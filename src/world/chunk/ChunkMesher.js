import {
  CHUNK_SIZE,
  CHUNK_HEIGHT,
  BLOCK_TYPES,
  BLOCK_COLORS,
  FLOWER_COLOR_VARIANTS,
  FLOWER_CENTER_COLOR,
  FLOWER_STEM_COLOR,
} from '../../constants.js';

const FACE_DEFS = [
  { dir: [1, 0, 0], shade: 0.82, corners: [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]] },
  { dir: [-1, 0, 0], shade: 0.82, corners: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]] },
  { dir: [0, 1, 0], shade: 1.05, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, -1, 0], shade: 0.62, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], shade: 0.9, corners: [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]] },
  { dir: [0, 0, -1], shade: 0.75, corners: [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]] },
];

const TRIANGLE_ORDER = [0, 2, 1, 0, 3, 2];
const TRANSPARENT_BLOCKS = new Set([BLOCK_TYPES.air, BLOCK_TYPES.flower]);

const WHITE_COLOR = [1, 1, 1];
const BLACK_COLOR = [0, 0, 0];

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function makeColor(baseColor, faceShade) {
  return [
    clamp01(baseColor[0] * faceShade),
    clamp01(baseColor[1] * faceShade),
    clamp01(baseColor[2] * faceShade),
  ];
}

function mix(a, b, t) {
  return a * (1 - t) + b * t;
}

function mixColorArrays(a, b, t) {
  return [
    mix(a[0], b[0], t),
    mix(a[1], b[1], t),
    mix(a[2], b[2], t),
  ];
}

function lightenColorArray(color, amount) {
  return mixColorArrays(color, WHITE_COLOR, clamp01(amount));
}

function darkenColorArray(color, amount) {
  return mixColorArrays(color, BLACK_COLOR, clamp01(amount));
}

function adjustColor(color, amount) {
  return [
    clamp01(color[0] + amount),
    clamp01(color[1] + amount),
    clamp01(color[2] + amount),
  ];
}

function adjustRandomColorArray(color, randomFn, worldX, worldY, worldZ, salt, magnitude = 0.12) {
  const offset = randomFn(worldX, worldY, worldZ, salt) * 2 - 1;
  if (offset >= 0) return lightenColorArray(color, offset * magnitude);
  return darkenColorArray(color, -offset * magnitude);
}

export class ChunkMesher {
  constructor({ getNeighborBlock, random2D, random3D, atlas }) {
    this.getNeighborBlock = getNeighborBlock;
    this.random2D = random2D;
    this.random3D = random3D;
    this.atlas = atlas;
  }

