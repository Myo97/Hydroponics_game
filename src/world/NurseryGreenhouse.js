import { LAYOUT, NURSERY_TABLE_SLOTS } from '../config/layout.js';
import { Greenhouse } from './Greenhouse.js';
import { NurseryEquipment } from './NurseryEquipment.js';

/**
 * Nursery / propagation greenhouse.
 *
 * A second, physically separate glasshouse standing beside the main production
 * house. It is assembled by the same `Greenhouse` builder and material library,
 * so the Venlo frame, glazing, plinths and sliding door language match exactly
 * while the 4 x 8 m footprint (one span, two bays) is half the previous plan
 * size in each direction. Height is unchanged.
 *
 * The interior fit-out is grouped under this root: one 3.4 x 1.8 m ebb-and-flow
 * bench with 36 trays, Reservoir 2 feed/return pipework, four sticky cards and
 * a retractable overhead shade screen.
 */
export class NurseryGreenhouse {
  constructor({ scene, materials, collisionWorld, preset, control = null, spec = LAYOUT.nursery }) {
    this.spec = spec;
    this.isNursery = true;
    this.control = control;
    this.tableSlots = NURSERY_TABLE_SLOTS.map((slot) => ({ ...slot }));
    this.building = new Greenhouse({
      scene,
      materials,
      collisionWorld,
      preset,
      control,
      spec: NurseryGreenhouse.toGreenhouseSpec(spec),
    });
    this.equipment = null;
    this.growth = null;
    this.tidalBed = null;
    this.shadeScreen = null;
    this.stickyTraps = null;
    this.group = null;
    this.detailGroup = null;
    this.entrance = null;
  }

  /** Translate the layout block into the generic builder's spec shape. */
  static toGreenhouseSpec(spec) {
    return {
      id: spec.id,
      label: spec.label,
      zone: spec.zone,
      width: spec.width,
      length: spec.length,
      centre: spec.centre,
      gutterHeight: spec.gutterHeight,
      ridgeHeight: spec.ridgeHeight,
      plinthHeight: spec.plinthHeight,
      bayWidth: spec.bayWidth,
      bayLength: spec.bayLength,
      wallThickness: spec.wallThickness,
      perimeterColumnSize: spec.perimeterColumnSize,
      columnSize: spec.columnSize,
      entrance: spec.entrance,
      entranceSign: {
        title: 'NURSERY ENTRANCE',
        subtitle: 'SLIDING DOOR - KEEP CLEAR',
      },
      entranceDescription:
        `Two glazed aluminium leaves slide clear of a ${spec.entrance.width.toFixed(1)} m ` +
        'opening, wide enough for a seedling trolley between the propagation bench ' +
        'and the main house. Each leaf carries its own collision volume, so the ' +
        'doorway opens progressively. Tap to open or close.',
      features: spec.features,
      signage: spec.signage,
      interior: {
        drain: false,
        joints: [-4, 0, 4],
      },
    };
  }

  build() {
    this.building.build();
    this.group = this.building.group;
    this.detailGroup = this.building.detailGroup;
    this.entrance = this.building.entrance;

    this.equipment = new NurseryEquipment({
      materials: this.building.materials,
      collisionWorld: this.building.collisionWorld,
      control: this.control,
      spec: this.spec,
    }).build(this.group);
    this.tidalBed = this.equipment.table;
    this.growth = this.equipment.growth;
    this.shadeScreen = this.equipment.shadeScreen;
    this.stickyTraps = this.equipment.stickyTraps;
    return this;
  }

  /** The one tidal-bed rectangle, in world coordinates. */
  getTableSlots() {
    return this.tableSlots.map((slot) => ({ ...slot }));
  }

  getInteractables() {
    return [...this.building.getInteractables(), ...(this.equipment?.getInteractables() ?? [])];
  }

  startTidalCycle() {
    return this.equipment?.startTidalCycle() ?? { started: false };
  }

  getTray(trayId) {
    return this.equipment?.getTray(trayId) ?? null;
  }

  seedTray(trayId, options = {}) {
    return this.equipment?.seedTray(trayId, options) ?? { ok: false };
  }

  seedAllEmpty(options = {}) {
    return this.equipment?.seedAllEmpty(options) ?? { seeded: 0, germinated: 0 };
  }

  get cropName() {
    return this.equipment?.cropName ?? '';
  }

  setCrop(cropName) {
    return this.equipment?.setCrop(cropName) ?? '';
  }

  cycleCrop() {
    return this.equipment?.cycleCrop() ?? '';
  }

  advanceDay(calendarDay) {
    return this.equipment?.advanceDay(calendarDay) ?? {
      advanced: 0,
      skippedEmpty: 0,
      ready: 0,
    };
  }

  snapshotGrowth() {
    return this.equipment?.snapshotGrowth() ?? { trays: [] };
  }

  restoreGrowth(state = {}) {
    return this.equipment?.restoreGrowth(state) ?? { restored: 0 };
  }

  growAll() {
    return this.equipment?.growAll() ?? { growing: 0, skippedEmpty: 0 };
  }

  toggleShade() {
    return this.equipment?.toggleShade() ?? false;
  }

  toggleEntranceDoors() {
    return this.building.toggleEntranceDoors();
  }

  update(dt, viewer = null) {
    this.building.update(dt);
    this.equipment?.update(dt, viewer);
  }

  setTopView(active) {
    this.building.setTopView(active);
    this.equipment?.setTopView(active);
  }

  setDetailVisible(visible) {
    this.building.setDetailVisible(visible);
    this.equipment?.setDetailVisible(visible);
  }

  dispose() {
    // Equipment is a child of the nursery group, so dispose it before the
    // building traverses the remaining structure geometry.
    this.equipment?.dispose();
    this.building.dispose();
    this.equipment = null;
    this.growth = null;
    this.tidalBed = null;
    this.shadeScreen = null;
    this.stickyTraps = null;
    this.group = null;
    this.detailGroup = null;
    this.entrance = null;
  }
}
