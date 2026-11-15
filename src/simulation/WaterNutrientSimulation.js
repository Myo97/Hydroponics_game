import { LAYOUT } from '../config/layout.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));

/**
 * Version 3 water + nutrient model.
 *
 * Mirrors the physical storage layout: two buried clean-water reservoirs
 * (Reservoir 1 permeate, Reservoir 2 mixed feed), the dirty nutrient-return
 * tank (DR-01) and the above-ground rainwater harvester. The shared
 * GreenhouseControlSystem drives which tank is monitored, which dosing channels
 * run and which transfer pumps are enabled.
 */
export class WaterNutrientSimulation {
  constructor({ equipment, layout = LAYOUT, control = null } = {}) {
    this.equipment = equipment;
    this.layout = layout;
    this.control = control;
    this.elapsedSeconds = 0;

    const storage = layout.storage ?? {};
    const roConfig = storage.roTanks ?? [];
    this.tanks = roConfig.map((tank) => ({
      id: tank.id,
      code: tank.code,
      name: tank.name,
      label: tank.label,
      subtitle: tank.subtitle,
      capacity: tank.capacity ?? 12000,
      level: tank.initialLevel ?? 0.7,
      ec: tank.ec ?? 0.02,
      ph: tank.ph ?? 6.9,
      temp: tank.temp ?? 19,
      targetEc: tank.targetEc ?? tank.ec ?? 0.02,
      targetPh: tank.targetPh ?? tank.ph ?? 6.9,
      role: tank.code === 'RES-1' ? 'Clean water' : 'Mixed feed',
    }));

    const returnConfig = storage.returnTank ?? {};
    this.returnTank = {
      id: returnConfig.id ?? 'return-tank',
      code: returnConfig.code ?? 'DR-01',
      label: returnConfig.label ?? 'NUTRIENT RETURN',
      capacity: returnConfig.capacity ?? 8000,
      level: returnConfig.initialLevel ?? 0.31,
      ec: 1.46,
      ph: 6.18,
      temp: 21.6,
    };

    const harvesterConfig = storage.harvester ?? {};
    this.harvester = {
      id: harvesterConfig.id ?? 'rainwater-harvester',
      label: harvesterConfig.label ?? 'RAINWATER HARVESTER',
      capacity: harvesterConfig.capacity ?? 5000,
      level: harvesterConfig.initialLevel ?? 0.46,
    };

    this.solution = {
      ec: this.tanks[1]?.ec ?? 1.8,
      ph: this.tanks[1]?.ph ?? 5.9,
      waterTemp: this.tanks[1]?.temp ?? 19.4,
      flowRate: 88,
      pressure: 1.4,
    };

    this.dosing = {
      stockA: 0.72,
      stockB: 0.68,
      phDown: 0.54,
      dosesToday: 14,
      volumeToday: 38.4,
    };

    this.drainAccumulator = 0;
    this.transferAccumulator = 0;
    this.rainAccumulator = 0;
  }

  get selectedTank() {
    const index = this.control?.selectedTank ?? 0;
    return this.tanks[index] ?? this.tanks[0] ?? null;
  }

  get totalVolume() {
    return this.tanks.reduce(
      (sum, tank) => sum + tank.level * tank.capacity,
      this.returnTank.level * this.returnTank.capacity,
    );
  }

  get alarms() {
    const alarms = [];
    for (const tank of this.tanks) {
      const fertilised = (tank.targetEc ?? 0) >= 1;
      const alarmName = tank.name ?? tank.code;
      if (fertilised && (tank.ec < 1.2 || tank.ec > 2.6)) {
        alarms.push(`${alarmName} EC ${tank.ec.toFixed(2)}`);
      }
      if (fertilised && (tank.ph < 5.4 || tank.ph > 6.4)) {
        alarms.push(`${alarmName} pH ${tank.ph.toFixed(2)}`);
      }
      if (tank.level < 0.12) alarms.push(`${alarmName} level ${Math.round(tank.level * 100)} %`);
    }
    if (this.returnTank.level > 0.88) alarms.push('DR-01 return tank high');
    if (this.harvester.level < 0.08) alarms.push('Rainwater harvester low');
    return alarms;
  }

