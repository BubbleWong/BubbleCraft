import {
  CHUNK_SIZE,
  CHUNK_HEIGHT,
  BLOCK_TYPES,
  SEA_LEVEL,
  EXTENDED_WORLD_RADIUS,
  MAX_CHUNK_LOADS_PER_TICK,
} from '../constants.js';
import { Chunk } from './chunk/Chunk.js';
import { ChunkMesher } from './chunk/ChunkMesher.js';
import { TerrainGenerator } from './generation/TerrainGenerator.js';
import { ImprovedNoise } from './generation/ImprovedNoise.js';
import { BlockAtlas } from './textures/BlockAtlas.js';

const WORK_CHUNK_RADIUS = 5;
const MAX_BLOCK_TYPE = Math.max(...Object.values(BLOCK_TYPES));
const NON_COLLIDING_BLOCKS = new Set([BLOCK_TYPES.air, BLOCK_TYPES.flower, BLOCK_TYPES.water]);

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VoxelWorld {
  constructor(context, { chunkRadius = WORK_CHUNK_RADIUS, maxRadius = EXTENDED_WORLD_RADIUS } = {}) {
    this.context = context;
    this.eventBus = context?.eventBus ?? null;
    this.scene = context?.scene ?? null;
    this.chunkRadius = Math.max(1, Math.floor(chunkRadius));
    this.maxChunkRadius = Math.max(this.chunkRadius, Math.floor(maxRadius));
    this.noise = new ImprovedNoise();
    this.seed = Math.random() * 10_000;
    this.chunks = new Map();
    this.chunkList = [];
    this.generatedRadius = 0;
    this._queuedRadius = 0;
    this._generationQueue = [];
    this._queuedChunkKeys = new Set();
    this._pendingRingLoads = new Map();
    this.blockTotals = new Array(MAX_BLOCK_TYPE + 1).fill(0);
    this.maxBlockType = MAX_BLOCK_TYPE;
    this.generator = new TerrainGenerator(this);
    this.blockAtlas = this.scene ? new BlockAtlas(this.scene) : null;
    this.chunkMesher = new ChunkMesher({
      getNeighborBlock: (chunk, lx, y, lz, dir) => this._getNeighborBlock(chunk, lx, y, lz, dir),
      random2D: this.random2D.bind(this),
      random3D: this.random3D.bind(this),
      atlas: this.blockAtlas,
    });

    this._spawnPoint = new BABYLON.Vector3(0, SEA_LEVEL + 4, 0);

    this.solidMaterial = this.scene ? new BABYLON.StandardMaterial('vox-solid', this.scene) : null;
    if (this.solidMaterial) {
      this.solidMaterial.useVertexColor = true;
      this.solidMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
      this.solidMaterial.useVertexAlpha = true;
      if (this.blockAtlas?.texture) {
        this.solidMaterial.diffuseTexture = this.blockAtlas.texture;
        this.solidMaterial.diffuseTexture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
        this.solidMaterial.diffuseTexture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        this.solidMaterial.diffuseTexture.hasAlpha = false;
      }
      this.solidMaterial.backFaceCulling = true;
    }

    this.waterMaterial = this.scene ? new BABYLON.StandardMaterial('vox-water', this.scene) : null;
    if (this.waterMaterial) {
      this.waterMaterial.useVertexColor = true;
      this.waterMaterial.alpha = 0.6;
      this.waterMaterial.backFaceCulling = false;
      this.waterMaterial.needDepthPrePass = true;
      this.waterMaterial.useVertexAlpha = true;
      this.waterMaterial.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      if (this.blockAtlas?.texture) {
        this.waterMaterial.diffuseTexture = this.blockAtlas.texture;
        this.waterMaterial.diffuseTexture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
        this.waterMaterial.diffuseTexture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
      }
    }
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
          await sleep(0);
        }
      }
    }

    this._spawnPoint = this._computeSpawnPoint();
    this.generatedRadius = this.chunkRadius;
    this._queuedRadius = this.chunkRadius;
    return { spawnPoint: this.getSpawnPoint() };
  }

  dispose() {
    for (const chunk of this.chunkList) {
      this._disposeChunk(chunk);
    }
    this.chunkList.length = 0;
    this.chunks.clear();
    this._generationQueue.length = 0;
    this._queuedChunkKeys.clear();
    this._pendingRingLoads.clear();
    this.generatedRadius = 0;
    this._queuedRadius = 0;
    this.solidMaterial?.dispose();
    this.solidMaterial = null;
    this.waterMaterial?.dispose();
    this.waterMaterial = null;
    this.blockAtlas?.dispose?.();
    this.blockAtlas = null;
    this.chunkMesher = null;
  }

  getSpawnPoint() {
    return this._spawnPoint.clone();
  }

  getBlockTotals() {
    return this.blockTotals;
  }

  updateStreaming(position) {
    if (position) {
      this._scheduleExpansion(position);
    }
    this._pumpGenerationQueue();
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

    this.eventBus?.emit('world:blockChange', {
      position: { x, y, z },
      previousType,
      nextType: blockType,
      chunk,
    });

    return true;
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

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz)) ?? null;
  }

  _ensureChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk({ world: this, cx, cz, maxBlockType: this.maxBlockType });
      this.generator.populate(chunk);
      this.chunks.set(key, chunk);
      this._applyChunkCounts(chunk, 1);
      this.eventBus?.emit('world:chunkGenerated', { chunk });
    }
    return chunk;
  }

  _buildChunkMeshes(chunk) {
    if (!this.scene) return;
    const geometry = this.chunkMesher.buildGeometry(chunk);
    chunk.disposeMeshes();

    if (geometry.solid) {
      chunk.mesh = this._createMesh(`chunk-solid-${chunk.cx}-${chunk.cz}`, geometry.solid, this.solidMaterial, chunk, {
        pickable: true,
        type: 'solid',
      });
    }

    if (geometry.water) {
      chunk.waterMesh = this._createMesh(`chunk-water-${chunk.cx}-${chunk.cz}`, geometry.water, this.waterMaterial, chunk, {
        pickable: false,
        alphaIndex: 10,
        type: 'water',
      });
    }
  }

  _createMesh(name, geometry, material, chunk, { pickable = true, alphaIndex = 0, type = 'solid' } = {}) {
    if (!this.scene || !geometry) return null;
    const mesh = new BABYLON.Mesh(name, this.scene);
    const vertexData = new BABYLON.VertexData();
    vertexData.positions = geometry.positions;
    vertexData.normals = geometry.normals;
    vertexData.colors = geometry.colors;
    vertexData.uvs = geometry.uvs;
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

  _disposeChunk(chunk) {
    this._applyChunkCounts(chunk, -1);
    chunk.disposeMeshes();
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

  _computeSpawnPoint() {
    const maxInteriorRadius = Math.max(2, Math.min(this.chunkRadius - 1, Math.floor(this.chunkRadius * 0.4)));
    const span = maxInteriorRadius * CHUNK_SIZE;
    const attempts = Math.max(48, maxInteriorRadius * maxInteriorRadius * 4);
    let best = null;

    for (let i = 0; i < attempts; i += 1) {
      const worldX = Math.floor((Math.random() * 2 - 1) * span);
      const worldZ = Math.floor((Math.random() * 2 - 1) * span);
      const surfaceY = Math.floor(this.getSurfaceHeight(worldX, worldZ));
      const groundType = this.getBlockAtWorld(worldX, surfaceY - 1, worldZ);
      const headSpace = this.getBlockAtWorld(worldX, surfaceY, worldZ);
      if (groundType === BLOCK_TYPES.water || headSpace !== BLOCK_TYPES.air) continue;
      const distance = Math.abs(worldX) + Math.abs(worldZ);
      if (!best || surfaceY > best.surfaceY || (surfaceY === best.surfaceY && distance < best.distance)) {
        best = {
          x: worldX + 0.5,
          y: surfaceY,
          z: worldZ + 0.5,
          surfaceY,
          distance,
        };
      }
    }

    if (!best) return this._computeSpawnPointFallback();
    return new BABYLON.Vector3(best.x, best.y + 1.8, best.z);
  }

  _computeSpawnPointFallback() {
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

  _scheduleExpansion(position) {
    const chunkX = Math.floor(position.x / CHUNK_SIZE);
    const chunkZ = Math.floor(position.z / CHUNK_SIZE);
    const distance = Math.max(Math.abs(chunkX), Math.abs(chunkZ));
    const desiredRadius = Math.min(this.maxChunkRadius, distance + this.chunkRadius);
    if (desiredRadius <= this._queuedRadius) return;
    this._queueRings(this._queuedRadius + 1, desiredRadius);
    this._queuedRadius = desiredRadius;
  }

  _queueRings(startRadius, endRadius) {
    for (let radius = startRadius; radius <= endRadius; radius += 1) {
      let needed = 0;
      for (let cz = -radius; cz <= radius; cz += 1) {
        for (let cx = -radius; cx <= radius; cx += 1) {
          if (Math.max(Math.abs(cx), Math.abs(cz)) !== radius) continue;
          const key = chunkKey(cx, cz);
          if (this.chunks.has(key) || this._queuedChunkKeys.has(key)) continue;
          this._queuedChunkKeys.add(key);
          this._generationQueue.push({ cx, cz, key, radius });
          needed += 1;
        }
      }

      if (needed === 0) {
        this._markRingComplete(radius);
      } else {
        const current = this._pendingRingLoads.get(radius) ?? 0;
        this._pendingRingLoads.set(radius, current + needed);
      }
    }
  }

  _pumpGenerationQueue(maxLoads = MAX_CHUNK_LOADS_PER_TICK) {
    let processed = 0;
    while (processed < maxLoads && this._generationQueue.length > 0) {
      const { cx, cz, key, radius } = this._generationQueue.shift();
      this._queuedChunkKeys.delete(key);
      const existed = this.chunks.has(key);
      const chunk = this._ensureChunk(cx, cz);
      if (!existed) {
        this.chunkList.push(chunk);
      }
      this._buildChunkMeshes(chunk);
      this._markRingChunkGenerated(radius);
      processed += 1;
    }
  }

  _markRingChunkGenerated(radius) {
    if (!this._pendingRingLoads.has(radius)) {
      this._updateGeneratedRadius();
      return;
    }
    const remaining = this._pendingRingLoads.get(radius) - 1;
    if (remaining <= 0) {
      this._pendingRingLoads.delete(radius);
      this._updateGeneratedRadius();
    } else {
      this._pendingRingLoads.set(radius, remaining);
    }
  }

  _markRingComplete(radius) {
    this._pendingRingLoads.delete(radius);
    this._updateGeneratedRadius();
  }

  _updateGeneratedRadius() {
    while (this.generatedRadius < this._queuedRadius) {
      const nextRadius = this.generatedRadius + 1;
      if (this._pendingRingLoads.has(nextRadius)) break;
      this.generatedRadius = nextRadius;
    }
  }
}
