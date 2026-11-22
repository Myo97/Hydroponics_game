import { LowPolySphereGeometry, LowPolyTorusGeometry } from './LowPolyGeometry.js';
import * as THREE from 'three';
import { LAYOUT, GUTTER_X, FRAME_Z } from '../config/layout.js';

/** Gap between the card face and the steelwork it hangs on. */
const CARD_CLEARANCE = 0.014;

const nearestGridLine = (values, value) =>
  values.reduce(
    (best, candidate) => (Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best),
    values[0],
  );

/**
 * Resolve a trap anchor to the actual side face of the nearest structural
 * column. The column grid is the same one the frame is built from, and the
 * section size comes from the frame description, so the card sits flush against
 * the steel instead of floating in the aisle.
 */
function columnMount(x, z, frame) {
  const columnX = nearestGridLine(frame.gutterXs, x);
  const columnZ = nearestGridLine(frame.frameZs, z);
  if (Math.abs(columnX - x) > 1e-3 || Math.abs(columnZ - z) > 1e-3) {
    console.warn(
      `Sticky trap at (${x}, ${z}) is not on a column; snapped to (${columnX}, ${columnZ}).`,
    );
  }

  const section =
    Math.abs(Math.abs(columnX) - frame.halfWidth) < 1e-6
      ? frame.perimeterColumnSize
      : frame.columnSize;
  // Cards face the centre of the house so they stay readable from the aisle.
  const face = columnX <= 0 ? 1 : -1;

  return {
    face,
    columnX,
    columnZ,
    x: columnX + face * (section / 2 + CARD_CLEARANCE),
    z: columnZ,
  };
}

const _visualMatrix = new THREE.Matrix4();

const DEFAULT_FRAME = {
  gutterXs: GUTTER_X,
  frameZs: FRAME_Z,
  halfWidth: LAYOUT.greenhouse.width / 2,
  perimeterColumnSize: LAYOUT.greenhouse.perimeterColumnSize,
  columnSize: LAYOUT.greenhouse.columnSize,
};

/**
 * Yellow sticky traps clipped to the structural columns (Version 3).
 *
 * Each card is double-sided and holds a deterministic scatter of caught insects.
 * There is no printed label on the card: colour alone identifies the monitor.
 * Tap a card to record an inspection; the card brightens briefly and the
 * caught count is reported.
 *
 * The component is reusable: pass `config` and a local `frame` grid to mount the
 * same cards on a second glasshouse. Without either option it reproduces the
 * original twelve main-house traps exactly.
 */
export class StickyTraps {
  constructor({
    materials,
    config = LAYOUT.traps,
    frame = null,
    idPrefix = 'sticky-trap',
    groupName = 'sticky-traps',
    buildingId = null,
  }) {
    this.materials = materials;
    this.config = config;
    this.frame = { ...DEFAULT_FRAME, ...(frame ?? {}) };
    this.idPrefix = idPrefix;
    this.groupName = groupName;
    this.buildingId = buildingId;
    this.group = null;
    this.traps = [];
    this.interactables = [];
    this.labelMaterials = [];
    this.runningTime = 0;
  }

