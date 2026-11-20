import { LAYOUT } from '../config/layout.js';
import {
  CROP_NAME,
  NFT_PRODUCTION_DAYS,
  TOTAL_GROWTH_DAYS,
  nftDevelopmentForDay,
  resolveCropVariety,
  targetHarvestWeightG,
} from './GreenCoralGrowth.js';

/**
 * Crop growth model.
 *
 * The original row contract (six NFT rows, age and health) is retained for the
 * existing HUD and tooling. Per-hole plantings are now calendar driven: one
 * completed in-game day advances every plant once, and the growth record carries
 * planting date, age, leaf count, height, canopy spread and status.
 *
 * Existing cultivar names are aliases into the crop profile catalogue in
 * GreenCoralGrowth.js, so save data and row summaries remain compatible.
 */
export const CULTIVARS = [
  { name: 'Green Coral Lettuce', daysToHarvest: 34, sowingDay: 6 },
  { name: 'Green Oak Lettuce', daysToHarvest: 34, sowingDay: 9 },
  { name: 'Red Oak Lettuce', daysToHarvest: 34, sowingDay: 4 },
  { name: 'Xiao Bai Cai', daysToHarvest: 34, sowingDay: 12 },
  { name: 'Pak Choy', daysToHarvest: 34, sowingDay: 2 },
  { name: 'Salanova Green', daysToHarvest: 34, sowingDay: 7 },
];


const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

export class PlantSimulation {
  constructor({ equipment, layout = LAYOUT } = {}) {
    this.equipment = equipment;
    this.layout = layout;
    this.elapsedSeconds = 0;
    // Retained for save/UI compatibility. Crop age itself is calendar driven,
    // not elapsed real time.
    this.dayLengthSeconds = 600;
    this.version = 0;
    this.transplantCounter = 0;
    this.transplants = new Map();
    this.calendarDay = 0;
    this.growthDayCursor = 0;
    this.lastGrowthCalendarDay = null;
    this.lastGrowthResult = { advanced: 0, day: 0, ready: 0 };
    this.harvestCounter = 0;
    /** Persistent harvest inventory. Values are aggregate counts/weights. */
    this.harvestInventory = new Map();
    this.harvestStats = {
      harvestedPlants: 0,
      totalHarvestWeightG: 0,
      byCrop: {},
    };
    this.harvestLog = [];

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
    return this.calendarDay + 1;
  }

  get transplantedPlantCount() {
    let count = 0;
    for (const entry of this.transplants.values()) count += entry.plants.length;
    return count;
  }

  get harvestReadyPlantCount() {
    let count = 0;
    for (const entry of this.transplants.values()) {
      for (const plant of entry.plants) if (plant.harvestReady) count += 1;
    }
    return count;
  }

  get totalHarvestWeightG() {
    return this.harvestStats.totalHarvestWeightG;
  }

  get harvestInventoryList() {
    return Array.from(this.harvestInventory.values(), (lot) => ({ ...lot }));
  }

  get summary() {
    const total = this.rows.reduce(
      (sum, row) => sum + row.plantsPerGully * row.gulliesPerTable * row.tables,
      0,
    );
    const averageHealth =
      this.rows.reduce((sum, row) => sum + row.health, 0) / Math.max(1, this.rows.length);
    return {
      plants: total + this.transplantedPlantCount,
      transplantedPlants: this.transplantedPlantCount,
      harvestReadyPlants: this.harvestReadyPlantCount,
      harvestedPlants: this.harvestStats.harvestedPlants,
      totalHarvestWeightG: this.harvestStats.totalHarvestWeightG,
      averageHealth,
      oldestRow: this.rows.reduce((oldest, row) => (row.ageDays > oldest.ageDays ? row : oldest)),
      cropDay: this.cropDay,
    };
  }

  tableCapacity() {
    return this.layout.beds.gulliesPerTable * this.layout.beds.holesPerGully;
  }

