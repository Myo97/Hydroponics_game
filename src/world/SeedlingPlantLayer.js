import * as THREE from 'three';
import {
  getCropPlantGeometry,
  getSubstratePlugGeometry,
  resolveCropVariety,
  visualScaleForDay,
  variantForPlant,
} from '../simulation/GreenCoralGrowth.js';

const tempObject = new THREE.Object3D();
const ease = (value) => value * value * (3 - 2 * value);


/**
 * Instanced seedling canopy for one tray.
 *
 * Geometry and materials are shared globally; this class only owns instance
 * matrices. Near trays use detailed leaf meshes and split rare leaf-count
 * variants into separate draw calls. Distant trays collapse to one simplified
 * instanced rosette per tray, which keeps the full 36-tray house affordable.
 */
export class SeedlingPlantLayer {
  constructor({ materials, parent = null }) {
    this.materials = materials;
    this.group = new THREE.Group();
    this.group.name = 'seedling-canopy';
    if (parent) parent.add(this.group);

    this.plan = null;
    this.stage = 0;
    this.day = 1;
    this.visualDay = 1;
    this.cropName = 'Green Coral Lettuce';
    this.transitionElapsed = 0;
    this.transitionDuration = 1.25;
    this.detailed = false;
    this.showSubstrate = false;
    this.buckets = [];
    this.substrate = null;
    this.signature = '';

    this.leafSets = {
      green: [1, 2, 3, 4, 5].map(
        (stage) => materials[`seedlingLeaf${stage}`] ?? materials.nurseryTrayCells,
      ),
      red: [1, 2, 3, 4, 5].map(
        (stage) => materials[`cropLeafRed${stage}`] ?? materials.seedlingLeaf5,
      ),
      'red-coral': [1, 2, 3, 4, 5].map(
        (stage) => materials[`cropLeafRedCoral${stage}`] ?? materials.cropLeafRed3,
      ),
      pale: [1, 2, 3, 4, 5].map(
        (stage) => materials[`cropLeafPale${stage}`] ?? materials.seedlingLeaf4,
      ),
    };
    this.leafMaterials = this.leafSets.green;
    this.substrateMaterial = materials.seedlingSubstrate ?? materials.nurseryTrayCells;
  }

  materialsForCrop(cropName) {
    const set = resolveCropVariety(cropName).materialSet;
    return this.leafSets[set] ?? this.leafSets.green;
  }

  setState({ plan, stage, day, cropName = this.cropName, detailed = false }) {
    const previousPlan = this.plan;
    const previousStage = this.stage;
    const nextDay = Math.max(1, Math.round(Number(day) || 1));
    const varietyKey = resolveCropVariety(cropName).key;
    const grew =
      Boolean(previousPlan) &&
      previousPlan === plan &&
      stage >= previousStage &&
      nextDay > this.day &&
      varietyKey === resolveCropVariety(this.cropName).key;
    const nextSignature = `${varietyKey}:${plan?.seed ?? 'none'}:${stage}:${nextDay}:${detailed ? 1 : 0}`;
    const samePlan = this.plan === plan;
    const needsGeometry = !samePlan || this.signature !== nextSignature;

    this.plan = plan;
    this.stage = stage;
    this.day = nextDay;
    this.cropName = cropName;
    this.detailed = detailed;
    this.showSubstrate = Boolean(plan) && stage >= 1 && stage <= 2;

    if (grew) {
      const displayed = this.visualDay < nextDay ? this.visualDay : nextDay - 1;
      this.visualDay = displayed;
      this.transitionElapsed = 0;
      this.transitionDuration = Math.min(2.2, 0.85 + (nextDay - displayed) * 0.24);
    } else if (needsGeometry) {
      this.visualDay = nextDay;
      this.transitionElapsed = this.transitionDuration;
    }

    if (needsGeometry) {
      this.buildGeometry();
    } else if (plan) {
      this.updateMatrices();
    }
  }

  setDetail(detailed) {
    if (this.detailed === detailed) return;
    this.detailed = detailed;
    if (this.plan && this.stage > 0) this.buildGeometry();
  }

  setVisible(visible) {
    this.group.visible = Boolean(visible);
  }

