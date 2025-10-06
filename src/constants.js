export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 64;

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
  flowerRed: 9,
  flowerYellow: 10,
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
  [BLOCK_TYPES.flowerRed]: 'Flower (Red)',
  [BLOCK_TYPES.flowerYellow]: 'Flower (Yellow)',
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
};

export const FLOWER_PETAL_COLORS = {
  [BLOCK_TYPES.flowerRed]: [0.9, 0.25, 0.32],
  [BLOCK_TYPES.flowerYellow]: [0.98, 0.88, 0.38],
};

export const FLOWER_CENTER_COLOR = [0.98, 0.94, 0.62];
export const FLOWER_STEM_COLOR = [0.25, 0.65, 0.38];
