import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FarmOrbitController, FARM_VIEWS } from '../src/player/FarmOrbitController.js';
import { Game } from '../src/core/Game.js';
import { InteractionSystem } from '../src/interaction/InteractionSystem.js';
import { getLettuceHeadGeometry } from '../src/world/lettuce.js';
import { LowPolyCylinderGeometry, LowPolySphereGeometry } from '../src/world/LowPolyGeometry.js';
import { stylizeMaterial } from '../src/world/StylizedArt.js';
import { SaveSystem } from '../src/save/SaveSystem.js';
import { CAMERA_FOV, clampFov } from '../src/config/camera.js';

assert.equal(CAMERA_FOV.default, 68);
assert.equal(clampFov(45), CAMERA_FOV.default, 'Legacy 45 degree setting migrates to the designed view');
assert.equal(clampFov(68), 68);
assert.equal(clampFov(180), CAMERA_FOV.max, 'Oversized saved FOV is clamped');
assert.equal(clampFov('not-a-number'), CAMERA_FOV.default, 'Malformed FOV falls back to default');
const makeCamera = () => ({ fov: 0, updated: 0, updateProjectionMatrix() { this.updated++; } });
const fovGame = Object.assign(Object.create(Game.prototype), {
  camera: makeCamera(), orbitCamera: makeCamera(), droneCamera: makeCamera(),
});
assert.equal(fovGame.setFov(CAMERA_FOV.default), CAMERA_FOV.default);
assert.equal(fovGame.camera.fov, CAMERA_FOV.default);
assert.equal(fovGame.orbitCamera.fov, CAMERA_FOV.default);
assert.equal(fovGame.droneCamera.fov, CAMERA_FOV.default);
assert.equal(fovGame.setFov(38), 38, 'Internal close-up poses may use a tighter lens');
assert.equal(fovGame.orbitCamera.fov, 38);
assert.equal(fovGame.setFov(NaN), 38, 'Invalid projection values are ignored');
const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
const previousWindow = globalThis.window;
globalThis.window = {
  localStorage: { getItem: () => JSON.stringify({ quality: 'high', sensitivity: 1, fov: 45 }) },
};
const migratedSettings = Game.prototype.loadSettings.call({});
assert.equal(migratedSettings.fov, CAMERA_FOV.default, 'Saved legacy camera settings are migrated on load');
const defaultViewGame = new Game({ container: {} });
assert.equal(defaultViewGame.orbitView, false, 'The walkthrough is the default view');
if (hadWindow) globalThis.window = previousWindow;
else delete globalThis.window;
console.log('PASS FOV defaults, clamping, projection updates and saved-setting migration');

class Surface extends EventTarget {
  constructor() {
    super();
    this.ownerDocument = new EventTarget();
    this.clientWidth = 1280; this.clientHeight = 720; this.style = {};
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
  setPointerCapture() {}
  releasePointerCapture() {}
}
const surface = new Surface();
const camera = new THREE.PerspectiveCamera(45, 1280 / 720, 0.1, 450);
const orbit = new FarmOrbitController({ camera, domElement: surface });
orbit.setEnabled(true);
const dispatch = (target, type, props = {}) => {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: 1, pointerType: 'mouse', button: 0,
    clientX: 640, clientY: 360, pageX: 640, pageY: 360,
    ctrlKey: false, shiftKey: false, metaKey: false, deltaMode: 0, ...props });
  target.dispatchEvent(event);
  return event;
};

