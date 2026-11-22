import * as THREE from 'three';

/**
 * Centre-screen raycast interaction.
 * The camera looks along -Z, so a single ray from the screen centre is enough to
 * pick the equipment under the crosshair. Hits are walked up the scene graph
 * until an object with `userData.interactable` is found, which lets each unit
 * register a group and still be picked by any of its child meshes.
 */
export class InteractionSystem {
  constructor({ camera, scene, interactables, maxDistance = 3.6 }) {
    this.camera = camera;
    this.scene = scene;
    this.interactables = interactables;
    this.maxDistance = maxDistance;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = maxDistance;
    this.screenCentre = new THREE.Vector2(0, 0);
    this.tapPoint = new THREE.Vector2(0, 0);
    this.enabled = false;
    this.locked = false;

    this.target = null;
    this.targetObject = null;
    this.targetInstanceId = null;
    this.targetBatchId = null;
    this.candidateObjects = [];
    this.instanceMatrix = new THREE.Matrix4();
    this.refreshCandidates();

    this.box = new THREE.Box3();
    this.highlight = new THREE.Box3Helper(this.box, 0x74d6b4);
    this.highlight.material.depthTest = false;
    this.highlight.material.transparent = true;
    this.highlight.material.opacity = 0.5;
    this.highlight.renderOrder = 3;
    this.highlight.visible = false;
    scene.add(this.highlight);
  }

  /** Keep one stable candidate array; rebuilding it per frame caused churn. */
  refreshCandidates() {
    this.candidateObjects.length = 0;
    for (const entry of this.interactables) {
      if (entry?.object) this.candidateObjects.push(entry.object);
    }
  }

  addInteractables(entries = []) {
    if (!entries.length) return this;
    this.interactables.push(...entries);
    this.refreshCandidates();
    return this;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  /** Switch the raycast between the walkthrough, orbit and inspection cameras. */
  setCamera(camera) {
    if (!camera || camera === this.camera) return this;
    this.camera = camera;
    this.clear();
    return this;
  }

  /** Objects are only raycast when the pointer is locked, to avoid hover flicker. */
  setLockState(locked) {
    this.locked = locked;
    if (!locked) this.clear();
  }

  clear() {
    this.target = null;
    this.targetObject = null;
    this.targetInstanceId = null;
    this.targetBatchId = null;
    this.highlight.visible = false;
  }

  update() {
    if (!this.enabled || !this.locked) return this.target;
    if (this.candidateObjects.length === 0) return null;
    this.raycaster.far = this.maxDistance;
    this.raycaster.setFromCamera(this.screenCentre, this.camera);
    const hits = this.raycaster.intersectObjects(this.candidateObjects, true);
    return this.#resolve(hits, { highlight: true });
  }

  /**
   * Version 14: touch taps are resolved from the tapped screen position instead
   * of the crosshair, so a finger can pick any visible badge or prop.
   */
  pickAt(ndcX, ndcY, { maxDistance = this.maxDistance, highlight = true } = {}) {
    if (!this.enabled || this.candidateObjects.length === 0) return null;
    this.raycaster.far = maxDistance;
    this.raycaster.setFromCamera(this.tapPoint.set(ndcX, ndcY), this.camera);
    const hits = this.raycaster.intersectObjects(this.candidateObjects, true);
    return this.#resolve(hits, { highlight });
  }

  #resolve(hits, { highlight }) {
    let found = null;
    let foundObject = null;
    let foundHit = null;
    for (const hit of hits) {
      // Raycaster does not test visibility. Invisible proxy meshes are intentional
      // interaction targets, but a batch inside a hidden cutaway must not block.
      // Hidden proxies are intentional; hidden parents (cutaway roofs, carried
      // boxes and stored trays) must never intercept a click.
      if (!this.isVisibleInHierarchy(hit.object.parent)) continue;
      if (hit.object.isBatchedMesh && !hit.object.visible) continue;
      const resolver = hit.object.userData.resolveInteractable;
      const resolved =
        typeof resolver === 'function'
          ? resolver(hit.batchId ?? hit.instanceId)
          : null;
      if (resolved) {
        found = {
          data: resolved,
          distance: hit.distance,
          instanceId: hit.instanceId,
          batchId: hit.batchId,
          object: hit.object,
        };
        foundObject = hit.object;
        foundHit = hit;
        break;
      }
      let node = hit.object;
      while (node && !node.userData.interactable) node = node.parent;
      if (node && node.userData.interactable) {
        found = {
          data: node.userData.interactable,
          distance: hit.distance,
          instanceId: null,
          batchId: null,
          object: node,
        };
        foundObject = node;
        foundHit = hit;
        break;
      }
      // Opaque, non-interactive geometry in front of the target: stop looking.
      if (!hit.object.material?.transparent) break;
    }

    const changed =
      found?.data !== this.target?.data ||
      found?.instanceId !== this.targetInstanceId ||
      found?.batchId !== this.targetBatchId ||
      foundObject !== this.targetObject;
    if (changed) {
      this.target = found;
      this.targetObject = foundObject;
      this.targetInstanceId = found?.instanceId ?? null;
      this.targetBatchId = found?.batchId ?? null;
      this.highlight.visible = false;
    }

    if (!highlight || !foundObject || !foundHit) return this.target;
    if (foundObject.userData.suppressHighlight) {
      this.highlight.visible = false;
      return this.target;
    }
    this.updateHighlight(foundObject, foundHit.instanceId, foundHit.batchId);
    return this.target;
  }

  isVisibleInHierarchy(object) {
    let node = object;
    while (node) {
      if (node.visible === false) return false;
      node = node.parent;
    }
    return true;
  }

  /** Boxes one instanced plant, one batch entry, or a whole equipment group. */
  updateHighlight(object, instanceId, batchId = null) {
    if (batchId != null && object.isBatchedMesh) {
      const boxResolver = object.userData.resolveHighlightBox;
      const box = typeof boxResolver === 'function' ? boxResolver(batchId) : null;
      if (!box) {
        this.highlight.visible = false;
        return;
      }
      this.box.copy(box);
    } else if (instanceId == null || !object.isInstancedMesh) {
      this.box.setFromObject(object);
    } else {
      const geometry = object.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      object.getMatrixAt(instanceId, this.instanceMatrix);
      object.updateWorldMatrix(true, false);
      this.instanceMatrix.premultiply(object.matrixWorld);
      this.box.copy(geometry.boundingBox).applyMatrix4(this.instanceMatrix);
    }
    if (this.box.isEmpty()) {
      this.highlight.visible = false;
      return;
    }
    this.highlight.box = this.box;
    this.highlight.updateMatrixWorld(true);
    this.highlight.visible = true;
  }

  dispose() {
    this.scene.remove(this.highlight);
    this.highlight.geometry?.dispose();
    this.highlight.material?.dispose();
    this.target = null;
    this.targetObject = null;
    this.targetInstanceId = null;
    this.targetBatchId = null;
    this.candidateObjects.length = 0;
  }
}
