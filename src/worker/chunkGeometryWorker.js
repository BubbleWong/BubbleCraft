import {
  CHUNK_SIZE,
  CHUNK_HEIGHT,
  BLOCK_TYPES,
  BLOCK_COLORS,
  FLOWER_COLOR_VARIANTS,
  FLOWER_CENTER_COLOR,
  FLOWER_STEM_COLOR,
} from '../constants.js';

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const isTransparentBlock = (blockType) => blockType === BLOCK_TYPES.flower;

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

function createRandom(seed) {
  const pseudoRandom = (x, y, z, salt = 0) => {
    const s = Math.sin((x * 15731 + y * 789221 + z * 1376312589 + (seed + salt) * 0.0001) * 12.9898);
    return s - Math.floor(s);
  };

  const random2D = (x, z, salt = 0) => pseudoRandom(x, 0, z, salt);
  const random3D = (x, y, z, salt = 0) => pseudoRandom(x, y, z, salt);

  return { seed, pseudoRandom, random2D, random3D };
}

function applyTextureDetail(blockType, baseColor, faceIndex, corner, worldX, worldY, worldZ, random) {
  const { u, v } = computeFaceUV(faceIndex, corner);
  const pixelU = Math.max(0, Math.min(15, Math.floor(u * 16)));
  const pixelV = Math.max(0, Math.min(15, Math.floor(v * 16)));
  const worldCornerX = worldX + corner[0];
  const worldCornerY = worldY + corner[1];
  const worldCornerZ = worldZ + corner[2];
  const isSideFace = faceIndex === 0 || faceIndex === 1 || faceIndex === 4 || faceIndex === 5;

  const pseudoRandom = (x, y, z, salt = 0) => {
    if (typeof random.pseudoRandom === 'function') return random.pseudoRandom(x, y, z, salt);
    const seed = random.seed ?? 0;
    const s = Math.sin((x * 15731 + y * 789221 + z * 1376312589 + (seed + salt) * 0.0001) * 12.9898);
    return s - Math.floor(s);
  };

  const pixelNoise = (salt = 0) => pseudoRandom(
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
      const stoneBase = applyTextureDetail(BLOCK_TYPES.stone, BLOCK_COLORS[BLOCK_TYPES.stone], faceIndex, corner, worldX, worldY, worldZ, random);
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
      const stoneBase = applyTextureDetail(BLOCK_TYPES.stone, BLOCK_COLORS[BLOCK_TYPES.stone], faceIndex, corner, worldX, worldY, worldZ, random);
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

function sampleFaceColor(blockType, baseColor, shade, faceIndex, corner, worldX, worldY, worldZ, random) {
  const detailColor = applyTextureDetail(blockType, baseColor, faceIndex, corner, worldX, worldY, worldZ, random);
  const { u, v } = computeFaceUV(faceIndex, corner);

  let color = detailColor;
  if (blockType === BLOCK_TYPES.gold || blockType === BLOCK_TYPES.diamond) {
    const random3D = typeof random.random3D === 'function'
      ? random.random3D
      : (x, y, z, salt = 0) => {
          const seed = random.seed ?? 0;
          const s = Math.sin((x * 15731 + y * 789221 + z * 1376312589 + (seed + salt) * 0.0001) * 12.9898);
          return s - Math.floor(s);
        };
    const sparkleBase = random3D(
      Math.floor(worldX),
      Math.floor(worldY),
      Math.floor(worldZ),
      200 + blockType * 7,
    );
    const sparkleWave = Math.abs(Math.sin((worldX + u) * 2.4 + (worldZ + v) * 1.7 + faceIndex));
    const sparkle = clamp01((sparkleBase - 0.7) * 1.5 + sparkleWave * 0.3);
    const highlight = blockType === BLOCK_TYPES.gold ? [1, 0.97, 0.7] : [0.9, 0.98, 1];
    color = mixColor(color, highlight, sparkle * 0.5);
  }

  const random3DShade = typeof random.random3D === 'function'
    ? random.random3D
    : (x, y, z, salt = 0) => {
        const seed = random.seed ?? 0;
        const s = Math.sin((x * 15731 + y * 789221 + z * 1376312589 + (seed + salt) * 0.0001) * 12.9898);
        return s - Math.floor(s);
      };

  const shadeNoise = (random3DShade(
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

const WHITE = [1, 1, 1];
const BLACK = [0, 0, 0];

const vecAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vecSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vecScale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
const vecCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vecNormalize = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length === 0) return [0, 1, 0];
  return [v[0] / length, v[1] / length, v[2] / length];
};

const computeNormal = (a, b, c) => vecNormalize(vecCross(vecSub(b, a), vecSub(c, a)));

const lightenColor = (color, amount) => mixColor(color, WHITE, amount);
const darkenColor = (color, amount) => mixColor(color, BLACK, amount);

function emitQuadDoubleSided(positions, normals, colors, vertices, vertexColors) {
  const [v0, v1, v2, v3] = vertices;
  let normal = computeNormal(v0, v1, v2);
  if (!Number.isFinite(normal[0])) normal = [0, 1, 0];
  const frontTriangles = [
    [0, 1, 2],
    [0, 2, 3],
  ];
  for (const triangle of frontTriangles) {
    for (const index of triangle) {
      const vertex = vertices[index];
      const color = vertexColors[index];
      positions.push(vertex[0], vertex[1], vertex[2]);
      normals.push(normal[0], normal[1], normal[2]);
      colors.push(color[0], color[1], color[2]);
    }
  }

  const backNormal = [-normal[0], -normal[1], -normal[2]];
  const backTriangles = [
    [0, 2, 1],
    [0, 3, 2],
  ];
  for (const triangle of backTriangles) {
    for (const index of triangle) {
      const vertex = vertices[index];
      const color = vertexColors[index];
      positions.push(vertex[0], vertex[1], vertex[2]);
      normals.push(backNormal[0], backNormal[1], backNormal[2]);
      colors.push(color[0], color[1], color[2]);
    }
  }
}

function addTaperedPanel(
  positions,
  normals,
  colors,
  right,
  bottomCenter,
  topCenter,
  bottomHalfWidth,
  topHalfWidth,
  bottomColor,
  topLeftColor,
  topRightColor,
) {
  const bottomLeft = vecSub(bottomCenter, vecScale(right, bottomHalfWidth));
  const bottomRight = vecAdd(bottomCenter, vecScale(right, bottomHalfWidth));
  const topLeft = vecSub(topCenter, vecScale(right, topHalfWidth));
  const topRight = vecAdd(topCenter, vecScale(right, topHalfWidth));

  const vertices = [bottomLeft, bottomRight, topRight, topLeft];
  const vertexColors = [bottomColor, bottomColor, topRightColor, topLeftColor];
  emitQuadDoubleSided(positions, normals, colors, vertices, vertexColors);
}

function addStemPanels(
  positions,
  normals,
  colors,
  bottomCenter,
  topCenter,
  radius,
  rotation,
  bottomColor,
  topColor,
) {
  const bladeCount = 3;
  for (let i = 0; i < bladeCount; i += 1) {
    const angle = rotation + (i / bladeCount) * Math.PI;
    const dir = [Math.cos(angle), 0, Math.sin(angle)];
    const right = [-dir[2], 0, dir[0]];
    const offset = vecScale(dir, radius * 0.25);
    const bladeBottom = vecAdd(bottomCenter, offset);
    const bladeTop = vecAdd(topCenter, offset);
    addTaperedPanel(
      positions,
      normals,
      colors,
      right,
      bladeBottom,
      bladeTop,
      radius,
      radius * 0.9,
      bottomColor,
      topColor,
      topColor,
    );
  }
}

function addStemLeaves(
  positions,
  normals,
  colors,
  stemBottom,
  stemHeight,
  rotation,
  random,
  worldX,
  worldY,
  worldZ,
) {
  const leafCount = 1 + Math.floor(random.random3D(worldX, worldY, worldZ, 861) * 2);
  const baseColor = darkenColor(FLOWER_STEM_COLOR, 0.25);
  const tipColor = lightenColor(FLOWER_STEM_COLOR, 0.15);
  for (let i = 0; i < leafCount; i += 1) {
    const heightFactor = 0.25 + random.random3D(worldX, worldY, worldZ, 870 + i) * 0.35;
    const baseY = stemBottom[1] + stemHeight * heightFactor;
    const leafLength = 0.22 + random.random3D(worldX, worldY, worldZ, 880 + i) * 0.14;
    const leafWidth = 0.09 + random.random3D(worldX, worldY, worldZ, 890 + i) * 0.05;
    const leafAngle = rotation + (i % 2 === 0 ? 0 : Math.PI / 2) + (random.random3D(worldX, worldY, worldZ, 900 + i) - 0.5) * 0.5;
    const dir = [Math.cos(leafAngle), 0, Math.sin(leafAngle)];
    const right = [-dir[2], 0, dir[0]];
    const baseCenter = [
      stemBottom[0] + dir[0] * 0.05,
      baseY,
      stemBottom[2] + dir[2] * 0.05,
    ];
    const tipCenter = [
      baseCenter[0] + dir[0] * leafLength,
      baseY + 0.12 + random.random3D(worldX, worldY, worldZ, 910 + i) * 0.08,
      baseCenter[2] + dir[2] * leafLength,
    ];
    addTaperedPanel(
      positions,
      normals,
      colors,
      right,
      baseCenter,
      tipCenter,
      leafWidth * 0.5,
      leafWidth * 0.1,
      baseColor,
      tipColor,
      tipColor,
    );
  }
}

function addBloomCore(
  positions,
  normals,
  colors,
  center,
  bottomY,
  topY,
  radius,
  rotation,
  color,
) {
  const variantTop = lightenColor(color, 0.18);
  for (let i = 0; i < 3; i += 1) {
    const angle = rotation + (i / 3) * (Math.PI / 1.5);
    const dir = [Math.cos(angle), 0, Math.sin(angle)];
    const right = [-dir[2], 0, dir[0]];
    const offset = vecScale(dir, radius * 0.15);
    const bottomCenter = [center[0] + offset[0], bottomY, center[2] + offset[2]];
    const topCenter = [center[0] + offset[0], topY, center[2] + offset[2]];
    addTaperedPanel(
      positions,
      normals,
      colors,
      right,
      bottomCenter,
      topCenter,
      radius,
      radius * 0.8,
      color,
      variantTop,
      variantTop,
    );
  }
}

function addPetalLayer(
  positions,
  normals,
  colors,
  stemTopCenter,
  bottomY,
  topY,
  baseRadius,
  petalCount,
  rotation,
  palette,
  random,
  worldX,
  worldY,
  worldZ,
  salt,
) {
  for (let i = 0; i < petalCount; i += 1) {
    const angle = rotation + (i / petalCount) * Math.PI * 2;
    const dir = [Math.cos(angle), 0, Math.sin(angle)];
    const right = [-dir[2], 0, dir[0]];
    const baseOffset = baseRadius * (0.4 + random.random3D(worldX, worldY, worldZ, salt + i) * 0.25);
    const tipOffset = baseRadius * (0.9 + random.random3D(worldX, worldY, worldZ, salt + 40 + i) * 0.4);
    const bottomWidth = 0.08 + random.random3D(worldX, worldY, worldZ, salt + 80 + i) * 0.05;
    const topWidth = bottomWidth * (1.6 + random.random3D(worldX, worldY, worldZ, salt + 120 + i) * 0.7);
    const sway = (random.random3D(worldX, worldY, worldZ, salt + 160 + i) - 0.5) * baseRadius * 0.4;

    const bottomCenter = [
      stemTopCenter[0] + dir[0] * baseOffset,
      bottomY,
      stemTopCenter[2] + dir[2] * baseOffset,
    ];
    const topCenter = [
      stemTopCenter[0] + dir[0] * tipOffset + right[0] * sway,
      topY,
      stemTopCenter[2] + dir[2] * tipOffset + right[2] * sway,
    ];

    const bottomColor = mixColor(palette.petalCenter, palette.petalBase, 0.6);
    const tipColorLeft = mixColor(palette.petalBase, palette.petalEdge, 0.45 + random.random3D(worldX, worldY, worldZ, salt + 200 + i) * 0.2);
    const tipColorRight = mixColor(palette.petalBase, palette.petalEdge, 0.65 + random.random3D(worldX, worldY, worldZ, salt + 240 + i) * 0.2);

    addTaperedPanel(
      positions,
      normals,
      colors,
      right,
      bottomCenter,
      topCenter,
      bottomWidth * 0.5,
      topWidth * 0.5,
      bottomColor,
      tipColorLeft,
      tipColorRight,
    );
  }
}

function addFlowerGeometry(
  positions,
  normals,
  colors,
  lx,
  y,
  lz,
  worldX,
  worldY,
  worldZ,
  random,
) {
  const centerX = lx + 0.5;
  const centerZ = lz + 0.5;
  const paletteIndex = Math.floor(random.random2D(worldX, worldZ, 731) * FLOWER_COLOR_VARIANTS.length) % FLOWER_COLOR_VARIANTS.length;
  const palette = FLOWER_COLOR_VARIANTS[paletteIndex] ?? FLOWER_COLOR_VARIANTS[0];

  const stemHeight = 0.55 + random.random3D(worldX, worldY, worldZ, 502) * 0.4;
  const stemBottom = [centerX, y, centerZ];
  const stemLeanAngle = random.random2D(worldX, worldZ, 742) * Math.PI * 2;
  const stemLeanAmount = (random.random3D(worldX, worldY, worldZ, 743) - 0.5) * 0.35;
  const stemTop = [
    centerX + Math.cos(stemLeanAngle) * stemLeanAmount,
    y + stemHeight,
    centerZ + Math.sin(stemLeanAngle) * stemLeanAmount,
  ];

  const stemRotation = random.random2D(worldX, worldZ, 752) * Math.PI * 2;
  const stemBottomColor = darkenColor(FLOWER_STEM_COLOR, 0.18 + random.random3D(worldX, worldY, worldZ, 753) * 0.1);
  const stemTopColor = lightenColor(FLOWER_STEM_COLOR, 0.1 + random.random3D(worldX, worldY, worldZ, 754) * 0.12);
  const stemRadius = 0.04 + random.random3D(worldX, worldY, worldZ, 755) * 0.018;

  addStemPanels(positions, normals, colors, stemBottom, stemTop, stemRadius, stemRotation, stemBottomColor, stemTopColor);
  addStemLeaves(
    positions,
    normals,
    colors,
    stemBottom,
    stemHeight,
    stemRotation,
    random,
    worldX,
    worldY,
    worldZ,
  );

  const bloomBottom = stemTop[1] - 0.05;
  const bloomTop = stemTop[1] + 0.38 + random.random3D(worldX, worldY, worldZ, 760) * 0.22;
  const stemTopCenter = stemTop;

  const petalCount = 4 + Math.floor(random.random3D(worldX, worldY, worldZ, 761) * 4);
  const rotation = random.random2D(worldX, worldZ, 762) * Math.PI * 2;
  const layerRadius = 0.28 + random.random3D(worldX, worldY, worldZ, 763) * 0.15;

  addPetalLayer(
    positions,
    normals,
    colors,
    stemTopCenter,
    bloomBottom,
    bloomTop,
    layerRadius,
    petalCount,
    rotation,
    palette,
    random,
    worldX,
    worldY,
    worldZ,
    780,
  );

  if (random.random3D(worldX, worldY, worldZ, 764) > 0.45) {
    const secondaryCount = petalCount - 1;
    if (secondaryCount >= 3) {
      addPetalLayer(
        positions,
        normals,
        colors,
        stemTopCenter,
        bloomBottom - 0.08,
        bloomTop - 0.12,
        layerRadius * 0.65,
        secondaryCount,
        rotation + Math.PI / petalCount,
        {
          petalBase: mixColor(palette.petalBase, palette.petalEdge, 0.2),
          petalEdge: lightenColor(palette.petalEdge, 0.15),
          petalCenter: mixColor(palette.petalCenter, palette.petalBase, 0.4),
        },
        random,
        worldX,
        worldY,
        worldZ,
        840,
      );
    }
  }

  const coreRadius = 0.12 + random.random3D(worldX, worldY, worldZ, 765) * 0.05;
  const coreBottom = bloomTop - 0.14;
  const coreTop = bloomTop;
  const coreRotation = rotation + Math.PI / 6;
  const coreColor = palette.center ?? FLOWER_CENTER_COLOR;
  addBloomCore(
    positions,
    normals,
    colors,
    [stemTopCenter[0], (coreBottom + coreTop) * 0.5, stemTopCenter[2]],
    coreBottom,
    coreTop,
    coreRadius,
    coreRotation,
    coreColor,
  );
}

function emitDetailedFace(positions, normals, colors, blockType, baseColor, faceIndex, face, worldX, worldY, worldZ, lx, y, lz, random) {
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
        const tinted = sampleFaceColor(
          blockType,
          baseColor,
          face.shade ?? 1,
          faceIndex,
          corner,
          worldX,
          worldY,
          worldZ,
          random,
        );
        colors.push(tinted[0], tinted[1], tinted[2]);
      }
    }
  }
}

