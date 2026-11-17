import * as THREE from 'three';
import { LAYOUT } from '../config/layout.js';
import { BeamBatch, CylinderBatch, boxMesh } from './Batches.js';
import { SeedlingTray } from './SeedlingTray.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (value) => Math.max(0, Math.min(1, value));

const STAGE_LABELS = {
  ready: 'Ready - drained',
  flooding: 'Stage 1 - flooding',
  irrigating: 'Stage 2 - irrigating',
  draining: 'Stage 3 - draining',
};

/**
 * Commercial single-layer ebb-and-flow nursery bench.
 *
 * One 3.4 x 1.8 m aluminium rolling bench carries a 3.36 x 1.74 m corrugated ABS
 * flood pan and exactly 36 standard 550 x 280 x 45 mm propagation trays in a
 * symmetrical 6 x 6 grid. The bench is plumbed to Reservoir 2 through a small
 * duty pump, a visual feed manifold and a gravity return, and runs the full
 * flood -> irrigate -> drain -> ready sequence from shared control state.
 */
export class NurseryTable {
  constructor({ materials, collisionWorld = null, control = null, config = LAYOUT.nursery }) {
    this.materials = materials;
    this.collisionWorld = collisionWorld;
    this.control = control;
    this.config = config;
    this.bed = config.tidalBed;
    this.group = null;
    this.trays = [];
    this.trayMeshes = null;
    this.waterMesh = null;
    this.sightWater = null;
    this.pumpRotor = null;
    this.pumpLamp = null;
    this.drainHandle = null;
    this.data = null;
    this.interactables = [];
    this.collisionBox = null;
    this.plantRoot = null;
    this.hitRoot = null;
    this.buttons = { grow: null, seed: null, crop: null };
    this.buttonInfo = { grow: null, seed: null, crop: null };
    this.stockIndex = -1;
    this.plantedIndex = -1;
    this.readyIndex = -1;

    this.stage = 'ready';
    this.stageElapsed = 0;
    this.waterDepth = 0;
    this.cycles = 0;
    this.auto = control?.nursery?.autoCycle ?? true;
    this.autoTimer = this.bed.cycle.intervalSeconds - this.bed.cycle.initialDelaySeconds;
    this.pumpOn = false;
    this.drainOpen = false;
    this.runningTime = 0;
  }

  build(parent) {
    const [centreX, centreZ] = this.bed.centre;
    const group = new THREE.Group();
    group.name = 'nursery-tidal-bed';
    group.position.set(centreX, 0, centreZ);
    this.group = group;
    parent.add(group);

    this.buildFrame(group);
    this.buildFloodPan(group);
    this.buildTrays(group);
    this.buildControls(group);
    this.buildPlumbing(group);
    this.buildSightGauge(group);
    this.registerInteraction(group);

    this.applyWaterDepth(0);
    this.syncControl();

    this.collisionBox = this.collisionWorld?.addBox({
      x: this.config.centre[0] + centreX,
      z: this.config.centre[1] + centreZ,
      width: this.bed.width + 0.14,
      depth: this.bed.length + 0.14,
      label: 'nursery tidal seedling bed',
    }) ?? null;

    return this;
  }

