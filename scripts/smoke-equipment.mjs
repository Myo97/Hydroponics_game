/**
 * Headless smoke test for the greenhouse, NFT tables, hydraulics and fans.
 * Node has no DOM, so the small canvas/material surface used by the cabinet HMI
 * and procedural textures is mocked. Geometry, interaction metadata, collision
 * volumes, door animation, fan rotation, climate data and disposal are real.
 */
import * as THREE from 'three';

const context = new Proxy(
  {
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (text) => ({ width: String(text).length * 10 }),
  },
  {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
    },
  },
);

globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => context,
  }),
};

const { Equipment } = await import('../src/world/Equipment.js');
const { Greenhouse } = await import('../src/world/Greenhouse.js');
const { GreenhouseClimate } = await import('../src/simulation/GreenhouseClimate.js');
const { CollisionWorld } = await import('../src/player/CollisionWorld.js');
const { LAYOUT, NFT_INSTALLATION, FAN_INSTALLATION } = await import('../src/config/layout.js');

const material = () => new THREE.MeshBasicMaterial();
const materials = new Proxy(
  {
    createLabelMaterial: () => material(),
    createWarningMaterial: () => material(),
    createScreenMaterial: () => material(),
  },
  {
    get(target, property) {
      if (property in target) return target[property];
      return material();
    },
  },
);

const scene = new THREE.Scene();
const collisionWorld = new CollisionWorld();
const climate = new GreenhouseClimate({ startHour: 10.7 });
const greenhouse = new Greenhouse({
  scene,
  materials,
  collisionWorld,
  preset: { showDetail: true },
}).build();
const equipment = new Equipment({ scene, materials, collisionWorld, climate }).build();
greenhouse.update(0);

const checks = [];
const check = (name, condition, detail = '') => {
  checks.push({ name, ok: Boolean(condition), detail });
};

const allInteractables = [
  ...greenhouse.getInteractables(),
  ...equipment.getInteractables(),
];

check('all interactables registered', allInteractables.length >= 52, allInteractables.length);
check('18 NFT tables', equipment.tables.length === 18, equipment.tables.length);
check(
  'every table has 8 gullies',
  equipment.tables.every((table) => table.gullies.length === 8),
  equipment.tables.map((table) => table.gullies.length).join(','),
);
check(
  'gullies are six metres long',
  LAYOUT.beds.gullyLength >= 5.9 && LAYOUT.beds.gullyLength <= 6.05,
  LAYOUT.beds.gullyLength,
);
check(
  '40 holes per gully at 150 mm',
  LAYOUT.beds.holesPerGully === 40 && Math.abs(LAYOUT.beds.holeSpacing - 0.15) < 1e-9,
  `${LAYOUT.beds.holesPerGully} / ${LAYOUT.beds.holeSpacing}`,
);
check(
  'total planting positions',
  equipment.tables.reduce((sum, table) => sum + table.gullies.length * LAYOUT.beds.holesPerGully, 0) === 5760,
  equipment.tables.reduce((sum, table) => sum + table.gullies.length * LAYOUT.beds.holesPerGully, 0),
);
const perforated = equipment.group.getObjectByName('nft-gully-perforated-tops');
check('perforated gully tops instanced', perforated?.isInstancedMesh && perforated.count === 18 * 8, perforated?.count);
check(
  'consistent table working height',
  equipment.tables.every((table) => Math.abs(table.topYStart - equipment.tables[0].topYStart) < 1e-6),
  equipment.tables[0]?.topYStart,
);
check(
  'table supply and return metadata',
  equipment.tables.every((table) => table.supplyInlet && table.drainageOutlet && table.supplyValve && table.drainUnion),
);

check('24 HAF fans', equipment.fans.length === 24, equipment.fans.length);
const fansPerBay = new Map();
for (const fan of equipment.fans) fansPerBay.set(fan.bay, (fansPerBay.get(fan.bay) || 0) + 1);
check('four HAF fans per bay', [...fansPerBay.values()].every((count) => count === 4) && fansPerBay.size === 6, [...fansPerBay.values()].join(','));
check(
  'fans mounted at columns and below shade',
  equipment.fans.every((fan) => LAYOUT.fans.height + LAYOUT.fans.radius < LAYOUT.shade.height),
  `${LAYOUT.fans.height + LAYOUT.fans.radius} < ${LAYOUT.shade.height}`,
);

