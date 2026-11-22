import * as THREE from 'three';
import {
  NFT_PRODUCTION_DAYS,
  getNftNetPotGeometry,
  getNftRootGeometry,
  nftDevelopmentForDay,
  resolveCropVariety,
} from '../simulation/GreenCoralGrowth.js';
import {
  LETTUCE_CROWN_OFFSET_M,
  LETTUCE_NET_POT_RECESS_M,
  LETTUCE_ROCKWOOL_HEIGHT_M,
  LETTUCE_ROCKWOOL_TOP_BELOW_SURFACE_M,
  getLettuceHeadGeometry,
  getLettuceLeafMaterial,
  getLettuceNetCupMaterial,
  getLettuceRockwoolGeometry,
  getLettuceRockwoolMaterial,
  lettuceStageForDay,
} from './lettuce.js';
import {
  HARVEST_GLOW_LENGTH_M,
  HARVEST_GLOW_LIFT_M,
  HARVEST_GLOW_WIDTH_M,
  NftHarvestGlow,
} from './NftHarvestGlow.js';

const temp = new THREE.Object3D();
const ease = (value) => value * value * (3 - 2 * value);
const DETAILED_VARIANTS = 3;
// Per-plant detail bands. Full 60-leaf geometry is reserved for heads within
// arm's reach; mid/far heads use cached 24/10-leaf silhouettes.
const NEAR_DISTANCE_M = 2.5;
const MID_DISTANCE_M = 8;
const NEAR_HYSTERESIS_M = 0.75;
const LOD_ANCHOR_STEP_M = 1;

