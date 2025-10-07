import * as THREE from './vendor/three.module.js';
import { PointerLockControls } from './vendor/PointerLockControls.js';
import { World, BLOCK_TYPES, CHUNK_HEIGHT, BLOCK_TYPE_LABELS } from './world.js';
import { BLOCK_COLORS, FLOWER_PETAL_COLORS } from './constants.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const fpsHud = document.getElementById('hud-fps');
const loadingOverlay = document.getElementById('loading');
const loadingLabel = document.getElementById('loading-label');
const loadingBar = document.getElementById('loading-bar');
const loadingPercent = document.getElementById('loading-percent');
const crosshair = document.getElementById('crosshair');
const inventoryBar = document.getElementById('inventory');

const HOTBAR_SLOT_COUNT = 9;
const MAX_STACK_SIZE = 64;
const FOOTSTEP_DISTANCE_INTERVAL = 2.2;

const MATERIAL_SOUND_PROFILE = {
  [BLOCK_TYPES.grass]: { stepCutoff: 1200, breakCutoff: 1500, breakQ: 1.2, placeFreq: 440 },
  [BLOCK_TYPES.dirt]: { stepCutoff: 900, breakCutoff: 900, breakQ: 1.4, placeFreq: 410 },
  [BLOCK_TYPES.stone]: { stepCutoff: 650, breakCutoff: 700, breakQ: 1.8, placeFreq: 330 },
  [BLOCK_TYPES.sand]: { stepCutoff: 1400, breakCutoff: 1800, breakQ: 0.8, placeFreq: 520 },
  [BLOCK_TYPES.wood]: { stepCutoff: 1000, breakCutoff: 1200, breakQ: 1.5, placeFreq: 360 },
  [BLOCK_TYPES.leaves]: { stepCutoff: 1600, breakCutoff: 1900, breakQ: 0.7, placeFreq: 560 },
  [BLOCK_TYPES.gold]: { stepCutoff: 800, breakCutoff: 950, breakQ: 1.6, placeFreq: 300 },
  [BLOCK_TYPES.diamond]: { stepCutoff: 1100, breakCutoff: 1300, breakQ: 1.9, placeFreq: 620 },
  [BLOCK_TYPES.flowerRed]: { stepCutoff: 1700, breakCutoff: 2000, breakQ: 0.6, placeFreq: 640 },
  [BLOCK_TYPES.flowerYellow]: { stepCutoff: 1700, breakCutoff: 2000, breakQ: 0.6, placeFreq: 660 },
  default: { stepCutoff: 1100, breakCutoff: 1400, breakQ: 1.1, placeFreq: 420 },
};

class SoundManager {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.fxGain = null;
    this.musicGain = null;
    this.bgmStarted = false;
    this.bgmNodes = [];
  }

  ensureContext() {
    if (this.context) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.context = new AudioCtx();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 0.6;
    this.masterGain.connect(this.context.destination);

    this.fxGain = this.context.createGain();
    this.fxGain.gain.value = 0.8;
    this.fxGain.connect(this.masterGain);

    this.musicGain = this.context.createGain();
    this.musicGain.gain.value = 0.22;
    this.musicGain.connect(this.masterGain);
  }

  resume() {
    this.ensureContext();
    if (!this.context) return;
    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
  }

  playFootstep(blockType) {
    this.ensureContext();
    if (!this.context) return;
    const profile = MATERIAL_SOUND_PROFILE[blockType] ?? MATERIAL_SOUND_PROFILE.default;
    const buffer = this.makeNoiseBuffer(0.25);
    const now = this.context.currentTime;
    const src = this.context.createBufferSource();
    src.buffer = buffer;
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = profile.stepCutoff + Math.random() * 200 - 100;
    filter.Q.value = 1.2;
    const gain = this.context.createGain();
    gain.gain.value = 0.0;
    src.connect(filter).connect(gain).connect(this.fxGain);
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    src.start(now);
    src.stop(now + 0.25);
  }

  playJump() {
    this.ensureContext();
    if (!this.context) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = 'triangle';
    const gain = this.context.createGain();
    gain.gain.value = 0.0;
    osc.frequency.value = 420;
    osc.connect(gain).connect(this.fxGain);
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.002, now + 0.32);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  playBlockBreak(blockType) {
    this.ensureContext();
    if (!this.context) return;
    const profile = MATERIAL_SOUND_PROFILE[blockType] ?? MATERIAL_SOUND_PROFILE.default;
    const now = this.context.currentTime;
    const noise = this.context.createBufferSource();
    noise.buffer = this.makeNoiseBuffer(0.35);
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = profile.breakCutoff + Math.random() * 250 - 120;
    filter.Q.value = profile.breakQ ?? 1;
    const gain = this.context.createGain();
    gain.gain.value = 0;
    noise.connect(filter).connect(gain).connect(this.fxGain);
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.45, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    noise.start(now);
    noise.stop(now + 0.35);
  }

  playBlockPlace(blockType) {
    this.ensureContext();
    if (!this.context) return;
    const profile = MATERIAL_SOUND_PROFILE[blockType] ?? MATERIAL_SOUND_PROFILE.default;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = 'sine';
    const gain = this.context.createGain();
    gain.gain.value = 0.0;
    const baseFreq = profile.placeFreq ?? 420;
    osc.frequency.value = baseFreq;
    osc.connect(gain).connect(this.fxGain);
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.28, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.002, now + 0.22);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.9, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  startBgm() {
    this.ensureContext();
    if (!this.context || this.bgmStarted) return;
    this.bgmStarted = true;
    const now = this.context.currentTime;
    const voices = [
      { freq: 196, type: 'sine', gain: 0.18, lfoFreq: 0.05 },
      { freq: 246.94, type: 'triangle', gain: 0.14, lfoFreq: 0.07 },
      { freq: 329.63, type: 'sawtooth', gain: 0.12, lfoFreq: 0.09 },
    ];
    for (const voice of voices) {
      const osc = this.context.createOscillator();
      osc.type = voice.type;
      const gain = this.context.createGain();
      gain.gain.value = 0;
      osc.frequency.value = voice.freq;
      osc.connect(gain).connect(this.musicGain);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(voice.gain, now + 3.5);
      gain.gain.linearRampToValueAtTime(voice.gain * 0.92, now + 16 + Math.random() * 4);

      const lfo = this.context.createOscillator();
      const lfoGain = this.context.createGain();
      lfo.frequency.value = voice.lfoFreq;
      lfoGain.gain.value = voice.freq * 0.015;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start(now);

      osc.start(now);
      this.bgmNodes.push({ osc, gain, lfo, lfoGain });
    }
  }

  makeNoiseBuffer(durationSeconds) {
    if (!this.context) return null;
    const length = Math.max(1, Math.floor(this.context.sampleRate * durationSeconds));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    return buffer;
  }
}

