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
  wood: 5,
  leaves: 6,
  gold: 7,
  diamond: 8,
  flowerRed: 9,
  flowerYellow: 10,
};

const MAX_BLOCK_TYPE = Math.max(...Object.values(BLOCK_TYPES));

const BLOCK_TYPE_LABELS = {
  [BLOCK_TYPES.grass]: 'Grass',
  [BLOCK_TYPES.dirt]: 'Dirt',
  [BLOCK_TYPES.stone]: 'Stone',
  [BLOCK_TYPES.sand]: 'Sand',
  [BLOCK_TYPES.wood]: 'Wood',
  [BLOCK_TYPES.leaves]: 'Leaves',
  [BLOCK_TYPES.gold]: 'Gold',
  [BLOCK_TYPES.diamond]: 'Diamond',
  [BLOCK_TYPES.flowerRed]: 'Flower (Red)',
  [BLOCK_TYPES.flowerYellow]: 'Flower (Yellow)',
};

const BLOCK_COLORS = {
  [BLOCK_TYPES.grass]: [0.49, 0.74, 0.35],
  [BLOCK_TYPES.dirt]: [0.58, 0.41, 0.29],
  [BLOCK_TYPES.stone]: [0.65, 0.65, 0.7],
  [BLOCK_TYPES.sand]: [0.93, 0.87, 0.63],
  [BLOCK_TYPES.wood]: [0.54, 0.35, 0.19],
  [BLOCK_TYPES.leaves]: [0.29, 0.62, 0.28],
  [BLOCK_TYPES.gold]: [0.97, 0.83, 0.36],
  [BLOCK_TYPES.diamond]: [0.53, 0.84, 0.92],
};

const FLOWER_PETAL_COLORS = {
  [BLOCK_TYPES.flowerRed]: [0.9, 0.25, 0.32],
  [BLOCK_TYPES.flowerYellow]: [0.98, 0.88, 0.38],
};

const FLOWER_CENTER_COLOR = [0.98, 0.94, 0.62];
const FLOWER_STEM_COLOR = [0.25, 0.65, 0.38];

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

const TRIANGLE_INDICES = [0, 1, 2, 0, 2, 3];

const mix = (a, b, t) => a * (1 - t) + b * t;

function addColorNoise(base, noise) {
  return [
    clamp01(base[0] + noise),
    clamp01(base[1] + noise),
    clamp01(base[2] + noise),
  ];
}

function tintForFace(blockType, baseColor, shade, world, worldX, worldY, worldZ, faceIndex, cornerIndex) {
  let color = baseColor;
  if (blockType === BLOCK_TYPES.grass && faceIndex !== 3) {
    const tint = 0.07;
    color = [baseColor[0] + tint, baseColor[1] + tint, baseColor[2] + tint];
  }
  if (blockType === BLOCK_TYPES.wood && (faceIndex === 2 || faceIndex === 3)) {
    color = [0.62, 0.45, 0.23];
  }
  if (blockType === BLOCK_TYPES.leaves) {
    const leafNoise = (world.random3D(worldX, worldY, worldZ, faceIndex * 11 + cornerIndex) - 0.5) * 0.2;
    color = addColorNoise(color, leafNoise);
  }
  if (blockType === BLOCK_TYPES.gold || blockType === BLOCK_TYPES.diamond) {
    const sparkle = Math.abs(Math.sin(worldX * 0.3 + worldZ * 0.7 + faceIndex)) * 0.15;
    color = [color[0] + sparkle, color[1] + sparkle * (blockType === BLOCK_TYPES.gold ? 1 : 1.2), color[2] + sparkle];
  }

  const noise = (world.random3D(worldX, worldY, worldZ, faceIndex * 17 + cornerIndex) - 0.5) * 0.08;
  const shaded = shade + noise;
  return [
    clamp01(color[0] * shaded),
    clamp01(color[1] * shaded),
    clamp01(color[2] * shaded),
  ];
}

const chunkKey = (cx, cz) => `${cx},${cz}`;