  build(parent) {
    const config = this.config;
    const group = new THREE.Group();
    group.name = this.groupName;
    this.group = group;
    parent.add(group);

    // Plain yellow card stock — no printed text or numbering.
    const cardMaterial = new THREE.MeshStandardMaterial({ flatShading: true,
      name: 'sticky-trap-yellow',
      color: '#f2c737',
      roughness: 0.74,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    this.labelMaterials.push(cardMaterial);
    const edgeMaterial = new THREE.MeshStandardMaterial({ flatShading: true,
      name: 'sticky-trap-edge',
      color: '#d6a91f',
      roughness: 0.82,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    this.labelMaterials.push(edgeMaterial);

    const cardGeometry = new THREE.PlaneGeometry(config.width, config.height);
    const rimGeometry = new THREE.PlaneGeometry(config.width + 0.018, config.height + 0.018);
    const clipGeometry = new THREE.BoxGeometry(0.05, 0.07, 0.035);
    const wireGeometry = new LowPolyTorusGeometry(0.045, 0.006, 5, 12, Math.PI * 1.35);
    const insectGeometry = new LowPolySphereGeometry(0.0035, 5, 4);
    const instances = {
      cards: [],
      rims: [],
      clips: [],
      wires: [],
      insects: [],
    };

    config.positions.forEach(([x, z], index) => {
      const mount = columnMount(x, z, this.frame);
      const cardY = config.cardY ?? 1.34;

      const trap = new THREE.Group();
      trap.name = `${this.idPrefix}-${index + 1}`;
      trap.position.set(mount.x, 0, mount.z);
      trap.rotation.y = mount.face > 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(trap);
      trap.updateMatrix();

      // Invisible pick proxy; the visible card stock is instanced below.
      const card = new THREE.Mesh(cardGeometry, cardMaterial);
      card.position.y = cardY;
      card.visible = false;
      card.userData.suppressHighlight = true;
      trap.add(card);

      const local = (position, rotation = null, scale = null) =>
        new THREE.Matrix4().compose(
          position,
          rotation ?? new THREE.Quaternion(),
          scale ?? new THREE.Vector3(1, 1, 1),
        );
      instances.cards.push({ trapIndex: index, local: local(new THREE.Vector3(0, cardY, 0)) });
      instances.rims.push({
        trapIndex: index,
        local: local(new THREE.Vector3(0, cardY, -0.002)),
      });
      instances.clips.push({
        trapIndex: index,
        local: local(new THREE.Vector3(0, cardY + config.height / 2 + 0.03, -CARD_CLEARANCE / 2)),
      });
      instances.wires.push({
        trapIndex: index,
        local: local(
          new THREE.Vector3(0, cardY + config.height / 2 + 0.09, 0.02),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI * 0.18)),
        ),
      });

      // Caught insects: a deterministic scatter kept clear of the card centre.
      const caught = 4 + ((index * 7 + 3) % 9);
      for (let insect = 0; insect < caught; insect += 1) {
        const angle = (insect * 2.399 + index * 1.13) % (Math.PI * 2);
        const radius = 0.028 + ((insect * 37 + index * 11) % 70) / 1000;
        instances.insects.push({
          trapIndex: index,
          local: local(
            new THREE.Vector3(
              Math.cos(angle) * radius,
              cardY + Math.sin(angle) * radius * 1.3,
              0.006,
            ),
            null,
            new THREE.Vector3(1.5, 1, 0.4),
          ),
        });
      }

      const info = {
        id: `${this.idPrefix}-${index + 1}`,
        buildingId: this.buildingId,
        category: 'Crop protection',
        title: `Sticky trap ${String(index + 1).padStart(2, '0')}`,
        description:
          'Yellow double-sided monitoring card clipped to a structural column. Yellow attracts whitefly, thrips and fungus gnats; the caught insects are counted weekly to track pest pressure before it reaches a treatment threshold.',
        specs: [
          ['Position', `Column ${mount.columnX}, ${mount.columnZ}`],
          ['Caught this week', `${caught} insects`],
          ['Threshold', '25 insects / card / week'],
          ['Replacement', 'Every 3 weeks'],
          ['Action', caught >= 25 ? 'Treat now' : 'Continue monitoring'],
        ],
        interactionHint: 'Inspect sticky trap',
        interaction: 'inspect-trap',
        trapIndex: index,
        caught,
      };
      card.userData.interactable = info;
      this.interactables.push({ object: card, data: info });
      this.traps.push({ index, mount, group: trap, card, caught, lastInspection: -100 });
    });

    const makeInstances = (name, geometry, material, entries, castShadow = false) => {
      const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
      mesh.name = name;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.sharedGeometry = true;
      group.add(mesh);
      return mesh;
    };
    this.visuals = {
      cards: makeInstances('sticky-cards', cardGeometry, cardMaterial, instances.cards, true),
      rims: makeInstances('sticky-card-rims', rimGeometry, edgeMaterial, instances.rims),
      clips: makeInstances('sticky-clips', clipGeometry, this.materials.stainless, instances.clips),
      wires: makeInstances('sticky-wires', wireGeometry, this.materials.stainless, instances.wires),
      insects: makeInstances(
        'sticky-caught-insects',
        insectGeometry,
        this.materials.steelDark,
        instances.insects,
      ),
    };
    this.instanceData = instances;
    this.instanceKeys = Object.keys(instances);
    this.applyVisualMatrices();

    group.userData.interactables = this.interactables;
    return this;
  }

  applyVisualMatrices() {
    if (!this.visuals || !this.instanceData) return;
    const matrix = _visualMatrix;
    for (const key of this.instanceKeys ?? []) {
      const list = this.instanceData[key];
      const mesh = this.visuals[key];
      if (!mesh) continue;
      for (let index = 0; index < list.length; index += 1) {
        const entry = list[index];
        const trap = this.traps[entry.trapIndex];
        if (!trap) continue;
        const pulse =
          key === 'cards'
            ? Math.max(0.94, trap.card?.scale.x ?? 1)
            : 1;
        matrix.makeScale(pulse, pulse, pulse).premultiply(entry.local);
        matrix.premultiply(trap.group.matrix);
        mesh.setMatrixAt(index, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Record a manual inspection; returns the caught count and threshold state. */
  inspect(index) {
    const trap = this.traps[index];
    if (!trap) return null;
    trap.lastInspection = this.runningTime;
    return {
      caught: trap.caught,
      threshold: 25,
      action: trap.caught >= 25 ? 'Treat now' : 'Continue monitoring',
    };
  }

  update(dt) {
    if (!this.group) return;
    this.runningTime += dt;
    for (const trap of this.traps) {
      const sinceInspection = this.runningTime - trap.lastInspection;
      const pulse = sinceInspection < 1.4 ? 1 + Math.sin(sinceInspection * 9) * 0.06 : 1;
      trap.card.scale.setScalar(pulse);
      // Barely perceptible air movement keeps the cards alive without noise.
      trap.group.rotation.z = Math.sin(this.runningTime * 0.7 + trap.index) * 0.006;
      trap.group.updateMatrix();
    }
    this.applyVisualMatrices();
  }

  setTopView(active) {
    this.topView = Boolean(active);
  }

  dispose() {
    if (!this.group) return;
    this.group.parent?.remove(this.group);
    for (const material of this.labelMaterials) material.dispose();
    this.group.traverse((object) => {
      if (!object.geometry) return;
      if (object.userData.sharedGeometry) return;
      object.geometry.dispose();
    });
    this.group = null;
    this.visuals = null;
    this.instanceData = null;
    this.interactables.length = 0;
    this.traps.length = 0;
  }
}
