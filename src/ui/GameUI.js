/**
 * Runtime UI: HUD readouts, crosshair targeting, interaction hint, inspect panel,
 * pause + settings modals and toast notifications.
 *
 * The markup is created here (index.html only ships the boot screen and an empty
 * #ui-root) so the DOM stays in sync with the CSS in src/styles/main.css.
 */

import { CAMERA_FOV, clampFov } from '../config/camera.js';

const HUD_MARKUP = `
  <div class="hud" id="hud">
    <div class="hud-block panel hud-block--tl">
      <div class="hud-title">Green Farm</div>
      <div class="hud-row"><span>Zone</span><strong data-zone>Entrance</strong></div>
      <div class="hud-row"><span>Time</span><strong class="accent" data-clock>Day 1 &middot; 10:42</strong></div>
      <div class="hud-row"><span>Weather</span><strong data-weather>Sunny</strong></div>
      <div class="hud-divider"></div>
      <div class="hud-row"><span>Air temp</span><strong class="accent" data-air>21.4 &deg;C</strong></div>
      <div class="hud-row"><span>Humidity</span><strong data-rh>64 %</strong></div>
      <div class="hud-row"><span>Solution</span><strong data-solution>EC 1.84 &middot; pH 5.88</strong></div>
      <div class="hud-row"><span>Status</span><strong class="accent" data-status>Nominal</strong></div>
    </div>

    <div class="hud-block hud-block--tr">
      <div class="hud-buttons">
        <span class="fps-readout"><strong data-fps>60</strong>FPS</span>
        <button type="button" class="btn btn-small btn-ghost" data-action="toggle-view" title="Switch between the walkthrough and the orbit camera (O)">Orbit view</button>
        <button type="button" class="btn btn-small btn-ghost" data-action="menu">Menu</button>
      </div>
      <div class="hud-row"><span>Position</span><strong data-pos>0.0 / 27.0</strong></div>
      <div class="hud-row"><span>Speed</span><strong data-speed>0.0 m/s</strong></div>
      <div class="hud-divider"></div>
      <div class="dev-tools" aria-label="Developer time and weather controls">
        <span class="dev-tools-label">DEV</span>
        <button
          type="button"
          class="btn btn-small btn-ghost dev-btn"
          data-action="skip-time"
          title="Skip 24 game hours and one plant growth day (T)"
        >Skip 24h <span class="dev-key">T</span></button>
        <button
          type="button"
          class="btn btn-small btn-ghost dev-btn dev-btn--weather"
          data-action="cycle-weather"
          title="Cycle weather (C)"
        ><span class="dev-prefix">WX</span><span data-dev-weather>Sunny</span><span class="dev-key">C</span></button>
      </div>
    </div>

    <div class="crosshair" id="crosshair"><span class="crosshair-dot"></span></div>

    <div class="interaction-hint panel" id="interaction-hint">
      <span class="interaction-name" data-hint-name>Bench</span>
      <span class="interaction-action"><kbd data-input-key>E</kbd><span data-hint-action>Inspect</span></span>
      <span class="interaction-range" data-hint-range>1.4 m</span>
    </div>

    <div class="controls-strip panel">
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Walk</span>
      <span class="sep"></span>
      <span><kbd>Shift</kbd> Sprint</span>
      <span class="sep"></span>
      <span><kbd>E</kbd> Interact</span>
      <span class="sep"></span>
      <span><kbd>G</kbd> Set down</span>
      <span class="sep"></span>
      <span><kbd>Tab</kbd> Reservoir</span>
      <span class="sep"></span>
      <span><kbd>O</kbd> Orbit view</span>
      <span class="sep"></span>
      <span><kbd>V</kbd> Drone view</span>
      <span class="sep"></span>
      <span><kbd>←</kbd><kbd>→</kbd> Orbit 360&deg;</span>
      <span class="sep"></span>
      <span><kbd>Q</kbd><kbd>E</kbd> Drone altitude</span>
      <span class="sep"></span>
      <span><kbd>T</kbd> +1 day</span>
      <span class="sep"></span>
      <span><kbd>C</kbd> Weather</span>
      <span class="sep"></span>
      <span><kbd>Esc</kbd> Menu</span>
    </div>

    <div class="location-tag panel" id="location-tag">
      <span class="dot"></span><span data-zone-tag>Entrance</span>
    </div>

    <div class="carry-tag panel" id="carry-tag">
      <span class="carry-dot"></span>
      <span class="carry-label">CARRYING</span>
      <strong data-carry-title>Seedling tray</strong>
      <span data-carry-detail>320 plugs &middot; Day 14</span>
      <span class="carry-action"><kbd data-input-key>E</kbd> <span data-carry-action>place / transplant</span></span>
    </div>

    <div class="harvest-mode-tag panel" id="harvest-mode-tag" aria-live="polite">
      <span class="harvest-mode-dot" aria-hidden="true"></span>
      <div class="harvest-mode-copy">
        <span class="harvest-mode-label">HARVEST MODE</span>
        <strong data-harvest-table>NFT table</strong>
        <span data-harvest-progress>Box 01 &middot; 0/80 heads</span>
      </div>
      <button type="button" class="btn btn-small btn-ghost" data-action="stop-harvest">Stop</button>
    </div>

    <aside class="inspect-panel panel" id="inspect-panel" aria-live="polite">
      <div class="inspect-head">
        <div>
          <span class="inspect-category" data-inspect-category>Equipment</span>
          <h2 class="inspect-title" data-inspect-title>Unit</h2>
        </div>
        <button type="button" class="inspect-close" data-action="close-inspect" aria-label="Close">&times;</button>
      </div>
      <div class="inspect-body">
        <p class="inspect-desc" data-inspect-desc></p>
        <dl class="spec-list" data-inspect-specs></dl>
      </div>
      <div class="inspect-foot"><kbd data-input-key>E</kbd><span>close</span></div>
    </aside>
  </div>

  <div class="modal" id="pause-modal">
    <div class="modal-panel">
      <div class="modal-head">
        <p class="eyebrow">Simulation paused</p>
        <h2>Farm menu</h2>
      </div>
      <div class="modal-body">
        <div class="hud-row"><span>Build</span><strong>Stylized farm &middot; orbit camera</strong></div>
        <div class="hud-row"><span>Pointer</span><strong>Free cursor</strong></div>
        <p class="hint">Resume to orbit the farm and continue growing.</p>

      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" data-action="resume">Resume</button>
        <div class="modal-actions-row">
          <button type="button" class="btn" data-action="settings">Settings</button>
          <button type="button" class="btn" data-action="respawn">Reset camera</button>
        </div>
      </div>
      <p class="modal-note">ESC opens the menu &middot; settings are stored locally</p>
    </div>
  </div>

  <div class="modal" id="settings-modal">
    <div class="modal-panel">
      <div class="modal-head">
        <p class="eyebrow">Rendering &amp; input</p>
        <h2>Settings</h2>
      </div>
      <div class="modal-body">
        <div class="field">
          <span class="field-label">Quality preset</span>
          <div class="quality-options">
            <button type="button" class="quality-btn" data-quality="low">Low</button>
            <button type="button" class="quality-btn" data-quality="medium">Medium</button>
            <button type="button" class="quality-btn" data-quality="high">High</button>
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="sensitivity">Mouse sensitivity <output id="sensitivity-out">1.0&times;</output></label>
          <input type="range" id="sensitivity" min="0.2" max="2.5" step="0.1" value="1" />
        </div>
        <div class="field">
          <label class="field-label" for="fov">Field of view <output id="fov-out">${CAMERA_FOV.default}&deg;</output></label>
          <input type="range" id="fov" min="${CAMERA_FOV.min}" max="${CAMERA_FOV.max}" step="1" value="${CAMERA_FOV.default}" />
        </div>
        <p class="hint">Changing quality rebuilds shadows and glass detail immediately. Keyboard, mouse and touch input are all supported.</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-settings">Back</button>
      </div>
      <p class="modal-note">Quality controls resolution and shadow detail</p>
    </div>
  </div>

  <div class="toast-stack" id="toast-stack"></div>
`;

