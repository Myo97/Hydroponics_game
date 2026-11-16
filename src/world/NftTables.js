import * as THREE from 'three';
import { LAYOUT, NFT_INSTALLATION } from '../config/layout.js';
import { BeamBatch } from './Batches.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DEG = THREE.MathUtils.degToRad;

/**
 * NFT table system.
 * Builds 18 tables on the structural column grid: six rows, each split into
 * three 6 m modules with a walkway between every table. Every table has eight
 * hollow PVC gullies with real extruded circular planting holes, a level metal
 * frame, and metadata for its dedicated supply and drainage connections.
 */
export class NftTables {
  constructor({ materials, collisionWorld, control = null }) {
    this.materials = materials;
    this.collisionWorld = collisionWorld;
    this.control = control;
    this.tables = [];
    this.interactables = [];
    this.gullyWaterMeshes = [];
    this.gullyWaterGeometry = null;
    this.group = null;
  }

  build(parent) {
    const beds = LAYOUT.beds;
    const install = NFT_INSTALLATION;
    const pipework = LAYOUT.pipework;
    const rows = new THREE.Group();
    rows.name = 'nft-tables';
    this.group = rows;
    parent.add(rows);

    const frame = new BeamBatch(this.materials.steel);
    const walls = new BeamBatch(this.materials.pvcWhite);
    const bottoms = new BeamBatch(this.materials.pvcGrey);
    const endCaps = new BeamBatch(this.materials.pvcGrey, { castShadow: false });
    const topGeometry = this.createGullyTopGeometry(beds);
    const topMatrices = [];
    const waterDepth = beds.gullyWaterDepth ?? 0.016;
    const waterWidth = beds.gullyWidth - 0.032;
    const waterLength = beds.gullyLength - 0.09;
    const waterGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.gullyWaterGeometry = waterGeometry;

    const slope = Math.tan(DEG(beds.slopeDegrees));
    const halfWidth = install.tableHalfWidth;
    const channelHalf = beds.gullyHeight / 2;
    const rowGroups = beds.centersX.map((centreX, index) => {
      const rowGroup = new THREE.Group();
      rowGroup.name = `nft-row-${index + 1}`;
      rows.add(rowGroup);
      return { group: rowGroup, centreX, row: index + 1 };
    });

    for (const plan of install.tables) {
      const { centerX: cx, startZ, endZ, centerZ, row, bay } = plan;
      const tableGroup = new THREE.Group();
      tableGroup.name = `nft-table-${row}-${bay}`;
      rowGroups[row - 1].group.add(tableGroup);

      const surfaceY = (z) => beds.benchHeight - slope * (z - startZ);
      const centreY = (z) => surfaceY(z) + 0.028 + channelHalf;
      const topY = (z) => centreY(z) + channelHalf;

      // Four-bay welded frame: legs, feet, longitudinal rails and cross-braces.
      const legCount = Math.max(2, Math.round((endZ - startZ) / beds.legSpacing));
      const legZs = [];
      for (let leg = 0; leg <= legCount; leg += 1) {
        legZs.push(startZ + (leg / legCount) * (endZ - startZ));
      }

      for (const z of legZs) {
        const top = surfaceY(z) - 0.055;
        for (const sx of [-1, 1]) {
          const x = cx + sx * halfWidth;
          frame.add(V(x, 0.018, z), V(x, top, z), 0.055, 0.055);
          frame.add(V(x - 0.065, 0.012, z - 0.065), V(x + 0.065, 0.012, z + 0.065), 0.018, 0.018);
        }
        frame.add(V(cx - halfWidth, top, z), V(cx + halfWidth, top, z), 0.05, 0.05);
        frame.add(V(cx - halfWidth, 0.24, z), V(cx + halfWidth, 0.24, z), 0.04, 0.04);
      }

      for (const sx of [-1, 1]) {
        const x = cx + sx * halfWidth;
        frame.add(
          V(x, surfaceY(startZ) - 0.075, startZ),
          V(x, surfaceY(endZ) - 0.075, endZ),
          0.065,
          0.08,
        );
        // Side cross-bracing in every bay.
        for (let bayIndex = 0; bayIndex < legZs.length - 1; bayIndex += 1) {
          const z0 = legZs[bayIndex];
          const z1 = legZs[bayIndex + 1];
          frame.add(V(x, 0.2, z0), V(x, surfaceY(z1) - 0.1, z1), 0.025, 0.025);
          frame.add(V(x, surfaceY(z0) - 0.1, z0), V(x, 0.2, z1), 0.025, 0.025);
        }
      }

      for (let support = 0; support <= legCount * 2; support += 1) {
        const z = startZ + (support / (legCount * 2)) * (endZ - startZ);
        frame.add(
          V(cx - halfWidth, surfaceY(z) - 0.035, z),
          V(cx + halfWidth, surfaceY(z) - 0.035, z),
          0.035,
          0.04,
        );
      }

      const gullies = [];
      for (let gully = 0; gully < beds.gulliesPerTable; gully += 1) {
        const x = cx + (gully - (beds.gulliesPerTable - 1) / 2) * beds.gullySpacing;
        const centreStart = centreY(startZ);
        const centreEnd = centreY(endZ);
        const bottomStart = centreStart - channelHalf;
        const bottomEnd = centreEnd - channelHalf;
        const topStart = topY(startZ);
        const topEnd = topY(endZ);

        // Hollow channel: dark base slab, two PVC side walls, cut top plate.
        bottoms.add(
          V(x, bottomStart + 0.0045, startZ),
          V(x, bottomEnd + 0.0045, endZ),
          beds.gullyWidth - 0.018,
          0.009,
        );
        for (const side of [-1, 1]) {
          const wallX = x + side * (beds.gullyWidth / 2 - 0.006);
          walls.add(
            V(wallX, bottomStart + 0.0475, startZ),
            V(wallX, bottomEnd + 0.0475, endZ),
            0.012,
            beds.gullyHeight - 0.009,
          );
        }
        endCaps.add(
          V(x, centreEnd, endZ),
          V(x, centreEnd, endZ + 0.022),
          beds.gullyWidth + 0.012,
          beds.gullyHeight + 0.01,
        );
        // Upstream cap closes the extruded channel behind the inlet dripper.
        endCaps.add(
          V(x, centreStart, startZ),
          V(x, centreStart, startZ - 0.022),
          beds.gullyWidth + 0.012,
          beds.gullyHeight + 0.01,
        );

        topMatrices.push({
          position: V(x, topY(centerZ) - 0.006, centerZ),
          rotation: slope,
        });
        gullies.push({
          id: `${plan.id}-gully-${gully + 1}`,
          index: gully + 1,
          x,
          startZ,
          endZ,
          centreYStart: centreStart,
          centreYEnd: centreEnd,
          topYStart: topStart,
          topYEnd: topEnd,
        });
      }

      // Eight static solution films confined inside the hollow channels. Each
      // table owns one instanced mesh, so flow gating is a single visibility
      // switch per table rather than a per-frame animation. The film stops
      // short of both end caps and stays below the perforated top plate.
      const gullyWater = new THREE.InstancedMesh(
        waterGeometry,
        this.materials.gullyWater,
        beds.gulliesPerTable,
      );
      gullyWater.name = `nft-gully-water-${row}-${bay}`;
      gullyWater.userData.sharedGeometry = true;
      gullyWater.castShadow = false;
      gullyWater.receiveShadow = false;
      gullyWater.frustumCulled = false;
      const waterMatrix = new THREE.Matrix4();
      const waterQuaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(slope, 0, 0),
      );
      const waterScale = V(waterWidth, waterDepth, waterLength);
      const waterCentreY =
        surfaceY(centerZ) + 0.028 + 0.009 + waterDepth / 2;
      gullies.forEach((gully, index) => {
        waterMatrix.compose(
          V(gully.x, waterCentreY, centerZ),
          waterQuaternion,
          waterScale,
        );
        gullyWater.setMatrixAt(index, waterMatrix);
      });
      gullyWater.instanceMatrix.needsUpdate = true;
      gullyWater.visible = this.control
        ? this.control.isTableFlowing(plan.id)
        : true;
      tableGroup.add(gullyWater);
      this.gullyWaterMeshes.push(gullyWater);

      const supplyX = cx - halfWidth - pipework.tableSupplyOffset;
      const returnX = cx + halfWidth + pipework.tableReturnOffset;
      const supplyZ = startZ - 0.26;
      const returnZ = endZ + 0.13;

      // Invisible table hit volume for reliable inspection targeting.
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(halfWidth * 2 + 0.08, 0.98, endZ - startZ + 0.06),
        this.materials.hitProxy,
      );
      proxy.name = `nft-${row}-${bay}-hit`;
      proxy.position.set(cx, 0.49, centerZ);
      proxy.visible = false;
      tableGroup.add(proxy);

