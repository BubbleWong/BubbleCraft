import { CHUNK_SIZE, BLOCK_TYPES } from '../../../constants.js';

const DEFAULT_WALK_SPEED = 5.5;
const DEFAULT_SPRINT_MULTIPLIER = 1.65;
const DEFAULT_JUMP_IMPULSE = 7.7; // ≈1.35 block apex with GRAVITY
const GRAVITY = -22;
const TERMINAL_VELOCITY = -48;
const CAPSULE_HEIGHT = 1.9;
const CAPSULE_RADIUS = 0.3;
const CAMERA_EYE_HEIGHT = 1.62;
const CROUCH_HEIGHT = 1.3;
const CROUCH_CAMERA_HEIGHT = 1.2;
const CROUCH_SPEED_MULTIPLIER = 0.3;
const FOOTSTEP_DISTANCE_INTERVAL = 2.2;
const FOOTSTEP_MIN_DISTANCE = 0.01;
const GROUND_CHECK_DISTANCE = 0.22;
const GROUND_CHECK_OFFSET = 0.04;
const GROUND_NORMAL_THRESHOLD = 0.55;
const AIRBORNE_EDGE_SUPPORT_FALL_SPEED = -1.5;
const COLLISION_EPSILON = 1e-3;
const SOLID_OVERLAP_TOLERANCE = 0.035;
const COYOTE_TIME = 0.12;
const LEDGE_DROP_THRESHOLD = 0.18;
const CROUCH_TRANSITION_SPEED = 12; // units per second
const MAX_JUMP_ASCENT = 1.4;
const SAFE_FALL_BLOCKS = 3;
const OVERLAP_BACKTRACK_STEPS = 8;

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
    this.standHeight = CAPSULE_HEIGHT;
    this.standCameraHeight = CAMERA_EYE_HEIGHT;
    this.crouchHeight = CROUCH_HEIGHT;
    this.crouchCameraHeight = CROUCH_CAMERA_HEIGHT;
    this.crouchSpeedMultiplier = CROUCH_SPEED_MULTIPLIER;
    this._currentHeight = CAPSULE_HEIGHT;
    this._isCrouching = false;
    this._targetHeight = CAPSULE_HEIGHT;
    this._targetCameraHeight = CAMERA_EYE_HEIGHT;

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
    
    const physicsEnabled = typeof this.scene?.isPhysicsEnabled === 'function'
      ? this.scene.isPhysicsEnabled()
      : Boolean(this.scene?.getPhysicsEngine?.());
    if (physicsEnabled && typeof BABYLON.PhysicsImpostor === 'function') {
      try {
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
          this.mesh,
          BABYLON.PhysicsImpostor.CapsuleImpostor,
          { mass: 1, friction: 0, restitution: 0 },
          this.scene,
        );
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Failed to create player physics impostor', error);
      }
    }

    this.camera.parent = this.mesh;
    this.camera.position.set(0, CAMERA_EYE_HEIGHT, 0);
    this.camera.rotationQuaternion = null;

    this._velocity = new BABYLON.Vector3();
    this._spawnPoint = new BABYLON.Vector3(0, CAPSULE_HEIGHT, 0);
    this._footstepAccumulator = 0;
    this._desiredMove = new BABYLON.Vector3();
    this._movementDelta = new BABYLON.Vector3();
    this._horizontalDelta = new BABYLON.Vector3();
    this._verticalDelta = new BABYLON.Vector3();
    this._previousPosition = new BABYLON.Vector3();
    this._movementStageStart = new BABYLON.Vector3();
    this._actualMovement = new BABYLON.Vector3();
    this._groundCheckOrigin = new BABYLON.Vector3();
    this._groundCheckRay = new BABYLON.Ray(new BABYLON.Vector3(), new BABYLON.Vector3(0, -1, 0), GROUND_CHECK_DISTANCE);
    this._groundPredicate = (mesh) => !!mesh && mesh !== this.mesh && mesh.checkCollisions === true;
    this._resolveCandidate = new BABYLON.Vector3();
    this._resolveBacktrack = new BABYLON.Vector3();
    const lateralProbe = Math.max(0.18, CAPSULE_RADIUS * 0.85);
    const airborneProbe = Math.max(0.1, CAPSULE_RADIUS * 0.35);
    this._centerGroundCheckOffsets = [
      new BABYLON.Vector3(0, 0, 0),
    ];
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
    this._airborneGroundCheckOffsets = [
      new BABYLON.Vector3(0, 0, 0),
      new BABYLON.Vector3(airborneProbe, 0, 0),
      new BABYLON.Vector3(-airborneProbe, 0, 0),
      new BABYLON.Vector3(0, 0, airborneProbe),
      new BABYLON.Vector3(0, 0, -airborneProbe),
    ];
    this._grounded = false;
    this._timeSinceGrounded = 0;
    this._lastGroundFootY = 0;
    this._fallStartFootY = 0;
    this._setColliderHeight(this.standHeight, this.standCameraHeight);
    this._lastGroundFootY = this._footY();
    this._fallStartFootY = Math.floor(this._lastGroundFootY);
  }

  setSpawnPoint(position) {
    this._spawnPoint.copyFrom(position);
    this.mesh.position.copyFrom(position);
    this._velocity.setAll(0);
    this._grounded = false;
    this._timeSinceGrounded = 0;
    this._isCrouching = false;
    this._targetHeight = this.standHeight;
    this._targetCameraHeight = this.standCameraHeight;
    this._setColliderHeight(this.standHeight, this.standCameraHeight);
    this._snapToGround(true);
    if (this._isGrounded()) {
      this._grounded = true;
      this._timeSinceGrounded = 0;
    }
    this._lastGroundFootY = this._footY();
    this._fallStartFootY = Math.floor(this._lastGroundFootY);
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
    this._updateCrouchTransition(deltaSeconds);
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
    this._isCrouching = false;
    this._targetHeight = this.standHeight;
    this._targetCameraHeight = this.standCameraHeight;
    this._setColliderHeight(this.standHeight, this.standCameraHeight);
    this._snapToGround(true);
    if (this._isGrounded()) {
      this._grounded = true;
      this._timeSinceGrounded = 0;
    }
    this._lastGroundFootY = this._footY();
    this._fallStartFootY = Math.floor(this._lastGroundFootY);
    this.eventBus?.emit('player:respawn', { position: this.mesh.position.clone(), player: this });
  }

  dispose() {
    if (this.mesh.physicsImpostor) {
      try {
        this.mesh.physicsImpostor.dispose();
      } catch (error) {
        // ignore physics cleanup failures
      }
      this.mesh.physicsImpostor = null;
    }
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
    const { move, sprint, jump, crouch } = inputState;
    const yaw = this.mesh.rotation.y;
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);

    this._timeSinceGrounded += deltaSeconds;
    const wasGrounded = this._grounded;
    const crouchActive = this._applyCrouchState(crouch);
    const sprintActive = !crouchActive && sprint;

    const desired = this._desiredMove;
    desired.copyFromFloats(
      sinYaw * move.y + cosYaw * move.x,
      0,
      cosYaw * move.y - sinYaw * move.x,
    );

    if (desired.lengthSquared() > 1e-4) {
      const inputMagnitude = Math.min(1.0, desired.length());
      desired.normalize();
      let moveSpeed = this.walkSpeed * inputMagnitude;
      if (sprintActive) moveSpeed *= this.sprintMultiplier;
      if (crouchActive) moveSpeed *= this.crouchSpeedMultiplier;
      desired.scaleInPlace(moveSpeed);
    } else {
      desired.setAll(0);
    }

    this._velocity.x = desired.x;
    this._velocity.z = desired.z;

    const canJump = jump && this._timeSinceGrounded <= COYOTE_TIME;
    if (canJump) {
      this._lastGroundFootY = this._footY();
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

    const baseFootY = this._footY();
    const maxAllowedFootY = this._lastGroundFootY + MAX_JUMP_ASCENT;

    const delta = this._movementDelta;
    delta.copyFrom(this._velocity);
    delta.scaleInPlace(deltaSeconds);

    if (!this._grounded && this._velocity.y > 0 && baseFootY < maxAllowedFootY) {
      const projectedFootY = baseFootY + delta.y;
      if (projectedFootY > maxAllowedFootY) {
        const excess = projectedFootY - maxAllowedFootY;
        delta.y -= excess;
        if (delta.y < 0) {
          delta.y = 0;
        }
        if (deltaSeconds > 0) {
          this._velocity.y = Math.max(0, delta.y / deltaSeconds);
        } else {
          this._velocity.y = 0;
        }
      }
    }

    const horizontalMove = Math.hypot(delta.x, delta.z);
    if (crouchActive && this._grounded && horizontalMove > 1e-4) {
      const predicted = this.mesh.position.clone();
      predicted.x += delta.x;
      predicted.z += delta.z;
      const drop = this._measureGroundDistance(predicted);
      if (drop > LEDGE_DROP_THRESHOLD) {
        delta.x = 0;
        delta.z = 0;
        this._velocity.x = 0;
        this._velocity.z = 0;
      }
    }

    this._previousPosition.copyFrom(this.mesh.position);
    const previousFootY = this._footY(this._previousPosition);
    const expectedY = delta.y;

    this._horizontalDelta.set(delta.x, 0, delta.z);
    if (Math.abs(delta.x) > COLLISION_EPSILON || Math.abs(delta.z) > COLLISION_EPSILON) {
      this.mesh.moveWithCollisions(this._horizontalDelta);
      this._clampToWorldBounds();
      this._resolveSolidOverlap(this._previousPosition);
    }

    let postMoveFootY = this._footY();

    this._verticalDelta.set(0, expectedY, 0);
    if (Math.abs(expectedY) > COLLISION_EPSILON) {
      this._movementStageStart.copyFrom(this.mesh.position);
      this.mesh.moveWithCollisions(this._verticalDelta);
      postMoveFootY = this._footY();
      if (!this._grounded && postMoveFootY > maxAllowedFootY + COLLISION_EPSILON) {
        const correction = postMoveFootY - (maxAllowedFootY + COLLISION_EPSILON);
        this.mesh.position.y -= correction;
        postMoveFootY = this._footY();
        if (this._velocity.y > 0) {
          this._velocity.y = 0;
        }
      }
      this._resolveSolidOverlap(this._movementStageStart);
    }

    this._clampToWorldBounds();

    this._actualMovement.copyFrom(this.mesh.position);
    this._actualMovement.subtractInPlace(this._previousPosition);

    const actualY = this._actualMovement.y;

    let groundedAfter = this._isGrounded();

    const headHit = expectedY > COLLISION_EPSILON && actualY + COLLISION_EPSILON < expectedY;
    if (headHit && this._velocity.y > 0) {
      this._velocity.y = 0;
    }

    if (wasGrounded && !groundedAfter) {
      this._fallStartFootY = Math.floor(previousFootY);
    }

    if (groundedAfter) {
      if (this._velocity.y < 0) {
        this._velocity.y = 0;
      }
      this._snapToGround(false);
      this._actualMovement.y = this.mesh.position.y - this._previousPosition.y;
      this._grounded = true;
      this._timeSinceGrounded = 0;
      const landingFoot = this._footY();
      this._lastGroundFootY = landingFoot;
      const landingSurface = this.world?.getSurfaceHeight?.(this.mesh.position.x, this.mesh.position.z);
      const landingSurfaceInt = Number.isFinite(landingSurface)
        ? Math.floor(landingSurface)
        : Math.floor(landingFoot);
      if (!wasGrounded) {
        const startFoot = Number.isFinite(this._fallStartFootY)
          ? this._fallStartFootY
          : landingSurfaceInt;
        const fallDistance = Math.max(0, startFoot - landingSurfaceInt);
        const landedInWater = this._didFallThroughWater(startFoot, landingSurfaceInt);
        const damage = landedInWater ? 0 : Math.max(0, fallDistance - SAFE_FALL_BLOCKS);
        if (damage > 0) {
          this._emitDamage({ amount: damage, cause: 'fall', fallDistance });
        }
      }
      this._fallStartFootY = landingSurfaceInt;
    } else {
      this._grounded = false;
    }

    const movedHorizontally = Math.abs(this._actualMovement.x) > 1e-4 || Math.abs(this._actualMovement.z) > 1e-4;
    if (crouchActive && wasGrounded && movedHorizontally) {
      const drop = this._measureGroundDistance(this.mesh.position);
      if (drop > LEDGE_DROP_THRESHOLD) {
        this.mesh.position.x = this._previousPosition.x;
        this.mesh.position.z = this._previousPosition.z;
        this._actualMovement.x = 0;
        this._actualMovement.z = 0;
        this._velocity.x = 0;
        this._velocity.z = 0;
        this._snapToGround(false);
        this._grounded = true;
        this._timeSinceGrounded = 0;
      }
    }

    const horizontalDistance = Math.hypot(this._actualMovement.x, this._actualMovement.z);
    this._handleFootsteps(this._grounded, horizontalDistance);
  }

  _emitDamage({ amount, cause = 'generic', fallDistance = 0 } = {}) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.eventBus?.emit('player:damage', {
      amount,
      cause,
      fallDistance,
      player: this,
      position: this.mesh.position.clone(),
    });
  }

  _clampToWorldBounds() {
    const maxRadius = this.world?.maxChunkRadius;
    if (!Number.isFinite(maxRadius)) return;
    const limit = (maxRadius + 0.5) * CHUNK_SIZE;
    this.mesh.position.x = Math.max(-limit, Math.min(limit, this.mesh.position.x));
    this.mesh.position.z = Math.max(-limit, Math.min(limit, this.mesh.position.z));
  }

  _applyCrouchState(requestCrouch) {
    const target = Boolean(requestCrouch);
    if (target) {
      if (!this._isCrouching) {
        this._targetHeight = this.crouchHeight;
        this._targetCameraHeight = this.crouchCameraHeight;
        this._isCrouching = true;
      }
      return true;
    }

    if (!this._isCrouching) {
      return false;
    }

    if (!this._hasHeadroom(this.standHeight)) {
      return true;
    }

    this._targetHeight = this.standHeight;
    this._targetCameraHeight = this.standCameraHeight;
    this._isCrouching = false;
    return false;
  }

  _setColliderHeight(height, eyeHeight) {
    const halfHeight = height * 0.5;
    this.mesh.ellipsoid.y = halfHeight;
    this.mesh.ellipsoidOffset.y = halfHeight;
    this.camera.position.y = eyeHeight;
    this._currentHeight = height;
  }

  _hasHeadroom(targetHeight) {
    if (!this.world?.getBlockAtWorld || !this._groundCheckOffsets) return true;
    const extraHeight = targetHeight - this._currentHeight;
    if (extraHeight <= COLLISION_EPSILON) return true;

    const footY = this._footY();
    const startY = Math.floor(footY + this._currentHeight + COLLISION_EPSILON);
    const endY = Math.floor(footY + targetHeight - COLLISION_EPSILON);
    if (endY < startY) return true;

    for (const lateral of this._groundCheckOffsets) {
      const blockX = Math.floor(this.mesh.position.x + lateral.x);
      const blockZ = Math.floor(this.mesh.position.z + lateral.z);
      for (let by = startY; by <= endY; by += 1) {
        const blockType = this.world.getBlockAtWorld(blockX, by, blockZ);
        if (!this._isPassableBlock(blockType)) {
          return false;
        }
      }
    }
    return true;
  }

  _isGrounded() {
    if (!this.scene || !this.mesh || !this._groundCheckOffsets || !this._airborneGroundCheckOffsets || !this._centerGroundCheckOffsets) return false;
    const ellipsoid = this.mesh.ellipsoid;
    const offset = this.mesh.ellipsoidOffset;
    if (!ellipsoid || !offset) return false;
    if (this._velocity.y > 0.15) return false;

    const rayLength = GROUND_CHECK_DISTANCE + COLLISION_EPSILON;
    const probeOffsets = this._getGroundProbeOffsets(false);
    for (const lateral of probeOffsets) {
      this._groundCheckOrigin.copyFrom(this.mesh.position);
      this._groundCheckOrigin.x += lateral.x;
      this._groundCheckOrigin.z += lateral.z;
      this._groundCheckOrigin.addInPlace(offset);
      this._groundCheckOrigin.y -= ellipsoid.y - GROUND_CHECK_OFFSET;

      this._groundCheckRay.origin.copyFrom(this._groundCheckOrigin);
      this._groundCheckRay.length = rayLength;

      const pick = this.scene.pickWithRay(this._groundCheckRay, this._groundPredicate, true);
      const normal = pick?.getNormal?.(true, true);
      if (pick?.hit && pick.distance <= rayLength && (normal?.y ?? 0) >= GROUND_NORMAL_THRESHOLD) {
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
    const footY = this._footY();
    const baseY = Math.floor(footY - 0.1);
    if (!this.world?.getBlockAtWorld) return BLOCK_TYPES.dirt;
    let blockType = this.world.getBlockAtWorld(worldX, baseY, worldZ);
    if (blockType === BLOCK_TYPES.air) {
      blockType = this.world.getBlockAtWorld(worldX, baseY - 1, worldZ);
    }
    if (!Number.isFinite(blockType)) return BLOCK_TYPES.dirt;
    return blockType;
  }

  _didFallThroughWater(startFootY, landingFootY) {
    if (!this.world?.getBlockAtWorld || !Number.isFinite(startFootY) || !Number.isFinite(landingFootY)) {
      return false;
    }

    const fromY = Math.min(startFootY, landingFootY);
    const toY = Math.max(startFootY, landingFootY);
    const samples = this._groundCheckOffsets ?? [new BABYLON.Vector3(0, 0, 0)];

    for (const lateral of samples) {
      const worldX = Math.floor(this.mesh.position.x + lateral.x);
      const worldZ = Math.floor(this.mesh.position.z + lateral.z);
      for (let y = fromY; y <= toY; y += 1) {
        if (this.world.getBlockAtWorld(worldX, y, worldZ) === BLOCK_TYPES.water) {
          return true;
        }
      }
    }

    return false;
  }

  _footY(position = this.mesh.position) {
    const ellipsoid = this.mesh.ellipsoid;
    const offset = this.mesh.ellipsoidOffset;
    const offsetY = offset?.y ?? (this._currentHeight * 0.5);
    const ellipsoidY = ellipsoid?.y ?? (this._currentHeight * 0.5);
    return position.y + offsetY - ellipsoidY;
  }

  _updateCrouchTransition(deltaSeconds) {
    const heightDiff = this._targetHeight - this._currentHeight;
    if (Math.abs(heightDiff) < 1e-3) {
      this._setColliderHeight(this._targetHeight, this._targetCameraHeight);
      return;
    }

    const maxStep = CROUCH_TRANSITION_SPEED * deltaSeconds;
    const applied = Math.abs(heightDiff) <= maxStep ? heightDiff : Math.sign(heightDiff) * maxStep;
    const nextHeight = this._currentHeight + applied;
    const cameraDiff = this._targetCameraHeight - this.camera.position.y;
    const cameraApplied = Math.abs(cameraDiff) <= maxStep ? cameraDiff : Math.sign(cameraDiff) * maxStep;
    const nextCamera = this.camera.position.y + cameraApplied;

    this._setColliderHeight(nextHeight, nextCamera);
  }

  _measureGroundDistance(position) {
    if (!this.world?.getSurfaceHeight || !this._groundCheckOffsets) return Number.POSITIVE_INFINITY;
    const footY = this._footY(position);
    let minDrop = Number.POSITIVE_INFINITY;
    for (const lateral of this._groundCheckOffsets) {
      const surface = this.world.getSurfaceHeight(position.x + lateral.x, position.z + lateral.z);
      if (!Number.isFinite(surface)) continue;
      const drop = Math.max(0, footY - surface);
      if (drop < minDrop) {
        minDrop = drop;
      }
    }
    return minDrop;
  }

  _isPassableBlock(blockType) {
    if (!Number.isFinite(blockType)) return true;
    return blockType === BLOCK_TYPES.air || blockType === BLOCK_TYPES.flower || blockType === BLOCK_TYPES.water;
  }

  _intersectsSolid(position = this.mesh.position) {
    if (!this.world?.getBlockAtWorld || !position) return false;
    const ellipsoid = this.mesh.ellipsoid;
    const radius = Math.max(0.05, (ellipsoid?.x ?? CAPSULE_RADIUS) - SOLID_OVERLAP_TOLERANCE);
    const footY = this._footY(position) + SOLID_OVERLAP_TOLERANCE;
    const headY = footY + Math.max(0.2, this._currentHeight - SOLID_OVERLAP_TOLERANCE * 2);

    const minX = position.x - radius;
    const maxX = position.x + radius;
    const minZ = position.z - radius;
    const maxZ = position.z + radius;
    const minY = footY;
    const maxY = headY;

    const startX = Math.floor(minX);
    const endX = Math.floor(maxX);
    const startY = Math.floor(minY);
    const endY = Math.floor(maxY);
    const startZ = Math.floor(minZ);
    const endZ = Math.floor(maxZ);

    for (let by = startY; by <= endY; by += 1) {
      for (let bz = startZ; bz <= endZ; bz += 1) {
        for (let bx = startX; bx <= endX; bx += 1) {
          const blockType = this.world.getBlockAtWorld(bx, by, bz);
          if (this._isPassableBlock(blockType)) continue;
          const overlapsX = minX < (bx + 1 - COLLISION_EPSILON) && maxX > (bx + COLLISION_EPSILON);
          const overlapsY = minY < (by + 1 - COLLISION_EPSILON) && maxY > (by + COLLISION_EPSILON);
          const overlapsZ = minZ < (bz + 1 - COLLISION_EPSILON) && maxZ > (bz + COLLISION_EPSILON);
          if (overlapsX && overlapsY && overlapsZ) {
            return true;
          }
        }
      }
    }

    return false;
  }

  _resolveSolidOverlap(previousPosition) {
    if (!previousPosition || !this._intersectsSolid(this.mesh.position)) return false;

    const currentX = this.mesh.position.x;
    const currentY = this.mesh.position.y;
    const currentZ = this.mesh.position.z;
    const moveX = currentX - previousPosition.x;
    const moveY = currentY - previousPosition.y;
    const moveZ = currentZ - previousPosition.z;

    const tryCandidate = (x, y, z) => {
      this._resolveCandidate.set(x, y, z);
      if (this._intersectsSolid(this._resolveCandidate)) return false;
      this.mesh.position.copyFrom(this._resolveCandidate);
      return true;
    };

    if (tryCandidate(previousPosition.x, currentY, currentZ)) return true;
    if (tryCandidate(currentX, currentY, previousPosition.z)) return true;
    if (tryCandidate(previousPosition.x, currentY, previousPosition.z)) return true;
    if (tryCandidate(currentX, previousPosition.y, currentZ)) return true;
    if (tryCandidate(previousPosition.x, previousPosition.y, previousPosition.z)) return true;

    for (let step = 1; step <= OVERLAP_BACKTRACK_STEPS; step += 1) {
      const t = step / OVERLAP_BACKTRACK_STEPS;
      this._resolveBacktrack.set(
        currentX - moveX * t,
        currentY - moveY * t,
        currentZ - moveZ * t,
      );
      if (!this._intersectsSolid(this._resolveBacktrack)) {
        this.mesh.position.copyFrom(this._resolveBacktrack);
        return true;
      }
    }

    this.mesh.position.copyFrom(previousPosition);
    return true;
  }

  _getGroundProbeOffsets(force = false) {
    if (force || this._grounded) {
      return this._groundCheckOffsets;
    }

    if (this._velocity.y > AIRBORNE_EDGE_SUPPORT_FALL_SPEED) {
      return this._centerGroundCheckOffsets;
    }

    return this._airborneGroundCheckOffsets;
  }

  _snapToGround(force = false) {
    if (!this.scene || !this.mesh || !this._groundCheckOffsets || !this._airborneGroundCheckOffsets || !this._centerGroundCheckOffsets) return;
    const ellipsoid = this.mesh.ellipsoid;
    const offset = this.mesh.ellipsoidOffset;
    if (!ellipsoid || !offset) return;

    const rayLength = (force ? GROUND_CHECK_DISTANCE * 2 : GROUND_CHECK_DISTANCE) + COLLISION_EPSILON;
    const limit = force ? 0.6 : 0.18;
    let bestTarget = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    const probeOffsets = this._getGroundProbeOffsets(force);

    for (const lateral of probeOffsets) {
      this._groundCheckOrigin.copyFrom(this.mesh.position);
      this._groundCheckOrigin.x += lateral.x;
      this._groundCheckOrigin.z += lateral.z;
      this._groundCheckOrigin.addInPlace(offset);
      this._groundCheckOrigin.y -= ellipsoid.y - GROUND_CHECK_OFFSET;

      this._groundCheckRay.origin.copyFrom(this._groundCheckOrigin);
      this._groundCheckRay.length = rayLength;

      const pick = this.scene.pickWithRay(this._groundCheckRay, this._groundPredicate, true);
      if (!pick?.hit) continue;
      const normal = pick.getNormal?.(true, true);
      if ((normal?.y ?? 0) < GROUND_NORMAL_THRESHOLD) continue;

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
