import { TOTAL_GROWTH_DAYS } from '../simulation/GreenCoralGrowth.js';

/**
 * Drives the nursery production cycle independently of the ebb-and-flow
 * hardware. It only touches planted trays, never empty neighbours.
 */
export class NurseryGrowthController {
  constructor({ table, growDuration = 3.2 }) {
    this.table = table;
    this.growDuration = growDuration;
    this.lastSummary = null;
    this.lastAdvanceDay = null;
  }

  getTray(trayId) {
    return this.table?.trays.find((tray) => tray.id === trayId) ?? null;
  }

  seedTray(trayId, options = {}) {
    const tray = this.getTray(trayId);
    if (!tray) return { ok: false, reason: 'Tray not found' };
    const result = tray.plantSeeds({ ...options, duration: this.growDuration });
    if (result.ok) this.publish();
    return result;
  }

  seedAllEmpty(options = {}) {
    let seeded = 0;
    let germinated = 0;
    for (const tray of this.table?.trays ?? []) {
      if (!tray.canPlant) continue;
      const result = tray.plantSeeds({ ...options, duration: this.growDuration });
      if (result.ok) {
        seeded += 1;
        germinated += result.germinated;
      }
    }
    this.publish();
    return { seeded, germinated };
  }

  /** One completed in-game day applied to every planted tray exactly once. */
  advanceDay(calendarDay) {
    const day = Number.isFinite(calendarDay)
      ? calendarDay
      : (this.lastAdvanceDay ?? 0) + 1;
    if (this.lastAdvanceDay === day) {
      return { advanced: 0, skippedEmpty: 0, ready: 0, day, duplicate: true };
    }
    this.lastAdvanceDay = day;
    let advanced = 0;
    let skippedEmpty = 0;
    let ready = 0;
    for (const tray of this.table?.trays ?? []) {
      if (tray.state === 'empty') {
        skippedEmpty += 1;
        continue;
      }
      if (tray.advanceDay(day)) advanced += 1;
      if (tray.ready) ready += 1;
    }
    if (advanced > 0) this.publish();
    return { advanced, skippedEmpty, ready, day, duplicate: false };
  }

  snapshotGrowth() {
    return {
      day: this.lastAdvanceDay,
      trays: (this.table?.trays ?? []).map((tray) => tray.snapshotGrowth()),
    };
  }

  restoreGrowth(state = {}) {
    const saved = Array.isArray(state?.trays) ? state.trays : [];
    this.lastAdvanceDay = Number.isFinite(state?.day) ? state.day : null;
    let restored = 0;
    for (const entry of saved) {
      const tray = this.getTray(entry.id);
      if (!tray) continue;
      if (tray.restoreGrowth(entry)) restored += 1;
    }
    this.publish();
    return { restored };
  }

  growAll() {
    const trays = (this.table?.trays ?? []).filter(
      (tray) => tray.state !== 'empty' && tray.growthDay < TOTAL_GROWTH_DAYS,
    );
    trays.forEach((tray) => tray.startGrow(this.growDuration));
    this.publish();
    return { growing: trays.length, skippedEmpty: (this.table?.trays ?? []).filter(
      (tray) => tray.state === 'empty',
    ).length };
  }

  update(dt, viewer = null) {
    let dirty = false;
    for (const tray of this.table?.trays ?? []) {
      if (tray.updateGrowth(dt)) dirty = true;
      if (viewer && tray.atTable && tray.plan) {
        const distance = Math.hypot(
          this.table.config.centre[0] + tray.x - viewer.x,
          this.table.config.centre[1] + tray.z - viewer.z,
        );
        tray.setViewerDistance(distance);
      }
    }
    if (dirty || this.summaryChanged()) this.publish();
  }

  summary() {
    const trays = this.table?.trays ?? [];
    const empty = trays.filter((tray) => tray.state === 'empty').length;
    const growing = trays.filter(
      (tray) => tray.state !== 'empty' && !tray.ready && tray.atTable,
    ).length;
    const ready = trays.filter((tray) => tray.ready && tray.atTable).length;
    const carried = trays.filter((tray) => !tray.atTable).length;
    const active = trays.filter((tray) => tray.growing).length;
    const seedlings = trays.reduce(
      (total, tray) => total + (tray.ready || tray.state !== 'empty' ? tray.germinated : 0),
      0,
    );
    return { empty, growing, ready, carried, active, seedlings };
  }

  summaryChanged() {
    const next = this.summary();
    const previous = this.lastSummary;
    const changed =
      !previous ||
      Object.keys(next).some((key) => next[key] !== previous[key]);
    if (changed) this.lastSummary = next;
    return changed;
  }

  publish() {
    this.lastSummary = this.summary();
    this.table?.setGrowthControlsState?.({
      ...this.lastSummary,
      growDuration: this.growDuration,
    });
    this.table?.refreshStock?.();
  }
}
