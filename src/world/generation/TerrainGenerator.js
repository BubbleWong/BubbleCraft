import {
  CHUNK_SIZE,
  CHUNK_HEIGHT,
  BLOCK_TYPES,
  SEA_LEVEL,
} from '../../constants.js';

const NON_COLLIDING_BLOCKS = new Set([BLOCK_TYPES.air, BLOCK_TYPES.flower, BLOCK_TYPES.water]);
const PASSABLE_BLOCKS = NON_COLLIDING_BLOCKS;

export class TerrainGenerator {
  constructor(world) {
    this.world = world;
  }

  populate(chunk) {
    const maxBlockType = this.world.maxBlockType;
    chunk.resetCounts(maxBlockType);

    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        const worldX = chunk.origin.x + lx;
        const worldZ = chunk.origin.z + lz;
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
          chunk.set(lx, y, lz, block);
        }

        if (terrainHeight < SEA_LEVEL) {
          for (let y = terrainHeight + 1; y <= SEA_LEVEL; y += 1) {
            chunk.set(lx, y, lz, BLOCK_TYPES.water);
          }
        }

        if (surfaceBlock === BLOCK_TYPES.grass && terrainHeight + 1 < CHUNK_HEIGHT) {
          if (this._maybePlaceTree(chunk, lx, terrainHeight, lz, worldX, worldZ)) {
            continue;
          }
          const flowerChance = this.world.random2D(worldX, worldZ, 97);
          if (flowerChance > 0.88) {
            chunk.set(lx, terrainHeight + 1, lz, BLOCK_TYPES.flower);
          }
        }
      }
    }
  }

  _maybePlaceTree(chunk, lx, groundY, lz, worldX, worldZ) {
    const treeChance = this.world.random2D(worldX, worldZ, 37);
    if (treeChance <= 0.82) return false;
    const heightRand = this.world.random2D(worldX, worldZ, 53);
    const treeHeight = 4 + Math.floor(heightRand * 3);
    if (!this._canPlaceTree(chunk, lx, groundY, lz, treeHeight)) return false;
    this._placeTree(chunk, lx, groundY, lz, treeHeight, worldX, worldZ);
    return true;
  }

  _canPlaceTree(chunk, lx, groundY, lz, height) {
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
          const check = chunk.get(lx + dx, y, lz + dz);
          if (!PASSABLE_BLOCKS.has(check)) return false;
        }
      }
    }
    return true;
  }

  _placeTree(chunk, lx, groundY, lz, height, worldX, worldZ) {
    for (let i = 1; i <= height; i += 1) {
      chunk.set(lx, groundY + i, lz, BLOCK_TYPES.wood);
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
          if (PASSABLE_BLOCKS.has(chunk.get(targetX, targetY, targetZ))) {
            const leafNoise = this.world.random3D(worldX + dx, targetY, worldZ + dz, 113);
            if (leafNoise > 0.2) {
              chunk.set(targetX, targetY, targetZ, BLOCK_TYPES.leaves);
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
      if (chunk.get(fx, groundY, fz) === BLOCK_TYPES.grass && PASSABLE_BLOCKS.has(chunk.get(fx, flowerY, fz))) {
        const chance = this.world.random2D(worldX + dx * 3, worldZ + dz * 3, 127);
        if (chance > 0.65) {
          chunk.set(fx, flowerY, fz, BLOCK_TYPES.flower);
        }
      }
    }
  }
}
