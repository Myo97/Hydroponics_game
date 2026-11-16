import { LAYOUT } from '../config/layout.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));

/**
 * Version 6 water + nutrient model.
 *
 * Mirrors the physical storage layout: two buried reservoirs (Reservoir 1
 * permeate, Reservoir 2 mixed feed), the dirty nutrient-return tank (DR-01) and
 * the underground rainwater harvester. Two independently pumped irrigation
 * groups draw from their own reservoir; roof run-off refills the harvester only
 * while it is raining, and the transfer pump tops both reservoirs through the
 * clean-water distribution manifold.
 */
export class WaterNutrientSimulation {
  constructor({ equipment, layout = LAYOUT, control = null, climate = null } = {}) {
    this.equipment = equipment;
    this.layout = layout;
    this.control = control;
    this.climate = climate;
    this.elapsedSeconds = 0;
    this.rainInflow = 0;
    this.groupFlow = new Map();

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
      flowRate: 82.8,
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

  get groupMetrics() {
    const { groups, nominalBranchFlow, deadheadPressure } = this.layout.irrigation;
    return groups.map((group) => {
      const status = this.control?.getGroupStatus?.(group.id) ?? null;
      const pumpOn = this.control
        ? Boolean(this.control.pumps[group.pumpKey])
        : true;
      const flowingTables = status?.flowingTables ?? 9;
      const openValves = status?.openValves ?? 9;
      const flow = pumpOn ? flowingTables * nominalBranchFlow : 0;
      return {
        id: group.id,
        name: group.name,
        label: group.label,
        reservoirId: group.reservoirId,
        reservoirName: group.reservoirName,
        pumpKey: group.pumpKey,
        pumpOn,
        openValves,
        flowingTables,
        flow,
        pressure: !pumpOn ? 0.05 : flow > 0 ? 1.4 : deadheadPressure,
        tank: this.tanks.find((tank) => tank.id === group.reservoirId) ?? null,
      };
    });
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
      rainInflow: Number(this.rainInflow.toFixed(2)),
      groups: this.groupMetrics.map((group) => ({
        id: group.id,
        pumpOn: group.pumpOn,
        openValves: group.openValves,
        flowingTables: group.flowingTables,
        flow: Math.round(group.flow),
      })),
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
      weather: this.climate?.weather ?? 'sunny',
      weatherLabel: this.climate?.weatherLabel ?? 'Sunny',
      weatherManual: this.climate?.weatherManual ?? false,
      rainIntensity: this.climate?.rainIntensity ?? 0,
      rainMmPerHour: this.climate?.rainMmPerHour ?? 0,
      rainInflow: this.rainInflow,
      groups: this.groupMetrics.map((group) => ({
        id: group.id,
        name: group.name,
        label: group.label,
        reservoirId: group.reservoirId,
        reservoirName: group.reservoirName,
        pumpKey: group.pumpKey,
        pumpOn: group.pumpOn,
        openValves: group.openValves,
        flowingTables: group.flowingTables,
        flow: Math.round(group.flow),
        pressure: Number(group.pressure.toFixed(2)),
        tankLevel: Number((group.tank?.level ?? 0).toFixed(3)),
      })),
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
    const transferOn = control ? control.pumps.rainwaterTransferOn : true;
    const metrics = this.groupMetrics;
    this.groupFlow.clear();
    for (const metric of metrics) this.groupFlow.set(metric.id, metric.flow);

    // Each group pump only produces flow through open table valves. A pump with
    // every valve closed deadheads at high pressure.
    const targetFlow = metrics.reduce((sum, metric) => sum + metric.flow, 0);
    const targetPressure = metrics.reduce(
      (max, metric) => Math.max(max, metric.pressure),
      0.05,
    );
    this.solution.flowRate +=
      (targetFlow - this.solution.flowRate) * Math.min(1, dt * 0.9);
    this.solution.pressure +=
      (targetPressure - this.solution.pressure) * Math.min(1, dt * 0.8);

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

    // Each flowing table draws from its own group reservoir.
    for (const metric of metrics) {
      if (!metric.tank || metric.flow <= 0) continue;
      const draw = dt * 0.0000125 * (metric.flow / 82.8);
      metric.tank.level = clamp01(metric.tank.level - draw);
      metric.tank.temp +=
        ((metric.id === 'group-1' ? 18.6 : 19.3) - metric.tank.temp) *
        Math.min(1, dt * 0.02);
    }

    // Roof run-off reaches the underground harvester only while it is raining.
    const rain = this.climate;
    const rainConfig = this.layout.weather ?? {};
    const rainIntensity = rain?.rainIntensity ?? 0;
    const rainRateMmPerHour =
      rain?.rainMmPerHour ??
      rainIntensity * (rainConfig.rainMmPerHour ?? 0);
    const gameSecondsPerRealSecond =
      (rain?.minutesPerSecond ?? 1440 / LAYOUT.time.realSecondsPerGameDay) * 60;
    const rainLitresPerSecond =
      (rainRateMmPerHour *
        (rainConfig.roofAreaM2 ?? 0) *
        (rainConfig.runoffCoefficient ?? 0) *
        gameSecondsPerRealSecond) /
      3600;
    this.rainInflow = rainLitresPerSecond;
    if (rainLitresPerSecond > 0) {
      const litres = rainLitresPerSecond * dt;
      this.harvester.level = clamp01(
        this.harvester.level + litres / this.harvester.capacity,
      );
      this.rainAccumulator += litres;
    }

    // Transfer pump: harvester -> clean-water manifold -> each reservoir whose
    // isolation valve is open. Excess stays in the harvester at full tanks.
    if (transferOn) {
      const available = this.harvester.level * this.harvester.capacity;
      const transferLps = this.layout.storage.transferPump.flowLps ?? 1.7;
      const requested = Math.min(available, dt * transferLps);
      let request = requested;
      const targets = this.tanks.filter(
        (tank) => control?.storageValves?.[tank.id] ?? true,
      );
      if (request > 0 && targets.length > 0) {
        const share = request / targets.length;
        for (const tank of targets) {
          const room = (1 - tank.level) * tank.capacity;
          const added = Math.min(share, Math.max(0, room));
          tank.level = clamp01(tank.level + added / tank.capacity);
          request -= added;
          this.transferAccumulator += added;
        }
        const used = requested - request;
        this.harvester.level = clamp01(
          this.harvester.level - used / this.harvester.capacity,
        );
      }
    }

    // Drainage from the tables returns to DR-01 proportionally to total flow.
    const drain = (targetFlow / 60) * dt * 0.78;
    this.returnTank.level = clamp01(
      this.returnTank.level + drain / this.returnTank.capacity,
    );
    this.drainAccumulator += drain;

    // Slow return-tank evaporation / transfer back to the feed loop.
    this.returnTank.level = clamp01(this.returnTank.level - dt * 0.0000035);

    // Return tank EC climbs as drainage concentrates; pH drifts up.
    this.returnTank.ec += (1.46 - this.returnTank.ec) * Math.min(1, dt * 0.01);
    this.returnTank.ph += (6.18 - this.returnTank.ph) * Math.min(1, dt * 0.01);
    this.returnTank.temp += (21.4 - this.returnTank.temp) * Math.min(1, dt * 0.02);

    // Keep the aggregate fields coherent for the HUD and the controller HMIs.
    const tank = this.selectedTank ?? mixed ?? this.tanks[0];
    this.solution.ec = tank?.ec ?? this.solution.ec;
    this.solution.ph = tank?.ph ?? this.solution.ph;
    this.solution.waterTemp = tank?.temp ?? this.solution.waterTemp;

    // Dosing inventory drains while solution is actually moving in Group 2.
    const activeChannels = [channelA, channelB, phDown].filter(Boolean).length;
    const mixedFlow = this.groupFlow.get('group-2') ?? 0;
    if (activeChannels > 0 && mixedFlow > 0) {
      const draw = dt * 0.00000012 * activeChannels * (mixedFlow / 41.4);
      this.dosing.stockA = clamp01(this.dosing.stockA - draw);
      this.dosing.stockB = clamp01(this.dosing.stockB - draw);
      this.dosing.phDown = clamp01(this.dosing.phDown - draw * 0.8);
      this.dosing.volumeToday += dt * 0.0004 * (mixedFlow / 41.4);
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
    this.solution.flowRate = 82.8;
    this.solution.pressure = 1.4;
    this.dosing.stockA = 0.72;
    this.dosing.stockB = 0.68;
    this.dosing.phDown = 0.54;
    this.dosing.dosesToday = 14;
    this.dosing.volumeToday = 38.4;
    this.drainAccumulator = 0;
    this.transferAccumulator = 0;
    this.rainAccumulator = 0;
    this.rainInflow = 0;
    this.groupFlow.clear();
  }
}