const indexInChunk = (x, y, z) => x + CHUNK_SIZE * (z + CHUNK_SIZE * y);

function getBlockAt(localX, localY, localZ, blocks, neighbors) {
  if (localY < 0 || localY >= CHUNK_HEIGHT) return BLOCK_TYPES.air;
  if (localX < 0) {
    const neighbor = neighbors.nx;
    if (!neighbor) return BLOCK_TYPES.air;
    const nx = CHUNK_SIZE - 1;
    return neighbor.blocks[indexInChunk(nx, localY, clamp(localZ))] ?? BLOCK_TYPES.air;
  }
  if (localX >= CHUNK_SIZE) {
    const neighbor = neighbors.px;
    if (!neighbor) return BLOCK_TYPES.air;
    const px = 0;
    return neighbor.blocks[indexInChunk(px, localY, clamp(localZ))] ?? BLOCK_TYPES.air;
  }
  if (localZ < 0) {
    const neighbor = neighbors.nz;
    if (!neighbor) return BLOCK_TYPES.air;
    const nz = CHUNK_SIZE - 1;
    return neighbor.blocks[indexInChunk(clamp(localX), localY, nz)] ?? BLOCK_TYPES.air;
  }
  if (localZ >= CHUNK_SIZE) {
    const neighbor = neighbors.pz;
    if (!neighbor) return BLOCK_TYPES.air;
    const pz = 0;
    return neighbor.blocks[indexInChunk(clamp(localX), localY, pz)] ?? BLOCK_TYPES.air;
  }
  return blocks[indexInChunk(localX, localY, localZ)] ?? BLOCK_TYPES.air;
}

