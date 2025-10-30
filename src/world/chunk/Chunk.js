import { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_TYPES } from '../../constants.js';

export class Chunk {
  constructor({ world, cx, cz, maxBlockType }) {
    this.world = world;
    this.cx = cx;
    this.cz = cz;
    this.origin = new BABYLON.Vector3(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    this.mesh = null;
    this.waterMesh = null;
    this.counts = new Uint32Array((maxBlockType ?? BLOCK_TYPES.water) + 1);
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
    if (type >= this.counts.length) {
      const next = new Uint32Array(type + 1);
      next.set(this.counts);
      this.counts = next;
    }
    this.counts[type] += 1;
    return true;
  }

  resetCounts(maxBlockType) {
    if (maxBlockType >= this.counts.length) {
      this.counts = new Uint32Array(maxBlockType + 1);
    } else {
      this.counts.fill(0);
    }
  }

  disposeMeshes() {
    if (this.mesh) {
      this.mesh.material = null;
      this.mesh.dispose(false, false);
      this.mesh = null;
    }
    if (this.waterMesh) {
      this.waterMesh.material = null;
      this.waterMesh.dispose(false, false);
      this.waterMesh = null;
    }
  }
}
