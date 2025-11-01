export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 64;

// Generation radii control how many chunk rings are created around the player.
// A starting radius of 10 keeps the initial load responsive, while the
// extended limit of 55 unlocks roughly 100× the original explorable area when
// combined with lazy chunk expansion.
export const INITIAL_WORLD_RADIUS = 10;
export const EXTENDED_WORLD_RADIUS = 55;
export const ALWAYS_RENDER_RADIUS = 3; // chunk rings kept in every direction
export const VIEW_CULL_ANGLE_DEG = 140; // total degrees of forward render cone
export const DEFAULT_RENDER_DISTANCE = INITIAL_WORLD_RADIUS;
export const CHUNK_UNLOAD_PADDING = 2;
export const MAX_CHUNK_LOADS_PER_TICK = 8;

export const BLOCK_TYPES = {
  air: 0,
  grass: 1,
  dirt: 2,
  stone: 3,
  sand: 4,
  wood: 5,
  leaves: 6,
  gold: 7,
  diamond: 8,
  flower: 9,
  water: 10,
};

export const BLOCK_TYPE_LABELS = {
  [BLOCK_TYPES.grass]: 'Grass',
  [BLOCK_TYPES.dirt]: 'Dirt',
  [BLOCK_TYPES.stone]: 'Stone',
  [BLOCK_TYPES.sand]: 'Sand',
  [BLOCK_TYPES.wood]: 'Wood',
  [BLOCK_TYPES.leaves]: 'Leaves',
  [BLOCK_TYPES.gold]: 'Gold',
  [BLOCK_TYPES.diamond]: 'Diamond',
  [BLOCK_TYPES.flower]: 'Wildflower',
  [BLOCK_TYPES.water]: 'Water',
};

export const BLOCK_COLORS = {
  [BLOCK_TYPES.grass]: [0.49, 0.74, 0.35],
  [BLOCK_TYPES.dirt]: [0.58, 0.41, 0.29],
  [BLOCK_TYPES.stone]: [0.65, 0.65, 0.7],
  [BLOCK_TYPES.sand]: [0.93, 0.87, 0.63],
  [BLOCK_TYPES.wood]: [0.54, 0.35, 0.19],
  [BLOCK_TYPES.leaves]: [0.29, 0.62, 0.28],
  [BLOCK_TYPES.gold]: [0.97, 0.83, 0.36],
  [BLOCK_TYPES.diamond]: [0.53, 0.84, 0.92],
  [BLOCK_TYPES.flower]: [0.95, 0.66, 0.84],
  [BLOCK_TYPES.water]: [0.58, 0.78, 0.95],
};

export const SEA_LEVEL = 20;

export const FLOWER_CENTER_COLOR = [0.98, 0.94, 0.62];
export const FLOWER_STEM_COLOR = [0.25, 0.65, 0.38];

export const FLOWER_COLOR_VARIANTS = [
  {
    petalBase: [0.92, 0.32, 0.56],
    petalEdge: [0.99, 0.76, 0.88],
    petalCenter: [0.67, 0.13, 0.39],
    center: [0.98, 0.94, 0.62],
  },
  {
    petalBase: [0.98, 0.82, 0.34],
    petalEdge: [0.99, 0.93, 0.63],
    petalCenter: [0.92, 0.58, 0.18],
    center: [0.99, 0.88, 0.54],
  },
  {
    petalBase: [0.68, 0.62, 0.97],
    petalEdge: [0.88, 0.84, 0.99],
    petalCenter: [0.44, 0.32, 0.78],
    center: [0.94, 0.92, 0.75],
  },
  {
    petalBase: [0.94, 0.54, 0.2],
    petalEdge: [0.99, 0.83, 0.55],
    petalCenter: [0.78, 0.22, 0.09],
    center: [0.99, 0.9, 0.62],
  },
  {
    petalBase: [0.6, 0.83, 0.96],
    petalEdge: [0.84, 0.94, 0.99],
    petalCenter: [0.31, 0.58, 0.86],
    center: [0.95, 0.97, 0.82],
  },
  {
    petalBase: [0.97, 0.97, 0.97],
    petalEdge: [0.94, 0.76, 0.92],
    petalCenter: [0.82, 0.4, 0.72],
    center: [0.99, 0.95, 0.83],
  },
  {
    petalBase: [0.74, 0.28, 0.78],
    petalEdge: [0.93, 0.67, 0.95],
    petalCenter: [0.42, 0.11, 0.47],
    center: [0.96, 0.86, 0.96],
  },
  {
    petalBase: [0.57, 0.34, 0.92],
    petalEdge: [0.82, 0.66, 0.97],
    petalCenter: [0.32, 0.17, 0.6],
    center: [0.9, 0.84, 0.97],
  },
  {
    petalBase: [0.44, 0.61, 0.96],
    petalEdge: [0.73, 0.83, 0.99],
    petalCenter: [0.21, 0.32, 0.67],
    center: [0.88, 0.92, 0.99],
  },
  {
    petalBase: [0.94, 0.52, 0.62],
    petalEdge: [0.99, 0.78, 0.86],
    petalCenter: [0.74, 0.26, 0.4],
    center: [0.99, 0.89, 0.84],
  },
  {
    petalBase: [0.88, 0.24, 0.42],
    petalEdge: [0.97, 0.61, 0.72],
    petalCenter: [0.63, 0.11, 0.28],
    center: [0.99, 0.8, 0.78],
  },
  {
    petalBase: [0.52, 0.8, 0.68],
    petalEdge: [0.77, 0.93, 0.84],
    petalCenter: [0.26, 0.55, 0.43],
    center: [0.9, 0.96, 0.87],
  },
  {
    petalBase: [0.82, 0.7, 0.24],
    petalEdge: [0.95, 0.88, 0.56],
    petalCenter: [0.58, 0.46, 0.12],
    center: [0.97, 0.9, 0.66],
  },
];

export const FLOWER_UI_COLOR = [0.95, 0.66, 0.84];
