import * as THREE from 'three';
import { LAYOUT, FRAME_Z, FAN_INSTALLATION } from '../config/layout.js';
import { BeamBatch, boxMesh } from './Batches.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Horizontal air-flow fan installation.
 * Four fans per 4 m roof bay (24 total), mounted just inside the east gutter
 * column. Every unit is a guarded EC fan with a motor can, five-blade impeller,
 * bracket frame and column connection. Blade sets can be paused for testing.
 */
export class HafFans {
  constructor({ materials }) {
    this.materials = materials;
    this.fans = [];
    this.interactables = [];
    this.group = null;
    this.enabled = true;
    this.config = LAYOUT.fans;
  }

  build(parent) {
    const config = this.config;
    const group = new THREE.Group();
    group.name = 'haf-fans';
    this.group = group;
    parent.add(group);
    const supports = new BeamBatch(this.materials.steel, { castShadow: true });

    for (const unit of FAN_INSTALLATION.fans) {
      const fan = new THREE.Group();
      fan.name = unit.id;
      fan.position.set(unit.x, config.height, unit.z);
      fan.rotation.y = unit.direction < 0 ? Math.PI : 0;
      group.add(fan);

      const shroud = new THREE.Mesh(
        new THREE.CylinderGeometry(config.radius, config.radius, 0.28, 32, 1, true),
        this.materials.steel,
      );
      shroud.rotation.x = Math.PI / 2;
      shroud.castShadow = true;
      fan.add(shroud);

      for (const zSide of [-0.14, 0.14]) {
        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(config.radius, 0.026, 8, 32),
          this.materials.steelDark,
        );
        rim.position.z = zSide;
        fan.add(rim);
      }

      // EC motor can and rear cowl.
      const motor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.17, 0.3, 20),
        this.materials.steelDark,
      );
      motor.rotation.x = Math.PI / 2;
      motor.position.z = -0.16;
      motor.castShadow = true;
      fan.add(motor);
      const cowl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.19, 0.18, 20),
        this.materials.steel,
      );
      cowl.rotation.x = Math.PI / 2;
      cowl.position.z = -0.34;
      fan.add(cowl);

      const blades = new THREE.Group();
      blades.name = `fan-blades-${unit.id}`;
      fan.add(blades);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.13, 0.12, 18),
        this.materials.pumpBlue,
      );
      hub.rotation.x = Math.PI / 2;
      hub.position.z = 0.06;
      blades.add(hub);

      for (let blade = 0; blade < 5; blade += 1) {
        const arm = new THREE.Group();
        arm.rotation.z = (blade / 5) * Math.PI * 2;
        blades.add(arm);
        const vane = boxMesh(
          0.32,
          0.15,
          0.016,
          this.materials.aluminium,
          V(0.26, 0, 0.06),
          `fan-vane-${unit.id}-${blade}`,
        );
        vane.rotation.y = 0.4;
        arm.add(vane);
      }

      // Welded inlet guard: concentric rings and radial spokes.
      for (const radius of [0.17, 0.3, 0.43]) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(radius, 0.007, 5, 30),
          this.materials.steelDark,
        );
        ring.position.z = 0.18;
        fan.add(ring);
      }
      for (let spoke = 0; spoke < 6; spoke += 1) {
        const bar = boxMesh(
          0.011,
          config.radius * 2 - 0.06,
          0.011,
          this.materials.steelDark,
          V(0, 0, 0.18),
          `fan-guard-spoke-${unit.id}-${spoke}`,
        );
        bar.rotation.z = (spoke / 6) * Math.PI;
        fan.add(bar);
      }

      // Swivel bracket at the fan shell.
      fan.add(
        boxMesh(0.11, 0.05, 0.22, this.materials.steelDark, V(0, config.radius - 0.02, -0.02), 'fan-swivel-bracket'),
      );
      for (const sx of [-1, 1]) {
        fan.add(
          boxMesh(0.035, 0.13, 0.035, this.materials.steelDark, V(sx * 0.3, config.radius + 0.02, 0), 'fan-hanger-strap'),
        );
      }

      const columnZ = FRAME_Z.reduce(
        (closest, z) => (Math.abs(z - unit.z) < Math.abs(closest - unit.z) ? z : closest),
        FRAME_Z[0],
      );
      const bracketY = config.height + config.radius + 0.12;
      supports.add(
        V(unit.columnX, bracketY, columnZ),
        V(unit.x, bracketY, unit.z),
        0.045,
        0.045,
      );
      supports.add(
        V(unit.x, bracketY, unit.z),
        V(unit.x, config.height + config.radius, unit.z),
        0.04,
        0.04,
      );
      supports.add(
        V(unit.columnX, bracketY - 0.32, columnZ),
        V(unit.x, bracketY, unit.z),
        0.03,
        0.03,
      );

      const speed = 4.4 + (unit.fan - 1) * 0.35;
      this.fans.push({
        id: unit.id,
        bay: unit.bay,
        fan: unit.fan,
        blades,
        speed,
        position: fan.position.clone(),
      });

      this.registerFan(fan, unit);
    }

    supports.build(group, 'haf-support-frames');
    return this;
  }

  registerFan(object, unit) {
    const data = {
      id: `haf-fan-${unit.bay}-${unit.fan}`,
      category: 'Air movement',
      title: `HAF fan HF-${unit.bay}.${unit.fan}`,
      interactionHint: 'Inspect fan',
      description:
        'Horizontal air-flow fan mounted on the gutter column. Four units per bay run in the same direction to maintain a continuous air loop along the crop, reducing leaf wetness and temperature stratification without chilling the canopy.',
      specs: [
        ['Airflow', '7,800 m³/h'],
        ['Motor', '0.55 kW EC · 0–10 V'],
        ['Diameter', `${(this.config.radius * 2).toFixed(2)} m`],
        ['Mounting', `Column bracket at ${this.config.height.toFixed(2)} m`],
        ['Bay / unit', `${unit.bay} / ${unit.fan}`],
        ['Control', 'Climate cabinet · 40 %'],
      ],
    };
    object.userData.interactable = data;
    this.interactables.push({ object, data });
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    return this.enabled;
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  update(dt) {
    if (!this.enabled) return;
    for (const fan of this.fans) {
      fan.blades.rotation.z -= dt * fan.speed;
    }
  }
}
