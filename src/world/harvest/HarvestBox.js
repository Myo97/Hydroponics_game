import * as THREE from 'three';

const CROP_TINTS = {
  green: 0x86c46a,
  red: 0xb4544a,
  dark: 0x5f9a52,
};

function cropTint(cropKey = '') {
  if (/red/i.test(cropKey)) return CROP_TINTS.red;
  if (/dark|oak/i.test(cropKey)) return CROP_TINTS.dark;
  return CROP_TINTS.green;
}

/**
 * Version 14 styrofoam harvest box.
 *
 * One box holds a single two-gully pass of a table (80 heads). The box is a
 * physical prop: it can be filled, inspected, carried, set down and stored in
 * the harvest-house fridge. Contents stay aggregated per crop so the save file
 * and the fridge readout do not grow with the head count.
 *
 * Boxes carry no canvas of their own - the harvest controller draws one shared
 * carry tag - so a full farm of staged boxes still costs only a few textures.
 */
export class HarvestBox {
  constructor({
    id,
    tableId = null,
    index,
    position = [0, 0, 0],
    materials,
    capacity = 80,
    tareWeightG = 380,
    boxConfig = {},
    parent = null,
  }) {
    this.id = id;
    this.tableId = tableId;
    this.index = index;
    this.capacity = capacity;
    this.tareWeightG = tareWeightG;
    this.config = boxConfig;
    this.materials = materials;
    this.plantCount = 0;
    this.weightG = 0;
    this.lots = new Map();
    this.carried = false;
    this.stored = false;
    this.cropKey = null;
    this.cropName = null;
    this.spawned = false;

    const width = boxConfig.width ?? 0.44;
    const depth = boxConfig.depth ?? 0.62;
    const height = boxConfig.height ?? 0.26;

    const group = new THREE.Group();
    group.name = id;
    group.position.set(position[0], position[1] ?? 0.02, position[2] ?? 0);
    group.visible = false;
    this.group = group;
    this.spawnPosition = new THREE.Vector3(
      position[0],
      position[1] ?? 0.02,
      position[2] ?? 0,
    );
    parent?.add(group);

    // Shell materials are shared by every box (one set for the whole farm);
    // only the produce block needs its own colour so crops stay independent.
    const shared = materials?.harvestBox ?? null;
    this.ownedMaterials = [];
    const own = (material) => {
      this.ownedMaterials.push(material);
      return material;
    };
    this.foam = shared?.foam ?? own(
      new THREE.MeshStandardMaterial({
        color: 0xf3f4ee,
        roughness: 0.94,
        metalness: 0,
      }),
    );
    this.foam.name = 'styrofoam';
    this.innerMaterial = shared?.inner ?? own(
      new THREE.MeshStandardMaterial({
        color: 0xd6dad0,
        roughness: 0.98,
        metalness: 0,
      }),
    );
    this.bandMaterial = shared?.band ?? own(
      new THREE.MeshStandardMaterial({
        color: 0x3f7d68,
        roughness: 0.72,
      }),
    );

    const shell = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), this.foam);
    shell.position.y = height / 2;
    group.add(shell);

    // Dark rim inset reads as an open tray without modelling four walls.
    const recess = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.05, 0.012, depth - 0.05),
      this.innerMaterial,
    );
    recess.position.y = height - 0.012;
    group.add(recess);

    const band = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.012, 0.036, 0.026),
      this.bandMaterial,
    );
    band.position.set(0, height * 0.62, depth / 2 + 0.002);
    group.add(band);

    // Produce volume: one block scaled by fill ratio keeps a full box cheap.
    this.produceMaterial = new THREE.MeshStandardMaterial({
      color: CROP_TINTS.green,
      roughness: 0.82,
      metalness: 0,
    });
    this.produce = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.07, 1, depth - 0.07),
      this.produceMaterial,
    );
    this.produce.name = 'harvest-box-produce';
    this.produce.scale.y = 0.001;
    this.produce.position.y = height;
    group.add(this.produce);

    this.height = height;
    this.width = width;
    this.depth = depth;

    this.hitProxy = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.08, height + 0.12, depth + 0.08),
      materials?.hitProxy ?? this.foam,
    );
    this.hitProxy.name = `${id}-hit`;
    this.hitProxy.position.set(0, (height + 0.12) / 2, 0);
    this.hitProxy.visible = false;
    group.add(this.hitProxy);

    this.data = {
      id,
      kind: 'harvest-box',
      category: 'Harvest - packed produce',
      title: `Styrofoam box ${String(index + 1).padStart(2, '0')}`,
      interaction: 'harvest-box-inspect',
      interactionHint: 'Inspect box',
      description: '',
      specs: [],
      boxId: id,
      boxIndex: index,
      tableId,
    };
    this.hitProxy.userData.interactable = this.data;

    this.refresh();
  }


  get isFull() {
    return this.plantCount >= this.capacity;
  }

  get isEmpty() {
    return this.plantCount === 0;
  }

  get grossWeightG() {
    return this.weightG + this.tareWeightG;
  }

  get fillRatio() {
    return Math.min(1, this.plantCount / Math.max(1, this.capacity));
  }

  get weightKg() {
    return this.grossWeightG / 1000;
  }

  get cropSummary() {
    return Array.from(this.lots.values(), (lot) => ({
      cropKey: lot.cropKey,
      cropName: lot.cropName,
      heads: lot.heads,
      weightG: lot.weightG,
    }));
  }

  get summary() {
    return {
      id: this.id,
      kind: 'harvest-box',
      index: this.index,
      plantCount: this.plantCount,
      capacity: this.capacity,
      weightG: this.weightG,
      grossWeightG: this.grossWeightG,
      weightKg: this.weightKg,
      crops: this.cropSummary,
    };
  }

  /** Boxes are built up front but only drawn once the table needs them. */
  setSpawned(spawned = true) {
    if (spawned && !this.spawned) this.group.position.copy(this.spawnPosition);
    this.spawned = spawned;
    this.group.visible = spawned && !this.stored;
    this.refresh();
    return this;
  }

  /**
   * A hidden box must never be pickable, otherwise the aisle would be full of
   * invisible interaction proxies. Layer 0 is what the raycaster tests.
   */
  #syncPickable() {
    const pickable = this.spawned && !this.stored && !this.carried && this.group.visible;
    if (pickable) this.hitProxy.layers.enable(0);
    else this.hitProxy.layers.disable(0);
  }

  addHead({ cropKey = 'green-coral', cropName = 'Green Coral', weightG = 0 } = {}) {
    if (this.isFull) return { ok: false, reason: 'Box is full' };
    this.setSpawned(true);
    const lot = this.lots.get(cropKey) ?? {
      cropKey,
      cropName,
      heads: 0,
      weightG: 0,
    };
    lot.heads += 1;
    lot.weightG += weightG;
    this.lots.set(cropKey, lot);
    this.plantCount += 1;
    this.weightG += weightG;
    this.cropKey ??= cropKey;
    this.cropName ??= cropName;
    this.refresh();
    return { ok: true, lot };
  }

  refresh() {
    const ratio = this.fillRatio;
    const visibleHeight = Math.max(0.001, (this.height - 0.05) * ratio);
    this.produce.scale.y = visibleHeight;
    this.produce.position.y = this.height - 0.012 + visibleHeight / 2;
    this.produce.visible = ratio > 0.005;
    this.produceMaterial.color.setHex(
      cropTint(this.cropKey ?? Array.from(this.lots.keys())[0] ?? ''),
    );

    const status = this.stored
      ? 'chilled'
      : this.carried
        ? 'carried'
        : this.isEmpty
          ? 'empty'
          : this.isFull
            ? 'full'
            : 'packing';
    this.data.title = `Styrofoam box ${String(this.index + 1).padStart(2, '0')} - ${status}`;
    this.data.interaction = this.carried
      ? 'harvest-box-carried'
      : this.isEmpty
        ? 'harvest-box-inspect'
        : 'harvest-carry-box';
    this.data.interactionHint = this.carried
      ? 'Carrying - set down or chill'
      : this.isEmpty
        ? 'Inspect empty box'
        : `Pick up box (${this.weightKg.toFixed(1)} kg)`;
    this.data.description = this.stored
      ? 'A chilled styrofoam box stored in the harvest-house refrigerator.'
      : this.isEmpty
        ? 'An empty styrofoam box staged beside its NFT table. Aim at the table and interact to fill it one pair of gullies at a time.'
        : `Packed with ${this.plantCount} harvested heads from two gullies. Carry it to the harvest house and store it in the glass-door fridge.`;
    this.data.specs = [
      ['Box', `${String(this.index + 1).padStart(2, '0')} of 04`],
      ['Fill', `${this.plantCount} / ${this.capacity} heads`],
      ['Crops', this.cropSummary.map((lot) => `${lot.cropName} ${lot.heads}`).join(' · ') || 'Empty'],
      ['Net produce', `${(this.weightG / 1000).toFixed(2)} kg`],
      ['Tare', `${(this.tareWeightG / 1000).toFixed(2)} kg`],
      ['Gross weight', `${this.weightKg.toFixed(2)} kg`],
      ['Status', status],
    ];
    this.#syncPickable();
  }


  /** Interaction record plus a live copy of the contents for the inspect panel. */
  describe() {
    this.refresh();
    return {
      ...this.data,
      specs: [...this.data.specs],
      crops: this.cropSummary,
    };
  }

  setCarried(carried) {
    this.carried = Boolean(carried);
    this.refresh();
  }

  setStored(stored) {
    this.stored = Boolean(stored);
    this.group.visible = !this.stored && this.spawned;
    this.refresh();
  }

  setPosition(x, y, z) {
    this.group.position.set(x, y, z);
  }

  setVisible(visible) {
    this.group.visible = Boolean(visible) && !this.stored;
    this.#syncPickable();
  }

  snapshot() {
    return {
      id: this.id,
      tableId: this.tableId,
      index: this.index,
      plantCount: this.plantCount,
      weightG: this.weightG,
      lots: this.cropSummary,
      carried: false,
      stored: this.stored,
      spawned: this.spawned,
      position: {
        x: this.group.position.x,
        y: this.group.position.y,
        z: this.group.position.z,
      },
    };
  }

  restore(state = {}) {
    this.plantCount = 0;
    this.weightG = 0;
    this.lots.clear();
    this.cropKey = null;
    this.cropName = null;
    for (const lot of state.lots ?? []) {
      if (!lot?.heads) continue;
      const cropKey = lot.cropKey ?? lot.cropName ?? 'crop';
      this.lots.set(cropKey, {
        cropKey,
        cropName: lot.cropName ?? 'Crop',
        heads: lot.heads,
        weightG: lot.weightG ?? 0,
      });
      this.plantCount += lot.heads;
      this.weightG += lot.weightG ?? 0;
      this.cropKey ??= cropKey;
      this.cropName ??= lot.cropName ?? 'Crop';
    }
    this.stored = Boolean(state.stored);
    this.carried = false;
    this.spawned = Boolean(state.spawned) || this.plantCount > 0 || this.stored;
    this.group.position.set(this.spawnPosition.x, this.spawnPosition.y, this.spawnPosition.z);
    if (state.position) {
      this.group.position.set(state.position.x, state.position.y ?? 0.02, state.position.z);
      this.spawnPosition.copy(this.group.position);
    }
    this.group.visible = this.spawned && !this.stored;
    this.refresh();
    return this;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((node) => {
      if (node.isMesh) node.geometry?.dispose?.();
    });
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedMaterials.length = 0;
    this.produceMaterial.dispose();
  }
}
