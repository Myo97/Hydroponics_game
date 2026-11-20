import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { boxMesh } from './Batches.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

const DEFAULT_DESCRIPTION =
  'Two glazed aluminium leaves run on a continuous top track with a recessed stainless bottom guide. Open the entrance to walk in; the leaves park in front of the gable glazing and leave the full 3.2 m opening clear. Each leaf carries its own collision volume, so the doorway opens progressively as the leaves slide.';

const DEFAULT_SIGN = {
  title: 'MAIN ENTRANCE',
  subtitle: 'SLIDING DOOR - KEEP CLEAR',
};

/**
 * Commercial sliding greenhouse entrance.
 * Two framed glass leaves ride a top track and a recessed bottom guide. The
 * leaves start closed, slide in opposite directions and expose a walkable
 * opening once open. A dynamic collision box fills the doorway while closed.
 *
 * The entrance is reusable: pass `config`, `frameZ`, origin and identity
 * options to mount a matched door in any greenhouse gable.
 */
export class EntranceDoors {
  constructor({
    materials,
    collisionWorld,
    config = LAYOUT.entrance,
    frameZ = LAYOUT.greenhouse.length / 2,
    originX = 0,
    originZ = 0,
    buildingId = 'greenhouse',
    id = 'entrance-doors',
    groupName = 'entrance-sliding-doors',
    title = 'Main entrance - sliding doors',
    sign = DEFAULT_SIGN,
    description = null,
  }) {
    this.materials = materials;
    this.collisionWorld = collisionWorld;
    this.config = config;
    this.frameZ = frameZ;
    this.originX = originX;
    this.originZ = originZ;
    this.buildingId = buildingId;
    this.id = id;
    this.groupName = groupName;
    this.title = title;
    this.sign = sign;
    this.description = description;
    this.interactables = [];
    this.group = null;
    this.leafLeft = null;
    this.leafRight = null;
    this.leafColliders = [];
    this.collisionBox = null;
    this.doorAmount = 0;
    this.openTarget = 0;
    this.data = null;
  }

  build(parent) {
    const { width, height, panelWidth, openTravel } = this.config;
    const doorHalf = width / 2;
    const leafHeight = height - 0.06;
    const frameZ = this.frameZ - 0.045;
    const panelZ = this.frameZ - 0.17;
    const alu = this.materials.aluminium;
    // Keep the main door's proportions and scale the running gear with the
    // opening so the nursery door does not inherit a 3.2 m track. Narrow houses
    // can also supply explicit track/guide lengths and hanger positions.
    const widthScale = width / LAYOUT.entrance.width;
    const trackLength =
      this.config.trackLength ?? (LAYOUT.entrance.width + 3.9) * widthScale;
    const hangerOffsets = (
      this.config.hangerOffsets ?? [-3.1, -1.68, 1.68, 3.1].map((x) => x * widthScale)
    ).slice();
    const guideLength =
      this.config.guideLength ?? (LAYOUT.entrance.width + 2.9) * widthScale;

    const group = new THREE.Group();
    group.name = this.groupName;
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
      boxMesh(trackLength, 0.075, 0.09, alu, V(0, height + 0.15, panelZ), 'entrance-top-track'),
    );
    for (const x of hangerOffsets) {
      group.add(
        boxMesh(0.045, 0.3, 0.045, alu, V(x, height + 0.02, panelZ), 'entrance-track-hanger'),
      );
    }

