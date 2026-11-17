import * as THREE from 'three';

/**
 * Green Coral Lettuce nursery model and procedural plant geometry.
 *
 * The model is deliberately framework-light: tray records can be created,
 * tested and transplanted without a renderer. Geometry is generated lazily and
 * cached by growth stage, leaf-count variant and detail level, so all 11,520
 * seedlings share a handful of buffers.
 */

export const CROP_NAME = 'Green Coral Lettuce';
/** Nursery plug production: 14 propagation days. */
export const TOTAL_GROWTH_DAYS = 14;
export const TRAY_CELLS = 320;
export const TRAY_COLUMNS = 16;
export const TRAY_ROWS = 20;
/**
 * Commercial plug trays are sown with a primed, high-vigour seed lot and the
 * game deliberately models a perfect batch: every one of the 320 cells
 * germinates, so a propagated tray never leaves an empty hole behind.
 */
export const GERMINATION_RATE = 1;
export const GERMINATED_CELLS = Math.round(TRAY_CELLS * GERMINATION_RATE);
export const EMPTY_CELLS = TRAY_CELLS - GERMINATED_CELLS;

export const GROWTH_STAGES = [
  {
    stage: 1,
    key: 'germination',
    label: 'Germination / radicle',
    shortLabel: 'Germinating',
    minDay: 1,
    maxDay: 2,
    status: 'Seeded',
  },
  {
    stage: 2,
    key: 'cotyledon',
    label: 'Cotyledon',
    shortLabel: 'Cotyledons open',
    minDay: 3,
    maxDay: 5,
    status: 'Growing',
  },
  {
    stage: 3,
    key: 'early-leaf',
    label: 'Early true leaf',
    shortLabel: 'First true leaves',
    minDay: 6,
    maxDay: 8,
    status: 'Growing',
  },
  {
    stage: 4,
    key: 'coral-frill',
    label: 'Coral frill',
    shortLabel: 'Coral rosette forming',
    minDay: 9,
    maxDay: 11,
    status: 'Growing',
  },
  {
    stage: 5,
    key: 'transplant-ready',
    label: 'Transplant ready',
    shortLabel: 'READY FOR TRANSPLANT',
    minDay: 12,
    maxDay: 14,
    status: 'Ready for Transplant',
  },
];

/**
 * Version 13 NFT production window. The nursery age stays frozen at 14 and the
 * production age starts at Day 1, which renders reference lettuce Day 4. The
 * cycle finishes on reference Day 20 after 17 production days, giving a 31-day
 * total crop age at harvest readiness (14 nursery days + 17 NFT days).
 */
export const NFT_PRODUCTION_DAYS = 17;
/** Standard Green Coral Lettuce fresh weight at reference Day 20. */
export const NFT_HARVEST_WEIGHT_G = 100;
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.507 degrees

/** Human-readable production stages; stage numbers are local to the NFT phase. */
export const NFT_GROWTH_STAGES = Object.freeze([
  {
    stage: 1,
    key: 'transplant-establishment',
    label: 'Transplant establishment',
    minDay: 1,
    maxDay: 2,
    status: 'Establishing in the nutrient film',
  },
  {
    stage: 2,
    key: 'early-expansion',
    label: 'Establishment and early expansion',
    minDay: 3,
    maxDay: 5,
    status: 'Growing - leaves expanding',
  },
  {
    stage: 3,
    key: 'rapid-canopy',
    label: 'Rapid canopy development',
    minDay: 6,
    maxDay: 9,
    status: 'Growing - rapid canopy development',
  },
  {
    stage: 4,
    key: 'heading',
    label: 'Heading and deep ruffling',
    minDay: 10,
    maxDay: 14,
    status: 'Growing - heading and deep coral ruffling',
  },
  {
    stage: 5,
    key: 'harvest-ready',
    label: 'Full-grown commercial head',
    minDay: 15,
    maxDay: NFT_PRODUCTION_DAYS,
    status: 'READY FOR HARVEST',
  },
]);

/**
 * Data-driven production targets. Weight is deliberately a separate curve from
 * diameter: it represents stored biomass, not a value inferred from mesh size.
 * Each anchor corresponds to a reference lettuce day from 4 to 20.
 */
export const NFT_GROWTH_MILESTONES = Object.freeze([
  {
    // NFT Day 1 / reference Day 4: established plug with 18 visible leaves.
    day: 1,
    diameterM: 0.0715,
    heightM: 0.055,
    leafCount: 18,
    biomassG: 9,
    rootDepthM: 0.03,
    label: 'Early seedling',
  },
  {
    // Reference Day 6.
    day: 3,
    diameterM: 0.118,
    heightM: 0.087,
    leafCount: 28,
    biomassG: 21,
    rootDepthM: 0.038,
    label: 'Coral rosette forming',
  },
  {
    // Reference Day 8.
    day: 5,
    diameterM: 0.163,
    heightM: 0.124,
    leafCount: 38,
    biomassG: 41,
    rootDepthM: 0.046,
    label: 'Coral rosette forming',
  },
  {
    // Reference Day 10.
    day: 7,
    diameterM: 0.184,
    heightM: 0.158,
    leafCount: 48,
    biomassG: 65,
    rootDepthM: 0.054,
    label: 'Rapid canopy development',
  },
  {
    // Reference Day 12.
    day: 9,
    diameterM: 0.188,
    heightM: 0.18,
    leafCount: 58,
    biomassG: 83,
    rootDepthM: 0.062,
    label: 'Rapid canopy development',
  },
  {
    // Reference Day 14.
    day: 11,
    diameterM: 0.189,
    heightM: 0.191,
    leafCount: 60,
    biomassG: 91,
    rootDepthM: 0.069,
    label: 'Heading and deep ruffling',
  },
  {
    // Reference Day 16.
    day: 13,
    diameterM: 0.1894,
    heightM: 0.195,
    leafCount: 60,
    biomassG: 95,
    rootDepthM: 0.073,
    label: 'Heading and deep ruffling',
  },
  {
    // Reference Day 18.
    day: 15,
    diameterM: 0.1898,
    heightM: 0.198,
    leafCount: 60,
    biomassG: 98,
    rootDepthM: 0.076,
    label: 'Full coral head',
  },
  {
    // Reference Day 20: 19 cm head, 20 cm tall, 60 leaves, 100 g.
    day: NFT_PRODUCTION_DAYS,
    diameterM: 0.19,
    heightM: 0.2,
    leafCount: 60,
    biomassG: 100,
    rootDepthM: 0.078,
    label: 'Harvest ready',
  },
]);

