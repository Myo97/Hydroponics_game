import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const CUSTOMER_STYLES = [
  { name: 'Blue hoodie', shirtColor: 0x3868cb, trouserColor: 0x496884, skinColor: 0xdca080, hairColor: 0x273f70, hairstyle: 'spiky', outfit: 'hoodie', height: 0.96 },
  { name: 'Bearded visitor', shirtColor: 0xc5ccd5, trouserColor: 0x344965, skinColor: 0xe1ad86, hairColor: 0x663b25, hairstyle: 'wavy', beard: true, outfit: 'jacket', width: 1.08 },
  { name: 'Copper bob', shirtColor: 0xb96563, trouserColor: 0xefe0c7, skinColor: 0xedbb98, hairColor: 0xa45c2b, hairstyle: 'bob', height: 0.96 },
  { name: 'Silver cardigan', shirtColor: 0x43a5a5, trouserColor: 0x556777, skinColor: 0xdba97c, hairColor: 0xd5d8d3, hairstyle: 'bun', glasses: true, outfit: 'jacket', height: 0.9 },
  { name: 'Flat cap visitor', shirtColor: 0x74629e, trouserColor: 0x635140, skinColor: 0xc58b60, hairColor: 0x8a8175, hairstyle: 'cap', glasses: true, height: 0.91, width: 1.18 },
  { name: 'Cream blouse', shirtColor: 0xe1c293, trouserColor: 0xae8059, skinColor: 0xd79b78, hairColor: 0x282329, hairstyle: 'bob', height: 1.01 },
  { name: 'Striped shirt', shirtColor: 0xb94d42, trouserColor: 0x344955, skinColor: 0xe3af8b, hairColor: 0x704531, hairstyle: 'wavy', glasses: true, outfit: 'striped', height: 0.98 },
  { name: 'Teal polo', shirtColor: 0x298394, trouserColor: 0x424f61, skinColor: 0x965d40, hairColor: 0x2d211c, hairstyle: 'short', beard: true, width: 1.2 },
];

export const SHOPKEEPER_STYLE = {
  name: 'Farm shopkeeper', shirtColor: 0xeee6d5, trouserColor: 0x62664b,
  skinColor: 0xde9e70, hairColor: 0x543222, hairstyle: 'quiff',
  outfit: 'suspenders', width: 1.1,
};

