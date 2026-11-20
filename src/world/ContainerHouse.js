import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { GlassRefrigerator } from './GlassRefrigerator.js';
import { BillboardLabel } from './BillboardLabels.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Version 14 harvest house: an insulated 40 ft site container beside the
 * glasshouse with a personnel door, an awning window, a stainless packing bench
 * and a glass-door refrigerator that chills filled styrofoam boxes.
 *
 * The shell is static and batches with the rest of the site; the door leaf,
 * window sash and refrigerator are marked dynamic so they keep animating.
 */
export class ContainerHouse {
  constructor({
    scene,
    materials,
    collisionWorld = null,
    camera = null,
    layout = LAYOUT,
  } = {}) {
    this.scene = scene;
    this.materials = materials;
    this.collisionWorld = collisionWorld;
    this.camera = camera;
    this.spec = layout.container;
    this.harvestLayout = layout.harvest ?? {};
    this.group = null;
    this.shellGroup = null;
    this.doorPivot = null;
    this.doorOpen = false;
    this.doorAngle = 0;
    this.windowPivot = null;
    this.windowOpen = false;
    this.windowAngle = 0;
    this.fridge = null;
    this.interactables = [];
    this.doorProxy = null;
    this.windowProxy = null;
    this.doorCollider = null;
    this.fridgeLabel = null;
    this.signLabel = null;
    this.signSubLabel = null;
    this.doorInfo = null;
    this.windowInfo = null;
    this.benchInfo = null;
  }

