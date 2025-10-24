import { BLOCK_TYPES } from '../../constants.js';

const TILE_SIZE = 32;
const ATLAS_COLUMNS = 4;
const ATLAS_ROWS = 3;

function clampChannel(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function rgba(r, g, b, a = 1) {
  return `rgba(${clampChannel(r)}, ${clampChannel(g)}, ${clampChannel(b)}, ${a})`;
}

export class BlockAtlas {
  constructor(scene) {
    this.tileSize = TILE_SIZE;
    this.columns = ATLAS_COLUMNS;
    this.rows = ATLAS_ROWS;
    this.width = this.columns * this.tileSize;
    this.height = this.rows * this.tileSize;
    this.texture = new BABYLON.DynamicTexture('block-atlas', { width: this.width, height: this.height }, scene, false, BABYLON.Texture.NEAREST_SAMPLINGMODE);
    this.texture.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);
    this.texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    this.texture.hasAlpha = false;
    this._ctx = this.texture.getContext();
    this._uvLookup = new Map();
    this._neutralTile = null;
    this._drawTiles();
    this.texture.update(false);
  }

  getBlockFaceUV(blockType, _faceIndex = 0) {
    const info = this._uvLookup.get(blockType) ?? this._uvLookup.get('default');
    const { uMin, vMin, uMax, vMax } = info;
    return [
      uMax, vMax,
      uMax, vMin,
      uMin, vMin,
      uMin, vMax,
    ];
  }

  getNeutralUV() {
    if (!this._neutralTile) {
      return [0.5, 0.5];
    }
    const { uMin, vMin, uMax, vMax } = this._neutralTile;
    return [(uMin + uMax) * 0.5, (vMin + vMax) * 0.5];
  }

  _registerTile(key, column, row) {
    const uMin = column / this.columns;
    const vMin = row / this.rows;
    const uMax = (column + 1) / this.columns;
    const vMax = (row + 1) / this.rows;
    this._uvLookup.set(key, { uMin, vMin, uMax, vMax });
  }

  _drawTiles() {
    const tiles = [
      { type: BLOCK_TYPES.grass, col: 0, row: 0, draw: (ctx, x, y, size) => this._drawGrass(ctx, x, y, size) },
      { type: BLOCK_TYPES.dirt, col: 1, row: 0, draw: (ctx, x, y, size) => this._drawNoiseTile(ctx, x, y, size, '#6d452f', '#8a5a3a') },
      { type: BLOCK_TYPES.stone, col: 2, row: 0, draw: (ctx, x, y, size) => this._drawNoiseTile(ctx, x, y, size, '#7f7f86', '#94949c') },
      { type: BLOCK_TYPES.sand, col: 3, row: 0, draw: (ctx, x, y, size) => this._drawSpeckle(ctx, x, y, size, '#cfc08f', '#d7c89b', '#b5a375') },
      { type: BLOCK_TYPES.wood, col: 0, row: 1, draw: (ctx, x, y, size) => this._drawWood(ctx, x, y, size) },
      { type: BLOCK_TYPES.leaves, col: 1, row: 1, draw: (ctx, x, y, size) => this._drawLeaf(ctx, x, y, size) },
      { type: BLOCK_TYPES.gold, col: 2, row: 1, draw: (ctx, x, y, size) => this._drawOre(ctx, x, y, size, '#f4d34c', '#f9e07c', '#a77e1a') },
      { type: BLOCK_TYPES.diamond, col: 3, row: 1, draw: (ctx, x, y, size) => this._drawOre(ctx, x, y, size, '#6ed3e8', '#9ce4f3', '#2e9ab3') },
      { type: BLOCK_TYPES.water, col: 0, row: 2, draw: (ctx, x, y, size) => this._drawWater(ctx, x, y, size) },
      { type: BLOCK_TYPES.flower, col: 1, row: 2, draw: (ctx, x, y, size) => this._drawNeutral(ctx, x, y, size, '#ffffff') },
    ];

    const neutralCol = 2;
    const neutralRow = 2;

    tiles.forEach(({ type, col, row, draw }) => {
      this._registerTile(type, col, row);
      draw(this._ctx, col * this.tileSize, row * this.tileSize, this.tileSize);
    });

    this._drawNeutral(this._ctx, neutralCol * this.tileSize, neutralRow * this.tileSize, this.tileSize, '#f0f0f0');
    this._registerTile('neutral', neutralCol, neutralRow);
    this._neutralTile = this._uvLookup.get('neutral');
    this._registerTile('default', neutralCol, neutralRow);
  }

  _drawGrass(ctx, x, y, size) {
    ctx.fillStyle = '#4b8f2d';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#5da939';
    for (let i = 0; i < size * 0.8; i += 1) {
      const px = x + Math.random() * size;
      const py = y + Math.random() * size;
      ctx.fillRect(px, py, 1, 1);
    }
  }

  _drawNoiseTile(ctx, x, y, size, baseColor, accentColor) {
    ctx.fillStyle = baseColor;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = accentColor;
    for (let i = 0; i < size * 0.6; i += 1) {
      const px = x + Math.random() * size;
      const py = y + Math.random() * size;
      ctx.globalAlpha = 0.4 + Math.random() * 0.4;
      ctx.fillRect(px, py, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  _drawSpeckle(ctx, x, y, size, base, mid, dark) {
    ctx.fillStyle = base;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = mid;
    for (let i = 0; i < size * 0.5; i += 1) {
      ctx.fillRect(x + Math.random() * size, y + Math.random() * size, 1, 1);
    }
    ctx.fillStyle = dark;
    for (let i = 0; i < size * 0.3; i += 1) {
      ctx.fillRect(x + Math.random() * size, y + Math.random() * size, 1, 1);
    }
  }

  _drawWood(ctx, x, y, size) {
    ctx.fillStyle = '#6d4c2f';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#8b6238';
    const ringCount = 5;
    const ringSpacing = size / ringCount;
    for (let i = 0; i < ringCount; i += 1) {
      ctx.fillRect(x + i * ringSpacing, y, 2, size);
    }
    ctx.strokeStyle = rgba(60, 37, 20, 0.45);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  }

  _drawLeaf(ctx, x, y, size) {
    ctx.fillStyle = '#3f8f3d';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = rgba(255, 255, 255, 0.16);
    for (let i = 0; i < size * 0.7; i += 1) {
      const px = x + Math.random() * size;
      const py = y + Math.random() * size;
      ctx.fillRect(px, py, 1, 1);
    }
    ctx.fillStyle = rgba(27, 61, 20, 0.35);
    for (let i = 0; i < size * 0.4; i += 1) {
      const px = x + Math.random() * size;
      const py = y + Math.random() * size;
      ctx.fillRect(px, py, 1, 1);
    }
  }

  _drawOre(ctx, x, y, size, baseHex, highlightHex, streakHex) {
    ctx.fillStyle = streakHex;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = baseHex;
    for (let i = 0; i < size * 0.5; i += 1) {
      const px = x + Math.random() * size;
      const py = y + Math.random() * size;
      ctx.fillRect(px, py, 2, 2);
    }
    ctx.fillStyle = highlightHex;
    for (let i = 0; i < size * 0.3; i += 1) {
      const px = x + Math.random() * size;
      const py = y + Math.random() * size;
      ctx.fillRect(px, py, 1, 1);
    }
  }

  _drawWater(ctx, x, y, size) {
    const gradient = ctx.createLinearGradient(x, y, x, y + size);
    gradient.addColorStop(0, '#3b6fd6');
    gradient.addColorStop(1, '#2f4fa8');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = rgba(255, 255, 255, 0.18);
    ctx.lineWidth = 1;
    for (let i = 0; i < size; i += 4) {
      ctx.beginPath();
      ctx.moveTo(x, y + i + Math.sin(i * 0.4) * 2);
      ctx.lineTo(x + size, y + i + Math.sin((i + 5) * 0.4) * 2);
      ctx.stroke();
    }
  }

  _drawNeutral(ctx, x, y, size, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, size, size);
  }
}
