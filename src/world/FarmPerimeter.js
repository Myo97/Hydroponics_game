import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';

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
 * them; the gate leaves and traffic stay dynamic.
 */
export class FarmPerimeter {
  constructor({ scene, materials, collisionWorld = null, layout = LAYOUT } = {}) {
    this.scene = scene;
    this.materials = materials;
    this.collisionWorld = collisionWorld;
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
    this.interactables = [];
    this.ownedMaterials = [];
    this.ownedGeometries = [];
    this.materialCache = new Map();
    this.traffic = [];
  }

  build() {
    const group = new THREE.Group();
    group.name = 'farm-perimeter';
    this.group = group;
    this.scene?.add(group);

    this.#buildCity(group);
    this.#buildTraffic(group);
    this.#buildFence(group);
    this.#buildGate(group);
    this.#buildColliders();
    this.update(0);
    return this;
  }

  #buildTraffic(parent) {
    const root = new THREE.Group();
    root.name = 'farm-road-traffic';
    parent.add(root);
    const fleet = [
      ['sedan', 0xd94540], ['hatchback', 0x26acbc], ['pickup', 0x64894b],
      ['wagon', 0xf29a46], ['sedan', 0x7768d6], ['pickup', 0x477d9e],
      ['hatchback', 0xe5bf42],
    ];
    fleet.forEach(([style, color], index) => {
      const direction = index % 2 === 0 ? 1 : -1;
      const { vehicle, wheels } = this.#buildRetroVehicle(style, color);
      vehicle.name = `farm-${style}-${index + 1}`;
      vehicle.rotation.y = direction > 0 ? Math.PI / 2 : -Math.PI / 2;
      const startX = -76 + index * 24 + (Math.random() - 0.5) * 5.5;
      vehicle.position.set(startX, GROUND_Y, this.city.roadZ + (direction > 0 ? -1.65 : 1.65));
      root.add(vehicle);
      this.traffic.push({ vehicle, wheels, direction, speed: 4.8 + Math.random() * 4.8 });
    });
  }

  #buildRetroVehicle(style, color) {
    const vehicle = new THREE.Group();
    const material = (name, options) => this.#cachedMaterial(`traffic-${name}`, () =>
      new THREE.MeshStandardMaterial(options),
    );
    const paint = material(color, { color, roughness: 0.42, metalness: 0.15 });
    const glass = material('glass', { color: 0x244451, roughness: 0.22, metalness: 0.32 });
    const trim = material('chrome', { color: 0xc4cbd0, roughness: 0.32, metalness: 0.55 });
    const rubber = material('rubber', { color: 0x202326, roughness: 0.96 });
    const headlight = material('headlight', { color: 0xfff1ce, emissive: 0xffcf83, emissiveIntensity: 0.5 });
    const taillight = material('taillight', { color: 0xd13331, emissive: 0xa71910, emissiveIntensity: 0.3 });
    const box = (mat, w, h, d, x, y, z) => {
      const mesh = new THREE.Mesh(this.#box(w, h, d), mat);
      mesh.position.set(x, y, z);
      vehicle.add(mesh);
      return mesh;
    };
    const panel = (mat, points) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap(p => p.toArray()), 3));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      geometry.computeVertexNormals();
      this.ownedGeometries.push(geometry);
      vehicle.add(new THREE.Mesh(geometry, mat));
    };

    const length = { hatchback: 3.45, sedan: 4.1, wagon: 4.25, pickup: 4.45 }[style];
    const nose = length / 2;
    const front = style === 'hatchback' ? 1.1 : 0.88;
    const rear = { hatchback: -1.6, sedan: -1.08, wagon: -1.91, pickup: -0.45 }[style];
    const belt = 0.88;
    const roof = style === 'sedan' ? 1.64 : 1.96;
    const roofFront = front - 0.55;
    const roofRear = rear + 0.24;
    const base = 0.83;
    const top = 0.71;
    const v = (x, y, z) => new THREE.Vector3(x, y, z);
    const bl = v(-base, belt, front);
    const br = v(base, belt, front);
    const rl = v(-base, belt, rear);
    const rr = v(base, belt, rear);
    const tl = v(-top, roof, roofFront);
    const tr = v(top, roof, roofFront);
    const ul = v(-top, roof, roofRear);
    const ur = v(top, roof, roofRear);

    // Interpolate inset panes on the sloped cabin faces so the paint forms the window frames.
    const glazedFace = (a, b, c, d, windows) => {
      panel(paint, [a, b, c, d]);
      const offset = b.clone().sub(a).cross(d.clone().sub(a)).normalize().multiplyScalar(0.008);
      const point = (u, t) => a.clone().lerp(b, u).lerp(d.clone().lerp(c, u), t).add(offset);
      for (const [left, right] of windows) {
        panel(glass, [point(left, 0.08), point(right, 0.08), point(right, 0.92), point(left, 0.92)]);
      }
    };
    const sideWindows = style === 'pickup' ? [[0.09, 0.91]] : [[0.05, 0.47], [0.52, 0.95]];
    glazedFace(bl, br, tr, tl, [[0.05, 0.95]]);
    glazedFace(rr, rl, ul, ur, [[0.08, 0.92]]);
    glazedFace(br, rr, ur, tr, sideWindows);
    glazedFace(rl, bl, tl, ul, sideWindows);
    panel(paint, [tl, tr, ur, ul]);

    box(paint, 1.76, 0.52, length, 0, 0.62, 0);
    if (style === 'pickup') {
      const bedLength = nose + rear;
      const bedCenter = (rear - nose) / 2;
      box(rubber, 1.44, 0.035, bedLength, 0, belt, bedCenter);
      for (const side of [-1, 1]) {
        box(paint, 0.15, 0.22, bedLength, side * 0.8, belt + 0.1, bedCenter);
      }
      box(paint, 1.76, 0.22, 0.13, 0, belt + 0.1, -nose + 0.065);
    }

    for (const end of [-1, 1]) {
      box(trim, 1.8, 0.15, 0.14, 0, 0.44, end * nose);
      box(trim, 0.31, 0.11, 0.025, 0, 0.46, end * (nose + 0.08));
    }
    box(rubber, 0.91, 0.23, 0.045, 0, 0.69, nose);
    for (const y of [0.62, 0.67, 0.72, 0.77]) {
      box(trim, 0.86, 0.016, 0.024, 0, y, nose + 0.025);
    }
    for (const side of [-1, 1]) {
      box(headlight, 0.27, 0.18, 0.045, side * 0.65, 0.72, nose);
      box(taillight, 0.25, 0.16, 0.04, side * 0.68, 0.73, -nose);
      box(trim, 0.026, 0.037, length - 0.5, side * 0.88, 0.69, 0);
      box(paint, 0.19, 0.105, 0.14, side * 0.91, 0.96, front - 0.16);
      box(trim, 0.026, 0.045, 0.17, side * 0.88, 0.81, -0.1);
    }

    const radius = 0.31;
    const tire = new THREE.CylinderGeometry(radius, radius, 0.19, 14);
    const hub = new THREE.CylinderGeometry(0.15, 0.15, 0.21, 12);
    tire.rotateZ(Math.PI / 2);
    hub.rotateZ(Math.PI / 2);
    this.ownedGeometries.push(tire);
    this.ownedGeometries.push(hub);
    const wheels = [];
    for (const z of [-nose + 0.65, nose - 0.71]) {
      for (const side of [-1, 1]) {
        const wheel = new THREE.Group();
        wheel.position.set(side * 0.85, radius, z);
        wheel.add(new THREE.Mesh(tire, rubber), new THREE.Mesh(hub, trim));
        vehicle.add(wheel);
        wheels.push(wheel);
      }
    }
    return { vehicle, wheels };
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

    (city.buildings ?? []).forEach((building, index) => {
      const facing = building.z >= roadZ ? Math.PI : Math.sign(-building.x) * Math.PI / 2;
      this.#buildCottage(cityGroup, building, index % 4, facing);
    });
  }

  #buildCottage(parent, building, style, facing) {
    const { width, depth, height } = building;
    const cottage = new THREE.Group();
    cottage.name = 'roadside-cottage';
    cottage.position.set(building.x, GROUND_Y, building.z);
    cottage.rotation.y = facing;
    parent.add(cottage);

    const finish = (color, glow = 0) => this.#cachedMaterial(`cottage-${color}-${glow}`, () =>
      new THREE.MeshStandardMaterial({
        color, roughness: 0.88, emissive: color, emissiveIntensity: glow,
      }),
    );
    const siding = finish([0x287e79, 0x237d92, 0xa16b47, 0x246b96][style]);
    const seams = finish([0x226c67, 0x216a7b, 0x865537, 0x215b7e][style]);
    const tiles = finish([0xc9843b, 0xba6236, 0x623f32, 0xcc7646][style]);
    const edge = finish([0x8c4d28, 0x813d29, 0x432a22, 0x8c4935][style]);
    const trim = finish([0x87b659, 0xcf9862, 0xdca276, 0x83b8c5][style]);
    const porch = finish(0x785340);
    const stone = finish(0x66666a);
    const glass = finish(0x72472a, 0.3);
    const foliage = finish(0x52732d);

    const add = (geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      cottage.add(mesh);
      return mesh;
    };
    const box = (material, w, h, d, x, y, z) =>
      add(this.#box(w, h, d), material, x, y, z);

    const gableRoof = (w, d, rise, x, y, z, courses) => {
      const profile = new THREE.Shape();
      profile.moveTo(-w / 2, 0);
      profile.lineTo(w / 2, 0);
      profile.lineTo(0, rise);
      profile.closePath();
      const gable = new THREE.ExtrudeGeometry(profile, { depth: d, bevelEnabled: false });
      this.ownedGeometries.push(gable);
      add(gable, siding, x, y, z - d / 2);
      const run = w / 2 + 0.33;
      const slope = Math.atan2(rise, w / 2);
      const span = run / Math.cos(slope);
      for (const side of [-1, 1]) {
        const roof = box(edge, span, 0.17, d + 0.62,
          x + side * run / 2, y + rise - run * Math.tan(slope) / 2, z);
        roof.rotation.z = -side * slope;
        roof.castShadow = true;
        for (let row = 0; row < courses; row += 1) {
          const offset = run * (row + 0.5) / courses;
          const tile = box(tiles, span / courses + 0.035, 0.1, d + 0.66,
            x + side * offset, y + rise - offset * Math.tan(slope) + 0.12, z);
          tile.rotation.z = -side * slope;
        }
      }
      box(edge, 0.18, 0.15, d + 0.7, x, y + rise + 0.14, z);
    };

    const window = (x, y, z, w, h) => {
      box(trim, w + 0.2, h + 0.22, 0.16, x, y, z);
      box(glass, w, h, 0.06, x, y, z + 0.09);
      box(trim, 0.07, h, 0.08, x, y, z + 0.13);
      box(trim, w, 0.07, 0.08, x, y, z + 0.13);
      box(porch, w + 0.28, 0.13, 0.26, x, y - h / 2 - 0.12, z);
    };

    const front = depth / 2;
    const rise = width * [0.36, 0.49, 0.34, 0.41][style];
    box(stone, width + 0.15, 0.36, depth + 0.15, 0, 0.18, 0);
    box(siding, width, height - 0.36, depth, 0, (height + 0.36) / 2, 0);
    for (let y = 0.65; y < height; y += 0.32) {
      box(seams, width + 0.035, 0.035, depth + 0.035, 0, y, 0);
    }
    gableRoof(width, depth, rise, 0, height, 0, 14);
    box(edge, 0.67, 1.7, 0.7, width * 0.23, height + rise * 0.77, -depth * 0.14);
    box(stone, 0.86, 0.16, 0.9, width * 0.23, height + rise * 0.77 + 0.89, -depth * 0.14);

    if (style === 2 || style === 3) {
      const wingWidth = width * 0.37;
      const wingX = width * (style === 2 ? -0.23 : 0.19);
      const wingY = height + rise * 0.24;
      box(siding, wingWidth, wingY - height + 0.55, 1.05, wingX, (wingY + height - 0.55) / 2, front - 0.3);
      gableRoof(wingWidth, 1.05, wingWidth * 0.48, wingX, wingY, front - 0.3, 6);
      window(wingX, wingY + 0.38, front + 0.23, 0.61, 0.69);
    }
    window(0, height + rise * 0.26, front, 0.85, 1.02);
    for (const side of [-1, 1]) {
      window(side * width * 0.27, 1.81, front, 1.18, 1.27);
    }
    box(porch, 1.37, 2.37, 0.16, 0, 1.49, front);
    box(trim, 1.13, 2.17, 0.08, 0, 1.46, front + 0.1);
    box(glass, 0.64, 0.62, 0.04, 0, 1.99, front + 0.15);
    box(porch, 0.06, 0.62, 0.05, 0, 1.99, front + 0.18);

    const porchWidth = width * [0.42, 0.36, 0.85, 0.73][style];
    box(porch, porchWidth, 0.28, 1.35, 0, 0.34, front + 0.59);
    box(stone, 1.75, 0.21, 0.52, 0, 0.12, front + 1.36);
    box(stone, 1.61, 0.15, 0.4, 0, 0.25, front + 1.16);
    const canopy = box(tiles, porchWidth + 0.34, 0.19, 1.61, 0, 2.83, front + 0.67);
    canopy.rotation.x = 0.19;
    for (const side of [-1, 1]) {
      box(porch, 0.16, 2.28, 0.16, side * (porchWidth / 2 - 0.14), 1.6, front + 1.1);
      const shrubGeometry = new THREE.IcosahedronGeometry(0.55, 1);
      this.ownedGeometries.push(shrubGeometry);
      const shrub = add(shrubGeometry, foliage, side * (width / 2 - 0.6), 0.55, front + 0.65);
      shrub.scale.set(0.82, style === 1 ? 1.7 : 1.05, 0.78);
      const fence = style === 0 ? trim : porch;
      const fenceWidth = width / 2 - 1.4;
      const fenceX = side * (1.4 + fenceWidth / 2);
      for (const y of [0.26, 0.59]) {
        box(porch, fenceWidth, 0.1, 0.09, fenceX, y, front + 1.78);
      }
      for (let post = 0; post <= 5; post += 1) {
        box(fence, 0.13, 0.8, 0.12, side * (1.4 + post * fenceWidth / 5), 0.4, front + 1.81);
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

  /** Gate leaves and traffic animate every frame. */
  getDynamicRoots() {
    return [
      this.gateRoot,
      ...this.traffic.map((entry) => entry.vehicle),
    ];
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

  update(dt = 0, _camera, climate = null) {
    const target = this.#targetAngle();
    this.gateAngle += (target - this.gateAngle) * Math.min(1, dt * 4.2);
    if (Math.abs(target - this.gateAngle) < 0.002) this.gateAngle = target;
    for (const leaf of this.leaves) {
      if (leaf.pivot) leaf.pivot.rotation.y = leaf.side * this.gateAngle;
    }
    for (const entry of this.traffic) {
      entry.vehicle.position.x += entry.direction * entry.speed * dt;
      if (entry.vehicle.position.x > 86) entry.vehicle.position.x = -86 - Math.random() * 18;
      if (entry.vehicle.position.x < -86) entry.vehicle.position.x = 86 + Math.random() * 18;
      for (const wheel of entry.wheels) wheel.rotation.x += entry.speed * dt / 0.31;
    }
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
