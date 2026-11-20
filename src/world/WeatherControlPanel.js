import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { boxMesh } from './Batches.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const WIDTH = 768;
const HEIGHT = 384;

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Version 7 four-position weather selector (Verde Block 4).
 *
 * A wall-mounted enclosure beside the main irrigation panel with a physical
 * rotary selector, one lamp per outlook (sunny / cloudy / light rain / heavy
 * rain) and an AUTO key. The selector writes directly to GreenhouseClimate, so
 * the sky, sun, rain particle field and roof catchment all follow the panel.
 */
export class WeatherControlPanel {
  constructor({ materials, climate = null }) {
    this.materials = materials;
    this.climate = climate;
    this.group = null;
    this.interactables = [];
    this.labelMaterials = [];
    this.stateLights = [];
    this.selectorPointer = null;
    this.autoKey = null;
    this.autoLamp = null;
    this.screen = null;
    this.hmiAccumulator = 1;
    this.hmiSignature = '';
    this.selectorAngle = 0;

    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.hmiMaterial = materials.createScreenMaterial(this.texture);
    this.drawHMI(null);
  }

  label(title, subtitle, width, height, options = {}) {
    const material = this.materials.createLabelMaterial(title, subtitle, {
      background: options.background ?? '#e8ece3',
      foreground: options.foreground ?? '#183345',
    });
    this.labelMaterials.push(material);
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  }

