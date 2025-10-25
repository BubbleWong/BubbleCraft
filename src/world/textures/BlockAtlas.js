import { BLOCK_TYPES } from '../../constants.js';

const TILE_SIZE = 48;
const ATLAS_COLUMNS = 5;
const ATLAS_ROWS = 4;
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
      [BLOCK_TYPES.grass, { top: 'grass_top', bottom: 'dirt', sides: 'grass_side' }],
      [BLOCK_TYPES.dirt, { all: 'dirt' }],
      [BLOCK_TYPES.stone, { all: 'stone' }],
      [BLOCK_TYPES.sand, { all: 'sand' }],
      [BLOCK_TYPES.wood, { top: 'wood_top', bottom: 'wood_top', sides: 'wood_bark' }],
      [BLOCK_TYPES.leaves, { all: 'leaves_dense' }],
      [BLOCK_TYPES.gold, { all: 'ore_gold' }],
      [BLOCK_TYPES.diamond, { all: 'ore_diamond' }],
      [BLOCK_TYPES.water, { all: 'water' }],
      [BLOCK_TYPES.flower, { all: 'flower_tile' }],
      ['default', { all: 'neutral_soft' }],
    ]);
  }

  getBlockFaceUV(blockType, faceIndex = 0) {
    const mapping = this._faceTiles.get(blockType) ?? this._faceTiles.get('default');
    let tileKey = mapping.all ?? 'neutral_soft';

    if (faceIndex === FACE_INDEX.POS_Y && mapping.top) tileKey = mapping.top;
    else if (faceIndex === FACE_INDEX.NEG_Y && mapping.bottom) tileKey = mapping.bottom;
    else if (mapping.sides && faceIndex !== FACE_INDEX.POS_Y && faceIndex !== FACE_INDEX.NEG_Y) tileKey = mapping.sides;

    const info = this._uvLookup.get(tileKey) ?? this._neutralTile;
    const { uMin, vMin, uMax, vMax } = info;
    return [
      uMax, vMax,
      uMax, vMin,
      uMin, vMin,
      uMin, vMax,
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
      grassShadow: hexToRgb('#346d35'),
      dirtBase: hexToRgb('#6f5034'),
      dirtShadow: hexToRgb('#3a2216'),
      stoneBase: hexToRgb('#868b91'),
      stoneLight: hexToRgb('#b6bcc3'),
      stoneDark: hexToRgb('#4a4f56'),
      sandBase: hexToRgb('#e2cf9c'),
      sandDark: hexToRgb('#b99866'),
      barkLight: hexToRgb('#885c32'),
      barkDark: hexToRgb('#5c3b1f'),
      ringLight: hexToRgb('#caa16a'),
      ringDark: hexToRgb('#966536'),
      leafBase: hexToRgb('#4da13f'),
      leafLight: hexToRgb('#81d061'),
      leafDark: hexToRgb('#2f6124'),
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

  _registerTile(key, column, row) {
    const uMin = column / this.columns;
    const vMin = row / this.rows;
    const uMax = (column + 1) / this.columns;
    const vMax = (row + 1) / this.rows;
    this._uvLookup.set(key, { uMin, vMin, uMax, vMax });
  }

  _drawTiles() {
    const defs = [
      ['grass_top', 0, 0, (x, y) => this._paintGrassTop(x, y)],
      ['grass_side', 1, 0, (x, y) => this._paintGrassSide(x, y)],
      ['dirt', 2, 0, (x, y) => this._paintDirt(x, y)],
      ['stone', 3, 0, (x, y) => this._paintStone(x, y)],
      ['sand', 4, 0, (x, y) => this._paintSand(x, y)],

      ['wood_bark', 0, 1, (x, y) => this._paintWoodBark(x, y)],
      ['wood_top', 1, 1, (x, y) => this._paintWoodTop(x, y)],
      ['leaves_dense', 2, 1, (x, y) => this._paintLeaves(x, y, 1.0)],
      ['leaves_soft', 3, 1, (x, y) => this._paintLeaves(x, y, 0.65)],
      ['neutral_soft', 4, 1, (x, y) => this._paintNeutral(x, y, this.palette.neutralSoft)],

      ['ore_gold', 0, 2, (x, y) => this._paintGoldOre(x, y)],
      ['ore_diamond', 1, 2, (x, y) => this._paintDiamondOre(x, y)],
      ['water', 2, 2, (x, y) => this._paintWater(x, y)],
      ['mud', 3, 2, (x, y) => this._paintMud(x, y)],
      ['flower_tile', 4, 2, (x, y) => this._paintGrassWithFlowers(x, y)],

      ['stone_polished', 0, 3, (x, y) => this._paintPolishedStone(x, y)],
      ['stone_brick', 1, 3, (x, y) => this._paintStoneBrick(x, y)],
      ['sandstone', 2, 3, (x, y) => this._paintSandstone(x, y)],
      ['neutral_dark', 3, 3, (x, y) => this._paintNeutral(x, y, this.palette.neutralDark)],
      ['neutral_light', 4, 3, (x, y) => this._paintNeutral(x, y, this.palette.neutralLight)],
    ];

    defs.forEach(([key, col, row, painter]) => {
      this._paintTile(key, col, row, painter);
    });

    this._neutralTile = this._uvLookup.get('neutral_soft');
  }

  _paintTile(key, col, row, painter) {
    const size = this.tileSize;
    const image = this._ctx.createImageData(size, size);
    const data = image.data;

    for (let py = 0; py < size; py += 1) {
      for (let px = 0; px < size; px += 1) {
        const color = painter(px, py);
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

  _paintGrassTop(x, y) {
    const base = this._fbm(x, y, 11.7, 4);
    let color = mixColors(this.palette.grassShadow, this.palette.grassHighlight, 0.5 + base * 0.35);

    const bladeNoise = this._hash2D(Math.floor(x / 3), Math.floor(y / 3), 41.6);
    if (bladeNoise > 0.8) {
      const offset = bladeNoise - 0.8;
      color = lighten(color, offset * 0.5);
    }

    const nx = (x % 8) / 8 - 0.5;
    const ny = (y % 8) / 8 - 0.5;
    const bloomSeed = this._hash2D(Math.floor(x / 8), Math.floor(y / 8), 97.3);
    const dist = Math.sqrt(nx * nx + ny * ny);
    if (bloomSeed > 0.97 && dist < 0.28) {
      const tint = bloomSeed > 0.985 ? [254, 224, 105] : [245, 248, 255];
      color = mixColors(color, tint, (0.28 - dist) * 1.8);
    }

    return color;
  }

  _paintGrassSide(x, y) {
    const size = this.tileSize;
    const blend = this._smoothstep(0.22, 0.78, y / size);
    const top = this._paintGrassTop(x, y * 0.6);
    const bottom = this._paintDirt(x, y);
    let color = mixColors(top, bottom, blend);

    const tuftSeed = this._hash2D(Math.floor(x / 6), Math.floor(y / 6), 133.7);
    if (tuftSeed > 0.85 && blend < 0.6) {
      const height = 0.18 + (tuftSeed - 0.85) * 0.35;
      color = lighten(color, height);
    }
    return color;
  }

  _paintDirt(x, y) {
    const base = this._fbm(x, y, 31.5, 4);
    let color = mixColors(this.palette.dirtShadow, this.palette.dirtBase, 0.45 + base * 0.4);

    const pebbleSeed = this._hash2D(Math.floor(x / 5), Math.floor(y / 5), 201.4);
    if (pebbleSeed > 0.82) {
      const lx = (x % 5) / 5 - 0.5;
      const ly = (y % 5) / 5 - 0.5;
      const dist = Math.sqrt(lx * lx + ly * ly);
      if (dist < 0.3) {
        const pebbleColor = pebbleSeed > 0.9 ? lighten(color, 0.25) : darken(color, 0.25);
        color = mixColors(color, pebbleColor, (0.3 - dist) * 2.4);
      }
    }
    return color;
  }

  _paintStone(x, y) {
    const base = this._fbm(x, y, 46.9, 4);
    let color = mixColors(this.palette.stoneDark, this.palette.stoneLight, 0.5 + base * 0.35);

    const crack = Math.abs(Math.sin((x + y) * 0.08) + Math.sin((x - y) * 0.094));
    if (crack > 1.4) {
      color = mixColors(color, this.palette.stoneDark, (crack - 1.4) * 0.6);
    }

    return color;
  }

  _paintSand(x, y) {
    const base = this._fbm(x, y, 57.77, 3);
    let color = mixColors(this.palette.sandBase, this.palette.sandDark, 0.45 + base * 0.3);

    const ripple = Math.sin((y / this.tileSize) * TAU * 1.1 + Math.sin((x / this.tileSize) * TAU * 0.9) * 0.6);
    color = mixColors(color, ripple > 0 ? lighten(color, ripple * 0.12) : darken(color, -ripple * 0.1), 0.6);
    return color;
  }

  _paintWoodBark(x, y) {
    const nx = x / this.tileSize;
    const stripes = Math.sin(nx * TAU * 3 + Math.sin(nx * TAU * 1.2) * 0.6);
    let color = stripes > 0 ? this.palette.barkLight : this.palette.barkDark;
    const noise = this._fbm(x, y, 64.5, 3);
    color = mixColors(color, stripes > 0 ? lighten(color, noise * 0.2) : darken(color, noise * 0.18), 0.4);
    return color;
  }

  _paintWoodTop(x, y) {
    const cx = this.tileSize * 0.5;
    const cy = this.tileSize * 0.5;
    const dx = (x - cx) / this.tileSize;
    const dy = (y - cy) / this.tileSize;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const ring = Math.sin(dist * TAU * 6 + this._hash2D(Math.floor(dist * 10), 0, 42.5));
    let color = mixColors(this.palette.ringDark, this.palette.ringLight, 0.5 + ring * 0.2);
    const noise = this._fbm(x, y, 77.9, 3);
    color = mixColors(color, noise > 0.5 ? lighten(color, (noise - 0.5) * 0.3) : darken(color, (0.5 - noise) * 0.3), 0.4);
    return color;
  }

  _paintLeaves(x, y, density) {
    const noise = this._fbm(x, y, 82.4 * density, 4);
    let color = mixColors(this.palette.leafDark, this.palette.leafLight, 0.45 + noise * 0.4);

    const cellSize = 6;
    const cellSeed = this._hash2D(Math.floor(x / cellSize), Math.floor(y / cellSize), 133.5 * density);
    if (cellSeed > 0.88) {
      const lx = (x % cellSize) / cellSize - 0.5;
      const ly = (y % cellSize) / cellSize - 0.5;
      const dist = Math.sqrt(lx * lx + ly * ly);
      if (dist < 0.28) {
        const tint = cellSeed > 0.95 ? lighten(color, 0.22) : darken(color, 0.15);
        color = mixColors(color, tint, (0.28 - dist) * 2.4 * density);
      }
    }

    if (density > 0.9 && this._hash2D(Math.floor(x / 8), Math.floor(y / 8), 77.2) > 0.92) {
      color = mixColors(color, lighten(color, 0.18), 0.4);
    }

    return color;
  }

  _paintGoldOre(x, y) {
    let color = this._paintStone(x, y);
    const cellSize = 7;
    const seed = this._hash2D(Math.floor(x / cellSize), Math.floor(y / cellSize), 205.4);
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

  _paintDiamondOre(x, y) {
    let color = this._paintStone(x, y);
    const cellSize = 7;
    const seed = this._hash2D(Math.floor(x / cellSize), Math.floor(y / cellSize), 219.7);
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

  _paintWater(x, y) {
    const t = y / this.tileSize;
    let color = mixColors(this.palette.waterShallow, this.palette.waterDeep, this._smoothstep(0, 1, t));
    const wave = Math.sin((y / this.tileSize) * TAU * 1.4 + Math.sin((x / this.tileSize) * TAU * 2.1) * 0.8);
    color = mixColors(color, wave > 0 ? lighten(color, wave * 0.15) : darken(color, -wave * 0.1), 0.4);
    return color;
  }

  _paintMud(x, y) {
    const noise = this._fbm(x, y, 132.4, 3);
    let color = mixColors(this.palette.mudDark, this.palette.mudBase, 0.45 + noise * 0.4);
    if (noise > 0.6) color = mixColors(color, lighten(color, (noise - 0.6) * 0.4), 0.5);
    return color;
  }

  _paintGrassWithFlowers(x, y) {
    let color = this._paintGrassTop(x, y);
    const cellSize = 10;
    const seed = this._hash2D(Math.floor(x / cellSize), Math.floor(y / cellSize), 311.9);
    if (seed > 0.925) {
      const lx = (x % cellSize) / cellSize - 0.5;
      const ly = (y % cellSize) / cellSize - 0.5;
      const dist = Math.sqrt(lx * lx + ly * ly);
      if (dist < 0.25) {
        const colorChoice = seed > 0.97 ? [255, 239, 135] : [248, 248, 255];
        color = mixColors(color, colorChoice, (0.25 - dist) * 2.6);
      }
    }
    return color;
  }

  _paintPolishedStone(x, y) {
    let color = mixColors(this.palette.stoneBase, this.palette.stoneLight, 0.55 + this._fbm(x, y, 147.2, 3) * 0.2);
    const highlight = Math.sin((x + y) * 0.05 + this._hash2D(Math.floor(x / 8), Math.floor(y / 8), 321.1));
    if (highlight > 0.6) color = mixColors(color, lighten(color, 0.2), (highlight - 0.6) * 0.6);
    return color;
  }

  _paintStoneBrick(x, y) {
    const base = this._paintStone(x, y);
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

  _paintSandstone(x, y) {
    const base = this._fbm(x, y, 163.9, 3);
    let color = mixColors(this.palette.sandBase, this.palette.sandDark, 0.4 + base * 0.3);
    const striation = Math.sin((x / this.tileSize) * TAU * 1.3 + this._hash2D(Math.floor(y / 6), 0, 23.4));
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

  _smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }
}
