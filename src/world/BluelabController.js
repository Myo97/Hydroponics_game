import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { CylinderBatch, boxMesh } from './Batches.js';

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
 * Bluelab Pro Controller + three-channel dosing station (Version 3).
 *
 * The enclosure sits on the south wall beside the nutrient stock tanks. It
 * carries a live HMI, three peristaltic dosing pumps (A / B / pH Down), six
 * table selector valves, and two independent probe sets (EC and pH) in a
 * sample flow cell.
 */
export class BluelabController {
  constructor({ materials, control = null }) {
    this.materials = materials;
    this.control = control;
    this.group = null;
    this.interactables = [];
    this.labelMaterials = [];
    this.pumps = [];
    this.selectors = [];
    this.screen = null;
    this.beacon = null;
    this.runningTime = 0;
    this.hmiAccumulator = 1;
    this.hmiSignature = '';
    this.localSelectedTank = 0;

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
      background: options.background ?? '#e9efe6',
      foreground: options.foreground ?? '#153145',
    });
    this.labelMaterials.push(material);
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  }

  build(parent) {
    const config = LAYOUT.bluelab;
    const [x, z] = config.position;
    const [depth, height, width] = config.size;

    const group = new THREE.Group();
    group.name = 'bluelab-controller';
    group.position.set(x, 0, z);
    this.group = group;
    parent.add(group);

    // Skid and enclosure shell. The service face looks west into the house.
    group.add(boxMesh(depth + 0.08, 0.07, width + 0.08, this.materials.steelDark, V(0, 0.035, 0), 'bluelab-skid'));
    group.add(boxMesh(0.035, height, width, this.materials.cabinetPaint, V(depth / 2 - 0.017, height / 2, 0), 'bluelab-back-panel'));
    for (const side of [-1, 1]) {
      group.add(
        boxMesh(depth, height, 0.04, this.materials.cabinetPaint, V(0, height / 2, side * (width / 2 - 0.02)), 'bluelab-side-panel'),
      );
    }
    group.add(boxMesh(depth, 0.04, width, this.materials.cabinetPaint, V(0, height - 0.02, 0), 'bluelab-top'));
    group.add(boxMesh(depth, 0.04, width, this.materials.cabinetPaint, V(0, 0.09, 0), 'bluelab-bottom'));
    group.add(boxMesh(depth + 0.09, 0.035, width + 0.08, this.materials.aluminium, V(0, height + 0.035, 0), 'bluelab-canopy'));

    const [screenWidth, screenHeight] = config.screenSize;
    group.add(
      boxMesh(0.04, screenHeight + 0.09, screenWidth + 0.09, this.materials.steelDark, V(-depth / 2 + 0.035, 1.18, 0), 'bluelab-bezel'),
    );
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(screenWidth, screenHeight), this.hmiMaterial);
    this.screen.name = 'bluelab-hmi';
    this.screen.rotation.y = -Math.PI / 2;
    this.screen.position.set(-depth / 2 + 0.012, 1.18, 0);
    group.add(this.screen);

    group.add(
      boxMesh(0.04, 0.6, width - 0.04, this.materials.cabinetPaint, V(-depth / 2 + 0.055, 0.4, 0), 'bluelab-pump-panel'),
    );

    // Top status beacon mirrors the dosing / alarm state.
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 0.075, 14),
      this.materials.ledGreen,
    );
    this.beacon.position.set(0, height + 0.095, -0.36);
    group.add(this.beacon);

    const title = this.label('BLUELAB', 'PRO CONTROLLER · DOSING STATION', 0.58, 0.14, {
      background: '#eef1e8',
      foreground: '#153145',
    });
    title.rotation.y = -Math.PI / 2;
    title.position.set(-depth / 2 - 0.002, 1.48, 0);
    group.add(title);

    const screenInfo = {
      id: 'bluelab-hmi',
      category: 'Nutrient dosing',
      title: 'Bluelab Pro Controller HMI',
      description:
        'Live controller face for the selected clean-water reservoir. It shows EC, pH, solution temperature and level, and the status of all three dosing channels. Tap to cycle the monitored reservoir between Reservoir 1 and Reservoir 2; the same selection is mirrored on the climate cabinet.',
      specs: [
        ['Controller', 'Bluelab Pro · 2 probe sets'],
        ['Dosing', '3 × peristaltic · A / B / pH Down'],
        ['Selectors', '6 table isolation valves'],
        ['Setpoint', 'EC 1.80 · pH 5.90'],
        ['Selection', 'Tap cycles Reservoir 1 / Reservoir 2'],
      ],
      interactionHint: 'Select reservoir',
      interaction: 'cycle-tank',
    };
    this.screen.userData.interactable = screenInfo;
    this.interactables.push({ object: this.screen, data: screenInfo });

    // Three peristaltic dosing pumps across the lower service panel.
    ['a', 'b', 'c'].forEach((key, index) => {
      const pumpZ = -0.3 + index * 0.3;
      const pumpGroup = new THREE.Group();
      pumpGroup.name = `bluelab-dosing-pump-${key}`;
      pumpGroup.position.set(-depth / 2 - 0.02, 0.5, pumpZ);
      group.add(pumpGroup);

      pumpGroup.add(boxMesh(0.16, 0.24, 0.19, this.materials.pumpBlue, V(-0.035, 0, 0), 'dosing-pump-body'));
      const rotor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.05, 16),
        this.materials.stainless,
      );
      rotor.rotation.z = Math.PI / 2;
      rotor.position.set(-0.135, 0.02, 0);
      pumpGroup.add(rotor);
      for (let roller = 0; roller < 3; roller += 1) {
        const pin = new THREE.Mesh(
          new THREE.CylinderGeometry(0.011, 0.011, 0.06, 8),
          this.materials.steelDark,
        );
        pin.rotation.z = Math.PI / 2;
        pin.position.set(
          -0.138,
          0.02 + Math.cos((roller / 3) * Math.PI * 2) * 0.032,
          Math.sin((roller / 3) * Math.PI * 2) * 0.032,
        );
        pumpGroup.add(pin);
      }
      const tube = new THREE.Mesh(
        new THREE.TorusGeometry(0.072, 0.011, 6, 20, Math.PI),
        this.materials.pvcWhite,
      );
      tube.rotation.y = Math.PI / 2;
      tube.position.set(-0.14, 0.02, 0);
      pumpGroup.add(tube);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), this.materials.ledGreen);
      lamp.position.set(-0.12, 0.085, 0.08);
      pumpGroup.add(lamp);
      const tag = this.label(
        key === 'c' ? 'pH DOWN' : `NUTRIENT ${key.toUpperCase()}`,
        key === 'c' ? 'CH-C' : `CH-${key.toUpperCase()}`,
        0.23,
        0.085,
        { background: '#e8eee4' },
      );
      tag.rotation.y = -Math.PI / 2;
      tag.position.set(-0.118, -0.075, 0);
      pumpGroup.add(tag);

      this.pumps.push({ key, group: pumpGroup, rotor, lamp });

      const info = {
        id: `dosing-pump-${key}`,
        category: 'Nutrient dosing',
        title: `Dosing pump ${key === 'c' ? 'pH Down' : key.toUpperCase()}`,
        description:
          'Peristaltic dosing channel with a three-roller rotor and a calibrated squeeze tube. The controller pulses the pump whenever the selected tank drifts away from its EC or pH setpoint. Tap to enable or disable this channel.',
        specs: [
          ['Channel', key.toUpperCase()],
          ['Pump', 'Peristaltic · 1.6 L/h'],
          ['Duty', 'Pulsed · 1 s minimum'],
          ['Interlock', 'Circulation pump running'],
          ['Feedback', 'EC / pH probe set'],
        ],
        interactionHint: 'Toggle dosing pump',
        interaction: 'toggle-dosing',
        dosingKey: key,
      };
      pumpGroup.userData.interactable = info;
      this.interactables.push({ object: pumpGroup, data: info });
    });

    // Six table selector valves below the HMI.
    const selectorY = 0.82;
    for (let index = 0; index < 6; index += 1) {
      const selectorZ = -0.4 + index * 0.16;
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.028, 0.07, 12),
        this.materials.stainless,
      );
      body.rotation.z = Math.PI / 2;
      body.position.set(-0.225, selectorY, selectorZ);
      body.castShadow = true;
      group.add(body);

      const lever = new THREE.Group();
      lever.name = `selector-valve-${index + 1}`;
      lever.position.set(-0.262, selectorY, selectorZ);
      group.add(lever);
      lever.add(boxMesh(0.016, 0.085, 0.016, this.materials.pumpBlue, V(0, 0.042, 0), 'selector-lever'));
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), this.materials.ledRed);
      knob.position.y = 0.088;
      lever.add(knob);

      const info = {
        id: `table-selector-${index + 1}`,
        category: 'Nutrient dosing',
        title: `Table selector valve ${index + 1}`,
        description:
          'Manual isolation valve on the controller selector rail. Each valve can isolate one NFT table from the dosed supply for maintenance without stopping the rest of the bay. Tap to open or close it; the lever rotates a quarter turn.',
        specs: [
          ['Selector', `${index + 1} of 6`],
          ['Type', 'Quarter-turn ball valve'],
          ['Port', 'DN20 · PVC body'],
          ['Normally', 'Open'],
        ],
        interactionHint: 'Toggle selector valve',
        interaction: 'toggle-selector',
        selectorIndex: index,
      };
      lever.userData.interactable = info;
      this.interactables.push({ object: lever, data: info });
      this.selectors.push({ index, group: lever, open: true });
    }

    const selectorLabel = this.label('TABLE SELECTORS', '1 · 2 · 3 · 4 · 5 · 6', 0.78, 0.065, {
      background: '#e7ece2',
    });
    selectorLabel.rotation.y = -Math.PI / 2;
    selectorLabel.position.set(-depth / 2 + 0.008, 0.905, 0);
    group.add(selectorLabel);

    // Two independent probe sets in a sample flow cell on the service side.
    const cables = new CylinderBatch(this.materials.rubber);
    const probeSets = [
      { key: 'ec', title: 'EC PROBE', z: 0.61, tint: this.materials.ledGreen },
      { key: 'ph', title: 'pH PROBE', z: -0.61, tint: this.materials.ledAmber },
    ];
    this.probes = [];
    probeSets.forEach((probe) => {
      const cell = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 0.56, 16),
        this.materials.glass,
      );
      cell.position.set(0.08, 0.35, probe.z);
      cell.castShadow = true;
      group.add(cell);
      group.add(boxMesh(0.2, 0.06, 0.22, this.materials.steelDark, V(0.08, 0.1, probe.z), `${probe.key}-flow-cell-base`));
      group.add(boxMesh(0.2, 0.04, 0.22, this.materials.steelDark, V(0.08, 0.64, probe.z), `${probe.key}-flow-cell-top`));

      const probeBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.026, 0.026, 0.3, 12),
        this.materials.stainless,
      );
      probeBody.position.set(0.08, 0.62, probe.z);
      group.add(probeBody);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 12), probe.tint);
      cap.position.set(0.08, 0.79, probe.z);
      group.add(cap);

      for (let sample = 0; sample < 5; sample += 1) {
        cables.add(
          V(0.08, 0.34 - sample * 0.045, probe.z + 0.045),
          V(0.08, 0.3 - sample * 0.045, probe.z + 0.045),
          0.006,
        );
      }
      cables.addPath(
        [
          V(0.08, 0.81, probe.z),
          V(0.14, 0.99, probe.z),
          V(0.2, 1.22, probe.z),
          V(0.21, 1.34, probe.z * 0.3),
          V(0.21, 1.34, probe.z > 0 ? 0.45 : -0.45),
        ],
        0.009,
      );

      const tag = this.label(probe.title, probe.key === 'ec' ? 'PROBE SET 1' : 'PROBE SET 2', 0.2, 0.07, {
        background: probe.key === 'ec' ? '#dcebdc' : '#f1e9d5',
      });
      tag.rotation.y = -Math.PI / 2;
      tag.position.set(-0.018, 0.18, probe.z);
      group.add(tag);

      const info = {
        id: `${probe.key}-probe-set`,
        category: 'Nutrient dosing',
        title: probe.title,
        description:
          'Independent probe set in a sample flow cell. EC and pH are measured on separate probes so a single contaminated sensor cannot mask a dosing fault. The flow cell is fed from the dosed supply and drains back to the return tank.',
        specs: [
          ['Measurement', probe.key === 'ec' ? 'Electrical conductivity' : 'pH / temperature'],
          ['Range', probe.key === 'ec' ? '0.0 – 5.0 EC' : 'pH 0.0 – 14.0'],
          ['Flow cell', 'Continuous sample · 2 L/min'],
          ['Calibration', 'Weekly · 4.0 EC / pH 7'],
        ],
        interactionHint: 'Inspect probe',
        interaction: 'inspect',
      };
      group.add(cell);
      cell.userData.interactable = info;
      this.interactables.push({ object: cell, data: info });
      this.probes.push({ key: probe.key, cell, cap });
    });

    // Stock suction tubing runs along the south wall to tanks A, B and C.
    const dosingTubes = new CylinderBatch(this.materials.pvcWhite);
    const stockXs = [0.4, 1.35, 2.3];
    stockXs.forEach((stockX, index) => {
      const pumpZ = -0.3 + index * 0.3;
      const localX = stockX - x;
      const backZ = -0.98 - index * 0.05;
      dosingTubes.addPath(
        [
          V(-0.35, 0.38, pumpZ),
          V(-0.5, 0.24, pumpZ),
          V(-0.5, 0.17 + index * 0.012, backZ),
          V(localX, 0.17 + index * 0.012, backZ),
          V(localX, 0.28, 0.5),
          V(localX, 0.55, 0.65),
        ],
        0.011,
      );
    });
    dosingTubes.addPath(
      [
        V(-0.3, 0.3, 0.3),
        V(-0.8, 0.2, 0.3),
        V(-0.8, 0.2, 1.15),
        V(1.35 - x, 0.2, 1.51),
        V(1.35 - x, 0.34, 1.51),
      ],
      0.012,
    );
    dosingTubes.build(group, 'bluelab-dosing-tubing');

    // A short bunded drip tray keeps spills away from the walkway.
    group.add(boxMesh(0.86, 0.05, 1.24, this.materials.concretePlinth, V(-0.02, 0.025, 0), 'bluelab-bund-tray'));

    group.userData.colliders = [
      { x, z, halfX: depth / 2 + 0.1, halfZ: width / 2 + 0.62 },
    ];
    group.userData.interactables = this.interactables;
    group.userData.screen = this.screen;

    cables.build(group, 'bluelab-probe-cables');

    group.userData.colliders = [
      { x, z, halfX: depth / 2 + 0.1, halfZ: width / 2 + 0.62 },
    ];
    group.userData.interactables = this.interactables;
    group.userData.screen = this.screen;

    return this;
  }

  /** Enable / disable a peristaltic channel from a world interaction. */
  toggleDosing(key) {
    if (!this.control) return false;
    this.control.toggleDosingPump(key);
    this.hmiAccumulator = 1;
    return this.control.dosing[key]?.enabled ?? false;
  }

  /** Cycle the reservoir monitored by the HMI and the climate cabinet. */
  cycleTank() {
    if (!this.control) return 0;
    this.control.cycleTank();
    this.hmiAccumulator = 1;
    return this.control.selectedTank;
  }

  /** Quarter-turn a selector valve lever; mirrored on the table header valve. */
  toggleSelector(index) {
    const selector = this.selectors[index];
    if (!selector) return false;
    const tableId = this.control ? Array.from(this.control.tables.keys())[index] : null;
    if (tableId) {
      selector.open = this.control.toggleTableValve(tableId);
    } else {
      selector.open = !selector.open;
    }
    this.hmiAccumulator = 1;
    return selector.open;
  }

  update(dt, waterSnapshot = null) {
    if (!this.group) return;
    this.runningTime += dt;

    const selectedIndex = this.control?.selectedTank ?? 0;
    const tank = waterSnapshot?.tanks?.[selectedIndex] ?? null;
    const dosing = this.control?.dosing ?? {};

    for (const pump of this.pumps) {
      const channel = dosing[pump.key];
      const enabled = channel?.enabled ?? true;
      const running = enabled && (channel?.output ?? 0) > 0.01;
      if (running) {
        pump.rotor.rotation.y += dt * (7 + (channel.output ?? 0) * 8);
        pump.lamp.visible = Math.sin(this.runningTime * 7) > -0.35;
      } else {
        pump.lamp.visible = enabled;
      }
      pump.lamp.scale.setScalar(enabled ? 1 : 0.55);
    }

    const tableIds = this.control ? Array.from(this.control.tables.keys()) : [];
    for (const selector of this.selectors) {
      const tableId = tableIds[selector.index];
      if (tableId) selector.open = this.control.isTableValveOpen(tableId);
      const target = selector.open ? 0 : Math.PI / 2;
      selector.group.rotation.x += (target - selector.group.rotation.x) * Math.min(1, dt * 8);
    }

    if (this.beacon) {
      const alarm = this.isAlarm(tank);
      this.beacon.material = alarm ? this.materials.ledRed : this.materials.ledGreen;
      const pulse = alarm ? 0.6 + Math.abs(Math.sin(this.runningTime * 4)) * 0.8 : 0.9;
      this.beacon.scale.setScalar(pulse);
    }

    this.hmiAccumulator += dt;
    if (this.hmiAccumulator < 0.35 || !waterSnapshot) return;
    this.hmiAccumulator = 0;

    const signature = [
      selectedIndex,
      tank?.code ?? '',
      this.format(tank?.ec, 2),
      this.format(tank?.ph, 2),
      this.format(tank?.temp, 1),
      this.format(tank?.level, 2),
      dosing.a?.enabled,
      dosing.b?.enabled,
      dosing.c?.enabled,
      this.selectors.filter((entry) => entry.open).length,
    ].join(';');
    if (signature === this.hmiSignature) return;
    this.hmiSignature = signature;
    this.drawHMI(waterSnapshot);
  }

  format(value, digits = 2) {
    return Number.isFinite(value) ? value.toFixed(digits) : '--';
  }

  isAlarm(tank) {
    if (!tank) return false;
    const fertilised = (tank.targetEc ?? 0) >= 1;
    if (fertilised && Number.isFinite(tank.ec) && (tank.ec < 1.2 || tank.ec > 2.6)) return true;
    if (fertilised && Number.isFinite(tank.ph) && (tank.ph < 5.4 || tank.ph > 6.4)) return true;
    if (Number.isFinite(tank.level) && tank.level < 0.12) return true;
    return false;
  }

  drawHMI(data) {
    const ctx = this.ctx;
    const selectedIndex = this.control?.selectedTank ?? 0;
    const tank = data?.tanks?.[selectedIndex] ?? data?.tanks?.[0] ?? null;
    const alarm = this.isAlarm(tank);
    const accent = alarm ? '#f0b04a' : '#5ce1a9';
    const ec = Number.isFinite(tank?.ec) ? tank.ec : 1.8;
    const ph = Number.isFinite(tank?.ph) ? tank.ph : 5.9;
    const temp = Number.isFinite(tank?.temp) ? tank.temp : 20.4;
    const level = THREE.MathUtils.clamp(tank?.level ?? 0.72, 0, 1);
    const label = tank?.name ?? (selectedIndex === 0 ? 'Reservoir 1' : 'Reservoir 2');

    const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    background.addColorStop(0, '#0b2430');
    background.addColorStop(1, '#050f16');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = 'rgba(120, 215, 195, 0.024)';
    for (let y = 0; y < HEIGHT; y += 4) ctx.fillRect(0, y, WIDTH, 1);

    ctx.fillStyle = '#0c2f39';
    ctx.fillRect(0, 0, WIDTH, 64);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 61, WIDTH, 3);

    ctx.fillStyle = '#edf8f2';
    ctx.font = '700 26px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('BLUELAB', 22, 25);
    ctx.fillStyle = '#7fb5ae';
    ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
    ctx.fillText('PRO CONTROLLER · NUTRIENT DOSING', 22, 47);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#e8f7f3';
    ctx.font = '700 30px Consolas, "Courier New", monospace';
    ctx.fillText(label, WIDTH - 22, 25);
    ctx.fillStyle = alarm ? '#f0b04a' : '#5ce1a9';
    ctx.beginPath();
    ctx.arc(WIDTH - 182, 47, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8fc4be';
    ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
    ctx.fillText(alarm ? 'OUT OF RANGE' : 'DOSING AUTO', WIDTH - 22, 47);

    const metrics = [
      { label: 'EC', value: ec.toFixed(2), unit: 'mS/cm', sub: 'SET 1.80', tone: '#72d9ce' },
      { label: 'pH', value: ph.toFixed(2), unit: 'pH', sub: 'SET 5.90', tone: '#f2d06f' },
      { label: 'TEMP', value: temp.toFixed(1), unit: '°C', sub: 'SET 20.0', tone: '#8fb9f0' },
    ];
    const cardWidth = 226;
    metrics.forEach((metric, index) => {
      const cardX = 22 + index * (cardWidth + 14);
      ctx.fillStyle = 'rgba(18, 54, 63, 0.92)';
      roundedRect(ctx, cardX, 78, cardWidth, 116, 12);
      ctx.fill();
      ctx.fillStyle = 'rgba(115, 201, 188, 0.22)';
      roundedRect(ctx, cardX, 78, cardWidth, 3, 2);
      ctx.fill();
      ctx.fillStyle = '#83b6b0';
      ctx.font = '600 14px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(metric.label, cardX + 16, 101);
      ctx.fillStyle = metric.tone;
      ctx.font = '700 46px Consolas, "Courier New", monospace';
      ctx.fillText(metric.value, cardX + 16, 143);
      ctx.fillStyle = '#7fb5b0';
      ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
      ctx.fillText(metric.unit, cardX + 16, 173);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#5f8d90';
      ctx.font = '600 12px Consolas, "Courier New", monospace';
      ctx.fillText(metric.sub, cardX + cardWidth - 16, 173);
    });

    // Level bar
    ctx.textAlign = 'left';
    ctx.fillStyle = '#83b6b0';
    ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
    ctx.fillText('TANK LEVEL', 22, 222);
    ctx.fillStyle = '#0d3038';
    roundedRect(ctx, 22, 234, 672, 18, 8);
    ctx.fill();
    const levelWidth = Math.max(8, 672 * level);
    const levelGradient = ctx.createLinearGradient(22, 0, 22 + levelWidth, 0);
    levelGradient.addColorStop(0, '#2f9a8b');
    levelGradient.addColorStop(1, level < 0.2 ? '#e6a94a' : '#63dfc0');
    ctx.fillStyle = levelGradient;
    roundedRect(ctx, 22, 234, levelWidth, 18, 8);
    ctx.fill();
    ctx.fillStyle = '#d9f3ea';
    ctx.font = '700 15px Consolas, "Courier New", monospace';
    ctx.fillText(`${Math.round(level * 100)}%`, 24 + Math.min(levelWidth + 12, 620), 222);

    const dosing = this.control?.dosing ?? {};
    const channels = [
      { key: 'a', title: 'NUTRIENT A' },
      { key: 'b', title: 'NUTRIENT B' },
      { key: 'c', title: 'pH DOWN' },
    ];
    channels.forEach((channel, index) => {
      const channelX = 22 + index * 172;
      const info = dosing[channel.key] ?? { enabled: false, output: 0 };
      const on = Boolean(info.enabled);
      ctx.fillStyle = on ? 'rgba(30, 92, 86, 0.95)' : 'rgba(45, 52, 54, 0.9)';
      roundedRect(ctx, channelX, 272, 158, 58, 10);
      ctx.fill();
      ctx.fillStyle = on ? '#5ce1a9' : '#6d7a7a';
      ctx.beginPath();
      ctx.arc(channelX + 18, 292, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = on ? '#e5f7ef' : '#8b9999';
      ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(channel.title, channelX + 32, 293);
      ctx.fillStyle = '#78a8a4';
      ctx.font = '600 12px Consolas, "Courier New", monospace';
      ctx.fillText(
        on ? `RUN ${Math.round((info.output ?? 0) * 100)}%` : 'OFF · INTERLOCK',
        channelX + 14,
        317,
      );
    });

    ctx.fillStyle = '#0d2b33';
    ctx.fillRect(0, 344, WIDTH, 40);
    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 12px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('SELECTORS OPEN', 22, 364);
    ctx.fillStyle = '#d9f3ea';
    ctx.font = '700 13px Consolas, "Courier New", monospace';
    ctx.fillText(`${this.selectors.filter((entry) => entry.open).length} / 6`, 150, 364);
    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 12px "Segoe UI", Arial, sans-serif';
    ctx.fillText('SETPOINT', 336, 364);
    ctx.fillStyle = '#d9f3ea';
    ctx.font = '700 13px Consolas, "Courier New", monospace';
    ctx.fillText('EC 1.80 · pH 5.90', 414, 364);
    ctx.fillStyle = alarm ? '#f0b04a' : '#5ce1a9';
    ctx.textAlign = 'right';
    ctx.font = '700 12px "Segoe UI", Arial, sans-serif';
    ctx.fillText(alarm ? 'ALARM · CHECK PROBES' : 'TAP · SELECT TANK', WIDTH - 22, 364);

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
    this.interactables.length = 0;
  }
}