  build(parent) {
    const config = LAYOUT.weatherPanel;
    const [x, z] = config.position;
    const [depth, height, width] = config.size;

    const group = new THREE.Group();
    group.name = 'weather-control-panel';
    group.position.set(x, 0, z);
    this.group = group;
    parent.add(group);

    group.add(
      boxMesh(
        width + 0.07,
        config.footHeight,
        depth + 0.05,
        this.materials.steelDark,
        V(0, config.footHeight / 2, 0),
        'weather-panel-foot',
      ),
    );
    group.add(
      boxMesh(
        width,
        height,
        depth,
        this.materials.cabinetPaint,
        V(0, height / 2 + config.footHeight, 0),
        'weather-panel-enclosure',
      ),
    );
    group.add(
      boxMesh(
        width - 0.035,
        height - 0.035,
        0.016,
        this.materials.steelDark,
        V(0, height / 2 + config.footHeight, depth / 2 + 0.012),
        'weather-panel-door',
      ),
    );
    group.add(
      boxMesh(
        width + 0.025,
        0.035,
        depth + 0.045,
        this.materials.aluminium,
        V(0, height + config.footHeight, 0),
        'weather-panel-canopy',
      ),
    );

    const [screenWidth, screenHeight] = config.screenSize;
    const screenY = 0.82;
    group.add(
      boxMesh(
        screenWidth + 0.08,
        screenHeight + 0.08,
        0.035,
        this.materials.steelDark,
        V(0, screenY, depth / 2 + 0.032),
        'weather-panel-bezel',
      ),
    );
    this.screen = new THREE.Mesh(
      new THREE.PlaneGeometry(screenWidth, screenHeight),
      this.hmiMaterial,
    );
    this.screen.name = 'weather-panel-hmi';
    this.screen.position.set(0, screenY, depth / 2 + 0.052);
    group.add(this.screen);

    const title = this.label(
      'WEATHER CONTROL',
      'VERDE BLOCK 4 \u00b7 ROOF OUTLOOK',
      0.58,
      0.105,
      { background: '#edf1e8', foreground: '#153145' },
    );
    title.position.set(0, 1.005, depth / 2 + 0.054);
    group.add(title);

    // Four-state rotary selector on the left of the control row.
    const selectorGroup = new THREE.Group();
    selectorGroup.name = 'weather-selector';
    selectorGroup.position.set(-0.235, 0.49, depth / 2 + 0.055);
    group.add(selectorGroup);

    const bezel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.096, 0.096, 0.034, 28),
      this.materials.steelDark,
    );
    bezel.rotation.x = Math.PI / 2;
    selectorGroup.add(bezel);

    const dial = new THREE.Group();
    dial.name = 'weather-selector-dial';
    dial.position.z = 0.026;
    selectorGroup.add(dial);
    this.selectorPointer = dial;

    const knob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.073, 0.066, 0.046, 24),
      this.materials.pumpBlue,
    );
    knob.rotation.x = Math.PI / 2;
    dial.add(knob);

    dial.add(
      boxMesh(
        0.021,
        0.084,
        0.016,
        this.materials.ledWhite,
        V(0, 0.037, 0.029),
        'weather-selector-pointer',
      ),
    );

    for (let index = 0; index < 8; index += 1) {
      const grip = boxMesh(
        0.008,
        0.012,
        0.018,
        this.materials.aluminium,
        V(
          Math.cos((index / 8) * Math.PI * 2) * 0.067,
          Math.sin((index / 8) * Math.PI * 2) * 0.067,
          0.026,
        ),
        `weather-selector-grip-${index}`,
      );
      grip.rotation.z = (index / 8) * Math.PI * 2;
      dial.add(grip);
    }

    const selectorInfo = {
      id: 'weather-selector-rotary',
      category: 'Weather control',
      title: 'Four-position weather selector',
      description:
        'Manual roof-outlook selector for the whole greenhouse. Each detent selects one of four weather states: sunny, cloudy, light rain or heavy rain. The selected state drives PPFD, humidity and temperature bias, cloud cover, the exterior rain field and the roof catchment rate. Rain caught by the roof drains to the underground harvester. Turning the selector holds that outlook until AUTO is pressed or the selector is advanced again.',
      specs: [
        ['Positions', 'Sunny / Cloudy / Light rain / Heavy rain'],
        ['Control', 'Manual hold \u00b7 detented rotary'],
        ['Outputs', 'Sky \u00b7 sun \u00b7 rain \u00b7 roof capture'],
        ['Location', 'Verde Block 4 headhouse'],
      ],
      interactionHint: 'Advance weather state',
      interaction: 'cycle-weather',
    };
    dial.userData.interactable = selectorInfo;
    this.interactables.push({ object: dial, data: selectorInfo });

    const states = this.climate?.weatherOrder ?? LAYOUT.weather.order;
    const stateX = [0.0, 0.1, 0.2, 0.3];
    states.forEach((stateId, index) => {
      const state = LAYOUT.weather.states[stateId];
      if (!state) return;
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.021, 12, 9),
        this.materials.steelDark,
      );
      lamp.name = `weather-lamp-${stateId}`;
      lamp.position.set(stateX[index] ?? 0.3, 0.565, depth / 2 + 0.075);
      group.add(lamp);

      const tag = this.label(
        state.label.toUpperCase(),
        state.rainMmPerHour > 0 ? `${state.rainMmPerHour.toFixed(1)} mm/h` : 'DRY',
        0.095,
        0.058,
        { background: '#dfe6dc', foreground: '#264236' },
      );
      tag.position.set(stateX[index] ?? 0.3, 0.475, depth / 2 + 0.058);
      group.add(tag);

      const info = {
        id: `weather-state-${stateId}`,
        category: 'Weather control',
        title: `${state.label} outlook`,
        description: `Select the ${state.label.toLowerCase()} weather state directly. PPFD factor ${state.ppfdFactor.toFixed(2)}, humidity bias +${state.humidityBias.toFixed(0)}%, temperature bias ${state.tempBias.toFixed(1)} \u00b0C and roof capture ${state.rainMmPerHour.toFixed(1)} mm/h. The lamp shows the state currently latched on the controller.`,
        specs: [
          ['State', state.label],
          ['PPFD factor', state.ppfdFactor.toFixed(2)],
          ['Humidity bias', `+${state.humidityBias.toFixed(0)} %`],
          ['Roof capture', `${state.rainMmPerHour.toFixed(1)} mm/h`],
        ],
        interactionHint: `Select ${state.label}`,
        interaction: 'set-weather',
        weatherId: stateId,
      };
      lamp.userData.interactable = info;
      this.interactables.push({ object: lamp, data: info });
      this.stateLights.push({ id: stateId, lamp, tag });
    });

    const autoKey = new THREE.Group();
    autoKey.name = 'weather-auto-key';
    autoKey.position.set(0.19, 0.315, depth / 2 + 0.068);
    group.add(autoKey);
    this.autoKey = autoKey;

    autoKey.add(
      boxMesh(
        0.165,
        0.065,
        0.024,
        this.materials.steelDark,
        V(0, 0, 0),
        'weather-auto-button',
      ),
    );
    const autoLamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.011, 10, 8),
      this.materials.ledGreen,
    );
    autoLamp.position.set(-0.062, 0, 0.018);
    autoKey.add(autoLamp);
    this.autoLamp = autoLamp;

    const autoTag = this.label('AUTO', 'RESUME SCHEDULE', 0.145, 0.05, {
      background: '#dfe6dc',
      foreground: '#245446',
    });
    autoTag.position.set(0.19, 0.25, depth / 2 + 0.058);
    group.add(autoTag);

    const autoInfo = {
      id: 'weather-auto-key',
      category: 'Weather control',
      title: 'AUTO weather key',
      description:
        'Releases the manual weather hold and resumes the deterministic four-state schedule. The schedule advances through sunny, cloudy, light rain and heavy rain using the saved random seed and the configured 2-5 game-hour dwell time. The green lamp is lit while the controller is running automatically; tapping the button while AUTO is already active has no effect.',
      specs: [
        ['Mode', 'AUTO schedule'],
        [
          'Dwell',
          `${LAYOUT.weather.minDurationHours}-${LAYOUT.weather.maxDurationHours} game hours`,
        ],
        ['Sequence', 'Sunny \u2192 Cloudy \u2192 Light \u2192 Heavy'],
        ['Seed', 'Restored from save'],
      ],
      interactionHint: 'Release manual hold',
      interaction: 'toggle-weather-auto',
    };
    autoKey.userData.interactable = autoInfo;
    this.interactables.push({ object: autoKey, data: autoInfo });

    const footer = this.label(
      'SELECTOR',
      'TAP ADVANCES \u00b7 AUTO RESUMES',
      width - 0.09,
      0.058,
      { background: '#dde6df', foreground: '#245446' },
    );
    footer.position.set(0, 0.16, depth / 2 + 0.058);
    group.add(footer);

    const screenInfo = {
      id: 'weather-panel-hmi',
      category: 'Weather control',
      title: 'Weather controller HMI',
      description:
        'Live weather HMI showing the latched outlook, manual or automatic mode, light factor, humidity and temperature bias, and roof rain capture rate. The four cards mirror the physical selector lamps. Tap a state lamp to select that outlook directly.',
      specs: [
        ['Outlook', 'Four-state selector'],
        ['Mode', 'Manual hold / AUTO schedule'],
        ['Outputs', 'PPFD \u00b7 VPD \u00b7 roof run-off'],
        ['Network', 'Shared with climate cabinet'],
      ],
      interactionHint: 'Inspect weather controller',
      interaction: 'inspect',
    };
    this.screen.userData.interactable = screenInfo;
    this.interactables.push({ object: this.screen, data: screenInfo });

    return this;
  }

  stateIndex(stateId) {
    const order = this.climate?.weatherOrder ?? LAYOUT.weather.order;
    const index = order.indexOf(stateId);
    return index < 0 ? 0 : index;
  }

  update(dt, climate = this.climate) {
    if (!this.group) return;
    const weather = climate?.weather ?? 'sunny';
    const activeIndex = this.stateIndex(weather);
    // Positive screen-space Z rotation is anticlockwise, so negate it to make
    // successive detents turn the pointer clockwise through the four positions.
    const targetAngle = -activeIndex * (Math.PI / 2);
    this.selectorAngle +=
      (targetAngle - this.selectorAngle) * Math.min(1, dt * 8.5);
    if (this.selectorPointer) this.selectorPointer.rotation.z = this.selectorAngle;

    for (const entry of this.stateLights) {
      const active = entry.id === weather;
      entry.lamp.material = active
        ? this.materials.ledAmber
        : this.materials.steelDark;
      // Keep every lamp mesh pickable: unseen lamp meshes cannot be raycast, so
      // the four direct-select targets must stay visible at all times.
      entry.lamp.visible = true;
    }

    const manual = Boolean(climate?.weatherManual);
    if (this.autoLamp) {
      this.autoLamp.material = manual
        ? this.materials.steelDark
        : this.materials.ledGreen;
      this.autoLamp.visible = true;
    }

    this.hmiAccumulator += dt;
    if (this.hmiAccumulator < 0.3 || !climate) return;
    this.hmiAccumulator = 0;
    const signature = [
      weather,
      manual,
      climate.rainMmPerHour?.toFixed(2) ?? '0.00',
      climate.dayIndex,
      climate.weatherOrder?.join(','),
    ].join('|');
    if (signature === this.hmiSignature) return;
    this.hmiSignature = signature;
    this.drawHMI(climate);
  }

  drawHMI(climate) {
    const ctx = this.ctx;
    const order = climate?.weatherOrder ?? LAYOUT.weather.order;
    const weather = climate?.weather ?? 'sunny';
    const state = LAYOUT.weather.states[weather] ?? LAYOUT.weather.states.sunny;
    const manual = Boolean(climate?.weatherManual);

    const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    background.addColorStop(0, '#0c3038');
    background.addColorStop(1, '#071c24');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8f4ee';
    ctx.font = '700 23px "Segoe UI", Arial, sans-serif';
    ctx.fillText('WEATHER CONTROL \u00b7 VERDE BLOCK 4', 20, 35);
    ctx.fillStyle = '#6fc9b5';
    ctx.font = '600 13px Consolas, "Courier New", monospace';
    ctx.fillText('FOUR-STATE ROOF OUTLOOK \u00b7 CLIMATE CABINET LINK', 22, 55);

    ctx.textAlign = 'right';
    ctx.fillStyle = manual ? '#ffc45c' : '#62e3b5';
    ctx.font = '700 15px Consolas, "Courier New", monospace';
    ctx.fillText(manual ? 'MANUAL HOLD' : 'AUTO SCHEDULE', WIDTH - 20, 31);
    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 12px "Segoe UI", Arial, sans-serif';
    ctx.fillText(
      climate?.dayLabel ? climate.dayLabel.toUpperCase() : 'DAY 1',
      WIDTH - 20,
      52,
    );

    ctx.fillStyle = 'rgba(18, 62, 64, 0.94)';
    roundedRect(ctx, 20, 74, 728, 154, 12);
    ctx.fill();
    ctx.strokeStyle = '#4fc7a1';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#8fd4c2';
    ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
    ctx.fillText('LATCHED OUTLOOK', 38, 99);
    ctx.fillStyle = '#f0fbf5';
    ctx.font = '700 42px "Segoe UI", Arial, sans-serif';
    ctx.fillText(state.label.toUpperCase(), 36, 145);

    const metrics = [
      ['LIGHT FACTOR', `${Math.round((state.ppfdFactor ?? 1) * 100)} %`],
      ['HUMIDITY BIAS', `+${(state.humidityBias ?? 0).toFixed(0)} %`],
      ['TEMP BIAS', `${(state.tempBias ?? 0).toFixed(1)} \u00b0C`],
      ['ROOF CAPTURE', `${(climate?.rainMmPerHour ?? 0).toFixed(1)} mm/h`],
    ];
    metrics.forEach(([label, value], index) => {
      const metricX = 400 + (index % 2) * 170;
      const metricY = 104 + Math.floor(index / 2) * 52;
      ctx.fillStyle = '#7fb5b0';
      ctx.font = '600 11px "Segoe UI", Arial, sans-serif';
      ctx.fillText(label, metricX, metricY);
      ctx.fillStyle = '#d9f3ea';
      ctx.font = '700 19px Consolas, "Courier New", monospace';
      ctx.fillText(value, metricX, metricY + 23);
    });

    const colours = ['#7d5a23', '#4f6168', '#245d70', '#5a2e31'];
    const activeColours = ['#b9862c', '#8fa6ad', '#38a9ca', '#c8555c'];
    order.forEach((stateId, index) => {
      const entry = LAYOUT.weather.states[stateId];
      if (!entry) return;
      const cardX = 20 + index * 184;
      const active = stateId === weather;
      ctx.fillStyle = active ? activeColours[index] : colours[index];
      roundedRect(ctx, cardX, 248, 172, 88, 10);
      ctx.fill();
      ctx.strokeStyle = active ? '#f0fbf5' : '#3c565b';
      ctx.lineWidth = active ? 2 : 1;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = active ? '#ffffff' : '#c3d5d3';
      ctx.font = '700 14px "Segoe UI", Arial, sans-serif';
      ctx.fillText(entry.label.toUpperCase(), cardX + 14, 275);
      ctx.fillStyle = active ? '#eaf8f4' : '#93aba9';
      ctx.font = '600 11px Consolas, "Courier New", monospace';
      ctx.fillText(`PPFD ${Math.round(entry.ppfdFactor * 100)}%`, cardX + 14, 298);
      ctx.fillText(
        entry.rainMmPerHour > 0
          ? `${entry.rainMmPerHour.toFixed(1)} mm/h`
          : 'NO RAIN',
        cardX + 14,
        317,
      );
      if (active) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 10px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(manual ? 'HELD' : 'AUTO', cardX + 156, 275);
      }
    });

    ctx.fillStyle = '#0a242c';
    ctx.fillRect(0, 350, WIDTH, 34);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6fc9b5';
    ctx.font = '600 12px "Segoe UI", Arial, sans-serif';
    ctx.fillText('ROTARY SELECTOR \u00b7 TAP ADVANCES', 22, 372);
    ctx.textAlign = 'right';
    ctx.fillStyle = manual ? '#ffc45c' : '#62e3b5';
    ctx.fillText(
      manual ? 'AUTO KEY AVAILABLE' : 'SCHEDULE RUNNING',
      WIDTH - 22,
      372,
    );

    this.texture.needsUpdate = true;
  }

  setTopView(active) {
    this.topView = Boolean(active);
  }

  dispose() {
    if (!this.group) return;
    this.group.parent?.remove(this.group);
    this.texture.dispose();
    this.hmiMaterial.dispose();
    for (const material of this.labelMaterials) material.dispose();
    this.group.traverse((object) => {
      if (!object.geometry) return;
      if (object.userData.sharedGeometry) return;
      object.geometry.dispose();
    });
    this.group = null;
    this.stateLights.length = 0;
    this.interactables.length = 0;
  }
}