check('supply header built', Boolean(equipment.hydraulics?.supplyHeader));
check('return header built', Boolean(equipment.hydraulics?.returnHeader));
check('pump suction connected', equipment.hydraulics?.pumpSuctionConnected === true);
check('pump discharge connected', equipment.hydraulics?.pumpDischargeConnected === true);
check('all table supplies connected', equipment.hydraulics?.tableSupplies.length === 18 && equipment.hydraulics.tableSupplies.every((entry) => entry.connected));
check('all table drains connected', equipment.hydraulics?.tableReturns.length === 18 && equipment.hydraulics.tableReturns.every((entry) => entry.connected));
check('return reaches reservoir', equipment.hydraulics?.returnsToReservoir === true);
check(
  'supply and return are separate',
  equipment.hydraulics?.supplyHeader.start.z !== equipment.hydraulics?.returnHeader.start.z,
);

const pumpX = LAYOUT.pumps.positions[0][0];
const pumpZ = LAYOUT.pumps.positions[0][1];
const reservoirX = LAYOUT.tanks.reservoirs.positions[1][0];
const reservoirZ = LAYOUT.tanks.reservoirs.positions[1][1];
check(
  'pump sited beside reservoir',
  Math.hypot(pumpX - reservoirX, pumpZ - reservoirZ) < 4,
  Math.hypot(pumpX - reservoirX, pumpZ - reservoirZ).toFixed(2),
);
const entrance = greenhouse.entrance;
const doorEntry = greenhouse.getInteractables().find((entry) => entry.data.id === 'entrance-doors');
check('sliding entrance built', Boolean(entrance?.leafLeft && entrance?.leafRight));
check('entrance starts closed', entrance?.doorAmount === 0 && entrance?.collisionBox.enabled === true);
check('entrance uses E interaction', doorEntry?.data.interaction === 'toggle-entrance', doorEntry?.data.interaction);
check('door hint asks to open', doorEntry?.data.interactionHint === 'Open entrance', doorEntry?.data.interactionHint);

const walkDoorway = (startZ, endZ) => {
  const walker = new THREE.Vector3(0, 0, startZ);
  const step = endZ < startZ ? -0.05 : 0.05;
  for (let travel = 0; travel <= Math.abs(endZ - startZ); travel += 0.05) {
    walker.z += step;
    collisionWorld.resolve(walker, LAYOUT.player.radius);
  }
  return walker.z;
};

const blockedZ = walkDoorway(19.2, 16.0);
check('closed entrance blocks player', blockedZ > 17.8, blockedZ.toFixed(2));

entrance.toggle();
check('entrance starts opening', entrance.isOpen === true);
check('door hint asks to close', entrance.data.interactionHint === 'Close entrance');
for (let frame = 0; frame < 120; frame += 1) greenhouse.update(1 / 60);
check('door leaves fully open', entrance.doorAmount > 0.98, entrance.doorAmount.toFixed(3));
check(
  'door leaves move opposite directions',
  entrance.leafLeft.position.x < -2.3 && entrance.leafRight.position.x > 2.3,
  `${entrance.leafLeft.position.x.toFixed(2)} / ${entrance.leafRight.position.x.toFixed(2)}`,
);
check('open entrance collision disabled', entrance.collisionBox.enabled === false);
const openZ = walkDoorway(19.2, 16.0);
check('open entrance is walkable', openZ < 16.1, openZ.toFixed(2));

entrance.toggle();
for (let frame = 0; frame < 120; frame += 1) greenhouse.update(1 / 60);
check('entrance closes again', entrance.doorAmount < 0.02 && entrance.collisionBox.enabled === true);

check('shade screen built', Boolean(greenhouse.shadeScreen?.screen));
check(
  'shade screen below truss chord',
  LAYOUT.shade.height < LAYOUT.greenhouse.gutterHeight - 0.06,
  `${LAYOUT.shade.height} < ${LAYOUT.greenhouse.gutterHeight - 0.06}`,
);
check(
  'shade screen is horizontal',
  Math.abs(greenhouse.shadeScreen.screen.rotation.x + Math.PI / 2) < 1e-6,
  greenhouse.shadeScreen.screen.rotation.x.toFixed(3),
);

const tableBoxes = collisionWorld.boxes.filter((box) => box.label === 'NFT table');
const columns = collisionWorld.boxes.filter((box) => box.label === 'column');
const overlaps = (a, b) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
check(
  'no table intersects a column',
  tableBoxes.every((tableBox) => columns.every((column) => !overlaps(tableBox, column))),
  `${tableBoxes.length} tables / ${columns.length} columns`,
);

