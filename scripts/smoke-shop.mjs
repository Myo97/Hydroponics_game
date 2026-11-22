import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AutoShopController } from '../src/systems/AutoShopController.js';
import { GlassRefrigerator } from '../src/world/GlassRefrigerator.js';
import { HarvestBox } from '../src/world/harvest/HarvestBox.js';
import { SaveSystem } from '../src/save/SaveSystem.js';

const material = new THREE.MeshBasicMaterial();
const materials = new Proxy({}, { get: () => material });
const storage = new Map();
const save = new SaveSystem({ storage: { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) } });

function setup(stock = 8) {
  const fridge = new GlassRefrigerator({ parent: new THREE.Group(), materials });
  const box = new HarvestBox({ id: 'test-box', index: 0 });
  for (let i = 0; i < stock; i++) box.addHead({ cropKey: 'lettuce', cropName: 'Lettuce', weightG: 100 });
  if (stock) fridge.addBox(box);
  const house = { fridge, extraFridges: [] };
  const market = { cash: 0 };
  const climate = { dayIndex: 0 };
  const shop = new AutoShopController({ house, market, climate, random: () => 0.75 });
  return { fridge, box, house, market, climate, shop };
}

function advance(shop, seconds) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.25) shop.update(0.25);
}

function reach(shop, stage) {
  for (let i = 0; i < 300 && shop.order?.stage !== stage; i++) shop.update(0.25);
  assert.equal(shop.order?.stage, stage);
}

// Public flow and physical refrigerator reservation guard.
const basic = setup();
advance(basic.shop, 60);
assert.equal(basic.market.cash, 0);
basic.shop.setPrice('lettuce', 2.1);
basic.shop.setOpen(true);
reach(basic.shop, 'arriving');
assert.equal(basic.shop.order.quantity, 4);
assert.equal(basic.shop.stock()[0].available, 4);
assert.equal(basic.fridge.removeBox(basic.box).ok, false);
basic.shop.setPrice('lettuce', 9);
basic.shop.setOpen(false);
advance(basic.shop, 60);
assert.equal(basic.market.cash, 8.4);
assert.equal(basic.fridge.totalHeads, 4);
assert.equal(basic.fridge.totalWeightG, 400);
assert.equal(basic.shop.sales, 1);
assert.equal(basic.shop.order, null);
console.log('PASS closed shop, reserved stock, locked order price and closing after payment');

// Reload every stage using actual SaveSystem and HarvestBox snapshots.
for (const stage of ['arriving', 'collecting', 'returning', 'packing', 'handover', 'leaving']) {
  const original = setup(4);
  original.shop.setOpen(true);
  reach(original.shop, stage);
  original.shop.setOpen(false);
  save.save({ market: original.market, shop: original.shop, harvest: { snapshot: () => ({ boxes: [original.box.snapshot()] }) } });
  const data = save.load();
  const restored = setup(0);
  restored.box.restore(data.harvest.boxes[0]);
  if (restored.box.stored) restored.fridge.addBox(restored.box);
  restored.market.cash = data.market.cash;
  restored.shop.restore(data.shop);
  assert.equal(restored.shop.order.customerVariant, original.shop.order.customerVariant);
  advance(restored.shop, 60);
  assert.equal(restored.market.cash, 14, stage);
  assert.equal(restored.fridge.totalHeads, 0, stage);
  assert.equal(restored.box.plantCount, 0, stage);
  assert.equal(restored.shop.sales, 1, stage);
  assert.equal(restored.shop.order, null, stage);
  assert.equal(restored.box.group.visible, false, stage);
}
console.log('PASS reload at all six stages without lost vegetables or duplicate payments');

// Out-of-stock recovery and day rollover.
const empty = setup(0);
empty.shop.setOpen(true);
advance(empty.shop, 60);
assert.equal(empty.shop.order, null);
for (let i = 0; i < 2; i++) empty.box.addHead({ cropKey: 'lettuce', cropName: 'Lettuce', weightG: 110 });
empty.fridge.addBox(empty.box);
advance(empty.shop, 60);
assert.equal(empty.market.cash, 7);
assert.equal(empty.shop.headsSold, 2);
empty.climate.dayIndex = 1;
empty.shop.update(0);
assert.equal(empty.shop.sales, 0);
assert.equal(empty.shop.revenueCents, 0);
assert.equal(empty.market.cash, 7);
assert.equal(empty.shop.setPrice('lettuce', NaN), false);
assert.equal(empty.shop.setPrice('lettuce', -1), false);
assert.equal(empty.shop.setPrice('lettuce', 0), false);
console.log('PASS automatic restock recovery, partial orders, daily totals and invalid prices');

// FIFO across mixed boxes conserves other crops and exact weight.
const fifo = setup(2);
fifo.box.chilledAt = 1;
fifo.box.addHead({ cropKey: 'red', cropName: 'Red lettuce', weightG: 120 });
const later = new HarvestBox({ id: 'later', index: 1 });
for (let i = 0; i < 4; i++) later.addHead({ cropKey: 'lettuce', cropName: 'Lettuce', weightG: 90 });
fifo.fridge.addBox(later);
later.chilledAt = 2;
fifo.shop.random = (() => { let n = 0; return () => n++ === 0 ? 0 : 0.75; })();
fifo.shop.setOpen(true);
reach(fifo.shop, 'arriving');
fifo.shop.setOpen(false);
advance(fifo.shop, 60);
assert.equal(fifo.box.lots.has('lettuce'), false);
assert.equal(fifo.box.lots.get('red').heads, 1);
assert.equal(fifo.box.weightG, 120);
assert.equal(later.plantCount, 2);
assert.equal(later.weightG, 180);
console.log('PASS oldest chilled stock first and mixed-crop weight conservation');

// Legacy saves default to a closed shop and keep the existing farm balance.
const legacy = setup();
legacy.market.cash = 42.5;
legacy.shop.restore();
advance(legacy.shop, 60);
assert.equal(legacy.market.cash, 42.5);
assert.equal(legacy.shop.open, false);
console.log('PASS legacy save compatibility');
// Shared stock can be stored through any cabinet. Sold-out visuals must
// disappear from their actual cabinet, even when checkout uses the main fridge.
const shared = setup(0);
const second = new GlassRefrigerator({ parent: new THREE.Group(), materials });
second.boxes = shared.fridge.boxes;
shared.house.fridge2 = second;
for (let i = 0; i < 2; i++) shared.box.addHead({ cropKey: 'lettuce', cropName: 'Lettuce', weightG: 100 });
second.addBox(shared.box);
assert.equal(second.boxRoot.children.length, 1);
shared.shop.setOpen(true);
advance(shared.shop, 60);
assert.equal(second.boxRoot.children.length, 0);
assert.equal(second.totalHeads, 0);
assert.equal(shared.market.cash, 7);
console.log('PASS shared refrigerator sales remove the actual stored carton');
console.log('Automatic shop checks passed');