  buildGeometry(chunk) {
    const solid = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
    const water = { positions: [], normals: [], colors: [], uvs: [], indices: [] };

    for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
          const blockType = chunk.get(lx, y, lz);
          if (blockType === BLOCK_TYPES.air) continue;

          const target = blockType === BLOCK_TYPES.water ? water : solid;
          const worldX = chunk.origin.x + lx;
          const worldZ = chunk.origin.z + lz;
          if (blockType === BLOCK_TYPES.flower) {
            this._emitFlowerGeometry(target, chunk, lx, y, lz, worldX, y, worldZ);
            continue;
          }
          const baseColor = BLOCK_COLORS[blockType] ?? [1, 1, 1];

          for (let faceIndex = 0; faceIndex < FACE_DEFS.length; faceIndex += 1) {
            const face = FACE_DEFS[faceIndex];
            const neighbor = this.getNeighborBlock(chunk, lx, y, lz, face.dir);
            const transparentNeighbor = TRANSPARENT_BLOCKS.has(neighbor) ||
              (neighbor === BLOCK_TYPES.water && blockType !== BLOCK_TYPES.water);
            if (!transparentNeighbor) continue;

            const shade = blockType === BLOCK_TYPES.water ? 0.95 : face.shade;
            const color = makeColor(baseColor, shade);
            const alpha = blockType === BLOCK_TYPES.water ? 0.68 : 1.0;
            const vertexBase = target.positions.length / 3;
            const faceUV = this.atlas?.getBlockFaceUV(blockType, faceIndex);

            for (let i = 0; i < 4; i += 1) {
              const corner = face.corners[i];
              target.positions.push(lx + corner[0], y + corner[1], lz + corner[2]);
              target.normals.push(face.dir[0], face.dir[1], face.dir[2]);
              target.colors.push(color[0], color[1], color[2], alpha);
              if (faceUV) {
                target.uvs.push(faceUV[i * 2], faceUV[i * 2 + 1]);
              } else {
                const [u, v] = this._getNeutralUV();
                target.uvs.push(u, v);
              }
            }

            for (let i = 0; i < TRIANGLE_ORDER.length; i += 1) {
              target.indices.push(vertexBase + TRIANGLE_ORDER[i]);
            }
          }
        }
      }
    }

    return {
      solid: this._finalizeGeometry(solid),
      water: this._finalizeGeometry(water),
    };
  }

  _finalizeGeometry(data) {
    if (data.positions.length === 0) return null;
    return {
      positions: new Float32Array(data.positions),
      normals: new Float32Array(data.normals),
      colors: new Float32Array(data.colors),
      uvs: new Float32Array(data.uvs),
      indices: new Uint32Array(data.indices),
    };
  }

  _emitFlowerGeometry(target, chunk, lx, y, lz, worldX, worldY, worldZ) {
    const centerX = lx + 0.5;
    const centerZ = lz + 0.5;
    const random3D = this.random3D.bind(this);
    const random2D = this.random2D.bind(this);

    const scale = 0.3 + random3D(worldX, worldY, worldZ, 689) * 0.6;
    const heightScale = scale;

    const paletteIndex = Math.floor(random2D(worldX, worldZ, 731) * FLOWER_COLOR_VARIANTS.length) % FLOWER_COLOR_VARIANTS.length;
    const paletteVariant = FLOWER_COLOR_VARIANTS[paletteIndex] ?? FLOWER_COLOR_VARIANTS[0];
    const palette = {
      petalBase: adjustRandomColorArray(paletteVariant.petalBase ?? [0.95, 0.66, 0.84], random3D, worldX, worldY, worldZ, 701, 0.18),
      petalEdge: adjustRandomColorArray(paletteVariant.petalEdge ?? [0.99, 0.93, 0.63], random3D, worldX, worldY, worldZ, 703, 0.18),
      petalCenter: adjustRandomColorArray(paletteVariant.petalCenter ?? [0.67, 0.13, 0.39], random3D, worldX, worldY, worldZ, 705, 0.16),
      center: adjustRandomColorArray(paletteVariant.center ?? FLOWER_CENTER_COLOR, random3D, worldX, worldY, worldZ, 707, 0.08),
    };

    let stemHeight = (0.5 + random3D(worldX, worldY, worldZ, 502) * 0.3) * heightScale;
    let bloomExtra = (0.24 + random3D(worldX, worldY, worldZ, 760) * 0.16) * scale;
    const maxTotalHeight = 0.94;
    const combined = stemHeight + bloomExtra;
    if (combined > maxTotalHeight) {
      const reduction = maxTotalHeight / combined;
      stemHeight *= reduction;
      bloomExtra *= reduction;
    }

    const stemBottom = [centerX, y, centerZ];
    const stemLeanAngle = random2D(worldX, worldZ, 742) * Math.PI * 2;
    const stemLeanAmount = (random3D(worldX, worldY, worldZ, 743) - 0.5) * 0.35;
    const stemTop = [
      stemBottom[0] + Math.cos(stemLeanAngle) * stemLeanAmount,
      y + stemHeight,
      stemBottom[2] + Math.sin(stemLeanAngle) * stemLeanAmount,
    ];

    const stemRotation = random2D(worldX, worldZ, 752) * Math.PI * 2;
    const stemBottomColor = darkenColorArray(FLOWER_STEM_COLOR, 0.18 + random3D(worldX, worldY, worldZ, 753) * 0.1);
    const stemTopColor = lightenColorArray(FLOWER_STEM_COLOR, 0.1 + random3D(worldX, worldY, worldZ, 754) * 0.12);
    const stemRadius = (0.04 + random3D(worldX, worldY, worldZ, 755) * 0.018) * scale;

    const bloomBottom = Math.max(y, stemTop[1] - 0.05 * scale);
    const bloomTop = Math.min(y + 0.99, stemTop[1] + bloomExtra);
    const stemTopCenter = stemTop;

    const vecAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const vecSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const vecScale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
    const makeColor = (color, alpha = 0.96) => this._colorWithAlpha(color, alpha);

    const emitTaperedPanel = (right, bottomCenter, topCenter, bottomHalfWidth, topHalfWidth, bottomColor, topLeftColor, topRightColor, alpha = 0.96) => {
      const bottomLeft = vecSub(bottomCenter, vecScale(right, bottomHalfWidth));
      const bottomRight = vecAdd(bottomCenter, vecScale(right, bottomHalfWidth));
      const topLeft = vecSub(topCenter, vecScale(right, topHalfWidth));
      const topRight = vecAdd(topCenter, vecScale(right, topHalfWidth));
      const normal = this._computeQuadNormal(bottomLeft, bottomRight, topRight);
      this._emitDoubleSidedQuad(target, [bottomLeft, bottomRight, topRight, topLeft], normal, [
        makeColor(bottomColor, alpha),
        makeColor(bottomColor, alpha),
        makeColor(topRightColor, alpha),
        makeColor(topLeftColor, alpha),
      ]);
    };

    const emitStemPanels = (bottomCenter, topCenter, radius, rotation, bottomColor, topColor) => {
      const bladeCount = 3;
      for (let i = 0; i < bladeCount; i += 1) {
        const angle = rotation + (i / bladeCount) * Math.PI;
        const dir = [Math.cos(angle), 0, Math.sin(angle)];
        const right = [-dir[2], 0, dir[0]];
        const offset = vecScale(dir, radius * 0.25);
        const bladeBottom = vecAdd(bottomCenter, offset);
        const bladeTop = vecAdd(topCenter, offset);
        emitTaperedPanel(right, bladeBottom, bladeTop, radius, radius * 0.9, bottomColor, topColor, topColor, 0.95);
      }
    };

    const emitStemLeaves = (bottomCenter, height, rotation) => {
      const leafCount = 1 + Math.floor(random3D(worldX, worldY, worldZ, 861) * 2);
      const baseColor = darkenColorArray(FLOWER_STEM_COLOR, 0.25);
      const tipColor = lightenColorArray(FLOWER_STEM_COLOR, 0.15);
      for (let i = 0; i < leafCount; i += 1) {
        const heightFactor = 0.25 + random3D(worldX, worldY, worldZ, 870 + i) * 0.35;
        const anchor = [
          bottomCenter[0] + (stemTop[0] - bottomCenter[0]) * heightFactor,
          bottomCenter[1] + (stemTop[1] - bottomCenter[1]) * heightFactor,
          bottomCenter[2] + (stemTop[2] - bottomCenter[2]) * heightFactor,
        ];
        const leafLength = (0.22 + random3D(worldX, worldY, worldZ, 880 + i) * 0.14) * scale;
        const leafWidth = (0.09 + random3D(worldX, worldY, worldZ, 890 + i) * 0.05) * scale;
        const leafAngle = rotation + (i % 2 === 0 ? 0 : Math.PI / 2) + (random3D(worldX, worldY, worldZ, 900 + i) - 0.5) * 0.5;
        const dir = [Math.cos(leafAngle), 0, Math.sin(leafAngle)];
        const right = [-dir[2], 0, dir[0]];
        const baseOffset = 0.05 * scale;
        const baseCenter = [
          anchor[0] + dir[0] * baseOffset,
          anchor[1],
          anchor[2] + dir[2] * baseOffset,
        ];
        const tipCenter = [
          baseCenter[0] + dir[0] * leafLength,
          anchor[1] + (0.12 + random3D(worldX, worldY, worldZ, 910 + i) * 0.08) * scale,
          baseCenter[2] + dir[2] * leafLength,
        ];
        emitTaperedPanel(right, baseCenter, tipCenter, leafWidth * 0.5, leafWidth * 0.1, baseColor, tipColor, tipColor, 0.94);
      }
    };

    const emitBloomCore = (center, bottomY, topY, radius, rotation, color) => {
      const variantTop = lightenColorArray(color, 0.18);
      for (let i = 0; i < 3; i += 1) {
        const angle = rotation + (i / 3) * (Math.PI / 1.5);
        const dir = [Math.cos(angle), 0, Math.sin(angle)];
        const right = [-dir[2], 0, dir[0]];
        const offset = vecScale(dir, radius * 0.15);
        const bottomCenter = vecAdd(center, offset);
        bottomCenter[1] = bottomY;
        const topCenter = vecAdd(center, offset);
        topCenter[1] = topY;
        emitTaperedPanel(right, bottomCenter, topCenter, radius, radius * 0.8, color, variantTop, variantTop, 0.96);
      }
    };

    const emitFlatDisc = (center, radius, thickness, color, alpha = 0.96, segments = 12) => {
      const discBottom = center[1] - thickness * 0.5;
      const discTop = center[1] + thickness * 0.5;
      const bottomRing = [];
      const topRing = [];
      for (let i = 0; i < segments; i += 1) {
        const angle = (i / segments) * Math.PI * 2;
        const x = center[0] + Math.cos(angle) * radius;
        const z = center[2] + Math.sin(angle) * radius;
        bottomRing.push([x, discBottom, z]);
        topRing.push([x, discTop, z]);
      }
      for (let i = 0; i < segments; i += 1) {
        const next = (i + 1) % segments;
        const v0 = bottomRing[i];
        const v1 = bottomRing[next];
        const v2 = topRing[next];
        const v3 = topRing[i];
        const normal = this._computeQuadNormal(v0, v1, v2);
        this._emitDoubleSidedQuad(target, [v0, v1, v2, v3], normal, [
          makeColor(color, alpha),
          makeColor(color, alpha),
          makeColor(lightenColorArray(color, 0.1), alpha),
          makeColor(lightenColorArray(color, 0.1), alpha),
        ]);
      }

      const bottomCenter = [center[0], discBottom, center[2]];
      const topCenter = [center[0], discTop, center[2]];
      for (let i = 0; i < segments; i += 1) {
        const next = (i + 1) % segments;
        const vb0 = bottomRing[i];
        const vb1 = bottomRing[next];
        const vt0 = topRing[i];
        const vt1 = topRing[next];
        const normalBottom = this._computeQuadNormal(vb0, vb1, bottomCenter);
        const normalTop = this._computeQuadNormal(vt0, topCenter, vt1);
        this._emitDoubleSidedTri(target, vb0, vb1, bottomCenter, normalBottom, [
          makeColor(color, alpha),
          makeColor(color, alpha),
          makeColor(color, alpha),
        ]);
        this._emitDoubleSidedTri(target, vt0, vt1, topCenter, normalTop, [
          makeColor(lightenColorArray(color, 0.08), alpha),
          makeColor(lightenColorArray(color, 0.08), alpha),
          makeColor(lightenColorArray(color, 0.08), alpha),
        ]);
      }
    };

    const emitPetalLayer = (stemCenter, bottomY, topY, baseRadius, petalCount, rotation, paletteColors, salt) => {
      for (let i = 0; i < petalCount; i += 1) {
        const angle = rotation + (i / petalCount) * Math.PI * 2;
        const dir = [Math.cos(angle), 0, Math.sin(angle)];
        const right = [-dir[2], 0, dir[0]];
        const baseOffset = baseRadius * (0.4 + random3D(worldX, worldY, worldZ, salt + i) * 0.25);
        const tipOffset = baseRadius * (0.9 + random3D(worldX, worldY, worldZ, salt + 40 + i) * 0.4);
        const bottomWidth = 0.08 + random3D(worldX, worldY, worldZ, salt + 80 + i) * 0.05;
        const topWidth = bottomWidth * (1.6 + random3D(worldX, worldY, worldZ, salt + 120 + i) * 0.7);
        const sway = (random3D(worldX, worldY, worldZ, salt + 160 + i) - 0.5) * baseRadius * 0.4;

        const bottomCenter = [
          stemCenter[0] + dir[0] * baseOffset,
          bottomY,
          stemCenter[2] + dir[2] * baseOffset,
        ];
        const topCenter = [
          stemCenter[0] + dir[0] * tipOffset + right[0] * sway,
          topY,
          stemCenter[2] + dir[2] * tipOffset + right[2] * sway,
        ];

        const bottomColor = mixColorArrays(paletteColors.petalCenter, paletteColors.petalBase, 0.6);
        const tipColorLeft = mixColorArrays(paletteColors.petalBase, paletteColors.petalEdge, 0.45 + random3D(worldX, worldY, worldZ, salt + 200 + i) * 0.2);
        const tipColorRight = mixColorArrays(paletteColors.petalBase, paletteColors.petalEdge, 0.65 + random3D(worldX, worldY, worldZ, salt + 240 + i) * 0.2);

        emitTaperedPanel(right, bottomCenter, topCenter, bottomWidth * 0.5, topWidth * 0.5, bottomColor, tipColorLeft, tipColorRight, 0.94);
      }
    };

    const emitVolumetricVariant = () => {
      emitStemPanels(stemBottom, stemTop, stemRadius, stemRotation, stemBottomColor, stemTopColor);
      emitStemLeaves(stemBottom, stemHeight, stemRotation);

      const petalCount = 4 + Math.floor(random3D(worldX, worldY, worldZ, 761) * 4);
      const rotation = random2D(worldX, worldZ, 762) * Math.PI * 2;
      const baseLayerRadius = 0.22 + random3D(worldX, worldY, worldZ, 763) * 0.1;
      const layerRadius = Math.min(0.33, baseLayerRadius * scale);

      emitPetalLayer(stemTopCenter, bloomBottom, bloomTop, layerRadius, petalCount, rotation, palette, 780);

      if (random3D(worldX, worldY, worldZ, 764) > 0.45) {
        const secondaryCount = petalCount - 1;
        if (secondaryCount >= 3) {
          const secondaryPalette = {
            petalBase: adjustRandomColorArray(mixColorArrays(palette.petalBase, palette.petalEdge, 0.25), random3D, worldX, worldY, worldZ, 812, 0.12),
            petalEdge: lightenColorArray(adjustRandomColorArray(palette.petalEdge, random3D, worldX, worldY, worldZ, 814, 0.1), 0.1),
            petalCenter: adjustRandomColorArray(mixColorArrays(palette.petalCenter, palette.petalBase, 0.35), random3D, worldX, worldY, worldZ, 816, 0.12),
          };

          emitPetalLayer(
            stemTopCenter,
            Math.max(y, bloomBottom - 0.06),
            Math.min(y + 0.98, bloomTop - 0.08),
            Math.min(0.26, layerRadius * 0.65),
            secondaryCount,
            rotation + Math.PI / petalCount,
            secondaryPalette,
            840,
          );
        }
      }

      const coreRadius = Math.min(0.16, (0.1 + random3D(worldX, worldY, worldZ, 765) * 0.04) * scale);
      const coreCenter = [stemTopCenter[0], bloomTop - Math.min(0.02 * scale, 0.015), stemTopCenter[2]];
      emitFlatDisc(coreCenter, coreRadius, Math.min(0.035 * scale, 0.03), palette.center ?? FLOWER_CENTER_COLOR, 0.96, 10);
    };

    const emitLayeredVariant = () => {
      emitStemPanels(stemBottom, stemTop, stemRadius, stemRotation, stemBottomColor, stemTopColor);
      emitStemLeaves(stemBottom, stemHeight, stemRotation);

      const petalAlpha = 0.95;
      const segmentCount = 16;
      const ringLevels = 3;
      const radii = [0.3 * scale, 0.22 * scale, 0.1 * scale];
      const heights = [bloomBottom, bloomBottom + (bloomTop - bloomBottom) * 0.55, bloomTop];

      const rings = [];
      for (let level = 0; level < ringLevels; level += 1) {
        const ring = [];
        for (let i = 0; i < segmentCount; i += 1) {
          const t = (i / segmentCount) * Math.PI * 2;
          const wobble = random3D(worldX, worldY, worldZ, 910 + level * 31 + i) * 0.05 * scale;
          const radius = radii[level] + wobble;
          ring.push([
            stemTopCenter[0] + Math.cos(t) * radius,
            heights[level] + Math.sin(t * 2) * 0.025 * scale,
            stemTopCenter[2] + Math.sin(t) * radius,
          ]);
        }
        rings.push(ring);
      }

      for (let level = 0; level < ringLevels - 1; level += 1) {
        const colorT0 = level / (ringLevels - 1);
        const colorT1 = (level + 1) / (ringLevels - 1);
        const colorLower = mixColorArrays(palette.petalBase, palette.petalEdge, Math.pow(colorT0, 0.7));
        const colorUpper = mixColorArrays(palette.petalBase, palette.petalEdge, Math.pow(colorT1, 0.7));
        for (let i = 0; i < segmentCount; i += 1) {
          const next = (i + 1) % segmentCount;
          const v0 = rings[level][i];
          const v1 = rings[level][next];
          const v2 = rings[level + 1][next];
          const v3 = rings[level + 1][i];
          const normal = this._computeQuadNormal(v0, v1, v2);
          this._emitDoubleSidedQuad(target, [v0, v1, v2, v3], normal, [
            makeColor(colorLower, petalAlpha),
            makeColor(colorLower, petalAlpha),
            makeColor(colorUpper, petalAlpha),
            makeColor(colorUpper, petalAlpha),
          ]);
        }
      }

      const coreColor = palette.center ?? FLOWER_CENTER_COLOR;
      const topCenter = [stemTopCenter[0], Math.min(bloomTop + 0.04 * scale, CHUNK_HEIGHT - 0.01), stemTopCenter[2]];
      const topRing = rings[ringLevels - 1];
      for (let i = 0; i < segmentCount; i += 1) {
        const next = (i + 1) % segmentCount;
        const v0 = topRing[i];
        const v1 = topRing[next];
        const normal = this._computeQuadNormal(v0, v1, topCenter);
        this._emitDoubleSidedTri(target, v0, v1, topCenter, normal, [
          makeColor(mixColorArrays(coreColor, palette.petalEdge, 0.2), 0.95),
          makeColor(mixColorArrays(coreColor, palette.petalEdge, 0.2), 0.95),
          makeColor(lightenColorArray(coreColor, 0.05), 0.98),
        ]);
      }

      // 層疊花型保持光滑中心，不生成額外花蕊
    };

    const emitFanVariant = () => {
      emitStemPanels(stemBottom, stemTop, stemRadius, stemRotation, stemBottomColor, stemTopColor);
      emitStemLeaves(stemBottom, stemHeight, stemRotation);

      const petalCount = 7;
      const radialSegments = 5;
      const petalLength = 0.46 * scale;
      const petalBaseWidth = 0.22 * scale;
      const curveHeight = 0.12 * scale;
      const twistAmplitude = 0.08 * scale;
      const petalAlpha = 0.94;
      const petalBaseColor = palette.petalBase;
      const petalEdgeColor = palette.petalEdge;

      for (let i = 0; i < petalCount; i += 1) {
        const baseAngle = (i / petalCount) * Math.PI * 2;
        const dirX = Math.cos(baseAngle);
        const dirZ = Math.sin(baseAngle);
        const rightX = -dirZ;
        const rightZ = dirX;
        let prevLeft = null;
        let prevRight = null;
        for (let seg = 0; seg <= radialSegments; seg += 1) {
          const t = seg / radialSegments;
          const length = petalLength * t;
          const width = petalBaseWidth * (1 - t * 0.7);
          const curve = Math.sin(t * Math.PI) * curveHeight;
          const twist = Math.sin(t * Math.PI) * twistAmplitude * random3D(worldX, worldY, worldZ, 951 + i * 13 + seg);

          const center = [
            stemTopCenter[0] + dirX * length,
            bloomBottom + (bloomTop - bloomBottom) * t + curve,
            stemTopCenter[2] + dirZ * length,
          ];
          const rightOffset = [rightX * width + dirX * twist, 0, rightZ * width + dirZ * twist];
          const left = [center[0] - rightOffset[0], center[1], center[2] - rightOffset[2]];
          const right = [center[0] + rightOffset[0], center[1], center[2] + rightOffset[2]];

          if (prevLeft && prevRight) {
            const normal = this._computeQuadNormal(prevLeft, prevRight, right);
            const colorLower = mixColorArrays(petalBaseColor, petalEdgeColor, Math.pow(Math.max(t - 1 / radialSegments, 0), 0.7));
            const colorUpper = mixColorArrays(petalBaseColor, petalEdgeColor, Math.pow(t, 0.7));
            this._emitDoubleSidedQuad(target, [prevLeft, prevRight, right, left], normal, [
              makeColor(colorLower, petalAlpha),
              makeColor(colorLower, petalAlpha),
              makeColor(colorUpper, petalAlpha),
              makeColor(colorUpper, petalAlpha),
            ]);
          }

          prevLeft = left;
          prevRight = right;
        }

        const tipCenter = [
          stemTopCenter[0] + dirX * petalLength,
          bloomTop + curveHeight * 0.3,
          stemTopCenter[2] + dirZ * petalLength,
        ];
        const tipNormal = this._computeQuadNormal(prevLeft, prevRight, tipCenter);
        const tipColor = mixColorArrays(petalEdgeColor, petalBaseColor, 0.6);
        this._emitDoubleSidedTri(target, prevLeft, prevRight, tipCenter, tipNormal, [
          makeColor(tipColor, petalAlpha * 0.95),
          makeColor(tipColor, petalAlpha * 0.95),
          makeColor(lightenColorArray(tipColor, 0.1), petalAlpha * 0.9),
        ]);
      }

      const coreRadius = Math.min(0.12 * scale, 0.1);
      const coreCenter = [stemTopCenter[0], bloomTop - Math.min(0.015 * scale, 0.012), stemTopCenter[2]];
      emitFlatDisc(coreCenter, coreRadius, Math.min(0.026 * scale, 0.022), mixColorArrays(palette.center ?? FLOWER_CENTER_COLOR, palette.petalEdge, 0.25), 0.92, 14);
    };

    const styleSeed = random3D(worldX, worldY, worldZ, 905);
    const variantIndex = Math.floor(styleSeed * 3) % 3;
    if (variantIndex === 0) {
      emitVolumetricVariant();
      return;
    }
    if (variantIndex === 1) {
      emitLayeredVariant();
      return;
    }
    emitFanVariant();
  }

  _emitTaperedPetal(target, right, bottomCenter, topCenter, bottomWidth, topWidth, bottomColor, topColor) {
    const verts = [
      [bottomCenter[0] - right[0] * bottomWidth, bottomCenter[1], bottomCenter[2] - right[2] * bottomWidth],
      [topCenter[0] - right[0] * topWidth, topCenter[1], topCenter[2] - right[2] * topWidth],
      [topCenter[0] + right[0] * topWidth, topCenter[1], topCenter[2] + right[2] * topWidth],
      [bottomCenter[0] + right[0] * bottomWidth, bottomCenter[1], bottomCenter[2] + right[2] * bottomWidth],
    ];
    const normal = this._computeQuadNormal(verts[0], verts[1], verts[2]);
    this._emitDoubleSidedQuad(target, verts, normal, [
      [...bottomColor],
      [...topColor],
      [...topColor],
      [...bottomColor],
    ]);
  }

  _emitDoubleSidedQuad(target, vertices, normal, colors, uvs = null) {
    this._emitQuad(target, vertices, normal, colors, uvs);
    const reversedVertices = [vertices[0], vertices[3], vertices[2], vertices[1]];
    const reversedColors = [colors[0], colors[3], colors[2], colors[1]].map((c) => [...c]);
    let reversedUvs = null;
    if (uvs) {
      reversedUvs = [
        uvs[0], uvs[1],
        uvs[6], uvs[7],
        uvs[4], uvs[5],
        uvs[2], uvs[3],
      ];
    }
    this._emitQuad(target, reversedVertices, [-normal[0], -normal[1], -normal[2]], reversedColors, reversedUvs);
  }

  _emitQuad(target, vertices, normal, colors, uvs = null) {
    const base = target.positions.length / 3;
    const neutral = uvs ? null : this._getNeutralUV();
    for (let i = 0; i < 4; i += 1) {
      const v = vertices[i];
      target.positions.push(v[0], v[1], v[2]);
      target.normals.push(normal[0], normal[1], normal[2]);
      const c = colors[i];
      target.colors.push(c[0], c[1], c[2], c[3] ?? 1);
      if (uvs) {
        target.uvs.push(uvs[i * 2], uvs[i * 2 + 1]);
      } else {
        target.uvs.push(neutral[0], neutral[1]);
      }
    }
    target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  _emitDoubleSidedTri(target, v0, v1, v2, normal, colors, uvs = null) {
    this._emitTri(target, v0, v1, v2, normal, colors, uvs);
    this._emitTri(target, v0, v2, v1, [-normal[0], -normal[1], -normal[2]], colors.map((c) => [...c]), uvs);
  }

  _emitTri(target, v0, v1, v2, normal, colors, uvs = null) {
    const base = target.positions.length / 3;
    const verts = [v0, v1, v2];
    const neutral = uvs ? null : this._getNeutralUV();
    for (let i = 0; i < 3; i += 1) {
      const v = verts[i];
      target.positions.push(v[0], v[1], v[2]);
      target.normals.push(normal[0], normal[1], normal[2]);
      const c = colors[i];
      target.colors.push(c[0], c[1], c[2], c[3] ?? 1);
      if (uvs) {
        target.uvs.push(uvs[i * 2], uvs[i * 2 + 1]);
      } else {
        target.uvs.push(neutral[0], neutral[1]);
      }
    }
    target.indices.push(base, base + 1, base + 2);
  }

  _colorWithAlpha(color, alpha) {
    return [color[0], color[1], color[2], alpha];
  }

  _getNeutralUV() {
    return this.atlas?.getNeutralUV() ?? [0.5, 0.5];
  }

  _computeQuadNormal(v0, v1, v2) {
    const ax = v1[0] - v0[0];
    const ay = v1[1] - v0[1];
    const az = v1[2] - v0[2];
    const bx = v2[0] - v0[0];
    const by = v2[1] - v0[1];
    const bz = v2[2] - v0[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    return [nx / length, ny / length, nz / length];
  }
}
