import * as THREE from './vendor/three.module.js';
import { PointerLockControls } from './vendor/PointerLockControls.js';
import { World, BLOCK_TYPES, CHUNK_HEIGHT, BLOCK_TYPE_LABELS } from './world.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const fpsHud = document.getElementById('hud-fps');
const loadingOverlay = document.getElementById('loading');
const loadingLabel = document.getElementById('loading-label');
const loadingBar = document.getElementById('loading-bar');
const loadingPercent = document.getElementById('loading-percent');
const crosshair = document.getElementById('crosshair');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 75, 250);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
const controls = new PointerLockControls(camera, document.body);
scene.add(controls.getObject());

const hemisphere = new THREE.HemisphereLight(0xffffff, 0x506070, 0.55);
scene.add(hemisphere);

const sun = new THREE.DirectionalLight(0xffffff, 0.85);
sun.position.set(60, 120, 40);
scene.add(sun);

const world = new World(scene);

const MAX_STEP_HEIGHT = 1.01;
const MAX_JUMP_CLEARANCE = 0.1;
const PLAYER_RADIUS = 0.35;
const FOOT_BUFFER = 0.05;
const HEAD_BUFFER = 0.1;
const KEYBOARD_LOOK_YAW_SPEED = THREE.MathUtils.degToRad(150);
const KEYBOARD_LOOK_PITCH_SPEED = THREE.MathUtils.degToRad(110);

let worldReady = false;
let loadingInProgress = false;

if (hud) hud.classList.add('hidden');
if (crosshair) crosshair.classList.add('hidden');

let spawn = new THREE.Vector3();
let currentGroundHeight = 0;
let maxClimbHeight = MAX_STEP_HEIGHT;
let wasGroundedPrevious = true;
let takeoffGroundHeight = 0;
const lastSafePosition = new THREE.Vector3();
let lastCrosshairVisible = false;

overlay.addEventListener('click', () => {
  if (loadingInProgress) return;
  if (worldReady) {
    controls.lock();
    return;
  }
  startWorldLoading();
});

controls.addEventListener('lock', () => {
  if (worldReady) {
    overlay.classList.add('hidden');
  }
  updateCrosshairVisibility();
});

controls.addEventListener('unlock', () => {
  if (loadingInProgress) return;
  overlay.classList.remove('hidden');
  updateCrosshairVisibility();
});

const keyState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
  lookUp: false,
  lookDown: false,
  lookLeft: false,
  lookRight: false,
};
let canJump = false;
const velocity = new THREE.Vector3(0, 0, 0);
const direction = new THREE.Vector3();
const playerHeight = 1.75;
const gravity = 40;
const walkAcceleration = 140;
const sprintMultiplier = 1.75;
const jumpImpulse = 15;

const SAMPLE_OFFSETS = [
  [0, 0],
  [PLAYER_RADIUS, 0],
  [-PLAYER_RADIUS, 0],
  [0, PLAYER_RADIUS],
  [0, -PLAYER_RADIUS],
  [PLAYER_RADIUS * 0.707, PLAYER_RADIUS * 0.707],
  [PLAYER_RADIUS * 0.707, -PLAYER_RADIUS * 0.707],
  [-PLAYER_RADIUS * 0.707, PLAYER_RADIUS * 0.707],
  [-PLAYER_RADIUS * 0.707, -PLAYER_RADIUS * 0.707],
];

function setMovementState(code, pressed) {
  switch (code) {
    case 'KeyW':
      keyState.forward = pressed;
      break;
    case 'KeyS':
      keyState.backward = pressed;
      break;
    case 'KeyA':
      keyState.left = pressed;
      break;
    case 'KeyD':
      keyState.right = pressed;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      keyState.sprint = pressed;
      break;
    case 'ArrowUp':
      keyState.lookUp = pressed;
      break;
    case 'ArrowDown':
      keyState.lookDown = pressed;
      break;
    case 'ArrowLeft':
      keyState.lookLeft = pressed;
      break;
    case 'ArrowRight':
      keyState.lookRight = pressed;
      break;
    case 'Space':
      if (pressed && canJump) {
        velocity.y = jumpImpulse;
        canJump = false;
      }
      break;
    default:
      break;
  }
}

const LOOK_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (LOOK_KEYS.has(event.code)) event.preventDefault();
  setMovementState(event.code, true);
});

document.addEventListener('keyup', (event) => {
  if (LOOK_KEYS.has(event.code)) event.preventDefault();
  setMovementState(event.code, false);
});

const raycaster = new THREE.Raycaster();
raycaster.far = 8;

function refreshRaycaster() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
}

