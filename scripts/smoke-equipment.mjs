/**
 * Headless smoke test for the greenhouse, NFT tables, hydraulics, 24-switch
 * climate cabinet, drone view and fans. Node has no DOM, so the small canvas/
 * material surface used by the cabinet HMI and procedural textures is mocked.
 * Geometry, interaction metadata, collision volumes, door animation, fan
 * rotation, climate data and disposal are real.
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
  addEventListener: () => {},
  removeEventListener: () => {},
};

const { Equipment } = await import('../src/world/Equipment.js');
const { Greenhouse } = await import('../src/world/Greenhouse.js');
const { WaterStorage } = await import('../src/world/WaterStorage.js');
const { BluelabController } = await import('../src/world/BluelabController.js');
const { IrrigationPanel } = await import('../src/world/IrrigationPanel.js');
const { WeatherControlPanel } = await import('../src/world/WeatherControlPanel.js');
const { DroneController } = await import('../src/player/DroneController.js');
const { SaveSystem } = await import('../src/save/SaveSystem.js');
const { GreenhouseClimate } = await import('../src/simulation/GreenhouseClimate.js');
const { WaterNutrientSimulation } = await import('../src/simulation/WaterNutrientSimulation.js');
const { GreenhouseControlSystem } = await import('../src/systems/GreenhouseControlSystem.js');
const { CollisionWorld } = await import('../src/player/CollisionWorld.js');
const { Environment } = await import('../src/world/Environment.js');
const { LAYOUT, NFT_INSTALLATION, FAN_INSTALLATION, GUTTER_X, FRAME_Z } = await import('../src/config/layout.js');

const material = () => new THREE.MeshBasicMaterial();
const sharedMaterials = new Map();
const materials = new Proxy(
  {
    createLabelMaterial: () => material(),
    createWarningMaterial: () => material(),
    createScreenMaterial: () => material(),
  },
  {
    get(target, property) {
      if (property in target) return target[property];
      // Real MaterialLibrary properties are stable singletons; cache the mock so
      // identity checks (for example the cabinet LED caps) stay meaningful.
      if (!sharedMaterials.has(property)) sharedMaterials.set(property, material());
      return sharedMaterials.get(property);
    },
  },
);

const scene = new THREE.Scene();
const collisionWorld = new CollisionWorld();
const climate = new GreenhouseClimate({ startHour: 10.7 });
const control = new GreenhouseControlSystem({ bayCount: 6 });
const greenhouse = new Greenhouse({
  scene,
  materials,
  collisionWorld,
  preset: { showDetail: true },
  control,
}).build();
const equipment = new Equipment({ scene, materials, collisionWorld, climate, control }).build();
const storage = new WaterStorage({ materials, control, collisionWorld }).build(scene);
const bluelab = new BluelabController({ materials, control }).build(scene);
const irrigationPanel = new IrrigationPanel({ materials, control }).build(scene);
const weatherPanel = new WeatherControlPanel({ materials, climate }).build(scene);
weatherPanel.update(1 / 60, climate);
const water = new WaterNutrientSimulation({ equipment, layout: LAYOUT, control, climate });
greenhouse.update(0);

const checks = [];
const check = (name, condition, detail = '') => {
  checks.push({ name, ok: Boolean(condition), detail });
};

const allInteractables = [
  ...greenhouse.getInteractables(),
  ...equipment.getInteractables(),
  ...storage.interactables,
  ...bluelab.interactables,
  ...irrigationPanel.interactables,
  ...weatherPanel.interactables,
];

check('all interactables registered', allInteractables.length >= 52, allInteractables.length);

/* --------------------------------------- Version 7 weather control panel */
check(
  'weather config exposes four ordered states',
  climate.weatherOrder.join(',') === 'sunny,cloudy,lightRain,heavyRain',
  climate.weatherOrder.join(','),
);
check(
  'each weather state carries rain rate and cloud cover',
  climate.weatherOrder.every((stateId) => {
    const state = LAYOUT.weather.states[stateId];
    return Number.isFinite(state.rainMmPerHour) && Number.isFinite(state.cloudCover);
  }),
);
check('weather panel builds four state lamps', weatherPanel.stateLights.length === 4, weatherPanel.stateLights.length);
check('weather panel carries a selector dial', Boolean(weatherPanel.selectorPointer));
check('weather panel carries an AUTO key', Boolean(weatherPanel.autoKey));
check('weather panel HMI is mounted', Boolean(weatherPanel.screen?.material));
check(
  'weather panel exposes selector, four set-state lamps, AUTO and HMI',
  weatherPanel.interactables.length === 7 &&
    weatherPanel.interactables.filter((entry) => entry.data.interaction === 'set-weather').length === 4 &&
    weatherPanel.interactables.some((entry) => entry.data.interaction === 'cycle-weather') &&
    weatherPanel.interactables.some((entry) => entry.data.interaction === 'toggle-weather-auto') &&
    weatherPanel.interactables.some((entry) => entry.data.interaction === 'inspect'),
  weatherPanel.interactables.length,
);
const selectorStart = climate.weather;
const selectorNext = climate.cycleWeather();
const selectorIndex = climate.weatherOrder.indexOf(selectorStart);
check(
  'selector advances one detent and holds manually',
  selectorNext === climate.weatherOrder[(selectorIndex + 1) % 4] && climate.weatherManual === true,
  `${selectorStart} -> ${selectorNext}`,
);
climate.setWeather('lightRain');
weatherPanel.update(2, climate);
const lightRainIndex = climate.weatherOrder.indexOf('lightRain');
const lightRainLamp = weatherPanel.stateLights.find((entry) => entry.id === 'lightRain');
check(
  'selector pointer follows the latched detent',
  Math.abs(weatherPanel.selectorPointer.rotation.z + lightRainIndex * (Math.PI / 2)) < 1e-3,
  weatherPanel.selectorPointer.rotation.z.toFixed(3),
);
check(
  'active lamp lights and every lamp mesh stays visible for direct select',
  lightRainLamp?.lamp.material === materials.ledAmber &&
    weatherPanel.stateLights.every((entry) => entry.lamp.visible),
);
const lightRainRate = climate.rainMmPerHour;
climate.setWeather('heavyRain');
check(
  'light and heavy rain have distinct roof capture rates',
  lightRainRate > 0 && climate.rainMmPerHour > lightRainRate,
  `${lightRainRate.toFixed(1)} / ${climate.rainMmPerHour.toFixed(1)} mm/h`,
);
climate.setWeatherAuto();
check('AUTO key releases the manual weather hold', climate.weatherManual === false);
weatherPanel.update(2, climate);
check(
  'AUTO key lamp confirms schedule control',
  weatherPanel.autoLamp?.material === materials.ledGreen,
);
const detentErrors = climate.weatherOrder.map((weatherId, index) => {
  climate.setWeather(weatherId, { manual: true });
  weatherPanel.update(2, climate);
  return weatherPanel.selectorPointer.rotation.z + index * (Math.PI / 2);
});
check(
  'selector pointer reaches all four detents',
  detentErrors.every((error) => Math.abs(error) < 1e-3),
  detentErrors.map((error) => error.toFixed(3)).join('/'),
);
// Restore the clear-sky baseline the remaining climate checks assume.
climate.setWeather('sunny', { manual: false });

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
check('return reaches return tank', equipment.hydraulics?.returnsToReturnTank === true && equipment.hydraulics?.returnsToReservoir === false);
check(
  'supply and return are separate',
  equipment.hydraulics?.supplyHeader.start.z !== equipment.hydraulics?.returnHeader.start.z,
);

