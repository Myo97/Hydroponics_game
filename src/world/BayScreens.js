import * as THREE from 'three';
import { LAYOUT, DIM, GUTTER_X, RIDGE_X } from '../config/layout.js';
import { BeamBatch, CylinderBatch, boxMesh } from './Batches.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Symmetric ease used by every actuator so starts and stops feel mechanical. */
const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * Advance one eased actuator tween toward `target`.
 * `tween.value` is the current position, `duration` the full stroke time.
 */
function advanceTween(tween, target, dt, duration) {
  if (target !== tween.target) {
    tween.from = tween.value;
    tween.target = target;
    tween.elapsed = 0;
  }
  if (tween.value === tween.target) return tween.value;

  const stroke = Math.max(0.0001, duration);
  tween.elapsed = Math.min(tween.elapsed + Math.max(0, dt), stroke);
  const t = tween.elapsed / stroke;
  tween.value =
    t >= 1 ? tween.target : tween.from + (tween.target - tween.from) * easeInOutCubic(t);
  return tween.value;
}

/**
 * Per-bay climate hardware (Version 4).
 *
 * Six independent 4 m bays each carry:
 *   - a horizontal shade cloth that retracts north into a compact bundle,
 *   - a reflective energy screen on its own carriage below the shade,
 *   - a pair of continuous ridge vents hinged along the roof ridge.
 *
 * Every panel is driven by `GreenhouseControlSystem.bays[]` and moves with an
 * eased 2.4 s stroke, so a cabinet switch only moves the hardware in that bay
 * while the other bays keep their current position.
 */
export class BayScreens {
  constructor({ materials, control = null }) {
    this.materials = materials;
    this.control = control;
    this.group = null;
    this.shadeGroup = null;
    this.energyGroup = null;
    this.ventGroup = null;
    this.shadePanels = [];
    this.energyPanels = [];
    this.vents = [];
    this.screen = null;
    this.interactables = [];
    this.ventMeshMaterial = new THREE.MeshBasicMaterial({
      color: 0x1d2a24,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  build(parent) {
    const group = new THREE.Group();
    group.name = 'bay-climate-screens';
    this.group = group;
    parent.add(group);

    const bayCount = GUTTER_X.length - 1;
    const width = DIM.bayWidth - LAYOUT.screens.bayGap;
    const northEdgeZ = -DIM.halfLength + LAYOUT.screens.insetZ;
    const depth = DIM.halfLength * 2 - LAYOUT.screens.insetZ * 2;

    const shadeGroup = new THREE.Group();
    shadeGroup.name = 'shade-screen';
    group.add(shadeGroup);
    this.shadeGroup = shadeGroup;

    const energyGroup = new THREE.Group();
    energyGroup.name = 'energy-screen';
    group.add(energyGroup);
    this.energyGroup = energyGroup;

    const wires = new CylinderBatch(this.materials.steelDark, {
      castShadow: false,
      receiveShadow: false,
    });
    const drives = new BeamBatch(this.materials.steelDark, { castShadow: false });

    for (let index = 0; index < bayCount; index += 1) {
      const west = GUTTER_X[index];
      const east = GUTTER_X[index + 1];
      const centerX = (west + east) / 2;
      const bay = index + 1;

      // Geometry is anchored on its north edge so scaling drives a real retract.
      const shadeGeometry = new THREE.PlaneGeometry(width, depth);
      shadeGeometry.translate(0, -depth / 2, 0);
      const shade = new THREE.Mesh(shadeGeometry, this.materials.shadeCloth);
      shade.name = `shade-bay-${bay}`;
      shade.rotation.x = -Math.PI / 2;
      shade.position.set(centerX, LAYOUT.screens.shadeY, northEdgeZ);
      shade.receiveShadow = false;
      shade.castShadow = false;
      shade.renderOrder = 1;
      shadeGroup.add(shade);
      if (!this.screen) this.screen = shade;

      const shadeBar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.019, 0.019, width - 0.06, 10),
        this.materials.aluminium,
      );
      shadeBar.rotation.z = Math.PI / 2;
      shadeBar.position.set(centerX, LAYOUT.screens.shadeY - 0.025, northEdgeZ + depth);
      shadeGroup.add(shadeBar);

      const energyGeometry = new THREE.PlaneGeometry(width, depth);
      energyGeometry.translate(0, -depth / 2, 0);
      const energy = new THREE.Mesh(energyGeometry, this.materials.energyScreen);
      energy.name = `energy-bay-${bay}`;
      energy.rotation.x = -Math.PI / 2;
      energy.position.set(centerX, LAYOUT.screens.energyY, northEdgeZ);
      energy.receiveShadow = false;
      energy.castShadow = false;
      energy.renderOrder = 1;
      energyGroup.add(energy);

      const energyBar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.017, 0.017, width - 0.06, 10),
        this.materials.stainless,
      );
      energyBar.rotation.z = Math.PI / 2;
      energyBar.position.set(centerX, LAYOUT.screens.energyY - 0.022, northEdgeZ + depth);
      energyGroup.add(energyBar);

      this.shadePanels.push({
        bay,
        mesh: shade,
        bar: shadeBar,
        depth,
        northEdgeZ,
        coverage: 1,
        tween: { value: 1, from: 1, target: 1, elapsed: 0 },
      });
      this.energyPanels.push({
        bay,
        mesh: energy,
        bar: energyBar,
        depth,
        northEdgeZ,
        coverage: LAYOUT.screens.retractedFraction,
        tween: {
          value: LAYOUT.screens.retractedFraction,
          from: LAYOUT.screens.retractedFraction,
          target: LAYOUT.screens.retractedFraction,
          elapsed: 0,
        },
      });

      // Screen drive motor and gearbox at the north head rail.
      drives.add(
        V(centerX - 0.16, LAYOUT.screens.shadeY + 0.16, northEdgeZ + 0.1),
        V(centerX + 0.16, LAYOUT.screens.shadeY + 0.16, northEdgeZ + 0.1),
        0.045,
        0.045,
      );
      drives.add(
        V(centerX, LAYOUT.screens.shadeY + 0.02, northEdgeZ + 0.1),
        V(centerX, LAYOUT.screens.shadeY + 0.16, northEdgeZ + 0.1),
        0.026,
        0.026,
      );

      // Tension wires for both decks.
      for (const y of [LAYOUT.screens.shadeY - 0.014, LAYOUT.screens.energyY - 0.012]) {
        for (let x = west + 0.3; x < east; x += 0.8) {
          wires.add(V(x, y, -DIM.halfLength + 0.24), V(x, y, DIM.halfLength - 0.24), 0.0045);
        }
      }
    }