document.addEventListener('mousedown', (event) => {
  if (!controls.isLocked) return;
  refreshRaycaster();

  if (event.button === 0) {
    const target = world.getRaycastTarget(raycaster, { place: false });
    if (target) {
      world.setBlock(target.x, target.y, target.z, BLOCK_TYPES.air);
    }
  } else if (event.button === 2) {
    event.preventDefault();
    const target = world.getRaycastTarget(raycaster, { place: true });
    if (target && target.y >= 0 && target.y < CHUNK_HEIGHT - 1) {
      const playerPos = controls.getObject().position;
      const distance = Math.hypot(target.x + 0.5 - playerPos.x, target.y + 0.5 - playerPos.y, target.z + 0.5 - playerPos.z);
      if (distance > 1.75) {
        world.setBlock(target.x, target.y, target.z, BLOCK_TYPES.grass);
      }
    }
  }
});

document.addEventListener('contextmenu', (event) => {
  if (controls.isLocked) event.preventDefault();
});

const clock = new THREE.Clock();
let hudAccumulator = 0;
let fpsAccumulatorTime = 0;
let fpsFrameCount = 0;
let fpsSmoothed = 0;
const FPS_UPDATE_INTERVAL = 0.25;
const FPS_SMOOTH_FACTOR = 0.7;

function highestGroundUnder(position, maxY = position.y) {
  let highest = -Infinity;
  for (const [ox, oz] of SAMPLE_OFFSETS) {
    const height = world.getSurfaceHeightAt(position.x + ox, position.z + oz, maxY);
    if (height > highest) highest = height;
  }
  return Number.isFinite(highest) ? highest : 0;
}

function collidesAt(position) {
  const minY = position.y - playerHeight + FOOT_BUFFER;
  const maxY = position.y - HEAD_BUFFER;
  const minBlockY = Math.max(0, Math.floor(minY));
  const maxBlockY = Math.min(CHUNK_HEIGHT - 1, Math.floor(maxY));

  if (maxBlockY < minBlockY) {
    return false;
  }

  for (const [ox, oz] of SAMPLE_OFFSETS) {
    const px = position.x + ox;
    const pz = position.z + oz;
    const blockX = Math.floor(px);
    const blockZ = Math.floor(pz);
    for (let by = minBlockY; by <= maxBlockY; by += 1) {
      if (world.getBlock(blockX, by, blockZ) !== BLOCK_TYPES.air) {
        return true;
      }
    }
  }
  return false;
}

function resolvePenetration(position, velocity) {
  if (!collidesAt(position)) return;

  let attempts = 0;
  while (collidesAt(position) && attempts < 12) {
    position.y += 0.05;
    if (velocity.y < 0) velocity.y = 0;
    attempts += 1;
  }

  if (collidesAt(position)) {
    for (const [ox, oz] of SAMPLE_OFFSETS) {
      position.x += ox * 0.1;
      position.z += oz * 0.1;
      if (!collidesAt(position)) {
        break;
      }
      position.x -= ox * 0.1;
      position.z -= oz * 0.1;
    }
  }

  if (collidesAt(position)) {
    const ground = highestGroundUnder(position, position.y + playerHeight);
    if (Number.isFinite(ground)) {
      position.y = ground + playerHeight + FOOT_BUFFER;
      if (velocity.y < 0) velocity.y = 0;
    }
  }

  if (collidesAt(position)) {
    position.copy(lastSafePosition);
    velocity.set(0, 0, 0);
  }
}

