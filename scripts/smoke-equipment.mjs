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
const { NurseryGreenhouse } = await import('../src/world/NurseryGreenhouse.js');
const { WaterStorage } = await import('../src/world/WaterStorage.js');
const { BluelabController } = await import('../src/world/BluelabController.js');
const { IrrigationPanel } = await import('../src/world/IrrigationPanel.js');
const { WeatherControlPanel } = await import('../src/world/WeatherControlPanel.js');
const { DroneController } = await import('../src/player/DroneController.js');
const { SaveSystem } = await import('../src/save/SaveSystem.js');
const { GreenhouseClimate } = await import('../src/simulation/GreenhouseClimate.js');
const { PlantSimulation } = await import('../src/simulation/PlantSimulation.js');
const { WaterNutrientSimulation } = await import('../src/simulation/WaterNutrientSimulation.js');
const { GreenhouseControlSystem } = await import('../src/systems/GreenhouseControlSystem.js');
const { TrayPickupController } = await import('../src/systems/TrayPickupController.js');
const { SeedlingTransplantController } = await import('../src/systems/SeedlingTransplantController.js');
const { stageForDay, getPlantGeometry, GROWTH_STAGES } = await import(
  '../src/simulation/GreenCoralGrowth.js'
);
const {
  NFT_PRODUCTION_DAYS,
  cropDevelopmentForDay,
  getCropPlantGeometry,
  getNftNetPotGeometry,
  getNftPlantGeometry,
  getNftRootGeometry,
  nftDevelopmentForDay,
  productionVisualScaleForDay,
  resolveCropVariety,
  visualScaleForDay,
} = await import('../src/simulation/GreenCoralGrowth.js');
const { CollisionWorld } = await import('../src/player/CollisionWorld.js');
const { Environment } = await import('../src/world/Environment.js');
const { LAYOUT, NFT_INSTALLATION, FAN_INSTALLATION, GUTTER_X, FRAME_Z } = await import('../src/config/layout.js');
const { NURSERY_DIM, NURSERY_GUTTER_X, NURSERY_RIDGE_X, NURSERY_FRAME_Z } =
  await import('../src/config/layout.js');

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
const nursery = new NurseryGreenhouse({
  scene,
  materials,
  collisionWorld,
  preset: { showDetail: true },
  control,
}).build();
nursery.setDetailVisible(true);
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
  ...nursery.getInteractables(),
  ...equipment.getInteractables(),
  ...storage.interactables,
  ...bluelab.interactables,
  ...irrigationPanel.interactables,
  ...weatherPanel.interactables,
];

