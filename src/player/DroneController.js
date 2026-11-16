import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';

const DRONE_KEYS = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  ArrowUp: 'lookUp',
  ArrowDown: 'lookDown',
  ArrowLeft: 'lookLeft',
  ArrowRight: 'lookRight',
  KeyE: 'up',
  KeyQ: 'down',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
};

/**
 * Free-flying inspection drone (Version 6).
 *
 * Runs a dedicated PerspectiveCamera, so entering and leaving drone view never
 * disturbs the walkthrough pose. WASD flies horizontally relative to the current
 * heading, Q/E changes altitude and Shift boosts. Arrow keys orbit continuously
 * through a full 360 degrees of yaw; click-drag or pointer lock looks around.
 */
export class DroneController {
  constructor({ camera, domElement = null, config = LAYOUT.droneView }) {
    this.camera = camera;
    this.domElement = domElement;
    this.config = config;

    this.position = new THREE.Vector3(...config.position);
    this.velocity = new THREE.Vector3();
    this.yaw = config.yaw;
    this.pitch = config.pitch;
    this.keys = new Set();
    this.active = false;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;

    this.camera.rotation.order = 'YXZ';

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);

    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this.onKeyDown);
      document.addEventListener('keyup', this.onKeyUp);
    }
    this.domElement?.addEventListener?.('pointerdown', this.onPointerDown);
    this.domElement?.addEventListener?.('pointermove', this.onPointerMove);
    this.domElement?.addEventListener?.('pointerup', this.onPointerUp);
    this.domElement?.addEventListener?.('pointerleave', this.onPointerUp);

    this.syncCamera();
  }

  /** Reset to the establishing aerial shot and start accepting input. */
  activate({ reset = true } = {}) {
    this.active = true;
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.dragging = false;
    if (reset) this.reset();
    else this.syncCamera();
    return this;
  }

  deactivate() {
    this.active = false;
    this.keys.clear();
    this.dragging = false;
    this.velocity.set(0, 0, 0);
  }

  reset() {
    this.position.set(...this.config.position);
    this.yaw = this.config.yaw;
    this.pitch = this.config.pitch;
    this.velocity.set(0, 0, 0);
    this.syncCamera();
  }

  /** Map a key event to a drone command; returns true when consumed. */
  setKeyState(code, pressed) {
    const action = DRONE_KEYS[code];
    if (!action) return false;
    if (pressed) this.keys.add(action);
    else this.keys.delete(action);
    return true;
  }

  onKeyDown(event) {
    if (!this.active || event.repeat) return;
    if (this.setKeyState(event.code, true)) event.preventDefault();
  }

  onKeyUp(event) {
    if (this.setKeyState(event.code, false)) event.preventDefault();
  }

  onPointerDown(event) {
    if (!this.active || event.button !== 0) return;
    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.domElement?.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.active) return;
    const pointerLocked =
      typeof document !== 'undefined' &&
      document.pointerLockElement === this.domElement;
    if (!this.dragging && !pointerLocked) return;

    // Pointer lock reports relative motion; drag fallback uses client coords.
    const dx = pointerLocked ? event.movementX ?? 0 : event.clientX - this.lastX;
    const dy = pointerLocked ? event.movementY ?? 0 : event.clientY - this.lastY;
    if (!pointerLocked) {
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    }
    this.applyLook(dx, dy);
  }

  /** Apply a relative look delta; yaw is unbounded but normalized for stability. */
  applyLook(dx, dy) {
    const sensitivity = this.config.lookSensitivity;
    this.yaw = this.normalizeYaw(this.yaw - dx * sensitivity);
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - dy * sensitivity,
      -this.maxPitch,
      this.maxPitch,
    );
  }

  normalizeYaw(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  get maxPitch() {
    return this.config.maxPitch ?? Math.PI / 2 - 0.04;
  }

  onPointerUp() {
    this.dragging = false;
  }

  update(dt) {
    if (!this.active) return;
    const config = this.config;
    const step = Math.max(0, dt);

    const yawInput = (this.keys.has('lookLeft') ? 1 : 0) - (this.keys.has('lookRight') ? 1 : 0);
    const pitchInput = (this.keys.has('lookUp') ? 1 : 0) - (this.keys.has('lookDown') ? 1 : 0);
    if (yawInput || pitchInput) {
      this.yaw = this.normalizeYaw(this.yaw + yawInput * (config.yawRate ?? 2) * step);
      this.pitch = THREE.MathUtils.clamp(
        this.pitch + pitchInput * (config.pitchRate ?? 1.3) * step,
        -this.maxPitch,
        this.maxPitch,
      );
    }

    const forward = (this.keys.has('forward') ? 1 : 0) - (this.keys.has('back') ? 1 : 0);
    const strafe = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);
    const lift = (this.keys.has('up') ? 1 : 0) - (this.keys.has('down') ? 1 : 0);
    const boost = this.keys.has('boost') ? config.boost : 1;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let targetX = -sin * forward + cos * strafe;
    let targetZ = -cos * forward - sin * strafe;
    const length = Math.hypot(targetX, targetZ);
    if (length > 1) {
      targetX /= length;
      targetZ /= length;
    }
    const horizontal = config.speed * boost;
    targetX *= horizontal;
    targetZ *= horizontal;
    const targetY = lift * (config.verticalSpeed ?? config.speed) * boost;

    // Critically damped-ish acceleration keeps starts and stops smooth.
    const blend = 1 - Math.exp(-step * 7);
    this.velocity.x += (targetX - this.velocity.x) * blend;
    this.velocity.y += (targetY - this.velocity.y) * blend;
    this.velocity.z += (targetZ - this.velocity.z) * blend;

    this.position.addScaledVector(this.velocity, step);

    const bounds = config.bounds;
    const x = THREE.MathUtils.clamp(this.position.x, bounds.minX, bounds.maxX);
    const y = THREE.MathUtils.clamp(this.position.y, bounds.minY, bounds.maxY);
    const z = THREE.MathUtils.clamp(this.position.z, bounds.minZ, bounds.maxZ);
    if (x !== this.position.x) this.velocity.x = 0;
    if (y !== this.position.y) this.velocity.y = 0;
    if (z !== this.position.z) this.velocity.z = 0;
    this.position.set(x, y, z);

    this.syncCamera();
  }

  syncCamera() {
    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
  }

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get altitude() {
    return this.position.y;
  }

  dispose() {
    this.deactivate();
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', this.onKeyDown);
      document.removeEventListener('keyup', this.onKeyUp);
    }
    this.domElement?.removeEventListener?.('pointerdown', this.onPointerDown);
    this.domElement?.removeEventListener?.('pointermove', this.onPointerMove);
    this.domElement?.removeEventListener?.('pointerup', this.onPointerUp);
    this.domElement?.removeEventListener?.('pointerleave', this.onPointerUp);
  }
}