class Chunk {
  constructor(world, cx, cz) {
    this.world = world;
    this.cx = cx;
    this.cz = cz;
    this.origin = new THREE.Vector3(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    this.mesh = null;
    this.counts = new Uint32Array(MAX_BLOCK_TYPE + 1);
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

  addCross(positions, normals, colors, centerX, centerZ, bottomY, topY, halfWidth, faceColor) {
    const quads = [
      {
        corners: [
          [centerX - halfWidth, bottomY, centerZ],
          [centerX + halfWidth, bottomY, centerZ],
          [centerX + halfWidth, topY, centerZ],
          [centerX - halfWidth, topY, centerZ],
        ],
        normal: [0, 0, 1],
      },
      {
        corners: [
          [centerX, bottomY, centerZ - halfWidth],
          [centerX, bottomY, centerZ + halfWidth],
          [centerX, topY, centerZ + halfWidth],
          [centerX, topY, centerZ - halfWidth],
        ],
        normal: [1, 0, 0],
      },
    ];
    const frontOrder = [0, 1, 2, 0, 2, 3];
    const backOrder = [0, 2, 1, 0, 3, 2];
    for (const quad of quads) {
      const { corners, normal } = quad;
      for (const indices of [frontOrder, backOrder]) {
        const usedNormal = indices === frontOrder ? normal : normal.map((n) => -n);
        for (const idx of indices) {
          const vertex = corners[idx];
          positions.push(vertex[0], vertex[1], vertex[2]);
          normals.push(usedNormal[0], usedNormal[1], usedNormal[2]);
          colors.push(faceColor[0], faceColor[1], faceColor[2]);
        }
      }
    }
  }

  addFlowerGeometry(positions, normals, colors, lx, y, lz, blockType) {
    const centerX = lx + 0.5;
    const centerZ = lz + 0.5;
    const stemBottom = y;
    const stemTop = y + 0.45;
    const petalBottom = y + 0.4;
    const petalTop = y + 0.95;

    const stemHalf = 0.05;
    const petalHalf = 0.32;
    const petalColor = FLOWER_PETAL_COLORS[blockType] ?? [1, 1, 1];

    this.addCross(positions, normals, colors, centerX, centerZ, stemBottom, stemTop, stemHalf, FLOWER_STEM_COLOR);
    this.addCross(positions, normals, colors, centerX, centerZ, petalBottom, petalTop, petalHalf, petalColor);

    const centerRadius = 0.12;
    const centerBottom = petalTop - 0.25;
    const centerTop = petalTop;
    const quads = [
      {
        corners: [
          [centerX - centerRadius, centerBottom, centerZ],
          [centerX + centerRadius, centerBottom, centerZ],
          [centerX + centerRadius, centerTop, centerZ],
          [centerX - centerRadius, centerTop, centerZ],
        ],
        normal: [0, 0, 1],
      },
      {
        corners: [
          [centerX, centerBottom, centerZ - centerRadius],
          [centerX, centerBottom, centerZ + centerRadius],
          [centerX, centerTop, centerZ + centerRadius],
          [centerX, centerTop, centerZ - centerRadius],
        ],
        normal: [1, 0, 0],
      },
    ];
    const frontOrder = [0, 1, 2, 0, 2, 3];
    const backOrder = [0, 2, 1, 0, 3, 2];
    for (const quad of quads) {
      const { corners, normal } = quad;
      for (const indices of [frontOrder, backOrder]) {
        const usedNormal = indices === frontOrder ? normal : normal.map((n) => -n);
        for (const idx of indices) {
          const vertex = corners[idx];
          positions.push(vertex[0], vertex[1], vertex[2]);
          normals.push(usedNormal[0], usedNormal[1], usedNormal[2]);
          colors.push(FLOWER_CENTER_COLOR[0], FLOWER_CENTER_COLOR[1], FLOWER_CENTER_COLOR[2]);
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
          if (!color && blockType !== BLOCK_TYPES.flowerRed && blockType !== BLOCK_TYPES.flowerYellow) continue;

          if (blockType === BLOCK_TYPES.flowerRed || blockType === BLOCK_TYPES.flowerYellow) {
            this.addFlowerGeometry(positions, normals, colors, lx, y, lz, blockType);
            continue;
          }

          const worldX = this.origin.x + lx;
          const worldY = y;
          const worldZ = this.origin.z + lz;

          for (let faceIndex = 0; faceIndex < FACE_DEFS.length; faceIndex += 1) {
            const face = FACE_DEFS[faceIndex];
            let neighborType = this.world.getBlock(worldX + face.dir[0], worldY + face.dir[1], worldZ + face.dir[2]);
            if (isTransparentBlock(neighborType)) neighborType = BLOCK_TYPES.air;
            if (neighborType !== BLOCK_TYPES.air) continue;

            const shade = face.shade ?? 1;
            for (let tri = 0; tri < TRIANGLE_INDICES.length; tri += 1) {
              const cornerIndex = TRIANGLE_INDICES[tri];
              const corner = face.corners[cornerIndex];
              positions.push(lx + corner[0], y + corner[1], lz + corner[2]);
              normals.push(face.dir[0], face.dir[1], face.dir[2]);
              const tinted = tintForFace(blockType, color, shade, this.world, worldX, worldY, worldZ, faceIndex, cornerIndex);
              colors.push(tinted[0], tinted[1], tinted[2]);
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
    this.seed = Math.floor(Math.random() * 2 ** 31);
    this.blockTotals = new Uint32Array(MAX_BLOCK_TYPE + 1);
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
    for (let cx = -radius; cx <= radius; cx += 1) {
      for (let cz = -radius; cz <= radius; cz += 1) {
        this.ensureChunk(cx, cz);
      }
    }
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
