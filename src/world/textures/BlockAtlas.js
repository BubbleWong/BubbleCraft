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
      grassBase: hexToRgb('#4ea948'),
      grassHighlight: hexToRgb('#63c15b'),
      grassShadow: hexToRgb('#2f6d2f'),
      dirtBase: hexToRgb('#6f5034'),
      dirtShadow: hexToRgb('#3d2516'),
      stoneBase: hexToRgb('#7f8288'),
      stoneLight: hexToRgb('#a9acb3'),
      stoneDark: hexToRgb('#4b4f56'),
      sandBase: hexToRgb('#decda1'),
      sandDark: hexToRgb('#b79b71'),
      woodBarkLight: hexToRgb('#8b5f33'),
      woodBarkDark: hexToRgb('#65401f'),
      woodRingLight: hexToRgb('#caa46d'),
      woodRingDark: hexToRgb('#99683a'),
      leafBase: hexToRgb('#4d9a3f'),
      leafLight: hexToRgb('#7ac857'),
      leafDark: hexToRgb('#2e6124'),
      goldOre: hexToRgb('#ecd472'),
      goldBright: hexToRgb('#f9ebb7'),
      goldBaseStone: hexToRgb('#6c5f45'),
      diamondOre: hexToRgb('#71d6f2'),
      diamondBright: hexToRgb('#c2f0fe'),
      diamondBaseStone: hexToRgb('#516472'),
      waterDeep: hexToRgb('#1c3f85'),
      waterShallow: hexToRgb('#2f6fce'),
      mudBase: hexToRgb('#4b322a'),
      mudDark: hexToRgb('#34231d'),
      neutralSoft: hexToRgb('#bfc3c8'),
      neutralDark: hexToRgb('#8a8f94'),
      neutralLight: hexToRgb('#dddddd'),
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
    const definitions = [
      ['grass_top', 0, 0, (x, y) => this._paintGrassTop(x, y)],
      ['grass_side', 1, 0, (x, y) => this._paintGrassSide(x, y)],
      ['dirt', 2, 0, (x, y) => this._paintDirt(x, y)],
      ['stone', 3, 0, (x, y) => this._paintStone(x, y)],
      ['sand', 4, 0, (x, y) => this._paintSand(x, y)],

      ['wood_bark', 0, 1, (x, y) => this._paintWoodBark(x, y)],
      ['wood_top', 1, 1, (x, y) => this._paintWoodTop(x, y)],
      ['leaves_dense', 2, 1, (x, y) => this._paintLeaves(x, y, true)],
      ['leaves_soft', 3, 1, (x, y) => this._paintLeaves(x, y, false)],
      ['neutral_soft', 4, 1, (x, y) => this._paintNeutral(x, y, this.palette.neutralSoft)],

      ['ore_gold', 0, 2, (x, y) => this._paintGoldOre(x, y)],
      ['ore_diamond', 1, 2, (x, y) => this._paintDiamondOre(x, y)],
      ['water', 2, 2, (x, y) => this._paintWater(x, y)],
      ['mud', 3, 2, (x, y) => this._paintMud(x, y)],
      ['flower_tile', 4, 2, (x, y) => this._paintFlowerTile(x, y)],

      ['stone_polished', 0, 3, (x, y) => this._paintPolishedStone(x, y)],
      ['stone_brick', 1, 3, (x, y) => this._paintStoneBrick(x, y)],
      ['sandstone', 2, 3, (x, y) => this._paintSandstone(x, y)],
      ['neutral_dark', 3, 3, (x, y) => this._paintNeutral(x, y, this.palette.neutralDark)],
      ['neutral_light', 4, 3, (x, y) => this._paintNeutral(x, y, this.palette.neutralLight)],
    ];

    definitions.forEach(([key, col, row, painter]) => {
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
    const base = this._fbm(x, y, 12.31, 4);
    let color = mixColors(this.palette.grassShadow, this.palette.grassHighlight, 0.35 + base * 0.5);

    const directional = Math.sin(x * 0.18 + Math.sin(y * 0.12) * 0.7);
    color = mixColors(color, directional > 0 ? this.palette.grassHighlight : this.palette.grassShadow, Math.min(0.18, Math.abs(directional) * 0.18));

    const cellSize = 8;
    const localX = (x % cellSize) / cellSize - 0.5;
    const localY = (y % cellSize) / cellSize - 0.5;
    const cellSeed = this._hash2D(Math.floor(x / cellSize), Math.floor(y / cellSize), 93.17);
    if (cellSeed > 0.985) {
      const dist = Math.sqrt(localX * localX + localY * localY);
      if (dist < 0.28) {
        const hueChoice = this._hash2D(Math.floor(x / cellSize), Math.floor(y / cellSize), 211.5);
        const petal = hueChoice > 0.66 ? lighten(this.palette.grassHighlight, 0.6) : lighten([255, 220, 180], 0.2);
        color = mixColors(color, petal, Math.max(0, 0.28 - dist) * 2.4);
      }
    }

    return color;
  }

  _paintGrassSide(x, y) {
    const size = this.tileSize;
    const blend = this._smoothstep(0.18, 0.72, y / size);
    const top = this._paintGrassTop(x, y * 0.6);
    const bottom = this._paintDirt(x, y);
    let color = mixColors(top, bottom, blend);

    const highlight = Math.sin((x * 0.22) + this._hash2D(0, Math.floor(y / 6), 41.2)) * 0.1;
    if (highlight > 0) color = mixColors(color, this.palette.grassHighlight, highlight * 0.6);
    return color;
  }

  _paintDirt(x, y) {
    const base = this._fbm(x, y, 33.71, 4);
    let color = mixColors(this.palette.dirtShadow, this.palette.dirtBase, 0.4 + base * 0.5);

    const cellSize = 6;
    const localX = (x % cellSize) / cellSize - 0.5;
    const localY = (y % cellSize) / cellSize - 0.5;
    const cellSeed = this._hash2D(Math.floor(x / cellSize), Math.floor(y / cellSize), 58.9);
    if (cellSeed > 0.78) {
      const dist = Math.sqrt(localX * localX + localY * localY);
      if (dist < 0.32) {
        const pebbleTone = this._hash2D(Math.floor(x / cellSize), Math.floor(y / cellSize), 91.4);
        const target = pebbleTone > 0.5 ? lighten(color, 0.25) : darken(color, 0.2);
        color = mixColors(color, target, (0.32 - dist) * 2.4);
      }
    }

    return color;
  }

  _paintStone(x, y) {
    const base = this._fbm(x, y, 45.2, 4);
    let color = mixColors(this.palette.stoneDark, this.palette.stoneLight, 0.45 + base * 0.35);

    const crack = Math.abs(Math.sin((x + y) * 0.09 + Math.sin(x * 0.04)) + Math.sin((x - y) * 0.07)) * 0.5;
    if (crack > 0.6) {
      color = mixColors(color, this.palette.stoneDark, Math.min(0.6, (crack - 0.6) * 1.4));
    }

    const highlight = this._hash2D(Math.floor(x / 7), Math.floor(y / 7), 201.4);
    if (highlight > 0.85) {
      color = mixColors(color, this.palette.stoneLight, 0.12);
    }

    return color;
  }

  _paintSand(x, y) {
    const base = this._fbm(x, y, 57.77, 3);
    let color = mixColors(this.palette.sandBase, this.palette.sandDark, 0.45 + base * 0.25);

    const dunes = Math.sin((y / this.tileSize) * TAU * 1.2 + Math.sin((x / this.tileSize) * TAU * 0.8) * 0.6);
    color = mixColors(color, dunes > 0 ? lighten(color, dunes * 0.12) : darken(color, -dunes * 0.08), 0.5);

    return color;
  }

  _paintWoodBark(x, y) {
    const nx = x / this.tileSize;
    const stripes = Math.sin(nx * TAU * 3.2 + Math.sin(nx * TAU * 1.1) * 0.5);
    let color = stripes > 0 ? this.palette.woodBarkLight : this.palette.woodBarkDark;
    const noise = this._fbm(x, y, 61.3, 3);
    color = mixColors(color, stripes > 0 ? lighten(color, noise * 0.15) : darken(color, noise * 0.1), 0.5);
    return color;
  }

  _paintWoodTop(x, y) {
    const cx = this.tileSize * 0.5;
    const cy = this.tileSize * 0.5;
    const dx = (x - cx) / this.tileSize;
    const dy = (y - cy) / this.tileSize;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const rings = Math.sin(dist * TAU * 6 + this._hash2D(Math.floor(dist * 10), 0, 32.8));
    let color = mixColors(this.palette.woodRingLight, this.palette.woodRingDark, 0.5 + rings * 0.1);
    const noise = this._fbm(x, y, 77.9, 3);
    color = mixColors(color, noise > 0.5 ? lighten(color, (noise - 0.5) * 0.3) : darken(color, (0.5 - noise) * 0.3), 0.4);
    return color;
  }

  _paintLeaves(x, y, dense) {
    const baseNoise = this._fbm(x, y, dense ? 82.4 : 84.9, 4);
    let color = mixColors(this.palette.leafDark, this.palette.leafLight, 0.45 + baseNoise * 0.4);

    const cellSize = dense ? 5 : 6;
    const cellSeed = this._hash2D(Math.floor(x / cellSize), Math.floor(y / cellSize), dense ? 121.7 : 126.3);
    if (cellSeed > 0.88) {
      const lx = (x % cellSize) / cellSize - 0.5;
      const ly = (y % cellSize) / cellSize - 0.5;
      const dist = Math.sqrt(lx * lx + ly * ly);
      if (dist < 0.3) {
        const varColor = cellSeed > 0.92 ? lighten(color, 0.25) : darken(color, 0.25);
        color = mixColors(color, varColor, (0.3 - dist) * 2.1);
      }
    }

    return color;
  }

  _paintGoldOre(x, y) {
    let color = this._paintStone(x, y);
    const cellSize = 7;
    const cellSeed = this._hash2D(Math.floor(x / cellSize), Math.floor(y / cellSize), 205.4);
    if (cellSeed > 0.7) {
      const lx = (x % cellSize) / cellSize - 0.5;
      const ly = (y % cellSize) / cellSize - 0.5;
      const dist = Math.sqrt(lx * lx + ly * ly);
      if (dist < 0.38) {
        const oreMix = Math.max(0, 0.38 - dist) * 1.8;
        color = mixColors(color, cellSeed > 0.9 ? this.palette.goldBright : this.palette.goldOre, oreMix);
      }
    }
    return color;
  }

  _paintDiamondOre(x, y) {
    let color = this._paintStone(x, y);
    const cellSize = 7;
    const cellSeed = this._hash2D(Math.floor(x / cellSize), Math.floor(y / cellSize), 221.6);
    if (cellSeed > 0.73) {
      const lx = (x % cellSize) / cellSize - 0.5;
      const ly = (y % cellSize) / cellSize - 0.5;
      const dist = Math.sqrt(lx * lx + ly * ly);
      if (dist < 0.35) {
        const oreMix = Math.max(0, 0.35 - dist) * 2.0;
        color = mixColors(color, cellSeed > 0.92 ? this.palette.diamondBright : this.palette.diamondOre, oreMix);
      }
    }
    return color;
  }

  _paintWater(x, y) {
    const t = y / this.tileSize;
    let color = mixColors(this.palette.waterShallow, this.palette.waterDeep, this._smoothstep(0, 1, t));
    const wave = Math.sin((y / this.tileSize) * TAU * 1.4 + Math.sin((x / this.tileSize) * TAU * 2.1) * 0.8);
    color = mixColors(color, wave > 0 ? lighten(color, wave * 0.18) : darken(color, -wave * 0.12), 0.5);
    return color;
  }

  _paintMud(x, y) {
    const noise = this._fbm(x, y, 132.4, 3);
    let color = mixColors(this.palette.mudDark, this.palette.mudBase, 0.4 + noise * 0.4);
    if (noise > 0.6) color = mixColors(color, lighten(color, (noise - 0.6) * 0.4), 0.5);
    return color;
  }

  _paintFlowerTile(x, y) {
    let color = this._paintGrassTop(x, y);
    const sway = Math.sin((x / this.tileSize) * TAU * 1.8 + (y / this.tileSize) * TAU * 1.6);
    if (sway > 0.75) {
      color = mixColors(color, lighten(color, 0.25), (sway - 0.75) * 1.2);
    }
    return color;
  }

  _paintPolishedStone(x, y) {
    let color = mixColors(this.palette.stoneBase, this.palette.stoneLight, 0.5 + this._fbm(x, y, 147.2, 3) * 0.2);
    const highlight = Math.sin((x + y) * 0.05 + this._hash2D(Math.floor(x / 8), Math.floor(y / 8), 321.1));
    if (highlight > 0.6) color = mixColors(color, lighten(color, 0.2), (highlight - 0.6) * 0.6);
    return color;
  }

  _paintStoneBrick(x, y) {
    const base = this._paintStone(x, y);
    const size = this.tileSize;
    const rows = 3;
    const cols = 4;
    const horizontal = y % (size / rows);
    const vertical = x % (size / cols);
    const mortar = 1.5;
    let color = base;
    if (horizontal < mortar || vertical < mortar) {
      color = mixColors(color, this.palette.neutralLight, 0.55);
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
    const delta = (noise - 0.5) * 0.1;
    if (delta > 0) return mixColors(baseColor, lighten(baseColor, delta * 1.4), Math.min(1, delta / 0.1));
    return mixColors(baseColor, darken(baseColor, -delta * 1.4), Math.min(1, -delta / 0.1));
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
