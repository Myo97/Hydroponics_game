import { LowPolyCylinderGeometry, LowPolySphereGeometry, LowPolyTorusGeometry } from './LowPolyGeometry.js';
import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { CylinderBatch, BeamBatch, boxMesh } from './Batches.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Version 6 water storage infrastructure.
 *
 *   - Two clean-water reservoirs buried in separate concrete vaults, each with a
 *     sealed manhole cover, level sight gauge and floor-mounted fill/suction
 *     risers. From the walkthrough only the covers and gauges are visible; in
 *     drone view the floor is cut away so the tanks themselves can be inspected.
 *   - A completely separate nutrient-return tank in its own vault. It receives
 *     NFT drainage and never shares a compartment, pipe or vent with clean water.
 *   - A buried rainwater harvester fed by the roof collector, with a grade hatch,
 *     vent, first-flush diverter and a live water surface visible in drone view.
 *   - A clean-water distribution manifold with one isolation valve per reservoir.
 */
export class WaterStorage {
  constructor({ materials, control = null, collisionWorld = null }) {
    this.materials = materials;
    this.control = control;
    this.collisionWorld = collisionWorld;
    this.group = null;
    this.cutawayGroup = null;
    this.coverGroup = null;
    this.roVisuals = [];
    this.returnVisuals = null;
    this.harvester = null;
    this.transferPump = null;
    this.valves = [];
    this.interactables = [];
    this.labelMaterials = [];
    this.runningTime = 0;
  }

  build(parent) {
    const group = new THREE.Group();
    group.name = 'water-storage';
    this.group = group;
    parent.add(group);

    this.coverGroup = new THREE.Group();
    this.coverGroup.name = 'storage-manhole-covers';
    group.add(this.coverGroup);

    this.cutawayGroup = new THREE.Group();
    this.cutawayGroup.name = 'storage-topview-cutaway';
    this.cutawayGroup.visible = false;
    group.add(this.cutawayGroup);

    for (const tank of LAYOUT.storage.roTanks) this.buildRoTank(group, tank);
    this.buildReturnTank(group);
    this.buildUndergroundHarvester(group);
    this.buildRelocatedTransferPump(group);
    this.buildDistributionManifold(group);
    this.buildReturnInlet(group);
    this.buildSigns(group);

    return this;
  }

  /* ---------------------------------------------------------- helpers */

  label(title, subtitle, width, height, options = {}) {
    const material = this.materials.createLabelMaterial(title, subtitle, {
      background: options.background ?? '#eef1e8',
      foreground: options.foreground ?? '#153145',
      accent: options.accent,
    });
    this.labelMaterials.push(material);
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  }

  buildRoTank(parent, tank) {
    const config = LAYOUT.storage;
    const [x, z] = tank.position;
    const index = this.roVisuals.length;

    const assembly = new THREE.Group();
    assembly.name = `underground-${tank.id}`;
    parent.add(assembly);

    // Concrete vault, open at the top so the cutaway sees straight in.
    const vaultMaterial = new THREE.MeshStandardMaterial({ flatShading: true,
      name: `vault-concrete-${index + 1}`,
      color: 0x8d9189,
      roughness: 0.94,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    this.labelMaterials.push(vaultMaterial);
    const wall = new THREE.Mesh(
      new LowPolyCylinderGeometry(
        config.vaultRadius,
        config.vaultRadius,
        config.vaultDepth,
        36,
        1,
        true,
      ),
      vaultMaterial,
    );
    wall.position.set(x, -config.vaultDepth / 2, z);
    wall.receiveShadow = true;
    assembly.add(wall);

    const floorSlab = new THREE.Mesh(
      new LowPolyCylinderGeometry(config.vaultRadius, config.vaultRadius, 0.12, 36),
      vaultMaterial,
    );
    floorSlab.position.set(x, -config.vaultDepth + 0.06, z);
    floorSlab.receiveShadow = true;
    assembly.add(floorSlab);

    const collar = new THREE.Mesh(
      new LowPolyCylinderGeometry(
        config.vaultRadius + 0.08,
        config.vaultRadius + 0.08,
        0.09,
        36,
        1,
        true,
      ),
      this.materials.concretePlinth,
    );
    collar.position.set(x, 0.035, z);
    assembly.add(collar);

    // HDPE tank shell and reinforcing hoops, entirely below the slab.
    const shell = new THREE.Mesh(
      new LowPolyCylinderGeometry(
        config.tankRadius,
        config.tankRadius * 1.01,
        config.tankHeight,
        44,
        1,
      ),
      this.materials.tankHDPEBlue,
    );
    shell.name = `${tank.id}-shell`;
    shell.position.set(x, config.tankTopY - config.tankHeight / 2, z);
    shell.castShadow = true;
    shell.receiveShadow = true;
    assembly.add(shell);

    for (const y of [-0.9, -1.85, -2.6]) {
      const hoop = new THREE.Mesh(
        new LowPolyTorusGeometry(config.tankRadius + 0.015, 0.028, 8, 40),
        this.materials.tankHDPE,
      );
      hoop.rotation.x = Math.PI / 2;
      hoop.position.set(x, y, z);
      assembly.add(hoop);
    }

    const top = new THREE.Mesh(
      new LowPolyCylinderGeometry(config.tankRadius, config.tankRadius, 0.08, 40),
      this.materials.tankHDPEBlue,
    );
    top.position.set(x, config.tankTopY, z);
    assembly.add(top);

    const liquid = new THREE.Mesh(
      new THREE.CircleGeometry(config.tankRadius - 0.05, 40),
      this.materials.water,
    );
    liquid.rotation.x = -Math.PI / 2;
    liquid.name = `${tank.id}-surface`;
    liquid.position.set(x, this.levelY(tank.initialLevel, tank), z);
    assembly.add(liquid);

    const rope = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.012, 0.012, config.tankHeight - 0.2, 6),
      this.materials.rubber,
    );
    rope.position.set(x + 0.32, config.tankTopY - config.tankHeight / 2 + 0.05, z - 0.3);
    assembly.add(rope);

    // Manhole cover assembly at grade.
    const cover = new THREE.Group();
    cover.name = `${tank.id}-manhole`;
    cover.position.set(x, 0, z);
    this.coverGroup.add(cover);

    const lid = new THREE.Mesh(
      new LowPolyCylinderGeometry(config.coverRadius, config.coverRadius, 0.075, 32),
      this.materials.steelDark,
    );
    lid.position.y = 0.045;
    lid.castShadow = true;
    lid.receiveShadow = true;
    cover.add(lid);
    const rim = new THREE.Mesh(
      new LowPolyTorusGeometry(config.coverRadius + 0.035, 0.035, 8, 32),
      this.materials.stainless,
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.018;
    cover.add(rim);
    cover.add(
      boxMesh(0.18, 0.035, 0.05, this.materials.stainless, V(0, 0.095, 0), 'manhole-handle'),
    );
    cover.add(
      boxMesh(0.3, 0.02, 0.26, this.materials.ledAmber, V(0.22, 0.087, 0.18), 'manhole-warning-tab'),
    );

    const floorLabel = this.label(tank.name, 'CLEAN WATER · CONFINED SPACE', 0.78, 0.2, {
      background: '#e7ebdf',
    });
    floorLabel.rotation.x = -Math.PI / 2;
    floorLabel.position.set(x, 0.012, z + config.coverRadius + 0.55);
    this.coverGroup.add(floorLabel);

    // Fill and suction risers come up through the slab beside the manhole.
    const risers = new CylinderBatch(this.materials.pvcWhite);
    risers.add(V(x - 0.95, config.tankTopY + 0.02, z), V(x - 0.95, 0.36, z), 0.055);
    risers.addJoint(V(x - 0.95, 0.36, z), 0.062);
    risers.add(V(x - 0.95, 0.36, z), V(x - 0.95, 0.36, z + 0.36), 0.055);
    risers.addJoint(V(x - 0.95, 0.36, z + 0.36), 0.062);
    risers.build(assembly, `${tank.id}-risers`);

    const fillStub = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.075, 0.075, 0.08, 16),
      this.materials.stainless,
    );
    fillStub.position.set(x - 0.95, 0.39, z + 0.36);
    assembly.add(fillStub);

