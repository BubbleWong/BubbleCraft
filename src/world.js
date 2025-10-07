import * as THREE from './vendor/three.module.js';
import { ImprovedNoise } from './vendor/ImprovedNoise.js';
import {
  CHUNK_SIZE,
  CHUNK_HEIGHT,
  BLOCK_TYPES,
  BLOCK_TYPE_LABELS,
  BLOCK_COLORS,
  FLOWER_PETAL_COLORS,
  FLOWER_CENTER_COLOR,
  FLOWER_STEM_COLOR,
} from './constants.js';

const MAX_BLOCK_TYPE = Math.max(...Object.values(BLOCK_TYPES));

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const isTransparentBlock = (blockType) =>
  blockType === BLOCK_TYPES.flowerRed || blockType === BLOCK_TYPES.flowerYellow;

const FACE_DEFS = [
  { dir: [1, 0, 0], shade: 0.8, corners: [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]] }, // +X
  { dir: [-1, 0, 0], shade: 0.8, corners: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]] }, // -X
  { dir: [0, 1, 0], shade: 1.0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] }, // +Y
  { dir: [0, -1, 0], shade: 0.6, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] }, // -Y
  { dir: [0, 0, 1], shade: 0.9, corners: [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]] }, // +Z
  { dir: [0, 0, -1], shade: 0.7, corners: [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]] }, // -Z
];

const TRIANGLE_ORDER = [0, 1, 2, 0, 2, 3];
const mix = (a, b, t) => a * (1 - t) + b * t;

const TOP_FACE_INDEX = 2;
const BOTTOM_FACE_INDEX = 3;

const FACE_AXES = FACE_DEFS.map((face) => {
  const origin = face.corners[0];
  const uAxis = [
    face.corners[3][0] - origin[0],
    face.corners[3][1] - origin[1],
    face.corners[3][2] - origin[2],
  ];
  const vAxis = [
    face.corners[1][0] - origin[0],
    face.corners[1][1] - origin[1],
    face.corners[1][2] - origin[2],
  ];
  return { origin, uAxis, vAxis };
});

