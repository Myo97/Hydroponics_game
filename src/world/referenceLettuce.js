import { LowPolyCylinderGeometry } from './LowPolyGeometry.js';
import * as THREE from 'three';

/**
 * Port of the standalone `Green Coral Lettuce – three.js.html` generator.
 *
 * The reference builds a mature coral head from 60 leaves that emerge from the
 * outside in. This module keeps that geometry and growth order, but accepts a
 * caller-supplied vertex palette and a lower grid resolution for the instanced
 * NFT renderer. Returned coordinates are still in reference units; the caller
 * normalises the head to game metres.
 */

const GOLDEN = 2.399963;

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (value) => {
  const x = THREE.MathUtils.clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Merge indexed position/normal/uv/color geometries into one buffer. */
function mergeGeometries(parts) {
  const attributeNames = ['position', 'normal', 'uv', 'color'];
  let vertexCount = 0;
  let indexCount = 0;
  for (const geometry of parts) {
    vertexCount += geometry.attributes.position.count;
    indexCount += geometry.index ? geometry.index.count : geometry.attributes.position.count;
  }

  const arrays = {};
  for (const name of attributeNames) {
    const itemSize = parts[0].attributes[name]?.itemSize ?? 0;
    if (itemSize) arrays[name] = { itemSize, data: new Float32Array(vertexCount * itemSize) };
  }
  const indices = new Uint32Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;

  for (const geometry of parts) {
    for (const name of attributeNames) {
      const attribute = geometry.attributes[name];
      const target = arrays[name];
      if (!attribute || !target) continue;
      target.data.set(attribute.array, vertexOffset * target.itemSize);
    }
    const index = geometry.index;
    if (index) {
      for (let offset = 0; offset < index.count; offset += 1) {
        indices[indexOffset] = index.getX(offset) + vertexOffset;
        indexOffset += 1;
      }
    } else {
      for (let offset = 0; offset < geometry.attributes.position.count; offset += 1) {
        indices[indexOffset] = vertexOffset + offset;
        indexOffset += 1;
      }
    }
    vertexOffset += geometry.attributes.position.count;
  }

  const merged = new THREE.BufferGeometry();
  for (const name of attributeNames) {
    const target = arrays[name];
    if (!target) continue;
    merged.setAttribute(name, new THREE.BufferAttribute(target.data, target.itemSize));
  }
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

function buildStem(referenceDay, palette, detailed) {
  const maturity = THREE.MathUtils.clamp((referenceDay - 1) / 19, 0, 1);
  const height = 0.2 + 0.1 * maturity;
  const geometry = new LowPolyCylinderGeometry(
    0.06 + 0.07 * maturity,
    0.09 + 0.08 * maturity,
    height,
    detailed ? 14 : 8,
    1,
  );
  geometry.translate(0, 0.1 + 0.05 * maturity, 0);
  const colour = new THREE.Color(palette.stem ?? 0xcfe39a);
  const colours = new Float32Array(geometry.attributes.position.count * 3);
  for (let index = 0; index < geometry.attributes.position.count; index += 1) {
    colours[index * 3] = colour.r;
    colours[index * 3 + 1] = colour.g;
    colours[index * 3 + 2] = colour.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

/**
 * Build the reference lettuce head at a (possibly fractional) reference day.
 * `palette` uses the same base/mid/tip names as `lettuce.js`.
 */
export function buildReferenceLettuceHead({
  referenceDay = 20,
  variant = 0,
  detailed = true,
  detailLevel = null,
  palette,
  leafCount = 60,
} = {}) {
  const day = THREE.MathUtils.clamp(Number(referenceDay) || 1, 1, 20);
  const level = detailLevel ?? (detailed ? 0 : 1);
  const nu = level === 0 ? 6 : level === 1 ? 4 : 3;
  const nv = level === 0 ? 3 : level === 1 ? 2 : 1;
  const positions = [];
  const colours = [];
  const indices = [];
  const growth = (day - 1) / 19;
  const base = new THREE.Color(palette.base);
  const mid = new THREE.Color(palette.mid);
  const tip = new THREE.Color(palette.tip);
  const colour = new THREE.Color();

  for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
    const random = mulberry32((variant + 1) * 1009 + leafIndex * 7919);
    const order = leafIndex / Math.max(1, leafCount - 1);
    // Outer (oldest) leaves exist first and expand first; new leaves push out
    // of the centre later, small and upright.
    const emerge = 0.3 + (1 - order) * 11.7;
    const age = day - emerge;
    if (age <= 0) continue;
    const size = smooth(age) * (0.3 + 0.7 * smooth(age / 9));
    const open = smooth(age / 10);
    if (size < 0.04) continue;

    const azimuth = leafIndex * GOLDEN + (random() - 0.5) * 0.25;
    const finalLength = 0.38 + 0.95 * Math.pow(order, 0.75);
    const length = finalLength * (0.25 + 0.75 * size) * (0.92 + random() * 0.16);
    const width = length * (0.62 + random() * 0.18);
    const pitch =
      THREE.MathUtils.lerp(
        1.45,
        THREE.MathUtils.lerp(1.45, 0.45, Math.pow(order, 0.9)),
        open,
      ) +
      (random() - 0.5) * 0.12;
    const droop =
      THREE.MathUtils.lerp(-0.15, 1.15, Math.pow(order, 1.1)) * (0.15 + 0.85 * open);
    let radius = 0.04 + 0.11 * order;
    let height = 0.12 + 0.3 * (1 - order) * growth * 0.5 + 0.05 * (1 - order);
    const phase = random() * 6.28;
    const frequency1 = 12 + random() * 6;
    const frequency2 = 28 + random() * 10;
    const amplitude = 0.13 * Math.min(1, 0.4 + 0.6 * size) * (0.55 + 0.45 * order + 0.25);

    const radialX = Math.cos(azimuth);
    const radialZ = Math.sin(azimuth);
    const tangentX = -Math.sin(azimuth);
    const tangentZ = Math.cos(azimuth);
    const vertexStart = positions.length / 3;

    for (let row = 0; row <= nu; row += 1) {
      const u = row / nu;
      const angle = pitch - droop * u;
      if (row > 0) {
        radius += (Math.cos(angle) * length) / nu;
        height += (Math.sin(angle) * length) / nu;
      }
      const normalRadius = -Math.sin(angle);
      const normalHeight = Math.cos(angle);
      const profile = 0.07 + Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.75);

      for (let column = 0; column <= nv; column += 1) {
        const across = -1 + (2 * column) / nv;
        const edge = Math.abs(across);
        const edgePow = Math.pow(edge, 2.1);
        let blade = width * 0.5 * profile * across;
        blade += edgePow * 0.05 * length * Math.sin(u * 46 + phase + across * 3);
        const ruffle =
          amplitude *
          length *
          edgePow *
          (0.65 * Math.sin(u * length * frequency1 + phase) +
            0.38 * Math.sin(u * length * frequency2 + across * 5 + phase * 2) +
            0.2 * Math.sin(across * 9 + u * 17));
        const cup = 0.28 * width * across * across * (0.5 + 0.5 * u);
        const midrib = -0.012 * Math.exp(-edge * 9);
        const offset = ruffle + cup + midrib;

        positions.push(
          (radius + normalRadius * offset) * radialX + tangentX * blade,
          height + normalHeight * offset,
          (radius + normalRadius * offset) * radialZ + tangentZ * blade,
        );

        // Dark near the base and midrib, lighter toward the ruffled edge;
        // inner leaves stay paler.
        const mix = Math.min(1, u * 0.55 + edgePow * 0.6 + (random() - 0.5) * 0.04);
        colour.copy(base).lerp(mid, Math.min(1, mix * 1.3));
        colour.lerp(tip, Math.max(0, (1 - order) * 0.55 - 0.1) + edgePow * 0.12);
        if (u < 0.12) colour.lerp(tip, 0.5 * (1 - u / 0.12));
        colours.push(colour.r, colour.g, colour.b);
      }
    }

    for (let row = 0; row < nu; row += 1) {
      for (let column = 0; column < nv; column += 1) {
        const a = vertexStart + row * (nv + 1) + column;
        const b = a + 1;
        const c = a + nv + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  leaves.setIndex(indices);
  leaves.computeVertexNormals();

  const merged = mergeGeometries([leaves, buildStem(day, palette, detailed)]);
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  merged.name = `reference-lettuce-day-${day}-v${variant}-lod${level}`;
  return merged;
}