const clamp = (value) => {
  if (value < 0) return 0;
  if (value >= CHUNK_SIZE) return CHUNK_SIZE - 1;
  return value;
};

function buildChunkGeometry(payload) {
  const { blocks: blockBuffer, neighbors: neighborPayloads, origin, seed } = payload;
  const blocks = new Uint8Array(blockBuffer);
  const neighbors = {};
  for (const key of ['px', 'nx', 'pz', 'nz']) {
    const entry = neighborPayloads?.[key];
    if (entry && entry.blocks) {
      neighbors[key] = { blocks: new Uint8Array(entry.blocks) };
    }
  }

  const positions = [];
  const normals = [];
  const colors = [];
  const random = createRandom(seed);

  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        const blockType = blocks[indexInChunk(lx, y, lz)];
        if (blockType === BLOCK_TYPES.air) continue;

        const worldX = origin[0] + lx;
        const worldY = origin[1] + y;
        const worldZ = origin[2] + lz;

        if (blockType === BLOCK_TYPES.flower) {
          addFlowerGeometry(
            positions,
            normals,
            colors,
            lx,
            y,
            lz,
            worldX,
            worldY,
            worldZ,
            random,
          );
          continue;
        }

        const baseColor = BLOCK_COLORS[blockType];
        if (!baseColor) continue;

        for (let faceIndex = 0; faceIndex < FACE_DEFS.length; faceIndex += 1) {
          const face = FACE_DEFS[faceIndex];
          const neighborType = getBlockAt(lx + face.dir[0], y + face.dir[1], lz + face.dir[2], blocks, neighbors);
          const isTransparentNeighbor = neighborType === BLOCK_TYPES.air || isTransparentBlock(neighborType);
          if (!isTransparentNeighbor) continue;

          emitDetailedFace(
            positions,
            normals,
            colors,
            blockType,
            baseColor,
            faceIndex,
            face,
            worldX,
            worldY,
            worldZ,
            lx,
            y,
            lz,
            random,
          );
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
  };
}

self.addEventListener('message', (event) => {
  const { id, version, payload } = event.data;
  if (!payload) return;
  try {
    const result = buildChunkGeometry(payload);
    self.postMessage(
      {
        id,
        version,
        positions: result.positions,
        normals: result.normals,
        colors: result.colors,
      },
      [result.positions.buffer, result.normals.buffer, result.colors.buffer],
    );
  } catch (error) {
    self.postMessage({ id, version, error: error?.message ?? String(error) });
  }
});