function updatePhysics(delta) {
  if (!worldReady || !controls.isLocked) return;

  const object = controls.getObject();
  resolvePenetration(object.position, velocity);
  const previousPosition = object.position.clone();
  const previousGround = currentGroundHeight;
  const wasGroundedPrevFrame = wasGroundedPrevious;

  velocity.x -= velocity.x * 10 * delta;
  velocity.z -= velocity.z * 10 * delta;
  velocity.y -= gravity * delta;

  direction.z = Number(keyState.forward) - Number(keyState.backward);
  direction.x = Number(keyState.right) - Number(keyState.left);
  direction.normalize();

  const accel = walkAcceleration * (keyState.sprint ? sprintMultiplier : 1);

  if (direction.z !== 0) velocity.z -= direction.z * accel * delta;
  if (direction.x !== 0) velocity.x -= direction.x * accel * delta;

  const prevX = object.position.x;
  const prevZ = object.position.z;

  controls.moveRight(-velocity.x * delta);
  controls.moveForward(-velocity.z * delta);

  const movedX = object.position.x - prevX;
  const movedZ = object.position.z - prevZ;

  object.position.x = prevX;
  object.position.z = prevZ;

  if (movedX !== 0) {
    object.position.x += movedX;
    if (collidesAt(object.position)) {
      object.position.x = prevX;
      velocity.x = 0;
    }
  }

  if (movedZ !== 0) {
    object.position.z += movedZ;
    if (collidesAt(object.position)) {
      object.position.z = prevZ;
      velocity.z = 0;
    }
  }

  const feetBefore = object.position.y - playerHeight;
  const groundedBefore = Math.abs(feetBefore - currentGroundHeight) <= 0.1;
  const surfaceAhead = world.getSurfaceHeightAt(
    object.position.x,
    object.position.z,
    currentGroundHeight + MAX_STEP_HEIGHT + 0.1
  );
  if (groundedBefore && surfaceAhead > currentGroundHeight + MAX_STEP_HEIGHT) {
    object.position.x = prevX;
    object.position.z = prevZ;
    velocity.x = 0;
    velocity.z = 0;
  }

  object.position.y += velocity.y * delta;

  const maxAllowedFoot = takeoffGroundHeight + MAX_STEP_HEIGHT + MAX_JUMP_CLEARANCE;
  const currentFoot = object.position.y - playerHeight;
  if (currentFoot > maxAllowedFoot) {
    object.position.y = maxAllowedFoot + playerHeight;
    if (velocity.y > 0) velocity.y = 0;
  }

  const footY = object.position.y - playerHeight;
  let surface = highestGroundUnder(object.position, footY + 0.1);
  if (!Number.isFinite(surface)) surface = -Infinity;
  const distanceToGround = footY - surface;
  const grounded = distanceToGround <= 0.1;

  if (wasGroundedPrevFrame && !grounded) {
    takeoffGroundHeight = currentGroundHeight;
    maxClimbHeight = takeoffGroundHeight + MAX_STEP_HEIGHT;
  }

  if (grounded && surface > maxClimbHeight) {
    object.position.copy(previousPosition);
    velocity.x = 0;
    velocity.z = 0;
    if (velocity.y > 0) velocity.y = 0;
    currentGroundHeight = previousGround;
    takeoffGroundHeight = previousGround;
    maxClimbHeight = takeoffGroundHeight + MAX_STEP_HEIGHT;
    wasGroundedPrevious = wasGroundedPrevFrame;
    canJump = wasGroundedPrevFrame;
    return;
  }

  if (collidesAt(object.position)) {
    object.position.x = previousPosition.x;
    object.position.z = previousPosition.z;
    velocity.x = 0;
    velocity.z = 0;
    resolvePenetration(object.position, velocity);
    if (collidesAt(object.position)) {
      object.position.copy(lastSafePosition);
      velocity.set(0, Math.min(velocity.y, 0), 0);
      currentGroundHeight = highestGroundUnder(object.position, object.position.y);
      takeoffGroundHeight = currentGroundHeight;
      maxClimbHeight = currentGroundHeight + MAX_STEP_HEIGHT;
      wasGroundedPrevious = true;
      canJump = true;
    }
    return;
  }

  if (grounded) {
    if (distanceToGround < 0) {
      object.position.y = surface + playerHeight;
    }
    if (velocity.y < 0) velocity.y = 0;
    canJump = true;
    currentGroundHeight = surface;
    takeoffGroundHeight = surface;
    maxClimbHeight = takeoffGroundHeight + MAX_STEP_HEIGHT;
  } else {
    canJump = false;
  }

  wasGroundedPrevious = grounded;
  resolvePenetration(object.position, velocity);

  if (!collidesAt(object.position)) {
    lastSafePosition.copy(object.position);
  }
}