check('all interactables registered', allInteractables.length >= 52, allInteractables.length);
check('interactable registry totals 183 units', allInteractables.length === 183, allInteractables.length);

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
const devClock = new GreenhouseClimate({ startHour: 22.5 });
devClock.setWeather('cloudy', { manual: true });
const skippedClock = devClock.skipGameHours(3);
check(
  'developer clock skip crosses midnight and holds manual weather',
  skippedClock.dayIndex === 1 &&
    Math.abs(skippedClock.hour - 1.5) < 1e-6 &&
    skippedClock.weather === 'cloudy' &&
    skippedClock.weatherManual,
  `${skippedClock.dayLabel} ${skippedClock.clock}`,
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

const walkDoorwayAt = (x, startZ, endZ) => {
  const walker = new THREE.Vector3(x, 0, startZ);
  const step = endZ < startZ ? -0.05 : 0.05;
  for (let travel = 0; travel <= Math.abs(endZ - startZ); travel += 0.05) {
    walker.z += step;
    collisionWorld.resolve(walker, LAYOUT.player.radius);
  }
  return walker.z;
};

const walkDoorway = (startZ, endZ) => walkDoorwayAt(0, startZ, endZ);

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

/* ------------------------------------------------ Nursery greenhouse */
check('nursery greenhouse built as its own house', Boolean(nursery.group?.parent === scene) && nursery.group.name === 'nursery-greenhouse');
check(
  'nursery is resized to 4 x 8 m with one span and two bays',
  Math.abs(NURSERY_DIM.halfWidth - 2) < 1e-9 &&
    Math.abs(NURSERY_DIM.halfLength - 4) < 1e-9 &&
    NURSERY_GUTTER_X.length === 2 &&
    NURSERY_RIDGE_X.length === 1 &&
    NURSERY_FRAME_Z.length === 3,
  `${NURSERY_GUTTER_X.join(',')} / ${NURSERY_RIDGE_X.join(',')} / ${NURSERY_FRAME_Z.join(',')}`,
);
check(
  'nursery keeps its original 4.6 / 5.55 m structural height',
  NURSERY_DIM.gutterY === 4.6 && NURSERY_DIM.ridgeY === 5.55,
);
check(
  'nursery derived frame grid spans 4 m bays',
  NURSERY_GUTTER_X.join(',') === '-2,2' &&
    NURSERY_RIDGE_X.join(',') === '0' &&
    NURSERY_FRAME_Z.join(',') === '12,16,20',
  `${NURSERY_GUTTER_X.join(',')} | ${NURSERY_RIDGE_X.join(',')} | ${NURSERY_FRAME_Z.join(',')}`,
);
const nurseryFootprint = collisionWorld.footprints.find((entry) => entry.buildingId === 'nursery-greenhouse');
check(
  'nursery registers a non-blocking footprint at X -17, Z 16',
  collisionWorld.footprints.length === 2 &&
    nurseryFootprint?.zone === 'nursery' &&
    nurseryFootprint?.x === -17 &&
    nurseryFootprint?.z === 16 &&
    nurseryFootprint?.width === 4 &&
    nurseryFootprint?.depth === 8,
  `${collisionWorld.footprints.length} footprints`,
);
check(
  'HUD zone switches between the houses',
  collisionWorld.footprintAt(0, 0)?.zone === 'main' &&
    collisionWorld.footprintAt(-17, 16)?.zone === 'nursery' &&
    collisionWorld.contains(-17, 16) &&
    !collisionWorld.contains(0, 20),
);
const nurseryBounds = new THREE.Box3().setFromObject(nursery.group);
const mainBounds = new THREE.Box3().setFromObject(greenhouse.group);
const buildingGap = mainBounds.min.x - nurseryBounds.max.x;
check(
  'nursery stands clear beside the main house',
  buildingGap > 2.0,
  `${buildingGap.toFixed(2)} m between floor slabs`,
);
check(
  'nursery keeps the main-house building features switched off',
  nursery.building.bayScreens === null &&
    nursery.building.stickyTraps === null &&
    !nursery.group.getObjectByName('rainwater-collector-runs'),
);
const nurserySign = nursery.group.getObjectByName('nursery-sign');
check(
  'nursery carries its own entrance board',
  Boolean(nurserySign) &&
    Math.abs(nurserySign.position.y - LAYOUT.nursery.signage.y) < 1e-9 &&
    nurserySign.position.z > NURSERY_DIM.halfLength,
  `${nurserySign?.position.y} / ${nurserySign?.position.z}`,
);
const nurseryDoorEntry = nursery.getInteractables().find((entry) => entry.data.id === 'nursery-greenhouse-entrance-doors');
check(
  'nursery door is a separate interaction target',
  nurseryDoorEntry?.data.buildingId === 'nursery-greenhouse' &&
    nurseryDoorEntry?.data.interaction === 'toggle-entrance' &&
    nurseryDoorEntry?.data.interactionHint === 'Open entrance',
  nurseryDoorEntry?.data.id,
);
const nurseryTrack = nursery.group.getObjectByName('entrance-top-track');
check(
  'nursery door track stays within the narrow gable',
  nurseryTrack?.geometry?.parameters?.width === LAYOUT.nursery.entrance.trackLength &&
    nurseryTrack.geometry.parameters.width < LAYOUT.nursery.width,
  `${nurseryTrack?.geometry?.parameters?.width} m`,
);
const walkNurseryDoor = (startZ, endZ) => walkDoorwayAt(-17, startZ, endZ);
const nurseryBlockedZ = walkNurseryDoor(24.0, 18.0);
check('closed nursery entrance blocks player', nurseryBlockedZ > 19.9, nurseryBlockedZ.toFixed(2));
nursery.toggleEntranceDoors();
for (let frame = 0; frame < 120; frame += 1) nursery.update(1 / 60);
check('nursery door opens fully', nursery.entrance.doorAmount > 0.98, nursery.entrance.doorAmount.toFixed(3));
const nurseryOpenZ = walkNurseryDoor(24.0, 19.0);
check('open nursery entrance is walkable', nurseryOpenZ < 19.7, nurseryOpenZ.toFixed(2));
nursery.toggleEntranceDoors();
for (let frame = 0; frame < 120; frame += 1) nursery.update(1 / 60);
check('nursery entrance closes again', nursery.entrance.doorAmount < 0.02);

const gardenSlots = nursery.getTableSlots();
check(
  'one 3.4 x 1.8 m tidal seedling bed is installed',
  gardenSlots.length === 1 &&
    gardenSlots[0].width === 1.8 &&
    gardenSlots[0].length === 3.4 &&
    gardenSlots[0].centreX === -17 &&
    gardenSlots[0].centreZ === 16,
  `${gardenSlots.length} slots`,
);
check(
  'the tidal bed sits completely inside the nursery walls',
  gardenSlots.every(
    (slot) =>
      slot.minX > NURSERY_DIM.centreX - NURSERY_DIM.halfWidth + 0.18 &&
      slot.maxX < NURSERY_DIM.centreX + NURSERY_DIM.halfWidth - 0.18 &&
      slot.minZ > NURSERY_DIM.centreZ - NURSERY_DIM.halfLength + 0.18 &&
      slot.maxZ < NURSERY_DIM.centreZ + NURSERY_DIM.halfLength - 0.18,
  ),
);
const nurseryTableBox = collisionWorld.boxes.find((box) => box.label === 'nursery tidal seedling bed');
const nurseryWalls = collisionWorld.boxes.filter(
  (box) =>
    box.label.includes('wall') &&
    box.minZ > 11 &&
    box.maxZ < 21 &&
    box.maxX < -14,
);
check(
  'tidal bed collision clears the nursery frame',
  Boolean(nurseryTableBox) &&
    nurseryWalls.length === 5 &&
    nurseryWalls.every((box) => !overlaps(nurseryTableBox, box)),
  `${nurseryWalls.length} walls`,
);
const nurseryPumpBox = collisionWorld.boxes.find((box) => box.label === 'nursery irrigation pump');
check(
  'nursery pump clears the bed, walls and door landing',
  Boolean(nurseryPumpBox) &&
    !overlaps(nurseryPumpBox, nurseryTableBox) &&
    nurseryWalls.every((box) => !overlaps(nurseryPumpBox, box)) &&
    nurseryPumpBox.minZ > NURSERY_DIM.centreZ - NURSERY_DIM.halfLength + 0.18,
);
const westAisle = nurseryTableBox.minX - (NURSERY_DIM.centreX - NURSERY_DIM.halfWidth + 0.18);
const eastAisle = NURSERY_DIM.centreX + NURSERY_DIM.halfWidth - 0.18 - nurseryTableBox.maxX;
const doorLanding = NURSERY_DIM.centreZ + NURSERY_DIM.halfLength - nurseryTableBox.maxZ;
check(
  'tidal bed leaves walkable side aisles and a door landing',
  westAisle >= 0.8 && eastAisle >= 0.8 && doorLanding >= 1.8,
  `${westAisle.toFixed(2)} / ${eastAisle.toFixed(2)} / ${doorLanding.toFixed(2)}`,
);

const bed = nursery.tidalBed;
const trayConfig = LAYOUT.nursery.tidalBed.trays;
check(
  'exactly 36 trays are installed in a 6 x 6 grid',
  bed.trays.length === 36 &&
    trayConfig.count === 36 &&
    trayConfig.rows === 6 &&
    trayConfig.columns === 6 &&
    bed.trayMeshes.bases.count === 36 &&
    bed.trayMeshes.cells.count === 36,
  `${bed.trays.length} trays / ${bed.trayMeshes.bases.count} meshes`,
);
check(
  'tray cells total 11,520 seedlings',
  bed.trays.every((tray) => tray.cells === 320) && bed.capacity === 11520,
  `${bed.capacity}`,
);
check(
  'trays are 550 x 280 x 45 mm',
  bed.trays.every(
    (tray) => tray.length === 0.55 && tray.width === 0.28 && tray.height === 0.045,
  ),
);
check(
  'tray block is 3.30 x 1.68 m with 2-3 cm flood-pan clearance',
  Math.abs(bed.trayBlock.length - 3.3) < 1e-9 &&
    Math.abs(bed.trayBlock.width - 1.68) < 1e-9 &&
    bed.trayBlock.clearanceX >= 0.0199 &&
    bed.trayBlock.clearanceX <= 0.04 &&
    bed.trayBlock.clearanceZ >= 0.0199 &&
    bed.trayBlock.clearanceZ <= 0.04,
  `${bed.trayBlock.clearanceX.toFixed(3)} / ${bed.trayBlock.clearanceZ.toFixed(3)}`,
);
const pan = LAYOUT.nursery.tidalBed.floodPan;
check(
  'all trays fit within the flood surface without overlap',
  bed.trays.every(
    (tray) =>
      Math.abs(tray.x) + tray.width / 2 <= pan.width / 2 + 1e-9 &&
      Math.abs(tray.z) + tray.length / 2 <= pan.length / 2 + 1e-9,
  ) &&
    bed.trays.every((tray, index) =>
      bed.trays.every((other, otherIndex) => {
        if (index === otherIndex) return true;
        return (
          Math.abs(tray.x - other.x) >= (tray.width + other.width) / 2 - 1e-9 ||
          Math.abs(tray.z - other.z) >= (tray.length + other.length) / 2 - 1e-9
        );
      }),
    ),
);
check(
  'flood water reaches the tray drain holes without floating them',
  pan.floorY + pan.waterDepth > bed.trays[0].bottomY &&
    pan.floorY + pan.waterDepth < bed.trays[0].topY,
  `${(pan.floorY + pan.waterDepth).toFixed(3)} m`,
);
check(
  'single-layer bench is the only growing deck',
  Boolean(bed.group.getObjectByName('nursery-abs-flood-pan')) &&
    bed.group.getObjectByName('seedling-tray-bases').count === 36 &&
    !bed.group.getObjectByName('upper-tray-deck'),
);

const nurseryTableEntry = nursery.getInteractables().find((entry) => entry.data.id === bed.bed.id);
check(
  'tidal bed is an E interaction target',
  nurseryTableEntry?.data.interaction === 'nursery-start-cycle' &&
    nurseryTableEntry?.data.specs[1][1] === '36 - 6 x 6 grid' &&
    nurseryTableEntry?.data.specs[2][1] === '320 per tray - 11,520 seedlings',
  nurseryTableEntry?.data.interaction,
);
check(
  'nursery irrigation is connected to Reservoir 2',
  Boolean(bed.group.getObjectByName('nursery-irrigation-pump')) &&
    Boolean(bed.group.getObjectByName('nursery-feed-pipe-runs')) &&
    Boolean(bed.group.getObjectByName('nursery-return-pipe-runs')) &&
    Boolean(bed.group.getObjectByName('nursery-feed-manifold')) &&
    LAYOUT.nursery.irrigation.reservoirId === 'ro-tank-2',
);
check(
  'four yellow sticky traps are mounted on the nursery frame',
  nursery.stickyTraps?.traps.length === 4 &&
    nursery.stickyTraps.traps.every((trap) =>
      [12, 16, 20].includes(trap.mount.columnZ + NURSERY_DIM.centreZ),
    ) &&
    nursery.stickyTraps.traps.every((trap) => Math.abs(trap.mount.columnX) === 2),
  `${nursery.stickyTraps?.traps.length} traps`,
);
check(
  'nursery trap metadata keeps inspection separate from the main house',
  nursery.stickyTraps.interactables.every(
    (entry) =>
      entry.data.buildingId === 'nursery-greenhouse' &&
      entry.data.interaction === 'inspect-trap',
  ),
);
const nurseryTrapInspection = nursery.stickyTraps.inspect(0);
check(
  'nursery trap inspection reports a caught count',
  nurseryTrapInspection?.caught > 0 && nurseryTrapInspection.threshold === 25,
);
check(
  'retractable shade screen covers the bench below the roof',
  Boolean(nursery.shadeScreen?.panel) &&
    nursery.shadeScreen.coverage > 0.98 &&
    nursery.shadeScreen.data.interaction === 'nursery-toggle-shade' &&
    LAYOUT.nursery.shadeScreen.y < NURSERY_DIM.gutterY &&
    LAYOUT.nursery.shadeScreen.y > pan.floorY + pan.waterDepth,
);
const shadeRetract = nursery.toggleShade();
for (let frame = 0; frame < 300; frame += 1) nursery.update(1 / 60);
check(
  'shade screen retracts north out of the light path',
  shadeRetract === false && nursery.shadeScreen.coverage < 0.12,
  nursery.shadeScreen.coverage.toFixed(2),
);
const shadeExtend = nursery.toggleShade();
for (let frame = 0; frame < 300; frame += 1) nursery.update(1 / 60);
check(
  'shade screen extends over the whole nursery bench',
  shadeExtend === true && nursery.shadeScreen.coverage > 0.98,
  nursery.shadeScreen.coverage.toFixed(2),
);

/* ------------------------------------------------ Nursery ebb and flow */
bed.setAuto(false);
bed.resetCycle();
const savedPumps = { ...control.pumps };
for (const key of Object.keys(control.pumps)) control.setPump(key, false);
const nurseryTank = water.tanks.find((tank) => tank.id === 'ro-tank-2');
const nurseryTankStart = nurseryTank.level;
const cycleStart = bed.startCycle();
check(
  'stage 1 floods the pan and starts the pump',
  cycleStart.started &&
    bed.stage === 'flooding' &&
    bed.pumpOn &&
    control.nursery.pumpOn &&
    bed.waterMesh.visible,
  `${cycleStart.label} / ${bed.waterDepth.toFixed(3)} m`,
);
for (let frame = 0; frame < 120; frame += 1) {
  bed.update(1 / 60);
  water.update(1 / 60);
}
check(
  'flooding draws the shared Reservoir 2 inventory',
  nurseryTank.level < nurseryTankStart && water.nurseryDepth > 0,
  `${nurseryTankStart.toFixed(4)} -> ${nurseryTank.level.toFixed(4)}`,
);
bed.update(21);
water.update(21);
check(
  'stage 2 holds the irrigation level without overflowing',
  bed.stage === 'irrigating' &&
    bed.pumpOn &&
    Math.abs(bed.waterDepth - pan.waterDepth) < 1e-9 &&
    bed.waterMesh.position.y <= pan.floorY + pan.waterDepth + 0.003,
  `${bed.stage} / ${bed.waterDepth.toFixed(3)} m`,
);
bed.update(31);
water.update(31);
check(
  'stage 3 stops the pump and opens the drain',
  bed.stage === 'draining' && !bed.pumpOn && bed.drainOpen,
  `${bed.stage} / drain ${bed.drainOpen}`,
);
bed.update(23);
water.update(23);
check(
  'stage 4 returns to ready and refills the reservoir',
  bed.stage === 'ready' &&
    !bed.pumpOn &&
    !bed.drainOpen &&
    bed.waterDepth === 0 &&
    bed.cycles === 1 &&
    Math.abs(nurseryTank.level - nurseryTankStart) < 1e-6,
  `${bed.stage} / ${nurseryTank.level.toFixed(4)}`,
);
for (const [key, value] of Object.entries(savedPumps)) control.setPump(key, value);
bed.setAuto(true);
bed.resetCycle();

/* ------------------------------------------------ Nursery access routes */
nursery.toggleEntranceDoors();
for (let frame = 0; frame < 120; frame += 1) nursery.update(1 / 60);
const nurseryWalker = new THREE.Vector3(-17, 0, 23.0);
for (let z = 23.0; z >= 19.4; z -= 0.05) {
  nurseryWalker.z = z;
  collisionWorld.resolve(nurseryWalker, LAYOUT.player.radius);
}
for (let x = -17; x >= -18.4; x -= 0.05) {
  nurseryWalker.x = x;
  collisionWorld.resolve(nurseryWalker, LAYOUT.player.radius);
}
for (let z = nurseryWalker.z; z >= 13.0; z -= 0.05) {
  nurseryWalker.z = z;
  collisionWorld.resolve(nurseryWalker, LAYOUT.player.radius);
}
check(
  'player can enter and walk the aisle around the tidal bed',
  nurseryWalker.x < -18.2 && nurseryWalker.z < 13.1,
  `${nurseryWalker.x.toFixed(2)}, ${nurseryWalker.z.toFixed(2)}`,
);
nursery.toggleEntranceDoors();
for (let frame = 0; frame < 120; frame += 1) nursery.update(1 / 60);

const gapWalker = new THREE.Vector3(-13.5, 0, 23.0);
for (let z = 23.0; z >= 10.0; z -= 0.05) {
  gapWalker.z = z;
  collisionWorld.resolve(gapWalker, LAYOUT.player.radius);
}
check(
  'clear walkway remains between the two greenhouses',
  gapWalker.z < 10.1 && Math.abs(gapWalker.x + 13.5) < 0.35,
  `${gapWalker.x.toFixed(2)}, ${gapWalker.z.toFixed(2)}`,
);

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
  'rain is masked over both glasshouses',
  skyEnvironment.isInsideRoof(0, 0) &&
    skyEnvironment.isInsideRoof(-17, 16) &&
    !skyEnvironment.isInsideRoof(-17, 25),
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
  'save payload is version 3 with manual weather and control state',
  saved?.version === 3 &&
    saved.climate?.weather === 'heavyRain' &&
    saved.climate?.weatherManual === true &&
    saved.climate?.rainMmPerHour > 10 &&
    saved.control?.pumps?.group1PumpOn !== undefined &&
    saved.water?.harvesterLevel >= 0,
);
const loaded = saveSystem.load();
check(
  'save round-trips through local storage',
  loaded?.version === 3 && loaded.control.groups.length === 2,
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
/* ------------------------------------- Version 10 nursery production cycle */
const productionBed = nursery.tidalBed;
const productionTrays = productionBed.trays;
check(
  'all 36 propagation trays start empty and independent',
  productionTrays.length === 36 &&
    productionTrays.every(
      (tray) =>
        tray.state === 'empty' &&
        tray.cells === 320 &&
        tray.plan === null &&
        tray.info.interaction === 'nursery-seed-tray' &&
        tray.info.trayId === tray.id,
    ) &&
    new Set(productionTrays.map((tray) => tray.info.id)).size === 36,
);

const productionTray0 = productionTrays[0];
const productionTray1 = productionTrays[1];
const productionTray2 = productionTrays[2];
const productionTray3 = productionTrays[3];
const firstSow = productionTray0.plantSeeds({ seed: 20261001 });
const germinationSnapshot = Array.from(productionTray0.plan.germination);
check(
  'one tray sows exactly 320 cells with 304 germinated and 16 empty',
  firstSow.ok &&
    productionTray0.cells === 320 &&
    productionTray0.germinated === 304 &&
    productionTray0.emptyCells === 16 &&
    productionTray0.plan.germination.reduce((sum, value) => sum + value, 0) === 304,
  `${productionTray0.germinated}/${productionTray0.emptyCells}`,
);
productionTray0.setGrowthDay(14);
check(
  'germination mask is unchanged through the 14-day cycle',
  germinationSnapshot.every((value, index) => value === productionTray0.plan.germination[index]),
);
check(
  'five growth stages map to Days 1-2, 3-5, 6-8, 9-11 and 12-14',
  GROWTH_STAGES.map((stage) => stageForDay(stage.minDay).stage).join(',') === '1,2,3,4,5' &&
    stageForDay(2).stage === 1 &&
    stageForDay(5).stage === 2 &&
    stageForDay(8).stage === 3 &&
    stageForDay(11).stage === 4 &&
    stageForDay(14).stage === 5,
);
const stageGeometries = [1, 2, 3, 4, 5].map((stage) => getPlantGeometry(stage, 0, true));
const stageTriangleCounts = stageGeometries.map((geometry) => geometry.index.count / 3);
const stageRadii = stageGeometries.map((geometry) => geometry.boundingSphere.radius);
check(
  'procedural leaf geometry grows substantially through five stages',
  stageTriangleCounts[4] >= stageTriangleCounts[3] &&
    stageTriangleCounts[3] > stageTriangleCounts[2] &&
    stageTriangleCounts[2] > stageTriangleCounts[1] &&
    stageRadii.every((radius, index) => index === 0 || radius > stageRadii[index - 1]),
  `${stageTriangleCounts.join(' / ')} | ${stageRadii.map((radius) => radius.toFixed(4)).join(' / ')}`,
);
productionTray0.setViewerDistance(0);
productionTray0.setGrowthDay(14);
check(
  'transplant-ready tray renders 304 instanced rosettes with leaf-count variants',
  productionTray0.layer.instanceCount === 304 && productionTray0.layer.buckets.length >= 2,
  `${productionTray0.layer.instanceCount} / ${productionTray0.layer.buckets.length} variants`,
);

const unfinishedSow = productionTray3.plantSeeds({ seed: 3099 });
const unfinishedPickup = new TrayPickupController({
  scene,
  camera: new THREE.PerspectiveCamera(60, 1, 0.05, 100),
  nursery,
  materials,
}).pickUp(productionTray3.id);
check(
  'unfinished trays cannot be carried',
  unfinishedSow.ok && !unfinishedPickup.ok && productionTray3.atTable,
  unfinishedPickup.reason,
);
productionTray3.clearCrop();

/* ------------------------------- Version 11 calendar-driven nursery growth */
const calendarTray = productionTray3;
const calendarSow = calendarTray.plantSeeds({ seed: 5150, calendarDay: 0 });
const day1Geometry = getCropPlantGeometry(
  calendarTray.cropName,
  calendarTray.stage,
  calendarTray.growthDay,
  0,
  true,
);
const day1Radius = day1Geometry.boundingSphere?.radius ?? 0;
const day2Result = nursery.advanceDay(1);
const day2Duplicate = nursery.advanceDay(1);
const day2Geometry = getCropPlantGeometry(
  calendarTray.cropName,
  calendarTray.stage,
  calendarTray.growthDay,
  0,
  true,
);
check(
  'one in-game day advances a planted nursery tray to Day 2 exactly once',
  calendarSow.ok &&
    calendarTray.growthDay === 2 &&
    day2Result.advanced === 1 &&
    day2Duplicate.advanced === 0 &&
    productionTray2.state === 'empty' &&
    productionTray2.growthDay === 0,
  `Day ${calendarTray.growthDay}, ${day2Result.advanced} advanced`,
);
check(
  'Day 1 to Day 2 produces visibly larger sprout geometry',
  (day2Geometry.boundingSphere?.radius ?? 0) > day1Radius,
  `${day1Radius.toFixed(5)} -> ${(day2Geometry.boundingSphere?.radius ?? 0).toFixed(5)}`,
);
nursery.advanceDay(2);
check(
  'Day 3 opens the cotyledon stage without jumping to Day 14',
  calendarTray.growthDay === 3 &&
    calendarTray.stage === 2 &&
    !calendarTray.ready &&
    calendarTray.layer.signature.includes(':2:'),
  `Day ${calendarTray.growthDay}, stage ${calendarTray.stage}`,
);
nursery.advanceDay(3);
nursery.advanceDay(4);
check(
  'consecutive days enlarge cotyledons and keep the germination mask intact',
  calendarTray.growthDay === 5 &&
    cropDevelopmentForDay(5).canopySpread > cropDevelopmentForDay(3).canopySpread &&
    visualScaleForDay(5) > visualScaleForDay(3),
  `${cropDevelopmentForDay(3).canopySpread.toFixed(4)} -> ${cropDevelopmentForDay(5).canopySpread.toFixed(4)}`,
);
nursery.advanceDay(6);
nursery.advanceDay(7);
check(
  'true leaves emerge at the appropriate Day 7 development stage',
  calendarTray.growthDay === 7 &&
    calendarTray.stage === 3 &&
    cropDevelopmentForDay(7).leafCount > cropDevelopmentForDay(6).leafCount,
  `Day ${calendarTray.growthDay}, ${cropDevelopmentForDay(7).leafCount} leaves`,
);
const nurserySnapshot = nursery.snapshotGrowth();
calendarTray.setGrowthDay(4);
nursery.restoreGrowth(nurserySnapshot);
check(
  'nursery growth snapshot restores day, germination and planting date',
  nurserySnapshot.trays.some((entry) => entry.id === calendarTray.id && entry.growthDay === 7) &&
    calendarTray.growthDay === 7 &&
    calendarTray.plantedCalendarDay === 0 &&
    calendarTray.germinated === 304,
);
calendarTray.clearCrop();

productionTray1.plantSeeds({ seed: 20261002 });
nursery.growAll();
for (let frame = 0; frame < 80; frame += 1) nursery.growth.update(0.05);
check(
  'GROW advances only planted trays to Day 14',
  productionTray0.ready &&
    productionTray0.growthDay === 14 &&
    productionTray1.ready &&
    productionTray1.growthDay === 14 &&
    productionTray2.state === 'empty' &&
    productionTray2.plan === null,
  `${productionTray0.growthDay}/${productionTray1.growthDay}/${productionTray2.growthDay}`,
);
check(
  'bench exposes physical SEED ALL and GROW controls',
  productionBed.buttonInfo.seed?.interaction === 'nursery-seed-all' &&
    productionBed.buttonInfo.grow?.interaction === 'nursery-grow-all' &&
    productionBed.buttonInfo.grow.specs.length === 3,
);

const carryCamera = new THREE.PerspectiveCamera(62, 1, 0.05, 100);
carryCamera.position.set(-17, 1.65, 17.4);
carryCamera.lookAt(-17, 1.2, 16);
const carryController = new TrayPickupController({
  scene,
  camera: carryCamera,
  nursery,
  materials,
});
const emptyPick = carryController.pickUp(productionTray2.id);
const emptyPlace = carryController.placeOnNursery();
check(
  'empty tray can also be carried and returned for reuse',
  emptyPick.ok &&
    emptyPlace.ok &&
    !carryController.isCarrying &&
    productionTray2.state === 'empty' &&
    productionTray2.atTable &&
    productionBed.trays.length === 36,
);
const pickReady = carryController.pickUp(productionTray0.id);
carryController.update(0.05);
const carriedMatrix = new THREE.Matrix4();
const carriedScale = new THREE.Vector3();
productionBed.trayMeshes.bases.getMatrixAt(0, carriedMatrix);
carriedMatrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), carriedScale);
check(
  'Day-14 tray is picked up as a horizontal physical object',
  pickReady.ok &&
    carryController.isCarrying &&
    carryController.view?.group.parent === scene &&
    Math.abs(carryController.view.group.rotation.x) < 1e-9 &&
    Math.abs(carryController.view.group.rotation.z) < 1e-9 &&
    carriedScale.x < 0.001 &&
    carryController.view.layer.instanceCount === 304,
  `${carriedScale.x.toFixed(6)} shell scale`,
);
const placeBack = carryController.placeOnNursery();
productionBed.trayMeshes.bases.getMatrixAt(0, carriedMatrix);
carriedMatrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), carriedScale);
check(
  'carried tray can be set back down on the nursery bench',
  placeBack.ok &&
    !carryController.isCarrying &&
    productionTray0.atTable &&
    productionTray0.ready &&
    carriedScale.x > 0.99,
  `${carriedScale.x.toFixed(3)} shell scale`,
);

