import * as THREE from 'three';
import { LAYOUT, DIM, GUTTER_X, RIDGE_X, FRAME_Z } from '../config/layout.js';
import { BeamBatch, PanelBatch, CylinderBatch, boxMesh } from './Batches.js';
import { EntranceDoors } from './EntranceDoors.js';
import { BayScreens } from './BayScreens.js';
import { StickyTraps } from './StickyTraps.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Greenhouse environment system.
 * Builds a Venlo-style multi-span glasshouse: concrete slab and plinths,
 * galvanised steel frame, aluminium glazing bars, glass roof/walls, gutters and
 * an open sliding entrance door. Static collision volumes are registered with
 * the collision world; all structural geometry is instanced.
 */
export class Greenhouse {
  constructor({ scene, materials, collisionWorld, preset, control = null }) {
    this.scene = scene;
    this.materials = materials;
    this.collisionWorld = collisionWorld;
    this.preset = preset;
    this.control = control;
    this.detailGroup = null;
    this.floorSlab = null;
    this.entrance = null;
    this.bayScreens = null;
    this.stickyTraps = null;
    this.interactables = [];
  }

  build() {
    this.group = new THREE.Group();
    this.group.name = 'greenhouse';
    this.detailGroup = new THREE.Group();
    this.detailGroup.name = 'greenhouse-details';

    this.buildFloor();
    this.buildPlinths();
    this.buildFrame();
    this.buildGlass();
    this.buildGuttersAndDownpipes();
    this.buildDoors();
    this.buildBayScreens();
    this.buildStickyTraps();
    this.buildInteriorDetails();
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

  /** Roof surface height at a given X (ridge at span centre, gutter at edges). */
  roofYAt(x) {
    const clampedX = Math.min(DIM.halfWidth - 1e-4, Math.max(-DIM.halfWidth + 1e-4, x));
    const spanIndex = Math.floor((clampedX + DIM.halfWidth) / DIM.bayWidth);
    const ridge = -DIM.halfWidth + spanIndex * DIM.bayWidth + DIM.bayWidth / 2;
    const t = Math.abs(clampedX - ridge) / (DIM.bayWidth / 2);
    return DIM.ridgeY - t * (DIM.ridgeY - DIM.gutterY);
  }

  buildFloor() {
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(DIM.halfWidth * 2 + 0.7, 0.18, DIM.halfLength * 2 + 0.7),
      this.materials.concreteFloor,
    );
    floor.position.set(0, -0.085, 0);
    floor.receiveShadow = true;
    floor.name = 'floor-slab';
    this.floorSlab = floor;
    this.group.add(floor);
  }

  buildPlinths() {
    const { plinthHeight } = LAYOUT.greenhouse;
    const thickness = 0.24;
    const hw = DIM.halfWidth + thickness / 2;
    const hl = DIM.halfLength + thickness / 2;
    const doorHalf = LAYOUT.entrance.width / 2;
    const mat = this.materials.concretePlinth;

    const plinth = (width, depth, x, z) => {
      const mesh = boxMesh(width, plinthHeight, depth, mat, V(x, plinthHeight / 2, z), 'plinth');
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };

    const frontSegmentWidth = DIM.halfWidth + thickness / 2 - doorHalf;
    const frontSegmentCentre = (DIM.halfWidth + thickness / 2 + doorHalf) / 2;

    plinth(DIM.halfWidth * 2 + thickness * 2, thickness, 0, -hl);
    plinth(frontSegmentWidth, thickness, -frontSegmentCentre, hl);
    plinth(frontSegmentWidth, thickness, frontSegmentCentre, hl);
    plinth(thickness, DIM.halfLength * 2, -hw, 0);
    plinth(thickness, DIM.halfLength * 2, hw, 0);

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
    flashing(DIM.halfWidth * 2 + thickness * 2 + 0.06, thickness + 0.06, 0, -hl);
    flashing(frontSegmentWidth + 0.06, thickness + 0.06, -frontSegmentCentre, hl);
    flashing(frontSegmentWidth + 0.06, thickness + 0.06, frontSegmentCentre, hl);
    flashing(thickness + 0.06, DIM.halfLength * 2 + 0.06, -hw, 0);
    flashing(thickness + 0.06, DIM.halfLength * 2 + 0.06, hw, 0);
  }

