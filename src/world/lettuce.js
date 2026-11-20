import * as THREE from 'three';
import { getNftNetPotGeometry, resolveCropVariety } from '../simulation/GreenCoralGrowth.js';
import { buildReferenceLettuceHead } from './referenceLettuce.js';

/**
 * High-detail procedural lettuce used by the NFT production tables and by any
 * close-up inspection view.
 *
 * The geometry is the 60-leaf coral model from the standalone
 * `Green Coral Lettuce – three.js.html` reference. Transplanted plants begin at
 * reference Day 4 (the first post-establishment seedling stage) and finish at
 * reference Day 20, so the NFT phase has 17 playable growth stages. Each head is
 * one merged, vertex-coloured BufferGeometry cached per variety / day / variant
 * / LOD.
 *
 * Public API:
 *   createLettucePlant(ageInDays, options)  -> THREE.Group
 *   updateLettuceGrowth(plant, ageInDays)   -> stage record
 *   getLettuceHeadGeometry(...)             -> cached merged BufferGeometry
 */

/** Reference Day 1 is the nursery transplant; production resumes at Day 4. */
export const LETTUCE_REFERENCE_START_DAY = 4;
export const LETTUCE_REFERENCE_END_DAY = 20;
export const LETTUCE_PRODUCTION_DAYS =
  LETTUCE_REFERENCE_END_DAY - LETTUCE_REFERENCE_START_DAY + 1;
export const LETTUCE_HARVEST_DIAMETER_M = 0.19;
export const LETTUCE_HARVEST_HEIGHT_M = 0.2;
/**
 * Height of the leaf crown above the NFT gully's upper plate surface. The
 * seedling plug and net cup are recessed into the 52 mm planting hole, so the
 * rosette emerges just above the plate instead of floating over it.
 */
export const LETTUCE_CROWN_OFFSET_M = 0.008;
/** Rockwool starter cube that is inserted into the NFT planting hole. */
export const LETTUCE_ROCKWOOL_WIDTH_M = 0.038;
export const LETTUCE_ROCKWOOL_HEIGHT_M = 0.028;
/** Top of the plug sits this far below the gully's upper plate surface. */
export const LETTUCE_ROCKWOOL_TOP_BELOW_SURFACE_M = 0.006;
/** Net cup rim is recessed this far into the planting opening. */
export const LETTUCE_NET_POT_RECESS_M = 0.004;
export const LETTUCE_VARIANTS = 4;

/** Reference day rendered for a 1-based NFT production day (1 -> 4, 17 -> 20). */
export function referenceDayForStage(ageInDays) {
  const day = THREE.MathUtils.clamp(
    Math.round(Number(ageInDays) || 1),
    1,
    LETTUCE_PRODUCTION_DAYS,
  );
  return LETTUCE_REFERENCE_START_DAY + day - 1;
}

/**
 * Key-frame morphology measured from the reference generator. Leaf counts are
 * the number of leaves actually visible on each reference day; width and height
 * are normalised to the game's 19 x 20 cm harvest head. Every value is
 * monotonically increasing so each production day is a visibly larger stage.
 */
const GROWTH_ANCHORS = Object.freeze([
  { day: 1, diameter: 0.0715, height: 0.055, leaves: 18 }, // reference Day 4
  { day: 2, diameter: 0.094, height: 0.07, leaves: 23 },
  { day: 3, diameter: 0.118, height: 0.087, leaves: 28 },
  { day: 4, diameter: 0.143, height: 0.105, leaves: 33 },
  { day: 5, diameter: 0.163, height: 0.124, leaves: 38 }, // reference Day 8
  { day: 6, diameter: 0.177, height: 0.142, leaves: 43 },
  { day: 7, diameter: 0.184, height: 0.158, leaves: 48 },
  { day: 8, diameter: 0.187, height: 0.17, leaves: 53 },
  { day: 9, diameter: 0.188, height: 0.18, leaves: 58 }, // reference Day 12
  { day: 10, diameter: 0.1885, height: 0.187, leaves: 60 }, // reference Day 13
  { day: 11, diameter: 0.189, height: 0.191, leaves: 60 },
  { day: 12, diameter: 0.1892, height: 0.193, leaves: 60 },
  { day: 13, diameter: 0.1894, height: 0.195, leaves: 60 }, // reference Day 16
  { day: 14, diameter: 0.1896, height: 0.197, leaves: 60 }, // reference Day 17
  { day: 15, diameter: 0.1898, height: 0.198, leaves: 60 },
  { day: 16, diameter: 0.1899, height: 0.199, leaves: 60 },
  {
    day: LETTUCE_PRODUCTION_DAYS,
    diameter: LETTUCE_HARVEST_DIAMETER_M,
    height: LETTUCE_HARVEST_HEIGHT_M,
    leaves: 60,
  }, // reference Day 20
]);

