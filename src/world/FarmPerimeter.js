import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { BillboardLabel } from './BillboardLabels.js';

const GROUND_Y = 0.005;

/**
 * Version 14 farm perimeter.
 *
 * Closes the site with a galvanised weld-mesh fence, a two-leaf vehicle gate at
 * the south yard and a low-poly city block beyond the road. The fence line also
 * carries the player clamp: every run registers a collider and the gateway
 * collider is disabled only while the leaves are open.
 *
 * Fence posts, vertical wires and lane markings are InstancedMesh, the long
 * rails and the city are plain meshes so the static batch pass can collapse
 * them; only the gate leaves and the billboard signage stay dynamic.
 */
export class FarmPerimeter {
  constructor({ scene, materials, collisionWorld = null, camera = null, layout = LAYOUT } = {}) {
    this.scene = scene;
    this.materials = materials;
    this.collisionWorld = collisionWorld;
    this.camera = camera;
    this.spec = layout.farm ?? {};
    this.bounds = this.spec.bounds ?? { minX: -24, maxX: 24, minZ: -25, maxZ: 46 };
    this.fence = this.spec.fence ?? { height: 2.35, postSpacing: 2.4, thickness: 0.1 };
    this.gate = this.spec.gate ?? {
      width: 4.6,
      height: 2.15,
      leafCount: 2,
      openAngle: 1.55,
      postSize: 0.28,
    };
    this.city = this.spec.city ?? { roadZ: 50, roadWidth: 9, sidewalkWidth: 3, buildings: [] };
    this.signage = this.spec.signage ?? {
      title: 'GREENHOUSE 14',
      subtitle: 'HYDROPONIC FARM',
      y: 3.1,
    };

    this.group = null;
    this.cityGroup = null;
    this.fenceGroup = null;
    this.gateRoot = null;
    this.gateProxy = null;
    this.leaves = [];
    this.gateOpen = false;
    this.gateAngle = 0;
    this.gateCollider = null;
    this.gateInfo = null;
    this.signLabel = null;
    this.signSubLabel = null;
    this.interactables = [];
    this.ownedMaterials = [];
    this.ownedGeometries = [];
    this.materialCache = new Map();
  }

  build() {
    const group = new THREE.Group();
    group.name = 'farm-perimeter';
    this.group = group;
    this.scene?.add(group);

    this.#buildCity(group);
    this.#buildFence(group);
    this.#buildGate(group);
    this.#buildSignage(group);
    this.#buildColliders();
    this.update(0);
    return this;
  }

  /* ------------------------------------------------------------------- city */

  #buildCity(parent) {
    const city = this.city;
    const roadZ = city.roadZ ?? 50;
    const roadWidth = city.roadWidth ?? 9;
    const sidewalkWidth = city.sidewalkWidth ?? 3;
    const length = 170;

    const cityGroup = new THREE.Group();
    cityGroup.name = 'city-block';
    cityGroup.userData.batchScope = true;
    parent.add(cityGroup);
    this.cityGroup = cityGroup;