export class GameUI {
  constructor({ root = document.getElementById('ui-root'), handlers = {} } = {}) {
    this.handlers = handlers;
    this.root = root;
    this.root.innerHTML = HUD_MARKUP;

    const $ = (selector) => this.root.querySelector(selector);
    this.el = {
      hud: $('#hud'),
      crosshair: $('#crosshair'),
      hint: $('#interaction-hint'),
      hintName: $('[data-hint-name]'),
      hintAction: $('[data-hint-action]'),
      hintRange: $('[data-hint-range]'),
      air: $('[data-air]'),
      rh: $('[data-rh]'),
      clock: $('[data-clock]'),
      weather: $('[data-weather]'),
      devWeather: $('[data-dev-weather]'),
      solution: $('[data-solution]'),
      status: $('[data-status]'),
      zone: $('[data-zone]'),
      zoneTag: $('#location-tag'),
      zoneTagText: $('[data-zone-tag]'),
      carry: $('#carry-tag'),
      carryTitle: $('[data-carry-title]'),
      carryDetail: $('[data-carry-detail]'),
      carryAction: $('[data-carry-action]'),
      harvestMode: $('#harvest-mode-tag'),
      harvestTable: $('[data-harvest-table]'),
      harvestProgress: $('[data-harvest-progress]'),
      fps: $('[data-fps]'),
      pos: $('[data-pos]'),
      speed: $('[data-speed]'),
      inspect: $('#inspect-panel'),
      inspectCategory: $('[data-inspect-category]'),
      inspectTitle: $('[data-inspect-title]'),
      inspectDesc: $('[data-inspect-desc]'),
      inspectSpecs: $('[data-inspect-specs]'),
      pause: $('#pause-modal'),
      settings: $('#settings-modal'),
      sensitivity: $('#sensitivity'),
      sensitivityOut: $('#sensitivity-out'),
      fov: $('#fov'),
      fovOut: $('#fov-out'),
      qualityButtons: Array.from(this.root.querySelectorAll('[data-quality]')),
      toasts: $('#toast-stack'),
    };

    // The orbit toolbar replaces the walkthrough key strip, so keep the original
    // markup around and restore it when the player returns to first person.
    this.touchInput = false;
    this.walkControlsMarkup = this.root.querySelector('.controls-strip').innerHTML;
    this.walkInspectFootMarkup = this.el.inspect.querySelector('.inspect-foot').innerHTML;

    this.inspectOpen = false;
    this.paused = false;
    this.settingsOpen = false;
    this.zoneTagTimer = null;
    this.lastZone = '';
    this.lastTargetKey = null;
    this.lastTargetDistance = null;

    this.bindEvents();
  }