  ensureTable(tableId) {
    if (!this.transplants.has(tableId)) {
      const capacity = this.tableCapacity();
      this.transplants.set(tableId, {
        occupied: new Uint8Array(capacity),
        plants: [],
        capacity,
        gullies: this.layout.beds.gulliesPerTable,
        cellsPerGully: this.layout.beds.holesPerGully,
      });
    }
    return this.transplants.get(tableId);
  }

  availablePositions(tableId) {
    const entry = this.ensureTable(tableId);
    return entry.capacity - entry.plants.length;
  }

  gullyAvailability(tableId) {
    const entry = this.ensureTable(tableId);
    return Array.from({ length: entry.gullies }, (_, gully) => {
      let used = 0;
      for (let hole = 0; hole < entry.cellsPerGully; hole += 1) {
        if (entry.occupied[gully * entry.cellsPerGully + hole]) used += 1;
      }
      return {
        gully: gully + 1,
        used,
        free: entry.cellsPerGully - used,
        capacity: entry.cellsPerGully,
      };
    });
  }

  /**
   * Fill free planting holes across one NFT table. Each gully's capacity is
   * respected; the whole tray is rejected if the table cannot hold it.
   */
  transplantTray({
    tableId,
    cropName = CROP_NAME,
    sourceTrayId = null,
    germinated = 0,
    startDay = 14,
    plantedCalendarDay = null,
  }) {
    if (!tableId) return { ok: false, reason: 'No NFT table selected' };
    const count = Math.max(0, Math.round(germinated));
    if (count === 0) return { ok: false, reason: 'Tray has no germinated seedlings' };

    const entry = this.ensureTable(tableId);
    const free = entry.capacity - entry.plants.length;
    if (free < count) {
      return {
        ok: false,
        reason: `Table capacity ${entry.capacity}; only ${free} planting holes free`,
        free,
        capacity: entry.capacity,
      };
    }

    let planted = 0;
    const gulliesUsed = new Set();
    for (let gully = 0; gully < entry.gullies && planted < count; gully += 1) {
      for (let hole = 0; hole < entry.cellsPerGully && planted < count; hole += 1) {
        const cell = gully * entry.cellsPerGully + hole;
        if (entry.occupied[cell]) continue;
        entry.occupied[cell] = 1;
        gulliesUsed.add(gully);
        this.transplantCounter += 1;
        // Nursery age is a completed-plug credential and is frozen at transplant.
        // Production age starts at Day 1 independently, so a Day-14 plug is never
        // mistaken for a Day-15 NFT plant on the same calendar.
        const nurseryAgeDays = Math.max(
          1,
          Math.min(TOTAL_GROWTH_DAYS, Math.round(Number(startDay) || TOTAL_GROWTH_DAYS)),
        );
        const nftAgeDays = 1;
        const variety = resolveCropVariety(cropName);
        const development = nftDevelopmentForDay(nftAgeDays, variety.name);
        entry.plants.push({
          id: `nft-crop-${this.transplantCounter}`,
          plantId: this.transplantCounter,
          tableId,
          gully,
          hole,
          cropName: variety.name,
          cropKey: variety.key,
          sourceTrayId,
          plantedCalendarDay: Number.isFinite(plantedCalendarDay)
            ? plantedCalendarDay
            : this.calendarDay,
          nftPlantedCalendarDay: Number.isFinite(plantedCalendarDay)
            ? plantedCalendarDay
            : this.calendarDay,
          lastGrowthCalendarDay: Number.isFinite(plantedCalendarDay)
            ? plantedCalendarDay
            : this.calendarDay,
          nurseryAgeDays,
          nurseryAgeAtTransplant: nurseryAgeDays,
          nftAgeDays,
          nftProductionAgeDays: nftAgeDays,
          ageDays: nurseryAgeDays + nftAgeDays,
          totalAgeDays: nurseryAgeDays + nftAgeDays,
          growthStage: development.stage,
          stageKey: development.stageKey,
          leafCount: development.leafCount,
          plantHeight: development.height,
          canopySpread: development.canopySpread,
          rosetteDiameter: development.rosetteDiameter,
          rootDepthM: development.rootDepthM,
          biomassG: development.biomassG,
          harvestWeightG: development.biomassG,
          estimatedHarvestWeightG: development.biomassG,
          targetHarvestWeightG: development.targetHarvestWeightG,
          harvestReady: false,
          growthStatus: development.status,
          variantSeed: (this.transplantCounter * 0.6180339887498949) % 1,
          growthSeed: ((this.transplantCounter * 0.41421356237) % 1) * Math.PI * 2,
        });
        planted += 1;
      }
    }

    this.version += 1;
    return {
      ok: true,
      planted,
      gulliesUsed: gulliesUsed.size,
      free: entry.capacity - entry.plants.length,
      capacity: entry.capacity,
    };
  }

