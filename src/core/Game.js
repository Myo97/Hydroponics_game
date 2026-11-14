import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { getPreset } from './Quality.js';
import { MaterialLibrary } from '../world/MaterialLibrary.js';
import { Environment } from '../world/Environment.js';
import { Greenhouse } from '../world/Greenhouse.js';
import { Equipment } from '../world/Equipment.js';
import { CollisionWorld } from '../player/CollisionWorld.js';
import { FirstPersonController } from '../player/FirstPersonController.js';
import { InteractionSystem } from '../interaction/InteractionSystem.js';
import { GameUI } from '../ui/GameUI.js';
import { PlantSimulation } from '../simulation/PlantSimulation.js';
import { WaterNutrientSimulation } from '../simulation/WaterNutrientSimulation.js';
import { GreenhouseClimate } from '../simulation/GreenhouseClimate.js';
import { GreenhouseControlSystem } from '../systems/GreenhouseControlSystem.js';
import { WaterStorage } from '../world/WaterStorage.js';
import { BluelabController } from '../world/BluelabController.js';
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
    this.topView = false;

    this.fpsAccumulator = 0;
    this.fpsFrames = 0;
    this.fps = 60;
    this.report = () => {};

    this.settings = this.loadSettings();
    this.preset = getPreset(this.settings.quality);

    this.onPointerLockChange = this.onPointerLockChange.bind(this);
    this.onPointerLockError = this.onPointerLockError.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
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
    this.collisionWorld.addBox({
      x: LAYOUT.bluelab.position[0],
      z: LAYOUT.bluelab.position[1],
      width: 0.72,
      depth: 1.18,
      label: 'Bluelab controller',
    });

    this.report(0.86, 'Calibrating sensors and player…');
    await this.nextTick();
    this.player = new FirstPersonController({
      camera: this.camera,
      domElement: this.renderer.domElement,
      collisionWorld: this.collisionWorld,
    });
    this.player.setSensitivity(this.settings.sensitivity);

    this.interaction = new InteractionSystem({
      camera: this.camera,
      scene: this.scene,
      interactables: [
        ...this.greenhouse.getInteractables(),
        ...this.equipment.getInteractables(),
        ...this.storage.interactables,
        ...this.bluelab.interactables,
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
    this.water = new WaterNutrientSimulation({
      equipment: this.equipment,
      layout: LAYOUT,
      control: this.control,
    });
    this.saveSystem = new SaveSystem({ key: 'verde-block4:save' });

    this.report(1, 'Ready');
    await this.nextTick();

    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
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
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
  }

  nextTick() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
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
    if (this.topView) {
      this.topView = false;
      this.camera.near = 0.06;
      this.camera.up.set(0, 1, 0);
      this.camera.updateProjectionMatrix();
      this.greenhouse?.setTopView(false);
      this.storage?.setTopView(false);
      this.environment?.setTopView(false);
    }
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
    this.player.setEnabled(true);
    this.player.requestPointerLock();
    this.interaction.setEnabled(true);
    this.clock.getDelta();
  }

  respawn() {
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
   * Central dispatch for every Version 3 interaction. Returns true when the
   * action was handled, so E never falls through to the generic inspect panel.
   */
  handleInteraction(data) {
    if (!data) return false;
    switch (data.interaction) {
      case 'toggle-entrance': {
        const open = this.greenhouse.toggleEntranceDoors();
        this.ui.toast(open ? 'Entrance opening' : 'Entrance closing');
        return true;
      }
      case 'toggle-cabinet': {
        const open = this.equipment.toggleCabinetDoor();
        this.ui.toast(
          open
            ? 'Climate cabinet open — master switches and bay status live'
            : 'Climate cabinet closed and latched',
        );
        return true;
      }
      case 'toggle-all-bays': {
        const on = this.equipment.toggleMasterBayDevice(data.bayKey);
        this.ui.toast(
          `${data.bayKey.replace('On', '').replace('Extended', '').replace('Open', '')} all bays: ${on ? 'ON' : 'OFF'}`,
        );
        return true;
      }
      case 'toggle-fan-bay': {
        const enabled = this.equipment.fanSystem?.toggleBay(data.bayId) ?? false;
        this.ui.toast(`HAF fans bay ${data.bayId}: ${enabled ? 'running' : 'stopped'}`);
        return true;
      }
      case 'toggle-table-valve': {
        const open = this.equipment.hydraulicNetwork?.toggleTableValve(data.tableId) ?? false;
        this.ui.toast(`${data.title}: ${open ? 'open' : 'isolated'}`);
        this.bluelab.hmiAccumulator = 1;
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
        this.ui.toast(`Rain transfer pump: ${on ? 'running' : 'stopped'}`);
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
        this.ui.toast(`Monitoring ${tank?.code ?? 'tank'} · press E to cycle`);
        return true;
      }
      case 'inspect-trap': {
        this.greenhouse.stickyTraps?.inspect(data.trapIndex);
        this.openInspect(data);
        return true;
      }
      case 'inspect':
      default:
        return false;
    }
  }

  /**
   * Cut-away top view. The camera is raised above the ridge and the near plane
   * is pushed below roof height, so glazing and trusses are clipped away while
   * the crop, machinery and underground tanks stay visible.
   */
  toggleTopView() {
    if (!this.started || this.inspecting) return;
    this.topView = !this.topView;
    this.player.setEnabled(!this.topView);
    this.interaction.setEnabled(!this.topView && !this.paused);
    this.ui.setTarget(null);
    this.greenhouse?.setTopView(this.topView);
    this.storage?.setTopView(this.topView);
    this.environment?.setTopView(this.topView);

    if (this.topView) {
      this.camera.position.set(0, 28, 0);
      this.camera.up.set(0, 0, -1);
      this.camera.near = 22.2;
      this.camera.lookAt(0, 0, 0);
      this.camera.updateProjectionMatrix();
      this.ui.toast('Top view — roof cut away. Press V to return');
    } else {
      this.camera.near = 0.06;
      this.camera.up.set(0, 1, 0);
      this.camera.updateProjectionMatrix();
      this.player.syncCamera();
      this.ui.toast('Walkthrough view');
    }
  }

  /* ------------------------------------------------------------------- events */

  onPointerLockChange() {
    const locked = this.player.isPointerLocked();
    this.interaction.setLockState(locked);
    if (!locked && this.started && !this.ui.isModalOpen()) {
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
      this.toggleTopView();
      return;
    }

    if (event.code === 'Tab' && !this.ui.isModalOpen() && !this.inspecting && !this.topView) {
      event.preventDefault();
      this.bluelab.cycleTank();
      const tank = this.water.selectedTank;
      this.ui.toast(`Monitoring ${tank?.code ?? 'tank'} · E on the Bluelab HMI cycles tanks`);
      return;
    }

    if (event.code === 'KeyE' && !this.ui.isModalOpen()) {
      event.preventDefault();
      if (this.inspecting) {
        this.closeInspect();
        return;
      }
      const target = this.interaction.target;
      if (target && this.handleInteraction(target.data)) {
        this.ui.setTarget(target);
        return;
      }
      if (target) this.openInspect(target.data);
      else this.ui.toast('Nothing within reach — move closer and aim at a unit', 'warn');
      return;
    }

    if (event.code === 'KeyF' && !this.ui.isModalOpen() && !this.inspecting) {
      event.preventDefault();
      const running = this.equipment.toggleFans();
      this.ui.toast(running ? 'HAF fans running' : 'HAF fans paused for testing');
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
      if (!this.inspecting && !this.topView) this.player.update(dt);
      this.climate.update(dt);
      this.water.update(dt);
      const waterSnapshot = this.water.snapshot();
      this.greenhouse.update(dt);
      this.equipment.update(dt, waterSnapshot);
      this.storage.update(dt, waterSnapshot);
      this.bluelab.update(dt, waterSnapshot);
      this.plants.update(dt);

      if (!this.topView) {
        const target = this.interaction.update();
        if (!this.inspecting) this.ui.setTarget(target);
      }
      this.ui.setClimate(this.climate.snapshot());
      this.ui.setPlayerState({
        x: this.player.position.x,
        z: this.player.position.z,
        speed: this.topView ? 0 : this.player.currentSpeed,
        zone: this.topView ? 'Top view' : this.player.getZone(),
      });
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.running = false;
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    this.player?.dispose();
    this.interaction?.dispose();
    this.equipment?.dispose();
    this.bluelab?.dispose();
    this.storage?.dispose();
    this.greenhouse?.dispose();
    this.environment?.dispose();
    this.materials?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}

