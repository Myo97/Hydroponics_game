import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';

const MOVE_KEYS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

/**
 * First-person walkthrough controller.
 * Pointer-lock mouse look, WASD movement with acceleration, sprint and a very
 * subtle head bob. Movement is resolved against the static collision world each
 * frame so the player slides along walls and benches instead of sticking.
 */
export class FirstPersonController {
  constructor({ camera, domElement, collisionWorld, player = LAYOUT.player }) {
    this.camera = camera;
    this.domElement = domElement;
    this.collisionWorld = collisionWorld;
    this.config = player;

    this.position = new THREE.Vector3(player.spawnX, 0, player.spawnZ);
    this.velocity = new THREE.Vector3();
    this.yaw = player.spawnYaw;
    this.pitch = -0.04;
    this.eyeHeight = player.eyeHeight;
    this.groundY = 0.005;
    this.radius = player.radius;

    this.keys = new Set();
    this.enabled = false;
    this.sensitivity = 1;
    this.bobTime = 0;
    this.bobOffset = 0;
    this.currentSpeed = 0;
    this.sprinting = false;

    // Analogue stick input from the touch overlay (x = strafe, y = forward) and
    // an external speed multiplier used while a harvest box is carried.
    this.moveInput = { x: 0, y: 0 };
    this.speedScale = 1;

    // Pointer-lock fallback: some embeds/remote desktops refuse to grant the lock.
    // If that happens the player can still look around by click-dragging the view.
    this.dragLook = false;
    this.everLocked = false;
    this.pointerLockBlocked = false;

    this.camera.rotation.order = 'YXZ';
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onPointerLockChange = this.onPointerLockChange.bind(this);
    this.onPointerLockError = this.onPointerLockError.bind(this);

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    this.syncCamera();
  }

