import * as THREE from 'three';

const WIDTH = 1024;
const HEIGHT = 512;

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
 * Canvas-rendered controller face.
 * The display is redrawn at ~3 Hz only when a value changes, then uploaded as a
 * single texture. It intentionally uses an unlit material so the figures stay
 * readable inside the shadowed cabinet.
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
    this.draw(null);
  }

  update(dt, climate) {
    this.accumulator += dt;
    if (this.accumulator < 0.32) return;
    this.accumulator = 0;
    if (!climate) return;

    const data = climate.snapshot();
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
    ].join(';');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.draw(data);
  }

  draw(data) {
    const ctx = this.ctx;
    const alarm = data?.isAlarm ?? false;
    const accent = alarm ? '#f2b24b' : '#65e0bc';

    const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    background.addColorStop(0, '#0b222b');
    background.addColorStop(1, '#061218');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Subtle scanline texture.
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
    ctx.fillText('CLIMATE · NFT HOUSE 4 · AUTO', 30, 63);

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
        unit: '°C',
        tone: '#72d9ce',
        sub: 'SETPOINT 21.5',
      },
      {
        label: 'HUMIDITY',
        value: data ? data.humidity.toFixed(0) : '--',
        unit: '% RH',
        tone: '#72d9ce',
        sub: 'TARGET 60–75 %',
      },
      {
        label: 'VPD',
        value: data ? data.vpd.toFixed(2) : '-.--',
        unit: 'kPa',
        tone: data && (data.vpd > 1.6 || data.vpd < 0.8) ? '#f2b24b' : '#81e3a9',
        sub: 'CANOPY 0.8–1.2 kPa',
      },
      {
        label: 'PPFD',
        value: data ? String(data.ppfd) : '---',
        unit: 'µmol/m²/s',
        tone: '#f3d06a',
        sub: 'PAR AT CANOPY',
      },
      {
        label: 'DLI TODAY',
        value: data ? data.dliToday.toFixed(1) : '--.-',
        unit: 'mol/m²',
        tone: '#81e3a9',
        sub: 'INTEGRATED LIGHT',
      },
      {
        label: 'EC',
        value: data ? data.ec.toFixed(2) : '-.--',
        unit: 'mS/cm',
        tone: '#7fc6f0',
        sub: 'NUTRIENT STRENGTH',
      },
      {
        label: 'pH',
        value: data ? data.ph.toFixed(2) : '-.--',
        unit: 'pH',
        tone: data && (data.ph < 5.65 || data.ph > 6.15) ? '#f2b24b' : '#9fe38a',
        sub: 'DOSING 5.8–6.0',
      },
    ];

    const margin = 28;
    const gap = 14;
    const tileWidth = (WIDTH - margin * 2 - gap * 3) / 4;
    const tileHeight = 142;
    const rowY = [108, 264];

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
      ctx.font = '700 54px "Segoe UI", Arial, sans-serif';
      ctx.fillText(tile.value, x + 14, y + 76);

      const valueWidth = ctx.measureText(tile.value).width;
      ctx.fillStyle = '#93c4bd';
      ctx.font = '600 17px "Segoe UI", Arial, sans-serif';
      ctx.fillText(tile.unit, x + 20 + valueWidth, y + 88);

      ctx.fillStyle = '#5d8e89';
      ctx.font = '600 14px "Segoe UI", Arial, sans-serif';
      ctx.fillText(tile.sub, x + 16, y + 119);
    });

    // System tile in the eighth slot.
    const statusX = margin + 3 * (tileWidth + gap);
    const statusY = rowY[1];
    ctx.fillStyle = alarm ? 'rgba(73, 53, 17, 0.9)' : 'rgba(14, 55, 49, 0.92)';
    roundedRect(ctx, statusX, statusY, tileWidth, tileHeight, 9);
    ctx.fill();
    ctx.strokeStyle = alarm ? 'rgba(242, 178, 75, 0.48)' : 'rgba(101, 224, 188, 0.32)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#7fb5b0';
    ctx.font = '600 18px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('SYSTEM', statusX + 16, statusY + 25);

    ctx.fillStyle = alarm ? '#f2b24b' : '#65e0bc';
    ctx.font = '700 46px "Segoe UI", Arial, sans-serif';
    ctx.fillText('AUTO', statusX + 14, statusY + 74);

    ctx.font = '600 15px "Segoe UI", Arial, sans-serif';
    const lines = data?.status ?? ['ALL ZONES NOMINAL'];
    lines.slice(0, 2).forEach((line, index) => {
      ctx.fillText(line, statusX + 16, statusY + 108 + index * 19);
    });

    // Footer strip.
    ctx.fillStyle = '#0b242c';
    ctx.fillRect(0, HEIGHT - 44, WIDTH, 44);
    ctx.fillStyle = '#5d8e89';
    ctx.font = '600 15px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ZONE 4 · NFT LETTUCE', 30, HEIGHT - 21);
    ctx.textAlign = 'center';
    ctx.fillText('FERTIGATION · VENTS · FANS', WIDTH / 2, HEIGHT - 21);
    ctx.textAlign = 'right';
    ctx.fillText('SENSOR BUS OK', WIDTH - 30, HEIGHT - 21);

    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}
