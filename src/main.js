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
const touchControls = document.getElementById('touch-controls');
const movePad = document.getElementById('touch-move-pad');
const moveKnob = document.getElementById('touch-move-knob');
const touchJumpButton = document.getElementById('touch-action-jump');
const touchAttackButton = document.getElementById('touch-action-attack');
const touchPlaceButton = document.getElementById('touch-action-place');
const touchSprintButton = document.getElementById('touch-action-sprint');

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

const WEATHER_TYPES = Object.freeze({
  SUNNY: 'sunny',
  RAIN: 'rain',
  SNOW: 'snow',
  THUNDERSTORM: 'thunderstorm',
});

const TIME_OF_DAY = Object.freeze({
  DAY: 'day',
  NIGHT: 'night',
});

const WEATHER_SELECTION = [
  { type: WEATHER_TYPES.SUNNY, weight: 0.62 },
  { type: WEATHER_TYPES.RAIN, weight: 0.25 },
  { type: WEATHER_TYPES.SNOW, weight: 0.08 },
  { type: WEATHER_TYPES.THUNDERSTORM, weight: 0.05 },
];

const WEATHER_DURATION_RANGE_MS = [120_000, 240_000];
const DAY_HALF_CYCLE_MS = 600_000; // 10 minutes per half cycle
const FULL_DAY_DURATION_MS = DAY_HALF_CYCLE_MS * 2;

const PRECIPITATION_COUNT = 900;
const PRECIPITATION_WIDTH = 55;
const PRECIPITATION_HEIGHT = 45;
const PRECIPITATION_RESET_PADDING = 4;
const PRECIPITATION_VERTICAL_OFFSET = 10;
const WEATHER_TRANSITION_SPEED = 0.35;

const WEATHER_LABELS = {
  [WEATHER_TYPES.SUNNY]: 'Clear',
  [WEATHER_TYPES.RAIN]: 'Rain',
  [WEATHER_TYPES.SNOW]: 'Snow',
  [WEATHER_TYPES.THUNDERSTORM]: 'Thunderstorm',
};

const TIME_OF_DAY_LABELS = {
  [TIME_OF_DAY.DAY]: 'Day',
  [TIME_OF_DAY.NIGHT]: 'Night',
};

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

const WEATHER_CONFIG = {
  [WEATHER_TYPES.SUNNY]: {
    precipitation: null,
    lightningFrequency: 0,
    day: {
      sky: 0x87ceeb,
      fog: 0xaed9ff,
      fogNear: 85,
      fogFar: 300,
      sunIntensity: 0.95,
      sunColor: 0xfff6d5,
      hemisphereIntensity: 0.58,
      hemiSky: 0xfff7e5,
      hemiGround: 0x4a545d,
    },
    night: {
      sky: 0x050c19,
      fog: 0x070d18,
      fogNear: 32,
      fogFar: 130,
      sunIntensity: 0.18,
      sunColor: 0xbfd2ff,
      hemisphereIntensity: 0.24,
      hemiSky: 0x16253a,
      hemiGround: 0x02060a,
    },
  },
  [WEATHER_TYPES.RAIN]: {
    precipitation: {
      type: 'rain',
      speedRange: [14, 24],
      size: 0.12,
      opacity: 0.72,
      color: 0x6aa9ff,
      drift: { x: [-6, -2], z: [-2, 2] },
    },
    lightningFrequency: 0,
    day: {
      sky: 0x6c7c88,
      fog: 0x6c7c88,
      fogNear: 55,
      fogFar: 160,
      sunIntensity: 0.55,
      sunColor: 0xe3e8f0,
      hemisphereIntensity: 0.52,
      hemiSky: 0xcdd5df,
      hemiGround: 0x384249,
    },
    night: {
      sky: 0x1b2731,
      fog: 0x1b2731,
      fogNear: 28,
      fogFar: 100,
      sunIntensity: 0.12,
      sunColor: 0xb5c2d0,
      hemisphereIntensity: 0.22,
      hemiSky: 0x243646,
      hemiGround: 0x0c1115,
    },
  },
  [WEATHER_TYPES.SNOW]: {
    precipitation: {
      type: 'snow',
      speedRange: [3, 7],
      size: 0.32,
      opacity: 0.9,
      color: 0xffffff,
      drift: { x: [-1.2, 1.2], z: [-1.2, 1.2] },
    },
    lightningFrequency: 0,
    day: {
      sky: 0xbfd8ff,
      fog: 0xcde0ff,
      fogNear: 70,
      fogFar: 200,
      sunIntensity: 0.65,
      sunColor: 0xf0fbff,
      hemisphereIntensity: 0.6,
      hemiSky: 0xffffff,
      hemiGround: 0x8897a6,
    },
    night: {
      sky: 0x1d2b3c,
      fog: 0x223144,
      fogNear: 32,
      fogFar: 110,
      sunIntensity: 0.12,
      sunColor: 0xe0e9ff,
      hemisphereIntensity: 0.28,
      hemiSky: 0x2c3f55,
      hemiGround: 0x0d1219,
    },
  },
  [WEATHER_TYPES.THUNDERSTORM]: {
    precipitation: {
      type: 'rain',
      speedRange: [18, 32],
      size: 0.14,
      opacity: 0.78,
      color: 0x9cc7ff,
      drift: { x: [-9, -3], z: [-3, 3] },
    },
    lightningFrequency: 0.28,
    day: {
      sky: 0x303a45,
      fog: 0x303a45,
      fogNear: 45,
      fogFar: 120,
      sunIntensity: 0.45,
      sunColor: 0xf3f6ff,
      hemisphereIntensity: 0.5,
      hemiSky: 0xb9c7d8,
      hemiGround: 0x2b333b,
    },
    night: {
      sky: 0x0d131d,
      fog: 0x0d131d,
      fogNear: 25,
      fogFar: 90,
      sunIntensity: 0.1,
      sunColor: 0xcad7e8,
      hemisphereIntensity: 0.2,
      hemiSky: 0x1f2d3f,
      hemiGround: 0x05080c,
    },
  },
};

