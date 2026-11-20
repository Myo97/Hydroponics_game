import * as THREE from 'three';
import { LabelField } from './BillboardLabels.js';

/**
 * Version 14: floating "READY" tags above propagation trays that have reached
 * transplant day. One instanced LabelField draws all 36 tags in a single call,
 * and each instance resolves back to the tray's interaction record so tapping a
 * tag starts the normal pickup flow.
 */
export class NurseryReadyLabels {
  constructor({ scene, camera, table, refreshSeconds = 0.2 } = {}) {
    this.scene = scene;
    this.camera = camera;
    this.table = table;
    this.refreshSeconds = Math.max(0.08, refreshSeconds);
    this.field = null;
    this.signature = '';
    this.accumulator = 0;
    this._point = new THREE.Vector3();
  }

  build() {
    if (!this.scene) return this;
    this.field = new LabelField({
      parent: this.scene,
      camera: this.camera,
      text: 'READY',
      variant: 'ready',
      width: 0.58,
      height: 0.18,
      name: 'nursery-ready-labels',
      capacity: Math.max(1, (this.table?.trays?.length ?? 0) + 1),
    });
    this.refresh(true);
    return this;
  }

  /** Rebuild only when the set of ready trays changes, or on demand. */
  refresh(force = false) {
    if (!this.field) return this;
    const trays = this.table?.trays ?? [];
    const entries = [];
    const ids = [];

    for (const tray of trays) {
      if (!tray?.ready || !tray.atTable || !tray.hitProxy?.visible) continue;
      tray.hitProxy.getWorldPosition(this._point);
      entries.push({
        position: {
          x: this._point.x,
          y: this._point.y + 0.34,
          z: this._point.z,
        },
        data: tray.info,
      });
      ids.push(tray.id);
    }

    const signature = ids.join('|');
    if (!force && signature === this.signature) return this;
    this.signature = signature;
    this.field.setEntries(entries);
    return this;
  }

  update(dt = 0, camera = this.camera) {
    if (!this.field) return;
    this.accumulator += dt;
    if (this.accumulator >= this.refreshSeconds) {
      this.accumulator = 0;
      this.refresh();
    }
    this.field.update(camera);
  }

  dispose() {
    this.field?.dispose();
    this.field = null;
    this.table = null;
  }
}
