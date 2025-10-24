const DEFAULT_WALK_SPEED = 5.5;
const DEFAULT_SPRINT_MULTIPLIER = 1.65;
const DEFAULT_JUMP_IMPULSE = 6.0;
const GRAVITY = -22;
const TERMINAL_VELOCITY = -48;
const CAPSULE_HEIGHT = 1.78;
const CAPSULE_RADIUS = 0.42;

export class PlayerController {
  constructor({ scene, world, camera, input, context = null }) {
    this.scene = scene;
    this.world = world;
    this.camera = camera;
    this.input = input;
    this.context = context;
    this.eventBus = context?.eventBus ?? null;

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

    this.camera.parent = this.mesh;
    this.camera.position.set(0, CAPSULE_HEIGHT * 0.32, 0);
    this.camera.rotationQuaternion = null;

    this._velocity = new BABYLON.Vector3();
    this._spawnPoint = new BABYLON.Vector3(0, CAPSULE_HEIGHT, 0);
  }

  setSpawnPoint(position) {
    this._spawnPoint.copyFrom(position);
    this.mesh.position.copyFrom(position);
    this._velocity.setAll(0);
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
    const forward = new BABYLON.Vector3(Math.sin(this.mesh.rotation.y), 0, Math.cos(this.mesh.rotation.y));
    const right = new BABYLON.Vector3(forward.z, 0, -forward.x);

    const desired = new BABYLON.Vector3();
    desired.addInPlace(forward.scale(move.y));
    desired.addInPlace(right.scale(move.x));

    if (desired.lengthSquared() > 1e-4) {
      desired.normalize();
      desired.scaleInPlace(this.walkSpeed * (sprint ? this.sprintMultiplier : 1));
    } else {
      desired.setAll(0);
    }

    this._velocity.x = desired.x;
    this._velocity.z = desired.z;

    if (jump && this._isGrounded()) {
      this._velocity.y = this.jumpImpulse;
    } else {
      this._velocity.y += GRAVITY * deltaSeconds;
      if (this._velocity.y < TERMINAL_VELOCITY) {
        this._velocity.y = TERMINAL_VELOCITY;
      }
    }

    const delta = this._velocity.scale(deltaSeconds);
    this.mesh.position.addInPlace(delta);
    this._resolveGroundPenetration();
  }

  _isGrounded() {
    const surfaceY = this.world.getSurfaceHeight(this.mesh.position.x, this.mesh.position.z);
    const minY = surfaceY + CAPSULE_HEIGHT * 0.5 + 0.01;
    return this.mesh.position.y <= minY + 1e-3;
  }

  _resolveGroundPenetration() {
    const surfaceY = this.world.getSurfaceHeight(this.mesh.position.x, this.mesh.position.z);
    const minY = surfaceY + CAPSULE_HEIGHT * 0.5;
    if (this.mesh.position.y < minY) {
      this.mesh.position.y = minY;
      if (this._velocity.y < 0) {
        this._velocity.y = 0;
      }
    }
  }
}
