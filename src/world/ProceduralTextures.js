import * as THREE from 'three';

/**
 * Procedural texture generation.
 * The prototype ships with no image assets, so physically plausible concrete,
 * galvanised steel, glass smudges, grass and equipment labels are generated on
 * the fly with the Canvas 2D API. All textures are tileable and cached by the
 * material library that consumes them.
 */

const TAU = Math.PI * 2;
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas2d(width, height = width) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
}

function addGrain(ctx, width, height, rnd, amount) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    data[i] = clamp255(data[i] + n);
    data[i + 1] = clamp255(data[i + 1] + n);
    data[i + 2] = clamp255(data[i + 2] + n);
  }
  ctx.putImageData(image, 0, 0);
}

function addBlobs(ctx, size, rnd, { count, min, max, color, alpha, yMax = size }) {
  for (let i = 0; i < count; i += 1) {
    const x = rnd() * size;
    const y = rnd() * yMax;
    const radius = min + rnd() * (max - min);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${color}, ${alpha * (0.5 + rnd() * 0.5)})`);
    gradient.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }
}

function toTexture(canvas, { srgb = false, repeat = 1 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Cheap luminance → tangent-space normal map conversion. */
function heightToNormal(sourceCanvas, strength = 1.4) {
  const size = sourceCanvas.width;
  const src = sourceCanvas
    .getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, size, size);
  const { canvas, ctx } = canvas2d(size);
  const out = ctx.createImageData(size, size);
  const srcData = src.data;
  const outData = out.data;

  const heightAt = (x, y) => {
    const xi = (x + size) % size;
    const yi = (y + size) % size;
    const i = (yi * size + xi) * 4;
    return (srcData[i] * 0.299 + srcData[i + 1] * 0.587 + srcData[i + 2] * 0.114) / 255;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = heightAt(x + 1, y) - heightAt(x - 1, y);
      const dy = heightAt(x, y + 1) - heightAt(x, y - 1);
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      outData[i] = (nx * 0.5 + 0.5) * 255;
      outData[i + 1] = (ny * 0.5 + 0.5) * 255;
      outData[i + 2] = (nz * 0.5 + 0.5) * 255;
      outData[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/**
 * Sealed concrete: used for the greenhouse slab, plinths and exterior apron.
 * Returns colour, roughness and normal maps sharing one visual language.
 */
export function createConcreteTextures({ size = 512, seed = 11 } = {}) {
  const rnd = mulberry32(seed);
  const { canvas, ctx } = canvas2d(size);

  ctx.fillStyle = '#8b8a84';
  ctx.fillRect(0, 0, size, size);

  addBlobs(ctx, size, rnd, {
    count: 22,
    min: size * 0.08,
    max: size * 0.3,
    color: '104, 103, 98',
    alpha: 0.16,
  });
  addBlobs(ctx, size, rnd, {
    count: 14,
    min: size * 0.06,
    max: size * 0.22,
    color: '176, 174, 166',
    alpha: 0.12,
  });

  // Exposed aggregate and fine pitting.
  for (let i = 0; i < 2600; i += 1) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 0.4 + rnd() * 1.5;
    const light = rnd() > 0.62;
    ctx.fillStyle = light
      ? `rgba(200, 198, 190, ${0.05 + rnd() * 0.12})`
      : `rgba(58, 58, 55, ${0.04 + rnd() * 0.14})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  // Hairline cracks.
  ctx.strokeStyle = 'rgba(52, 52, 50, 0.22)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 5; i += 1) {
    let x = rnd() * size;
    let y = rnd() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s += 1) {
      x += (rnd() - 0.5) * 70;
      y += (rnd() - 0.5) * 70;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  addGrain(ctx, size, size, rnd, 26);

  const roughness = canvas2d(size);
  roughness.ctx.fillStyle = '#9d9d9d';
  roughness.ctx.fillRect(0, 0, size, size);
  addBlobs(roughness.ctx, size, rnd, {
    count: 18,
    min: size * 0.06,
    max: size * 0.26,
    color: '118, 118, 118',
    alpha: 0.4,
  });
  addBlobs(roughness.ctx, size, rnd, {
    count: 12,
    min: size * 0.04,
    max: size * 0.16,
    color: '196, 196, 196',
    alpha: 0.35,
  });
  addGrain(roughness.ctx, size, size, rnd, 30);

  return {
    map: toTexture(canvas, { srgb: true }),
    roughnessMap: toTexture(roughness.canvas),
    normalMap: toTexture(heightToNormal(canvas, 1.5)),
  };
}

/** Hot-dip galvanised / brushed steel with faint spangle pattern. */
export function createSteelTextures({ size = 512, seed = 23 } = {}) {
  const rnd = mulberry32(seed);
  const { canvas, ctx } = canvas2d(size);

  ctx.fillStyle = '#a8adae';
  ctx.fillRect(0, 0, size, size);

  // Zinc spangle: overlapping translucent polygons.
  for (let i = 0; i < 90; i += 1) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const radius = 6 + rnd() * 34;
    ctx.beginPath();
    for (let v = 0; v < 6; v += 1) {
      const angle = (v / 6) * TAU + rnd() * 0.5;
      const r = radius * (0.6 + rnd() * 0.6);
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      if (v === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(228, 232, 233, 0.05)' : 'rgba(96, 102, 104, 0.05)';
    ctx.fill();
  }

  // Rolling direction streaks.
  for (let i = 0; i < 700; i += 1) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = 20 + rnd() * 180;
    ctx.strokeStyle = rnd() > 0.5
      ? `rgba(236, 240, 240, ${0.02 + rnd() * 0.05})`
      : `rgba(70, 76, 78, ${0.02 + rnd() * 0.05})`;
    ctx.lineWidth = 0.5 + rnd() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + len);
    ctx.stroke();
  }

  addGrain(ctx, size, size, rnd, 14);

  const roughness = canvas2d(size);
  roughness.ctx.fillStyle = '#6e6e6e';
  roughness.ctx.fillRect(0, 0, size, size);
  addBlobs(roughness.ctx, size, rnd, {
    count: 26,
    min: size * 0.03,
    max: size * 0.16,
    color: rnd() > 0.5 ? '150, 150, 150' : '88, 88, 88',
    alpha: 0.3,
  });
  addGrain(roughness.ctx, size, size, rnd, 22);

  return {
    map: toTexture(canvas, { srgb: true }),
    roughnessMap: toTexture(roughness.canvas),
  };
}


