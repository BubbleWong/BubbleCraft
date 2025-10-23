import { BabylonVoxelWorld } from './world/babylonWorld.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const crosshair = document.getElementById('crosshair');
const hud = document.getElementById('hud');
const fpsHud = document.getElementById('hud-fps');
const loadingOverlay = document.getElementById('loading');
const loadingLabel = document.getElementById('loading-label');
const loadingBar = document.getElementById('loading-bar');
const loadingPercent = document.getElementById('loading-percent');

const PHYSICS_PLUGIN_VERSION_V2 = BABYLON.PhysicsPluginVersion?.V2 ?? (BABYLON.PhysicsPluginVersion_V2 ?? 2);

if (!canvas) {
  throw new Error('Unable to locate required canvas element with id="game"');
}

const engine = new BABYLON.Engine(canvas, true, { adaptToDeviceRatio: true });
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.62, 0.78, 1.0, 1.0);

const camera = new BABYLON.UniversalCamera('player-camera', new BABYLON.Vector3(0, 32, -48), scene);
camera.minZ = 0.05;
camera.maxZ = 4000;
camera.inertia = 0.65;
camera.angularSensibility = 4000;
camera.speed = 0;
camera.attachControl(canvas, true);

const ambient = new BABYLON.HemisphericLight('ambient', new BABYLON.Vector3(0.2, 1, 0.3), scene);
ambient.intensity = 0.55;

const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.36, -0.92, 0.28), scene);
sun.position = new BABYLON.Vector3(120, 180, -140);
sun.intensity = 1.05;

let world = null;
let player = null;
let physicsPlugin = null;

class PlayerController {
  constructor(sceneRef, cameraRef, spawnPoint) {
    this.scene = sceneRef;
    this.camera = cameraRef;
    this.spawnPoint = spawnPoint.clone();

    this.walkSpeed = 7.2;
    this.sprintMultiplier = 1.6;
    this.jumpImpulse = 4.8;
    this._linearVelocity = new BABYLON.Vector3();
    this._groundRay = new BABYLON.Ray(new BABYLON.Vector3(), new BABYLON.Vector3(0, -1, 0), 1.05);
    this._jumpCooldown = 0;
    this._movement = new BABYLON.Vector3();

    this.mesh = BABYLON.MeshBuilder.CreateCapsule('player-collider', {
      height: 1.8,
      radius: 0.45,
      tessellation: 12,
    }, this.scene);
    this.mesh.isVisible = false;
    this.mesh.isPickable = false;
    this.mesh.position.copyFrom(this.spawnPoint);

    this._input = {
      forward: 0,
      right: 0,
      sprint: false,
      jump: false,
    };

    this._createPhysicsAggregate();

    this.camera.parent = this.mesh;
    this.camera.position.set(0, 0.72, 0);
  }

  _createPhysicsAggregate() {
    const physicsEnabled = typeof this.scene.isPhysicsEnabled === 'function'
      ? this.scene.isPhysicsEnabled()
      : Boolean(this.scene.getPhysicsEngine?.());
    const pluginVersion = this.scene.getPhysicsEngine?.()?.getPhysicsPluginVersion?.();
    if (!BABYLON.PhysicsAggregate || !physicsEnabled || pluginVersion !== PHYSICS_PLUGIN_VERSION_V2) {
      this.aggregate = null;
      this.body = null;
      return;
    }
    if (this.aggregate) {
      this.aggregate.dispose();
    }
    this.aggregate = new BABYLON.PhysicsAggregate(
      this.mesh,
      BABYLON.PhysicsShapeType.CAPSULE,
      { mass: 82, restitution: 0.0, friction: 0.92 },
      this.scene,
    );
    this.body = this.aggregate.body;
    this.body.setMotionType(BABYLON.PhysicsMotionType.DYNAMIC);
    this.body.setAngularFactor(BABYLON.Vector3.Zero());
    this.body.setLinearDamping(0.32);
    this.body.setAngularDamping(0.95);
  }

  setInputState(inputState) {
    this._input.forward = inputState.forward;
    this._input.right = inputState.right;
    this._input.sprint = inputState.sprint;
    this._input.jump ||= inputState.jumpRequested;
  }

  update(deltaSeconds) {
    if (!this.body) {
      if (this.mesh.position.y < -32) {
        this.respawn(this.spawnPoint);
      }
      return;
    }

    this._jumpCooldown = Math.max(0, this._jumpCooldown - deltaSeconds);

    const forwardDir = this.camera.getDirection(BABYLON.Axis.Z);
    forwardDir.y = 0;
    if (forwardDir.lengthSquared() > 1e-4) {
      forwardDir.normalize();
    } else {
      forwardDir.copyFrom(BABYLON.Axis.Z);
    }

    const rightDir = BABYLON.Vector3.Cross(forwardDir, BABYLON.Axis.Y);
    if (rightDir.lengthSquared() > 1e-4) {
      rightDir.normalize();
    }

    const movement = this._movement;
    movement.copyFromFloats(0, 0, 0);
    movement.x += forwardDir.x * this._input.forward;
    movement.z += forwardDir.z * this._input.forward;
    movement.x += rightDir.x * this._input.right;
    movement.z += rightDir.z * this._input.right;

    if (movement.lengthSquared() > 1e-4) {
      movement.normalize();
      const speed = this.walkSpeed * (this._input.sprint ? this.sprintMultiplier : 1);
      movement.scaleInPlace(speed);
    }

    this.body.getLinearVelocityToRef(this._linearVelocity);
    const desiredVelocity = new BABYLON.Vector3(
      movement.x,
      this._linearVelocity.y,
      movement.z,
    );

    this.body.setLinearVelocity(desiredVelocity);

    if (this._input.jump && this._jumpCooldown <= 0 && this._isGrounded()) {
      this.body.applyImpulse(new BABYLON.Vector3(0, this.jumpImpulse, 0), this.mesh.getAbsolutePosition());
      this._jumpCooldown = 0.25;
    }

    this._input.jump = false;

    if (this.mesh.position.y < -48) {
      this.respawn(this.spawnPoint);
    }
  }

