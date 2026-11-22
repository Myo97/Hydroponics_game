import { LowPolyCylinderGeometry } from './LowPolyGeometry.js';
import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { BeamBatch } from './Batches.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Retractable shade / energy screen over the nursery bench.
 *
 * The panel is a single woven deck below the Venlo trusses, anchored at its
 * north edge so scaling it produces a real rack-and-pinion retraction. It is
 * driven by the shared `GreenhouseControlSystem` nursery state rather than a
 * separate control path, and the support rails line up with the nursery frame.
 */
export class NurseryShadeScreen {
  constructor({ materials, control = null, config = LAYOUT.nursery.shadeScreen }) {
    this.materials = materials;
    this.control = control;
    this.config = config;
    this.group = null;
    this.panel = null;
    this.panelBar = null;
    this.motor = null;
    this.coverage = 1;
    this.interactables = [];
    this.data = null;
  }

  build(parent) {
    const config = this.config;
    const dim = LAYOUT.nursery;
    const halfLength = dim.length / 2;
    const northEdgeZ = -halfLength + config.northInset;
    const depth = config.length;
    const width = config.width;

    const group = new THREE.Group();
    group.name = 'nursery-shade-screen';
    this.group = group;
    parent.add(group);

    const frame = new BeamBatch(this.materials.aluminium, {
      castShadow: false,
      receiveShadow: false,
    });
    const wires = new BeamBatch(this.materials.steelDark, {
      castShadow: false,
      receiveShadow: false,
    });

    // Two longitudinal tracks and three transverse carriers, all tucked below
    // the gutter line and clear of the roof trusses.
    for (const x of [-width / 2, width / 2]) {
      frame.add(
        V(x, config.y + 0.07, northEdgeZ),
        V(x, config.y + 0.07, northEdgeZ + depth),
        0.045,
        0.045,
      );
    }
    for (const z of [northEdgeZ, northEdgeZ + depth / 2, northEdgeZ + depth]) {
      frame.add(V(-width / 2, config.y + 0.07, z), V(width / 2, config.y + 0.07, z), 0.04, 0.04);
    }
    for (let x = -width / 2 + 0.3; x < width / 2; x += 0.45) {
      wires.add(
        V(x, config.y - 0.008, northEdgeZ),
        V(x, config.y - 0.008, northEdgeZ + depth),
        0.004,
        0.004,
      );
    }
    frame.build(group, 'nursery-screen-rails');
    wires.build(group, 'nursery-screen-tension-wires');

    // Geometry is anchored on the north edge; scale.y is extended coverage.
    const geometry = new THREE.PlaneGeometry(width, depth);
    geometry.translate(0, -depth / 2, 0);
    const panel = new THREE.Mesh(geometry, this.materials.shadeCloth);
    panel.name = 'nursery-shade-screen-panel';
    panel.rotation.x = -Math.PI / 2;
    panel.position.set(0, config.y, northEdgeZ);
    panel.receiveShadow = false;
    panel.castShadow = false;
    panel.renderOrder = 1;
    group.add(panel);
    this.panel = panel;

    const bar = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.018, 0.018, width - 0.08, 10),
      this.materials.aluminium,
    );
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, config.y - 0.024, northEdgeZ + depth);
    group.add(bar);
    this.panelBar = bar;

    // Drive motor and gearbox on the north head rail.
    const motor = new THREE.Group();
    motor.name = 'nursery-screen-drive';
    motor.position.set(width / 2 - 0.16, config.y + 0.1, northEdgeZ + 0.12);
    const motorBody = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.075, 0.075, 0.24, 16),
      this.materials.pumpBlue,
    );
    motorBody.rotation.z = Math.PI / 2;
    motor.add(motorBody);
    const gearbox = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.14, 0.14),
      this.materials.steelDark,
    );
    gearbox.position.set(0.19, 0, 0);
    motor.add(gearbox);
    const shaft = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.013, 0.013, 0.28, 8),
      this.materials.stainless,
    );
    shaft.rotation.z = Math.PI / 2;
    shaft.position.set(-0.23, 0, 0);
    motor.add(shaft);
    group.add(motor);
    this.motor = motor;

    const screenTag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.16),
      this.materials.createLabelMaterial('SHADE SCREEN', 'RETRACTABLE - 55%', {
        background: '#e9ece3',
        foreground: '#173345',
      }),
    );
    screenTag.position.set(-width / 2 + 0.42, config.y + 0.17, northEdgeZ + 0.06);
    group.add(screenTag);

    this.coverage =
      this.control?.nursery?.shadeExtended === false ? config.retractedFraction : 1;

    const info = {
      id: 'nursery-shade-screen',
      buildingId: LAYOUT.nursery.id,
      category: 'Climate control',
      title: 'Nursery retractable shade screen',
      interaction: 'nursery-toggle-shade',
      interactionHint: 'Retract screen',
      description:
        'A single woven shade deck on the nursery head rail. The 4.5 s drive retracts the cloth north into a compact bundle for brighter propagation light, or extends it over the whole bench to cut summer radiation and hold humidity around the seedlings.',
      specs: [
        ['Coverage', `${width.toFixed(1)} x ${depth.toFixed(1)} m single deck`],
        ['Height', `${config.y.toFixed(2)} m - below truss chord`],
        ['Drive', '24 V gear motor - rack and pinion'],
        ['Stroke', `${config.travelSeconds.toFixed(1)} s - retractable`],
        ['Control', 'Shared nursery climate state'],
      ],
    };
    group.userData.interactable = info;
    this.interactables.push({ object: group, data: info });
    this.data = info;

    this.applyCoverage(this.coverage);
    return this;
  }

  get isExtended() {
    return this.coverage > 0.98;
  }

  get isRetracted() {
    return this.coverage <= this.config.retractedFraction + 0.02;
  }

  /** Toggle through the shared control system when one is present. */
  toggle() {
    if (this.control?.toggleNurseryShade) {
      return this.control.toggleNurseryShade();
    }
    this.data.interactionHint = this.isExtended ? 'Extend screen' : 'Retract screen';
    return !this.isExtended;
  }

  applyCoverage(coverage) {
    if (!this.panel) return;
    this.coverage = THREE.MathUtils.clamp(coverage, 0.001, 1);
    this.panel.scale.y = this.coverage;
    this.panel.visible = this.coverage > 0.02;
    this.panelBar.visible = this.panel.visible;
    this.panelBar.position.z =
      -LAYOUT.nursery.length / 2 +
      this.config.northInset +
      this.coverage * this.config.length;
    if (this.data) {
      this.data.interactionHint = this.isExtended ? 'Retract screen' : 'Extend screen';
    }
  }

  update(dt) {
    if (!this.panel) return;
    const extended = this.control?.nursery?.shadeExtended ?? true;
    const target = extended ? 1 : this.config.retractedFraction;
    const step = Math.max(0, dt) / Math.max(0.001, this.config.travelSeconds);
    if (this.coverage < target) this.coverage = Math.min(target, this.coverage + step);
    else if (this.coverage > target) this.coverage = Math.max(target, this.coverage - step);
    this.applyCoverage(this.coverage);
  }

  setTopView(active) {
    if (this.group) this.group.visible = !active;
  }

  dispose() {
    this.interactables.length = 0;
    this.data = null;
    if (!this.group) return;
    this.group.traverse((child) => {
      if (child.isMesh) child.geometry?.dispose();
    });
    this.group.removeFromParent();
    this.group = null;
    this.panel = null;
    this.panelBar = null;
    this.motor = null;
  }
}
