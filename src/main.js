import * as THREE from './vendor/three.module.js';
import { PointerLockControls } from './vendor/PointerLockControls.js';
import { World, BLOCK_TYPES, CHUNK_HEIGHT, BLOCK_TYPE_LABELS } from './world.js';
import { BLOCK_COLORS, FLOWER_UI_COLOR, DEFAULT_RENDER_DISTANCE } from './constants.js';

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
const healthBar = document.getElementById('health');

const HOTBAR_SLOT_COUNT = 9;
const MAX_STACK_SIZE = 64;
const FOOTSTEP_DISTANCE_INTERVAL = 2.2;
const BGM_URL = './src/sounds/bgm-sunny.mp3';
const MAX_HEALTH = 20;
const GAMEPAD_MOVE_DEADZONE = 0.18;
const GAMEPAD_LOOK_DEADZONE = 0.12;
const GAMEPAD_LOOK_SENSITIVITY = THREE.MathUtils.degToRad(210);
const GAMEPAD_TRIGGER_THRESHOLD = 0.4;
const GAMEPAD_BUTTON_THRESHOLD = 0.3;

const MATERIAL_SOUND_PROFILE = {
  [BLOCK_TYPES.grass]: { stepCutoff: 1200, breakCutoff: 1500, breakQ: 1.2, placeFreq: 440 },
  [BLOCK_TYPES.dirt]: { stepCutoff: 900, breakCutoff: 900, breakQ: 1.4, placeFreq: 410 },
  [BLOCK_TYPES.stone]: { stepCutoff: 650, breakCutoff: 700, breakQ: 1.8, placeFreq: 330 },
  [BLOCK_TYPES.sand]: { stepCutoff: 1400, breakCutoff: 1800, breakQ: 0.8, placeFreq: 520 },
  [BLOCK_TYPES.wood]: { stepCutoff: 1000, breakCutoff: 1200, breakQ: 1.5, placeFreq: 360 },
  [BLOCK_TYPES.leaves]: { stepCutoff: 1600, breakCutoff: 1900, breakQ: 0.7, placeFreq: 560 },
  [BLOCK_TYPES.gold]: { stepCutoff: 800, breakCutoff: 950, breakQ: 1.6, placeFreq: 300 },
  [BLOCK_TYPES.diamond]: { stepCutoff: 1100, breakCutoff: 1300, breakQ: 1.9, placeFreq: 620 },
  [BLOCK_TYPES.flower]: { stepCutoff: 1700, breakCutoff: 2000, breakQ: 0.6, placeFreq: 650 },
  [BLOCK_TYPES.water]: { stepCutoff: 1450, breakCutoff: 1200, breakQ: 0.9, placeFreq: 480 },
  default: { stepCutoff: 1100, breakCutoff: 1400, breakQ: 1.1, placeFreq: 420 },
};

class SoundManager {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.fxGain = null;
    this.musicGain = null;
    this.bgmStarted = false;
    this.bgmSource = null;
    this.bgmBuffer = null;
    this.bgmStartTime = 0;
    this.bgmOffset = 0;
    this.bgmPlaying = false;
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