class WeatherSystem {
  constructor({ scene, sun, hemisphere, fog, controls, camera }) {
    this.scene = scene;
    this.sun = sun;
    this.hemisphere = hemisphere;
    this.fog = fog ?? null;
    this.controls = controls;
    this.camera = camera;
    this.playerObject = controls?.getObject?.() ?? camera;

    this.autoWeatherEnabled = true;
    this.autoTimeEnabled = true;
    this.currentWeather = WEATHER_TYPES.SUNNY;
    this.currentTimeOfDay = TIME_OF_DAY.DAY;
    this.nextWeatherChangeAt = Number.POSITIVE_INFINITY;
    this.nextTimeOfDayChangeAt = Number.POSITIVE_INFINITY;

    this.skyColor = this.scene.background instanceof THREE.Color
      ? this.scene.background.clone()
      : new THREE.Color(0x87ceeb);
    this.targetSkyColor = this.skyColor.clone();
    this.fogColor = this.fog?.color?.clone?.() ?? new THREE.Color(0x87ceeb);
    this.targetFogColor = this.fogColor.clone();
    this.sunColor = this.sun.color.clone();
    this.targetSunColor = this.sun.color.clone();
    this.hemisphereSkyColor = this.hemisphere.color.clone();
    this.targetHemisphereSkyColor = this.hemisphere.color.clone();
    this.hemisphereGroundColor = this.hemisphere.groundColor.clone();
    this.targetHemisphereGroundColor = this.hemisphere.groundColor.clone();
    this.currentSunIntensity = this.sun.intensity;
    this.targetSunIntensity = this.sun.intensity;
    this.currentHemisphereIntensity = this.hemisphere.intensity;
    this.targetHemisphereIntensity = this.hemisphere.intensity;
    this.targetFogNear = this.fog?.near ?? 75;
    this.targetFogFar = this.fog?.far ?? 250;

    this.transitionColor = new THREE.Color();
    this.transitionFogColor = new THREE.Color();
    this.flashColor = new THREE.Color(0xf6fbff);
    this.flashIntensity = 0;
    this.lightningCooldown = 0;

    this.precipSpeedRange = [10, 16];
    this.precipDriftRange = { x: [-1, 1], z: [-1, 1] };
    this.setupPrecipitation();

    this.lightningLight = new THREE.PointLight(0xfefbff, 0, 220, 2);
    this.lightningLight.castShadow = false;
    this.lightningLight.intensity = 0;
    this.scene.add(this.lightningLight);

    this.updateTargetsFromState(true);
    this.configurePrecipitation(WEATHER_CONFIG[this.currentWeather]);
    this.scheduleNextWeatherChange();
    this.scheduleNextTimeOfDayChange();
    this.exposeDebugHelpers();
  }

