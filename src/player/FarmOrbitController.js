import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LAYOUT } from '../config/layout.js';

export const FARM_VIEWS = {
  farm: { target: [0, 0, 10], offset: [36, 42, 46] },
  greenhouse: { target: [0, 0.8, 0], offset: [19, 25, 27] },
  nursery: { target: [-17, 0.8, 16], offset: [5, 7, 8] },
};

/** Free cursor, bounded orbit/pan/zoom, with touch gestures owned by OrbitControls. */
export class FarmOrbitController {
  constructor({ camera, domElement }) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.09, screenSpacePanning: false,
      minDistance: 2.5, maxDistance: 105,
      minPolarAngle: 0.12, maxPolarAngle: Math.PI / 2 - 0.12,
      rotateSpeed: 0.7, zoomSpeed: 0.85, panSpeed: 0.8,
    });
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.enabled = false;
    this.controls.addEventListener('change', () => this.clampTarget());
    this.focus('farm');
  }

  get target() { return this.controls.target; }
  setEnabled(value) { this.controls.enabled = Boolean(value); }

  clampTarget() {
    const bounds = LAYOUT.farm.bounds;
    const previous = this.target.clone();
    this.target.x = THREE.MathUtils.clamp(this.target.x, bounds.minX, bounds.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, bounds.minZ, bounds.maxZ);
    this.target.y = THREE.MathUtils.clamp(this.target.y, 0, 3);
    this.camera.position.add(this.target.clone().sub(previous));
  }

  focus(name = 'farm') {
    const view = FARM_VIEWS[name] ?? FARM_VIEWS.farm;
    // Clear residual drag damping before moving to a new building.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.target.fromArray(view.target);
    this.camera.position.copy(this.target).add(new THREE.Vector3().fromArray(view.offset));
    this.controls.update();
    this.controls.enableDamping = damping;
  }

  update() { this.controls.update(); }

  snapshot() { return { target: this.target.toArray(), position: this.camera.position.toArray() }; }

  restore(state) {
    if (![state?.target, state?.position].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) return;
    this.target.fromArray(state.target);
    this.camera.position.fromArray(state.position);
    this.clampTarget();
    this.controls.update();
  }

  dispose() { this.controls.dispose(); }
}