const tablesByRow = new Map();
for (const box of tableBoxes) {
  const key = box.minX.toFixed(2);
  if (!tablesByRow.has(key)) tablesByRow.set(key, []);
  tablesByRow.get(key).push(box);
}
let minCrossWalkway = Infinity;
for (const row of tablesByRow.values()) {
  row.sort((a, b) => a.minZ - b.minZ);
  for (let i = 1; i < row.length; i += 1) {
    minCrossWalkway = Math.min(minCrossWalkway, row[i].minZ - row[i - 1].maxZ);
  }
}
check('walkway between every table', minCrossWalkway >= 1.0, minCrossWalkway.toFixed(2));

const rowXs = [...new Set(tableBoxes.map((box) => box.minX))].sort((a, b) => a - b);
let minRowAisle = Infinity;
for (let i = 1; i < rowXs.length; i += 1) {
  const previous = tableBoxes.find((box) => box.minX === rowXs[i - 1]);
  const current = tableBoxes.find((box) => box.minX === rowXs[i]);
  minRowAisle = Math.min(minRowAisle, current.minX - previous.maxX);
}
check('clear aisle between rows', minRowAisle >= 2.0, minRowAisle.toFixed(2));

const cabinet = equipment.interactables.find((entry) => entry.data.id === 'climate-cabinet');
const cabinetBox = collisionWorld.boxes.find((box) => box.label === 'Climate cabinet');
check('cabinet interactable metadata', Boolean(cabinet));
check('cabinet uses E interaction', cabinet?.data.interaction === 'toggle-cabinet', cabinet?.data.interaction);
check('cabinet starts closed', equipment.isCabinetOpen === false);
check(
  'cabinet footprint clear of tables',
  Boolean(cabinetBox) && tableBoxes.every((tableBox) => !overlaps(tableBox, cabinetBox)),
);
const approach = new THREE.Vector3(10.8, 0, 13.0);
for (let x = 10.8; x <= 11.8; x += 0.02) {
  approach.x = x;
  collisionWorld.resolve(approach, LAYOUT.player.radius);
}
check('cabinet approach walkable', approach.x <= 11.16, approach.x.toFixed(2));

equipment.update(1 / 60);
climate.update(1 / 60);
const initial = climate.snapshot();
check(
  'climate snapshot finite',
  ['airTemp', 'humidity', 'vpd', 'ppfd', 'dliToday', 'ec', 'ph'].every((key) =>
    Number.isFinite(initial[key]),
  ),
);
check('climate starts nominal', initial.isAlarm === false, initial.status.join(' | '));

const fanRotation = equipment.fans[0].blades.rotation.z;
equipment.update(1 / 60);
check('fan blades rotate', equipment.fans[0].blades.rotation.z !== fanRotation);
equipment.setFansEnabled(false);
const pausedRotation = equipment.fans[0].blades.rotation.z;
equipment.update(1 / 60);
check('fan animation can be paused', equipment.fans[0].blades.rotation.z === pausedRotation);
equipment.setFansEnabled(true);

equipment.toggleCabinetDoor();
check('cabinet opens', equipment.isCabinetOpen === true);
check('cabinet hint updates', cabinet?.data.interactionHint === 'Close cabinet', cabinet?.data.interactionHint);
for (let frame = 0; frame < 90; frame += 1) {
  equipment.update(1 / 60);
  climate.update(1 / 60);
}
check('cabinet door easing settles', equipment.doorAmount > 0.98, equipment.doorAmount.toFixed(3));
check('cabinet door rotates', Math.abs(equipment.cabinetDoor.rotation.y) > 1.8, equipment.cabinetDoor.rotation.y.toFixed(3));
equipment.toggleCabinetDoor();
check('cabinet closes', equipment.isCabinetOpen === false);

equipment.dispose();
check('equipment disposed', equipment.group === null, equipment.group);
check('tables disposed', equipment.tables.length === 0);
greenhouse.dispose();
check('scene emptied', scene.children.length === 0, scene.children.length);

let failed = 0;
for (const result of checks) {
  if (!result.ok) failed += 1;
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.detail !== '' ? `: ${result.detail}` : ''}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
if (failed > 0) process.exitCode = 1;