  bindEvents() {
    this.root.addEventListener('click', (event) => {
      const focus = event.target.closest('[data-orbit-focus]');
      if (focus) { this.handlers.onOrbitFocus?.(focus.dataset.orbitFocus); return; }
      const quality = event.target.closest('[data-quality]');
      if (quality) {
        this.setQuality(quality.dataset.quality);
        this.handlers.onQualityChange?.(quality.dataset.quality);
        return;
      }

      const actionEl = event.target.closest('[data-action]');
      if (!actionEl || actionEl.disabled) return;
      const { action } = actionEl.dataset;
      if (action === 'orbit-roofs') this.handlers.onOrbitRoofs?.();
      else if (action === 'toggle-view') this.handlers.onToggleView?.();
      else if (action === 'drop') this.handlers.onDrop?.();
      else if (action === 'menu') this.handlers.onPause?.();
      else if (action === 'resume') this.handlers.onResume?.();
      else if (action === 'settings') this.openSettings();
      else if (action === 'respawn') this.handlers.onRespawn?.();
      else if (action === 'close-settings') this.closeSettings();
      else if (action === 'close-inspect') this.handlers.onCloseInspect?.();
      else if (action === 'skip-time') this.handlers.onSkipTime?.();
      else if (action === 'cycle-weather') this.handlers.onCycleWeather?.();
      else if (action === 'stop-harvest') this.handlers.onStopHarvest?.();
    });

    this.el.sensitivity.addEventListener('input', () => {
      const value = Number(this.el.sensitivity.value);
      this.el.sensitivityOut.textContent = `${value.toFixed(1)}×`;
      this.handlers.onSensitivityChange?.(value);
    });

    this.el.fov.addEventListener('input', () => {
      const value = clampFov(this.el.fov.value);
      this.el.fov.value = String(value);
      this.el.fovOut.textContent = `${value}°`;
      this.handlers.onFovChange?.(value);
    });
  }