  setupPrecipitation() {
    this.precipitationPositions = new Float32Array(PRECIPITATION_COUNT * 3);
    this.precipitationSpeeds = new Float32Array(PRECIPITATION_COUNT);
    this.precipitationDriftX = new Float32Array(PRECIPITATION_COUNT);
    this.precipitationDriftZ = new Float32Array(PRECIPITATION_COUNT);
    this.precipitationGeometry = new THREE.BufferGeometry();
    this.precipitationGeometry.setAttribute('position', new THREE.BufferAttribute(this.precipitationPositions, 3));
    this.precipitationGeometry.computeBoundingSphere();

    this.rainMaterial = new THREE.PointsMaterial({
      color: 0x6aa9ff,
      size: 0.12,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.snowMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.32,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    this.precipitation = new THREE.Points(this.precipitationGeometry, this.rainMaterial);
    this.precipitation.visible = false;
    this.precipitation.frustumCulled = false;

    this.precipitationGroup = new THREE.Group();
    this.precipitationGroup.add(this.precipitation);
    this.precipitationGroup.visible = false;
    this.scene.add(this.precipitationGroup);
    this.precipitationEnabled = false;
  }

  update(delta) {
    this.updateTimers();
    this.updateLightning(delta);
    this.updateEnvironment(delta);
    this.updatePrecipitation(delta);
    this.dissipateLightning(delta);
  }

  updateTimers() {
    const now = performance.now();
    if (this.autoWeatherEnabled && now >= this.nextWeatherChangeAt) {
      const nextWeather = this.pickWeightedWeather();
      if (nextWeather !== this.currentWeather) {
        this.setWeather(nextWeather);
      } else {
        this.scheduleNextWeatherChange();
      }
    }
    if (this.autoTimeEnabled && now >= this.nextTimeOfDayChangeAt) {
      const nextTime = this.currentTimeOfDay === TIME_OF_DAY.DAY ? TIME_OF_DAY.NIGHT : TIME_OF_DAY.DAY;
      this.setTimeOfDay(nextTime);
    }
  }

  updateEnvironment(delta) {
    const t = Math.min(1, delta * WEATHER_TRANSITION_SPEED);
    this.skyColor.lerp(this.targetSkyColor, t);
    this.fogColor.lerp(this.targetFogColor, t);
    this.sunColor.lerp(this.targetSunColor, t);
    this.hemisphereSkyColor.lerp(this.targetHemisphereSkyColor, t);
    this.hemisphereGroundColor.lerp(this.targetHemisphereGroundColor, t);
    this.currentSunIntensity = THREE.MathUtils.lerp(this.currentSunIntensity, this.targetSunIntensity, t);
    this.currentHemisphereIntensity = THREE.MathUtils.lerp(this.currentHemisphereIntensity, this.targetHemisphereIntensity, t);

    if (this.fog) {
      this.fog.near = THREE.MathUtils.lerp(this.fog.near, this.targetFogNear, t);
      this.fog.far = THREE.MathUtils.lerp(this.fog.far, this.targetFogFar, t);
    }

    const flashFactor = Math.min(1, this.flashIntensity);
    const currentSky = flashFactor > 0
      ? this.transitionColor.copy(this.skyColor).lerp(this.flashColor, flashFactor * 0.6)
      : this.skyColor;
    const currentFog = flashFactor > 0
      ? this.transitionFogColor.copy(this.fogColor).lerp(this.flashColor, flashFactor * 0.4)
      : this.fogColor;

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(currentSky);
    } else {
      this.scene.background = currentSky.clone();
    }
    if (this.fog) this.fog.color.copy(currentFog);

    this.sun.color.copy(this.sunColor);
    this.sun.intensity = this.currentSunIntensity + flashFactor * 0.8;
    this.hemisphere.color.copy(this.hemisphereSkyColor);
    this.hemisphere.groundColor.copy(this.hemisphereGroundColor);
    this.hemisphere.intensity = this.currentHemisphereIntensity;
  }

  updatePrecipitation(delta) {
    if (!this.precipitationEnabled) return;

    const halfWidth = PRECIPITATION_WIDTH * 0.5;
    const positions = this.precipitationPositions;
    for (let i = 0; i < PRECIPITATION_COUNT; i += 1) {
      const index = i * 3;
      positions[index] += this.precipitationDriftX[i] * delta;
      positions[index + 2] += this.precipitationDriftZ[i] * delta;
      positions[index + 1] -= this.precipitationSpeeds[i] * delta;

      if (positions[index + 1] < -PRECIPITATION_RESET_PADDING) {
        this.resetPrecipitationParticle(i, false);
        continue;
      }

      if (positions[index] < -halfWidth || positions[index] > halfWidth) {
        positions[index] = THREE.MathUtils.randFloatSpread(PRECIPITATION_WIDTH);
      }
      if (positions[index + 2] < -halfWidth || positions[index + 2] > halfWidth) {
        positions[index + 2] = THREE.MathUtils.randFloatSpread(PRECIPITATION_WIDTH);
      }
    }

    this.precipitationGeometry.attributes.position.needsUpdate = true;

    const playerPosition = this.getPlayerPosition();
    if (playerPosition) {
      this.precipitationGroup.position.set(
        playerPosition.x,
        playerPosition.y + PRECIPITATION_VERTICAL_OFFSET,
        playerPosition.z,
      );
    }
  }

  updateLightning(delta) {
    const config = WEATHER_CONFIG[this.currentWeather];
    const frequency = config?.lightningFrequency ?? 0;
    if (frequency <= 0) {
      this.lightningCooldown = 0;
      return;
    }

    this.lightningCooldown -= delta;
    if (this.lightningCooldown <= 0) {
      const chance = Math.min(1, frequency * delta);
      if (Math.random() < chance) {
        this.triggerLightning();
      } else {
        this.lightningCooldown = THREE.MathUtils.randFloat(0.4, 1.4);
      }
    }
  }

  dissipateLightning(delta) {
    if (this.flashIntensity > 0) {
      this.flashIntensity = Math.max(0, this.flashIntensity - delta * 2.6);
    }
    if (this.lightningLight.intensity > 0) {
      this.lightningLight.intensity = Math.max(0, this.lightningLight.intensity - delta * 8);
    }
  }

  triggerLightning() {
    const playerPosition = this.getPlayerPosition();
    if (playerPosition) {
      this.lightningLight.position.set(
        playerPosition.x + THREE.MathUtils.randFloatSpread(60),
        playerPosition.y + 20 + Math.random() * 25,
        playerPosition.z + THREE.MathUtils.randFloatSpread(60),
      );
    }
    this.lightningLight.intensity = 10 + Math.random() * 4;
    this.flashIntensity = 1;
    this.lightningCooldown = THREE.MathUtils.randFloat(1.2, 3.6);
  }

  setWeather(weather, options = {}) {
    if (!WEATHER_CONFIG[weather]) return;
    if (weather === this.currentWeather && !options.force) {
      if (this.autoWeatherEnabled) this.scheduleNextWeatherChange();
      return;
    }
    this.currentWeather = weather;
    if (typeof options.autoWeather === 'boolean') this.autoWeatherEnabled = options.autoWeather;
    this.updateTargetsFromState(Boolean(options.instant));
    this.configurePrecipitation(WEATHER_CONFIG[weather]);
    if (this.autoWeatherEnabled) this.scheduleNextWeatherChange();
    else this.nextWeatherChangeAt = Number.POSITIVE_INFINITY;
  }

  setTimeOfDay(timeOfDay, options = {}) {
    const normalized = timeOfDay === TIME_OF_DAY.NIGHT ? TIME_OF_DAY.NIGHT : TIME_OF_DAY.DAY;
    if (normalized === this.currentTimeOfDay && !options.force) {
      if (this.autoTimeEnabled) this.scheduleNextTimeOfDayChange();
      return;
    }
    this.currentTimeOfDay = normalized;
    if (typeof options.autoTime === 'boolean') this.autoTimeEnabled = options.autoTime;
    this.updateTargetsFromState(Boolean(options.instant));
    if (this.autoTimeEnabled) this.scheduleNextTimeOfDayChange();
    else this.nextTimeOfDayChangeAt = Number.POSITIVE_INFINITY;
  }

  configurePrecipitation(config) {
    const settings = config?.precipitation ?? null;
    if (!settings) {
      this.precipitationEnabled = false;
      this.precipitation.visible = false;
      this.precipitationGroup.visible = false;
      return;
    }

    this.precipitationEnabled = true;
    this.precipitation.visible = true;
    this.precipitationGroup.visible = true;

    const material = settings.type === 'snow' ? this.snowMaterial : this.rainMaterial;
    material.size = settings.size ?? material.size;
    material.opacity = settings.opacity ?? material.opacity;
    material.color.set(settings.color ?? material.color.getHex());
    material.needsUpdate = true;
    this.precipitation.material = material;

    this.precipSpeedRange = settings.speedRange ?? this.precipSpeedRange;
    this.precipDriftRange = settings.drift ?? { x: [-1, 1], z: [-1, 1] };
    this.resetAllPrecipitation(true);
  }

  resetAllPrecipitation(initial = false) {
    for (let i = 0; i < PRECIPITATION_COUNT; i += 1) {
      this.resetPrecipitationParticle(i, initial);
    }
    this.precipitationGeometry.attributes.position.needsUpdate = true;
    this.precipitationGeometry.computeBoundingSphere();
  }

  resetPrecipitationParticle(index, randomizeHeight) {
    const posIndex = index * 3;
    this.precipitationPositions[posIndex] = THREE.MathUtils.randFloatSpread(PRECIPITATION_WIDTH);
    this.precipitationPositions[posIndex + 2] = THREE.MathUtils.randFloatSpread(PRECIPITATION_WIDTH);
    if (randomizeHeight) {
      this.precipitationPositions[posIndex + 1] = THREE.MathUtils.randFloat(0, PRECIPITATION_HEIGHT);
    } else {
      this.precipitationPositions[posIndex + 1] = PRECIPITATION_HEIGHT + Math.random() * PRECIPITATION_RESET_PADDING;
    }

    const [minSpeed, maxSpeed] = this.precipSpeedRange;
    this.precipitationSpeeds[index] = THREE.MathUtils.randFloat(minSpeed, maxSpeed);

    if (this.precipDriftRange) {
      const { x, z } = this.precipDriftRange;
      this.precipitationDriftX[index] = THREE.MathUtils.randFloat(x[0], x[1]);
      this.precipitationDriftZ[index] = THREE.MathUtils.randFloat(z[0], z[1]);
    } else {
      this.precipitationDriftX[index] = 0;
      this.precipitationDriftZ[index] = 0;
    }
  }

  updateTargetsFromState(instant = false) {
    const config = WEATHER_CONFIG[this.currentWeather] ?? WEATHER_CONFIG[WEATHER_TYPES.SUNNY];
    const timeConfig = config[this.currentTimeOfDay] ?? config.day;

    this.targetSkyColor.set(timeConfig.sky ?? 0x87ceeb);
    this.targetFogColor.set(timeConfig.fog ?? timeConfig.sky ?? 0x87ceeb);
    this.targetSunColor.set(timeConfig.sunColor ?? 0xffffff);
    this.targetHemisphereSkyColor.set(timeConfig.hemiSky ?? this.hemisphere.color.getHex());
    this.targetHemisphereGroundColor.set(timeConfig.hemiGround ?? this.hemisphere.groundColor.getHex());
    this.targetSunIntensity = timeConfig.sunIntensity ?? this.sun.intensity;
    this.targetHemisphereIntensity = timeConfig.hemisphereIntensity ?? this.hemisphere.intensity;
    this.targetFogNear = timeConfig.fogNear ?? this.fog?.near ?? 75;
    this.targetFogFar = timeConfig.fogFar ?? this.fog?.far ?? 250;

    if (instant) {
      this.skyColor.copy(this.targetSkyColor);
      this.fogColor.copy(this.targetFogColor);
      this.sunColor.copy(this.targetSunColor);
      this.hemisphereSkyColor.copy(this.targetHemisphereSkyColor);
      this.hemisphereGroundColor.copy(this.targetHemisphereGroundColor);
      this.currentSunIntensity = this.targetSunIntensity;
      this.currentHemisphereIntensity = this.targetHemisphereIntensity;
      if (this.fog) {
        this.fog.near = this.targetFogNear;
        this.fog.far = this.targetFogFar;
        this.fog.color.copy(this.fogColor);
      }
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.copy(this.skyColor);
      } else {
        this.scene.background = this.skyColor.clone();
      }
      this.sun.color.copy(this.sunColor);
      this.sun.intensity = this.currentSunIntensity;
      this.hemisphere.color.copy(this.hemisphereSkyColor);
      this.hemisphere.groundColor.copy(this.hemisphereGroundColor);
      this.hemisphere.intensity = this.currentHemisphereIntensity;
    }
  }