  onKeyDown(event) {
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      this.sprinting = true;
      return;
    }
    const action = MOVE_KEYS[event.code];
    if (!action) return;
    this.keys.add(action);
    if (this.enabled) event.preventDefault();
  }

  onKeyUp(event) {
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      this.sprinting = false;
      return;
    }
    const action = MOVE_KEYS[event.code];
    if (action) this.keys.delete(action);
  }

  onMouseMove(event) {
    if (!this.enabled) return;
    const locked = this.isPointerLocked();
    if (!locked && !this.dragLook) return;
    this.applyLook(event.movementX, event.movementY);
  }

  /** Shared mouse/touch look. `dx`/`dy` are pixel deltas. */
  applyLook(dx = 0, dy = 0) {
    const scale = 0.0022 * this.sensitivity;
    this.yaw -= dx * scale;
    this.pitch -= dy * scale;
    const limit = Math.PI / 2 - 0.08;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    return this;
  }

  /** Touch look helper: screen-space swipe delta in CSS pixels. */
  addLook(dx = 0, dy = 0, scale = 1) {
    return this.applyLook(dx * scale, dy * scale);
  }

  /**
   * Analogue movement from the on-screen stick. Values are normalised, so
   * `setMoveInput(0, 1)` walks forward at full speed while a half deflection
   * walks at half speed. Keyboard input is added on top and clamped.
   */
  setMoveInput(x = 0, y = 0) {
    this.moveInput.x = Math.max(-1, Math.min(1, Number(x) || 0));
    this.moveInput.y = Math.max(-1, Math.min(1, Number(y) || 0));
    return this;
  }

  /** Release every movement source (touch overlay deactivation, pointer-lock loss). */
  clearInput() {
    this.moveInput.x = 0;
    this.moveInput.y = 0;
    this.keys.clear();
    this.sprinting = false;
    return this;
  }

  /** Click (or drag) on the view: re-request the lock, or fall back to drag-look. */
  onMouseDown(event) {
    if (!this.enabled || event.button !== 0) return;
    if (this.isPointerLocked()) return;
    this.dragLook = true;
    this.requestPointerLock();
  }

  onMouseUp() {
    this.dragLook = false;
  }

  onPointerLockChange() {
    if (this.isPointerLocked()) {
      this.everLocked = true;
      this.dragLook = false;
      return;
    }
    this.dragLook = false;
    this.keys.clear();
  }

  /** Only treat the error as fatal when the lock has never worked this session. */
  onPointerLockError() {
    if (!this.everLocked) this.pointerLockBlocked = true;
  }

  isPointerLocked() {
    return document.pointerLockElement === this.domElement;
  }

  requestPointerLock() {
    if (this.isPointerLocked() || this.pointerLockBlocked) return;
    const request = this.domElement.requestPointerLock?.();
    if (request && typeof request.catch === 'function') request.catch(() => {});
  }

  exitPointerLock() {
    if (this.isPointerLocked()) document.exitPointerLock();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.clearInput();
  }

  setSensitivity(value) {
    this.sensitivity = Math.max(0.2, Math.min(3, value));
  }

  /** Place the player and aim the view. Used by the save system / respawn. */
  teleport(x, z, yaw = this.yaw) {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = -0.04;
    this.syncCamera();
  }

  getZone() {
    const { x, z } = this.position;
    const footprint = this.collisionWorld?.footprintAt?.(x, z);
    if (footprint?.zone === 'nursery') return 'Nursery greenhouse';
    if (footprint?.zone === 'container-house') return footprint.label ?? 'Harvest House';
    if (this.collisionWorld && !this.collisionWorld.contains(x, z)) {
      if (z > 30) return 'Farm gate · south yard';
      if (z > 18) return 'South yard';
      if (z < -18) return 'North service yard';
      return 'Perimeter apron';
    }
    if (z < -12.5) return 'Headhouse · tanks & pumps';
    if (Math.abs(x) < 2.4) return 'Central aisle';
    if (x < 0) return Math.abs(x) < 4.8 ? 'West aisle' : 'West growing bay';
    return x < 4.8 ? 'East aisle' : 'East growing bay';
  }

  update(dt) {
    let forwardInput = (this.keys.has('forward') ? 1 : 0) - (this.keys.has('back') ? 1 : 0);
    let strafeInput = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);
    if (this.moveInput.x || this.moveInput.y) {
      forwardInput = Math.max(-1, Math.min(1, forwardInput + this.moveInput.y));
      strafeInput = Math.max(-1, Math.min(1, strafeInput + this.moveInput.x));
    }

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let targetX = -sin * forwardInput + cos * strafeInput;
    let targetZ = -cos * forwardInput - sin * strafeInput;
    const inputLength = Math.hypot(targetX, targetZ);

    const maxSpeed =
      (this.sprinting ? this.config.sprintSpeed : this.config.walkSpeed) * this.speedScale;
    if (inputLength > 0.001) {
      // Keep the analogue magnitude so a half-pushed stick walks at half pace;
      // keyboard diagonals clamp back to a full-throttle unit vector.
      const throttle = Math.min(1, inputLength);
      targetX = (targetX / inputLength) * maxSpeed * throttle;
      targetZ = (targetZ / inputLength) * maxSpeed * throttle;
    } else {
      targetX = 0;
      targetZ = 0;
    }

    const blend = Math.min(1, this.config.acceleration * dt);
    this.velocity.x += (targetX - this.velocity.x) * blend;
    this.velocity.z += (targetZ - this.velocity.z) * blend;
    if (Math.abs(this.velocity.x) < 0.002) this.velocity.x = 0;
    if (Math.abs(this.velocity.z) < 0.002) this.velocity.z = 0;

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    const beforeX = this.position.x;
    const beforeZ = this.position.z;
    this.collisionWorld.resolve(this.position, this.radius);
    if (
      Math.abs(this.position.x - beforeX) > 1e-6 ||
      Math.abs(this.position.z - beforeZ) > 1e-6
    ) {
      // Bleed off the velocity component that drove into the obstacle.
      this.velocity.x *= 0.35;
      this.velocity.z *= 0.35;
    }

    this.currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = this.currentSpeed > 0.35;
    this.bobTime = moving ? this.bobTime + dt * (1.6 + this.currentSpeed * 0.5) : 0;
    const targetBob = moving ? Math.sin(this.bobTime * Math.PI * 2) * 0.018 : 0;
    this.bobOffset += (targetBob - this.bobOffset) * Math.min(1, dt * 10);

    this.syncCamera();
  }

  syncCamera() {
    this.camera.position.set(
      this.position.x,
      this.groundY + this.eyeHeight + this.bobOffset,
      this.position.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    // Refresh the world matrix immediately so centre-screen raycasts in the same
    // frame use the new view (the renderer would otherwise only update it on draw).
    this.camera.updateMatrixWorld();
  }

  dispose() {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    this.exitPointerLock();
  }
}

