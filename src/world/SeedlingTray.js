import * as THREE from 'three';
import {
  CROP_NAME,
  createTrayPlan,
  cropDevelopmentForDay,
  growthScaleForDay,
  hashSeed,
  resolveCropVariety,
  stageForDay,
  TOTAL_GROWTH_DAYS,
} from '../simulation/GreenCoralGrowth.js';
import { SeedlingPlantLayer } from './SeedlingPlantLayer.js';

/**
 * One independent 320-cell propagation tray.
 *
 * The tray owns its germination mask, planting/growth data and interaction
 * record. The bench keeps the shell instance for performance; this class owns
 * the canopy, hit target and lifecycle so a tray can be grown, picked up,
 * carried or reset without disturbing its neighbours.
 */
export class SeedlingTray {
  constructor({
    id,
    index,
    row,
    column,
    x,
    z,
    width,
    length,
    height,
    cells,
    bottomY,
    topY,
    materials,
    plantParent,
    hitParent,
    table = null,
  }) {
    this.id = id;
    this.index = index;
    this.row = row;
    this.column = column;
    this.x = x;
    this.z = z;
    this.width = width;
    this.length = length;
    this.height = height;
    this.cells = cells;
    this.cropName = CROP_NAME;
    this.bottomY = bottomY;
    this.topY = topY;
    this.home = { x, z, bottomY };
    this.table = table;
    this.materials = materials;

    this.state = 'empty';
    this.plantedDay = null;
    this.plantedCalendarDay = null;
    this.lastGrowthCalendarDay = null;
    this.growthDay = 0;
    this.germinated = 0;
    this.emptyCells = cells;
    this.plan = null;
    this.planSeed = null;
    this.stage = 0;
    this.ready = false;
    this.growing = false;
    this.targetDay = 1;
    this.growthStartDay = 1;
    this.growthElapsed = 0;
    this.growthDuration = 3.2;
    this.cycle = 0;
    this.atTable = true;
    this.detailed = false;

    this.layer = new SeedlingPlantLayer({ materials, parent: plantParent });
    this.layer.group.position.set(x, topY + 0.001, z);
    this.layer.setVisible(true);

    this.hitProxy = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.012, 0.13, length - 0.012),
      materials.hitProxy,
    );
    this.hitProxy.name = `${id}-hit`;
    this.hitProxy.position.set(x, topY + 0.055, z);
    this.hitProxy.userData.trayId = id;
    hitParent.add(this.hitProxy);

    this.info = {
      id: `${id}-tray`,
      trayId: id,
      buildingId: 'nursery-greenhouse',
      category: 'Propagation tray',
      title: `Seedling tray ${String(index + 1).padStart(2, '0')}`,
      interaction: 'nursery-seed-tray',
      interactionHint: 'Plant Green Coral seeds',
      description: '',
      specs: [],
    };
    this.hitProxy.userData.interactable = this.info;
    this.layer.group.userData.interactable = this.info;
    this.layer.group.userData.trayId = id;
    this.refreshInteraction();
  }

  get stageDefinition() {
    return this.stage > 0 ? stageForDay(this.growthDay) : null;
  }

  /** Shared growth record used by the inspect panel and the save payload. */
  get development() {
    if (this.state === 'empty') return null;
    return cropDevelopmentForDay(this.growthDay, this.cropName);
  }

  get leafCount() {
    return this.development?.leafCount ?? 0;
  }

  get plantHeight() {
    return this.development?.height ?? 0;
  }

  get canopySpread() {
    return this.development?.canopySpread ?? 0;
  }

  get growthStatus() {
    return this.development?.status ?? 'Empty';
  }

  get statusLabel() {
    if (this.state === 'empty') return 'Empty';
    if (this.ready) return 'READY FOR TRANSPLANT';
    if (this.state === 'seeded') return 'Seeded';
    return 'Growing';
  }

  get canPlant() {
    return this.state === 'empty' && this.atTable;
  }

  get canPickUp() {
    return this.atTable && (this.state === 'empty' || this.ready);
  }

  plantSeeds({ seed = null, duration = 3.2, calendarDay = null, cropName = CROP_NAME } = {}) {
    if (!this.canPlant) {
      return {
        ok: false,
        reason: this.atTable ? 'Tray is already in production' : 'Tray is not on the bench',
      };
    }

    this.cycle += 1;
    const planSeed = seed ?? hashSeed(`${this.id}:cycle-${this.cycle}`);
    this.plan = createTrayPlan({
      seed: planSeed,
      cells: this.cells,
      width: this.width,
      length: this.length,
    });
    this.planSeed = planSeed;
    this.cropName = resolveCropVariety(cropName).name;
    this.state = 'seeded';
    this.plantedDay = 1;
    this.plantedCalendarDay = Number.isFinite(calendarDay) ? calendarDay : null;
    this.lastGrowthCalendarDay = this.plantedCalendarDay;
    this.growthDay = 1;
    this.targetDay = 1;
    this.germinated = this.plan.germinated;
    this.emptyCells = this.plan.empty;
    this.stage = stageForDay(1).stage;
    this.ready = false;
    this.growing = false;
    this.growthElapsed = 0;
    this.growthStartDay = 1;
    this.growthDuration = duration;
    this.refreshVisual();
    this.refreshInteraction();
    this.table?.refreshStock();
    return {
      ok: true,
      tray: this,
      cropName: this.cropName,
      germinated: this.germinated,
      empty: this.emptyCells,
    };
  }

  /** Start the accelerated 14-day sequence. Empty/ready trays are ignored. */
  startGrow(duration = this.growthDuration) {
    if (this.state === 'empty') return false;
    if (this.growthDay >= TOTAL_GROWTH_DAYS) {
      this.setGrowthDay(TOTAL_GROWTH_DAYS);
      return false;
    }
    this.growing = true;
    this.growthElapsed = 0;
    this.growthStartDay = this.growthDay;
    this.growthDuration = Math.max(0.4, duration);
    this.targetDay = TOTAL_GROWTH_DAYS;
    this.refreshInteraction();
    return true;
  }

  /** Called by NurseryGrowthController every frame. */
  updateGrowth(dt) {
    const visualChanged = this.layer.update(dt);
    if (!this.growing || this.state === 'empty') return visualChanged;
    this.growthElapsed += Math.max(0, dt);
    const progress = THREE.MathUtils.clamp(
      this.growthElapsed / this.growthDuration,
      0,
      1,
    );
    const exactDay =
      this.growthStartDay + (TOTAL_GROWTH_DAYS - this.growthStartDay) * progress;
    const wholeDay = Math.max(this.growthDay, Math.floor(exactDay));
    let changed = visualChanged;

    if (wholeDay > this.growthDay) {
      this.setGrowthDay(wholeDay, { fromGrowth: true });
      changed = true;
    }

    if (progress >= 1) {
      this.growing = false;
      this.setGrowthDay(TOTAL_GROWTH_DAYS, { fromGrowth: true });
      changed = true;
    }
    return changed;
  }

  /**
   * One completed in-game day. The per-tray calendar guard makes this idempotent
   * even if the frame loop, a developer skip and a save restore all report the
   * same date.
   */
  advanceDay(calendarDay) {
    if (this.state === 'empty') return false;
    const day = Number.isFinite(calendarDay) ? calendarDay : null;
    if (day !== null && this.lastGrowthCalendarDay === day) return false;
    if (day !== null) this.lastGrowthCalendarDay = day;
    if (this.growthDay >= TOTAL_GROWTH_DAYS) {
      this.ready = true;
      return false;
    }
    const before = this.growthDay;
    this.setGrowthDay(before + 1, { fromCalendar: true });
    return this.growthDay > before;
  }

  setGrowthDay(day, { fromGrowth = false } = {}) {
    if (this.state === 'empty') return false;
    const bounded = THREE.MathUtils.clamp(
      Math.round(day),
      1,
      TOTAL_GROWTH_DAYS,
    );
    const previousStage = this.stage;
    this.growthDay = bounded;
    this.targetDay = bounded;
    this.stage = stageForDay(bounded).stage;
    this.ready = bounded >= TOTAL_GROWTH_DAYS;
    this.state = this.ready ? 'ready' : bounded === 1 ? 'seeded' : 'growing';
    if (this.ready) this.growing = false;
    this.refreshVisual();
    this.refreshInteraction();
    if (!fromGrowth) this.table?.refreshStock();
    return previousStage !== this.stage;
  }


  refreshVisual() {
    this.layer.setState({
      plan: this.plan,
      stage: this.stage,
      day: this.growthDay,
      cropName: this.cropName,
      detailed: this.detailed,
    });
    this.layer.setVisible(this.atTable);
  }

  refreshInteraction() {
    const label = this.stage > 0 ? stageForDay(this.growthDay).label : 'Not sown';
    const benchVariety = resolveCropVariety(
      this.table?.growth?.cropName ?? CROP_NAME,
    );
    if (this.state === 'empty') {
      this.info.interaction = 'nursery-seed-tray';
      this.info.interactionHint = `Plant ${benchVariety.label} seeds`;
      this.info.description =
        `An empty 550 x 280 mm, 320-cell propagation tray on the nursery bench. Tap to sow ${benchVariety.label}; germination is 100% and is generated once, then preserved as the tray grows. Hold to pick the empty tray up for staging or return.`;
    } else if (this.ready) {
      this.info.interaction = 'nursery-pickup-tray';
      this.info.interactionHint = 'Pick up transplant-ready tray';
      this.info.description =
        `Tray ${String(this.index + 1).padStart(2, '0')} carries ${this.germinated} ${this.cropName} plugs at Day ${this.growthDay}. The canopy is a dense, frilled coral rosette and is ready to carry to an NFT gully. Tap to pick up the tray.`;
    } else {
      this.info.interaction = 'inspect';
      this.info.interactionHint = `Inspect tray - Day ${this.growthDay}`;
      this.info.description =
        `${this.cropName} propagation tray at Day ${this.growthDay} of 14. ${this.germinated} cells have germinated and ${this.emptyCells} remain empty. The seedling canopy is at the ${label.toLowerCase()} stage. Tap to inspect the full tray record.`;
    }

    this.info.specs = [
      ['Crop', this.state === 'empty' ? benchVariety.label : this.cropName],
      ['Total cells', String(this.cells)],
      ['Germinated', this.state === 'empty' ? '0' : String(this.germinated)],
      ['Empty cells', this.state === 'empty' ? String(this.cells) : String(this.emptyCells)],
      ['Growth stage', this.state === 'empty' ? 'Not sown' : label],
      [
        'Growth day',
        this.state === 'empty' ? '0 / 14' : `${this.growthDay} / ${TOTAL_GROWTH_DAYS}`,
      ],
      ['Leaf count', this.state === 'empty' ? '0' : String(this.leafCount)],
      [
        'Canopy / height',
        this.state === 'empty'
          ? '-'
          : `${(this.canopySpread * 1000).toFixed(1)} / ${(this.plantHeight * 1000).toFixed(1)} mm`,
      ],
      ['Status', this.statusLabel],
    ];
    this.info.ready = this.ready;
    this.info.state = this.state;
    this.info.growthDay = this.growthDay;
    this.info.leafCount = this.leafCount;
    this.info.canopySpread = this.canopySpread;
    this.info.plantHeight = this.plantHeight;
  }

  setViewerDistance(distance) {
    const detailed = distance < 5.2;
    if (this.detailed === detailed) return;
    this.detailed = detailed;
    this.layer.setDetail(detailed);
  }

  pickUp() {
    if (!this.canPickUp) {
      return {
        ok: false,
        reason:
          this.state === 'empty'
            ? 'Tray is not on the bench'
            : this.ready
              ? 'Tray is not on the bench'
              : 'Only transplant-ready trays can be carried',
      };
    }
    this.atTable = false;
    this.growing = false;
    this.hitProxy.visible = false;
    this.layer.setVisible(false);
    this.table?.setTrayShellVisible(this.index, false);
    this.table?.refreshStock();
    return { ok: true, tray: this };
  }

  returnHome({ clearCrop = false } = {}) {
    if (clearCrop) this.clearCrop();
    this.atTable = true;
    this.hitProxy.visible = true;
    this.layer.group.position.set(this.home.x, this.topY + 0.001, this.home.z);
    this.refreshVisual();
    this.layer.setVisible(true);
    this.table?.setTrayShellVisible(this.index, true);
    this.table?.refreshStock();
    return this;
  }

  /** Serializable growth record; the germination plan is recreated by seed. */
  snapshotGrowth() {
    return {
      id: this.id,
      index: this.index,
      state: this.state,
      cropName: this.cropName,
      plantedDay: this.plantedDay,
      plantedCalendarDay: this.plantedCalendarDay,
      lastGrowthCalendarDay: this.lastGrowthCalendarDay,
      growthDay: this.growthDay,
      cycle: this.cycle,
      planSeed: this.planSeed,
      germinated: this.germinated,
      emptyCells: this.emptyCells,
      ready: this.ready,
      atTable: this.atTable,
      leafCount: this.leafCount,
      plantHeight: this.plantHeight,
      canopySpread: this.canopySpread,
      status: this.statusLabel,
      growthStatus: this.growthStatus,
    };
  }

  restoreGrowth(state = {}) {
    if (!state || state.state === 'empty' || !Number.isFinite(state.planSeed)) {
      this.clearCrop();
      this.cycle = Math.max(this.cycle, Number(state?.cycle) || 0);
      return false;
    }
    this.cycle = Math.max(0, Number(state.cycle) || 0);
    this.planSeed = state.planSeed;
    this.plan = createTrayPlan({
      seed: state.planSeed,
      cells: this.cells,
      width: this.width,
      length: this.length,
    });
    this.state = state.state ?? 'growing';
    this.cropName = state.cropName ?? CROP_NAME;
    this.plantedDay = Number.isFinite(state.plantedDay) ? state.plantedDay : 1;
    this.plantedCalendarDay = Number.isFinite(state.plantedCalendarDay)
      ? state.plantedCalendarDay
      : null;
    this.lastGrowthCalendarDay = Number.isFinite(state.lastGrowthCalendarDay)
      ? state.lastGrowthCalendarDay
      : this.plantedCalendarDay;
    this.growthDay = THREE.MathUtils.clamp(
      Number(state.growthDay) || 1,
      1,
      TOTAL_GROWTH_DAYS,
    );
    this.targetDay = this.growthDay;
    this.germinated = this.plan.germinated;
    this.emptyCells = this.plan.empty;
    this.stage = stageForDay(this.growthDay).stage;
    this.ready = this.growthDay >= TOTAL_GROWTH_DAYS;
    this.growing = false;
    this.atTable = state.atTable !== false;
    if (!this.atTable) this.returnHome();
    this.refreshVisual();
    this.refreshInteraction();
    this.table?.refreshStock();
    return true;
  }

  clearCrop() {
    this.state = 'empty';
    this.plantedDay = null;
    this.plantedCalendarDay = null;
    this.lastGrowthCalendarDay = null;
    this.growthDay = 0;
    this.germinated = 0;
    this.emptyCells = this.cells;
    this.plan = null;
    this.planSeed = null;
    this.cropName = CROP_NAME;
    this.stage = 0;
    this.ready = false;
    this.growing = false;
    this.targetDay = 1;
    this.growthElapsed = 0;
    this.layer.setState({ plan: null, stage: 0, day: 0, detailed: this.detailed });
    this.refreshInteraction();
    return this;
  }

  get scaleForCurrentDay() {
    return this.stage > 0 ? growthScaleForDay(this.stage, this.growthDay) : 1;
  }

  dispose() {
    this.layer.dispose();
    this.hitProxy.removeFromParent();
    this.hitProxy.geometry?.dispose();
    this.hitProxy = null;
    this.info = null;
    this.table = null;
  }
}