  buildFrame(group) {
    const { width, length } = this.bed;
    const frame = new BeamBatch(this.materials.aluminium);
    const dark = new BeamBatch(this.materials.steelDark, { castShadow: false });
    const halfW = width / 2;
    const halfL = length / 2;

    // Six uprights (three pairs) support the long flood pan without mid-span sag.
    for (const z of [-halfL + 0.08, 0, halfL - 0.08]) {
      for (const x of [-halfW + 0.09, halfW - 0.09]) {
        frame.add(V(x, 0.08, z), V(x, 0.7, z), 0.045, 0.045);
      }
      frame.add(V(-halfW + 0.09, 0.69, z), V(halfW - 0.09, 0.69, z), 0.04, 0.04);
    }
    // Longitudinal rails connect the leg pairs and carry the ABS pan.
    for (const x of [-halfW + 0.05, halfW - 0.05]) {
      frame.add(V(x, 0.7, -halfL + 0.04), V(x, 0.7, halfL - 0.04), 0.05, 0.05);
    }
    for (const z of [-halfL + 0.04, halfL - 0.04]) {
      frame.add(V(-halfW + 0.05, 0.7, z), V(halfW - 0.05, 0.7, z), 0.05, 0.05);
    }
    // Corner gussets and lower anti-rack rails.
    for (const x of [-halfW + 0.09, halfW - 0.09]) {
      frame.add(V(x, 0.14, -halfL + 0.1), V(x, 0.32, -halfL + 0.1), 0.03, 0.03);
      frame.add(V(x, 0.14, halfL - 0.1), V(x, 0.32, halfL - 0.1), 0.03, 0.03);
    }
    frame.build(group, 'nursery-bench-frame');

    // Adjustable levelling feet with rubber pads.
    for (const z of [-halfL + 0.1, halfL - 0.1]) {
      for (const x of [-halfW + 0.09, halfW - 0.09]) {
        const foot = new THREE.Mesh(
          new THREE.CylinderGeometry(0.032, 0.038, 0.04, 12),
          this.materials.steelDark,
        );
        foot.position.set(x, 0.035, z);
        group.add(foot);
        const stem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.012, 0.03, 8),
          this.materials.stainless,
        );
        stem.position.set(x, 0.068, z);
        group.add(stem);
        const pad = new THREE.Mesh(
          new THREE.CylinderGeometry(0.052, 0.052, 0.012, 14),
          this.materials.rubber,
        );
        pad.position.set(x, 0.012, z);
        group.add(pad);
      }
    }

    // Anti-tip caster outriggers under the six leg stations, with lock tabs.
    for (const z of [-halfL + 0.1, 0, halfL - 0.1]) {
      for (const x of [-halfW + 0.09, halfW - 0.09]) {
        const wheel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.055, 0.038, 16),
          this.materials.rubber,
        );
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.062, z + 0.1);
        group.add(wheel);
        group.add(
          boxMesh(
            0.035,
            0.06,
            0.11,
            this.materials.steelDark,
            V(x, 0.095, z + 0.06),
            'caster-bracket',
          ),
        );
        dark.add(V(x, 0.06, z), V(x, 0.06, z + 0.13), 0.018, 0.018);
      }
    }
    dark.build(group, 'nursery-caster-outriggers');

    // Hand crank for rolling the bench sideways during crop work.
    const crank = new THREE.Group();
    crank.name = 'nursery-hand-crank';
    crank.position.set(-0.46, 0.69, halfL + 0.035);
    const axle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.12, 10),
      this.materials.stainless,
    );
    axle.rotation.x = Math.PI / 2;
    crank.add(axle);
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.105, 0.012, 6, 22),
      this.materials.stainless,
    );
    wheel.position.z = 0.07;
    crank.add(wheel);
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.013, 0.06, 8),
      this.materials.rubber,
    );
    handle.rotation.x = Math.PI / 2;
    handle.position.set(0.075, 0, 0.1);
    crank.add(handle);
    group.add(crank);

    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.19),
      this.materials.createLabelMaterial('TIDAL BED 01', '36 TRAYS - 11,520 CELLS', {
        background: '#e9ece3',
        foreground: '#173345',
      }),
    );
    plate.position.set(0, 0.49, halfL + 0.026);
    group.add(plate);
  }


  buildFloodPan(group) {
    const pan = this.bed.floodPan;
    const { width, length, baseY, floorY, rimHeight, rimThickness } = pan;
    const halfW = width / 2;
    const halfL = length / 2;
    const panHeight = floorY - baseY;

    group.add(
      boxMesh(
        width,
        panHeight,
        length,
        this.materials.nurseryFloodTray,
        V(0, baseY + panHeight / 2, 0),
        'nursery-abs-flood-pan',
      ),
    );

    // Raised perimeter walls retain the flood water.
    for (const x of [-halfW + rimThickness / 2, halfW - rimThickness / 2]) {
      group.add(
        boxMesh(
          rimThickness,
          rimHeight,
          length,
          this.materials.nurseryFloodTray,
          V(x, floorY + rimHeight / 2, 0),
          'nursery-flood-rim',
        ),
      );
    }
    for (const z of [-halfL + rimThickness / 2, halfL - rimThickness / 2]) {
      group.add(
        boxMesh(
          width - rimThickness * 2,
          rimHeight,
          rimThickness,
          this.materials.nurseryFloodTray,
          V(0, floorY + rimHeight / 2, z),
          'nursery-flood-rim',
        ),
      );
    }

    // Shallow corrugation ribs across the pan floor.
    const ribs = new BeamBatch(this.materials.nurseryFloodTray, {
      castShadow: false,
      receiveShadow: false,
    });
    for (let z = -halfL + 0.09; z < halfL - 0.03; z += 0.105) {
      ribs.add(
        V(-halfW + rimThickness, floorY + 0.003, z),
        V(halfW - rimThickness, floorY + 0.003, z),
        0.012,
        0.006,
      );
    }
    ribs.build(group, 'nursery-flood-corrugation');

    // Four support rails keep every tray level and lift its drain holes clear of
    // the pan floor so water can pass underneath during the flood stage.
    const rails = new BeamBatch(this.materials.nurseryFloodTray, {
      castShadow: false,
      receiveShadow: false,
    });
    for (const x of [-0.72, -0.24, 0.24, 0.72]) {
      rails.add(
        V(x, floorY + 0.012, -halfL + 0.04),
        V(x, floorY + 0.012, halfL - 0.04),
        0.032,
        0.024,
      );
    }
    rails.build(group, 'nursery-tray-support-rails');

    const waterGeometry = new THREE.PlaneGeometry(
      width - rimThickness * 2 - 0.01,
      length - rimThickness * 2 - 0.01,
    );
    const water = new THREE.Mesh(waterGeometry, this.materials.water);
    water.name = 'nursery-flood-water';
    water.rotation.x = -Math.PI / 2;
    water.position.y = floorY + 0.002;
    water.renderOrder = 2;
    water.visible = false;
    group.add(water);
    this.waterMesh = water;

    // Low-profile slotted floor drain under the tray block. It is below the
    // support rails, so trays never clip the fitting.
    const drainScreen = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.012, 16),
      this.materials.pvcGrey,
    );
    drainScreen.position.set(-0.75, floorY + 0.012, halfL - 0.08);
    group.add(drainScreen);
  }

  buildTrays(group) {
    const trays = this.bed.trays;
    const pan = this.bed.floodPan;
    const trayBottom = pan.floorY + 0.024;
    const spacingX = trays.width;
    const spacingZ = trays.length;
    const startX = -((trays.columns - 1) * spacingX) / 2;
    const startZ = -((trays.rows - 1) * spacingZ) / 2;

    const baseGeometry = new THREE.BoxGeometry(
      trays.width - 0.004,
      trays.height,
      trays.length - 0.004,
    );
    const bases = new THREE.InstancedMesh(
      baseGeometry,
      this.materials.nurseryFloodTray,
      trays.count,
    );
    bases.name = 'seedling-tray-bases';
    bases.castShadow = true;
    bases.receiveShadow = true;
    bases.frustumCulled = false;

    const cellGeometry = new THREE.PlaneGeometry(
      trays.width - 0.01,
      trays.length - 0.01,
    );
    const cells = new THREE.InstancedMesh(
      cellGeometry,
      this.materials.nurseryTrayCells,
      trays.count,
    );
    cells.name = 'seedling-tray-cells';
    cells.castShadow = false;
    cells.receiveShadow = true;
    cells.frustumCulled = false;

    const plantRoot = new THREE.Group();
    plantRoot.name = 'seedling-canopies';
    group.add(plantRoot);
    this.plantRoot = plantRoot;

    const hitRoot = new THREE.Group();
    hitRoot.name = 'seedling-tray-hit-targets';
    group.add(hitRoot);
    this.hitRoot = hitRoot;

    const dummy = new THREE.Object3D();
    let index = 0;
    for (let row = 0; row < trays.rows; row += 1) {
      for (let column = 0; column < trays.columns; column += 1) {
        const x = startX + column * spacingX;
        const z = startZ + row * spacingZ;
        dummy.position.set(x, trayBottom + trays.height / 2, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        bases.setMatrixAt(index, dummy.matrix);

        dummy.position.set(x, trayBottom + trays.height + 0.001, z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        cells.setMatrixAt(index, dummy.matrix);

        const tray = new SeedlingTray({
          id: `seedling-tray-${String(index + 1).padStart(2, '0')}`,
          index,
          row,
          column,
          x,
          z,
          width: trays.width,
          length: trays.length,
          height: trays.height,
          cells: trays.cells,
          bottomY: trayBottom,
          topY: trayBottom + trays.height,
          materials: this.materials,
          plantParent: plantRoot,
          hitParent: hitRoot,
          table: this,
        });
        this.trays.push(tray);
        this.interactables.push({ object: tray.hitProxy, data: tray.info });
        index += 1;
      }
    }
    bases.instanceMatrix.needsUpdate = true;
    cells.instanceMatrix.needsUpdate = true;
    group.add(bases);
    group.add(cells);
    this.trayMeshes = { bases, cells, trayBottom };

    this.trayBlock = {
      length: trays.rows * trays.length,
      width: trays.columns * trays.width,
      clearanceX:
        (pan.width - pan.rimThickness * 2 - trays.columns * trays.width) / 2,
      clearanceZ:
        (pan.length - pan.rimThickness * 2 - trays.rows * trays.length) / 2,
    };
  }

  /** Hide/show one tray shell without disturbing the other 35 instances. */
  setTrayShellVisible(index, visible) {
    const tray = this.trays[index];
    if (!tray || !this.trayMeshes) return;
    const dummy = new THREE.Object3D();
    const scale = visible ? 1 : 0.000001;
    dummy.scale.setScalar(scale);
    dummy.position.set(tray.x, this.trayMeshes.trayBottom + tray.height / 2, tray.z);
    dummy.updateMatrix();
    this.trayMeshes.bases.setMatrixAt(index, dummy.matrix);
    this.trayMeshes.bases.instanceMatrix.needsUpdate = true;

    dummy.position.set(tray.x, tray.topY + 0.001, tray.z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    this.trayMeshes.cells.setMatrixAt(index, dummy.matrix);
    this.trayMeshes.cells.instanceMatrix.needsUpdate = true;
  }

  /** Physical CROP / SEED ALL / GROW panel on the south end of the bench. */
  buildControls(group) {
    const pan = this.bed.floodPan;
    const panel = new THREE.Group();
    panel.name = 'nursery-growth-controls';
    panel.position.set(-0.42, pan.floorY + 0.055, pan.length / 2 + 0.018);
    group.add(panel);

    panel.add(
      boxMesh(0.62, 0.2, 0.065, this.materials.stainless, V(0, 0, 0), 'nursery-growth-control-housing'),
    );
    panel.add(
      boxMesh(0.56, 0.14, 0.008, this.materials.steelDark, V(0, 0.005, 0.038), 'nursery-growth-control-face'),
    );
    if (this.materials.createLabelMaterial) {
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.048),
        this.materials.createLabelMaterial('NURSERY PROPAGATION', 'CROP  |  SEED ALL  |  GROW'),
      );
      label.name = 'nursery-growth-control-label';
      label.position.set(0, 0.066, 0.043);
      panel.add(label);
    }

    const makeButton = (x, label, interaction, hint, description) => {
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.034, 0.034, 0.015, 20),
        this.materials.ledGreen,
      );
      cap.name = `nursery-${label.toLowerCase()}-button`;
      cap.rotation.x = Math.PI / 2;
      cap.position.set(x, 0.012, 0.043);
      panel.add(cap);

      const info = {
        id: `nursery-${label.toLowerCase()}-control`,
        buildingId: LAYOUT.nursery.id,
        category: 'Propagation control',
        title: `Nursery ${label} control`,
        interaction,
        interactionHint: hint,
        description,
        specs: [],
      };
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.105, 0.035),
        this.materials.hitProxy,
      );
      proxy.name = `nursery-${label.toLowerCase()}-hit`;
      proxy.position.set(x, 0.012, 0.065);
      proxy.userData.interactable = info;
      panel.add(proxy);
      this.interactables.push({ object: proxy, data: info });
      return { cap, info };
    };

    this.buttons.crop = makeButton(
      -0.19,
      'CROP',
      'nursery-cycle-crop',
      'Crop: Green Coral Lettuce - click to switch',
      'Bench crop selector: choose the lettuce variety loaded in the seed drill. Green Coral and Red Coral Lettuce share the same reference Day 4-20 morphology but use different leaf palettes.',
    );
    this.buttons.seed = makeButton(
      0,
      'SEED',
      'nursery-seed-all',
      'Sow every empty tray',
      'Batch seed drill: sow the selected lettuce variety into every empty 320-cell tray on this bench. Germination is 100%, so no cell is left empty.',
    );
    this.buttons.grow = makeButton(
      0.19,
      'GROW',
      'nursery-grow-all',
      'Grow planted trays to Day 14',
      'Accelerated nursery cycle: advance every planted tray through Day 1 to Day 14 in a short controlled sequence. Empty trays are left untouched and the game clock does not change.',
    );
    this.buttonInfo.crop = this.buttons.crop.info;
    this.buttonInfo.seed = this.buttons.seed.info;
    this.buttonInfo.grow = this.buttons.grow.info;
    this.setGrowthControlsState({ empty: this.trays.length, planted: 0, ready: 0, active: 0 });
  }

  /** Live labels and lamp colour for the bench control panel. */
  setGrowthControlsState({
    empty = 0,
    growing = 0,
    ready = 0,
    active = 0,
    carried = 0,
    seedlings = 0,
    cropName = '',
    cropLabel = 'Green Coral Lettuce',
  } = {}) {
    const planted = growing + ready + carried;
    const redCoral = /red/i.test(cropName) || /red/i.test(cropLabel);
    if (this.buttons.crop) {
      this.buttons.crop.cap.material = redCoral
        ? this.materials.ledRed
        : this.materials.ledGreen;
      this.buttonInfo.crop.interactionHint = `Crop: ${cropLabel} - click to switch`;
      this.buttonInfo.crop.specs = [
        ['Loaded crop', cropLabel],
        ['Available', 'Green Coral Lettuce · Red Coral Lettuce'],
        ['Growth cycle', 'Day 1 to Day 17 · reference lettuce Days 4-20'],
      ];
    }
    if (this.buttons.seed) {
      this.buttons.seed.cap.material =
        empty > 0 ? this.materials.ledGreen : this.materials.ledRed;
      this.buttonInfo.seed.interactionHint =
        empty > 0 ? `Sow ${empty} empty tray${empty === 1 ? '' : 's'}` : 'All trays sown';
      this.buttonInfo.seed.specs = [
        ['Crop', cropLabel],
        ['Empty trays', String(empty)],
        ['Stock on bench', `${planted} planted · ${seedlings.toLocaleString('en-GB')} seedlings`],
      ];
    }
    if (this.buttons.grow) {
      this.buttons.grow.cap.material =
        active > 0
          ? this.materials.ledAmber
          : growing > 0
            ? this.materials.ledGreen
            : ready > 0
              ? this.materials.ledWhite
              : this.materials.ledRed;
      this.buttonInfo.grow.interactionHint =
        active > 0
          ? 'Growing - Day 1 to 14'
          : growing > 0
            ? 'Grow planted trays to Day 14'
            : ready > 0
              ? `${ready} tray${ready === 1 ? '' : 's'} ready for transplant`
              : 'Sow a tray before growing';
      this.buttonInfo.grow.specs = [
        ['Planted trays', String(planted)],
        ['Ready for transplant', String(ready)],
        ['Cycle', 'Day 1 to Day 14 · clock unchanged'],
      ];
    }
    // Empty tray prompts quote the loaded crop, so refresh them on crop change.
    for (const tray of this.trays ?? []) {
      if (tray.state === 'empty') tray.refreshInteraction();
    }
  }

  /** Refresh the bench stock line without disturbing the ebb-flow specs. */
  refreshStock() {
    if (!this.data || this.stockIndex < 0) return;
    const trays = this.trays ?? [];
    const empty = trays.filter((tray) => tray.state === 'empty').length;
    const growing = trays.filter(
      (tray) => tray.state !== 'empty' && !tray.ready && tray.atTable,
    ).length;
    const ready = trays.filter((tray) => tray.ready && tray.atTable).length;
    const carried = trays.filter((tray) => !tray.atTable).length;
    this.data.specs[this.stockIndex][1] =
      `${empty} empty · ${growing} growing · ${ready} ready` +
      (carried ? ` · ${carried} carried` : '');
    this.refreshPlanted();
  }



  buildPlumbing(group) {
    const irrigation = this.config.irrigation;
    const [pumpX, pumpZ] = irrigation.pumpPosition;
    const pan = this.bed.floodPan;
    const halfW = pan.width / 2;
    const halfL = pan.length / 2;
    const supply = new CylinderBatch(this.materials.pvcWhite);
    const returnLine = new CylinderBatch(this.materials.pvcReturn);
    const bright = new BeamBatch(this.materials.stainless, { castShadow: false });

    const pump = new THREE.Group();
    pump.name = 'nursery-irrigation-pump';
    pump.position.set(pumpX, 0, pumpZ);
    group.add(pump);
    pump.add(
      boxMesh(0.46, 0.045, 0.34, this.materials.steelDark, V(0, 0.024, 0), 'nursery-pump-skid'),
    );
    const motor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.075, 0.24, 18),
      this.materials.pumpBlue,
    );
    motor.rotation.z = Math.PI / 2;
    motor.position.set(-0.04, 0.22, 0);
    motor.castShadow = true;
    pump.add(motor);
    const volute = new THREE.Mesh(
      new THREE.CylinderGeometry(0.105, 0.105, 0.08, 20),
      this.materials.pumpPaint,
    );
    volute.rotation.z = Math.PI / 2;
    volute.position.set(0.17, 0.22, 0);
    pump.add(volute);
    this.pumpRotor = new THREE.Mesh(
      new THREE.TorusGeometry(0.052, 0.011, 6, 14),
      this.materials.stainless,
    );
    this.pumpRotor.position.set(0.215, 0.22, 0.055);
    for (let blade = 0; blade < 3; blade += 1) {
      const spoke = boxMesh(
        0.008,
        0.09,
        0.005,
        this.materials.stainless,
        V(0, 0, 0.003),
        'nursery-pump-impeller',
      );
      spoke.rotation.z = (blade / 3) * Math.PI;
      this.pumpRotor.add(spoke);
    }
    pump.add(this.pumpRotor);
    this.pumpLamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 10, 8),
      this.materials.ledRed,
    );
    this.pumpLamp.position.set(0.15, 0.36, 0.11);
    pump.add(this.pumpLamp);

    const gaugeStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.11, 8),
      this.materials.stainless,
    );
    gaugeStem.position.set(0.17, 0.38, 0.06);
    pump.add(gaugeStem);
    const gauge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.025, 16),
      this.materials.stainless,
    );
    gauge.rotation.x = Math.PI / 2;
    gauge.position.set(0.17, 0.445, 0.06);
    pump.add(gauge);

    const pumpPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.38, 0.12),
      this.materials.createLabelMaterial('P-03', 'NURSERY EBB/FLOOD - RES-2', {
        background: '#e9ece3',
        foreground: '#16324a',
      }),
    );
    pumpPlate.position.set(-0.02, 0.12, 0.172);
    pump.add(pumpPlate);


    // Buried suction riser from the Reservoir 2 feed main, then a visible
    // discharge up the east side of the bench and into the flood pan.
    supply.addPath(
      [
        V(pumpX - 0.14, 0.012, pumpZ),
        V(pumpX - 0.14, 0.22, pumpZ),
        V(pumpX + 0.06, 0.22, pumpZ),
        V(pumpX + 0.055, 0.23, pumpZ),
      ],
      0.022,
    );
    supply.addPath(
      [
        V(pumpX + 0.22, 0.25, pumpZ),
        V(pumpX + 0.22, 0.83, pumpZ),
        V(halfW - 0.05, 0.83, -halfL - 0.05),
        V(halfW - 0.11, 0.765, -halfL + 0.1),
      ],
      0.019,
    );
    const inletHeader = new BeamBatch(this.materials.pvcWhite, { castShadow: false });
    inletHeader.add(
      V(-halfW + 0.08, 0.765, -halfL + 0.1),
      V(halfW - 0.1, 0.765, -halfL + 0.1),
      0.018,
      0.018,
    );
    for (let i = 0; i < 8; i += 1) {
      const x = -halfW + 0.16 + i * 0.19;
      inletHeader.add(V(x, 0.765, -halfL + 0.1), V(x, 0.775, -halfL + 0.1), 0.007, 0.007);
    }
    inletHeader.build(group, 'nursery-feed-manifold');
    supply.addJoint(V(pumpX - 0.14, 0.22, pumpZ), 0.03);
    supply.addJoint(V(halfW - 0.08, 0.83, -halfL - 0.05), 0.024);
    supply.build(group, 'nursery-feed-pipe');

    // Gravity drain: bottom outlet, drop below the bench, then a floor-level
    // return to the Reservoir 2 return riser at the service corner.
    returnLine.addPath(
      [
        V(-0.75, 0.76, halfL - 0.08),
        V(-0.75, 0.76, halfL + 0.02),
        V(-0.75, 0.07, halfL + 0.02),
        V(1.16, 0.07, halfL + 0.02),
        V(1.16, 0.07, pumpZ - 0.24),
        V(1.16, 0.015, pumpZ - 0.24),
      ],
      0.023,
    );
    returnLine.addJoint(V(-0.75, 0.76, halfL + 0.02), 0.034);
    returnLine.build(group, 'nursery-return-pipe');

    const drainValve = new THREE.Group();
    drainValve.name = 'nursery-drain-valve';
    drainValve.position.set(1.16, 0.17, pumpZ - 0.24);
    const valveBody = new THREE.Mesh(
      new THREE.SphereGeometry(0.048, 12, 10),
      this.materials.stainless,
    );
    drainValve.add(valveBody);
    this.drainHandle = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.018, 0.024),
      this.materials.ledRed,
    );
    this.drainHandle.position.set(0.04, 0.055, 0);
    drainValve.add(this.drainHandle);
    group.add(drainValve);

    const feedLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 0.12),
      this.materials.createLabelMaterial('RES-2 FEED', 'CLEAN MIXED SOLUTION', {
        background: '#e9ece3',
        foreground: '#16324a',
      }),
    );
    feedLabel.position.set(pumpX + 0.2, 0.59, pumpZ + 0.01);
    feedLabel.rotation.y = -Math.PI / 2;
    group.add(feedLabel);
    const returnLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.38, 0.12),
      this.materials.createLabelMaterial('EBB RETURN', 'RETURN TO RESERVOIR 2', {
        background: '#e9ece3',
        foreground: '#16324a',
      }),
    );
    returnLabel.position.set(1.16, 0.3, pumpZ - 0.21);
    returnLabel.rotation.y = Math.PI;
    group.add(returnLabel);

    for (const x of [pumpX - 0.14, 1.16]) {
      const flange = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.018, 14),
        this.materials.steelDark,
      );
      flange.position.set(x, 0.01, x === 1.16 ? pumpZ - 0.24 : pumpZ);
      group.add(flange);
    }
    bright.add(
      V(pumpX + 0.22, 0.83, pumpZ),
      V(halfW - 0.05, 0.83, -halfL - 0.05),
      0.006,
      0.006,
    );
    bright.build(group, 'nursery-feed-brackets');

    this.collisionWorld?.addBox({
      x: this.config.centre[0] + this.bed.centre[0] + pumpX,
      z: this.config.centre[1] + this.bed.centre[1] + pumpZ,
      width: 0.55,
      depth: 0.44,
      label: 'nursery irrigation pump',
    });
  }


  buildSightGauge(group) {
    const pan = this.bed.floodPan;
    const x = 0.78;
    const z = pan.length / 2 + 0.025;
    const baseY = pan.floorY;

    const fitting = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.035, 12),
      this.materials.pvcGrey,
    );
    fitting.position.set(x, baseY + 0.018, z);
    group.add(fitting);

    // Short link back into the pan end wall, so the gauge is not floating.
    const link = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.009, 0.06, 8),
      this.materials.pvcGrey,
    );
    link.rotation.x = Math.PI / 2;
    link.position.set(x, baseY + 0.018, z - 0.03);
    group.add(link);

    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.019, 0.019, 0.25, 14, 1, true),
      this.materials.glassDoor,
    );
    tube.position.set(x, baseY + 0.16, z);
    tube.renderOrder = 2;
    group.add(tube);

    this.sightWater = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 1, 12),
      this.materials.water,
    );
    this.sightWater.position.set(x, baseY + 0.001, z);
    this.sightWater.scale.y = 0.001;
    this.sightWater.visible = false;
    group.add(this.sightWater);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, 0.018, 12),
      this.materials.pvcGrey,
    );
    cap.position.set(x, baseY + 0.292, z);
    group.add(cap);
  }

  registerInteraction(group) {
    const { trays, width, length } = this.bed;
    const capacity = trays.count * trays.cells;
    const info = {
      id: this.bed.id,
      buildingId: LAYOUT.nursery.id,
      category: 'Propagation',
      title: 'Single-layer tidal seedling bed',
      interaction: 'nursery-start-cycle',
      interactionHint: 'Start ebb & flow cycle',
      description:
        'A commercial rolling nursery bench with one corrugated ABS flood pan. Thirty-six 320-cell propagation trays sit in a symmetrical 6 x 6 block; the pump floods the pan from Reservoir 2, holds the water at the tray drainage holes, then opens the return valve and drains back to the reservoir. Press E to start a manual cycle; automatic cycles also run on the propagation timer.',
      specs: [
        ['Bench', `${length.toFixed(2)} x ${width.toFixed(2)} m - single layer`],
        ['Trays', `${trays.count} - ${trays.rows} x ${trays.columns} grid`],
        ['Cells', `${trays.cells} per tray - ${capacity.toLocaleString('en-GB')} seedlings`],
        ['Tray size', `${Math.round(trays.length * 1000)} x ${Math.round(trays.width * 1000)} x ${Math.round(trays.height * 1000)} mm`],
        ['Irrigation', 'Ebb & flow - Reservoir 2'],
        ['Stage', STAGE_LABELS.ready],
        ['Cycles', '0 completed'],
        ['Nursery stock', `${trays.count} empty`],
        ['Planted', '0 trays'],
        ['Ready', '0 trays'],
      ],
    };
    group.userData.interactable = info;
    this.interactables.push({ object: group, data: info });
    this.data = info;
    this.data.stageIndex = 5;
    this.data.cycleIndex = 6;
    this.stockIndex = 7;
    this.plantedIndex = 8;
    this.readyIndex = 9;
    this.capacity = capacity;
    this.refreshStock();
    this.refreshPlanted();
  }

  refreshPlanted() {
    if (!this.data || this.plantedIndex < 0) return;
    const trays = this.trays ?? [];
    const planted = trays.filter((tray) => tray.state !== 'empty').length;
    const ready = trays.filter((tray) => tray.ready).length;
    this.data.specs[this.plantedIndex][1] = `${planted} of ${trays.length} trays`;
    this.data.specs[this.readyIndex][1] =
      ready > 0 ? `${ready} - READY FOR TRANSPLANT` : '0 trays';
  }



  /** Start a manual cycle when the bench is drained and ready. */
  startCycle() {
    if (this.stage !== 'ready') {
      return { started: false, stage: this.stage, label: STAGE_LABELS[this.stage] };
    }
    this.stage = 'flooding';
    this.stageElapsed = 0;
    this.autoTimer = 0;
    this.pumpOn = true;
    this.drainOpen = false;
    this.applyWaterDepth(0.002);
    this.syncControl();
    this.updateStatus();
    return { started: true, stage: this.stage, label: STAGE_LABELS[this.stage] };
  }

  /** Enable/disable the recurring propagation timer. */
  setAuto(enabled) {
    this.auto = Boolean(enabled);
    this.control?.setNurseryState({ autoCycle: this.auto });
    return this.auto;
  }

  /** Return the bench to a clean ready state (used by tests and maintenance). */
  resetCycle() {
    this.stage = 'ready';
    this.stageElapsed = 0;
    this.waterDepth = 0;
    this.cycles = 0;
    this.pumpOn = false;
    this.drainOpen = false;
    this.autoTimer = this.bed.cycle.intervalSeconds - this.bed.cycle.initialDelaySeconds;
    this.applyWaterDepth(0);
    this.syncControl();
    this.updateStatus();
    return this;
  }

  syncControl() {
    if (!this.control?.setNurseryState) return;
    this.control.setNurseryState({
      stage: this.stage,
      pumpOn: this.pumpOn,
      waterDepth: this.waterDepth,
      cycles: this.cycles,
      autoCycle: this.auto,
      drainOpen: this.drainOpen,
    });
  }

  updateStatus() {
    if (!this.data) return;
    this.data.specs[this.data.stageIndex][1] = STAGE_LABELS[this.stage];
    this.data.specs[this.data.cycleIndex][1] = `${this.cycles} completed`;
    this.data.stage = this.stage;
    this.data.interactionHint =
      this.stage === 'ready' ? 'Start ebb & flow cycle' : STAGE_LABELS[this.stage];
  }

  applyWaterDepth(depth) {
    const pan = this.bed.floodPan;
    this.waterDepth = THREE.MathUtils.clamp(depth, 0, pan.waterDepth);
    if (this.waterMesh) {
      this.waterMesh.position.y = pan.floorY + 0.002 + this.waterDepth;
      this.waterMesh.visible = this.waterDepth > 0.0015;
    }
    if (this.sightWater) {
      const visibleDepth = Math.max(0.001, this.waterDepth);
      this.sightWater.scale.y = visibleDepth;
      this.sightWater.position.y = pan.floorY + 0.018 + visibleDepth / 2;
      this.sightWater.visible = this.waterDepth > 0.0015;
    }
  }

  update(dt) {
    if (!this.group) return;
    const step = Math.max(0, dt);
    this.runningTime += step;

    if (this.control?.consumeNurseryCycleRequest?.()) {
      this.startCycle();
    }

    if (this.auto && this.stage === 'ready') {
      this.autoTimer += step;
      if (this.autoTimer >= this.bed.cycle.intervalSeconds) this.startCycle();
    }

    if (this.stage !== 'ready') {
      this.stageElapsed += step;
      const duration =
        this.stage === 'flooding'
          ? this.bed.cycle.floodSeconds
          : this.stage === 'irrigating'
            ? this.bed.cycle.irrigateSeconds
            : this.bed.cycle.drainSeconds;
      const t = clamp01(this.stageElapsed / Math.max(0.001, duration));

      if (this.stage === 'flooding') {
        this.applyWaterDepth(this.bed.floodPan.waterDepth * t);
        if (t >= 1) this.enterStage('irrigating');
      } else if (this.stage === 'irrigating') {
        this.applyWaterDepth(this.bed.floodPan.waterDepth);
        if (t >= 1) this.enterStage('draining');
      } else if (this.stage === 'draining') {
        this.applyWaterDepth(this.bed.floodPan.waterDepth * (1 - t));
        if (t >= 1) this.completeCycle();
      }
    }

    if (this.control?.nursery) {
      // The water simulation reads the live depth after this update.
      this.control.nursery.waterDepth = this.waterDepth;
    }

    if (this.pumpRotor) {
      this.pumpRotor.rotation.z += step * (this.pumpOn ? 14 : 0);
    }
    if (this.pumpLamp) {
      this.pumpLamp.material = this.pumpOn
        ? this.materials.ledGreen
        : this.drainOpen
          ? this.materials.ledAmber
          : this.materials.ledRed;
    }
    if (this.drainHandle) {
      const target = this.drainOpen ? -Math.PI / 2 : 0;
      this.drainHandle.rotation.z +=
        (target - this.drainHandle.rotation.z) * Math.min(1, step * 8);
    }
  }

  enterStage(stage) {
    this.stage = stage;
    this.stageElapsed = 0;
    this.pumpOn = stage === 'flooding' || stage === 'irrigating';
    this.drainOpen = stage === 'draining';
    this.syncControl();
    this.updateStatus();
  }

  completeCycle() {
    this.stage = 'ready';
    this.stageElapsed = 0;
    this.pumpOn = false;
    this.drainOpen = false;
    this.cycles += 1;
    this.autoTimer = 0;
    this.applyWaterDepth(0);
    this.syncControl();
    this.updateStatus();
  }

  getInteractables() {
    return this.interactables;
  }

  setTopView() {}

  dispose() {
    this.interactables.length = 0;
    this.data = null;
    for (const tray of this.trays) tray.dispose();
    this.trays.length = 0;
    this.plantRoot = null;
    this.hitRoot = null;
    this.buttons = { grow: null, seed: null, crop: null };
    this.buttonInfo = { grow: null, seed: null, crop: null };
    this.trayMeshes = null;
    this.waterMesh = null;
    this.sightWater = null;
    this.pumpRotor = null;
    this.pumpLamp = null;
    this.drainHandle = null;
    if (!this.group) return;
    this.group.traverse((child) => {
      if (child.isMesh && !child.userData.sharedGeometry) child.geometry?.dispose();
    });
    this.group.removeFromParent();
    this.group = null;
  }
}
