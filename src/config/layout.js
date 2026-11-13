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
    panelWidth: 1.62,
    openTravel: 1.63,
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
    reservoirs: {
      radius: 1.25,
      height: 2.7,
      positions: [
        [-9.6, -15.1],
        [-6.4, -15.1],
      ],
    },
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
