import * as THREE from 'three';

/**
 * Version 14 glass-door harvest refrigerator.
 *
 * The fridge references filled styrofoam boxes (never copies) so head counts and
 * weights stay in one place, while the glass front still lets the player see the
 * chilled stock. Shop reservations prevent removal during order collection.
 */
export class GlassRefrigerator {
  constructor({
    parent,
    materials,
    position = [0, 0, 0],
    rotationY = 0,
    capacity = 8,
    config = {},
  } = {}) {
    this.parent = parent;
    this.materials = materials;
    this.capacity = capacity;
    this.config = config;
    this.boxes = [];
    this.doorOpen = false;
    this.doorAngle = 0;
    this.targetAngle = 0;
    this.carryContext = false;
    this.carryingBox = null;
    this.group = null;
    this.doors = [];
    this.slotPositions = [];
    this.interactables = [];

    this.build({
      width: config.width ?? 0.92,
      depth: config.depth ?? 0.72,
      height: config.height ?? 2.02,
      position,
      rotationY,
    });
  }

  build({ width, depth, height, position, rotationY }) {
    const group = new THREE.Group();
    group.name = 'harvest-fridge';
    group.position.set(position[0], position[1] ?? 0, position[2] ?? 0);
    group.rotation.y = rotationY;
    this.group = group;
    this.parent?.add(group);

    const white = this.materials.pvcWhite;
    const t = 0.035;

    const back = new THREE.Mesh(new THREE.BoxGeometry(width, height, t), white);
    back.position.set(0, height / 2, -depth / 2 + t / 2);
    group.add(back);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(t, height, depth), white);
      wall.position.set(side * (width / 2 - t / 2), height / 2, 0);
      group.add(wall);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(width, t, depth), white);
    top.position.set(0, height - t / 2, 0);
    group.add(top);
    const base = new THREE.Mesh(new THREE.BoxGeometry(width, t, depth), white);
    base.position.set(0, t / 2, 0);
    group.add(base);

    const frameTop = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.09, 0.06),
      this.materials.steel,
    );
    frameTop.position.set(0, height - 0.045, depth / 2 - 0.03);
    group.add(frameTop);
    const frameBottom = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.16, 0.06),
      this.materials.steel,
    );
    frameBottom.position.set(0, 0.08, depth / 2 - 0.03);
    group.add(frameBottom);
    for (const side of [-1, 1]) {
      const stile = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, height, 0.06),
        this.materials.steel,
      );
      stile.position.set(side * (width / 2 - 0.02), height / 2, depth / 2 - 0.03);
      group.add(stile);
    }

    const led = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.16, 0.025, 0.05),
      this.materials.ledWhite,
    );
    led.position.set(0, height - 0.18, depth / 2 - 0.12);
    led.userData.sharedGeometry = false;
    group.add(led);

    this.light = new THREE.PointLight(0xdff2ff, 2.4, 2.4, 2);
    this.light.position.set(0, height - 0.35, depth / 2 - 0.28);
    group.add(this.light);

    const shelfCount = Math.max(2, Math.ceil(this.capacity / 2));
    const shelfGap = (height - 0.62) / shelfCount;
    for (let shelf = 0; shelf < shelfCount; shelf += 1) {
      const y = 0.3 + shelf * shelfGap;
      const pane = new THREE.Mesh(
        new THREE.BoxGeometry(width - 0.14, 0.012, depth - 0.16),
        this.materials.glass,
      );
      pane.name = 'fridge-shelf';
      pane.position.set(0, y, -0.02);
      group.add(pane);
      for (const side of [-1, 1]) {
        this.slotPositions.push(new THREE.Vector3(side * 0.2, y + 0.012, 0));
      }
    }

    const leafWidth = width / 2 - 0.035;
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * (width / 2 - 0.02), 0, depth / 2 - 0.02);
      const pane = new THREE.Mesh(
        new THREE.BoxGeometry(leafWidth, height - 0.24, 0.024),
        this.materials.glassDoor ?? this.materials.glass,
      );
      pane.position.set((-side * leafWidth) / 2, height / 2, 0.005);
      pivot.add(pane);
      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.52, 0.045),
        this.materials.aluminium,
      );
      handle.position.set(-side * (leafWidth - 0.07), height / 2, 0.045);
      pivot.add(handle);
      group.add(pivot);
      this.doors.push({ pivot, side });
    }

    this.boxRoot = new THREE.Group();
    this.boxRoot.name = 'fridge-boxes';
    group.add(this.boxRoot);

    this.hitProxy = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.12, height, 0.24),
      this.materials.hitProxy,
    );
    this.hitProxy.name = 'harvest-fridge-hit';
    this.hitProxy.position.set(0, height / 2, depth / 2 + 0.12);
    this.hitProxy.visible = false;
    group.add(this.hitProxy);

    this.info = {
      id: 'container-fridge',
      kind: 'cold-storage',
      category: 'Cold storage',
      title: 'Glass-door harvest fridge',
      description: '',
      interaction: 'fridge-inspect',
      interactionHint: 'Open fridge',
      specs: [],
    };
    this.hitProxy.userData.interactable = this.info;
    this.interactables.push({ object: this.hitProxy, data: this.info });
    this.refreshInfo();
  }


  get totalHeads() {
    return this.boxes.reduce((total, box) => total + (box.plantCount ?? 0), 0);
  }

  get totalWeightG() {
    return this.boxes.reduce((total, box) => total + (box.weightG ?? 0), 0);
  }

  get hasRoom() {
    return this.boxes.length < this.capacity;
  }

  addBox(box) {
    if (!box) return { ok: false, reason: 'No box to store' };
    if (!this.boxes.includes(box) && !this.hasRoom) {
      return { ok: false, reason: `Fridge full - ${this.capacity}/${this.capacity} boxes` };
    }
    if (!this.boxes.includes(box)) this.boxes.push(box);
    box.chilledAt ??= Date.now();
    box.stored = true;
    box.carried = false;
    this.createBoxVisual(box);
    this.refreshInfo();
    return { ok: true, box };
  }

  removeBox(box) {
    const index = this.boxes.indexOf(box);
    if (box.shopReserved) return { ok: false, reason: 'This box is reserved for a shop order' };
    if (index < 0) return { ok: false, reason: 'Box is not in the fridge' };
    this.boxes.splice(index, 1);
    if (box.view) {
      box.view.removeFromParent();
      box.view.traverse((node) => {
        if (node.isMesh) {
          node.geometry?.dispose?.();
          node.material?.dispose?.();
        }
      });
      box.view = null;
    }
    box.stored = false;
    box.chilledAt = null;
    this.boxes.forEach((storedBox, slot) => {
      const positions = storedBox.view?.userData.slotPositions;
      if (positions?.length) storedBox.view.position.copy(positions[slot % positions.length]);
    });
    this.refreshInfo();
    return { ok: true, box };
  }

  createBoxVisual(box) {
    if (!box || box.view) return box?.view ?? null;
    const slot = Math.max(0, this.boxes.indexOf(box)) % this.slotPositions.length;
    const position = this.slotPositions[slot] ?? new THREE.Vector3(0, 0.33, 0);
    const group = new THREE.Group();
    group.name = `fridge-box-${box.id ?? slot}`;
    group.userData.slotPositions = this.slotPositions;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.2, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xf2f4ec, roughness: 0.86 }),
    );
    body.position.y = 0.1;
    group.add(body);
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.37, 0.04, 0.41),
      new THREE.MeshStandardMaterial({ color: 0x3f7d68, roughness: 0.7 }),
    );
    band.position.y = 0.155;
    group.add(band);
    group.position.copy(position);
    this.boxRoot.add(group);
    box.view = group;
    return group;
  }

  toggleDoors(open = !this.doorOpen) {
    this.doorOpen = Boolean(open);
    this.targetAngle = this.doorOpen ? (this.config.doorOpenAngle ?? 1.95) : 0;
    this.refreshInfo();
    return this.doorOpen;
  }

  setCarryContext(carrying, box = null) {
    this.carryContext = Boolean(carrying);
    this.carryingBox = box;
    this.refreshInfo();
  }

  refreshInfo() {
    if (!this.info) return;
    const count = this.boxes.length;
    // A world click always opens the menu, regardless of stock or hands.
    this.info.interaction = 'fridge-inspect';
    this.info.interactionHint = `Fridge options - ${this.doorOpen ? 'open' : 'closed'}`;
    this.info.specs = [
      ['Boxes', `${count} / ${this.capacity}`],
      ['Heads', String(this.totalHeads)],
      ['Net weight', `${(this.totalWeightG / 1000).toFixed(2)} kg`],
      ['Door', this.doorOpen ? 'Open' : 'Closed'],
      ['Temperature', '3.5 °C'],
    ];
    this.info.description =
      count > 0
        ? `Chilled stock: ${count} styrofoam box${count === 1 ? '' : 'es'} holding ${this.totalHeads} harvested heads (${(this.totalWeightG / 1000).toFixed(2)} kg net).`
        : 'The fridge is empty. Carry a filled harvest box from an NFT table and store it here to keep the crop cold.';
  }

  describe() {
    return {
      ...this.info,
      specs: [...this.info.specs],
      boxes: this.boxes.map((box) => ({
        id: box.id,
        heads: box.plantCount,
        weightG: box.weightG,
      })),
    };
  }

  update(dt = 0) {
    this.doorAngle += (this.targetAngle - this.doorAngle) * Math.min(1, dt * 5.5);
    if (Math.abs(this.targetAngle - this.doorAngle) < 0.002) this.doorAngle = this.targetAngle;
    for (const door of this.doors) {
      // Swing each leaf away from the centre seam; mirrored signs keep both
      // doors from rotating through the cabinet when they open.
      door.pivot.rotation.y = door.side * this.doorAngle;
    }
  }

  dispose() {
    this.group?.removeFromParent();
    this.group?.traverse((node) => {
      if (node.isMesh && node.geometry && !node.userData.sharedGeometry) {
        node.geometry.dispose();
      }
    });
    this.group = null;
    this.boxes = [];
    this.doors = [];
    this.interactables.length = 0;
    this.info = null;
  }
}