  /** Structural frame, built entirely from instanced members. */
  buildFrame() {
    const steel = new BeamBatch(this.materials.steel);
    const alu = new BeamBatch(this.materials.aluminium);
    const { gutterHeight, ridgeHeight } = LAYOUT.greenhouse;
    const halfWidth = DIM.halfWidth;
    const halfLength = DIM.halfLength;
    const doorHalf = LAYOUT.entrance.width / 2;

    // Columns at every gutter line / truss intersection.
    for (const x of GUTTER_X) {
      for (const z of FRAME_Z) {
        if (z === halfLength && Math.abs(x) < doorHalf + 0.05) continue;
        const thickness =
          Math.abs(x) === halfWidth
            ? LAYOUT.greenhouse.perimeterColumnSize
            : LAYOUT.greenhouse.columnSize;
        steel.add(V(x, 0, z), V(x, gutterHeight - 0.06, z), thickness, thickness);
      }
    }

    // Transverse trusses: bottom chord, rafters following the roof, king posts.
    for (const z of FRAME_Z) {
      steel.add(
        V(-halfWidth, gutterHeight - 0.06, z),
        V(halfWidth, gutterHeight - 0.06, z),
        0.12,
        0.16,
      );
      for (const ridge of RIDGE_X) {
        for (const side of [-1, 1]) {
          const gutter = ridge + side * DIM.bayWidth / 2;
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
      for (const y of [DIM.plinthY + 0.04, 2.72, gutterHeight - 0.08]) {
        steel.add(V(x, y, -halfLength), V(x, y, halfLength), 0.09, 0.12);
      }
    }

    // Side wall mullions every 2 m.
    for (const x of [-halfWidth, halfWidth]) {
      for (let z = -halfLength + 2; z < halfLength; z += 2) {
        alu.add(V(x, DIM.plinthY, z), V(x, gutterHeight - 0.05, z), 0.055, 0.08);
      }
    }

    // Gable mullions and barge boards.
    for (const zEnd of [-halfLength, halfLength]) {
      const isFront = zEnd === halfLength;
      for (let x = -halfWidth + 2; x < halfWidth; x += 2) {
        if (isFront && Math.abs(x) < doorHalf) {
          alu.add(V(x, LAYOUT.entrance.height + 0.02, zEnd), V(x, gutterHeight - 0.05, zEnd), 0.055, 0.08);
          continue;
        }
        alu.add(V(x, DIM.plinthY, zEnd), V(x, gutterHeight - 0.05, zEnd), 0.055, 0.08);
      }
      // barge board following the roof line
      for (const ridge of RIDGE_X) {
        for (const side of [-1, 1]) {
          const gutter = ridge + side * DIM.bayWidth / 2;
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
        steel.add(V(x, DIM.plinthY, zEnd), V(x, gutterHeight, zEnd), 0.14, 0.14);
      }
    }

    // Roof purlins and ridge caps along the length of the house.
    for (const ridge of RIDGE_X) {
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
    for (const x of GUTTER_X) {
      alu.add(
        V(x, gutterHeight - 0.02, -halfLength),
        V(x, gutterHeight - 0.02, halfLength),
        0.12,
        0.08,
      );
    }
    // Longitudinal ties at the ridge for lateral stiffness.
    for (const ridge of RIDGE_X) {
      steel.add(
        V(ridge, DIM.ridgeY - 0.14, -halfLength),
        V(ridge, DIM.ridgeY - 0.14, halfLength),
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
    const hw = DIM.halfWidth;
    const hl = DIM.halfLength;
    const doorHalf = LAYOUT.entrance.width / 2;
    const rightX = new THREE.Vector3(1, 0, 0);
    const rightZ = new THREE.Vector3(0, 0, 1);
    const upY = new THREE.Vector3(0, 1, 0);
    const wallHeight = DIM.gutterY - DIM.plinthY;
    const wallCentreY = (DIM.gutterY + DIM.plinthY) / 2;

    // Side wall glazing: one pane per 4 m bay.
    for (const x of [-hw, hw]) {
      const glassX = x - Math.sign(x) * 0.012;
      for (let i = 0; i < FRAME_Z.length - 1; i += 1) {
        const z = (FRAME_Z[i] + FRAME_Z[i + 1]) / 2;
        panes.add(new THREE.Vector3(glassX, wallCentreY, z), DIM.bayLength, wallHeight, rightZ, upY);
      }
    }

    // Roof glazing: one pane per bay on each side of every ridge. The upper
    // section of each slope is left open for the hinged vent leaf, so opening a
    // vent exposes sky and mesh instead of a second layer of glass.
    const slopeLength = Math.hypot(DIM.bayWidth / 2, DIM.ridgeY - DIM.gutterY);
    const ventSlopeLength = Math.min(LAYOUT.vents.slopeLength, slopeLength - 0.1);
    const glazedLength = slopeLength - ventSlopeLength;
    const glazedDistance = ventSlopeLength + glazedLength / 2;
    for (const ridge of RIDGE_X) {
      for (const side of [-1, 1]) {
        const right = new THREE.Vector3(
          side * (DIM.bayWidth / 2),
          DIM.gutterY - DIM.ridgeY,
          0,
        ).normalize();
        const centreX = ridge + side * (glazedDistance / slopeLength) * (DIM.bayWidth / 2);
        const centreY = DIM.ridgeY - (glazedDistance / slopeLength) * (DIM.ridgeY - DIM.gutterY);
        for (let i = 0; i < FRAME_Z.length - 1; i += 1) {
          const z = (FRAME_Z[i] + FRAME_Z[i + 1]) / 2;
          panes.add(
            new THREE.Vector3(centreX, centreY, z),
            glazedLength,
            DIM.bayLength,
            right,
            rightZ,
          );
        }
      }
    }

    // Gable end glazing below the eaves.
    for (const zEnd of [-hl, hl]) {
      const glassZ = zEnd - Math.sign(zEnd) * 0.012;
      if (zEnd === hl) {
        // Front: leave the doorway clear, glaze both sides and the transom.
        const regionWidth = hw - doorHalf;
        const count = 5;
        const paneWidth = regionWidth / count;
        for (const sign of [-1, 1]) {
          for (let i = 0; i < count; i += 1) {
            const x = sign * (doorHalf + paneWidth * (i + 0.5));
            panes.add(new THREE.Vector3(x, wallCentreY, glassZ), paneWidth, wallHeight, rightX, upY);
          }
        }
        for (const x of [-doorHalf / 2, doorHalf / 2]) {
          panes.add(
            new THREE.Vector3(x, (LAYOUT.entrance.height + DIM.gutterY) / 2, glassZ),
            doorHalf,
            DIM.gutterY - LAYOUT.entrance.height,
            rightX,
            upY,
          );
        }
      } else {
        for (let i = 0; i < 12; i += 1) {
          const x = -hw + 1 + i * 2;
          panes.add(new THREE.Vector3(x, wallCentreY, glassZ), 2, wallHeight, rightX, upY);
        }
      }
    }

    panes.build(this.group, 'glass-panes');
    this.buildGableTriangles();
  }

  /** Glass in the triangular gable above the gutter line. */
  buildGableTriangles() {
    const positions = [];
    const normals = [];
    const uvs = [];

    const pushVertex = (x, y, z, normalZ) => {
      positions.push(x, y, z);
      normals.push(0, 0, normalZ);
      uvs.push((x + DIM.halfWidth) / (DIM.halfWidth * 2), (y - DIM.gutterY) / (DIM.ridgeY - DIM.gutterY));
    };

    for (const zEnd of [-DIM.halfLength, DIM.halfLength]) {
      const normalZ = Math.sign(zEnd);
      for (const ridge of RIDGE_X) {
        const left = ridge - DIM.bayWidth / 2;
        const right = ridge + DIM.bayWidth / 2;
        pushVertex(left, DIM.gutterY, zEnd, normalZ);
        pushVertex(right, DIM.gutterY, zEnd, normalZ);
        pushVertex(ridge, DIM.ridgeY, zEnd, normalZ);
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
    const hw = DIM.halfWidth;
    const hl = DIM.halfLength;
    const gutterY = DIM.gutterY - 0.04;
    const collector = LAYOUT.rainwater;

    // Eave gutters run the length of the house at every gutter line.
    for (const x of GUTTER_X) {
      pipes.add(V(x, gutterY, -hl), V(x, gutterY, hl), 0.11);
      // North end drops into the rainwater collector that feeds the harvester.
      rain.addPath(
        [
          V(x, gutterY, -hl + 0.06),
          V(x, collector.collectorY, collector.collectorZ),
        ],
        collector.collectorRadius * 0.55,
      );
    }

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

    // Front downpipes still discharge to splash blocks; the roof water that
    // matters for irrigation is captured on the north collector.
    for (const sx of [-1, 1]) {
      const x = sx * (hw - 0.22);
      const z = hl - 0.25;
      pipes.addPath(
        [
          V(sx * hw, gutterY - 0.1, z),
          V(x, gutterY - 0.1, z),
          V(x, 0.16, z),
          V(x - sx * 0.12, 0.16, z),
        ],
        0.055,
      );
      const block = boxMesh(
        0.46,
        0.1,
        0.46,
        this.materials.concretePlinth,
        V(x - sx * 0.12, 0.05, z),
        'downpipe-splash-block',
      );
      block.castShadow = true;
      this.group.add(block);
    }

    pipes.build(this.group, 'gutters-downpipes');
    rain.build(this.group, 'rainwater-collector');
  }

  /** Build the animated, two-leaf sliding main entrance. */
  buildDoors() {
    this.entrance = new EntranceDoors({
      materials: this.materials,
      collisionWorld: this.collisionWorld,
    }).build(this.group);
    this.interactables.push(...this.entrance.interactables);
  }

  /** Per-bay shade, energy screen and hinged ridge vents. */
  buildBayScreens() {
    this.bayScreens = new BayScreens({
      materials: this.materials,
      control: this.control,
    }).build(this.group);
    this.interactables.push(...this.bayScreens.interactables);
  }

  /** Yellow sticky traps clipped to the structural columns. */
  buildStickyTraps() {
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
    const hw = DIM.halfWidth;
    const detail = this.detailGroup;

    // Saw-cut expansion joints in the slab.
    for (const z of [-12, -6, 0, 6, 12]) {
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

    // Recessed drainage channel down the central aisle.
    const channelStart = -9;
    const channelEnd = DIM.halfLength - 0.6;
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
    const thickness = 0.36;
    const doorHalf = LAYOUT.entrance.width / 2;
    const segmentWidth = DIM.halfWidth - doorHalf;
    const segmentCentre = doorHalf + segmentWidth / 2;

    cw.addBox({
      x: 0,
      z: -DIM.halfLength,
      width: DIM.halfWidth * 2 + 0.7,
      depth: thickness,
      label: 'north wall',
    });
    cw.addBox({
      x: -segmentCentre,
      z: DIM.halfLength,
      width: segmentWidth,
      depth: thickness,
      label: 'south wall (left)',
    });
    cw.addBox({
      x: segmentCentre,
      z: DIM.halfLength,
      width: segmentWidth,
      depth: thickness,
      label: 'south wall (right)',
    });
    for (const x of [-DIM.halfWidth, DIM.halfWidth]) {
      cw.addBox({
        x,
        z: 0,
        width: thickness,
        depth: DIM.halfLength * 2,
        label: 'side wall',
      });
    }

    for (const x of [-8, -4, 0, 4, 8]) {
      for (const z of FRAME_Z) {
        if (z === DIM.halfLength && Math.abs(x) < doorHalf) continue;
        cw.addBox({ x, z, width: 0.3, depth: 0.3, label: 'column' });
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

