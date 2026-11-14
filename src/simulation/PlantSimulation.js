import { LAYOUT } from '../config/layout.js';

/**
 * Crop growth model — version 3 placeholder.
 *
 * Keeps a stable per-row contract for the frame loop, save system and future UI
 * panels. `update()` advances the crop clock and simple row state; no crop
 * geometry is rendered from it yet.
 */
const CULTIVARS = [
  { name: 'Rex Butterhead', daysToHarvest: 32, sowingDay: 6 },
  { name: 'Cervantes Green', daysToHarvest: 30, sowingDay: 9 },
  { name: 'Salanova Green', daysToHarvest: 28, sowingDay: 4 },
  { name: 'Rex Butterhead', daysToHarvest: 32, sowingDay: 12 },
  { name: 'Cervantes Green', daysToHarvest: 30, sowingDay: 2 },
  { name: 'Salanova Green', daysToHarvest: 28, sowingDay: 7 },
];

export class PlantSimulation {
  constructor({ equipment, layout = LAYOUT } = {}) {
    this.equipment = equipment;
    this.layout = layout;
    this.elapsedSeconds = 0;
    this.dayLengthSeconds = 600; // 10 real minutes per crop day in the prototype

    this.rows = layout.beds.centersX.map((cx, index) => ({
      id: index + 1,
      centreX: cx,
      cultivar: CULTIVARS[index % CULTIVARS.length].name,
      ageDays: 12 + index * 2,
      health: 1,
      plantsPerGully: layout.beds.holesPerGully,
      gulliesPerTable: layout.beds.gulliesPerTable,
      tables: layout.beds.tablesPerRow,
    }));
  }

  get cropDay() {
    return 1 + Math.floor(this.elapsedSeconds / this.dayLengthSeconds);
  }

  get summary() {
    const total = this.rows.reduce(
      (sum, row) => sum + row.plantsPerGully * row.gulliesPerTable * row.tables,
      0,
    );
    const averageHealth =
      this.rows.reduce((sum, row) => sum + row.health, 0) / Math.max(1, this.rows.length);
    return {
      plants: total,
      averageHealth,
      oldestRow: this.rows.reduce((oldest, row) => (row.ageDays > oldest.ageDays ? row : oldest)),
      cropDay: this.cropDay,
    };
  }

  /** Advance the crop clock. Crop geometry and harvest visuals are still pending. */
  update(dt) {
    this.elapsedSeconds += dt;
    const daysAdvanced = this.elapsedSeconds / this.dayLengthSeconds;
    for (const row of this.rows) {
      row.ageDays = 12 + row.id * 2 + daysAdvanced;
    }
  }

  reset() {
    this.elapsedSeconds = 0;
    for (const row of this.rows) {
      row.ageDays = 12 + row.id * 2;
      row.health = 1;
    }
  }
}
