import * as THREE from 'three';
import { LAYOUT, DIM } from '../config/layout.js';
import { boxMesh } from './Batches.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Commercial sliding greenhouse entrance.
 * Two framed glass leaves ride a top track and a recessed bottom guide. The
 * leaves start closed, slide in opposite directions and expose a walkable
 * opening once open. A dynamic collision box fills the doorway while closed.
 */
export class EntranceDoors {
  constructor({ materials, collisionWorld }) {
    this.materials = materials;
    this.collisionWorld = collisionWorld;
    this.interactables = [];
    this.group = null;
    this.leafLeft = null;
    this.leafRight = null;
    this.collisionBox = null;
    this.doorAmount = 0;
    this.openTarget = 0;
    this.data = null;
  }

  build(parent) {
    const { width, height, panelWidth, openTravel } = LAYOUT.entrance;
    const doorHalf = width / 2;
    const leafHeight = height - 0.06;
    const frameZ = DIM.halfLength - 0.045;
    const panelZ = DIM.halfLength - 0.17;
    const alu = this.materials.aluminium;

    const group = new THREE.Group();
    group.name = 'entrance-sliding-doors';
    this.group = group;
    parent.add(group);

    // Jambs, head and threshold.
    for (const x of [-doorHalf - 0.055, doorHalf + 0.055]) {
      group.add(
        boxMesh(0.11, height + 0.06, 0.18, alu, V(x, (height + 0.06) / 2, frameZ), 'entrance-jamb'),
      );
    }
    group.add(
      boxMesh(width + 0.24, 0.16, 0.18, alu, V(0, height + 0.05, frameZ), 'entrance-head'),
    );
    group.add(
      boxMesh(width + 0.12, 0.025, 0.34, this.materials.aluminium, V(0, 0.012, panelZ), 'entrance-threshold'),
    );

    // Continuous aluminium top track with hanger trolleys.
    group.add(
      boxMesh(width + 3.9, 0.075, 0.09, alu, V(0, height + 0.15, panelZ), 'entrance-top-track'),
    );
    for (const x of [-3.1, -1.68, 1.68, 3.1]) {
      group.add(
        boxMesh(0.045, 0.3, 0.045, alu, V(x, height + 0.02, panelZ), 'entrance-track-hanger'),
      );
    }

    // Recessed bottom guide: two stainless guide strips and a shallow sill.
    for (const offset of [-0.028, 0.028]) {
      group.add(
        boxMesh(width + 2.9, 0.012, 0.022, this.materials.stainless, V(0, 0.031, panelZ + offset), 'entrance-bottom-guide'),
      );
    }

    const buildLeaf = (sign) => {
      const leaf = new THREE.Group();
      leaf.name = sign < 0 ? 'entrance-leaf-left' : 'entrance-leaf-right';

      const railGeometry = new THREE.BoxGeometry(panelWidth, 0.06, 0.055);
      const stileGeometry = new THREE.BoxGeometry(0.06, leafHeight, 0.055);
      const topRail = new THREE.Mesh(railGeometry, alu);
      topRail.position.set(0, leafHeight - 0.03, 0);
      const bottomRail = new THREE.Mesh(railGeometry, alu);
      bottomRail.position.set(0, 0.03, 0);
      const leftStile = new THREE.Mesh(stileGeometry, alu);
      leftStile.position.set(-panelWidth / 2 + 0.03, leafHeight / 2, 0);
      const rightStile = new THREE.Mesh(stileGeometry, alu);
      rightStile.position.set(panelWidth / 2 - 0.03, leafHeight / 2, 0);

      for (const part of [topRail, bottomRail, leftStile, rightStile]) {
        part.castShadow = true;
        part.receiveShadow = true;
        leaf.add(part);
      }

      // Mid rail and glazing gasket keep the leaf reading as a commercial door.
      leaf.add(
        boxMesh(panelWidth - 0.1, 0.035, 0.045, alu, V(0, 1.02, 0), 'entrance-mid-rail'),
      );
      const pane = new THREE.Mesh(
        new THREE.PlaneGeometry(panelWidth - 0.14, leafHeight - 0.14),
        this.materials.glassDoor,
      );
      pane.position.set(0, leafHeight / 2, 0);
      pane.renderOrder = 2;
      leaf.add(pane);

      // Pull handle on the leading stile (towards the centre of the opening).
      const handleX = -sign * (panelWidth / 2 - 0.11);
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.52, 8),
        this.materials.stainless,
      );
      handle.position.set(handleX, 1.12, 0.075);
      leaf.add(handle);
      for (const y of [0.92, 1.32]) {
        const standoff = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.012, 0.075, 6),
          this.materials.stainless,
        );
        standoff.rotation.x = Math.PI / 2;
        standoff.position.set(handleX, y, 0.038);
        leaf.add(standoff);
      }

      // Two top trolleys and a bottom guide shoe.
      for (const x of [-panelWidth * 0.32, panelWidth * 0.32]) {
        const hanger = boxMesh(0.035, 0.18, 0.035, alu, V(x, leafHeight + 0.08, 0), 'entrance-leaf-hanger');
        leaf.add(hanger);
        const trolley = new THREE.Mesh(
          new THREE.CylinderGeometry(0.032, 0.032, 0.045, 10),
          this.materials.steelDark,
        );
        trolley.rotation.z = Math.PI / 2;
        trolley.position.set(x, leafHeight + 0.18, 0);
        leaf.add(trolley);
      }
      leaf.add(
        boxMesh(0.055, 0.02, 0.05, this.materials.stainless, V(0, 0.015, 0), 'entrance-guide-shoe'),
      );

      const closedX = sign * (width / 4);
      leaf.position.set(closedX, 0, sign * 0.029);
      leaf.userData.closedX = closedX;
      leaf.userData.travel = openTravel;
      group.add(leaf);
      return leaf;
    };

    this.leafLeft = buildLeaf(-1);
    this.leafRight = buildLeaf(1);

    // Invisible door-sized hit volume: keeps the entrance targetable when open.
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(width, height + 0.15, 0.32),
      this.materials.hitProxy,
    );
    proxy.name = 'entrance-interaction-volume';
    proxy.position.set(0, (height + 0.15) / 2, panelZ);
    proxy.visible = false;
    group.add(proxy);

    this.data = {
      id: 'entrance-doors',
      category: 'Access',
      title: 'Main entrance — sliding doors',
      interaction: 'toggle-entrance',
      interactionHint: 'Open entrance',
      description:
        'Two glazed aluminium leaves run on a continuous top track with a recessed stainless bottom guide. Open the entrance to walk in; the leaves park in front of the gable glazing and leave the full 3.2 m opening clear.',
      specs: [
        ['Opening', `${width.toFixed(1)} m wide × ${height.toFixed(1)} m high`],
        ['Leaves', '2 × sliding aluminium-framed glass'],
        ['Track', 'Top rollers · bottom guide'],
        ['Glazing', 'Toughened greenhouse glass'],
        ['Operation', 'E to open / close'],
      ],
    };
    group.userData.interactable = this.data;
    this.interactables.push({ object: group, data: this.data });

    this.collisionBox = this.collisionWorld?.addBox({
      x: 0,
      z: panelZ,
      width,
      depth: 0.34,
      label: 'entrance doors (closed)',
    });
    if (this.collisionBox) this.collisionBox.enabled = true;

    return this;
  }

  get isOpen() {
    return this.openTarget > 0.5;
  }

  get isFullyOpen() {
    return this.doorAmount > 0.98;
  }

  toggle() {
    this.openTarget = this.openTarget > 0.5 ? 0 : 1;
    this.data.interactionHint = this.isOpen ? 'Close entrance' : 'Open entrance';
    return this.isOpen;
  }

  update(dt) {
    const blend = dt > 0 ? 1 - Math.exp(-dt * 6.2) : 1;
    this.doorAmount += (this.openTarget - this.doorAmount) * blend;
    if (Math.abs(this.openTarget - this.doorAmount) < 0.0015) {
      this.doorAmount = this.openTarget;
    }

    for (const leaf of [this.leafLeft, this.leafRight]) {
      if (!leaf) continue;
      const sign = leaf.userData.closedX < 0 ? -1 : 1;
      leaf.position.x = leaf.userData.closedX + sign * leaf.userData.travel * this.doorAmount;
    }

    // Keep the doorway blocked until the leaves have cleared it.
    if (this.collisionBox) this.collisionBox.enabled = this.doorAmount < 0.2;
  }

  dispose() {
    this.interactables.length = 0;
  }
}
