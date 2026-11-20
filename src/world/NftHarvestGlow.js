import * as THREE from 'three';

/**
 * Soft green light pools that mark harvest-ready planting positions.
 *
 * Version 13 replaced the floating white torus markers with a subtle wash of
 * green light on the NFT channel surface. The effect is a single instanced
 * draw call, has no real-time lights, never floats above the table and fades in
 * once a plant reaches its harvest-ready day. Because the pool is depth-tested
 * against the crop, it reads as table lighting rather than a ring around the
 * head, and it alpha-blends over the bright plate instead of adding to it (an
 * additive pool clips on the white surface and blooms out to a white halo).
 */

/** Seconds for a newly ready position to reach full glow. */
export const HARVEST_GLOW_FADE_SECONDS = 1.15;
/** Glow footprint across the gully, metres. Kept inside the 11 cm top plate. */
export const HARVEST_GLOW_WIDTH_M = 0.108;
/** Glow footprint along the gully, metres. */
export const HARVEST_GLOW_LENGTH_M = 0.21;
/** Lift above the perforated plate to avoid z-fighting. */
export const HARVEST_GLOW_LIFT_M = 0.0012;

let glowGeometry = null;

/** Unit plane lying in XZ, centred on the origin and facing up. */
export function getNftHarvestGlowGeometry() {
  if (glowGeometry) return glowGeometry;
  glowGeometry = new THREE.PlaneGeometry(1, 1);
  glowGeometry.rotateX(-Math.PI / 2);
  glowGeometry.name = 'nft-harvest-glow-plane';
  return glowGeometry;
}

/**
 * Radial falloff with no hard edge, so the highlight never draws a circular
 * outline. `uStrength` scales the whole effect; the gentle breathing term keeps
 * the light alive without pulsing distractingly.
 */
export function createNftHarvestGlowMaterial() {
  return new THREE.ShaderMaterial({
    name: 'nft-harvest-glow',
    uniforms: {
      uColor: { value: new THREE.Color(0x2fbf6a) },
      uStrength: { value: 0.32 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aFade;
      varying vec2 vGlowUv;
      varying float vGlowFade;
      void main() {
        vGlowUv = uv;
        vGlowFade = aFade;
        vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uTime;
      varying vec2 vGlowUv;
      varying float vGlowFade;
      void main() {
        vec2 p = (vGlowUv - 0.5) * 2.0;
        float radial = clamp(1.0 - dot(p, p), 0.0, 1.0);
        float falloff = radial * radial * (0.6 + 0.4 * radial);
        float breathing = 0.94 + 0.06 * sin(uTime * 1.5);
        float alpha = falloff * vGlowFade * uStrength * breathing;
        if (alpha <= 0.002) discard;
        gl_FragColor = vec4(uColor, alpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    // Normal (not additive) blending: additive green over the white channel
    // plate clips every channel and reads as a white bloom, so the pool tints
    // the surface instead of blowing it out.
    blending: THREE.NormalBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

function pooledCapacity(count) {
  return Math.max(8, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
}

export class NftHarvestGlow {
  /** `matrixForPlant(plant)` returns the world matrix for a ready position. */
  constructor({ matrixForPlant }) {
    this.matrixForPlant = matrixForPlant;
    this.material = createNftHarvestGlowMaterial();
    this.geometry = null;
    this.mesh = null;
    this.capacity = 0;
    this.fadeAttribute = null;
    this.plants = [];
    this.fadeStarts = new Map();
    this.time = 0;
    this.fading = false;
    this.parent = null;
  }

  build(parent) {
    this.parent = parent;
    this.ensureMesh(0);
    return this;
  }

  ensureMesh(count) {
    if (this.mesh && this.capacity >= count) return this.mesh;
    this.mesh?.removeFromParent();
    this.capacity = pooledCapacity(count);
    this.geometry?.dispose();

    // Clone the four-vertex plane so this pool owns its instance fade buffer.
    this.geometry = getNftHarvestGlowGeometry().clone();
    this.fadeAttribute = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity),
      1,
    );
    this.fadeAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aFade', this.fadeAttribute);

    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    mesh.name = 'nft-harvest-glow';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // The pool is decorative; its bounds must not cull it as the camera moves.
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.raycast = () => {};
    mesh.userData.harvestGlow = true;
    mesh.userData.sharedGeometry = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh = mesh;
    if (this.parent) this.parent.add(mesh);
    return mesh;
  }

  /** Re-sync the ready set; new positions fade in from zero. */
  sync(plants) {
    const next = new Set();
    for (const plant of plants) {
      if (!plant?.id) continue;
      next.add(plant.id);
      if (!this.fadeStarts.has(plant.id)) {
        this.fadeStarts.set(plant.id, this.time);
      }
    }
    for (const id of this.fadeStarts.keys()) {
      if (!next.has(id)) this.fadeStarts.delete(id);
    }
    this.plants = plants.slice();
    this.ensureMesh(this.plants.length);
    this.writeMatrices();
    if (this.mesh) {
      this.mesh.count = this.plants.length;
      this.mesh.visible = this.plants.length > 0;
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    this.writeFades(true);
  }

  writeMatrices() {
    if (!this.mesh) return;
    for (let index = 0; index < this.plants.length; index += 1) {
      const matrix = this.matrixForPlant(this.plants[index]);
      if (matrix) this.mesh.setMatrixAt(index, matrix);
    }
  }

  writeFades(force) {
    if (!this.fadeAttribute) return;
    const array = this.fadeAttribute.array;
    let changed = force;
    let pending = false;
    for (let index = 0; index < this.plants.length; index += 1) {
      const start = this.fadeStarts.get(this.plants[index].id) ?? 0;
      const t = THREE.MathUtils.clamp(
        (this.time - start) / HARVEST_GLOW_FADE_SECONDS,
        0,
        1,
      );
      const fade = t * t * (3 - 2 * t);
      if (fade < 1) pending = true;
      if (array[index] !== fade) {
        array[index] = fade;
        changed = true;
      }
    }
    for (let index = this.plants.length; index < this.capacity; index += 1) {
      array[index] = 0;
    }
    this.fading = pending;
    if (changed) this.fadeAttribute.needsUpdate = true;
  }

  update(dt = 0) {
    this.time += Math.max(0, Number(dt) || 0);
    this.material.uniforms.uTime.value = this.time;
    if (this.fading) this.writeFades(false);
  }

  dispose() {
    this.mesh?.removeFromParent();
    this.geometry?.dispose();
    this.material.dispose();
    this.mesh = null;
    this.geometry = null;
    this.fadeAttribute = null;
    this.parent = null;
    this.plants = [];
    this.fadeStarts.clear();
  }
}
