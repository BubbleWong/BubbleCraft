import { CHUNK_SIZE, BLOCK_TYPES } from '../../../constants.js';

const DEFAULT_WALK_SPEED = 5.5;
const DEFAULT_SPRINT_MULTIPLIER = 1.65;
const DEFAULT_JUMP_IMPULSE = 8.15; // ≈1.5 block apex with GRAVITY
const GRAVITY = -22;
const TERMINAL_VELOCITY = -48;
const CAPSULE_HEIGHT = 1.9;
const CAPSULE_RADIUS = 0.42;
const CAMERA_EYE_HEIGHT = 1.62;
const FOOTSTEP_DISTANCE_INTERVAL = 2.2;
const FOOTSTEP_MIN_DISTANCE = 0.01;
const GROUND_CHECK_DISTANCE = 0.22;
const GROUND_CHECK_OFFSET = 0.04;
const COLLISION_EPSILON = 1e-3;
const COYOTE_TIME = 0.12;

export class PlayerController {
  constructor({ scene, world, camera, input, context = null }) {
    this.scene = scene;
    this.world = world;
    this.camera = camera;
    this.input = input;
    this.context = context;
    this.eventBus = context?.eventBus ?? null;
    this.sound = context?.getService?.('sound') ?? null;

    this.walkSpeed = DEFAULT_WALK_SPEED;
    this.sprintMultiplier = DEFAULT_SPRINT_MULTIPLIER;
    this.jumpImpulse = DEFAULT_JUMP_IMPULSE;

    this.mesh = BABYLON.MeshBuilder.CreateCapsule('player-capsule', {
      height: CAPSULE_HEIGHT,
      radius: CAPSULE_RADIUS,
      tessellation: 12,
      capSubdivisions: 6,
    }, this.scene);
    this.mesh.isVisible = false;
    this.mesh.isPickable = false;
    this.mesh.checkCollisions = true;
    const ellipsoidY = CAPSULE_HEIGHT * 0.5;
    this.mesh.ellipsoid = new BABYLON.Vector3(CAPSULE_RADIUS, ellipsoidY, CAPSULE_RADIUS);
    this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, ellipsoidY, 0);

    this.camera.parent = this.mesh;
    this.camera.position.set(0, CAMERA_EYE_HEIGHT, 0);
    this.camera.rotationQuaternion = null;

