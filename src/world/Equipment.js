import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { BeamBatch, CylinderBatch, boxMesh } from './Batches.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Greenhouse equipment: NFT benches, bulk tanks, nutrient dosing station,
 * pump skid, control cabinet, circulation fans and the pipework connecting them.
 * Each unit exposes `userData.interactable` metadata for the inspect system and
 * registers its footprint with the collision world.
 */
export class Equipment {
  constructor({ scene, materials, collisionWorld }) {
    this.scene = scene;
    this.materials = materials;
    this.collisionWorld = collisionWorld;
    this.interactables = [];
    this.fans = [];
    this.group = null;
  }

  build() {
    this.group = new THREE.Group();
    this.group.name = 'equipment';

    this.buildBenches();
    this.buildReservoirs();
    this.buildNutrientStation();
    this.buildPumpSkid();
    this.buildControlCabinet();
    this.buildFans();
    this.buildPipework();

    this.scene.add(this.group);
    return this;
  }

  register(object, data) {
    object.userData.interactable = data;
    this.interactables.push({ object, data });
    return object;
  }

  buildBenches() {
    const beds = LAYOUT.beds;
    const {
      centersX,
      channelsPerBed,
      channelSpacing,
      channelWidth,
      channelHeight,
      channelLength,
      channelStartZ,
      benchHeight,
      legSpacing,
      slopeDegrees,
    } = beds;

    const rows = new THREE.Group();
    rows.name = 'nft-benches';
    this.group.add(rows);

    const frame = new BeamBatch(this.materials.steel);
    const channels = new BeamBatch(this.materials.pvcWhite);
    const slots = new BeamBatch(this.materials.rubber);
    const plumbing = new CylinderBatch(this.materials.pvcGrey);

    const slope = Math.tan(THREE.MathUtils.degToRad(slopeDegrees));
    const zLow = channelStartZ + channelLength;
    const railTopAt = (z) => benchHeight + slope * (zLow - z);
    const channelCentreAt = (z) => railTopAt(z) + 0.02 + channelHeight / 2;
    const bedHalfWidth = 0.4;
    const legZs = [];
    for (let z = channelStartZ; z <= zLow + 1e-6; z += legSpacing) legZs.push(z);

    const rowGroups = [];


    centersX.forEach((cx, row) => {
      const rowGroup = new THREE.Group();
      rowGroup.name = `nft-row-${row + 1}`;
      rows.add(rowGroup);
      rowGroups.push({ group: rowGroup, cx, row });

      for (const z of legZs) {
        const top = railTopAt(z);
        for (const sx of [-1, 1]) {
          frame.add(V(cx + sx * bedHalfWidth, 0.02, z), V(cx + sx * bedHalfWidth, top, z), 0.055, 0.055);
        }
        frame.add(V(cx - bedHalfWidth, top - 0.03, z), V(cx + bedHalfWidth, top - 0.03, z), 0.05, 0.05);
        frame.add(V(cx - bedHalfWidth, 0.22, z), V(cx + bedHalfWidth, 0.22, z), 0.04, 0.04);
      }

      for (const sx of [-1, 1]) {
        frame.add(
          V(cx + sx * bedHalfWidth, railTopAt(channelStartZ) - 0.02, channelStartZ),
          V(cx + sx * bedHalfWidth, railTopAt(zLow) - 0.02, zLow),
          0.06,
          0.08,
        );
      }

      for (let c = 0; c < channelsPerBed; c += 1) {
        const x = cx + (c - (channelsPerBed - 1) / 2) * channelSpacing;
        const topStart = channelCentreAt(channelStartZ) + channelHeight / 2;
        const topEnd = channelCentreAt(zLow) + channelHeight / 2;

        channels.add(
          V(x, channelCentreAt(channelStartZ), channelStartZ),
          V(x, channelCentreAt(zLow), zLow),
          channelWidth,
          channelHeight,
        );
        slots.add(
          V(x, topStart + 0.002, channelStartZ + 0.06),
          V(x, topEnd + 0.002, zLow - 0.06),
          0.052,
          0.004,
        );

        // End cap and drain spout at the low end of each channel.
        const cap = boxMesh(
          channelWidth + 0.02,
          channelHeight + 0.02,
          0.05,
          this.materials.pvcGrey,
          V(x, channelCentreAt(zLow), zLow + 0.025),
          'channel-end-cap',
        );
        cap.castShadow = false;
        rowGroup.add(cap);
        plumbing.addPath(
          [
            V(x, channelCentreAt(zLow) - 0.03, zLow + 0.03),
            V(x, channelCentreAt(zLow) - 0.06, zLow + 0.28),
            V(x, 0.58, zLow + 0.28),
          ],
          0.022,
        );

        // Feed stub from the header pipe above the high end.
        plumbing.addPath(
          [
            V(x, channelCentreAt(channelStartZ) + 0.28, channelStartZ - 0.34),
            V(x, channelCentreAt(channelStartZ) + 0.28, channelStartZ - 0.1),
            V(x, topStart + 0.04, channelStartZ + 0.01),
          ],
          0.014,
        );
      }

      // Header pipe feeding this row.
      plumbing.add(
        V(cx - bedHalfWidth - 0.1, channelCentreAt(channelStartZ) + 0.3, channelStartZ - 0.34),
        V(cx + bedHalfWidth + 0.1, channelCentreAt(channelStartZ) + 0.3, channelStartZ - 0.34),
        0.026,
      );
    });

    frame.build(rows, 'bench-frames');
    channels.build(rows, 'nft-channels');
    slots.build(rows, 'channel-slots');
    plumbing.build(rows, 'bench-plumbing');

    rowGroups.forEach(({ group, row, cx }) => {
      // Instanced batch geometry is not raycastable per row, so give each row an
      // invisible hit volume covering the bench footprint (also used by the
      // BoxHelper highlight).
      const benchTopY = channelCentreAt(channelStartZ + channelLength / 2) + channelHeight / 2;
      const hitProxy = new THREE.Mesh(
        new THREE.BoxGeometry(bedHalfWidth * 2, benchTopY, channelLength),
        this.materials.hitProxy,
      );
      hitProxy.name = `nft-row-${row + 1}-hit`;
      hitProxy.position.set(cx, benchTopY / 2, channelStartZ + channelLength / 2);
      hitProxy.visible = false;
      group.add(hitProxy);

      this.register(group, {
        id: `nft-row-${row + 1}`,
        category: 'Growing system',
        title: `NFT bench — Row ${row + 1}`,
        description:
          'Three gravity-fed nutrient film channels on a galvanised bench. A shallow film of nutrient solution runs continuously from the high end to the drain, keeping roots moist and oxygenated.',
        specs: [
          ['Channels', `${channelsPerBed} × ${channelLength} m`],
          ['Channels / house', String(centersX.length * channelsPerBed)],
          ['Bench height', `${benchHeight.toFixed(2)} m`],
          ['Falling slope', `${slopeDegrees}°`],
          ['Flow rate', '2.0 L/min / channel'],
          ['Crop', 'Loose-leaf lettuce'],
        ],
      });
    });

    for (const cx of centersX) {
      this.collisionWorld.addBox({
        x: cx,
        z: channelStartZ + channelLength / 2,
        width: bedHalfWidth * 2 + 0.12,
        depth: channelLength + 0.2,
        label: 'NFT bench',
      });
    }
  }

