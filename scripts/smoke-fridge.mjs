import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GlassRefrigerator } from '../src/world/GlassRefrigerator.js';
import { HarvestController } from '../src/systems/HarvestController.js';
import { HarvestBox } from '../src/world/harvest/HarvestBox.js';
import { Game } from '../src/core/Game.js';

const material = new THREE.MeshBasicMaterial();
const materials = new Proxy({}, { get: () => material });
const fridges = [0, 1, 2].map(index => {
  const fridge = new GlassRefrigerator({ parent: new THREE.Group(), materials });
  fridge.info.id = `fridge-${index}`;
  return fridge;
});
// Match the shop's shared inventory, with independently controlled doors.
for (const fridge of fridges) fridge.boxes = fridges[0].boxes;
const harvest = new HarvestController({ camera: new THREE.PerspectiveCamera(),
  fridge: fridges[0], fridges });
const box = new HarvestBox({ id: 'popup-box', index: 0 });
box.addHead({ cropKey: 'lettuce', cropName: 'Lettuce', weightG: 100 });
harvest.boxes.push(box);
harvest.byId.set(box.id, box);
assert.equal(harvest.pickUp(box).ok, true);

let menu;
let enabled = true;
let locks = 0;
const game = Object.assign(Object.create(Game.prototype), {
  harvest, trayPickup: { isCarrying: false },
  containerHouse: { fridge: fridges[0], fridge2: fridges[1], extraFridges: [fridges[2]] },
  player: { setEnabled: value => { enabled = value; }, exitPointerLock() {}, requestPointerLock: () => { locks++; } },
  interaction: { setEnabled() {} },
  ui: { closeInspect() {}, setTarget() {}, showFridge: state => { menu = state; },
    updateFridge: state => { menu = state; }, closeFridge() {}, toast() {}, setBoxCarry() {} },
  requestShadowUpdate() {},
});

for (const fridge of fridges) {
  const target = { data: fridge.info };
  assert.equal(game.decorateCarryTarget(target).data.interaction, 'fridge-inspect');
  assert.equal(game.activateTarget(target), true);
  assert.equal(game.activeFridge, fridge);
  assert.equal(enabled, false);
  assert.equal(fridge.doorOpen, false, 'Click only opens popup');
  assert.equal(menu.carrying, true);
  game.useFridgeBox();
  assert.equal(harvest.carried, box, 'Closed fridge rejects storing');
  assert.equal(harvest.storeInFridge(fridge).ok, false);
  game.useFridgeDoor();
  game.useFridgeBox();
  assert.equal(harvest.isCarrying, false);
  assert.equal(box.view.parent, fridge.boxRoot, 'Box goes into selected cabinet');
  assert.equal(menu.carrying, false);
  assert.equal(fridge.info.interaction, 'fridge-inspect');
  game.useFridgeDoor();
  fridge.update(2);
  assert.equal(fridge.doorAngle, 0, 'Stocked fridge closes fully');
  assert.equal(fridge.doors.every(door => door.pivot.rotation.y === 0), true);
  game.useFridgeBox();
  assert.equal(box.stored, true, 'Closed fridge rejects taking');
  assert.equal(harvest.takeFromFridge(fridge).ok, false);
  game.useFridgeDoor();
  box.shopReserved = 1;
  game.useFridgeBox();
  assert.equal(box.stored, true, 'Reserved stock stays in fridge');
  box.shopReserved = 0;
  game.trayPickup.isCarrying = true;
  game.useFridgeBox();
  assert.equal(box.stored, true, 'Cannot carry a tray and box together');
  game.trayPickup.isCarrying = false;
  game.useFridgeBox();
  assert.equal(harvest.carried, box);
  assert.equal(fridge.boxes.length, 0);
  assert.equal(box.view, null);
  game.useFridgeDoor();
  fridge.update(2);
  assert.equal(fridge.doorAngle, 0, 'Can close while carrying');
  game.closeInspect();
  assert.equal(game.activeFridge, null);
  assert.equal(enabled, true);
}
assert.equal(locks, 3, 'Closing popup restores mouse controls');

game.openFridge(fridges[1]);
game.containerHouse.shopFridgeWasOpen = true;
game.useFridgeDoor();
game.useFridgeDoor();
assert.equal(game.containerHouse.shopFridgeWasOpen, false, 'Shop assistant preserves player close choice');
const capacity = fridges[1].capacity;
fridges[1].capacity = 0;
game.useFridgeDoor();
game.useFridgeBox();
assert.equal(harvest.carried, box, 'Full storage never loses carried box');
fridges[1].capacity = capacity;
game.closeFridge();
for (const fridge of fridges) fridge.dispose();
box.dispose();
material.dispose();
console.log('PASS fridge popup, independent doors, closed/full storage guards, reserved stock, tray conflicts and carry restoration');