/** Dry, muted meadow grass for the exterior ground plane. */
export function createGrassTexture({ size = 512, seed = 41 } = {}) {
  const rnd = mulberry32(seed);
  const { canvas, ctx } = canvas2d(size);

  ctx.fillStyle = '#59613f';
  ctx.fillRect(0, 0, size, size);

  addBlobs(ctx, size, rnd, {
    count: 40,
    min: size * 0.04,
    max: size * 0.18,
    color: '70, 79, 49',
    alpha: 0.4,
  });
  addBlobs(ctx, size, rnd, {
    count: 22,
    min: size * 0.03,
    max: size * 0.12,
    color: '133, 130, 88',
    alpha: 0.22,
  });

  // Grass blades.
  for (let i = 0; i < 7000; i += 1) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = 2 + rnd() * 7;
    const lean = (rnd() - 0.5) * 2;
    const shade = 54 + Math.floor(rnd() * 58);
    ctx.strokeStyle = `rgba(${shade + 14}, ${shade + 26}, ${Math.floor(shade * 0.62)}, ${0.25 + rnd() * 0.4})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + lean, y - len);
    ctx.stroke();
  }

  addGrain(ctx, size, size, rnd, 18);
  return toTexture(canvas, { srgb: true });
}

/** Glass is almost perfectly smooth; a slight smudge/water-spot map breaks it up. */
export function createGlassRoughnessTexture({ size = 512, seed = 63 } = {}) {
  const rnd = mulberry32(seed);
  const { canvas, ctx } = canvas2d(size);

  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, size, size);

  addBlobs(ctx, size, rnd, {
    count: 60,
    min: 3,
    max: 42,
    color: '150, 150, 150',
    alpha: 0.15,
  });
  addBlobs(ctx, size, rnd, {
    count: 250,
    min: 1,
    max: 7,
    color: '196, 196, 196',
    alpha: 0.2,
  });

  // Cleaning streaks along the panel.
  for (let i = 0; i < 24; i += 1) {
    const x = rnd() * size;
    ctx.strokeStyle = `rgba(120, 120, 120, ${0.04 + rnd() * 0.06})`;
    ctx.lineWidth = 2 + rnd() * 10;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 30, size * 0.4, x - 20, size * 0.7, x + 10, size);
    ctx.stroke();
  }

  addGrain(ctx, size, size, rnd, 10);
  return toTexture(canvas);
}

/** White/light-grey extruded PVC with faint longitudinal tool marks. */
export function createPlasticTextures({ size = 256, seed = 77 } = {}) {
  const rnd = mulberry32(seed);
  const { canvas, ctx } = canvas2d(size);

  ctx.fillStyle = '#d9d8d2';
  ctx.fillRect(0, 0, size, size);
  addBlobs(ctx, size, rnd, {
    count: 26,
    min: 4,
    max: 44,
    color: '176, 175, 168',
    alpha: 0.12,
  });
  for (let i = 0; i < 140; i += 1) {
    const x = rnd() * size;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.02 + rnd() * 0.05})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rnd() - 0.5) * 4, size);
    ctx.stroke();
  }
  addGrain(ctx, size, size, rnd, 9);

  const roughness = canvas2d(size);
  roughness.ctx.fillStyle = '#8a8a8a';
  roughness.ctx.fillRect(0, 0, size, size);
  addGrain(roughness.ctx, size, size, rnd, 26);

  return {
    map: toTexture(canvas, { srgb: true }),
    roughnessMap: toTexture(roughness.canvas),
  };
}

/** Printed equipment label (nutrient tanks, pump skids). */
export function createLabelTexture(title, subtitle = '', { width = 512, height = 256 } = {}) {
  const { canvas, ctx } = canvas2d(width, height);

  ctx.fillStyle = '#e8e5da';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#20211f';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, width - 20, height - 20);

  ctx.fillStyle = '#20211f';
  ctx.font = 'bold 132px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, width * 0.5, height * 0.44);

  ctx.font = '600 26px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#4a4a44';
  ctx.fillText(subtitle, width * 0.5, height * 0.76);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Small emissive display used on the control cabinet. */
export function createScreenTexture() {
  const { canvas, ctx } = canvas2d(256, 160);
  ctx.fillStyle = '#0b1512';
  ctx.fillRect(0, 0, 256, 160);

  ctx.strokeStyle = 'rgba(116, 214, 180, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(16, 46);
  for (let x = 16; x < 240; x += 8) {
    ctx.lineTo(x, 46 + Math.sin(x * 0.09) * 12 + (Math.random() - 0.5) * 6);
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(116, 214, 180, 0.85)';
  ctx.font = '600 14px Consolas, monospace';
  ctx.fillText('EC 1.9', 16, 24);
  ctx.fillText('pH 5.8', 108, 24);
  ctx.fillStyle = 'rgba(160, 200, 190, 0.5)';
  ctx.font = '11px Consolas, monospace';
  ctx.fillText('FLOW 2.4 m³/h', 16, 132);
  ctx.fillText('AUTO', 196, 132);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