  get isAlarm() {
    return this.alarms.length > 0;
  }

  get summary() {
    const tank = this.selectedTank;
    return {
      tank: tank?.code ?? 'RES-1',
      level: Number((tank?.level ?? 0).toFixed(2)),
      ec: Number((tank?.ec ?? this.solution.ec).toFixed(2)),
      ph: Number((tank?.ph ?? this.solution.ph).toFixed(2)),
      waterTemp: Number((tank?.temp ?? this.solution.waterTemp).toFixed(1)),
      flowRate: Math.round(this.solution.flowRate),
      pressure: Number(this.solution.pressure.toFixed(1)),
      supplyLevel: Number((this.tanks[1]?.level ?? 0).toFixed(2)),
      returnLevel: Number(this.returnTank.level.toFixed(2)),
      rainLevel: Number(this.harvester.level.toFixed(2)),
      alarm: this.isAlarm,
    };
  }

  /**
   * Stable read-only view consumed by the HMI screens, the water storage model
   * and the HUD. Levels are fractions (0-1), EC in mS/cm, temperatures in C.
   */
  snapshot() {
    return {
      selectedTank: this.control?.selectedTank ?? 0,
      tanks: this.tanks.map((tank) => ({
        ...tank,
        volume: Math.round(tank.level * tank.capacity),
      })),
      returnTank: { ...this.returnTank },
      harvester: { ...this.harvester },
      solution: { ...this.solution },
      flowRate: Math.round(this.solution.flowRate),
      pressure: Number(this.solution.pressure.toFixed(1)),
      dosing: {
        ...this.dosing,
        a: { ...(this.control?.dosing?.a ?? { enabled: true, output: 0.34 }) },
        b: { ...(this.control?.dosing?.b ?? { enabled: true, output: 0.31 }) },
        c: { ...(this.control?.dosing?.c ?? { enabled: true, output: 0.18 }) },
      },
      alarms: this.alarms,
    };
  }