    // Cutaway ring, only shown in drone view.
    const ringMaterial = new THREE.MeshBasicMaterial({
      name: 'storage-cutaway-ring',
      color: 0x63d8c6,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });
    this.labelMaterials.push(ringMaterial);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(config.vaultRadius + 0.03, config.vaultRadius + 0.12, 48),
      ringMaterial,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.02, z);
    this.cutawayGroup.add(ring);

    const visual = {
      id: tank.id,
      code: tank.code,
      data: tank,
      assembly,
      liquid,
      cover,
      level: tank.initialLevel,
      gaugeWater: null,
      gaugeFloat: null,
    };
    this.roVisuals.push(visual);
    this.buildLevelGauge(assembly, tank);

    const info = {
      id: tank.id,
      category: 'Water storage',
      title: tank.name,
      description: `Buried ${config.tankHeight.toFixed(2)} m HDPE clean-water reservoir in an independent concrete vault under the headhouse. The clean-water fill main enters through the floor beside the sealed manhole and the suction riser leaves for the circulation pump. The tank itself is only visible in drone view, where the floor is cut away.`,
      specs: [
        ['Service', tank.subtitle],
        ['Capacity', `${tank.capacity.toLocaleString('en-GB')} L`],
        ['Tank top', `${config.tankTopY.toFixed(2)} m below slab`],
        [
          'Vault',
          `Ø ${(config.vaultRadius * 2).toFixed(2)} m × ${config.vaultDepth.toFixed(2)} m deep`,
        ],
        ['Access', 'Sealed Ø 920 mm manhole'],
      ],
      interactionHint: 'Inspect tank',
      interaction: 'inspect',
    };
    cover.userData.interactable = info;
    this.interactables.push({ object: cover, data: info });
  }

  buildLevelGauge(parent, tank) {
    const [x, z] = tank.position;
    const gaugeX = x + 1.16;
    const gaugeZ = z + 0.78;
    const baseY = -0.3;
    const topY = 0.98;

    const glass = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.035, 0.035, topY - baseY, 14),
      this.materials.glass,
    );
    glass.position.set(gaugeX, (topY + baseY) / 2, gaugeZ);
    parent.add(glass);

    const water = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.026, 0.026, 1, 12),
      this.materials.water,
    );
    water.position.set(gaugeX, baseY, gaugeZ);
    parent.add(water);

    const float = new THREE.Mesh(
      new LowPolyTorusGeometry(0.045, 0.012, 6, 16),
      this.materials.ledAmber,
    );
    float.rotation.x = Math.PI / 2;
    float.position.set(gaugeX, baseY, gaugeZ);
    parent.add(float);

    for (const y of [baseY, topY]) {
      const cap = new THREE.Mesh(
        new LowPolyCylinderGeometry(0.06, 0.06, 0.06, 14),
        this.materials.stainless,
      );
      cap.position.set(gaugeX, y, gaugeZ);
      parent.add(cap);
    }

    const plate = this.label(tank.name, 'LEVEL 0 — 100 %', 0.62, 0.18, {
      background: '#eef2e9',
    });
    plate.position.set(gaugeX + 0.02, 1.1, gaugeZ);
    parent.add(plate);

    const visual = this.roVisuals[this.roVisuals.length - 1];
    if (visual) {
      visual.gaugeWater = water;
      visual.gaugeFloat = float;
      visual.gaugeRange = [baseY, topY];
    }
  }

  levelY(level, tank) {
    const config = LAYOUT.storage;
    const clamped = THREE.MathUtils.clamp(level, 0.02, 1);
    return config.tankTopY - (1 - clamped) * (config.tankHeight - 0.12) - 0.06;
  }

  buildReturnTank(parent) {
    const config = LAYOUT.storage.returnTank;
    const [x, z] = config.position;
    const vaultRadius = 1.62;
    const vaultDepth = 3.35;

    const assembly = new THREE.Group();
    assembly.name = 'underground-nutrient-return';
    parent.add(assembly);

    const vaultMaterial = new THREE.MeshStandardMaterial({ flatShading: true,
      name: 'return-vault-concrete',
      color: 0x7e837c,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    this.labelMaterials.push(vaultMaterial);

    const wall = new THREE.Mesh(
      new LowPolyCylinderGeometry(vaultRadius, vaultRadius, vaultDepth, 36, 1, true),
      vaultMaterial,
    );
    wall.position.set(x, -vaultDepth / 2, z);
    assembly.add(wall);

    const slab = new THREE.Mesh(
      new LowPolyCylinderGeometry(vaultRadius, vaultRadius, 0.12, 36),
      vaultMaterial,
    );
    slab.position.set(x, -vaultDepth + 0.06, z);
    assembly.add(slab);

    const shell = new THREE.Mesh(
      new LowPolyCylinderGeometry(config.radius, config.radius * 1.01, config.height, 40, 1),
      this.materials.returnTank,
    );
    shell.name = 'return-tank-shell';
    shell.position.set(x, config.topY - config.height / 2, z);
    shell.castShadow = true;
    shell.receiveShadow = true;
    assembly.add(shell);

    for (const y of [-1.0, -1.9, -2.55]) {
      const hoop = new THREE.Mesh(
        new LowPolyTorusGeometry(config.radius + 0.015, 0.026, 8, 36),
        this.materials.steelDark,
      );
      hoop.rotation.x = Math.PI / 2;
      hoop.position.set(x, y, z);
      assembly.add(hoop);
    }

    const top = new THREE.Mesh(
      new LowPolyCylinderGeometry(config.radius, config.radius, 0.075, 36),
      this.materials.returnTank,
    );
    top.position.set(x, config.topY, z);
    assembly.add(top);

    const returnLiquidMaterial = new THREE.MeshStandardMaterial({ flatShading: true,
      name: 'return-tank-liquid',
      color: 0x4c5f3c,
      transparent: true,
      opacity: 0.88,
      roughness: 0.28,
      metalness: 0.05,
    });
    this.labelMaterials.push(returnLiquidMaterial);

    const liquid = new THREE.Mesh(
      new THREE.CircleGeometry(config.radius - 0.05, 40),
      returnLiquidMaterial,
    );
    liquid.rotation.x = -Math.PI / 2;
    liquid.name = 'return-tank-surface';
    liquid.position.set(
      x,
      config.topY - (1 - config.initialLevel) * (config.height - 0.12) - 0.06,
      z,
    );
    assembly.add(liquid);

    // Drop pipe from the above-floor return inlet, ending below the liquid line.
    const drop = new CylinderBatch(this.materials.pvcReturn);
    drop.addPath(
      [
        V(x, -0.06, -13.58),
        V(x, -0.62, -13.58),
        V(x, -0.62, -13.95),
        V(x, -1.6, -14.0),
        V(x, -2.2, -14.35),
      ],
      0.075,
    );
    drop.build(assembly, 'return-tank-drop-pipe');

    // Gas vent and high-level beacon rise through the slab beside the cover.
    const vent = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.045, 0.045, 0.8, 12),
      this.materials.pvcGrey,
    );
    vent.position.set(x + 0.78, 0.4, z - 0.55);
    assembly.add(vent);
    const ventCap = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.085, 0.065, 0.06, 12),
      this.materials.pvcGrey,
    );
    ventCap.position.set(x + 0.78, 0.82, z - 0.55);
    assembly.add(ventCap);

    const cover = new THREE.Group();
    cover.name = 'return-tank-manhole';
    cover.position.set(x, 0, z);
    this.coverGroup.add(cover);

    const lid = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.54, 0.54, 0.075, 30),
      this.materials.steelDark,
    );
    lid.position.y = 0.045;
    lid.castShadow = true;
    cover.add(lid);
    const rim = new THREE.Mesh(
      new LowPolyTorusGeometry(0.575, 0.032, 8, 30),
      this.materials.stainless,
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.016;
    cover.add(rim);
    const beacon = new THREE.Mesh(
      new LowPolySphereGeometry(0.055, 12, 8),
      this.materials.ledRed,
    );
    beacon.position.set(-0.72, 0.11, 0.3);
    cover.add(beacon);

    const floorLabel = this.label('DIRTY DRAIN', 'NUTRIENT RETURN · DO NOT MIX', 0.94, 0.24, {
      background: '#f0dfd2',
      foreground: '#5a2718',
    });
    floorLabel.rotation.x = -Math.PI / 2;
    floorLabel.position.set(x, 0.012, z + 0.84);
    this.coverGroup.add(floorLabel);

    const ringMaterial = new THREE.MeshBasicMaterial({
      name: 'return-cutaway-ring',
      color: 0xe28a58,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });
    this.labelMaterials.push(ringMaterial);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(vaultRadius + 0.03, vaultRadius + 0.12, 44),
      ringMaterial,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.02, z);
    this.cutawayGroup.add(ring);

    this.returnVisuals = { ...config, liquid, cover, beacon, assembly, level: config.initialLevel };

    const info = {
      id: config.id,
      category: 'Water storage',
      title: `${config.label} · ${config.code}`,
      description:
        'A dedicated buried tank for all NFT drainage. Every table drain discharges here through its own return inlet; the tank is mechanically and hydraulically separate from Reservoir 1 and Reservoir 2, with its own vault, cover, vent and high-level beacon. Water from this tank is never drawn by the irrigation pump.',
      specs: [
        ['Service', 'Nutrient drainage · dirty side'],
        ['Capacity', `${config.capacity.toLocaleString('en-GB')} L`],
        ['Tank top', `${config.topY.toFixed(2)} m below slab`],
        ['Separation', 'Own vault · no cross-connection'],
        ['Alarm', 'High level beacon + cabinet alarm'],
      ],
      interactionHint: 'Inspect return tank',
      interaction: 'inspect',
    };
    cover.userData.interactable = info;
    this.interactables.push({ object: cover, data: info });
  }

  /**
   * V6 underground rainwater harvester. The 5,000 L HDPE tank sits in a concrete
   * vault below the headhouse slab; at grade only the sealed hatch, vent and
   * first-flush chamber are visible. Drone topology view shows the tank and the
   * live rain-fed water surface through the cutaway ring.
   */
  buildUndergroundHarvester(parent) {
    const config = LAYOUT.storage.harvester;
    const [x, z] = config.position;
    const vaultRadius = config.vaultRadius ?? 1.44;
    const vaultDepth = config.vaultDepth ?? 3.15;
    const radius = config.radius ?? 1.02;
    const height = config.height ?? 2.45;
    const topY = config.topY ?? -0.52;
    const [flushX, flushZ] = config.firstFlush ?? [x - 0.7, z - 1.5];

    const assembly = new THREE.Group();
    assembly.name = 'underground-rainwater-harvester';
    parent.add(assembly);

    const vaultMaterial = new THREE.MeshStandardMaterial({ flatShading: true,
      name: 'harvester-vault-concrete',
      color: 0x858b84,
      roughness: 0.95,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    this.labelMaterials.push(vaultMaterial);
    const wall = new THREE.Mesh(
      new LowPolyCylinderGeometry(vaultRadius, vaultRadius, vaultDepth, 40, 1, true),
      vaultMaterial,
    );
    wall.position.set(x, -vaultDepth / 2, z);
    wall.receiveShadow = true;
    assembly.add(wall);

    const floorSlab = new THREE.Mesh(
      new LowPolyCylinderGeometry(vaultRadius, vaultRadius, 0.12, 40),
      vaultMaterial,
    );
    floorSlab.position.set(x, -vaultDepth + 0.06, z);
    floorSlab.receiveShadow = true;
    assembly.add(floorSlab);

    // HDPE storage tank, open at the top so the cutaway shows the water plane.
    const shell = new THREE.Mesh(
      new LowPolyCylinderGeometry(radius, radius * 1.012, height, 44, 1, true),
      this.materials.tankHDPEBlue,
    );
    shell.name = 'rainwater-harvester-shell';
    shell.position.set(x, topY - height / 2, z);
    shell.castShadow = true;
    shell.receiveShadow = true;
    assembly.add(shell);

    for (let rib = 0; rib < 5; rib += 1) {
      const hoop = new THREE.Mesh(
        new LowPolyTorusGeometry(radius + 0.014, 0.026, 8, 42),
        this.materials.tankHDPE,
      );
      hoop.rotation.x = Math.PI / 2;
      hoop.position.set(x, topY - 0.22 - rib * (height - 0.4) / 4, z);
      assembly.add(hoop);
    }

    const tankRim = new THREE.Mesh(
      new LowPolyTorusGeometry(radius + 0.01, 0.04, 8, 42),
      this.materials.tankHDPEBlue,
    );
    tankRim.rotation.x = Math.PI / 2;
    tankRim.position.set(x, topY, z);
    assembly.add(tankRim);

    const liquid = new THREE.Mesh(
      new THREE.CircleGeometry(radius - 0.04, 40),
      this.materials.water,
    );
    liquid.rotation.x = -Math.PI / 2;
    liquid.name = 'rainwater-surface';
    liquid.position.set(
      x,
      topY - 0.07 - (1 - config.initialLevel) * (height - 0.16),
      z,
    );
    assembly.add(liquid);

    // Access ladder from the hatch to the vault floor.
    for (let rung = 0; rung < 7; rung += 1) {
      assembly.add(
        boxMesh(
          0.28,
          0.025,
          0.025,
          this.materials.stainless,
          V(x - vaultRadius + 0.22, -0.55 - rung * 0.34, z + 0.32),
          'harvester-ladder-rung',
        ),
      );
    }
    for (const side of [-1, 1]) {
      assembly.add(
        boxMesh(
          0.022,
          vaultDepth - 0.8,
          0.022,
          this.materials.stainless,
          V(
            x - vaultRadius + 0.22 + side * 0.12,
            -vaultDepth / 2 - 0.1,
            z + 0.32,
          ),
          'harvester-ladder-rail',
        ),
      );
    }

    // Buried fill and overflow connections from the first-flush chamber.
    const buried = new CylinderBatch(this.materials.pvcReturn);
    buried.addPath(
      [
        V(flushX, 0.32, flushZ),
        V(flushX, -0.42, flushZ),
        V(flushX, -0.42, z - vaultRadius + 0.18),
        V(x, -0.42, z - radius + 0.08),
      ],
      0.07,
    );
    buried.build(assembly, 'harvester-first-flush-to-tank');

    this.buildHarvesterGradeWorks(parent, config);
    this.harvesterCutawayRing(parent, x, z, vaultRadius);

    this.collisionWorld?.addCircle({
      x,
      z,
      radius: config.hatchRadius + 0.22,
      label: 'rainwater harvester hatch',
    });

    this.harvester = {
      ...config,
      assembly,
      shell,
      liquid,
      level: config.initialLevel,
      rainGain: 0,
    };

    const info = {
      id: config.id,
      category: 'Water storage',
      title: config.label,
      description:
        'Underground 5,000 L HDPE harvester collecting roof run-off. Water arrives from the north gutter through a first-flush chamber that rejects the dirty initial flow, then drops into the buried tank. Rain intensity controls the live inflow; the transfer pump sends stored water through the clean distribution manifold to both reservoirs.',
      specs: [
        ['Capacity', `${config.capacity.toLocaleString('en-GB')} L`],
        ['Installation', `Buried · tank top ${topY.toFixed(2)} m`],
        ['Collection', `North roof collector · ${LAYOUT.weather.rainMmPerHour.toFixed(1)} mm/h design`],
        ['Pre-treatment', 'Leaf strainer + first-flush diverter'],
        ['Access', `Sealed ${Math.round(config.hatchRadius * 2000)} mm hatch`],
        ['Transfer', 'Rain pump → manifold → Reservoir 1 / Reservoir 2'],
      ],
      interactionHint: 'Inspect harvester',
      interaction: 'inspect',
    };
    this.harvesterHatch.userData.interactable = info;
    this.interactables.push({ object: this.harvesterHatch, data: info });
  }

  /** Grade-level hatch, vent, first-flush chamber and labels. */
  buildHarvesterGradeWorks(parent, config) {
    const [x, z] = config.position;
    const [flushX, flushZ] = config.firstFlush ?? [x - 0.7, z - 1.5];
    const hatchRadius = config.hatchRadius ?? 0.58;

    const hatch = new THREE.Group();
    hatch.name = 'rainwater-harvester-hatch';
    hatch.position.set(x, 0, z);
    this.coverGroup.add(hatch);
    this.harvesterHatch = hatch;

    const collar = new THREE.Mesh(
      new LowPolyCylinderGeometry(hatchRadius + 0.13, hatchRadius + 0.16, 0.09, 36),
      this.materials.concretePlinth,
    );
    collar.position.y = 0.035;
    collar.receiveShadow = true;
    hatch.add(collar);

    const lid = new THREE.Mesh(
      new LowPolyCylinderGeometry(hatchRadius, hatchRadius, 0.075, 36),
      this.materials.steelDark,
    );
    lid.position.y = 0.115;
    lid.castShadow = true;
    lid.receiveShadow = true;
    hatch.add(lid);

    const rim = new THREE.Mesh(
      new LowPolyTorusGeometry(hatchRadius + 0.035, 0.03, 8, 36),
      this.materials.stainless,
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.085;
    hatch.add(rim);
    hatch.add(
      boxMesh(0.22, 0.035, 0.05, this.materials.stainless, V(0, 0.165, 0), 'harvester-hatch-handle'),
    );

    const hatchLabel = this.label('RAINWATER', 'HARVESTER · 5,000 L', 0.64, 0.18, {
      background: '#e4ece7',
      foreground: '#173a49',
    });
    hatchLabel.rotation.x = -Math.PI / 2;
    hatchLabel.position.set(0, 0.012, hatchRadius + 0.4);
    hatch.add(hatchLabel);

    // Vent standpipe prevents the buried tank drawing a vacuum during transfer.
    const vent = new THREE.Group();
    vent.name = 'harvester-vault-vent';
    vent.position.set(x + hatchRadius + 0.24, 0, z + 0.12);
    const ventPipe = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.045, 0.045, 0.72, 14),
      this.materials.pvcWhite,
    );
    ventPipe.position.y = 0.34;
    ventPipe.castShadow = true;
    vent.add(ventPipe);
    const ventCap = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.09, 0.09, 0.05, 18),
      this.materials.pvcGrey,
    );
    ventCap.position.y = 0.73;
    vent.add(ventCap);
    parent.add(vent);

    // First-flush chamber between the roof downpipe and the buried tank.
    const flush = new THREE.Group();
    flush.name = 'harvester-first-flush';
    flush.position.set(flushX, 0, flushZ);
    const flushPipe = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.095, 0.095, 1.48, 18),
      this.materials.pvcReturn,
    );
    flushPipe.position.y = 0.78;
    flushPipe.castShadow = true;
    flush.add(flushPipe);
    const flushTop = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.12, 0.12, 0.08, 18),
      this.materials.pvcGrey,
    );
    flushTop.position.y = 1.55;
    flush.add(flushTop);
    const flushCap = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.1, 0.1, 0.06, 18),
      this.materials.pvcGrey,
    );
    flushCap.position.y = 0.12;
    flush.add(flushCap);
    const flushWheel = new THREE.Mesh(
      new LowPolyTorusGeometry(0.075, 0.014, 8, 18),
      this.materials.ledRed,
    );
    flushWheel.rotation.x = Math.PI / 2;
    flushWheel.position.set(0, 0.34, 0.12);
    flush.add(flushWheel);
    this.flushValveWheel = flushWheel;
    const flushLabel = this.label('FIRST FLUSH', 'DIVERTER · 25 L', 0.46, 0.15, {
      background: '#f0e2d2',
      foreground: '#5a2b18',
    });
    flushLabel.position.set(0, 0.96, 0.1);
    flush.add(flushLabel);

    // Roof downpipe connection into the first-flush chamber.
    const downpipe = new CylinderBatch(this.materials.pvcWhite);
    downpipe.addPath(
      [
        V(x, LAYOUT.rainwater.harvesterInletY, LAYOUT.rainwater.collectorZ),
        V(x, 1.62, LAYOUT.rainwater.collectorZ),
        V(flushX, 1.62, LAYOUT.rainwater.collectorZ),
        V(flushX, 1.48, flushZ),
      ],
      0.075,
    );
    downpipe.build(parent, 'harvester-downpipe');
    parent.add(flush);

    this.collisionWorld?.addCircle({
      x: flushX,
      z: flushZ,
      radius: 0.16,
      label: 'first-flush diverter',
    });
    this.collisionWorld?.addCircle({
      x: x + hatchRadius + 0.24,
      z: z + 0.12,
      radius: 0.09,
      label: 'harvester vent',
    });
  }

  harvesterCutawayRing(parent, x, z, vaultRadius) {
    const ringMaterial = new THREE.MeshBasicMaterial({
      name: 'harvester-cutaway-ring',
      color: 0x4fc8e8,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    this.labelMaterials.push(ringMaterial);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(vaultRadius + 0.03, vaultRadius + 0.13, 48),
      ringMaterial,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.02, z);
    this.cutawayGroup.add(ring);

    const floorLabel = this.label('RAINWATER HARVESTER', 'ROOF RUN-OFF · UNDERGROUND 5,000 L', 1.4, 0.26, {
      background: '#e3edf0',
      foreground: '#123547',
    });
    floorLabel.rotation.x = -Math.PI / 2;
    floorLabel.position.set(x, 0.014, z + vaultRadius + 0.42);
    this.cutawayGroup.add(floorLabel);
  }

  /** Grade-mounted transfer pump west of the harvester hatch. */
  buildRelocatedTransferPump(parent) {
    const config = LAYOUT.storage.transferPump;
    const [x, z] = config.position;

    const assembly = new THREE.Group();
    assembly.name = 'rain-transfer-pump';
    parent.add(assembly);

    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.09, 0.92),
      this.materials.concretePlinth,
    );
    pad.position.set(x, 0.045, z);
    pad.receiveShadow = true;
    assembly.add(pad);
    assembly.add(
      boxMesh(1.02, 0.08, 0.56, this.materials.steelDark, V(x, 0.12, z), 'rain-pump-skid'),
    );
    for (const sx of [-0.38, 0.38]) {
      assembly.add(
        boxMesh(0.08, 0.3, 0.46, this.materials.steelDark, V(x + sx, 0.25, z), 'rain-pump-foot'),
      );
    }

    const volute = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.19, 0.19, 0.28, 24),
      this.materials.pumpBlue,
    );
    volute.rotation.z = Math.PI / 2;
    volute.position.set(x - 0.06, 0.45, z);
    volute.castShadow = true;
    assembly.add(volute);

    const motor = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.155, 0.155, 0.34, 20),
      this.materials.pumpBlue,
    );
    motor.rotation.z = Math.PI / 2;
    motor.position.set(x - 0.4, 0.45, z);
    motor.castShadow = true;
    assembly.add(motor);

    const cowl = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.17, 0.17, 0.13, 20),
      this.materials.steelDark,
    );
    cowl.rotation.z = Math.PI / 2;
    cowl.position.set(x - 0.63, 0.45, z);
    assembly.add(cowl);

    for (let fin = 0; fin < 8; fin += 1) {
      const angle = (fin / 8) * Math.PI * 2;
      const finMesh = boxMesh(
        0.4,
        0.014,
        0.03,
        this.materials.aluminium,
        V(x - 0.4, 0.45 + Math.cos(angle) * 0.165, z + Math.sin(angle) * 0.165),
        'rain-pump-fin',
      );
      finMesh.rotation.x = -angle;
      assembly.add(finMesh);
    }

    // Suction leaves the buried tank wall and rises to the pump inlet.
    const suction = new CylinderBatch(this.materials.pvcWhite);
    const harvester = LAYOUT.storage.harvester;
    const vaultEdgeX = harvester.position[0] - (harvester.vaultRadius ?? 1.44) + 0.16;
    suction.addPath(
      [
        V(vaultEdgeX, -0.38, z + 0.24),
        V(vaultEdgeX, 0.56, z + 0.24),
        V(x + 0.34, 0.56, z + 0.24),
        V(x + 0.34, 0.42, z + 0.24),
      ],
      0.058,
    );
    suction.addJoint(V(vaultEdgeX, 0.56, z + 0.24), 0.085);
    suction.build(assembly, 'rain-pump-suction');

    // Discharge to the clean-water manifold feeding both reservoir valves.
    const distribution = LAYOUT.storage.distribution;
    const discharge = new CylinderBatch(this.materials.pvcWhite);
    discharge.addPath(
      [
        V(x + 0.3, 0.46, z),
        V(x + 0.3, 0.78, z),
        V(x + 0.3, 0.78, distribution.z),
        V(-9.8, 0.78, distribution.z),
        V(-9.8, distribution.y, distribution.z),
      ],
      0.058,
    );
    discharge.addJoint(V(-6.2, 0.78, distribution.z), 0.085);
    discharge.addPath(
      [V(-6.2, 0.78, distribution.z), V(-6.2, distribution.y, distribution.z)],
      0.058,
    );
    discharge.build(assembly, 'rain-pump-discharge');

    const valveBody = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.085, 0.085, 0.13, 16),
      this.materials.stainless,
    );
    valveBody.position.set(x + 0.3, 0.78, z - 0.22);
    assembly.add(valveBody);
    const valveStem = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.016, 0.016, 0.16, 10),
      this.materials.stainless,
    );
    valveStem.position.set(x + 0.3, 0.92, z - 0.22);
    assembly.add(valveStem);
    const wheel = new THREE.Mesh(
      new LowPolyTorusGeometry(0.075, 0.014, 8, 18),
      this.materials.ledRed,
    );
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x + 0.3, 1.01, z - 0.22);
    assembly.add(wheel);

    this.buildTransferStarter(assembly, x, z, config);
  }

  buildTransferStarter(assembly, x, z, config) {
    const starter = new THREE.Group();
    starter.name = 'rain-pump-starter';
    starter.position.set(x + 0.22, 0.49, z - 0.34);
    starter.add(
      boxMesh(0.24, 0.3, 0.12, this.materials.cabinetPaint, V(0, 0, 0), 'rain-pump-starter-box'),
    );
    const lamp = new THREE.Mesh(
      new LowPolySphereGeometry(0.025, 10, 8),
      this.materials.ledGreen,
    );
    lamp.position.set(-0.06, 0.08, -0.065);
    starter.add(lamp);
    const button = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.038, 0.038, 0.03, 14),
      this.materials.ledWhite,
    );
    button.rotation.x = Math.PI / 2;
    button.position.set(0.06, 0.04, -0.07);
    starter.add(button);
    const starterLabel = this.label('RAIN TRANSFER', 'PUMP · AUTO / OFF', 0.4, 0.14, {
      background: '#e8ede2',
    });
    starterLabel.position.set(0, -0.04, -0.069);
    starter.add(starterLabel);
    assembly.add(starter);

    const plate = this.label('RAIN TRANSFER PUMP', 'HARVESTER → RESERVOIR 1 / 2', 1.02, 0.34, {
      background: '#e8eee4',
      foreground: '#173a49',
    });
    plate.position.set(x, 0.3, z + 0.35);
    assembly.add(plate);

    this.collisionWorld?.addBox({
      x,
      z,
      width: 1.25,
      depth: 0.82,
      label: 'rain transfer pump',
    });

    this.transferPump = { ...config, assembly, starter, lamp };

    const info = {
      id: config.id,
      category: 'Water storage',
      title: 'Rainwater transfer pump',
      description:
        'Booster set lifting stored roof water from the underground harvester into the clean distribution manifold. The discharge tee feeds one isolation valve per reservoir, so either tank can be isolated for maintenance without stopping the other fill. Tap at the starter to toggle the pump.',
      specs: [
        ['Duty', '6.0 m³ h⁻¹ at 2.4 bar'],
        ['Motor', '0.75 kW · 230 V single phase'],
        ['Suction', 'Buried harvester tank'],
        ['Discharge', 'Reservoir 1 / Reservoir 2 isolation manifold'],
        ['Interlock', 'Low-level cut-out in harvester'],
      ],
      interactionHint: 'Toggle rain pump',
      interaction: 'toggle-rain-transfer',
    };
    starter.userData.interactable = info;
    this.interactables.push({ object: starter, data: info });
  }

  buildDistributionManifold(parent) {
    const config = LAYOUT.storage.distribution;
    const valveXs = config.valveXs;

    const assembly = new THREE.Group();
    assembly.name = 'ro-distribution-manifold';
    parent.add(assembly);

    const clean = new CylinderBatch(this.materials.pvcWhite);
    clean.add(
      V(valveXs[0] - 0.2, config.y, config.z),
      V(valveXs[valveXs.length - 1] + 0.2, config.y, config.z),
      0.06,
    );
    for (let i = 0; i < valveXs.length; i += 1) {
      const x = valveXs[i];
      clean.add(V(x, config.y, config.z), V(x, config.y - 0.28, config.z), 0.05);
      clean.add(V(x, config.y - 0.28, config.z), V(x, 0.36, config.z), 0.045);
      clean.add(V(x, 0.36, config.z), V(x - 0.95, 0.36, config.z), 0.045);
      clean.add(V(x - 0.95, 0.36, config.z), V(x - 0.95, 0.36, config.z + 0.36), 0.045);
    }
    clean.build(assembly, 'clean-distribution-header');

    const saddles = new BeamBatch(this.materials.steelDark, {
      castShadow: false,
      receiveShadow: false,
    });
    for (let x = valveXs[0] - 0.2; x <= valveXs[valveXs.length - 1] + 0.2; x += 1.2) {
      saddles.add(V(x, 0.015, config.z), V(x, config.y - 0.06, config.z), 0.026, 0.026);
    }
    saddles.build(assembly, 'distribution-pipe-saddles');

    valveXs.forEach((x, index) => {
      const tank = LAYOUT.storage.roTanks[index];
      const valve = new THREE.Group();
      valve.name = `ro-isolation-valve-${index + 1}`;
      valve.position.set(x, config.y - 0.22, config.z);

      const body = new THREE.Mesh(
        new LowPolyCylinderGeometry(0.085, 0.085, 0.14, 16),
        this.materials.stainless,
      );
      valve.add(body);
      const bonnet = new THREE.Mesh(
        new LowPolyCylinderGeometry(0.045, 0.06, 0.09, 14),
        this.materials.stainless,
      );
      bonnet.position.y = 0.11;
      valve.add(bonnet);
      const stem = new THREE.Mesh(
        new LowPolyCylinderGeometry(0.014, 0.014, 0.18, 10),
        this.materials.stainless,
      );
      stem.position.y = 0.22;
      valve.add(stem);

      const handle = new THREE.Group();
      handle.position.y = 0.31;
      handle.add(
        new THREE.Mesh(
          new LowPolyTorusGeometry(0.082, 0.012, 6, 18),
          this.materials.ledRed,
        ),
      );
      handle.children[0].rotation.x = Math.PI / 2;
      handle.add(
        boxMesh(0.15, 0.012, 0.022, this.materials.ledRed, V(0.035, 0, 0), 'valve-lever'),
      );
      valve.add(handle);

      const tag = this.label(tank.name, 'FILL ISOLATION', 0.42, 0.14, {
        background: '#e9efe6',
      });
      tag.position.set(0, 0.11, 0.092);
      valve.add(tag);

      assembly.add(valve);
      this.valves.push({
        tankId: tank.id,
        code: tank.code,
        object: valve,
        handle,
        angle: 0,
      });

      const info = {
        id: `ro-isolation-${index + 1}`,
        category: 'Water storage',
        title: `${tank.name} fill isolation valve`,
        description: `Full-bore stainless ball valve on the clean-water branch to ${tank.name}. Closing it isolates that reservoir from the rain transfer pump while the other reservoir continues to fill. The lever rotates through 90 degrees and the position is mirrored on the storage status panel.`,
        specs: [
          ['Service', 'Clean water fill'],
          ['Size', 'DN 50 · full bore'],
          ['Operator', 'Lockable lever'],
          ['Reservoir', `${tank.name} · ${tank.capacity.toLocaleString('en-GB')} L`],
          ['Interlock', 'None · independent per reservoir'],
        ],
        interactionHint: 'Close valve',
        interaction: 'toggle-storage-valve',
        tankId: tank.id,
      };
      valve.userData.interactable = info;
      this.interactables.push({ object: valve, data: info });
    });

    // Pressure gauge on the manifold.
    const gauge = new THREE.Group();
    gauge.name = 'clean-manifold-pressure-gauge';
    gauge.position.set(-8.0, config.y + 0.22, config.z);
    const dial = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.12, 0.12, 0.035, 24),
      this.materials.stainless,
    );
    dial.rotation.x = Math.PI / 2;
    gauge.add(dial);
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(0.1, 24),
      this.materials.createLabelMaterial('2.4', 'BAR', {
        background: '#f1f2ea',
        foreground: '#173345',
      }),
    );
    face.position.z = 0.02;
    gauge.add(face);
    gauge.add(
      new THREE.Mesh(
        new LowPolyCylinderGeometry(0.012, 0.012, 0.1, 8),
        this.materials.steelDark,
      ),
    );
    gauge.children[2].position.set(0, -0.13, 0);
    assembly.add(gauge);

    this.distributionManifold = { assembly, ...config };

    const info = {
      id: 'ro-distribution-manifold',
      category: 'Water storage',
      title: 'Clean-water distribution manifold',
      description:
        'The only place where harvested rainwater is split between the two clean-water reservoirs. A DN 50 header runs above the slab with one lockable isolation valve per reservoir; closing either branch lets that reservoir be serviced while the other keeps filling. The dirty return network is physically separate and never connects here.',
      specs: [
        ['Header', 'DN 50 PVC · 2.4 bar'],
        ['Branches', '2 × reservoir storage'],
        ['Isolation', 'One lockable ball valve per reservoir'],
        ['Source', 'Rain transfer pump'],
        ['Cross-connection', 'None · clean side only'],
      ],
      interactionHint: 'Inspect manifold',
      interaction: 'inspect',
    };
    assembly.userData.interactable = info;
    this.interactables.push({ object: assembly, data: info });
  }

  buildReturnInlet(parent) {
    const config = LAYOUT.storage.returnInlet;
    const { x, z } = config;

    const assembly = new THREE.Group();
    assembly.name = 'nutrient-return-inlet';
    parent.add(assembly);

    const sump = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.46, 0.48, 0.05, 28),
      this.materials.steelDark,
    );
    sump.position.set(x, 0.012, z);
    sump.receiveShadow = true;
    assembly.add(sump);

    const flange = new THREE.Mesh(
      new LowPolyTorusGeometry(0.43, 0.045, 8, 28),
      this.materials.stainless,
    );
    flange.rotation.x = Math.PI / 2;
    flange.position.set(x, 0.045, z);
    assembly.add(flange);

    const grate = new THREE.Mesh(
      new THREE.CircleGeometry(0.4, 28),
      this.materials.drainGrate,
    );
    grate.rotation.x = -Math.PI / 2;
    grate.position.set(x, 0.042, z);
    assembly.add(grate);
    for (let bar = 0; bar < 7; bar += 1) {
      const barX = -0.32 + bar * 0.107;
      const half = Math.sqrt(Math.max(0, 0.38 * 0.38 - barX * barX));
      assembly.add(
        boxMesh(
          0.022,
          0.02,
          half * 2,
          this.materials.steelDark,
          V(x + barX, 0.054, z),
          'return-inlet-bar',
        ),
      );
    }

    const stub = new THREE.Mesh(
      new LowPolyCylinderGeometry(0.15, 0.15, 0.32, 20),
      this.materials.pvcReturn,
    );
    stub.position.set(x, 0.2, z);
    stub.castShadow = true;
    assembly.add(stub);

    const floorLabel = this.label('NUTRIENT RETURN', 'NFT DRAIN · TO DR-01', 0.82, 0.2, {
      background: '#f0dfd2',
      foreground: '#5a2718',
    });
    floorLabel.rotation.x = -Math.PI / 2;
    floorLabel.position.set(x, 0.011, z + 0.72);
    assembly.add(floorLabel);

    this.returnInlet = { ...config, y: 0.36 };

    const info = {
      id: 'nutrient-return-inlet',
      category: 'Water storage',
      title: 'Nutrient return inlet',
      description:
        'The single floor inlet that collects drainage from the six NFT tables. Below the grating a DN 150 drop pipe carries the dirty nutrient solution north to the separate return tank; there is no connection of any kind to the clean-water manifold.',
      specs: [
        ['Service', 'NFT drainage · dirty side'],
        ['Inlet', 'DN 150 gravity drop'],
        ['Destination', 'DR-01 nutrient return tank'],
        ['Grating', 'Removable stainless bar grate'],
        ['Cross-connection', 'None'],
      ],
      interactionHint: 'Inspect return inlet',
      interaction: 'inspect',
    };
    assembly.userData.interactable = info;
    this.interactables.push({ object: assembly, data: info });
  }

  buildSigns(parent) {
    const clean = new THREE.Group();
    clean.name = 'clean-water-sign';
    clean.position.set(-7.9, 0, -13.16);
    for (const sx of [-0.56, 0.56]) {
      clean.add(
        new THREE.Mesh(
          new LowPolyCylinderGeometry(0.03, 0.032, 1.5, 10),
          this.materials.steelDark,
        ),
      );
      clean.children[clean.children.length - 1].position.set(sx, 0.75, 0);
    }
    const cleanBoard = this.label(
      'CLEAN WATER',
      'RESERVOIR 1 · RESERVOIR 2 · PERMEATE ONLY',
      1.24,
      0.32,
      {
        background: '#e6efea',
        foreground: '#124a44',
      },
    );
    cleanBoard.position.set(0, 1.34, 0.035);
    clean.add(cleanBoard);
    const cleanBack = this.label('CLEAN WATER', 'ROOF HARVEST → RESERVOIRS', 1.24, 0.32, {
      background: '#cddbd4',
      foreground: '#124a44',
    });
    cleanBack.position.set(0, 1.34, -0.035);
    cleanBack.rotation.y = Math.PI;
    clean.add(cleanBack);
    parent.add(clean);

    const dirty = new THREE.Group();
    dirty.name = 'dirty-water-sign';
    dirty.position.set(6.0, 0, -12.98);
    for (const sx of [-0.6, 0.6]) {
      const post = new THREE.Mesh(
        new LowPolyCylinderGeometry(0.03, 0.032, 1.5, 10),
        this.materials.steelDark,
      );
      post.position.set(sx, 0.75, 0);
      dirty.add(post);
    }
    const dirtyBoard = this.label('DIRTY WATER', 'NUTRIENT RETURN · DO NOT MIX', 1.3, 0.32, {
      background: '#f2dfd1',
      foreground: '#5a2718',
    });
    dirtyBoard.position.set(0, 1.34, 0.035);
    dirty.add(dirtyBoard);
    const dirtyBack = this.label('DIRTY WATER', 'NFT DRAIN → DR-01', 1.3, 0.32, {
      background: '#e2c8b6',
      foreground: '#5a2718',
    });
    dirtyBack.position.set(0, 1.34, -0.035);
    dirtyBack.rotation.y = Math.PI;
    dirty.add(dirtyBack);
    parent.add(dirty);
  }

  update(dt, waterSnapshot = null) {
    this.runningTime += dt;
    const blend = Math.min(1, dt * 1.8);

    const tankLevels = new Map();
    for (const tank of waterSnapshot?.tanks ?? []) {
      if (tank && typeof tank.id === 'string') tankLevels.set(tank.id, tank.level);
    }

    this.roVisuals.forEach((visual) => {
      const reported = tankLevels.get(visual.id);
      const target = Number.isFinite(reported) ? reported : visual.level;
      visual.level += (target - visual.level) * blend;
      const level = THREE.MathUtils.clamp(visual.level, 0, 1);

      visual.liquid.position.y = this.levelY(level, visual);

      if (visual.gaugeWater && visual.gaugeRange) {
        const [bottom, top] = visual.gaugeRange;
        const height = Math.max(0.02, (top - bottom) * level);
        visual.gaugeWater.scale.y = height;
        visual.gaugeWater.position.y = bottom + height / 2;
        visual.gaugeFloat.position.y = bottom + height;
      }
    });

    const harvester = this.harvester;
    if (harvester) {
      const reported = waterSnapshot?.harvester?.level;
      const target = Number.isFinite(reported) ? reported : harvester.level;
      harvester.level += (target - harvester.level) * blend;
      const level = THREE.MathUtils.clamp(harvester.level, 0, 1);
      const topY = harvester.topY ?? -0.52;
      harvester.liquid.position.y =
        topY - 0.07 - (1 - level) * ((harvester.height ?? 2.45) - 0.16);
      harvester.rainGain = waterSnapshot?.rainInflow ?? 0;
    }

    const returned = this.returnVisuals;
    if (returned) {
      const reported = waterSnapshot?.returnTank?.level;
      const target = Number.isFinite(reported) ? reported : 0.31;
      returned.level = (returned.level ?? 0.31) + (target - (returned.level ?? 0.31)) * blend;
      const level = THREE.MathUtils.clamp(returned.level, 0, 1);
      returned.liquid.position.y =
        returned.topY - (1 - level) * (returned.height - 0.12) - 0.06;
      if (returned.beacon) {
        const alarm = level > 0.82;
        const pulse = 0.75 + Math.sin(this.runningTime * (alarm ? 9 : 2.2)) * 0.25;
        returned.beacon.visible = alarm || Math.sin(this.runningTime * 2.2) > 0.4;
        returned.beacon.scale.setScalar(pulse);
      }
    }

    if (this.transferPump) {
      const on = this.control?.pumps?.rainwaterTransferOn ?? true;
      const pulse = on ? 1 + Math.sin(this.runningTime * 6) * 0.18 : 0.82;
      this.transferPump.lamp.material = on
        ? this.materials.ledGreen
        : this.materials.ledRed;
      this.transferPump.lamp.scale.setScalar(pulse);
      this.transferPump.lamp.visible = true;
    }

    for (const valve of this.valves) {
      const open = this.control?.storageValves?.[valve.tankId] ?? true;
      const target = open ? 0 : Math.PI / 2;
      valve.angle += (target - valve.angle) * Math.min(1, dt * 6);
      valve.handle.rotation.y = valve.angle;
    }

    if (this.flushValveWheel) {
      const settling = Math.sin(this.runningTime * 0.9) * 0.25;
      this.flushValveWheel.rotation.z = settling;
    }
  }

  setTopView(active) {
    this.topViewActive = Boolean(active);
    if (this.coverGroup) this.coverGroup.visible = !this.topViewActive;
    if (this.cutawayGroup) this.cutawayGroup.visible = this.topViewActive;
    return this;
  }

  dispose() {
    this.labelMaterials.forEach((material) => material.dispose?.());
    this.labelMaterials.length = 0;
    if (this.group) {
      this.group.traverse((object) => {
        if (object.isMesh || object.isLine) object.geometry?.dispose?.();
      });
      this.group.removeFromParent();
    }
    this.roVisuals.length = 0;
    this.returnVisuals = null;
    this.harvester = null;
    this.transferPump = null;
    this.valves.length = 0;
    this.interactables.length = 0;
    this.group = null;
  }
}