  getTablePlantings(tableId) {
    return this.ensureTable(tableId).plants;
  }

  getTableSummary(tableId) {
    const entry = this.ensureTable(tableId);
    return {
      planted: entry.plants.length,
      free: entry.capacity - entry.plants.length,
      capacity: entry.capacity,
      gullies: this.gullyAvailability(tableId),
    };
  }

  /**
   * Reconcile the stored record with the production curve. Nursery age and NFT
   * production age are tracked independently; total age is their sum and is only
   * used for continuity with the older crop UI and save data.
   */
  getPlantGrowth(plant) {
    if (!plant) return null;
    const nurseryAgeDays = clampNumber(
      Math.round(
        Number(plant.nurseryAgeDays ?? plant.nurseryAgeAtTransplant ?? TOTAL_GROWTH_DAYS) ||
          TOTAL_GROWTH_DAYS,
      ),
      1,
      TOTAL_GROWTH_DAYS,
    );
    const nftAgeDays = clampNumber(
      Math.round(Number(plant.nftAgeDays ?? plant.nftProductionAgeDays ?? 1) || 1),
      1,
      NFT_PRODUCTION_DAYS,
    );
    const development = nftDevelopmentForDay(nftAgeDays, plant.cropName);
    plant.nurseryAgeDays = nurseryAgeDays;
    plant.nurseryAgeAtTransplant = nurseryAgeDays;
    plant.nftAgeDays = nftAgeDays;
    plant.nftProductionAgeDays = nftAgeDays;
    plant.ageDays = nurseryAgeDays + nftAgeDays;
    plant.totalAgeDays = plant.ageDays;
    plant.growthStage = development.stage;
    plant.stageKey = development.stageKey;
    plant.stageLabel = development.stageLabel;
    plant.leafCount = development.leafCount;
    plant.plantHeight = development.height;
    plant.canopySpread = development.canopySpread;
    plant.rosetteDiameter = development.rosetteDiameter;
    plant.rootDepthM = development.rootDepthM;
    plant.biomassG = development.biomassG;
    plant.harvestWeightG = development.biomassG;
    plant.estimatedHarvestWeightG = development.biomassG;
    plant.targetHarvestWeightG = development.targetHarvestWeightG;
    plant.harvestReady = development.harvestReady;
    plant.growthStatus = development.status;
    return {
      ...development,
      nurseryAgeDays,
      nftAgeDays,
      totalAgeDays: plant.ageDays,
      nftDay: nftAgeDays,
    };
  }

