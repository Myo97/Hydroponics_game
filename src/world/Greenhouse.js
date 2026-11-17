import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { BeamBatch, PanelBatch, CylinderBatch, boxMesh } from './Batches.js';
import { EntranceDoors } from './EntranceDoors.js';
import { BayScreens } from './BayScreens.js';
import { StickyTraps } from './StickyTraps.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Feature switches for the generic glasshouse builder. Everything defaults to
 * the main production house fit-out, so building with an empty spec reproduces
 * the original structure exactly.
 */
const DEFAULT_FEATURES = {
  bayScreens: true,
  stickyTraps: true,
  rainCollector: true,
  interiorDetails: true,
  vents: true,
};

const DEFAULT_INTERIOR = {
  drain: true,
  joints: [-12, -6, 0, 6, 12],
};

/**
 * Turn a compact greenhouse description into all derived geometry the builder
 * needs. Dimensions are local to the building centre; world placement is kept
 * separate so the same builder can serve any number of houses.
 */
export function resolveGreenhouseSpec(spec = {}) {
  const base = LAYOUT.greenhouse;
  const width = spec.width ?? base.width;
  const length = spec.length ?? base.length;
  const bayWidth = spec.bayWidth ?? base.bayWidth;
  const bayLength = spec.bayLength ?? base.bayLength;
  const centre = spec.centre ?? spec.center ?? [0, 0];
  const halfWidth = width / 2;
  const halfLength = length / 2;
  const bayCount = Math.max(1, Math.round(width / bayWidth));
  const frameCount = Math.max(1, Math.round(length / bayLength));
  const gutterXs = Array.from(
    { length: bayCount + 1 },
    (_, i) => -halfWidth + i * bayWidth,
  );
  const ridgeXs = Array.from(
    { length: bayCount },
    (_, i) => -halfWidth + bayWidth * (i + 0.5),
  );
  const frameZs = Array.from(
    { length: frameCount + 1 },
    (_, i) => -halfLength + i * bayLength,
  );
  const id = spec.id ?? 'greenhouse';
  const label = spec.label ?? 'Main Greenhouse';
  const isMainHouse = id === 'greenhouse';
  const entrance =
    spec.entrance === null
      ? null
      : { ...LAYOUT.entrance, ...(spec.entrance ?? {}) };

  return {
    id,
    label,
    zone: spec.zone ?? 'main',
    centreX: centre[0],
    centreZ: centre[1],
    width,
    length,
    bayWidth,
    bayLength,
    halfWidth,
    halfLength,
    gutterY: spec.gutterHeight ?? base.gutterHeight,
    ridgeY: spec.ridgeHeight ?? base.ridgeHeight,
    plinthY: spec.plinthHeight ?? base.plinthHeight,
    wallThickness: spec.wallThickness ?? base.wallThickness,
    perimeterColumnSize: spec.perimeterColumnSize ?? base.perimeterColumnSize,
    columnSize: spec.columnSize ?? base.columnSize,
    bayCount,
    frameCount,
    gutterXs,
    ridgeXs,
    frameZs,
    entrance,
    entranceTitle:
      spec.entranceTitle ??
      (isMainHouse ? 'Main entrance - sliding doors' : `${label} entrance - sliding doors`),
    entranceSign:
      spec.entranceSign ??
      {
        title: isMainHouse ? 'MAIN ENTRANCE' : `${label.toUpperCase()} ENTRANCE`,
        subtitle: 'SLIDING DOOR - KEEP CLEAR',
      },
    entranceDescription: spec.entranceDescription ?? null,
    entranceId: spec.entranceId ?? (isMainHouse ? 'entrance-doors' : `${id}-entrance-doors`),
    features: { ...DEFAULT_FEATURES, ...(spec.features ?? {}) },
    interior: {
      ...DEFAULT_INTERIOR,
      ...(spec.interior ?? {}),
      joints: spec.interior?.joints ?? [...DEFAULT_INTERIOR.joints],
    },
    signage: spec.signage ?? null,
  };
}

/**
 * Greenhouse environment system.
 * Builds a Venlo-style multi-span glasshouse: concrete slab and plinths,
 * galvanised steel frame, aluminium glazing bars, glass roof/walls, gutters and
 * an open sliding entrance door. Static collision volumes are registered with
 * the collision world; all structural geometry is instanced.
 *
 * The builder is fully parameterised: pass a `spec` (see
 * `resolveGreenhouseSpec`) to build a second, differently sized house that
 * shares the same construction language. Omitting the spec builds the main
 * 24 x 36 m production house exactly as before.
 */