const pumpX = LAYOUT.pumps.circuits[0].position[0];
const pumpZ = LAYOUT.pumps.circuits[0].position[1];
const reservoirX = LAYOUT.storage.roTanks[0].position[0];
const reservoirZ = LAYOUT.storage.roTanks[0].position[1];
check(
  'group pump 1 sited beside Reservoir 1',
  Math.hypot(pumpX - reservoirX, pumpZ - reservoirZ) < 4,
  Math.hypot(pumpX - reservoirX, pumpZ - reservoirZ).toFixed(2),
);
check(
  'each pump is assigned to its own reservoir',
  LAYOUT.pumps.circuits.length === 2 &&
    LAYOUT.pumps.circuits[0].reservoirId === 'ro-tank-1' &&
    LAYOUT.pumps.circuits[1].reservoirId === 'ro-tank-2',
);
check(
  'supply header is split between the groups',
  equipment.hydraulics?.supplyHeaders?.length === 2 &&
    equipment.hydraulics.supplyHeaders[0].end.x < equipment.hydraulics.supplyHeaders[1].start.x,
);
const entrance = greenhouse.entrance;
const doorEntry = greenhouse.getInteractables().find((entry) => entry.data.id === 'entrance-doors');
check('sliding entrance built', Boolean(entrance?.leafLeft && entrance?.leafRight));
check('entrance starts closed', entrance?.doorAmount === 0 && entrance?.leafColliders.every((entry) => entry.box?.enabled));
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
check(
  'door colliders slide with leaves',
  entrance.leafColliders[0].box.maxX < -1.4 && entrance.leafColliders[1].box.minX > 1.4,
  `${entrance.leafColliders[0].box.maxX.toFixed(2)} / ${entrance.leafColliders[1].box.minX.toFixed(2)}`,
);
const openZ = walkDoorway(19.2, 16.0);
check('open entrance is walkable', openZ < 16.1, openZ.toFixed(2));

