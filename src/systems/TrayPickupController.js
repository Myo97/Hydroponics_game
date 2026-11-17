import * as THREE from 'three';
import { SeedlingTrayView } from '../world/SeedlingTray.js';

const target = new THREE.Vector3();
const forward = new THREE.Vector3();

/**
 * First-person tray carrying. A transplant-ready tray is moved from its bench
 * slot into a horizontal chest-height view; the tray data, germination mask and
 * canopy stay intact and the bench slot remains reserved until it is returned.
 */
export class TrayPickupController {
  constructor({ scene, camera, nursery, materials }) {
    this.scene = scene;
    this.camera = camera;
    this.nursery = nursery;
    this.materials = materials;
    this.carried = null;
    this.view = null;
    this.elapsed = 0;
  }

  get isCarrying() {
    return Boolean(this.carried);
  }

  pickUp(trayId) {
    if (this.carried) {
      return { ok: false, reason: 'Hands already full - place or transplant the current tray' };
    }
    const tray = this.nursery.getTray(trayId);
    if (!tray) return { ok: false, reason: 'Tray not found' };
    const result = tray.pickUp();
    if (!result.ok) return result;

    this.carried = tray;
    this.view = new SeedlingTrayView({ materials: this.materials, tray });
    this.scene.add(this.view.group);
    this.elapsed = 0;
    this.update(0);
    return { ok: true, tray };
  }

  /** Place the carried tray back on its reserved nursery-bench slot. */
  placeOnNursery() {
    if (!this.carried) return { ok: false, reason: 'Not carrying a tray' };
    const tray = this.carried;
    tray.returnHome();
    this.releaseView();
    return { ok: true, tray };
  }

  /** Consume the tray into an NFT table, returning an empty tray for reuse. */
  completeTransplant() {
    if (!this.carried) return null;
    const tray = this.carried;
    tray.returnHome({ clearCrop: true });
    this.releaseView();
    return tray;
  }

  update(dt) {
    if (!this.view || !this.carried) return;
    this.elapsed += Math.max(0, dt);
    this.view.update(dt);
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();

    target.copy(this.camera.position).addScaledVector(forward, 0.56);
    target.y = this.camera.position.y - 0.34 + Math.sin(this.elapsed * 5.5) * 0.006;
    const blend = 1 - Math.exp(-Math.max(0, dt) * 16);
    this.view.group.position.lerp(target, dt === 0 ? 1 : blend);
    this.view.group.rotation.y = Math.atan2(forward.x, forward.z);
    this.view.group.updateMatrixWorld();
  }

  releaseView() {
    this.view?.dispose();
    this.view = null;
    this.carried = null;
  }

  dispose() {
    this.releaseView();
    this.nursery = null;
    this.scene = null;
    this.camera = null;
  }
}
