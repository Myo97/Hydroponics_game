import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { HarvestBox } from '../world/harvest/HarvestBox.js';
import { BillboardLabel, LabelField } from '../world/BillboardLabels.js';

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const target = new THREE.Vector3();
const dropPoint = new THREE.Vector3();

const GROUND_Y = 0.02;
const CARRY_HEIGHT = 0.44;

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * Version 14 harvest floor controller.
 *
 * Owns the styrofoam box fleet, the two-gully harvest pass, the carried-box
 * pose and the harvest-house refrigerator hand-off. Boxes are provisioned for
 * every NFT table up front but stay invisible until their table is picked, so
 * an untouched farm costs no draw calls.
 */
export class HarvestController {
  constructor({
    scene,
    camera,
    materials,
    equipment,
    simulation,
    collisionWorld = null,
    fridge = null,
    fridges = [],
    layout = LAYOUT,
    onPacked = null,
    onModeChange = null,
  } = {}) {
    this.scene = scene;
    this.camera = camera;
    this.materials = materials;
    this.equipment = equipment;
    this.simulation = simulation;
    this.collisionWorld = collisionWorld;
    this.fridge = fridge;
    this.fridges = Array.from(new Set([fridge, ...fridges].filter(Boolean)));
    this.layout = layout;
    this.config = layout.harvest ?? {};
    this.onPacked = onPacked;
    this.onModeChange = onModeChange;

    this.root = null;
    this.boxes = [];
    this.byId = new Map();
    this.byTable = new Map();
    this.tableData = new Map();

    this.carried = null;
    this.carryElapsed = 0;
    this.packing = null;
    this.modeTableId = null;
    this.badgeAccumulator = 0;
    this.badgeSignature = '';
    this.badgeField = null;
    this.carryLabel = null;
    this.flyMesh = null;
    this.flyFrom = new THREE.Vector3();
    this.flyTo = new THREE.Vector3();
    this.lastPacked = null;
    this.interactables = [];
  }