    const asphalt = this.#cachedMaterial(
      'farm-asphalt',
      () => new THREE.MeshStandardMaterial({ color: 0x2b3033, roughness: 0.96, metalness: 0.02 }),
    );
    const paint = this.#cachedMaterial(
      'farm-road-paint',
      () => new THREE.MeshStandardMaterial({ color: 0xd8d6cc, roughness: 0.8 }),
    );
    const windowBand = this.#cachedMaterial(
      'farm-city-glass',
      () =>
        new THREE.MeshStandardMaterial({
          color: 0x121a1e,
          roughness: 0.28,
          metalness: 0.6,
          emissive: 0x0a1418,
          emissiveIntensity: 0.55,
        }),
    );

    const road = new THREE.Mesh(this.#box(length, 0.06, roadWidth), asphalt);
    road.position.set(0, GROUND_Y + 0.03, roadZ);
    road.receiveShadow = true;
    cityGroup.add(road);

    for (const side of [-1, 1]) {
      const walk = new THREE.Mesh(
        this.#box(length, 0.1, sidewalkWidth),
        this.materials?.concretePlinth ?? asphalt,
      );
      walk.position.set(0, GROUND_Y + 0.05, roadZ + side * (roadWidth / 2 + sidewalkWidth / 2));
      walk.receiveShadow = true;
      cityGroup.add(walk);
    }

    const dashCount = 22;
    const dashes = new THREE.InstancedMesh(this.#box(2.4, 0.012, 0.16), paint, dashCount);
    dashes.name = 'farm-road-dashes';
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < dashCount; index += 1) {
      matrix.makeTranslation(-66 + index * 6.3, GROUND_Y + 0.062, roadZ);
      dashes.setMatrixAt(index, matrix);
    }
    dashes.instanceMatrix.needsUpdate = true;
    dashes.castShadow = false;
    dashes.receiveShadow = false;
    cityGroup.add(dashes);

    const roofMaterial = this.materials?.steelDark ?? asphalt;
    for (const building of city.buildings ?? []) {
      const tint = this.#cachedMaterial(
        `city-tint-${building.tint}`,
        () =>
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(building.tint ?? '#2b3a41'),
            roughness: 0.86,
            metalness: 0.06,
          }),
      );
      const body = new THREE.Mesh(this.#box(building.width, building.height, building.depth), tint);
      body.position.set(building.x, GROUND_Y + building.height / 2, building.z);
      body.receiveShadow = true;
      cityGroup.add(body);

      const parapet = new THREE.Mesh(
        this.#box(building.width + 0.5, 0.55, building.depth + 0.5),
        roofMaterial,
      );
      parapet.position.set(building.x, GROUND_Y + building.height + 0.27, building.z);
      cityGroup.add(parapet);

      // Two window bands per block read as storeys from the farm without a
      // texture, and collapse into a single draw call once batched.
      for (const ratio of [0.38, 0.66]) {
        const band = new THREE.Mesh(
          this.#box(building.width * 0.9, building.height * 0.14, building.depth + 0.12),
          windowBand,
        );
        band.position.set(building.x, GROUND_Y + building.height * ratio, building.z);
        cityGroup.add(band);
      }
    }
  }

  /* ------------------------------------------------------------------ fence */

  #buildFence(parent) {
    const fenceGroup = new THREE.Group();
    fenceGroup.name = 'farm-fence';
    parent.add(fenceGroup);
    this.fenceGroup = fenceGroup;

    const steel = this.materials?.steel ?? this.materials?.aluminium;
    const height = this.fence.height ?? 2.35;
    const spacing = Math.max(1.2, this.fence.postSpacing ?? 2.4);
    const gateHalf = (this.gate.width ?? 4.6) / 2;
    const { minX, maxX, minZ, maxZ } = this.bounds;

    const runs = [
      { along: 'x', at: maxZ, from: minX, to: -gateHalf },
      { along: 'x', at: maxZ, from: gateHalf, to: maxX },
      { along: 'x', at: minZ, from: minX, to: maxX },
      { along: 'z', at: minX, from: minZ, to: maxZ },
      { along: 'z', at: maxX, from: minZ, to: maxZ },
    ];

    const postPositions = [];
    const wirePositions = [];

    for (const run of runs) {
      const length = run.to - run.from;
      if (length <= 0.2) continue;

      const postCount = Math.max(1, Math.round(length / spacing));
      const step = length / postCount;
      for (let index = 0; index <= postCount; index += 1) {
        const offset = run.from + step * index;
        postPositions.push(
          run.along === 'x' ? { x: offset, z: run.at } : { x: run.at, z: offset },
        );
      }

      const wireCount = Math.max(1, Math.floor(length / 0.32));
      for (let index = 0; index <= wireCount; index += 1) {
        const offset = run.from + (length * index) / wireCount;
        wirePositions.push({
          x: run.along === 'x' ? offset : run.at,
          z: run.along === 'x' ? run.at : offset,
        });
      }

      for (const railY of [0.34, 1.28, height - 0.1]) {
        const rail = new THREE.Mesh(
          run.along === 'x' ? this.#box(length, 0.055, 0.05) : this.#box(0.05, 0.055, length),
          steel,
        );
        rail.position.set(
          run.along === 'x' ? (run.from + run.to) / 2 : run.at,
          railY,
          run.along === 'x' ? run.at : (run.from + run.to) / 2,
        );
        rail.castShadow = true;
        rail.receiveShadow = true;
        fenceGroup.add(rail);
      }
    }

    const postSize = Math.max(0.06, this.fence.thickness ?? 0.1);
    const posts = new THREE.InstancedMesh(
      this.#box(postSize, height, postSize),
      steel,
      postPositions.length,
    );
    posts.name = 'farm-fence-posts';
    const matrix = new THREE.Matrix4();
    postPositions.forEach((position, index) => {
      matrix.makeTranslation(position.x, GROUND_Y + height / 2, position.z);
      posts.setMatrixAt(index, matrix);
    });
    posts.instanceMatrix.needsUpdate = true;
    posts.castShadow = true;
    posts.receiveShadow = true;
    posts.frustumCulled = false;
    fenceGroup.add(posts);

    const wires = new THREE.InstancedMesh(
      this.#box(0.018, height - 0.2, 0.018),
      steel,
      wirePositions.length,
    );
    wires.name = 'farm-fence-wires';
    wirePositions.forEach((position, index) => {
      matrix.makeTranslation(position.x, GROUND_Y + (height - 0.2) / 2, position.z);
      wires.setMatrixAt(index, matrix);
    });
    wires.instanceMatrix.needsUpdate = true;
    wires.castShadow = false;
    wires.receiveShadow = false;
    wires.frustumCulled = false;
    fenceGroup.add(wires);
  }


  /* ------------------------------------------------------------------- gate */

  #buildGate(parent) {
    const root = new THREE.Group();
    root.name = 'farm-gate';
    parent.add(root);
    this.gateRoot = root;

    const { width, height, openAngle, postSize } = this.gate;
    const gateHalf = width / 2;
    const gateZ = this.bounds.maxZ;
    const steel = this.materials?.steel;
    const dark = this.materials?.steelDark ?? steel;

    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(this.#box(postSize, height + 0.55, postSize), dark);
      post.position.set(side * (gateHalf + postSize / 2), GROUND_Y + (height + 0.55) / 2, gateZ);
      post.castShadow = true;
      post.receiveShadow = true;
      root.add(post);
    }

    const leafWidth = (width - 0.14) / 2;
    const leafHeight = height - 0.12;
    const barGeometry = this.#box(0.03, leafHeight - 0.18, 0.035);

    this.leaves = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.name = `farm-gate-leaf-${side < 0 ? 'west' : 'east'}`;
      pivot.position.set(side * gateHalf, GROUND_Y, gateZ);
      root.add(pivot);

      const leaf = new THREE.Group();
      leaf.position.x = -side * (leafWidth / 2);
      pivot.add(leaf);

      for (const y of [0.09, leafHeight - 0.02]) {
        const rail = new THREE.Mesh(this.#box(leafWidth, 0.07, 0.055), steel);
        rail.position.set(0, y, 0);
        rail.castShadow = true;
        leaf.add(rail);
      }
      for (const x of [-leafWidth / 2 + 0.04, leafWidth / 2 - 0.04]) {
        const stile = new THREE.Mesh(this.#box(0.07, leafHeight, 0.055), steel);
        stile.position.set(x, leafHeight / 2, 0);
        stile.castShadow = true;
        leaf.add(stile);
      }
      for (let index = 1; index <= 5; index += 1) {
        const bar = new THREE.Mesh(barGeometry, steel);
        bar.position.set(-leafWidth / 2 + (leafWidth * index) / 6, leafHeight / 2, 0);
        leaf.add(bar);
      }

      // Both leaves swing out over the road: rotating by the hinge side keeps
      // the pivots symmetric without a second angle constant.
      this.leaves.push({ pivot, side, hingeAngle: openAngle ?? 1.55 });
    }

    // One invisible proxy spans the opening so the gate stays easy to aim at
    // while the leaves are swinging away from the player.
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.2, height, 0.34),
      this.materials?.hitProxy,
    );
    proxy.name = 'farm-gate-proxy';
    proxy.position.set(0, GROUND_Y + height / 2, gateZ);
    root.add(proxy);

    this.gateInfo = {
      id: 'farm-gate',
      kind: 'gate',
      category: 'Farm perimeter',
      title: 'South yard vehicle gate',
      description:
        'Two-leaf galvanised gate onto the service road. Opening it clears the collider so a load can be wheeled between the site and the street.',
      interaction: 'farm-gate',
      interactionHint: 'Open gate',
      specs: [
        ['Opening', `${width.toFixed(1)} m`],
        ['Leaves', String(this.leaves.length)],
        ['State', 'Closed'],
      ],
    };
    proxy.userData.interactable = this.gateInfo;
    this.interactables.push({ object: proxy, data: this.gateInfo });
    this.gateProxy = proxy;
  }

  #buildSignage(parent) {
    const signY = this.signage.y ?? 3.1;
    const signZ = this.bounds.maxZ + 0.16;

    this.signLabel = new BillboardLabel({
      parent,
      camera: this.camera,
      text: this.signage.title ?? 'GREENHOUSE 14',
      variant: 'store',
      width: 3.4,
      height: 0.46,
      position: { x: 0, y: signY, z: signZ },
      renderOrder: 12,
    });
    this.signSubLabel = new BillboardLabel({
      parent,
      camera: this.camera,
      text: this.signage.subtitle ?? '',
      variant: 'muted',
      width: 2.6,
      height: 0.24,
      position: { x: 0, y: signY - 0.42, z: signZ },
      renderOrder: 12,
    });
  }


  /* -------------------------------------------------------------- collision */

  #buildColliders() {
    const world = this.collisionWorld;
    if (!world) return;
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const depth = Math.max(0.16, (this.fence.thickness ?? 0.1) * 1.8);
    const gateHalf = this.gate.width / 2;
    const label = 'Farm perimeter fence';

    world.addBox({ x: minX, z: (minZ + maxZ) / 2, width: depth, depth: maxZ - minZ, label });
    world.addBox({ x: maxX, z: (minZ + maxZ) / 2, width: depth, depth: maxZ - minZ, label });
    world.addBox({ x: 0, z: minZ, width: maxX - minX, depth, label });

    world.addBox({
      x: (minX - gateHalf) / 2,
      z: maxZ,
      width: -gateHalf - minX,
      depth,
      label,
    });
    world.addBox({
      x: (gateHalf + maxX) / 2,
      z: maxZ,
      width: maxX - gateHalf,
      depth,
      label,
    });

    for (const side of [-1, 1]) {
      world.addBox({
        x: side * (gateHalf + this.gate.postSize / 2),
        z: maxZ,
        width: this.gate.postSize,
        depth: this.gate.postSize,
        label: 'Farm gate post',
      });
    }

    this.gateCollider = world.addBox({
      x: 0,
      z: maxZ,
      width: this.gate.width,
      depth: 0.3,
      label: 'Farm gate',
    });
    this.gateCollider.enabled = !this.gateOpen;
  }

  /* ---------------------------------------------------------------- runtime */

  getInteractables() {
    return this.interactables;
  }

  /** Gate leaves and billboard labels animate every frame. */
  getDynamicRoots() {
    return [this.gateRoot, this.signLabel?.mesh, this.signSubLabel?.mesh];
  }

  #targetAngle() {
    return this.gateOpen ? (this.gate.openAngle ?? 1.55) : 0;
  }

  toggleGate(open = !this.gateOpen) {
    this.gateOpen = Boolean(open);
    if (this.gateCollider) this.gateCollider.enabled = !this.gateOpen;
    if (this.gateInfo) {
      this.gateInfo.interactionHint = this.gateOpen ? 'Close gate' : 'Open gate';
      this.gateInfo.specs[2][1] = this.gateOpen ? 'Open' : 'Closed';
    }
    return this.gateOpen;
  }

  update(dt = 0, camera = this.camera) {
    const target = this.#targetAngle();
    this.gateAngle += (target - this.gateAngle) * Math.min(1, dt * 4.2);
    if (Math.abs(target - this.gateAngle) < 0.002) this.gateAngle = target;
    for (const leaf of this.leaves) {
      if (leaf.pivot) leaf.pivot.rotation.y = leaf.side * this.gateAngle;
    }
    this.signLabel?.setText(this.signage.title ?? 'GREENHOUSE 14', this.gateOpen ? 'store' : 'ready');
    this.signLabel?.update(camera);
    this.signSubLabel?.update(camera);
  }

  /* ------------------------------------------------------------ persistence */

  snapshot() {
    return { gateOpen: this.gateOpen, gateAngle: this.gateAngle };
  }

  restore(state = {}) {
    if (!state) return this;
    this.toggleGate(Boolean(state.gateOpen));
    this.gateAngle = Number.isFinite(state.gateAngle) ? state.gateAngle : this.#targetAngle();
    this.update(0);
    return this;
  }

  dispose() {
    this.signLabel?.dispose();
    this.signSubLabel?.dispose();
    this.signLabel = null;
    this.signSubLabel = null;

    this.group?.removeFromParent();
    for (const geometry of this.ownedGeometries) geometry.dispose?.();
    this.ownedGeometries.length = 0;
    for (const material of this.ownedMaterials) material.dispose?.();
    this.ownedMaterials.length = 0;
    this.materialCache.clear();

    this.group = null;
    this.cityGroup = null;
    this.fenceGroup = null;
    this.gateRoot = null;
    this.gateProxy = null;
    this.gateInfo = null;
    this.gateCollider = null;
    this.leaves = [];
    this.interactables.length = 0;
  }

  /* ----------------------------------------------------------------- helpers */

  #box(width, height, depth) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    this.ownedGeometries.push(geometry);
    return geometry;
  }

  #cachedMaterial(key, factory) {
    if (this.materialCache.has(key)) return this.materialCache.get(key);
    const material = factory();
    this.materialCache.set(key, material);
    this.ownedMaterials.push(material);
    return material;
  }
}