const STAGE_LABEL_BANDS = Object.freeze([
  { maxDay: 2, label: 'Early seedling' }, // reference Days 4-5
  { maxDay: 5, label: 'Coral rosette forming' }, // reference Days 6-8
  { maxDay: 9, label: 'Rapid canopy growth' }, // reference Days 9-12
  { maxDay: 13, label: 'Heading and ruffling' }, // reference Days 13-16
  { maxDay: 16, label: 'Full coral head' }, // reference Days 17-19
  { maxDay: LETTUCE_PRODUCTION_DAYS, label: 'Harvest ready' }, // reference Day 20
]);

const VARIANT_DIAMETER_FACTORS = Object.freeze([1, 1.012, 1.024, 1.036]);

function smoothstep01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function stageLabelForDay(day) {
  return (
    STAGE_LABEL_BANDS.find((band) => day <= band.maxDay)?.label ??
    STAGE_LABEL_BANDS[STAGE_LABEL_BANDS.length - 1].label
  );
}

/**
 * Interpolated record for one of the 17 post-transplant production stages. The
 * curve is monotonic, so every day produces a visibly larger head than before.
 */
export function lettuceStageForDay(ageInDays) {
  const day = Math.round(
    THREE.MathUtils.clamp(Number(ageInDays) || 1, 1, LETTUCE_PRODUCTION_DAYS),
  );
  const last = GROWTH_ANCHORS[GROWTH_ANCHORS.length - 1];
  let from = GROWTH_ANCHORS[0];
  let to = last;
  let t = 0;
  if (day >= last.day) {
    t = 1;
  } else {
    for (let index = 1; index < GROWTH_ANCHORS.length; index += 1) {
      const next = GROWTH_ANCHORS[index];
      if (day > next.day) continue;
      from = GROWTH_ANCHORS[index - 1];
      to = next;
      t = smoothstep01((day - from.day) / Math.max(1, to.day - from.day));
      break;
    }
  }
  const maturity = THREE.MathUtils.clamp((day - 1) / (LETTUCE_PRODUCTION_DAYS - 1), 0, 1);
  return Object.freeze({
    day,
    label: stageLabelForDay(day),
    maturity,
    diameterM: THREE.MathUtils.lerp(from.diameter, to.diameter, t),
    heightM: THREE.MathUtils.lerp(from.height, to.height, t),
    leafCount: Math.round(THREE.MathUtils.lerp(from.leaves, to.leaves, t)),
    ruffle: 0.1 + 0.9 * Math.pow(maturity, 1.15),
    cup: 0.32 + 0.34 * maturity,
    curl: 0.08 + 0.16 * maturity,
    serration: 0.08 + 0.2 * maturity,
  });
}

/** The 17 fixed production stages, useful for tests and UI timelines. */
export const LETTUCE_STAGES = Object.freeze(
  Array.from({ length: LETTUCE_PRODUCTION_DAYS }, (_, index) =>
    lettuceStageForDay(index + 1),
  ),
);

const LEAF_PALETTES = Object.freeze({
  'green-coral': {
    base: 0x122906,
    mid: 0x22430f,
    tip: 0x3f6122,
    edge: 0x2f5217,
    stem: 0x6d8148,
  },
  'red-coral': {
    base: 0x5c1725,
    mid: 0xa62f3d,
    tip: 0xf07a66,
    edge: 0xd44c4c,
    stem: 0xd6a58f,
  },
  green: { base: 0x477c29, mid: 0x77b345, tip: 0xd0ef8a, edge: 0xa8d867 },
  red: { base: 0x5f1d28, mid: 0x9f3b3c, tip: 0xdd816f, edge: 0xc45350 },
  pale: { base: 0x6c8c34, mid: 0xa8c85c, tip: 0xe8f3a9, edge: 0xcade7f },
});

/**
 * Green Coral darkens through five growth stages. The palette is interpolated
 * per NFT day, so every production day has its own shade while the whole crop
 * stays clearly dark green. Stems remain a lighter, less saturated green.
 */