  _isGrounded() {
    this._groundRay.origin.copyFrom(this.mesh.position);
    this._groundRay.origin.y -= 0.95;
    const pick = this.scene.pickWithRay(this._groundRay, (mesh) => mesh !== this.mesh && mesh.isPickable);
    return Boolean(pick?.hit && pick.distance <= 0.2);
  }

  respawn(position) {
    this.mesh.position.copyFrom(position);
    if (this.aggregate) {
      this.aggregate.dispose();
    }
    this._createPhysicsAggregate();
  }
}

async function enablePhysics() {
  if (typeof Ammo !== 'function') {
    console.warn('Ammo.js failed to load – physics V2 disabled');
    return null;
  }
  const ammoModule = await Ammo();
  const plugin = new BABYLON.AmmoJSPlugin(true, ammoModule, undefined, PHYSICS_PLUGIN_VERSION_V2);
  scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), plugin, BABYLON.PhysicsEngineV2);
  return plugin;
}

const pressedKeys = new Set();
const inputState = {
  forward: 0,
  right: 0,
  sprint: false,
  jumpRequested: false,
};

function updateDirectionalAxes() {
  const forward = (pressedKeys.has('KeyW') ? 1 : 0) - (pressedKeys.has('KeyS') ? 1 : 0);
  const right = (pressedKeys.has('KeyD') ? 1 : 0) - (pressedKeys.has('KeyA') ? 1 : 0);
  inputState.forward = clampAxis(forward);
  inputState.right = clampAxis(right);
}

function clampAxis(value) {
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

function handleKeyDown(event) {
  if (document.pointerLockElement !== canvas) return;
  if (event.repeat) return;

  switch (event.code) {
    case 'Space':
    case 'KeyW':
    case 'KeyA':
    case 'KeyS':
    case 'KeyD':
    case 'ShiftLeft':
    case 'ShiftRight':
      event.preventDefault();
      break;
    default:
      break;
  }

  pressedKeys.add(event.code);

  switch (event.code) {
    case 'Space':
      inputState.jumpRequested = true;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      inputState.sprint = true;
      break;
    default:
      break;
  }

  updateDirectionalAxes();
}

function handleKeyUp(event) {
  pressedKeys.delete(event.code);

  switch (event.code) {
    case 'ShiftLeft':
    case 'ShiftRight':
      inputState.sprint = false;
      break;
    default:
      break;
  }

  updateDirectionalAxes();
}

function setLoading(status, percent = null) {
  if (!loadingOverlay) return;
  if (status) {
    loadingOverlay.classList.remove('hidden');
  } else {
    loadingOverlay.classList.add('hidden');
  }
  if (typeof status === 'string' && loadingLabel) {
    loadingLabel.textContent = status;
  }
  if (loadingPercent && loadingBar && percent !== null) {
    const clamped = Math.min(100, Math.max(0, percent));
    loadingPercent.textContent = `${clamped.toFixed(0)}%`;
    loadingBar.style.width = `${clamped}%`;
  }
}

function requestPointerLock() {
  if (!canvas.requestPointerLock) return;
  canvas.requestPointerLock();
}

function releasePointerLock() {
  if (document.pointerLockElement === canvas && document.exitPointerLock) {
    document.exitPointerLock();
  }
}

function updatePointerLockUi() {
  const locked = document.pointerLockElement === canvas;
  if (overlay) {
    overlay.classList.toggle('hidden', locked);
  }
  if (crosshair) {
    crosshair.classList.toggle('hidden', !locked);
  }
  if (!locked) {
    pressedKeys.clear();
    updateDirectionalAxes();
    inputState.sprint = false;
    inputState.jumpRequested = false;
  }
}

canvas.addEventListener('click', () => {
  if (document.pointerLockElement !== canvas) {
    requestPointerLock();
  }
});

if (overlay) {
  overlay.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) {
      requestPointerLock();
    }
  });
}

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

document.addEventListener('pointerlockchange', updatePointerLockUi);

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && document.pointerLockElement === canvas) {
    releasePointerLock();
    return;
  }
  handleKeyDown(event);
});

window.addEventListener('keyup', handleKeyUp);

window.addEventListener('resize', () => engine.resize());

let fpsAccumulator = 0;

async function bootstrap() {
  setLoading('Preparing Babylon.js world…', 10);
  physicsPlugin = await enablePhysics();

  setLoading('Generating terrain…', 35);
  world = new BabylonVoxelWorld(scene, { physics: physicsPlugin, chunkRadius: 5 });
  const { spawnPoint } = await world.initialize();

  setLoading('Spawning player…', 70);
  player = new PlayerController(scene, camera, spawnPoint);

  setLoading(false);
  updatePointerLockUi();

  engine.runRenderLoop(() => {
    const delta = engine.getDeltaTime() * 0.001;
    if (player) {
      player.setInputState(inputState);
      player.update(delta);
      inputState.jumpRequested = false;
    }
    scene.render();

    if (fpsHud) {
      fpsAccumulator += delta;
      if (fpsAccumulator >= 0.25) {
        fpsHud.textContent = `${engine.getFps().toFixed(0)} fps`;
        fpsAccumulator = 0;
      }
    }
  });
}

bootstrap().catch((error) => {
  console.error('Failed to initialise Babylon.js game loop', error);
  setLoading('Failed to load world', 100);
});
