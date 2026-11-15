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
    const sunConfig = LAYOUT.sun ?? {};
    const sky = new Sky();
    sky.scale.setScalar(45000);
    sky.name = 'sky';

    const uniforms = sky.material.uniforms;
    uniforms.turbidity.value = 4.4;
    uniforms.rayleigh.value = 1.55;
    uniforms.mieCoefficient.value = 0.0035;
    uniforms.mieDirectionalG.value = 0.84;

    // Physical sun position. Elevation and compass azimuth are configured in
    // LAYOUT.sun so the sky, the directional light and the visible disc agree.
    this.sunDirection.copy(
      this.directionFromAngles(sunConfig.elevationDeg ?? 36, sunConfig.azimuthDeg ?? 135),
    );
    uniforms.sunPosition.value.copy(this.sunDirection);
    this.scene.add(sky);
    this.sky = sky;
    this.skyUniforms = uniforms;

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

  /**
   * Unit vector pointing from the site toward the sun.
   * `azimuthDeg` is a compass bearing (0 = north, 90 = east, 180 = south).
   */
  directionFromAngles(elevationDeg, azimuthDeg) {
    const elevation = THREE.MathUtils.degToRad(elevationDeg);
    const theta = Math.PI - THREE.MathUtils.degToRad(azimuthDeg);
    return new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elevation, theta);
  }

  buildSun() {
    const config = LAYOUT.sun ?? {};
    const distance = config.distance ?? 120;

    const sun = new THREE.DirectionalLight(config.color ?? 0xfff1d8, config.intensity ?? 2.35);
    sun.name = 'sun';
    sun.position.copy(this.sunDirection).multiplyScalar(distance);
    sun.target.position.set(0, 1.2, 0);
    sun.castShadow = true;

    const shadow = sun.shadow;
    const extent = config.shadowExtent ?? 27;
    shadow.camera.left = -extent;
    shadow.camera.right = extent;
    shadow.camera.top = extent;
    shadow.camera.bottom = -extent;
    shadow.camera.near = config.shadowNear ?? 1;
    shadow.camera.far = config.shadowFar ?? 220;
    shadow.bias = config.shadowBias ?? -0.0004;
    shadow.normalBias = config.shadowNormalBias ?? 0.03;
    shadow.camera.updateProjectionMatrix();

    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.lights.push(sun);

    // Sky bounce / skylight fill. Keeps the shaded interior readable without
    // flattening the direct sun contrast.
    const hemisphere = new THREE.HemisphereLight(
      config.skylightColor ?? 0xd8e8ef,
      config.groundColor ?? 0x6c675a,
      config.skylightIntensity ?? 0.36,
    );
    hemisphere.name = 'skylight';
    hemisphere.position.set(0, 12, 0);
    this.scene.add(hemisphere);
    this.lights.push(hemisphere);

    this.buildSunDisc();

    this.scene.fog = new THREE.Fog(0xc6d2d2, 62, 260);
  }

  /**
   * Visible sun: a warm opaque core with two additive halos, kept at the same
   * bearing and elevation as the directional light. The core uses normal
   * blending so it stays a readable disc against the bright sky glare;
   * `depthWrite` is off so the disc never punches a hole in the sky dome.
   */
  buildSunDisc() {
    const config = LAYOUT.sun ?? {};
    const radius = config.discRadius ?? 2.9;
    const group = new THREE.Group();
    group.name = 'sun-disc';

    const layers = [
      { scale: 3.6, opacity: 0.045, color: 0xffd9a0, blending: THREE.AdditiveBlending },
      { scale: 2.1, opacity: 0.09, color: 0xffe6bd, blending: THREE.AdditiveBlending },
      {
        scale: 1.45,
        opacity: 0.97,
        color: config.discCoreColor ?? 0xffd9a0,
        blending: THREE.NormalBlending,
      },
    ];
    layers.forEach((layer, index) => {
      const material = new THREE.MeshBasicMaterial({
        color: layer.color,
        transparent: true,
        opacity: layer.opacity,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: layer.blending,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * layer.scale, 48), material);
      disc.renderOrder = index;
      group.add(disc);
    });

    group.position.copy(this.sunDirection).multiplyScalar(config.discDistance ?? 190);
    group.lookAt(0, 0, 0);
    this.scene.add(group);
    this.sunDisc = group;
  }

  /**
   * Move the sun at runtime. Everything that depends on the sun (sky shader,
   * directional light, shadow direction and the visible disc) follows.
   */
  setSunPosition(elevationDeg, azimuthDeg) {
    this.sunDirection.copy(this.directionFromAngles(elevationDeg, azimuthDeg));
    this.skyUniforms?.sunPosition.value.copy(this.sunDirection);

    if (this.sun) {
      this.sun.position.copy(this.sunDirection).multiplyScalar(LAYOUT.sun?.distance ?? 120);
      this.sun.target.updateMatrixWorld();
    }
    if (this.sunDisc) {
      this.sunDisc.position.copy(this.sunDirection).multiplyScalar(LAYOUT.sun?.discDistance ?? 190);
      this.sunDisc.lookAt(0, 0, 0);
    }
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

  /** Drone cutaway hides the exterior yard so buried storage reads as a plan. */
  setTopView(active) {
    if (this.exteriorGroup) this.exteriorGroup.visible = !active;
  }

  dispose() {
    for (const light of this.lights) light.parent?.remove(light);
    if (this.sunDisc) {
      this.sunDisc.traverse((child) => {
        if (child.isMesh) {
          child.geometry.dispose();
          child.material.dispose();
        }
      });
      this.scene.remove(this.sunDisc);
      this.sunDisc = null;
    }
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
