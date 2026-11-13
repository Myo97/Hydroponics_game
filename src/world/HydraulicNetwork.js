import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { BeamBatch, CylinderBatch, boxMesh } from './Batches.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Complete NFT hydraulic network.
 *
 * Supply path:
 *   reservoir 2 → pump suction manifold → duty/standby pumps → pump discharge
 *   → main supply header → one dedicated branch and valve per table → 8 gullies.
 *
 * Return path:
 *   8 gully outlets → table collection manifold → one dedicated table drain
 *   → gravity return header → reservoir 2.
 *
 * Supply and return are separate networks; no header is cross-connected.
 */
export class HydraulicNetwork {
  constructor({ materials, tables, parent }) {
    this.materials = materials;
    this.tables = tables;
    this.parent = parent;
    this.group = null;
    this.tableSupplies = [];
    this.tableReturns = [];
  }

  build() {
    const pipes = LAYOUT.pipework;
    const pumpConfig = LAYOUT.pumps;
    const tanks = LAYOUT.tanks.reservoirs;
    const group = new THREE.Group();
    group.name = 'hydraulic-network';
    this.group = group;
    this.parent.add(group);

    const supply = new CylinderBatch(this.materials.pvcWhite);
    const returnLine = new CylinderBatch(this.materials.pvcReturn);
    const dosing = new CylinderBatch(this.materials.pvcWhite);
    const saddles = new BeamBatch(this.materials.steelDark, {
      castShadow: false,
      receiveShadow: false,
    });
    const bright = new BeamBatch(this.materials.stainless, { castShadow: false });

    const supplyMain = {
      start: V(pipes.supplyMainStartX, pipes.supplyY, pipes.crossMainZ),
      end: V(pipes.supplyMainEndX, pipes.supplyY, pipes.crossMainZ),
    };
    supply.add(supplyMain.start, supplyMain.end, pipes.supplyRadius);

    const returnMain = {
      start: V(pipes.returnMainStartX, pipes.returnY, pipes.returnMainZ),
      end: V(pipes.returnMainEndX, pipes.returnY, pipes.returnMainZ),
    };
    returnLine.add(returnMain.start, returnMain.end, pipes.returnRadius);

    // Suction manifold from the mixed-feed reservoir to both pump inlets.
    const reservoirX = tanks.positions[1][0];
    const reservoirZ = tanks.positions[1][1];
    const tankOutlet = V(reservoirX, 0.36, reservoirZ + tanks.radius + 0.08);
    const suctionHeaderZ = pumpConfig.positions[0][1] + 0.54;
    const pumpInlets = pumpConfig.positions.map(([x, z]) => V(x + 0.29, 0.41, z + 0.26));
    supply.addPath(
      [
        tankOutlet,
        V(reservoirX, 0.36, suctionHeaderZ),
        V(pumpInlets[0].x, 0.41, suctionHeaderZ),
        V(pumpInlets[pumpInlets.length - 1].x, 0.41, suctionHeaderZ),
      ],
      0.052,
    );
    for (const inlet of pumpInlets) {
      supply.addPath([V(inlet.x, 0.41, suctionHeaderZ), inlet], 0.045);
      supply.addJoint(inlet, 0.06);
    }
    group.add(
      boxMesh(
        0.24,
        0.24,
        0.08,
        this.materials.stainless,
        V(reservoirX, 0.36, reservoirZ + tanks.radius + 0.04),
        'reservoir-suction-flange',
      ),
    );

    // Discharge rises clear of the skid, then drops into the main supply header.
    for (const [index] of pumpConfig.positions.entries()) {
      const [pumpX, pumpZ] = pumpConfig.positions[index];
      const outlet = V(pumpX + 0.29, 0.9, pumpZ + 0.02);
      supply.addPath(
        [
          outlet,
          V(outlet.x, 1.02, outlet.z),
          V(outlet.x, 1.02, pipes.crossMainZ - 0.28),
          V(outlet.x, pipes.supplyY, pipes.crossMainZ - 0.28),
          V(outlet.x, pipes.supplyY, pipes.crossMainZ),
        ],
        pipes.supplyRadius * 0.86,
      );
      group.add(
        boxMesh(0.2, 0.19, 0.18, this.materials.stainless, V(outlet.x, 1.02, pumpZ + 0.42), 'pump-check-valve'),
      );
      group.add(
        boxMesh(0.23, 0.04, 0.21, this.materials.steelDark, V(outlet.x, 1.02, pumpZ + 0.32), 'pump-check-valve-flange'),
      );
    }

    // Dosing injection line enters the supply header downstream of the pumps.
    dosing.addPath(
      [
        V(1.35, 0.44, -15.34),
        V(1.35, 0.31, -15.34),
        V(0.9, 0.31, -15.34),
        V(0.9, pipes.supplyY, -12.2),
        V(0.9, pipes.supplyY, pipes.crossMainZ - 0.18),
        V(0.9, pipes.supplyY, pipes.crossMainZ),
      ],
      0.014,
    );

    // Main header isolation valve and pressure gauge.
    group.add(
      boxMesh(0.22, 0.24, 0.2, this.materials.steelDark, V(0.55, 0.25, pipes.crossMainZ), 'supply-main-gate-valve'),
    );
    const supplyWheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.075, 0.011, 5, 16),
      this.materials.ledRed,
    );
    supplyWheel.rotation.x = Math.PI / 2;
    supplyWheel.position.set(0.55, 0.5, pipes.crossMainZ);
    group.add(supplyWheel);

    this.hydraulics = {
      supplyHeader: supplyMain,
      returnHeader: returnMain,
      pumpInlets,
      pumpSuctionConnected: true,
      pumpDischargeConnected: true,
      returnsToReservoir: false,
      tableSupplies: this.tableSupplies,
      tableReturns: this.tableReturns,
    };

    this.buildTableConnections(group, supply, returnLine, saddles, bright);
    this.buildReturnToReservoir(group, returnLine);
    this.buildSigns(group);
    this.buildSupports(group, saddles);

    supply.build(group, 'supply-pipe-runs');
    returnLine.build(group, 'return-pipe-runs');
    dosing.build(group, 'dosing-injection-line');
    saddles.build(group, 'pipe-saddles');
    bright.build(group, 'pipe-identification-bands');
    return this;
  }

  buildTableConnections(group, supply, returnLine, saddles, bright) {
    const pipes = LAYOUT.pipework;

    for (const table of this.tables) {
      const halfWidth = table.tableWidth / 2;
      const manifoldEndX = table.centerX + halfWidth + 0.02;

      // Dedicated supply branch: main header → table valve → distribution manifold.
      supply.addPath(
        [
          V(table.supplyX, pipes.supplyY, pipes.crossMainZ),
          V(table.supplyX, pipes.supplyY, table.supplyZ),
          V(table.supplyX, pipes.tableSupplyY, table.supplyZ),
          V(manifoldEndX, pipes.tableSupplyY, table.supplyZ),
        ],
        pipes.branchRadius,
      );
      supply.addJoint(V(table.supplyX, pipes.supplyY, pipes.crossMainZ), 0.06);

      for (const gully of table.gullies) {
        supply.addPath(
          [
            V(gully.x, pipes.tableSupplyY, table.supplyZ),
            V(gully.x, gully.topYStart + 0.024, table.startZ + 0.018),
          ],
          0.008,
        );
      }

      const valve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.11, 12),
        this.materials.stainless,
      );
      valve.position.set(table.supplyX, 0.48, table.supplyZ);
      valve.castShadow = true;
      group.add(valve);
      group.add(
        boxMesh(
          0.15,
          0.022,
          0.036,
          this.materials.pumpBlue,
          V(table.supplyX + 0.055, 0.535, table.supplyZ),
          `table-supply-valve-${table.row}-${table.bay}`,
        ),
      );
      table.supplyValve = valve;
      this.tableSupplies.push({
        tableId: table.id,
        valve,
        inlet: table.supplyInlet,
        connected: true,
      });

      // Dedicated gravity return: gully outlets → table collector → table drain.
      const collectorStartX = table.centerX - halfWidth - 0.02;
      returnLine.add(
        V(collectorStartX, pipes.tableDrainY, table.returnZ),
        V(table.returnX, pipes.tableDrainY, table.returnZ),
        0.038,
      );
      for (const gully of table.gullies) {
        returnLine.addPath(
          [
            V(gully.x, gully.centreYEnd - 0.045, table.endZ + 0.02),
            V(gully.x, pipes.tableDrainY, table.returnZ),
          ],
          0.011,
        );
      }
      returnLine.addPath(
        [
          V(table.returnX, pipes.tableDrainY, table.returnZ),
          V(table.returnX, 0.2, table.returnZ),
          V(table.returnX, pipes.returnY, pipes.returnMainZ),
        ],
        pipes.drainBranchRadius,
      );
      returnLine.addJoint(V(table.returnX, pipes.returnY, pipes.returnMainZ), 0.075);

      const union = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12),
        this.materials.steelDark,
      );
      union.rotation.z = Math.PI / 2;
      union.position.set(table.returnX, 0.37, table.returnZ);
      union.castShadow = true;
      group.add(union);
      table.drainUnion = union;
      this.tableReturns.push({
        tableId: table.id,
        union,
        outlet: table.drainageOutlet,
        connected: true,
      });

      // Colour identification collars: blue supply, stainless return.
      bright.add(V(table.supplyX, 0.59, table.supplyZ), V(table.supplyX, 0.61, table.supplyZ), 0.032, 0.032);
      bright.add(V(table.returnX, 0.45, table.returnZ), V(table.returnX, 0.47, table.returnZ), 0.036, 0.036);

      // Pipe saddles keep the long dedicated runs off the floor.
      for (let z = table.supplyZ; z > pipes.crossMainZ; z -= pipes.bracketSpacing) {
        saddles.add(V(table.supplyX, 0.015, z), V(table.supplyX, pipes.supplyY, z), 0.028, 0.028);
      }
      for (let z = table.returnZ; z < pipes.returnMainZ; z += pipes.bracketSpacing) {
        saddles.add(V(table.returnX, 0.015, z), V(table.returnX, pipes.returnY, z), 0.032, 0.032);
      }
    }
  }
  buildReturnToReservoir(group, returnLine) {
    const pipes = LAYOUT.pipework;
    const tanks = LAYOUT.tanks.reservoirs;
    const reservoirX = tanks.positions[1][0];
    const reservoirZ = tanks.positions[1][1];
    const inletX = reservoirX - 0.8;
    const tankInletZ = reservoirZ + Math.sqrt(tanks.radius ** 2 - 0.8 ** 2);

    // Perimeter gravity main: west aisle → north cross aisle → tank inlet.
    returnLine.addPath(
      [
        V(pipes.returnMainStartX, pipes.returnY, pipes.returnMainZ),
        V(-11.35, 0.1, 11.0),
        V(-11.35, 0.1, -12.35),
        V(inletX, 0.1, -12.35),
        V(inletX, 0.34, -13.7),
        V(inletX, 0.34, tankInletZ),
      ],
      pipes.returnRadius,
    );
    returnLine.addJoint(V(inletX, 0.34, tankInletZ), 0.085);
    group.add(
      boxMesh(
        0.28,
        0.28,
        0.07,
        this.materials.pvcReturn,
        V(inletX, 0.34, tankInletZ),
        'reservoir-return-flange',
      ),
    );
    this.hydraulics.returnsToReservoir = true;
  }

  buildSigns(group) {
    const addSign = (title, subtitle, x, z, facing) => {
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(0.66, 0.22),
        this.materials.createLabelMaterial(title, subtitle, {
          background: '#e9ece2',
          foreground: '#173345',
        }),
      );
      sign.position.set(x, 0.58, z + facing * 0.035);
      if (facing < 0) sign.rotation.y = Math.PI;
      group.add(sign);
      for (const sx of [-0.25, 0.25]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.012, 0.58, 6),
          this.materials.stainless,
        );
        post.position.set(x + sx, 0.29, z);
        group.add(post);
      }
    };

    addSign('NFT SUPPLY', 'PUMP → HEADER → TABLE VALVES', 1.8, LAYOUT.pipework.crossMainZ, 1);
    addSign('NFT RETURN', 'TABLE DRAINS → GRAVITY → TANK 02', 1.8, LAYOUT.pipework.returnMainZ, -1);
  }

  buildSupports(group, saddles) {
    const pipes = LAYOUT.pipework;
    for (let x = pipes.supplyMainStartX; x <= pipes.supplyMainEndX; x += 1.6) {
      saddles.add(V(x, 0.015, pipes.crossMainZ), V(x, pipes.supplyY, pipes.crossMainZ), 0.032, 0.032);
    }
    for (let x = pipes.returnMainEndX; x >= pipes.returnMainStartX; x -= 1.6) {
      saddles.add(V(x, 0.015, pipes.returnMainZ), V(x, pipes.returnY, pipes.returnMainZ), 0.04, 0.04);
    }
  }
}

