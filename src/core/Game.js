import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { getPreset } from './Quality.js';
import { MaterialLibrary } from '../world/MaterialLibrary.js';
import { Environment } from '../world/Environment.js';
import { Greenhouse } from '../world/Greenhouse.js';
import { NurseryGreenhouse } from '../world/NurseryGreenhouse.js';
import { Equipment } from '../world/Equipment.js';
import { CollisionWorld } from '../player/CollisionWorld.js';
import { FirstPersonController } from '../player/FirstPersonController.js';
import { DroneController } from '../player/DroneController.js';
import { InteractionSystem } from '../interaction/InteractionSystem.js';
import { GameUI } from '../ui/GameUI.js';
import { PlantSimulation } from '../simulation/PlantSimulation.js';
import { WaterNutrientSimulation } from '../simulation/WaterNutrientSimulation.js';
import { GreenhouseClimate } from '../simulation/GreenhouseClimate.js';
import { GreenhouseControlSystem } from '../systems/GreenhouseControlSystem.js';
import { TrayPickupController } from '../systems/TrayPickupController.js';
import { SeedlingTransplantController } from '../systems/SeedlingTransplantController.js';
import { WaterStorage } from '../world/WaterStorage.js';
import { BluelabController } from '../world/BluelabController.js';
import { IrrigationPanel } from '../world/IrrigationPanel.js';
import { WeatherControlPanel } from '../world/WeatherControlPanel.js';
import { SaveSystem } from '../save/SaveSystem.js';

const SETTINGS_KEY = 'verde-block4:settings';

/**
 * Application shell.
 * Owns the renderer, scene graph, player, UI and the frame loop, and wires the
 * quality presets to the world systems. World content is built in stages so the
 * boot screen can report progress while the procedural textures bake.
 */
export class Game {
  constructor({ container = document.getElementById('viewport') } = {}) {
    this.container = container;
    this.clock = new THREE.Clock();
    this.started = false;
    this.paused = false;
    this.inspecting = false;
    this.running = false;
    this.pointerLockWarned = false;
    this.droneView = false;

    this.fpsAccumulator = 0;
    this.fpsFrames = 0;
    this.fps = 60;
    this.report = () => {};
    this.lastGrowthDayIndex = null;
    this.saveAccumulator = 0;

    this.settings = this.loadSettings();
    this.preset = getPreset(this.settings.quality);

    this.onPointerLockChange = this.onPointerLockChange.bind(this);
    this.onPointerLockError = this.onPointerLockError.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onBeforeUnload = this.onBeforeUnload.bind(this);
    this.animate = this.animate.bind(this);
  }