const CROP_TARGET_WEIGHT_G = Object.freeze({
  'green-coral': 100,
  'red-coral': 100,
  'green-oak': 110,
  'red-oak': 105,
  'xiao-bai-cai': 70,
  'pak-choy': 180,
  'butterhead': 120,
  salanova: 95,
});

const NFT_LEAF_COLOURS = Object.freeze({
  // Green Coral follows a dark-green ramp from young seedling to deep forest
  // green at harvest. Red and pale crops retain their established palettes.
  green: [0x4a7c2e, 0x416f28, 0x376122, 0x2d521b, 0x234313],
  red: [0xc98a73, 0xb26b5f, 0x984b45, 0x793635, 0x5f282b],
  pale: [0xd8e89a, 0xc5dc7c, 0xafc965, 0x97b451, 0x7f9b40],
});

const STAGE_VARIANTS = {
  3: [2, 3],
  4: [3, 4],
  5: [5, 6, 7],
};

const geometryCache = new Map();

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash for tray IDs, so a reload grows the same crop. */
export function hashSeed(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function stageForDay(day) {
  const bounded = THREE.MathUtils.clamp(Math.round(day), 1, TOTAL_GROWTH_DAYS);
  return (
    GROWTH_STAGES.find((stage) => bounded >= stage.minDay && bounded <= stage.maxDay) ??
    GROWTH_STAGES[GROWTH_STAGES.length - 1]
  );
}

export function stageIndex(stage) {
  return Math.max(0, Math.min(GROWTH_STAGES.length - 1, stage - 1));
}

/** Slight within-stage scale change, so Days 3, 4 and 5 are not identical. */
export function growthScaleForDay(stage, day) {
  const definition = GROWTH_STAGES[stageIndex(stage)];
  const span = Math.max(1, definition.maxDay - definition.minDay + 1);
  const offset = THREE.MathUtils.clamp(day - definition.minDay, 0, span - 1);
  return 0.86 + (offset / span) * 0.19;
}

/** Maximum total crop age (14 nursery + 20 NFT production days). */
export const MAX_CROP_DAY = TOTAL_GROWTH_DAYS + NFT_PRODUCTION_DAYS;

function smoothstep01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Production stage derived from the NFT age, never from total plant age. */
export function nftStageForDay(day) {
  const bounded = THREE.MathUtils.clamp(Number(day) || 1, 1, NFT_PRODUCTION_DAYS);
  return (
    NFT_GROWTH_STAGES.find((stage) => bounded >= stage.minDay && bounded <= stage.maxDay) ??
    NFT_GROWTH_STAGES[NFT_GROWTH_STAGES.length - 1]
  );
}

/** Standard target fresh weight for a crop. Green Coral is exactly 100 g. */
export function targetHarvestWeightG(crop = CROP_NAME) {
  const variety = resolveCropVariety(crop);
  return CROP_TARGET_WEIGHT_G[variety.key] ?? NFT_HARVEST_WEIGHT_G;
}

function milestoneValue(day, key) {
  const bounded = THREE.MathUtils.clamp(Number(day) || 1, 1, NFT_PRODUCTION_DAYS);
  const milestones = NFT_GROWTH_MILESTONES;
  if (bounded <= milestones[0].day) return milestones[0][key];
  if (bounded >= milestones[milestones.length - 1].day) {
    return milestones[milestones.length - 1][key];
  }
  for (let index = 1; index < milestones.length; index += 1) {
    const next = milestones[index];
    if (bounded > next.day) continue;
    const previous = milestones[index - 1];
    const span = Math.max(1, next.day - previous.day);
    const t = smoothstep01((bounded - previous.day) / span);
    return THREE.MathUtils.lerp(previous[key], next[key], t);
  }
  return milestones[milestones.length - 1][key];
}

/**
 * Per-NFT-day growth record. This is the single source of truth for both stored
 * crop data and the production mesh. Diameter, height, leaf count and biomass
 * interpolate smoothly across the reference Day 4-20 milestones.
 */
export function nftDevelopmentForDay(day, crop = CROP_NAME) {
  const variety = resolveCropVariety(crop);
  const bounded = THREE.MathUtils.clamp(Number(day) || 1, 1, NFT_PRODUCTION_DAYS);
  const stageDefinition = nftStageForDay(bounded);
  const targetWeight = targetHarvestWeightG(variety.name);
  const biomassRatio = milestoneValue(bounded, 'biomassG') / NFT_HARVEST_WEIGHT_G;
  const rosetteDiameterM = milestoneValue(bounded, 'diameterM') * variety.widthScale;
  const heightM = milestoneValue(bounded, 'heightM');
  const leafCount = Math.max(
    2,
    Math.round(milestoneValue(bounded, 'leafCount')) + variety.leafCountBonus,
  );
  const harvestReady = bounded >= NFT_PRODUCTION_DAYS;
  return {
    day: bounded,
    nftDay: bounded,
    nftAgeDays: bounded,
    growthDay: bounded,
    stage: stageDefinition.stage,
    stageKey: stageDefinition.key,
    stageLabel: stageDefinition.label,
    growthStageLabel: stageDefinition.label,
    label: stageDefinition.label,
    leafCount,
    height: heightM,
    plantHeight: heightM,
    canopySpread: rosetteDiameterM / 2,
    rosetteDiameter: rosetteDiameterM,
    rosetteDiameterM,
    rootDepthM: milestoneValue(bounded, 'rootDepthM'),
    biomassG: targetWeight * biomassRatio,
    harvestWeightG: targetWeight * biomassRatio,
    estimatedHarvestWeightG: targetWeight * biomassRatio,
    targetHarvestWeightG: targetWeight,
    targetHarvestDay: NFT_PRODUCTION_DAYS,
    harvestReady,
    status: harvestReady ? 'READY FOR HARVEST' : stageDefinition.status,
    growthStatus: harvestReady ? 'READY FOR HARVEST' : stageDefinition.status,
    variety,
  };
}

/** Legacy continuous production scale retained for compatibility with older UI code. */
export function productionVisualScaleForDay(day) {
  const bounded = THREE.MathUtils.clamp(Number(day) || 1, 1, NFT_PRODUCTION_DAYS);
  return milestoneValue(bounded, 'diameterM') / NFT_GROWTH_MILESTONES[0].diameterM;
}

/**
 * Smoothly interpolated leaf colour. Instanced meshes multiply their white base
 * material by this per-instance colour, so consecutive days never snap between
 * two discrete stage palettes.
 */
export function productionLeafColorHex(day, materialSet = 'green') {
  const bounded = THREE.MathUtils.clamp(Number(day) || 1, 1, NFT_PRODUCTION_DAYS);
  const colours = NFT_LEAF_COLOURS[materialSet] ?? NFT_LEAF_COLOURS.green;
  const maturity =
    NFT_PRODUCTION_DAYS <= 1 ? 0 : (bounded - 1) / (NFT_PRODUCTION_DAYS - 1);
  const position = maturity * (colours.length - 1);
  const fromIndex = Math.floor(position);
  const toIndex = Math.min(colours.length - 1, fromIndex + 1);
  const t = position - fromIndex;
  const from = colours[fromIndex];
  const to = colours[toIndex];
  const mix = (shift) =>
    Math.round(
      THREE.MathUtils.lerp((from >> shift) & 0xff, (to >> shift) & 0xff, t),
    );
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/**
 * Continuous size curve used by the nursery renderer. Kept for compatibility;
 * the NFT table renderer now uses lettuceStageForDay() from world/lettuce.js.
 */
export function visualScaleForDay(day) {
  const bounded = THREE.MathUtils.clamp(Number(day) || 1, 1, MAX_CROP_DAY);
  return 0.6 + (Math.min(bounded, 28) - 1) * (0.4 / 27);
}

/**
 * Crop profiles share the same procedural leaf builder but preserve their own
 * margin shape, leaf proportions, palette and development rate. Names from the
 * existing row contract are aliases, so old saves and HUD data keep working.
 */
export const CROP_VARIETIES = Object.freeze({
  'green-coral': {
    key: 'green-coral',
    name: CROP_NAME,
    label: 'Green Coral',
    materialSet: 'green',
    lobes: 5,
    lobeDepth: 0.32,
    ruffle: 1,
    widthScale: 1,
    lengthScale: 1,
    leafRate: 1,
    leafCountBonus: 0,
    cup: 1,
    status: 'Coral rosette',
  },
  'red-coral': {
    key: 'red-coral',
    name: 'Red Coral Lettuce',
    label: 'Red Coral',
    materialSet: 'red-coral',
    lobes: 6,
    lobeDepth: 0.38,
    ruffle: 1.12,
    widthScale: 1.02,
    lengthScale: 0.98,
    leafRate: 1,
    leafCountBonus: 0,
    cup: 1.04,
    status: 'Red coral rosette',
  },
  'green-oak': {
    key: 'green-oak',
    name: 'Green Oak Lettuce',
    label: 'Green Oak',
    materialSet: 'green',
    lobes: 4,
    lobeDepth: 0.24,
    ruffle: 0.35,
    widthScale: 1.1,
    lengthScale: 1.06,
    leafRate: 1,
    leafCountBonus: 0,
    cup: 0.9,
    status: 'Oak-leaf rosette',
  },
  'red-oak': {
    key: 'red-oak',
    name: 'Red Oak Lettuce',
    label: 'Red Oak',
    materialSet: 'red',
    lobes: 4,
    lobeDepth: 0.25,
    ruffle: 0.38,
    widthScale: 1.08,
    lengthScale: 1.04,
    leafRate: 0.94,
    leafCountBonus: 0,
    cup: 0.88,
    status: 'Red oak rosette',
  },
  'xiao-bai-cai': {
    key: 'xiao-bai-cai',
    name: 'Xiao Bai Cai',
    label: 'Xiao Bai Cai',
    materialSet: 'pale',
    lobes: 0,
    lobeDepth: 0,
    ruffle: 0,
    widthScale: 1.48,
    lengthScale: 0.86,
    leafRate: 1.05,
    leafCountBonus: -1,
    cup: 0.52,
    status: 'Broad baby-leaf rosette',
  },
  'pak-choy': {
    key: 'pak-choy',
    name: 'Pak Choy',
    label: 'Pak Choy',
    materialSet: 'pale',
    lobes: 0,
    lobeDepth: 0.04,
    ruffle: 0,
    widthScale: 1.62,
    lengthScale: 1.08,
    leafRate: 0.9,
    leafCountBonus: -1,
    cup: 0.44,
    status: 'Broad petiole rosette',
  },
  butterhead: {
    key: 'butterhead',
    name: 'Rex Butterhead',
    label: 'Butterhead',
    materialSet: 'green',
    lobes: 2,
    lobeDepth: 0.08,
    ruffle: 0.12,
    widthScale: 1.3,
    lengthScale: 1,
    leafRate: 1,
    leafCountBonus: 0,
    cup: 0.68,
    status: 'Soft butterhead rosette',
  },
  salanova: {
    key: 'salanova',
    name: 'Salanova Green',
    label: 'Salanova',
    materialSet: 'green',
    lobes: 3,
    lobeDepth: 0.16,
    ruffle: 0.24,
    widthScale: 1.18,
    lengthScale: 1.05,
    leafRate: 1.06,
    leafCountBonus: 1,
    cup: 0.86,
    status: 'Loose-leaf rosette',
  },
});

const CROP_ALIASES = {
  'green coral': 'green-coral',
  'green coral lettuce': 'green-coral',
  'red coral': 'red-coral',
  'red coral lettuce': 'red-coral',
  'green oak': 'green-oak',
  'green oak lettuce': 'green-oak',
  'red oak': 'red-oak',
  'red oak lettuce': 'red-oak',
  'xiao bai cai': 'xiao-bai-cai',
  'pak choy': 'pak-choy',
  'pak choi': 'pak-choy',
  'rex butterhead': 'butterhead',
  butterhead: 'butterhead',
  'cervantes green': 'salanova',
  'salanova green': 'salanova',
};

function normaliseCropKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveCropVariety(value = CROP_NAME) {
  const direct = typeof value === 'string' ? value : value?.key;
  if (direct && CROP_VARIETIES[direct]) return CROP_VARIETIES[direct];
  const alias = CROP_ALIASES[normaliseCropKey(direct)];
  return CROP_VARIETIES[alias] ?? CROP_VARIETIES['green-coral'];
}

/**
 * Crops the nursery bench can select without changing the row contract or the
 * transplant pipeline. The grower can switch the sowing line between the two
 * coral lettuces.
 */
export const NURSERY_CROPS = Object.freeze([CROP_NAME, 'Red Coral Lettuce']);

/**
 * Per-day growth record. It deliberately exposes leaf count, height and canopy
 * spread as data, not just a mesh scale: those values are stored on every plant
 * and are what the two renderers use to choose leaf geometry.
 */
export function cropDevelopmentForDay(day, crop = CROP_NAME) {
  const variety = resolveCropVariety(crop);
  const bounded = THREE.MathUtils.clamp(Number(day) || 1, 1, MAX_CROP_DAY);
  if (bounded > TOTAL_GROWTH_DAYS) {
    const production = nftDevelopmentForDay(bounded - TOTAL_GROWTH_DAYS, variety.name);
    return {
      ...production,
      day: bounded,
      totalAgeDays: bounded,
      nurseryAgeDays: TOTAL_GROWTH_DAYS,
      nftAgeDays: production.nftDay,
      nftDay: production.nftDay,
      stage: production.stage,
      stageKey: production.stageKey,
      stageLabel: production.stageLabel,
      status: production.status,
    };
  }
  const stage = stageForDay(bounded).stage;

  let leafCount;
  if (bounded < 3) {
    leafCount = 2;
  } else if (bounded < 6) {
    leafCount = 2;
  } else if (bounded < 9) {
    leafCount = 2 + Math.floor(bounded - 6);
  } else if (bounded < 12) {
    leafCount = 5 + Math.floor(bounded - 9);
  } else {
    // A 14-day plug leaves the nursery with about six true leaves.
    leafCount = 5 + Math.floor((bounded - 12) / 2);
  }
  leafCount = THREE.MathUtils.clamp(
    leafCount + variety.leafCountBonus,
    2,
    14,
  );

  const height =
    bounded <= 2
      ? 0.0025 + (bounded - 1) * 0.001
      : 0.0035 + Math.min(0.032, (bounded - 2) * 0.0011);
  const canopySpread =
    0.004 +
    Math.min(0.2, Math.pow(Math.max(0, bounded - 1), 1.18) * 0.00115) *
      variety.widthScale;
  const stageDefinition = stageForDay(bounded);
  const status =
    bounded >= TOTAL_GROWTH_DAYS
      ? 'Transplant ready'
      : stageDefinition.status;

  return {
    day: bounded,
    totalAgeDays: bounded,
    nurseryAgeDays: bounded,
    nftAgeDays: 0,
    nftDay: 0,
    stage,
    stageKey: stageDefinition.key,
    stageLabel: stageDefinition.label,
    leafCount,
    height,
    plantHeight: height,
    canopySpread,
    rosetteDiameter: canopySpread * 2,
    rosetteDiameterM: canopySpread * 2,
    status,
    growthStatus: status,
    harvestReady: false,
    targetHarvestDay: TOTAL_GROWTH_DAYS + NFT_PRODUCTION_DAYS,
    variety,
  };
}

/**
 * Build the immutable germination + variation plan for one tray.
 * Every one of the 320 cells germinates (100%), so a transplanted tray always
 * fills the NFT table exactly. Per-cell rotation/scale/lean variation still comes
 * from the deterministic seed, so opening or growing a tray never reshuffles
 * plants and replays of the same tray look identical.
 */
export function createTrayPlan({
  seed = 1,
  cells = TRAY_CELLS,
  columns = TRAY_COLUMNS,
  rows = TRAY_ROWS,
  width = 0.28,
  length = 0.55,
} = {}) {
  const total = columns * rows;
  const germinatedCount = Math.round(total * GERMINATION_RATE);
  const random = mulberry32(seed >>> 0);

  // 100% germination: every cell is populated. The array is kept so the data
  // contract, save format and renderer loops remain unchanged.
  const germination = new Uint8Array(total).fill(1);

  const cellX = new Float32Array(total);
  const cellZ = new Float32Array(total);
  const rotation = new Float32Array(total);
  const scale = new Float32Array(total);
  const leanX = new Float32Array(total);
  const leanZ = new Float32Array(total);
  const variantSeed = new Float32Array(total);
  const innerWidth = Math.max(0.02, width - 0.022);
  const innerLength = Math.max(0.02, length - 0.022);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      cellX[index] = -innerWidth / 2 + ((column + 0.5) / columns) * innerWidth;
      cellZ[index] = -innerLength / 2 + ((row + 0.5) / rows) * innerLength;
      rotation[index] = random() * Math.PI * 2;
      scale[index] = 0.86 + random() * 0.22;
      leanX[index] = (random() - 0.5) * 0.1;
      leanZ[index] = (random() - 0.5) * 0.1;
      variantSeed[index] = random();
    }
  }

  return {
    seed,
    cells: total,
    columns,
    rows,
    germinated: germinatedCount,
    empty: total - germinatedCount,
    germination,
    cellX,
    cellZ,
    rotation,
    scale,
    leanX,
    leanZ,
    variantSeed,
  };
}

