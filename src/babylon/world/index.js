import {
  CHUNK_SIZE,
  CHUNK_HEIGHT,
  BLOCK_TYPES,
  BLOCK_COLORS,
  SEA_LEVEL,
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

const WORK_CHUNK_RADIUS = 5;

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

class Chunk {
  constructor(world, cx, cz) {
    this.world = world;
    this.cx = cx;
    this.cz = cz;
    this.origin = new BABYLON.Vector3(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    this.mesh = null;
    this.waterMesh = null;
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
    this.blocks[this.index(lx, y, lz)] = type;
  }

  generate() {
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

        const flowerChance = this.world.random2D(worldX, worldZ, 97);
        if (flowerChance > 0.9 && terrainHeight + 1 < CHUNK_HEIGHT && surfaceBlock === BLOCK_TYPES.grass) {
          this.set(lx, terrainHeight + 1, lz, BLOCK_TYPES.flower);
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
    }
    return chunk;
  }

  _buildChunkMeshes(chunk) {
    const geometry = this._buildGeometry(chunk);
    if (!geometry) return;

    this._disposeChunkMeshes(chunk);

    chunk.mesh = this._createMesh(`chunk-solid-${chunk.cx}-${chunk.cz}`, geometry.solid, this.solidMaterial, chunk.origin, {
      pickable: true,
    });

    chunk.waterMesh = this._createMesh(`chunk-water-${chunk.cx}-${chunk.cz}`, geometry.water, this.waterMaterial, chunk.origin, {
      pickable: false,
      alphaIndex: 10,
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

  _createMesh(name, geometry, material, origin, { pickable = true, alphaIndex = 0 } = {}) {
    if (!geometry) return null;
    const mesh = new BABYLON.Mesh(name, this.scene);
    const vertexData = new BABYLON.VertexData();
    vertexData.positions = geometry.positions;
    vertexData.normals = geometry.normals;
    vertexData.colors = geometry.colors;
    vertexData.indices = geometry.indices;
    vertexData.applyToMesh(mesh, true);
    mesh.position.copyFrom(origin);
    mesh.material = material;
    mesh.isPickable = pickable;
    mesh.alphaIndex = alphaIndex;
    mesh.receiveShadows = true;
    return mesh;
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
}