export const GREEN_CORAL_PALETTE_STOPS = Object.freeze([
  {
    day: 1, // Transplant establishment - youngest dark green
    palette: {
      base: 0x2c551a,
      mid: 0x457529,
      tip: 0x6f9a48,
      edge: 0x578532,
      stem: 0x90a46a,
    },
  },
  {
    day: 5,
    palette: {
      base: 0x264b16,
      mid: 0x3d6a24,
      tip: 0x648e3e,
      edge: 0x4e792d,
      stem: 0x889c62,
    },
  },
  {
    day: 9,
    palette: {
      base: 0x204011,
      mid: 0x345d1e,
      tip: 0x598134,
      edge: 0x456d27,
      stem: 0x82965c,
    },
  },
  {
    day: 13,
    palette: {
      base: 0x19350b,
      mid: 0x2b5117,
      tip: 0x4d722b,
      edge: 0x39621e,
      stem: 0x798c54,
    },
  },
  {
    day: LETTUCE_PRODUCTION_DAYS, // Harvest - deepest forest green
    palette: {
      base: 0x122906,
      mid: 0x22430f,
      tip: 0x3f6122,
      edge: 0x2f5217,
      stem: 0x6d8148,
    },
  },
]);

const PALETTE_CHANNELS = Object.freeze(['base', 'mid', 'tip', 'edge', 'stem']);

function blendPalette(from, to, amount) {
  const palette = {};
  for (const channel of PALETTE_CHANNELS) {
    const fromValue = from[channel] ?? to[channel] ?? 0;
    const toValue = to[channel] ?? fromValue;
    const mix = (shift) =>
      Math.round(
        THREE.MathUtils.lerp(
          (fromValue >> shift) & 0xff,
          (toValue >> shift) & 0xff,
          amount,
        ),
      );
    palette[channel] = (mix(16) << 16) | (mix(8) << 8) | mix(0);
  }
  return palette;
}

/** Dark-green Green Coral palette for a 1-based NFT production day. */
export function greenCoralPaletteForDay(ageInDays) {
  const day = THREE.MathUtils.clamp(
    Number(ageInDays) || 1,
    1,
    LETTUCE_PRODUCTION_DAYS,
  );
  const first = GREEN_CORAL_PALETTE_STOPS[0];
  const last = GREEN_CORAL_PALETTE_STOPS[GREEN_CORAL_PALETTE_STOPS.length - 1];
  if (day <= first.day) return { ...first.palette };
  if (day >= last.day) return { ...last.palette };

  for (let index = 1; index < GREEN_CORAL_PALETTE_STOPS.length; index += 1) {
    const to = GREEN_CORAL_PALETTE_STOPS[index];
    if (day > to.day) continue;
    const from = GREEN_CORAL_PALETTE_STOPS[index - 1];
    const amount = smoothstep01((day - from.day) / Math.max(1, to.day - from.day));
    return blendPalette(from.palette, to.palette, amount);
  }
  return { ...last.palette };
}

function paletteFor(variety, spec) {
  if (variety.key === 'green-coral') {
    return greenCoralPaletteForDay(spec?.day ?? 1);
  }
  return LEAF_PALETTES[variety.key] ?? LEAF_PALETTES[variety.materialSet] ?? LEAF_PALETTES.green;
}

const headGeometryCache = new Map();
const rockwoolGeometryCache = new Map();
let sharedMaterials = null;

/* --------------------------------------------------------------- head mesh */




function buildHeadGeometry(spec, variety, variant, detailLevel) {
  const factor = VARIANT_DIAMETER_FACTORS[variant] ?? 1;
  const diameter = spec.diameterM * factor;
  const height = spec.heightM;
  const palette = paletteFor(variety, spec);
  const referenceDay = referenceDayForStage(spec.day);
  const level = typeof detailLevel === 'number' ? detailLevel : detailLevel ? 0 : 1;
  const merged = buildReferenceLettuceHead({
    referenceDay,
    variant,
    detailed: level === 0,
    detailLevel: level,
    palette,
    // Close heads keep all 60 leaves. Mid/far heads are already below ~1° of
    // screen width; fewer, larger leaves preserve silhouette and colour.
    leafCount: level === 0 ? 60 : level === 1 ? 24 : 10,
  });

  merged.computeBoundingBox();
  const size = merged.boundingBox.getSize(new THREE.Vector3());
  const scaleXZ = diameter / Math.max(1e-6, size.x, size.z);
  const scaleY = height / Math.max(1e-6, size.y);
  merged.scale(scaleXZ, scaleY, scaleXZ);
  merged.computeBoundingBox();
  merged.translate(
    -(merged.boundingBox.min.x + merged.boundingBox.max.x) / 2,
    -merged.boundingBox.min.y,
    -(merged.boundingBox.min.z + merged.boundingBox.max.z) / 2,
  );
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  merged.name = `lettuce-head-${variety.key}-day-${spec.day}-v${variant}-lod${level}`;
  merged.userData.lettuce = {
    variety: variety.key,
    day: spec.day,
    referenceDay,
    variant,
    detailed: level === 0,
    lodLevel: level,
    widthM: diameter,
    heightM: height,
    leafCount: Math.max(2, spec.leafCount),
  };
  return merged;
}

