import * as THREE from 'three';
import {
  LAYOUT,
  NURSERY_DIM,
  NURSERY_FRAME_Z,
  NURSERY_GUTTER_X,
} from '../config/layout.js';
import { NurseryTable } from './NurseryTable.js';
import { NurseryShadeScreen } from './NurseryShadeScreen.js';
import { StickyTraps } from './StickyTraps.js';
import { NurseryGrowthController } from '../systems/NurseryGrowthController.js';

/**
 * Complete propagation-house fit-out, grouped under the nursery root so the
 * building, bench, irrigation, traps and screen move as one structure.
 */
export class NurseryEquipment {
  constructor({ materials, collisionWorld = null, control = null, spec = LAYOUT.nursery }) {
    this.materials = materials;
    this.collisionWorld = collisionWorld;
    this.control = control;
    this.spec = spec;
    this.group = null;
    this.table = null;
    this.growth = null;
    this.shadeScreen = null;
    this.stickyTraps = null;
    this.interactables = [];
  }

  build(parent) {
    const group = new THREE.Group();
    group.name = 'nursery-equipment';
    this.group = group;
    parent.add(group);

    this.table = new NurseryTable({
      materials: this.materials,
      collisionWorld: this.collisionWorld,
      control: this.control,
      config: this.spec,
    }).build(group);

    this.growth = new NurseryGrowthController({ table: this.table, growDuration: 3.2 });
    // Let trays read the current bench crop for their empty-state prompts.
    this.table.growth = this.growth;

    // The trap anchors are local to the nursery root; the frame grid itself is
    // also local, while NURSERY_FRAME_Z is exported in world Z.
    this.stickyTraps = new StickyTraps({
      materials: this.materials,
      config: this.spec.stickyTraps,
      frame: {
        gutterXs: NURSERY_GUTTER_X,
        frameZs: NURSERY_FRAME_Z.map((z) => z - NURSERY_DIM.centreZ),
        halfWidth: NURSERY_DIM.halfWidth,
        perimeterColumnSize: this.spec.perimeterColumnSize,
        columnSize: this.spec.columnSize,
      },
      idPrefix: 'nursery-sticky-trap',
      groupName: 'nursery-sticky-traps',
      buildingId: this.spec.id,
    }).build(group);

    this.shadeScreen = new NurseryShadeScreen({
      materials: this.materials,
      control: this.control,
      config: this.spec.shadeScreen,
    }).build(group);

    this.interactables = [
      ...this.table.getInteractables(),
      ...this.stickyTraps.interactables,
      ...this.shadeScreen.interactables,
    ];
    return this;
  }

  getInteractables() {
    return this.interactables;
  }

  startTidalCycle() {
    return this.table?.startCycle() ?? { started: false, stage: 'ready' };
  }

  getTray(trayId) {
    return this.growth?.getTray(trayId) ?? null;
  }

  seedTray(trayId, options = {}) {
    return this.growth?.seedTray(trayId, options) ?? { ok: false, reason: 'Growth controller offline' };
  }

  seedAllEmpty(options = {}) {
    return this.growth?.seedAllEmpty(options) ?? { seeded: 0, germinated: 0 };
  }

  get cropName() {
    return this.growth?.cropName ?? '';
  }

  setCrop(cropName) {
    return this.growth?.setCrop(cropName) ?? '';
  }

  cycleCrop() {
    return this.growth?.cycleCrop() ?? '';
  }

  advanceDay(calendarDay) {
    return this.growth?.advanceDay(calendarDay) ?? { advanced: 0, skippedEmpty: 0, ready: 0 };
  }

  snapshotGrowth() {
    return this.growth?.snapshotGrowth() ?? { trays: [] };
  }

  restoreGrowth(state = {}) {
    return this.growth?.restoreGrowth(state) ?? { restored: 0 };
  }

  growAll() {
    return this.growth?.growAll() ?? { growing: 0, skippedEmpty: 0 };
  }

  toggleShade() {
    return this.shadeScreen?.toggle() ?? false;
  }

  update(dt, viewer = null) {
    this.table?.update(dt);
    this.growth?.update(dt, viewer);
    this.stickyTraps?.update(dt);
    this.shadeScreen?.update(dt);
  }

  setTopView(active) {
    this.shadeScreen?.setTopView(active);
    this.table?.setTopView(active);
    this.stickyTraps?.setTopView(active);
  }

  setDetailVisible() {}

  dispose() {
    this.interactables.length = 0;
    this.table?.dispose();
    this.stickyTraps?.dispose();
    this.shadeScreen?.dispose();
    this.table = null;
    this.growth = null;
    this.stickyTraps = null;
    this.shadeScreen = null;
    if (!this.group) return;
    this.group.removeFromParent();
    this.group = null;
  }
}