  async ensureBgmBuffer() {
    this.ensureContext();
    if (!this.context) return null;
    if (this.bgmBuffer) return this.bgmBuffer;
    const response = await fetch(BGM_URL);
    if (!response.ok) throw new Error(`Failed to load BGM: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    this.bgmBuffer = await this.context.decodeAudioData(arrayBuffer.slice(0));
    return this.bgmBuffer;
  }

  stopBgmInternal() {
    if (this.bgmSource) {
      try {
        this.bgmSource.onended = null;
        this.bgmSource.stop();
      } catch (error) {
        // no-op
      }
      try {
        this.bgmSource.disconnect();
      } catch (error) {
        // no-op
      }
    }
    this.bgmSource = null;
  }

  async startBgm(offset = null) {
    this.ensureContext();
    if (!this.context) return;
    try {
      await this.ensureBgmBuffer();
    } catch (error) {
      console.warn('Unable to load background music:', error);
      return;
    }
    if (!this.bgmBuffer) return;
    if (this.bgmPlaying) return;

    const duration = this.bgmBuffer.duration || 0;
    let startOffset = this.bgmOffset;
    if (typeof offset === 'number') startOffset = offset;
    if (duration > 0) {
      startOffset = ((startOffset % duration) + duration) % duration;
    } else {
      startOffset = 0;
    }

    this.stopBgmInternal();
    const source = this.context.createBufferSource();
    source.buffer = this.bgmBuffer;
    source.loop = true;
    source.connect(this.musicGain);
    source.start(0, startOffset);
    this.bgmSource = source;
    this.bgmOffset = startOffset;
    this.bgmStartTime = this.context.currentTime - startOffset;
    this.bgmStarted = true;
    this.bgmPlaying = true;
    source.onended = () => {
      if (!this.bgmPlaying) return;
      this.bgmPlaying = false;
    };
  }

  pauseBgm() {
    if (!this.context || !this.bgmPlaying) return;
    if (this.bgmBuffer) {
      const duration = this.bgmBuffer.duration || 0;
      if (duration > 0) {
        const elapsed = this.context.currentTime - (this.bgmStartTime ?? 0);
        this.bgmOffset = ((this.bgmOffset + elapsed) % duration + duration) % duration;
      }
    }
    this.stopBgmInternal();
    this.bgmPlaying = false;
  }

  async resumeBgm() {
    if (this.bgmPlaying) return;
    if (!this.bgmStarted) {
      await this.startBgm(0);
      return;
    }
    await this.startBgm();
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
let health = MAX_HEALTH;
const gamepadState = {
  index: -1,
  connected: false,
  buttons: [],
  moveX: 0,
  moveY: 0,
  lookX: 0,
  lookY: 0,
};

function blockColorToCss(type) {
  let base = BLOCK_COLORS[type];
  if (!base && type === BLOCK_TYPES.flower) base = FLOWER_UI_COLOR;
  if (!base) return 'rgba(255, 255, 255, 0.2)';
  const [r, g, b] = base.map((channel) => Math.round(channel * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

function applyDeadzone(value, deadzone) {
  if (Math.abs(value) < deadzone) return 0;
  const sign = Math.sign(value);
  const adjusted = (Math.abs(value) - deadzone) / (1 - deadzone);
  return adjusted * sign;
}

updateInventoryUI();
updateHealthUI();

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
const cameraDirection = new THREE.Vector3();

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
const NON_COLLIDING_BLOCKS = new Set([BLOCK_TYPES.air, BLOCK_TYPES.flower, BLOCK_TYPES.water]);
const KEYBOARD_LOOK_YAW_SPEED = THREE.MathUtils.degToRad(150);
const KEYBOARD_LOOK_PITCH_SPEED = THREE.MathUtils.degToRad(110);

let worldReady = false;
let loadingInProgress = false;

if (hud) hud.classList.add('hidden');
if (crosshair) crosshair.classList.add('hidden');
if (inventoryBar) inventoryBar.classList.add('hidden');
if (healthBar) healthBar.classList.add('hidden');

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

function releaseGamepadControls() {
  setMovementState('ShiftLeft', false);
  setMovementState('Space', false);
}

window.addEventListener('gamepadconnected', (event) => {
  if (gamepadState.index === -1) gamepadState.index = event.gamepad.index;
  gamepadState.connected = true;
});

window.addEventListener('gamepaddisconnected', (event) => {
  if (event.gamepad.index === gamepadState.index) {
    gamepadState.index = -1;
    gamepadState.connected = false;
    gamepadState.buttons = [];
    gamepadState.moveX = 0;
    gamepadState.moveY = 0;
    gamepadState.lookX = 0;
    gamepadState.lookY = 0;
    releaseGamepadControls();
  }
});

controls.addEventListener('lock', () => {
  if (worldReady) {
    overlay.classList.add('hidden');
  }
  sound.resume();
  if (worldReady) void sound.resumeBgm();
  updateCrosshairVisibility();
});

controls.addEventListener('unlock', () => {
  sound.pauseBgm();
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

function attemptBreakBlock() {
  if (!controls.isLocked || !worldReady) return false;
  refreshRaycaster();
  const target = world.getRaycastTarget(raycaster, { place: false });
  if (!target) return false;
  const blockType = world.getBlock(target.x, target.y, target.z);
  if (blockType === BLOCK_TYPES.air || blockType === BLOCK_TYPES.water) return false;
  const removed = world.setBlock(target.x, target.y, target.z, BLOCK_TYPES.air);
  if (!removed) return false;
  sound.playBlockBreak(blockType);
  inventory.add(blockType, 1);
  updateInventoryUI();
  return true;
}

function attemptPlaceBlock(forceType = null) {
  if (!controls.isLocked || !worldReady) return false;
  const slot = inventory.getSlot(activeHotbarIndex);
  const blockType = forceType ?? slot?.type;
  if (!blockType || blockType === BLOCK_TYPES.air || blockType === BLOCK_TYPES.water) return false;
  refreshRaycaster();
  const target = world.getRaycastTarget(raycaster, { place: true });
  if (!target || target.y < 0 || target.y >= CHUNK_HEIGHT - 1) return false;
  const playerPos = controls.getObject().position;
  const distance = Math.hypot(target.x + 0.5 - playerPos.x, target.y + 0.5 - playerPos.y, target.z + 0.5 - playerPos.z);
  if (distance <= 1.75) return false;
  const existing = world.getBlock(target.x, target.y, target.z);
  if (!NON_COLLIDING_BLOCKS.has(existing)) return false;
  const placed = world.setBlock(target.x, target.y, target.z, blockType);
  if (!placed) return false;
  if (!forceType) inventory.removeFromSlot(activeHotbarIndex, 1);
  updateInventoryUI();
  sound.playBlockPlace(blockType);
  return true;
}

document.addEventListener('mousedown', (event) => {
  if (!controls.isLocked) return;
  if (event.button === 0) {
    attemptBreakBlock();
  } else if (event.button === 2) {
    event.preventDefault();
    attemptPlaceBlock();
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
      const blockType = world.getBlock(blockX, by, blockZ);
      if (!NON_COLLIDING_BLOCKS.has(blockType)) {
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

  const digitalZ = Number(keyState.forward) - Number(keyState.backward);
  const digitalX = Number(keyState.right) - Number(keyState.left);
  direction.z = digitalZ + gamepadState.moveY;
  direction.x = digitalX + gamepadState.moveX;
  const dirLength = direction.length();
  if (dirLength > 1) {
    direction.divideScalar(dirLength);
  }

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

  if (!wasGroundedPrevFrame && grounded) {
    const landingSurface = Number.isFinite(surface) ? surface : currentGroundHeight;
    const fallDistance = Math.max(0, takeoffGroundHeight - landingSurface);
    if (fallDistance > 3) {
      const damage = Math.floor((fallDistance - 3) * 2);
      if (damage > 0) applyDamage(damage);
    }
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

  camera.getWorldDirection(cameraDirection);
  world.updatePlayerPosition(object.position, cameraDirection);
}

function animate() {
  const frameDelta = clock.getDelta();
  const delta = Math.min(0.05, frameDelta);
  updateGamepadState();
  applyKeyboardLook(frameDelta);
  applyGamepadLook(delta);
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
  camera.getWorldDirection(cameraDirection);
  world.updatePlayerView(cameraDirection);
  try {
    await world.generateAsync(DEFAULT_RENDER_DISTANCE, (progress) => setLoadingProgress(progress * 0.95));
    finalizeWorldLoad();
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
  if (healthBar) healthBar.classList.add('hidden');
  sound.pauseBgm();
  updateCrosshairVisibility();
}

function finalizeWorldLoad() {
  spawn = world.getSpawnPoint();
  controls.getObject().position.copy(spawn);
  controls.getObject().position.y = Math.min(spawn.y, CHUNK_HEIGHT - 1);
  camera.getWorldDirection(cameraDirection);
  world.updatePlayerPosition(controls.getObject().position, cameraDirection);
  lastSafePosition.copy(controls.getObject().position);
  currentGroundHeight = world.getSurfaceHeightAt(spawn.x, spawn.z, spawn.y);
  takeoffGroundHeight = currentGroundHeight;
  maxClimbHeight = currentGroundHeight + MAX_STEP_HEIGHT;
  wasGroundedPrevious = true;
  worldReady = true;
  if (hud) hud.classList.remove('hidden');
  if (inventoryBar) inventoryBar.classList.remove('hidden');
  if (healthBar) healthBar.classList.remove('hidden');
  hudAccumulator = 0;
  updateHUD();
  updateFPSHud(0);
  updateInventoryUI();
  health = MAX_HEALTH;
  updateHealthUI();
  sound.resume();
  void sound.startBgm();
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

function applyGamepadLook(delta) {
  if (!worldReady || !controls.isLocked) return;
  const yawInput = gamepadState.lookX;
  const pitchInput = gamepadState.lookY;
  if (Math.abs(yawInput) < 1e-3 && Math.abs(pitchInput) < 1e-3) return;
  const camera = controls.getObject();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  euler.setFromQuaternion(camera.quaternion);
  euler.y -= yawInput * GAMEPAD_LOOK_SENSITIVITY * delta;
  euler.x = clampPitch(euler.x + pitchInput * GAMEPAD_LOOK_SENSITIVITY * delta);
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

function clampHealth(value) {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(MAX_HEALTH, value));
}

function updateHealthUI() {
  if (!healthBar) return;
  const totalHearts = MAX_HEALTH / 2;
  let remaining = clampHealth(health);
  const fragments = [];
  for (let i = 0; i < totalHearts; i += 1) {
    let className = 'health__heart';
    if (remaining >= 2) {
      className += ' health__heart--full';
      remaining -= 2;
    } else if (remaining === 1) {
      className += ' health__heart--half';
      remaining = 0;
    } else {
      className += ' health__heart--empty';
    }
    fragments.push(`<div class="${className}"></div>`);
  }
  healthBar.innerHTML = fragments.join('');
  const heartsValue = (clampHealth(health) / 2).toFixed(1).replace(/\.0$/, '');
  healthBar.setAttribute('aria-label', `Health: ${heartsValue} hearts`);
}

function applyDamage(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  health = clampHealth(health - amount);
  updateHealthUI();
  if (health <= 0) {
    handlePlayerDeath();
  }
}

function heal(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  health = clampHealth(health + amount);
  updateHealthUI();
}

function handlePlayerDeath() {
  health = MAX_HEALTH;
  updateHealthUI();
  const player = controls.getObject();
  player.position.copy(spawn);
  player.position.y = Math.min(spawn.y, CHUNK_HEIGHT - 1);
  velocity.set(0, 0, 0);
  footstepDistanceAccumulator = 0;
  currentGroundHeight = world.getSurfaceHeightAt(spawn.x, spawn.z, spawn.y);
  takeoffGroundHeight = currentGroundHeight;
  maxClimbHeight = currentGroundHeight + MAX_STEP_HEIGHT;
}

function updateGamepadState() {
  const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  let pad = null;
  if (gamepadState.index >= 0 && pads[gamepadState.index]) {
    pad = pads[gamepadState.index];
  } else {
    for (const candidate of pads) {
      if (candidate && candidate.connected) {
        pad = candidate;
        gamepadState.index = candidate.index;
        break;
      }
    }
  }

  if (!pad) {
    if (gamepadState.connected) {
      gamepadState.connected = false;
      releaseGamepadControls();
    }
    gamepadState.moveX = 0;
    gamepadState.moveY = 0;
    gamepadState.lookX = 0;
    gamepadState.lookY = 0;
    return;
  }

  gamepadState.connected = true;

  const axis0 = pad.axes?.[0] ?? 0;
  const axis1 = pad.axes?.[1] ?? 0;
  const axis2 = pad.axes?.[2] ?? 0;
  const axis3 = pad.axes?.[3] ?? 0;

  gamepadState.moveX = THREE.MathUtils.clamp(applyDeadzone(axis0, GAMEPAD_MOVE_DEADZONE), -1, 1);
  gamepadState.moveY = THREE.MathUtils.clamp(applyDeadzone(-axis1, GAMEPAD_MOVE_DEADZONE), -1, 1);
  gamepadState.lookX = THREE.MathUtils.clamp(applyDeadzone(axis2, GAMEPAD_LOOK_DEADZONE), -1, 1);
  gamepadState.lookY = THREE.MathUtils.clamp(applyDeadzone(-axis3, GAMEPAD_LOOK_DEADZONE), -1, 1);

  const buttons = pad.buttons ?? [];
  const isPressed = (index, threshold = GAMEPAD_BUTTON_THRESHOLD) => {
    const button = buttons[index];
    if (!button) return false;
    return button.pressed || button.value > threshold;
  };

  const handleButton = (index, onPress, onRelease, threshold) => {
    const pressed = isPressed(index, threshold);
    const prev = gamepadState.buttons[index] ?? false;
    if (pressed && !prev && typeof onPress === 'function') onPress();
    if (!pressed && prev && typeof onRelease === 'function') onRelease();
    gamepadState.buttons[index] = pressed;
  };

  handleButton(0, () => {
    sound.resume();
    if (!worldReady) {
      if (!loadingInProgress) startWorldLoading();
      return;
    }
    if (!controls.isLocked) {
      controls.lock();
      return;
    }
    setMovementState('Space', true);
  }, () => {
    if (controls.isLocked) setMovementState('Space', false);
  });

  handleButton(9, () => {
    sound.resume();
    if (!worldReady) {
      if (!loadingInProgress) startWorldLoading();
      return;
    }
    if (!controls.isLocked) {
      controls.lock();
    }
  });

  handleButton(10, () => {
    setMovementState('ShiftLeft', true);
  }, () => {
    setMovementState('ShiftLeft', false);
  });

  const breakAction = () => {
    if (!controls.isLocked) {
      if (worldReady && !loadingInProgress) controls.lock();
      return;
    }
    attemptBreakBlock();
  };

  const placeAction = () => {
    if (!controls.isLocked) {
      if (worldReady && !loadingInProgress) controls.lock();
      return;
    }
    attemptPlaceBlock();
  };

  handleButton(7, breakAction, null, GAMEPAD_TRIGGER_THRESHOLD);
  handleButton(6, placeAction, null, GAMEPAD_TRIGGER_THRESHOLD);

  handleButton(4, () => {
    handleInventoryWheel(-1);
  });

  handleButton(5, () => {
    handleInventoryWheel(1);
  });

  handleButton(14, () => {
    handleInventoryWheel(-1);
  });

  handleButton(15, () => {
    handleInventoryWheel(1);
  });

}