function animate() {
  const frameDelta = clock.getDelta();
  const delta = Math.min(0.05, frameDelta);
  applyKeyboardLook(frameDelta);
  updatePhysics(delta);
  hudAccumulator += delta;
  if (hudAccumulator >= 0.2) {
    updateHUD();
    hudAccumulator = 0;
  }
  fpsAccumulatorTime += frameDelta;
  fpsFrameCount += 1;
  if (fpsAccumulatorTime >= FPS_UPDATE_INTERVAL) {
    const instantaneous = fpsFrameCount / fpsAccumulatorTime;
    updateFPSHud(instantaneous);
    fpsAccumulatorTime = 0;
    fpsFrameCount = 0;
  }
  updateCrosshairVisibility();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
updateHUD();
updateFPSHud(0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

async function startWorldLoading() {
  if (loadingInProgress) return;
  loadingInProgress = true;
  overlay.classList.add('hidden');
  setLoadingProgress(0);
  showLoadingOverlay();
  if (loadingLabel) loadingLabel.textContent = 'Loading world…';
  controls.lock();
  try {
    await world.generateAsync(1, (progress) => setLoadingProgress(progress * 0.75));
    finalizeWorldLoad();
    setLoadingProgress(0.85);
    void world.generateAsync(2, (progress) => {
      // scale progress to remaining 15%
      const blended = 0.85 + progress * 0.15;
      setLoadingProgress(blended);
    });
    setLoadingProgress(1);
    hideLoadingOverlay();
    if (controls.isLocked) {
      overlay.classList.add('hidden');
    } else {
      overlay.classList.remove('hidden');
    }
  } catch (error) {
    console.error('Failed to generate world', error);
    handleWorldLoadError();
  } finally {
    loadingInProgress = false;
    if (loadingOverlay) {
      const visible = loadingOverlay.classList.contains('visible');
      loadingOverlay.setAttribute('aria-hidden', String(!visible));
    }
  }
}

function handleWorldLoadError() {
  hideLoadingOverlay();
  overlay.classList.remove('hidden');
  worldReady = false;
  if (loadingLabel) loadingLabel.textContent = 'Failed to load world. Click to retry.';
  updateCrosshairVisibility();
}

function finalizeWorldLoad() {
  spawn = world.getSpawnPoint();
  controls.getObject().position.copy(spawn);
  controls.getObject().position.y = Math.min(spawn.y, CHUNK_HEIGHT - 1);
  lastSafePosition.copy(controls.getObject().position);
  currentGroundHeight = world.getSurfaceHeightAt(spawn.x, spawn.z, spawn.y);
  takeoffGroundHeight = currentGroundHeight;
  maxClimbHeight = currentGroundHeight + MAX_STEP_HEIGHT;
  wasGroundedPrevious = true;
  worldReady = true;
  if (hud) hud.classList.remove('hidden');
  hudAccumulator = 0;
  updateHUD();
  updateFPSHud(0);
  updateCrosshairVisibility();
}

function showLoadingOverlay() {
  if (!loadingOverlay) return;
  loadingOverlay.classList.add('visible');
  loadingOverlay.setAttribute('aria-hidden', 'false');
}

function hideLoadingOverlay() {
  if (!loadingOverlay) return;
  loadingOverlay.classList.remove('visible');
  loadingOverlay.setAttribute('aria-hidden', 'true');
}

function setLoadingProgress(progress) {
  if (!loadingBar || !loadingPercent) return;
  const clamped = Math.max(0, Math.min(1, progress));
  loadingBar.style.width = `${(clamped * 100).toFixed(1)}%`;
  loadingPercent.textContent = `${Math.round(clamped * 100)}%`;
}

function updateCrosshairVisibility() {
  if (!crosshair) return;
  const shouldShow = worldReady && controls.isLocked;
  if (shouldShow !== lastCrosshairVisible) {
    crosshair.classList.toggle('hidden', !shouldShow);
    lastCrosshairVisible = shouldShow;
  }
}

function applyKeyboardLook(delta) {
  if (!worldReady) return;

  let yaw = 0;
  if (keyState.lookLeft) yaw += KEYBOARD_LOOK_YAW_SPEED * delta;
  if (keyState.lookRight) yaw -= KEYBOARD_LOOK_YAW_SPEED * delta;

  let pitch = 0;
  if (keyState.lookUp) pitch += KEYBOARD_LOOK_PITCH_SPEED * delta;
  if (keyState.lookDown) pitch -= KEYBOARD_LOOK_PITCH_SPEED * delta;

  if (yaw === 0 && pitch === 0) return;

  const camera = controls.getObject();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  euler.setFromQuaternion(camera.quaternion);

  euler.y += yaw;
  euler.x = clampPitch(euler.x + pitch);

  camera.quaternion.setFromEuler(euler);
}

function clampPitch(nextPitch) {
  const halfPi = Math.PI / 2;
  const minPolar = controls.minPolarAngle ?? 0;
  const maxPolar = controls.maxPolarAngle ?? Math.PI;
  return Math.max(halfPi - maxPolar, Math.min(halfPi - minPolar, nextPitch));
}

function updateHUD() {
  if (!hud) return;
  if (!worldReady) {
    hud.innerHTML = '';
    return;
  }
  const pos = controls.getObject().position;
  const lines = [`XYZ: ${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}`];
  const totals = world.getBlockTotals();
  let typeCount = 0;
  const blockLines = [];
  for (const [typeKey, label] of Object.entries(BLOCK_TYPE_LABELS)) {
    const typeIndex = Number(typeKey);
    const amount = totals[typeIndex] ?? 0;
    if (amount > 0) {
      typeCount += 1;
      blockLines.push(`${label}: ${amount}`);
    }
  }
  lines.push(`Types: ${typeCount}`);
  lines.push(...blockLines);
  hud.innerHTML = lines.map((text) => `<div>${text}</div>`).join('');
}

function updateFPSHud(fps) {
  if (!fpsHud) return;
  const clamped = Number.isFinite(fps) ? fps : 0;
  fpsSmoothed = fpsSmoothed === 0 ? clamped : fpsSmoothed * FPS_SMOOTH_FACTOR + clamped * (1 - FPS_SMOOTH_FACTOR);
  const display = fpsSmoothed < 0 ? 0 : fpsSmoothed;
  fpsHud.textContent = `FPS: ${display.toFixed(1)}`;
}
