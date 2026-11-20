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
    this.shadowSunElevation = null;
    this.shadowSunAzimuth = null;
    this.shadowSunVisible = null;
    this.sunChanged = true;
    const greenhouse = LAYOUT.greenhouse ?? {};
    const nursery = LAYOUT.nursery ?? {};
    this.rainUniforms = {
      uTime: { value: 0 },
      uHouseA: {
        value: new THREE.Vector4(
          greenhouse.centre?.[0] ?? 0,
          greenhouse.centre?.[1] ?? 0,
          (greenhouse.width ?? 0) / 2 + 0.5,
          (greenhouse.length ?? 0) / 2 + 0.5,
        ),
      },
      uHouseB: {
        value: new THREE.Vector4(
          nursery.centre?.[0] ?? 1000,
          nursery.centre?.[1] ?? 1000,
          (nursery.width ?? 0) / 2 + 0.5,
          (nursery.length ?? 0) / 2 + 0.5,
        ),
      },
    };
    this.nightFogColor = new THREE.Color(0x0b1420);
    this.rainFogColor = new THREE.Color(0x87969b);
  }

  build() {
    this.buildSky();
    this.buildSun();
    this.buildExterior();
    this.buildWeather();
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

    if (this.renderer) {
      try {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.envRenderTarget = pmrem.fromScene(envScene, 0.02, 1, 100000);
        this.scene.environment = this.envRenderTarget.texture;
        pmrem.dispose();
      } catch (error) {
        console.warn('Environment map generation failed, using lights only.', error);
      }
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
    sun.target.position.set(0, 1.2, config.shadowTargetZ ?? 0);
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
    this.sunBaseIntensity = config.intensity ?? 2.35;
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
    this.hemisphere = hemisphere;
    this.hemisphereBaseIntensity = config.skylightIntensity ?? 0.36;
    this.lights.push(hemisphere);

    // Low blue night fill so the glasshouse remains inspectable after sunset.
    const moon = new THREE.DirectionalLight(0x9cb9d8, 0);
    moon.name = 'moonlight';
    moon.position.set(-28, 42, 22);
    moon.target.position.set(0, 1.2, 0);
    this.scene.add(moon);
    this.scene.add(moon.target);
    this.moon = moon;
    this.lights.push(moon);

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

  /** True when a point sits under a glasshouse roof, so rain stops at the glass. */
  isInsideRoof(x, z, margin = 0.5) {
    return [LAYOUT.greenhouse, LAYOUT.nursery].filter(Boolean).some((house) => {
      const [centreX, centreZ] = house.centre ?? [0, 0];
      return (
        Math.abs(x - centreX) < house.width / 2 + margin &&
        Math.abs(z - centreZ) < house.length / 2 + margin
      );
    });
  }

  /** Stars, a drifting cloud deck and an exterior rain particle field. */
  buildWeather() {
    const starCount = this.preset?.id === 'low' ? 280 : 620;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const elevation = 0.12 + Math.random() * 1.36;
      const radius = 330;
      starPositions[i * 3] = Math.cos(theta) * Math.cos(elevation) * radius;
      starPositions[i * 3 + 1] = Math.sin(elevation) * radius;
      starPositions[i * 3 + 2] = Math.sin(theta) * Math.cos(elevation) * radius;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({
      color: 0xdbe8ff,
      size: 1.35,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const stars = new THREE.Points(starGeometry, starMaterial);
    stars.name = 'night-stars';
    stars.visible = false;
    this.scene.add(stars);
    this.stars = stars;

    const cloudMaterial = new THREE.MeshStandardMaterial({
      name: 'cloud-deck',
      color: 0xdde5e8,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    });
    const clouds = new THREE.Group();
    clouds.name = 'cloud-deck';
    for (let i = 0; i < 12; i += 1) {
      const cloud = new THREE.Mesh(
        new THREE.SphereGeometry(1, 10, 6),
        cloudMaterial,
      );
      const angle = (i / 12) * Math.PI * 2;
      const radius = 22 + (i % 4) * 9;
      cloud.position.set(
        Math.cos(angle) * radius,
        30 + (i % 3) * 2.4,
        Math.sin(angle) * radius,
      );
      cloud.scale.set(5.4 + (i % 3) * 1.8, 1.1, 2.4 + (i % 4) * 0.8);
      cloud.userData.drift = 0.16 + (i % 5) * 0.035;
      clouds.add(cloud);
    }
    clouds.visible = false;
    this.scene.add(clouds);
    this.clouds = clouds;
    this.cloudMaterial = cloudMaterial;

    const rainCount = this.preset?.id === 'low' ? 700 : 1500;
    const rainPositions = new Float32Array(rainCount * 3);
    const rainSpeeds = new Float32Array(rainCount);
    for (let i = 0; i < rainCount; i += 1) {
      const x = (Math.random() - 0.5) * 64;
      const z = -28 + Math.random() * 78;
      const insideRoof = this.isInsideRoof(x, z);
      rainPositions[i * 3] = x;
      rainPositions[i * 3 + 1] = insideRoof ? 6 + Math.random() * 19 : Math.random() * 26;
      rainPositions[i * 3 + 2] = z;
      rainSpeeds[i] = 13 + Math.random() * 8;
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    rainGeometry.setAttribute('aSpeed', new THREE.BufferAttribute(rainSpeeds, 1));
    const rainMaterial = new THREE.PointsMaterial({
      color: 0xb7d6e2,
      size: 0.075,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    });
    // Wrap each drop on the GPU. Static positions stay uploaded; only uTime
    // changes per frame, so rain no longer rewrites/uploads 1,500 positions.
    rainMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.rainUniforms.uTime;
      shader.uniforms.uHouseA = this.rainUniforms.uHouseA;
      shader.uniforms.uHouseB = this.rainUniforms.uHouseB;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform vec4 uHouseA;
          uniform vec4 uHouseB;
          attribute float aSpeed;`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
          transformed.x = mod(position.x + uTime * 0.7 + 32.0, 64.0) - 32.0;
          float rainFloor = 0.0;
          if (abs(transformed.x - uHouseA.x) < uHouseA.z && abs(transformed.z - uHouseA.y) < uHouseA.w) rainFloor = 5.2;
          if (abs(transformed.x - uHouseB.x) < uHouseB.z && abs(transformed.z - uHouseB.y) < uHouseB.w) rainFloor = 5.2;
          float rainSpan = 26.0 - rainFloor;
          transformed.y = rainFloor + mod(position.y - rainFloor - uTime * aSpeed, rainSpan);`,
        );
    };
    rainMaterial.customProgramCacheKey = () => 'verde-gpu-rain-v1';
    const rain = new THREE.Points(rainGeometry, rainMaterial);
    rain.name = 'rain-field';
    rain.visible = false;
    this.scene.add(rain);
    this.rain = rain;
    this.rainPositions = rainPositions;
    this.rainSpeeds = rainSpeeds;
    this.rainMaterial = rainMaterial;
  }

  /**
   * Drive sky, sun, fill light, stars, clouds and rain from the climate clock.
   * Lighting and visible sky elements always derive from the same snapshot.
   */
  update(dt, climate) {
    if (!climate) return;
    const config = LAYOUT.sun ?? {};
    const elevation = climate.sunElevationDeg;
    const azimuth = climate.sunAzimuthDeg;
    const dayAmount = THREE.MathUtils.clamp((elevation + 2) / 8, 0, 1);
    const directAmount = THREE.MathUtils.clamp(elevation / 14, 0, 1);
    const weatherFactor = climate.weatherState.ppfdFactor;
    const raining = (climate.rainIntensity ?? 0) > 0;
    const night = 1 - dayAmount;

    // Climate azimuth is 0=east / 90=south / 180=west; the sky helper expects
    // a compass bearing where 0=north / 90=east / 180=south.
    this.setSunPosition(
      THREE.MathUtils.clamp(elevation, -18, 90),
      (azimuth + 90) % 360,
    );

    const sunVisible = elevation > -1;
    this.sunChanged =
      !Number.isFinite(this.shadowSunElevation) ||
      Math.abs(elevation - this.shadowSunElevation) > 0.04 ||
      Math.abs(azimuth - this.shadowSunAzimuth) > 0.04 ||
      sunVisible !== this.shadowSunVisible;
    this.shadowSunElevation = elevation;
    this.shadowSunAzimuth = azimuth;
    this.shadowSunVisible = sunVisible;

    this.sun.visible = sunVisible;
    this.sun.intensity = this.sunBaseIntensity * directAmount * weatherFactor;
    this.sun.color.setHSL(
      0.105 - night * 0.04,
      0.46 - night * 0.15,
      0.94 - night * 0.25,
    );

    this.hemisphere.intensity =
      0.11 +
      dayAmount *
        Math.max(0, this.hemisphereBaseIntensity - 0.11) *
        weatherFactor;
    this.hemisphere.color.setHex(
      night > 0.6 ? 0x607a9a : config.skylightColor ?? 0xd8e8ef,
    );
    this.moon.intensity = night * 0.26;

    this.skyUniforms.turbidity.value = 3.2 + (1 - weatherFactor) * 8;
    this.skyUniforms.rayleigh.value =
      1.7 + night * 0.5 - (1 - weatherFactor) * 0.35;
    this.skyUniforms.mieCoefficient.value = 0.003 + (1 - weatherFactor) * 0.006;

    if (this.sunDisc) {
      this.sunDisc.visible = elevation > 0.4;
      this.sunDisc.traverse((child) => {
        if (child.isMesh) {
          const base = child.userData.baseOpacity ?? child.material.opacity;
          child.userData.baseOpacity = base;
          child.material.opacity = base * (1 - (1 - weatherFactor) * 0.7);
        }
      });
    }

    this.stars.visible = night > 0.55;
    this.stars.material.opacity = THREE.MathUtils.clamp(
      (night - 0.35) * 1.6,
      0,
      0.9,
    );
    this.stars.rotation.y += dt * 0.003;

    const cloudCover =
      climate.weatherState?.cloudCover ??
      (climate.rainIntensity > 0.5 ? 0.95 : climate.rainIntensity > 0 ? 0.7 : 0.1);
    this.clouds.visible = cloudCover > 0.18;
    this.cloudMaterial.opacity = cloudCover * 0.46;
    this.cloudMaterial.color.setHex(
      cloudCover > 0.9 ? 0x9fabb0 : cloudCover > 0.65 ? 0xb9c2c5 : 0xdde5e8,
    );
    for (const cloud of this.clouds.children) {
      cloud.position.x += dt * cloud.userData.drift * (cloudCover > 0.65 ? 2.2 : 1);
      if (cloud.position.x > 42) cloud.position.x = -42;
    }

    const rainIntensity = climate.rainIntensity;
    this.rain.visible = rainIntensity > 0.02 && !this.topView;
    this.rainMaterial.opacity = 0.22 + rainIntensity * 0.5;
    if (this.rain.visible && dt > 0) {
      this.rainUniforms.uTime.value += dt;
    }

    const fogColor = this.scene.fog?.color;
    if (fogColor) {
      fogColor.setHex(0xc6d2d2).lerp(this.nightFogColor, night * 0.88);
      if (raining) fogColor.lerp(this.rainFogColor, 0.35);
    }
    if (this.scene.fog) {
      this.scene.fog.near = raining ? 38 : this.preset?.id === 'low' ? 48 : 62;
      this.scene.fog.far = raining ? 190 : 260;
    }
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

    // Entrance bollards, kept clear of the nursery footprint in front.
    for (const x of [-3.6, 3.6]) {
      const bollard = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 0.9, 12),
        this.materials.steel,
      );
      bollard.position.set(x, 0.45, 19.6);
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
    this.topView = active;
    if (this.exteriorGroup) this.exteriorGroup.visible = !active;
    if (this.rain) this.rain.visible = false;
  }

  dispose() {
    for (const light of this.lights) {
      light.target?.removeFromParent?.();
      light.parent?.remove(light);
    }
    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky.geometry.dispose();
      this.sky.material.dispose();
      this.sky = null;
    }
    this.skyUniforms = null;
    if (this.stars) {
      this.stars.geometry.dispose();
      this.stars.material.dispose();
      this.scene.remove(this.stars);
      this.stars = null;
    }
    if (this.clouds) {
      this.clouds.traverse((child) => {
        if (child.isMesh) child.geometry.dispose();
      });
      this.cloudMaterial?.dispose();
      this.scene.remove(this.clouds);
      this.clouds = null;
    }
    if (this.rain) {
      this.rain.geometry.dispose();
      this.rainMaterial.dispose();
      this.scene.remove(this.rain);
      this.rain = null;
    }
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
  }
}