function mixColor(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

function computeFaceUV(faceIndex, corner) {
  switch (faceIndex) {
    case 0: // +X
      return { u: 1 - corner[2], v: corner[1] };
    case 1: // -X
      return { u: corner[2], v: corner[1] };
    case TOP_FACE_INDEX: // +Y
      return { u: corner[0], v: corner[2] };
    case BOTTOM_FACE_INDEX: // -Y
      return { u: corner[0], v: 1 - corner[2] };
    case 4: // +Z
      return { u: corner[0], v: corner[1] };
    case 5: // -Z
      return { u: 1 - corner[0], v: corner[1] };
    default:
      return { u: corner[0], v: corner[1] };
  }
}

function getFaceResolution(blockType, faceIndex) {
  if (blockType === BLOCK_TYPES.grass && faceIndex === TOP_FACE_INDEX) return 12;
  if (blockType === BLOCK_TYPES.wood && (faceIndex === TOP_FACE_INDEX || faceIndex === BOTTOM_FACE_INDEX)) return 10;
  if (blockType === BLOCK_TYPES.leaves) return 6;
  if (blockType === BLOCK_TYPES.gold || blockType === BLOCK_TYPES.diamond) return 10;
  if (blockType === BLOCK_TYPES.sand) return 10;
  return 8;
}

function interpolateCorner(origin, uAxis, vAxis, u, v) {
  return [
    origin[0] + uAxis[0] * u + vAxis[0] * v,
    origin[1] + uAxis[1] * u + vAxis[1] * v,
    origin[2] + uAxis[2] * u + vAxis[2] * v,
  ];
}

function applyTextureDetail(blockType, baseColor, faceIndex, corner, world, worldX, worldY, worldZ) {
  const { u, v } = computeFaceUV(faceIndex, corner);
  const pixelU = Math.max(0, Math.min(15, Math.floor(u * 16)));
  const pixelV = Math.max(0, Math.min(15, Math.floor(v * 16)));
  const worldCornerX = worldX + corner[0];
  const worldCornerY = worldY + corner[1];
  const worldCornerZ = worldZ + corner[2];
  const isSideFace = faceIndex === 0 || faceIndex === 1 || faceIndex === 4 || faceIndex === 5;

  const pixelNoise = (salt = 0) => world.pseudoRandom(
    Math.floor(worldCornerX) * 101 + pixelU * 13 + salt * 17,
    Math.floor(worldCornerY) * 131 + pixelV * 11 + salt * 19,
    Math.floor(worldCornerZ) * 151 + faceIndex * 7 + salt * 23,
    salt + blockType * 31,
  );

  let color = [...baseColor];

  switch (blockType) {
    case BLOCK_TYPES.grass: {
      const topShadow = [0.23, 0.47, 0.18];
      const topMid = [0.35, 0.68, 0.26];
      const topHighlight = [0.59, 0.88, 0.4];
      if (faceIndex === TOP_FACE_INDEX) {
        const tuft = pixelNoise(10);
        const blade = pixelNoise(11);
        const weave = ((pixelU + pixelV) % 2) * 0.08;
        const radial = Math.sin((pixelU - 7.5) * 0.6 + (pixelV - 7.5) * 0.6) * 0.1;
        let blend = clamp01(0.25 + tuft * 0.55 + radial + weave);
        let grass = mixColor(topShadow, topHighlight, blend);
        if (blade > 0.78) grass = mixColor(grass, topHighlight, 0.5);
        if (blade < 0.14) grass = mixColor(grass, topShadow, 0.6);
        grass[0] = clamp01(grass[0] + (pixelNoise(12) - 0.5) * 0.05);
        grass[1] = clamp01(grass[1] + (pixelNoise(13) - 0.5) * 0.07);
        return grass;
      }
      const dirtShadow = [0.28, 0.19, 0.11];
      const dirtHighlight = [0.66, 0.48, 0.28];
      if (faceIndex === BOTTOM_FACE_INDEX) {
        const soilBlend = clamp01(0.4 + pixelNoise(18) * 0.6);
        return mixColor(dirtShadow, dirtHighlight, soilBlend);
      }
      if (isSideFace) {
        const grassLine = 12 + Math.floor((pixelNoise(20) - 0.5) * 2);
        if (pixelV >= grassLine) {
          const fringe = pixelNoise(21);
          const edge = pixelNoise(pixelU + 37);
          let sideGrass = mixColor(topMid, topHighlight, clamp01(0.35 + fringe * 0.6));
          sideGrass[1] = clamp01(sideGrass[1] + (edge - 0.5) * 0.12);
          return sideGrass;
        }
        const stratum = Math.floor(pixelV / 3);
        let soil = mixColor(dirtShadow, dirtHighlight, clamp01(0.25 + pixelNoise(24 + stratum) * 0.7));
        if (pixelNoise(28) > 0.86) soil = mixColor(soil, dirtShadow, 0.65);
        if (pixelNoise(29) < 0.08) soil = mixColor(soil, [0.54, 0.39, 0.23], 0.5);
        soil = soil.map((c, idx) => clamp01(c + (pixelNoise(30 + idx) - 0.5) * 0.04));
        return soil;
      }
      return baseColor;
    }
    case BLOCK_TYPES.dirt: {
      const soilDark = [0.28, 0.18, 0.09];
      const soilMid = [0.48, 0.33, 0.18];
      const soilLight = [0.68, 0.51, 0.32];
      const strata = Math.sin(pixelV * 0.45 + worldCornerY * 0.3);
      let soil = mixColor(soilDark, soilLight, clamp01(0.35 + pixelNoise(40) * 0.65 + strata * 0.1));
      if (pixelNoise(41) > 0.82) soil = mixColor(soil, soilLight, 0.4);
      if (pixelNoise(42) < 0.12) soil = mixColor(soil, soilDark, 0.6);
      const pebble = pixelNoise(43);
      if (pebble > 0.9) soil = mixColor(soil, [0.75, 0.58, 0.38], 0.45);
      soil[1] = clamp01(soil[1] + (pixelNoise(44) - 0.5) * 0.05);
      soil[0] = clamp01(soil[0] + (pixelNoise(45) - 0.5) * 0.03);
      return soil;
    }
    case BLOCK_TYPES.stone: {
      const stoneDeep = [0.28, 0.29, 0.33];
      const stoneMid = [0.52, 0.55, 0.6];
      const stoneLight = [0.78, 0.8, 0.86];
      const grain = pixelNoise(60);
      let stone = mixColor(stoneDeep, stoneMid, clamp01(0.25 + grain * 0.6));
      const fleck = pixelNoise(61);
      if (fleck > 0.82) stone = mixColor(stone, stoneLight, 0.55);
      if (fleck < 0.16) stone = mixColor(stone, stoneDeep, 0.7);
      if ((pixelU % 4 === 0 || pixelV % 5 === 0) && pixelNoise(62) > 0.65) {
        stone = mixColor(stone, stoneDeep, 0.6);
      }
      stone = stone.map((c) => clamp01(c + (pixelNoise(63) - 0.5) * 0.05));
      return stone;
    }
    case BLOCK_TYPES.sand: {
      const sandShadow = [0.82, 0.74, 0.53];
      const sandMid = [0.93, 0.87, 0.64];
      const sandLight = [0.99, 0.95, 0.78];
      const ripple = Math.sin((worldCornerX + worldCornerZ) * 5.1 + pixelV * 0.7);
      let sand = mixColor(sandShadow, sandMid, clamp01(0.3 + pixelNoise(80) * 0.5 + ripple * 0.08));
      if (pixelNoise(81) > 0.88) sand = mixColor(sand, sandLight, 0.5);
      if (pixelNoise(82) < 0.08) sand = mixColor(sand, sandShadow, 0.45);
      sand = sand.map((c, idx) => clamp01(c + (pixelNoise(83 + idx) - 0.5) * (idx === 1 ? 0.05 : 0.035)));
      return sand;
    }
    case BLOCK_TYPES.wood: {
      const barkDark = [0.3, 0.18, 0.08];
      const barkLight = [0.65, 0.45, 0.23];
      const heartwood = [0.7, 0.53, 0.3];
      if (faceIndex === TOP_FACE_INDEX || faceIndex === BOTTOM_FACE_INDEX) {
        const dx = corner[0] - 0.5;
        const dz = corner[2] - 0.5;
        const radius = Math.sqrt(dx * dx + dz * dz);
        const ring = Math.sin(radius * 24 + worldX * 0.35 + worldZ * 0.35);
        let wood = mixColor(heartwood, barkLight, clamp01(0.45 + ring * 0.45));
        const core = Math.exp(-radius * 6.5);
        wood = wood.map((c, idx) => clamp01(c + core * (idx === 1 ? 0.08 : 0.03)));
        if (pixelNoise(100) > 0.84) wood = mixColor(wood, barkDark, 0.5);
        return wood;
      }
      const verticalBand = pixelU % 6;
      let wood = verticalBand <= 1 || verticalBand >= 5 ? barkDark.slice() : barkLight.slice();
      const grain = Math.sin((worldCornerY + worldCornerZ) * 7 + pixelU * 0.8 + pixelNoise(101) * 2);
      wood = wood.map((c, idx) => clamp01(c + grain * (idx === 1 ? 0.06 : 0.03)));
      const knot = pixelNoise(102);
      if (knot > 0.87) wood = mixColor(wood, [0.24, 0.14, 0.07], 0.7);
      if (knot < 0.12) wood = mixColor(wood, barkLight, 0.35);
      return wood;
    }
    case BLOCK_TYPES.leaves: {
      const leafShadow = [0.1, 0.28, 0.08];
      const leafMid = [0.32, 0.58, 0.18];
      const leafHighlight = [0.62, 0.9, 0.34];
      let leaf = mixColor(leafShadow, leafHighlight, clamp01(0.2 + pixelNoise(120) * 0.65));
      if (pixelNoise(121) > 0.85) leaf = mixColor(leaf, leafHighlight, 0.5);
      if (pixelNoise(122) < 0.1) leaf = mixColor(leaf, leafShadow, 0.6);
      const dapple = Math.max(0, Math.sin((worldCornerX + worldCornerZ) * 1.2 + pixelNoise(123) * Math.PI));
      leaf[1] = clamp01(leaf[1] + dapple * 0.1);
      leaf[0] = clamp01(leaf[0] + dapple * 0.04);
      return leaf;
    }
    case BLOCK_TYPES.gold: {
      const stoneBase = applyTextureDetail(BLOCK_TYPES.stone, BLOCK_COLORS[BLOCK_TYPES.stone], faceIndex, corner, world, worldX, worldY, worldZ);
      const goldOre = [0.96, 0.82, 0.34];
      const goldHighlight = [1, 0.95, 0.6];
      const cluster = pixelNoise(140);
      const mask = pixelNoise(141);
      if (cluster > 0.55 + Math.sin((pixelU + pixelV) * 0.3) * 0.1) {
        const intensity = clamp01((cluster - 0.45) + (mask - 0.4) * 0.6);
        let ore = mixColor(goldOre, goldHighlight, clamp01(0.2 + intensity));
        if (pixelNoise(142) > 0.82) ore = mixColor(ore, goldHighlight, 0.6);
        return mixColor(stoneBase, ore, clamp01(0.55 + intensity * 0.5));
      }
      return stoneBase.map((c, idx) => clamp01(c * (idx === 1 ? 1 : 0.96)));
    }
    case BLOCK_TYPES.diamond: {
      const stoneBase = applyTextureDetail(BLOCK_TYPES.stone, BLOCK_COLORS[BLOCK_TYPES.stone], faceIndex, corner, world, worldX, worldY, worldZ);
      const diamondOre = [0.55, 0.82, 0.9];
      const diamondHighlight = [0.85, 0.97, 1];
      const cluster = pixelNoise(160);
      const mask = pixelNoise(161);
      if (cluster > 0.58 + Math.cos((pixelU - pixelV) * 0.35) * 0.08) {
        const intensity = clamp01((cluster - 0.48) + (mask - 0.5) * 0.7);
        let ore = mixColor(diamondOre, diamondHighlight, clamp01(0.35 + intensity));
        if (pixelNoise(162) > 0.87) ore = mixColor(ore, diamondHighlight, 0.6);
        return mixColor(stoneBase, ore, clamp01(0.6 + intensity * 0.45));
      }
      return stoneBase.map((c, idx) => clamp01(idx === 2 ? c * 1.02 : c * 0.97));
    }
    default:
      return color;
  }
}

function sampleFaceColor(blockType, baseColor, shade, world, worldX, worldY, worldZ, faceIndex, corner) {
  const detailColor = applyTextureDetail(blockType, baseColor, faceIndex, corner, world, worldX, worldY, worldZ);
  const { u, v } = computeFaceUV(faceIndex, corner);

  let color = detailColor;
  if (blockType === BLOCK_TYPES.gold || blockType === BLOCK_TYPES.diamond) {
    const sparkleBase = world.pseudoRandom(
      Math.floor(worldX) * 59 + Math.floor(worldY) * 83 + Math.floor(worldZ) * 97,
      Math.floor(u * 16) * 13,
      Math.floor(v * 16) * 17,
      200 + blockType * 7,
    );
    const sparkleWave = Math.abs(Math.sin((worldX + u) * 2.4 + (worldZ + v) * 1.7 + faceIndex));
    const sparkle = clamp01((sparkleBase - 0.7) * 1.5 + sparkleWave * 0.3);
    const highlight = blockType === BLOCK_TYPES.gold ? [1, 0.97, 0.7] : [0.9, 0.98, 1];
    color = mixColor(color, highlight, sparkle * 0.5);
  }

  const shadeNoise = (world.random3D(
    worldX + corner[0],
    worldY + corner[1],
    worldZ + corner[2],
    faceIndex * 29 + Math.floor(u * 11) + Math.floor(v * 13),
  ) - 0.5) * 0.12;
  const finalShade = shade + shadeNoise;
  return [
    clamp01(color[0] * finalShade),
    clamp01(color[1] * finalShade),
    clamp01(color[2] * finalShade),
  ];
}

function emitDetailedFace(
  positions,
  normals,
  colors,
  blockType,
  baseColor,
  faceIndex,
  face,
  world,
  worldX,
  worldY,
  worldZ,
  lx,
  y,
  lz,
) {
  const resolution = Math.max(1, getFaceResolution(blockType, faceIndex));
  const { origin, uAxis, vAxis } = FACE_AXES[faceIndex];
  for (let iu = 0; iu < resolution; iu += 1) {
    const u0 = iu / resolution;
    const u1 = (iu + 1) / resolution;
    for (let iv = 0; iv < resolution; iv += 1) {
      const v0 = iv / resolution;
      const v1 = (iv + 1) / resolution;

      const quadCorners = [
        interpolateCorner(origin, uAxis, vAxis, u0, v0),
        interpolateCorner(origin, uAxis, vAxis, u0, v1),
        interpolateCorner(origin, uAxis, vAxis, u1, v1),
        interpolateCorner(origin, uAxis, vAxis, u1, v0),
      ];

      for (const idx of TRIANGLE_ORDER) {
        const corner = quadCorners[idx];
        positions.push(lx + corner[0], y + corner[1], lz + corner[2]);
        normals.push(face.dir[0], face.dir[1], face.dir[2]);
        const tinted = sampleFaceColor(blockType, baseColor, face.shade ?? 1, world, worldX, worldY, worldZ, faceIndex, corner);
        colors.push(tinted[0], tinted[1], tinted[2]);
      }
    }
  }
}

const chunkKey = (cx, cz) => `${cx},${cz}`;

function chunkTasksInSpiral(radius) {
  const tasks = [];
  for (let cx = -radius; cx <= radius; cx += 1) {
    for (let cz = -radius; cz <= radius; cz += 1) {
      tasks.push({ cx, cz });
    }
  }

  tasks.sort((a, b) => {
    const da = a.cx * a.cx + a.cz * a.cz;
    const db = b.cx * b.cx + b.cz * b.cz;
    if (da !== db) return da - db;
    const angleA = a.cx === 0 && a.cz === 0 ? 0 : (Math.atan2(a.cz, a.cx) + Math.PI * 2) % (Math.PI * 2);
    const angleB = b.cx === 0 && b.cz === 0 ? 0 : (Math.atan2(b.cz, b.cx) + Math.PI * 2) % (Math.PI * 2);
    if (angleA !== angleB) return angleA - angleB;
    if (a.cx !== b.cx) return a.cx - b.cx;
    return a.cz - b.cz;
  });

  return tasks;
}

class Chunk {
  constructor(world, cx, cz) {
    this.world = world;
    this.cx = cx;
    this.cz = cz;
    this.origin = new THREE.Vector3(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    this.mesh = null;
    this.rebuildInFlight = false;
    this.counts = new Uint32Array(MAX_BLOCK_TYPE + 1);
    this.generate();
    this.geometryVersion = 0;
  }

  index(x, y, z) {
    return x + CHUNK_SIZE * (z + CHUNK_SIZE * y);
  }

  get(x, y, z) {
    if (
      x < 0 || x >= CHUNK_SIZE ||
      y < 0 || y >= CHUNK_HEIGHT ||
      z < 0 || z >= CHUNK_SIZE
    ) {
      return BLOCK_TYPES.air;
    }
    return this.blocks[this.index(x, y, z)];
  }

  set(x, y, z, type) {
    const idx = this.index(x, y, z);
    const prev = this.blocks[idx];
    if (prev === type) return false;

    this.blocks[idx] = type;
    if (this.counts[prev] > 0) this.counts[prev] -= 1;
    this.counts[type] += 1;
    return true;
  }

  generate() {
    const { noise, seed } = this.world;
    const scale = 0.06;
    const roughness = 0.35;

    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        const worldX = this.origin.x + lx;
        const worldZ = this.origin.z + lz;

        let height = 24;
        let amplitude = 12;
        let frequency = scale;
        let value = 0;

        for (let octave = 0; octave < 4; octave += 1) {
          const n = noise.noise(worldX * frequency, seed + octave * 7.13, worldZ * frequency);
          value += n * amplitude;
          amplitude *= roughness;
          frequency *= 2;
        }

        const terrainHeight = Math.max(3, Math.min(CHUNK_HEIGHT - 1, Math.floor(height + value)));

        for (let y = 0; y <= terrainHeight; y += 1) {
          let blockType = BLOCK_TYPES.stone;
          if (y === terrainHeight) {
            blockType = terrainHeight <= 18 ? BLOCK_TYPES.sand : BLOCK_TYPES.grass;
          } else if (terrainHeight - y <= 3) {
            blockType = BLOCK_TYPES.dirt;
          } else if (blockType === BLOCK_TYPES.stone && y > 6 && y < terrainHeight - 4) {
            const oreChance = this.world.random3D(worldX, y, worldZ, 79);
            if (oreChance > 0.97) {
              blockType = BLOCK_TYPES.diamond;
            } else if (oreChance > 0.93) {
              blockType = BLOCK_TYPES.gold;
            }
          }
          this.set(lx, y, lz, blockType);
        }

        const surfaceType = this.get(lx, terrainHeight, lz);
        if (surfaceType === BLOCK_TYPES.grass) {
          const treeChance = this.world.random2D(worldX, worldZ, 37);
          const treeHeight = 4 + Math.floor(this.world.random2D(worldX, worldZ, 53) * 3);
          if (
            treeChance > 0.82 &&
            terrainHeight + treeHeight + 2 < CHUNK_HEIGHT &&
            this.canPlaceTree(lx, terrainHeight, lz, treeHeight)
          ) {
            this.placeTree(lx, terrainHeight, lz, treeHeight, worldX, worldZ);
          } else if (terrainHeight + 1 < CHUNK_HEIGHT) {
            const flowerChance = this.world.random2D(worldX, worldZ, 91);
            if (flowerChance > 0.7) {
              const flowerType = flowerChance > 0.88 ? BLOCK_TYPES.flowerRed : BLOCK_TYPES.flowerYellow;
              this.set(lx, terrainHeight + 1, lz, flowerType);
            }
          }
        }
      }
    }
  }

  canPlaceTree(lx, groundY, lz, height, radius = 2) {
    if (
      lx < radius ||
      lx >= CHUNK_SIZE - radius ||
      lz < radius ||
      lz >= CHUNK_SIZE - radius ||
      groundY + height + 2 >= CHUNK_HEIGHT
    ) {
      return false;
    }

    for (let y = groundY + 1; y <= groundY + height + 2; y += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          const check = this.get(lx + dx, y, lz + dz);
          if (check !== BLOCK_TYPES.air) return false;
        }
      }
    }
    return true;
  }

  placeTree(lx, groundY, lz, height, worldX, worldZ) {
    for (let i = 1; i <= height; i += 1) {
      this.set(lx, groundY + i, lz, BLOCK_TYPES.wood);
    }

    const canopyTop = groundY + height + 2;
    for (let y = groundY + height - 1; y <= canopyTop; y += 1) {
      const layerRadius = Math.max(1, canopyTop - y);
      for (let dx = -layerRadius; dx <= layerRadius; dx += 1) {
        for (let dz = -layerRadius; dz <= layerRadius; dz += 1) {
          const dist = Math.abs(dx) + Math.abs(dz);
          if (dist > layerRadius + 1) continue;
          const targetX = lx + dx;
          const targetY = y;
          const targetZ = lz + dz;
          if (
            targetX < 0 ||
            targetX >= CHUNK_SIZE ||
            targetZ < 0 ||
            targetZ >= CHUNK_SIZE ||
            targetY >= CHUNK_HEIGHT
          ) {
            continue;
          }
          if (dx === 0 && dz === 0 && targetY <= groundY + height) continue;
          if (this.get(targetX, targetY, targetZ) === BLOCK_TYPES.air) {
            const leafNoise = this.world.random3D(worldX + dx, targetY, worldZ + dz, 113);
            if (leafNoise > 0.2) {
              this.set(targetX, targetY, targetZ, BLOCK_TYPES.leaves);
            }
          }
        }
      }
    }

    const offsets = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dz] of offsets) {
      const fx = lx + dx;
      const fz = lz + dz;
      const flowerY = groundY + 1;
      if (
        fx < 0 ||
        fx >= CHUNK_SIZE ||
        fz < 0 ||
        fz >= CHUNK_SIZE ||
        flowerY >= CHUNK_HEIGHT
      ) {
        continue;
      }
      if (this.get(fx, groundY, fz) === BLOCK_TYPES.grass && this.get(fx, flowerY, fz) === BLOCK_TYPES.air) {
        const chance = this.world.random2D(worldX + dx * 3, worldZ + dz * 3, 127);
        if (chance > 0.65) {
          const flowerType = chance > 0.85 ? BLOCK_TYPES.flowerRed : BLOCK_TYPES.flowerYellow;
          this.set(fx, flowerY, fz, flowerType);
        }
      }
    }
  }

  rebuild() {
    this.geometryVersion += 1;
    this.world.queueChunkRebuild(this);
  }
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.chunkMeshes = new Set();
    this.pendingRebuilds = new Map();
    this.activeRebuilds = 0;
    let concurrency = 2;
    if (typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)) {
      concurrency = Math.max(1, Math.min(4, Math.floor(navigator.hardwareConcurrency / 2)));
    }
    this.maxConcurrentRebuilds = concurrency;
    this.playerPosition = new THREE.Vector3(0, 0, 0);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.noise = new ImprovedNoise();
    this.seed = Math.floor(Math.random() * 2 ** 31);
    this.blockTotals = new Uint32Array(MAX_BLOCK_TYPE + 1);
    this.workerTaskId = 0;
    this.workerTasks = new Map();
    try {
      this.worker = new Worker(new URL('./worker/chunkGeometryWorker.js', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (event) => this.handleWorkerMessage(event));
      this.worker.addEventListener('error', (event) => {
        console.error('Chunk geometry worker error', event);
      });
    } catch (error) {
      console.error('Failed to initialize chunk geometry worker', error);
      this.worker = null;
    }
  }

  pseudoRandom(x, y, z, salt = 0) {
    const s = Math.sin((x * 15731 + y * 789221 + z * 1376312589 + (this.seed + salt) * 0.0001) * 12.9898);
    return s - Math.floor(s);
  }

  random2D(x, z, salt = 0) {
    return this.pseudoRandom(x, 0, z, salt);
  }

  random3D(x, y, z, salt = 0) {
    return this.pseudoRandom(x, y, z, salt);
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  ensureChunk(cx, cz) {
    let chunk = this.getChunk(cx, cz);
    if (!chunk) {
      chunk = new Chunk(this, cx, cz);
      this.chunks.set(chunkKey(cx, cz), chunk);
      this.applyChunkCounts(chunk, 1);
      chunk.rebuild();
    }
    return chunk;
  }

  queueChunkRebuild(chunk) {
    if (!chunk) return;
    const version = chunk.geometryVersion;
    const existing = this.pendingRebuilds.get(chunk);
    if (existing) {
      existing.version = version;
    } else {
      this.pendingRebuilds.set(chunk, { chunk, version });
    }
    this.processRebuildQueue();
  }

  updatePlayerPosition(position) {
    if (!position) return;
    this.playerPosition.copy(position);
    this.processRebuildQueue();
  }

  processRebuildQueue() {
    if (!this.worker) return;
    while (this.activeRebuilds < this.maxConcurrentRebuilds) {
      const next = this.pickNextChunkForRebuild();
      if (!next) break;
      this.pendingRebuilds.delete(next.chunk);
      next.chunk.rebuildInFlight = true;
      this.activeRebuilds += 1;
      this.requestChunkGeometry(next.chunk, next.version);
    }
  }

  pickNextChunkForRebuild() {
    let best = null;
    let bestPriority = Infinity;
    for (const entry of this.pendingRebuilds.values()) {
      const { chunk } = entry;
      if (!chunk || chunk.rebuildInFlight) continue;
      const priority = this.computeChunkPriority(chunk);
      const bestVersion = best ? best.version : -Infinity;
      if (
        priority < bestPriority - 1e-6 ||
        (Math.abs(priority - bestPriority) <= 1e-6 && bestVersion < entry.version)
      ) {
        best = entry;
        bestPriority = priority;
      }
    }
    return best;
  }

  computeChunkPriority(chunk) {
    const centerX = chunk.origin.x + CHUNK_SIZE * 0.5;
    const centerZ = chunk.origin.z + CHUNK_SIZE * 0.5;
    const dx = centerX - this.playerPosition.x;
    const dz = centerZ - this.playerPosition.z;
    return dx * dx + dz * dz;
  }

  finishChunkRebuild(chunk) {
    chunk.rebuildInFlight = false;
    if (this.activeRebuilds > 0) this.activeRebuilds -= 1;
    this.processRebuildQueue();
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return BLOCK_TYPES.air;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return BLOCK_TYPES.air;
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    return chunk.get(lx, y, lz);
  }

  setBlock(x, y, z, type) {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.ensureChunk(cx, cz);
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    const current = chunk.get(lx, y, lz);
    if (current === type) return false;

    chunk.set(lx, y, lz, type);
    if (current <= MAX_BLOCK_TYPE && this.blockTotals[current] > 0) {
      this.blockTotals[current] -= 1;
    }
    if (type <= MAX_BLOCK_TYPE) {
      this.blockTotals[type] += 1;
    }
    chunk.rebuild();

    if (lx === 0) this.rebuildChunkIfExists(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.rebuildChunkIfExists(cx + 1, cz);
    if (lz === 0) this.rebuildChunkIfExists(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.rebuildChunkIfExists(cx, cz + 1);
    return true;
  }

  rebuildChunkIfExists(cx, cz) {
    const chunk = this.getChunk(cx, cz);
    if (chunk) chunk.rebuild();
  }

  generate(radius = 2) {
    for (const { cx, cz } of chunkTasksInSpiral(radius)) {
      this.ensureChunk(cx, cz);
    }
  }

  async generateAsync(radius = 2, onProgress = null) {
    const tasks = chunkTasksInSpiral(radius);

    const total = tasks.length;
    if (total === 0) {
      if (typeof onProgress === 'function') onProgress(1);
      return;
    }

    for (let index = 0; index < total; index += 1) {
      const { cx, cz } = tasks[index];
      this.ensureChunk(cx, cz);
      if (typeof onProgress === 'function') {
        onProgress((index + 1) / total);
      }
      if (index < total - 1) {
        // Yield control so the UI can update between chunk generations.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
  }

  requestChunkGeometry(chunk, version) {
    if (!this.worker) return;
    const blocksCopy = chunk.blocks.slice();
    const neighbors = {};
    const transfers = [blocksCopy.buffer];
    const neighborSpecs = [
      ['px', 1, 0],
      ['nx', -1, 0],
      ['pz', 0, 1],
      ['nz', 0, -1],
    ];
    for (const [key, dx, dz] of neighborSpecs) {
      const neighbor = this.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (neighbor) {
        const neighborCopy = neighbor.blocks.slice();
        neighbors[key] = { blocks: neighborCopy.buffer };
        transfers.push(neighborCopy.buffer);
      }
    }

    const id = ++this.workerTaskId;
    this.workerTasks.set(id, { chunk, version });
    this.worker.postMessage(
      {
        id,
        version,
        payload: {
          seed: this.seed,
          origin: [chunk.origin.x, chunk.origin.y, chunk.origin.z],
          blocks: blocksCopy.buffer,
          neighbors,
        },
      },
      transfers,
    );
  }

  handleWorkerMessage(event) {
    const { id, version, positions, normals, colors, error } = event.data;
    const task = this.workerTasks.get(id);
    if (!task) return;
    this.workerTasks.delete(id);
    const { chunk } = task;
    if (version !== chunk.geometryVersion) {
      this.finishChunkRebuild(chunk);
      return;
    }
    if (error) {
      console.error('Chunk geometry worker message error:', error);
      this.finishChunkRebuild(chunk);
      return;
    }

    const previousMesh = chunk.mesh;

    if (!positions || positions.length === 0) {
      if (previousMesh) {
        this.scene.remove(previousMesh);
        this.chunkMeshes.delete(previousMesh);
        previousMesh.geometry.dispose();
      }
      chunk.mesh = null;
      this.finishChunkRebuild(chunk);
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.copy(chunk.origin);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.chunk = chunk;

    if (previousMesh) {
      this.scene.remove(previousMesh);
      this.chunkMeshes.delete(previousMesh);
      previousMesh.geometry.dispose();
    }

    chunk.mesh = mesh;
    this.scene.add(mesh);
    this.chunkMeshes.add(mesh);
    this.finishChunkRebuild(chunk);
  }

  applyChunkCounts(chunk, delta) {
    const counts = chunk.counts;
    for (let i = 0; i < counts.length; i += 1) {
      const next = this.blockTotals[i] + delta * counts[i];
      this.blockTotals[i] = next < 0 ? 0 : next;
    }
  }

  getBlockTotals() {
    return this.blockTotals;
  }

  getHeightAt(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return 0;
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y -= 1) {
      if (chunk.get(lx, y, lz) !== BLOCK_TYPES.air) {
        return y + 1;
      }
    }
    return 0;
  }

  getSurfaceHeightAt(x, z, maxY = CHUNK_HEIGHT - 1) {
    const blockX = Math.floor(x);
    const blockZ = Math.floor(z);
    const cx = Math.floor(blockX / CHUNK_SIZE);
    const cz = Math.floor(blockZ / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return 0;
    const lx = blockX - cx * CHUNK_SIZE;
    const lz = blockZ - cz * CHUNK_SIZE;
    let top = Math.min(Math.floor(maxY), CHUNK_HEIGHT - 1);
    if (Number.isNaN(top)) top = CHUNK_HEIGHT - 1;
    for (let y = top; y >= 0; y -= 1) {
      if (chunk.get(lx, y, lz) !== BLOCK_TYPES.air) {
        return y + 1;
      }
    }
    return 0;
  }

  getSpawnPoint() {
    const x = 0;
    const z = 0;
    const y = this.getHeightAt(x, z);
    return new THREE.Vector3(x + 0.5, y + 1.75, z + 0.5);
  }

  getRaycastTarget(raycaster, { place = false } = {}) {
    const intersections = raycaster.intersectObjects(Array.from(this.chunkMeshes), false);
    if (intersections.length === 0) return null;

    const hit = intersections[0];
    const normal = hit.face.normal.clone();
    const offset = place ? 0.01 : -0.01;
    const point = hit.point.clone().addScaledVector(normal, offset);

    const worldX = Math.floor(point.x);
    const worldY = Math.floor(point.y);
    const worldZ = Math.floor(point.z);
    return { x: worldX, y: worldY, z: worldZ, normal };
  }
}

export { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_TYPES, BLOCK_TYPE_LABELS };
