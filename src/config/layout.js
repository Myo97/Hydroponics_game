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
    // Located in the south gable wall (Z = +length / 2).
  },

  /** NFT bench rows, each holding three growing channels. */
  beds: {
    centersX: [-9.6, -6.4, -3.2, 3.2, 6.4, 9.6],
    channelsPerBed: 3,
    channelSpacing: 0.26,
    channelWidth: 0.16,
    channelHeight: 0.11,
    channelLength: 18,
    channelStartZ: -9,
    benchHeight: 0.82,
    legSpacing: 3,
    slopeDegrees: 0.7,
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
        ['A', 'CALCIUM NITRATE'],
        ['B', 'POTASSIUM SULPHATE'],
        ['C', 'pH DOWN · NITRIC'],
      ],
    },
  },

  pumps: {
    positions: [
      [4.6, -14.3, 0],
      [6.1, -14.3, Math.PI],
    ],
  },

  cabinet: {
    position: [11.73, 5.4],
    size: [0.36, 1.25, 0.9],
  },

  fans: {
    positions: [
      [0, -5.5],
      [0, 4.5],
      [0, 12.5],
    ],
    height: 4.0,
    radius: 0.72,
  },

  returnManifold: {
    z: 10.2,
    xStart: -9.6,
    xEnd: 11.2,
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

/** Whether a Z coordinate is inside the growing area (used by plant simulation). */
export function isInsideGrowingArea(z) {
  const { channelStartZ, channelLength } = LAYOUT.beds;
  return z >= channelStartZ && z <= channelStartZ + channelLength;
}
