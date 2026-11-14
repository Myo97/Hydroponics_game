/**
 * Shared, real-world dimensions for the whole simulator.
 * Everything is in metres so structures, equipment and gameplay stay consistent.
 *
 * Coordinate system:
 *   +X → east (greenhouse width)   +Y → up   +Z → south (entrance side)
 *   The greenhouse occupies X ∈ [-12, 12], Z ∈ [-18, 18].
 */
export const LAYOUT = {
  greenhouse: {
    width: 24, // 6 roof spans of 4 m
    length: 36, // 9 frame bays of 4 m
    gutterHeight: 4.6,
    ridgeHeight: 5.55,
    plinthHeight: 0.9,
    bayWidth: 4,
    bayLength: 4,
    wallThickness: 0.18,
    floorY: 0.0,
  },

  entrance: {
    width: 3.2,
    height: 2.7,
    panelWidth: 1.58,
    openTravel: 1.62,
    leafDepth: 0.055,
    trackOverrun: 1.05,
    interlockDelay: 0.18,
    // Located in the south gable wall (Z = +length / 2).
  },

  /**
   * NFT production area.
   * Six rows, one per 4 m roof bay, with centres on the column-grid mid-lines.
   * Each row is split into three independent 6 m tables with a 1.4 m cross
   * walkway between them. Every table carries eight parallel gullies and forty
   * real 15 cm-spaced planting holes per gully.
   */
  beds: {
    centersX: [-10, -6, -2, 2, 6, 10],
    tablesPerRow: 3,
    gulliesPerTable: 8,
    gullySpacing: 0.19,
    gullyWidth: 0.11,
    gullyHeight: 0.095,
    gullyLength: 5.94,
    tableGap: 1.4,
    channelStartZ: -10,
    benchHeight: 0.8,
    legSpacing: 1.9,
    slopeDegrees: 1.2,
    holesPerGully: 40,
    holeSpacing: 0.15,
    holeDiameter: 0.052,
    // Legacy aliases kept for systems that still read the original names.
    channelsPerBed: 8,
    channelSpacing: 0.19,
    channelWidth: 0.11,
    channelHeight: 0.095,
    channelLength: 5.94,
  },

  tanks: {
    nutrients: {
      radius: 0.4,
      height: 1.1,
      position: [0.4, -16.2],
      spacing: 0.95,
      labels: [
        { key: 'A', title: 'NUTRIENT A', subtitle: 'CALCIUM NITRATE · 60 L', colour: 'blue' },
        { key: 'B', title: 'NUTRIENT B', subtitle: 'POTASSIUM SULPHATE · 60 L', colour: 'blue' },
        { key: 'C', title: 'pH', subtitle: 'NITRIC ACID · pH DOWN · 60 L', colour: 'white' },
      ],
    },
  },

  /**
   * Below-ground water infrastructure (Version 3).
   *
   * The two RO storage tanks are buried in a twin concrete vault under the
   * headhouse. A separate nutrient-return tank receives all NFT drainage: it
   * never shares a compartment with the clean RO store. The above-ground
   * rainwater harvester is fed by the north roof collector and tops the RO
   * tanks through a dedicated transfer pump and distribution manifold.
   */
  storage: {
    vaultRadius: 1.76,
    vaultDepth: 3.5,
    tankRadius: 1.42,
    tankHeight: 2.45,
    tankTopY: -0.52,
    coverRadius: 0.46,
    hatchRadius: 0.6,
    roTanks: [
      {
        id: 'ro-tank-1',
        code: 'RO-01',
        label: 'RO STORAGE 01',
        subtitle: 'PERMEATE · 12,000 L',
        position: [-9.8, -14.9],
        capacity: 12000,
        initialLevel: 0.78,
        ec: 0.02,
        ph: 6.9,
        temp: 18.6,
        targetEc: 0.02,
        targetPh: 6.9,
      },
      {
        id: 'ro-tank-2',
        code: 'RO-02',
        label: 'RO STORAGE 02',
        subtitle: 'MIXED FEED · 12,000 L',
        position: [-6.2, -14.9],
        capacity: 12000,
        initialLevel: 0.64,
        ec: 1.82,
        ph: 5.88,
        temp: 19.3,
        targetEc: 1.8,
        targetPh: 5.9,
      },
    ],
    returnTank: {
      id: 'return-tank',
      code: 'DR-01',
      label: 'NUTRIENT RETURN',
      subtitle: 'DIRTY DRAIN · 8,000 L',
      position: [8.8, -15.2],
      capacity: 8000,
      initialLevel: 0.31,
      radius: 1.28,
      height: 2.25,
      topY: -0.5,
    },
    harvester: {
      id: 'rainwater-harvester',
      label: 'RAINWATER HARVESTER',
      subtitle: 'ROOF RUN-OFF · 5,000 L',
      position: [-2.15, -15.35],
      radius: 1.02,
      height: 2.35,
      capacity: 5000,
      initialLevel: 0.46,
    },
    transferPump: {
      id: 'rain-transfer-pump',
      label: 'RAIN TRANSFER PUMP',
      position: [-3.05, -17.0],
      yaw: 0,
    },
    distribution: {
      y: 0.62,
      z: -14.55,
      valveXs: [-9.8, -6.2],
    },
    suction: {
      y: 0.16,
      z: -13.82,
      riserXs: [-9.8, -6.2],
    },
    returnInlet: {
      x: 8.8,
      z: -13.58,
    },
  },

  /** Roof rainwater collection to the harvester inlet. */
  rainwater: {
    collectorY: 4.18,
    collectorZ: -17.55,
    startX: -12,
    endX: 12,
    collectorRadius: 0.09,
    downpipeX: -2.15,
    harvesterInletY: 2.46,
    firstFlushLength: 0.85,
    strainerRadius: 0.17,
  },

  /** Bluelab Pro Controller + three-channel dosing station. */
  bluelab: {
    position: [5.3, -16.85],
    // depth (X) × height (Y) × width (Z)
    size: [0.5, 1.46, 1.02],
    footHeight: 0.07,
    screenSize: [0.66, 0.34],
    pumps: 3,
    probeSets: 2,
    selectorValves: 6,
  },

  /** Per-bay screens and hinged roof vents. */
  screens: {
    shadeY: 4.32,
    energyY: 4.14,
    insetX: 0.18,
    insetZ: 0.22,
    bayGap: 0.06,
    retractedFraction: 0.12,
  },
  vents: {
    openingAngle: 0.64,
    slopeLength: 1.34,
    lengthInset: 0.22,
    frameThickness: 0.05,
  },

  /** Yellow sticky traps clipped to structural columns (pest monitoring). */
  traps: {
    positions: [
      [-8, -10],
      [4, -10],
      [8, -10],
      [-8, -2],
      [4, -2],
      [8, -2],
      [-8, 6],
      [4, 6],
      [8, 6],
      [-8, 14],
      [4, 14],
      [8, 14],
    ],
    width: 0.22,
    height: 0.3,
    offset: 0.24,
  },

  topView: {
    centerZ: -13.4,
    width: 27,
    minDepth: 14.5,
    height: 26,
  },

  pumps: {
    // Duty + standby skid immediately south of the mixed-feed reservoir.
    positions: [
      [-4.9, -12.7, 0],
      [-3.4, -12.7, 0],
    ],
    dutyIndex: 0,
  },

  cabinet: {
    position: [11.66, 13.0],
    // depth (X) × height (Y) × width (Z)
    size: [0.46, 1.78, 0.9],
    footHeight: 0.11,
    doorOpenAngle: 1.94,
  },

  /**
   * Horizontal air-flow fans: four per 4 m roof bay (six bays = 24 fans).
   * Each fan hangs just inside the east gutter column, clear of the shade deck.
   */
  fans: {
    perBay: 4,
    height: 3.62,
    radius: 0.46,
    zPositions: [-13.55, -4.55, 4.55, 13.55],
  },

  /** Horizontal shade deck, hung immediately below the truss bottom chord. */
  shade: {
    height: 4.32,
    insetX: 0.18,
    insetZ: 0.18,
    transmission: 0.58,
  },

  /** Floor-level irrigation/return runs. All dimensions in metres. */
  pipework: {
    supplyY: 0.16,
    supplyRadius: 0.052,
    returnY: 0.11,
    returnRadius: 0.075,
    crossMainZ: -10.8,
    returnMainZ: 11.4,
    supplyMainStartX: -11.05,
    supplyMainEndX: 11.05,
    returnMainStartX: -10.9,
    returnMainEndX: 10.9,
    tableSupplyOffset: 0.12,
    tableReturnOffset: 0.12,
    tableSupplyY: 0.74,
    tableDrainY: 0.61,
    branchRadius: 0.024,
    drainBranchRadius: 0.038,
    bracketSpacing: 1.5,
  },

  player: {
    spawnX: 0,
    spawnZ: 27,
    spawnYaw: 0,
    eyeHeight: 1.68,
    radius: 0.3,
    walkSpeed: 3.1,
    sprintSpeed: 5.4,
    acceleration: 12,
  },

  exterior: {
    apronHalfWidth: 21,
    apronHalfDepth: 26,
    apronFront: 31,
    apronBack: -25,
  },
};

