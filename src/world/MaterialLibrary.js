import * as THREE from 'three';
import {
  createConcreteTextures,
  createSteelTextures,
  createGrassTexture,
  createGlassRoughnessTexture,
  createPlasticTextures,
  createShadeClothTexture,
  createLabelTexture,
  createScreenTexture,
  createWarningLabelTexture,
} from './ProceduralTextures.js';

/**
 * Central material library.
 * All meshes share instances from here, which keeps GPU state changes low and
 * guarantees a consistent material language across greenhouse + equipment.
 */
export class MaterialLibrary {
  constructor(renderer) {
    this.renderer = renderer;
    this.maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.materials = [];
    this.buildTextures();
    this.buildMaterials();
  }

  track(material) {
    this.materials.push(material);
    return material;
  }

  buildTextures() {
    this.textures = {
      concrete: createConcreteTextures({ seed: 11 }),
      steel: createSteelTextures({ seed: 23 }),
      grass: createGrassTexture({ seed: 41 }),
      glassRoughness: createGlassRoughnessTexture({ seed: 63 }),
      plastic: createPlasticTextures({ seed: 77 }),
      shadeCloth: createShadeClothTexture({ seed: 91 }),
      screen: createScreenTexture(),
    };
  }

  /** Clone a tiling texture with an independent repeat while sharing its image. */
  tiled(texture, repeatX, repeatY = repeatX) {
    const clone = texture.clone();
    clone.wrapS = THREE.RepeatWrapping;
    clone.wrapT = THREE.RepeatWrapping;
    clone.repeat.set(repeatX, repeatY);
    clone.anisotropy = this.maxAnisotropy;
    clone.needsUpdate = true;
    return clone;
  }