    this._velocity = new BABYLON.Vector3();
    this._spawnPoint = new BABYLON.Vector3(0, CAPSULE_HEIGHT, 0);
    this._footstepAccumulator = 0;
    this._desiredMove = new BABYLON.Vector3();
    this._movementDelta = new BABYLON.Vector3();
    this._previousPosition = new BABYLON.Vector3();
    this._actualMovement = new BABYLON.Vector3();
    this._groundCheckOrigin = new BABYLON.Vector3();
    this._groundCheckRay = new BABYLON.Ray(new BABYLON.Vector3(), new BABYLON.Vector3(0, -1, 0), GROUND_CHECK_DISTANCE);
    this._groundPredicate = (mesh) => !!mesh && mesh !== this.mesh && mesh.checkCollisions === true;
    const lateralProbe = Math.max(0.18, CAPSULE_RADIUS * 0.85);
    this._groundCheckOffsets = [
      new BABYLON.Vector3(0, 0, 0),
      new BABYLON.Vector3(lateralProbe, 0, 0),
      new BABYLON.Vector3(-lateralProbe, 0, 0),
      new BABYLON.Vector3(0, 0, lateralProbe),
      new BABYLON.Vector3(0, 0, -lateralProbe),
      new BABYLON.Vector3(lateralProbe * 0.7, 0, lateralProbe * 0.7),
      new BABYLON.Vector3(-lateralProbe * 0.7, 0, lateralProbe * 0.7),
      new BABYLON.Vector3(lateralProbe * 0.7, 0, -lateralProbe * 0.7),
      new BABYLON.Vector3(-lateralProbe * 0.7, 0, -lateralProbe * 0.7),
    ];
    this._grounded = false;
    this._timeSinceGrounded = 0;
  }

  setSpawnPoint(position) {
    this._spawnPoint.copyFrom(position);
    this.mesh.position.copyFrom(position);
    this._velocity.setAll(0);
    this._grounded = false;
    this._timeSinceGrounded = 0;
    this._snapToGround(true);
    if (this._isGrounded()) {
      this._grounded = true;
      this._timeSinceGrounded = 0;
    }
  }

  setOrientation({ yaw, pitch }) {
    if (Number.isFinite(yaw)) {
      this.mesh.rotation.y = yaw;
    }
    if (Number.isFinite(pitch)) {
      this.camera.rotation.x = Math.max(-(Math.PI * 0.49), Math.min(Math.PI * 0.49, pitch));
    }
  }

  update(deltaSeconds, frameInput = null) {
    const inputState = frameInput ?? this.input.poll();
    this._applyCameraOrientation(inputState.look);
    this._integrateMovement(deltaSeconds, inputState);

    if (this.mesh.position.y < -64) {
      this.respawn();
    }
  }

  respawn() {
    this.mesh.position.copyFrom(this._spawnPoint);
    this._velocity.setAll(0);
    this._footstepAccumulator = 0;
    this._grounded = false;
    this._timeSinceGrounded = 0;
    this._snapToGround(true);
    if (this._isGrounded()) {
      this._grounded = true;
      this._timeSinceGrounded = 0;
    }
    this.eventBus?.emit('player:respawn', { position: this.mesh.position.clone(), player: this });
  }

  dispose() {
    this.mesh.dispose(false, true);
  }

  _applyCameraOrientation({ yaw, pitch }) {
    this.mesh.rotationQuaternion = null;
    this.mesh.rotation.y = yaw;

    const clampedPitch = Math.max(-(Math.PI * 0.49), Math.min(Math.PI * 0.49, pitch));
    this.camera.rotation.x = clampedPitch;
    this.camera.rotation.y = 0;
    this.camera.rotation.z = 0;
  }

  _integrateMovement(deltaSeconds, inputState) {
    const { move, sprint, jump } = inputState;
    const yaw = this.mesh.rotation.y;
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);

    this._timeSinceGrounded += deltaSeconds;

    const desired = this._desiredMove;
    desired.copyFromFloats(
      sinYaw * move.y + cosYaw * move.x,
      0,
      cosYaw * move.y - sinYaw * move.x,
    );

    if (desired.lengthSquared() > 1e-4) {
      desired.normalize();
      desired.scaleInPlace(this.walkSpeed * (sprint ? this.sprintMultiplier : 1));
    } else {
      desired.setAll(0);
    }

    this._velocity.x = desired.x;
    this._velocity.z = desired.z;

    const canJump = jump && this._timeSinceGrounded <= COYOTE_TIME;
    if (canJump) {
      this._velocity.y = this.jumpImpulse;
      this._grounded = false;
      this._timeSinceGrounded = COYOTE_TIME + deltaSeconds;
      this.sound?.playJump();
    } else {
      this._velocity.y += GRAVITY * deltaSeconds;
      if (this._velocity.y < TERMINAL_VELOCITY) {
        this._velocity.y = TERMINAL_VELOCITY;
      }
    }

    const delta = this._movementDelta;
    delta.copyFrom(this._velocity);
    delta.scaleInPlace(deltaSeconds);

    this._previousPosition.copyFrom(this.mesh.position);
    this.mesh.moveWithCollisions(delta);
    this._clampToWorldBounds();

    this._actualMovement.copyFrom(this.mesh.position);
    this._actualMovement.subtractInPlace(this._previousPosition);

    const expectedY = delta.y;
    const actualY = this._actualMovement.y;

    let groundedAfter = false;
    if (expectedY < -COLLISION_EPSILON && Math.abs(expectedY - actualY) > COLLISION_EPSILON) {
      groundedAfter = true;
    }

    const headHit = expectedY > COLLISION_EPSILON && actualY + COLLISION_EPSILON < expectedY;
    if (headHit && this._velocity.y > 0) {
      this._velocity.y = 0;
    }

    if (!groundedAfter) {
      groundedAfter = this._isGrounded();
    }

    if (groundedAfter) {
      if (this._velocity.y < 0) {
        this._velocity.y = 0;
      }
      this._snapToGround(false);
      this._actualMovement.y = this.mesh.position.y - this._previousPosition.y;
      this._grounded = true;
      this._timeSinceGrounded = 0;
    } else {
      this._grounded = false;
    }

    const horizontalDistance = Math.hypot(this._actualMovement.x, this._actualMovement.z);
    this._handleFootsteps(this._grounded, horizontalDistance);
  }

  _clampToWorldBounds() {
    const maxRadius = this.world?.maxChunkRadius;
    if (!Number.isFinite(maxRadius)) return;
    const limit = (maxRadius + 0.5) * CHUNK_SIZE;
    this.mesh.position.x = Math.max(-limit, Math.min(limit, this.mesh.position.x));
    this.mesh.position.z = Math.max(-limit, Math.min(limit, this.mesh.position.z));
  }

  _isGrounded() {
    if (!this.scene || !this.mesh || !this._groundCheckOffsets) return false;
    const ellipsoid = this.mesh.ellipsoid;
    const offset = this.mesh.ellipsoidOffset;
    if (!ellipsoid || !offset) return false;
    if (this._velocity.y > 0.15) return false;

    const rayLength = GROUND_CHECK_DISTANCE + COLLISION_EPSILON;
    for (const lateral of this._groundCheckOffsets) {
      this._groundCheckOrigin.copyFrom(this.mesh.position);
      this._groundCheckOrigin.x += lateral.x;
      this._groundCheckOrigin.z += lateral.z;
      this._groundCheckOrigin.addInPlace(offset);
      this._groundCheckOrigin.y -= ellipsoid.y - GROUND_CHECK_OFFSET;

      this._groundCheckRay.origin.copyFrom(this._groundCheckOrigin);
      this._groundCheckRay.length = rayLength;

      const pick = this.scene.pickWithRay(this._groundCheckRay, this._groundPredicate, true);
      if (pick?.hit && pick.distance <= rayLength) {
        return true;
      }
    }

    return false;
  }

  _handleFootsteps(grounded, horizontalDistance) {
    if (grounded && horizontalDistance > FOOTSTEP_MIN_DISTANCE) {
      this._footstepAccumulator += horizontalDistance;
      if (this._footstepAccumulator >= FOOTSTEP_DISTANCE_INTERVAL) {
        this._footstepAccumulator = 0;
        const blockType = this._sampleGroundBlock();
        this.sound?.playFootstep(blockType);
      }
    } else {
      this._footstepAccumulator = 0;
    }
  }

  _sampleGroundBlock() {
    const worldX = Math.floor(this.mesh.position.x);
    const worldZ = Math.floor(this.mesh.position.z);
    const offsetY = this.mesh.ellipsoidOffset?.y ?? CAPSULE_HEIGHT * 0.5;
    const ellipsoidY = this.mesh.ellipsoid?.y ?? CAPSULE_HEIGHT * 0.5;
    const footY = this.mesh.position.y + offsetY - ellipsoidY;
    const baseY = Math.floor(footY - 0.1);
    if (!this.world?.getBlockAtWorld) return BLOCK_TYPES.dirt;
    let blockType = this.world.getBlockAtWorld(worldX, baseY, worldZ);
    if (blockType === BLOCK_TYPES.air) {
      blockType = this.world.getBlockAtWorld(worldX, baseY - 1, worldZ);
    }
    if (!Number.isFinite(blockType)) return BLOCK_TYPES.dirt;
    return blockType;
  }

  _snapToGround(force = false) {
    if (!this.scene || !this.mesh || !this._groundCheckOffsets) return;
    const ellipsoid = this.mesh.ellipsoid;
    const offset = this.mesh.ellipsoidOffset;
    if (!ellipsoid || !offset) return;

    const rayLength = (force ? GROUND_CHECK_DISTANCE * 2 : GROUND_CHECK_DISTANCE) + COLLISION_EPSILON;
    const limit = force ? 0.6 : 0.18;
    let bestTarget = null;
    let bestDiff = Number.POSITIVE_INFINITY;

    for (const lateral of this._groundCheckOffsets) {
      this._groundCheckOrigin.copyFrom(this.mesh.position);
      this._groundCheckOrigin.x += lateral.x;
      this._groundCheckOrigin.z += lateral.z;
      this._groundCheckOrigin.addInPlace(offset);
      this._groundCheckOrigin.y -= ellipsoid.y - GROUND_CHECK_OFFSET;

      this._groundCheckRay.origin.copyFrom(this._groundCheckOrigin);
      this._groundCheckRay.length = rayLength;

      const pick = this.scene.pickWithRay(this._groundCheckRay, this._groundPredicate, true);
      if (!pick?.hit) continue;

      const targetY = pick.pickedPoint.y - offset.y + ellipsoid.y;
      const diff = targetY - this.mesh.position.y;
      if (Math.abs(diff) <= limit && Math.abs(diff) < Math.abs(bestDiff)) {
        bestTarget = targetY;
        bestDiff = diff;
      }
    }

    if (bestTarget !== null) {
      this.mesh.position.y = bestTarget + COLLISION_EPSILON;
    }
  }
}
