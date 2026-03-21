import { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_TYPES } from '../../constants.js';

const MAX_INTERACT_DISTANCE = 6.5;
const EPSILON = 1e-3;
const PLAYER_SUPPORT_PLACEMENT_TOLERANCE = 0.05;
const WATER_FILL_NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export class BlockInteraction {
  constructor({ scene, world, player, camera, hud, inventory, onInventoryChange, context = null, eventBus = null }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.camera = camera;
    this.hud = hud;
    this.inventory = inventory;
    this.onInventoryChange = onInventoryChange ?? (() => {});
    this.context = context;
    this.eventBus = eventBus ?? context?.eventBus ?? null;
    this.sound = context?.getService?.('sound') ?? null;

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
    const usingGamepad = Boolean(frameInput?.usingGamepad);
    const usingTouch = Boolean(frameInput?.usingTouch);
    const gamepadAction = frameInput?.actions;
    
    // Allow interaction if a direct aiming mode is active.
    if (!pointerLocked && !usingGamepad && !usingTouch) {
      this.currentTarget = null;
      this.breakRequested = false;
      this.placeRequested = false;
      this._updateHud(null);
      return;
    }

    // Process gamepad actions
    if (gamepadAction?.break) this.queueBreak();
    if (gamepadAction?.place) this.queuePlace();

    const pickInfo = this._pickSolidBlock();
    this.currentTarget = pickInfo;
    // if ((this.breakRequested || this.placeRequested) && !pickInfo) {
    //   console.log('[blockInteraction] pickInfo missing');
    // }
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
    // if (this.breakRequested || this.placeRequested) {
    //   console.log('[blockInteraction] ray', { origin: origin.asArray?.() ?? origin, dir: forwardDir.asArray?.() ?? forwardDir });
    // }
    const pick = this.scene.pickWithRay(
      forwardRay,
      (mesh) => mesh?.metadata?.chunk && mesh.metadata.type === 'solid',
      false,
    );

    if (!pick?.hit || !pick.pickedMesh?.metadata?.chunk) {
      // if (this.breakRequested || this.placeRequested) {
      //   console.log('[blockInteraction] pick miss', pick);
      // }
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
    const replacementType = this._shouldFillBrokenBlockWithWater(worldX, worldY, worldZ)
      ? BLOCK_TYPES.water
      : BLOCK_TYPES.air;

    const changed = this.world.setBlockAtWorld(worldX, worldY, worldZ, replacementType);
    // console.log('[blockInteraction] break attempt', { worldX, worldY, worldZ, blockType, changed });
    if (!changed) return;
    this.sound?.playBlockBreak(blockType);

    if (this.inventory) {
      const remaining = this.inventory.add(blockType, 1);
      if (remaining < 1) {
        this.onInventoryChange();
      }
    }
    this.eventBus?.emit('block:break', {
      position: { x: worldX, y: worldY, z: worldZ },
      type: blockType,
      player: this.player,
    });
    this.eventBus?.emit('inventory:changed', { inventory: this.inventory });
  }

  _shouldFillBrokenBlockWithWater(worldX, worldY, worldZ) {
    if (!this.world?.getBlockAtWorld) return false;

    for (const [dx, dy, dz] of WATER_FILL_NEIGHBORS) {
      const neighborType = this.world.getBlockAtWorld(worldX + dx, worldY + dy, worldZ + dz);
      if (neighborType === BLOCK_TYPES.water) {
        return true;
      }
    }

    return false;
  }

  _getPlayerBounds() {
    const playerMesh = this.player?.mesh;
    const playerPos = playerMesh?.position;
    if (!playerPos) return null;

    const ellipsoid = playerMesh.ellipsoid;
    const radiusX = Math.max(0.3, ellipsoid?.x ?? 0.3);
    const radiusZ = Math.max(0.3, ellipsoid?.z ?? 0.3);
    const height = Math.max(1.3, (ellipsoid?.y ?? 0.95) * 2);

    return {
      minX: playerPos.x - radiusX,
      maxX: playerPos.x + radiusX,
      minZ: playerPos.z - radiusZ,
      maxZ: playerPos.z + radiusZ,
      bottom: playerPos.y,
      top: playerPos.y + height,
    };
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

    const playerBounds = this._getPlayerBounds();
    if (!playerBounds) return;

    const blockBottom = worldY;
    const blockTop = worldY + 1.0;
    const overlapsX = playerBounds.minX < (worldX + 1 - EPSILON) && playerBounds.maxX > (worldX + EPSILON);
    const overlapsZ = playerBounds.minZ < (worldZ + 1 - EPSILON) && playerBounds.maxZ > (worldZ + EPSILON);

    if (overlapsX && overlapsZ) {
      const intersectsBody = playerBounds.bottom < (blockTop - EPSILON) && playerBounds.top > (blockBottom + EPSILON);
      const supportsFeet = playerBounds.bottom <= blockTop + PLAYER_SUPPORT_PLACEMENT_TOLERANCE
        && playerBounds.bottom >= blockBottom - PLAYER_SUPPORT_PLACEMENT_TOLERANCE;
      if (intersectsBody || supportsFeet) {
        return;
      }
    }

    const placed = this.world.setBlockAtWorld(worldX, worldY, worldZ, placeType);
    // console.log('[blockInteraction] place attempt', { worldX, worldY, worldZ, placeType, placed });
    if (!placed) return;
    this.sound?.playBlockPlace(placeType);

    const removed = this.inventory.removeFromSlot(this.activeSlot, 1);
    if (removed > 0) {
      this.onInventoryChange();
    }
    this.eventBus?.emit('block:place', {
      position: { x: worldX, y: worldY, z: worldZ },
      type: placeType,
      player: this.player,
    });
    if (removed > 0) {
      this.eventBus?.emit('inventory:changed', { inventory: this.inventory });
    }
  }
}
