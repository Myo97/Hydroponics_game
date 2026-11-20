/**
 * Version 14 touch overlay.
 *
 * Landscape phones and tablets get a left-thumb virtual stick, a right-thumb
 * look area and four action buttons. A short tap on any object resolves the
 * interaction from the tapped screen position (InteractionSystem.pickAt) so a
 * badge on a distant table can be inspected without first aiming the crosshair.
 *
 * The overlay only exists on coarse-pointer devices, so desktop keeps the
 * pointer-lock walkthrough untouched.
 */
const STICK_RADIUS = 46;
const LOOK_SCALE = 1.7;
const TAP_SLOP = 14;
const LONG_PRESS_MS = 520;
const LONG_PRESS_MAX_MS = 1600;

const MARKUP = `
  <div class="touch-look" data-touch-look aria-hidden="true"></div>
  <div class="touch-orientation">
    <span class="touch-orientation-icon" aria-hidden="true"></span>
    <strong>Rotate to landscape</strong>
    <span>Swipe to look, left thumb to walk, right buttons to act</span>
  </div>
  <div class="touch-stick" data-touch-stick aria-label="Movement stick">
    <span class="touch-stick-ring" aria-hidden="true"></span>
    <span class="touch-stick-knob" data-touch-knob aria-hidden="true"></span>
    <span class="touch-stick-label">MOVE</span>
  </div>
  <div class="touch-actions">
    <button type="button" class="touch-btn touch-btn-use" data-touch="use">
      <strong>USE</strong><span id="touch-use-label">Interact</span>
    </button>
    <button type="button" class="touch-btn" data-touch="drop"><strong>DROP</strong><span>Set down</span></button>
    <button type="button" class="touch-btn" data-touch="drone"><strong>DRONE</strong><span>Fly view</span></button>
    <button type="button" class="touch-btn" data-touch="menu"><strong>MENU</strong><span>Pause</span></button>
  </div>
  <p class="touch-hint">Drag to look &middot; tap to act &middot; hold to inspect &middot; USE works on the crosshair</p>
`;

export class TouchControls {
  constructor({
    root = document.getElementById('ui-root'),
    viewport = document.querySelector('#viewport canvas'),
    player,
    interaction,
    handlers = {},
  } = {}) {
    this.root = root;
    this.viewport = viewport;
    this.player = player;
    this.interaction = interaction;
    this.handlers = handlers;
    this.isTouchDevice = TouchControls.detectTouch();
    this.active = false;
    this.el = null;
    this.knob = null;
    this.stick = { pointerId: null };
    this.look = { pointerId: null, lastX: 0, lastY: 0, startX: 0, startY: 0, moved: 0, startedAt: 0 };
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    if (this.isTouchDevice) this.#build();
  }

  /** Coarse pointer plus a real touch digitiser; hybrids keep the desktop UI. */
  static detectTouch() {
    if (typeof window === 'undefined') return false;
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
    const points = navigator.maxTouchPoints ?? 0;
    const hasTouch = points > 0 || 'ontouchstart' in window;
    return Boolean(coarse && hasTouch);
  }

  #build() {
    if (!this.root) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'touch-ui';
    wrapper.id = 'touch-ui';
    wrapper.innerHTML = MARKUP;
    this.root.appendChild(wrapper);
    this.el = wrapper;

    this.lookEl = wrapper.querySelector('[data-touch-look]');
    this.stickEl = wrapper.querySelector('[data-touch-stick]');
    this.knob = wrapper.querySelector('[data-touch-knob]');
    this.useLabel = wrapper.querySelector('#touch-use-label');

    this.lookEl.addEventListener('pointerdown', this.onPointerDown);
    this.lookEl.addEventListener('pointermove', this.onPointerMove);
    this.lookEl.addEventListener('pointerup', this.onPointerUp);
    this.lookEl.addEventListener('pointercancel', this.onPointerUp);
    this.stickEl.addEventListener('pointerdown', this.onPointerDown);
    this.stickEl.addEventListener('pointermove', this.onPointerMove);
    this.stickEl.addEventListener('pointerup', this.onPointerUp);
    this.stickEl.addEventListener('pointercancel', this.onPointerUp);

