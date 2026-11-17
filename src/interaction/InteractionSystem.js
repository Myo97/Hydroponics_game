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
    this.enabled = false;
    this.locked = false;

    this.target = null;
    this.targetObject = null;
    this.targetInstanceId = null;

    this.box = new THREE.Box3();
    this.highlight = new THREE.Box3Helper(this.box, 0x74d6b4);
    this.highlight.material.depthTest = false;
    this.highlight.material.transparent = true;
    this.highlight.material.opacity = 0.5;
    this.highlight.renderOrder = 3;
    this.highlight.visible = false;
    scene.add(this.highlight);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.clear();
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
    this.highlight.visible = false;
  }

  update() {
    if (!this.enabled || !this.locked) return this.target;

    const candidates = this.interactables.map((entry) => entry.object);
    if (candidates.length === 0) return null;

    this.raycaster.setFromCamera(this.screenCentre, this.camera);
    const hits = this.raycaster.intersectObjects(candidates, true);

    let found = null;
    let foundObject = null;
    let foundHit = null;
    for (const hit of hits) {
      const resolved =
        hit.instanceId != null && typeof hit.object.userData.resolveInteractable === 'function'
          ? hit.object.userData.resolveInteractable(hit.instanceId)
          : null;
      if (resolved) {
        found = {
          data: resolved,
          distance: hit.distance,
          instanceId: hit.instanceId,
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
      foundObject !== this.targetObject;
    if (changed) {
      this.target = found;
      this.targetObject = foundObject;
      this.targetInstanceId = found?.instanceId ?? null;
      this.highlight.visible = false;
    }

    if (!foundObject || !foundHit) return this.target;
    if (foundObject.userData.suppressHighlight) {
      this.highlight.visible = false;
      return this.target;
    }
    this.updateHighlight(foundObject, foundHit.instanceId);
    return this.target;
  }

  /** Boxes one instanced plant or the whole equipment group when not instanced. */
  updateHighlight(object, instanceId) {
    if (instanceId == null || !object.isInstancedMesh) {
      this.box.setFromObject(object);
    } else {
      const geometry = object.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const matrix = new THREE.Matrix4();
      object.getMatrixAt(instanceId, matrix);
      object.updateWorldMatrix(true, false);
      matrix.premultiply(object.matrixWorld);
      this.box.copy(geometry.boundingBox).applyMatrix4(matrix);
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
  }
}