  buildMaterials() {
    const t = this.textures;

    this.concreteFloor = this.track(
      new THREE.MeshStandardMaterial({
        name: 'concrete-floor',
        map: this.tiled(t.concrete.map, 6, 9),
        roughnessMap: this.tiled(t.concrete.roughnessMap, 6, 9),
        normalMap: this.tiled(t.concrete.normalMap, 6, 9),
        normalScale: new THREE.Vector2(0.5, 0.5),
        color: 0x777b77,
        metalness: 0.0,
        roughness: 0.92,
        envMapIntensity: 0.18,
      }),
    );

    this.concretePlinth = this.track(
      new THREE.MeshStandardMaterial({
        name: 'concrete-plinth',
        map: this.tiled(t.concrete.map, 4, 1),
        roughnessMap: this.tiled(t.concrete.roughnessMap, 4, 1),
        normalMap: this.tiled(t.concrete.normalMap, 4, 1),
        normalScale: new THREE.Vector2(0.42, 0.42),
        color: 0x898c88,
        metalness: 0.0,
        roughness: 0.9,
        envMapIntensity: 0.2,
      }),
    );

    this.concreteApron = this.track(
      new THREE.MeshStandardMaterial({
        name: 'concrete-apron',
        map: this.tiled(t.concrete.map, 14, 14),
        roughnessMap: this.tiled(t.concrete.roughnessMap, 14, 14),
        normalMap: this.tiled(t.concrete.normalMap, 14, 14),
        normalScale: new THREE.Vector2(0.52, 0.52),
        color: 0x7b7f7a,
        metalness: 0.0,
        roughness: 0.94,
        envMapIntensity: 0.16,
      }),
    );

    this.steel = this.track(
      new THREE.MeshStandardMaterial({
        name: 'galvanised-steel',
        map: this.tiled(t.steel.map, 2, 2),
        roughnessMap: this.tiled(t.steel.roughnessMap, 2, 2),
        color: 0x879297,
        metalness: 0.55,
        roughness: 0.68,
        envMapIntensity: 0.4,
      }),
    );

    this.steelDark = this.track(
      new THREE.MeshStandardMaterial({
        name: 'steel-dark',
        map: this.tiled(t.steel.map, 2, 2),
        roughnessMap: this.tiled(t.steel.roughnessMap, 2, 2),
        color: 0x5e6669,
        metalness: 0.78,
        roughness: 0.62,
      }),
    );

    this.aluminium = this.track(
      new THREE.MeshStandardMaterial({
        name: 'aluminium',
        map: this.tiled(t.steel.map, 3, 3),
        roughnessMap: this.tiled(t.steel.roughnessMap, 3, 3),
        color: 0x98a3a7,
        metalness: 0.8,
        roughness: 0.5,
        envMapIntensity: 0.5,
      }),
    );

    this.glass = this.track(
      new THREE.MeshPhysicalMaterial({
        name: 'greenhouse-glass',
        color: 0xdbe8e5,
        metalness: 0.0,
        roughness: 0.14,
        roughnessMap: this.tiled(t.glassRoughness, 1, 1),
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
        ior: 1.52,
        reflectivity: 0.55,
        envMapIntensity: 1.0,
        clearcoat: 0.6,
        clearcoatRoughness: 0.08,
      }),
    );

    this.glassDoor = this.track(
      new THREE.MeshPhysicalMaterial({
        name: 'door-glass',
        color: 0xdfeae7,
        metalness: 0.0,
        roughness: 0.1,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
        ior: 1.52,
        reflectivity: 0.6,
        envMapIntensity: 1.05,
      }),
    );

    this.pvcWhite = this.track(
      new THREE.MeshStandardMaterial({
        name: 'pvc-supply',
        map: this.tiled(t.plastic.map, 6, 2),
        roughnessMap: this.tiled(t.plastic.roughnessMap, 6, 2),
        color: 0xbcc0ba,
        metalness: 0.0,
        roughness: 0.52,
        envMapIntensity: 0.35,
      }),
    );

    this.pvcGrey = this.track(
      new THREE.MeshStandardMaterial({
        name: 'pvc-grey',
        color: 0x767b7c,
        metalness: 0.05,
        roughness: 0.5,
      }),
    );

    this.pipeDark = this.track(
      new THREE.MeshStandardMaterial({
        name: 'pipe-dark',
        color: 0x3f4647,
        metalness: 0.35,
        roughness: 0.46,
      }),
    );

    /** Dark, slightly glossy return line so it reads separately from supply PVC. */
    this.pvcReturn = this.track(
      new THREE.MeshStandardMaterial({
        name: 'pvc-return',
        map: this.tiled(t.plastic.map, 5, 2),
        roughnessMap: this.tiled(t.plastic.roughnessMap, 5, 2),
        color: 0x33484b,
        metalness: 0.08,
        roughness: 0.4,
        envMapIntensity: 0.45,
      }),
    );

    this.rubber = this.track(
      new THREE.MeshStandardMaterial({
        name: 'rubber',
        color: 0x1d1f1f,
        metalness: 0.0,
        roughness: 0.92,
      }),
    );

    /** Woven neutral grey-green shade cloth; the alpha mat leaves the mesh open. */
    this.shadeCloth = this.track(
      new THREE.MeshStandardMaterial({
        name: 'shade-cloth',
        color: 0x9ba79c,
        alphaMap: this.tiled(t.shadeCloth, 26, 40),
        transparent: true,
        opacity: 0.62,
        alphaTest: 0.24,
        side: THREE.DoubleSide,
        depthWrite: false,
        roughness: 0.94,
        metalness: 0.0,
        envMapIntensity: 0.22,
      }),
    );

    /** Reflective woven energy screen, hung below the shade deck. */
    this.energyScreen = this.track(
      new THREE.MeshStandardMaterial({
        name: 'energy-screen',
        color: 0xe9eee4,
        map: this.tiled(t.shadeCloth, 24, 44),
        transparent: true,
        opacity: 0.52,
        alphaTest: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
        roughness: 0.46,
        metalness: 0.28,
        envMapIntensity: 0.9,
      }),
    );

    /** Dark green return-tank shell, deliberately different from RO blue. */
    this.returnTank = this.track(
      new THREE.MeshStandardMaterial({
        name: 'return-tank',
        map: this.tiled(t.plastic.map, 8, 3),
        roughnessMap: this.tiled(t.plastic.roughnessMap, 8, 3),
        color: 0x35544c,
        metalness: 0.05,
        roughness: 0.52,
        envMapIntensity: 0.4,
      }),
    );

    this.stainless = this.track(
      new THREE.MeshStandardMaterial({
        name: 'stainless',
        map: this.tiled(t.steel.map, 2, 2),
        roughnessMap: this.tiled(t.steel.roughnessMap, 2, 2),
        color: 0xd5d8d8,
        metalness: 1.0,
        roughness: 0.3,
        envMapIntensity: 1.1,
      }),
    );

    this.pumpPaint = this.track(
      new THREE.MeshStandardMaterial({
        name: 'pump-paint',
        color: 0x505c58,
        metalness: 0.45,
        roughness: 0.55,
      }),
    );

    /** Deep industrial blue used for the circulation pump volute and motor. */
    this.pumpBlue = this.track(
      new THREE.MeshStandardMaterial({
        name: 'pump-blue',
        color: 0x163b63,
        metalness: 0.38,
        roughness: 0.46,
        envMapIntensity: 0.55,
      }),
    );

    this.cabinetPaint = this.track(
      new THREE.MeshStandardMaterial({
        name: 'cabinet-paint',
        color: 0x9aa09f,
        metalness: 0.28,
        roughness: 0.54,
        envMapIntensity: 0.45,
      }),
    );

    this.cabinetDoor = this.track(
      new THREE.MeshStandardMaterial({
        name: 'cabinet-door',
        color: 0x80888a,
        metalness: 0.3,
        roughness: 0.5,
        envMapIntensity: 0.5,
      }),
    );

    this.cabinetInterior = this.track(
      new THREE.MeshStandardMaterial({
        name: 'cabinet-interior',
        color: 0x363d3f,
        metalness: 0.25,
        roughness: 0.78,
      }),
    );

    // Small indicator lamps (unlit so they stay visible in the cabinet shadow).
    this.ledGreen = this.track(
      new THREE.MeshBasicMaterial({ name: 'led-green', color: 0x62f5b0, toneMapped: false }),
    );
    this.ledAmber = this.track(
      new THREE.MeshBasicMaterial({ name: 'led-amber', color: 0xffb347, toneMapped: false }),
    );
    this.ledRed = this.track(
      new THREE.MeshBasicMaterial({ name: 'led-red', color: 0xff5a52, toneMapped: false }),
    );
    this.ledWhite = this.track(
      new THREE.MeshBasicMaterial({ name: 'led-white', color: 0xcfe9e7, toneMapped: false }),
    );

    this.tankHDPE = this.track(
      new THREE.MeshStandardMaterial({
        name: 'tank-hdpe',
        map: this.tiled(t.plastic.map, 4, 2),
        roughnessMap: this.tiled(t.plastic.roughnessMap, 4, 2),
        color: 0x5a675c,
        metalness: 0.0,
        roughness: 0.72,
      }),
    );

    this.tankHDPELight = this.track(
      new THREE.MeshStandardMaterial({
        name: 'tank-hdpe-light',
        map: this.tiled(t.plastic.map, 3, 2),
        roughnessMap: this.tiled(t.plastic.roughnessMap, 3, 2),
        color: 0xdfe1d9,
        metalness: 0.0,
        roughness: 0.66,
      }),
    );

    /** Blue HDPE stock tanks for nutrient A/B. */
    this.tankHDPEBlue = this.track(
      new THREE.MeshStandardMaterial({
        name: 'tank-hdpe-blue',
        map: this.tiled(t.plastic.map, 3, 2),
        roughnessMap: this.tiled(t.plastic.roughnessMap, 3, 2),
        color: 0x1f5a92,
        metalness: 0.0,
        roughness: 0.58,
        envMapIntensity: 0.35,
      }),
    );

    /** White/translucent HDPE for the pH stock tank. */
    this.tankHDPEAcid = this.track(
      new THREE.MeshStandardMaterial({
        name: 'tank-hdpe-acid',
        map: this.tiled(t.plastic.map, 3, 2),
        roughnessMap: this.tiled(t.plastic.roughnessMap, 3, 2),
        color: 0xd8d9d1,
        metalness: 0.0,
        roughness: 0.55,
        envMapIntensity: 0.3,
      }),
    );

    this.water = this.track(
      new THREE.MeshPhysicalMaterial({
        name: 'water',
        color: 0x22403c,
        metalness: 0.0,
        roughness: 0.08,
        transparent: true,
        opacity: 0.85,
        ior: 1.33,
        envMapIntensity: 1.2,
      }),
    );

    this.floorJoint = this.track(
      new THREE.MeshStandardMaterial({
        name: 'floor-joint',
        color: 0x4d4c47,
        roughness: 0.95,
        metalness: 0.0,
      }),
    );

    this.drainGrate = this.track(
      new THREE.MeshStandardMaterial({
        name: 'drain-grate',
        map: this.tiled(t.steel.map, 1, 2),
        color: 0x54595a,
        metalness: 0.9,
        roughness: 0.55,
      }),
    );

    this.screen = this.track(
      new THREE.MeshStandardMaterial({
        name: 'cabinet-screen',
        map: t.screen,
        emissive: 0x2f7a66,
        emissiveMap: t.screen,
        emissiveIntensity: 1.1,
        roughness: 0.28,
        metalness: 0.1,
      }),
    );

    this.grass = this.track(
      new THREE.MeshStandardMaterial({
        name: 'grass',
        map: this.tiled(t.grass, 70, 70),
        color: 0xa9ad9b,
        roughness: 0.98,
        metalness: 0.0,
      }),
    );

    // Invisible hit volume for batched (instanced) units: never drawn, but still
    // picked by the interaction raycaster.
    this.hitProxy = this.track(
      new THREE.MeshBasicMaterial({
        name: 'hit-proxy',
        visible: false,
        depthWrite: false,
      }),
    );
  }