  /**
   * Touch devices get "TAP" keycaps and lose the desktop key strip, so no
   * instruction on screen asks a phone player to press E.
   */
  setTouchInput(enabled) {
    const touch = Boolean(enabled);
    this.touchInput = touch;
    this.root.classList.toggle('is-touch-input', touch);
    for (const key of this.root.querySelectorAll('[data-input-key]')) {
      key.textContent = touch ? 'TAP' : 'E';
    }
  }

  setOrbitMode(enabled) {
    const orbit = Boolean(enabled);
    this.orbitMode = orbit;
    this.root.classList.toggle('is-orbit', orbit);

    const strip = this.root.querySelector('.controls-strip');
    if (strip) {
      strip.innerHTML = orbit
        ? `
      <div class="orbit-views" aria-label="Farm camera views">
        <button class="btn btn-small" data-action="toggle-view" title="Return to the first-person walkthrough (O)">First person</button>
        <button class="btn btn-small" data-orbit-focus="farm">Whole farm</button>
        <button class="btn btn-small" data-orbit-focus="greenhouse">Greenhouse</button>
        <button class="btn btn-small" data-orbit-focus="nursery">Nursery</button>
        <button class="btn btn-small" data-action="orbit-roofs" aria-pressed="true">Show roofs</button>
        <button class="btn btn-small" data-action="drop">Set down</button>
      </div>
      <span class="orbit-instructions">Drag to orbit · Scroll to zoom · Right-drag to pan · Click to interact · O returns to walk</span>
      <span class="orbit-touch-instructions">Drag to orbit · Pinch to zoom · Two fingers to pan · Tap to interact · First person returns to walk</span>`
        : this.walkControlsMarkup;
    }

    const inspectFoot = this.el.inspect.querySelector('.inspect-foot');
    if (inspectFoot) {
      inspectFoot.innerHTML = orbit ? 'Press E or Escape to close' : this.walkInspectFootMarkup;
    }

    if (orbit) {
      for (const key of this.root.querySelectorAll('[data-input-key]')) key.textContent = 'CLICK';
    } else {
      // Restoring the walkthrough markup also restores its original keycaps;
      // reapply the touch labels afterwards.
      this.setTouchInput(this.touchInput);
    }

    for (const button of this.root.querySelectorAll('[data-action="toggle-view"]')) {
      button.textContent = orbit ? 'First person' : 'Orbit view';
      button.setAttribute('aria-pressed', String(orbit));
      button.title = orbit
        ? 'Return to the first-person walkthrough (O)'
        : 'Switch to the farm orbit camera (O)';
    }
  }

  setOrbitRoofs(hidden) {
    const button = this.root.querySelector('[data-action="orbit-roofs"]');
    if (!button) return;
    button.textContent = hidden ? 'Show roofs' : 'Hide roofs';
    button.setAttribute('aria-pressed', String(hidden));
  }

  showHud() {
    this.el.hud.classList.add('is-visible');
  }

  hideHud() {
    this.el.hud.classList.remove('is-visible');
  }

  setFps(fps) {
    this.el.fps.textContent = Math.round(fps);
  }

