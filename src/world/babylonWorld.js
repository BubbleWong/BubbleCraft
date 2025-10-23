import {
  CHUNK_SIZE,
  CHUNK_HEIGHT,
  BLOCK_TYPES,
  BLOCK_COLORS,
  SEA_LEVEL,
} from '../constants.js';
import { ImprovedNoise } from '../vendor/ImprovedNoise.js';

const PHYSICS_PLUGIN_VERSION_V2 = BABYLON.PhysicsPluginVersion?.V2 ?? (BABYLON.PhysicsPluginVersion_V2 ?? 2);

const FACE_DEFS = [
  { dir: [1, 0, 0], shade: 0.82, corners: [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]] },
  { dir: [-1, 0, 0], shade: 0.82, corners: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]] },
  { dir: [0, 1, 0], shade: 1.05, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, -1, 0], shade: 0.65, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], shade: 0.92, corners: [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]] },
  { dir: [0, 0, -1], shade: 0.76, corners: [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]] },
];

const TRIANGLE_ORDER = [0, 1, 2, 0, 2, 3];
const TRANSPARENT_BLOCKS = new Set([BLOCK_TYPES.air, BLOCK_TYPES.flower]);
const NON_COLLIDING_BLOCKS = new Set([BLOCK_TYPES.air, BLOCK_TYPES.flower, BLOCK_TYPES.water]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

function makeColorArray(baseColor, shade, alpha = 1) {
  const r = clamp(baseColor[0] * shade, 0, 1);
  const g = clamp(baseColor[1] * shade, 0, 1);
  const b = clamp(baseColor[2] * shade, 0, 1);
  return [r, g, b, alpha];
}

class Chunk {
  constructor(world, cx, cz) {
    this.world = world;
    this.cx = cx;
    this.cz = cz;
    this.origin = { x: cx * CHUNK_SIZE, y: 0, z: cz * CHUNK_SIZE };
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    this.mesh = null;
    this.waterMesh = null;
    this.physicsAggregate = null;
    this.generate();
  }

  index(lx, y, lz) {
    return lx + CHUNK_SIZE * (lz + CHUNK_SIZE * y);
  }

  get(lx, y, lz) {
    if (
      lx < 0 || lx >= CHUNK_SIZE ||
      lz < 0 || lz >= CHUNK_SIZE ||
      y < 0 || y >= CHUNK_HEIGHT
    ) {
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
        const columnHeight = this.world.sampleTerrainHeight(worldX, worldZ);
        const surfaceBlock = columnHeight <= SEA_LEVEL + 1 ? BLOCK_TYPES.sand : BLOCK_TYPES.grass;
        const maxLayer = Math.max(columnHeight, SEA_LEVEL);

        for (let y = 0; y <= maxLayer; y += 1) {
          let blockType = BLOCK_TYPES.stone;
          if (y === columnHeight) {
            blockType = surfaceBlock;
          } else if (y > columnHeight - 4) {
            blockType = BLOCK_TYPES.dirt;
          }
          this.set(lx, y, lz, blockType);
        }

        if (columnHeight < SEA_LEVEL) {
          for (let y = columnHeight + 1; y <= SEA_LEVEL; y += 1) {
            this.set(lx, y, lz, BLOCK_TYPES.water);
          }
        }

        // Sparse flowers for variety.
        const flowerChance = this.world.random2D(worldX, worldZ, 19);
        if (flowerChance > 0.86 && columnHeight + 1 < CHUNK_HEIGHT && surfaceBlock === BLOCK_TYPES.grass) {
          this.set(lx, columnHeight + 1, lz, BLOCK_TYPES.flower);
        }
      }
    }
  }
}