/** Derived helpers used by several systems. */
export const DIM = {
  halfWidth: LAYOUT.greenhouse.width / 2,
  halfLength: LAYOUT.greenhouse.length / 2,
  gutterY: LAYOUT.greenhouse.gutterHeight,
  ridgeY: LAYOUT.greenhouse.ridgeHeight,
  plinthY: LAYOUT.greenhouse.plinthHeight,
  bayWidth: LAYOUT.greenhouse.bayWidth,
  bayLength: LAYOUT.greenhouse.bayLength,
};

/** X positions of the gutter lines (also the column lines). */
export const GUTTER_X = [-12, -8, -4, 0, 4, 8, 12];

/** X positions of the roof ridges (span centres). */
export const RIDGE_X = [-10, -6, -2, 2, 6, 10];

/** Z positions of the frame bays / trusses. */
export const FRAME_Z = Array.from({ length: 10 }, (_, i) => -18 + i * 4);

/**
 * HAF fan installation derived from the six 4 m roof bays.
 * Four fans per bay, hung just inside the east gutter column. Each fan points
 * along +Z so the four units form one continuous horizontal air loop per bay.
 */
export const FAN_INSTALLATION = (() => {
  const bays = [];
  for (let index = 0; index < GUTTER_X.length - 1; index += 1) {
    const west = GUTTER_X[index];
    const east = GUTTER_X[index + 1];
    const bay = {
      id: `haf-bay-${index + 1}`,
      bay: index + 1,
      centreX: (west + east) / 2,
      columnX: east,
      mountX: east - 0.55,
      direction: 1,
      fans: LAYOUT.fans.zPositions.map((z, fanIndex) => ({
        id: `haf-${index + 1}-${fanIndex + 1}`,
        bay: index + 1,
        fan: fanIndex + 1,
        x: east - 0.55,
        z,
        columnX: east,
        direction: 1,
      })),
    };
    bays.push(bay);
  }
  return {
    bays,
    fans: bays.flatMap((bay) => bay.fans),
    perBay: LAYOUT.fans.perBay,
  };
})();

