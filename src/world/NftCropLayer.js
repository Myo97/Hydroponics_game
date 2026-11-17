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
  createLettuceReadyRingMaterial,
  getLettuceHeadGeometry,
  getLettuceLeafMaterial,
  getLettuceNetCupMaterial,
  getLettuceReadyRingGeometry,
  getLettuceRockwoolGeometry,
  getLettuceRockwoolMaterial,
  lettuceStageForDay,
} from './lettuce.js';

const temp = new THREE.Object3D();
const ease = (value) => value * value * (3 - 2 * value);
const DETAILED_VARIANTS = 4;

/**
 * Renders the real per-hole NFT production plants held by PlantSimulation.
 *
 * Each plant is bucketed by (crop, local NFT day, deterministic variant), so a
 * table needs only a few InstancedMeshes while still showing 320 independently
 * aged individuals. Every bucket reuses one cached merged lettuce geometry, a
 * vertex-coloured shared leaf material, one net cup and one rockwool cube.
 * Geometry is rebuilt only when a table's actual plants or day buckets change;
 * a short eased scale bridges the one-day growth step.
 */
export class NftCropLayer {
  constructor({ materials, tables, layout }) {
    this.materials = materials;
    this.tables = tables;
    this.layout = layout;
    this.simulation = null;
    this.group = null;
    this.tableGroups = new Map();
    this.signatures = new Map();

    this.leafMaterial = getLettuceLeafMaterial();
    this.rootMaterial = new THREE.MeshStandardMaterial({
      name: 'nft-production-roots',
      color: 0xe4dcc0,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.netPotMaterial = getLettuceNetCupMaterial();
    this.rockwoolMaterial = getLettuceRockwoolMaterial();
    this.readyRingMaterial = createLettuceReadyRingMaterial();
    this.lastVersion = -1;
  }

  build(parent) {
    this.group = new THREE.Group();
    this.group.name = 'nft-crop-layer';
    parent.add(this.group);
    for (const table of this.tables) {
      const tableGroup = table.group;
      if (!tableGroup) continue;
      this.tableGroups.set(table.id, {
        group: tableGroup,
        meshes: [],
        buckets: [],
        plants: [],
        rootMesh: null,
        potMesh: null,
        rockwoolMesh: null,
        readyRingMesh: null,
        ageById: new Map(),
        fromAgeById: new Map(),
        transitionElapsed: 1,
        transitionDuration: 1.4,
      });
      this.signatures.set(table.id, '');
    }
    return this;
  }

  attach(simulation) {
    this.simulation = simulation;
    this.lastVersion = -1;
    this.refresh(true);
  }

  refresh(force = false) {
    if (!this.group) return;
    if (this.simulation) this.lastVersion = this.simulation.version;
    for (const table of this.tables) {
      const entry = this.tableGroups.get(table.id);
      if (!entry) continue;
      const plantings = this.simulation?.getTablePlantings(table.id) ?? [];
      if (plantings.length === 0) {
        if (entry.meshes.length) this.clearTable(entry);
        entry.plants = [];
        entry.ageById.clear();
        this.signatures.set(table.id, '');
        continue;
      }
      const detailed = this.viewerIsNear(table);
      const variantCount = detailed ? DETAILED_VARIANTS : 1;
      const buckets = new Map();
      const bucketKeys = [];
      let idHash = 0;
      for (const plant of plantings) {
        const development = nftDevelopmentForDay(this.nftDayForPlant(plant), plant.cropName);
        const variety = resolveCropVariety(plant.cropName);
        const variant = Math.min(
          variantCount - 1,
          Math.floor((plant.variantSeed ?? 0) * variantCount),
        );
        const key = `${variety.key}:${development.day}:${variant}`;
        if (!buckets.has(key)) {
          buckets.set(key, {
            day: development.day,
            variant,
            variety,
            detailed,
            plants: [],
          });
        }
        buckets.get(key).plants.push(plant);
        for (let index = 0; index < plant.id.length; index += 1) {
          idHash = (idHash * 31 + plant.id.charCodeAt(index)) >>> 0;
        }
      }
      bucketKeys.push(...buckets.keys());
      const signature = `${detailed ? 1 : 0}:${plantings.length}:${idHash}:${bucketKeys.join('|')}`;
      if (!force && signature === this.signatures.get(table.id)) {
        continue;
      }
      this.signatures.set(table.id, signature);
      this.rebuildTable(table, entry, buckets, detailed, plantings);
    }
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
    const viewer = this.viewerPosition;
    if (!viewer) return false;
    return Math.hypot(viewer.x - table.centerX, viewer.z - table.centerZ) < 7.5;
  }

  rebuildTable(table, entry, buckets, detailed, plantings) {
    const previousAges = new Map(entry.ageById);
    const hadPlants = entry.plants.length > 0;
    this.clearTable(entry);
    entry.plants = plantings;
    entry.fromAgeById = previousAges;
    entry.ageById.clear();
    entry.transitionElapsed = hadPlants ? 0 : 1.4;
    entry.transitionDuration = 1.4;

    for (const bucket of buckets.values()) {
      const geometry = getLettuceHeadGeometry(
        bucket.variety.name,
        bucket.day,
        bucket.variant,
        detailed,
      );
      const mesh = new THREE.InstancedMesh(geometry, this.leafMaterial, bucket.plants.length);
      mesh.name = `${table.id}-${bucket.variety.key}-lettuce-day-${bucket.day}-v${bucket.variant}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData.sharedGeometry = true;
      mesh.userData.suppressHighlight = true;
      if (table.data) {
        mesh.userData.interactable = table.data;
        mesh.userData.tableId = table.id;
        mesh.userData.resolveInteractable = (instanceId) =>
          this.describePlant(bucket.plants[instanceId], table);
      }
      entry.group.add(mesh);
      entry.meshes.push(mesh);
      entry.buckets.push({ mesh, bucket });
      for (const plant of bucket.plants) {
        entry.ageById.set(plant.id, this.nftDayForPlant(plant));
      }
    }

    const count = plantings.length;
    const rootMesh = new THREE.InstancedMesh(getNftRootGeometry(), this.rootMaterial, count);
    rootMesh.name = `${table.id}-nft-production-roots`;
    rootMesh.castShadow = false;
    rootMesh.receiveShadow = true;
    rootMesh.frustumCulled = false;
    rootMesh.userData.sharedGeometry = false;
    rootMesh.userData.suppressHighlight = true;
    if (table.data) {
      rootMesh.userData.interactable = table.data;
      rootMesh.userData.tableId = table.id;
    }
    entry.group.add(rootMesh);
    entry.meshes.push(rootMesh);
    entry.rootMesh = rootMesh;

    const potMesh = new THREE.InstancedMesh(getNftNetPotGeometry(), this.netPotMaterial, count);
    potMesh.name = `${table.id}-nft-net-pots`;
    potMesh.castShadow = detailed;
    potMesh.receiveShadow = true;
    potMesh.frustumCulled = false;
    potMesh.userData.sharedGeometry = false;
    potMesh.userData.suppressHighlight = true;
    if (table.data) {
      potMesh.userData.interactable = table.data;
      potMesh.userData.tableId = table.id;
    }
    entry.group.add(potMesh);
    entry.meshes.push(potMesh);
    entry.potMesh = potMesh;

    const rockwoolMesh = new THREE.InstancedMesh(
      getLettuceRockwoolGeometry(),
      this.rockwoolMaterial,
      count,
    );
    rockwoolMesh.name = `${table.id}-lettuce-rockwool-cubes`;
    rockwoolMesh.castShadow = detailed;
    rockwoolMesh.receiveShadow = true;
    rockwoolMesh.frustumCulled = false;
    rockwoolMesh.userData.sharedGeometry = true;
    rockwoolMesh.userData.suppressHighlight = true;
    if (table.data) {
      rockwoolMesh.userData.interactable = table.data;
      rockwoolMesh.userData.tableId = table.id;
    }
    entry.group.add(rockwoolMesh);
    entry.meshes.push(rockwoolMesh);
    entry.rockwoolMesh = rockwoolMesh;

    const readyPlants = plantings.filter(
      (plant) => plant.harvestReady || this.nftDayForPlant(plant) >= NFT_PRODUCTION_DAYS,
    );
    if (readyPlants.length > 0) {
      const ringMesh = new THREE.InstancedMesh(
        getLettuceReadyRingGeometry(),
        this.readyRingMaterial,
        readyPlants.length,
      );
      ringMesh.name = `${table.id}-lettuce-harvest-ready-rings`;
      ringMesh.castShadow = false;
      ringMesh.receiveShadow = false;
      ringMesh.frustumCulled = false;
      ringMesh.userData.sharedGeometry = true;
      ringMesh.userData.suppressHighlight = true;
      if (table.data) {
        ringMesh.userData.interactable = table.data;
        ringMesh.userData.tableId = table.id;
      }
      entry.group.add(ringMesh);
      entry.meshes.push(ringMesh);
      entry.readyRingMesh = ringMesh;
      entry.readyPlantIds = new Set(readyPlants.map((plant) => plant.id));
    } else {
      entry.readyRingMesh = null;
      entry.readyPlantIds = null;
    }

    this.placeTablePlants(table, entry);
  }

  /** Interpolated NFT day is only a visual bridge; the plant's stored day is exact. */
  displayAge(entry, plant) {
    const target = this.nftDayForPlant(plant);
    const from = entry.fromAgeById.get(plant.id);
    if (!Number.isFinite(from) || from >= target) return target;
    const t = ease(
      Math.min(1, entry.transitionElapsed / Math.max(0.001, entry.transitionDuration)),
    );
    return from + (target - from) * t;
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

  placeTablePlants(table, entry) {
    const { rootMesh, potMesh, rockwoolMesh, readyRingMesh } = entry;
    for (const { mesh, bucket } of entry.buckets) {
      bucket.plants.forEach((plant, instance) => {
        const hole = this.holeTransform(table, plant);
        if (!hole) return;
        const displayAge = this.displayAge(entry, plant);
        const targetAge = this.nftDayForPlant(plant);
        // Bridge the one-day step using the same diameter curve as the rendered
        // head, so a new stage starts at yesterday's width and eases to today's.
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
        mesh.setMatrixAt(instance, temp.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }

    let ringInstance = 0;
    entry.plants.forEach((plant, instance) => {
      const hole = this.holeTransform(table, plant);
      if (!hole) return;
      const displayAge = this.displayAge(entry, plant);
      const development = nftDevelopmentForDay(displayAge, plant.cropName);
      const seed = plant.variantSeed ?? 0.5;
      const rootDepth = development.rootDepthM * (0.94 + seed * 0.12);
      if (rootMesh) {
        temp.position.set(hole.x, hole.y - 0.026, hole.z);
        temp.rotation.set(0, (plant.growthSeed ?? 0) * 0.6, 0);
        temp.scale.set(0.9 + seed * 0.16, Math.max(0.02, rootDepth), 0.9 + seed * 0.16);
        temp.updateMatrix();
        rootMesh.setMatrixAt(instance, temp.matrix);
      }
      if (potMesh) {
        temp.position.set(hole.x, hole.y + 0.006, hole.z);
        temp.rotation.set(0, seed * Math.PI, 0);
        temp.scale.setScalar(1);
        temp.updateMatrix();
        potMesh.setMatrixAt(instance, temp.matrix);
      }
      if (rockwoolMesh) {
        temp.position.set(hole.x, hole.y + 0.006, hole.z);
        temp.rotation.set(0, seed * Math.PI * 0.5, 0);
        temp.scale.setScalar(1);
        temp.updateMatrix();
        rockwoolMesh.setMatrixAt(instance, temp.matrix);
      }
      if (
        readyRingMesh &&
        entry.readyPlantIds?.has(plant.id) &&
        ringInstance < readyRingMesh.count
      ) {
        temp.position.set(
          hole.x,
          hole.y + LETTUCE_CROWN_OFFSET_M + development.height + 0.018,
          hole.z,
        );
        temp.rotation.set(0, 0, 0);
        temp.scale.setScalar(1);
        temp.updateMatrix();
        readyRingMesh.setMatrixAt(ringInstance, temp.matrix);
        ringInstance += 1;
      }
    });
    for (const mesh of [rootMesh, potMesh, rockwoolMesh, readyRingMesh]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
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

  clearTable(entry) {
    for (const mesh of entry.meshes) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    entry.meshes.length = 0;
    entry.buckets.length = 0;
    entry.rootMesh = null;
    entry.potMesh = null;
    entry.rockwoolMesh = null;
    entry.readyRingMesh = null;
    entry.readyPlantIds = null;
  }

  update(dt, viewer = null) {
    if (viewer) this.viewerPosition = viewer;
    this.refresh();
    for (const table of this.tables) {
      const entry = this.tableGroups.get(table.id);
      if (!entry || entry.transitionElapsed >= entry.transitionDuration) continue;
      entry.transitionElapsed = Math.min(
        entry.transitionDuration,
        entry.transitionElapsed + Math.max(0, dt),
      );
      this.placeTablePlants(table, entry);
      if (entry.transitionElapsed >= entry.transitionDuration) {
        entry.fromAgeById.clear();
      }
    }
  }

  dispose() {
    if (!this.group) return;
    for (const entry of this.tableGroups.values()) this.clearTable(entry);
    this.tableGroups.clear();
    this.signatures.clear();
    this.group.removeFromParent();
    this.group = null;
    this.simulation = null;
    // Leaf/net-cup/rockwool materials are shared module-level lettuce materials.
    // They are owned by lettuce.js, so this layer only disposes its own ones.
    this.rootMaterial?.dispose();
    this.readyRingMaterial?.dispose();
  }
}
