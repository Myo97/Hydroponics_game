import * as THREE from 'three';
import { LAYOUT, DIM, FRAME_Z, GUTTER_X } from '../config/layout.js';
import { BeamBatch, CylinderBatch } from './Batches.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Horizontal retractable-type shade deck at the truss bottom-chord level.
 * A woven, part-transparent cloth spans the house on a grid of tension wires,
 * with edge rails and short hangers from the trusses. The glass roof remains
 * untouched above it.
 */
export class ShadeScreen {
  constructor({ materials }) {
    this.materials = materials;
    this.group = null;
    this.screen = null;
    this.interactables = [];
    this.height = LAYOUT.shade.height;
  }

  build(parent) {
    const group = new THREE.Group();
    group.name = 'shade-screen';
    this.group = group;
    parent.add(group);

    const width = DIM.halfWidth * 2 - LAYOUT.shade.insetX * 2;
    const depth = DIM.halfLength * 2 - LAYOUT.shade.insetZ * 2;
    const y = this.height;

    // Cloth is one plane so the alpha weave reads evenly across the whole house.
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      this.materials.shadeCloth,
    );
    cloth.name = 'shade-cloth-deck';
    cloth.rotation.x = -Math.PI / 2;
    cloth.position.set(0, y, 0);
    cloth.receiveShadow = false;
    cloth.castShadow = false;
    cloth.renderOrder = 1;
    group.add(cloth);
    this.screen = cloth;

    // Longitudinal tension wires under the cloth.
    const wires = new CylinderBatch(this.materials.steelDark, {
      castShadow: false,
      receiveShadow: false,
    });
    for (let x = -DIM.halfWidth + 1; x < DIM.halfWidth; x += 2) {
      wires.add(V(x, y - 0.014, -DIM.halfLength + 0.24), V(x, y - 0.014, DIM.halfLength - 0.24), 0.0055);
    }

    // Cross wires at every truss line carry the cloth between bays.
    for (const z of FRAME_Z) {
      wires.add(V(-DIM.halfWidth + 0.24, y - 0.022, z), V(DIM.halfWidth - 0.24, y - 0.022, z), 0.0065);
    }

    // Tensioned edge rails down both side walls and across each gable.
    for (const x of [-DIM.halfWidth + 0.18, DIM.halfWidth - 0.18]) {
      wires.add(V(x, y - 0.03, -DIM.halfLength + 0.2), V(x, y - 0.03, DIM.halfLength - 0.2), 0.018);
    }
    for (const z of [-DIM.halfLength + 0.18, DIM.halfLength - 0.18]) {
      wires.add(V(-DIM.halfWidth + 0.2, y - 0.03, z), V(DIM.halfWidth - 0.2, y - 0.03, z), 0.018);
    }
    wires.build(group, 'shade-support-wires');

    // Short galvanised hangers pick the deck up from the truss bottom chords.
    const hangers = new BeamBatch(this.materials.steel, {
      castShadow: false,
      receiveShadow: false,
    });
    for (const x of GUTTER_X) {
      for (const z of FRAME_Z) {
        if (Math.abs(x) === DIM.halfWidth && Math.abs(z) === DIM.halfLength) continue;
        hangers.add(V(x, y + 0.01, z), V(x, DIM.gutterY - 0.06, z), 0.018, 0.018);
      }
    }
    hangers.build(group, 'shade-hangers');

    // Small tensioner plates at the four corners of the cloth.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const anchor = new THREE.Mesh(
          new THREE.CylinderGeometry(0.045, 0.045, 0.035, 10),
          this.materials.stainless,
        );
        anchor.position.set(sx * (DIM.halfWidth - 0.2), y - 0.025, sz * (DIM.halfLength - 0.2));
        group.add(anchor);
      }
    }

    const data = {
      id: 'shade-screen',
      category: 'Climate control',
      title: 'Horizontal shade screen',
      description:
        'A woven grey-green shade cloth hung horizontally at the truss bottom chord. The open weave cuts peak solar load while still transmitting diffuse light to the crop, and the wire grid keeps the deck clear of the fans and trusses.',
      specs: [
        ['Coverage', `${width.toFixed(1)} × ${depth.toFixed(1)} m`],
        ['Height', `${y.toFixed(2)} m · below truss chord`],
        ['Type', 'Woven agricultural shade cloth'],
        ['Transmission', '≈ 58 % diffuse light'],
        ['Support', 'Steel tension wires + edge rails'],
      ],
    };
    group.userData.interactable = data;
    this.interactables.push({ object: group, data });
    return this;
  }
}