entrance.toggle();
for (let frame = 0; frame < 120; frame += 1) greenhouse.update(1 / 60);
check('entrance closes again', entrance.doorAmount < 0.02 && entrance.collisionBox.enabled === true);

check('per-bay screens built', greenhouse.bayScreens?.shadePanels.length === 6 && greenhouse.bayScreens.energyPanels.length === 6);
check('twelve roof vent leaves built', greenhouse.bayScreens?.vents.length === 12, greenhouse.bayScreens?.vents.length);
check(
  'shade screen below truss chord',
  LAYOUT.screens.shadeY < LAYOUT.greenhouse.gutterHeight - 0.06,
  `${LAYOUT.screens.shadeY} < ${LAYOUT.greenhouse.gutterHeight - 0.06}`,
);
check(
  'shade screen is horizontal',
  Math.abs(greenhouse.bayScreens.shadePanels[0].mesh.rotation.x + Math.PI / 2) < 1e-6,
  greenhouse.bayScreens.shadePanels[0].mesh.rotation.x.toFixed(3),
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
for (let frame = 0; frame < 300; frame += 1) equipment.update(1 / 60);
const pausedRotation = equipment.fans[0].blades.rotation.z;
equipment.update(1 / 60);
check(
  'fan animation ramps to a stop',
  equipment.fans[0].currentSpeed < 0.01 &&
    Math.abs(equipment.fans[0].blades.rotation.z - pausedRotation) < 1e-3,
  `${equipment.fans[0].currentSpeed.toFixed(4)} rad/s`,
);
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

/* ------------------------------------------------ Version 3 sub-systems */

check('control registers every NFT table', control.tables.size === 18, control.tables.size);
check('storage built two reservoirs and return tank', storage.roVisuals.length === 2 && Boolean(storage.returnVisuals));
check(
  'storage tanks are named Reservoir 1 and Reservoir 2',
  storage.roVisuals.map((visual) => visual.data.name).join(' / ') === 'Reservoir 1 / Reservoir 2',
  storage.roVisuals.map((visual) => visual.data.name).join(' / '),
);
check('no wall-mounted sensor signs', !greenhouse.group.getObjectByName('wall-sensor'));
check(
  'no above-ground bulk reservoir duplicates',
  !scene.getObjectByName('bulk-reservoirs') && !scene.getObjectByName('reservoir-1'),
);
check('rainwater collector reaches harvester', Boolean(greenhouse.group.getObjectByName('rainwater-collector-runs')));
check('sticky traps clipped to columns', greenhouse.stickyTraps?.traps.length === 12, greenhouse.stickyTraps?.traps.length);
const trapMounts = greenhouse.stickyTraps.traps;
check(
  'sticky traps snap to the structural column grid',
  trapMounts.every((trap) => GUTTER_X.includes(trap.mount.columnX) && FRAME_Z.includes(trap.mount.columnZ)),
  trapMounts.map((trap) => `${trap.mount.columnX},${trap.mount.columnZ}`).join(' '),
);
check(
  'sticky traps sit flush on a column face',
  trapMounts.every((trap) => {
    const section =
      Math.abs(trap.mount.columnX) === LAYOUT.greenhouse.width / 2
        ? LAYOUT.greenhouse.perimeterColumnSize
        : LAYOUT.greenhouse.columnSize;
    const gap = Math.abs(trap.group.position.x - trap.mount.columnX) - section / 2;
    return Math.abs(trap.group.position.z - trap.mount.columnZ) < 1e-9 && gap > 0.005 && gap < 0.03;
  }),
);
const trapInspection = greenhouse.stickyTraps.inspect(2);
check(
  'sticky trap inspection reports a count',
  trapInspection?.caught > 0 && trapInspection.threshold === 25,
  `${trapInspection?.caught} caught`,
);

/* ------------------------------------------------ Version 5 physical sun */

const environment = new Environment({});
const sunEast = environment.directionFromAngles(0, 90);
const sunSouth = environment.directionFromAngles(0, 180);
const sunNorth = environment.directionFromAngles(0, 0);
check(
  'sun bearing maps compass east',
  Math.abs(sunEast.x - 1) < 1e-6 && Math.abs(sunEast.z) < 1e-6,
  `${sunEast.x.toFixed(3)}, ${sunEast.z.toFixed(3)}`,
);
check(
  'sun bearing maps compass south',
  Math.abs(sunSouth.z - 1) < 1e-6 && Math.abs(sunSouth.x) < 1e-6,
  `${sunSouth.x.toFixed(3)}, ${sunSouth.z.toFixed(3)}`,
);
check(
  'sun bearing maps compass north',
  Math.abs(sunNorth.z + 1) < 1e-6 && Math.abs(sunNorth.x) < 1e-6,
  `${sunNorth.x.toFixed(3)}, ${sunNorth.z.toFixed(3)}`,
);
const configuredSun = environment.directionFromAngles(
  LAYOUT.sun.elevationDeg,
  LAYOUT.sun.azimuthDeg,
);
check(
  'configured sun sits south-east and above the horizon',
  configuredSun.x > 0 && configuredSun.z > 0 && configuredSun.y > 0,
  `${configuredSun.x.toFixed(2)}, ${configuredSun.y.toFixed(2)}, ${configuredSun.z.toFixed(2)}`,
);
check(
  'sun exposes intensity and shadow tuning',
  LAYOUT.sun.intensity > 0 && LAYOUT.sun.shadowExtent > 0 && LAYOUT.sun.shadowFar > 0,
);
environment.scene = new THREE.Scene();
environment.sunDirection.copy(configuredSun);
environment.buildSunDisc();
const discLayers = environment.sunDisc?.children ?? [];
const discCore = discLayers[discLayers.length - 1];
check(
  'sun disc sits on the configured sun vector',
  Math.abs(environment.sunDisc.position.length() - LAYOUT.sun.discDistance) < 1e-6 &&
    environment.sunDisc.position.clone().normalize().distanceTo(configuredSun) < 1e-6,
);
check(
  'sun disc has a warm opaque core',
  discLayers.length === 3 &&
    discCore.material.blending === THREE.NormalBlending &&
    discCore.material.opacity > 0.9,
);
environment.sunDisc.traverse((child) => {
  if (!child.isMesh) return;
  child.geometry.dispose();
  child.material.dispose();
});
environment.sunDisc = null;

control.setBayDevice(1, 'shadeNetExtended', false);
for (let frame = 0; frame < 120; frame += 1) greenhouse.update(1 / 60);
check(
  'shade retracts only in its own bay',
  greenhouse.bayScreens.shadePanels[0].coverage < 0.3 &&
    greenhouse.bayScreens.shadePanels[1].coverage > 0.95,
  `${greenhouse.bayScreens.shadePanels[0].coverage.toFixed(2)} / ${greenhouse.bayScreens.shadePanels[1].coverage.toFixed(2)}`,
);

control.setBayDevice(2, 'roofVentOpen', true);
control.setBayDevice(3, 'energyScreenExtended', true);
for (let frame = 0; frame < 120; frame += 1) greenhouse.update(1 / 60);
const ventBay2 = greenhouse.bayScreens.vents.filter((vent) => vent.bay === 2);
const ventBay1 = greenhouse.bayScreens.vents.filter((vent) => vent.bay === 1);
check(
  'ridge vents open only in their bay',
  ventBay2.length === 2 && ventBay2.every((vent) => vent.openAmount > 0.95) &&
    ventBay1.every((vent) => vent.openAmount < 0.05),
  ventBay2.map((vent) => vent.openAmount.toFixed(2)).join('/'),
);
check(
  'energy screen deploys independently',
  greenhouse.bayScreens.energyPanels[2].coverage > 0.95 &&
    greenhouse.bayScreens.energyPanels[1].coverage < 0.2,
  `${greenhouse.bayScreens.energyPanels[2].coverage.toFixed(2)} / ${greenhouse.bayScreens.energyPanels[1].coverage.toFixed(2)}`,
);

control.setBayDevice(4, 'fansOn', false);
for (let frame = 0; frame < 180; frame += 1) equipment.update(1 / 60);
check(
  'one bay of HAF fans can be isolated',
  equipment.fans.filter((fan) => fan.bay === 4).every((fan) => fan.currentSpeed < 0.05) &&
    equipment.fans.filter((fan) => fan.bay === 1).every((fan) => fan.currentSpeed > 0.5),
);

const firstTable = equipment.tables[0];
const firstSupply = equipment.hydraulics.tableSupplies.find(
  (supply) => supply.tableId === firstTable.id,
);
const valveBefore = firstSupply.handle.rotation.y;
control.setTableValve(firstTable.id, false);
for (let frame = 0; frame < 60; frame += 1) equipment.update(1 / 60);
check(
  'table valve handle follows the control system',
  Math.abs(firstSupply.handle.rotation.y - valveBefore) > 0.8,
  firstSupply.handle.rotation.y.toFixed(2),
);
const selectorResult = bluelab.toggleSelector(0);
check(
  'Bluelab selector mirrors the same table valve',
  selectorResult === true && control.isTableValveOpen(firstTable.id) === true,
);

control.toggleStorageValve('ro-tank-2');
for (let frame = 0; frame < 60; frame += 1) storage.update(1 / 60);
check(
  'clean-water isolation valve closes on command',
  storage.valves.length === 2 && storage.valves[1].angle > 1.2,
  storage.valves[1]?.angle.toFixed(2),
);

control.togglePump('group1PumpOn');
control.togglePump('group2PumpOn');
for (let frame = 0; frame < 120; frame += 1) water.update(1 / 60);
const v3Snapshot = water.snapshot();
check(
  'water model reports both reservoirs, return and rain',
  v3Snapshot.tanks.length === 2 &&
    Number.isFinite(v3Snapshot.returnTank.level) &&
    Number.isFinite(v3Snapshot.harvester.level) &&
    v3Snapshot.flowRate < 20 &&
    v3Snapshot.pressure < 0.5,
  `${v3Snapshot.flowRate} L/min · ${v3Snapshot.pressure} bar`,
);
check(
  'group flow stops when both group pumps are off',
  v3Snapshot.groups.length === 2 &&
    v3Snapshot.groups.every((group) => group.pumpOn === false && group.flow === 0),
);
storage.update(1 / 60, v3Snapshot);
bluelab.update(1 / 60, v3Snapshot);
irrigationPanel.update(1 / 60, v3Snapshot);
check('Bluelab HMI renders a water snapshot', Boolean(bluelab.screen?.material));
check('irrigation panel HMI renders a water snapshot', Boolean(irrigationPanel.screen?.material));
check('tank selection cycles to Reservoir 2', control.cycleTank() === 1 && water.selectedTank.code === 'RES-2');

/* ------------------------------------------------ Version 6 irrigation panel */
check('main panel carries exactly three pump switches', irrigationPanel.switches.length === 3);
check(
  'panel switches map to both groups and rain transfer',
  irrigationPanel.switches.map((entry) => entry.key).join(',') ===
    'group1PumpOn,group2PumpOn,rainwaterTransferOn',
);
control.setPump('group1PumpOn', true);
control.setPump('group2PumpOn', true);
for (let frame = 0; frame < 30; frame += 1) equipment.update(1 / 60);

/* -------------------------------------- Version 7 static gully film */
const hydraulic = equipment.hydraulicNetwork;
check(
  'pipe flow markers are removed',
  !('flowMarkers' in hydraulic) &&
    !('flowMaterials' in hydraulic) &&
    !('flowColourMode' in control) &&
    typeof hydraulic.addFlowTrack === 'undefined',
);
check(
  'each table owns one instanced gully water mesh',
  equipment.tables.every((table) => table.gullyWater?.isInstancedMesh) &&
    equipment.tableSystem.gullyWaterMeshes.length === 18,
  equipment.tableSystem.gullyWaterMeshes.length,
);
check(
  'gully film instances match the eight gullies per table',
  equipment.tables.every((table) => table.gullyWater.count === LAYOUT.beds.gulliesPerTable),
);
check(
  'gully film sits below the perforated top plate',
  (LAYOUT.beds.gullyWaterDepth ?? 0.016) > 0 &&
    (LAYOUT.beds.gullyWaterDepth ?? 0.016) < 0.03,
  LAYOUT.beds.gullyWaterDepth,
);
control.setTableValve(firstTable.id, true);
equipment.update(1 / 60);
check('gully film shows on a flowing table', firstTable.gullyWater.visible === true);
control.setTableValve(firstTable.id, false);
equipment.update(1 / 60);
check('gully film hides when its table valve is isolated', firstTable.gullyWater.visible === false);

/* ------------------------------------------------ Version 6 rain harvesting */
const rainStart = water.harvester.level;
climate.setWeather('lightRain');
for (let frame = 0; frame < 60; frame += 1) water.update(1 / 60);
const lightSnapshot = water.snapshot();
climate.setWeather('heavyRain');
for (let frame = 0; frame < 120; frame += 1) water.update(1 / 60);
const rainSnapshot = water.snapshot();
check(
  'heavy rain fills the harvester faster than light rain',
  rainSnapshot.weather === 'heavyRain' &&
    rainSnapshot.rainInflow > lightSnapshot.rainInflow &&
    water.harvester.level > rainStart &&
    rainSnapshot.rainMmPerHour > lightSnapshot.rainMmPerHour,
  `${lightSnapshot.rainInflow.toFixed(3)} -> ${rainSnapshot.rainInflow.toFixed(3)} L/s`,
);
check(
  'harvester is now an underground tank',
  storage.harvester?.topY < 0 &&
    Boolean(scene.getObjectByName('underground-rainwater-harvester')),
);
check(
  'rain transfer pump is relocated beside the harvester hatch',
  LAYOUT.storage.transferPump.position[0] === -4.25 &&
    LAYOUT.storage.transferPump.position[1] === -15.8,
);

/* ------------------------------------------------ Version 6 clock + weather */
const fastClock = new GreenhouseClimate({ startHour: 23.99 });
check(
  'one real hour equals one game day',
  Math.abs(fastClock.minutesPerSecond - 0.4) < 1e-9,
  fastClock.minutesPerSecond,
);
fastClock.update(2);
check('game clock rolls over at midnight', fastClock.dayIndex === 1, fastClock.dayLabel);
fastClock.setWeather('heavyRain');
check(
  'weather state machine exposes four states and rain rates',
  fastClock.weather === 'heavyRain' &&
    fastClock.rainIntensity > 0.8 &&
    fastClock.weatherState.ppfdFactor < 0.5 &&
    fastClock.rainMmPerHour > 10,
  fastClock.rainMmPerHour.toFixed(1),
);

const skyScene = new THREE.Scene();
const skyEnvironment = new Environment({
  scene: skyScene,
  renderer: null,
  materials,
  preset: { id: 'medium' },
});
skyEnvironment.buildSky();
skyEnvironment.buildSun();
skyEnvironment.buildWeather();
fastClock.hour = 12;
fastClock.setWeather('heavyRain');
skyEnvironment.update(1 / 60, fastClock);
check(
  'heavy rain shows the cloud deck and exterior rain field',
  skyEnvironment.rain.visible &&
    skyEnvironment.clouds.visible &&
    skyEnvironment.rainMaterial.opacity > 0.5,
);
check(
  'daylight sun is above the horizon and casts light',
  skyEnvironment.sun.visible &&
    skyEnvironment.sun.position.y > 0 &&
    skyEnvironment.sun.intensity > 0,
  skyEnvironment.sun.intensity.toFixed(2),
);
fastClock.hour = 23;
skyEnvironment.update(1 / 60, fastClock);
check(
  'night hides the sun and shows stars',
  skyEnvironment.sun.visible === false && skyEnvironment.stars.visible === true,
);
skyEnvironment.dispose();
check('weather environment disposed', skyScene.children.length === 0, skyScene.children.length);

const memory = new Map();
const saveSystem = new SaveSystem({
  key: 'smoke-v6',
  storage: {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  },
});
const saved = saveSystem.save({
  climate: fastClock,
  control,
  water,
  settings: { quality: 'high' },
});
check(
  'save payload is version 2 with manual weather and control state',
  saved?.version === 2 &&
    saved.climate?.weather === 'heavyRain' &&
    saved.climate?.weatherManual === true &&
    saved.climate?.rainMmPerHour > 10 &&
    saved.control?.pumps?.group1PumpOn !== undefined &&
    saved.water?.harvesterLevel >= 0,
);
const loaded = saveSystem.load();
check(
  'save round-trips through local storage',
  loaded?.version === 2 && loaded.control.groups.length === 2,
);
const restoredClimate = new GreenhouseClimate();
restoredClimate.restore(loaded.climate);
check(
  'manual weather and roof capture restore from the save',
  restoredClimate.weather === 'heavyRain' &&
    restoredClimate.weatherManual === true &&
    Math.abs(restoredClimate.rainMmPerHour - fastClock.rainMmPerHour) < 1e-6,
  `${restoredClimate.weather} / ${restoredClimate.rainMmPerHour.toFixed(1)} mm/h`,
);
const legacyClimate = new GreenhouseClimate();
legacyClimate.restore({
  hour: 12,
  weather: 'rain',
  rainIntensity: 0.82,
  weatherRemainingHours: 3,
});
check(
  'legacy rain saves migrate to heavy rain and auto schedule',
  legacyClimate.weather === 'heavyRain' && legacyClimate.weatherManual === false,
  legacyClimate.weather,
);

const drone = new DroneController({ camera: new THREE.PerspectiveCamera() });
drone.applyLook(2400, 0);
drone.update(0.5);
check(
  'drone yaw supports continuous 360 degree orbits',
  Math.abs(drone.yaw) <= Math.PI && Number.isFinite(drone.yaw),
  drone.yaw.toFixed(3),
);
check(
  'drone pitch clamps below vertical',
  Math.abs(drone.pitch) <= drone.maxPitch,
  drone.pitch.toFixed(3),
);
drone.dispose();

/* ------------------------------------------------ Version 4 bay cabinet */
const baySwitches = equipment.cabinetSwitches;
check('cabinet has exactly 24 per-bay switches', baySwitches.length === 24, baySwitches.length);
check(
  'six bays x four circuits are unique',
  new Set(baySwitches.map((entry) => `${entry.bay}:${entry.key}`)).size === 24,
);
check(
  'each bay row carries exactly four switches',
  [1, 2, 3, 4, 5, 6].every((bay) => baySwitches.filter((entry) => entry.bay === bay).length === 4),
);
check(
  'every bay exposes FAN / SHADE NET / ENERGY SCREEN / ROOF VENT',
  [1, 2, 3, 4, 5, 6].every((bay) =>
    ['fansOn', 'shadeNetExtended', 'energyScreenExtended', 'roofVentOpen'].every((key) =>
      baySwitches.some((entry) => entry.bay === bay && entry.key === key),
    ),
  ),
);
check(
  'all cabinet switches use the bay-device interaction',
  baySwitches.every((entry) => entry.info.interaction === 'toggle-bay-device'),
);
check(
  'no master or global bay switches remain',
  !equipment.interactables.some(
    (entry) =>
      entry.data.interaction === 'toggle-all-bays' || String(entry.data.id).startsWith('cabinet-master'),
  ),
);
const ventSwitch = baySwitches.find((entry) => entry.bay === 6 && entry.key === 'roofVentOpen');
check(
  'roof-vent switch metadata targets its bay',
  ventSwitch?.info.bayId === 6 && ventSwitch?.info.lockMs === 2400,
);
const ventBefore = control.getBay(6).roofVentOpen;
const ventAfter = control.toggleBayDevice(6, 'roofVentOpen', { lockMs: 2400 });
check('cabinet switch writes the shared bay state', ventAfter !== ventBefore);
equipment.update(0.016);
check(
  'green cap follows the live bay state',
  ventSwitch.cap.material === (ventAfter ? equipment.materials.ledGreen : equipment.materials.ledRed),
);
check('vent switch engages the actuator interlock', control.isBayDeviceLocked(6, 'roofVentOpen'));
check(
  'interlock rejects a mid-stroke reversal',
  control.toggleBayDevice(6, 'roofVentOpen') === ventAfter,
);
control.releaseBayDevice(6, 'roofVentOpen');
check('released interlock frees the switch', !control.isBayDeviceLocked(6, 'roofVentOpen'));
check(
  'roof vents open to the 28 degree partial position',
  Math.abs(THREE.MathUtils.radToDeg(LAYOUT.vents.openingAngle) - 28) < 0.01,
  THREE.MathUtils.radToDeg(LAYOUT.vents.openingAngle).toFixed(1),
);
check('drone view replaces the fixed top view', Boolean(LAYOUT.droneView) && !('topView' in LAYOUT));
check(
  'sticky traps carry no numbered labels',
  greenhouse.stickyTraps.traps.every((trap) => trap.card?.material?.userData?.isLabel !== true),
);
equipment.dispose();
check('equipment disposed', equipment.group === null, equipment.group);
check('tables disposed', equipment.tables.length === 0);
storage.dispose();
bluelab.dispose();
irrigationPanel.dispose();
weatherPanel.dispose();
environment.dispose();
greenhouse.dispose();
check('scene emptied', scene.children.length === 0, scene.children.length);

let failed = 0;
for (const result of checks) {
  if (!result.ok) failed += 1;
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.detail !== '' ? `: ${result.detail}` : ''}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
if (failed > 0) process.exitCode = 1;