  /**
   * Stable inspection payload shared by hover, inspect UI and harvest actions.
   * Ages, stage, stored biomass and readiness all come from the same record.
   */
  describePlant(plant, table = null) {
    if (!plant) return null;
    const growth = this.getPlantGrowth(plant);
    const harvestReady = Boolean(plant.harvestReady);
    const biomass = Number(plant.biomassG) || 0;
    const target = Number(plant.targetHarvestWeightG) || targetHarvestWeightG(plant.cropName);
    const title = `${plant.cropName} - NFT Day ${plant.nftAgeDays}/${NFT_PRODUCTION_DAYS}`;
    return {
      id: plant.id,
      plantId: plant.id,
      numericId: plant.plantId,
      type: 'nft-crop',
      kind: 'nft-table',
      category: 'NFT crop',
      tableId: table?.id ?? plant.tableId,
      nftTableId: table?.id ?? plant.tableId,
      tableName: table?.name ?? `NFT table ${plant.tableId}`,
      cropName: plant.cropName,
      cropKey: plant.cropKey,
      title,
      hintName: harvestReady ? `${plant.cropName} - READY FOR HARVEST` : title,
      description: harvestReady
        ? 'Full-grown commercial head at the end of its 17-day NFT production cycle.'
        : `Nursery Day ${plant.nurseryAgeDays} plug now on NFT production Day ${plant.nftAgeDays}.`,
      action: harvestReady ? 'Harvest crop' : 'Inspect crop',
      interaction: harvestReady ? 'harvest-crop' : 'inspect-crop',
      interactionHint: harvestReady
        ? 'Tap to pack head · hold to inspect'
        : 'Tap to inspect plant',
      harvestReady,
      ready: harvestReady,
      stage: plant.growthStage,
      stageLabel: plant.stageLabel ?? growth.stageLabel,
      status: plant.growthStatus,
      nurseryAgeDays: plant.nurseryAgeDays,
      nurseryAge: plant.nurseryAgeDays,
      nftAgeDays: plant.nftAgeDays,
      nftAge: plant.nftAgeDays,
      totalAgeDays: plant.ageDays,
      ageDays: plant.ageDays,
      day: plant.nftAgeDays,
      productionDay: plant.nftAgeDays,
      targetHarvestDay: NFT_PRODUCTION_DAYS,
      leafCount: plant.leafCount,
      heightM: plant.plantHeight,
      diameterM: plant.rosetteDiameter,
      rootDepthM: plant.rootDepthM,
      biomassG: biomass,
      harvestWeightG: biomass,
      estimatedHarvestWeightG: biomass,
      targetHarvestWeightG: target,
      specs: [
        ['Crop', plant.cropName],
        ['Nursery age', `${plant.nurseryAgeDays} days`],
        ['NFT production age', `Day ${plant.nftAgeDays} / ${NFT_PRODUCTION_DAYS}`],
        ['Growth stage', plant.stageLabel ?? growth.stageLabel],
        ['Leaf count', `${plant.leafCount}`],
        ['Height', `${(plant.plantHeight * 100).toFixed(1)} cm`],
        ['Canopy', `${(plant.rosetteDiameter * 100).toFixed(1)} cm across`],
        ['Biomass', `${biomass.toFixed(1)} g / ${target.toFixed(0)} g target`],
        ['Status', harvestReady ? 'READY FOR HARVEST' : plant.growthStatus],
      ],
    };
  }

  /** Backwards-compatible inspection alias. */
  getPlantInfo(plant, table = null) {
    return this.describePlant(plant, table);
  }

