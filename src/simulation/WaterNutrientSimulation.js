import { LAYOUT } from '../config/layout.js';

/**
 * Water + nutrient model — placeholder for Milestone 3.
 *
 * Holds the state that the HUD and inspect panels will read: reservoir levels,
 * solution EC/pH, flow rate and dosing inventory. `update()` integrates small,
 * slow drift so readouts feel alive without simulating hydraulics yet.
 */
export class WaterNutrientSimulation {
  constructor({ equipment, layout = LAYOUT } = {}) {
    this.equipment = equipment;
    this.layout = layout;
    this.elapsedSeconds = 0;

    this.tanks = {
      a: { id: 'A', role: 'Supply', volume: 4200, capacity: 5000, level: 0.84 },
      b: { id: 'B', role: 'Drain return', volume: 1450, capacity: 5000, level: 0.29 },
    };

    this.solution = {
      ec: 1.8, // mS/cm
      ph: 5.9,
      waterTemp: 19.4,
      flowRate: 88, // L/min through the duty pump
      pressure: 1.9, // bar at the row headers
    };

    this.dosing = {
      stockA: 0.72,
      stockB: 0.68,
      phDown: 0.54,
      dosesToday: 14,
    };
  }

  get totalVolume() {
    return this.tanks.a.volume + this.tanks.b.volume;
  }

  get summary() {
    return {
      ec: Number(this.solution.ec.toFixed(2)),
      ph: Number(this.solution.ph.toFixed(2)),
      waterTemp: Number(this.solution.waterTemp.toFixed(1)),
      flowRate: Math.round(this.solution.flowRate),
      supplyLevel: Number(this.tanks.a.level.toFixed(2)),
      drainLevel: Number(this.tanks.b.level.toFixed(2)),
    };
  }

  /** Very light drift so HUD numbers are not frozen. Replace in Milestone 3. */
  update(dt) {
    this.elapsedSeconds += dt;
    const phase = this.elapsedSeconds * 0.12;
    this.solution.ec = 1.8 + Math.sin(phase) * 0.03;
    this.solution.ph = 5.9 + Math.sin(phase * 0.7 + 1.2) * 0.04;
    this.solution.waterTemp = 19.4 + Math.sin(phase * 0.25) * 0.15;
    this.solution.flowRate = 88 + Math.sin(phase * 1.7) * 1.6;
    this.tanks.a.level = 0.84 - (this.elapsedSeconds / 36000) * 0.02;
  }

  reset() {
    this.elapsedSeconds = 0;
    this.solution.ec = 1.8;
    this.solution.ph = 5.9;
    this.solution.waterTemp = 19.4;
    this.solution.flowRate = 88;
    this.tanks.a.level = 0.84;
  }
}
