import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { CylinderBatch, boxMesh } from './Batches.js';
import { DashboardDisplay } from './DashboardDisplay.js';
import { NftTables } from './NftTables.js';
import { HydraulicNetwork } from './HydraulicNetwork.js';
import { HafFans } from './HafFans.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DEG = THREE.MathUtils.degToRad;

/**
 * Greenhouse equipment: NFT tables, bulk tanks, nutrient dosing station,
 * circulation pumps, climate cabinet, fans and the connecting pipework.
 * Each unit exposes `userData.interactable` metadata for the inspect system and
 * registers its footprint with the collision world.
 */
export class Equipment {
  constructor({ scene, materials, collisionWorld, climate = null }) {
    this.scene = scene;
    this.materials = materials;
    this.collisionWorld = collisionWorld;
    this.climate = climate;
    this.interactables = [];
    this.fans = [];
    this.tables = [];
    this.tableSystem = null;
    this.hydraulics = null;
    this.fanSystem = null;
    this.fansEnabled = true;
    this.group = null;
    this.dashboard = null;
    this.cabinetDoor = null;
    this.doorAmount = 0;
    this.doorTarget = 0;
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

  getInteractables() {
    return this.interactables;
  }

  /* ------------------------------------------------------------- NFT tables */

  buildBenches() {
    this.tableSystem = new NftTables({
      materials: this.materials,
      collisionWorld: this.collisionWorld,
    }).build(this.group);
    this.tables = this.tableSystem.tables;
    this.interactables.push(...this.tableSystem.interactables);
  }


  /* -------------------------------------------------------------- bulk water */

  buildReservoirs() {
    const config = LAYOUT.tanks.reservoirs;
    const group = new THREE.Group();
    group.name = 'bulk-reservoirs';
    this.group.add(group);

    const labels = [
      ['RO STORAGE 01', 'RAW WATER · 3,000 L', 'TANK 01'],
      ['RO STORAGE 02', 'MIXED FEED · 3,000 L', 'TANK 02'],
    ];

    config.positions.forEach(([x, z], index) => {
      const tank = new THREE.Group();
      tank.name = `reservoir-${index + 1}`;
      tank.position.set(x, 0, z);
      group.add(tank);

      tank.add(
        boxMesh(
          config.radius * 2.15,
          0.07,
          config.radius * 2.15,
          this.materials.concretePlinth,
          V(0, 0.035, 0),
          `reservoir-pad-${index + 1}`,
        ),
      );

      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(config.radius, config.radius * 1.01, config.height, 40, 1),
        this.materials.tankHDPEBlue,
      );
      shell.position.y = 0.07 + config.height / 2;
      shell.castShadow = true;
      shell.receiveShadow = true;
      tank.add(shell);

      const lid = new THREE.Mesh(
        new THREE.CylinderGeometry(config.radius * 1.015, config.radius * 1.015, 0.05, 40),
        this.materials.tankHDPEBlue,
      );
      lid.position.y = 0.07 + config.height + 0.018;
      lid.castShadow = true;
      tank.add(lid);

      // Ribs and hoops make the moulded HDPE read at close range.
      for (const y of [0.62, 1.43, 2.24]) {
        const hoop = new THREE.Mesh(
          new THREE.TorusGeometry(config.radius * 1.012, 0.018, 6, 40),
          this.materials.tankHDPE,
        );
        hoop.rotation.x = Math.PI / 2;
        hoop.position.y = y;
        tank.add(hoop);
      }

      for (let rib = 0; rib < 12; rib += 1) {
        const angle = (rib / 12) * Math.PI * 2;
        const mesh = boxMesh(
          0.045,
          config.height - 0.2,
          0.09,
          this.materials.tankHDPEBlue,
          V(
            Math.cos(angle) * config.radius * 1.006,
            0.07 + config.height / 2,
            Math.sin(angle) * config.radius * 1.006,
          ),
          `reservoir-rib-${index + 1}-${rib}`,
        );
        mesh.rotation.y = -angle;
        tank.add(mesh);
      }

      const hatch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.08, 24),
        this.materials.pvcGrey,
      );
      hatch.position.set(0.28, 0.07 + config.height + 0.07, 0.1);
      hatch.castShadow = true;
      tank.add(hatch);
      tank.add(
        boxMesh(
          0.3,
          0.035,
          0.06,
          this.materials.steelDark,
          V(0.28, 0.07 + config.height + 0.125, 0.1),
          `reservoir-hatch-handle-${index + 1}`,
        ),
      );

      const vent = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.4, 12),
        this.materials.pvcGrey,
      );
      vent.position.set(-0.65, 0.07 + config.height + 0.21, -0.25);
      tank.add(vent);
      const ventCap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.095, 0.075, 0.06, 12),
        this.materials.pvcGrey,
      );
      ventCap.position.set(-0.65, 0.07 + config.height + 0.43, -0.25);
      tank.add(ventCap);

      // Side-mounted sight tube with a simple float indicator.
      const sightGlass = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.032, 1.5, 12),
        this.materials.glass,
      );
      sightGlass.position.set(0.9, 1.2, config.radius * 0.99);
      tank.add(sightGlass);
      const sightWater = new THREE.Mesh(
        new THREE.CylinderGeometry(0.021, 0.021, 1.12, 10),
        this.materials.water,
      );
      sightWater.position.set(0.9, 0.99, config.radius * 0.99);
      tank.add(sightWater);
      for (const y of [0.46, 1.94]) {
        tank.add(
          boxMesh(
            0.12,
            0.05,
            0.12,
            this.materials.stainless,
            V(0.9, y, config.radius * 0.98),
            `sight-bracket-${index + 1}`,
          ),
        );
      }

      // Printed plate sits on a stainless carrier on the front of the tank.
      const [title, subtitle] = labels[index];
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(1.28, 0.64),
        this.materials.createLabelMaterial(title, subtitle, {
          background: '#f0f2ea',
          foreground: '#16324a',
        }),
      );
      plate.position.set(0, 1.62, config.radius + 0.012);
      tank.add(plate);
      tank.add(
        boxMesh(
          1.4,
          0.76,
          0.025,
          this.materials.stainless,
          V(0, 1.62, config.radius + 0.001),
          `reservoir-label-frame-${index + 1}`,
        ),
      );

      tank.add(
        boxMesh(
          0.55,
          0.38,
          0.42,
          this.materials.steelDark,
          V(0, 0.28, config.radius + 0.08),
          `reservoir-outlet-box-${index + 1}`,
        ),
      );

      this.collisionWorld.addBox({
        x,
        z,
        width: config.radius * 2.2,
        depth: config.radius * 2.2,
        label: 'Bulk water tank',
      });

      this.register(tank, {
        id: `reservoir-${index + 1}`,
        category: 'Water source',
        title: `Bulk reservoir ${index + 1} — ${title}`,
        description:
          'Insulated HDPE buffer tank holding reverse-osmosis water. A float valve tops the tank up, and the side sight tube gives a local level check. Tank 2 is the mixed feed buffer that supplies the NFT circulation pump.',
        specs: [
          ['Nominal volume', '3,000 L'],
          ['Material', 'Moulded HDPE'],
          ['Current level', index === 0 ? '72 %' : '64 %'],
          ['Top-up', 'RO permeate · float valve'],
          ['Outlet', 'DN50 · bottom drain'],
        ],
      });
    });
  }


  /* ---------------------------------------------------------- dosing station */

  buildNutrientStation() {
    const config = LAYOUT.tanks.nutrients;
    const [baseX, baseZ] = config.position;
    const spacing = config.spacing;
    const totalWidth = spacing * (config.labels.length - 1);
    const station = new THREE.Group();
    station.name = 'nutrient-dosing-station';
    this.group.add(station);

    // Bunded containment tray.
    const bundWidth = totalWidth + config.radius * 2 + 0.7;
    const bundDepth = 1.22;
    station.add(
      boxMesh(
        bundWidth,
        0.14,
        bundDepth,
        this.materials.concretePlinth,
        V(baseX + totalWidth / 2, 0.07, baseZ),
        'nutrient-bund-base',
      ),
    );
    for (const side of [-1, 1]) {
      station.add(
        boxMesh(
          bundWidth,
          0.18,
          0.06,
          this.materials.concretePlinth,
          V(baseX + totalWidth / 2, 0.13, baseZ + side * (bundDepth / 2 - 0.03)),
          `nutrient-bund-rim-${side}`,
        ),
      );
    }

    const dosingLines = new CylinderBatch(this.materials.pvcWhite);
    const dosingRailY = 0.42;
    const railZ = baseZ + 0.62;

    config.labels.forEach((label, index) => {
      const x = baseX + index * spacing;
      const tank = new THREE.Group();
      tank.name = `nutrient-tank-${label.key}`;
      station.add(tank);

      const shellMaterial =
        label.colour === 'white' ? this.materials.tankHDPEAcid : this.materials.tankHDPEBlue;
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(config.radius, config.radius * 1.02, config.height, 28),
        shellMaterial,
      );
      shell.position.set(x, 0.14 + config.height / 2, baseZ);
      shell.castShadow = true;
      shell.receiveShadow = true;
      tank.add(shell);

      const lid = new THREE.Mesh(
        new THREE.CylinderGeometry(config.radius * 0.52, config.radius * 0.52, 0.07, 20),
        this.materials.pvcGrey,
      );
      lid.position.set(x + 0.08, 0.14 + config.height + 0.035, baseZ - 0.03);
      lid.castShadow = true;
      tank.add(lid);

      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.12, 0.018, 6, 14, Math.PI),
        this.materials.steelDark,
      );
      handle.rotation.y = Math.PI / 2;
      handle.position.set(x + 0.08, 0.14 + config.height + 0.09, baseZ - 0.03);
      tank.add(handle);

      // Moulded rib ring and a graduated strip.
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(config.radius * 1.005, 0.014, 6, 28),
        this.materials.tankHDPE,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, 0.14 + config.height * 0.62, baseZ);
      tank.add(ring);

      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(0.09, 0.58),
        this.materials.createLabelMaterial('20', '40\n60\n80\n100 L', {
          width: 128,
          height: 512,
          background: '#eff2ec',
          foreground: '#1c3a4f',
        }),
      );
      strip.position.set(x + config.radius * 0.78, 0.74, baseZ + config.radius * 0.63);
      strip.rotation.y = Math.PI / 6;
      tank.add(strip);

      const labelPlate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.4),
        this.materials.createLabelMaterial(label.title, label.subtitle, {
          background: label.colour === 'white' ? '#1f3a52' : '#f0f2e9',
          foreground: label.colour === 'white' ? '#f3f4ec' : '#17324a',
        }),
      );
      labelPlate.position.set(x, 0.72, baseZ + config.radius + 0.014);
      tank.add(labelPlate);

      // Metering pump head on a small skid rail in front of each tank.
      tank.add(
        boxMesh(
          0.24,
          0.3,
          0.24,
          this.materials.pumpBlue,
          V(x, 0.29, railZ),
          `dosing-pump-${label.key}`,
        ),
      );
      tank.add(
        boxMesh(
          0.3,
          0.05,
          0.32,
          this.materials.steelDark,
          V(x, 0.12, railZ),
          `dosing-pump-foot-${label.key}`,
        ),
      );
      tank.add(
        boxMesh(
          0.16,
          0.08,
          0.02,
          this.materials.ledWhite,
          V(x, 0.39, railZ + 0.125),
          `dosing-pump-display-${label.key}`,
        ),
      );

      dosingLines.addPath(
        [
          V(x, 0.2, baseZ + config.radius * 0.7),
          V(x, 0.3, baseZ + config.radius * 0.86),
          V(x, 0.3, railZ - 0.1),
          V(x, 0.42, railZ - 0.1),
        ],
        0.012,
      );
      dosingLines.addPath(
        [
          V(x, 0.44, railZ + 0.12),
          V(x, 0.44, baseZ + 0.86),
          V(baseX + totalWidth / 2, 0.44, baseZ + 0.86),
        ],
        0.014,
      );

      this.register(tank, {
        id: `nutrient-${label.key}`,
        category: 'Nutrient dosing',
        title: `${label.title} stock tank`,
        description:
          label.colour === 'white'
            ? 'Acid stock tank feeding the inline pH dosing pump. The controller pulses the pump against the pH probe in the return manifold and locks out dosing if the circulation pump stops.'
            : 'Concentrated fertiliser stock tank. A calibrated metering pump injects stock into the mixing chamber proportionally to the irrigation flow, while the EC probe trims the final strength.',
        specs: [
          ['Stock volume', '60 L'],
          ['Contents', label.subtitle.split('·')[0].trim()],
          ['Dosing pump', `Diaphragm · ${label.key}`],
          ['Injection ratio', label.colour === 'white' ? '0–40 ml/m³' : '1:200'],
          ['Level', index === 2 ? '48 %' : index === 1 ? '71 %' : '66 %'],
        ],
      });
    });

    dosingLines.build(station, 'dosing-lines');

    this.collisionWorld.addBox({
      x: baseX + totalWidth / 2,
      z: baseZ + 0.2,
      width: bundWidth,
      depth: bundDepth + 0.5,
      label: 'Nutrient dosing station',
    });
  }


  /* --------------------------------------------------------- pump skid */

  buildPumpSkid() {
    const config = LAYOUT.pumps;
    const group = new THREE.Group();
    group.name = 'pump-skid';
    this.group.add(group);

    config.positions.forEach(([x, z, yaw], index) => {
      const duty = index === config.dutyIndex;
      const pump = new THREE.Group();
      pump.name = `pump-${index + 1}`;
      pump.position.set(x, 0, z);
      pump.rotation.y = yaw;
      group.add(pump);

      pump.add(
        boxMesh(
          1.05,
          0.11,
          0.62,
          this.materials.steelDark,
          V(0, 0.075, 0),
          `pump-skid-${index + 1}`,
        ),
      );
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          pump.add(
            boxMesh(
              0.1,
              0.045,
              0.12,
              this.materials.rubber,
              V(sx * 0.4, 0.022, sz * 0.23),
              `pump-pad-${index + 1}`,
            ),
          );
        }
      }

      const motor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.19, 0.19, 0.47, 24),
        this.materials.pumpBlue,
      );
      motor.rotation.z = Math.PI / 2;
      motor.position.set(-0.22, 0.43, 0);
      motor.castShadow = true;
      pump.add(motor);

      for (let fin = 0; fin < 7; fin += 1) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.193, 0.009, 5, 22),
          this.materials.pumpPaint,
        );
        ring.rotation.y = Math.PI / 2;
        ring.position.set(-0.42 + fin * 0.055, 0.43, 0);
        pump.add(ring);
      }

      const fanCowl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.175, 0.185, 0.12, 20),
        this.materials.steelDark,
      );
      fanCowl.rotation.z = Math.PI / 2;
      fanCowl.position.set(-0.49, 0.43, 0);
      pump.add(fanCowl);
      for (let blade = 0; blade < 6; blade += 1) {
        const spoke = boxMesh(
          0.024,
          0.15,
          0.018,
          this.materials.steelDark,
          V(-0.553, 0.43, 0),
          `pump-fan-blade-${index + 1}-${blade}`,
        );
        spoke.rotation.x = (blade / 6) * Math.PI * 2;
        pump.add(spoke);
      }

      pump.add(
        boxMesh(
          0.14,
          0.12,
          0.17,
          this.materials.steelDark,
          V(-0.22, 0.64, 0),
          `pump-terminal-box-${index + 1}`,
        ),
      );

      pump.add(
        boxMesh(
          0.17,
          0.28,
          0.3,
          this.materials.stainless,
          V(0.03, 0.43, 0),
          `pump-coupling-guard-${index + 1}`,
        ),
      );

      const volute = new THREE.Mesh(
        new THREE.CylinderGeometry(0.255, 0.255, 0.23, 28),
        this.materials.pumpBlue,
      );
      volute.rotation.x = Math.PI / 2;
      volute.position.set(0.29, 0.41, 0.02);
      volute.castShadow = true;
      pump.add(volute);

      const voluteRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.255, 0.016, 6, 28),
        this.materials.pumpPaint,
      );
      voluteRing.position.set(0.29, 0.41, 0.14);
      pump.add(voluteRing);

      const suction = new THREE.Mesh(
        new THREE.CylinderGeometry(0.115, 0.115, 0.1, 20),
        this.materials.steelDark,
      );
      suction.rotation.x = Math.PI / 2;
      suction.position.set(0.29, 0.41, 0.2);
      pump.add(suction);
      const suctionFlange = new THREE.Mesh(
        new THREE.CylinderGeometry(0.155, 0.155, 0.035, 20),
        this.materials.stainless,
      );
      suctionFlange.rotation.x = Math.PI / 2;
      suctionFlange.position.set(0.29, 0.41, 0.26);
      pump.add(suctionFlange);

      const discharge = new THREE.Mesh(
        new THREE.CylinderGeometry(0.095, 0.095, 0.3, 18),
        this.materials.steelDark,
      );
      discharge.position.set(0.29, 0.74, 0.02);
      pump.add(discharge);
      const dischargeFlange = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.035, 20),
        this.materials.stainless,
      );
      dischargeFlange.position.set(0.29, 0.9, 0.02);
      pump.add(dischargeFlange);


      const gaugeStem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.016, 0.16, 8),
        this.materials.stainless,
      );
      gaugeStem.rotation.x = Math.PI / 2;
      gaugeStem.position.set(0.44, 0.72, 0.13);
      pump.add(gaugeStem);
      const gauge = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 0.04, 20),
        this.materials.stainless,
      );
      gauge.rotation.x = Math.PI / 2;
      gauge.position.set(0.44, 0.72, 0.22);
      pump.add(gauge);
      const gaugeFace = new THREE.Mesh(
        new THREE.CircleGeometry(0.06, 20),
        this.materials.ledWhite,
      );
      gaugeFace.position.set(0.44, 0.72, 0.242);
      pump.add(gaugeFace);

      const valveWheel = new THREE.Mesh(
        new THREE.TorusGeometry(0.075, 0.012, 5, 16),
        this.materials.ledRed,
      );
      valveWheel.rotation.x = Math.PI / 2;
      valveWheel.position.set(0.29, 0.84, 0.02);
      pump.add(valveWheel);

      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.16),
        this.materials.createLabelMaterial(
          `P-0${index + 1}`,
          duty ? 'DUTY · NFT SUPPLY' : 'STANDBY · AUTO START',
          { background: '#e9ece3', foreground: '#16324a' },
        ),
      );
      plate.position.set(0, 0.302, 0.312);
      pump.add(plate);

      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 12, 8),
        duty ? this.materials.ledGreen : this.materials.ledAmber,
      );
      lamp.position.set(0.36, 0.35, 0.312);
      pump.add(lamp);

      const warning = new THREE.Mesh(
        new THREE.PlaneGeometry(0.18, 0.09),
        this.materials.createWarningMaterial(),
      );
      warning.position.set(-0.32, 0.32, 0.312);
      pump.add(warning);

      this.collisionWorld.addBox({
        x,
        z,
        width: 1.2,
        depth: 0.8,
        label: 'Circulation pump skid',
      });

      this.register(pump, {
        id: `pump-${index + 1}`,
        category: 'Irrigation',
        title: `Circulation pump P-0${index + 1}`,
        description: duty
          ? 'Duty pump for the NFT supply main. Variable-speed control holds the manifold pressure at 1.4 bar, and the controller rotates duty weekly to equalise wear. A dry-run relay protects the mechanical seal if the buffer tank empties.'
          : 'Standby pump on automatic changeover. It starts on a pressure drop or duty-pump fault, with a soft starter to avoid water hammer in the floor main.',
        specs: [
          ['Duty', duty ? 'Lead / duty' : 'Standby / auto'],
          ['Motor', '1.1 kW · 400 V · 2,900 rpm'],
          ['Flow', '18 m³/h at 3.5 m head'],
          ['Discharge pressure', duty ? '1.4 bar' : 'set to 1.4 bar'],
          ['Protection', 'Dry-run + thermal overload'],
        ],
      });
    });
  }


  /* ------------------------------------------------------- climate cabinet */

  buildControlCabinet() {
    const config = LAYOUT.cabinet;
    const [x, z] = config.position;
    const [depth, height, width] = config.size;
    const foot = config.footHeight;
    const cabinet = new THREE.Group();
    cabinet.name = 'climate-cabinet';
    cabinet.position.set(x, 0, z);
    this.group.add(cabinet);

    cabinet.add(
      boxMesh(
        depth + 0.2,
        0.06,
        width + 0.2,
        this.materials.concretePlinth,
        V(0, 0.03, 0),
        'cabinet-plinth',
      ),
    );

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        cabinet.add(
          boxMesh(
            0.05,
            foot,
            0.05,
            this.materials.steelDark,
            V(sx * (depth / 2 - 0.05), 0.06 + foot / 2, sz * (width / 2 - 0.05)),
            'cabinet-foot',
          ),
        );
      }
    }

    const shellY = foot + height / 2 + 0.06;
    cabinet.add(
      boxMesh(depth, 0.04, width, this.materials.cabinetPaint, V(0, shellY + height / 2, 0)),
    );
    cabinet.add(
      boxMesh(depth, 0.05, width, this.materials.cabinetPaint, V(0, shellY - height / 2, 0)),
    );
    cabinet.add(
      boxMesh(0.04, height, width, this.materials.cabinetPaint, V(depth / 2 - 0.02, shellY, 0)),
    );
    cabinet.add(
      boxMesh(
        depth,
        height,
        0.04,
        this.materials.cabinetPaint,
        V(0, shellY, width / 2 - 0.02),
      ),
    );
    cabinet.add(
      boxMesh(
        depth,
        height,
        0.04,
        this.materials.cabinetPaint,
        V(0, shellY, -width / 2 + 0.02),
      ),
    );

    // Interior back board and mounting rails.
    cabinet.add(
      boxMesh(
        0.025,
        height - 0.06,
        width - 0.06,
        this.materials.cabinetInterior,
        V(depth / 2 - 0.045, shellY, 0),
        'cabinet-interior-back',
      ),
    );

    const railX = depth / 2 - 0.085;
    for (const railY of [1.64, 1.09, 0.82]) {
      cabinet.add(
        boxMesh(
          0.03,
          0.035,
          width - 0.12,
          this.materials.aluminium,
          V(railX, railY, 0),
          'cabinet-din-rail',
        ),
      );
    }

    // Wire ducts frame the HMI and keep the interior reading as a real panel.
    for (const ductY of [1.46, 0.96, 0.62]) {
      cabinet.add(
        boxMesh(
          0.055,
          0.065,
          width - 0.09,
          this.materials.pvcGrey,
          V(railX, ductY, 0),
          'cabinet-wire-duct',
        ),
      );
    }
    for (const ductZ of [-width / 2 + 0.095, width / 2 - 0.095]) {
      cabinet.add(
        boxMesh(0.045, 0.88, 0.055, this.materials.pvcGrey, V(railX, 1.16, ductZ)),
      );
    }

    // HMI screen: the seven live metrics are rendered onto this surface.
    const screenX = depth / 2 - 0.122;
    cabinet.add(
      boxMesh(
        0.028,
        0.38,
        0.68,
        this.materials.steelDark,
        V(depth / 2 - 0.105, 1.22, 0),
        'dashboard-bezel',
      ),
    );
    this.dashboard = new DashboardDisplay({ materials: this.materials });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), this.dashboard.material);
    screen.name = 'climate-dashboard';
    screen.rotation.y = -Math.PI / 2;
    screen.position.set(screenX, 1.22, 0);
    cabinet.add(screen);

    // Small status button cluster beside the screen.
    for (let i = 0; i < 4; i += 1) {
      const button = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.012, 12),
        i === 0 ? this.materials.ledGreen : this.materials.ledWhite,
      );
      button.rotation.z = Math.PI / 2;
      button.position.set(depth / 2 - 0.135, 1.28 - i * 0.055, 0.36);
      cabinet.add(button);
    }

    this.cabinetLight = new THREE.PointLight(0xa8ecda, 0, 1.1, 2);
    this.cabinetLight.position.set(depth / 2 - 0.05, 1.24, 0);
    cabinet.add(this.cabinetLight);

    // Hinged door. The pivot sits on the +Z edge, and the panel extends -Z.
    const hinge = new THREE.Group();
    hinge.name = 'cabinet-door-hinge';
    hinge.position.set(-depth / 2 + 0.017, shellY, width / 2 - 0.01);
    cabinet.add(hinge);
    this.cabinetDoor = hinge;
    this.cabinetDoorAngle = config.doorOpenAngle;

    hinge.add(
      boxMesh(
        0.035,
        height - 0.035,
        width - 0.02,
        this.materials.cabinetDoor,
        V(0, 0, -(width - 0.02) / 2),
        'cabinet-door',
      ),
    );

    for (const y of [-height / 2 + 0.12, height / 2 - 0.12]) {
      const hingeKnuckle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.019, 0.019, 0.09, 10),
        this.materials.stainless,
      );
      hingeKnuckle.position.set(0.01, y, 0);
      hinge.add(hingeKnuckle);
    }

    // Latch handle on the free edge.
    hinge.add(
      boxMesh(
        0.045,
        0.23,
        0.035,
        this.materials.stainless,
        V(-0.035, -0.02, -width + 0.115),
        'cabinet-handle',
      ),
    );
    hinge.add(
      boxMesh(
        0.028,
        0.055,
        0.045,
        this.materials.steelDark,
        V(-0.038, -0.15, -width + 0.115),
        'cabinet-latch',
      ),
    );

    // Ventilation louvres in the lower half of the door.
    for (let louvre = 0; louvre < 9; louvre += 1) {
      hinge.add(
        boxMesh(
          0.014,
          0.012,
          width - 0.24,
          this.materials.steelDark,
          V(-0.022, -0.5 - louvre * 0.038, -width / 2),
          `cabinet-louvre-${louvre}`,
        ),
      );
    }


    // DIN breakers along the top rail.
    for (let breaker = 0; breaker < 8; breaker += 1) {
      const bz = -0.33 + breaker * 0.094;
      cabinet.add(
        boxMesh(
          0.065,
          0.13,
          0.07,
          this.materials.cabinetInterior,
          V(railX, 1.64, bz),
          `cabinet-breaker-${breaker}`,
        ),
      );
      cabinet.add(
        boxMesh(
          0.016,
          0.035,
          0.022,
          breaker % 2 === 0 ? this.materials.pvcWhite : this.materials.ledWhite,
          V(railX - 0.041, 1.66, bz),
          `cabinet-breaker-toggle-${breaker}`,
        ),
      );
    }

    // Terminal blocks along the lower rail.
    for (let terminal = 0; terminal < 12; terminal += 1) {
      const tz = -0.3 + terminal * 0.055;
      cabinet.add(
        boxMesh(
          0.055,
          0.1,
          0.042,
          this.materials.pvcGrey,
          V(railX, 0.82, tz),
          `cabinet-terminal-${terminal}`,
        ),
      );
      cabinet.add(
        boxMesh(
          0.012,
          0.016,
          0.03,
          terminal % 3 === 0 ? this.materials.ledWhite : this.materials.pumpBlue,
          V(railX - 0.033, 0.86, tz),
          `cabinet-terminal-tag-${terminal}`,
        ),
      );
    }

    // Compact PLC, relay and 24 V supply modules below the HMI.
    cabinet.add(
      boxMesh(
        0.075,
        0.2,
        0.11,
        this.materials.steelDark,
        V(railX, 1.09, 0.37),
        'cabinet-plc',
      ),
    );
    for (let led = 0; led < 4; led += 1) {
      const pilot = new THREE.Mesh(
        new THREE.SphereGeometry(0.009, 8, 6),
        led === 0 ? this.materials.ledGreen : this.materials.ledAmber,
      );
      pilot.position.set(railX - 0.042, 1.14 - led * 0.03, 0.37);
      cabinet.add(pilot);
    }
    cabinet.add(
      boxMesh(
        0.085,
        0.16,
        0.11,
        this.materials.cabinetInterior,
        V(railX, 1.1, 0.23),
        'cabinet-relay-module',
      ),
    );
    cabinet.add(
      boxMesh(
        0.075,
        0.12,
        0.09,
        this.materials.aluminium,
        V(railX, 0.72, 0.34),
        'cabinet-psu',
      ),
    );

    // Door branding, safety sticker and status LED.
    const doorPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.2),
      this.materials.createLabelMaterial('CLIMATE CONTROL', 'CC-4 · NFT HOUSE 4', {
        background: '#dfe4df',
        foreground: '#172d3a',
      }),
    );
    doorPanel.rotation.y = -Math.PI / 2;
    doorPanel.position.set(-0.02, 0.6, -(width - 0.02) / 2);
    hinge.add(doorPanel);

    const doorSticker = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18, 0.09),
      this.materials.createWarningMaterial(),
    );
    doorSticker.rotation.y = -Math.PI / 2;
    doorSticker.position.set(-0.021, -0.31, -0.28);
    hinge.add(doorSticker);

    const doorLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 10, 8),
      this.materials.ledGreen,
    );
    doorLed.position.set(-0.025, 0.48, 0.24);
    hinge.add(doorLed);

    // Roof-mounted extract fan and cable conduit to the ceiling.
    const exhaust = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.07, 16),
      this.materials.steelDark,
    );
    exhaust.position.set(0.02, shellY + height / 2 + 0.04, -0.24);
    cabinet.add(exhaust);
    const conduit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 2.35, 10),
      this.materials.pvcGrey,
    );
    conduit.position.set(depth / 2 - 0.08, shellY + height / 2 + 1.19, 0.3);
    cabinet.add(conduit);

    this.collisionWorld.addBox({
      x,
      z,
      width: depth + 0.06,
      depth: width + 0.1,
      label: 'Climate cabinet',
    });

    this.register(cabinet, {
      id: 'climate-cabinet',
      category: 'Climate control',
      title: 'Climate control cabinet CC-4',
      description:
        'The greenhouse controller, safety interlocks and variable-speed drives. The hinged door gives access to the HMI, which is showing live air temperature, humidity, VPD, PPFD, DLI, EC and pH. Press E near the cabinet to swing the door open or closed.',
      specs: [
        ['Controller', 'GreenCtrl 400 · 7-channel'],
        ['Sensors', 'Air temp / RH · PAR · EC / pH'],
        ['Vent control', '2 × proportional actuators'],
        ['Fan control', '24 × EC HAF fans · per-bay loops'],
        ['Supply', '400 V three-phase + 24 V DC'],
      ],
      interactionHint: 'Open cabinet',
      interaction: 'toggle-cabinet',
    });

    this.setCabinetDoor(false);
  }

  toggleCabinetDoor() {
    this.setCabinetDoor(this.doorTarget < 0.5);
    return this.doorTarget > 0.5;
  }

  setCabinetDoor(open) {
    this.doorTarget = open ? 1 : 0;
    const data = this.interactables.find((entry) => entry.data.id === 'climate-cabinet');
    if (data) data.data.interactionHint = open ? 'Close cabinet' : 'Open cabinet';
  }

  get isCabinetOpen() {
    return this.doorTarget > 0.5;
  }


  /* -------------------------------------------------------------- fans */

  buildFans() {
    this.fanSystem = new HafFans({ materials: this.materials }).build(this.group);
    this.fans = this.fanSystem.fans;
    this.fansEnabled = this.fanSystem.enabled;
    this.interactables.push(...this.fanSystem.interactables);
  }

  setFansEnabled(enabled) {
    this.fansEnabled = this.fanSystem ? this.fanSystem.setEnabled(enabled) : Boolean(enabled);
    return this.fansEnabled;
  }

  toggleFans() {
    this.fansEnabled = this.fanSystem ? this.fanSystem.toggle() : !this.fansEnabled;
    return this.fansEnabled;
  }


  /* ----------------------------------------------------------- pipework */

  buildPipework() {
    this.hydraulicNetwork = new HydraulicNetwork({
      materials: this.materials,
      tables: this.tables,
      parent: this.group,
    }).build();
    this.hydraulics = this.hydraulicNetwork.hydraulics;
  }

  /* ------------------------------------------------------------- lifecycle */

  update(dt) {
    this.fanSystem?.update(dt);

    if (this.cabinetDoor) {
      const blend = 1 - Math.exp(-dt * 7);
      this.doorAmount += (this.doorTarget - this.doorAmount) * blend;
      if (Math.abs(this.doorTarget - this.doorAmount) < 0.002) {
        this.doorAmount = this.doorTarget;
      }
      this.cabinetDoor.rotation.y = this.doorAmount * this.cabinetDoorAngle;
      if (this.cabinetLight) this.cabinetLight.intensity = this.doorAmount * 0.55;
    }

    this.dashboard?.update(dt, this.climate);
  }

  dispose() {
    this.dashboard?.dispose();
    if (!this.group) return;
    this.group.traverse((child) => {
      if (child.isMesh || child.isInstancedMesh) child.geometry?.dispose();
    });
    this.group.removeFromParent();
    this.group = null;
    this.interactables.length = 0;
    this.fans.length = 0;
    this.tables.length = 0;
    this.tableSystem = null;
    this.hydraulicNetwork = null;
    this.fanSystem = null;
    this.dashboard = null;
    this.cabinetDoor = null;
    this.cabinetLight = null;
  }
}