  /** Printed label material for a tank or skid. */
  createLabelMaterial(title, subtitle, options = {}) {
    const material = this.track(
      new THREE.MeshStandardMaterial({
        name: `label-${title}`,
        map: createLabelTexture(title, subtitle, options),
        roughness: 0.55,
        metalness: 0.0,
      }),
    );
    material.userData.isLabel = true;
    return material;
  }

  /** Unlit material for a live controller display (keeps the canvas legible). */
  createScreenMaterial(texture) {
    const material = this.track(
      new THREE.MeshBasicMaterial({
        name: 'dashboard-screen',
        map: texture,
        toneMapped: false,
      }),
    );
    material.userData.isDashboard = true;
    return material;
  }

  /** Yellow safety sticker. */
  createWarningMaterial() {
    return this.track(
      new THREE.MeshStandardMaterial({
        name: 'safety-label',
        map: createWarningLabelTexture(),
        roughness: 0.62,
        metalness: 0.05,
      }),
    );
  }

  applyAnisotropy(maxAnisotropy) {
    const value = Math.max(1, Math.min(maxAnisotropy, this.maxAnisotropy));
    for (const material of this.materials) {
      for (const key of ['map', 'roughnessMap', 'normalMap', 'emissiveMap']) {
        const texture = material[key];
        if (texture && texture.isTexture) {
          texture.anisotropy = value;
          texture.needsUpdate = true;
        }
      }
    }
  }

  dispose() {
    for (const material of this.materials) material.dispose();
    for (const texture of Object.values(this.textures)) {
      if (texture?.isTexture) texture.dispose();
      else if (texture) for (const value of Object.values(texture)) value?.dispose?.();
    }
    this.materials.length = 0;
  }
}
