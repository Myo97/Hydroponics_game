import * as THREE from 'three';

const WIDTH = 1024;
const HEIGHT = 512;
const DEGREE = '\u00B0';

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

function readTank(water, index) {
  const tanks = water?.tanks ?? [];
  if (tanks.length > 0) return tanks[Math.min(index, tanks.length - 1)] ?? null;
  return null;
}

/**
 * Canvas-rendered controller face for the shared climate cabinet.
 * The display is redrawn at ~3 Hz only when a value changes, then uploaded as a
 * single texture. It intentionally uses an unlit material so the figures stay
 * readable inside the shadowed cabinet.
 *
 * Version 3 adds the selected storage tank, solution EC / pH / temperature,
 * per-bay totals and the three Bluelab dosing channels.
 */
export class DashboardDisplay {
  constructor({ materials }) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.material = materials.createScreenMaterial(this.texture);

    this.accumulator = 1;
    this.lastSignature = '';
    this.draw(null, null, null);
  }

  update(dt, climate, control = null, water = null) {
    this.accumulator += dt;
    if (this.accumulator < 0.32) return;
    this.accumulator = 0;
    if (!climate) return;

    const data = climate.snapshot();
    const selected = control?.selectedTank ?? 0;
    const tank = readTank(water, selected);
    const signature = [
      data.clock,
      data.airTemp.toFixed(1),
      data.humidity.toFixed(0),
      data.vpd.toFixed(2),
      data.ppfd,
      data.dliToday.toFixed(1),
      data.ec.toFixed(2),
      data.ph.toFixed(2),
      data.status.join('|'),
      selected,
      tank?.code ?? '',
      Number.isFinite(tank?.ec) ? tank.ec.toFixed(2) : '',
      Number.isFinite(tank?.ph) ? tank.ph.toFixed(2) : '',
      Number.isFinite(tank?.temp) ? tank.temp.toFixed(1) : '',
      Number.isFinite(tank?.level) ? tank.level.toFixed(2) : '',
      control?.dosing?.a?.enabled,
      control?.dosing?.b?.enabled,
      control?.dosing?.c?.enabled,
      water?.returnTank?.level?.toFixed?.(2) ?? '',
      water?.harvester?.level?.toFixed?.(2) ?? '',
      water?.flowRate ?? '',
    ].join(';');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.draw(data, control, water);
  }

  draw(data, control, water) {
    const ctx = this.ctx;
    const selected = control?.selectedTank ?? 0;
    const tank = readTank(water, selected);
    const tankEc = Number.isFinite(tank?.ec) ? tank.ec : data?.ec;
    const tankPh = Number.isFinite(tank?.ph) ? tank.ph : data?.ph;
    const tankTemp = Number.isFinite(tank?.temp) ? tank.temp : water?.solution?.waterTemp;
    const tankLevel = THREE.MathUtils.clamp(
      Number.isFinite(tank?.level) ? tank.level : 0.7,
      0,
      1,
    );

    const monitoredFeed = (tank?.targetEc ?? 2) >= 1;
    const solutionAlarm =
      (monitoredFeed && Number.isFinite(tankEc) && (tankEc < 1.2 || tankEc > 2.6)) ||
      (monitoredFeed && Number.isFinite(tankPh) && (tankPh < 5.4 || tankPh > 6.4)) ||
      (Number.isFinite(tank?.level) && tank.level < 0.12);
    const alarm = Boolean(data?.isAlarm) || solutionAlarm;
    const accent = alarm ? '#f2b24b' : '#65e0bc';

    const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    background.addColorStop(0, '#0b222b');
    background.addColorStop(1, '#061218');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = 'rgba(116, 210, 193, 0.025)';
    for (let y = 0; y < HEIGHT; y += 4) ctx.fillRect(0, y, WIDTH, 1);

    // Header.
    ctx.fillStyle = '#0d2b35';
    ctx.fillRect(0, 0, WIDTH, 88);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 84, WIDTH, 3);

    ctx.fillStyle = '#e8f7f3';
    ctx.font = '700 34px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('GREENCTRL 400', 30, 34);

    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 17px "Segoe UI", Arial, sans-serif';
    ctx.fillText('CLIMATE \u00B7 NUTRIENT \u00B7 NFT HOUSE 4 \u00B7 AUTO', 30, 63);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#e8f7f3';
    ctx.font = '700 32px Consolas, "Courier New", monospace';
    ctx.fillText(data?.clock ?? '10:42', WIDTH - 30, 34);

    ctx.fillStyle = alarm ? '#f2b24b' : '#5ce1a9';
    ctx.beginPath();
    ctx.arc(WIDTH - 180, 64, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8fc4be';
    ctx.font = '600 15px "Segoe UI", Arial, sans-serif';
    ctx.fillText(alarm ? 'ALARM' : 'ONLINE', WIDTH - 30, 64);

    const tiles = [
      {
        label: 'AIR TEMP',
        value: data ? data.airTemp.toFixed(1) : '--.-',
        unit: `${DEGREE}C`,
        tone: '#72d9ce',
        sub: 'SETPOINT 21.5',
      },
      {
        label: 'HUMIDITY',
        value: data ? data.humidity.toFixed(0) : '--',
        unit: '% RH',
        tone: '#72d9ce',
        sub: 'TARGET 60-75 %',
      },
      {
        label: 'VPD',
        value: data ? data.vpd.toFixed(2) : '-.--',
        unit: 'kPa',
        tone: data && (data.vpd > 1.6 || data.vpd < 0.8) ? '#f2b24b' : '#81e3a9',
        sub: 'CANOPY 0.8-1.2 kPa',
      },
      {
        label: 'PPFD',
        value: data ? String(data.ppfd) : '---',
        unit: '\u00B5mol/m\u00B2/s',
        tone: '#f3d06a',
        sub: 'PAR AT CANOPY',
      },
      {
        label: 'EC',
        value: Number.isFinite(tankEc) ? tankEc.toFixed(2) : '-.--',
        unit: 'mS/cm',
        tone:
          monitoredFeed && Number.isFinite(tankEc) && (tankEc < 1.2 || tankEc > 2.6)
            ? '#f2b24b'
            : '#7fc6f0',
        sub: tank?.name
          ? `${tank.name} SET ${Number(tank.targetEc ?? 1.8).toFixed(2)}`
          : 'SET 1.80',
      },
      {
        label: 'pH',
        value: Number.isFinite(tankPh) ? tankPh.toFixed(2) : '-.--',
        unit: 'pH',
        tone:
          monitoredFeed && Number.isFinite(tankPh) && (tankPh < 5.4 || tankPh > 6.4)
            ? '#f2b24b'
            : '#9fe38a',
        sub: 'DOSING 5.8-6.0',
      },
      {
        label: 'SOLUTION',
        value: Number.isFinite(tankTemp) ? tankTemp.toFixed(1) : '--.-',
        unit: `${DEGREE}C`,
        tone: '#8fb9f0',
        sub: `FLOW ${Math.round(water?.flowRate ?? 0)} L/MIN`,
      },
      {
        label: 'RESERVOIR',
        value: tank?.name ?? tank?.code ?? 'Reservoir 1',
        unit: '',
        tone: '#65e0bc',
        sub: `LEVEL ${Math.round(tankLevel * 100)} % \u00B7 E SELECT`,
        valueSize: 30,
        bar: tankLevel,
      },
    ];

    const margin = 28;
    const gap = 14;
    const tileWidth = (WIDTH - margin * 2 - gap * 3) / 4;
    const tileHeight = 142;
    const rowY = [108, 258];

    tiles.forEach((tile, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const x = margin + column * (tileWidth + gap);
      const y = rowY[row];

      ctx.fillStyle = 'rgba(18, 52, 61, 0.88)';
      roundedRect(ctx, x, y, tileWidth, tileHeight, 9);
      ctx.fill();
      ctx.strokeStyle = 'rgba(107, 196, 183, 0.18)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#7fb5b0';
      ctx.font = '600 18px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(tile.label, x + 16, y + 25);

      ctx.fillStyle = tile.tone;
      ctx.font = `700 ${tile.valueSize ?? 54}px "Segoe UI", Arial, sans-serif`;
      ctx.fillText(tile.value, x + 14, y + 76);

      if (tile.unit) {
        const valueWidth = ctx.measureText(tile.value).width;
        ctx.fillStyle = '#93c4bd';
        ctx.font = '600 17px "Segoe UI", Arial, sans-serif';
        ctx.fillText(tile.unit, x + 20 + valueWidth, y + 88);
      }

      ctx.fillStyle = '#5d8e89';
      ctx.font = '600 14px "Segoe UI", Arial, sans-serif';
      ctx.fillText(tile.sub, x + 16, y + 112);

      if (Number.isFinite(tile.bar)) {
        const barX = x + 16;
        const barY = y + 126;
        const barWidth = tileWidth - 32;
        ctx.fillStyle = '#0d2b33';
        roundedRect(ctx, barX, barY, barWidth, 8, 4);
        ctx.fill();
        ctx.fillStyle = tile.bar < 0.12 ? '#f2b24b' : '#65e0bc';
        roundedRect(ctx, barX, barY, Math.max(4, barWidth * tile.bar), 8, 4);
        ctx.fill();
      }
    });

    // Shared dosing / water strip between the tiles and the footer.
    const stripX = margin;
    const stripY = 410;
    const stripW = WIDTH - margin * 2;
    const stripH = 46;
    ctx.fillStyle = alarm ? 'rgba(60, 44, 18, 0.9)' : 'rgba(14, 48, 55, 0.92)';
    roundedRect(ctx, stripX, stripY, stripW, stripH, 8);
    ctx.fill();
    ctx.strokeStyle = alarm ? 'rgba(242, 178, 75, 0.45)' : 'rgba(101, 224, 188, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
    ctx.fillText('DOSING', stripX + 16, stripY + 15);

    const dosing = control?.dosing ?? {};
    const channels = [
      { key: 'a', label: 'A', tone: '#65e0bc' },
      { key: 'b', label: 'B', tone: '#7fc6f0' },
      { key: 'c', label: 'pH', tone: '#f3d06a' },
    ];
    channels.forEach((channel, index) => {
      const chipX = stripX + 82 + index * 82;
      const chipY = stripY + 9;
      const on = dosing[channel.key]?.enabled ?? true;
      ctx.fillStyle = on ? 'rgba(26, 74, 72, 0.95)' : 'rgba(24, 38, 44, 0.9)';
      roundedRect(ctx, chipX, chipY, 70, 28, 6);
      ctx.fill();
      ctx.fillStyle = on ? channel.tone : '#4a6266';
      ctx.beginPath();
      ctx.arc(chipX + 13, chipY + 14, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = on ? '#dcf5ee' : '#6c8385';
      ctx.font = '700 14px "Segoe UI", Arial, sans-serif';
      ctx.fillText(channel.label, chipX + 25, chipY + 15);
      const output = dosing[channel.key]?.output;
      ctx.fillStyle = on ? '#93c4bd' : '#52696c';
      ctx.font = '600 12px Consolas, "Courier New", monospace';
      ctx.fillText(Number.isFinite(output) ? `${Math.round(output * 100)}%` : '--', chipX + 46, chipY + 15);
    });

    ctx.fillStyle = '#244e58';
    ctx.fillRect(stripX + 342, stripY + 9, 2, stripH - 18);

    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
    ctx.fillText('WATER', stripX + 362, stripY + 15);
    ctx.fillStyle = '#dcf5ee';
    ctx.font = '600 14px Consolas, "Courier New", monospace';
    ctx.fillText(`${Math.round(water?.flowRate ?? 0)} L/MIN`, stripX + 362, stripY + 33);

    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
    ctx.fillText('RETURN', stripX + 484, stripY + 15);
    ctx.fillStyle = water?.returnTank?.level > 0.82 ? '#f2b24b' : '#dcf5ee';
    ctx.font = '600 14px Consolas, "Courier New", monospace';
    ctx.fillText(
      `${Math.round((water?.returnTank?.level ?? 0) * 100)} %`,
      stripX + 484,
      stripY + 33,
    );

    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
    ctx.fillText('RAIN', stripX + 578, stripY + 15);
    ctx.fillStyle = '#dcf5ee';
    ctx.font = '600 14px Consolas, "Courier New", monospace';
    ctx.fillText(
      `${Math.round((water?.harvester?.level ?? 0) * 100)} %`,
      stripX + 578,
      stripY + 33,
    );

    ctx.textAlign = 'right';
    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
    ctx.fillText('MONITORED RESERVOIR', stripX + stripW - 16, stripY + 15);
    ctx.fillStyle = alarm ? '#f2b24b' : '#65e0bc';
    ctx.font = '700 18px Consolas, "Courier New", monospace';
    ctx.fillText(
      `${tank?.name ?? 'Reservoir 1'} \u00B7 E CYCLE`,
      stripX + stripW - 16,
      stripY + 33,
    );

    // Footer strip.
    ctx.fillStyle = '#0b242c';
    ctx.fillRect(0, HEIGHT - 44, WIDTH, 44);
    ctx.fillStyle = '#5d8e89';
    ctx.font = '600 15px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ZONE 4 \u00B7 NFT LETTUCE', 30, HEIGHT - 21);
    ctx.textAlign = 'center';
    const statusLine = alarm
      ? 'CHECK RESERVOIR EC / pH / LEVEL'
      : (data?.status?.[0] ?? 'ALL ZONES NOMINAL');
    ctx.fillStyle = alarm ? '#f2b24b' : '#5d8e89';
    ctx.fillText(statusLine, WIDTH / 2, HEIGHT - 21);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#5d8e89';
    ctx.fillText('BLUELAB \u00B7 SENSOR BUS OK', WIDTH - 30, HEIGHT - 21);

    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}