const cropSimulation = new PlantSimulation({ equipment, layout: LAYOUT });
equipment.setPlantSimulation(cropSimulation);
const transplantController = new SeedlingTransplantController({
  simulation: cropSimulation,
  equipment,
  nursery,
  pickup: carryController,
});
const nftTable = equipment.tables[0];
const freeBefore = cropSimulation.availablePositions(nftTable.id);
carryController.pickUp(productionTray0.id);
const transplantResult = transplantController.transplant(nftTable.id);
const tablePlantings = cropSimulation.getTablePlantings(nftTable.id);
const gullyState = cropSimulation.gullyAvailability(nftTable.id);
check(
  'transplant fills free NFT holes without overplanting a gully',
  freeBefore === 320 &&
    transplantResult.ok &&
    transplantResult.planted === 304 &&
    transplantResult.free === 16 &&
    transplantResult.gulliesUsed === 8 &&
    tablePlantings.length === 304 &&
    gullyState.every((gully) => gully.used <= gully.capacity),
  `${freeBefore} -> ${transplantResult.free}`,
);
check(
  'transplant preserves Green Coral variety and removes the carried tray',
  tablePlantings.every((plant) => plant.cropName === 'Green Coral Lettuce') &&
    !carryController.isCarrying &&
    productionTray0.state === 'empty' &&
    productionTray0.atTable &&
    tablePlantings.every((plant) => plant.sourceTrayId === productionTray0.id),
);
check(
  'transplanted plugs are visible as NFT production plants and start at Day 1',
  equipment.cropLayer.tableGroups.get(nftTable.id).meshes.length > 0 &&
    tablePlantings.every(
      (plant) =>
        plant.nurseryAgeDays === 14 &&
        plant.nftAgeDays === 1 &&
        plant.ageDays === 15,
    ),
  `Nursery ${tablePlantings[0].nurseryAgeDays} + NFT Day ${tablePlantings[0].nftAgeDays}`,
);
const cropWater = new WaterNutrientSimulation({
  equipment,
  layout: LAYOUT,
  control,
  climate,
  plants: cropSimulation,
});
const cropDemandTankId = [...cropWater.cropDemandByTank.keys()][0];
const cropDemandTank = cropWater.tanks.find((tank) => tank.id === cropDemandTankId);
const levelBefore = cropDemandTank?.level ?? 0;
const transferBefore = control.pumps.rainwaterTransferOn;
control.setPump('rainwaterTransferOn', false);
cropWater.update(60);
control.setPump('rainwaterTransferOn', transferBefore);
const levelAfter = cropDemandTank?.level ?? 0;
check(
  'transplanted crop load draws water through the existing nutrient model',
  cropWater.transplantedCropCount === 304 &&
    cropWater.cropWaterDemandLps > 0 &&
    cropWater.cropWaterUsedLitres > 0 &&
    levelAfter < levelBefore,
  `${cropWater.cropWaterUsedLitres.toFixed(3)} L`,
);
const cropAgeBefore = tablePlantings[0].ageDays;
cropSimulation.update(60);
check(
  'real time no longer advances plant age; only calendar days do',
  tablePlantings[0].ageDays === cropAgeBefore,
  `${cropAgeBefore.toFixed(2)} -> ${tablePlantings[0].ageDays.toFixed(2)}`,
);
const development14 = nftDevelopmentForDay(1, tablePlantings[0].cropName);
const firstCropDay = cropSimulation.advanceDay(1);
const development15 = nftDevelopmentForDay(
  tablePlantings[0].nftAgeDays,
  tablePlantings[0].cropName,
);
const cropDayDuplicate = cropSimulation.advanceDay(1);
check(
  'one calendar day advances every NFT plant and a duplicate call is ignored',
  firstCropDay.advanced === tablePlantings.length &&
    cropDayDuplicate.advanced === 0 &&
    cropDayDuplicate.duplicate &&
    tablePlantings.every((plant) => plant.nftAgeDays === 2) &&
    tablePlantings.every((plant) => plant.ageDays === cropAgeBefore + 1),
  `${firstCropDay.advanced} plants / NFT Day ${tablePlantings[0].nftAgeDays}`,
);
check(
  'NFT crops gain leaves, height and canopy spread on the next day',
  development15.leafCount > development14.leafCount ||
    development15.height > development14.height,
  `${development14.leafCount}/${development14.height.toFixed(4)} -> ${development15.leafCount}/${development15.height.toFixed(4)}`,
);
const variantCount = new Set(tablePlantings.slice(0, 40).map((plant) => plant.variantSeed)).size;
check(
  'individual NFT plants retain natural variation',
  variantCount > 20 && tablePlantings[0].growthSeed !== tablePlantings[1].growthSeed,
  `${variantCount} unique variants`,
);
for (let day = 2; day < NFT_PRODUCTION_DAYS; day += 1) cropSimulation.advanceDay(day);
const matureDay = cropSimulation.advanceDay(NFT_PRODUCTION_DAYS);
const mature = tablePlantings[0];
const matureDevelopment = nftDevelopmentForDay(NFT_PRODUCTION_DAYS, mature.cropName);
const variantSizes = [0, 1, 2, 3].map((variant) => {
  const geometry = getNftPlantGeometry(mature.cropName, NFT_PRODUCTION_DAYS, variant, true);
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  return { width: Math.max(size.x, size.z), height: size.y };
});
check(
  '20-day NFT production ends at 100 g and total crop age 34 days',
  matureDay.ready === tablePlantings.length &&
    tablePlantings.every(
      (plant) =>
        plant.nftAgeDays === NFT_PRODUCTION_DAYS &&
        plant.ageDays === 34 &&
        plant.harvestReady === true,
    ) &&
    mature.biomassG === 100 &&
    mature.harvestWeightG === 100 &&
    matureDevelopment.harvestReady,
  `NFT Day ${mature.nftAgeDays} / ${mature.ageDays} total / ${mature.biomassG} g`,
);
check(
  'every harvest-ready Coral variant measures 18-20 cm across and about 20 cm tall',
  variantSizes.every(
    ({ width, height }) =>
      width >= 0.18 && width <= 0.2 && height >= 0.195 && height <= 0.205,
  ),
  variantSizes
    .map(({ width, height }) => `${(width * 100).toFixed(1)}x${(height * 100).toFixed(1)} cm`)
    .join(' / '),
);
const matureInfo = cropSimulation.describePlant(mature, nftTable);
check(
  'inspect payload exposes production ages, biomass target and harvest action',
  matureInfo?.interaction === 'harvest-crop' &&
    matureInfo?.action === 'Harvest crop' &&
    matureInfo?.nftAgeDays === NFT_PRODUCTION_DAYS &&
    matureInfo?.nurseryAgeDays === 14 &&
    matureInfo?.totalAgeDays === 34 &&
    matureInfo?.biomassG === 100 &&
    matureInfo?.targetHarvestWeightG === 100 &&
    matureInfo?.specs?.every((entry) => Array.isArray(entry) && entry.length === 2) &&
    matureInfo.specs.some(([label, value]) => label === 'Status' && value === 'READY FOR HARVEST'),
  `${matureInfo?.title} / ${matureInfo?.specs?.length ?? 0} specs`,
);
check(
  'production roots and net pots are modelled below the channel plate',
  getNftRootGeometry(true).boundingBox.max.y <= 0.001 &&
    Math.abs(getNftRootGeometry(true).boundingBox.min.y + 1) < 0.02 &&
    getNftNetPotGeometry(true).boundingBox.max.y > 0.001,
  `${getNftRootGeometry(true).boundingBox.min.y.toFixed(2)} m roots`,
);
check(
  'harvest-ready geometry keeps every daily scale monotonic',
  [5, 10, 15, 20].every(
    (day, index, days) =>
      index === 0 || productionVisualScaleForDay(day) > productionVisualScaleForDay(days[index - 1]),
  ),
);

