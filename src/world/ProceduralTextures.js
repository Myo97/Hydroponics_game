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

  ctx.fillStyle = '#c9c7bf';
  ctx.fillRect(0, 0, size, size);

  addBlobs(ctx, size, rnd, {
    count: 22,
    min: size * 0.08,
    max: size * 0.3,
    color: '150, 149, 142',
    alpha: 0.16,
  });
  addBlobs(ctx, size, rnd, {
    count: 14,
    min: size * 0.06,
    max: size * 0.22,
    color: '214, 212, 204',
    alpha: 0.12,
  });

  // Exposed aggregate and fine pitting.
  for (let i = 0; i < 2600; i += 1) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 0.4 + rnd() * 1.5;
    const light = rnd() > 0.62;
    ctx.fillStyle = light
      ? `rgba(232, 230, 222, ${0.05 + rnd() * 0.12})`
      : `rgba(98, 98, 92, ${0.04 + rnd() * 0.14})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  // Hairline cracks.
  ctx.strokeStyle = 'rgba(93, 94, 90, 0.22)';
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

/** Woven agricultural shade-cloth alpha mat: dense threads, open mesh gaps. */
export function createShadeClothTexture({ size = 256, seed = 91 } = {}) {
  const rnd = mulberry32(seed);
  const { canvas, ctx } = canvas2d(size);

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'butt';

  // Warp and weft threads leave small open apertures for partial transmission.
  const pitch = 5;
  for (let i = 0; i < size; i += pitch) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.72 + rnd() * 0.24})`;
    ctx.lineWidth = 1.6 + rnd() * 0.7;
    ctx.beginPath();
    ctx.moveTo(i + 0.5, 0);
    ctx.lineTo(i + 0.5, size);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255, 255, 255, ${0.66 + rnd() * 0.25})`;
    ctx.lineWidth = 1.35 + rnd() * 0.6;
    ctx.beginPath();
    ctx.moveTo(0, i + 0.5);
    ctx.lineTo(size, i + 0.5);
    ctx.stroke();
  }

  // A few thicker tape bands read as the reinforced panel seams.
  for (let i = 0; i < size; i += 64) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
  }

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

/**
 * 320-cell propagation tray surface: 16 x 20 moulded cells with a deterministic
 * scatter of young seedlings. The texture is shared by all 36 nursery trays, so
 * the cell grid reads clearly without 11,520 individual meshes.
 */
export function createSeedlingTrayTexture({
  width = 512,
  height = 1024,
  columns = 16,
  rows = 20,
  seed = 137,
  seedlings = true,
} = {}) {
  const rnd = mulberry32(seed);
  const { canvas, ctx } = canvas2d(width, height);

  // Dark injection-moulded tray with a slightly lighter rim.
  ctx.fillStyle = '#252b25';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#343b32';
  ctx.fillRect(6, 6, width - 12, height - 12);

  const cellW = (width - 20) / columns;
  const cellH = (height - 20) / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = 10 + column * cellW;
      const y = 10 + row * cellH;
      const cx = x + cellW / 2;
      const cy = y + cellH / 2;

      // Recessed square cell with a darker growing hole.
      ctx.fillStyle = '#2d332c';
      ctx.fillRect(x + 1.5, y + 1.5, cellW - 3, cellH - 3);
      ctx.fillStyle = '#172018';
      ctx.beginPath();
      ctx.ellipse(cx, cy + cellH * 0.06, cellW * 0.25, cellH * 0.23, 0, 0, TAU);
      ctx.fill();

      // Vintage versions painted permanent seedlings into the tray texture.
      // Production trays now start genuinely empty, so the live instanced
      // canopy is the only foliage the player sees.
      if (seedlings) {
        const leaves = 2 + ((row * 7 + column * 3) % 2);
        for (let leaf = 0; leaf < leaves; leaf += 1) {
          const angle = (leaf / leaves) * TAU + rnd() * 0.7;
          const radius = cellW * (0.08 + rnd() * 0.1);
          ctx.fillStyle = leaf === 0 ? '#6f9b4a' : '#89af58';
          ctx.beginPath();
          ctx.ellipse(
            cx + Math.cos(angle) * radius,
            cy + Math.sin(angle) * radius * 1.25,
            cellW * 0.13,
            cellH * 0.09,
            angle,
            0,
            TAU,
          );
          ctx.fill();
        }
        ctx.fillStyle = '#4f7a3d';
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1.2, cellW * 0.045), 0, TAU);
        ctx.fill();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Printed equipment label (nutrient tanks, pump skids). */
export function createLabelTexture(
  title,
  subtitle = '',
  { width = 512, height = 256, background = '#e8e5da', foreground = '#20211f' } = {},
) {
  const { canvas, ctx } = canvas2d(width, height);

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = foreground;
  ctx.lineWidth = 7;
  ctx.strokeRect(9, 9, width - 18, height - 18);

  // Fit the title inside the plate instead of letting long labels overflow.
  let titleSize = Math.round(height * 0.52);
  ctx.font = `bold ${titleSize}px "Segoe UI", Arial, sans-serif`;
  while (ctx.measureText(title).width > width * 0.84 && titleSize > 28) {
    titleSize -= 2;
    ctx.font = `bold ${titleSize}px "Segoe UI", Arial, sans-serif`;
  }
  ctx.fillStyle = foreground;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, width * 0.5, height * 0.43);

  let subSize = Math.round(height * 0.105);
  ctx.font = `600 ${subSize}px "Segoe UI", Arial, sans-serif`;
  while (ctx.measureText(subtitle).width > width * 0.88 && subSize > 12) {
    subSize -= 1;
    ctx.font = `600 ${subSize}px "Segoe UI", Arial, sans-serif`;
  }
  ctx.fillStyle = foreground;
  ctx.globalAlpha = 0.72;
  ctx.fillText(subtitle, width * 0.5, height * 0.75);
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Small yellow electrical-safety sticker used on the control cabinet. */
export function createWarningLabelTexture({ width = 256, height = 128 } = {}) {
  const { canvas, ctx } = canvas2d(width, height);
  ctx.fillStyle = '#e3bf3f';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#181914';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, width - 8, height - 8);

  // Hazard triangle.
  ctx.beginPath();
  ctx.moveTo(34, 96);
  ctx.lineTo(58, 38);
  ctx.lineTo(82, 96);
  ctx.closePath();
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(58, 56);
  ctx.lineTo(58, 78);
  ctx.moveTo(58, 86);
  ctx.lineTo(58, 87);
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = '#181914';
  ctx.font = 'bold 38px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('400 V', 96, 58);
  ctx.font = '600 19px "Segoe UI", Arial, sans-serif';
  ctx.fillText('ISOLATE BEFORE OPENING', 96, 88);

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