/** Rounded cartoon characters, facing +Z, with articulated arms and legs. */
export function createHumanFigure({
  name = 'Visitor', shirtColor = 0x527e69, trouserColor = 0x35495a,
  skinColor = 0xc98f6b, hairColor = 0x332b27, hairstyle = 'short',
  outfit = 'shirt', beard = false, glasses = false, height = 1, width = 1,
} = {}) {
  const root = new THREE.Group();
  root.name = 'human-figure';
  root.scale.set(width * height, height, height);
  const materials = new Map();
  const geometries = new Map();
  const mat = (color, roughness = 0.82) => {
    const key = color + ':' + roughness;
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness }));
    return materials.get(key);
  };
  const geometry = (key, build) => {
    if (!geometries.has(key)) geometries.set(key, build());
    return geometries.get(key);
  };
  const mesh = (shape, material, parent, x, y, z) => {
    const object = new THREE.Mesh(shape, material);
    object.position.set(x, y, z);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  };
  const ball = (parent, material, x, y, z, sx, sy, sz) => {
    const object = mesh(geometry('sphere', () => new THREE.SphereGeometry(1, 16, 12)), material, parent, x, y, z);
    object.scale.set(sx, sy, sz);
    return object;
  };
  const box = (parent, material, x, y, z, w, h, d, radius = 0.025) =>
    mesh(geometry([w, h, d, radius].join(','), () => new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3))), material, parent, x, y, z);
  const capsule = (parent, material, radius, length, x, y, z) =>
    mesh(geometry('capsule-' + radius + '-' + length, () => new THREE.CapsuleGeometry(radius, length, 4, 10)), material, parent, x, y, z);
  const skin = mat(skinColor);
  const hair = mat(hairColor);
  const hairHighlight = mat(new THREE.Color(hairColor).multiplyScalar(1.22).getHex());
  const shirt = mat(shirtColor);
  const pants = mat(trouserColor);
  const white = mat(0xfff6e8);
  const dark = mat(0x292322);
  const shoeMaterial = mat(0x33383c);
  const face = new THREE.Group();
  face.name = 'expressive-face';
  face.position.set(0, 1.63, 0.02);
  root.add(face);

  box(root, pants, 0, 0.76, 0, 0.39, 0.27, 0.29, 0.07);
  ball(root, shirt, 0, 1.09, 0, 0.27, 0.34, 0.185);
  capsule(root, skin, 0.085, 0.1, 0, 1.4, 0);
  ball(face, skin, 0, 0, 0, 0.285, 0.315, 0.25);
  for (const side of [-1, 1]) {
    ball(face, skin, side * 0.283, -0.005, 0, 0.065, 0.087, 0.045);
    ball(face, mat(0xc78267), side * 0.3, -0.005, 0.038, 0.025, 0.046, 0.012);
    ball(face, skin, side * 0.145, -0.075, 0.185, 0.107, 0.077, 0.057);
    ball(face, white, side * 0.102, 0.057, 0.222, 0.066, 0.081, 0.035);
    ball(face, mat(0x66422a, 0.55), side * 0.098, 0.05, 0.25, 0.036, 0.046, 0.018);
    ball(face, dark, side * 0.098, 0.05, 0.266, 0.023, 0.033, 0.01);
    ball(face, white, side * 0.098 - 0.009, 0.068, 0.275, 0.01, 0.013, 0.006);
    const brow = ball(face, hair, side * 0.104, 0.158, 0.223, 0.077, 0.022, 0.018);
    brow.rotation.z = -side * 0.15;
  }
  ball(face, skin, 0, -0.032, 0.267, 0.069, 0.056, 0.064);

  if (beard) {
    ball(face, hair, 0, -0.205, 0.092, 0.224, 0.114, 0.14);
    for (const side of [-1, 1]) ball(face, hair, side * 0.207, -0.12, 0.12, 0.052, 0.106, 0.065);
  }
  // A curved, open smile with a narrow upper row of teeth.
  const smile = new THREE.Shape();
  smile.moveTo(-0.12, 0.015);
  smile.quadraticCurveTo(0, -0.025, 0.12, 0.015);
  smile.quadraticCurveTo(0.09, -0.085, 0, -0.088);
  smile.quadraticCurveTo(-0.09, -0.085, -0.12, 0.015);
  const smileMesh = mesh(geometry('smile', () => new THREE.ShapeGeometry(smile, 12)), dark, face, 0, -0.105, 0.247);
  smileMesh.name = 'smile';
  const teeth = new THREE.Shape();
  teeth.moveTo(-0.106, 0.006);
  teeth.quadraticCurveTo(0, -0.026, 0.106, 0.006);
  teeth.quadraticCurveTo(0.08, -0.033, 0, -0.037);
  teeth.quadraticCurveTo(-0.08, -0.033, -0.106, 0.006);
  mesh(geometry('teeth', () => new THREE.ShapeGeometry(teeth, 12)), white, face, 0, -0.105, 0.249);

  const cap = mesh(
    geometry('hair-cap', () => new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)),
    hair, face, 0, 0.205, -0.025,
  );
  cap.scale.set(0.286, 0.19, 0.255);
  if (hairstyle === 'bob') {
    ball(face, hair, 0, -0.015, -0.15, 0.30, 0.32, 0.16);
    for (const side of [-1, 1]) {
      ball(face, hair, side * 0.252, -0.06, -0.025, 0.072, 0.26, 0.16);
      const fringe = ball(face, hairHighlight, side * 0.13, 0.205, 0.14, 0.16, 0.08, 0.11);
      fringe.rotation.z = side * 0.4;
    }
  } else if (hairstyle === 'bun') {
    ball(face, hair, 0.03, 0.28, -0.20, 0.14, 0.14, 0.12);
    for (let i = 0; i < 7; i++) {
      const lock = ball(face, hairHighlight, -0.22 + i * 0.07, 0.27, 0.05, 0.055, 0.12, 0.19);
      lock.rotation.z = (i - 3) * -0.15;
    }
  } else if (hairstyle === 'cap') {
    ball(face, mat(0x727d7b), 0, 0.27, -0.01, 0.325, 0.125, 0.27);
    ball(face, mat(0x5e6967), 0, 0.205, 0.195, 0.28, 0.026, 0.16);
  } else {
    const tall = hairstyle === 'quiff' || hairstyle === 'spiky';
    for (let i = 0; i < 7; i++) {
      const lock = ball(face, i % 2 ? hairHighlight : hair,
        -0.23 + i * 0.073, 0.25 + (tall ? 0.06 : 0), 0.09,
        0.075, tall ? 0.19 : 0.10, 0.15);
      lock.rotation.z = hairstyle === 'spiky' ? (3 - i) * 0.13 : -0.45;
      lock.rotation.x = -0.35;
    }
    if (hairstyle === 'wavy' || hairstyle === 'quiff') {
      for (const side of [-1, 1]) ball(face, hair, side * 0.25, 0.12, -0.055, 0.066, 0.11, 0.18);
    }
  }

  if (glasses) {
    const frame = mat(0x493d32, 0.48);
    for (const side of [-1, 1]) {
      mesh(geometry('glasses', () => new THREE.TorusGeometry(0.083, 0.009, 6, 20)), frame, face, side * 0.105, 0.057, 0.279);
      box(face, frame, side * 0.23, 0.06, 0.16, 0.017, 0.017, 0.22, 0.005);
    }
    box(face, frame, 0, 0.075, 0.279, 0.043, 0.013, 0.014, 0.004);
  }

  const limbs = { arms: [], legs: [] };
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.26, 1.28, 0);
    shoulder.rotation.z = side * 0.08;
    root.add(shoulder);
    capsule(shoulder, shirt, 0.098, 0.16, 0, -0.13, 0);
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    shoulder.add(elbow);
    capsule(elbow, outfit === 'hoodie' || outfit === 'jacket' ? shirt : skin, 0.071, 0.17, 0, -0.11, 0);
    ball(elbow, skin, 0, -0.275, 0.012, 0.083, 0.10, 0.069);
    ball(elbow, skin, -side * 0.058, -0.245, 0.047, 0.034, 0.058, 0.031);
    limbs.arms.push({ shoulder, elbow, side });

    const hip = new THREE.Group();
    hip.position.set(side * 0.112, 0.75, 0);
    root.add(hip);
    capsule(hip, pants, 0.10, 0.17, 0, -0.15, 0);
    const knee = new THREE.Group();
    knee.position.y = -0.32;
    hip.add(knee);
    capsule(knee, pants, 0.077, 0.17, 0, -0.15, 0);
    box(knee, shoeMaterial, 0, -0.355, 0.065, 0.18, 0.13, 0.31, 0.05);
    box(knee, white, 0, -0.401, 0.065, 0.18, 0.034, 0.31, 0.01);
    limbs.legs.push({ hip, knee, side });
  }

  for (const side of [-1, 1]) {
    const collar = box(root, white, side * 0.072, 1.35, 0.141, 0.11, 0.12, 0.04, 0.012);
    collar.rotation.z = side * -0.38;
  }
  if (outfit === 'suspenders') {
    const strap = mat(0x62684c);
    for (const side of [-1, 1]) {
      const suspender = box(root, strap, side * 0.16, 1.105, 0.171, 0.047, 0.53, 0.032, 0.008);
      suspender.rotation.z = side * -0.09;
      box(root, mat(0xb4b198, 0.4), side * 0.142, 0.92, 0.195, 0.056, 0.059, 0.021, 0.006);
      box(root, strap, side * 0.16, 1.105, -0.171, 0.047, 0.53, 0.032, 0.008);
    }
    box(root, mat(0x4d513c), 0, 0.815, 0.15, 0.38, 0.065, 0.04, 0.01);
    box(root, mat(0x8c9072, 0.4), 0, 0.815, 0.177, 0.075, 0.066, 0.018, 0.007);
    box(root, shirt, -0.085, 1.14, 0.178, 0.084, 0.105, 0.02, 0.01);
  }
  if (outfit === 'hoodie') {
    ball(root, shirt, 0, 1.34, -0.115, 0.24, 0.13, 0.12);
    box(root, mat(0x274c9b), 0, 0.98, 0.177, 0.23, 0.095, 0.025, 0.02);
  }
  if (outfit === 'jacket') {
    box(root, white, 0, 1.15, 0.173, 0.12, 0.35, 0.025, 0.012);
  }
  if (outfit === 'striped') {
    for (const x of [-0.18, -0.09, 0, 0.09, 0.18]) {
      box(root, white, x, 1.10, 0.175 - Math.abs(x) * 0.22, 0.022, 0.38, 0.021, 0.006);
    }
  }
  for (const y of [0.99, 1.12, 1.25]) ball(root, mat(0xc6bda9), 0, y, 0.187, 0.014, 0.014, 0.009);

  const umbrella = new THREE.Group();
  umbrella.name = 'rain-umbrella';
  const canopy = mesh(
    geometry('umbrella', () => new THREE.SphereGeometry(0.64, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)),
    mat(0x547a91), umbrella, 0, 2.3, 0,
  );
  canopy.scale.y = 0.32;
  mesh(geometry('umbrella-pole', () => new THREE.CylinderGeometry(0.014, 0.014, 1.15, 6)), dark, umbrella, 0.36, 1.73, 0);
  umbrella.visible = false;
  root.add(umbrella);
  root.userData.figure = { name, limbs, umbrella, face, gait: 0, materials, geometries };
  return root;
}

export function animateHumanFigure(root, dt, { walking = true, rainy = false } = {}) {
  const data = root?.userData?.figure;
  if (!data) return;
  data.umbrella.visible = Boolean(rainy);
  if (walking) data.gait += dt * 7.2;
  const swing = walking ? Math.sin(data.gait) * 0.38 : 0;
  for (const arm of data.limbs.arms) {
    arm.shoulder.rotation.x = swing * arm.side;
    arm.elbow.rotation.x = walking ? Math.max(0, -swing * arm.side) * 0.55 : 0.08;
  }
  for (const leg of data.limbs.legs) {
    leg.hip.rotation.x = -swing * leg.side;
    leg.knee.rotation.x = walking ? Math.max(0, swing * leg.side) * 0.65 : 0;
  }
}

export function disposeHumanFigure(root) {
  root?.removeFromParent();
  const figure = root?.userData?.figure;
  if (!figure) return;
  for (const geometry of figure.geometries.values()) geometry.dispose();
  for (const material of figure.materials.values()) material.dispose();
}