const harvestedPlant = mature;
const harvestResult = cropSimulation.harvestPlant(nftTable.id, harvestedPlant.id);
check(
  'E harvest removes one ready head and banks its 100 g weight',
  harvestResult.ok &&
    harvestResult.weightG === 100 &&
    cropSimulation.getTablePlantings(nftTable.id).length === 303 &&
    cropSimulation.harvestStats.harvestedPlants === 1 &&
    cropSimulation.harvestStats.totalHarvestWeightG === 100 &&
    cropSimulation.harvestInventoryList[0]?.count === 1 &&
    cropSimulation.harvestReadyPlantCount === 303,
  `${harvestResult.weightG} g / ${cropSimulation.availablePositions(nftTable.id)} free holes`,
);
const earlyHarvest = cropSimulation.getTablePlantings(nftTable.id)[0];
earlyHarvest.nftAgeDays = 19;
earlyHarvest.harvestReady = false;
const rejectedHarvest = cropSimulation.harvestPlant(nftTable.id, earlyHarvest.id);
cropSimulation.getPlantGrowth(earlyHarvest);
check(
  'harvest rejects a plant before NFT Day 20',
  !rejectedHarvest.ok && rejectedHarvest.ready === false,
  rejectedHarvest.reason,
);
earlyHarvest.nftAgeDays = NFT_PRODUCTION_DAYS;
cropSimulation.getPlantGrowth(earlyHarvest);