  scheduleNextWeatherChange() {
    if (!this.autoWeatherEnabled) {
      this.nextWeatherChangeAt = Number.POSITIVE_INFINITY;
      return;
    }
    const duration = THREE.MathUtils.randFloat(WEATHER_DURATION_RANGE_MS[0], WEATHER_DURATION_RANGE_MS[1]);
    this.nextWeatherChangeAt = performance.now() + duration;
  }

  scheduleNextTimeOfDayChange() {
    if (!this.autoTimeEnabled) {
      this.nextTimeOfDayChangeAt = Number.POSITIVE_INFINITY;
      return;
    }
    this.nextTimeOfDayChangeAt = performance.now() + DAY_HALF_CYCLE_MS;
  }

  pickWeightedWeather() {
    const totalWeight = WEATHER_SELECTION.reduce((sum, entry) => sum + entry.weight, 0);
    let threshold = Math.random() * totalWeight;
    for (const entry of WEATHER_SELECTION) {
      threshold -= entry.weight;
      if (threshold <= 0) {
        return entry.type;
      }
    }
    return WEATHER_TYPES.SUNNY;
  }

  exposeDebugHelpers() {
    const api = (options = {}) => {
      if (options.resume === true) {
        this.autoWeatherEnabled = true;
        this.autoTimeEnabled = true;
        this.scheduleNextWeatherChange();
        this.scheduleNextTimeOfDayChange();
        return this.getState();
      }

      if (typeof options.autoWeather === 'boolean') {
        this.autoWeatherEnabled = options.autoWeather;
        if (this.autoWeatherEnabled) this.scheduleNextWeatherChange();
      }
      if (typeof options.autoTime === 'boolean') {
        this.autoTimeEnabled = options.autoTime;
        if (this.autoTimeEnabled) this.scheduleNextTimeOfDayChange();
      }

      if (typeof options.weather === 'string') {
        const normalized = options.weather.toLowerCase();
        if (WEATHER_CONFIG[normalized]) {
          this.setWeather(normalized, { force: true, instant: options.instant === true });
        }
      }

      if (typeof options.timeOfDay === 'string') {
        const normalized = options.timeOfDay.toLowerCase() === TIME_OF_DAY.NIGHT
          ? TIME_OF_DAY.NIGHT
          : TIME_OF_DAY.DAY;
        this.setTimeOfDay(normalized, { force: true, instant: options.instant === true });
      }

      return this.getState();
    };

    api.help = () => (
      'setWeatherDebug usage:\n' +
      '  setWeatherDebug({ weather: "rain", timeOfDay: "night" });\n' +
      'Options: weather="sunny|rain|snow|thunderstorm", timeOfDay="day|night", \n' +
      'autoWeather=<bool> to re-enable/disable automatic cycling, autoTime=<bool>,\n' +
      'instant=<bool> for immediate transitions, resume=true to restore defaults.'
    );

    Object.defineProperty(window, 'setWeatherDebug', {
      value: api,
      configurable: true,
      writable: false,
    });
  }

  getState() {
    return {
      weather: this.currentWeather,
      timeOfDay: this.currentTimeOfDay,
      autoWeather: this.autoWeatherEnabled,
      autoTime: this.autoTimeEnabled,
      nextWeatherChangeAt: this.nextWeatherChangeAt,
      nextTimeOfDayChangeAt: this.nextTimeOfDayChangeAt,
    };
  }

