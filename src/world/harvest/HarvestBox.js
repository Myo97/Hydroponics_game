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

function createCurlyLeafGeometry() {
  const rows = 7;
  const columns = 9;
  const positions = [];
  const indices = [];
  for (let row = 0; row <= rows; row += 1) {
    const t = row / rows;
    const halfWidth = Math.pow(Math.sin(Math.PI * t), 0.72);
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns * 2 - 1;
      const edgeWave = 1 + 0.12 * Math.sin(column * 2.4 + row * 1.8);
      positions.push(
        u * halfWidth * edgeWave,
        0.16 * Math.sin(Math.PI * t) * (1 - Math.abs(u)) + 0.055 * Math.sin(column * 2.1 + row * 1.7),
        t,
      );
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function halton(index, base) {
  let result = 0;
  let fraction = 1 / base;
  let value = index;
  while (value > 0) {
    result += fraction * (value % base);
    value = Math.floor(value / base);
    fraction /= base;
  }
  return result;
}

/**
 * Version 14 styrofoam harvest box.
 *
 * One box holds a single two-gully pass of a table (80 heads). The box is a
 * physical prop: it can be filled, inspected, carried and set down around the
 * glasshouse. Contents stay aggregated per crop so the save file does not grow
 * with the head count.
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

    // Open-top insulated shipping crate: a thick foam floor and four separate
    // walls leave a real cavity for the harvested crop to sit in.
    const base = new THREE.Mesh(new THREE.BoxGeometry(width, 0.055, depth), this.foam);
    base.position.y = 0.0275;
    group.add(base);
    const wallHeight = height - 0.055;
    const wallGeometry = new THREE.BoxGeometry(width, wallHeight, 0.055);
    const frontWall = new THREE.Mesh(wallGeometry, this.foam);
    frontWall.position.set(0, 0.055 + wallHeight / 2, depth / 2 - 0.0275);
    group.add(frontWall);
    const backWall = new THREE.Mesh(wallGeometry, this.foam);
    backWall.position.set(0, 0.055 + wallHeight / 2, -depth / 2 + 0.0275);
    group.add(backWall);
    const sideGeometry = new THREE.BoxGeometry(0.055, wallHeight, depth - 0.1);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(sideGeometry, this.foam);
      wall.position.set(side * (width / 2 - 0.0275), 0.055 + wallHeight / 2, 0);
      group.add(wall);
    }
    const inner = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.075, 0.012, depth - 0.075), this.innerMaterial,
    );
    inner.position.y = 0.057;
    group.add(inner);

    const band = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.012, 0.036, 0.026),
      this.bandMaterial,
    );
    band.position.set(0, height * 0.62, depth / 2 + 0.002);
    group.add(band);

    // The old produce block stays hidden; the visible contents are loose leaves.
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
    this.produce.visible = false;
    group.add(this.produce);

    this.leafMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
    this.leafGeometry = createCurlyLeafGeometry();
    this.produceLeaves = new THREE.InstancedMesh(this.leafGeometry, this.leafMaterial, 240);
    this.produceLeaves.name = 'harvest-box-packed-lettuce';
    this.produceLeaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.produceLeaves.frustumCulled = false;
    group.add(this.produceLeaves);
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
    this.group.visible = spawned;
    this.refresh();
    return this;
  }

  /**
   * A hidden box must never be pickable, otherwise the aisle would be full of
   * invisible interaction proxies. Layer 0 is what the raycaster tests.
   */
  #syncPickable() {
    const pickable = this.spawned && !this.carried && this.group.visible;
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
    const key = this.cropKey ?? Array.from(this.lots.keys())[0] ?? '';
    this.produceMaterial.color.setHex(cropTint(key));
    const leafPalette = /red/i.test(key)
      ? [0x6f873f, 0x84964a, 0x9e5946, 0xb7664c, 0x748a42]
      : /dark|oak/i.test(key)
        ? [0x4c783e, 0x5c8b45, 0x6d9848, 0x47743b, 0x7a9d50]
        : [0x5f913f, 0x70a447, 0x82b34f, 0x4f823b, 0x94bd5d];
    const leafCount = this.isEmpty ? 0 : Math.min(240, Math.max(28, Math.ceil(ratio * 240)));
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    let seed = 0;
    for (const char of this.id) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    for (let index = 0; index < 240; index += 1) {
      if (index < leafCount) {
        const pointIndex = index + 1 + seed % 977;
        const x = (halton(pointIndex, 2) - 0.5) * (this.width - 0.22);
        const z = (halton(pointIndex, 3) - 0.5) * (this.depth - 0.32);
        const angle = halton(pointIndex, 5) * Math.PI * 2;
        const tilt = (halton(pointIndex, 7) - 0.5) * 0.9;
        const layer = Math.floor(index / Math.max(1, leafCount / 4));
        position.set(x, this.height - 0.12 + layer * 0.027 + halton(pointIndex, 11) * 0.02, z);
        rotation.setFromEuler(new THREE.Euler(tilt, angle, (halton(pointIndex, 13) - 0.5) * 0.7));
        scale.set(
          0.035 + halton(pointIndex, 17) * 0.02,
          0.012 + halton(pointIndex, 19) * 0.01,
          0.07 + halton(pointIndex, 23) * 0.04,
        );
        this.produceLeaves.setColorAt(index, new THREE.Color(leafPalette[Math.floor(halton(pointIndex, 29) * leafPalette.length)]));
      } else {
        position.set(0, 0, 0);
        rotation.identity();
        scale.set(0, 0, 0);
      }
      matrix.compose(position, rotation, scale);
      this.produceLeaves.setMatrixAt(index, matrix);
    }
    this.produceLeaves.instanceMatrix.needsUpdate = true;
    if (this.produceLeaves.instanceColor) this.produceLeaves.instanceColor.needsUpdate = true;
    this.produceLeaves.count = 240;

    const status = this.carried
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
      ? 'Carrying - set it down'
      : this.isEmpty
        ? 'Inspect empty box'
        : `Pick up box (${this.weightKg.toFixed(1)} kg)`;
    this.data.description = this.isEmpty
      ? 'An empty styrofoam box staged beside its NFT table. Aim at the table and interact to fill it one pair of gullies at a time.'
      : `Packed with ${this.plantCount} harvested heads from two gullies. Carry it clear of the walkway or set it down with G / DROP.`;
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

  setPosition(x, y, z) {
    this.group.position.set(x, y, z);
  }

  setVisible(visible) {
    this.group.visible = Boolean(visible);
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
    this.carried = false;
    this.spawned = Boolean(state.spawned) || this.plantCount > 0;
    this.group.position.set(this.spawnPosition.x, this.spawnPosition.y, this.spawnPosition.z);
    if (state.position) {
      this.group.position.set(state.position.x, state.position.y ?? 0.02, state.position.z);
      this.spawnPosition.copy(this.group.position);
    }
    this.group.visible = this.spawned;
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
    this.leafMaterial.dispose();
  }
}