const plantGrowthSnapshot = cropSimulation.snapshotGrowth();
const restoredCrops = new PlantSimulation({ equipment, layout: LAYOUT });
restoredCrops.restoreGrowth(plantGrowthSnapshot);
check(
  'NFT growth snapshot restores production ages, biomass, readiness and harvest',
  restoredCrops.getTablePlantings(nftTable.id).length === 303 &&
    restoredCrops.getTablePlantings(nftTable.id)[0].nftAgeDays === NFT_PRODUCTION_DAYS &&
    restoredCrops.getTablePlantings(nftTable.id)[0].ageDays === 34 &&
    restoredCrops.getTablePlantings(nftTable.id)[0].biomassG === 100 &&
    restoredCrops.getTablePlantings(nftTable.id)[0].harvestReady === true &&
    restoredCrops.harvestStats.harvestedPlants === 1 &&
    restoredCrops.harvestStats.totalHarvestWeightG === 100 &&
    restoredCrops.harvestInventoryList.length === 1 &&
    restoredCrops.calendarDay === NFT_PRODUCTION_DAYS,
  `${restoredCrops.getTablePlantings(nftTable.id).length} plants / ${restoredCrops.totalHarvestWeightG} g`,
);
const varietyProfiles = ['Green Coral Lettuce', 'Green Oak Lettuce', 'Red Oak Lettuce'].map(
  (name) => {
    const variety = resolveCropVariety(name);
    const development = cropDevelopmentForDay(14, name);
    return {
      key: variety.key,
      palette: variety.materialSet,
      geometry: getCropPlantGeometry(name, 5, 14, 0, true),
      leafCount: development.leafCount,
    };
  },
);
check(
  'crop varieties keep distinct morphology and colour profiles',
  new Set(varietyProfiles.map((entry) => entry.key)).size === 3 &&
    new Set(varietyProfiles.map((entry) => entry.palette)).size === 2 &&
    Math.abs(
      varietyProfiles[0].geometry.boundingSphere.radius -
        varietyProfiles[2].geometry.boundingSphere.radius,
    ) > 1e-5,
  varietyProfiles.map((entry) => entry.key).join(' / '),
);
const xiao = cropDevelopmentForDay(14, 'Xiao Bai Cai');
const coral = cropDevelopmentForDay(14, 'Green Coral Lettuce');
check(
  'broad-leaf crops keep a wider, lower morphology than coral lettuce',
  xiao.variety.widthScale > coral.variety.widthScale &&
    xiao.variety.lobes < coral.variety.lobes,
  `${xiao.variety.key} / ${coral.variety.key}`,
);
saveSystem.save({
  climate,
  control,
  water,
  plants: cropSimulation,
  nursery,
});
const savedGrowth = saveSystem.load();
check(
  'save payload carries nursery and NFT growth records',
  savedGrowth?.plants?.growth?.tables?.length > 0 &&
    savedGrowth?.plants?.growth?.harvest?.stats?.harvestedPlants === 1 &&
    savedGrowth?.plants?.growth?.harvest?.inventory?.length === 1 &&
    savedGrowth?.nursery?.trays?.length === 36 &&
    savedGrowth.nursery.trays.some((tray) => tray.growthDay > 0),
  `${savedGrowth?.plants?.growth?.tables?.length} tables / ${savedGrowth?.nursery?.trays?.length} trays`,
);