  getPlayerPosition() {
    if (this.playerObject?.position) return this.playerObject.position;
    if (this.camera?.position) return this.camera.position;
    return null;
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
const pointerLockElement = canvas ?? document.body;
const pointerLockSupported = Boolean(pointerLockElement?.requestPointerLock || pointerLockElement?.mozRequestPointerLock || pointerLockElement?.webkitRequestPointerLock);
const isTouchCapable = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches;
const useTouchFallback = isTouchCapable && !pointerLockSupported;
const TOUCH_LOOK_SENSITIVITY = 2.2;
const TOUCH_TAP_MAX_DISTANCE = 18;
const TOUCH_TAP_MAX_DURATION = 220;
const TOUCH_DOUBLE_TAP_INTERVAL = 320;

const touchLookState = {
  id: null,
  lastX: 0,
  lastY: 0,
  startX: 0,
  startY: 0,
  startTime: 0,
  moved: false
};

let lastTouchTapTime = 0;

const enableVirtualJoystick = isTouchCapable;
const touchMoveState = { x: 0, y: 0 };
let activeMovePointerId = null;
const touchButtonPointers = new Map();
let touchControlsVisible = false;
let attackRepeatTimer = null;
let placeRepeatTimer = null;

const controls = new PointerLockControls(camera, pointerLockElement);
scene.add(controls.getObject());
const cameraDirection = new THREE.Vector3();

function hasActiveTouchControl() {
  return activeMovePointerId !== null || touchButtonPointers.size > 0 || touchLookState.id !== null;
}

function showTouchControls() {
  if (!enableVirtualJoystick || !touchControls) return;
  if (touchControlsVisible) return;
  touchControls.classList.remove('hidden');
  touchControls.setAttribute('aria-hidden', 'false');
  touchControlsVisible = true;
}

function hideTouchControls(force = false) {
  if (!enableVirtualJoystick || !touchControls) return;
  if (!touchControlsVisible) return;
  if (!force && hasActiveTouchControl()) return;
  touchControls.classList.add('hidden');
  touchControls.setAttribute('aria-hidden', 'true');
  touchControlsVisible = false;
  touchButtonPointers.clear();
  activeMovePointerId = null;
  resetTouchMoveState();
  clearAttackRepeat();
  clearPlaceRepeat();
  setSprintActive('touch', false);
}

function registerTouchInput() {
  if (!enableVirtualJoystick) return;
  showTouchControls();
}

function registerNonTouchInput() {
  if (!enableVirtualJoystick) return;
  if (!hasActiveTouchControl()) hideTouchControls();
}

function resetTouchMoveState() {
  touchMoveState.x = 0;
  touchMoveState.y = 0;
  updateMoveKnob();
}

function updateMoveKnob() {
  if (!moveKnob || !movePad) return;
  const padRect = movePad.getBoundingClientRect();
  const knobRect = moveKnob.getBoundingClientRect();
  const maxOffsetX = Math.max(0, (padRect.width - knobRect.width) * 0.5);
  const maxOffsetY = Math.max(0, (padRect.height - knobRect.height) * 0.5);
  moveKnob.style.setProperty('--knob-x', `${touchMoveState.x * maxOffsetX}px`);
  moveKnob.style.setProperty('--knob-y', `${-touchMoveState.y * maxOffsetY}px`);
}

function clearAttackRepeat() {
  if (attackRepeatTimer !== null) {
    clearInterval(attackRepeatTimer);
    attackRepeatTimer = null;
  }
}

function clearPlaceRepeat() {
  if (placeRepeatTimer !== null) {
    clearInterval(placeRepeatTimer);
    placeRepeatTimer = null;
  }
}

function disablePageZoom() {
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta) {
    viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  }

  const blockGesture = (event) => {
    event.preventDefault();
  };

  window.addEventListener('gesturestart', blockGesture, { passive: false });
  window.addEventListener('gesturechange', blockGesture, { passive: false });
  window.addEventListener('gestureend', blockGesture, { passive: false });

  window.addEventListener('wheel', (event) => {
    if (event.ctrlKey) event.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', (event) => {
    if (typeof event.scale === 'number' && event.scale !== 1) {
      event.preventDefault();
    }
  }, { passive: false });
}

function requestControlLock() {
  if (useTouchFallback) {
    if (!controls.isLocked) {
      controls.isLocked = true;
      controls.dispatchEvent({ type: 'lock' });
    }
    return;
  }
  controls.lock();
}

function releaseControlLock() {
  if (useTouchFallback) {
    if (controls.isLocked) {
      controls.isLocked = false;
      controls.dispatchEvent({ type: 'unlock' });
    }
    touchLookState.id = null;
    lastTouchTapTime = 0;
    return;
  }
  controls.unlock();
}

if (useTouchFallback) {
  setupTouchFallbackControls();
  if (overlay) {
    const paragraphs = overlay.querySelectorAll('p');
    if (paragraphs[0]) paragraphs[0].textContent = 'Tap to enter. Drag to look around.';
    if (paragraphs[1]) paragraphs[1].textContent = 'Single tap: remove block · Double tap: place block';
  }
}

disablePageZoom();

if (enableVirtualJoystick) {
  setupVirtualJoystick();
} else {
  hideTouchControls(true);
}

const hemisphere = new THREE.HemisphereLight(0xffffff, 0x506070, 0.55);
scene.add(hemisphere);

const sun = new THREE.DirectionalLight(0xffffff, 0.85);
sun.position.set(60, 120, 40);
scene.add(sun);

const world = new World(scene);
const weatherSystem = new WeatherSystem({ scene, sun, hemisphere, fog: scene.fog, controls, camera });
Object.defineProperty(window, 'setHealthPoints', {
  value: setHealthPoints,
  configurable: true,
  writable: false,
});

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
let takeoffFootHeight = 0;
const lastSafePosition = new THREE.Vector3();
let lastCrosshairVisible = false;
let footstepDistanceAccumulator = 0;

overlay.addEventListener('click', () => {
  if (loadingInProgress) return;
  sound.resume();
  if (worldReady) {
    requestControlLock();
    return;
  }
  startWorldLoading();
});

overlay.addEventListener('pointerdown', (event) => {
  if (isTouchPointer(event)) {
    registerTouchInput();
  } else {
    registerNonTouchInput();
  }
});

function releaseGamepadControls() {
  setSprintActive('gamepad', false);
  setMovementState('Space', false);
}

window.addEventListener('gamepadconnected', (event) => {
  registerNonTouchInput();
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
  crouchHold: false,
  lookUp: false,
  lookDown: false,
  lookLeft: false,
  lookRight: false,
};
let canJump = false;
const velocity = new THREE.Vector3(0, 0, 0);
const direction = new THREE.Vector3();
const STAND_HEIGHT = 1.75;
const CROUCH_HEIGHT = 1.35;
const CROUCH_SPEED_MULTIPLIER = 0.3;
let playerHeight = STAND_HEIGHT;
let isCrouching = false;
let crouchToggleActive = false;
const gravity = 40;
const walkAcceleration = 80;
const sprintMultiplier = 1.3;
const jumpImpulse = 15;

const sprintSources = new Set();
const KEYBOARD_SPRINT_DOUBLE_TAP_INTERVAL = 280;
let lastForwardTapTime = 0;

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

function setSprintActive(source, active) {
  if (active && isCrouching) {
    active = false;
  }
  if (active) {
    sprintSources.add(source);
  } else {
    sprintSources.delete(source);
  }
  keyState.sprint = sprintSources.size > 0;
}

function withTouchCrouchButton(callback) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('touch-action-crouch');
  if (!el) return;
  callback(el);
}

function updateCrouchIndicator() {
  withTouchCrouchButton((el) => {
    if (!el || !el.classList || typeof el.classList.toggle !== 'function') return;
    try {
      el.classList.toggle('touch-button--active', isCrouching);
      el.setAttribute('aria-pressed', String(isCrouching));
    } catch (error) {
      console.warn('Failed to update crouch indicator', error);
    }
  });
}

function syncCrouchState() {
  const target = keyState.crouchHold || crouchToggleActive;
  if (target === isCrouching && playerHeight === (target ? CROUCH_HEIGHT : STAND_HEIGHT)) {
    updateCrouchIndicator();
    return;
  }

  if (!worldReady) {
    isCrouching = target;
    playerHeight = target ? CROUCH_HEIGHT : STAND_HEIGHT;
    updateCrouchIndicator();
    return;
  }

  const object = controls.getObject();
  if (!object) {
    isCrouching = target;
    playerHeight = target ? CROUCH_HEIGHT : STAND_HEIGHT;
    updateCrouchIndicator();
    return;
  }

  const previousHeight = playerHeight;
  const nextHeight = target ? CROUCH_HEIGHT : STAND_HEIGHT;
  if (previousHeight === nextHeight && isCrouching === target) {
    updateCrouchIndicator();
    return;
  }

  const previousY = object.position.y;
  playerHeight = nextHeight;
  object.position.y += nextHeight - previousHeight;

  if (collidesAt(object.position)) {
    object.position.y = previousY;
    playerHeight = previousHeight;
    updateCrouchIndicator();
    return;
  }

  if (target) {
    if (sprintSources.size > 0) sprintSources.clear();
    keyState.sprint = false;
  }

  isCrouching = target;
  updateCrouchIndicator();
}

function setCrouchHold(active) {
  if (keyState.crouchHold === active) return;
  keyState.crouchHold = active;
  syncCrouchState();
}

function toggleCrouch() {
  crouchToggleActive = !crouchToggleActive;
  syncCrouchState();
}

function handleForwardDoubleTap() {
  const now = performance.now();
  if (lastForwardTapTime !== 0 && now - lastForwardTapTime <= KEYBOARD_SPRINT_DOUBLE_TAP_INTERVAL && controls.isLocked) {
    setSprintActive('doubleTap', true);
  }
  lastForwardTapTime = now;
}

function setMovementState(code, pressed) {
  switch (code) {
    case 'KeyW':
      keyState.forward = pressed;
      if (!pressed) setSprintActive('doubleTap', false);
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
      setCrouchHold(pressed);
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
  registerNonTouchInput();
  if (event.repeat) return;
  const handledInventory = handleInventoryKeyDown(event);
  if (LOOK_KEYS.has(event.code)) event.preventDefault();
  if (handledInventory) event.preventDefault();
  if (event.code === 'KeyW') handleForwardDoubleTap();
  setMovementState(event.code, true);
});

document.addEventListener('keyup', (event) => {
  registerNonTouchInput();
  if (LOOK_KEYS.has(event.code)) event.preventDefault();
  setMovementState(event.code, false);
});

const raycaster = new THREE.Raycaster();
raycaster.far = 8;

function refreshRaycaster() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
}