  /** Integrates slow, believable drift driven by the control system. */
  update(dt) {
    this.elapsedSeconds += dt;
    const phase = this.elapsedSeconds * 0.12;
    const control = this.control;
    const irrigating = control ? control.pumps.irrigationOn : true;
    const transferOn = control ? control.pumps.rainwaterTransferOn : true;

    // Duty pump flow and manifold pressure.
    const targetFlow = irrigating ? 88 : 0;
    this.solution.flowRate += (targetFlow - this.solution.flowRate) * Math.min(1, dt * 0.9);
    const targetPressure = irrigating ? 1.4 : 0.05;
    this.solution.pressure += (targetPressure - this.solution.pressure) * Math.min(1, dt * 0.8);

    // Dosing channels trim the mixed-feed tank toward its setpoints.
    const dosing = control?.dosing ?? {};
    const channelA = dosing.a?.enabled ?? true;
    const channelB = dosing.b?.enabled ?? true;
    const phDown = dosing.c?.enabled ?? true;
    const mixed = this.tanks[1];
    if (mixed) {
      const ecBias = (channelA ? 0.02 : 0) + (channelB ? 0.015 : 0);
      const phBias = phDown ? 0.02 : 0;
      const ecTarget = mixed.targetEc + Math.sin(phase) * 0.03 + ecBias;
      const phTarget = mixed.targetPh + Math.sin(phase * 0.7 + 1.2) * 0.03 - phBias;
      mixed.ec += (ecTarget - mixed.ec) * Math.min(1, dt * 0.05);
      mixed.ph += (Math.max(5.4, Math.min(6.2, phTarget)) - mixed.ph) * Math.min(1, dt * 0.04);
      mixed.temp += (19.3 - mixed.temp) * Math.min(1, dt * 0.02);
    }

    // Reservoir 1 (permeate) is slowly consumed while the mixed feed is irrigated.
    const permeate = this.tanks[0];
    if (permeate) {
      const draw = irrigating ? 0.0000105 : 0;
      permeate.level = clamp01(permeate.level - draw * dt);
      permeate.temp += (18.6 - permeate.temp) * Math.min(1, dt * 0.02);
    }

    // Rainwater transfer tops Reservoir 1 through the distribution manifold.
    this.rainAccumulator += dt;
    if (transferOn) {
      const inflow = Math.min(this.harvester.level, dt * 0.0000185);
      this.harvester.level = clamp01(this.harvester.level - inflow * 0.9);
      if (permeate) permeate.level = clamp01(permeate.level + inflow * 0.7);
      this.transferAccumulator += inflow;
    } else {
      this.harvester.level = clamp01(this.harvester.level + dt * 0.000004);
    }

    // The mixed feed supplies the tables; drainage returns to DR-01.
    if (mixed) {
      const feed = irrigating ? dt * 0.0000125 : 0;
      mixed.level = clamp01(mixed.level - feed);
      const openTables = control?.tables
        ? Array.from(control.tables.values()).filter((table) => table.open).length
        : 6;
      const drain = (feed + dt * 0.000004) * (openTables / 6);
      this.returnTank.level = clamp01(this.returnTank.level + drain * 0.8);
      this.drainAccumulator += drain;
    }

    // Slow return-tank evaporation / transfer back to the feed loop.
    this.returnTank.level = clamp01(this.returnTank.level - dt * 0.0000035);

    // Return tank EC climbs as drainage concentrates; pH drifts up.
    this.returnTank.ec += (1.46 - this.returnTank.ec) * Math.min(1, dt * 0.01);
    this.returnTank.ph += (6.18 - this.returnTank.ph) * Math.min(1, dt * 0.01);
    this.returnTank.temp += (21.4 - this.returnTank.temp) * Math.min(1, dt * 0.02);

    // Harvester tops up gently outside the transfer window.
    if (!transferOn) {
      const rain = dt * 0.0000022 * (0.6 + Math.sin(this.elapsedSeconds * 0.02) * 0.4);
      this.harvester.level = clamp01(this.harvester.level + rain);
    }

    // Keep the legacy aggregate fields coherent for the HUD.
    const tank = this.selectedTank ?? mixed ?? this.tanks[0];
    this.solution.ec = tank?.ec ?? this.solution.ec;
    this.solution.ph = tank?.ph ?? this.solution.ph;
    this.solution.waterTemp = tank?.temp ?? this.solution.waterTemp;

    // Dosing inventory drains while channels run.
    const activeChannels = [channelA, channelB, phDown].filter(Boolean).length;
    if (activeChannels > 0 && irrigating) {
      const draw = dt * 0.00000012 * activeChannels;
      this.dosing.stockA = clamp01(this.dosing.stockA - draw);
      this.dosing.stockB = clamp01(this.dosing.stockB - draw);
      this.dosing.phDown = clamp01(this.dosing.phDown - draw * 0.8);
      this.dosing.volumeToday += dt * 0.0004;
    }
  }

  reset() {
    this.elapsedSeconds = 0;
    const storage = this.layout.storage ?? {};
    (storage.roTanks ?? []).forEach((config, index) => {
      const tank = this.tanks[index];
      if (!tank) return;
      tank.level = config.initialLevel ?? 0.7;
      tank.ec = config.ec ?? 0.02;
      tank.ph = config.ph ?? 6.9;
      tank.temp = config.temp ?? 19;
    });
    this.returnTank.level = storage.returnTank?.initialLevel ?? 0.31;
    this.returnTank.ec = 1.46;
    this.returnTank.ph = 6.18;
    this.returnTank.temp = 21.6;
    this.harvester.level = storage.harvester?.initialLevel ?? 0.46;
    this.solution.ec = this.tanks[1]?.ec ?? 1.8;
    this.solution.ph = this.tanks[1]?.ph ?? 5.9;
    this.solution.waterTemp = this.tanks[1]?.temp ?? 19.4;
    this.solution.flowRate = 88;
    this.solution.pressure = 1.4;
    this.dosing.stockA = 0.72;
    this.dosing.stockB = 0.68;
    this.dosing.phDown = 0.54;
    this.dosing.dosesToday = 14;
    this.dosing.volumeToday = 38.4;
    this.drainAccumulator = 0;
    this.transferAccumulator = 0;
    this.rainAccumulator = 0;
  }
}
