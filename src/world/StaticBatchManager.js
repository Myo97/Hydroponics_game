import * as THREE from 'three';

const _relativeMatrix = new THREE.Matrix4();
const _scopeInverse = new THREE.Matrix4();
const _worldBox = new THREE.Box3();

function attributeSignature(geometry) {
  const names = Object.keys(geometry.attributes).sort();
  return names
    .map((name) => {
      const attribute = geometry.getAttribute(name);
      return `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}`;
    })
    .join('|');
}

function ownsDynamicMaterial(material) {
  return Boolean(
    material?.userData?.dynamic ||
      material?.isShaderMaterial ||
      material?.transparent ||
      material?.depthWrite === false ||
      (material?.opacity ?? 1) < 0.999 ||
      Array.isArray(material),
  );
}

function nearestInteractable(object) {
  let node = object;
  while (node) {
    if (node.userData?.interactable) return node.userData.interactable;
    node = node.parent;
  }
  return null;
}

/**
 * Collapses static opaque meshes into one THREE.BatchedMesh per material/scope.
 *
 * The scene already uses InstancedMesh for repeated structure. This pass handles
 * the remaining unique static meshes (valves, brackets, labels, tank shells,
 * pipe fittings). BatchedMesh keeps per-object culling and raycast IDs, so
 * interaction metadata and highlight boxes survive the collapse.
 *
 * Dynamic roots are never traversed. Visibility-controlled groups are declared
 * as scopes so their batch is parented under the same toggle.
 */
export class StaticBatchManager {
  constructor({ scene }) {
    this.scene = scene;
    this.batches = [];
    this.dynamicRoots = new Set();
    this.scopes = new Set();
    this.groups = new Map();
    this.stats = {
      sourceMeshes: 0,
      batchedMeshes: 0,
      skippedMeshes: 0,
      batches: 0,
      vertices: 0,
      indices: 0,
    };
  }

  markDynamic(...objects) {
    for (const object of objects) {
      if (object) this.dynamicRoots.add(object);
    }
    return this;
  }

  markScope(...objects) {
    for (const object of objects) {
      if (object) {
        object.userData.batchScope = true;
        this.scopes.add(object);
      }
    }
    return this;
  }

  /** Recurse until a scope is reached, then collect that scope's static meshes. */
  collect(object, scope, inheritedDynamic = false) {
    if (!object) return;
    const dynamic = inheritedDynamic || this.dynamicRoots.has(object);
    if (dynamic) return;
    if (object !== scope && object.userData?.batchScope) {
      scope = object;
    }

    if (object.isMesh && !object.isInstancedMesh && !object.isBatchedMesh) {
      this.stats.sourceMeshes += 1;
      if (this.isEligible(object)) this.addCandidate(object, scope);
      else this.stats.skippedMeshes += 1;
    }

    for (const child of object.children) this.collect(child, scope, false);
  }

  isEligible(object) {
    const geometry = object.geometry;
    if (!geometry?.getAttribute('position')) return false;
    if (object.isSkinnedMesh || object.isSprite || object.isPoints || object.isLine) return false;
    // Removing a mesh also removes its children. Only batch leaf meshes so no
    // transparent/invisible child is accidentally detached from the scene.
    if (object.children.length > 0) return false;
    if (!object.visible || object.userData?.noBatch) return false;
    if (geometry.morphAttributes && Object.keys(geometry.morphAttributes).length) return false;
    const material = object.material;
    if (!material || ownsDynamicMaterial(material)) return false;
    if (material.visible === false) return false;
    return true;
  }

  addCandidate(object, scope) {
    const material = object.material;
    const geometry = object.geometry;
    const key = [
      material.uuid,
      scope.uuid,
      object.castShadow ? 1 : 0,
      object.receiveShadow ? 1 : 0,
      object.renderOrder ?? 0,
      Boolean(geometry.index) ? 1 : 0,
      attributeSignature(geometry),
    ].join('|');
    let group = this.groups.get(key);
    if (!group) {
      group = {
        key,
        material,
        scope,
        castShadow: object.castShadow,
        receiveShadow: object.receiveShadow,
        renderOrder: object.renderOrder ?? 0,
        entries: [],
      };
      this.groups.set(key, group);
    }
    group.entries.push(object);
  }

  build() {
    if (!this.scene) return this;
    this.scene.updateMatrixWorld(true);
    this.collect(this.scene, this.scene, false);
    let batchIndex = 0;
    for (const group of this.groups.values()) {
      this.createBatch(group, batchIndex);
      batchIndex += 1;
    }
    this.stats.batches = this.batches.length;
    return this;
  }

  createBatch(group, batchIndex) {
    const entries = group.entries;
    if (entries.length === 0) return null;
    const geometryIds = new Map();
    let maxVertices = 0;
    let maxIndices = 0;
    for (const entry of entries) {
      const geometry = entry.geometry;
      if (!geometryIds.has(geometry.uuid)) {
        geometryIds.set(geometry.uuid, geometry);
        maxVertices += geometry.getAttribute('position').count;
        maxIndices += geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
      }
    }
    if (maxVertices === 0) return null;

    const batch = new THREE.BatchedMesh(
      entries.length,
      maxVertices,
      Math.max(maxIndices, entries.length * 3),
      group.material,
    );
    batch.name = `static-batch-${batchIndex}-${group.material.name || 'material'}`;
    batch.castShadow = group.castShadow;
    batch.receiveShadow = group.receiveShadow;
    batch.renderOrder = group.renderOrder;
    batch.frustumCulled = true;
    batch.perObjectFrustumCulled = true;
    batch.sortObjects = true;

    _scopeInverse.copy(group.scope.matrixWorld).invert();
    const items = [];
    const geometryIdByUuid = new Map();
    for (const entry of entries) {
      const worldMatrix = entry.matrixWorld;
      _relativeMatrix.multiplyMatrices(_scopeInverse, worldMatrix);
      let geometryId = geometryIdByUuid.get(entry.geometry.uuid);
      if (geometryId == null) {
        geometryId = batch.addGeometry(entry.geometry);
        geometryIdByUuid.set(entry.geometry.uuid, geometryId);
      }
      const instanceId = batch.addInstance(geometryId);
      batch.setMatrixAt(instanceId, _relativeMatrix);

      const geometry = entry.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry.boundingBox.clone().applyMatrix4(worldMatrix);
      items[instanceId] = {
        data: nearestInteractable(entry) ?? entry.userData?.interactable ?? null,
        box,
        name: entry.name,
      };
    }

    batch.userData.resolveInteractable = (instanceId) => items[instanceId]?.data ?? null;
    batch.userData.resolveHighlightBox = (instanceId) => items[instanceId]?.box ?? null;
    batch.userData.staticBatchItems = items;
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    group.scope.add(batch);

    for (const entry of entries) entry.removeFromParent();
    this.batches.push(batch);
    this.stats.batchedMeshes += entries.length;
    this.stats.vertices += maxVertices;
    this.stats.indices += maxIndices;
    return batch;
  }

  dispose() {
    for (const batch of this.batches) {
      batch.removeFromParent();
      batch.dispose?.();
    }
    this.batches.length = 0;
    this.groups.clear();
    this.dynamicRoots.clear();
    this.scopes.clear();
  }
}

