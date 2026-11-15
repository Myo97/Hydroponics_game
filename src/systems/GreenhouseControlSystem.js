/**
 * Shared control state for the Version 4 greenhouse.
 *
 * One instance is created by `Game` and injected into the 3D equipment, the
 * climate cabinet, the Bluelab station, the hydraulic network and the water
 * simulation. Every switch therefore has exactly one source of truth: the
 * physical toggle, the cabinet indicator and the simulation all read the same
 * values, and a single subscribe/notify channel keeps them in sync.
 */
export class GreenhouseControlSystem {
  constructor({ bayCount = 6 } = {}) {
    this.bays = Array.from({ length: bayCount }, (_, index) => ({
      id: index + 1,
      fansOn: true,
      shadeNetExtended: true,
      energyScreenExtended: false,
      roofVentOpen: false,
    }));

    this.pumps = {
      rainwaterTransferOn: true,
      irrigationOn: true,
    };

    /** tableId -> { open: boolean } */
    this.tables = new Map();

    /** Index into storage.rotanks; the Bluelab display follows this selection. */
    this.selectedTank = 0;

    /** Peristaltic dosing channels. */
    this.dosing = {
      a: { id: 'a', label: 'Nutrient A', enabled: true, output: 0.34 },
      b: { id: 'b', label: 'Nutrient B', enabled: true, output: 0.31 },
      c: { id: 'c', label: 'pH Down', enabled: true, output: 0.18 },
    };

    /** Isolation valves on the clean-water distribution drops to each RO tank. */
    this.storageValves = {
      'ro-tank-1': true,
      'ro-tank-2': true,
    };

    /**
     * Per-device actuator interlocks. Keyed `${bayId}:${key}` with an epoch-ms
     * release time, so a bay switch cannot reverse a screen or vent mid-stroke.
     */
    this.deviceLocks = new Map();

    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, detail = {}) {
    const change = { type, ...detail, state: this };
    for (const listener of this.listeners) listener(change);
    return change;
  }

  get bayCount() {
    return this.bays.length;
  }

  getBay(bayId) {
    return this.bays.find((bay) => bay.id === Number(bayId)) ?? null;
  }

  setBayDevice(bayId, key, value) {
    const bay = this.getBay(bayId);
    if (!bay || !(key in bay) || key === 'id') return false;
    if (bay[key] === Boolean(value)) return bay[key];
    bay[key] = Boolean(value);
    this.emit('bay', { bayId: bay.id, key, value: bay[key] });
    return bay[key];
  }

  toggleBayDevice(bayId, key, { lockMs = 0 } = {}) {
    const bay = this.getBay(bayId);
    if (!bay || !(key in bay) || key === 'id') return false;
    if (this.isBayDeviceLocked(bay.id, key)) return bay[key];
    const next = !bay[key];
    this.setBayDevice(bay.id, key, next);
    if (lockMs > 0) this.deviceLocks.set(`${bay.id}:${key}`, Date.now() + lockMs);
    return bay[key];
  }

  /** True while a screen or vent actuator is still travelling. */
  isBayDeviceLocked(bayId, key, now = Date.now()) {
    const lockKey = `${Number(bayId)}:${key}`;
    const releaseAt = this.deviceLocks.get(lockKey);
    if (releaseAt === undefined) return false;
    if (now < releaseAt) return true;
    this.deviceLocks.delete(lockKey);
    return false;
  }

  /** Seconds left on the actuator interlock (0 when free). */
  bayDeviceLockRemaining(bayId, key, now = Date.now()) {
    const releaseAt = this.deviceLocks.get(`${Number(bayId)}:${key}`) ?? 0;
    return Math.max(0, (releaseAt - now) / 1000);
  }

  releaseBayDevice(bayId, key) {
    return this.deviceLocks.delete(`${Number(bayId)}:${key}`);
  }

  setAllBays(key, value) {
    let changed = false;
    for (const bay of this.bays) {
      if (!(key in bay) || key === 'id') continue;
      const next = Boolean(value);
      if (bay[key] === next) continue;
      bay[key] = next;
      changed = true;
    }
    if (changed) this.emit('bay-all', { key, value: Boolean(value) });
    return changed;
  }

  /** Bulk helper used by the equipment API and the headless smoke test. */
  setFansEnabled(enabled) {
    this.setAllBays('fansOn', enabled);
    return Boolean(enabled);
  }

  get fansEnabled() {
    return this.bays.every((bay) => bay.fansOn);
  }

  setPump(key, value) {
    if (!(key in this.pumps)) return false;
    const next = Boolean(value);
    if (this.pumps[key] === next) return next;
    this.pumps[key] = next;
    this.emit('pump', { key, value: next });
    return next;
  }

  togglePump(key) {
    if (!(key in this.pumps)) return false;
    return this.setPump(key, !this.pumps[key]);
  }

  registerTables(tableIds) {
    for (const entry of tableIds) {
      const id = typeof entry === 'string' ? entry : entry.id;
      if (id && !this.tables.has(id)) this.tables.set(id, { open: true });
    }
    return this;
  }

  isTableValveOpen(tableId) {
    return this.tables.get(tableId)?.open ?? false;
  }

  setTableValve(tableId, open) {
    const table = this.tables.get(tableId);
    if (!table) return false;
    const next = Boolean(open);
    if (table.open === next) return next;
    table.open = next;
    this.emit('table-valve', { tableId, open: next });
    return next;
  }

  toggleTableValve(tableId) {
    const table = this.tables.get(tableId);
    if (!table) return false;
    return this.setTableValve(tableId, !table.open);
  }

  get openTableCount() {
    let count = 0;
    for (const table of this.tables.values()) if (table.open) count += 1;
    return count;
  }

  get closedTableCount() {
    return this.tables.size - this.openTableCount;
  }

  selectTank(index) {
    const count = 2;
    const next = ((Number(index) % count) + count) % count;
    if (next === this.selectedTank) return next;
    this.selectedTank = next;
    this.emit('tank-select', { index: next });
    return next;
  }

  cycleTank() {
    return this.selectTank(this.selectedTank + 1);
  }

  setDosingPump(key, enabled) {
    const channel = this.dosing[key];
    if (!channel) return false;
    const next = Boolean(enabled);
    if (channel.enabled === next) return next;
    channel.enabled = next;
    this.emit('dosing', { key, enabled: next });
    return next;
  }

  toggleDosingPump(key) {
    const channel = this.dosing[key];
    if (!channel) return false;
    return this.setDosingPump(key, !channel.enabled);
  }

  setStorageValve(tankId, open) {
    if (!(tankId in this.storageValves)) return false;
    const next = Boolean(open);
    if (this.storageValves[tankId] === next) return next;
    this.storageValves[tankId] = next;
    this.emit('storage-valve', { tankId, open: next });
    return next;
  }

  toggleStorageValve(tankId) {
    if (!(tankId in this.storageValves)) return false;
    return this.setStorageValve(tankId, !this.storageValves[tankId]);
  }

  snapshot() {
    return {
      bays: this.bays.map((bay) => ({ ...bay })),
      pumps: { ...this.pumps },
      tables: Array.from(this.tables, ([id, value]) => ({ id, ...value })),
      selectedTank: this.selectedTank,
      dosing: Object.fromEntries(
        Object.entries(this.dosing).map(([key, value]) => [key, { ...value }]),
      ),
      storageValves: { ...this.storageValves },
    };
  }
}