const before = camera.position.clone();
dispatch(surface, 'pointerdown');
dispatch(surface.ownerDocument, 'pointermove', { clientX: 900, pageX: 900 });
dispatch(surface.ownerDocument, 'pointerup');
for (let i = 0; i < 80; i++) orbit.update();
assert.ok(camera.position.distanceTo(before) > 5, 'Dragging rotates around the farm');
assert.ok(camera.position.y > 0, 'Camera stays above ground');
const distance = camera.position.distanceTo(orbit.target);
dispatch(surface, 'wheel', { deltaY: -120 });
orbit.update();
assert.ok(camera.position.distanceTo(orbit.target) < distance, 'Wheel zooms');
const targetBefore = orbit.target.clone();
dispatch(surface, 'pointerdown', { button: 2 });
dispatch(surface.ownerDocument, 'pointermove', { button: 2, clientX: 790, pageX: 790 });
dispatch(surface.ownerDocument, 'pointerup', { button: 2 });
orbit.update();
assert.ok(orbit.target.distanceTo(targetBefore) > 0.1, 'Right drag pans');
orbit.focus('nursery');
assert.deepEqual(orbit.target.toArray(), FARM_VIEWS.nursery.target);
dispatch(surface, 'pointerdown', { pointerType: 'touch', pointerId: 10, pageX: 500 });
dispatch(surface, 'pointerdown', { pointerType: 'touch', pointerId: 11, pageX: 700 });
const touchDistance = camera.position.distanceTo(orbit.target);
dispatch(surface.ownerDocument, 'pointermove', { pointerType: 'touch', pointerId: 11, pageX: 900 });
dispatch(surface.ownerDocument, 'pointerup', { pointerType: 'touch', pointerId: 11 });
dispatch(surface.ownerDocument, 'pointerup', { pointerType: 'touch', pointerId: 10 });
orbit.update();
assert.ok(camera.position.distanceTo(orbit.target) < touchDistance, 'Pinch zooms');
orbit.setEnabled(false);
const pausedPose = camera.position.clone();
dispatch(surface, 'wheel', { deltaY: -120 });
assert.equal(camera.position.distanceTo(pausedPose), 0, 'Paused controls ignore wheel');
orbit.focus('nursery');
const map = new Map();
const save = new SaveSystem({ storage: { setItem: (k, v) => map.set(k, v), getItem: k => map.get(k) } });
save.save({ orbit });
const snapshot = orbit.snapshot();
orbit.focus('farm');
orbit.restore(save.load().orbit);
assert.deepEqual(orbit.target.toArray(), snapshot.target);
assert.ok(camera.position.distanceTo(new THREE.Vector3().fromArray(snapshot.position)) < 1e-8);
orbit.restore({ target: [NaN, 0, 0], position: [0, 0, 0] });
assert.deepEqual(orbit.target.toArray(), snapshot.target, 'Bad saves are ignored');
orbit.restore({ target: [1000, 0, -1000], position: [1005, 5, -995] });
assert.ok(orbit.target.x <= 24 && orbit.target.z >= -25, 'Pan bounds constrain restored targets');
console.log('PASS orbit rotation, zoom, pan, pinch, pause, named views and save restore');

orbit.focus('farm'); camera.updateMatrixWorld(true);
const scene = new THREE.Scene();
const parent = new THREE.Group(); scene.add(parent);
const proxy = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
proxy.position.copy(orbit.target); proxy.visible = false;
proxy.userData.interactable = { id: 'test-equipment', interaction: 'inspect' };
parent.add(proxy); scene.updateMatrixWorld(true);
const interaction = new InteractionSystem({ camera, scene, interactables: [{ object: proxy }] });
interaction.setEnabled(true);
let clicks = 0;
const game = Object.assign(Object.create(Game.prototype), {
  started: true, paused: false, inspecting: false, droneView: false, orbitView: true,
  activePointers: new Set(), renderer: { domElement: surface }, interaction,
  player: { isPointerLocked: () => false }, ui: { isModalOpen: () => false },
  activateTarget: target => { assert.equal(target.data.id, 'test-equipment'); clicks++; },
});
const tap = { pointerId: 1, button: 0, clientX: 640, clientY: 360 };
game.onCanvasPointerDown(tap); game.onCanvasPointerUp(tap);
assert.equal(clicks, 1, 'Orbit click reaches objects beyond first-person distance');
game.onCanvasPointerDown(tap);
game.onCanvasPointerMove({ ...tap, clientX: 700 });
game.onCanvasPointerMove(tap);
game.onCanvasPointerUp(tap);
assert.equal(clicks, 1, 'Drag out and back never activates an object');
game.onCanvasPointerDown(tap);
game.onCanvasPointerDown({ ...tap, pointerId: 2 });
game.onCanvasPointerUp({ ...tap, pointerId: 2 });
game.onCanvasPointerUp(tap);
assert.equal(clicks, 1, 'Multi-touch never activates objects');
parent.visible = false;
assert.equal(interaction.pickAt(0, 0, { maxDistance: 180 }), null, 'Hidden cutaway parents cannot intercept clicks');
parent.visible = true;
assert.equal(interaction.pickAt(0, 0, { maxDistance: 180 }).data.id, 'test-equipment', 'Invisible proxies still work');
console.log('PASS distant pointer picking, drag suppression, multi-touch suppression and cutaway picking');