/**
 * Derived NFT installation geometry.
 * A table is a self-contained eight-gully production module. Three modules are
 * laid end-to-end in each of the six 4 m column bays, with a cross walkway
 * between every table and clear side aisles.
 */
export const NFT_INSTALLATION = (() => {
  const beds = LAYOUT.beds;
  const tables = [];
  const tableWidth = (beds.gulliesPerTable - 1) * beds.gullySpacing + beds.gullyWidth;
  const tablePitch = beds.gullyLength + beds.tableGap;

  beds.centersX.forEach((centerX, rowIndex) => {
    for (let bay = 0; bay < beds.tablesPerRow; bay += 1) {
      const startZ = beds.channelStartZ + bay * tablePitch;
      tables.push({
        id: `nft-row-${rowIndex + 1}-bay-${bay + 1}`,
        row: rowIndex + 1,
        bay: bay + 1,
        centerX,
        startZ,
        endZ: startZ + beds.gullyLength,
        centerZ: startZ + beds.gullyLength / 2,
      });
    }
  });

  return {
    tables,
    tableWidth,
    tableHalfWidth: tableWidth / 2,
    tablePitch,
    gulliesPerTable: beds.gulliesPerTable,
    gullyLength: beds.gullyLength,
    growingStartZ: beds.channelStartZ,
    growingEndZ: beds.channelStartZ + beds.tablesPerRow * tablePitch - beds.tableGap,
    crossWalkway: beds.tableGap,
  };
})();

/** Whether a Z coordinate is inside the growing area (used by plant simulation). */
export function isInsideGrowingArea(z) {
  return z >= NFT_INSTALLATION.growingStartZ && z <= NFT_INSTALLATION.growingEndZ;
}