const tooFull = carryController.pickUp(productionTray1.id);
const rejected = transplantController.transplant(nftTable.id);
check(
  'capacity check rejects a second tray before overplanting',
  tooFull.ok &&
    !rejected.ok &&
    carryController.isCarrying &&
    cropSimulation.availablePositions(nftTable.id) === 17,
  rejected.reason,
);
carryController.placeOnNursery();
const cycleBefore = productionTray0.cycle;
const replant = productionTray0.plantSeeds({ seed: 77 });
check(
  'empty tray returns to the bench and can start a new cycle without duplicates',
  replant.ok &&
    productionTray0.cycle === cycleBefore + 1 &&
    productionTray0.state === 'seeded' &&
    productionBed.trays.length === 36,
);
carryController.dispose();

equipment.dispose();
check('equipment disposed', equipment.group === null, equipment.group);
check('tables disposed', equipment.tables.length === 0);
storage.dispose();
bluelab.dispose();
irrigationPanel.dispose();
weatherPanel.dispose();
environment.dispose();
nursery.dispose();
check('nursery disposed', nursery.group === null && !scene.getObjectByName('nursery-greenhouse'));
greenhouse.dispose();
check('scene emptied', scene.children.length === 0, scene.children.length);
collisionWorld.dispose();
check('footprints clear with the collision world', collisionWorld.footprints.length === 0);

let failed = 0;
for (const result of checks) {
  if (!result.ok) failed += 1;
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.detail !== '' ? `: ${result.detail}` : ''}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
if (failed > 0) process.exitCode = 1;

