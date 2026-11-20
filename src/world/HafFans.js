import * as THREE from 'three';
import { LAYOUT, FRAME_Z, FAN_INSTALLATION } from '../config/layout.js';
import { BeamBatch } from './Batches.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

const _localMatrix = new THREE.Matrix4();
const _worldMatrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _hubLocal = new THREE.Matrix4().compose(
  new THREE.Vector3(0, 0, 0.06),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)),
  new THREE.Vector3(1, 1, 1),
);
const _vaneLocal = new THREE.Matrix4().compose(
  new THREE.Vector3(0.26, 0, 0.06),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.4, 0)),
  new THREE.Vector3(1, 1, 1),
);

function partMatrix(fanMatrix, position, rotation = null, scale = null) {
  _pos.copy(position);
  if (rotation) _quat.setFromEuler(rotation);
  else _quat.identity();
  if (scale) _scale.copy(scale);
  else _scale.set(1, 1, 1);
  _localMatrix.compose(_pos, _quat, _scale);
  return _worldMatrix.multiplyMatrices(fanMatrix, _localMatrix);
}

function addPart(
  parent,
  name,
  geometry,
  material,
  matrices,
  { castShadow = true, receiveShadow = true } = {},
) {
  if (matrices.length === 0) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  mesh.name = name;
  for (let index = 0; index < matrices.length; index += 1) {
    mesh.setMatrixAt(index, matrices[index]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}

/**
 * Horizontal air-flow fan installation.
 * Four fans per 4 m roof bay (24 total), mounted just inside the east gutter
 * column. Static fan hardware is shared and instanced; only the 24 rotors get
 * per-frame matrices. Body geometry is identical, so this preserves the guarded
 * EC fan appearance at a fraction of the draw calls.
 */
export class HafFans {
  constructor({ materials, control = null }) {
    this.materials = materials;
    this.control = control;
    this.fans = [];
    this.interactables = [];
    this.group = null;
    this.enabled = true;
    this.config = LAYOUT.fans;
    this.rotor = null;
  }

  build(parent) {
    const config = this.config;
    const group = new THREE.Group();
    group.name = 'haf-fans';
    this.group = group;
    parent.add(group);
    const supports = new BeamBatch(this.materials.steel, { castShadow: true });

    const fanMatrices = [];
    const hitGeometry = new THREE.CylinderGeometry(
      config.radius * 1.04,
      config.radius * 1.04,
      0.42,
      12,
      1,
      true,
    );
    hitGeometry.rotateX(Math.PI / 2);

    for (const unit of FAN_INSTALLATION.fans) {
      const fan = new THREE.Group();
      fan.name = unit.id;
      fan.position.set(unit.x, config.height, unit.z);
      fan.rotation.y = unit.direction < 0 ? Math.PI : 0;
      fan.updateMatrix();
      group.add(fan);

      // Pickable proxy only: fan hardware itself is instanced at group level.
      const proxy = new THREE.Mesh(hitGeometry, this.materials.hitProxy);
      proxy.name = `${unit.id}-interaction-volume`;
      proxy.visible = false;
      proxy.castShadow = false;
      proxy.receiveShadow = false;
      fan.add(proxy);

      const blades = new THREE.Group();
      blades.name = `fan-blades-${unit.id}`;
      fan.add(blades);

      fanMatrices.push(fan.matrix.clone());

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
        currentSpeed: speed,
        position: fan.position.clone(),
        matrix: fan.matrix.clone(),
        rotorIndex: fanMatrices.length - 1,
      });

      this.registerFan(fan, unit);
    }

    const rotX = new THREE.Euler(Math.PI / 2, 0, 0);
    const shroudMatrices = fanMatrices.map((matrix) =>
      partMatrix(matrix, V(0, 0, 0), rotX).clone(),
    );
    addPart(
      group,
      'haf-fan-shrouds',
      new THREE.CylinderGeometry(config.radius, config.radius, 0.28, 32, 1, true),
      this.materials.steel,
      shroudMatrices,
    );

    const rimGeometry = new THREE.TorusGeometry(config.radius, 0.026, 8, 32);
    const rimMatrices = [];
    for (const matrix of fanMatrices) {
      for (const zSide of [-0.14, 0.14]) {
        rimMatrices.push(partMatrix(matrix, V(0, 0, zSide)).clone());
      }
    }
    addPart(group, 'haf-fan-rims', rimGeometry, this.materials.steelDark, rimMatrices);

    const motorGeometry = new THREE.CylinderGeometry(0.17, 0.17, 0.3, 20);
    const motorMatrices = fanMatrices.map((matrix) =>
      partMatrix(matrix, V(0, 0, -0.16), rotX).clone(),
    );
    addPart(group, 'haf-fan-motors', motorGeometry, this.materials.steelDark, motorMatrices);

    const cowlGeometry = new THREE.CylinderGeometry(0.11, 0.19, 0.18, 20);
    const cowlMatrices = fanMatrices.map((matrix) =>
      partMatrix(matrix, V(0, 0, -0.34), rotX).clone(),
    );
    addPart(group, 'haf-fan-cowls', cowlGeometry, this.materials.steel, cowlMatrices);


    const guardMatrices = [];
    for (const matrix of fanMatrices) {
      for (const radius of [0.17, 0.3, 0.43]) {
        guardMatrices.push({
          radius,
          matrix: partMatrix(matrix, V(0, 0, 0.18)).clone(),
        });
      }
    }
    for (const radius of [0.17, 0.3, 0.43]) {
      addPart(
        group,
        `haf-fan-guard-${radius}`,
        new THREE.TorusGeometry(radius, 0.007, 5, 30),
        this.materials.steelDark,
        guardMatrices
          .filter((entry) => entry.radius === radius)
          .map((entry) => entry.matrix),
        { castShadow: false },
      );
    }

    const spokeWidth = config.radius * 2 - 0.06;
    const spokeMatrices = [];
    for (const matrix of fanMatrices) {
      for (let spoke = 0; spoke < 6; spoke += 1) {
        spokeMatrices.push(
          partMatrix(
            matrix,
            V(0, 0, 0.18),
            new THREE.Euler(0, 0, (spoke / 6) * Math.PI),
          ).clone(),
        );
      }
    }
    addPart(
      group,
      'haf-fan-guard-spokes',
      new THREE.BoxGeometry(spokeWidth, 0.011, 0.011),
      this.materials.steelDark,
      spokeMatrices,
      { castShadow: false },
    );

    // Swivel bracket and two hanger straps share one unit box geometry.
    const bracketMatrices = [];
    for (const matrix of fanMatrices) {
      bracketMatrices.push(
        partMatrix(
          matrix,
          V(0, config.radius - 0.02, -0.02),
          null,
          V(0.11, 0.05, 0.22),
        ).clone(),
      );
      for (const sx of [-1, 1]) {
        bracketMatrices.push(
          partMatrix(
            matrix,
            V(sx * 0.3, config.radius + 0.02, 0),
            null,
            V(0.035, 0.13, 0.035),
          ).clone(),
        );
      }
    }
    addPart(
      group,
      'haf-fan-brackets',
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.steelDark,
      bracketMatrices,
    );

    const hubMesh = addPart(
      group,
      'haf-fan-rotor-hubs',
      new THREE.CylinderGeometry(0.1, 0.13, 0.12, 18),
      this.materials.pumpBlue,
      fanMatrices.map(() => new THREE.Matrix4()),
      { castShadow: false },
    );
    const vaneMesh = addPart(
      group,
      'haf-fan-rotor-vanes',
      new THREE.BoxGeometry(0.32, 0.15, 0.016),
      this.materials.aluminium,
      Array.from({ length: fanMatrices.length * 5 }, () => new THREE.Matrix4()),
      { castShadow: false },
    );
    this.rotor = { hubMesh, vaneMesh };


    supports.build(group, 'haf-support-frames');
    this.applyRotorMatrices();
    return this;
  }

  /** Build one rotor matrix per fan plus five vane matrices per fan. */
  applyRotorMatrices() {
    if (!this.rotor?.hubMesh || !this.rotor?.vaneMesh) return;
    for (const fan of this.fans) {
      const fanMatrix = fan.matrix;
      const angle = fan.blades.rotation.z;
      _localMatrix.makeRotationZ(angle).multiply(_hubLocal);
      _worldMatrix.multiplyMatrices(fanMatrix, _localMatrix);
      this.rotor.hubMesh.setMatrixAt(fan.rotorIndex, _worldMatrix);

      for (let blade = 0; blade < 5; blade += 1) {
        const armAngle = angle + (blade / 5) * Math.PI * 2;
        _quat.setFromAxisAngle(_zAxis, armAngle);
        _localMatrix.compose(_pos.set(0, 0, 0), _quat, _scale.set(1, 1, 1));
        _localMatrix.multiply(_vaneLocal);
        _worldMatrix.multiplyMatrices(fanMatrix, _localMatrix);
        this.rotor.vaneMesh.setMatrixAt(fan.rotorIndex * 5 + blade, _worldMatrix);
      }
    }
    this.rotor.hubMesh.instanceMatrix.needsUpdate = true;
    this.rotor.vaneMesh.instanceMatrix.needsUpdate = true;
  }

  registerFan(object, unit) {
    const data = {
      id: `haf-fan-${unit.bay}-${unit.fan}`,
      category: 'Air movement',
      title: `HAF fan HF-${unit.bay}.${unit.fan}`,
      interactionHint: 'Toggle bay fans',
      interaction: 'toggle-fan-bay',
      bayId: unit.bay,
      description:
        'Horizontal air-flow fan mounted on the gutter column. Four units per bay run in the same direction to maintain a continuous air loop along the crop, reducing leaf wetness and temperature stratification without chilling the canopy. Tap to start or stop all four fans in this bay.',
      specs: [
        ['Airflow', '7,800 m³/h'],
        ['Motor', '0.55 kW EC · 0–10 V'],
        ['Diameter', `${(this.config.radius * 2).toFixed(2)} m`],
        ['Mounting', `Column bracket at ${this.config.height.toFixed(2)} m`],
        ['Bay / unit', `${unit.bay} / ${unit.fan}`],
        ['Control', 'Climate cabinet · per bay'],
      ],
    };
    object.userData.interactable = data;
    this.interactables.push({ object, data });
  }

  toggleBay(bayId) {
    if (!this.control) return this.toggle();
    return this.control.toggleBayDevice(bayId, 'fansOn');
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    return this.enabled;
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  get hasMotion() {
    return this.fans.some((fan) => fan.currentSpeed > 0.02);
  }

  update(dt) {
    for (const fan of this.fans) {
      const bay = this.control?.getBay(fan.bay);
      const running = this.enabled && (bay ? bay.fansOn : true);
      const target = running ? fan.speed : 0;
      fan.currentSpeed += (target - fan.currentSpeed) * Math.min(1, dt * 1.8);
      fan.blades.rotation.z -= dt * fan.currentSpeed;
    }
    if (this.hasMotion) this.applyRotorMatrices();
  }

  dispose() {
    if (!this.group) return;
    for (const fan of this.fans) fan.blades = null;
    this.interactables.length = 0;
    this.fans.length = 0;
    this.group = null;
    this.rotor = null;
  }
}