  /**
   * Remove one harvest-ready plant and add its stored biomass to inventory.
   * Plants before NFT Day 17 are rejected rather than silently deleted.
   */
  harvestPlant(tableIdOrPlantId, plantId = null) {
    let entry = null;
    let plant = null;
    let plantIndex = -1;

    if (plantId == null) {
      for (const candidate of this.transplants.values()) {
        const index = candidate.plants.findIndex(
          (item) =>
            item.id === tableIdOrPlantId || String(item.plantId) === String(tableIdOrPlantId),
        );
        if (index >= 0) {
          entry = candidate;
          plant = candidate.plants[index];
          plantIndex = index;
          break;
        }
      }
    } else {
      entry = this.transplants.get(tableIdOrPlantId) ?? null;
      if (entry) {
        plantIndex = entry.plants.findIndex(
          (item) => item.id === plantId || String(item.plantId) === String(plantId),
        );
        plant = plantIndex >= 0 ? entry.plants[plantIndex] : null;
      }
    }

    if (!entry || !plant || plantIndex < 0) {
      return { ok: false, reason: 'Crop plant not found' };
    }
    const growth = this.getPlantGrowth(plant);
    if (!plant.harvestReady) {
      return {
        ok: false,
        ready: false,
        reason: `Not ready: NFT Day ${growth.nftAgeDays} of ${NFT_PRODUCTION_DAYS}`,
        nftAgeDays: growth.nftAgeDays,
        targetHarvestDay: NFT_PRODUCTION_DAYS,
      };
    }

    const weightG = Math.max(0, Number(plant.harvestWeightG ?? plant.biomassG ?? 0));
    entry.plants.splice(plantIndex, 1);
    const cell = plant.gully * entry.cellsPerGully + plant.hole;
    if (cell >= 0 && cell < entry.occupied.length) entry.occupied[cell] = 0;

    this.harvestCounter += 1;
    const harvestCalendarDay = this.lastGrowthCalendarDay ?? this.calendarDay;
    const lot = {
      id: `harvest-lot-${this.harvestCounter}`,
      cropKey: plant.cropKey,
      cropName: plant.cropName,
      count: 1,
      weightG,
      sourceTableId: plant.tableId,
      plantId: plant.id,
      nurseryAgeDays: plant.nurseryAgeDays,
      nftAgeDays: plant.nftAgeDays,
      harvestCalendarDay,
      harvestReady: true,
    };
    const inventoryKey = `${plant.cropKey}@${harvestCalendarDay}`;
    const existingLot = this.harvestInventory.get(inventoryKey);
    if (existingLot) {
      existingLot.count += 1;
      existingLot.weightG += weightG;
    } else {
      this.harvestInventory.set(inventoryKey, lot);
    }

    this.harvestStats.harvestedPlants += 1;
    this.harvestStats.totalHarvestWeightG += weightG;
    const cropStats = (this.harvestStats.byCrop[plant.cropKey] ??= {
      cropName: plant.cropName,
      count: 0,
      weightG: 0,
    });
    cropStats.count += 1;
    cropStats.weightG += weightG;
    this.harvestLog.push({ ...lot });
    if (this.harvestLog.length > 500) this.harvestLog.splice(0, this.harvestLog.length - 500);

    this.version += 1;
    return {
      ok: true,
      plantId: plant.id,
      cropName: plant.cropName,
      cropKey: plant.cropKey,
      weightG,
      harvestWeightG: weightG,
      totalHarvestWeightG: this.harvestStats.totalHarvestWeightG,
      harvestedPlants: this.harvestStats.harvestedPlants,
      harvestCalendarDay,
      inventory: lot,
    };
  }


  /**
   * Advance every transplant exactly once for a completed in-game day.
   *
   * `calendarDay` is the climate's zero-based day index. A plant records the day
   * it last grew, so a render-loop duplicate, a developer skip and a restore can
   * all report the same date without producing a second leaf flush.
   */
  advanceDay(calendarDay = null) {
    const day = Number.isFinite(calendarDay)
      ? calendarDay
      : this.growthDayCursor + 1;
    if (this.lastGrowthCalendarDay === day) {
      return { advanced: 0, day, duplicate: true };
    }

    this.lastGrowthCalendarDay = day;
    this.growthDayCursor = day;
    this.calendarDay = day;
    for (const row of this.rows) row.ageDays = 12 + row.id * 2 + day;
    let advanced = 0;

    for (const entry of this.transplants.values()) {
      for (const plant of entry.plants) {
        if (plant.lastGrowthCalendarDay === day) continue;
        plant.lastGrowthCalendarDay = day;
        const currentNftAge = clampNumber(
          Math.round(Number(plant.nftAgeDays) || 1),
          1,
          NFT_PRODUCTION_DAYS,
        );
        if (currentNftAge >= NFT_PRODUCTION_DAYS) {
          // Harvest-ready plants stay in the channel indefinitely; they never
          // gain a 21st day and are only removed by an explicit harvest action.
          plant.nftAgeDays = NFT_PRODUCTION_DAYS;
          plant.nftProductionAgeDays = NFT_PRODUCTION_DAYS;
          plant.ageDays = (plant.nurseryAgeDays ?? TOTAL_GROWTH_DAYS) + NFT_PRODUCTION_DAYS;
          plant.totalAgeDays = plant.ageDays;
          plant.harvestReady = true;
          continue;
        }
        plant.nftAgeDays = currentNftAge + 1;
        plant.nftProductionAgeDays = plant.nftAgeDays;
        this.getPlantGrowth(plant);
        advanced += 1;
      }
    }

    const ready = this.harvestReadyPlantCount;
    if (advanced > 0) this.version += 1;
    this.lastGrowthResult = { advanced, day, duplicate: false, ready };
    return this.lastGrowthResult;
  }

