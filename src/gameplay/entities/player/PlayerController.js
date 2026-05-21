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
const CAMERA_VIEW_FIRST_PERSON = 0;
const CAMERA_VIEW_THIRD_PERSON_BACK = 1;
const CAMERA_VIEW_THIRD_PERSON_FRONT = 2;
const CAMERA_VIEW_COUNT = 3;
const THIRD_PERSON_CAMERA_DISTANCE = 4.2;
const THIRD_PERSON_CAMERA_HEIGHT = 0.32;
const THIRD_PERSON_CAMERA_COLLISION_PADDING = 0.18;
const ACTION_SWING_DURATION = 0.22;
const ACTION_SWING_REPEAT_INTERVAL = 0.18;
const FIRST_PERSON_HAND_REST_X = 0.54;
const FIRST_PERSON_HAND_REST_Y = -0.78;
const FIRST_PERSON_HAND_REST_Z = 0.8;
const FIRST_PERSON_HAND_BOB_X = 0.018;
const FIRST_PERSON_HAND_BOB_Y = 0.014;
const FIRST_PERSON_HAND_BOB_Z = 0.012;
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

    this._cameraViewMode = CAMERA_VIEW_FIRST_PERSON;
    this._cameraMount = new BABYLON.TransformNode('player-camera-mount', this.scene);
    this._cameraMount.parent = this.mesh;
    this._cameraMount.position.set(0, CAMERA_EYE_HEIGHT, 0);
    this._cameraMount.rotation.set(0, 0, 0);

    this.camera.parent = this._cameraMount;
    this.camera.position.set(0, 0, 0);
    this.camera.rotationQuaternion = null;
    this.camera.rotation.set(0, 0, 0);

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
    this._cameraTarget = new BABYLON.Vector3();
    this._cameraDesiredOffset = new BABYLON.Vector3();
    this._cameraDesiredWorld = new BABYLON.Vector3();
    this._cameraCollisionDirection = new BABYLON.Vector3();
    this._interactionOrigin = new BABYLON.Vector3();
    this._interactionDirection = new BABYLON.Vector3();
    this._groundCheckOrigin = new BABYLON.Vector3();
    this._groundCheckRay = new BABYLON.Ray(new BABYLON.Vector3(), new BABYLON.Vector3(0, -1, 0), GROUND_CHECK_DISTANCE);
    this._groundPredicate = (mesh) => !!mesh && mesh !== this.mesh && mesh.checkCollisions === true;
    this._cameraCollisionRay = new BABYLON.Ray(new BABYLON.Vector3(), new BABYLON.Vector3(0, 0, -1), THIRD_PERSON_CAMERA_DISTANCE);
    this._cameraCollisionPredicate = (mesh) => !!mesh && mesh !== this.mesh && mesh.checkCollisions === true;
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
    this._walkCycle = 0;
    this._limbSwing = 0;
    this._crouchVisual = 0;
    this._runVisual = 0;
    this._jumpVisual = 0;
    this._actionSwingTime = 0;
    this._actionSwingRepeatTimer = 0;
    this._actionActiveLastFrame = false;
    this._activeActionType = 'mine';
    this._animationDisposers = [];
    this._setColliderHeight(this.standHeight, this.standCameraHeight);
    this._createAvatar();
    this._createFirstPersonHands();
    this._bindAnimationEvents();
    this._syncAvatarTransform();
    this._lastGroundFootY = this._footY();
    this._fallStartFootY = Math.floor(this._lastGroundFootY);
    this._updateAvatarVisibility();
    this._updateAvatarPose(0, 0);
    this._updateCameraView();
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
    this._syncAvatarTransform();
    this._updateAvatarPose(0, 0);
    this._updateCameraView();
  }

  setOrientation({ yaw, pitch }) {
    this._applyCameraOrientation({
      yaw: Number.isFinite(yaw) ? yaw : this.mesh.rotation.y,
      pitch: Number.isFinite(pitch) ? pitch : this._cameraMount.rotation.x,
    });
    this._updateCameraView();
  }

  update(deltaSeconds, frameInput = null) {
    const inputState = frameInput ?? this.input.poll();
    const actionType = inputState.actions?.break
      ? 'mine'
      : inputState.actions?.place
        ? 'place'
        : null;
    if (inputState.cycleCameraView) {
      this.cycleCameraView();
    }
    this._updateActionSwing(deltaSeconds, actionType);
    this._applyCameraOrientation(inputState.look);
    this._updateCrouchTransition(deltaSeconds);
    this._integrateMovement(deltaSeconds, inputState);
    this._syncAvatarTransform();
    const horizontalDistance = Math.hypot(this._actualMovement.x, this._actualMovement.z);
    this._updateAvatarPose(deltaSeconds, horizontalDistance, inputState);
    this._updateFirstPersonHands(deltaSeconds, horizontalDistance, inputState);
    this._updateCameraView();

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
    this._syncAvatarTransform();
    this._updateAvatarPose(0, 0);
    this._updateCameraView();
    this.eventBus?.emit('player:respawn', { position: this.mesh.position.clone(), player: this });
  }

  dispose() {
    for (const dispose of this._animationDisposers) {
      try {
        dispose?.();
      } catch (error) {
        // ignore animation listener cleanup failures
      }
    }
    this._animationDisposers.length = 0;
    this._avatarRoot?.dispose?.(false, true);
    this._avatarRoot = null;
    this._viewModelRoot?.dispose?.(false, true);
    this._viewModelRoot = null;
    this._cameraMount?.dispose?.();
    this._cameraMount = null;
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
    this._cameraMount.rotation.x = clampedPitch;
    this._cameraMount.rotation.y = 0;
    this._cameraMount.rotation.z = 0;
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

  cycleCameraView() {
    this._cameraViewMode = (this._cameraViewMode + 1) % CAMERA_VIEW_COUNT;
    this._updateAvatarVisibility();
    this._updateCameraView();
  }

  _updateCameraView() {
    if (!this.camera || !this._cameraMount) return;

    this.camera.rotationQuaternion = null;
    if (this._cameraViewMode === CAMERA_VIEW_FIRST_PERSON) {
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
      return;
    }

    const inFront = this._cameraViewMode === CAMERA_VIEW_THIRD_PERSON_FRONT;
    this._cameraDesiredOffset.set(
      0,
      THIRD_PERSON_CAMERA_HEIGHT,
      inFront ? THIRD_PERSON_CAMERA_DISTANCE : -THIRD_PERSON_CAMERA_DISTANCE,
    );

    const scale = this._resolveCameraOffsetScale(this._cameraDesiredOffset);
    this.camera.position.copyFrom(this._cameraDesiredOffset);
    if (scale < 1) {
      this.camera.position.scaleInPlace(scale);
    }

    this.camera.rotation.set(0, inFront ? Math.PI : 0, 0);
  }

  _resolveCameraOffsetScale(desiredOffset) {
    if (!this.scene || !this._cameraMount) return 1;

    this._cameraMount.computeWorldMatrix(true);
    BABYLON.Vector3.TransformCoordinatesToRef(
      desiredOffset,
      this._cameraMount.getWorldMatrix(),
      this._cameraDesiredWorld,
    );

    this._cameraCollisionDirection.copyFrom(this._cameraDesiredWorld);
    this._cameraCollisionDirection.subtractInPlace(this._cameraMount.getAbsolutePosition());
    const distance = this._cameraCollisionDirection.length();
    if (distance <= COLLISION_EPSILON) return 1;

    this._cameraCollisionDirection.scaleInPlace(1 / distance);
    this._cameraCollisionRay.origin.copyFrom(this._cameraMount.getAbsolutePosition());
    this._cameraCollisionRay.direction.copyFrom(this._cameraCollisionDirection);
    this._cameraCollisionRay.length = distance;

    const pick = this.scene.pickWithRay(this._cameraCollisionRay, this._cameraCollisionPredicate, true);
    if (!pick?.hit || pick.distance >= distance) {
      return 1;
    }

    const clipped = Math.max(0.35, pick.distance - THIRD_PERSON_CAMERA_COLLISION_PADDING);
    return Math.min(1, clipped / distance);
  }

  _updateAvatarVisibility() {
    this._avatarRoot?.setEnabled?.(this._cameraViewMode !== CAMERA_VIEW_FIRST_PERSON);
    this._viewModelRoot?.setEnabled?.(this._cameraViewMode === CAMERA_VIEW_FIRST_PERSON);
  }

  _syncAvatarTransform() {
    if (!this._avatarRoot || !this.mesh) return;
    this._avatarRoot.position.copyFrom(this.mesh.position);
    this._avatarRoot.rotation.x = 0;
    this._avatarRoot.rotation.y = this.mesh.rotation.y;
    this._avatarRoot.rotation.z = 0;
  }

  _bindAnimationEvents() {
    if (!this.eventBus?.on) return;
    this._animationDisposers.push(
      this.eventBus.on('block:break', () => this._triggerActionSwing('mine')),
      this.eventBus.on('block:place', () => this._triggerActionSwing('place')),
    );
  }

  triggerActionAnimation(type = 'mine') {
    this._triggerActionSwing(type);
  }

  _triggerActionSwing(type = 'mine') {
    this._activeActionType = type === 'place' ? 'place' : 'mine';
    this._actionSwingTime = ACTION_SWING_DURATION;
  }

  _updateActionSwing(deltaSeconds, actionType) {
    this._actionSwingTime = Math.max(0, this._actionSwingTime - deltaSeconds);
    this._actionSwingRepeatTimer = Math.max(0, this._actionSwingRepeatTimer - deltaSeconds);

    const actionActive = Boolean(actionType);
    if (actionActive) {
      if (!this._actionActiveLastFrame || this._actionSwingRepeatTimer <= 0) {
        this._triggerActionSwing(actionType);
        this._actionSwingRepeatTimer = ACTION_SWING_REPEAT_INTERVAL;
      }
    } else {
      this._actionSwingRepeatTimer = 0;
    }

    this._actionActiveLastFrame = actionActive;
  }

  _getActionSwingCurve() {
    if (this._actionSwingTime <= 0) return 0;
    return Math.sin((1 - (this._actionSwingTime / ACTION_SWING_DURATION)) * Math.PI);
  }

  _createAvatar() {
    if (!this.scene || !this.mesh) return;

    const makeMaterial = (name, color) => {
      const material = new BABYLON.StandardMaterial(name, this.scene);
      material.diffuseColor = color;
      material.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
      return material;
    };

    const makePivot = (name, parent, position) => {
      const node = new BABYLON.TransformNode(name, this.scene);
      node.parent = parent;
      node.position.copyFrom(position);
      return node;
    };

    const makePart = (name, parent, options, material, position) => {
      const mesh = BABYLON.MeshBuilder.CreateBox(name, options, this.scene);
      mesh.parent = parent;
      mesh.position.copyFrom(position);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.alwaysSelectAsActiveMesh = true;
      return mesh;
    };

    this._avatarRoot = new BABYLON.TransformNode('player-avatar-root', this.scene);
    this._avatarRoot.position.copyFrom(this.mesh.position);
    this._avatarRoot.rotation.set(0, this.mesh.rotation.y, 0);

    const skin = makeMaterial('player-skin', new BABYLON.Color3(0.96, 0.82, 0.69));
    const skinShade = makeMaterial('player-skin-shade', new BABYLON.Color3(0.78, 0.55, 0.42));
    const shirt = makeMaterial('player-shirt', new BABYLON.Color3(0.18, 0.58, 0.82));
    const jacket = makeMaterial('player-jacket', new BABYLON.Color3(0.08, 0.28, 0.38));
    const pack = makeMaterial('player-pack', new BABYLON.Color3(0.28, 0.19, 0.1));
    const packTrim = makeMaterial('player-pack-trim', new BABYLON.Color3(0.48, 0.34, 0.18));
    const pants = makeMaterial('player-pants', new BABYLON.Color3(0.14, 0.2, 0.46));
    const hair = makeMaterial('player-hair', new BABYLON.Color3(0.22, 0.15, 0.08));
    const boots = makeMaterial('player-boots', new BABYLON.Color3(0.12, 0.11, 0.12));
    const eye = makeMaterial('player-eye', new BABYLON.Color3(0.04, 0.04, 0.04));
    const belt = makeMaterial('player-belt', new BABYLON.Color3(0.1, 0.08, 0.06));
    const buckle = makeMaterial('player-buckle', new BABYLON.Color3(0.86, 0.62, 0.18));

    this._avatarBody = makePart(
      'player-body',
      this._avatarRoot,
      { width: 0.72, height: 0.82, depth: 0.36 },
      shirt,
      new BABYLON.Vector3(0, 1.12, 0),
    );
    this._avatarJacketLeft = makePart(
      'player-jacket-left',
      this._avatarBody,
      { width: 0.22, height: 0.76, depth: 0.024 },
      jacket,
      new BABYLON.Vector3(-0.21, 0.02, 0.19),
    );
    this._avatarJacketRight = makePart(
      'player-jacket-right',
      this._avatarBody,
      { width: 0.22, height: 0.76, depth: 0.024 },
      jacket,
      new BABYLON.Vector3(0.21, 0.02, 0.19),
    );
    this._avatarJacketBack = makePart(
      'player-jacket-back',
      this._avatarBody,
      { width: 0.64, height: 0.72, depth: 0.03 },
      jacket,
      new BABYLON.Vector3(0, 0.02, -0.2),
    );
    this._avatarBackpack = makePart(
      'player-backpack',
      this._avatarBody,
      { width: 0.52, height: 0.52, depth: 0.16 },
      pack,
      new BABYLON.Vector3(0, 0.05, -0.32),
    );
    this._avatarBackpackFlap = makePart(
      'player-backpack-flap',
      this._avatarBackpack,
      { width: 0.44, height: 0.12, depth: 0.03 },
      packTrim,
      new BABYLON.Vector3(0, 0.16, -0.095),
    );
    this._avatarBackpackPocket = makePart(
      'player-backpack-pocket',
      this._avatarBackpack,
      { width: 0.3, height: 0.18, depth: 0.035 },
      packTrim,
      new BABYLON.Vector3(0, -0.12, -0.095),
    );
    this._avatarBackStrapLeft = makePart(
      'player-back-strap-left',
      this._avatarBody,
      { width: 0.08, height: 0.74, depth: 0.034 },
      packTrim,
      new BABYLON.Vector3(-0.2, 0.0, -0.215),
    );
    this._avatarBackStrapRight = makePart(
      'player-back-strap-right',
      this._avatarBody,
      { width: 0.08, height: 0.74, depth: 0.034 },
      packTrim,
      new BABYLON.Vector3(0.2, 0.0, -0.215),
    );
    this._avatarShirtStripe = makePart(
      'player-shirt-stripe',
      this._avatarBody,
      { width: 0.06, height: 0.72, depth: 0.028 },
      new BABYLON.StandardMaterial('player-shirt-stripe-material', this.scene),
      new BABYLON.Vector3(0, 0.03, 0.2),
    );
    this._avatarShirtStripe.material.diffuseColor = new BABYLON.Color3(0.12, 0.38, 0.56);
    this._avatarShirtStripe.material.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
    this._avatarBelt = makePart(
      'player-belt',
      this._avatarBody,
      { width: 0.74, height: 0.08, depth: 0.03 },
      belt,
      new BABYLON.Vector3(0, -0.35, 0.2),
    );
    this._avatarBuckle = makePart(
      'player-buckle',
      this._avatarBody,
      { width: 0.12, height: 0.1, depth: 0.034 },
      buckle,
      new BABYLON.Vector3(0, -0.35, 0.215),
    );

    this._avatarHeadPivot = makePivot('player-head-pivot', this._avatarRoot, new BABYLON.Vector3(0, 1.44, 0));
    this._avatarHead = makePart(
      'player-head',
      this._avatarHeadPivot,
      { width: 0.62, height: 0.62, depth: 0.62 },
      skin,
      new BABYLON.Vector3(0, 0.3, 0),
    );
    this._avatarHair = makePart(
      'player-hair',
      this._avatarHeadPivot,
      { width: 0.66, height: 0.14, depth: 0.66 },
      hair,
      new BABYLON.Vector3(0, 0.64, 0),
    );
    this._avatarHairFront = makePart(
      'player-hair-front',
      this._avatarHeadPivot,
      { width: 0.66, height: 0.16, depth: 0.08 },
      hair,
      new BABYLON.Vector3(0, 0.48, 0.34),
    );
    this._avatarHairLeft = makePart(
      'player-hair-left',
      this._avatarHeadPivot,
      { width: 0.08, height: 0.34, depth: 0.66 },
      hair,
      new BABYLON.Vector3(-0.34, 0.34, 0),
    );
    this._avatarHairRight = makePart(
      'player-hair-right',
      this._avatarHeadPivot,
      { width: 0.08, height: 0.34, depth: 0.66 },
      hair,
      new BABYLON.Vector3(0.34, 0.34, 0),
    );
    this._avatarHairBack = makePart(
      'player-hair-back',
      this._avatarHeadPivot,
      { width: 0.66, height: 0.38, depth: 0.08 },
      hair,
      new BABYLON.Vector3(0, 0.34, -0.34),
    );
    this._avatarLeftEye = makePart(
      'player-left-eye',
      this._avatarHeadPivot,
      { width: 0.08, height: 0.07, depth: 0.014 },
      eye,
      new BABYLON.Vector3(-0.12, 0.34, 0.318),
    );
    this._avatarRightEye = makePart(
      'player-right-eye',
      this._avatarHeadPivot,
      { width: 0.08, height: 0.07, depth: 0.014 },
      eye,
      new BABYLON.Vector3(0.12, 0.34, 0.318),
    );
    this._avatarNose = makePart(
      'player-nose',
      this._avatarHeadPivot,
      { width: 0.06, height: 0.1, depth: 0.018 },
      skinShade,
      new BABYLON.Vector3(0, 0.23, 0.322),
    );
    this._avatarMouth = makePart(
      'player-mouth',
      this._avatarHeadPivot,
      { width: 0.16, height: 0.035, depth: 0.014 },
      eye,
      new BABYLON.Vector3(0, 0.08, 0.318),
    );

    this._avatarLeftArmPivot = makePivot('player-left-arm-pivot', this._avatarRoot, new BABYLON.Vector3(-0.48, 1.46, 0));
    this._avatarRightArmPivot = makePivot('player-right-arm-pivot', this._avatarRoot, new BABYLON.Vector3(0.48, 1.46, 0));
    this._avatarLeftSleeve = makePart(
      'player-left-sleeve',
      this._avatarLeftArmPivot,
      { width: 0.24, height: 0.32, depth: 0.24 },
      shirt,
      new BABYLON.Vector3(0, -0.16, 0),
    );
    this._avatarRightSleeve = makePart(
      'player-right-sleeve',
      this._avatarRightArmPivot,
      { width: 0.24, height: 0.32, depth: 0.24 },
      shirt,
      new BABYLON.Vector3(0, -0.16, 0),
    );
    this._avatarLeftArm = makePart(
      'player-left-arm',
      this._avatarLeftArmPivot,
      { width: 0.22, height: 0.38, depth: 0.22 },
      skin,
      new BABYLON.Vector3(0, -0.51, 0),
    );
    this._avatarRightArm = makePart(
      'player-right-arm',
      this._avatarRightArmPivot,
      { width: 0.22, height: 0.38, depth: 0.22 },
      skin,
      new BABYLON.Vector3(0, -0.51, 0),
    );
    this._avatarLeftCuff = makePart(
      'player-left-cuff',
      this._avatarLeftArmPivot,
      { width: 0.24, height: 0.08, depth: 0.24 },
      jacket,
      new BABYLON.Vector3(0, -0.32, 0),
    );
    this._avatarRightCuff = makePart(
      'player-right-cuff',
      this._avatarRightArmPivot,
      { width: 0.24, height: 0.08, depth: 0.24 },
      jacket,
      new BABYLON.Vector3(0, -0.32, 0),
    );

    this._avatarLeftLegPivot = makePivot('player-left-leg-pivot', this._avatarRoot, new BABYLON.Vector3(-0.16, 0.82, 0));
    this._avatarRightLegPivot = makePivot('player-right-leg-pivot', this._avatarRoot, new BABYLON.Vector3(0.16, 0.82, 0));
    this._avatarLeftLeg = makePart(
      'player-left-leg',
      this._avatarLeftLegPivot,
      { width: 0.26, height: 0.62, depth: 0.26 },
      pants,
      new BABYLON.Vector3(0, -0.31, 0),
    );
    this._avatarRightLeg = makePart(
      'player-right-leg',
      this._avatarRightLegPivot,
      { width: 0.26, height: 0.62, depth: 0.26 },
      pants,
      new BABYLON.Vector3(0, -0.31, 0),
    );
    this._avatarLeftBoot = makePart(
      'player-left-boot',
      this._avatarLeftLegPivot,
      { width: 0.28, height: 0.22, depth: 0.32 },
      boots,
      new BABYLON.Vector3(0, -0.73, 0.02),
    );
    this._avatarRightBoot = makePart(
      'player-right-boot',
      this._avatarRightLegPivot,
      { width: 0.28, height: 0.22, depth: 0.32 },
      boots,
      new BABYLON.Vector3(0, -0.73, 0.02),
    );
  }

  _createFirstPersonHands() {
    if (!this.scene || !this.camera) return;

    const makeMaterial = (name, color) => {
      const material = new BABYLON.StandardMaterial(name, this.scene);
      material.diffuseColor = color;
      material.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
      return material;
    };

    const makePart = (name, parent, options, material, position) => {
      const mesh = BABYLON.MeshBuilder.CreateBox(name, options, this.scene);
      mesh.parent = parent;
      mesh.position.copyFrom(position);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.alwaysSelectAsActiveMesh = true;
      return mesh;
    };

    this._viewModelRoot = new BABYLON.TransformNode('player-viewmodel-root', this.scene);
    this._viewModelRoot.parent = this.camera;
    this._viewModelRoot.position.set(FIRST_PERSON_HAND_REST_X, FIRST_PERSON_HAND_REST_Y, FIRST_PERSON_HAND_REST_Z);

    const skin = makeMaterial('player-viewmodel-skin', new BABYLON.Color3(0.96, 0.82, 0.69));
    const shirt = makeMaterial('player-viewmodel-shirt', new BABYLON.Color3(0.18, 0.58, 0.82));
    const cuff = makeMaterial('player-viewmodel-cuff', new BABYLON.Color3(0.08, 0.28, 0.38));
    const armHeight = 0.58;
    const sleeveHeight = 0.28;
    const handHeight = 0.2;

    this._viewRightArmPivot = new BABYLON.TransformNode('player-view-right-arm-pivot', this.scene);
    this._viewRightArmPivot.parent = this._viewModelRoot;
    this._viewRightArmPivot.position.set(0, 0, 0);

    this._viewRightSleeve = makePart(
      'player-view-right-sleeve',
      this._viewRightArmPivot,
      { width: 0.28, height: sleeveHeight, depth: 0.28 },
      shirt,
      new BABYLON.Vector3(0, -sleeveHeight * 0.5, 0),
    );
    this._viewRightCuff = makePart(
      'player-view-right-cuff',
      this._viewRightArmPivot,
      { width: 0.29, height: 0.08, depth: 0.29 },
      cuff,
      new BABYLON.Vector3(0, -sleeveHeight - 0.04, 0),
    );
    this._viewRightArm = makePart(
      'player-view-right-arm',
      this._viewRightArmPivot,
      { width: 0.26, height: armHeight, depth: 0.26 },
      skin,
      new BABYLON.Vector3(0, -(sleeveHeight + 0.08 + armHeight * 0.5), 0),
    );
    this._viewRightHand = makePart(
      'player-view-right-hand',
      this._viewRightArmPivot,
      { width: 0.24, height: handHeight, depth: 0.24 },
      skin,
      new BABYLON.Vector3(0, -(sleeveHeight + 0.08 + armHeight + handHeight * 0.5) + 0.02, 0),
    );
  }

  _updateAvatarPose(deltaSeconds, horizontalDistance, inputState = null) {
    if (!this._avatarRoot) return;

    const moving = this._grounded && horizontalDistance > FOOTSTEP_MIN_DISTANCE;
    const sprinting = Boolean(inputState?.sprint && moving && !this._isCrouching);
    if (moving) {
      const strideSpeed = this._isCrouching ? 4.6 : sprinting ? 9.4 : 6.5;
      this._walkCycle += Math.max(0, horizontalDistance * strideSpeed);
    }

    const poseLerp = Math.min(1, Math.max(0, deltaSeconds * 12));
    this._runVisual += ((sprinting ? 1 : 0) - this._runVisual) * poseLerp;
    this._jumpVisual += ((!this._grounded ? 1 : 0) - this._jumpVisual) * poseLerp;

    const walkWave = moving ? Math.sin(this._walkCycle) : 0;
    const strideAmplitude = (0.58 + this._runVisual * 0.38) * (1 - this._crouchVisual * 0.45);
    const swingTarget = walkWave * strideAmplitude;
    this._limbSwing += (swingTarget - this._limbSwing) * poseLerp;
    const crouchTarget = this._isCrouching ? 1 : 0;
    this._crouchVisual += (crouchTarget - this._crouchVisual) * poseLerp;
    const actionCurve = this._getActionSwingCurve();
    const mineSwing = this._activeActionType === 'mine' ? actionCurve : 0;
    const placeSwing = this._activeActionType === 'place' ? actionCurve : 0;

    const crouchDrop = this._crouchVisual * 0.28;
    const crouchLean = this._crouchVisual * 0.18;
    const runLean = this._runVisual * 0.12;
    const jumpTuck = this._jumpVisual * (this._velocity.y > 0 ? 0.32 : 0.18);
    const bodyBob = moving ? Math.abs(Math.cos(this._walkCycle * 2)) * (0.018 + this._runVisual * 0.014) : 0;
    const cameraPitch = this._cameraMount?.rotation?.x ?? 0;

    this._avatarBody.position.set(0, 1.12 - crouchDrop + bodyBob, this._crouchVisual * 0.04);
    this._avatarBody.rotation.set(-(crouchLean + runLean), 0, this._runVisual * walkWave * 0.025);

    if (this._avatarHeadPivot) {
      this._avatarHeadPivot.position.set(0, 1.44 - crouchDrop * 0.92 + bodyBob, this._crouchVisual * 0.06);
      this._avatarHeadPivot.rotation.set(
        cameraPitch * 0.35 + this._crouchVisual * 0.08 - this._runVisual * 0.04,
        this._runVisual * walkWave * 0.035,
        -this._runVisual * walkWave * 0.025,
      );
    }

    if (this._avatarLeftArmPivot && this._avatarRightArmPivot) {
      this._avatarLeftArmPivot.position.set(-0.49, 1.46 - crouchDrop * 0.82 + bodyBob, this._crouchVisual * 0.04);
      this._avatarRightArmPivot.position.set(0.49, 1.46 - crouchDrop * 0.82 + bodyBob, this._crouchVisual * 0.04);

      const leftArmX = this._limbSwing * 0.95 - this._crouchVisual * 0.16 - this._jumpVisual * 0.18;
      const rightArmX = -this._limbSwing * 0.95
        - this._crouchVisual * 0.16
        - this._jumpVisual * 0.18
        - mineSwing * 1.45
        - placeSwing * 0.48;

      this._avatarLeftArmPivot.rotation.set(
        leftArmX,
        -0.04 + this._runVisual * 0.04,
        0.08 + this._crouchVisual * 0.08 + this._runVisual * 0.05,
      );
      this._avatarRightArmPivot.rotation.set(
        rightArmX,
        0.04 + mineSwing * 0.18 - placeSwing * 0.32,
        -0.08 - this._crouchVisual * 0.08 - this._runVisual * 0.05 + mineSwing * 0.2 - placeSwing * 0.12,
      );
    }

    if (this._avatarLeftLegPivot && this._avatarRightLegPivot) {
      this._avatarLeftLegPivot.position.set(-0.16, 0.82 - crouchDrop * 0.28, this._crouchVisual * 0.04);
      this._avatarRightLegPivot.position.set(0.16, 0.82 - crouchDrop * 0.28, this._crouchVisual * 0.04);
      this._avatarLeftLegPivot.rotation.set(
        -this._limbSwing * 0.95 + this._crouchVisual * 0.38 + jumpTuck,
        0,
        this._crouchVisual * 0.04,
      );
      this._avatarRightLegPivot.rotation.set(
        this._limbSwing * 0.95 + this._crouchVisual * 0.38 + jumpTuck * 0.8,
        0,
        -this._crouchVisual * 0.04,
      );
    }
  }

  _updateFirstPersonHands(deltaSeconds, horizontalDistance, inputState = null) {
    if (!this._viewModelRoot || !this._viewRightArmPivot) return;

    const moving = this._grounded && horizontalDistance > FOOTSTEP_MIN_DISTANCE;
    const sprinting = Boolean(inputState?.sprint && moving && !this._isCrouching);
    const walkWave = moving ? Math.sin(this._walkCycle) : 0;
    const bobWave = moving ? Math.cos(this._walkCycle * 2) : 0;
    const actionCurve = this._getActionSwingCurve();
    const mineSwing = this._activeActionType === 'mine' ? actionCurve : 0;
    const placeSwing = this._activeActionType === 'place' ? actionCurve : 0;
    const poseLerp = Math.min(1, Math.max(0, deltaSeconds * 12));
    const crouchOffset = this._crouchVisual * 0.08;
    const runOffset = sprinting ? 0.035 : 0;
    const actionPull = mineSwing * 0.12 + placeSwing * 0.04;
    const actionLift = mineSwing * 0.04 - placeSwing * 0.035;

    this._viewModelRoot.position.x += (((FIRST_PERSON_HAND_REST_X + walkWave * FIRST_PERSON_HAND_BOB_X - actionPull + runOffset) - this._viewModelRoot.position.x) * poseLerp);
    this._viewModelRoot.position.y += (((FIRST_PERSON_HAND_REST_Y + bobWave * FIRST_PERSON_HAND_BOB_Y - crouchOffset + actionLift) - this._viewModelRoot.position.y) * poseLerp);
    this._viewModelRoot.position.z += (((FIRST_PERSON_HAND_REST_Z + Math.abs(walkWave) * FIRST_PERSON_HAND_BOB_Z - mineSwing * 0.07 + placeSwing * 0.04) - this._viewModelRoot.position.z) * poseLerp);

    this._viewRightArmPivot.rotation.x = -1.36 + walkWave * 0.08 - mineSwing * 0.96 - placeSwing * 0.32;
    this._viewRightArmPivot.rotation.y = 0.08 - mineSwing * 0.12 - placeSwing * 0.36;
    this._viewRightArmPivot.rotation.z = -0.46 - walkWave * 0.03 - mineSwing * 0.24 + placeSwing * 0.1;
  }

  getInteractionOrigin() {
    if (!this._cameraMount) return this.mesh.position.clone();
    this._cameraMount.computeWorldMatrix(true);
    this._interactionOrigin.copyFrom(this._cameraMount.getAbsolutePosition());
    return this._interactionOrigin.clone();
  }

  getInteractionDirection() {
    if (!this._cameraMount) return new BABYLON.Vector3(0, 0, 1);
    this._cameraMount.computeWorldMatrix(true);
    BABYLON.Vector3.TransformNormalToRef(
      BABYLON.Axis.Z,
      this._cameraMount.getWorldMatrix(),
      this._interactionDirection,
    );
    this._interactionDirection.normalize();
    return this._interactionDirection.clone();
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
    this._cameraMount.position.y = eyeHeight;
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
    const cameraDiff = this._targetCameraHeight - this._cameraMount.position.y;
    const cameraApplied = Math.abs(cameraDiff) <= maxStep ? cameraDiff : Math.sign(cameraDiff) * maxStep;
    const nextCamera = this._cameraMount.position.y + cameraApplied;

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
