import * as THREE from './vendor/three.module.js';
import { ImprovedNoise } from './vendor/ImprovedNoise.js';

const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;
const BLOCK_TYPES = {
  air: 0,
  grass: 1,
  dirt: 2,
  stone: 3,
  sand: 4,
};

const BLOCK_COLORS = {
  [BLOCK_TYPES.grass]: [0.49, 0.74, 0.35],
  [BLOCK_TYPES.dirt]: [0.58, 0.41, 0.29],
  [BLOCK_TYPES.stone]: [0.65, 0.65, 0.7],
  [BLOCK_TYPES.sand]: [0.93, 0.87, 0.63],
};

const FACE_DEFS = [
  { dir: [1, 0, 0], corners: [[1, 1, 0], [1, 0, 0], [1, 0, 1], [1, 1, 1]] }, // +X
  { dir: [-1, 0, 0], corners: [[0, 1, 1], [0, 0, 1], [0, 0, 0], [0, 1, 0]] }, // -X
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] }, // +Y
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] }, // -Y
  { dir: [0, 0, 1], corners: [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]] }, // +Z
  { dir: [0, 0, -1], corners: [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]] }, // -Z
];

const TRIANGLE_INDICES = [0, 1, 2, 0, 2, 3];

const chunkKey = (cx, cz) => `${cx},${cz}`;

class Chunk {
  constructor(world, cx, cz) {
    this.world = world;
    this.cx = cx;
    this.cz = cz;
    this.origin = new THREE.Vector3(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    this.mesh = null;
    this.generate();
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
    this.blocks[this.index(x, y, z)] = type;
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
          }
          this.set(lx, y, lz, blockType);
        }
      }
    }
  }

  buildMesh() {
    const positions = [];
    const normals = [];
    const colors = [];

    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
        for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
          const blockType = this.get(lx, y, lz);
          if (blockType === BLOCK_TYPES.air) continue;

          const color = BLOCK_COLORS[blockType];
          if (!color) continue;

          const worldX = this.origin.x + lx;
          const worldY = y;
          const worldZ = this.origin.z + lz;

          for (const face of FACE_DEFS) {
            const neighborType = this.world.getBlock(worldX + face.dir[0], worldY + face.dir[1], worldZ + face.dir[2]);
            if (neighborType !== BLOCK_TYPES.air) continue;

            for (let i = 0; i < TRIANGLE_INDICES.length; i += 1) {
              const cornerIndex = TRIANGLE_INDICES[i];
              const corner = face.corners[cornerIndex];
              positions.push(lx + corner[0], y + corner[1], lz + corner[2]);
              normals.push(face.dir[0], face.dir[1], face.dir[2]);
              colors.push(color[0], color[1], color[2]);
            }
          }
        }
      }
    }

    if (positions.length === 0) {
      return null;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.world.material);
    mesh.position.copy(this.origin);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.chunk = this;
    return mesh;
  }

  rebuild() {
    if (this.mesh) {
      this.world.scene.remove(this.mesh);
      this.world.chunkMeshes.delete(this.mesh);
      this.mesh.geometry.dispose();
    }
    const nextMesh = this.buildMesh();
    this.mesh = nextMesh;
    if (nextMesh) {
      this.world.scene.add(nextMesh);
      this.world.chunkMeshes.add(nextMesh);
    }
  }
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.chunkMeshes = new Set();
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.noise = new ImprovedNoise();
    this.seed = Math.random() * 1000;
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  ensureChunk(cx, cz) {
    let chunk = this.getChunk(cx, cz);
    if (!chunk) {
      chunk = new Chunk(this, cx, cz);
      this.chunks.set(chunkKey(cx, cz), chunk);
      chunk.rebuild();
    }
    return chunk;
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
    for (let cx = -radius; cx <= radius; cx += 1) {
      for (let cz = -radius; cz <= radius; cz += 1) {
        this.ensureChunk(cx, cz);
      }
    }
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

export { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_TYPES };