  buildGeometry() {
    this.clearGeometry();
    const varietyKey = resolveCropVariety(this.cropName).key;
    this.signature = `${varietyKey}:${this.plan?.seed ?? 'none'}:${this.stage}:${this.day}:${this.detailed ? 1 : 0}`;
    if (!this.plan || this.stage < 1) return;
    const leafMaterials = this.materialsForCrop(this.cropName);

    const groups = new Map();
    for (let cell = 0; cell < this.plan.cells; cell += 1) {
      if (!this.plan.germination[cell]) continue;
      const variant =
        this.stage === 1 ? 0 : variantForPlant(this.plan, cell, this.stage, this.detailed);
      if (!groups.has(variant)) groups.set(variant, []);
      groups.get(variant).push(cell);
    }

    for (const [variant, cells] of groups) {
      const geometry = getCropPlantGeometry(
        this.cropName,
        this.stage,
        this.day,
        variant,
        this.detailed,
      );
      const mesh = new THREE.InstancedMesh(
        geometry,
        leafMaterials[this.stage - 1],
        cells.length,
      );
      mesh.name = `seedling-canopy-day-${this.day}-variant-${variant}`;
      mesh.castShadow = this.detailed;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData.sharedGeometry = true;
      this.group.add(mesh);
      this.buckets.push({ mesh, cells, variant });
    }

    if (this.showSubstrate) {
      const geometry = getSubstratePlugGeometry(this.detailed);
      const mesh = new THREE.InstancedMesh(
        geometry,
        this.substrateMaterial,
        this.plan.cells,
      );
      mesh.name = 'seedling-substrate-plugs';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData.sharedGeometry = true;
      this.group.add(mesh);
      this.substrate = mesh;
    }

    this.updateMatrices();
  }

  /** Advance the visual transition only; growth itself is calendar driven. */
  update(dt) {
    if (!this.plan || this.stage < 1) return false;
    if (this.visualDay >= this.day) return false;
    this.transitionElapsed = Math.min(
      this.transitionDuration,
      this.transitionElapsed + Math.max(0, dt),
    );
    const t = ease(this.transitionElapsed / this.transitionDuration);
    this.visualDay = this.day - (this.day - this.visualDay) * (1 - t);
    if (this.transitionElapsed >= this.transitionDuration) this.visualDay = this.day;
    this.updateMatrices();
    return true;
  }

  updateMatrices() {
    if (!this.plan) return;
    const targetScale = visualScaleForDay(this.day);
    const displayScale = visualScaleForDay(this.visualDay);
    const correction = THREE.MathUtils.clamp(
      displayScale / Math.max(0.001, targetScale),
      0.45,
      1,
    );
    for (const bucket of this.buckets) {
      bucket.cells.forEach((cell, instance) => {
        tempObject.position.set(
          this.plan.cellX[cell],
          0,
          this.plan.cellZ[cell],
        );
        tempObject.rotation.set(
          this.plan.leanX[cell],
          this.plan.rotation[cell],
          this.plan.leanZ[cell],
          'YXZ',
        );
        const plantScale = this.plan.scale[cell] * correction;
        tempObject.scale.setScalar(plantScale);
        tempObject.updateMatrix();
        bucket.mesh.setMatrixAt(instance, tempObject.matrix);
      });
      bucket.mesh.instanceMatrix.needsUpdate = true;
      bucket.mesh.computeBoundingSphere();
    }

    if (this.substrate) {
      for (let cell = 0; cell < this.plan.cells; cell += 1) {
        tempObject.position.set(this.plan.cellX[cell], 0, this.plan.cellZ[cell]);
        tempObject.rotation.set(0, 0, 0);
        tempObject.scale.setScalar(1);
        tempObject.updateMatrix();
        this.substrate.setMatrixAt(cell, tempObject.matrix);
      }
      this.substrate.instanceMatrix.needsUpdate = true;
      this.substrate.computeBoundingSphere();
    }
  }

  clearGeometry() {
    for (const bucket of this.buckets) {
      bucket.mesh.removeFromParent();
      bucket.mesh.dispose();
    }
    this.buckets.length = 0;
    if (this.substrate) {
      this.substrate.removeFromParent();
      this.substrate.dispose();
      this.substrate = null;
    }
  }

  get instanceCount() {
    return this.buckets.reduce((total, bucket) => total + bucket.cells.length, 0);
  }

  dispose() {
    this.clearGeometry();
    this.group.removeFromParent();
    this.plan = null;
  }
}
