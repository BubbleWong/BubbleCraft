import { BLOCK_TYPE_LABELS, CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_TYPES } from '../constants.js';

const MAX_INTERACT_DISTANCE = 6.5;
const EPSILON = 1e-3;

export class BlockInteraction {
  constructor({ scene, world, player, camera, hud, blockPalette }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.camera = camera;
    this.hud = hud;
    this.blockPalette = blockPalette;

    this.activeSlot = 0;
    this.currentTarget = null;
    this.breakRequested = false;
    this.placeRequested = false;
  }

  setActiveSlot(index) {
    if (index < 0 || index >= this.blockPalette.length) return;
    this.activeSlot = index;
  }

  queueBreak() {
    this.breakRequested = true;
  }

  queuePlace() {
    this.placeRequested = true;
  }

  update() {
    const pickInfo = this._pickSolidBlock();
    this.currentTarget = pickInfo;

    const selectedBlockType = this.blockPalette[this.activeSlot] ?? BLOCK_TYPES.dirt;
    const targetType = pickInfo?.blockType ?? null;
    const distance = pickInfo?.distance ?? null;
    this.hud?.updateStatus({ selectedType: selectedBlockType, targetedType: targetType, distance });

    if (!pickInfo) {
      this.breakRequested = false;
      this.placeRequested = false;
      return;
    }

    if (this.breakRequested) {
      this._breakBlock(pickInfo);
    }

    if (this.placeRequested) {
      this._placeBlock(pickInfo);
    }

    this.breakRequested = false;
    this.placeRequested = false;
  }

  _pickSolidBlock() {
    const origin = this.camera.getAbsolutePosition?.() ?? this.camera.position.clone();
    const forwardDir = this.camera.getDirection(BABYLON.Axis.Z).normalize();
    const forwardRay = BABYLON.Ray.CreateNewFromTo(origin, origin.add(forwardDir.scale(MAX_INTERACT_DISTANCE)));
    const pick = this.scene.pickWithRay(
      forwardRay,
      (mesh) => mesh?.metadata?.chunk && mesh.metadata.type === 'solid',
      false,
    );

    if (!pick?.hit || !pick.pickedMesh?.metadata?.chunk) {
      return null;
    }

    const chunk = pick.pickedMesh.metadata.chunk;
    const worldPoint = pick.pickedPoint;
    const normalVector = pick.getNormal(true, true);
    const normal = normalVector ? normalVector.clone().normalize() : forwardDir.clone().scale(-1);
    const adjusted = worldPoint.subtract(normal.scale(EPSILON));

    const blockX = Math.floor(adjusted.x - chunk.origin.x);
    const blockY = Math.floor(adjusted.y - chunk.origin.y);
    const blockZ = Math.floor(adjusted.z - chunk.origin.z);

    if (
      blockX < 0 || blockX >= CHUNK_SIZE ||
      blockZ < 0 || blockZ >= CHUNK_SIZE ||
      blockY < 0 || blockY >= CHUNK_HEIGHT
    ) {
      return null;
    }

    const blockType = chunk.get(blockX, blockY, blockZ);
    if (blockType === BLOCK_TYPES.air) return null;

    return {
      chunk,
      blockType,
      blockX,
      blockY,
      blockZ,
      worldPoint: adjusted,
      distance: pick.distance,
      normal,
    };
  }

  _breakBlock(target) {
    const { chunk, blockX, blockY, blockZ } = target;
    const worldX = chunk.origin.x + blockX;
    const worldY = blockY;
    const worldZ = chunk.origin.z + blockZ;

    const changed = this.world.setBlockAtWorld(worldX, worldY, worldZ, BLOCK_TYPES.air);
    if (!changed) return;

    this.hud?.updateStatus({
      selectedType: this.blockPalette[this.activeSlot],
      targetedType: target.blockType,
      distance: target.distance,
    });
  }

  _placeBlock(target) {
    const placeType = this.blockPalette[this.activeSlot] ?? BLOCK_TYPES.dirt;
    if (placeType === BLOCK_TYPES.air) return;

    const { chunk, blockX, blockY, blockZ, normal } = target;
    const worldX = chunk.origin.x + blockX + Math.sign(normal.x);
    const worldY = blockY + Math.sign(normal.y);
    const worldZ = chunk.origin.z + blockZ + Math.sign(normal.z);

    if (worldY < 0 || worldY >= CHUNK_HEIGHT) return;

    const existing = this.world.getBlockAtWorld(worldX, worldY, worldZ);
    if (existing !== BLOCK_TYPES.air && existing !== BLOCK_TYPES.water && existing !== BLOCK_TYPES.flower) {
      return;
    }

    // Avoid placing inside the player capsule.
    const playerPos = this.player.mesh.position;
    const dx = Math.abs(worldX + 0.5 - playerPos.x);
    const dy = Math.abs(worldY + 0.5 - playerPos.y);
    const dz = Math.abs(worldZ + 0.5 - playerPos.z);
    if (dx <= 0.6 && dz <= 0.6 && dy <= 1.3) {
      return;
    }

    this.world.setBlockAtWorld(worldX, worldY, worldZ, placeType);
  }
}