  build() {
    const spec = this.spec;
    const [centreX, centreZ] = spec.centre;
    const halfW = spec.width / 2;
    const halfL = spec.length / 2;
    const t = spec.wallThickness;

    const group = new THREE.Group();
    group.name = spec.id;
    group.position.set(centreX, 0, centreZ);
    this.group = group;
    this.scene?.add(group);

    // Static shell gets its own group so the batch pass can collapse it.
    const shell = new THREE.Group();
    shell.name = `${spec.id}-shell`;
    shell.userData.batchScope = true;
    group.add(shell);
    this.shellGroup = shell;

    const steel = this.materials.steel;
    const dark = this.materials.steelDark;
    const floorY = spec.floorY;

    // Raised deck: containers stand on their corner castings.
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width, floorY, spec.length),
      this.materials.concreteFloor,
    );
    deck.position.y = floorY / 2;
    deck.receiveShadow = true;
    deck.castShadow = false;
    shell.add(deck);

    const skin = new THREE.MeshStandardMaterial({
      color: 0x8f9a9c,
      roughness: 0.62,
      metalness: 0.28,
    });
    skin.name = 'container-skin';
    this.skinMaterial = skin;

    const height = spec.height;
    const wallH = height - floorY;

    /** One box wall panel, sized explicitly so openings stay exact. */
    const panel = (width, panelHeight, x, y, z, depth = t) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, panelHeight, depth), skin);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      shell.add(mesh);
      return mesh;
    };

    // East (long) wall and north (end) wall are solid.
    panel(t, wallH, halfW - t / 2, floorY + wallH / 2, 0, spec.length);
    panel(spec.width, wallH, 0, floorY + wallH / 2, -halfL + t / 2);

    // South end wall: awning window opening, built as four real panels.
    const win = spec.window;
    const winTop = win.sillY + win.height;
    const southZ = halfL - t / 2;
    const sideWidth = halfW - win.width / 2;
    panel(sideWidth, wallH, -(halfW + win.width / 2) / 2, floorY + wallH / 2, southZ);
    panel(sideWidth, wallH, (halfW + win.width / 2) / 2, floorY + wallH / 2, southZ);
    panel(win.width, win.sillY - floorY, 0, (floorY + win.sillY) / 2, southZ);
    panel(win.width, height - winTop, 0, winTop + (height - winTop) / 2, southZ);

    // West (door) wall: personnel door opening at door.z, header above.
    const door = spec.door;
    const doorMinZ = door.z - door.width / 2;
    const doorMaxZ = door.z + door.width / 2;
    const doorTop = floorY + door.height;
    const westX = -halfW + t / 2;
    panel(t, wallH, westX, floorY + wallH / 2, (-halfL + doorMinZ) / 2, doorMinZ + halfL);
    panel(t, wallH, westX, floorY + wallH / 2, (doorMaxZ + halfL) / 2, halfL - doorMaxZ);
    panel(t, height - doorTop, westX, doorTop + (height - doorTop) / 2, door.z);

    // Roof slab with a small overhang.
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width + 0.1, t, spec.length + 0.1),
      skin,
    );
    roof.position.y = height + t / 2;
    roof.castShadow = true;
    roof.receiveShadow = true;
    shell.add(roof);

    this.#buildFrame(shell, { halfW, halfL, height, floorY, door, t, dark, steel });

    // Dynamic parts: door leaf and window sash.
    this.#buildDoor(group, { halfW, floorY, door, t, dark, steel });
    this.#buildWindow(group, { halfL, floorY, win, t, dark });
    this.#buildInterior(group, { halfW, halfL, floorY, dark, steel });
    this.#buildSignage(group, { halfW, halfL, height, door });

    this.#buildColliders({ centreX, centreZ, halfW, halfL, t, door, floorY });
    this.update(0);
    return this;
  }

  /** Packing bench, grading table and the glass-door chiller. */
  #buildInterior(group, { halfW, halfL, floorY }) {
    const stainless = this.materials.stainless;
    const dark = this.materials.steelDark;

    // Bench along the west wall, north of the door.
    const benchX = -halfW + 0.09 + 0.31;
    const benchZ = -1.8;
    const benchLength = 2.2;
    const benchDepth = 0.62;
    const benchTop = 0.92;
    const bench = new THREE.Group();
    bench.name = 'container-workbench';
    group.add(bench);

    const benchSurface = new THREE.Mesh(
      new THREE.BoxGeometry(benchDepth, 0.05, benchLength),
      stainless,
    );
    benchSurface.position.set(benchX, floorY + benchTop, benchZ);
    benchSurface.castShadow = true;
    benchSurface.receiveShadow = true;
    bench.add(benchSurface);

    const legGeometry = new THREE.BoxGeometry(0.05, benchTop - 0.05, 0.05);
    for (const dx of [-benchDepth / 2 + 0.05, benchDepth / 2 - 0.05]) {
      for (const dz of [-benchLength / 2 + 0.06, benchLength / 2 - 0.06]) {
        const leg = new THREE.Mesh(legGeometry, dark);
        leg.position.set(benchX + dx, floorY + (benchTop - 0.05) / 2, benchZ + dz);
        bench.add(leg);
      }
    }

    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(benchDepth - 0.06, 0.03, benchLength - 0.1),
      this.materials.aluminium,
    );
    shelf.position.set(benchX, floorY + 0.34, benchZ);
    bench.add(shelf);

    // Backboard with a knife strip and a row of hooks.
    const backboard = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.62, benchLength - 0.2),
      this.materials.aluminium,
    );
    backboard.position.set(-halfW + 0.15, floorY + 1.42, benchZ);
    bench.add(backboard);
    const stripGeometry = new THREE.CylinderGeometry(0.012, 0.012, benchLength - 0.36, 8);
    for (const y of [1.5, 1.66]) {
      const strip = new THREE.Mesh(stripGeometry, dark);
      strip.rotation.x = Math.PI / 2;
      strip.position.set(-halfW + 0.18, floorY + y, benchZ);
      bench.add(strip);
    }

    this.benchInfo = {
      id: 'container-workbench',
      kind: 'workbench',
      category: 'Harvest House',
      title: 'Grading bench',
      description:
        'Stainless grading bench with a lower shelf for empty boxes. Boxes are packed at the NFT table and finished here.',
      interaction: null,
      interactionHint: '',
      specs: [
        ['Length', `${benchLength.toFixed(1)} m`],
        ['Surface', 'Stainless steel'],
        ['Duty', 'Grading / trims'],
      ],
    };
    const benchProxy = new THREE.Mesh(
      new THREE.BoxGeometry(benchDepth, 1.0, benchLength),
      this.materials.hitProxy,
    );
    benchProxy.position.set(benchX, floorY + 0.5, benchZ);
    group.add(benchProxy);
    benchProxy.userData.interactable = this.benchInfo;
    this.interactables.push({ object: benchProxy, data: this.benchInfo });

    // Free-standing grading table under the window.
    const tableX = 0.12;
    const tableZ = 0.42;
    const table = new THREE.Group();
    table.name = 'container-grading-table';
    group.add(table);

    const tableTop = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.05, 0.7),
      stainless,
    );
    tableTop.position.set(tableX, floorY + 0.88, tableZ);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    table.add(tableTop);

    const tableLeg = new THREE.BoxGeometry(0.045, 0.83, 0.045);
    for (const dx of [-0.5, 0.5]) {
      for (const dz of [-0.29, 0.29]) {
        const leg = new THREE.Mesh(tableLeg, dark);
        leg.position.set(tableX + dx, floorY + 0.415, tableZ + dz);
        table.add(leg);
      }
    }

    // Bench scale with a green LED readout.
    const scaleBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.07, 0.3),
      this.materials.steel,
    );
    scaleBase.position.set(tableX - 0.24, floorY + 0.94, tableZ - 0.04);
    table.add(scaleBase);
    const scalePlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.015, 0.26),
      stainless,
    );
    scalePlate.position.set(tableX - 0.24, floorY + 0.985, tableZ - 0.04);
    table.add(scalePlate);
    const readout = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.05, 0.01),
      this.materials.ledGreen,
    );
    readout.position.set(tableX - 0.24, floorY + 0.96, tableZ + 0.115);
    table.add(readout);

    // An open box waiting to be filled.
    const openBox = new THREE.Group();
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.05, 0.62),
      new THREE.MeshStandardMaterial({ color: 0xf2f4ec, roughness: 0.88 }),
    );
    rim.position.set(tableX + 0.32, floorY + 0.93, tableZ + 0.02);
    openBox.add(rim);
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.02, 0.58),
      new THREE.MeshStandardMaterial({ color: 0xf7fbf0, roughness: 0.95 }),
    );
    bed.position.set(tableX + 0.32, floorY + 0.955, tableZ + 0.02);
    openBox.add(bed);
    table.add(openBox);

    // Chiller on the east wall.
    const fridgeSpec = this.spec.fridge;
    this.fridge = new GlassRefrigerator({
      parent: group,
      materials: this.materials,
      position: [fridgeSpec.offset[0], floorY, fridgeSpec.offset[1]],
      rotationY: -Math.PI / 2,
      capacity: fridgeSpec.capacity,
      config: {
        width: fridgeSpec.width,
        depth: fridgeSpec.depth,
        height: fridgeSpec.height,
      },
    });
    this.fridgeInteractables = this.fridge.interactables ?? [];
    for (const entry of this.fridgeInteractables) this.interactables.push(entry);

    // Rubber mat just inside the door.
    const mat = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.012, 1.3),
      this.materials.rubber,
    );
    mat.position.set(-halfW + 0.65, floorY + 0.006, 1.55);
    mat.receiveShadow = true;
    group.add(mat);
  }

  /** Outside signage over the door plus the floating chiller label. */
  #buildSignage(group, { halfW, height, door }) {
    const signY = this.spec.signage?.y ?? height - 0.2;
    this.signLabel = new BillboardLabel({
      parent: group,
      camera: this.camera,
      text: this.spec.signage?.title ?? this.spec.label,
      variant: 'store',
      width: 2.3,
      height: 0.34,
      position: { x: -halfW - 0.06, y: signY, z: door.z },
      renderOrder: 12,
    });
    this.signSubLabel = new BillboardLabel({
      parent: group,
      camera: this.camera,
      text: this.spec.signage?.subtitle ?? '',
      variant: 'muted',
      width: 2.1,
      height: 0.2,
      position: { x: -halfW - 0.06, y: signY - 0.32, z: door.z },
      renderOrder: 12,
    });

    const fridgeSpec = this.spec.fridge;
    this.fridgeLabel = new BillboardLabel({
      parent: group,
      camera: this.camera,
      text: `CHILL 3.5 \u00b0C - 0/${fridgeSpec.capacity}`,
      variant: 'store',
      width: 1.35,
      height: 0.26,
      position: {
        x: fridgeSpec.offset[0],
        y: fridgeSpec.height + 0.34,
        z: fridgeSpec.offset[1],
      },
      renderOrder: 13,
    });
  }

  /** Wall, furniture and door colliders plus the HUD footprint. */
  #buildColliders({ centreX, centreZ, halfW, halfL, t, door }) {
    const world = this.collisionWorld;
    if (!world) return;
    const wallLabel = `${this.spec.label} shell`;

    world.addBox({
      x: centreX + halfW - t / 2,
      z: centreZ,
      width: t + 0.06,
      depth: this.spec.length,
      label: wallLabel,
    });
    world.addBox({
      x: centreX,
      z: centreZ - halfL + t / 2,
      width: this.spec.width,
      depth: t + 0.06,
      label: wallLabel,
    });
    world.addBox({
      x: centreX,
      z: centreZ + halfL - t / 2,
      width: this.spec.width,
      depth: t + 0.06,
      label: wallLabel,
    });

    const doorMinZ = door.z - door.width / 2;
    const doorMaxZ = door.z + door.width / 2;
    const westX = centreX - halfW + t / 2;
    world.addBox({
      x: westX,
      z: centreZ + (-halfL + doorMinZ) / 2,
      width: t + 0.06,
      depth: doorMinZ + halfL,
      label: wallLabel,
    });
    world.addBox({
      x: westX,
      z: centreZ + (doorMaxZ + halfL) / 2,
      width: t + 0.06,
      depth: halfL - doorMaxZ,
      label: wallLabel,
    });

    // Doorway blocks movement only while the leaf is shut.
    this.doorCollider = world.addBox({
      x: westX,
      z: centreZ + door.z,
      width: t + 0.2,
      depth: door.width,
      label: `${this.spec.label} door`,
    });
    this.doorCollider.enabled = !this.doorOpen;

    // Bench, grading table and chiller stand inside the shell.
    world.addBox({
      x: centreX - halfW + 0.4,
      z: centreZ - 1.8,
      width: 0.66,
      depth: 2.2,
      label: 'Grading bench',
    });
    world.addBox({
      x: centreX + 0.12,
      z: centreZ + 0.42,
      width: 1.15,
      depth: 0.7,
      label: 'Grading table',
    });

    const fridgeSpec = this.spec.fridge;
    world.addBox({
      x: centreX + fridgeSpec.offset[0],
      z: centreZ + fridgeSpec.offset[1],
      width: fridgeSpec.depth + 0.06,
      depth: fridgeSpec.width + 0.06,
      label: 'Harvest fridge',
    });

    world.addFootprint({
      x: centreX,
      z: centreZ,
      width: this.spec.width,
      depth: this.spec.length,
      label: this.spec.label,
      zone: this.spec.zone ?? 'container-house',
      buildingId: this.spec.id,
    });
  }

  getInteractables() {
    return this.interactables;
  }

  /** Roots that keep animating and therefore skip the static batch. */
  getDynamicRoots() {
    const roots = [];
    if (this.doorPivot) roots.push(this.doorPivot);
    if (this.windowPivot) roots.push(this.windowPivot);
    if (this.fridge?.group) roots.push(this.fridge.group);
    // Billboard labels re-orient every frame, so they cannot be batched either.
    if (this.signLabel?.mesh) roots.push(this.signLabel.mesh);
    if (this.signSubLabel?.mesh) roots.push(this.signSubLabel.mesh);
    if (this.fridgeLabel?.mesh) roots.push(this.fridgeLabel.mesh);
    return roots;
  }

  toggleDoor(open = !this.doorOpen) {
    this.doorOpen = Boolean(open);
    if (this.doorCollider) this.doorCollider.enabled = !this.doorOpen;
    if (this.doorInfo) {
      this.doorInfo.interactionHint = this.doorOpen ? 'Close door' : 'Open door';
      this.doorInfo.specs = [
        ['Building', this.spec.label],
        ['State', this.doorOpen ? 'Open' : 'Closed'],
      ];
    }
    return this.doorOpen;
  }

  toggleWindow(open = !this.windowOpen) {
    this.windowOpen = Boolean(open);
    if (this.windowInfo) {
      this.windowInfo.interactionHint = this.windowOpen ? 'Close window' : 'Open window';
      this.windowInfo.specs = [
        ['Building', this.spec.label],
        ['State', this.windowOpen ? 'Open' : 'Closed'],
        ['Ventilation', this.windowOpen ? 'Venting' : 'Sealed'],
      ];
    }
    return this.windowOpen;
  }

  update(dt = 0, camera = this.camera) {
    const doorTarget = this.doorOpen ? (this.spec.door.openAngle ?? 1.82) : 0;
    this.doorAngle += (doorTarget - this.doorAngle) * Math.min(1, dt * 6);
    if (Math.abs(doorTarget - this.doorAngle) < 0.002) this.doorAngle = doorTarget;
    if (this.doorPivot) this.doorPivot.rotation.y = -this.doorAngle;

    const windowTarget = this.windowOpen ? (this.spec.window.openAngle ?? 0.95) : 0;
    this.windowAngle += (windowTarget - this.windowAngle) * Math.min(1, dt * 5);
    if (Math.abs(windowTarget - this.windowAngle) < 0.002) this.windowAngle = windowTarget;
    if (this.windowPivot) this.windowPivot.rotation.x = -this.windowAngle;

    this.fridge?.update(dt);

    if (this.fridgeLabel && this.fridge) {
      const stock = this.fridge.boxes?.length ?? 0;
      const capacity = this.fridge.capacity ?? this.spec.fridge.capacity;
      const heads = this.fridge.totalHeads ?? 0;
      const text = `CHILL 3.5 \u00b0C - ${stock}/${capacity} | ${heads} heads`;
      this.fridgeLabel.setText(text, 'store');
    }
    this.signLabel?.update(camera);
    this.signSubLabel?.update(camera);
    this.fridgeLabel?.update(camera);
  }

  snapshot() {
    return {
      doorOpen: this.doorOpen,
      windowOpen: this.windowOpen,
      doorAngle: this.doorAngle,
      windowAngle: this.windowAngle,
      fridge: {
        doorOpen: this.fridge?.doorOpen ?? false,
        boxIndices: (this.fridge?.boxes ?? []).map((box) => box.index ?? null),
      },
    };
  }

  restore(state) {
    if (!state) return this;
    this.toggleDoor(Boolean(state.doorOpen));
    this.toggleWindow(Boolean(state.windowOpen));
    this.doorAngle = Number.isFinite(state.doorAngle)
      ? state.doorAngle
      : this.doorOpen
        ? (this.spec.door.openAngle ?? 1.82)
        : 0;
    this.windowAngle = Number.isFinite(state.windowAngle)
      ? state.windowAngle
      : this.windowOpen
        ? (this.spec.window.openAngle ?? 0.95)
        : 0;
    if (this.fridge) this.fridge.toggleDoors(Boolean(state.fridge?.doorOpen));
    this.update(0);
    return this;
  }

  dispose() {
    this.signLabel?.dispose();
    this.signSubLabel?.dispose();
    this.fridgeLabel?.dispose();
    this.signLabel = null;
    this.signSubLabel = null;
    this.fridgeLabel = null;

    this.fridge?.dispose();
    this.fridge = null;

    this.group?.removeFromParent();
    this.group?.traverse((node) => {
      if (node.isMesh) node.geometry?.dispose?.();
    });
    this.group = null;
    this.shellGroup = null;
    this.doorPivot = null;
    this.windowPivot = null;
    this.doorCollider = null;
    this.skinMaterial?.dispose?.();
    this.skinMaterial = null;
    this.interactables.length = 0;
    this.fridgeInteractables = [];
    this.doorProxy = null;
    this.windowProxy = null;
  }

  #buildDoor(group, { halfW, floorY, door }) {
    const pivot = new THREE.Group();
    pivot.name = 'container-door-pivot';
    pivot.position.set(-halfW, floorY, door.z - door.width / 2);
    group.add(pivot);
    this.doorPivot = pivot;

    const leafWidth = door.width - 0.05;
    const leafHeight = door.height - 0.03;
    const leaf = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, leafHeight, leafWidth),
      this.materials.pvcWhite,
    );
    leaf.position.set(0, leafHeight / 2, leafWidth / 2 + 0.025);
    leaf.castShadow = true;
    pivot.add(leaf);

    const inset = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, leafHeight - 0.36, leafWidth - 0.22),
      this.materials.aluminium,
    );
    inset.position.set(0.04, leafHeight / 2, leafWidth / 2 + 0.025);
    pivot.add(inset);

    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.14, 10),
      this.materials.steel,
    );
    handle.rotation.z = Math.PI / 2;
    handle.position.set(-0.08, 1.02, leafWidth - 0.14);
    pivot.add(handle);

    const gasket = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, leafHeight - 0.02, 0.03),
      this.materials.rubber,
    );
    gasket.position.set(0, leafHeight / 2, 0.02);
    pivot.add(gasket);

    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, door.height, door.width),
      this.materials.hitProxy,
    );
    proxy.position.set(-halfW + 0.02, floorY + door.height / 2, door.z);
    proxy.name = 'container-door-proxy';
    group.add(proxy);
    this.doorProxy = proxy;

    this.doorInfo = {
      id: 'container-door',
      kind: 'door',
      category: 'Harvest House',
      title: 'Harvest House door',
      description:
        'Insulated personnel door into the harvest house. Inside are the packing bench, the table and the glass-door chiller.',
      interaction: 'container-door',
      interactionHint: 'Open door',
      specs: [
        ['Building', this.spec.label],
        ['State', 'Closed'],
      ],
    };
    proxy.userData.interactable = this.doorInfo;
    this.interactables.push({ object: proxy, data: this.doorInfo });
  }

  /** Awning window hinged at the head; the sash swings out over the apron. */
  #buildWindow(group, { halfL, floorY, win }) {
    const winTop = win.sillY + win.height;
    const pivot = new THREE.Group();
    pivot.name = 'container-window-pivot';
    pivot.position.set(0, winTop, halfL - 0.01);
    group.add(pivot);
    this.windowPivot = pivot;

    const sash = new THREE.Group();
    sash.position.set(0, -win.height / 2 - 0.03, 0);
    pivot.add(sash);

    const pane = new THREE.Mesh(
      new THREE.BoxGeometry(win.width - 0.1, win.height - 0.1, 0.012),
      this.materials.glass,
    );
    pane.name = 'container-window-glass';
    sash.add(pane);

    const frameGeometryH = new THREE.BoxGeometry(win.width, 0.05, 0.04);
    const frameGeometryV = new THREE.BoxGeometry(0.05, win.height, 0.04);
    for (const y of [win.height / 2 - 0.025, -win.height / 2 + 0.025]) {
      const bar = new THREE.Mesh(frameGeometryH, this.materials.aluminium);
      bar.position.y = y;
      sash.add(bar);
    }
    for (const x of [-win.width / 2 + 0.025, win.width / 2 - 0.025]) {
      const bar = new THREE.Mesh(frameGeometryV, this.materials.aluminium);
      bar.position.x = x;
      sash.add(bar);
    }

    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(win.width, win.height, 0.14),
      this.materials.hitProxy,
    );
    proxy.position.set(0, win.sillY + win.height / 2, halfL - 0.06);
    proxy.name = 'container-window-proxy';
    group.add(proxy);
    this.windowProxy = proxy;

    this.windowInfo = {
      id: 'container-window',
      kind: 'window',
      category: 'Harvest House',
      title: 'Awning window',
      description:
        'A hinged awning window over the packing table. Open it to vent warm, humid air while boxes are graded and weighed.',
      interaction: 'container-window',
      interactionHint: 'Open window',
      specs: [
        ['Building', this.spec.label],
        ['State', 'Closed'],
        ['Ventilation', 'Awning sash'],
      ],
    };
    proxy.userData.interactable = this.windowInfo;
    this.interactables.push({ object: proxy, data: this.windowInfo });
  }

  #buildFrame(shell, { halfW, halfL, height, floorY, door, t, dark, steel }) {
    const casting = new THREE.BoxGeometry(0.24, 0.14, 0.24);
    const postGeometry = new THREE.BoxGeometry(0.16, height - floorY, 0.16);
    const corners = [
      [-halfW + 0.09, -halfL + 0.09],
      [halfW - 0.09, -halfL + 0.09],
      [-halfW + 0.09, halfL - 0.09],
      [halfW - 0.09, halfL - 0.09],
    ];
    for (const [x, z] of corners) {
      for (const y of [floorY + 0.07, height - 0.07]) {
        const block = new THREE.Mesh(casting, dark);
        block.position.set(x, y, z);
        block.castShadow = true;
        shell.add(block);
      }
      const post = new THREE.Mesh(postGeometry, dark);
      post.position.set(x, floorY + (height - floorY) / 2, z);
      post.castShadow = true;
      shell.add(post);
    }

    // Corrugation ribs on both long walls, skipping the door opening.
    const ribGeometry = new THREE.BoxGeometry(0.05, height - floorY - 0.5, 0.07);
    const doorMinZ = door.z - door.width / 2 - 0.18;
    const doorMaxZ = door.z + door.width / 2 + 0.18;
    for (let z = -halfL + 0.42; z <= halfL - 0.42; z += 0.42) {
      const inDoorway = z > doorMinZ && z < doorMaxZ;
      if (!inDoorway) {
        const west = new THREE.Mesh(ribGeometry, this.skinMaterial);
        west.position.set(-halfW - 0.025, floorY + (height - floorY) / 2, z);
        shell.add(west);
      }
      const east = new THREE.Mesh(ribGeometry, this.skinMaterial);
      east.position.set(halfW + 0.025, floorY + (height - floorY) / 2, z);
      shell.add(east);
    }

    // Horizontal top and bottom rails on the long walls.
    const railGeometry = new THREE.BoxGeometry(0.07, 0.1, halfL * 2);
    for (const x of [-halfW - 0.02, halfW + 0.02]) {
      for (const y of [floorY + 0.12, height - 0.16]) {
        const rail = new THREE.Mesh(railGeometry, dark);
        rail.position.set(x, y, 0);
        shell.add(rail);
      }
    }

    // Door surround.
    const jambGeometry = new THREE.BoxGeometry(t + 0.06, door.height + 0.04, 0.09);
    for (const z of [door.z - door.width / 2 - 0.045, door.z + door.width / 2 + 0.045]) {
      const jamb = new THREE.Mesh(jambGeometry, dark);
      jamb.position.set(-halfW + t / 2 - 0.02, floorY + door.height / 2, z);
      jamb.castShadow = true;
      shell.add(jamb);
    }
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(t + 0.06, 0.09, door.width + 0.18),
      dark,
    );
    lintel.position.set(-halfW + t / 2 - 0.02, floorY + door.height + 0.045, door.z);
    shell.add(lintel);

    // Window surround on the south end.
    const win = this.spec.window;
    const winTop = win.sillY + win.height;
    const southZ = halfL - t / 2 + 0.02;
    const winFrame = [
      [win.width + 0.16, 0.08, 0, win.sillY - 0.04],
      [win.width + 0.16, 0.08, 0, winTop + 0.04],
      [0.08, win.height + 0.16, -win.width / 2 - 0.04, (win.sillY + winTop) / 2],
      [0.08, win.height + 0.16, win.width / 2 + 0.04, (win.sillY + winTop) / 2],
    ];
    for (const [width, panelHeight, x, y] of winFrame) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(width, panelHeight, 0.06), dark);
      bar.position.set(x, y, southZ);
      shell.add(bar);
    }
  }
}

