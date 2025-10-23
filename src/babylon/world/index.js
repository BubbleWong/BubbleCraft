import {
  CHUNK_SIZE,
  CHUNK_HEIGHT,
  BLOCK_TYPES,
  BLOCK_COLORS,
  SEA_LEVEL,
  FLOWER_COLOR_VARIANTS,
  FLOWER_CENTER_COLOR,
  FLOWER_STEM_COLOR,
} from '../../constants.js';
import { ImprovedNoise } from '../../vendor/ImprovedNoise.js';

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
const NON_COLLIDING_BLOCKS = new Set([BLOCK_TYPES.air, BLOCK_TYPES.flower, BLOCK_TYPES.water]);
const PASSABLE_BLOCKS = NON_COLLIDING_BLOCKS;

const WORK_CHUNK_RADIUS = 5;
const MAX_BLOCK_TYPE = Math.max(...Object.values(BLOCK_TYPES));

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
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

const WHITE_COLOR = [1, 1, 1];
const BLACK_COLOR = [0, 0, 0];

function lightenColorArray(color, amount) {
  return mixColorArrays(color, WHITE_COLOR, clamp01(amount));
}

function darkenColorArray(color, amount) {
  return mixColorArrays(color, BLACK_COLOR, clamp01(amount));
}

function adjustRandomColorArray(color, randomFn, worldX, worldY, worldZ, salt, magnitude = 0.12) {
  const offset = randomFn(worldX, worldY, worldZ, salt) * 2 - 1;
  if (offset >= 0) return lightenColorArray(color, offset * magnitude);
  return darkenColorArray(color, -offset * magnitude);
}

function adjustColor(color, amount) {
  return [
    clamp01(color[0] + amount),
    clamp01(color[1] + amount),
    clamp01(color[2] + amount),
  ];
}

class Chunk {
  constructor(world, cx, cz) {
    this.world = world;
    this.cx = cx;
    this.cz = cz;
    this.origin = new BABYLON.Vector3(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    this.mesh = null;
    this.waterMesh = null;
    this.counts = new Uint32Array(MAX_BLOCK_TYPE + 1);
    this.generate();
  }

  index(lx, y, lz) {
    return lx + CHUNK_SIZE * (lz + CHUNK_SIZE * y);
  }

  get(lx, y, lz) {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT) {
      return BLOCK_TYPES.air;
    }
    return this.blocks[this.index(lx, y, lz)];
  }

  set(lx, y, lz, type) {
    const idx = this.index(lx, y, lz);
    const prev = this.blocks[idx];
    if (prev === type) return false;
    this.blocks[idx] = type;
    if (this.counts[prev] > 0) this.counts[prev] -= 1;
    this.counts[type] += 1;
    return true;
  }

  generate() {
    this.counts.fill(0);
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        const worldX = this.origin.x + lx;
        const worldZ = this.origin.z + lz;
        const terrainHeight = this.world.sampleTerrainHeight(worldX, worldZ);
        const surfaceBlock = terrainHeight <= SEA_LEVEL + 1 ? BLOCK_TYPES.sand : BLOCK_TYPES.grass;
        const top = Math.max(terrainHeight, SEA_LEVEL);

        for (let y = 0; y <= top; y += 1) {
          let block = BLOCK_TYPES.stone;
          if (y === terrainHeight) {
            block = surfaceBlock;
          } else if (y > terrainHeight - 3) {
            block = BLOCK_TYPES.dirt;
          }
          this.set(lx, y, lz, block);
        }

        if (terrainHeight < SEA_LEVEL) {
          for (let y = terrainHeight + 1; y <= SEA_LEVEL; y += 1) {
            this.set(lx, y, lz, BLOCK_TYPES.water);
          }
        }

        if (surfaceBlock === BLOCK_TYPES.grass && terrainHeight + 1 < CHUNK_HEIGHT) {
          if (this._maybePlaceTree(lx, terrainHeight, lz, worldX, worldZ)) {
            continue;
          }
          const flowerChance = this.world.random2D(worldX, worldZ, 97);
          if (flowerChance > 0.88) {
            this.set(lx, terrainHeight + 1, lz, BLOCK_TYPES.flower);
          }
        }
      }
    }
  }

  _maybePlaceTree(lx, groundY, lz, worldX, worldZ) {
    const treeChance = this.world.random2D(worldX, worldZ, 37);
    if (treeChance <= 0.82) return false;
    const heightRand = this.world.random2D(worldX, worldZ, 53);
    const treeHeight = 4 + Math.floor(heightRand * 3);
    if (!this._canPlaceTree(lx, groundY, lz, treeHeight)) return false;
    this._placeTree(lx, groundY, lz, treeHeight, worldX, worldZ);
    return true;
  }

  _canPlaceTree(lx, groundY, lz, height) {
    const radius = 2;
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
          if (!PASSABLE_BLOCKS.has(check)) return false;
        }
      }
    }
    return true;
  }

  _placeTree(lx, groundY, lz, height, worldX, worldZ) {
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
          if (PASSABLE_BLOCKS.has(this.get(targetX, targetY, targetZ))) {
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
      if (this.get(fx, groundY, fz) === BLOCK_TYPES.grass && PASSABLE_BLOCKS.has(this.get(fx, flowerY, fz))) {
        const chance = this.world.random2D(worldX + dx * 3, worldZ + dz * 3, 127);
        if (chance > 0.65) {
          this.set(fx, flowerY, fz, BLOCK_TYPES.flower);
        }
      }
    }
  }
}

