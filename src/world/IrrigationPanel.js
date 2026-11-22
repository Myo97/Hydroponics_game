import { LowPolyCylinderGeometry, LowPolySphereGeometry } from './LowPolyGeometry.js';
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
 * Main Irrigation Controller Panel (Version 7).
 *
 * A wall-mounted panel on the north headhouse wall with three illuminated
 * switches: Group 1 pump, Group 2 pump and the rain transfer pump. Its canvas
 * HMI mirrors live group flow, valve counts, reservoir levels, harvester level
 * and the shared four-state weather / roof-capture readout.
 */
export class IrrigationPanel {
  constructor({ materials, control = null }) {
    this.materials = materials;
    this.control = control;
    this.group = null;
    this.interactables = [];
    this.labelMaterials = [];
    this.switches = [];
    this.screen = null;
    this.hmiAccumulator = 1;
    this.hmiSignature = '';
    this.runningTime = 0;

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
      background: options.background ?? '#e7ece4',
      foreground: options.foreground ?? '#143042',
    });
    this.labelMaterials.push(material);
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  }

  build(parent) {
    const config = LAYOUT.irrigationPanel;
    const [x, z] = config.position;
    const [depth, height, width] = config.size;

    const group = new THREE.Group();
    group.name = 'main-irrigation-panel';
    group.position.set(x, 0, z);
    this.group = group;
    parent.add(group);

    group.add(
      boxMesh(width + 0.08, config.footHeight, depth + 0.05, this.materials.steelDark, V(0, config.footHeight / 2, 0), 'irrigation-panel-foot'),
    );
    group.add(
      boxMesh(width, height, depth, this.materials.cabinetPaint, V(0, height / 2 + config.footHeight, 0), 'irrigation-panel-enclosure'),
    );
    group.add(
      boxMesh(width - 0.04, height - 0.04, 0.018, this.materials.steelDark, V(0, height / 2 + config.footHeight, depth / 2 + 0.012), 'irrigation-panel-door'),
    );
    group.add(
      boxMesh(width + 0.03, 0.04, depth + 0.05, this.materials.aluminium, V(0, height + config.footHeight, 0), 'irrigation-panel-canopy'),
    );

    const [screenWidth, screenHeight] = config.screenSize;
    group.add(
      boxMesh(screenWidth + 0.09, screenHeight + 0.09, 0.04, this.materials.steelDark, V(0, 1.02, depth / 2 + 0.035), 'irrigation-panel-bezel'),
    );
    this.screen = new THREE.Mesh(
      new THREE.PlaneGeometry(screenWidth, screenHeight),
      this.hmiMaterial,
    );
    this.screen.name = 'irrigation-panel-hmi';
    this.screen.position.set(0, 1.02, depth / 2 + 0.058);
    group.add(this.screen);

    const title = this.label('MAIN IRRIGATION', 'GROUPS 1 / 2 · RAIN TRANSFER', 0.6, 0.14, {
      background: '#edf1e8',
      foreground: '#153145',
    });
    title.position.set(0, 1.31, depth / 2 + 0.06);
    group.add(title);

    const switchKeys = [
      { key: 'group1PumpOn', label: 'PUMP 1', subtitle: 'GROUP 1 · RESERVOIR 1' },
      { key: 'group2PumpOn', label: 'PUMP 2', subtitle: 'GROUP 2 · RESERVOIR 2' },
      { key: 'rainwaterTransferOn', label: 'RAIN XFER', subtitle: 'HARVESTER TOP-UP' },
    ];
    switchKeys.forEach((entry, index) => {
      const switchX = -0.27 + index * 0.27;
      const switchGroup = new THREE.Group();
      switchGroup.name = `irrigation-switch-${entry.key}`;
      switchGroup.position.set(switchX, 0.48, depth / 2 + 0.07);
      group.add(switchGroup);

      const bezel = new THREE.Mesh(
        new LowPolyCylinderGeometry(0.062, 0.062, 0.035, 18),
        this.materials.steelDark,
      );
      bezel.rotation.x = Math.PI / 2;
      switchGroup.add(bezel);

      const lever = new THREE.Group();
      lever.name = `${entry.key}-lever`;
      lever.position.z = 0.035;
      switchGroup.add(lever);
      lever.add(
        boxMesh(0.048, 0.09, 0.028, this.materials.pumpBlue, V(0, 0.045, 0.02), `${entry.key}-toggle`),
      );

      const lamp = new THREE.Mesh(
        new LowPolySphereGeometry(0.018, 10, 8),
        this.materials.ledGreen,
      );
      lamp.position.set(0, 0.083, 0.022);
      lever.add(lamp);

      const tag = this.label(entry.label, entry.subtitle, 0.24, 0.095, {
        background: '#e8ede2',
      });
      tag.position.set(switchX, 0.33, depth / 2 + 0.065);
      group.add(tag);

      const info = {
        id: `irrigation-panel-${entry.key}`,
        category: 'Irrigation control',
        title: `${entry.label} switch`,
        description:
          'Illuminated panel switch for the irrigation group pump. Switching off stops solution flow to every table in that group, even where the local table valves are open. The switch lamp mirrors the pump duty state.',
        specs: [
          ['Circuit', entry.key],
          ['Service', entry.subtitle],
          ['Switch', 'Illuminated 3-position selector'],
          ['Interlock', 'Panel HMI + local starter'],
        ],
        interactionHint: `Toggle ${entry.label}`,
        interaction: 'toggle-pump',
        pumpKey: entry.key,
      };
      lever.userData.interactable = info;
      this.interactables.push({ object: lever, data: info });
      this.switches.push({ ...entry, group: lever, lamp });
    });

    const screenInfo = {
      id: 'irrigation-panel-hmi',
      category: 'Irrigation control',
      title: 'Main irrigation controller HMI',
      description:
        'Live overview of both irrigation groups and the rainwater transfer circuit. The screen shows pump state, open table valves, flowing tables, branch flow, reservoir levels, current weather and harvester rain capture. Tap to inspect the controller.',
      specs: [
        ['Control', '2 × group pumps + rain transfer'],
        ['Supply', 'Reservoir 1 west header · Reservoir 2 east header'],
        ['Valves', '18 × quarter-turn table isolation valves'],
        ['Weather link', 'Block 4 four-state selector'],
      ],
      interactionHint: 'Inspect irrigation controller',
      interaction: 'inspect',
    };
    this.screen.userData.interactable = screenInfo;
    this.interactables.push({ object: this.screen, data: screenInfo });

    const footer = this.label('RAIN CAPTURE', 'ROOF / HARVESTER / TRANSFER', width - 0.08, 0.06, {
      background: '#dde6df',
      foreground: '#245446',
    });
    footer.position.set(0, 0.2, depth / 2 + 0.062);
    group.add(footer);

    return this;
  }


  format(value, digits = 2, fallback = '--') {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits) : fallback;
  }

  drawHMI(waterSnapshot) {
    const ctx = this.ctx;
    const control = this.control;
    const groups = waterSnapshot?.groups ?? [];
    const rainRate = waterSnapshot?.rainMmPerHour ?? 0;
    const harvester = waterSnapshot?.harvester ?? {};

    const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    background.addColorStop(0, '#0b2f39');
    background.addColorStop(1, '#071d26');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = '#e8f4ee';
    ctx.font = '700 24px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('MAIN IRRIGATION CONTROLLER', 20, 36);
    ctx.fillStyle = '#6fc9b5';
    ctx.font = '600 13px Consolas, "Courier New", monospace';
    ctx.fillText('2 GROUPS · 18 TABLE VALVES', 22, 56);

    ctx.textAlign = 'right';
    ctx.fillStyle = rainRate > 0 ? '#8fdcf0' : '#f0c46a';
    ctx.font = '700 16px Consolas, "Courier New", monospace';
    ctx.fillText(rainRate > 0 ? 'RAIN CAPTURE' : 'NO RAIN', WIDTH - 20, 31);
    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 12px "Segoe UI", Arial, sans-serif';
    ctx.fillText(
      `${waterSnapshot?.weatherLabel ?? 'Sunny'} / ${rainRate.toFixed(1)} mm/h`,
      WIDTH - 20,
      52,
    );

    groups.slice(0, 2).forEach((group, index) => {
      const cardX = 20 + index * 366;
      const on = Boolean(group.pumpOn);
      ctx.fillStyle = on ? 'rgba(24, 82, 74, 0.95)' : 'rgba(43, 51, 54, 0.95)';
      roundedRect(ctx, cardX, 72, 348, 158, 12);
      ctx.fill();
      ctx.strokeStyle = on ? '#4fc7a1' : '#526163';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = on ? '#62e3b5' : '#7f8d8c';
      ctx.font = '700 17px "Segoe UI", Arial, sans-serif';
      const groupName = group.name || 'GROUP ' + (index + 1);
      ctx.fillText(groupName + ' · ' + (on ? 'RUN' : 'OFF'), cardX + 16, 102);
      ctx.fillStyle = '#9bc4bd';
      ctx.font = '600 12px Consolas, "Courier New", monospace';
      ctx.fillText((group.label ?? group.reservoirName ?? '').slice(0, 42), cardX + 16, 122);

      ctx.fillStyle = '#d9f3ea';
      ctx.font = '700 34px Consolas, "Courier New", monospace';
      ctx.fillText(String(Math.round(group.flow ?? 0)), cardX + 16, 166);
      ctx.fillStyle = '#78a8a4';
      ctx.font = '600 12px "Segoe UI", Arial, sans-serif';
      ctx.fillText('L/min branch flow', cardX + 16, 183);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#d9f3ea';
      ctx.font = '700 20px Consolas, "Courier New", monospace';
      ctx.fillText((group.flowingTables ?? 0) + ' / ' + (group.openValves ?? 0), cardX + 332, 160);
      ctx.fillStyle = '#78a8a4';
      ctx.font = '600 12px "Segoe UI", Arial, sans-serif';
      ctx.fillText('flowing / open valves', cardX + 332, 178);
      ctx.fillStyle = '#9bc4bd';
      ctx.font = '600 12px Consolas, "Courier New", monospace';
      ctx.fillText('TANK ' + Math.round((group.tankLevel ?? 0) * 100) + '%', cardX + 332, 205);
    });

    ctx.fillStyle = '#0d2b33';
    roundedRect(ctx, 20, 244, 714, 92, 10);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 12px "Segoe UI", Arial, sans-serif';
    ctx.fillText('RAIN TRANSFER PUMP', 34, 268);
    const transferOn = Boolean(control?.pumps?.rainwaterTransferOn);
    ctx.fillStyle = transferOn ? '#5ce1a9' : '#8b9999';
    ctx.font = '700 16px "Segoe UI", Arial, sans-serif';
    ctx.fillText(transferOn ? 'RUNNING' : 'OFF', 34, 290);
    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 12px "Segoe UI", Arial, sans-serif';
    ctx.fillText('HARVESTER', 206, 268);
    ctx.fillStyle = '#d9f3ea';
    ctx.font = '700 22px Consolas, "Courier New", monospace';
    ctx.fillText(Math.round((harvester.level ?? 0) * 100) + '%', 206, 293);
    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 12px "Segoe UI", Arial, sans-serif';
    ctx.fillText('RAIN CAPTURE', 340, 268);
    ctx.fillStyle = '#8fdcf0';
    ctx.font = '700 18px Consolas, "Courier New", monospace';
    ctx.fillText(this.format(waterSnapshot?.rainInflow, 2, '0.00') + ' L/s', 340, 292);
    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 12px "Segoe UI", Arial, sans-serif';
    ctx.fillText('TOTAL FLOW', 520, 268);
    ctx.fillStyle = '#d9f3ea';
    ctx.font = '700 20px Consolas, "Courier New", monospace';
    ctx.fillText((waterSnapshot?.flowRate ?? 0) + ' L/min', 520, 291);
    ctx.fillStyle = rainRate > 0 ? '#8fdcf0' : '#8b9999';
    ctx.font = '700 12px "Segoe UI", Arial, sans-serif';
    ctx.fillText(rainRate > 0 ? 'ROOF RUN-OFF ACTIVE' : 'ROOF DRY', 520, 316);

    ctx.fillStyle = '#0a242c';
    ctx.fillRect(0, 348, WIDTH, 36);
    ctx.fillStyle = '#6fc9b5';
    ctx.font = '600 12px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('GROUP 1 · RESERVOIR 1 / WEST ROWS', 22, 371);
    ctx.fillText('GROUP 2 · RESERVOIR 2 / EAST ROWS', 300, 371);
    ctx.textAlign = 'right';
    ctx.fillStyle = groups.some((group) => group.pumpOn) ? '#5ce1a9' : '#f0b04a';
    ctx.fillText(
      groups.some((group) => group.pumpOn) ? 'IRRIGATION ACTIVE' : 'ALL PUMPS OFF',
      WIDTH - 22,
      371,
    );

    this.texture.needsUpdate = true;
  }

  update(dt, waterSnapshot = null) {
    if (!this.group) return;
    this.runningTime += dt;

    for (const entry of this.switches) {
      const on = this.control ? Boolean(this.control.pumps[entry.key]) : true;
      const target = on ? 0 : -Math.PI / 2.6;
      entry.group.rotation.x +=
        (target - entry.group.rotation.x) * Math.min(1, dt * 9);
      entry.lamp.material = on ? this.materials.ledGreen : this.materials.ledRed;
      entry.lamp.visible = on || Math.sin(this.runningTime * 2.4) > 0.72;
    }

    this.hmiAccumulator += dt;
    if (this.hmiAccumulator < 0.3 || !waterSnapshot) return;
    this.hmiAccumulator = 0;

    const signature = [
      this.control?.pumps?.group1PumpOn,
      this.control?.pumps?.group2PumpOn,
      this.control?.pumps?.rainwaterTransferOn,
      waterSnapshot.flowRate,
      waterSnapshot.weatherLabel,
      waterSnapshot.rainInflow,
      waterSnapshot.harvester?.level,
      ...(waterSnapshot.groups ?? []).flatMap((group) => [
        group.flow,
        group.openValves,
        group.flowingTables,
        Math.round((group.tankLevel ?? 0) * 100),
      ]),
    ].join('|');
    if (signature === this.hmiSignature) return;
    this.hmiSignature = signature;
    this.drawHMI(waterSnapshot);
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
    this.switches.length = 0;
    this.interactables.length = 0;
  }
}