const walkCamera = new THREE.PerspectiveCamera(68, 1280 / 720, 0.06, 240);
const farmCamera = new THREE.PerspectiveCamera(68, 1280 / 720, 0.1, 450);
let walkEnabled = null;
let farmEnabled = null;
let orbitUiMode = null;
let lockRequests = 0;
let lockState = null;
const viewGame = Object.assign(Object.create(Game.prototype), {
  started: true, paused: false, inspecting: false, droneView: false, orbitView: true,
  activePointers: new Set(), orbitPointer: { x: 0, y: 0 }, canvasTap: null,
  camera: walkCamera, orbitCamera: farmCamera,
  player: {
    setEnabled(value) { walkEnabled = value; },
    exitPointerLock() {},
    clearInput() {},
    syncCamera() {},
  },
  orbit: { setEnabled(value) { farmEnabled = value; }, focus() {} },
  interaction: {
    camera: farmCamera,
    setCamera(camera) { this.camera = camera; },
    setEnabled() {},
    setLockState(value) { lockState = value; },
    clear() {},
  },
  touch: { setActive() {}, setTarget() {} },
  ui: {
    setOrbitMode(value) { orbitUiMode = value; },
    setTarget() {},
    toast() {},
    isModalOpen: () => false,
  },
  requestLookLock() { lockRequests += 1; this.interaction.setLockState(true); return true; },
});
viewGame.setOrbitView(false);
assert.equal(viewGame.orbitView, false, 'Orbit view can return to the first-person walkthrough');
assert.equal(walkEnabled, true, 'Returning to walkthrough enables WASD movement');
assert.equal(farmEnabled, false, 'Orbit controls are suspended in first person');
assert.equal(viewGame.interaction.camera, walkCamera, 'Interaction ray follows the walkthrough camera');
assert.equal(orbitUiMode, false, 'HUD restores the walkthrough controls');
assert.equal(lockRequests, 1, 'Returning to walkthrough restores mouse look');
assert.equal(lockState, true, 'First-person centre-screen targeting is active');
viewGame.toggleOrbitView();
assert.equal(viewGame.orbitView, true, 'The view toggle returns to the orbit camera');
assert.equal(walkEnabled, false, 'Orbit view disables the walking controller');
assert.equal(farmEnabled, true, 'Orbit controls resume in farm view');
assert.equal(viewGame.interaction.camera, farmCamera, 'Interaction ray follows the orbit camera');
assert.equal(orbitUiMode, true, 'HUD shows the orbit toolbar');
console.log('PASS first-person/orbit view switching, WASD controller ownership and interaction camera handoff');

const cylinder = new LowPolyCylinderGeometry(1, 1, 2, 64);
const sphere = new LowPolySphereGeometry(1, 64, 32);
assert.equal(cylinder.parameters.radialSegments, 8);
assert.equal(sphere.parameters.widthSegments, 8);
const lettuce = getLettuceHeadGeometry('Green Coral Lettuce', 17, 0, 0);
assert.ok(lettuce.index.count / 3 < 2500, 'Mature close-up head stays below 2500 triangles');
const surfaceMaterial = new THREE.MeshStandardMaterial({ name: 'galvanised-steel', metalness: 1 });
stylizeMaterial(surfaceMaterial);
assert.equal(surfaceMaterial.flatShading, true);
assert.equal(surfaceMaterial.metalness, 0.08);
const labelTexture = new THREE.Texture();
const label = new THREE.MeshStandardMaterial({ name: 'label-EC', map: labelTexture });
stylizeMaterial(label); assert.equal(label.map, labelTexture, 'Controller labels remain legible');
console.log(`PASS faceted primitives, protected labels and low-poly crop budget (${lettuce.index.count / 3} triangles per mature close-up head)`);
orbit.dispose(); interaction.dispose(); proxy.geometry.dispose(); proxy.material.dispose();
cylinder.dispose(); sphere.dispose(); surfaceMaterial.dispose(); label.dispose(); labelTexture.dispose();
