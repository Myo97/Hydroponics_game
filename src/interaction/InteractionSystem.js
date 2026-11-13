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

    this.box = new THREE.Box3();
    this.highlight = new THREE.BoxHelper(new THREE.Object3D(), 0x74d6b4);
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
    for (const hit of hits) {
      let node = hit.object;
      while (node && !node.userData.interactable) node = node.parent;
      if (node && node.userData.interactable) {
        found = { data: node.userData.interactable, distance: hit.distance };
        foundObject = node;
        break;
      }
      // Opaque, non-interactive geometry in front of the target: stop looking.
      if (!hit.object.material?.transparent) break;
    }

    if (found !== this.target || foundObject !== this.targetObject) {
      this.target = found;
      this.targetObject = foundObject;
      if (foundObject) {
        this.highlight.setFromObject(foundObject);
        this.highlight.visible = true;
      } else {
        this.highlight.visible = false;
      }
    } else if (foundObject) {
      this.highlight.setFromObject(foundObject);
    }

    return this.target;
  }

  dispose() {
    this.scene.remove(this.highlight);
    this.highlight.geometry?.dispose();
    this.highlight.material?.dispose();
    this.target = null;
    this.targetObject = null;
  }
}