document.addEventListener('wheel', (event) => {
  registerNonTouchInput();
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
  registerNonTouchInput();
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

function setupTouchFallbackControls() {
  if (!canvas) return;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
  canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
  canvas.addEventListener('touchend', handleTouchEnd);
  canvas.addEventListener('touchcancel', handleTouchEnd);
}

function handleTouchStart(event) {
  registerTouchInput();
  if (!controls.isLocked) return;
  if (touchLookState.id !== null) return;
  const touch = event.changedTouches?.[0];
  if (!touch) return;
  touchLookState.id = touch.identifier;
  touchLookState.lastX = touch.clientX;
  touchLookState.lastY = touch.clientY;
  touchLookState.startX = touch.clientX;
  touchLookState.startY = touch.clientY;
  touchLookState.startTime = performance.now();
  touchLookState.moved = false;
  event.preventDefault();
}

function handleTouchMove(event) {
  registerTouchInput();
  if (touchLookState.id === null || !controls.isLocked) return;
  const touch = findTouchById(event.changedTouches, touchLookState.id);
  if (!touch) return;
  const deltaX = (touch.clientX - touchLookState.lastX) * TOUCH_LOOK_SENSITIVITY;
  const deltaY = (touch.clientY - touchLookState.lastY) * TOUCH_LOOK_SENSITIVITY;
  touchLookState.lastX = touch.clientX;
  touchLookState.lastY = touch.clientY;
  if (deltaX !== 0 || deltaY !== 0) {
    controls.rotate(deltaX, deltaY);
    const totalDx = touch.clientX - touchLookState.startX;
    const totalDy = touch.clientY - touchLookState.startY;
    if (!touchLookState.moved && totalDx * totalDx + totalDy * totalDy > TOUCH_TAP_MAX_DISTANCE * TOUCH_TAP_MAX_DISTANCE) {
      touchLookState.moved = true;
    }
  }
  event.preventDefault();
}

function handleTouchEnd(event) {
  const touch = findTouchById(event.changedTouches, touchLookState.id);
  if (!touch) return;
  const now = performance.now();
  const duration = now - touchLookState.startTime;
  const totalDx = touch.clientX - touchLookState.startX;
  const totalDy = touch.clientY - touchLookState.startY;
  const distanceSq = totalDx * totalDx + totalDy * totalDy;
  const isTap = !touchLookState.moved && distanceSq <= TOUCH_TAP_MAX_DISTANCE * TOUCH_TAP_MAX_DISTANCE && duration <= TOUCH_TAP_MAX_DURATION;
  touchLookState.id = null;
  if (!controls.isLocked) return;
  if (!isTap) return;
  if (now - lastTouchTapTime <= TOUCH_DOUBLE_TAP_INTERVAL) {
    lastTouchTapTime = 0;
    attemptPlaceBlock();
    event.preventDefault();
    return;
  }
  lastTouchTapTime = now;
  attemptBreakBlock();
  event.preventDefault();
}

function findTouchById(touchList, id) {
  if (!touchList || id === null) return null;
  for (let index = 0; index < touchList.length; index += 1) {
    const touch = touchList.item(index);
    if (touch?.identifier === id) return touch;
  }
  return null;
}

function setupVirtualJoystick() {
  updateMoveKnob();
  hideTouchControls(true);

  window.addEventListener('pointerdown', handleGlobalPointerDown, { passive: true });
  window.addEventListener('wheel', handleGlobalWheel, { passive: true });
  window.addEventListener('mousemove', handleGlobalMouseMove, { passive: true });

  if (movePad) {
    movePad.addEventListener('pointerdown', handleMovePadPointerDown);
    movePad.addEventListener('pointermove', handleMovePadPointerMove);
    movePad.addEventListener('pointerup', handleMovePadPointerUp);
    movePad.addEventListener('pointercancel', handleMovePadPointerUp);
  }

  bindJumpButton();
  bindAttackButton();
  bindPlaceButton();
  bindSprintButton();
  bindCrouchButton();
}

function handleGlobalPointerDown(event) {
  if (isTouchPointer(event)) {
    registerTouchInput();
  } else {
    registerNonTouchInput();
  }
}

function handleGlobalWheel() {
  registerNonTouchInput();
}

function handleGlobalMouseMove(event) {
  if (typeof event.movementX === 'number' || typeof event.movementY === 'number') {
    if (event.movementX !== 0 || event.movementY !== 0) registerNonTouchInput();
  } else {
    registerNonTouchInput();
  }
}

function isTouchPointer(event) {
  return event.pointerType === 'touch';
}

function handleMovePadPointerDown(event) {
  if (!isTouchPointer(event)) {
    registerNonTouchInput();
    return;
  }
  registerTouchInput();
  event.preventDefault();
  if (typeof movePad.setPointerCapture === 'function') {
    try {
      movePad.setPointerCapture(event.pointerId);
    } catch (error) {
      // ignore if capture fails
    }
  }
  activeMovePointerId = event.pointerId;
  updateMovePadFromEvent(event);
}

function handleMovePadPointerMove(event) {
  if (event.pointerId !== activeMovePointerId) return;
  registerTouchInput();
  event.preventDefault();
  updateMovePadFromEvent(event);
}

function handleMovePadPointerUp(event) {
  if (event.pointerId !== activeMovePointerId) return;
  if (typeof movePad.releasePointerCapture === 'function') {
    try {
      movePad.releasePointerCapture(event.pointerId);
    } catch (error) {
      // ignore release issues
    }
  }
  activeMovePointerId = null;
  resetTouchMoveState();
}

function updateMovePadFromEvent(event) {
  if (!movePad) return;
  const rect = movePad.getBoundingClientRect();
  const centerX = rect.left + rect.width * 0.5;
  const centerY = rect.top + rect.height * 0.5;
  let dx = event.clientX - centerX;
  let dy = event.clientY - centerY;
  const radius = rect.width * 0.5;
  const distance = Math.hypot(dx, dy);
  if (distance > radius) {
    const scale = radius / distance;
    dx *= scale;
    dy *= scale;
  }
  const normX = THREE.MathUtils.clamp(dx / radius, -1, 1);
  const normY = THREE.MathUtils.clamp(-dy / radius, -1, 1);
  touchMoveState.x = normX;
  touchMoveState.y = normY;
  updateMoveKnob();
}

function bindJumpButton() {
  if (!touchJumpButton) return;
  touchJumpButton.addEventListener('pointerdown', (event) => {
    if (!isTouchPointer(event)) {
      registerNonTouchInput();
      return;
    }
    registerTouchInput();
    event.preventDefault();
    sound.resume();
    touchButtonPointers.set(event.pointerId, 'jump');
    if (typeof touchJumpButton.setPointerCapture === 'function') {
      try {
        touchJumpButton.setPointerCapture(event.pointerId);
      } catch (error) {
        // ignore capture failures
      }
    }
    requestControlLock();
    setMovementState('Space', true);
  });

  const handleEnd = (event) => {
    if (touchButtonPointers.get(event.pointerId) !== 'jump') return;
    touchButtonPointers.delete(event.pointerId);
    if (typeof touchJumpButton.releasePointerCapture === 'function') {
      try {
        touchJumpButton.releasePointerCapture(event.pointerId);
      } catch (error) {
        // ignore release issues
      }
    }
  };

  touchJumpButton.addEventListener('pointerup', handleEnd);
  touchJumpButton.addEventListener('pointercancel', handleEnd);
}

function bindAttackButton() {
  if (!touchAttackButton) return;
  touchAttackButton.addEventListener('pointerdown', (event) => {
    if (!isTouchPointer(event)) {
      registerNonTouchInput();
      return;
    }
    registerTouchInput();
    event.preventDefault();
    sound.resume();
    touchButtonPointers.set(event.pointerId, 'attack');
    if (typeof touchAttackButton.setPointerCapture === 'function') {
      try {
        touchAttackButton.setPointerCapture(event.pointerId);
      } catch (error) {
        // ignore capture failures
      }
    }
    requestControlLock();
    attemptBreakBlock();
    clearAttackRepeat();
    attackRepeatTimer = window.setInterval(() => {
      if (!touchButtonPointers.has(event.pointerId)) {
        clearAttackRepeat();
        return;
      }
      attemptBreakBlock();
    }, 200);
  });

  const handleEnd = (event) => {
    if (touchButtonPointers.get(event.pointerId) !== 'attack') return;
    touchButtonPointers.delete(event.pointerId);
    if (typeof touchAttackButton.releasePointerCapture === 'function') {
      try {
        touchAttackButton.releasePointerCapture(event.pointerId);
      } catch (error) {
        // ignore release issues
      }
    }
    clearAttackRepeat();
  };

  touchAttackButton.addEventListener('pointerup', handleEnd);
  touchAttackButton.addEventListener('pointercancel', handleEnd);
}

function bindPlaceButton() {
  if (!touchPlaceButton) return;
  touchPlaceButton.addEventListener('pointerdown', (event) => {
    if (!isTouchPointer(event)) {
      registerNonTouchInput();
      return;
    }
    registerTouchInput();
    event.preventDefault();
    sound.resume();
    touchButtonPointers.set(event.pointerId, 'place');
    if (typeof touchPlaceButton.setPointerCapture === 'function') {
      try {
        touchPlaceButton.setPointerCapture(event.pointerId);
      } catch (error) {
        // ignore capture failures
      }
    }
    requestControlLock();
    attemptPlaceBlock();
    clearPlaceRepeat();
    placeRepeatTimer = window.setInterval(() => {
      if (!touchButtonPointers.has(event.pointerId)) {
        clearPlaceRepeat();
        return;
      }
      attemptPlaceBlock();
    }, 200);
  });

  const handleEnd = (event) => {
    if (touchButtonPointers.get(event.pointerId) !== 'place') return;
    touchButtonPointers.delete(event.pointerId);
    if (typeof touchPlaceButton.releasePointerCapture === 'function') {
      try {
        touchPlaceButton.releasePointerCapture(event.pointerId);
      } catch (error) {
        // ignore release issues
      }
    }
    clearPlaceRepeat();
  };

  touchPlaceButton.addEventListener('pointerup', handleEnd);
  touchPlaceButton.addEventListener('pointercancel', handleEnd);
}

function bindSprintButton() {
  if (!touchSprintButton) return;
  touchSprintButton.addEventListener('pointerdown', (event) => {
    if (!isTouchPointer(event)) {
      registerNonTouchInput();
      return;
    }
    registerTouchInput();
    event.preventDefault();
    sound.resume();
    touchButtonPointers.set(event.pointerId, 'sprint');
    if (typeof touchSprintButton.setPointerCapture === 'function') {
      try {
        touchSprintButton.setPointerCapture(event.pointerId);
      } catch (error) {
        // ignore capture failures
      }
    }
    requestControlLock();
    setSprintActive('touch', true);
  });

  const handleEnd = (event) => {
    if (touchButtonPointers.get(event.pointerId) !== 'sprint') return;
    touchButtonPointers.delete(event.pointerId);
    if (typeof touchSprintButton.releasePointerCapture === 'function') {
      try {
        touchSprintButton.releasePointerCapture(event.pointerId);
      } catch (error) {
        // ignore release issues
      }
    }
    setSprintActive('touch', false);
  };

  touchSprintButton.addEventListener('pointerup', handleEnd);
  touchSprintButton.addEventListener('pointercancel', handleEnd);
}

function attachCrouchButtonListener(el) {
  updateCrouchIndicator();
  el.addEventListener('pointerdown', (event) => {
    if (!isTouchPointer(event)) {
      registerNonTouchInput();
      return;
    }
    registerTouchInput();
    event.preventDefault();
    sound.resume();
    requestControlLock();
    toggleCrouch();
  });
}

function bindCrouchButton() {
  let initialized = false;
  withTouchCrouchButton((el) => {
    initialized = true;
    attachCrouchButtonListener(el);
  });
  if (!initialized && typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      withTouchCrouchButton((el) => {
        attachCrouchButtonListener(el);
      });
    }, { once: true });
  }
}

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
  const shouldCrouch = keyState.crouchHold || crouchToggleActive;
  if (shouldCrouch !== isCrouching) {
    syncCrouchState();
  }
  resolvePenetration(object.position, velocity);
  const previousPosition = object.position.clone();
  const previousGround = currentGroundHeight;
  const wasGroundedPrevFrame = wasGroundedPrevious;

  velocity.x -= velocity.x * 10 * delta;
  velocity.z -= velocity.z * 10 * delta;
  velocity.y -= gravity * delta;

  const digitalZ = Number(keyState.forward) - Number(keyState.backward);
  const digitalX = Number(keyState.right) - Number(keyState.left);
  const analogZ = gamepadState.moveY + touchMoveState.y;
  const analogX = gamepadState.moveX + touchMoveState.x;
  direction.z = digitalZ + analogZ;
  direction.x = digitalX + analogX;
  const dirLength = direction.length();
  if (dirLength > 1) {
    direction.divideScalar(dirLength);
  }

  const speedMultiplier = isCrouching ? CROUCH_SPEED_MULTIPLIER : (keyState.sprint ? sprintMultiplier : 1);
  const accel = walkAcceleration * speedMultiplier;

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

  if (isCrouching && groundedBefore) {
    const footAfter = object.position.y - playerHeight;
    const surfaceAfter = highestGroundUnder(object.position, footAfter + 0.1);
    const distanceAfter = footAfter - surfaceAfter;
    if (distanceAfter > 0.15) {
      object.position.x = prevX;
      object.position.z = prevZ;
      velocity.x = 0;
      velocity.z = 0;
    }
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
    takeoffFootHeight = Math.floor(feetBefore);
  }

  if (!wasGroundedPrevFrame && grounded) {
    const landingSurface = Number.isFinite(surface) ? surface : currentGroundHeight;
    const fallDistance = Math.max(0, takeoffFootHeight - Math.floor(landingSurface));
    const damage = Math.max(0, fallDistance - 3);
    if (damage > 0) applyDamage(damage);
  }

  if (grounded && surface > maxClimbHeight) {
    object.position.copy(previousPosition);
    velocity.x = 0;
    velocity.z = 0;
    if (velocity.y > 0) velocity.y = 0;
    currentGroundHeight = previousGround;
    takeoffGroundHeight = previousGround;
    maxClimbHeight = takeoffGroundHeight + MAX_STEP_HEIGHT;
    takeoffFootHeight = Math.floor(previousGround);
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
      takeoffFootHeight = Math.floor(currentGroundHeight);
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
    takeoffFootHeight = Math.floor(surface);
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
  weatherSystem.update(delta);
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
  requestControlLock();
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
  takeoffFootHeight = Math.floor(currentGroundHeight);
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
  const lines = [];
  const weatherState = typeof weatherSystem?.getState === 'function' ? weatherSystem.getState() : null;
  if (weatherState) {
    const weatherLabel = WEATHER_LABELS[weatherState.weather] ?? weatherState.weather;
    const timeLabel = TIME_OF_DAY_LABELS[weatherState.timeOfDay] ?? weatherState.timeOfDay;
    const flags = [];
    if (!weatherState.autoWeather) flags.push('manual weather');
    if (!weatherState.autoTime) flags.push('manual time');
    const flagSuffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    lines.push(`Weather: ${weatherLabel} · ${timeLabel}${flagSuffix}`);
  }

  const pos = controls.getObject().position;
  lines.push(`XYZ: ${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}`);
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

function setHealthPoints(points) {
  if (!Number.isFinite(points)) return clampHealth(health);
  health = clampHealth(Math.round(points));
  updateHealthUI();
  if (health <= 0) handlePlayerDeath();
  return health;
}

function handlePlayerDeath() {
  health = MAX_HEALTH;
  updateHealthUI();
  const respawnPoint = world.getRandomRespawnPoint({ attempts: 64 });
  const player = controls.getObject();
  const intendedHeight = STAND_HEIGHT;
  const groundHeight = world.getSurfaceHeightAt(respawnPoint.x, respawnPoint.z);
  const blockX = Math.floor(respawnPoint.x);
  const blockZ = Math.floor(respawnPoint.z);
  let liftBlocks = 0;
  const liftOptions = [2, 1];
  for (const candidate of liftOptions) {
    const footY = groundHeight + candidate;
    if (footY >= CHUNK_HEIGHT) continue;
    const headY = Math.floor(footY + intendedHeight - 0.001);
    if (headY >= CHUNK_HEIGHT) continue;
    if (
      world.getBlock(blockX, footY, blockZ) === BLOCK_TYPES.air &&
      world.getBlock(blockX, headY, blockZ) === BLOCK_TYPES.air
    ) {
      liftBlocks = candidate;
      break;
    }
  }
  const safeY = Math.min(groundHeight + intendedHeight + liftBlocks, CHUNK_HEIGHT - 1);
  respawnPoint.y = safeY;
  spawn.copy(respawnPoint);
  player.position.set(respawnPoint.x, respawnPoint.y, respawnPoint.z);
  spawn.set(player.position.x, player.position.y, player.position.z);
  // Clear lateral motion but give a downward nudge so the player drops to ground.
  velocity.set(0, -5, 0);
  footstepDistanceAccumulator = 0;
  currentGroundHeight = groundHeight;
  takeoffGroundHeight = groundHeight;
  maxClimbHeight = takeoffGroundHeight + MAX_STEP_HEIGHT;
  takeoffFootHeight = Math.floor(groundHeight);
  lastSafePosition.copy(player.position);
  wasGroundedPrevious = true;
  canJump = true;
  crouchToggleActive = false;
  keyState.crouchHold = false;
  isCrouching = false;
  playerHeight = STAND_HEIGHT;
  updateCrouchIndicator();
  camera.getWorldDirection(cameraDirection);
  world.updatePlayerPosition(player.position, cameraDirection);
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
  const usedAnalog = Math.abs(axis0) > GAMEPAD_MOVE_DEADZONE || Math.abs(axis1) > GAMEPAD_MOVE_DEADZONE || Math.abs(axis2) > GAMEPAD_LOOK_DEADZONE || Math.abs(axis3) > GAMEPAD_LOOK_DEADZONE;
  const usedButton = buttons.some((button) => button?.pressed || (button?.value ?? 0) > GAMEPAD_BUTTON_THRESHOLD);
  if (usedAnalog || usedButton) registerNonTouchInput();
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
      requestControlLock();
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
      requestControlLock();
    }
  });

  handleButton(10, () => {
    setSprintActive('gamepad', true);
  }, () => {
    setSprintActive('gamepad', false);
  });

  handleButton(1, () => {
    if (!worldReady || !controls.isLocked) return;
    toggleCrouch();
  });

  const breakAction = () => {
    if (!controls.isLocked) {
      if (worldReady && !loadingInProgress) requestControlLock();
      return;
    }
    attemptBreakBlock();
  };

  const placeAction = () => {
    if (!controls.isLocked) {
      if (worldReady && !loadingInProgress) requestControlLock();
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