    drives.build(shadeGroup, 'screen-drive-units');
    wires.build(shadeGroup, 'screen-support-wires');

    this.buildVents(group);
    this.registerInteractables();

    return this;
  }

  buildVents(parent) {
    const ventGroup = new THREE.Group();
    ventGroup.name = 'roof-vents';
    parent.add(ventGroup);
    this.ventGroup = ventGroup;

    const config = LAYOUT.vents;
    const length = DIM.halfLength * 2 - config.lengthInset * 2;
    const slopeLength = config.slopeLength;
    const slopeDown = Math.atan((DIM.ridgeY - DIM.gutterY) / (DIM.bayWidth / 2));

    for (let bay = 1; bay <= GUTTER_X.length - 1; bay += 1) {
      const ridgeX = RIDGE_X[bay - 1];
      for (const sign of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.name = `roof-vent-${bay}-${sign > 0 ? 'east' : 'west'}`;
        pivot.position.set(ridgeX, DIM.ridgeY - 0.035, 0);
        ventGroup.add(pivot);

        const glass = new THREE.Mesh(
          new THREE.BoxGeometry(slopeLength - 0.06, 0.026, length - 0.06),
          this.materials.glass,
        );
        glass.name = `roof-vent-glass-${bay}`;
        glass.position.set((sign * slopeLength) / 2, 0, 0);
        glass.castShadow = false;
        glass.receiveShadow = false;
        glass.renderOrder = 2;
        pivot.add(glass);

        // Aluminium perimeter frame.
        const frame = [
          [slopeLength, 0.055, 0.055, (sign * slopeLength) / 2, 0.02, -length / 2],
          [slopeLength, 0.055, 0.055, (sign * slopeLength) / 2, 0.02, length / 2],
          [0.055, 0.055, length, 0, 0.02, 0],
          [0.055, 0.055, length, sign * slopeLength, 0.02, 0],
        ];
        for (const [w, h, d, x, y, z] of frame) {
          pivot.add(boxMesh(w, h, d, this.materials.aluminium, V(x, y, z), 'roof-vent-frame'));
        }
        // Mid rails keep the long glazed leaf stiff.
        for (const t of [-0.33, 0.33]) {
          pivot.add(
            boxMesh(
              0.04,
              0.05,
              length,
              this.materials.aluminium,
              V(sign * slopeLength * (0.5 + t), 0.02, 0),
              'roof-vent-rail',
            ),
          );
        }

        // Fixed insect mesh closes the roof aperture; the glazed leaf overlays
        // it when closed and lifts clear when the vent opens.
        const aperture = new THREE.Group();
        aperture.name = `roof-vent-mesh-${bay}-${sign > 0 ? 'east' : 'west'}`;
        aperture.position.set(ridgeX, DIM.ridgeY - 0.05, 0);
        aperture.rotation.z = -sign * slopeDown;
        ventGroup.add(aperture);

        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(slopeLength - 0.04, length - 0.04),
          this.ventMeshMaterial,
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set((sign * slopeLength) / 2, 0, 0);
        mesh.visible = false;
        aperture.add(mesh);

        this.vents.push({
          bay,
          sign,
          pivot,
          mesh,
          slopeDown,
          openAmount: 0,
          /** 0..1 opening requested by the cabinet (partial ventilation). */
          partial: 1,
          tween: { value: 0, from: 0, target: 0, elapsed: 0 },
        });
      }
    }
  }

  registerInteractables() {
    const shadeData = {
      id: 'shade-screen',
      category: 'Climate control',
      title: 'Per-bay retractable shade screens',
      description:
        'Six independent 58 % shade cloths, one per roof bay. Each deck retracts north into a compact bundle on its own drive motor, so shade can be pulled from one bay without darkening its neighbours. The SHADE NET switch for a bay in the climate cabinet drives that bay only, with a smooth 2.4 s rack-and-pinion stroke.',
      specs: [
        ['Bays', '6 independent decks'],
        [
          'Coverage',
          `${(DIM.bayWidth - LAYOUT.screens.bayGap).toFixed(2)} × ${(
            DIM.halfLength * 2 -
            LAYOUT.screens.insetZ * 2
          ).toFixed(1)} m per bay`,
        ],
        ['Height', `${LAYOUT.screens.shadeY.toFixed(2)} m · truss chord`],
        ['Retraction', `${Math.round(LAYOUT.screens.retractedFraction * 100)} % stored bundle`],
        ['Stroke time', `${LAYOUT.screens.shadeTravelSeconds.toFixed(1)} s · eased`],
        ['Drive', '24 V gear motor per bay'],
      ],
    };
    this.shadeGroup.userData.interactable = shadeData;
    this.interactables.push({ object: this.shadeGroup, data: shadeData });

    const energyData = {
      id: 'energy-screen',
      category: 'Climate control',
      title: 'Per-bay reflective energy screens',
      description:
        'A reflective woven screen below the shade deck holds heat in at night and reflects excess solar gain at midday. It retracts bay by bay, independently of the shade cloth, on a second carriage in the same head rail, with its own smooth stroke.',
      specs: [
        ['Bays', '6 independent decks'],
        ['Height', `${LAYOUT.screens.energyY.toFixed(2)} m`],
        ['Material', 'Aluminised woven polyester'],
        ['Reflection', 'about 72 % short-wave'],
        ['Stroke time', `${LAYOUT.screens.energyTravelSeconds.toFixed(1)} s · eased`],
        ['Drive', 'Independent 24 V carriage'],
      ],
    };
    this.energyGroup.userData.interactable = energyData;
    this.interactables.push({ object: this.energyGroup, data: energyData });

    const ventData = {
      id: 'roof-vents',
      category: 'Climate control',
      title: 'Hinged ridge vents',
      description:
        'Twelve continuous ridge vents, one pair per 4 m roof bay. Each glazed leaf hinges on the ridge and lifts under a linear actuator, revealing a fixed insect-mesh aperture without letting the leaf foul the ridge cap. Vents are switched per bay from the climate cabinet and travel smoothly to 28 degrees.',
      specs: [
        ['Leaves', '12 · two per bay'],
        [
          'Opening',
          `${Math.round(THREE.MathUtils.radToDeg(LAYOUT.vents.openingAngle))} degrees maximum · partial opening supported`,
        ],
        ['Actuation', '24 V linear actuator · 2 per leaf'],
        ['Stroke time', `${LAYOUT.vents.travelSeconds.toFixed(1)} s · eased`],
        ['Aperture', 'Fixed insect mesh under the leaf'],
        ['Glazing', 'Toughened 4 mm glass'],
      ],
    };
    this.ventGroup.userData.interactable = ventData;
    this.interactables.push({ object: this.ventGroup, data: ventData });
  }

  /** True when the given bay's cloth is fully extended. */
  isShadeExtended(bay) {
    const panel = this.shadePanels.find((entry) => entry.bay === bay);
    return panel ? panel.coverage > 0.98 : false;
  }

  /**
   * Set a bay's target vent opening as a fraction (0..1) of the 28 deg stroke.
   * The cabinet switch opens to the last value set here; useful for staged or
   * partial ventilation while keeping the glazed leaf on its hinge.
   */
  setVentOpening(bayId, amount) {
    const value = THREE.MathUtils.clamp(Number(amount), 0, 1);
    let applied = false;
    for (const vent of this.vents) {
      if (vent.bay !== Number(bayId)) continue;
      vent.partial = value;
      applied = true;
    }
    return applied;
  }

  /** Current fraction of maximum vent lift for a bay (0 closed, 1 at 28 deg). */
  getVentOpening(bayId) {
    return this.vents.find((vent) => vent.bay === Number(bayId))?.openAmount ?? 0;
  }

  /** Current glazed-leaf angle in radians for a bay's west leaf. */
  getVentAngle(bayId) {
    return this.vents.find((vent) => vent.bay === Number(bayId))?.pivot.rotation.z ?? 0;
  }

  update(dt) {
    const retracted = LAYOUT.screens.retractedFraction;
    const shadeDuration = LAYOUT.screens.shadeTravelSeconds;
    const energyDuration = LAYOUT.screens.energyTravelSeconds;
    const ventDuration = LAYOUT.vents.travelSeconds;

    for (const panel of this.shadePanels) {
      const bay = this.control?.getBay(panel.bay);
      const target = bay ? (bay.shadeNetExtended ? 1 : retracted) : 1;
      panel.coverage = advanceTween(panel.tween, target, dt, shadeDuration);
      panel.mesh.scale.y = Math.max(panel.coverage, 0.001);
      panel.bar.position.z = panel.northEdgeZ + panel.coverage * panel.depth;
    }

    for (const panel of this.energyPanels) {
      const bay = this.control?.getBay(panel.bay);
      const target = bay ? (bay.energyScreenExtended ? 1 : retracted) : retracted;
      panel.coverage = advanceTween(panel.tween, target, dt, energyDuration);
      panel.mesh.visible = panel.coverage > 0.015;
      panel.bar.visible = panel.mesh.visible;
      panel.mesh.scale.y = Math.max(panel.coverage, 0.001);
      panel.bar.position.z = panel.northEdgeZ + panel.coverage * panel.depth;
    }

    for (const vent of this.vents) {
      const bay = this.control?.getBay(vent.bay);
      const target = bay?.roofVentOpen ? vent.partial : 0;
      vent.openAmount = advanceTween(vent.tween, target, dt, ventDuration);
      // Hinge stays on the ridge: subtract the roof pitch, then add the lift.
      vent.pivot.rotation.z =
        vent.sign * (vent.openAmount * LAYOUT.vents.openingAngle - vent.slopeDown);
      vent.mesh.visible = vent.openAmount > 0.001;
    }
  }

  setTopView(active) {
    if (this.group) this.group.visible = !active;
  }

  dispose() {
    this.interactables.length = 0;
    this.shadePanels.length = 0;
    this.energyPanels.length = 0;
    this.vents.length = 0;
    this.screen = null;
    this.ventMeshMaterial.dispose();
    if (!this.group) return;
    this.group.traverse((child) => {
      if (child.isMesh) child.geometry?.dispose();
    });
    this.group.removeFromParent();
    this.group = null;
  }
}