    for (const button of wrapper.querySelectorAll('[data-touch]')) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.#pressButton(button.dataset.touch);
      });
    }
  }

  /** Show/hide the overlay; hiding also releases the stick so the player stops. */
  setActive(active) {
    this.active = Boolean(active);
    this.el?.classList.toggle('is-active', this.active);
    if (!this.active) {
      this.#resetStick();
      this.look.pointerId = null;
    }
    return this.active;
  }

  /** Mirrors the aimed interaction into the USE button caption. */
  setTarget(target) {
    if (!this.useLabel) return;
    const label =
      target?.data?.action ??
      target?.data?.interactionHint ??
      (target ? 'Inspect' : 'Nothing in reach');
    if (this.useLabel.textContent !== label) this.useLabel.textContent = label;
    this.el?.classList.toggle('has-target', Boolean(target));
  }

  #pressButton(action) {
    switch (action) {
      case 'use':
        this.handlers.onUse?.(this.interaction?.target ?? null);
        break;
      case 'drop':
        this.handlers.onDrop?.();
        break;
      case 'drone':
        this.handlers.onDrone?.();
        break;
      case 'menu':
        this.handlers.onMenu?.();
        break;
      default:
        break;
    }
  }

  onPointerDown(event) {
    if (!this.active) return;
    if (event.pointerType === 'mouse' && !this.isTouchDevice) return;
    event.preventDefault();

    if (event.currentTarget === this.stickEl) {
      if (this.stick.pointerId !== null) return;
      this.stick.pointerId = event.pointerId;
      this.stickEl.classList.add('is-engaged');
      this.stickEl.setPointerCapture?.(event.pointerId);
      this.#updateStick(event);
      return;
    }

    if (this.look.pointerId !== null) return;
    this.look.pointerId = event.pointerId;
    this.look.lastX = event.clientX;
    this.look.lastY = event.clientY;
    this.look.startX = event.clientX;
    this.look.startY = event.clientY;
    this.look.moved = 0;
    this.look.startedAt = performance.now();
    this.lookEl.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.active) return;

    if (event.currentTarget === this.stickEl && event.pointerId === this.stick.pointerId) {
      event.preventDefault();
      this.#updateStick(event);
      return;
    }

    if (event.pointerId !== this.look.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - this.look.lastX;
    const dy = event.clientY - this.look.lastY;
    this.look.lastX = event.clientX;
    this.look.lastY = event.clientY;
    this.look.moved += Math.abs(dx) + Math.abs(dy);
    this.player?.addLook?.(dx * LOOK_SCALE, dy * LOOK_SCALE);
  }

  onPointerUp(event) {
    if (event.currentTarget === this.stickEl && event.pointerId === this.stick.pointerId) {
      this.stickEl.releasePointerCapture?.(event.pointerId);
      this.#resetStick();
      return;
    }

    if (event.pointerId !== this.look.pointerId) return;
    const elapsed = performance.now() - this.look.startedAt;
    const still = this.look.moved <= TAP_SLOP;
    const longPress = still && elapsed >= LONG_PRESS_MS && elapsed <= LONG_PRESS_MAX_MS;
    const tapped = still && elapsed < LONG_PRESS_MS;
    this.look.pointerId = null;
    this.lookEl.releasePointerCapture?.(event.pointerId);
    if (event.type === 'pointerup' && (tapped || longPress)) {
      this.#tap(event.clientX, event.clientY, { longPress });
    }
  }

  #updateStick(event) {
    const rect = this.stickEl.getBoundingClientRect();
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    let dx = event.clientX - centreX;
    let dy = event.clientY - centreY;
    const length = Math.hypot(dx, dy);
    if (length > STICK_RADIUS) {
      const scale = STICK_RADIUS / length;
      dx *= scale;
      dy *= scale;
    }
    if (this.knob) this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // Screen-up is forward, so the vertical axis is inverted.
    this.player?.setMoveInput?.(dx / STICK_RADIUS, -dy / STICK_RADIUS);
  }

  #resetStick() {
    this.stick.pointerId = null;
    this.stickEl?.classList.remove('is-engaged');
    if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
    this.player?.clearInput?.();
  }

  /** Touch taps pick from the tapped point instead of the screen centre. */
  #tap(clientX, clientY, { longPress = false } = {}) {
    if (!this.interaction || !this.player) return;
    const rect = this.viewport?.getBoundingClientRect?.();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    const width = Math.max(1, rect?.width ?? window.innerWidth);
    const height = Math.max(1, rect?.height ?? window.innerHeight);
    const ndcX = ((clientX - left) / width) * 2 - 1;
    const ndcY = -((clientY - top) / height) * 2 + 1;
    const target = this.interaction.pickAt?.(ndcX, ndcY, { maxDistance: 4.6 });
    if (longPress) this.handlers.onLongPress?.(target ?? null);
    else this.handlers.onActivate?.(target ?? null);
  }

  dispose() {
    this.setActive(false);
    this.el?.remove();
    this.el = null;
    this.lookEl = null;
    this.stickEl = null;
    this.knob = null;
    this.useLabel = null;
    this.viewport = null;
    this.player = null;
    this.interaction = null;
  }
}