export class VoxelWorld {
  constructor(scene, { chunkRadius = WORK_CHUNK_RADIUS } = {}) {
    this.scene = scene;
    this.chunkRadius = Math.max(1, Math.floor(chunkRadius));
    this.noise = new ImprovedNoise();
    this.seed = Math.random() * 10_000;
    this.chunks = new Map();
    this.chunkList = [];
    this.solidMaterial = new BABYLON.StandardMaterial('vox-solid', scene);
    this.solidMaterial.useVertexColor = true;
    this.solidMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    this.solidMaterial.useVertexAlpha = true;

    this.waterMaterial = new BABYLON.StandardMaterial('vox-water', scene);
    this.waterMaterial.useVertexColor = true;
    this.waterMaterial.alpha = 0.6;
    this.waterMaterial.backFaceCulling = false;
    this.waterMaterial.needDepthPrePass = true;
    this.waterMaterial.useVertexAlpha = true;
    this.waterMaterial.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;

    this._spawnPoint = new BABYLON.Vector3(0, SEA_LEVEL + 4, 0);
    this.blockTotals = new Array(MAX_BLOCK_TYPE + 1).fill(0);
  }

  async generate(onProgress = null) {
    const total = (this.chunkRadius * 2 + 1) ** 2;
    let processed = 0;

    for (let cz = -this.chunkRadius; cz <= this.chunkRadius; cz += 1) {
      for (let cx = -this.chunkRadius; cx <= this.chunkRadius; cx += 1) {
        const chunk = this._ensureChunk(cx, cz);
        this.chunkList.push(chunk);
        this._buildChunkMeshes(chunk);
        processed += 1;
        if (typeof onProgress === 'function') {
          onProgress(processed / total);
        }
        if (processed % 4 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }

    this._spawnPoint = this._computeSpawnPoint();
    return { spawnPoint: this.getSpawnPoint() };
  }

  dispose() {
    for (const chunk of this.chunkList) {
      this._disposeChunk(chunk);
    }
    this.chunkList.length = 0;
    this.chunks.clear();
  }

  getSpawnPoint() {
    return this._spawnPoint.clone();
  }

  sampleTerrainHeight(x, z) {
    const base = 24;
    let amplitude = 16;
    let frequency = 0.035;
    let value = 0;

    for (let octave = 0; octave < 4; octave += 1) {
      const noiseValue = this.noise.noise(x * frequency, this.seed + octave * 54.321, z * frequency);
      value += noiseValue * amplitude;
      amplitude *= 0.5;
      frequency *= 1.9;
    }

    const height = base + value;
    return Math.max(2, Math.min(CHUNK_HEIGHT - 2, Math.floor(height)));
  }

  random2D(x, z, salt = 0) {
    const s = Math.sin((x * 12_989.8 + z * 78_233.1 + (this.seed + salt) * 0.125) * 0.5);
    return s - Math.floor(s);
  }

  random3D(x, y, z, salt = 0) {
    const s = Math.sin((x * 12_989.8 + y * 78_233.1 + z * 37_513.7 + (this.seed + salt) * 0.223) * 0.5);
    return s - Math.floor(s);
  }

  getSurfaceHeight(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return SEA_LEVEL + 3;
    const lx = Math.floor(x - chunk.origin.x);
    const lz = Math.floor(z - chunk.origin.z);
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y -= 1) {
      const type = chunk.get(lx, y, lz);
      if (!NON_COLLIDING_BLOCKS.has(type)) {
        return y + 1;
      }
    }
    return SEA_LEVEL + 3;
  }

  _ensureChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(this, cx, cz);
      this.chunks.set(key, chunk);
      this._applyChunkCounts(chunk, 1);
    }
    return chunk;
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz)) ?? null;
  }

  _buildChunkMeshes(chunk) {
    const geometry = this._buildGeometry(chunk);
    if (!geometry) return;

    this._disposeChunkMeshes(chunk);

    chunk.mesh = this._createMesh(`chunk-solid-${chunk.cx}-${chunk.cz}`, geometry.solid, this.solidMaterial, chunk, {
      pickable: true,
      type: 'solid',
    });

    chunk.waterMesh = this._createMesh(`chunk-water-${chunk.cx}-${chunk.cz}`, geometry.water, this.waterMaterial, chunk, {
      pickable: false,
      alphaIndex: 10,
      type: 'water',
    });

  }

  _disposeChunkMeshes(chunk) {
    if (chunk.mesh) {
      chunk.mesh.dispose(false, true);
      chunk.mesh = null;
    }
    if (chunk.waterMesh) {
      chunk.waterMesh.dispose(false, true);
      chunk.waterMesh = null;
    }
  }

  _disposeChunk(chunk) {
    this._applyChunkCounts(chunk, -1);
    this._disposeChunkMeshes(chunk);
  }

  _buildGeometry(chunk) {
    const solid = { positions: [], normals: [], colors: [], indices: [] };
    const water = { positions: [], normals: [], colors: [], indices: [] };

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

          for (const face of FACE_DEFS) {
            const neighbor = this._getNeighborBlock(chunk, lx, y, lz, face.dir);
            const transparentNeighbor = TRANSPARENT_BLOCKS.has(neighbor) || (neighbor === BLOCK_TYPES.water && blockType !== BLOCK_TYPES.water);
            if (!transparentNeighbor) continue;

            const shade = blockType === BLOCK_TYPES.water ? 0.95 : face.shade;
            const color = makeColor(baseColor, shade);
            const alpha = blockType === BLOCK_TYPES.water ? 0.68 : 1.0;
            const vertexBase = target.positions.length / 3;

            for (let i = 0; i < 4; i += 1) {
              const corner = face.corners[i];
              target.positions.push(lx + corner[0], y + corner[1], lz + corner[2]);
              target.normals.push(face.dir[0], face.dir[1], face.dir[2]);
              target.colors.push(color[0], color[1], color[2], alpha);
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

  _getNeighborBlock(chunk, lx, y, lz, dir) {
    const nx = lx + dir[0];
    const ny = y + dir[1];
    const nz = lz + dir[2];
    if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE && ny >= 0 && ny < CHUNK_HEIGHT) {
      return chunk.get(nx, ny, nz);
    }

    const worldX = chunk.origin.x + nx;
    const worldZ = chunk.origin.z + nz;
    const cx = Math.floor(worldX / CHUNK_SIZE);
    const cz = Math.floor(worldZ / CHUNK_SIZE);
    const neighborChunk = this.chunks.get(chunkKey(cx, cz));
    if (!neighborChunk) return BLOCK_TYPES.air;
    const localX = (worldX % CHUNK_SIZE + CHUNK_SIZE) % CHUNK_SIZE;
    const localZ = (worldZ % CHUNK_SIZE + CHUNK_SIZE) % CHUNK_SIZE;
    return neighborChunk.get(localX, ny, localZ);
  }

  _finalizeGeometry(data) {
    if (data.positions.length === 0) return null;
    return {
      positions: new Float32Array(data.positions),
      normals: new Float32Array(data.normals),
      colors: new Float32Array(data.colors),
      indices: new Uint32Array(data.indices),
    };
  }

  _createMesh(name, geometry, material, chunk, { pickable = true, alphaIndex = 0, type = 'solid' } = {}) {
    if (!geometry) return null;
    const mesh = new BABYLON.Mesh(name, this.scene);
    const vertexData = new BABYLON.VertexData();
    vertexData.positions = geometry.positions;
    vertexData.normals = geometry.normals;
    vertexData.colors = geometry.colors;
    vertexData.indices = geometry.indices;
    vertexData.applyToMesh(mesh, true);
    mesh.position.copyFrom(chunk.origin);
    mesh.material = material;
    mesh.isPickable = pickable;
    mesh.alphaIndex = alphaIndex;
    mesh.receiveShadows = true;
    mesh.metadata = { chunk, type };
    return mesh;
  }

  setBlockAtWorld(x, y, z, blockType) {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return false;

    const lx = Math.floor(x - chunk.origin.x);
    const lz = Math.floor(z - chunk.origin.z);
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return false;

    const previousType = chunk.get(lx, y, lz);
    const updated = chunk.set(lx, y, lz, blockType);
    if (!updated) return false;

    this._updateBlockTotals(previousType, blockType);

    this._buildChunkMeshes(chunk);
    this._rebuildNeighborIfNeeded(cx, cz, lx, lz);

    return true;
  }

  _rebuildNeighborIfNeeded(cx, cz, lx, lz) {
    const neighborSpecs = [];
    if (lx === 0) neighborSpecs.push([cx - 1, cz]);
    if (lx === CHUNK_SIZE - 1) neighborSpecs.push([cx + 1, cz]);
    if (lz === 0) neighborSpecs.push([cx, cz - 1]);
    if (lz === CHUNK_SIZE - 1) neighborSpecs.push([cx, cz + 1]);

    for (const [ncx, ncz] of neighborSpecs) {
      const neighbor = this.getChunk(ncx, ncz);
      if (neighbor) this._buildChunkMeshes(neighbor);
    }
  }

  getBlockAtWorld(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return BLOCK_TYPES.air;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return BLOCK_TYPES.air;
    const lx = Math.floor(x - chunk.origin.x);
    const lz = Math.floor(z - chunk.origin.z);
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
      return BLOCK_TYPES.air;
    }
    return chunk.get(lx, y, lz);
  }

  _rebuildNeighborIfNeeded(cx, cz, lx, lz) {
    const neighborSpecs = [];
    if (lx === 0) neighborSpecs.push([cx - 1, cz]);
    if (lx === CHUNK_SIZE - 1) neighborSpecs.push([cx + 1, cz]);
    if (lz === 0) neighborSpecs.push([cx, cz - 1]);
    if (lz === CHUNK_SIZE - 1) neighborSpecs.push([cx, cz + 1]);

    for (const [ncx, ncz] of neighborSpecs) {
      const neighbor = this.getChunk(ncx, ncz);
      if (neighbor) this._buildChunkMeshes(neighbor);
    }
  }

  _emitDoubleSidedQuad(target, vertices, normal, colors) {
    this._emitQuad(target, vertices, normal, colors);
    const reversedVertices = [vertices[0], vertices[3], vertices[2], vertices[1]];
    const reversedColors = [colors[0], colors[3], colors[2], colors[1]].map((c) => [...c]);
    this._emitQuad(target, reversedVertices, [-normal[0], -normal[1], -normal[2]], reversedColors);
  }

  _emitQuad(target, vertices, normal, colors) {
    const base = target.positions.length / 3;
    for (let i = 0; i < 4; i += 1) {
      const v = vertices[i];
      target.positions.push(v[0], v[1], v[2]);
      target.normals.push(normal[0], normal[1], normal[2]);
      const c = colors[i];
      target.colors.push(c[0], c[1], c[2], c[3] ?? 1);
    }
    target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  _emitDoubleSidedTri(target, v0, v1, v2, normal, colors) {
    this._emitTri(target, v0, v1, v2, normal, colors);
    this._emitTri(target, v0, v2, v1, [-normal[0], -normal[1], -normal[2]], colors.map((c) => [...c]));
  }

  _emitTri(target, v0, v1, v2, normal, colors) {
    const base = target.positions.length / 3;
    const verts = [v0, v1, v2];
    for (let i = 0; i < 3; i += 1) {
      const v = verts[i];
      target.positions.push(v[0], v[1], v[2]);
      target.normals.push(normal[0], normal[1], normal[2]);
      const c = colors[i];
      target.colors.push(c[0], c[1], c[2], c[3] ?? 1);
    }
    target.indices.push(base, base + 1, base + 2);
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

  _colorWithAlpha(color, alpha) {
    return [color[0], color[1], color[2], alpha];
  }

  _emitFlowerGeometry(target, chunk, lx, y, lz, worldX, worldY, worldZ) {
    const centerX = lx + 0.5;
    const centerZ = lz + 0.5;
    const paletteIndex = Math.floor(this.random2D(worldX, worldZ, 731) * FLOWER_COLOR_VARIANTS.length) % FLOWER_COLOR_VARIANTS.length;
    const paletteVariant = FLOWER_COLOR_VARIANTS[paletteIndex] ?? FLOWER_COLOR_VARIANTS[0] ?? {
      petalBase: [0.95, 0.66, 0.84],
      petalEdge: [0.99, 0.93, 0.63],
      petalCenter: [0.67, 0.13, 0.39],
      center: FLOWER_CENTER_COLOR,
    };

    const random3D = this.random3D.bind(this);
    const random2D = this.random2D.bind(this);

    const scale = 0.65 + random3D(worldX, worldY, worldZ, 689) * 0.25;
    const heightScale = 0.85 + random3D(worldX, worldY, worldZ, 690) * 0.2;

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
        const baseY = bottomCenter[1] + height * heightFactor;
        const leafLength = 0.22 + random3D(worldX, worldY, worldZ, 880 + i) * 0.14;
        const leafWidth = 0.09 + random3D(worldX, worldY, worldZ, 890 + i) * 0.05;
        const leafAngle = rotation + (i % 2 === 0 ? 0 : Math.PI / 2) + (random3D(worldX, worldY, worldZ, 900 + i) - 0.5) * 0.5;
        const dir = [Math.cos(leafAngle), 0, Math.sin(leafAngle)];
        const right = [-dir[2], 0, dir[0]];
        const baseCenter = [
          bottomCenter[0] + dir[0] * 0.05,
          baseY,
          bottomCenter[2] + dir[2] * 0.05,
        ];
        const tipCenter = [
          baseCenter[0] + dir[0] * leafLength,
          baseY + 0.12 + random3D(worldX, worldY, worldZ, 910 + i) * 0.08,
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

      const coreRadius = Math.min(0.22, (0.12 + random3D(worldX, worldY, worldZ, 765) * 0.05) * scale);
      const coreBottom = Math.max(bloomBottom, bloomTop - Math.max(0.12, bloomExtra * 0.6));
      const coreTop = bloomTop;
      const coreRotation = rotation + Math.PI / 6;
      const coreCenter = [stemTopCenter[0], (coreBottom + coreTop) * 0.5, stemTopCenter[2]];
      emitBloomCore(coreCenter, coreBottom, coreTop, coreRadius, coreRotation, palette.center ?? FLOWER_CENTER_COLOR);
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

      const coreRadius = Math.min(0.2 * scale, 0.18);
      const coreBottom = Math.max(bloomBottom, bloomTop - Math.max(0.12, bloomExtra * 0.55));
      const coreTop = Math.min(bloomTop + 0.04 * scale, CHUNK_HEIGHT - 0.01);
      const coreRotation = random2D(worldX, worldZ, 906) * Math.PI * 2;
      const coreCenter = [stemTopCenter[0], (coreBottom + coreTop) * 0.5, stemTopCenter[2]];
      emitBloomCore(coreCenter, coreBottom, coreTop, coreRadius, coreRotation, coreColor);
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

      const coreRadius = Math.min(0.18 * scale, 0.15);
      const coreBottom = Math.max(bloomBottom, bloomTop - Math.max(0.1, bloomExtra * 0.55));
      const coreTop = bloomTop;
      const coreRotation = random2D(worldX, worldZ, 907) * Math.PI * 2;
      const coreCenter = [stemTopCenter[0], (coreBottom + coreTop) * 0.5, stemTopCenter[2]];
      emitBloomCore(coreCenter, coreBottom, coreTop, coreRadius, coreRotation, palette.center ?? FLOWER_CENTER_COLOR);
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
  _computeSpawnPoint() {
    let best = null;
    const radius = Math.max(1, this.chunkRadius);
    for (let z = -radius; z <= radius; z += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        const worldX = x * CHUNK_SIZE + CHUNK_SIZE * 0.5;
        const worldZ = z * CHUNK_SIZE + CHUNK_SIZE * 0.5;
        const surfaceY = this.getSurfaceHeight(worldX, worldZ);
        if (!best || surfaceY > best.y) {
          best = { x: worldX, y: surfaceY, z: worldZ };
        }
      }
    }
    if (!best) return new BABYLON.Vector3(0.5, SEA_LEVEL + 4, 0.5);
    return new BABYLON.Vector3(best.x, best.y + 1.8, best.z);
  }

  getBlockTotals() {
    return this.blockTotals;
  }

  _applyChunkCounts(chunk, delta) {
    if (!chunk?.counts) return;
    for (let i = 0; i < chunk.counts.length; i += 1) {
      const amount = chunk.counts[i];
      if (!amount) continue;
      const current = this.blockTotals[i] ?? 0;
      const next = current + delta * amount;
      this.blockTotals[i] = next < 0 ? 0 : next;
    }
  }

  _updateBlockTotals(previousType, nextType) {
    if (Number.isInteger(previousType) && previousType >= 0) {
      const current = this.blockTotals[previousType] ?? 0;
      const next = current - 1;
      this.blockTotals[previousType] = next < 0 ? 0 : next;
    }
    if (Number.isInteger(nextType) && nextType >= 0) {
      const current = this.blockTotals[nextType] ?? 0;
      this.blockTotals[nextType] = current + 1;
    }
  }
}