export class Greenhouse {
  constructor({ scene, materials, collisionWorld, preset, control = null, spec = null }) {
    this.scene = scene;
    this.materials = materials;
    this.collisionWorld = collisionWorld;
    this.preset = preset;
    this.control = control;
    this.spec = resolveGreenhouseSpec(spec ?? {});
    this.dims = {
      width: this.spec.width,
      length: this.spec.length,
      halfWidth: this.spec.halfWidth,
      halfLength: this.spec.halfLength,
      gutterY: this.spec.gutterY,
      ridgeY: this.spec.ridgeY,
      plinthY: this.spec.plinthY,
      bayWidth: this.spec.bayWidth,
      bayLength: this.spec.bayLength,
    };
    this.features = this.spec.features;
    this.detailGroup = null;
    this.floorSlab = null;
    this.entrance = null;
    this.bayScreens = null;
    this.stickyTraps = null;
    this.interactables = [];
  }

  build() {
    this.group = new THREE.Group();
    this.group.name = this.spec.id;
    this.group.position.set(this.spec.centreX, 0, this.spec.centreZ);
    this.detailGroup = new THREE.Group();
    this.detailGroup.name = `${this.spec.id}-details`;

    this.buildFloor();
    this.buildPlinths();
    this.buildFrame();
    this.buildGlass();
    this.buildGuttersAndDownpipes();
    this.buildDoors();
    this.buildBayScreens();
    this.buildStickyTraps();
    this.buildInteriorDetails();
    this.buildSignage();
    this.buildColliders();

    this.group.add(this.detailGroup);
    this.group.traverse((child) => {
      if (child.isMesh) {
        child.frustumCulled = child.isInstancedMesh ? false : true;
      }
    });
    this.scene.add(this.group);
    return this;
  }

  /** Roof surface height at a given local X (ridge at span centre, gutter at edges). */
  roofYAt(x) {
    const { halfWidth, bayWidth, ridgeY, gutterY } = this.dims;
    const clampedX = Math.min(halfWidth - 1e-4, Math.max(-halfWidth + 1e-4, x));
    const spanIndex = Math.floor((clampedX + halfWidth) / bayWidth);
    const ridge = -halfWidth + spanIndex * bayWidth + bayWidth / 2;
    const t = Math.abs(clampedX - ridge) / (bayWidth / 2);
    return ridgeY - t * (ridgeY - gutterY);
  }