/**
 * Cached merged head geometry. Cached per variety + day + variant + LOD; the
 * instanced renderer reuses it for every plant that shares that bucket.
 */
export function getLettuceHeadGeometry(
  varietyName,
  ageInDays,
  variant = 0,
  detailed = true,
) {
  const variety = resolveCropVariety(varietyName);
  const spec = lettuceStageForDay(ageInDays);
  const safeVariant = Math.abs(Math.round(Number(variant) || 0)) % LETTUCE_VARIANTS;
  const level =
    typeof detailed === 'number'
      ? THREE.MathUtils.clamp(Math.round(detailed), 0, 2)
      : detailed
        ? 0
        : 1;
  const key = `${variety.key}|${spec.day}|${safeVariant}|lod${level}`;
  const cached = headGeometryCache.get(key);
  if (cached) return cached;
  const geometry = buildHeadGeometry(spec, variety, safeVariant, level);
  headGeometryCache.set(key, geometry);
  return geometry;
}

/** Net cup geometry is shared with the rest of the NFT plant renderer. */
export function getLettuceNetCupGeometry(detailed = false) {
  return getNftNetPotGeometry(detailed);
}

/**
 * Compact rockwool starter cube; base sits at y = 0. The 38 mm cube is sized to
 * drop through the 52 mm NFT planting hole and sit inside its net cup.
 */
export function getLettuceRockwoolGeometry() {
  const key = 'rockwool';
  const cached = rockwoolGeometryCache.get(key);
  if (cached) return cached;
  const geometry = new THREE.BoxGeometry(
    LETTUCE_ROCKWOOL_WIDTH_M,
    LETTUCE_ROCKWOOL_HEIGHT_M,
    LETTUCE_ROCKWOOL_WIDTH_M,
  );
  geometry.translate(0, LETTUCE_ROCKWOOL_HEIGHT_M / 2, 0);
  geometry.name = 'lettuce-rockwool-cube';
  rockwoolGeometryCache.set(key, geometry);
  return geometry;
}


/* --------------------------------------------------------------- materials */

/**
 * Shared materials for close-up lettuce plants. Instanced NFT heads reuse the
 * exact same leaf material, so all heads share one shader program.
 */
export function getLettuceMaterials() {
  if (!sharedMaterials) {
    sharedMaterials = {
      leaf: new THREE.MeshStandardMaterial({
        name: 'lettuce-leaf-vertex-colour',
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.62,
        metalness: 0,
        side: THREE.DoubleSide,
        envMapIntensity: 0.35,
      }),
      netCup: new THREE.MeshStandardMaterial({
        name: 'lettuce-net-cup',
        color: 0x2f3a33,
        roughness: 0.85,
        metalness: 0.05,
        side: THREE.DoubleSide,
      }),
      rockwool: new THREE.MeshStandardMaterial({
        name: 'lettuce-rockwool',
        color: 0xd8c9a3,
        roughness: 0.98,
        metalness: 0,
      }),
    };
  }
  return sharedMaterials;
}

export function getLettuceLeafMaterial() {
  return getLettuceMaterials().leaf;
}

export function getLettuceNetCupMaterial() {
  return getLettuceMaterials().netCup;
}

export function getLettuceRockwoolMaterial() {
  return getLettuceMaterials().rockwool;
}

/* -------------------------------------------------------------- plant API */

function readPlantData(plant) {
  const data = plant?.userData?.lettuce;
  if (!data) {
    throw new Error('createLettucePlant() group expected');
  }
  return data;
}