/**
 * Lightweight individual tray shell used while the tray is in the player's
 * hands. It shares the same tray data and plant layer; it is a representation,
 * never a duplicate tray record.
 */
export class SeedlingTrayView {
  constructor({ materials, tray }) {
    this.tray = tray;
    this.group = new THREE.Group();
    this.group.name = `${tray.id}-carried`;
    this.baseGeometry = new THREE.BoxGeometry(
      tray.width - 0.004,
      tray.height,
      tray.length - 0.004,
    );
    this.cellGeometry = new THREE.PlaneGeometry(
      tray.width - 0.01,
      tray.length - 0.01,
    );
    const base = new THREE.Mesh(this.baseGeometry, materials.nurseryFloodTray);
    base.position.y = tray.height / 2;
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);

    const cells = new THREE.Mesh(this.cellGeometry, materials.nurseryTrayCells);
    cells.rotation.x = -Math.PI / 2;
    cells.position.y = tray.height + 0.001;
    cells.receiveShadow = true;
    this.group.add(cells);

    this.layer = new SeedlingPlantLayer({ materials, parent: this.group });
    this.layer.group.position.y = tray.height + 0.001;
    this.lastDay = tray.growthDay;
    this.layer.setState({
      plan: tray.plan,
      stage: tray.stage,
      day: tray.growthDay,
      cropName: tray.cropName,
      detailed: true,
    });
  }

  /** Keep a carried tray's canopy in sync if the calendar advances mid-carry. */
  update(dt) {
    if (this.lastDay !== this.tray.growthDay) {
      this.lastDay = this.tray.growthDay;
      this.layer.setState({
        plan: this.tray.plan,
        stage: this.tray.stage,
        day: this.tray.growthDay,
        cropName: this.tray.cropName,
        detailed: true,
      });
    }
    this.layer.update(dt);
  }

  dispose() {
    this.layer.dispose();
    this.group.removeFromParent();
    this.baseGeometry.dispose();
    this.cellGeometry.dispose();
  }
}

