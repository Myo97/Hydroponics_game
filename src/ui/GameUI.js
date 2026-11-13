/**
 * Runtime UI: HUD readouts, crosshair targeting, interaction hint, inspect panel,
 * pause + settings modals and toast notifications.
 *
 * The markup is created here (index.html only ships the boot screen and an empty
 * #ui-root) so the DOM stays in sync with the CSS in src/styles/main.css.
 */

const HUD_MARKUP = `
  <div class="hud" id="hud">
    <div class="hud-block panel hud-block--tl">
      <div class="hud-title">Verde Block 4</div>
      <div class="hud-row"><span>Zone</span><strong data-zone>Entrance</strong></div>
      <div class="hud-divider"></div>
      <div class="hud-row"><span>Air temp</span><strong class="accent" data-air>21.4 &deg;C</strong></div>
      <div class="hud-row"><span>Humidity</span><strong data-rh>64 %</strong></div>
      <div class="hud-row"><span>Solution</span><strong>EC 1.8 &middot; pH 5.9</strong></div>
      <div class="hud-row"><span>Status</span><strong class="accent">Nominal</strong></div>
    </div>

    <div class="hud-block hud-block--tr">
      <div class="hud-buttons">
        <span class="fps-readout"><strong data-fps>60</strong>FPS</span>
        <button type="button" class="btn btn-small btn-ghost" data-action="menu">Menu</button>
      </div>
      <div class="hud-row"><span>Position</span><strong data-pos>0.0 / 27.0</strong></div>
      <div class="hud-row"><span>Speed</span><strong data-speed>0.0 m/s</strong></div>
    </div>

    <div class="crosshair" id="crosshair"><span class="crosshair-dot"></span></div>

    <div class="interaction-hint panel" id="interaction-hint">
      <span class="interaction-name" data-hint-name>Bench</span>
      <span class="interaction-action"><kbd>E</kbd>Inspect</span>
      <span class="interaction-range" data-hint-range>1.4 m</span>
    </div>

    <div class="controls-strip panel">
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Walk</span>
      <span class="sep"></span>
      <span><kbd>Shift</kbd> Sprint</span>
      <span class="sep"></span>
      <span><kbd>E</kbd> Inspect</span>
      <span class="sep"></span>
      <span><kbd>Esc</kbd> Menu</span>
    </div>

    <div class="location-tag panel" id="location-tag">
      <span class="dot"></span><span data-zone-tag>Entrance</span>
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
      <div class="inspect-foot"><kbd>E</kbd><span>close</span></div>
    </aside>
  </div>

  <div class="modal" id="pause-modal">
    <div class="modal-panel">
      <div class="modal-head">
        <p class="eyebrow">Simulation paused</p>
        <h2>Walkthrough</h2>
      </div>
      <div class="modal-body">
        <div class="hud-row"><span>Milestone</span><strong>1 &middot; Environment</strong></div>
        <div class="hud-row"><span>Pointer</span><strong>Released</strong></div>
        <p class="hint">Resume to re-lock the mouse and continue walking the house.</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" data-action="resume">Resume</button>
        <div class="modal-actions-row">
          <button type="button" class="btn" data-action="settings">Settings</button>
          <button type="button" class="btn" data-action="respawn">Respawn</button>
        </div>
      </div>
      <p class="modal-note">ESC releases the pointer &middot; settings are stored locally</p>
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
          <label class="field-label" for="fov">Field of view <output id="fov-out">68&deg;</output></label>
          <input type="range" id="fov" min="55" max="90" step="1" value="68" />
        </div>
        <p class="hint">Changing quality rebuilds shadows and glass detail immediately. The walkthrough is desktop-only.</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-settings">Back</button>
      </div>
      <p class="modal-note">HIGH adds contact shadows and full glass reflections</p>
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
      hintRange: $('[data-hint-range]'),
      zone: $('[data-zone]'),
      zoneTag: $('#location-tag'),
      zoneTagText: $('[data-zone-tag]'),
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

    this.inspectOpen = false;
    this.paused = false;
    this.settingsOpen = false;
    this.zoneTagTimer = null;
    this.lastZone = '';

    this.bindEvents();
  }

  bindEvents() {
    this.root.addEventListener('click', (event) => {
      const quality = event.target.closest('[data-quality]');
      if (quality) {
        this.setQuality(quality.dataset.quality);
        this.handlers.onQualityChange?.(quality.dataset.quality);
        return;
      }

      const actionEl = event.target.closest('[data-action]');
      if (!actionEl) return;
      const { action } = actionEl.dataset;
      if (action === 'menu') this.handlers.onPause?.();
      else if (action === 'resume') this.handlers.onResume?.();
      else if (action === 'settings') this.openSettings();
      else if (action === 'respawn') this.handlers.onRespawn?.();
      else if (action === 'close-settings') this.closeSettings();
      else if (action === 'close-inspect') this.handlers.onCloseInspect?.();
    });

    this.el.sensitivity.addEventListener('input', () => {
      const value = Number(this.el.sensitivity.value);
      this.el.sensitivityOut.textContent = `${value.toFixed(1)}×`;
      this.handlers.onSensitivityChange?.(value);
    });

    this.el.fov.addEventListener('input', () => {
      const value = Number(this.el.fov.value);
      this.el.fovOut.textContent = `${value}°`;
      this.handlers.onFovChange?.(value);
    });
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
    this.el.crosshair.classList.toggle('is-targeting', active);
    this.el.hint.classList.toggle('is-visible', active && !this.inspectOpen);
    if (active) {
      this.el.hintName.textContent = target.data.title;
      this.el.hintRange.textContent = `${target.distance.toFixed(1)} m`;
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
      this.el.fov.value = String(fov);
      this.el.fovOut.textContent = `${fov}°`;
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