export class BabylonVoxelWorld {
  constructor(scene, { physics, chunkRadius = 4 } = {}) {
    this.scene = scene;
    this.physics = physics ?? null;
    this.physicsPluginVersion = this.scene.getPhysicsEngine?.()?.getPhysicsPluginVersion?.() ?? null;
    this.chunkRadius = Math.max(1, Math.floor(chunkRadius));
    this.noise = new ImprovedNoise();
    this.seed = Math.random() * 10_000;
    this.chunks = new Map();
    this.chunkList = [];
    this.solidMaterial = new BABYLON.StandardMaterial('chunk-solid', scene);
    this.solidMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1);
    this.solidMaterial.specularColor = new BABYLON.Color3(0.06, 0.06, 0.06);
    this.solidMaterial.useVertexColor = true;
    this.solidMaterial.useVertexAlpha = false;
    this.solidMaterial.backFaceCulling = true;

    this.waterMaterial = new BABYLON.StandardMaterial('chunk-water', scene);
    this.waterMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.55, 0.88);
    this.waterMaterial.specularColor = new BABYLON.Color3(0.07, 0.07, 0.12);
    this.waterMaterial.alpha = 0.55;
    this.waterMaterial.needDepthPrePass = true;
    this.waterMaterial.backFaceCulling = false;
    this.waterMaterial.useVertexColor = true;
    this.waterMaterial.useVertexAlpha = true;

    this._spawnPoint = new BABYLON.Vector3(0, SEA_LEVEL + 4, 0);
  }

  async initialize() {
    this.physicsPluginVersion = this.scene.getPhysicsEngine?.()?.getPhysicsPluginVersion?.() ?? this.physicsPluginVersion;
    if (
      this.physics &&
      this.physicsPluginVersion !== null &&
      this.physicsPluginVersion !== PHYSICS_PLUGIN_VERSION_V2
    ) {
      console.warn('Physics plugin is not running in V2 mode; chunk colliders will be disabled.');
    }
    for (let cz = -this.chunkRadius; cz <= this.chunkRadius; cz += 1) {
      for (let cx = -this.chunkRadius; cx <= this.chunkRadius; cx += 1) {
        const chunk = this._ensureChunk(cx, cz);
        this.chunkList.push(chunk);
      }
    }

    for (const chunk of this.chunkList) {
      this._buildChunkMeshes(chunk);
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
    const base = 22;
    const scale = 0.035;
    let amplitude = 18;
    let frequency = scale;
    let accum = 0;
    for (let octave = 0; octave < 4; octave += 1) {
      const value = this.noise.noise(x * frequency, this.seed + octave * 37.31, z * frequency);
      accum += value * amplitude;
      amplitude *= 0.48;
      frequency *= 1.92;
    }
    const height = base + accum;
    return Math.max(3, Math.min(CHUNK_HEIGHT - 2, Math.floor(height)));
  }

  random2D(x, z, salt = 0) {
    const s = Math.sin((x * 12_989.8 + z * 78_233.1 + (this.seed + salt) * 437.585) * 0.125);
    return s - Math.floor(s);
  }

  getBlockAtWorld(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return BLOCK_TYPES.air;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return BLOCK_TYPES.air;
    const lx = Math.floor(x - chunk.origin.x);
    const lz = Math.floor(z - chunk.origin.z);
    return chunk.get(lx, y, lz);
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

  _computeSpawnPoint() {
    const samples = [
      [0, 0],
      [CHUNK_SIZE * 0.25, 0],
      [-CHUNK_SIZE * 0.25, 0],
      [0, CHUNK_SIZE * 0.25],
      [0, -CHUNK_SIZE * 0.25],
    ];
    let best = null;
    for (const [dx, dz] of samples) {
      const x = dx;
      const z = dz;
      const y = this.getSurfaceHeight(x, z);
      if (!best || y > best.y) {
        best = { x, y, z };
      }
    }
    if (!best) {
      return new BABYLON.Vector3(0.5, SEA_LEVEL + 5, 0.5);
    }
    return new BABYLON.Vector3(best.x + 0.5, best.y + 1.65, best.z + 0.5);
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
    const geometry = this._buildChunkGeometry(chunk);
    if (!geometry) return;

    const origin = chunk.origin;

    if (chunk.mesh) {
      this._disposeChunkMeshes(chunk);
    }

    chunk.mesh = this._createMesh(`chunk-${chunk.cx}-${chunk.cz}-solid`, geometry.solid, this.solidMaterial, origin, {
      pickable: true,
    });

    chunk.waterMesh = this._createMesh(
      `chunk-${chunk.cx}-${chunk.cz}-water`,
      geometry.water,
      this.waterMaterial,
      origin,
      { pickable: false, alphaIndex: 10 },
    );

    const physicsEngine = this.scene.getPhysicsEngine?.();
    const pluginVersion = physicsEngine?.getPhysicsPluginVersion?.() ?? this.physicsPluginVersion;
    const canUsePhysics =
      this.physics &&
      BABYLON.PhysicsAggregate &&
      pluginVersion === PHYSICS_PLUGIN_VERSION_V2;

    if (chunk.mesh && canUsePhysics) {
      chunk.physicsAggregate = new BABYLON.PhysicsAggregate(
        chunk.mesh,
        BABYLON.PhysicsShapeType.MESH,
        { mass: 0, restitution: 0.0, friction: 0.92 },
        this.scene,
      );
      chunk.physicsAggregate.body.setMotionType(BABYLON.PhysicsMotionType.STATIC);
    }
  }

  _disposeChunkMeshes(chunk) {
    if (chunk.physicsAggregate) {
      chunk.physicsAggregate.dispose();
      chunk.physicsAggregate = null;
    }
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

  _buildChunkGeometry(chunk) {
    const solid = {
      positions: [],
      normals: [],
      colors: [],
      indices: [],
    };
    const water = {
      positions: [],
      normals: [],
      colors: [],
      indices: [],
    };

    for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
          const blockType = chunk.get(lx, y, lz);
          if (blockType === BLOCK_TYPES.air || blockType === BLOCK_TYPES.flower) continue;

          const target = blockType === BLOCK_TYPES.water ? water : solid;
          const baseColor = BLOCK_COLORS[blockType] ?? [1, 1, 1];

          const worldX = chunk.origin.x + lx;
          const worldY = y;
          const worldZ = chunk.origin.z + lz;

          for (let faceIndex = 0; faceIndex < FACE_DEFS.length; faceIndex += 1) {
            const face = FACE_DEFS[faceIndex];
            const neighborType = this.getBlockAtWorld(
              worldX + face.dir[0],
              worldY + face.dir[1],
              worldZ + face.dir[2],
            );
            const isTransparentNeighbor = TRANSPARENT_BLOCKS.has(neighborType) ||
              (neighborType === BLOCK_TYPES.water && blockType !== BLOCK_TYPES.water);
            if (!isTransparentNeighbor) continue;

            const vertexBase = target.positions.length / 3;
            const cornerColor = makeColorArray(baseColor, face.shade, blockType === BLOCK_TYPES.water ? 0.72 : 1);

            for (let i = 0; i < TRIANGLE_ORDER.length; i += 1) {
              const idx = TRIANGLE_ORDER[i];
              const corner = face.corners[idx];
              target.positions.push(lx + corner[0], y + corner[1], lz + corner[2]);
              target.normals.push(face.dir[0], face.dir[1], face.dir[2]);
              target.colors.push(cornerColor[0], cornerColor[1], cornerColor[2], cornerColor[3]);
            }

            target.indices.push(
              vertexBase,
              vertexBase + 1,
              vertexBase + 2,
              vertexBase + 3,
              vertexBase + 4,
              vertexBase + 5,
            );
          }
        }
      }
    }

    return {
      solid: this._finaliseGeometryBuffers(solid),
      water: this._finaliseGeometryBuffers(water),
    };
  }

  _finaliseGeometryBuffers(data) {
    const { positions, normals, colors, indices } = data;
    if (positions.length === 0) {
      return null;
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      colors: new Float32Array(colors),
      indices: new Uint32Array(indices),
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
    mesh.position.set(origin.x, origin.y, origin.z);
    mesh.material = material;
    mesh.isPickable = pickable;
    mesh.alphaIndex = alphaIndex;
    mesh.checkCollisions = pickable;
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
    return mesh;
  }
}
