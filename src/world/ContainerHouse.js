import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { GlassRefrigerator } from './GlassRefrigerator.js';
import { createHumanFigure, animateHumanFigure, disposeHumanFigure, CUSTOMER_STYLES, SHOPKEEPER_STYLE } from './HumanFigure.js';

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
    layout = LAYOUT,
  } = {}) {
    this.scene = scene;
    this.materials = materials;
    this.collisionWorld = collisionWorld;
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
    this.fridge2 = null;
    this.extraFridges = [];
    this.customer = null;
    this.customers = [];
    this.customerGroup = null;
    this.shopAssistant = null;
    this.pickupCrate = null;
    this.pickupCrateHomePosition = null;
    this.interactables = [];
    this.doorProxy = null;
    this.windowProxy = null;
    this.doorCollider = null;
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
      const bottom = y - panelHeight / 2;
      const top = y + panelHeight / 2;
      const upper = spec.upperFloorY ?? height / 2;
      const windowBottom = upper + 0.5;
      const windowTop = upper + 1.5;
      const addSegment = (material, segmentBottom, segmentTop, castShadow = true) => {
        const h = segmentTop - segmentBottom;
        if (h < 0.015) return null;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, h, depth), material);
        mesh.position.set(x, (segmentBottom + segmentTop) / 2, z);
        mesh.castShadow = castShadow;
        mesh.receiveShadow = true;
        shell.add(mesh);
        return mesh;
      };
      if (top > windowBottom && bottom < windowTop) {
        addSegment(skin, bottom, Math.min(top, windowBottom));
        addSegment(this.materials.glass, Math.max(bottom, windowBottom), Math.min(top, windowTop), false);
        addSegment(skin, Math.max(bottom, windowTop), top);
      } else {
        addSegment(skin, bottom, top);
      }
      return null;
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
    this.#buildUpperFloor(group, { halfW, halfL, floorY, height, dark, steel });
    this.#buildCustomer(group, { halfL, height });

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

    // A second shop chiller shares the chilled inventory, so either cabinet can
    // be used to inspect and retrieve the farm's stored produce.
    this.fridge2 = null;
    // Three shop refrigerators share the north wall. The fourth old position
    // sat in the stair run, so it is intentionally removed.
    const wallLine = [[-2.25, -4.55], [-0.65, -4.55], [0.95, -4.55]];
    wallLine.forEach(([x, z], index) => {
      const cabinet = index === 0 ? this.fridge : new GlassRefrigerator({
        parent: group,
        materials: this.materials,
        position: [x, floorY, z],
        rotationY: 0,
        capacity: fridgeSpec.capacity,
        config: { width: 0.92, depth: 0.72, height: 2.02 },
      });
      if (index === 0) {
        cabinet.group.position.set(x, floorY, z);
        cabinet.group.rotation.y = 0;
        this.fridge2 = cabinet;
      } else if (index === 1) {
        this.fridge2 = cabinet;
      } else {
        this.extraFridges.push(cabinet);
      }
      cabinet.group.name = `shop-refrigerator-${index + 1}`;
      cabinet.boxes = this.fridge.boxes;
      cabinet.info.title = index === 0 ? 'Harvest refrigerator' : `Shop refrigerator ${index + 1}`;
      cabinet.info.id = `container-fridge-${index + 1}`;
      cabinet.refreshInfo();
      for (const entry of cabinet.interactables ?? []) this.interactables.push(entry);
    });

    // Rubber mat just inside the door.
    const mat = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.012, 1.3),
      this.materials.rubber,
    );
    mat.position.set(-halfW + 0.65, floorY + 0.006, 1.55);
    mat.receiveShadow = true;
    group.add(mat);

    const timber = this.materials.wood ?? this.materials.steelDark;
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.84, 0.72), timber);
    counter.position.set(0, floorY + 0.42, 4.18);
    group.add(counter);
    const counterTop = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.09, 0.8), this.materials.stainless);
    counterTop.position.set(0, floorY + 0.89, 4.18);
    group.add(counterTop);
    const register = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.26, 0.3), this.materials.steelDark);
    register.position.set(-0.72, floorY + 1.06, 3.78);
    group.add(register);
    const registerScreen = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.15, 0.02), this.materials.ledGreen);
    registerScreen.position.set(-0.72, floorY + 1.1, 3.615);
    group.add(registerScreen);
    for (const [x, color] of [[-0.65, 0x72a94f], [0.65, 0xa64f45]]) {
      const bin = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.42), this.materials.steelDark);
      bin.position.set(x, floorY + 1.02, 4.22);
      group.add(bin);
      const produce = new THREE.MeshStandardMaterial({ color, roughness: 0.84 });
      for (let i = 0; i < 4; i += 1) {
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 9, 7), produce);
        head.scale.set(1.15, 0.62, 1);
        head.position.set(x - 0.15 + (i % 2) * 0.3, floorY + 1.18, 4.11 + Math.floor(i / 2) * 0.18);
        group.add(head);
      }
    }
    // Small retail carton holds the exact one-to-four-head customer order.
    const pickupCrate = new THREE.Group();
    pickupCrate.name = 'green-farm-customer-pickup-crate';
    pickupCrate.position.set(0, floorY + 0.95, 4.4);
    pickupCrate.visible = false;
    group.add(pickupCrate);
    const crateFoam = new THREE.MeshStandardMaterial({ color: 0xb88e5c, roughness: 0.95 });
    const crateBase = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.055, 0.62), crateFoam);
    crateBase.position.y = 0.035;
    pickupCrate.add(crateBase);
    const crateWallMat = new THREE.MeshStandardMaterial({ color: 0xc8a475, roughness: 0.9 });
    const wallH = 0.2;
    const frontBack = new THREE.BoxGeometry(0.54, wallH, 0.045);
    for (const z of [-0.2875, 0.2875]) {
      const wall = new THREE.Mesh(frontBack, crateWallMat);
      wall.position.set(0, 0.055 + wallH / 2, z);
      pickupCrate.add(wall);
    }
    const ends = new THREE.BoxGeometry(0.045, wallH, 0.53);
    for (const x of [-0.2475, 0.2475]) {
      const wall = new THREE.Mesh(ends, crateWallMat);
      wall.position.set(x, 0.055 + wallH / 2, 0);
      pickupCrate.add(wall);
    }
    const crateBand = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.045, 0.026), this.materials.harvestBox?.band ?? this.materials.steelDark);
    crateBand.position.set(0, 0.15, 0.316);
    pickupCrate.add(crateBand);
    const leafGeometry = new THREE.SphereGeometry(0.105, 10, 7);
    this.pickupCrateLeafMaterials = new Map();
    for (const color of [
      0x4f873c, 0x6da64a, 0x83b853, 0x9bc96a,
      0x9d493e, 0xb86150, 0xc97963, 0xd58c72,
      0x477a3d, 0x5f9148, 0x729b53, 0x88ae61,
    ]) {
      this.pickupCrateLeafMaterials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    }
    const leafMats = [0x4f873c, 0x6da64a, 0x83b853, 0x9bc96a].map((color) =>
      this.pickupCrateLeafMaterials.get(color),
    );
    const leafHeads = [];
    this.pickupHeadGroups = [];
    for (const x of [-0.13, 0.13]) {
      for (const z of [-0.16, 0.16]) {
        const headGroup = new THREE.Group();
        pickupCrate.add(headGroup);
        this.pickupHeadGroups.push(headGroup);
        for (let layer = 0; layer < 3; layer += 1) {
          const count = layer === 0 ? 5 : 7;
          for (let leafIndex = 0; leafIndex < count; leafIndex += 1) {
            const angle = (leafIndex / count) * Math.PI * 2 + layer * 0.38;
            const leaf = new THREE.Mesh(leafGeometry, leafMats[(leafIndex + layer) % leafMats.length]);
            leaf.scale.set(1.3, 0.42, 0.82);
            leaf.position.set(
              x + Math.cos(angle) * (layer === 0 ? 0.015 : 0.055),
              0.16 + layer * 0.035,
              z + Math.sin(angle) * (layer === 0 ? 0.015 : 0.055),
            );
            leaf.rotation.y = -angle;
            headGroup.add(leaf);
            leafHeads.push(leaf);
          }
        }
        const heart = new THREE.Mesh(new THREE.SphereGeometry(0.058, 9, 7), leafMats[2]);
        heart.scale.set(1, 0.68, 1);
        heart.position.set(x, 0.25, z);
        headGroup.add(heart);
        leafHeads.push(heart);
      }
    }
    this.pickupCrate = pickupCrate;
    this.pickupCrateHomePosition = pickupCrate.position.clone();
    this.pickupCrateLeafHeads = leafHeads;
  }

  /** Second-floor bedroom, balcony and the two visible cooling units. */
  #buildUpperFloor(group, { halfW, halfL, floorY, height, dark, steel }) {
    const level = this.spec.upperFloorY ?? height / 2;
    const openingX = halfW - 1.05;
    const openingHalfWidth = 0.85;
    const openingMinX = openingX - openingHalfWidth;
    const openingMaxX = openingX + openingHalfWidth;
    const openingMinZ = -4.2;
    const openingMaxZ = -0.55;
    const floorMinX = -halfW + 0.09;
    const floorMaxX = halfW - 0.09;
    const floorMinZ = -halfL + 0.09;
    const floorMaxZ = halfL - 0.09;
    const floorPiece = (x0, x1, z0, z1) => {
      if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return;
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(x1 - x0, 0.16, z1 - z0), this.materials.concreteFloor,
      );
      slab.position.set((x0 + x1) / 2, level, (z0 + z1) / 2);
      slab.receiveShadow = true;
      group.add(slab);
    };
    // Four deck sections leave an actual stairwell hole through the upper slab.
    floorPiece(floorMinX, openingMinX, floorMinZ, floorMaxZ);
    floorPiece(openingMaxX, floorMaxX, floorMinZ, floorMaxZ);
    floorPiece(openingMinX, openingMaxX, floorMinZ, openingMinZ);
    floorPiece(openingMinX, openingMaxX, openingMaxZ, floorMaxZ);

    // Guard rails line both open edges of the stairwell.
    for (const x of [openingMinX, openingMaxX]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.07, openingMaxZ - openingMinZ), this.materials.steel,
      );
      rail.position.set(x, level + 0.9, (openingMinZ + openingMaxZ) / 2);
      group.add(rail);
      for (let z = openingMinZ; z <= openingMaxZ + 0.01; z += 0.42) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), this.materials.steel);
        post.position.set(x, level + 0.45, z);
        group.add(post);
      }
    }

    const wallMat = this.materials.pvcWhite;
    // Upper windows and trim make the second room legible from the yard.
    for (const [x, z, w, d] of [
      [-halfW + 0.03, 0, 0.08, this.spec.length - 0.2],
      [halfW - 0.03, 0, 0.08, this.spec.length - 0.2],
      [0, -halfL + 0.03, this.spec.width - 0.2, 0.08],
      [0, halfL - 0.03, this.spec.width - 0.2, 0.08],
    ]) {
      const sill = new THREE.Mesh(new THREE.BoxGeometry(w + (w < 0.2 ? 0.04 : 0), 0.06, d + (d < 0.2 ? 0.04 : 0)), steel);
      sill.position.set(x, level + 0.5, z);
      group.add(sill);
    }

    // Balcony with an open front view. Three rails and regular balusters keep
    // it visually safe while leaving the player's sightline clear.
    const balcony = new THREE.Group();
    balcony.name = 'green-farm-bedroom-balcony';
    group.add(balcony);
    const balconyZ = halfL + 0.62;
    const railMaterial = this.materials.steel;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(this.spec.width * 0.76, 0.07, 0.07), railMaterial);
    rail.position.set(0, level + 1.02, balconyZ);
    balcony.add(rail);
    const lowerRail = new THREE.Mesh(new THREE.BoxGeometry(this.spec.width * 0.76, 0.06, 0.06), railMaterial);
    lowerRail.position.set(0, level + 0.35, balconyZ);
    balcony.add(lowerRail);
    const postGeo = new THREE.BoxGeometry(0.055, 1.05, 0.055);
    for (let x = -this.spec.width * 0.38; x <= this.spec.width * 0.38 + 0.01; x += 0.42) {
      const post = new THREE.Mesh(postGeo, railMaterial);
      post.position.set(x, level + 0.68, balconyZ);
      balcony.add(post);
    }
    const balconyFloor = new THREE.Mesh(
      new THREE.BoxGeometry(this.spec.width * 0.82, 0.12, 1.25), this.materials.steelDark,
    );
    balconyFloor.position.set(0, level + 0.12, balconyZ - 0.22);
    balcony.add(balconyFloor);

    // A compact bedroom set: raised bed, headboard, pillow and blanket.
    const bed = new THREE.Group();
    bed.name = 'green-farm-upstairs-bed';
    bed.position.set(-0.6, level + 0.16, -0.9);
    group.add(bed);
    const timber = this.materials.wood ?? dark;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.28, 2.05), timber);
    frame.position.y = 0.14;
    bed.add(frame);
    const mattress = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 0.18, 1.98),
      new THREE.MeshStandardMaterial({ color: 0xf0eee4, roughness: 0.95 }),
    );
    mattress.position.y = 0.36;
    bed.add(mattress);
    const blanket = new THREE.Mesh(
      new THREE.BoxGeometry(1.16, 0.09, 1.25),
      new THREE.MeshStandardMaterial({ color: 0x648b83, roughness: 0.95 }),
    );
    blanket.position.set(0, 0.48, 0.34);
    bed.add(blanket);
    const pillow = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.12, 0.34),
      new THREE.MeshStandardMaterial({ color: 0xfffdf5, roughness: 0.98 }),
    );
    pillow.position.set(0, 0.49, -0.68);
    bed.add(pillow);
    const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.86, 0.12), timber);
    headboard.position.set(0, 0.55, -1.02);
    bed.add(headboard);

    const rug = new THREE.Mesh(
      new THREE.BoxGeometry(2.55, 0.035, 3.1),
      new THREE.MeshStandardMaterial({ color: 0x9a7864, roughness: 1 }),
    );
    rug.position.set(-0.6, level + 0.09, -0.85);
    group.add(rug);
    const nightstand = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.66, 0.48), timber);
    nightstand.position.set(-1.52, level + 0.48, -1.55);
    group.add(nightstand);
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.06, 10), this.materials.steel);
    lampBase.position.set(-1.52, level + 0.84, -1.55);
    group.add(lampBase);
    const lampShade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.21, 0.26, 10),
      new THREE.MeshStandardMaterial({ color: 0xe5d3aa, emissive: 0x8d6f39, emissiveIntensity: 0.2 }),
    );
    lampShade.position.set(-1.52, level + 1.0, -1.55);
    group.add(lampShade);
    const wardrobe = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.0, 0.72), timber);
    wardrobe.position.set(-0.75, level + 1.08, -4.2);
    group.add(wardrobe);
    for (const x of [-1.08, -0.42]) {
      const wardrobeDoor = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.83, 0.04), this.materials.pvcWhite);
      wardrobeDoor.position.set(x, level + 1.08, -3.82);
      group.add(wardrobeDoor);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 8), this.materials.steel);
      handle.position.set(x + 0.23, level + 1.08, -3.78);
      group.add(handle);
    }
    const ceilingLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.12, 12), this.materials.ledWhite);
    ceilingLamp.position.set(-0.2, height - 0.18, -0.7);
    group.add(ceilingLamp);
    const bedroomLight = new THREE.PointLight(0xffdfb0, 0.7, 5.5, 2);
    bedroomLight.position.set(-0.2, height - 0.42, -0.7);
    group.add(bedroomLight);

    // Compact interior stair flight up to the bedroom landing.
    for (let step = 0; step < 10; step += 1) {
      const tread = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.12, 0.42), timber);
      tread.position.set(halfW - 1.05, (step + 0.5) * 0.285, -4.2 + (step + 0.5) * 0.325);
      group.add(tread);
    }
    for (const side of [-1, 1]) {
      const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 3.45), timber);
      stringer.position.set(halfW - 1.05 + side * 0.57, 1.42, -2.57);
      stringer.rotation.x = -0.72;
      group.add(stringer);
    }

    // Visible external condensers and indoor AC cassettes on both floors.
    const acMat = this.materials.steel ?? steel;
    for (const y of [floorY + 1.25, level + 1.55]) {
      const indoor = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.24, 0.28), wallMat);
      indoor.position.set(halfW - 0.42, y, -0.2);
      group.add(indoor);
      const grille = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 0.03), dark);
      grille.position.set(halfW - 0.42, y - 0.07, -0.035);
      group.add(grille);
      const condenser = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.62, 0.4), acMat);
      condenser.position.set(halfW + 0.48, y - 0.28, -0.2);
      group.add(condenser);
      for (let slat = 0; slat < 5; slat += 1) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.025, 0.025), dark);
        line.position.set(halfW + 0.48, y - 0.47 + slat * 0.08, 0.015);
        group.add(line);
      }
    }

    // Place the bed interaction at the foot of the stair inside the shop. The
    // player can reach it through the real door even though movement stays on
    // the ground plane, while the bedroom and bed remain visibly upstairs.
    const sleepProxy = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 1.6, 1.2), this.materials.hitProxy,
    );
    sleepProxy.position.set(halfW - 1.05, floorY + 0.8, -halfL + 0.85);
    sleepProxy.name = 'green-farm-sleep-proxy';
    group.add(sleepProxy);
    const sleepInfo = {
      id: 'green-farm-bed', kind: 'bed', category: 'Green Farm home',
      title: 'Upstairs bedroom bed',
      description: 'Rest in the upstairs bedroom. Sleeping advances the farm clock by six hours and lets all crops grow on any crossed calendar day.',
      interaction: 'container-sleep', interactionHint: 'Sleep · skip 6 hours',
      specs: [['Room', 'Second floor'], ['Rest', '6 game hours']],
    };
    sleepProxy.userData.interactable = sleepInfo;
    this.interactables.push({ object: sleepProxy, data: sleepInfo });
  }

  #buildCustomer(group, { halfL }) {
    this.customerGroup = new THREE.Group();
    this.customerGroup.name = 'shop-customer-cast';
    group.add(this.customerGroup);
    this.customers = CUSTOMER_STYLES.map(style => {
      const visitor = createHumanFigure(style);
      visitor.name = 'customer-' + style.name.toLowerCase().replaceAll(' ', '-');
      visitor.position.set(0, 0, halfL + 1.2);
      visitor.visible = false;
      this.customerGroup.add(visitor);
      return visitor;
    });
    this.customer = this.customers[0];
    this.shopAssistant = createHumanFigure(SHOPKEEPER_STYLE);
    this.shopAssistant.name = 'farm-shop-assistant';
    this.shopAssistant.position.set(0, 0, 3.1);
    group.add(this.shopAssistant);
    const counterProxy = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.2, 0.8), this.materials.hitProxy);
    counterProxy.position.set(0, 0.65, 4.18);
    counterProxy.visible = false;
    group.add(counterProxy);
    const window = this.spec.window;
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(window.width + 0.18, window.height + 0.25, 0.24),
      this.materials.hitProxy,
    );
    proxy.position.set(0, window.sillY + window.height / 2, halfL + 0.14);
    proxy.name = 'green-farm-shop-window-proxy';
    group.add(proxy);
    this.shopWindowInfo = {
      id: 'green-farm-shop-window', kind: 'shop-counter', category: 'Green Farm shop',
      title: 'Farm shop display window',
      description: 'Manage automatic sales, opening and vegetable prices. The assistant collects, packs and serves orders from chilled stock.',
      interaction: 'shop-sell', interactionHint: 'Manage farm shop',
      specs: [['Customer', 'None'], ['Payment', 'Cash added to farm balance']],
    };
    counterProxy.userData.interactable = this.shopWindowInfo;
    this.interactables.push({ object: counterProxy, data: this.shopWindowInfo });
    proxy.userData.interactable = this.shopWindowInfo;
    this.interactables.push({ object: proxy, data: this.shopWindowInfo });
  }

  updateShopVisuals(shop, dt) {
    const order = shop.order;
    const assistant = this.shopAssistant;
    const variant = Math.abs(Math.floor(order?.customerVariant ?? 0)) % this.customers.length;
    const nextCustomer = this.customers[variant];
    if (nextCustomer !== this.customer) {
      this.customer.visible = false;
      this.customer = nextCustomer;
    }
    const customer = this.customer;
    if (!assistant || !customer) return;
    const stage = order?.stage;
    const duration = { arriving: 5, collecting: 7, returning: 7, packing: 3, handover: 1, leaving: 5 };
    const progress = order ? Math.min(1, order.elapsed / duration[stage]) : 0;
    const counter = V(0, 0, 3.1);
    const fridge = V(-0.65, 0, -3.55);
    assistant.position.copy(counter);
    assistant.rotation.y = 0;
    const walking = stage === 'collecting' || stage === 'returning';
    if (walking) {
      const towardsFridge = stage === 'collecting';
      assistant.position.lerpVectors(towardsFridge ? counter : fridge, towardsFridge ? fridge : counter, progress);
      assistant.rotation.y = towardsFridge ? Math.PI : 0;
    }
    const collectingAtFridge = stage === 'collecting' && progress > 0.82;
    if (collectingAtFridge && this.shopFridgeWasOpen === undefined) {
      this.shopFridgeWasOpen = this.fridge2.doorOpen;
      this.fridge2.toggleDoors(true);
    }
    if (this.shopFridgeWasOpen !== undefined && !collectingAtFridge) {
      this.fridge2.toggleDoors(this.shopFridgeWasOpen);
      this.shopFridgeWasOpen = undefined;
    }
    animateHumanFigure(assistant, dt, { walking });
    if (stage === 'packing' || stage === 'returning') {
      for (const arm of assistant.userData.figure.limbs.arms) {
        arm.shoulder.rotation.x = -0.65 + (stage === 'packing' ? Math.sin(order.elapsed * 6) * 0.12 : 0);
      }
    }
    const windowZ = this.spec.length / 2 + 0.85;
    customer.visible = Boolean(order);
    customer.position.set(0, 0, windowZ);
    customer.rotation.y = Math.PI;
    if (stage === 'arriving') customer.position.x = 5 * (1 - progress);
    if (stage === 'leaving') customer.position.x = -5 * progress;
    const customerWalking = stage === 'arriving' || stage === 'leaving';
    if (customerWalking) customer.rotation.y = -Math.PI / 2;
    animateHumanFigure(customer, dt, { walking: customerWalking, rainy: shop.climate.rainIntensity > 0.02 });
    if (stage === 'handover' || stage === 'leaving') {
      for (const arm of customer.userData.figure.limbs.arms) {
        arm.shoulder.rotation.x = -0.8;
        arm.elbow.rotation.x = -0.2;
      }
    }


    const packed = ['returning', 'packing', 'handover', 'leaving'].includes(stage);
    this.pickupCrate.visible = packed;
    this.pickupCrate.position.copy(this.pickupCrateHomePosition);
    this.pickupCrate.rotation.set(0, 0, 0);
    this.pickupCrate.scale.setScalar(order?.quantity <= 2 ? 0.8 : 1);
    for (const [index, head] of this.pickupHeadGroups.entries()) head.visible = index < (order?.quantity ?? 0);
    if (packed) {
      const palette = /red/i.test(order.cropKey) ? [0x9d493e, 0xb86150, 0xc97963, 0xd58c72] : [0x4f873c, 0x6da64a, 0x83b853, 0x9bc96a];
      for (const [index, leaf] of this.pickupCrateLeafHeads.entries()) {
        leaf.material = this.pickupCrateLeafMaterials.get(palette[index % palette.length]);
      }
      if (stage === 'returning') this.pickupCrate.position.copy(assistant.position).add(V(0, 0.9, 0.35));
      if (stage === 'packing') this.pickupCrate.rotation.y = Math.sin(order.elapsed * 4) * 0.035;
      const handoff = V(customer.position.x, 0.9 * customer.scale.y, windowZ - 0.36);
      if (stage === 'handover') {
        // Keep the entire carton above the sill until it clears the outside wall,
        // then lower it into the customer's hands (including shorter customers).
        const throughWindow = handoff.clone();
        throughWindow.y = Math.max(this.pickupCrateHomePosition.y, this.spec.window.sillY + 0.1);
        if (progress < 0.8) this.pickupCrate.position.lerp(throughWindow, progress / 0.8);
        else this.pickupCrate.position.lerpVectors(throughWindow, handoff, (progress - 0.8) / 0.2);
      }
      if (stage === 'leaving') {
        this.pickupCrate.position.copy(customer.position).add(V(-0.35, 0.9 * customer.scale.y, 0));
        this.pickupCrate.rotation.y = -Math.PI / 2;
      }
    }
    if (order) this.toggleWindow(true);
    this.shopWindowInfo.specs = [
      ['Shop', shop.status()], ['Orders today', String(shop.sales)],
      ['Revenue today', 'S$' + (shop.revenueCents / 100).toFixed(2)],
    ];
  }

  applyPlayerElevation(player) {
    if (!player) return;
    const [cx, cz] = this.spec.centre;
    const x = player.position.x - cx;
    const z = player.position.z - cz;
    const inside = Math.abs(x) <= this.spec.width / 2 - 0.25 && Math.abs(z) <= this.spec.length / 2 - 0.25;
    const stairX = Math.abs(x - (this.spec.width / 2 - 1.05)) <= 0.9;
    const onStairs = inside && stairX && z >= -4.2 && z <= -0.95;
    const level = this.spec.upperFloorY ?? 2.85;
    if (onStairs) {
      player.groundY = Math.max(0, Math.min(level, ((z + 4.2) / 3.25) * level));
      if (z > -1.1 && player.groundY > level - 0.15) player.houseFloor = true;
      if (z < -4.0 && player.groundY < 0.15) player.houseFloor = false;
    } else if (player.houseFloor && inside) {
      player.groundY = level;
    } else {
      player.groundY = 0.005;
      if (!inside) player.houseFloor = false;
    }
    player.syncCamera();
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

    for (const xOffset of [-2.25, -0.65, 0.95]) {
      world.addBox({
        x: centreX + xOffset, z: centreZ - 4.55,
        width: 0.98, depth: 0.78, label: 'Shop refrigerator',
      });
    }

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
    if (this.fridge2?.group) roots.push(this.fridge2.group);
    for (const fridge of this.extraFridges) if (fridge?.group) roots.push(fridge.group);
    // The buyer and the produce box move during pickup, so keep their full
    // hierarchies out of the static mesh batch.
    if (this.customerGroup) roots.push(this.customerGroup);
    if (this.shopAssistant) roots.push(this.shopAssistant);
    if (this.pickupCrate) roots.push(this.pickupCrate);
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

  update(dt = 0) {
    const doorTarget = this.doorOpen ? (this.spec.door.openAngle ?? 1.82) : 0;
    this.doorAngle += (doorTarget - this.doorAngle) * Math.min(1, dt * 6);
    if (Math.abs(doorTarget - this.doorAngle) < 0.002) this.doorAngle = doorTarget;
    if (this.doorPivot) this.doorPivot.rotation.y = -this.doorAngle;

    const windowTarget = this.windowOpen ? (this.spec.window.openAngle ?? 0.95) : 0;
    this.windowAngle += (windowTarget - this.windowAngle) * Math.min(1, dt * 5);
    if (Math.abs(windowTarget - this.windowAngle) < 0.002) this.windowAngle = windowTarget;
    if (this.windowPivot) this.windowPivot.rotation.x = -this.windowAngle;

    this.fridge?.update(dt);
    this.fridge2?.update(dt);
    for (const fridge of this.extraFridges) fridge?.update(dt);
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
    for (const customer of this.customers) disposeHumanFigure(customer);
    disposeHumanFigure(this.shopAssistant);
    this.customers = [];
    this.customer = null;
    this.shopAssistant = null;

    this.fridge?.dispose();
    this.fridge = null;
    this.fridge2?.dispose();
    this.fridge2 = null;
    for (const fridge of this.extraFridges) fridge?.dispose();
    this.extraFridges.length = 0;

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