  /** Live climate readout shared with the controller HMI inside the cabinet. */
  setClimate(data) {
    if (!data) return;
    const air = `${data.airTemp.toFixed(1)} \u00b0C`;
    const humidity = `${Math.round(data.humidity)} %`;
    const solution = `EC ${data.ec.toFixed(2)} \u00b7 pH ${data.ph.toFixed(2)}`;
    const status = data.isAlarm ? data.status[0] : 'Nominal';
    const clock = `${data.dayLabel ?? 'Day 1'} \u00b7 ${data.clock ?? '10:42'}`;
    const rainRate = data.rainMmPerHour ?? 0;
    const weatherMode = data.weatherManual ? 'HOLD' : 'AUTO';
    const weather =
      rainRate > 0.02
        ? `${data.weatherLabel ?? 'Rain'} \u00b7 ${rainRate.toFixed(1)} mm/h \u00b7 ${weatherMode}`
        : `${data.weatherLabel ?? 'Sunny'} \u00b7 ${weatherMode}`;

    if (this.el.air.textContent !== air) this.el.air.textContent = air;
    if (this.el.rh.textContent !== humidity) this.el.rh.textContent = humidity;
    if (this.el.clock.textContent !== clock) this.el.clock.textContent = clock;
    if (this.el.weather.textContent !== weather) this.el.weather.textContent = weather;
    const devWeather = data.weatherLabel ?? 'Sunny';
    if (this.el.devWeather.textContent !== devWeather) this.el.devWeather.textContent = devWeather;
    if (this.el.solution.textContent !== solution) this.el.solution.textContent = solution;
    if (this.el.status.textContent !== status) this.el.status.textContent = status;
    this.el.status.classList.toggle('accent', !data.isAlarm);
    this.el.status.classList.toggle('warn', data.isAlarm);
  }

  setPlayerState({ x, z, speed, zone }) {
    this.el.pos.textContent = `${x.toFixed(1)} / ${z.toFixed(1)}`;
    this.el.speed.textContent = `${speed.toFixed(1)} m/s`;
    if (zone && zone !== this.lastZone) {
      this.lastZone = zone;
      this.el.zone.textContent = zone;
      this.el.zoneTagText.textContent = zone;
      this.el.zoneTag.classList.add('is-visible');
      window.clearTimeout(this.zoneTagTimer);
      this.zoneTagTimer = window.setTimeout(
        () => this.el.zoneTag.classList.remove('is-visible'),
        2600,
      );
    }
  }

  /** Crosshair + hint reflect the currently raycast equipment (or null). */
  setTarget(target) {
    const active = Boolean(target);
    const key = active
      ? `${target.data?.id ?? target.data?.title ?? ''}|${target.data?.interactionHint ?? ''}`
      : null;
    const distance = active ? target.distance : null;
    const unchanged =
      key === this.lastTargetKey &&
      (distance === null || Math.abs(distance - this.lastTargetDistance) < 0.08);
    if (unchanged) return;
    this.lastTargetKey = key;
    this.lastTargetDistance = distance;
    this.el.crosshair.classList.toggle('is-targeting', active);
    this.el.hint.classList.toggle('is-visible', active && !this.inspectOpen);
    if (active) {
      this.el.hintName.textContent = target.data.title;
      this.el.hintAction.textContent = target.data.interactionHint ?? 'Inspect';
      this.el.hintRange.textContent = `${target.distance.toFixed(1)} m`;
    }
  }


  /** Persistent carry card while a physical seedling tray is in hand. */
  setCarry(tray) {
    const active = Boolean(tray);
    this.el.carry.classList.toggle('is-visible', active);
    this.el.carry.classList.toggle('is-box', false);
    if (!active) return;
    this.el.carryTitle.textContent = `Tray ${String(tray.index + 1).padStart(2, '0')} · ${tray.cropName}`;
    this.el.carryDetail.textContent = tray.ready
      ? `${tray.germinated} plugs · Day ${tray.growthDay} · READY`
      : tray.state === 'empty'
        ? 'Empty tray · ready to replant'
        : `${tray.germinated} plugs · Day ${tray.growthDay}`;
    if (this.el.carryAction) this.el.carryAction.textContent = 'place / transplant';
  }

