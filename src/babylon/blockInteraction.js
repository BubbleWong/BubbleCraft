import { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_TYPES } from '../constants.js';

const MAX_INTERACT_DISTANCE = 6.5;
const EPSILON = 1e-3;

export class BlockInteraction {
  constructor({ scene, world, player, camera, hud, inventory, onInventoryChange }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.camera = camera;
    this.hud = hud;
    this.inventory = inventory;
    this.onInventoryChange = onInventoryChange ?? (() => {});

    this.activeSlot = 0;
    this.currentTarget = null;
    this.breakRequested = false;
    this.placeRequested = false;
  }

  setActiveSlot(index) {
    this.activeSlot = Math.max(0, index);
  }

  queueBreak() {
    this.breakRequested = true;
  }

  queuePlace() {
    this.placeRequested = true;
  }

  update(frameInput) {
    const pointerLocked = Boolean(frameInput?.pointerLocked);
    if (!pointerLocked) {
      this.currentTarget = null;
      this.breakRequested = false;
      this.placeRequested = false;
      this._updateHud(null);
      return;
    }

    const pickInfo = this._pickSolidBlock();
    this.currentTarget = pickInfo;
    if ((this.breakRequested || this.placeRequested) && !pickInfo) {
      console.log('[blockInteraction] pickInfo missing');
    }
    this._updateHud(pickInfo);

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

  _updateHud(pickInfo) {
    const selectedType = this._currentBlockType();
    const targetedType = pickInfo?.blockType ?? null;
    const distance = pickInfo?.distance ?? null;
    this.hud?.updateStatus({ selectedType, targetedType, distance });
  }

  _currentBlockType() {
    if (!this.inventory) return BLOCK_TYPES.air;
    const slot = this.inventory.getSlot(this.activeSlot);
    return slot?.type ?? BLOCK_TYPES.air;
  }

  _pickSolidBlock() {
    if (!this.camera || !this.player?.mesh) return null;
    const meshPos = this.player.mesh.getAbsolutePosition?.() ?? this.player.mesh.position.clone();
    const origin = meshPos.clone ? meshPos.clone() : new BABYLON.Vector3(meshPos.x, meshPos.y, meshPos.z);
    origin.y += this.camera.position?.y ?? 0;
    this.camera.computeWorldMatrix?.(true);
    const forwardDir = this.camera.getDirection(BABYLON.Axis.Z).normalize();
    const forwardRay = new BABYLON.Ray(origin, forwardDir, MAX_INTERACT_DISTANCE);
    if (this.breakRequested || this.placeRequested) {
      console.log('[blockInteraction] ray', { origin: origin.asArray?.() ?? origin, dir: forwardDir.asArray?.() ?? forwardDir });
    }
    const pick = this.scene.pickWithRay(
      forwardRay,
      (mesh) => mesh?.metadata?.chunk && mesh.metadata.type === 'solid',
      false,
    );

    if (!pick?.hit || !pick.pickedMesh?.metadata?.chunk) {
      if (this.breakRequested || this.placeRequested) {
        console.log('[blockInteraction] pick miss', pick);
      }
      return null;
    }

    const chunk = pick.pickedMesh.metadata.chunk;
    const worldPoint = pick.pickedPoint;
    const normalVector = pick.getNormal(true, true);
    const normal = normalVector ? normalVector.clone().normalize() : forwardDir.clone().negate();
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
    const { chunk, blockX, blockY, blockZ, blockType } = target;
    if (blockType === BLOCK_TYPES.air || blockType === BLOCK_TYPES.water) return;
    const worldX = chunk.origin.x + blockX;
    const worldY = blockY;
    const worldZ = chunk.origin.z + blockZ;

    const changed = this.world.setBlockAtWorld(worldX, worldY, worldZ, BLOCK_TYPES.air);
    console.log('[blockInteraction] break attempt', { worldX, worldY, worldZ, blockType, changed });
    if (!changed) return;

    if (this.inventory) {
      const remaining = this.inventory.add(blockType, 1);
      if (remaining < 1) {
        this.onInventoryChange();
      }
    }
  }

  _placeBlock(target) {
    if (!this.inventory) return;
    const slot = this.inventory.getSlot(this.activeSlot);
    if (!slot || slot.count <= 0) return;
    const placeType = slot.type;
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

    const playerPos = this.player?.mesh?.position;
    if (!playerPos) return;
    const dx = Math.abs(worldX + 0.5 - playerPos.x);
    const dy = Math.abs(worldY + 0.5 - playerPos.y);
    const dz = Math.abs(worldZ + 0.5 - playerPos.z);
    if (dx <= 0.6 && dz <= 0.6 && dy <= 1.3) {
      return;
    }

    const placed = this.world.setBlockAtWorld(worldX, worldY, worldZ, placeType);
    console.log('[blockInteraction] place attempt', { worldX, worldY, worldZ, placeType, placed });
    if (!placed) return;

    const removed = this.inventory.removeFromSlot(this.activeSlot, 1);
    if (removed > 0) {
      this.onInventoryChange();
    }
  }
}
