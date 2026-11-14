import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { boxMesh } from './Batches.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Yellow sticky traps clipped to the structural columns (Version 3).
 *
 * Each card is double-sided, carries an inspection label, and holds a
 * deterministic scatter of caught insects. Press E on a card to record an
 * inspection; the card brightens briefly and the caught count is reported.
 */
export class StickyTraps {
  constructor({ materials }) {
    this.materials = materials;
    this.group = null;
    this.traps = [];
    this.interactables = [];
    this.labelMaterials = [];
    this.runningTime = 0;
  }

  build(parent) {
    const config = LAYOUT.traps;
    const group = new THREE.Group();
    group.name = 'sticky-traps';
    this.group = group;
    parent.add(group);

    const cardMaterial = this.materials.createLabelMaterial('STICKY TRAP', 'PEST MONITOR · WEEK 12', {
      background: '#f2c737',
      foreground: '#3a2c05',
    });
    this.labelMaterials.push(cardMaterial);
    const edgeMaterial = new THREE.MeshStandardMaterial({
      name: 'sticky-trap-edge',
      color: '#d6a91f',
      roughness: 0.82,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    this.labelMaterials.push(edgeMaterial);

    config.positions.forEach(([x, z], index) => {
      const faceEast = x < 0;
      const offset = faceEast ? config.offset : -config.offset;
      const rotation = faceEast ? Math.PI / 2 : -Math.PI / 2;

      const trap = new THREE.Group();
      trap.name = `sticky-trap-${index + 1}`;
      trap.position.set(x + offset, 0, z);
      trap.rotation.y = rotation;
      group.add(trap);

      // Card and its darker rim, both double-sided so the trap reads from the
      // adjacent aisle as well as from the table bay.
      const card = new THREE.Mesh(new THREE.PlaneGeometry(config.width, config.height), cardMaterial);
      card.position.y = 1.34;
      card.castShadow = true;
      trap.add(card);
      const rim = new THREE.Mesh(
        new THREE.PlaneGeometry(config.width + 0.018, config.height + 0.018),
        edgeMaterial,
      );
      rim.position.set(0, 1.34, -0.002);
      trap.add(rim);

      // Wire hanger and clip back to the column.
      const clip = boxMesh(0.05, 0.07, 0.035, this.materials.stainless, V(0, 1.34 + config.height / 2 + 0.03, 0.018), 'trap-clip');
      trap.add(clip);
      const wire = new THREE.Mesh(
        new THREE.TorusGeometry(0.045, 0.006, 5, 12, Math.PI * 1.35),
        this.materials.stainless,
      );
      wire.position.set(0, 1.34 + config.height / 2 + 0.09, 0.02);
      wire.rotation.z = Math.PI * 0.18;
      trap.add(wire);

      // Caught insects: a deterministic scatter that never sits on the label.
      const caught = 4 + ((index * 7 + 3) % 9);
      const insectMaterial = this.materials.steelDark;
      for (let insect = 0; insect < caught; insect += 1) {
        const angle = (insect * 2.399 + index * 1.13) % (Math.PI * 2);
        const radius = 0.028 + ((insect * 37 + index * 11) % 70) / 1000;
        const speck = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 5, 4), insectMaterial);
        speck.scale.set(1.5, 1, 0.4);
        speck.position.set(
          Math.cos(angle) * radius,
          1.34 + Math.sin(angle) * radius * 1.3,
          0.006,
        );
        trap.add(speck);
      }

      // Small numbered tag at the foot of the column.
      const tag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.16, 0.055),
        this.materials.createLabelMaterial(`TRAP ${String(index + 1).padStart(2, '0')}`, 'STICKY', {
          background: '#f7e9a6',
          foreground: '#4a3708',
        }),
      );
      this.labelMaterials.push(tag.material);
      tag.position.set(0, 0.72, 0.004);
      trap.add(tag);

      const info = {
        id: `sticky-trap-${index + 1}`,
        category: 'Crop protection',
        title: `Sticky trap ${String(index + 1).padStart(2, '0')}`,
        description:
          'Yellow double-sided monitoring card clipped to a structural column. Yellow attracts whitefly, thrips and fungus gnats; the caught insects are counted weekly to track pest pressure before it reaches a treatment threshold.',
        specs: [
          ['Position', `Column ${x}, ${z}`],
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
      this.traps.push({ index, group: trap, card, caught, lastInspection: -100 });
    });

    group.userData.interactables = this.interactables;
    return this;
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
    }
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
    this.interactables.length = 0;
    this.traps.length = 0;
  }
}