      const table = {
        ...plan,
        gullies,
        tableWidth: install.tableWidth,
        topYStart: topY(startZ),
        topYEnd: topY(endZ),
        supplyX,
        supplyZ,
        supplyInlet: V(supplyX, pipework.tableSupplyY, supplyZ),
        returnX,
        returnZ,
        drainageOutlet: V(returnX, pipework.tableDrainY, returnZ),
        supplyValve: null,
        drainUnion: null,
        gullyWater,
      };
      this.tables.push(table);

      this.collisionWorld?.addBox({
        x: cx,
        z: centerZ,
        width: install.tableWidth + 0.14,
        depth: endZ - startZ + 0.12,
        label: 'NFT table',
      });

      const group = LAYOUT.irrigation.groups.find(
        (entry) => entry.id === plan.groupId,
      );
      const data = {
        id: `nft-${row}-${bay}`,
        category: 'Growing system',
        title: `NFT table — Row ${row}, bay ${bay}`,
        description:
          `An eight-gully nutrient film table on the structural column grid. Solution is pumped from ${group?.reservoirName ?? 'its group reservoir'} through the ${group?.name ?? 'group'} supply header, then a dedicated table valve and distribution manifold. Each hollow PVC gully carries a shallow film to a table-specific gravity return. Every planting hole is a real circular cut-out at 150 mm centres.`,
        interactionHint: 'Inspect table',
        specs: [
          ['Irrigation group', group?.name ?? 'Group 1'],
          ['Supply source', group?.reservoirName ?? 'Reservoir 1'],
          ['Group pump', group?.pumpKey ?? 'group1PumpOn'],
          ['Gullies', `${beds.gulliesPerTable} × ${beds.gullyLength.toFixed(2)} m`],
          ['Planting holes', `${beds.holesPerGully} / gully · ${beds.gulliesPerTable * beds.holesPerGully} / table`],
          ['Hole spacing', `${(beds.holeSpacing * 100).toFixed(0)} cm`],
          ['Table width', `${install.tableWidth.toFixed(2)} m`],
          ['Working height', `${table.topYStart.toFixed(2)} m at head`],
          ['Falling slope', `${beds.slopeDegrees.toFixed(1)}°`],
          ['Supply valve', 'Dedicated PVC ball valve - E to isolate'],
          ['Supply / return', 'Dedicated DN50 / DN80'],
        ],
        groupId: group?.id ?? null,
        reservoirId: group?.reservoirId ?? null,
      };
      tableGroup.userData.interactable = data;
      tableGroup.userData.tableId = table.id;
      this.interactables.push({ object: tableGroup, data });
    }

    // One geometry and one draw call for all 5,760 real planting openings.
    const topPlateMesh = new THREE.InstancedMesh(
      topGeometry,
      this.materials.pvcWhite,
      topMatrices.length,
    );
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    topMatrices.forEach((entry, index) => {
      quaternion.setFromEuler(new THREE.Euler(entry.rotation, 0, 0));
      matrix.compose(entry.position, quaternion, scale);
      topPlateMesh.setMatrixAt(index, matrix);
    });
    topPlateMesh.instanceMatrix.needsUpdate = true;
    topPlateMesh.name = 'nft-gully-perforated-tops';
    topPlateMesh.castShadow = true;
    topPlateMesh.receiveShadow = true;
    rows.add(topPlateMesh);

    frame.build(rows, 'nft-table-frames');
    walls.build(rows, 'nft-gully-walls');
    bottoms.build(rows, 'nft-gully-interiors');
    endCaps.build(rows, 'nft-gully-end-caps');
    return this;
  }

  /**
   * Show the confined solution film only on tables that are actually flowing.
   * There is no surface animation: the water is visible through the inspection
   * holes but cannot leave the gully envelope.
   */
  update() {
    for (const table of this.tables) {
      if (!table.gullyWater) continue;
      table.gullyWater.visible = this.control
        ? this.control.isTableFlowing(table.id)
        : true;
    }
  }

  /**
   * One reusable extruded top plate with forty true circular openings.
   * ExtrudeGeometry keeps the hole walls visible, so the holes read as cut-outs
   * into the hollow channel rather than painted circles.
   */
  createGullyTopGeometry(beds) {
    const halfWidth = (beds.gullyWidth - 0.002) / 2;
    const halfLength = beds.gullyLength / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-halfWidth, -halfLength);
    shape.lineTo(halfWidth, -halfLength);
    shape.lineTo(halfWidth, halfLength);
    shape.lineTo(-halfWidth, halfLength);
    shape.closePath();

    const margin = (beds.gullyLength - (beds.holesPerGully - 1) * beds.holeSpacing) / 2;
    const radius = beds.holeDiameter / 2;
    for (let hole = 0; hole < beds.holesPerGully; hole += 1) {
      const y = -halfLength + margin + hole * beds.holeSpacing;
      const path = new THREE.Path();
      path.absarc(0, y, radius, 0, Math.PI * 2, true);
      shape.holes.push(path);
    }

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.006,
      bevelEnabled: false,
      curveSegments: 10,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();
    return geometry;
  }
}