class Inventory {
  constructor(slotCount = HOTBAR_SLOT_COUNT) {
    this.slotCount = slotCount;
    this.slots = Array.from({ length: slotCount }, () => null);
  }

  getSlot(index) {
    if (index < 0 || index >= this.slotCount) return null;
    return this.slots[index];
  }

  add(type, amount = 1) {
    if (type === BLOCK_TYPES.air || amount <= 0) return amount;
    let remaining = amount;
    for (let i = 0; i < this.slotCount && remaining > 0; i += 1) {
      const slot = this.slots[i];
      if (slot && slot.type === type && slot.count < MAX_STACK_SIZE) {
        const space = MAX_STACK_SIZE - slot.count;
        const toTransfer = Math.min(space, remaining);
        slot.count += toTransfer;
        remaining -= toTransfer;
      }
    }
    for (let i = 0; i < this.slotCount && remaining > 0; i += 1) {
      if (!this.slots[i]) {
        const toTransfer = Math.min(MAX_STACK_SIZE, remaining);
        this.slots[i] = { type, count: toTransfer };
        remaining -= toTransfer;
      }
    }
    return remaining;
  }

  removeFromSlot(index, amount = 1) {
    if (index < 0 || index >= this.slotCount || amount <= 0) return 0;
    const slot = this.slots[index];
    if (!slot) return 0;
    const removed = Math.min(slot.count, amount);
    slot.count -= removed;
    if (slot.count === 0) this.slots[index] = null;
    return removed;
  }

  findNextFilledSlot(startIndex, direction) {
    if (this.slotCount === 0) return -1;
    let index = startIndex;
    for (let i = 0; i < this.slotCount; i += 1) {
      index = (index + direction + this.slotCount) % this.slotCount;
      if (this.slots[index]) return index;
    }
    return -1;
  }
}

const inventory = new Inventory();
let activeHotbarIndex = 0;
const sound = new SoundManager();