  /** Persistent carry card while a styrofoam harvest box is in hand. */
  setBoxCarry(box) {
    const active = Boolean(box);
    this.el.carry.classList.toggle('is-visible', active);
    this.el.carry.classList.toggle('is-box', active);
    if (!active) return;
    const heads = `${box.plantCount}/${box.capacity}`;
    this.el.carryTitle.textContent = `Box ${String(box.index + 1).padStart(2, '0')} · ${heads} heads`;
    this.el.carryDetail.textContent = box.isEmpty
      ? 'Empty box · fill it at an NFT table'
      : `${box.weightKg.toFixed(1)} kg gross · ${box.cropSummary
          .map((lot) => `${lot.cropName} ${lot.heads}`)
          .join(' · ')}`;
    if (this.el.carryAction) this.el.carryAction.textContent = 'set down';
  }

  /**
   * Live harvest-mode card. It shows exactly which box is being filled and lets
   * the player stop without hunting for the table badge again.
   */
  setHarvestMode(state = null) {
    const active = Boolean(state?.active);
    this.el.harvestMode.classList.toggle('is-visible', active);
    if (!active) return;
    this.el.harvestTable.textContent = state.tableTitle ?? state.tableId ?? 'NFT table';
    if (state.box) {
      this.el.harvestProgress.textContent = `Box ${String(state.box.index + 1).padStart(2, '0')} · ${state.box.plantCount}/${state.box.capacity} heads · ${state.readyHeads ?? 0} ready`;
    } else {
      this.el.harvestProgress.textContent = `${state.readyHeads ?? 0} heads ready · all boxes full`;
    }
  }

  openInspect(data) {
    this.inspectOpen = true;
    this.el.inspectCategory.textContent = data.category ?? 'Equipment';
    this.el.inspectTitle.textContent = data.title;
    this.el.inspectDesc.textContent = data.description ?? '';
    this.el.inspectSpecs.textContent = '';
    for (const [key, value] of data.specs ?? []) {
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.textContent = value;
      this.el.inspectSpecs.append(dt, dd);
    }
    this.el.inspect.classList.add('is-open');
    this.el.hint.classList.remove('is-visible');
  }

  closeInspect() {
    if (!this.inspectOpen) return;
    this.inspectOpen = false;
    this.el.inspect.classList.remove('is-open');
    // Let the next setTarget call repaint the interaction hint immediately.
    this.lastTargetKey = null;
    this.lastTargetDistance = null;
  }

  toggleInspect(data) {
    if (this.inspectOpen) {
      this.closeInspect();
      return false;
    }
    if (data) {
      this.openInspect(data);
      return true;
    }
    return false;
  }

  setPaused(paused) {
    this.paused = paused;
    this.el.pause.classList.toggle('is-open', paused && !this.settingsOpen);
    if (!paused) {
      this.closeSettings();
      this.closeInspect();
    }
  }

  openSettings() {
    this.settingsOpen = true;
    this.el.pause.classList.remove('is-open');
    this.el.settings.classList.add('is-open');
  }

  closeSettings() {
    this.settingsOpen = false;
    this.el.settings.classList.remove('is-open');
    this.el.pause.classList.toggle('is-open', this.paused);
  }

  isModalOpen() {
    return this.paused || this.settingsOpen;
  }

  setQuality(quality) {
    for (const button of this.el.qualityButtons) {
      button.classList.toggle('is-active', button.dataset.quality === quality);
    }
  }

  setSettings({ quality, sensitivity, fov }) {
    if (quality) this.setQuality(quality);
    if (typeof sensitivity === 'number') {
      this.el.sensitivity.value = String(sensitivity);
      this.el.sensitivityOut.textContent = `${sensitivity.toFixed(1)}×`;
    }
    if (typeof fov === 'number') {
      const value = clampFov(fov);
      this.el.fov.value = String(value);
      this.el.fovOut.textContent = `${value}°`;
    }
  }

  toast(message, tone = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    if (tone === 'warn') toast.style.borderLeftColor = 'var(--warn)';
    this.el.toasts.append(toast);
    window.setTimeout(() => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 300);
    }, 3200);
  }
}

