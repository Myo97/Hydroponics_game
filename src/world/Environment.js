import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { LAYOUT } from '../config/layout.js';

/**
 * Environment system: sky, sun, natural light, exterior ground and yard.
 * Kept separate from the greenhouse so lighting/time-of-day can evolve without
 * touching structural code.
 */
export class Environment {
  constructor({ scene, renderer, materials, preset }) {
    this.scene = scene;
    this.renderer = renderer;
    this.materials = materials;
    this.preset = preset;
    this.sunDirection = new THREE.Vector3();
    this.envRenderTarget = null;
    this.lights = [];
  }

  build() {
    this.buildSky();
    this.buildSun();
    this.buildExterior();
    this.applyQuality(this.preset);
    return this;
  }

  buildSky() {
    const sky = new Sky();
    sky.scale.setScalar(45000);
    sky.name = 'sky';

    const uniforms = sky.material.uniforms;
    uniforms.turbidity.value = 5.5;
    uniforms.rayleigh.value = 1.35;
    uniforms.mieCoefficient.value = 0.004;
    uniforms.mieDirectionalG.value = 0.82;

    // Late-morning sun: 38° elevation, south-east.
    const elevation = THREE.MathUtils.degToRad(38);
    const azimuth = THREE.MathUtils.degToRad(132);
    this.sunDirection.setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);
    uniforms.sunPosition.value.copy(this.sunDirection);
    this.scene.add(sky);
    this.sky = sky;

    // Pre-filter the sky into an environment map for glass and metal reflections.
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(45000);
    const envUniforms = envSky.material.uniforms;
    envUniforms.turbidity.value = uniforms.turbidity.value;
    envUniforms.rayleigh.value = uniforms.rayleigh.value;
    envUniforms.mieCoefficient.value = uniforms.mieCoefficient.value;
    envUniforms.mieDirectionalG.value = uniforms.mieDirectionalG.value;
    envUniforms.sunPosition.value.copy(this.sunDirection);
    envScene.add(envSky);

    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envRenderTarget = pmrem.fromScene(envScene, 0.02, 1, 100000);
      this.scene.environment = this.envRenderTarget.texture;
      pmrem.dispose();
    } catch (error) {
      console.warn('Environment map generation failed, using lights only.', error);
    }

    envSky.geometry.dispose();
    envSky.material.dispose();
  }

  buildSun() {
    const sun = new THREE.DirectionalLight(0xfff2df, 3.1);
    sun.name = 'sun';
    sun.position.copy(this.sunDirection).multiplyScalar(70);
    sun.target.position.set(0, 1.2, 0);
    sun.castShadow = true;

    const shadow = sun.shadow;
    shadow.camera.left = -40;
    shadow.camera.right = 40;
    shadow.camera.top = 40;
    shadow.camera.bottom = -40;
    shadow.camera.near = 1;
    shadow.camera.far = 180;
    shadow.bias = -0.00035;
    shadow.normalBias = 0.028;
    shadow.camera.updateProjectionMatrix();

    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.lights.push(sun);

    // Sky bounce / skylight fill. Keeps the shaded interior readable without
    // looking like artificial studio lighting.
    const hemisphere = new THREE.HemisphereLight(0xc4d8e2, 0x6d6759, 0.55);
    hemisphere.position.set(0, 12, 0);
    this.scene.add(hemisphere);
    this.lights.push(hemisphere);

    this.scene.fog = new THREE.Fog(0xc2cdcd, 62, 260);
  }

  buildExterior() {
    const { apronHalfWidth, apronFront, apronBack } = LAYOUT.exterior;
    const exterior = new THREE.Group();
    exterior.name = 'exterior';
    this.exteriorGroup = exterior;

    // Lawn.
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), this.materials.grass);
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.05;
    grass.receiveShadow = true;
    grass.name = 'exterior-grass';
    exterior.add(grass);

    // Concrete apron: a ring around the building footprint.
    const apronGroup = new THREE.Group();
    apronGroup.name = 'exterior-apron';
    const halfWidth = LAYOUT.greenhouse.width / 2 + 0.35;
    const halfLength = LAYOUT.greenhouse.length / 2 + 0.35;
    const thickness = 0.12;

    const addSlab = (width, depth, x, z) => {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(width, thickness, depth),
        this.materials.concreteApron,
      );
      slab.position.set(x, -thickness / 2, z);
      slab.receiveShadow = true;
      slab.castShadow = false;
      apronGroup.add(slab);
    };

    addSlab(apronHalfWidth * 2, apronFront - halfLength, 0, (apronFront + halfLength) / 2);
    addSlab(apronHalfWidth * 2, Math.abs(apronBack + halfLength), 0, (apronBack - halfLength) / 2);
    addSlab(apronHalfWidth - halfWidth, halfLength * 2, -(apronHalfWidth + halfWidth) / 2, 0);
    addSlab(apronHalfWidth - halfWidth, halfLength * 2, (apronHalfWidth + halfWidth) / 2, 0);
    exterior.add(apronGroup);

    // Entrance bollards.
    for (const x of [-3.4, 3.4]) {
      const bollard = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 0.9, 12),
        this.materials.steel,
      );
      bollard.position.set(x, 0.45, 24.2);
      bollard.castShadow = true;
      bollard.receiveShadow = true;
      exterior.add(bollard);
    }

    // Distant windbreak hedges — read as depth, softened by fog.
    const hedgeMaterial = this.materials.track(
      new THREE.MeshStandardMaterial({
        name: 'hedge',
        color: 0x3f4936,
        roughness: 0.95,
        metalness: 0,
      }),
    );
    for (const [x, z, width] of [
      [-46, 48, 52],
      [40, 54, 44],
      [-58, -30, 12],
    ]) {
      const hedge = new THREE.Mesh(new THREE.BoxGeometry(width, 2.4, 1.4), hedgeMaterial);
      hedge.position.set(x, 1.1, z);
      hedge.castShadow = true;
      exterior.add(hedge);
    }

    // Drainage channel crossing the front apron.
    const drain = new THREE.Mesh(
      new THREE.BoxGeometry(apronHalfWidth * 1.6, 0.02, 0.34),
      this.materials.drainGrate,
    );
    drain.position.set(0, 0.008, 20.9);
    drain.receiveShadow = true;
    exterior.add(drain);

    this.scene.add(exterior);
  }

  applyQuality(preset) {
    this.preset = preset;
    if (!this.sun) return;

    const size = preset.shadowMapSize;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.sun.castShadow = preset.shadows;
    this.scene.environmentIntensity = preset.environmentIntensity;
    this.scene.fog.near = preset.id === 'low' ? 48 : 62;
  }

  dispose() {
    for (const light of this.lights) light.parent?.remove(light);
    if (this.exteriorGroup) {
      this.exteriorGroup.traverse((child) => {
        if (child.isMesh) child.geometry?.dispose();
      });
      this.scene.remove(this.exteriorGroup);
      this.exteriorGroup = null;
    }
    this.envRenderTarget?.dispose();
    this.sky?.geometry.dispose();
    this.sky?.material.dispose();
  }
}