export function variantForPlant(plan, cellIndex, stage, detailed) {
  if (!detailed) return 0;
  const counts = STAGE_VARIANTS[stage];
  if (!counts) return 0;
  return Math.min(counts.length - 1, Math.floor(plan.variantSeed[cellIndex] * counts.length));
}

/* ------------------------------------------------------------ mesh helpers */

function mergeGeometries(geometries) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const geometry of geometries) {
    vertexCount += geometry.attributes.position.count;
    indexCount += geometry.index ? geometry.index.count : geometry.attributes.position.count;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;

  for (const geometry of geometries) {
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    positions.set(position.array, vertexOffset * 3);
    if (normal) normals.set(normal.array, vertexOffset * 3);
    if (uv) uvs.set(uv.array, vertexOffset * 2);

    if (geometry.index) {
      const source = geometry.index.array;
      for (let index = 0; index < source.length; index += 1) {
        indices[indexOffset + index] = source[index] + vertexOffset;
      }
      indexOffset += source.length;
    } else {
      for (let index = 0; index < position.count; index += 1) {
        indices[indexOffset + index] = index + vertexOffset;
      }
      indexOffset += position.count;
    }
    vertexOffset += position.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * One curved, lobed leaf. The silhouette is driven by a sinusoidal margin cut;
 * extra longitudinal segments and edge ruffles give the coral frill its
 * irregular, deeply serrated profile.
 */
function buildLeafGeometry({
  length,
  width,
  tilt,
  yaw,
  roll = 0,
  lobes = 0,
  lobeDepth = 0,
  curl = 0,
  cup = 0,
  ruffle = 0,
  phase = 0,
  segmentsT = 7,
  segmentsV = 4,
}) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const columns = segmentsV;

  for (let column = 0; column <= columns; column += 1) {
    const v = (column / columns) * 2 - 1;
    for (let segment = 0; segment <= segmentsT; segment += 1) {
      const t = segment / segmentsT;
      const taper = Math.pow(Math.sin(Math.PI * (0.035 + t * 0.965)), 0.56);
      const lobe =
        lobeDepth > 0
          ? 1 - lobeDepth * (0.5 + 0.5 * Math.cos(t * Math.PI * 2 * lobes + phase))
          : 1;
      const edge = width * taper * Math.max(0.16, lobe);
      const x = v * edge;
      const y = t * length - t * t * length * 0.055;
      const centralRidge = (1 - Math.abs(v)) * width * 0.055;
      const z =
        cup * (v * v) * edge +
        centralRidge +
        curl * t * t +
        ruffle * Math.abs(v) * Math.sin(t * Math.PI * lobes + phase) * (0.3 + t);
      positions.push(x, y, z);
      normals.push(0, 0, 1);
      uvs.push((v + 1) / 2, t);
    }
  }

  const stride = segmentsT + 1;
  for (let column = 0; column < columns; column += 1) {
    for (let segment = 0; segment < segmentsT; segment += 1) {
      const a = column * stride + segment;
      const b = a + stride;
      const c = a + 1;
      const d = b + 1;
      // Winding faces partly upwards when tilted; DoubleSide handles the rest.
      indices.push(a, b, c, c, b, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.rotateX(tilt);
  geometry.rotateZ(roll);
  geometry.rotateY(yaw);
  geometry.computeVertexNormals();
  return geometry;
}

function buildStemGeometry(height, detail) {
  if (height <= 0) return null;
  const geometry = new THREE.CylinderGeometry(
    0.00045,
    0.00062,
    height,
    detail ? 6 : 4,
    1,
  );
  geometry.translate(0, height / 2, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function addLeaf(list, config) {
  list.push(buildLeafGeometry(config));
}


function buildSproutGeometry(detail, day = 1, variety = CROP_VARIETIES['green-coral']) {
  const leaves = [];
  const development = THREE.MathUtils.clamp((day - 1) / 1, 0, 1);
  const stemHeight = (0.0019 + development * 0.0013) * variety.lengthScale;
  const stem = buildStemGeometry(stemHeight, detail);
  if (stem) leaves.push(stem);
  addLeaf(leaves, {
    length: (0.0015 + development * 0.0012) * variety.lengthScale,
    width: (0.00056 + development * 0.00018) * variety.widthScale,
    tilt: 1.24,
    yaw: 0.28,
    cup: 0.6,
    segmentsT: detail ? 4 : 2,
    segmentsV: detail ? 2 : 1,
  });
  addLeaf(leaves, {
    length: (0.0014 + development * 0.0011) * variety.lengthScale,
    width: (0.0005 + development * 0.00016) * variety.widthScale,
    tilt: 1.3,
    yaw: Math.PI - 0.34,
    cup: 0.55,
    phase: 1.2,
    segmentsT: detail ? 4 : 2,
    segmentsV: detail ? 2 : 1,
  });
  return mergeGeometries(leaves);
}

function buildRosetteGeometry(stage, leafCount, detail, day = 1, crop = CROP_NAME) {
  const parts = [];
  const variety = resolveCropVariety(crop);
  const development = cropDevelopmentForDay(day, crop);
  const stageConfig = {
    2: { baseLeaves: 2 },
    3: { baseLeaves: 2, trueLeaves: leafCount },
    4: { baseLeaves: 0, trueLeaves: leafCount },
    5: { baseLeaves: 0, trueLeaves: leafCount },
  }[stage];

  const stem = buildStemGeometry(development.height, detail);
  if (stem) parts.push(stem);

  // Pak Choy keeps a visibly thicker central petiole cluster beneath the broad
  // leaf blades; the other profiles use the slimmer lettuce stem.
  if (variety.key === 'pak-choy') {
    const petioleHeight = Math.max(0.004, development.height * 1.25);
    const petiole = new THREE.CylinderGeometry(
      0.0016,
      0.0022,
      petioleHeight,
      detail ? 6 : 4,
      1,
    );
    petiole.translate(0, petioleHeight / 2, 0);
    petiole.computeVertexNormals();
    parts.push(petiole);
  }

  if (stage === 2) {
    // Cotyledons open on Day 3 and expand through Day 5. Their dimensions are
    // calculated per day, not inherited from a single stage mesh.
    const t = THREE.MathUtils.clamp((day - 3) / 2, 0, 1);
    for (let leaf = 0; leaf < 2; leaf += 1) {
      addLeaf(parts, {
        length: (0.0052 + t * 0.0048) * variety.lengthScale,
        width: (0.0028 + t * 0.0022) * variety.widthScale,
        tilt: 1.32 - t * 0.07,
        yaw: leaf * Math.PI + 0.12,
        cup: 0.42 * variety.cup,
        curl: 0.0007,
        segmentsT: detail ? 7 : 3,
        segmentsV: detail ? 3 : 1,
      });
    }
    return mergeGeometries(parts);
  }

  // Cotyledons stay visible at the base through the early true-leaf stage.
  if (stageConfig.baseLeaves) {
    for (let leaf = 0; leaf < stageConfig.baseLeaves; leaf += 1) {
      addLeaf(parts, {
        length: 0.0052 * variety.lengthScale,
        width: 0.0025 * variety.widthScale,
        tilt: 1.35,
        yaw: leaf * Math.PI + 0.28,
        cup: 0.4 * variety.cup,
        curl: 0.0004,
        segmentsT: detail ? 5 : 3,
        segmentsV: detail ? 2 : 1,
      });
    }
  }

  const trueLeaves = stageConfig.trueLeaves;
  for (let leaf = 0; leaf < trueLeaves; leaf += 1) {
    const fraction = trueLeaves === 1 ? 0 : leaf / trueLeaves;
    const stageT =
      stage === 3
        ? THREE.MathUtils.clamp((day - 6) / 2, 0, 1)
        : stage === 4
          ? THREE.MathUtils.clamp((day - 9) / 2, 0, 1)
          : stage === 5
            ? THREE.MathUtils.clamp((day - 12) / 2, 0, 1)
            : 1;
    const layer = leaf % 3;
    let length = 0.014 + stageT * 0.011;
    let width = 0.0055 + stageT * 0.0037;
    let tilt = 0.82 - stageT * 0.08;
    let lobes = Math.min(2, variety.lobes);
    let lobeDepth = Math.min(0.16, variety.lobeDepth);
    let ruffle = 0.0002 * variety.ruffle;
    let cup = 0.46 * variety.cup;
    let curl = 0.0008;

    if (stage === 4) {
      length = (0.025 + stageT * 0.013) * variety.lengthScale;
      width = (0.0095 + stageT * 0.0045) * variety.widthScale;
      tilt = 1.04 + (leaf % 3) * 0.045;
      lobes = variety.lobes;
      lobeDepth = variety.lobeDepth;
      ruffle = (0.0012 + stageT * 0.0008) * variety.ruffle;
      cup = 0.52 * variety.cup;
      curl = 0.0035;
    } else if (stage === 5) {
      // A transplant plug is intentionally compact: roughly 5 cm across and
      // 3 cm tall. The 18-20 cm production head is built by the NFT geometry.
      const establishment = 1 + stageT * 0.08;
      length = [0.028, 0.019, 0.014][layer] * establishment * variety.lengthScale;
      width = [0.011, 0.009, 0.0072][layer] * establishment * variety.widthScale;
      tilt = [1.12, 0.88, 0.46][layer] + (leaf % 2) * 0.035;
      lobes = Math.min(variety.lobes, 2 + layer + Math.round(stageT * 2));
      lobeDepth = variety.lobeDepth * 0.55;
      ruffle = (0.0005 + stageT * 0.0005) * variety.ruffle;
      cup = 0.5 * variety.cup;
      curl = 0.0018;
    }

    addLeaf(parts, {
      length,
      width,
      tilt,
      yaw: fraction * Math.PI * 2 + (leaf % 2) * 0.19,
      roll: (leaf % 2 === 0 ? 1 : -1) * 0.055,
      lobes,
      lobeDepth,
      ruffle,
      cup,
      curl,
      phase: leaf * 1.37,
      segmentsT: detail ? 9 : 5,
      segmentsV: detail ? 4 : 2,
    });
  }

  return mergeGeometries(parts);
}


/* ------------------------------------------------- NFT production geometry */

const PRODUCTION_VARIANTS = [1.02, 1.03, 1.04, 1.05];

function productionLeafCountForVariant(day, variant) {
  const development = nftDevelopmentForDay(day, CROP_NAME);
  // Variants only perturb leaf size/yaw, never the shared stored leaf count.
  return Math.max(2, development.leafCount + (variant % 2));
}

/**
 * Broad, deeply ruffled coral rosette for NFT production. Leaf length is solved
 * from the target diameter (with a species width scale), so the Day-20 head
 * spans the requested 18-20 cm instead of merely being a scaled nursery plug.
 * Leaves are arranged from the oldest outer whorl to the youngest centre using
 * the golden angle, which gives even light coverage with no radial spokes.
 */
function buildProductionPlantGeometry(day, variant = 0, detail = false, variety) {
  const parts = [];
  const development = nftDevelopmentForDay(day, variety.name);
  const maturity = THREE.MathUtils.clamp(
    (development.day - 1) / (NFT_PRODUCTION_DAYS - 1),
    0,
    1,
  );
  const variantIndex =
    ((variant % PRODUCTION_VARIANTS.length) + PRODUCTION_VARIANTS.length) %
    PRODUCTION_VARIANTS.length;
  const diameter = development.rosetteDiameterM * PRODUCTION_VARIANTS[variantIndex];
  const radius = diameter / 2;
  const height = development.height;
  const stemHeight = Math.max(0.002, height * 0.105);
  const stem = buildStemGeometry(stemHeight, detail);
  if (stem) parts.push(stem);
  const leafCount = productionLeafCountForVariant(development.day, variantIndex);
  const yawPhase = variantIndex * 0.83 + (variety.goldenAngleOffset ?? 0);
  const heightBudget = Math.max(0.008, height - stemHeight);
  const segmentsT = detail ? 12 : 6;
  const segmentsV = detail ? 5 : 2;

  for (let leaf = 0; leaf < leafCount; leaf += 1) {
    const order = leafCount <= 1 ? 0 : leaf / (leafCount - 1);
    // Oldest leaves form the low, wide skirt; newer leaves rise toward a tight,
    // upright centre, producing the classic coral head silhouette.
    const tilt = THREE.MathUtils.lerp(1.3, 0.19, order) + Math.sin(leaf * 1.71) * 0.025;
    const radialTarget = THREE.MathUtils.lerp(radius, radius * 0.36, order);
    const verticalTarget =
      THREE.MathUtils.lerp(heightBudget * 0.28, heightBudget, order) * 1.18;
    // buildLeafGeometry shortens its centre line slightly at the tip; measuring
    // the result and compensating keeps the requested diameter honest.
    const length =
      Math.min(
        radialTarget / Math.max(0.13, Math.sin(tilt)),
        verticalTarget / Math.max(0.2, Math.cos(tilt)),
      ) * 1.08;
    const width = length * THREE.MathUtils.lerp(0.37, 0.3, order);
    const lobes = Math.max(
      2,
      Math.round(variety.lobes * (0.6 + maturity * 0.78) * (1 - order * 0.32)),
    );
    const lobeDepth = variety.lobeDepth * (0.62 + maturity * 0.62) * (1 - order * 0.22);
    const ruffle = (0.0011 + maturity * 0.0015) * variety.ruffle * (1 - order * 0.34);
    addLeaf(parts, {
      length,
      width,
      tilt,
      yaw: yawPhase + leaf * GOLDEN_ANGLE + Math.sin(leaf * 1.31 + variantIndex) * 0.025,
      roll: (leaf % 2 === 0 ? 1 : -1) * (0.035 + maturity * 0.025),
      lobes,
      lobeDepth,
      ruffle,
      cup: THREE.MathUtils.lerp(0.36, 0.68, order) * variety.cup,
      curl: (0.002 + maturity * 0.009) * (1 - order * 0.35),
      phase: leaf * 1.13 + variantIndex * 0.71,
      segmentsT,
      segmentsV,
    });
  }

  const geometry = mergeGeometries(parts);
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  // Solve both specs exactly: the widest horizontal span equals the milestone
  // diameter (including the variant scale) and the crown measures the milestone
  // height. Horizontal scaling is uniform, so leaf shape and golden-angle
  // spacing are preserved.
  const horizontalScale = diameter / Math.max(0.0001, Math.max(size.x, size.z));
  const verticalScale = height / Math.max(0.0001, size.y);
  geometry.scale(horizontalScale, verticalScale, horizontalScale);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * Legacy NFT production geometry accessor retained for compatibility and tests.
 * The live table renderer uses getLettuceHeadGeometry() from world/lettuce.js.
 * @param {string} crop crop name or variety key
 * @param {number} day local NFT production day (1-17)
 * @param {number} variant deterministic per-plant variant index (0-3)
 * @param {boolean} detailed high-detail buffer for close inspection
 */
export function getNftPlantGeometry(
  crop = CROP_NAME,
  day = 1,
  variant = 0,
  detailed = false,
) {
  const variety = resolveCropVariety(crop);
  const boundedDay = THREE.MathUtils.clamp(
    Math.round(Number(day) || 1),
    1,
    NFT_PRODUCTION_DAYS,
  );
  const variantIndex =
    ((Math.round(Number(variant) || 0) % PRODUCTION_VARIANTS.length) +
      PRODUCTION_VARIANTS.length) %
    PRODUCTION_VARIANTS.length;
  const key = `nft:${variety.key}:${boundedDay}:${variantIndex}:${detailed ? 1 : 0}`;
  if (geometryCache.has(key)) return geometryCache.get(key);
  const geometry = buildProductionPlantGeometry(boundedDay, variantIndex, detailed, variety);
  geometry.name = `nft-${variety.key}-day-${boundedDay}-variant-${variantIndex}-${detailed ? 'detail' : 'far'}`;
  geometryCache.set(key, geometry);
  return geometry;
}

/** Convenience alias with the day first. */
export function getProductionPlantGeometry(
  day = 1,
  crop = CROP_NAME,
  variant = 0,
  detailed = false,
) {
  return getNftPlantGeometry(crop, day, variant, detailed);
}


/** Suspended NFT root mass, one unit long downward from the crown. */
export function getNftRootGeometry(detailed = false) {
  const key = `nft-roots:${detailed ? 1 : 0}`;
  if (geometryCache.has(key)) return geometryCache.get(key);
  const parts = [];
  const strands = detailed ? 13 : 8;
  for (let index = 0; index < strands; index += 1) {
    const length = 0.68 + (((index * 37) % 100) / 100) * 0.32;
    const strand = new THREE.CylinderGeometry(
      0.00042,
      0.00085,
      length,
      detailed ? 4 : 3,
      1,
      true,
    );
    strand.translate(0, -length / 2, 0);
    strand.rotateZ(0.07 + (index % 4) * 0.045);
    strand.rotateY(index * GOLDEN_ANGLE);
    strand.computeVertexNormals();
    parts.push(strand);
    if (detailed && index % 3 === 0) {
      const branch = new THREE.CylinderGeometry(
        0.00028,
        0.00052,
        length * 0.48,
        3,
        1,
        true,
      );
      branch.translate(0, -length * 0.24, 0);
      branch.rotateZ(0.5 + (index % 2) * 0.18);
      branch.rotateY(index * GOLDEN_ANGLE + 1.4);
      branch.computeVertexNormals();
      parts.push(branch);
    }
  }
  const geometry = mergeGeometries(parts);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  geometry.name = `nft-roots-${detailed ? 'detail' : 'far'}`;
  geometryCache.set(key, geometry);
  return geometry;
}

/** Dark slotted net pot whose top rim sits on the NFT channel plate. */
export function getNftNetPotGeometry(detailed = false) {
  const key = `nft-net-pot:${detailed ? 1 : 0}`;
  if (geometryCache.has(key)) return geometryCache.get(key);
  const radius = 0.0255;
  const height = 0.026;
  const parts = [];
  const body = new THREE.CylinderGeometry(
    radius,
    radius * 0.82,
    height,
    detailed ? 14 : 8,
    1,
    true,
  );
  body.translate(0, -height / 2, 0);
  body.computeVertexNormals();
  parts.push(body);
  const rim = new THREE.TorusGeometry(
    radius,
    0.0017,
    detailed ? 5 : 3,
    detailed ? 16 : 9,
  );
  rim.rotateX(Math.PI / 2);
  rim.computeVertexNormals();
  parts.push(rim);
  const geometry = mergeGeometries(parts);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  geometry.name = `nft-net-pot-${detailed ? 'detail' : 'far'}`;
  geometryCache.set(key, geometry);
  return geometry;
}

/**
 * Daily, crop-specific nursery plug geometry. Leaf count and leaf dimensions are
 * part of the geometry cache key, so a new nursery day gets new leaves rather
 * than a uniformly stretched copy of yesterday's plant.
 */
export function getCropPlantGeometry(
  crop = CROP_NAME,
  stage = 1,
  day = 1,
  variant = 0,
  detailed = false,
) {
  const variety = resolveCropVariety(crop);
  const development = cropDevelopmentForDay(day, variety.name);
  const boundedStage = THREE.MathUtils.clamp(Math.round(stage), 1, GROWTH_STAGES.length);
  const boundedDay = THREE.MathUtils.clamp(Math.round(day), 1, MAX_CROP_DAY);
  const leafCount = THREE.MathUtils.clamp(
    development.leafCount + variant,
    2,
    18,
  );
  const key = `crop:${variety.key}:${boundedStage}:${boundedDay}:${leafCount}:${detailed ? 1 : 0}`;
  if (geometryCache.has(key)) return geometryCache.get(key);

  const geometry =
    boundedStage === 1
      ? buildSproutGeometry(detailed, boundedDay, variety)
      : buildRosetteGeometry(boundedStage, leafCount, detailed, boundedDay, variety.name);
  geometry.name = `${variety.key}-day-${boundedDay}-stage-${boundedStage}-variant-${variant}-${detailed ? 'detail' : 'far'}`;
  geometryCache.set(key, geometry);
  return geometry;
}

/**
 * Backwards-compatible Green Coral geometry accessor. Existing callers that
 * only know a stage get that stage's first day; new callers should pass the
 * exact day through getCropPlantGeometry.
 */
export function getPlantGeometry(stage, variant = 0, detailed = false) {
  const boundedStage = THREE.MathUtils.clamp(Math.round(stage), 1, GROWTH_STAGES.length);
  const definition = GROWTH_STAGES[stageIndex(boundedStage)];
  return getCropPlantGeometry(
    CROP_NAME,
    boundedStage,
    definition.minDay,
    variant,
    detailed,
  );
}


/** Dark peat/rockwool plug used by the germination stage. */
export function getSubstratePlugGeometry(detailed = false) {
  const key = `plug:${detailed ? 1 : 0}`;
  if (geometryCache.has(key)) return geometryCache.get(key);
  const geometry = new THREE.CylinderGeometry(
    0.0056,
    0.0062,
    0.0048,
    detailed ? 8 : 5,
    1,
  );
  geometry.translate(0, 0.0024, 0);
  geometry.computeVertexNormals();
  geometry.name = 'green-coral-substrate-plug';
  geometryCache.set(key, geometry);
  return geometry;
}

export function disposeGreenCoralGeometryCache() {
  for (const geometry of geometryCache.values()) geometry.dispose();
  geometryCache.clear();
}