/**
 * Build a single lettuce plant: one merged leaf mesh (with shadows), a black net
 * cup and a rockwool starter cube. `ageInDays` is the NFT production age (1-17),
 * which maps to reference lettuce Day 4-20.
 */
export function createLettucePlant(
  ageInDays = 1,
  {
    variety: varietyName = 'Green Coral Lettuce',
    variant = 0,
    detailed = true,
    scale = 1,
    roots = false,
  } = {},
) {
  const variety = resolveCropVariety(varietyName);
  const spec = lettuceStageForDay(ageInDays);
  const safeVariant = Math.abs(Math.round(Number(variant) || 0)) % LETTUCE_VARIANTS;
  const materials = getLettuceMaterials();
  const group = new THREE.Group();
  group.name = `lettuce-${variety.key}-day-${spec.day}`;

  const leafMesh = new THREE.Mesh(
    getLettuceHeadGeometry(variety.name, spec.day, safeVariant, detailed),
    materials.leaf,
  );
  leafMesh.name = `${variety.key}-leaf-head`;
  leafMesh.position.y = LETTUCE_CROWN_OFFSET_M;
  leafMesh.castShadow = true;
  leafMesh.receiveShadow = true;

  const netCup = new THREE.Mesh(getLettuceNetCupGeometry(detailed), materials.netCup);
  netCup.name = `${variety.key}-net-cup`;
  netCup.position.y = -LETTUCE_NET_POT_RECESS_M;
  netCup.castShadow = true;
  netCup.receiveShadow = true;

  const rockwool = new THREE.Mesh(getLettuceRockwoolGeometry(), materials.rockwool);
  rockwool.name = `${variety.key}-rockwool`;
  // The group origin is the NFT plate surface: the cup and plug drop into the
  // planting hole so the rosette emerges just above the channel.
  rockwool.position.y = -(
    LETTUCE_ROCKWOOL_TOP_BELOW_SURFACE_M + LETTUCE_ROCKWOOL_HEIGHT_M
  );
  rockwool.castShadow = true;
  rockwool.receiveShadow = true;

  group.add(leafMesh, netCup, rockwool);
  group.scale.setScalar(scale);
  group.userData.lettuce = {
    variety: variety.key,
    varietyName: variety.name,
    day: spec.day,
    variant: safeVariant,
    detailed,
    spec,
    leafMesh,
    netCup,
    rockwool,
  };
  if (roots) {
    // Root detail is supplied by the caller (the NFT layer owns root geometry),
    // keeping this module independent of the table layout.
    group.userData.wantsRoots = true;
  }
  return group;
}

/**
 * Replace the merged head geometry in place. Old geometry stays in the cache and
 * is shared with other plants, so it is intentionally not disposed here.
 */
export function updateLettuceGrowth(plant, ageInDays, options = {}) {
  const data = readPlantData(plant);
  const spec = lettuceStageForDay(ageInDays);
  const variant = Math.abs(
    Math.round(Number(options.variant ?? data.variant) || 0),
  ) % LETTUCE_VARIANTS;
  const detailed = options.detailed ?? data.detailed;
  const variety = resolveCropVariety(options.variety ?? data.varietyName);
  const geometry = getLettuceHeadGeometry(variety.name, spec.day, variant, detailed);

  data.leafMesh.geometry = geometry;
  data.day = spec.day;
  data.variant = variant;
  data.detailed = detailed;
  data.variety = variety.key;
  data.varietyName = variety.name;
  data.spec = spec;
  plant.name = `lettuce-${variety.key}-day-${spec.day}`;
  plant.userData.lettuce = data;
  if (Number.isFinite(options.scale)) plant.scale.setScalar(options.scale);
  return spec;
}

/** True when the plant is showing the reference Day 20 harvest-ready stage. */
export function isLettuceHarvestReady(ageInDays) {
  return Math.round(Number(ageInDays) || 1) >= LETTUCE_PRODUCTION_DAYS;
}

/** Free cached geometries (used by tests / hot reload, not by the game loop). */
export function disposeLettuceGeometryCache() {
  for (const geometry of headGeometryCache.values()) geometry.dispose();
  headGeometryCache.clear();
  for (const geometry of rockwoolGeometryCache.values()) geometry.dispose();
  rockwoolGeometryCache.clear();
}

/** Dispose the shared materials once the last renderer has been torn down. */
export function disposeLettuceMaterials() {
  if (!sharedMaterials) return;
  for (const material of Object.values(sharedMaterials)) material.dispose();
  sharedMaterials = null;
}