  async init(onProgress = () => {}) {
    this.report = onProgress;

    this.report(0.04, 'Starting renderer…');
    await this.nextTick();
    this.setupRenderer();

    this.report(0.12, 'Baking procedural materials…');
    await this.nextTick();
    this.materials = new MaterialLibrary(this.renderer);
    this.materials.applyAnisotropy(this.preset.anisotropy);
    this.collisionWorld = new CollisionWorld();
    this.control = new GreenhouseControlSystem({ bayCount: 6 });

    this.report(0.28, 'Building sky, sun and site…');
    await this.nextTick();
    this.environment = new Environment({
      scene: this.scene,
      renderer: this.renderer,
      materials: this.materials,
      preset: this.preset,
    }).build();

    this.report(0.5, 'Erecting glasshouse structure…');
    await this.nextTick();
    this.greenhouse = new Greenhouse({
      scene: this.scene,
      materials: this.materials,
      collisionWorld: this.collisionWorld,
      preset: this.preset,
      control: this.control,
    }).build();
    this.greenhouse.setDetailVisible(this.preset.showDetail);

    // Separate propagation house beside the main glasshouse. Same construction
    // language, half the previous plan size, with a complete ebb-and-flow bench,
    // sticky traps and retractable shade screen inside.
    this.nursery = new NurseryGreenhouse({
      scene: this.scene,
      materials: this.materials,
      collisionWorld: this.collisionWorld,
      preset: this.preset,
      control: this.control,
    }).build();
    this.nursery.setDetailVisible(this.preset.showDetail);

    this.report(0.72, 'Installing NFT tables and hydraulics…');
    await this.nextTick();
    this.climate = new GreenhouseClimate({ startHour: 10.7 });
    this.equipment = new Equipment({
      scene: this.scene,
      materials: this.materials,
      collisionWorld: this.collisionWorld,
      climate: this.climate,
      control: this.control,
    }).build();

    this.storage = new WaterStorage({
      materials: this.materials,
      control: this.control,
      collisionWorld: this.collisionWorld,
    }).build(this.scene);
    this.bluelab = new BluelabController({
      materials: this.materials,
      control: this.control,
    }).build(this.scene);
    this.irrigationPanel = new IrrigationPanel({
      materials: this.materials,
      control: this.control,
    }).build(this.scene);
    this.weatherPanel = new WeatherControlPanel({
      materials: this.materials,
      climate: this.climate,
    }).build(this.scene);
    this.collisionWorld.addBox({
      x: LAYOUT.bluelab.position[0],
      z: LAYOUT.bluelab.position[1],
      width: 0.72,
      depth: 1.18,
      label: 'Bluelab controller',
    });
    this.collisionWorld.addBox({
      x: LAYOUT.irrigationPanel.position[0],
      z: LAYOUT.irrigationPanel.position[1],
      width: 0.98,
      depth: 0.58,
      label: 'main irrigation panel',
    });
    this.collisionWorld.addBox({
      x: LAYOUT.weatherPanel.position[0],
      z: LAYOUT.weatherPanel.position[1],
      width: 0.82,
      depth: 0.44,
      label: 'weather control panel',
    });

    this.report(0.86, 'Calibrating sensors and player…');
    await this.nextTick();
    this.player = new FirstPersonController({
      camera: this.camera,
      domElement: this.renderer.domElement,
      collisionWorld: this.collisionWorld,
    });
    this.player.setSensitivity(this.settings.sensitivity);

    this.drone = new DroneController({
      camera: this.droneCamera,
      domElement: this.renderer.domElement,
    });

    this.interaction = new InteractionSystem({
      camera: this.camera,
      scene: this.scene,
      interactables: [
        ...this.greenhouse.getInteractables(),
        ...this.nursery.getInteractables(),
        ...this.equipment.getInteractables(),
        ...this.storage.interactables,
        ...this.bluelab.interactables,
        ...this.irrigationPanel.interactables,
        ...this.weatherPanel.interactables,
      ],
    });

    this.ui = new GameUI({
      handlers: {
        onResume: () => this.resume(),
        onPause: () => this.pause(),
        onRespawn: () => this.respawn(),
        onQualityChange: (id) => this.applyQuality(id),
        onSensitivityChange: (value) => {
          this.player.setSensitivity(value);
          this.settings.sensitivity = value;
          this.saveSettings();
        },
        onFovChange: (value) => {
          this.setFov(value);
          this.settings.fov = value;
          this.saveSettings();
        },
        onSkipTime: () => this.skipTime(24),
        onCycleWeather: () => this.cycleWeather(),
        onCloseInspect: () => this.closeInspect(),
      },
    });
    this.ui.setSettings({
      quality: this.preset.id,
      sensitivity: this.settings.sensitivity,
      fov: this.settings.fov,
    });
    this.setFov(this.settings.fov);

    this.report(0.94, 'Waking simulations…');
    await this.nextTick();
    this.plants = new PlantSimulation({ equipment: this.equipment, layout: LAYOUT });
    this.equipment.setPlantSimulation(this.plants);
    this.trayPickup = new TrayPickupController({
      scene: this.scene,
      camera: this.camera,
      nursery: this.nursery,
      materials: this.materials,
    });
    this.transplant = new SeedlingTransplantController({
      simulation: this.plants,
      equipment: this.equipment,
      nursery: this.nursery,
      pickup: this.trayPickup,
    });
    this.water = new WaterNutrientSimulation({
      equipment: this.equipment,
      layout: LAYOUT,
      control: this.control,
      climate: this.climate,
      plants: this.plants,
    });
    this.saveSystem = new SaveSystem({ key: 'verde-block4:save' });
    this.restoreSession();

    this.report(1, 'Ready');
    await this.nextTick();

    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    this.onResize();
    this.running = true;
    this.clock.start();
    this.animate();
    return this;
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.preset.maxPixelRatio));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.58;
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.tabIndex = 0;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.name = 'greenhouse-scene';

    const { clientWidth, clientHeight } = this.container;
    this.camera = new THREE.PerspectiveCamera(
      this.settings.fov,
      clientWidth / Math.max(1, clientHeight),
      0.06,
      240,
    );
    this.camera.name = 'player-camera';

    // Drone inspection camera stays independent of the walkthrough camera so
    // entering and leaving drone view never disturbs the first-person pose.
    this.droneCamera = new THREE.PerspectiveCamera(
      this.settings.fov,
      clientWidth / Math.max(1, clientHeight),
      0.06,
      240,
    );
    this.droneCamera.name = 'drone-camera';
  }

  nextTick() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    if (this.droneCamera) {
      this.droneCamera.fov = fov;
      this.droneCamera.updateProjectionMatrix();
    }
  }

  /* ---------------------------------------------------------------- lifecycle */

  /** Called from the boot screen button, inside a user gesture (pointer lock). */
  start() {
    this.started = true;
    this.ui.showHud();
    this.ui.setTarget(null);
    this.player.setEnabled(true);
    this.player.syncCamera();
    this.player.requestPointerLock();
    this.interaction.setEnabled(true);
    this.interaction.setLockState(true);
    this.clock.getDelta();
    this.ui.toast('Walkthrough ready — E opens doors, operates equipment and inspects units');
  }

  pause() {
    if (!this.started || this.paused) return;
    this.paused = true;
    this.saveGame();
    // Drone mode survives the pause; only flight input is suspended.
    this.drone?.deactivate();
    // Drop out of inspect first so the panel state cannot outlive the pause.
    this.inspecting = false;
    this.ui.closeInspect();
    this.player.setEnabled(false);
    this.player.exitPointerLock();
    this.interaction.setEnabled(false);
    this.ui.setPaused(true);
  }

  resume() {
    if (!this.started) return;
    this.paused = false;
    this.inspecting = false;
    this.ui.setPaused(false);
    if (this.droneView) {
      this.drone.activate({ reset: false });
      this.player.setEnabled(false);
      this.interaction.setEnabled(false);
    } else {
      this.player.setEnabled(true);
      this.player.requestPointerLock();
      this.interaction.setEnabled(true);
    }
    this.clock.getDelta();
  }

  respawn() {
    if (this.droneView) this.exitDroneView({ silent: true });
    this.player.teleport(LAYOUT.player.spawnX, LAYOUT.player.spawnZ, LAYOUT.player.spawnYaw);
    this.ui.toast('Returned to the entrance');
    if (this.paused) this.resume();
  }

  openInspect(data) {
    this.inspecting = true;
    this.player.setEnabled(false);
    this.interaction.setEnabled(false);
    this.ui.openInspect(data);
    this.ui.setTarget(null);
  }

  closeInspect() {
    if (!this.inspecting) return;
    this.inspecting = false;
    this.ui.closeInspect();
    if (!this.paused) {
      this.player.setEnabled(true);
      this.interaction.setEnabled(true);
    }
  }

  /**
   * While carrying, the same aimed object gets a contextual action: the nursery
   * bench accepts the tray back, and an NFT table offers transplantation with a
   * live capacity check. Nothing else is repurposed.
   */
  decorateCarryTarget(target) {
    if (!target || !this.trayPickup?.isCarrying) return target;
    const data = target.data;
    if (!data) return target;
    const bedId = this.nursery.tidalBed?.bed.id;
    const isBench = data.trayId || data.id === bedId;
    if (isBench && data.buildingId === LAYOUT.nursery.id) {
      return {
        ...target,
        data: {
          ...data,
          title: 'Nursery propagation bench',
          interaction: 'nursery-place-tray',
          interactionHint: 'Place tray on the nursery bench',
        },
      };
    }

    if (data.kind === 'nft-table') {
      const tray = this.trayPickup.carried;
      const capacity = this.transplant.canTransplant(data.nftTableId);
      const hint = !tray.ready
        ? `Transplant-ready tray required (Day ${tray.growthDay}/14)`
        : capacity.ok
          ? `Transplant ${tray.germinated} seedlings (${capacity.free} holes free)`
          : `No capacity - ${tray.germinated} needed, ${capacity.free} free`;
      return {
        ...target,
        data: {
          ...data,
          title: `${data.title} - Green Coral transplant`,
          interaction: 'nursery-transplant',
          interactionHint: hint,
          carryTrayId: tray.id,
        },
      };
    }
    return target;
  }

  /**
   * Central dispatch for every Version 4 interaction. Returns true when the
   * action was handled, so E never falls through to the generic inspect panel.
   */
  handleInteraction(data, options = {}) {
    if (!data) return false;
    switch (data.interaction) {
      case 'inspect-crop': {
        this.openInspect(data);
        return true;
      }
      case 'harvest-crop': {
        if (options.shiftKey) {
          this.openInspect(data);
          return true;
        }
        const result = this.plants.harvestPlant(data.tableId, data.plantId);
        if (result.ok) {
          const total = this.plants.harvestStats.totalHarvestWeightG;
          this.ui.toast(
            `${result.cropName} harvested - ${result.weightG.toFixed(0)} g head · ${this.plants.harvestStats.harvestedPlants} heads / ${total.toFixed(0)} g total`,
          );
          if (this.inspecting) this.closeInspect();
        } else {
          this.ui.toast(result.reason ?? 'Crop is not ready to harvest', 'warn');
          this.openInspect(data);
        }
        return true;
      }
      case 'nursery-seed-tray': {
        const result = this.nursery.seedTray(data.trayId, {
          calendarDay: this.climate.dayIndex,
        });
        if (result.ok) {
          this.ui.toast(
            `${data.title}: Green Coral sown - ${result.germinated}/320 germinated, Day 1`,
          );
        } else {
          this.ui.toast(result.reason ?? 'Tray could not be seeded', 'warn');
        }
        return true;
      }
      case 'nursery-pickup-tray': {
        const result = this.trayPickup.pickUp(data.trayId);
        if (result.ok) {
          this.ui.setCarry(result.tray);
          this.ui.setTarget(null);
          this.ui.toast(
            `Carrying Tray ${String(result.tray.index + 1).padStart(2, '0')} - ${result.tray.germinated} transplant-ready plugs`,
          );
        } else {
          this.ui.toast(result.reason ?? 'Tray could not be picked up', 'warn');
        }
        return true;
      }
      case 'nursery-seed-all': {
        const result = this.nursery.seedAllEmpty({ calendarDay: this.climate.dayIndex });
        this.ui.toast(
          result.seeded > 0
            ? `Seeded ${result.seeded} trays with ${result.germinated.toLocaleString('en-GB')} Green Coral cells`
            : 'No empty trays to sow',
          result.seeded > 0 ? 'info' : 'warn',
        );
        return true;
      }
      case 'nursery-grow-all': {
        const result = this.nursery.growAll();
        this.ui.toast(
          result.growing > 0
            ? `GROW: ${result.growing} planted trays advancing Day 1 to Day 14 (empty trays untouched)`
            : 'GROW skipped - no planted trays below Day 14',
          result.growing > 0 ? 'info' : 'warn',
        );
        return true;
      }
      case 'nursery-place-tray': {
        const result = this.trayPickup.placeOnNursery();
        if (result.ok) {
          this.ui.setCarry(null);
          this.ui.toast(
            `Tray ${String(result.tray.index + 1).padStart(2, '0')} set down on the nursery bench`,
          );
        } else {
          this.ui.toast(result.reason ?? 'Tray could not be placed', 'warn');
        }
        return true;
      }
      case 'nursery-transplant': {
        const result = this.transplant.transplant(data.nftTableId);
        if (result.ok) {
          this.ui.setCarry(null);
          this.ui.setTarget(null);
          this.ui.toast(
            `${result.planted} Green Coral seedlings transplanted to ${result.tableTitle} - tray returned for reuse`,
          );
        } else {
          this.ui.toast(result.reason ?? 'Transplant rejected', 'warn');
        }
        return true;
      }
      case 'toggle-entrance': {
        const isNursery = data.buildingId === LAYOUT.nursery.id;
        const building = isNursery ? this.nursery : this.greenhouse;
        const open = building.toggleEntranceDoors();
        this.ui.toast(
          `${isNursery ? 'Nursery' : 'Main'} entrance ${open ? 'opening' : 'closing'}`,
        );
        return true;
      }
      case 'nursery-start-cycle': {
        const result = this.nursery.startTidalCycle();
        if (result.started) {
          this.ui.toast('Nursery ebb & flow: flooding started');
        } else {
          this.ui.toast(`Nursery bed busy - ${result.label ?? result.stage}`);
        }
        return true;
      }
      case 'nursery-toggle-shade': {
        const extended = this.nursery.toggleShade();
        this.ui.toast(`Nursery shade screen ${extended ? 'extending' : 'retracting'}`);
        return true;
      }
      case 'toggle-cabinet': {
        const open = this.equipment.toggleCabinetDoor();
        this.ui.toast(
          open
            ? 'Climate cabinet open — 24 bay switches live'
            : 'Climate cabinet closed and latched',
        );
        return true;
      }
      case 'toggle-bay-device': {
        if (this.control.isBayDeviceLocked(data.bayId, data.deviceKey)) {
          const remaining = this.control.bayDeviceLockRemaining(data.bayId, data.deviceKey);
          this.ui.toast(
            `Bay ${data.bayId} ${data.deviceLabel?.toLowerCase() ?? 'actuator'} still travelling (${remaining.toFixed(1)} s)`,
            'warn',
          );
          return true;
        }
        const on = this.control.toggleBayDevice(data.bayId, data.deviceKey, {
          lockMs: data.lockMs ?? 0,
        });
        data.state = on;
        data.specs[2][1] = on ? 'ON' : 'OFF';
        this.ui.toast(`Bay ${data.bayId} ${data.deviceLabel ?? ''}: ${on ? 'ON' : 'OFF'}`);
        return true;
      }
      case 'toggle-fan-bay': {
        if (this.control.isBayDeviceLocked(data.bayId, 'fansOn')) {
          this.ui.toast(`HAF fans bay ${data.bayId} are still spinning up`, 'warn');
          return true;
        }
        const enabled = this.control.toggleBayDevice(data.bayId, 'fansOn', { lockMs: 500 });
        this.ui.toast(`HAF fans bay ${data.bayId}: ${enabled ? 'running' : 'stopped'}`);
        return true;
      }
      case 'toggle-table-valve': {
        const open = this.equipment.hydraulicNetwork?.toggleTableValve(data.tableId) ?? false;
        this.ui.toast(`${data.title}: ${open ? 'open' : 'isolated'}`);
        this.bluelab.hmiAccumulator = 1;
        this.irrigationPanel.hmiAccumulator = 1;
        return true;
      }
      case 'toggle-selector': {
        const open = this.bluelab.toggleSelector(data.selectorIndex);
        this.ui.toast(`Table selector ${data.selectorIndex + 1}: ${open ? 'open' : 'closed'}`);
        return true;
      }
      case 'toggle-storage-valve': {
        const open = this.control.toggleStorageValve(data.tankId);
        data.interactionHint = open ? 'Close valve' : 'Open valve';
        this.ui.toast(`${data.title}: ${open ? 'open' : 'closed'}`);
        return true;
      }
      case 'toggle-rain-transfer': {
        const on = this.control.togglePump('rainwaterTransferOn');
        this.irrigationPanel.hmiAccumulator = 1;
        this.ui.toast(`Rain transfer pump: ${on ? 'running' : 'stopped'}`);
        return true;
      }
      case 'toggle-pump': {
        if (!data.pumpKey) return false;
        const on = this.control.togglePump(data.pumpKey);
        this.irrigationPanel.hmiAccumulator = 1;
        this.bluelab.hmiAccumulator = 1;
        this.ui.toast(`${data.title ?? 'Pump switch'}: ${on ? 'ON' : 'OFF'}`);
        return true;
      }
      case 'cycle-weather': {
        this.cycleWeather();
        return true;
      }
      case 'set-weather': {
        if (!data.weatherId) return false;
        const state = this.climate.setWeather(data.weatherId, { manual: true });
        const label = LAYOUT.weather?.states?.[state]?.label ?? state;
        this.weatherPanel.hmiAccumulator = 1;
        this.ui.toast(`Weather held at ${label}`);
        return true;
      }
      case 'toggle-weather-auto': {
        if (this.climate.weatherManual) {
          const state = this.climate.setWeatherAuto();
          const label = LAYOUT.weather?.states?.[state]?.label ?? state;
          this.ui.toast(`AUTO weather resumed: ${label}`);
        } else {
          this.ui.toast('AUTO weather schedule already running');
        }
        this.weatherPanel.hmiAccumulator = 1;
        return true;
      }
      case 'toggle-dosing': {
        const enabled = this.bluelab.toggleDosing(data.dosingKey);
        const labels = { a: 'Nutrient A', b: 'Nutrient B', c: 'pH Down' };
        this.ui.toast(`${labels[data.dosingKey] ?? 'Dosing'} pump: ${enabled ? 'running' : 'paused'}`);
        return true;
      }
      case 'cycle-tank': {
        this.bluelab.cycleTank();
        const tank = this.water.selectedTank;
        this.ui.toast(`Monitoring ${tank?.name ?? 'Reservoir 1'} · press E to cycle`);
        return true;
      }
      case 'inspect-trap': {
        const trapSystem =
          data.buildingId === LAYOUT.nursery.id ? this.nursery.stickyTraps : this.greenhouse.stickyTraps;
        trapSystem?.inspect(data.trapIndex);
        this.openInspect(data);
        return true;
      }
      case 'inspect':
      default:
        return false;
    }
  }

  /**
   * One calendar authority for every living crop. The climate day index is
   * compared with the last processed day, so a frame update and a developer
   * clock jump can never grow the same plant twice.
   */
  applyCalendarGrowth() {
    const targetDay = this.climate?.dayIndex ?? 0;
    if (this.lastGrowthDayIndex === null) {
      this.lastGrowthDayIndex = targetDay;
      return { days: 0, nursery: { advanced: 0 }, plants: { advanced: 0 } };
    }
    let days = 0;
    let nursery = { advanced: 0, skippedEmpty: 0, ready: 0 };
    let plants = { advanced: 0 };
    while (this.lastGrowthDayIndex < targetDay) {
      this.lastGrowthDayIndex += 1;
      const nurseryResult = this.nursery?.advanceDay?.(this.lastGrowthDayIndex);
      const plantResult = this.plants?.advanceDay?.(this.lastGrowthDayIndex);
      if (nurseryResult) {
        nursery = {
          advanced: nursery.advanced + (nurseryResult.advanced ?? 0),
          skippedEmpty: nurseryResult.skippedEmpty ?? 0,
          ready: nurseryResult.ready ?? 0,
        };
      }
      if (plantResult) {
        plants = {
          advanced: plants.advanced + (plantResult.advanced ?? 0),
        };
      }
      days += 1;
    }
    return { days, nursery, plants };
  }

  /** Restore the automatic save once all simulations and physical systems exist. */
  restoreSession() {
    this.lastGrowthDayIndex = this.climate?.dayIndex ?? 0;
    const saved = this.saveSystem?.load();
    if (!saved) return false;
    try {
      if (saved.climate) this.climate.restore(saved.climate);
      if (saved.control) this.control.apply(saved.control);
      if (saved.water) this.water.applyState(saved.water);
      if (saved.plants?.growth) this.plants.restoreGrowth(saved.plants.growth);
      if (saved.nursery) this.nursery.restoreGrowth(saved.nursery);
      if (saved.player && this.player) {
        this.player.teleport(saved.player.x, saved.player.z, saved.player.yaw);
        this.player.pitch = saved.player.pitch ?? this.player.pitch;
        this.player.syncCamera();
      }
      this.lastGrowthDayIndex = this.climate.dayIndex;
      this.equipment.updateCrops(0, null);
      return true;
    } catch (error) {
      console.warn('[Verde Block 4] Save could not be restored', error);
      return false;
    }
  }

  saveGame() {
    if (!this.saveSystem || !this.climate) return null;
    return this.saveSystem.save({
      player: this.player,
      settings: this.settings,
      plants: this.plants,
      water: this.water,
      climate: this.climate,
      control: this.control,
      nursery: this.nursery,
    });
  }

  onBeforeUnload() {
    this.saveGame();
  }

  /**
   * Shared by the physical selector and the on-screen developer weather button.
   * A manual hold makes the selected outlook deterministic until AUTO resumes.
   */
  cycleWeather() {
    const state = this.climate.cycleWeather();
    const label = LAYOUT.weather?.states?.[state]?.label ?? state;
    if (this.weatherPanel) this.weatherPanel.hmiAccumulator = 1;
    this.ui.setClimate(this.climate.snapshot());
    this.ui.toast(`Weather: ${label} (manual hold)`);
    return state;
  }

  /**
   * Developer clock jump. Climate is advanced through its normal update path so
   * the date, sun, DLI and automatic weather schedule all stay in sync.
   */
  skipTime(hours = 24) {
    const snapshot = this.climate.skipGameHours(hours);
    const growth = this.applyCalendarGrowth();
    this.environment?.update(0, this.climate);
    if (this.weatherPanel) this.weatherPanel.hmiAccumulator = 1;
    this.ui.setClimate(snapshot);
    const growthNote =
      growth.days > 0
        ? ` \u00b7 ${growth.nursery.advanced} trays + ${growth.plants.advanced} crops grew`
        : '';
    this.ui.toast(`DEV clock +${hours} h - ${snapshot.dayLabel} \u00b7 ${snapshot.clock}${growthNote}`);
    this.saveGame();
    return snapshot;
  }

  /**
   * Free-flying drone view. A dedicated camera is flown with WASD/QE and the
   * walkthrough pose is left untouched, so landing returns exactly where the
   * player was standing.
   */
  enterDroneView() {
    if (!this.started || this.inspecting || this.droneView) return;
    if (this.trayPickup?.isCarrying) {
      this.ui.toast('Set the seedling tray down before entering drone view', 'warn');
      return;
    }
    this.droneView = true;
    this.ui.setTarget(null);
    this.player.setEnabled(false);
    this.player.exitPointerLock();
    this.interaction.setEnabled(false);
    this.drone.activate();
    this.setCutaway(true);
    this.ui.toast(
      'Drone view — WASD fly · arrows orbit 360° · Q/E altitude · Shift boost · V to land',
    );
    return this;
  }

  exitDroneView({ silent = false } = {}) {
    if (!this.droneView) return;
    this.droneView = false;
    this.drone.deactivate();
    this.setCutaway(false);
    this.player.syncCamera();
    this.ui.setTarget(null);
    if (!this.paused) {
      this.player.setEnabled(true);
      this.interaction.setEnabled(true);
      this.player.requestPointerLock();
    }
    if (!silent) this.ui.toast('Walkthrough view');
  }

  toggleDroneView() {
    if (this.droneView) this.exitDroneView();
    else this.enterDroneView();
  }

  /**
   * Drone view doubles as the cutaway inspection: the floor slab, overhead
   * screens and yard shell are hidden so the buried water store and equipment
   * layout stay readable from above. Restored when the drone lands.
   */
  setCutaway(active) {
    this.environment?.setTopView(active);
    this.greenhouse?.setTopView(active);
    this.nursery?.setTopView(active);
    this.storage?.setTopView(active);
    this.equipment?.hydraulicNetwork?.setTopView(active);
    this.bluelab?.setTopView(active);
    this.irrigationPanel?.setTopView(active);
    this.weatherPanel?.setTopView(active);
  }

  /* ------------------------------------------------------------------- events */

  onPointerLockChange() {
    const locked = this.player.isPointerLocked();
    this.interaction.setLockState(locked);
    if (!locked && this.started && !this.ui.isModalOpen() && !this.droneView) {
      this.pause();
    }
  }

  /**
   * The browser refused mouse capture. The walkthrough stays playable: the camera
   * falls back to click-drag look, so keep the centre-screen raycast running.
   */
  onPointerLockError() {
    if (this.started && !this.pointerLockWarned) {
      this.pointerLockWarned = true;
      this.interaction.setLockState(true);
      this.ui.toast('Mouse capture blocked — click and drag the view to look around', 'warn');
    }
  }

  onKeyDown(event) {
    if (!this.started) return;

    if (event.code === 'KeyV' && !this.ui.isModalOpen()) {
      event.preventDefault();
      this.toggleDroneView();
      return;
    }

    // Developer controls work in both walkthrough and drone views. Ignore key
    // repeat so holding T cannot skip several days in one key stroke.
    if (!event.repeat && !this.ui.isModalOpen()) {
      if (event.code === 'KeyT') {
        event.preventDefault();
        this.skipTime(24);
        return;
      }
      if (event.code === 'KeyC') {
        event.preventDefault();
        this.cycleWeather();
        return;
      }
    }

    // While flying, the drone controller owns WASD/QE/Shift; only pause keys
    // are handled here so flight cannot trigger world interactions.
    if (this.droneView) {
      if (event.code === 'Escape' && !this.ui.settingsOpen && !this.paused) {
        this.pause();
      }
      return;
    }

    if (event.code === 'Tab' && !this.ui.isModalOpen() && !this.inspecting) {
      event.preventDefault();
      this.bluelab.cycleTank();
      const tank = this.water.selectedTank;
      this.ui.toast(`Monitoring ${tank?.name ?? 'Reservoir 1'} · Tab cycles reservoirs`);
      return;
    }

    if (event.code === 'KeyE' && !this.ui.isModalOpen()) {
      event.preventDefault();
      if (this.inspecting) {
        this.closeInspect();
        return;
      }
      const target = this.interaction.target;
      const emptyPickup =
        event.shiftKey && target?.data?.interaction === 'nursery-seed-tray'
          ? this.trayPickup?.pickUp(target.data.trayId)
          : null;
      if (emptyPickup?.ok) {
        const tray = this.trayPickup.carried;
        this.ui.setCarry(tray);
        this.ui.setTarget(null);
        this.ui.toast(
          `Carrying empty Tray ${String(tray.index + 1).padStart(2, '0')} - set it back on the bench to replant`,
        );
        return;
      }
      const actionTarget = this.decorateCarryTarget(target);
      if (
        actionTarget &&
        this.handleInteraction(actionTarget.data, { shiftKey: event.shiftKey })
      ) {
        this.ui.setTarget(actionTarget);
        return;
      }
      if (target) this.openInspect(target.data);
      else if (this.trayPickup?.isCarrying) {
        this.ui.toast(
          'Carrying a tray - aim at the nursery bench to set it down, or at an NFT table to transplant',
          'warn',
        );
      } else {
        this.ui.toast('Nothing within reach - move closer and aim at a unit', 'warn');
      }
      return;
    }

    if (event.code === 'Escape') {
      if (this.ui.settingsOpen) this.ui.closeSettings();
      else if (this.inspecting) this.closeInspect();
      // Without pointer lock the browser will not exit anything for us, so Esc
      // has to open the pause menu itself or it would be a dead key.
      else if (!this.paused && !this.player.isPointerLocked()) this.pause();
    }
  }

  onResize() {
    if (!this.renderer) return;
    const width = this.container.clientWidth;
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.preset.maxPixelRatio),
    );
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.droneCamera) {
      this.droneCamera.aspect = width / height;
      this.droneCamera.updateProjectionMatrix();
    }
  }

  applyQuality(id) {
    this.preset = getPreset(id);
    this.settings.quality = this.preset.id;
    this.saveSettings();

    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.preset.maxPixelRatio),
    );
    this.onResize();
    this.materials.applyAnisotropy(this.preset.anisotropy);
    this.environment.applyQuality(this.preset);
    this.greenhouse.setDetailVisible(this.preset.showDetail);
    this.nursery.setDetailVisible(this.preset.showDetail);
    this.ui.setQuality(this.preset.id);
    this.ui.toast(`Quality preset: ${this.preset.label}`);
  }

  /* --------------------------------------------------------------- persistence */

  loadSettings() {
    const fallback = { quality: 'high', sensitivity: 1, fov: 68 };
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return {
        quality: getPreset(parsed.quality).id,
        sensitivity:
          typeof parsed.sensitivity === 'number' ? parsed.sensitivity : fallback.sensitivity,
        fov: typeof parsed.fov === 'number' ? parsed.fov : fallback.fov,
      };
    } catch (error) {
      return fallback;
    }
  }

  saveSettings() {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch (error) {
      // Storage can be blocked (private mode); settings simply stay session-local.
    }
  }


  /* -------------------------------------------------------------- frame loop */

  animate() {
    if (!this.running) return;
    requestAnimationFrame(this.animate);
    this.update();
  }

  update() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const interactive = this.started && !this.paused && !this.ui.settingsOpen;

    this.fpsAccumulator += dt;
    this.fpsFrames += 1;
    if (this.fpsAccumulator >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccumulator;
      this.ui.setFps(this.fps);
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }

    if (interactive) {
      if (!this.inspecting) {
        if (this.droneView) this.drone.update(dt);
        else this.player.update(dt);
      }
      this.climate.update(dt);
      this.applyCalendarGrowth();
      this.environment.update(dt, this.climate);
      this.greenhouse.update(dt);
      const viewer = this.droneView ? this.drone.position : this.player.position;
      // The nursery controller advances the flood depth first so the shared
      // water model meters the same frame's draw/return from Reservoir 2.
      this.nursery.update(dt, viewer);
      this.water.update(dt);
      const waterSnapshot = this.water.snapshot();
      this.equipment.update(dt, waterSnapshot);
      this.storage.update(dt, waterSnapshot);
      this.bluelab.update(dt, waterSnapshot);
      this.irrigationPanel.update(dt, waterSnapshot);
      this.weatherPanel.update(dt, this.climate);
      this.plants.update(dt);
      this.equipment.updateCrops(dt, viewer);
      this.trayPickup.update(dt);

      if (!this.droneView) {
        const target = this.interaction.update();
        if (!this.inspecting) this.ui.setTarget(this.decorateCarryTarget(target));
      }
      this.ui.setClimate(this.climate.snapshot());
      this.ui.setPlayerState(
        this.droneView
          ? {
              x: this.drone.position.x,
              z: this.drone.position.z,
              speed: this.drone.horizontalSpeed,
              zone: `Drone view · ${this.drone.altitude.toFixed(1)} m`,
            }
          : {
              x: this.player.position.x,
              z: this.player.position.z,
              speed: this.player.currentSpeed,
              zone: this.player.getZone(),
            },
      );

      this.saveAccumulator += dt;
      if (this.saveAccumulator >= 30) {
        this.saveAccumulator = 0;
        this.saveGame();
      }
    }

    this.renderer.render(this.scene, this.droneView ? this.droneCamera : this.camera);
  }

  dispose() {
    this.running = false;
    this.saveGame();
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    this.player?.dispose();
    this.drone?.dispose();
    this.trayPickup?.dispose();
    this.interaction?.dispose();
    this.equipment?.dispose();
    this.bluelab?.dispose();
    this.irrigationPanel?.dispose();
    this.weatherPanel?.dispose();
    this.storage?.dispose();
    this.nursery?.dispose();
    this.greenhouse?.dispose();
    this.environment?.dispose();
    this.materials?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}