  buildFloor() {
    const { halfWidth, halfLength } = this.dims;
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(halfWidth * 2 + 0.7, 0.18, halfLength * 2 + 0.7),
      this.materials.concreteFloor,
    );
    floor.position.set(0, -0.085, 0);
    floor.receiveShadow = true;
    floor.name = 'floor-slab';
    this.floorSlab = floor;
    this.group.add(floor);
  }

  buildPlinths() {
    const { plinthY: plinthHeight, halfWidth, halfLength } = this.dims;
    const thickness = 0.24;
    const hw = halfWidth + thickness / 2;
    const hl = halfLength + thickness / 2;
    const doorHalf = this.spec.entrance ? this.spec.entrance.width / 2 : 0;
    const mat = this.materials.concretePlinth;

    const plinth = (width, depth, x, z) => {
      const mesh = boxMesh(width, plinthHeight, depth, mat, V(x, plinthHeight / 2, z), 'plinth');
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };

    const frontSegmentWidth = halfWidth + thickness / 2 - doorHalf;
    const frontSegmentCentre = (halfWidth + thickness / 2 + doorHalf) / 2;

    plinth(halfWidth * 2 + thickness * 2, thickness, 0, -hl);
    if (doorHalf > 0) {
      plinth(frontSegmentWidth, thickness, -frontSegmentCentre, hl);
      plinth(frontSegmentWidth, thickness, frontSegmentCentre, hl);
    } else {
      plinth(halfWidth * 2 + thickness * 2, thickness, 0, hl);
    }
    plinth(thickness, halfLength * 2, -hw, 0);
    plinth(thickness, halfLength * 2, hw, 0);

    // Galvanised flashing along the top of each plinth.
    const flashMat = this.materials.steel;
    const flashing = (width, depth, x, z) => {
      const mesh = boxMesh(width, 0.04, depth, flashMat, V(x, plinthHeight + 0.02, z));
      mesh.castShadow = false;
      this.group.add(mesh);
    };
    // The north plinth is flashed in one run. The south plinth is only flashed
    // in the two segments either side of the entrance; a full-width run would
    // leave a horizontal bar straight across the doorway.
    flashing(halfWidth * 2 + thickness * 2 + 0.06, thickness + 0.06, 0, -hl);
    if (doorHalf > 0) {
      flashing(frontSegmentWidth + 0.06, thickness + 0.06, -frontSegmentCentre, hl);
      flashing(frontSegmentWidth + 0.06, thickness + 0.06, frontSegmentCentre, hl);
    } else {
      flashing(halfWidth * 2 + thickness * 2 + 0.06, thickness + 0.06, 0, hl);
    }
    flashing(thickness + 0.06, halfLength * 2 + 0.06, -hw, 0);
    flashing(thickness + 0.06, halfLength * 2 + 0.06, hw, 0);
  }

  /** Structural frame, built entirely from instanced members. */
  buildFrame() {
    const steel = new BeamBatch(this.materials.steel);
    const alu = new BeamBatch(this.materials.aluminium);
    const {
      gutterY: gutterHeight,
      ridgeY: ridgeHeight,
      halfWidth,
      halfLength,
      bayWidth,
      plinthY,
    } = this.dims;
    const { perimeterColumnSize, columnSize } = this.spec;
    const doorHalf = this.spec.entrance ? this.spec.entrance.width / 2 : 0;

    // Columns at every gutter line / truss intersection.
    for (const x of this.spec.gutterXs) {
      for (const z of this.spec.frameZs) {
        if (z === halfLength && Math.abs(x) < doorHalf + 0.05) continue;
        const thickness =
          Math.abs(Math.abs(x) - halfWidth) < 1e-6 ? perimeterColumnSize : columnSize;
        steel.add(V(x, 0, z), V(x, gutterHeight - 0.06, z), thickness, thickness);
      }
    }

    // Transverse trusses: bottom chord, rafters following the roof, king posts.
    for (const z of this.spec.frameZs) {
      steel.add(
        V(-halfWidth, gutterHeight - 0.06, z),
        V(halfWidth, gutterHeight - 0.06, z),
        0.12,
        0.16,
      );
      for (const ridge of this.spec.ridgeXs) {
        for (const side of [-1, 1]) {
          const gutter = ridge + side * bayWidth / 2;
          steel.add(
            V(gutter, this.roofYAt(gutter) - 0.1, z),
            V(ridge, ridgeHeight - 0.1, z),
            0.075,
            0.075,
          );
        }
        steel.add(
          V(ridge, ridgeHeight - 0.11, z),
          V(ridge, gutterHeight - 0.06, z),
          0.06,
          0.06,
        );
      }
    }

    // Eave and mid-wall girts.
    for (const x of [-halfWidth, halfWidth]) {
      for (const y of [plinthY + 0.04, 2.72, gutterHeight - 0.08]) {
        steel.add(V(x, y, -halfLength), V(x, y, halfLength), 0.09, 0.12);
      }
    }

    // Side wall mullions every 2 m.
    for (const x of [-halfWidth, halfWidth]) {
      for (let z = -halfLength + 2; z < halfLength; z += 2) {
        alu.add(V(x, plinthY, z), V(x, gutterHeight - 0.05, z), 0.055, 0.08);
      }
    }

    // Gable mullions and barge boards.
    for (const zEnd of [-halfLength, halfLength]) {
      const isFront = zEnd === halfLength;
      for (let x = -halfWidth + 2; x < halfWidth; x += 2) {
        if (isFront && Math.abs(x) < doorHalf) {
          alu.add(
            V(x, (this.spec.entrance?.height ?? 0) + 0.02, zEnd),
            V(x, gutterHeight - 0.05, zEnd),
            0.055,
            0.08,
          );
          continue;
        }
        alu.add(V(x, plinthY, zEnd), V(x, gutterHeight - 0.05, zEnd), 0.055, 0.08);
      }
      // barge board following the roof line
      for (const ridge of this.spec.ridgeXs) {
        for (const side of [-1, 1]) {
          const gutter = ridge + side * bayWidth / 2;
          alu.add(
            V(gutter, this.roofYAt(gutter) - 0.03, zEnd),
            V(ridge, ridgeHeight - 0.03, zEnd),
            0.1,
            0.12,
          );
        }
      }
      // corner posts
      for (const x of [-halfWidth, halfWidth]) {
        steel.add(V(x, plinthY, zEnd), V(x, gutterHeight, zEnd), 0.14, 0.14);
      }
    }

    // Roof purlins and ridge caps along the length of the house.
    for (const ridge of this.spec.ridgeXs) {
      alu.add(
        V(ridge, ridgeHeight - 0.07, -halfLength),
        V(ridge, ridgeHeight - 0.07, halfLength),
        0.13,
        0.07,
      );
      alu.add(
        V(ridge, ridgeHeight + 0.03, -halfLength),
        V(ridge, ridgeHeight + 0.03, halfLength),
        0.2,
        0.09,
      );
      for (const side of [-1, 1]) {
        const midX = ridge + side;
        alu.add(
          V(midX, this.roofYAt(midX) - 0.045, -halfLength),
          V(midX, this.roofYAt(midX) - 0.045, halfLength),
          0.06,
          0.06,
        );
      }
    }
    for (const x of this.spec.gutterXs) {
      alu.add(
        V(x, gutterHeight - 0.02, -halfLength),
        V(x, gutterHeight - 0.02, halfLength),
        0.12,
        0.08,
      );
    }
    // Longitudinal ties at the ridge for lateral stiffness.
    for (const ridge of this.spec.ridgeXs) {
      steel.add(
        V(ridge, ridgeHeight - 0.14, -halfLength),
        V(ridge, ridgeHeight - 0.14, halfLength),
        0.05,
        0.05,
      );
    }

    steel.build(this.group, 'frame-steel');
    alu.build(this.group, 'frame-aluminium');
  }

  /** Glass roof, side walls and gable ends (instanced panes + merged gables). */
  buildGlass() {
    const panes = new PanelBatch(this.materials.glass);
    const { halfWidth: hw, halfLength: hl, bayWidth, bayLength, gutterY, ridgeY, plinthY } = this.dims;
    const doorHalf = this.spec.entrance ? this.spec.entrance.width / 2 : 0;
    const doorHeight = this.spec.entrance?.height ?? 0;
    const rightX = new THREE.Vector3(1, 0, 0);
    const rightZ = new THREE.Vector3(0, 0, 1);
    const upY = new THREE.Vector3(0, 1, 0);
    const wallHeight = gutterY - plinthY;
    const wallCentreY = (gutterY + plinthY) / 2;

    // Side wall glazing: one pane per bay.
    for (const x of [-hw, hw]) {
      const glassX = x - Math.sign(x) * 0.012;
      for (let i = 0; i < this.spec.frameZs.length - 1; i += 1) {
        const z = (this.spec.frameZs[i] + this.spec.frameZs[i + 1]) / 2;
        panes.add(new THREE.Vector3(glassX, wallCentreY, z), bayLength, wallHeight, rightZ, upY);
      }
    }

    // Roof glazing: one pane per bay on each side of every ridge. When hinged
    // vents are fitted the upper section of each slope is left open for the
    // vent leaf, so opening a vent exposes sky instead of a second glass layer.
    const slopeLength = Math.hypot(bayWidth / 2, ridgeY - gutterY);
    const ventSlopeLength = this.features.vents
      ? Math.min(LAYOUT.vents.slopeLength, slopeLength - 0.1)
      : 0;
    const glazedLength = slopeLength - ventSlopeLength;
    const glazedDistance = ventSlopeLength + glazedLength / 2;
    for (const ridge of this.spec.ridgeXs) {
      for (const side of [-1, 1]) {
        const right = new THREE.Vector3(side * (bayWidth / 2), gutterY - ridgeY, 0).normalize();
        const centreX = ridge + side * (glazedDistance / slopeLength) * (bayWidth / 2);
        const centreY = ridgeY - (glazedDistance / slopeLength) * (ridgeY - gutterY);
        for (let i = 0; i < this.spec.frameZs.length - 1; i += 1) {
          const z = (this.spec.frameZs[i] + this.spec.frameZs[i + 1]) / 2;
          panes.add(
            new THREE.Vector3(centreX, centreY, z),
            glazedLength,
            bayLength,
            right,
            rightZ,
          );
        }
      }
    }

    // Gable end glazing below the eaves.
    for (const zEnd of [-hl, hl]) {
      const glassZ = zEnd - Math.sign(zEnd) * 0.012;
      if (zEnd === hl && doorHalf > 0) {
        // Front: leave the doorway clear, glaze both sides and the transom.
        const regionWidth = hw - doorHalf;
        const count = Math.max(1, Math.ceil(regionWidth / 2.1));
        const paneWidth = regionWidth / count;
        for (const sign of [-1, 1]) {
          for (let i = 0; i < count; i += 1) {
            const x = sign * (doorHalf + paneWidth * (i + 0.5));
            panes.add(new THREE.Vector3(x, wallCentreY, glassZ), paneWidth, wallHeight, rightX, upY);
          }
        }
        for (const x of [-doorHalf / 2, doorHalf / 2]) {
          panes.add(
            new THREE.Vector3(x, (doorHeight + gutterY) / 2, glassZ),
            doorHalf,
            gutterY - doorHeight,
            rightX,
            upY,
          );
        }
      } else {
        const count = Math.max(1, Math.round((hw * 2) / 2));
        const paneWidth = (hw * 2) / count;
        for (let i = 0; i < count; i += 1) {
          const x = -hw + paneWidth * (i + 0.5);
          panes.add(new THREE.Vector3(x, wallCentreY, glassZ), paneWidth, wallHeight, rightX, upY);
        }
      }
    }

    panes.build(this.group, 'glass-panes');
    this.buildGableTriangles();
  }

  /** Glass in the triangular gable above the gutter line. */
  buildGableTriangles() {
    const { halfWidth, halfLength, bayWidth, gutterY, ridgeY } = this.dims;
    const positions = [];
    const normals = [];
    const uvs = [];

    const pushVertex = (x, y, z, normalZ) => {
      positions.push(x, y, z);
      normals.push(0, 0, normalZ);
      uvs.push((x + halfWidth) / (halfWidth * 2), (y - gutterY) / (ridgeY - gutterY));
    };

    for (const zEnd of [-halfLength, halfLength]) {
      const normalZ = Math.sign(zEnd);
      for (const ridge of this.spec.ridgeXs) {
        const left = ridge - bayWidth / 2;
        const right = ridge + bayWidth / 2;
        pushVertex(left, gutterY, zEnd, normalZ);
        pushVertex(right, gutterY, zEnd, normalZ);
        pushVertex(ridge, ridgeY, zEnd, normalZ);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.materials.glass);
    mesh.name = 'gable-glazing';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 2;
    this.group.add(mesh);
  }

  buildGuttersAndDownpipes() {
    const pipes = new CylinderBatch(this.materials.aluminium);
    const rain = new CylinderBatch(this.materials.pvcWhite);
    const { halfWidth: hw, halfLength: hl, gutterY } = this.dims;
    const gutterTop = gutterY - 0.04;
    const collector = LAYOUT.rainwater;
    const splash = (x, z) => {
      const block = boxMesh(
        0.46,
        0.1,
        0.46,
        this.materials.concretePlinth,
        V(x, 0.05, z),
        'downpipe-splash-block',
      );
      block.castShadow = true;
      this.group.add(block);
    };

    // Eave gutters run the length of the house at every gutter line.
    for (const x of this.spec.gutterXs) {
      pipes.add(V(x, gutterTop, -hl), V(x, gutterTop, hl), 0.11);
      // North end drops into the rainwater collector that feeds the harvester.
      if (this.features.rainCollector) {
        rain.addPath(
          [
            V(x, gutterTop, -hl + 0.06),
            V(x, collector.collectorY, collector.collectorZ),
          ],
          collector.collectorRadius * 0.55,
        );
      }
    }

    if (this.features.rainCollector) {
      // Level collector along the north eave, falling to the central downpipe.
      rain.add(
        V(-hw, collector.collectorY + 0.05, collector.collectorZ),
        V(collector.downpipeX, collector.collectorY, collector.collectorZ),
        collector.collectorRadius,
      );
      rain.add(
        V(collector.downpipeX, collector.collectorY, collector.collectorZ),
        V(hw, collector.collectorY + 0.05, collector.collectorZ),
        collector.collectorRadius,
      );

      // Central downpipe drops straight to the harvester first-flush chamber.
      rain.addPath(
        [
          V(collector.downpipeX, collector.collectorY, collector.collectorZ),
          V(collector.downpipeX, collector.harvesterInletY, collector.collectorZ),
        ],
        0.075,
      );
      rain.addJoint(V(collector.downpipeX, collector.collectorY, collector.collectorZ), 0.14);
      rain.addJoint(
        V(collector.downpipeX, collector.harvesterInletY, collector.collectorZ),
        0.1,
      );
    }

    // Front downpipes still discharge to splash blocks; the roof water that
    // matters for irrigation is captured on the north collector.
    for (const sx of [-1, 1]) {
      const x = sx * (hw - 0.22);
      const z = hl - 0.25;
      pipes.addPath(
        [
          V(sx * hw, gutterTop - 0.1, z),
          V(x, gutterTop - 0.1, z),
          V(x, 0.16, z),
          V(x - sx * 0.12, 0.16, z),
        ],
        0.055,
      );
      splash(x - sx * 0.12, z);
    }

    // The nursery has no harvester, so its north eaves discharge to the apron
    // through matching rear downpipes instead of a collector run.
    if (!this.features.rainCollector) {
      for (const sx of [-1, 1]) {
        const x = sx * (hw - 0.22);
        const z = -hl + 0.25;
        pipes.addPath(
          [
            V(sx * hw, gutterTop - 0.1, z),
            V(x, gutterTop - 0.1, z),
            V(x, 0.16, z),
            V(x - sx * 0.12, 0.16, z),
          ],
          0.055,
        );
        splash(x - sx * 0.12, z);
      }
    }

    pipes.build(this.group, 'gutters-downpipes');
    if (this.features.rainCollector) rain.build(this.group, 'rainwater-collector');
  }

  /** Build the animated, two-leaf sliding entrance. */
  buildDoors() {
    if (!this.spec.entrance) return;
    this.entrance = new EntranceDoors({
      materials: this.materials,
      collisionWorld: this.collisionWorld,
      config: this.spec.entrance,
      frameZ: this.dims.halfLength,
      originX: this.spec.centreX,
      originZ: this.spec.centreZ,
      buildingId: this.spec.id,
      id: this.spec.entranceId,
      groupName: `${this.spec.id}-entrance-sliding-doors`,
      title: this.spec.entranceTitle,
      sign: this.spec.entranceSign,
      description: this.spec.entranceDescription,
    }).build(this.group);
    this.interactables.push(...this.entrance.interactables);
  }

  /**
   * Optional building name board mounted above the south entrance. The main
   * house relies on its existing door sign, so only specified houses build it.
   */
  buildSignage() {
    const signage = this.spec.signage;
    if (!signage) return;
    const { halfLength } = this.dims;
    const width = signage.width ?? 2.4;
    const height = signage.height ?? 0.72;
    const y = signage.y ?? this.dims.gutterY - 0.9;
    const z = halfLength + 0.06;

    const backing = boxMesh(
      width + 0.14,
      height + 0.14,
      0.06,
      this.materials.steelDark,
      V(0, y, z),
      'nursery-sign-backing',
    );
    backing.castShadow = true;
    this.group.add(backing);

    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      this.materials.createLabelMaterial(signage.title, signage.subtitle, signage.options),
    );
    plate.position.set(0, y, z + 0.035);
    plate.name = 'nursery-sign';
    this.group.add(plate);

    for (const x of [-width * 0.32, width * 0.32]) {
      this.group.add(
        boxMesh(
          0.05,
          0.05,
          0.16,
          this.materials.aluminium,
          V(x, y + height / 2 - 0.03, z - 0.1),
          'nursery-sign-bracket',
        ),
      );
    }
  }

  /** Per-bay shade, energy screen and hinged ridge vents (main house only). */
  buildBayScreens() {
    if (!this.features.bayScreens || !this.control) return;
    this.bayScreens = new BayScreens({
      materials: this.materials,
      control: this.control,
    }).build(this.group);
    this.interactables.push(...this.bayScreens.interactables);
  }

  /** Yellow sticky traps clipped to the structural columns. */
  buildStickyTraps() {
    if (!this.features.stickyTraps) return;
    this.stickyTraps = new StickyTraps({ materials: this.materials }).build(this.group);
    this.interactables.push(...this.stickyTraps.interactables);
  }

  getInteractables() {
    return this.interactables;
  }

  toggleEntranceDoors() {
    return this.entrance?.toggle() ?? false;
  }

  update(dt) {
    this.entrance?.update(dt);
    this.bayScreens?.update(dt);
    this.stickyTraps?.update(dt);
  }

  /** Drone view hides overhead screens/vents and the floor slab for a cutaway. */
  setTopView(active) {
    if (this.floorSlab) this.floorSlab.visible = !active;
    this.bayScreens?.setTopView(active);
    this.stickyTraps?.setTopView(active);
  }

  /** Floor joints, central drain channel and other small fixed details. */
  buildInteriorDetails() {
    if (!this.features.interiorDetails) return;
    const { halfWidth: hw, halfLength: hl } = this.dims;
    const detail = this.detailGroup;

    // Saw-cut expansion joints in the slab.
    for (const z of this.spec.interior.joints) {
      if (Math.abs(z) > hl - 0.2) continue;
      const joint = boxMesh(
        hw * 2 - 0.5,
        0.012,
        0.045,
        this.materials.floorJoint,
        V(0, 0.006, z),
        'floor-joint',
      );
      joint.receiveShadow = true;
      detail.add(joint);
    }

    if (!this.spec.interior.drain) return;

    // Recessed drainage channel down the central aisle.
    const channelStart = -9;
    const channelEnd = hl - 0.6;
    const channelLength = channelEnd - channelStart;

    const recess = boxMesh(
      0.34,
      0.02,
      channelLength,
      this.materials.concreteFloor,
      V(0, 0.004, (channelStart + channelEnd) / 2),
      'drain-recess',
    );
    recess.receiveShadow = true;
    detail.add(recess);

    const bars = new BeamBatch(this.materials.drainGrate);
    for (let z = channelStart + 0.1; z < channelEnd; z += 0.12) {
      bars.add(V(-0.15, 0.017, z), V(0.15, 0.017, z), 0.022, 0.028);
    }
    // Longitudinal edge angles.
    for (const x of [-0.17, 0.17]) {
      bars.add(V(x, 0.02, channelStart), V(x, 0.02, channelEnd), 0.03, 0.03);
    }
    const barMesh = bars.build(detail, 'drain-grate');
    barMesh.receiveShadow = true;
  }

  /** Static walls and columns for the collision world. */
  buildColliders() {
    const cw = this.collisionWorld;
    if (!cw) return;
    const { halfWidth, halfLength } = this.dims;
    const { centreX, centreZ } = this.spec;
    const thickness = 0.36;
    const doorHalf = this.spec.entrance ? this.spec.entrance.width / 2 : 0;
    const segmentWidth = halfWidth - doorHalf;
    const segmentCentre = doorHalf + segmentWidth / 2;

    // Register the building footprint so player zones and future systems can
    // tell which house the player is standing in.
    cw.addFootprint?.({
      x: centreX,
      z: centreZ,
      width: this.spec.width,
      depth: this.spec.length,
      label: this.spec.label,
      zone: this.spec.zone,
      buildingId: this.spec.id,
    });

    cw.addBox({
      x: centreX,
      z: centreZ - halfLength,
      width: this.spec.width + 0.7,
      depth: thickness,
      label: 'north wall',
    });
    if (doorHalf > 0) {
      cw.addBox({
        x: centreX - segmentCentre,
        z: centreZ + halfLength,
        width: segmentWidth,
        depth: thickness,
        label: 'south wall (left)',
      });
      cw.addBox({
        x: centreX + segmentCentre,
        z: centreZ + halfLength,
        width: segmentWidth,
        depth: thickness,
        label: 'south wall (right)',
      });
    }
    for (const x of [-halfWidth, halfWidth]) {
      cw.addBox({
        x: centreX + x,
        z: centreZ,
        width: thickness,
        depth: this.spec.length,
        label: 'side wall',
      });
    }

    for (const x of this.spec.gutterXs) {
      if (Math.abs(Math.abs(x) - halfWidth) < 1e-6) continue;
      for (const z of this.spec.frameZs) {
        if (z === halfLength && Math.abs(x) < doorHalf) continue;
        cw.addBox({
          x: centreX + x,
          z: centreZ + z,
          width: 0.3,
          depth: 0.3,
          label: 'column',
        });
      }
    }
  }

  setDetailVisible(visible) {
    if (this.detailGroup) this.detailGroup.visible = visible;
  }

  dispose() {
    this.bayScreens?.dispose();
    this.stickyTraps?.dispose();
    this.bayScreens = null;
    this.stickyTraps = null;
    this.interactables.length = 0;
    this.group.traverse((child) => {
      if (child.isMesh && child.geometry) child.geometry.dispose();
    });
    this.group.parent?.remove(this.group);
  }
}
