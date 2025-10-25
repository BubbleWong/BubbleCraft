import { BLOCK_TYPES } from '../../constants.js';

const TILE_SIZE = 48;
const ATLAS_COLUMNS = 8;
const ATLAS_ROWS = 6;
const TAU = Math.PI * 2;

const FACE_INDEX = {
  POS_X: 0,
  NEG_X: 1,
  POS_Y: 2,
  NEG_Y: 3,
  POS_Z: 4,
  NEG_Z: 5,
};

function clampChannel(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function hexToRgb(hex) {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return [r, g, b];
}

function mixColors(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function lighten(color, amount) {
  return mixColors(color, [255, 255, 255], amount);
}

function darken(color, amount) {
  return mixColors(color, [0, 0, 0], amount);
}

export class BlockAtlas {
  constructor(scene) {
    this.tileSize = TILE_SIZE;
    this.columns = ATLAS_COLUMNS;
    this.rows = ATLAS_ROWS;
    this.width = this.columns * this.tileSize;
    this.height = this.rows * this.tileSize;

    this.texture = new BABYLON.DynamicTexture('block-atlas', { width: this.width, height: this.height }, scene, false, BABYLON.Texture.NEAREST_SAMPLINGMODE);
    this.texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    this.texture.hasAlpha = false;
    this.texture.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);

    this._ctx = this.texture.getContext();
    this._uvLookup = new Map();
    this._neutralTile = null;

    this._preparePalette();
    this._drawTiles();
    this.texture.update(false);

    this._faceTiles = new Map([
      [BLOCK_TYPES.grass, {
        top: ['grass_top_0', 'grass_top_1', 'grass_top_2'],
        bottom: ['dirt_0', 'dirt_1'],
        sides: ['grass_side_0', 'grass_side_1'],
      }],
      [BLOCK_TYPES.dirt, { all: ['dirt_0', 'dirt_1'] }],
      [BLOCK_TYPES.stone, { all: ['stone_0', 'stone_1', 'stone_2'] }],
      [BLOCK_TYPES.sand, { all: ['sand_0', 'sand_1'] }],
      [BLOCK_TYPES.wood, {
        top: ['wood_top_0', 'wood_top_1'],
        bottom: ['wood_top_0', 'wood_top_1'],
        sides: ['wood_bark_0', 'wood_bark_1'],
      }],
      [BLOCK_TYPES.leaves, { all: ['leaves_dense_0', 'leaves_dense_1', 'leaves_dense_2'] }],
      [BLOCK_TYPES.gold, { all: ['ore_gold_0', 'ore_gold_1', 'ore_gold_2'] }],
      [BLOCK_TYPES.diamond, { all: ['ore_diamond_0', 'ore_diamond_1', 'ore_diamond_2'] }],
      [BLOCK_TYPES.water, { all: ['water_0', 'water_1'] }],
      [BLOCK_TYPES.flower, { all: ['flower_tile_0', 'flower_tile_1'] }],
      ['default', { all: ['neutral_soft'] }],
    ]);
  }

  getBlockFaceUV(blockType, faceIndex = 0, worldX = 0, worldY = 0, worldZ = 0) {
    const mapping = this._faceTiles.get(blockType) ?? this._faceTiles.get('default');

    const tileList = () => {
      if (faceIndex === FACE_INDEX.POS_Y && mapping.top) return mapping.top;
      if (faceIndex === FACE_INDEX.NEG_Y && mapping.bottom) return mapping.bottom;
      if (faceIndex !== FACE_INDEX.POS_Y && faceIndex !== FACE_INDEX.NEG_Y && mapping.sides) return mapping.sides;
      return mapping.all ?? ['neutral_soft'];
    };

    const keys = tileList();
    const tileKey = Array.isArray(keys)
      ? keys[this._variantIndex(worldX, worldY, worldZ, faceIndex, keys.length)]
      : keys;

    const info = this._uvLookup.get(tileKey) ?? this._neutralTile;
    const { uMin, vMin, uMax, vMax } = info;
    return [
      uMax, vMin,
      uMax, vMax,
      uMin, vMax,
      uMin, vMin,
    ];
  }

  getNeutralUV() {
    if (!this._neutralTile) return [0.5, 0.5];
    const { uMin, vMin, uMax, vMax } = this._neutralTile;
    return [(uMin + uMax) * 0.5, (vMin + vMax) * 0.5];
  }

  _preparePalette() {
    this.palette = {
      grassBase: hexToRgb('#5eaf47'),
      grassHighlight: hexToRgb('#7ec75d'),
      grassShadow: hexToRgb('#32672f'),
      dirtBase: hexToRgb('#6f5034'),
      dirtShadow: hexToRgb('#3a2216'),
      stoneBase: hexToRgb('#868b91'),
      stoneLight: hexToRgb('#b6bcc3'),
      stoneDark: hexToRgb('#4a4f56'),
      sandBase: hexToRgb('#e2cf9c'),
      sandDark: hexToRgb('#b99866'),
      barkLight: hexToRgb('#885c32'),
      barkDark: hexToRgb('#54341b'),
      ringLight: hexToRgb('#c9a16d'),
      ringDark: hexToRgb('#8f5f2f'),
      leafBase: hexToRgb('#4da13f'),
      leafLight: hexToRgb('#8fe067'),
      leafDark: hexToRgb('#256027'),
      leafVibrant: hexToRgb('#6fd64c'),
      vine: hexToRgb('#3c8b2e'),
      goldBright: hexToRgb('#f3d976'),
      goldMid: hexToRgb('#d0aa3c'),
      goldStone: hexToRgb('#5f5741'),
      diamondBright: hexToRgb('#9feefe'),
      diamondMid: hexToRgb('#71d6f2'),
      diamondStone: hexToRgb('#506273'),
      waterShallow: hexToRgb('#348bdb'),
      waterDeep: hexToRgb('#1c3f85'),
      mudBase: hexToRgb('#4f362c'),
      mudDark: hexToRgb('#332019'),
      neutralSoft: hexToRgb('#bfc3c8'),
      neutralDark: hexToRgb('#898e92'),
      neutralLight: hexToRgb('#e0e2e5'),
    };
  }

  _drawTiles() {
    const tiles = [
      { key: 'grass_top', variants: 3, painter: (x, y, r) => this._paintGrassTop(x, y, r) },
      { key: 'grass_side', variants: 2, painter: (x, y, r) => this._paintGrassSide(x, y, r) },
      { key: 'dirt', variants: 2, painter: (x, y, r) => this._paintDirt(x, y, r) },
      { key: 'stone', variants: 3, painter: (x, y, r) => this._paintStone(x, y, r) },
      { key: 'sand', variants: 2, painter: (x, y, r) => this._paintSand(x, y, r) },

      { key: 'wood_bark', variants: 2, painter: (x, y, r) => this._paintWoodBark(x, y, r) },
      { key: 'wood_top', variants: 2, painter: (x, y, r) => this._paintWoodTop(x, y, r) },
      { key: 'leaves_dense', variants: 3, painter: (x, y, r) => this._paintLeaves(x, y, 1.0, r) },
      { key: 'leaves_soft', variants: 2, painter: (x, y, r) => this._paintLeaves(x, y, 0.7, r) },
      { key: 'neutral_soft', variants: 1, painter: (x, y) => this._paintNeutral(x, y, this.palette.neutralSoft) },

      { key: 'ore_gold', variants: 3, painter: (x, y, r) => this._paintGoldOre(x, y, r) },
      { key: 'ore_diamond', variants: 3, painter: (x, y, r) => this._paintDiamondOre(x, y, r) },
      { key: 'water', variants: 2, painter: (x, y, r) => this._paintWater(x, y, r) },
      { key: 'mud', variants: 2, painter: (x, y, r) => this._paintMud(x, y, r) },
      { key: 'flower_tile', variants: 2, painter: (x, y, r) => this._paintGrassWithFlowers(x, y, r) },

      { key: 'stone_polished', variants: 2, painter: (x, y, r) => this._paintPolishedStone(x, y, r) },
      { key: 'stone_brick', variants: 2, painter: (x, y, r) => this._paintStoneBrick(x, y, r) },
      { key: 'sandstone', variants: 2, painter: (x, y, r) => this._paintSandstone(x, y, r) },
      { key: 'neutral_dark', variants: 1, painter: (x, y) => this._paintNeutral(x, y, this.palette.neutralDark) },
      { key: 'neutral_light', variants: 1, painter: (x, y) => this._paintNeutral(x, y, this.palette.neutralLight) },
    ];

    let col = 0;
    let row = 0;
    const advance = () => {
      col += 1;
      if (col >= this.columns) {
        col = 0;
        row += 1;
      }
      if (row >= this.rows) throw new Error('Block atlas dimensions insufficient for defined tiles');
    };

    tiles.forEach(({ key, variants, painter }) => {
      for (let variant = 0; variant < variants; variant += 1) {
        const tileKey = variants > 1 ? `${key}_${variant}` : key;
        this._paintTile(tileKey, col, row, painter, variant);
        advance();
      }
    });

    this._neutralTile = this._uvLookup.get('neutral_soft');
  }

  _registerTile(key, column, row) {
    const uMin = column / this.columns;
    const vMin = row / this.rows;
    const uMax = (column + 1) / this.columns;
    const vMax = (row + 1) / this.rows;
    this._uvLookup.set(key, { uMin, vMin, uMax, vMax });
  }

  _paintTile(key, col, row, painter, variant = 0) {
    const size = this.tileSize;
    const image = this._ctx.createImageData(size, size);
    const data = image.data;
    for (let py = 0; py < size; py += 1) {
      for (let px = 0; px < size; px += 1) {
        const color = painter(px, py, variant);
        const idx = (py * size + px) * 4;
        data[idx] = clampChannel(color[0]);
        data[idx + 1] = clampChannel(color[1]);
        data[idx + 2] = clampChannel(color[2]);
        data[idx + 3] = 255;
      }
    }
    this._ctx.putImageData(image, col * size, row * size);
    this._registerTile(key, col, row);
  }

  _paintGrassTop(x, y, variant = 0) {
    const offset = variant * 91.7;
    const coarse = this._fbm(x + offset, y - offset, 11.7 + variant * 7.1, 4);
    let color = mixColors(this.palette.grassShadow, this.palette.grassHighlight, 0.52 + coarse * 0.32);

    const bladeSeed = this._hash2D(Math.floor((x + offset) / 3), Math.floor((y - offset) / 3), 41.6 + variant * 23.1);
    if (bladeSeed > 0.78) {
      color = lighten(color, (bladeSeed - 0.78) * 0.6);
    }

    const tuftNoise = this._periodicNoise(x + 17.3 + offset, y + 31.1 - offset, 63.5 + variant * 12.5, 1.8);
    color = mixColors(color, tuftNoise > 0.5 ? lighten(color, (tuftNoise - 0.5) * 0.18) : darken(color, (0.5 - tuftNoise) * 0.12), 0.6);

    const nx = (x % 8) / 8 - 0.5;
    const ny = (y % 8) / 8 - 0.5;
    const bloomSeed = this._hash2D(Math.floor((x + offset) / 8), Math.floor((y - offset) / 8), 97.3 + variant * 45.7);
    const dist = Math.sqrt(nx * nx + ny * ny);
    if (bloomSeed > 0.965 && dist < 0.3) {
      const tintIndex = bloomSeed > 0.985 ? [254, 224, 105] : [244, 250, 255];
      color = mixColors(color, tintIndex, (0.3 - dist) * 1.6);
    }
    return color;
  }

  _paintGrassSide(x, y, variant = 0) {
    const size = this.tileSize;
    const blend = this._smoothstep(0.2, 0.78, y / size);
    const top = this._paintGrassTop(x, y * 0.6, variant);
    const bottom = this._paintDirt(x, y, variant);
    let color = mixColors(top, bottom, blend);

    const tuftSeed = this._hash2D(Math.floor((x + variant * 11.5) / 6), Math.floor((y - variant * 8.9) / 6), 133.7 + variant * 19.4);
    if (tuftSeed > 0.84 && blend < 0.45) {
      color = lighten(color, (tuftSeed - 0.84) * 0.25);
    }
    return color;
  }

  _paintDirt(x, y, variant = 0) {
    const base = this._fbm(x + variant * 71.3, y - variant * 54.8, 31.5 + variant * 9.7, 4);
    let color = mixColors(this.palette.dirtShadow, this.palette.dirtBase, 0.45 + base * 0.4);

    const cellSize = 5;
    const cellSeed = this._hash2D(Math.floor((x + variant * 13.1) / cellSize), Math.floor((y - variant * 17.4) / cellSize), 201.4 + variant * 33.3);
    if (cellSeed > 0.82) {
      const lx = (x % cellSize) / cellSize - 0.5;
      const ly = (y % cellSize) / cellSize - 0.5;
      const dist = Math.sqrt(lx * lx + ly * ly);
      if (dist < 0.3) {
        const pebble = cellSeed > 0.9 ? lighten(color, 0.25) : darken(color, 0.25);
        color = mixColors(color, pebble, (0.3 - dist) * 2.4);
      }
    }
    return color;
  }

  _paintStone(x, y, variant = 0) {
    const base = this._fbm(x + variant * 52.6, y - variant * 44.2, 46.9 + variant * 15.3, 4);
    let color = mixColors(this.palette.stoneDark, this.palette.stoneLight, 0.5 + base * 0.35);

    const crack = Math.abs(Math.sin((x + y + variant * 9.1) * 0.085) + Math.sin((x - y - variant * 6.3) * 0.094));
    if (crack > 1.35) color = mixColors(color, this.palette.stoneDark, (crack - 1.35) * 0.55);
    return color;
  }

  _paintSand(x, y, variant = 0) {
    const base = this._fbm(x + variant * 91.1, y - variant * 87.3, 57.77 + variant * 21.4, 3);
    let color = mixColors(this.palette.sandBase, this.palette.sandDark, 0.45 + base * 0.3);
    const ripple = Math.sin((y / this.tileSize) * TAU * 1.1 + Math.sin((x / this.tileSize) * TAU * 0.9 + variant) * 0.6);
    color = mixColors(color, ripple > 0 ? lighten(color, ripple * 0.12) : darken(color, -ripple * 0.09), 0.6);
    return color;
  }

  _paintWoodBark(x, y, variant = 0) {
    const nx = (x + variant * 5.7) / this.tileSize;
    const stripes = Math.sin(nx * TAU * 3.1 + Math.sin(nx * TAU * 1.2 + variant) * 0.6);
    let color = stripes > 0 ? this.palette.barkLight : this.palette.barkDark;
    const noise = this._fbm(x + variant * 21.4, y - variant * 17.9, 64.5 + variant * 4.2, 3);
    color = mixColors(color, stripes > 0 ? lighten(color, noise * 0.18) : darken(color, noise * 0.16), 0.4);
    return color;
  }

  _paintWoodTop(x, y, variant = 0) {
    const cx = this.tileSize * 0.5;
    const cy = this.tileSize * 0.5;
    const dx = (x - cx) / this.tileSize;
    const dy = (y - cy) / this.tileSize;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ring = Math.sin(dist * TAU * (6 + variant) + this._hash2D(Math.floor(dist * 10), variant, 42.5));
    let color = mixColors(this.palette.ringDark, this.palette.ringLight, 0.5 + ring * 0.18);
    const noise = this._fbm(x + variant * 63.2, y - variant * 52.1, 77.9 + variant * 7.7, 3);
    color = mixColors(color, noise > 0.5 ? lighten(color, (noise - 0.5) * 0.3) : darken(color, (0.5 - noise) * 0.3), 0.4);
    return color;
  }

  _paintLeaves(x, y, density = 1, variant = 0) {
    const baseNoise = this._fbm(x + variant * 43.6, y - variant * 39.8, 82.4 * (0.8 + density * 0.4), 4);
    let color = mixColors(this.palette.leafDark, this.palette.leafLight, 0.45 + baseNoise * 0.4);

    const clusterSize = density > 0.9 ? 4 : 5;
    const cellX = Math.floor((x + variant * 3.2) / clusterSize);
    const cellY = Math.floor((y - variant * 4.3) / clusterSize);
    const clusterSeed = this._hash2D(cellX, cellY, 151.7 * density + variant * 17.1);

    if (clusterSeed > 0.82) {
      const lx = (x % clusterSize) / clusterSize - 0.5;
      const ly = (y % clusterSize) / clusterSize - 0.5;
      const dist = Math.sqrt(lx * lx + ly * ly);
      if (dist < 0.35) {
        const highlight = clusterSeed > 0.93 ? this.palette.leafVibrant : this.palette.leafLight;
        color = mixColors(color, highlight, (0.35 - dist) * 2.8 * density);
      }
    }

    if (density > 0.9) {
      const vineSeed = this._hash2D(cellX, cellY - 1, 201.9 + variant * 9.6);
      if (vineSeed > 0.925 && (x % clusterSize) / clusterSize < 0.4) {
        const vertical = (y % this.tileSize) / this.tileSize;
        color = mixColors(color, this.palette.vine, (1 - vertical) * 0.35);
      }
    }

    const edgeShade = this._smoothstep(0, 0.22, (Math.abs((x % this.tileSize) - this.tileSize / 2) + Math.abs((y % this.tileSize) - this.tileSize / 2)) / this.tileSize);
    color = mixColors(color, this.palette.leafDark, edgeShade * 0.18);
    return color;
  }

  _paintGoldOre(x, y, variant = 0) {
    let color = this._paintStone(x, y, variant);
    const cellSize = 7;
    const seed = this._hash2D(Math.floor((x + variant * 5.1) / cellSize), Math.floor((y - variant * 6.2) / cellSize), 205.4 + variant * 22.4);
    if (seed > 0.7) {
      const lx = (x % cellSize) / cellSize - 0.5;
      const ly = (y % cellSize) / cellSize - 0.5;
      const dist = Math.sqrt(lx * lx + ly * ly);
      if (dist < 0.38) {
        const mix = (0.38 - dist) * 2.2;
        color = mixColors(color, seed > 0.9 ? this.palette.goldBright : this.palette.goldMid, mix);
      }
    }
    return color;
  }

  _paintDiamondOre(x, y, variant = 0) {
    let color = this._paintStone(x, y, variant);
    const cellSize = 7;
    const seed = this._hash2D(Math.floor((x - variant * 4.9) / cellSize), Math.floor((y + variant * 5.6) / cellSize), 219.7 + variant * 19.5);
    if (seed > 0.72) {
      const lx = (x % cellSize) / cellSize - 0.5;
      const ly = (y % cellSize) / cellSize - 0.5;
      const dist = Math.sqrt(lx * lx + ly * ly);
      if (dist < 0.35) {
        const mix = (0.35 - dist) * 2.4;
        color = mixColors(color, seed > 0.92 ? this.palette.diamondBright : this.palette.diamondMid, mix);
      }
    }
    return color;
  }

  _paintWater(x, y, variant = 0) {
    const t = y / this.tileSize;
    let color = mixColors(this.palette.waterShallow, this.palette.waterDeep, this._smoothstep(0, 1, t));
    const wave = Math.sin((y / this.tileSize) * TAU * (1.2 + variant * 0.1) + Math.sin((x / this.tileSize) * TAU * (2 + variant * 0.15)) * 0.8);
    color = mixColors(color, wave > 0 ? lighten(color, wave * 0.15) : darken(color, -wave * 0.1), 0.4);
    return color;
  }

  _paintMud(x, y, variant = 0) {
    const noise = this._fbm(x + variant * 57.3, y - variant * 42.8, 132.4 + variant * 9.1, 3);
    let color = mixColors(this.palette.mudDark, this.palette.mudBase, 0.45 + noise * 0.4);
    if (noise > 0.6) color = mixColors(color, lighten(color, (noise - 0.6) * 0.4), 0.5);
    return color;
  }

  _paintGrassWithFlowers(x, y, variant = 0) {
    let color = this._paintGrassTop(x, y, variant);
    const cellSize = 10;
    const seed = this._hash2D(Math.floor((x + variant * 9.8) / cellSize), Math.floor((y - variant * 5.2) / cellSize), 311.9 + variant * 18.6);
    if (seed > 0.925) {
      const lx = (x % cellSize) / cellSize - 0.5;
      const ly = (y % cellSize) / cellSize - 0.5;
      const dist = Math.sqrt(lx * lx + ly * ly);
      if (dist < 0.25) {
        const colorChoice = seed > 0.97 ? [255, 239, 135] : [248, 248, 255];
        color = mixColors(color, colorChoice, (0.25 - dist) * 2.4);
      }
    }
    return color;
  }

  _paintPolishedStone(x, y, variant = 0) {
    let color = mixColors(this.palette.stoneBase, this.palette.stoneLight, 0.55 + this._fbm(x + variant * 43.1, y - variant * 32.4, 147.2, 3) * 0.2);
    const highlight = Math.sin((x + y + variant * 11.1) * 0.05 + this._hash2D(Math.floor(x / 8), Math.floor(y / 8), 321.1));
    if (highlight > 0.6) color = mixColors(color, lighten(color, 0.2), (highlight - 0.6) * 0.6);
    return color;
  }

  _paintStoneBrick(x, y, variant = 0) {
    const base = this._paintStone(x, y, variant);
    const size = this.tileSize;
    const rows = 3;
    const cols = 4;
    const mortar = 1.5;
    let color = base;
    const rowPos = y % (size / rows);
    const colPos = x % (size / cols);
    if (rowPos < mortar || colPos < mortar) {
      color = mixColors(color, this.palette.neutralLight, 0.6);
    }
    return color;
  }

  _paintSandstone(x, y, variant = 0) {
    const base = this._fbm(x + variant * 55.9, y - variant * 46.8, 163.9, 3);
    let color = mixColors(this.palette.sandBase, this.palette.sandDark, 0.4 + base * 0.3);
    const striation = Math.sin((x / this.tileSize) * TAU * 1.3 + this._hash2D(Math.floor(y / 6), variant, 23.4));
    if (striation > 0) color = mixColors(color, lighten(color, striation * 0.15), 0.4);
    else color = mixColors(color, darken(color, -striation * 0.12), 0.4);
    return color;
  }

  _paintNeutral(x, y, baseColor) {
    const noise = this._fbm(x, y, 179.1, 3);
    const delta = (noise - 0.5) * 0.12;
    if (delta > 0) return mixColors(baseColor, lighten(baseColor, delta * 1.2), Math.min(1, delta / 0.12));
    return mixColors(baseColor, darken(baseColor, -delta * 1.2), Math.min(1, -delta / 0.12));
  }

  _variantIndex(x, y, z, faceIndex, length) {
    const hash = this._hash3D(x, y, z, 97.3 + faceIndex * 37.1);
    return Math.floor(hash * length) % length;
  }

  _fbm(x, y, seed, octaves = 3) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
      total += amplitude * this._periodicNoise(x, y, seed + i * 12.97, frequency);
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return total / norm;
  }

  _periodicNoise(x, y, seed, frequency = 1) {
    const nx = (x / this.tileSize) * frequency;
    const ny = (y / this.tileSize) * frequency;
    const value = Math.sin((nx + seed) * TAU) + Math.cos((ny + seed * 1.73) * TAU);
    return value * 0.25 + 0.5;
  }

  _hash2D(x, y, seed = 0) {
    const s = Math.sin((x * 127.1 + y * 311.7 + seed * 0.171) * 43758.5453);
    return s - Math.floor(s);
  }

  _hash3D(x, y, z, seed = 0) {
    const s = Math.sin((x * 127.1 + y * 311.7 + z * 74.7 + seed * 0.137) * 43758.5453);
    return s - Math.floor(s);
  }

  _smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }
}