  build() {
    const root = new THREE.Group();
    root.name = 'harvest-floor';
    this.root = root;
    this.scene?.add(root);

    // One shell material set for every box; produce colour stays per box.
    const boxMaterials = {
      foam: new THREE.MeshStandardMaterial({
        color: 0xf3f4ee,
        roughness: 0.94,
        metalness: 0,
      }),
      inner: new THREE.MeshStandardMaterial({
        color: 0xd6dad0,
        roughness: 0.98,
        metalness: 0,
      }),
      band: new THREE.MeshStandardMaterial({
        color: 0x3f7d68,
        roughness: 0.72,
      }),
    };
    boxMaterials.foam.name = 'harvest-box-foam';
    boxMaterials.inner.name = 'harvest-box-inner';
    boxMaterials.band.name = 'harvest-box-band';
    this.boxMaterials = boxMaterials;

    const tables = this.equipment?.tables ?? [];
    const perTable = Math.max(1, this.config.boxesPerTable ?? 4);
    for (const table of tables) {
      const group = [];
      for (let index = 0; index < perTable; index += 1) {
        const [x, y, z] = this.boxPosition(table, index);
        const box = new HarvestBox({
          id: `${table.id}-box-${index + 1}`,
          tableId: table.id,
          index,
          position: [x, y, z],
          materials: { hitProxy: this.materials?.hitProxy, harvestBox: boxMaterials },
          capacity: this.config.capacityPerBox ?? 80,
          tareWeightG: this.config.tareWeightG ?? 380,
          boxConfig: this.config.box ?? {},
          parent: root,
        });
        this.boxes.push(box);
        this.byId.set(box.id, box);
        group.push(box);
        this.interactables.push({ object: box.hitProxy, data: box.data });
      }
      this.byTable.set(table.id, group);
      this.tableData.set(table.id, this.createTableData(table, group));
    }

    this.badgeField = new LabelField({
      parent: this.scene,
      camera: this.camera,
      name: 'harvest-badges',
      text: 'HARVEST TABLE',
      variant: 'harvest',
      width: 1.18,
      height: 0.28,
    });

    this.carryLabel = new BillboardLabel({
      parent: this.scene,
      camera: this.camera,
      text: '',
      variant: 'store',
      width: 0.96,
      height: 0.31,
    });

    this.flyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x86c46a, roughness: 0.8, metalness: 0 }),
    );
    this.flyMesh.name = 'harvest-fly-head';
    this.flyMesh.castShadow = false;
    this.flyMesh.visible = false;
    root.add(this.flyMesh);

    this.refreshBadges(true);
    return this;
  }

  /* ---------------------------------------------------------------- staging */

  boxPosition(table, index) {
    const slots = this.config.slotOffsets ?? [-1.95, -0.65, 0.65, 1.95];
    const halfLength = Math.max(0, (table.endZ - table.startZ) / 2 - 0.42);
    const slot = Math.max(-halfLength, Math.min(halfLength, slots[index] ?? 0));
    const aisle = this.config.aisleOffset ?? 1.18;
    return [table.centerX + aisle, GROUND_Y, table.centerZ + slot];
  }

  createTableData(table, boxes) {
    return {
      id: `harvest-${table.id}`,
      kind: 'harvest-table-badge',
      category: 'Harvest floor',
      title: `${table.data?.title ?? table.id} - harvest`,
      description:
        'Two gullies are cut per pass. Every harvest-ready head is lifted into the styrofoam box staged in the aisle, which holds one full two-gully pass (80 heads). Carry the packed box to the harvest house and chill it.',
      interaction: 'harvest-table-pass',
      interactionHint: 'Harvest the next ready pass',
      specs: [],
      tableId: table.id,
      nftTableId: table.id,
      boxIds: boxes.map((box) => box.id),
    };
  }

  getInteractables() {
    return this.interactables;
  }

  getDynamicRoots() {
    return [this.root, this.badgeField?.mesh, this.carryLabel?.mesh];
  }

  getBox(boxIdOrBox) {
    if (!boxIdOrBox) return null;
    if (typeof boxIdOrBox === 'object') return boxIdOrBox;
    return this.byId.get(boxIdOrBox) ?? null;
  }

  get isCarrying() {
    return Boolean(this.carried);
  }

  get carriedBox() {
    return this.carried;
  }

  get isPacking() {
    return Boolean(this.packing);
  }

  get harvestMode() {
    return Boolean(this.modeTableId);
  }

  get harvestModeTableId() {
    return this.modeTableId;
  }

  /** The set of boxes shown: the active table shows all four staged boxes. */
  #syncBoxVisibility() {
    for (const [tableId, boxes] of this.byTable) {
      const active = tableId === this.modeTableId;
      for (const box of boxes) {
        if (box.stored || box.carried) continue;
        box.setSpawned(active || !box.isEmpty);
      }
    }
  }

  #setMode(tableId, notify = true) {
    const next = tableId ?? null;
    if (next !== this.modeTableId) {
      this.modeTableId = next;
      this.#syncBoxVisibility();
      this.refreshBadges(true);
      if (notify) this.onModeChange?.(this.harvestMode, this.modeTableId);
    }
    return { ok: true, active: this.harvestMode, tableId: this.modeTableId };
  }

  /**
   * Harvest badges submit one ready two-gully pass directly into the next box.
   * The finer plant-by-plant workflow remains available through the legacy
   * harvest-mode interaction, while the visible badge does the expected action.
   */
  toggleHarvestMode(tableId) {
    if (!tableId) return { ok: false, active: this.harvestMode, reason: 'No table selected' };
    if (this.carried) {
      return { ok: false, active: this.harvestMode, reason: 'Set the box you are carrying down first' };
    }
    if (this.modeTableId === tableId) {
      return { ...this.#setMode(null), stopping: true };
    }
    const table = this.equipment?.tables?.find((entry) => entry.id === tableId);
    if (!table) return { ok: false, active: this.harvestMode, reason: 'Harvest table not found' };
    const status = this.tableStatus(tableId);
    if (!status.box) {
      return {
        ok: false,
        active: false,
        reason: 'All four boxes are full - carry them to the harvest house',
      };
    }
    const result = this.#setMode(tableId);
    return {
      ...result,
      table,
      status,
      message: `Harvest mode on - tap ready heads to fill box ${pad2(status.box.index + 1)}`,
    };
  }

  stopHarvestMode() {
    return this.#setMode(null);
  }

  #autoStopWhenFull(tableId = this.modeTableId) {
    if (!tableId || this.modeTableId !== tableId) return false;
    const status = this.tableStatus(tableId);
    if (!status.full) return false;
    this.#setMode(null);
    return true;
  }

  get tableCount() {
    return this.byTable.size;
  }

  /** Player speed multiplier while a box is in hand. */
  get moveSpeedScale() {
    if (!this.carried) return 1;
    const scale =
      (this.config.carriedSpeedScale ?? 0.82) -
      (this.config.carriedSpeedLossPerKg ?? 0.012) * this.carried.weightKg;
    return Math.max(
      this.config.minimumCarriedSpeedScale ?? 0.42,
      Math.min(1, scale),
    );
  }



  /* ---------------------------------------------------------------- queries */

  tableStatus(tableId) {
    const boxes = this.byTable.get(tableId) ?? [];
    const plantings = this.simulation?.getTablePlantings?.(tableId) ?? [];
    let readyHeads = 0;
    for (const plant of plantings) if (plant.harvestReady) readyHeads += 1;
    const box =
      boxes.find((entry) => !entry.stored && !entry.carried && !entry.isFull) ?? null;
    return {
      boxes,
      readyHeads,
      box,
      free: box ? box.capacity - box.plantCount : 0,
      full: boxes.length > 0 && boxes.every((entry) => entry.isFull || entry.stored),
      canHarvest: readyHeads > 0 && Boolean(box) && !this.carried && !this.packing,
    };
  }

  /** Short status string used by the badge panel and the interaction hint. */
  statusLabel(tableId) {
    if (this.packing?.tableId === tableId) {
      return `Packing box ${pad2(this.packing.box.index + 1)} - ${this.packing.done}/${this.packing.plantIds.length} heads`;
    }
    if (this.carried) return 'Hands full - set the box down first';
    const status = this.tableStatus(tableId);
    if (!status.readyHeads) return 'No harvest-ready heads';
    if (!status.box) return 'All boxes full - carry them to the harvest house';
    if (this.modeTableId === tableId) {
      return `Stop harvest mode - box ${pad2(status.box.index + 1)} open`;
    }
    return `Harvest next pass - ${status.readyHeads} heads ready`;
  }

  /* ----------------------------------------------------------------- harvest */

  /**
   * One click in harvest mode: lift exactly the clicked head into the next
   * staging box. The simulation call is the single source of truth, so a click
   * can never duplicate produce or leave a hole occupied.
   */
  harvestPlant(tableId, plantId) {
    if (!this.modeTableId) {
      return { ok: false, reason: 'Start harvest mode first' };
    }
    if (tableId && tableId !== this.modeTableId) {
      return { ok: false, reason: 'Harvest mode is active at another table' };
    }
    if (this.carried) return { ok: false, reason: 'Set the carried box down first' };
    if (this.packing) return { ok: false, reason: 'A box is still packing' };

    const status = this.tableStatus(this.modeTableId);
    if (!status.box) {
      this.#setMode(null);
      return { ok: false, reason: 'All four boxes are full - carry them to the harvest house' };
    }

    const result = this.simulation?.harvestPlant?.(this.modeTableId, plantId);
    if (!result?.ok) {
      return { ok: false, reason: result?.reason ?? 'That head is not ready to harvest' };
    }

    const added = status.box.addHead({
      cropKey: result.cropKey,
      cropName: result.cropName,
      weightG: result.weightG,
    });
    if (!added.ok) {
      return { ok: false, reason: added.reason ?? 'Box could not accept the head' };
    }

    const box = status.box;
    const boxFull = box.isFull;
    const modeStopped = this.#autoStopWhenFull();
    this.refreshBadges(true);
    return {
      ok: true,
      box,
      boxFull,
      modeStopped,
      result,
      remaining: this.tableStatus(this.modeTableId ?? tableId).readyHeads,
    };
  }

  /**
   * Cut the next two sequential gullies that hold harvest-ready heads. Plants
   * leave the simulation one at a time while the box fills, so an interrupted
   * pass can never duplicate or lose a head.
   */
  harvestTable(tableId) {
    if (this.carried) {
      return { ok: false, reason: 'Set the box you are carrying down first' };
    }
    if (this.packing) {
      return { ok: false, reason: 'A box is still packing' };
    }
    const plantings = this.simulation?.getTablePlantings?.(tableId) ?? [];
    const status = this.tableStatus(tableId);
    if (!status.readyHeads) {
      const table = this.equipment?.tables?.find((entry) => entry.id === tableId);
      const sample = plantings[0];
      return {
        ok: false,
        reason: sample
          ? `No harvest-ready heads - newest plants are NFT Day ${sample.nftAgeDays ?? 1} of 17`
          : `${table?.data?.title ?? 'This table'} is empty - transplant seedlings first`,
      };
    }
    if (!status.box) {
      return {
        ok: false,
        reason: 'All four boxes are full - carry them to the harvest house',
      };
    }

    // Gullies are stored 0-based; only display numbers are 1-based.
    const gullies = Array.from(
      new Set(plantings.filter((plant) => plant.harvestReady).map((plant) => plant.gully)),
    ).sort((a, b) => a - b);
    const firstGully = gullies[0];
    const secondGully = gullies.includes(firstGully + 1) ? firstGully + 1 : null;
    const passes = new Set([firstGully, secondGully].filter((value) => value != null));
    const room = status.box.capacity - status.box.plantCount;
    const picks = plantings
      .filter((plant) => plant.harvestReady && passes.has(plant.gully))
      .sort((a, b) => a.gully - b.gully || a.hole - b.hole)
      .slice(0, room)
      .map((plant) => ({ id: plant.id, gully: plant.gully }));

    if (!picks.length) {
      return { ok: false, reason: 'No heads could be cut from the selected gullies' };
    }

    const box = status.box;
    box.setSpawned(true);
    this.packing = {
      tableId,
      box,
      plantIds: picks,
      index: 0,
      done: 0,
      elapsed: 0,
      heads: 0,
      weightG: 0,
      crops: new Map(),
      duration: Math.min(
        1.6,
        Math.max(0.3, picks.length * (this.config.fillSecondsPerHead ?? 0.045)),
      ),
    };

    const table = this.equipment?.tables?.find((entry) => entry.id === tableId);
    this.flyFrom.set(
      table?.gullies?.[firstGully]?.x ?? table?.centerX ?? box.group.position.x,
      0.95,
      table?.centerZ ?? box.group.position.z,
    );
    this.flyTo.set(
      box.group.position.x,
      box.group.position.y + box.height * 0.7,
      box.group.position.z,
    );
    if (this.flyMesh) this.flyMesh.visible = true;

    this.refreshBadges(true);
    return {
      ok: true,
      box,
      heads: picks.length,
      gullies: Array.from(passes).map((gully) => gully + 1),
      table,
      duration: this.packing.duration,
    };
  }


  #drainPacking() {
    const packing = this.packing;
    if (!packing) return;
    const total = packing.plantIds.length;
    const progress = Math.min(1, packing.elapsed / Math.max(0.01, packing.duration));
    const wanted = Math.min(total, Math.floor(progress * total));
    while (packing.index < wanted) {
      const entry = packing.plantIds[packing.index];
      packing.index += 1;
      const result = this.simulation?.harvestPlant?.(packing.tableId, entry.id);
      if (!result?.ok) continue;
      const added = packing.box.addHead({
        cropKey: result.cropKey,
        cropName: result.cropName,
        weightG: result.weightG,
      });
      if (!added.ok) break;
      packing.done += 1;
      packing.heads += 1;
      packing.weightG += result.weightG ?? 0;
      const lot = packing.crops.get(result.cropKey);
      packing.crops.set(result.cropKey, {
        cropKey: result.cropKey,
        cropName: result.cropName,
        heads: (lot?.heads ?? 0) + 1,
      });
      if (this.flyMesh) {
        this.flyMesh.material.color.setHex(
          /red/i.test(result.cropKey ?? '')
            ? 0xb4544a
            : /dark|oak/i.test(result.cropKey ?? '')
              ? 0x5f9a52
              : 0x86c46a,
        );
      }
    }

    if (progress >= 1 || packing.index >= total) {
      const box = packing.box;
      const packedTableId = packing.tableId;
      const summary = {
        tableId: packing.tableId,
        box,
        heads: packing.heads,
        weightG: packing.weightG,
        crops: Array.from(packing.crops.values()),
        duration: packing.duration,
      };
      this.packing = null;
      if (this.flyMesh) this.flyMesh.visible = false;
      this.lastPacked = summary;
      this.#autoStopWhenFull(packedTableId);
      this.refreshBadges(true);
      this.onPacked?.(summary);
    }
  }

  /* ---------------------------------------------------------- carry and drop */

  pickUp(boxIdOrBox) {
    const box = this.getBox(boxIdOrBox);
    if (!box) return { ok: false, reason: 'Box not found' };
    if (box === this.carried) return { ok: true, box };
    if (this.carried) {
      return {
        ok: false,
        reason: `Hands full - set box ${pad2(this.carried.index + 1)} down first`,
      };
    }
    if (box.stored) return { ok: false, reason: 'That box is already in the fridge' };
    if (this.packing?.box === box) return { ok: false, reason: 'That box is still packing' };

    box.setSpawned(true);
    box.setCarried(true);
    box.group.visible = true;
    this.carried = box;
    this.carryElapsed = 0;
    if (this.harvestMode) this.#setMode(null);
    for (const cabinet of this.fridges) cabinet.setCarryContext(true, box);
    this.update(0, this.camera);
    return { ok: true, box };
  }

  /** Place the carried box on the ground just ahead of the player. */
  setDown() {
    if (!this.carried) return { ok: false, reason: 'Not carrying a box' };
    const box = this.carried;
    this.#dropPosition();
    box.setPosition(dropPoint.x, GROUND_Y, dropPoint.z);
    box.spawnPosition.set(dropPoint.x, GROUND_Y, dropPoint.z);
    box.setCarried(false);
    this.carried = null;
    this.carryElapsed = 0;
    this.carryLabel?.setText('');
    for (const cabinet of this.fridges) cabinet.setCarryContext(false);
    return { ok: true, box, position: box.group.position };
  }

  #dropPosition() {
    const camera = this.camera;
    dropPoint.copy(camera.position);
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    dropPoint.addScaledVector(forward, this.config.dropForward ?? 0.95);
    dropPoint.y = GROUND_Y;
    if (this.collisionWorld) {
      this.collisionWorld.resolve(dropPoint, 0.26);
      dropPoint.y = GROUND_Y;
    }
    return dropPoint;
  }

  storeInFridge(fridge = this.fridge) {
    if (!this.carried) return { ok: false, reason: 'Not carrying a box' };
    if (!fridge) return { ok: false, reason: 'No refrigerator available' };
    if (!fridge.doorOpen) return { ok: false, reason: 'Open the fridge before putting a box inside' };
    const box = this.carried;
    const result = fridge.addBox(box);
    if (!result.ok) return result;
    // The box keeps its staging slot as its home position, so taking it back
    // out of the fridge later returns it to the same table.
    box.setStored(true);
    box.setPosition(box.spawnPosition.x, box.spawnPosition.y, box.spawnPosition.z);
    this.carried = null;
    this.carryElapsed = 0;
    this.carryLabel?.setText('');
    for (const cabinet of this.fridges) cabinet.setCarryContext(false);
    return { ok: true, box, count: fridge.boxes.length };
  }

  takeFromFridge(fridge = this.fridge) {
    if (!fridge) return { ok: false, reason: 'No refrigerator available' };
    if (!fridge.doorOpen) return { ok: false, reason: 'Open the fridge before taking a box outside' };
    if (this.carried) {
      return { ok: false, reason: 'Set the box in your hands down first' };
    }
    const box = [...fridge.boxes].reverse().find(box => !box.shopReserved);
    if (!box) return { ok: false, reason: 'No unreserved chilled box is available' };
    const removed = fridge.removeBox(box);
    if (!removed.ok) return removed;
    box.setStored(false);
    box.setSpawned(true);
    box.setPosition(box.spawnPosition.x, box.spawnPosition.y, box.spawnPosition.z);
    return this.pickUp(box);
  }


  /* ---------------------------------------------------------------- update */

  update(dt = 0, camera = this.camera) {
    const step = Math.max(0, dt);

    if (this.packing) {
      this.packing.elapsed += step;
      this.#drainPacking();
    }
    if (this.flyMesh) {
      if (this.packing) {
        const progress = Math.min(
          1,
          this.packing.elapsed / Math.max(0.01, this.packing.duration),
        );
        this.flyMesh.visible = true;
        this.flyMesh.position.lerpVectors(this.flyFrom, this.flyTo, progress);
        this.flyMesh.position.y += Math.sin(Math.PI * progress) * 0.42;
        this.flyMesh.scale.setScalar(0.7 + Math.sin(Math.PI * progress) * 0.5);
      } else {
        this.flyMesh.visible = false;
      }
    }

    if (this.carried) {
      this.carryElapsed += step;
      const pose = this.config.carryPose ?? { forward: 0.62, right: 0.2, down: 0.4 };
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
      forward.normalize();
      right.set(-forward.z, 0, forward.x);
      target.copy(camera.position);
      target.addScaledVector(forward, pose.forward);
      target.addScaledVector(right, pose.right);
      target.y = camera.position.y - pose.down + Math.sin(this.carryElapsed * 6) * 0.004;
      const blend = step === 0 ? 1 : 1 - Math.exp(-step * 16);
      this.carried.group.position.lerp(target, blend);
      this.carried.group.rotation.y = Math.atan2(forward.x, forward.z);
      this.carried.group.visible = true;

      this.carryLabel?.setText(
        `BOX ${pad2(this.carried.index + 1)} \u00b7 ${this.carried.plantCount}/${this.carried.capacity}` +
          ` \u00b7 ${this.carried.weightKg.toFixed(1)} kg`,
        'store',
      );
      if (this.carryLabel?.mesh) {
        this.carryLabel.mesh.position
          .copy(this.carried.group.position)
          .setY(this.carried.group.position.y + CARRY_HEIGHT);
        this.carryLabel.update(camera);
      }
    } else {
      if (this.carryLabel?.mesh?.visible) this.carryLabel.setText('');
      this.carryLabel?.update(camera);
    }

    this.badgeAccumulator += step;
    if (this.badgeAccumulator >= 0.2) {
      this.badgeAccumulator = 0;
      this.refreshBadges();
    }
    this.badgeField?.update(camera);
  }

  /** One shared texture: per-table counts remain in the interaction panel. */
  refreshBadges(force = false) {
    if (!this.badgeField) return;
    const tables = this.equipment?.tables ?? [];
    const signature = tables
      .map((table) => {
        const status = this.tableStatus(table.id);
        return `${table.id}:${status.readyHeads}:${status.box?.index ?? -1}:${
          this.modeTableId === table.id ? 1 : 0
        }`;
      })
      .join('|');
    if (!force && signature === this.badgeSignature) return;
    this.badgeSignature = signature;

    const entries = tables.map((table) => {
      const status = this.tableStatus(table.id);
      const data = this.tableData.get(table.id);
      if (data) {
        const active = this.modeTableId === table.id;
        data.interactionHint = this.statusLabel(table.id);
        data.action = active ? 'Stop harvest mode' : 'Start harvest mode';
        data.active = active;
        data.specs = [
          ['Ready heads', String(status.readyHeads)],
          [
            'Next box',
            status.box
              ? `${pad2(status.box.index + 1)} - ${status.box.plantCount}/${status.box.capacity} heads`
              : 'none - all full',
          ],
          [
            'Boxes staged',
            `${status.boxes.filter((box) => !box.stored).length} of ${status.boxes.length}`,
          ],
          ['Pass', 'Two sequential gullies - 80 heads per box'],
          ['Chilled', `${status.boxes.filter((box) => box.stored).length} in the harvest house`],
        ];
      }
      return {
        position:
          status.canHarvest || this.modeTableId === table.id
            ? { x: table.centerX, y: 1.38, z: table.centerZ }
            : null,
        data,
      };
    });
    this.badgeField.setEntries(entries);
  }


  /* ------------------------------------------------------------- persistence */

  snapshot() {
    return {
      boxes: this.boxes.map((box) => {
        const state = box.snapshot();
        // A box in hand returns to its staging slot when the save reloads, so
        // the reload can never leave a crate floating in mid air.
        state.carried = false;
        state.position = {
          x: box.spawnPosition.x,
          y: box.spawnPosition.y,
          z: box.spawnPosition.z,
        };
        return state;
      }),
    };
  }

  restore(state = {}) {
    this.packing = null;
    this.carried = null;
    this.modeTableId = null;
    this.carryElapsed = 0;
    this.carryLabel?.setText('');
    if (this.flyMesh) this.flyMesh.visible = false;
    for (const entry of state.boxes ?? []) {
      const box = this.byId.get(entry?.id);
      if (box) box.restore(entry);
    }
    // A restored box that was chilled goes back into the refrigerator's rack so
    // the fridge count, the visual stack and the take-from-fridge action agree.
    if (this.fridge) {
      for (const box of this.boxes) {
        if (!box.stored) continue;
        this.fridge.addBox(box);
        box.setPosition(box.spawnPosition.x, box.spawnPosition.y, box.spawnPosition.z);
      }
    }
    for (const cabinet of this.fridges) cabinet.setCarryContext(false);
    this.#syncBoxVisibility();
    this.refreshBadges(true);
    return this;
  }

  dispose() {
    for (const box of this.boxes) box.dispose();
    this.boxes.length = 0;
    this.byId.clear();
    this.byTable.clear();
    this.tableData.clear();
    this.interactables.length = 0;
    for (const material of Object.values(this.boxMaterials ?? {})) {
      material.dispose?.();
    }
    this.boxMaterials = null;
    this.flyMesh?.geometry.dispose();
    this.flyMesh?.material.dispose();
    this.flyMesh = null;
    this.badgeField?.dispose();
    this.badgeField = null;
    this.carryLabel?.dispose();
    this.carryLabel = null;
    this.root?.removeFromParent();
    this.root = null;
    this.carried = null;
    this.packing = null;
    this.modeTableId = null;
  }
}