function pooledCapacity(count) {
  return Math.max(8, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
}

/**
 * Renders the real per-hole NFT production plants held by PlantSimulation.
 *
 * Plants are pooled globally by (crop, local NFT day, variant, LOD) rather than
 * per table. A full 5,760-plant house therefore uses a few dozen InstancedMeshes
 * instead of hundreds, while still showing individually aged and varied plants.
 * Geometry comes from the shared lettuce cache; only matrices are rebuilt when
 * the simulation version or the per-table LOD changes.
 */
export class NftCropLayer {
  constructor({ materials, tables, layout }) {
    this.materials = materials;
    this.tables = tables;
    this.layout = layout;
    this.simulation = null;
    this.group = null;
    this.tableGroups = new Map();
    this.tablesById = new Map();
    this.batches = new Map();
    this.supportPools = new Map();
    this.viewerPosition = null;
    this.lodAnchor = null;
    this.lodSignature = '';
    this.lastVersion = -1;
    this.activeTransitions = false;

    this.leafMaterial = getLettuceLeafMaterial();
    this.rootMaterial = new THREE.MeshStandardMaterial({ flatShading: true,
      name: 'nft-production-roots',
      color: 0xe4dcc0,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.netPotMaterial = getLettuceNetCupMaterial();
    this.rockwoolMaterial = getLettuceRockwoolMaterial();
    this.harvestGlow = new NftHarvestGlow({
      matrixForPlant: (plant) => this.harvestGlowMatrix(plant),
    });
  }

  build(parent) {
    this.group = new THREE.Group();
    this.group.name = 'nft-crop-layer';
    parent.add(this.group);
    for (const table of this.tables) {
      if (!table.group) continue;
      this.tablesById.set(table.id, table);
      this.tableGroups.set(table.id, {
        table,
        meshes: [],
        buckets: [],
        plants: [],
        ageById: new Map(),
        fromAgeById: new Map(),
        transitionElapsed: 1,
        transitionDuration: 1.4,
        lodFull: false,
        rootMesh: null,
        potMesh: null,
        rockwoolMesh: null,
        harvestGlowMesh: null,
      });
    }
    this.harvestGlow.build(this.group);
    return this;
  }

  attach(simulation) {
    this.simulation = simulation;
    this.lastVersion = -1;
    this.lodAnchor = null;
    this.refresh(true);
  }

  getInteractables() {
    return this.group ? [{ object: this.group }] : [];
  }

  /**
   * Recompute which tables are close enough for the detailed (four-variant)
   * geometry. The 1.5 m hysteresis prevents rapid bucket churn at the boundary.
   */
  updateTableLods() {
    let changed = false;
    const viewer = this.viewerPosition;
    for (const entry of this.tableGroups.values()) {
      const table = entry.table;
      const distance = viewer
        ? Math.hypot(viewer.x - table.centerX, viewer.z - table.centerZ)
        : Infinity;
      const threshold = entry.lodFull
        ? NEAR_DISTANCE_M + NEAR_HYSTERESIS_M
        : NEAR_DISTANCE_M;
      const full = distance <= threshold;
      if (full !== entry.lodFull) {
        entry.lodFull = full;
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Rebuild per-plant LOD only after the viewer walks ~1 m. This keeps buckets
   * stable while standing still and avoids a full 5,760-plant rebuild each frame.
   */
  updateLodAnchor() {
    const viewer = this.viewerPosition;
    if (!viewer) return false;
    if (
      this.lodAnchor &&
      Math.hypot(viewer.x - this.lodAnchor.x, viewer.z - this.lodAnchor.z) <
        LOD_ANCHOR_STEP_M
    ) {
      return false;
    }
    this.lodAnchor = { x: viewer.x, z: viewer.z };
    return true;
  }

  /** 0 = close detail, 1 = mid, 2 = far silhouette. */
  plantLod(table, plant) {
    const viewer = this.lodAnchor ?? this.viewerPosition;
    if (!viewer) return 2;
    const hole = this.holeTransform(table, plant);
    if (!hole) return 2;
    const distance = Math.hypot(viewer.x - hole.x, viewer.z - hole.z);
    if (distance <= NEAR_DISTANCE_M) return 0;
    if (distance <= MID_DISTANCE_M) return 1;
    return 2;
  }

  refresh(force = false) {
    if (!this.group) return;
    const version = this.simulation?.version ?? 0;
    const moved = this.updateLodAnchor();
    const tableLodChanged = moved ? this.updateTableLods() : false;
    const lodChanged = tableLodChanged || moved;
    const versionChanged = force || version !== this.lastVersion;
    if (!versionChanged && !lodChanged) return;

    if (versionChanged) {
      for (const entry of this.tableGroups.values()) {
        const plantings = this.simulation?.getTablePlantings(entry.table.id) ?? [];
        const hadPlants = entry.plants.length > 0;
        entry.fromAgeById = new Map(entry.ageById);
        entry.ageById.clear();
        entry.plants = plantings;
        entry.transitionElapsed = hadPlants ? 0 : 1.4;
        entry.transitionDuration = 1.4;
        for (const plant of plantings) {
          entry.ageById.set(plant.id, this.nftDayForPlant(plant));
        }
      }
      this.lastVersion = version;
    }

    this.rebuildBatches(versionChanged);
    this.lodSignature = this.currentLodSignature();
  }

  currentLodSignature() {
    return this.tables
      .map((table) => (this.tableGroups.get(table.id)?.lodFull ? '1' : '0'))
      .join('');
  }

  nftDayForPlant(plant) {
    const explicit = Number(plant?.nftAgeDays ?? plant?.nftProductionAgeDays);
    if (Number.isFinite(explicit)) {
      return THREE.MathUtils.clamp(Math.round(explicit), 1, NFT_PRODUCTION_DAYS);
    }
    const total = Number(plant?.ageDays) || 14;
    return THREE.MathUtils.clamp(Math.round(total - 14), 1, NFT_PRODUCTION_DAYS);
  }

  viewerIsNear(table) {
    return Boolean(this.tableGroups.get(table.id)?.lodFull);
  }

  /**
   * Rebuild bucket membership only when plant data or table LOD changes.
   * Instance buffers grow geometrically and are reused across day transitions.
   */
  rebuildBatches(versionChanged) {
    const desired = new Map();
    const roots = [];
    const detailSupports = [];
    const farSupports = [];
    const readyPlants = [];

    for (const entry of this.tableGroups.values()) {
      entry.buckets.length = 0;
      for (const plant of entry.plants) {
        const day = this.nftDayForPlant(plant);
        const variety = resolveCropVariety(plant.cropName);
        const lod = this.plantLod(entry.table, plant);
        const variantCount = lod === 0 ? DETAILED_VARIANTS : 1;
        const variant = Math.min(
          variantCount - 1,
          Math.floor((plant.variantSeed ?? 0.5) * variantCount),
        );
        // Per-table buckets give every batch a tight bounding sphere, so
        // InstancedMesh frustum culling can reject tables behind the camera
        // instead of submitting all 5,760 plants.
        const key = `${entry.table.id}:${variety.key}:${day}:${variant}:${lod}`;
        let bucket = desired.get(key);
        if (!bucket) {
          bucket = {
            key,
            day,
            variant,
            variety,
            lod,
            detailed: lod === 0,
            items: [],
          };
          desired.set(key, bucket);
        }
        bucket.items.push({ plant, tableId: plant.tableId });
        if (lod < 2) roots.push(plant);
        if (lod < 2) detailSupports.push(plant);
        else farSupports.push(plant);
        if (plant.harvestReady || day >= NFT_PRODUCTION_DAYS) readyPlants.push(plant);
      }
    }

    for (const [key, bucket] of desired) {
      let batch = this.batches.get(key);
      if (!batch) {
        batch = { key, geometry: null, mesh: null, capacity: 0, items: [] };
        this.batches.set(key, batch);
      }
      bucket.geometry = getLettuceHeadGeometry(
        bucket.variety.name,
        bucket.day,
        bucket.variant,
        bucket.lod,
      );
      batch.geometry = bucket.geometry;
      batch.items = bucket.items;
      this.ensureBatchMesh(batch, bucket);
      const tableIds = new Set(bucket.items.map((item) => item.tableId));
      for (const tableId of tableIds) {
        this.tableGroups.get(tableId)?.buckets.push({ mesh: batch.mesh, bucket });
      }
    }

    for (const [key, batch] of this.batches) {
      if (desired.has(key)) continue;
      batch.mesh?.removeFromParent();
      this.batches.delete(key);
    }


    this.ensureSupportPool(
      'roots',
      getNftRootGeometry(),
      this.rootMaterial,
      roots,
      { castShadow: false, receiveShadow: true },
      (plant) => this.rootMatrix(plant),
    );
    this.ensureSupportPool(
      'pots-detail',
      getNftNetPotGeometry(),
      this.netPotMaterial,
      detailSupports,
      { castShadow: true, receiveShadow: true },
      (plant) => this.potMatrix(plant),
    );
    this.ensureSupportPool(
      'pots-far',
      getNftNetPotGeometry(),
      this.netPotMaterial,
      farSupports,
      { castShadow: false, receiveShadow: true },
      (plant) => this.potMatrix(plant),
    );
    this.ensureSupportPool(
      'rockwool-detail',
      getLettuceRockwoolGeometry(),
      this.rockwoolMaterial,
      detailSupports,
      { castShadow: true, receiveShadow: true },
      (plant) => this.rockwoolMatrix(plant),
    );
    this.ensureSupportPool(
      'rockwool-far',
      getLettuceRockwoolGeometry(),
      this.rockwoolMaterial,
      farSupports,
      { castShadow: false, receiveShadow: true },
      (plant) => this.rockwoolMatrix(plant),
    );
    this.harvestGlow.sync(readyPlants);

    this.applyAllMatrices();

    for (const entry of this.tableGroups.values()) {
      entry.rootMesh = this.supportPools.get('roots')?.mesh ?? null;
      entry.potMesh =
        this.supportPools.get(entry.lodFull ? 'pots-detail' : 'pots-far')?.mesh ?? null;
      entry.rockwoolMesh =
        this.supportPools.get(entry.lodFull ? 'rockwool-detail' : 'rockwool-far')?.mesh ?? null;
      entry.harvestGlowMesh = this.harvestGlow.mesh;
      entry.meshes = [
        ...new Set(
          entry.buckets
            .map((bucket) => bucket.mesh)
            .concat(
              [entry.rootMesh, entry.potMesh, entry.rockwoolMesh, entry.harvestGlowMesh].filter(
                Boolean,
              ),
            ),
        ),
      ];
    }

    if (versionChanged) this.activeTransitions = this.hasActiveTransitions();
  }

  ensureBatchMesh(batch, bucket) {
    const count = bucket.items.length;
    if (batch.mesh && batch.capacity >= count) {
      batch.mesh.count = count;
      batch.mesh.visible = count > 0;
      return;
    }
    batch.mesh?.removeFromParent();
    batch.capacity = pooledCapacity(count);
    const mesh = new THREE.InstancedMesh(bucket.geometry, this.leafMaterial, batch.capacity);
    const tableId = bucket.items[0]?.tableId ?? 'table';
    mesh.name = `nft-crop-${tableId}-${bucket.variety.key}-day-${bucket.day}-v${
      bucket.variant
    }-${bucket.detailed ? 'near' : 'far'}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.count = count;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.sharedGeometry = true;
    mesh.userData.suppressHighlight = true;
    mesh.userData.cropBucket = true;
    mesh.userData.resolveInteractable = (instanceId) => {
      const item = batch.items[instanceId];
      if (!item) return null;
      const table = this.tablesById.get(item.tableId);
      return table ? this.describePlant(item.plant, table) : null;
    };
    this.group.add(mesh);
    batch.mesh = mesh;
  }

  ensureSupportPool(key, geometry, material, plants, options, matrixForPlant) {
    let pool = this.supportPools.get(key);
    if (!pool) {
      pool = {
        key,
        geometry,
        material,
        mesh: null,
        capacity: 0,
        plants: [],
        options,
        matrixForPlant,
      };
      this.supportPools.set(key, pool);
    }
    pool.plants = plants;
    pool.matrixForPlant = matrixForPlant;
    const count = plants.length;
    if (pool.mesh && pool.capacity >= count) {
      pool.mesh.count = count;
      pool.mesh.visible = count > 0;
      return;
    }
    pool.mesh?.removeFromParent();
    pool.capacity = pooledCapacity(count);
    const mesh = new THREE.InstancedMesh(geometry, material, pool.capacity);
    mesh.name = `nft-crop-${key}`;
    mesh.castShadow = options.castShadow;
    mesh.receiveShadow = options.receiveShadow;
    mesh.frustumCulled = false;
    mesh.count = count;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.sharedGeometry = true;
    mesh.userData.suppressHighlight = true;
    mesh.userData.cropSupport = key;
    this.group.add(mesh);
    pool.mesh = mesh;
  }


  holeTransform(table, plant) {
    const beds = this.layout.beds;
    const margin = (beds.gullyLength - (beds.holesPerGully - 1) * beds.holeSpacing) / 2;
    const gully = table.gullies[plant.gully];
    if (!gully) return null;
    const z = gully.startZ + margin + plant.hole * beds.holeSpacing;
    const fraction = (z - gully.startZ) / Math.max(0.001, gully.endZ - gully.startZ);
    const topY = gully.topYStart + (gully.topYEnd - gully.topYStart) * fraction;
    return { x: gully.x, y: topY, z };
  }

  displayAge(entry, plant) {
    const target = this.nftDayForPlant(plant);
    const from = entry?.fromAgeById.get(plant.id);
    if (!Number.isFinite(from) || from >= target) return target;
    if (!entry || entry.transitionElapsed >= entry.transitionDuration) return target;
    const t = ease(
      Math.min(1, entry.transitionElapsed / Math.max(0.001, entry.transitionDuration)),
    );
    return from + (target - from) * t;
  }

  headMatrix(plant, tableId = plant.tableId) {
    const entry = this.tableGroups.get(tableId);
    const table = entry?.table ?? this.tablesById.get(tableId);
    if (!table) return null;
    const hole = this.holeTransform(table, plant);
    if (!hole) return null;
    const displayAge = entry ? this.displayAge(entry, plant) : this.nftDayForPlant(plant);
    const targetAge = this.nftDayForPlant(plant);
    const correction = THREE.MathUtils.clamp(
      lettuceStageForDay(displayAge).diameterM /
        Math.max(0.0001, lettuceStageForDay(targetAge).diameterM),
      0.82,
      1,
    );
    const variantScale = 0.985 + (plant.variantSeed ?? 0.5) * 0.03;
    temp.position.set(hole.x, hole.y + LETTUCE_CROWN_OFFSET_M, hole.z);
    temp.rotation.set(0, plant.growthSeed ?? (plant.variantSeed ?? 0.5) * Math.PI * 2, 0);
    temp.scale.setScalar(correction * variantScale);
    temp.updateMatrix();
    return temp.matrix;
  }

  rootMatrix(plant) {
    const table = this.tablesById.get(plant.tableId);
    if (!table) return null;
    const hole = this.holeTransform(table, plant);
    if (!hole) return null;
    const seed = plant.variantSeed ?? 0.5;
    const development = nftDevelopmentForDay(this.nftDayForPlant(plant), plant.cropName);
    const rootDepth = development.rootDepthM * (0.94 + seed * 0.12);
    const plugBase =
      hole.y -
      (LETTUCE_ROCKWOOL_TOP_BELOW_SURFACE_M + LETTUCE_ROCKWOOL_HEIGHT_M);
    temp.position.set(hole.x, plugBase - 0.002, hole.z);
    temp.rotation.set(0, (plant.growthSeed ?? 0) * 0.6, 0);
    temp.scale.set(0.9 + seed * 0.16, Math.max(0.02, rootDepth), 0.9 + seed * 0.16);
    temp.updateMatrix();
    return temp.matrix;
  }

  potMatrix(plant) {
    const table = this.tablesById.get(plant.tableId);
    if (!table) return null;
    const hole = this.holeTransform(table, plant);
    if (!hole) return null;
    const seed = plant.variantSeed ?? 0.5;
    // The net cup drops into the 52 mm opening; only its dark rim shows.
    temp.position.set(hole.x, hole.y - LETTUCE_NET_POT_RECESS_M, hole.z);
    temp.rotation.set(0, seed * Math.PI, 0);
    temp.scale.setScalar(1);
    temp.updateMatrix();
    return temp.matrix;
  }

  rockwoolMatrix(plant) {
    const table = this.tablesById.get(plant.tableId);
    if (!table) return null;
    const hole = this.holeTransform(table, plant);
    if (!hole) return null;
    const seed = plant.variantSeed ?? 0.5;
    // The plug top sits 6 mm below the plate, fully inside the hole.
    temp.position.set(
      hole.x,
      hole.y - (LETTUCE_ROCKWOOL_TOP_BELOW_SURFACE_M + LETTUCE_ROCKWOOL_HEIGHT_M),
      hole.z,
    );
    temp.rotation.set(0, seed * Math.PI * 0.5, 0);
    temp.scale.setScalar(1);
    temp.updateMatrix();
    return temp.matrix;
  }

  /**
   * Harvest lighting stays on the channel surface. The pool follows the 1.2°
   * gully fall so it never floats above the plate or clips the perforations.
   */
  harvestGlowMatrix(plant) {
    const table = this.tablesById.get(plant.tableId);
    if (!table) return null;
    const hole = this.holeTransform(table, plant);
    if (!hole) return null;
    const slope = Math.tan(THREE.MathUtils.degToRad(this.layout.beds.slopeDegrees));
    temp.position.set(hole.x, hole.y + HARVEST_GLOW_LIFT_M, hole.z);
    temp.rotation.set(slope, 0, 0);
    temp.scale.set(HARVEST_GLOW_WIDTH_M, 1, HARVEST_GLOW_LENGTH_M);
    temp.updateMatrix();
    return temp.matrix;
  }


  applyAllMatrices() {
    for (const batch of this.batches.values()) {
      let instance = 0;
      for (const item of batch.items) {
        const matrix = this.headMatrix(item.plant, item.tableId);
        if (!matrix) continue;
        batch.mesh.setMatrixAt(instance, matrix);
        instance += 1;
      }
      batch.mesh.count = instance;
      batch.mesh.visible = instance > 0;
      batch.mesh.instanceMatrix.needsUpdate = true;
      if (instance > 0) batch.mesh.computeBoundingSphere();
    }

    for (const pool of this.supportPools.values()) {
      let instance = 0;
      for (const plant of pool.plants) {
        const matrix = pool.matrixForPlant(plant);
        if (!matrix) continue;
        pool.mesh.setMatrixAt(instance, matrix);
        instance += 1;
      }
      pool.mesh.count = instance;
      pool.mesh.visible = instance > 0;
      pool.mesh.instanceMatrix.needsUpdate = true;
    }
    this.activeTransitions = this.hasActiveTransitions();
  }

  hasActiveTransitions() {
    for (const entry of this.tableGroups.values()) {
      if (entry.transitionElapsed < entry.transitionDuration) return true;
    }
    return false;
  }

  /**
   * Interpolated NFT day is only a visual bridge; the plant's stored day is exact.
   * The scale correction bridges the one-day growth step.
   */
  update(dt, viewer = null) {
    if (viewer) this.viewerPosition = viewer;
    this.refresh();
    this.harvestGlow.update(dt);
    if (!this.hasActiveTransitions()) {
      this.activeTransitions = false;
      return;
    }
    for (const entry of this.tableGroups.values()) {
      if (entry.transitionElapsed >= entry.transitionDuration) continue;
      entry.transitionElapsed = Math.min(
        entry.transitionDuration,
        entry.transitionElapsed + Math.max(0, dt),
      );
      if (entry.transitionElapsed >= entry.transitionDuration) {
        entry.fromAgeById.clear();
      }
    }
    this.applyAllMatrices();
  }

  describePlant(plant, table) {
    if (!plant) return null;
    const description = this.simulation?.describePlant?.(plant, table) ?? null;
    if (description) return description;
    return {
      ok: false,
      message: 'This plant is still being established in the NFT channel.',
      tableId: table.id,
    };
  }

  dispose() {
    if (!this.group) return;
    this.harvestGlow.dispose();
    for (const batch of this.batches.values()) batch.mesh?.removeFromParent();
    for (const pool of this.supportPools.values()) pool.mesh?.removeFromParent();
    this.batches.clear();
    this.supportPools.clear();
    this.tableGroups.clear();
    this.tablesById.clear();
    this.group.removeFromParent();
    this.group = null;
    this.simulation = null;
    // Leaf/net-cup/rockwool materials are shared module-level lettuce materials.
    // They are owned by lettuce.js, so this layer only disposes its own ones.
    this.rootMaterial?.dispose();
  }
}