function blockColorToCss(type) {
  const base = BLOCK_COLORS[type] ?? FLOWER_PETAL_COLORS[type];
  if (!base) return 'rgba(255, 255, 255, 0.2)';
  const [r, g, b] = base.map((channel) => Math.round(channel * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

updateInventoryUI();

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
if (inventoryBar) inventoryBar.classList.add('hidden');

let spawn = new THREE.Vector3();
let currentGroundHeight = 0;
let maxClimbHeight = MAX_STEP_HEIGHT;
let wasGroundedPrevious = true;
let takeoffGroundHeight = 0;
const lastSafePosition = new THREE.Vector3();
let lastCrosshairVisible = false;
let footstepDistanceAccumulator = 0;

overlay.addEventListener('click', () => {
  if (loadingInProgress) return;
  sound.resume();
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
  sound.resume();
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
        sound.playJump();
      }
      break;
    default:
      break;
  }
}

const LOOK_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  const handledInventory = handleInventoryKeyDown(event);
  if (LOOK_KEYS.has(event.code)) event.preventDefault();
  if (handledInventory) event.preventDefault();
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

document.addEventListener('wheel', (event) => {
  if (!controls.isLocked) return;
  if (handleInventoryWheel(event.deltaY)) event.preventDefault();
}, { passive: false });

document.addEventListener('mousedown', (event) => {
  if (!controls.isLocked) return;
  refreshRaycaster();

  if (event.button === 0) {
    const target = world.getRaycastTarget(raycaster, { place: false });
    if (target) {
      const blockType = world.getBlock(target.x, target.y, target.z);
      if (blockType !== BLOCK_TYPES.air) {
        const removed = world.setBlock(target.x, target.y, target.z, BLOCK_TYPES.air);
        if (removed) {
          sound.playBlockBreak(blockType);
          inventory.add(blockType, 1);
          updateInventoryUI();
        }
      }
    }
  } else if (event.button === 2) {
    event.preventDefault();
    const activeSlot = inventory.getSlot(activeHotbarIndex);
    if (!activeSlot) return;
    const target = world.getRaycastTarget(raycaster, { place: true });
    if (target && target.y >= 0 && target.y < CHUNK_HEIGHT - 1) {
      const playerPos = controls.getObject().position;
      const distance = Math.hypot(target.x + 0.5 - playerPos.x, target.y + 0.5 - playerPos.y, target.z + 0.5 - playerPos.z);
      if (distance > 1.75) {
        const existing = world.getBlock(target.x, target.y, target.z);
        if (existing !== BLOCK_TYPES.air) return;
        const placeType = activeSlot.type;
        const placed = world.setBlock(target.x, target.y, target.z, placeType);
        if (placed) {
          inventory.removeFromSlot(activeHotbarIndex, 1);
          updateInventoryUI();
          sound.playBlockPlace(placeType);
        }
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

  const horizontalDistance = Math.hypot(object.position.x - previousPosition.x, object.position.z - previousPosition.z);
  if (grounded && horizontalDistance > 0.01) {
    footstepDistanceAccumulator += horizontalDistance;
    if (footstepDistanceAccumulator >= FOOTSTEP_DISTANCE_INTERVAL) {
      footstepDistanceAccumulator = 0;
      const underX = Math.floor(object.position.x);
      const underY = Math.floor(object.position.y - playerHeight - 0.1);
      const underZ = Math.floor(object.position.z);
      let blockType = world.getBlock(underX, underY, underZ);
      if (blockType === BLOCK_TYPES.air) {
        blockType = world.getBlock(underX, underY - 1, underZ);
      }
      sound.playFootstep(blockType);
    }
  } else if (!grounded || horizontalDistance <= 0.01) {
    footstepDistanceAccumulator = 0;
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
  if (inventoryBar) inventoryBar.classList.add('hidden');
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
  if (inventoryBar) inventoryBar.classList.remove('hidden');
  hudAccumulator = 0;
  updateHUD();
  updateFPSHud(0);
  updateInventoryUI();
  sound.resume();
  sound.startBgm();
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

function ensureActiveSlot() {
  if (inventory.getSlot(activeHotbarIndex)) return;
  const fallback = inventory.findNextFilledSlot(activeHotbarIndex, 1);
  activeHotbarIndex = fallback === -1 ? 0 : fallback;
}

function updateInventoryUI() {
  if (!inventoryBar) return;
  ensureActiveSlot();
  inventoryBar.innerHTML = '';
  for (let i = 0; i < inventory.slotCount; i += 1) {
    const slot = inventory.getSlot(i);
    const slotEl = document.createElement('div');
    slotEl.className = 'inventory__slot';
    if (i === activeHotbarIndex) slotEl.classList.add('inventory__slot--active');
    if (slot) {
      const itemEl = document.createElement('div');
      itemEl.className = 'inventory__item';
      itemEl.style.backgroundColor = blockColorToCss(slot.type);
      itemEl.textContent = BLOCK_TYPE_LABELS[slot.type] ?? `#${slot.type}`;
      const countEl = document.createElement('span');
      countEl.className = 'inventory__count';
      countEl.textContent = String(slot.count);
      slotEl.appendChild(itemEl);
      slotEl.appendChild(countEl);
    } else {
      slotEl.classList.add('inventory__slot--empty');
    }
    inventoryBar.appendChild(slotEl);
  }
}

function setActiveHotbarIndex(index) {
  if (inventory.slotCount === 0) return;
  const normalized = ((index % inventory.slotCount) + inventory.slotCount) % inventory.slotCount;
  if (normalized === activeHotbarIndex) {
    updateInventoryUI();
    return;
  }
  activeHotbarIndex = normalized;
  updateInventoryUI();
}

function handleInventoryKeyDown(event) {
  if (event.code.startsWith('Digit')) {
    const digit = Number(event.code.slice(-1));
    if (digit >= 1 && digit <= inventory.slotCount) {
      const targetIndex = digit - 1;
      setActiveHotbarIndex(targetIndex);
      return true;
    }
  }
  return false;
}

function handleInventoryWheel(deltaY) {
  if (deltaY === 0 || inventory.slotCount === 0) return false;
  const direction = deltaY > 0 ? 1 : -1;
  let nextIndex = (activeHotbarIndex + direction + inventory.slotCount) % inventory.slotCount;
  if (!inventory.getSlot(nextIndex)) {
    const found = inventory.findNextFilledSlot(activeHotbarIndex, direction);
    if (found !== -1) nextIndex = found;
  }
  setActiveHotbarIndex(nextIndex);
  return true;
}