  /** Real time only tracks session duration now; age is calendar driven. */
  update(dt) {
    this.elapsedSeconds += Math.max(0, dt);
  }

  snapshotGrowth() {
    return {
      elapsedSeconds: this.elapsedSeconds,
      version: this.version,
      transplantCounter: this.transplantCounter,
      calendarDay: this.calendarDay,
      growthDayCursor: this.growthDayCursor,
      lastGrowthCalendarDay: this.lastGrowthCalendarDay,
      harvest: {
        counter: this.harvestCounter,
        inventory: this.harvestInventoryList,
        stats: {
          harvestedPlants: this.harvestStats.harvestedPlants,
          totalHarvestWeightG: this.harvestStats.totalHarvestWeightG,
          byCrop: JSON.parse(JSON.stringify(this.harvestStats.byCrop ?? {})),
        },
        log: this.harvestLog.map((lot) => ({ ...lot })),
      },
      tables: Array.from(this.transplants, ([tableId, entry]) => ({
        tableId,
        occupied: Array.from(entry.occupied),
        plants: entry.plants.map((plant) => ({ ...plant })),
      })),
    };
  }

  restoreGrowth(state = {}) {
    this.elapsedSeconds = Math.max(0, Number(state?.elapsedSeconds) || 0);
    this.transplantCounter = Math.max(0, Number(state?.transplantCounter) || 0);
    this.calendarDay = Math.max(0, Number(state?.calendarDay) || 0);
    this.growthDayCursor = Math.max(0, Number(state?.growthDayCursor) || 0);
    this.lastGrowthCalendarDay = Number.isFinite(state?.lastGrowthCalendarDay)
      ? state.lastGrowthCalendarDay
      : this.calendarDay;
    this.transplants.clear();
    for (const row of this.rows) row.ageDays = 12 + row.id * 2 + this.calendarDay;

    this.harvestCounter = Math.max(0, Number(state?.harvest?.counter) || 0);
    this.harvestInventory.clear();
    for (const lot of state?.harvest?.inventory ?? []) {
      if (!lot?.cropKey) continue;
      const key = `${lot.cropKey}@${lot.harvestCalendarDay ?? this.calendarDay}`;
      this.harvestInventory.set(key, { ...lot });
    }
    const savedHarvestStats = state?.harvest?.stats ?? {};
    this.harvestStats = {
      harvestedPlants: Math.max(0, Number(savedHarvestStats.harvestedPlants) || 0),
      totalHarvestWeightG: Math.max(0, Number(savedHarvestStats.totalHarvestWeightG) || 0),
      byCrop: JSON.parse(JSON.stringify(savedHarvestStats.byCrop ?? {})),
    };
    this.harvestLog = Array.isArray(state?.harvest?.log)
      ? state.harvest.log.slice(-500).map((lot) => ({ ...lot }))
      : [];

    for (const saved of state?.tables ?? []) {
      if (!saved?.tableId || !Array.isArray(saved.plants)) continue;
      const entry = this.ensureTable(saved.tableId);
      entry.occupied.fill(0);
      if (Array.isArray(saved.occupied)) {
        saved.occupied.forEach((value, index) => {
          if (index < entry.occupied.length) entry.occupied[index] = value ? 1 : 0;
        });
      }
      for (let index = 0; index < saved.plants.length; index += 1) {
        const savedPlant = saved.plants[index];
        if (!Number.isInteger(savedPlant.gully) || !Number.isInteger(savedPlant.hole)) continue;
        const cell = savedPlant.gully * entry.cellsPerGully + savedPlant.hole;
        if (cell < 0 || cell >= entry.capacity) continue;
        const variety = resolveCropVariety(savedPlant.cropName);
        const nurseryAgeDays = clampNumber(
          Math.round(
            Number(
              savedPlant.nurseryAgeDays ??
                savedPlant.nurseryAgeAtTransplant ??
                TOTAL_GROWTH_DAYS,
            ) || TOTAL_GROWTH_DAYS,
          ),
          1,
          TOTAL_GROWTH_DAYS,
        );
        const savedNftAge = Number(savedPlant.nftAgeDays ?? savedPlant.nftProductionAgeDays);
        const legacyAge = Math.max(1, Number(savedPlant.ageDays) || 1);
        const nftAgeDays = clampNumber(
          Math.round(Number.isFinite(savedNftAge) ? savedNftAge : legacyAge - nurseryAgeDays),
          1,
          NFT_PRODUCTION_DAYS,
        );
        const development = nftDevelopmentForDay(nftAgeDays, variety.name);
        const storedBiomass = Number(savedPlant.harvestWeightG ?? savedPlant.biomassG);
        const plantId = Number(savedPlant.plantId) || this.transplantCounter + index + 1;
        const restoredPlant = {
          ...savedPlant,
          id: savedPlant.id ?? `nft-crop-${plantId}`,
          plantId,
          cropName: variety.name,
          cropKey: variety.key,
          nurseryAgeDays,
          nurseryAgeAtTransplant: nurseryAgeDays,
          nftAgeDays,
          nftProductionAgeDays: nftAgeDays,
          ageDays: nurseryAgeDays + nftAgeDays,
          totalAgeDays: nurseryAgeDays + nftAgeDays,
          growthStage: development.stage,
          stageKey: development.stageKey,
          stageLabel: development.stageLabel,
          leafCount: development.leafCount,
          plantHeight: development.height,
          canopySpread: development.canopySpread,
          rosetteDiameter: development.rosetteDiameter,
          rootDepthM: development.rootDepthM,
          biomassG: Number.isFinite(storedBiomass)
            ? storedBiomass
            : development.biomassG,
          harvestWeightG: Number.isFinite(storedBiomass)
            ? storedBiomass
            : development.biomassG,
          estimatedHarvestWeightG: Number.isFinite(storedBiomass)
            ? storedBiomass
            : development.biomassG,
          targetHarvestWeightG: development.targetHarvestWeightG,
          harvestReady:
            Boolean(savedPlant.harvestReady) || nftAgeDays >= NFT_PRODUCTION_DAYS,
          growthStatus: development.status,
          lastGrowthCalendarDay: Number.isFinite(savedPlant.lastGrowthCalendarDay)
            ? savedPlant.lastGrowthCalendarDay
            : this.calendarDay,
        };
        entry.plants.push(restoredPlant);
        entry.occupied[cell] = 1;
      }
    }
    this.version += 1;
    this.lastGrowthResult = {
      advanced: 0,
      day: this.calendarDay,
      duplicate: false,
      ready: this.harvestReadyPlantCount,
    };
    return this.transplantedPlantCount;
  }

  reset() {
    this.elapsedSeconds = 0;
    this.version = 0;
    this.transplantCounter = 0;
    this.transplants.clear();
    this.calendarDay = 0;
    this.growthDayCursor = 0;
    this.lastGrowthCalendarDay = null;
    this.lastGrowthResult = { advanced: 0, day: 0, ready: 0 };
    this.harvestCounter = 0;
    this.harvestInventory.clear();
    this.harvestStats = { harvestedPlants: 0, totalHarvestWeightG: 0, byCrop: {} };
    this.harvestLog = [];
    for (const row of this.rows) {
      row.ageDays = 12 + row.id * 2;
      row.health = 1;
    }
  }
}