    // Recessed bottom guide: two stainless guide strips and a shallow sill.
    for (const offset of [-0.028, 0.028]) {
      group.add(
        boxMesh(guideLength, 0.012, 0.022, this.materials.stainless, V(0, 0.031, panelZ + offset), 'entrance-bottom-guide'),
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

      // Brushed kick plate and a rubber meeting astragal on the leading stile.
      leaf.add(
        boxMesh(
          panelWidth - 0.16,
          0.24,
          0.008,
          this.materials.stainless,
          V(0, 0.3, 0.029),
          'entrance-kick-plate',
        ),
      );
      leaf.add(
        boxMesh(
          0.028,
          leafHeight - 0.18,
          0.1,
          this.materials.rubber,
          V(-sign * (panelWidth / 2 - 0.012), leafHeight / 2, 0),
          'entrance-astragal',
        ),
      );

      if (sign > 0) {
        const sticker = new THREE.Mesh(
          new THREE.PlaneGeometry(0.17, 0.09),
          this.materials.createWarningMaterial(),
        );
        sticker.position.set(panelWidth * 0.22, 1.42, 0.058);
        leaf.add(sticker);
      }

      const closedX = sign * (width / 4);
      // Both leaves ride the same head track, offset onto their own runners so
      // they meet on the centreline instead of stacking at the world origin.
      leaf.position.set(closedX, 0, panelZ + sign * 0.029);
      leaf.userData.closedX = closedX;
      leaf.userData.travel = openTravel;
      leaf.userData.panelWidth = panelWidth;
      group.add(leaf);
      return leaf;
    };

    this.leafLeft = buildLeaf(-1);
    this.leafRight = buildLeaf(1);

    // Two safety sensors on the head track and a status beacon above the door.
    for (const x of [-doorHalf + 0.24, doorHalf - 0.24]) {
      group.add(
        boxMesh(0.09, 0.07, 0.09, this.materials.steelDark, V(x, height - 0.06, panelZ + 0.08), 'entrance-safety-sensor'),
      );
    }
    this.statusLamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 10),
      this.materials.ledGreen,
    );
    this.statusLamp.position.set(0, height + 0.08, frameZ + 0.09);
    group.add(this.statusLamp);

    const doorSign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.13),
      this.materials.createLabelMaterial(this.sign.title, this.sign.subtitle, {
        background: '#e8ece5',
        foreground: '#1b3440',
      }),
    );
    doorSign.position.set(0, height - 0.22, frameZ - 0.1);
    doorSign.rotation.y = Math.PI;
    group.add(doorSign);

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
      id: this.id,
      buildingId: this.buildingId,
      category: 'Access',
      title: this.title,
      interaction: 'toggle-entrance',
      interactionHint: 'Open entrance',
      description: this.description ?? DEFAULT_DESCRIPTION,
      specs: [
        ['Opening', `${width.toFixed(1)} m wide x ${height.toFixed(1)} m high`],
        ['Leaves', '2 x sliding aluminium-framed glass'],
        ['Track', 'Top rollers / bottom guide'],
        ['Glazing', 'Toughened greenhouse glass'],
        ['Safety', '2 x presence sensors + beacon'],
        ['Operation', 'Tap to open / close'],
      ],
    };
    group.userData.interactable = this.data;
    this.interactables.push({ object: group, data: this.data });

    // One collider per leaf, moved with the leaf so the clear opening grows.
    this.leafColliders = [this.leafLeft, this.leafRight].map((leaf) => {
      const box = this.collisionWorld?.addBox({
        x: this.originX + leaf.userData.closedX,
        z: this.originZ + panelZ,
        width: panelWidth,
        depth: 0.34,
        label: `${leaf.name} (sliding)`,
      });
      return { leaf, box };
    });
    this.collisionBox = this.leafColliders[0]?.box ?? null;

    return this;
  }

  get isOpen() {
    return this.openTarget > 0.5;
  }

  get isFullyOpen() {
    return this.doorAmount > 0.98;
  }

  get isMoving() {
    return Math.abs(this.openTarget - this.doorAmount) > 0.0015;
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

    // Keep each collider under its leaf; the doorway clears as they separate.
    for (const { leaf, box } of this.leafColliders) {
      if (!leaf || !box) continue;
      const half = (leaf.userData.panelWidth ?? 0) / 2;
      const leafX = this.originX + leaf.position.x;
      box.minX = leafX - half;
      box.maxX = leafX + half;
      box.enabled = true;
    }

    if (this.statusLamp) {
      const moving = this.doorAmount > 0.02 && this.doorAmount < 0.98;
      this.statusLamp.material = moving ? this.materials.ledAmber : this.materials.ledGreen;
    }
  }

  dispose() {
    this.interactables.length = 0;
    this.leafColliders.length = 0;
  }
}
