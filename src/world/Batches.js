import * as THREE from 'three';

/**
 * Batching helpers.
 * Structural frames, glazing bars, glass panes and pipe runs are built from a
 * handful of instanced meshes instead of hundreds of individual objects. This is
 * the main reason the scene stays cheap on desktop GPUs.
 */

const UP = new THREE.Vector3(0, 1, 0);
const _start = new THREE.Vector3();
const _end = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();

function segmentMatrix(start, end, xScale, zScale, target) {
  _start.copy(start);
  _end.copy(end);
  _dir.subVectors(_end, _start);
  const length = _dir.length();
  if (length < 1e-5) return null;
  _mid.addVectors(_start, _end).multiplyScalar(0.5);
  _quat.setFromUnitVectors(UP, _dir.normalize());
  _scale.set(xScale, length, zScale);
  target.compose(_mid, _quat, _scale);
  return target;
}

/** Instanced box members (columns, beams, benches, rails). */
export class BeamBatch {
  constructor(material, { castShadow = true, receiveShadow = true } = {}) {
    this.material = material;
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
    this.matrices = [];
  }

  add(start, end, width, depth = width) {
    const matrix = segmentMatrix(start, end, width, depth, new THREE.Matrix4());
    if (matrix) this.matrices.push(matrix);
    return this;
  }

  get size() {
    return this.matrices.length;
  }

  build(group, name) {
    if (!this.matrices.length) return null;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geometry, this.material, this.matrices.length);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < this.matrices.length; i += 1) {
      matrix.copy(this.matrices[i]);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = this.receiveShadow;
    mesh.name = name;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  }
}

/** Instanced glass panes with an arbitrary right/up basis. */
export class PanelBatch {
  constructor(material) {
    this.material = material;
    this.matrices = [];
  }

  /**
   * @param {THREE.Vector3} center pane centre
   * @param {number} width pane width
   * @param {number} height pane height
   * @param {THREE.Vector3} right unit vector along the width
   * @param {THREE.Vector3} up unit vector along the height
   */
  add(center, width, height, right, up) {
    const r = right.clone().normalize();
    const u = up.clone().normalize();
    const n = new THREE.Vector3().crossVectors(r, u).normalize();
    const matrix = new THREE.Matrix4();
    matrix.makeBasis(r, u, n);
    matrix.scale(new THREE.Vector3(width, height, 1));
    matrix.setPosition(center);
    this.matrices.push(matrix);
    return this;
  }

  get size() {
    return this.matrices.length;
  }

  build(group, name) {
    if (!this.matrices.length) return null;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.InstancedMesh(geometry, this.material, this.matrices.length);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < this.matrices.length; i += 1) {
      matrix.copy(this.matrices[i]);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 2;
    mesh.name = name;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  }
}

/** Instanced cylinders + rounded joints for pipework. */
export class CylinderBatch {
  constructor(material, { castShadow = true, receiveShadow = true } = {}) {
    this.material = material;
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
    this.segments = [];
    this.joints = [];
  }

  add(start, end, radius) {
    const matrix = segmentMatrix(start, end, radius, radius, new THREE.Matrix4());
    if (matrix) this.segments.push(matrix);
    return this;
  }

  /** A pipe run through several points; joints hide the hard corners. */
  addPath(points, radius) {
    for (let i = 0; i < points.length - 1; i += 1) {
      this.add(points[i], points[i + 1], radius);
    }
    for (let i = 1; i < points.length - 1; i += 1) {
      this.addJoint(points[i], radius * 1.06);
    }
    return this;
  }

  addJoint(position, radius) {
    const matrix = new THREE.Matrix4();
    matrix.compose(position, new THREE.Quaternion(), new THREE.Vector3(radius, radius, radius));
    this.joints.push(matrix);
    return this;
  }

  get size() {
    return this.segments.length + this.joints.length;
  }

  build(group, name) {
    const results = [];
    if (this.segments.length) {
      const geometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
      const mesh = new THREE.InstancedMesh(geometry, this.material, this.segments.length);
      for (let i = 0; i < this.segments.length; i += 1) {
        mesh.setMatrixAt(i, this.segments[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = this.castShadow;
      mesh.receiveShadow = this.receiveShadow;
      mesh.name = `${name}-runs`;
      mesh.frustumCulled = false;
      group.add(mesh);
      results.push(mesh);
    }
    if (this.joints.length) {
      const geometry = new THREE.SphereGeometry(1, 10, 6);
      const mesh = new THREE.InstancedMesh(geometry, this.material, this.joints.length);
      for (let i = 0; i < this.joints.length; i += 1) {
        mesh.setMatrixAt(i, this.joints[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = this.castShadow;
      mesh.receiveShadow = this.receiveShadow;
      mesh.name = `${name}-joints`;
      mesh.frustumCulled = false;
      group.add(mesh);
      results.push(mesh);
    }
    return results;
  }
}

/** Convenience: a simple box mesh positioned by centre. */
export function boxMesh(width, height, depth, material, position, name = '') {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  if (position) mesh.position.copy(position);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