  buildReservoirs() {
    const { radius, height, positions } = LAYOUT.tanks.reservoirs;
    const group = new THREE.Group();
    group.name = 'bulk-reservoirs';
    this.group.add(group);

    const pipes = new CylinderBatch(this.materials.pipeDark);
    const labels = [
      this.materials.createLabelMaterial('RESERVOIR A', 'NFT STOCK SOLUTION · 4 000 L'),
      this.materials.createLabelMaterial('RESERVOIR B', 'DRAIN RETURN · 4 000 L'),
    ];

    positions.forEach(([x, z], index) => {
      const tank = new THREE.Group();
      tank.name = `reservoir-${index + 1}`;
      tank.position.set(x, 0, z);
      group.add(tank);

      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, height, 28, 1, true),
        this.materials.tankHDPE,
      );
      body.position.y = height / 2 + 0.12;
      body.castShadow = true;
      body.receiveShadow = true;
      tank.add(body);

      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + 0.04, radius + 0.04, 0.14, 28),
        this.materials.tankHDPE,
      );
      base.position.y = 0.07;
      base.castShadow = true;
      base.receiveShadow = true;
      tank.add(base);

      const lid = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + 0.02, radius + 0.02, 0.09, 28),
        this.materials.tankHDPELight,
      );
      lid.position.y = height + 0.16;
      lid.castShadow = true;
      tank.add(lid);

      const manway = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.12, 18),
        this.materials.tankHDPELight,
      );
      manway.position.y = height + 0.25;
      manway.castShadow = true;
      tank.add(manway);

      for (const y of [0.75, 1.55, 2.35]) {
        const rib = new THREE.Mesh(
          new THREE.TorusGeometry(radius + 0.012, 0.022, 6, 30),
          this.materials.tankHDPELight,
        );
        rib.rotation.x = Math.PI / 2;
        rib.position.y = y;
        tank.add(rib);
      }

      // Sight glass on the aisle-facing side, with a scale plate.
      const sightX = -radius * 0.55;
      const sightZ = radius * 0.82;
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.024, 0.024, 1.85, 10, 1, true),
        this.materials.glassDoor,
      );
      tube.position.set(sightX, 1.25, sightZ);
      tube.renderOrder = 3;
      tank.add(tube);

      const level = new THREE.Mesh(
        new THREE.CylinderGeometry(0.017, 0.017, 1.15, 10),
        this.materials.water,
      );
      level.position.set(sightX, 0.9, sightZ);
      tank.add(level);

      const scale = boxMesh(0.06, 0.62, 0.16, this.materials.cabinetPaint, V(sightX + 0.05, 1.3, sightZ), 'sight-scale');
      scale.castShadow = false;
      tank.add(scale);

      tank.add(
        boxMesh(0.62, 0.34, 0.02, labels[index], V(0, 1.8, radius + 0.02), 'reservoir-label'),
      );

      pipes.addPath(
        [
          V(x + radius * 0.72, 0.4, z + radius * 0.7),
          V(x + radius * 0.72 + 0.55, 0.4, z + radius * 0.7),
          V(x + radius * 0.72 + 0.55, 0.16, z + radius * 0.7),
        ],
        0.05,
      );

      this.register(tank, {
        id: `reservoir-${index + 1}`,
        category: 'Water & nutrient',
        title: index === 0 ? 'Reservoir A — stock tank' : 'Reservoir B — drain return',
        description:
          'Insulated HDPE bulk tank with a sight glass for manual level checks. Reservoir A holds freshly mixed nutrient solution; Reservoir B collects the return flow from the NFT channels before it is re-dosed and pumped back.',
        specs: [
          ['Capacity', '4 000 L'],
          ['Diameter', `${(radius * 2).toFixed(1)} m`],
          ['Height', `${height.toFixed(2)} m`],
          ['Level', index === 0 ? '72 %' : '38 %'],
          ['Solution temp.', '19.8 °C'],
          ['Material', 'Double-wall HDPE'],
        ],
      });

      this.collisionWorld.addCircle({ x, z, radius: radius + 0.1, label: 'reservoir' });
    });

    pipes.build(group, 'reservoir-outlets');
  }


  buildNutrientStation() {
    const { radius, height, position, spacing, labels } = LAYOUT.tanks.nutrients;
    const [baseX, baseZ] = position;
    const station = new THREE.Group();
    station.name = 'nutrient-station';
    this.group.add(station);

    // Containment bund.
    const bund = boxMesh(3.15, 0.14, 1.0, this.materials.pvcGrey, V(baseX + spacing, 0.07, baseZ), 'nutrient-bund');
    bund.castShadow = false;
    station.add(bund);

    // Dosing frame behind the drums.
    const frame = new BeamBatch(this.materials.steel);
    const frameZ = baseZ - 0.72;
    for (const x of [baseX - 0.5, baseX + spacing * 2 + 0.5]) {
      frame.add(V(x, 0.1, frameZ), V(x, 1.75, frameZ), 0.06, 0.06);
      frame.add(V(x, 1.72, frameZ), V(x, 1.72, baseZ + 0.45), 0.05, 0.05);
    }
    frame.add(V(baseX - 0.5, 1.72, frameZ), V(baseX + spacing * 2 + 0.5, 1.72, frameZ), 0.06, 0.06);
    frame.add(V(baseX - 0.5, 1.2, frameZ), V(baseX + spacing * 2 + 0.5, 1.2, frameZ), 0.05, 0.05);
    frame.build(station, 'nutrient-frame');

    const dosing = new CylinderBatch(this.materials.pvcGrey);
    const drums = new THREE.Group();

    labels.forEach(([letter, chemical], index) => {
      const x = baseX + index * spacing;
      const drum = new THREE.Group();
      drum.name = `nutrient-drum-${letter}`;
      drum.position.set(x, 0.14, baseZ);
      drums.add(drum);

      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, height, 22),
        this.materials.tankHDPELight,
      );
      body.position.y = height / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      drum.add(body);

      const lid = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + 0.02, radius + 0.02, 0.07, 22),
        this.materials.pvcGrey,
      );
      lid.position.y = height + 0.03;
      drum.add(lid);

      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.1, 12),
        this.materials.pumpPaint,
      );
      cap.position.set(radius * 0.55, height + 0.1, 0);
      drum.add(cap);

      const label = this.materials.createLabelMaterial(
        `${letter} · ${chemical.split(' ')[0]}`,
        chemical,
      );
      drum.add(
        boxMesh(0.52, 0.3, 0.02, label, V(0, height * 0.62, radius + 0.02), 'drum-label'),
      );

      // Suction lance and dosing line up to the pump shelf.
      dosing.addPath(
        [
          V(x, height + 0.16, baseZ),
          V(x, 1.5, frameZ + 0.02),
          V(x, 1.5, frameZ - 0.16),
        ],
        0.014,
      );

      // Dosing pump on the shelf.
      const pump = boxMesh(0.2, 0.16, 0.3, this.materials.pumpPaint, V(x, 1.32, frameZ), 'dosing-pump');
      station.add(pump);
      station.add(
        boxMesh(0.14, 0.09, 0.02, this.materials.screen, V(x, 1.34, frameZ + 0.16), 'dosing-display'),
      );

      this.register(drum, {
        id: `nutrient-${letter}`,
        category: 'Water & nutrient',
        title: `Nutrient drum ${letter}`,
        description: `Concentrated ${chemical.toLowerCase()} stock, dosed into the mixing tank by a peristaltic pump. Drum weights and dosing volumes are logged at every batch mix.`,
        specs: [
          ['Chemical', chemical],
          ['Volume', '60 L'],
          ['Drum level', ['64 %', '58 %', '71 %'][index]],
          ['Dosing pump', 'Peristaltic, 3 L/h'],
          ['Last dose', '10:18'],
          ['Target EC', '1.8 mS/cm'],
        ],
      });
    });

    station.add(drums);
    dosing.build(station, 'nutrient-lines');

    this.register(station, {
      id: 'nutrient-station',
      category: 'Water & nutrient',
      title: 'Nutrient dosing station',
      description:
        'Three-part stock dosing: calcium nitrate, potassium sulphate and nitric acid for pH control. Each drum feeds a dedicated peristaltic pump controlled from the climate cabinet.',
      specs: [
        ['Drums', '3 × 60 L'],
        ['Pumps', '3 × peristaltic'],
        ['Controller', 'Dosing unit · 4-channel'],
        ['pH target', '5.8 – 6.0'],
        ['EC target', '1.8 mS/cm'],
        ['Bund', '110 % containment'],
      ],
    });

    this.collisionWorld.addBox({
      x: baseX + spacing,
      z: baseZ - 0.3,
      width: spacing * 2 + 1.0,
      depth: 1.3,
      label: 'nutrient dosing station',
    });
  }


  buildPumpSkid() {
    const skid = new THREE.Group();
    skid.name = 'pump-skid';
    this.group.add(skid);

    // Common skid frame.
    skid.add(
      boxMesh(2.1, 0.1, 1.0, this.materials.steelDark, V(5.35, 0.05, -14.3), 'pump-skid-base'),
    );
    const rails = new BeamBatch(this.materials.steelDark);
    for (const z of [-14.75, -13.85]) {
      rails.add(V(4.3, 0.12, z), V(6.4, 0.12, z), 0.07, 0.07);
    }
    rails.build(skid, 'pump-skid-rails');

    const pipework = new CylinderBatch(this.materials.pipeDark);
    const pumps = new THREE.Group();
    skid.add(pumps);

    LAYOUT.pumps.positions.forEach(([x, z], index) => {
      const pump = new THREE.Group();
      pump.name = `pump-${index + 1}`;
      pump.position.set(x, 0, z);
      pumps.add(pump);

      pump.add(boxMesh(1.0, 0.08, 0.44, this.materials.steelDark, V(0, 0.13, 0), 'pump-plinth'));

      const motor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.46, 16),
        this.materials.pumpPaint,
      );
      motor.rotation.z = Math.PI / 2;
      motor.position.set(-0.28, 0.38, 0);
      motor.castShadow = true;
      pump.add(motor);

      const cowl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.13, 0.14, 16),
        this.materials.steelDark,
      );
      cowl.rotation.z = Math.PI / 2;
      cowl.position.set(-0.58, 0.38, 0);
      pump.add(cowl);

      const volute = new THREE.Mesh(
        new THREE.CylinderGeometry(0.21, 0.21, 0.24, 18),
        this.materials.pumpPaint,
      );
      volute.rotation.z = Math.PI / 2;
      volute.position.set(0.2, 0.38, 0);
      volute.castShadow = true;
      pump.add(volute);

      const suction = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.34, 12),
        this.materials.pipeDark,
      );
      suction.position.set(0.2, 0.55, 0.22);
      pump.add(suction);

      const discharge = new THREE.Mesh(
        new THREE.CylinderGeometry(0.048, 0.048, 0.3, 12),
        this.materials.pipeDark,
      );
      discharge.position.set(0.2, 0.9, 0);
      pump.add(discharge);

      // Discharge valve wheel.
      const wheel = new THREE.Mesh(
        new THREE.TorusGeometry(0.085, 0.012, 6, 18),
        this.materials.stainless,
      );
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(0.2, 1.06, 0);
      pump.add(wheel);
      const spindle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6),
        this.materials.stainless,
      );
      spindle.position.set(0.2, 1.0, 0);
      pump.add(spindle);

      // Pump plate.
      pump.add(
        boxMesh(
          0.3,
          0.16,
          0.02,
          this.materials.createLabelMaterial(`P-${index + 1}`, index === 0 ? 'DUTY' : 'STANDBY'),
          V(-0.28, 0.62, 0.17),
          'pump-plate',
        ),
      );

      // Suction and discharge connections to the floor / overhead mains.
      pipework.addPath(
        [
          V(x, 0.35, z + 0.32),
          V(x, 0.35, z + 0.55),
          V(x, 0.16, z + 0.55),
        ],
        0.05,
      );
      pipework.addPath(
        [
          V(x, 1.05, z),
          V(x, 1.35, z),
          V(x, 1.35, z + 0.75),
        ],
        0.045,
      );

      this.register(pump, {
        id: `pump-${index + 1}`,
        category: 'Water & nutrient',
        title: `Circulation pump P-${index + 1}`,
        description:
          index === 0
            ? 'Duty pump for the NFT supply main. Draws filtered nutrient solution from Reservoir A and pushes it to the row headers at roughly 2 bar.'
            : 'Standby pump on automatic changeover. Starts if the duty pump trips or if the supply pressure falls below setpoint.',
        specs: [
          ['Duty', index === 0 ? 'Lead / duty' : 'Standby'],
          ['Flow', '90 L/min'],
          ['Head', '18 m'],
          ['Motor', '1.1 kW · 230 V'],
          ['Running hours', index === 0 ? '1 284 h' : '212 h'],
          ['Status', index === 0 ? 'Running' : 'Ready'],
        ],
      });
    });

    pipework.build(skid, 'pump-connections');

    this.register(skid, {
      id: 'pump-skid',
      category: 'Water & nutrient',
      title: 'Pump skid',
      description:
        'Duty / standby centrifugal pumps on a common skid, with isolation valves and a pressure switch. The skid is the hydraulic heart of the NFT loop.',
      specs: [
        ['Configuration', '2 × 90 L/min'],
        ['Control', 'Duty / standby auto-changeover'],
        ['Supply pressure', '1.9 bar'],
        ['Isolation', 'Ball valves, both sides'],
        ['Power', '2 × 1.1 kW'],
        ['Status', '1 running · 1 ready'],
      ],
    });

    this.collisionWorld.addBox({
      x: 5.35,
      z: -14.3,
      width: 2.2,
      depth: 1.1,
      label: 'pump skid',
    });
  }


  buildControlCabinet() {
    const [x, z] = LAYOUT.cabinet.position;
    const [width, height, depth] = LAYOUT.cabinet.size;
    const cabinet = new THREE.Group();
    cabinet.name = 'control-cabinet';
    cabinet.position.set(x, 0, z);
    this.group.add(cabinet);

    const body = boxMesh(width, height, depth, this.materials.cabinetPaint, V(0, 1.62, 0), 'cabinet-body');
    cabinet.add(body);

    // Door, hinged on the north edge, facing the aisle (-X).
    const door = boxMesh(0.03, height - 0.08, depth - 0.06, this.materials.cabinetPaint, V(-width / 2 - 0.015, 1.62, 0), 'cabinet-door');
    cabinet.add(door);

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.2),
      this.materials.screen,
    );
    screen.rotation.y = -Math.PI / 2;
    screen.position.set(-width / 2 - 0.032, 1.92, 0.12);
    cabinet.add(screen);

    const button = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.02, 12),
      this.materials.stainless,
    );
    button.rotation.z = Math.PI / 2;
    button.position.set(-width / 2 - 0.035, 1.42, -0.06);
    cabinet.add(button);

    const handle = boxMesh(0.03, 0.22, 0.035, this.materials.stainless, V(-width / 2 - 0.04, 1.5, -0.32), 'cabinet-handle');
    cabinet.add(handle);

    cabinet.add(
      boxMesh(
        0.02,
        0.16,
        0.26,
        this.materials.createLabelMaterial('CLIMATE', 'CONTROL · 400 V'),
        V(-width / 2 - 0.035, 1.2, 0.18),
        'cabinet-label',
      ),
    );

    // Cable tray / conduit rising to the roof purlin.
    const conduit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 2.5, 10),
      this.materials.pvcGrey,
    );
    conduit.position.set(-0.1, 3.0, -0.36);
    cabinet.add(conduit);

    this.register(cabinet, {
      id: 'control-cabinet',
      category: 'Controls',
      title: 'Climate control cabinet',
      description:
        'Main control panel for fertigation, vents and circulation. Setpoints, dosing recipes and alarm history are managed here; the touchscreen mirrors the same data on a phone.',
      specs: [
        ['Controller', 'GreenCtrl 400'],
        ['Functions', 'Fertigation · vents · fans'],
        ['Sensors', 'Air temp / RH / CO₂'],
        ['Mode', 'Auto'],
        ['Day setpoint', '21.5 °C'],
        ['Alarms', 'None active'],
      ],
    });

    this.collisionWorld.addBox({
      x: x - 0.05,
      z,
      width: 0.55,
      depth: depth + 0.2,
      label: 'control cabinet',
    });
  }

  buildFans() {
    const { positions, height, radius } = LAYOUT.fans;
    const fanRoot = new THREE.Group();
    fanRoot.name = 'circulation-fans';
    this.group.add(fanRoot);

    positions.forEach(([x, z], index) => {
      const fan = new THREE.Group();
      fan.name = `fan-${index + 1}`;
      fan.position.set(x, height, z);
      fanRoot.add(fan);

      // Suspension rods up to the ridge tie.
      const rods = new BeamBatch(this.materials.steelDark);
      rods.add(V(0, 0, 0), V(0, 0.62, 0), 0.025, 0.025);
      rods.add(V(-0.2, 0.1, 0), V(-0.2, 0.62, 0), 0.018, 0.018);
      rods.add(V(0.2, 0.1, 0), V(0.2, 0.62, 0), 0.018, 0.018);
      rods.build(fan, `fan-${index + 1}-rods`);

      const motor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.14, 0.28, 16),
        this.materials.pumpPaint,
      );
      motor.castShadow = true;
      fan.add(motor);

      const rotor = new THREE.Group();
      rotor.position.y = -0.2;
      fan.add(rotor);

      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 0.1, 14),
        this.materials.aluminium,
      );
      rotor.add(hub);

      for (let b = 0; b < 5; b += 1) {
        const pivot = new THREE.Group();
        pivot.rotation.y = (b / 5) * Math.PI * 2;
        const blade = new THREE.Mesh(
          new THREE.BoxGeometry(radius * 0.82, 0.012, 0.16),
          this.materials.aluminium,
        );
        blade.position.set(radius * 0.55, 0, 0);
        blade.rotation.x = 0.26;
        blade.castShadow = true;
        pivot.add(blade);
        rotor.add(pivot);
      }

      const guard = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.012, 6, 40),
        this.materials.steelDark,
      );
      guard.rotation.x = Math.PI / 2;
      guard.position.y = -0.24;
      fan.add(guard);

      const lowerGuard = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 0.62, 0.01, 6, 32),
        this.materials.steelDark,
      );
      lowerGuard.rotation.x = Math.PI / 2;
      lowerGuard.position.y = -0.34;
      fan.add(lowerGuard);

      this.fans.push({ group: fan, rotor, speed: 2.1 + index * 0.15 });

      // Invisible hit volume so the high-mounted fan is easy to target from the
      // floor without pixel-perfect aim at the blades or guard ring.
      const hitProxy = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + 0.22, radius + 0.22, 0.95, 14),
        this.materials.hitProxy,
      );
      hitProxy.name = `fan-${index + 1}-hit`;
      hitProxy.position.y = -0.18;
      hitProxy.visible = false;
      fan.add(hitProxy);

      this.register(fan, {
        id: `fan-${index + 1}`,
        category: 'Climate',
        title: `Circulation fan ${index + 1}`,
        description:
          'Horizontal air circulator that keeps temperature and humidity uniform through the crop canopy. Runs continuously during the day and on a humidity trigger at night.',
        specs: [
          ['Diameter', `${(radius * 2).toFixed(2)} m`],
          ['Airflow', '4 200 m³/h'],
          ['Mounting', 'Suspended, ridge tie'],
          ['Speed', '1 400 rpm'],
          ['Control', 'VFD · 0-100 %'],
          ['Status', 'Running · 65 %'],
        ],
      });
    });
  }


  buildPipework() {
    const mains = new THREE.Group();
    mains.name = 'main-pipework';
    this.group.add(mains);

    const pvc = new CylinderBatch(this.materials.pvcGrey);
    const dark = new CylinderBatch(this.materials.pipeDark);
    const bedRowXs = LAYOUT.beds.centersX;

    // Suction main: reservoir outlets along the headhouse wall to the pumps.
    pvc.addPath(
      [
        V(-8.15, 0.16, -14.23),
        V(-8.15, 0.16, -13.75),
        V(6.1, 0.16, -13.75),
      ],
      0.05,
    );
    pvc.addPath([V(-4.95, 0.16, -14.23), V(-4.95, 0.16, -13.75)], 0.05);

    // Discharge from each pump down onto the feed main.
    for (const [x] of LAYOUT.pumps.positions) {
      pvc.addPath(
        [
          V(x, 1.35, -13.55),
          V(x, 1.35, -13.3),
          V(x, 0.2, -13.3),
        ],
        0.045,
      );
    }

    // Feed main: east aisle, then west along the head of the benches.
    pvc.addPath(
      [
        V(4.6, 0.2, -13.3),
        V(10.9, 0.2, -13.3),
        V(10.9, 0.2, -9.6),
        V(-10.6, 0.2, -9.6),
      ],
      0.055,
    );

    // Riser + isolation valve at the head of every bench row.
    const highHeaderY = LAYOUT.beds.benchHeight +
      Math.tan(THREE.MathUtils.degToRad(LAYOUT.beds.slopeDegrees)) * LAYOUT.beds.channelLength +
      0.02 + LAYOUT.beds.channelHeight / 2 + 0.3;
    for (const x of bedRowXs) {
      pvc.addPath(
        [
          V(x, 0.2, -9.6),
          V(x, highHeaderY, -9.6),
          V(x, highHeaderY, -9.34),
        ],
        0.032,
      );
      const wheel = new THREE.Mesh(
        new THREE.TorusGeometry(0.075, 0.01, 6, 16),
        this.materials.stainless,
      );
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 1.0, -9.6);
      mains.add(wheel);
    }

    // Return collector under the low ends of the benches.
    pvc.addPath([V(-10.2, 0.58, 9.28), V(10.2, 0.58, 9.28)], 0.065);
    pvc.addPath(
      [
        V(-10.2, 0.58, 9.28),
        V(-11.3, 0.58, 9.28),
        V(-11.3, 0.25, 9.28),
        V(-11.3, 0.25, -16.0),
        V(-7.7, 0.25, -16.0),
        V(-7.7, 0.52, -15.1),
      ],
      0.055,
    );

    // Shallow collection trough so the return reads continuously along the row.
    pvc.add(V(-10.0, 0.62, 9.05), V(10.0, 0.62, 9.05), 0.028);

    // Balance line between the two bulk tanks.
    dark.addPath([V(-7.58, 0.55, -15.1), V(-8.42, 0.55, -15.1)], 0.05);

    // Inline filter beside the pump skid.
    const filter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.17, 0.52, 16),
      this.materials.stainless,
    );
    filter.position.set(7.05, 0.78, -14.75);
    filter.castShadow = true;
    mains.add(filter);
    const gauge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.03, 16),
      this.materials.stainless,
    );
    gauge.rotation.z = Math.PI / 2;
    gauge.position.set(7.05, 1.08, -14.75);
    mains.add(gauge);

    pvc.build(mains, 'pvc-mains');
    dark.build(mains, 'dark-mains');
  }

  getInteractables() {
    return this.interactables;
  }

  update(dt) {
    for (const fan of this.fans) {
      fan.rotor.rotation.y += fan.speed * dt;
    }
  }

  dispose() {
    if (!this.group) return;
    this.group.traverse((child) => {
      if (child.isMesh && child.geometry) child.geometry.dispose();
    });
    this.group.parent?.remove(this.group);
    this.group = null;
    this.fans.length = 0;
    this.interactables.length = 0;
  }
}

