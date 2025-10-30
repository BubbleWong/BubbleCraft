const WEATHER_TYPES = {
  SUNNY: 'sunny',
  RAIN: 'rain',
  SNOW: 'snow',
  THUNDERSTORM: 'thunderstorm',
};

const WEATHER_LABELS = {
  [WEATHER_TYPES.SUNNY]: 'Clear',
  [WEATHER_TYPES.RAIN]: 'Rain',
  [WEATHER_TYPES.SNOW]: 'Snow',
  [WEATHER_TYPES.THUNDERSTORM]: 'Thunderstorm',
};

const TIME_OF_DAY = {
  DAY: 'day',
  NIGHT: 'night',
};

const TIME_OF_DAY_LABELS = {
  [TIME_OF_DAY.DAY]: 'Day',
  [TIME_OF_DAY.NIGHT]: 'Night',
};

const WEATHER_SELECTION = [
  { type: WEATHER_TYPES.SUNNY, weight: 0.62 },
  { type: WEATHER_TYPES.RAIN, weight: 0.25 },
  { type: WEATHER_TYPES.SNOW, weight: 0.08 },
  { type: WEATHER_TYPES.THUNDERSTORM, weight: 0.05 },
];

const WEATHER_DURATION_RANGE_MS = [120_000, 240_000];
const DAY_HALF_CYCLE_MS = 600_000;
const WEATHER_TRANSITION_SPEED = 0.35;

const PRECIPITATION_COUNT = 900;
const PRECIPITATION_WIDTH = 55;
const PRECIPITATION_HEIGHT = 45;
const PRECIPITATION_RESET_PADDING = 4;
const PRECIPITATION_VERTICAL_OFFSET = 10;
const LIGHTNING_RANGE = 220;
const LIGHTNING_FLASH_DECAY = 2.6;
const LIGHTNING_LIGHT_DECAY = 8;
const LIGHTNING_COOLDOWN_RANGE = [1.2, 3.6];
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

function color3FromHex(hex) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return new BABYLON.Color3(r, g, b);
}

export class WeatherSystem {
  constructor({ scene, sun, hemisphere, player = null }) {
    this.scene = scene;
    this.sun = sun;
    this.hemisphere = hemisphere;
    this.player = player ?? null;

    this.autoWeatherEnabled = true;
    this.autoTimeEnabled = true;
    this.currentWeather = WEATHER_TYPES.SUNNY;
    this.currentTimeOfDay = TIME_OF_DAY.DAY;

    const initialConfig = WEATHER_CONFIG[this.currentWeather];
    const initialPhase = initialConfig.day;

    this.nextWeatherChangeAt = Number.POSITIVE_INFINITY;
    this.nextTimeOfDayChangeAt = Number.POSITIVE_INFINITY;

    this.currentSkyColor = color3FromHex(initialPhase.sky);
    this.targetSkyColor = this.currentSkyColor.clone();
    this.currentFogColor = color3FromHex(initialPhase.fog);
    this.targetFogColor = this.currentFogColor.clone();
    this.currentSunColor = color3FromHex(initialPhase.sunColor);
    this.targetSunColor = this.currentSunColor.clone();
    this.currentHemisphereSky = this.hemisphere?.diffuse?.clone?.() ?? new BABYLON.Color3(1, 1, 1);
    this.targetHemisphereSky = this.currentHemisphereSky.clone();
    this.currentHemisphereGround = this.hemisphere?.groundColor?.clone?.() ?? new BABYLON.Color3(0.4, 0.4, 0.4);
    this.targetHemisphereGround = this.currentHemisphereGround.clone();

    this.currentSunIntensity = this.sun?.intensity ?? initialPhase.sunIntensity;
    this.targetSunIntensity = this.currentSunIntensity;
    this.currentHemisphereIntensity = this.hemisphere?.intensity ?? initialPhase.hemisphereIntensity;
    this.targetHemisphereIntensity = this.currentHemisphereIntensity;
    this.currentFogNear = initialPhase.fogNear;
    this.currentFogFar = initialPhase.fogFar;
    this.targetFogNear = this.currentFogNear;
    this.targetFogFar = this.currentFogFar;

    this.scene.clearColor = new BABYLON.Color4(this.currentSkyColor.r, this.currentSkyColor.g, this.currentSkyColor.b, 1);
    this.scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
    this.scene.fogColor = this.currentFogColor.clone();
    this.scene.fogStart = this.currentFogNear;
    this.scene.fogEnd = this.currentFogFar;

    this.flashColor = color3FromHex(0xf6fbff);
    this.flashIntensity = 0;
    this.lightningCooldown = 0;
    this.lightningLight = new BABYLON.PointLight('weather-lightning', new BABYLON.Vector3(0, PRECIPITATION_VERTICAL_OFFSET + 25, 0), this.scene);
    this.lightningLight.intensity = 0;
    this.lightningLight.range = LIGHTNING_RANGE;
    this.lightningLight.diffuse = color3FromHex(0xfefbff);
    this.lightningLight.specular = this.lightningLight.diffuse.clone();
    this.lightningLight.falloffType = BABYLON.Light.FALLOFF_STANDARD;

    this._particleTextures = Object.create(null);
    this._scratchColorA = new BABYLON.Color3();
    this._scratchColorB = new BABYLON.Color3();
    this._scratchColorC = new BABYLON.Color3();
    this._scratchVec = new BABYLON.Vector3();
    this._color4A = new BABYLON.Color4();
    this._color4B = new BABYLON.Color4();
    this._setupPrecipitationSystems();
    this.activePrecipitation = null;

    this._updateTargetsFromState(true);
    this.configurePrecipitation(initialConfig);
    this.scheduleNextWeatherChange();
    this.scheduleNextTimeOfDayChange();
    this.exposeDebugHelpers();
  }

  update(deltaSeconds) {
    this._updateTimers();
    this._updateLightning(deltaSeconds);
    this._updateEnvironment(deltaSeconds);
    this._updatePrecipitation(deltaSeconds);
    this._dissipateLightning(deltaSeconds);
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

  setWeather(weather, { force = false, instant = false, autoWeather = null } = {}) {
    if (!WEATHER_CONFIG[weather]) return;
    if (!force && weather === this.currentWeather) {
      if (this.autoWeatherEnabled) this.scheduleNextWeatherChange();
      return;
    }
    this.currentWeather = weather;
    if (typeof autoWeather === 'boolean') {
      this.autoWeatherEnabled = autoWeather;
    }
    this._updateTargetsFromState(instant);
    this.configurePrecipitation(WEATHER_CONFIG[weather]);
    if (this.autoWeatherEnabled) this.scheduleNextWeatherChange();
    else this.nextWeatherChangeAt = Number.POSITIVE_INFINITY;
  }

  setTimeOfDay(timeOfDay, { force = false, instant = false, autoTime = null } = {}) {
    const normalized = timeOfDay === TIME_OF_DAY.NIGHT ? TIME_OF_DAY.NIGHT : TIME_OF_DAY.DAY;
    if (!force && normalized === this.currentTimeOfDay) {
      if (this.autoTimeEnabled) this.scheduleNextTimeOfDayChange();
      return;
    }
    this.currentTimeOfDay = normalized;
    if (typeof autoTime === 'boolean') {
      this.autoTimeEnabled = autoTime;
    }
    this._updateTargetsFromState(instant);
    if (this.autoTimeEnabled) this.scheduleNextTimeOfDayChange();
    else this.nextTimeOfDayChangeAt = Number.POSITIVE_INFINITY;
  }

  setAutoWeather(enabled) {
    this.autoWeatherEnabled = Boolean(enabled);
    if (this.autoWeatherEnabled) this.scheduleNextWeatherChange();
    else this.nextWeatherChangeAt = Number.POSITIVE_INFINITY;
  }

  setAutoTime(enabled) {
    this.autoTimeEnabled = Boolean(enabled);
    if (this.autoTimeEnabled) this.scheduleNextTimeOfDayChange();
    else this.nextTimeOfDayChangeAt = Number.POSITIVE_INFINITY;
  }

  scheduleNextWeatherChange() {
    if (!this.autoWeatherEnabled) {
      this.nextWeatherChangeAt = Number.POSITIVE_INFINITY;
      return;
    }
    const [min, max] = WEATHER_DURATION_RANGE_MS;
    const delay = min + Math.random() * (max - min);
    this.nextWeatherChangeAt = performance.now() + delay;
  }

  scheduleNextTimeOfDayChange() {
    if (!this.autoTimeEnabled) {
      this.nextTimeOfDayChangeAt = Number.POSITIVE_INFINITY;
      return;
    }
    this.nextTimeOfDayChangeAt = performance.now() + DAY_HALF_CYCLE_MS;
  }

  _pickWeightedWeather() {
    const totalWeight = WEATHER_SELECTION.reduce((sum, entry) => sum + entry.weight, 0);
    const target = Math.random() * totalWeight;
    let cumulative = 0;
    for (const entry of WEATHER_SELECTION) {
      cumulative += entry.weight;
      if (target <= cumulative) return entry.type;
    }
    return WEATHER_TYPES.SUNNY;
  }

  _updateTimers() {
    const now = performance.now();
    if (this.autoWeatherEnabled && now >= this.nextWeatherChangeAt) {
      this.setWeather(this._pickWeightedWeather());
    }
    if (this.autoTimeEnabled && now >= this.nextTimeOfDayChangeAt) {
      const nextTime = this.currentTimeOfDay === TIME_OF_DAY.DAY ? TIME_OF_DAY.NIGHT : TIME_OF_DAY.DAY;
      this.setTimeOfDay(nextTime);
    }
  }

  _updateLightning(deltaSeconds) {
    const config = WEATHER_CONFIG[this.currentWeather];
    const frequency = config?.lightningFrequency ?? 0;
    if (!frequency || frequency <= 0) {
      this.lightningCooldown = 0;
      return;
    }
    this.lightningCooldown -= deltaSeconds;
    if (this.lightningCooldown <= 0) {
      const triggerChance = Math.min(1, frequency * deltaSeconds);
      if (Math.random() < triggerChance) {
        this._triggerLightning();
      } else {
        this.lightningCooldown = this._randomRange(LIGHTNING_COOLDOWN_RANGE[0], LIGHTNING_COOLDOWN_RANGE[1]);
      }
    }
  }

  _dissipateLightning(deltaSeconds) {
    if (this.flashIntensity > 0) {
      this.flashIntensity = Math.max(0, this.flashIntensity - deltaSeconds * LIGHTNING_FLASH_DECAY);
    }
    if (this.lightningLight?.intensity > 0) {
      this.lightningLight.intensity = Math.max(0, this.lightningLight.intensity - deltaSeconds * LIGHTNING_LIGHT_DECAY);
    }
  }

  _triggerLightning() {
    const position = this._getPlayerPosition();
    if (position && this.lightningLight) {
      this.lightningLight.position.set(
        position.x + this._randomRange(-60, 60),
        position.y + 20 + Math.random() * 25,
        position.z + this._randomRange(-60, 60),
      );
    }
    if (this.lightningLight) {
      this.lightningLight.intensity = 10 + Math.random() * 4;
    }
    this.flashIntensity = 1;
    this.lightningCooldown = this._randomRange(LIGHTNING_COOLDOWN_RANGE[0], LIGHTNING_COOLDOWN_RANGE[1]);
  }

  _updatePrecipitation(deltaSeconds) {
    if (!this.activePrecipitation?.emitter) return;
    const position = this._getPlayerPosition();
    if (!position) return;
    this.activePrecipitation.emitter.position.copyFrom(position);
    this.activePrecipitation.emitter.position.y += PRECIPITATION_VERTICAL_OFFSET;
  }

  configurePrecipitation(config) {
    const settings = config?.precipitation ?? null;
    if (!settings) {
      this._setActivePrecipitation(null);
      return;
    }

    const isSnow = settings.type === 'snow';
    const system = isSnow ? this.snowSystem : this.rainSystem;
    const emitter = isSnow ? this.snowEmitter : this.rainEmitter;
    if (!system || !emitter) return;

    const drift = settings.drift ?? { x: [-1, 1], z: [-1, 1] };
    const [minSpeed, maxSpeed] = settings.speedRange ?? [10, 18];
    const boxEmitter = system.particleEmitterType;
    if (boxEmitter && typeof boxEmitter.minEmitBox !== 'undefined') {
      const halfWidth = PRECIPITATION_WIDTH * 0.5;
      boxEmitter.minEmitBox.set(-halfWidth, 0, -halfWidth);
      boxEmitter.maxEmitBox.set(halfWidth, PRECIPITATION_HEIGHT, halfWidth);
      boxEmitter.direction1 = new BABYLON.Vector3(drift.x[0], -1, drift.z[0]);
      boxEmitter.direction2 = new BABYLON.Vector3(drift.x[1], -1, drift.z[1]);
    }

    system.minEmitPower = minSpeed;
    system.maxEmitPower = maxSpeed;
    const lifeMin = PRECIPITATION_HEIGHT / Math.max(maxSpeed, 0.1);
    const lifeMax = (PRECIPITATION_HEIGHT + PRECIPITATION_RESET_PADDING) / Math.max(minSpeed, 0.1);
    system.minLifeTime = lifeMin;
    system.maxLifeTime = lifeMax;

    const baseSize = settings.size ?? (isSnow ? 0.3 : 0.12);
    system.minSize = baseSize * 0.8;
    system.maxSize = baseSize * 1.2;

    const color = color3FromHex(settings.color ?? 0xffffff);
    const alpha = settings.opacity ?? 0.85;
    this._color4A.set(color.r, color.g, color.b, alpha);
    this._color4B.set(color.r, color.g, color.b, alpha * 0.75);
    system.color1 = this._color4A.clone();
    system.color2 = this._color4B.clone();
    system.colorDead = new BABYLON.Color4(color.r, color.g, color.b, 0);
    system.particleTexture = this._getParticleTexture(isSnow ? 'snow' : 'rain');

    this._setActivePrecipitation({ system, emitter, settings });
  }

  _setActivePrecipitation(target) {
    if (this.activePrecipitation?.system && this.activePrecipitation.system !== target?.system) {
      this.activePrecipitation.system.stop();
      this.activePrecipitation.system.reset();
    }
    if (!target) {
      this.activePrecipitation = null;
      this.rainSystem?.stop();
      this.snowSystem?.stop();
      return;
    }
    this.activePrecipitation = target;
    target.system.stop();
    target.system.reset();
    target.system.start();
    this._updatePrecipitation(0);
  }

  _updateEnvironment(deltaSeconds) {
    const t = Math.min(1, deltaSeconds * WEATHER_TRANSITION_SPEED);
    BABYLON.Color3.LerpToRef(this.currentSkyColor, this.targetSkyColor, t, this.currentSkyColor);
    BABYLON.Color3.LerpToRef(this.currentFogColor, this.targetFogColor, t, this.currentFogColor);
    BABYLON.Color3.LerpToRef(this.currentSunColor, this.targetSunColor, t, this.currentSunColor);
    BABYLON.Color3.LerpToRef(this.currentHemisphereSky, this.targetHemisphereSky, t, this.currentHemisphereSky);
    BABYLON.Color3.LerpToRef(this.currentHemisphereGround, this.targetHemisphereGround, t, this.currentHemisphereGround);

    this.currentSunIntensity = BABYLON.Scalar.Lerp(this.currentSunIntensity, this.targetSunIntensity, t);
    this.currentHemisphereIntensity = BABYLON.Scalar.Lerp(this.currentHemisphereIntensity, this.targetHemisphereIntensity, t);
    this.currentFogNear = BABYLON.Scalar.Lerp(this.currentFogNear, this.targetFogNear, t);
    this.currentFogFar = BABYLON.Scalar.Lerp(this.currentFogFar, this.targetFogFar, t);

    this._applyToScene();
  }

  _applyToScene() {
    const flashFactor = Math.min(1, this.flashIntensity);
    const skyColor = flashFactor > 0
      ? BABYLON.Color3.LerpToRef(this.currentSkyColor, this.flashColor, flashFactor * 0.6, this._scratchColorA)
      : this.currentSkyColor;
    const fogColor = flashFactor > 0
      ? BABYLON.Color3.LerpToRef(this.currentFogColor, this.flashColor, flashFactor * 0.4, this._scratchColorB)
      : this.currentFogColor;
    const sunColor = flashFactor > 0
      ? BABYLON.Color3.LerpToRef(this.currentSunColor, this.flashColor, flashFactor * 0.4, this._scratchColorC)
      : this.currentSunColor;

    if (this.scene) {
      this.scene.clearColor = new BABYLON.Color4(skyColor.r, skyColor.g, skyColor.b, 1);
      this.scene.fogColor = fogColor.clone();
      this.scene.fogStart = this.currentFogNear;
      this.scene.fogEnd = this.currentFogFar;
    }
    if (this.sun) {
      this.sun.intensity = this.currentSunIntensity + flashFactor * 0.8;
      if (this.sun.diffuse) this.sun.diffuse = sunColor.clone();
      if (this.sun.specular) this.sun.specular = sunColor.clone();
    }
    if (this.hemisphere) {
      this.hemisphere.intensity = this.currentHemisphereIntensity;
      if (this.hemisphere.diffuse) this.hemisphere.diffuse = this.currentHemisphereSky.clone();
      if (this.hemisphere.groundColor) this.hemisphere.groundColor = this.currentHemisphereGround.clone();
    }
  }

  _updateTargetsFromState(instant = false) {
    const config = WEATHER_CONFIG[this.currentWeather] ?? WEATHER_CONFIG[WEATHER_TYPES.SUNNY];
    const phase = this.currentTimeOfDay === TIME_OF_DAY.NIGHT ? config.night : config.day;

    this.targetSkyColor = color3FromHex(phase.sky);
    this.targetFogColor = color3FromHex(phase.fog);
    this.targetSunColor = color3FromHex(phase.sunColor);
    this.targetHemisphereSky = color3FromHex(phase.hemiSky);
    this.targetHemisphereGround = color3FromHex(phase.hemiGround);
    this.targetSunIntensity = phase.sunIntensity;
    this.targetHemisphereIntensity = phase.hemisphereIntensity;
    this.targetFogNear = phase.fogNear;
    this.targetFogFar = phase.fogFar;

    if (instant) {
      this.currentSkyColor = this.targetSkyColor.clone();
      this.currentFogColor = this.targetFogColor.clone();
      this.currentSunColor = this.targetSunColor.clone();
      this.currentHemisphereSky = this.targetHemisphereSky.clone();
      this.currentHemisphereGround = this.targetHemisphereGround.clone();
      this.currentSunIntensity = this.targetSunIntensity;
      this.currentHemisphereIntensity = this.targetHemisphereIntensity;
      this.currentFogNear = this.targetFogNear;
      this.currentFogFar = this.targetFogFar;
      this._applyToScene();
    }
  }

  _setupPrecipitationSystems() {
    if (!this.scene) return;
    this.precipRoot = new BABYLON.TransformNode('weather-precip-root', this.scene);
    this.rainEmitter = new BABYLON.TransformNode('weather-rain-emitter', this.scene);
    this.rainEmitter.parent = this.precipRoot;
    this.snowEmitter = new BABYLON.TransformNode('weather-snow-emitter', this.scene);
    this.snowEmitter.parent = this.precipRoot;

    this.rainSystem = this._createParticleSystem('rain', PRECIPITATION_COUNT);
    if (this.rainSystem) {
      this.rainSystem.emitter = this.rainEmitter;
      this.rainSystem.stop();
    }

    this.snowSystem = this._createParticleSystem('snow', PRECIPITATION_COUNT);
    if (this.snowSystem) {
      this.snowSystem.emitter = this.snowEmitter;
      this.snowSystem.stop();
    }
  }

  _createParticleSystem(type, capacity) {
    if (!this.scene) return null;
    const engine = this.scene?.getEngine?.() ?? null;
    let supportsGPU = false;
    if (typeof BABYLON.GPUParticleSystem !== 'undefined') {
      const supportValue = BABYLON.GPUParticleSystem.IsSupported;
      if (typeof supportValue === 'function') {
        supportsGPU = engine ? supportValue(engine) : false;
      } else if (typeof supportValue === 'boolean') {
        supportsGPU = supportValue;
      } else {
        supportsGPU = true;
      }
    }
    const system = supportsGPU
      ? new BABYLON.GPUParticleSystem(`weather-${type}`, { capacity }, this.scene)
      : new BABYLON.ParticleSystem(`weather-${type}`, capacity, this.scene);

    system.particleTexture = this._getParticleTexture(type);
    system.color1 = new BABYLON.Color4(1, 1, 1, 1);
    system.color2 = new BABYLON.Color4(1, 1, 1, 1);
    system.colorDead = new BABYLON.Color4(1, 1, 1, 0);
    system.minSize = type === 'snow' ? 0.24 : 0.08;
    system.maxSize = type === 'snow' ? 0.36 : 0.14;
    system.minLifeTime = 1.2;
    system.maxLifeTime = 1.8;
    system.emitRate = capacity * 4;
    system.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    system.gravity = new BABYLON.Vector3(0, 0, 0);
    system.updateSpeed = 0.02;

    const boxEmitter = new BABYLON.BoxParticleEmitter();
    const halfWidth = PRECIPITATION_WIDTH * 0.5;
    boxEmitter.minEmitBox = new BABYLON.Vector3(-halfWidth, 0, -halfWidth);
    boxEmitter.maxEmitBox = new BABYLON.Vector3(halfWidth, PRECIPITATION_HEIGHT, halfWidth);
    boxEmitter.direction1 = new BABYLON.Vector3(-0.5, -1, -0.5);
    boxEmitter.direction2 = new BABYLON.Vector3(0.5, -1, 0.5);
    system.particleEmitterType = boxEmitter;

    system.stop();
    system.reset();
    return system;
  }

  _getParticleTexture(type) {
    if (this._particleTextures[type]) return this._particleTextures[type];
    const size = 32;
    const texture = new BABYLON.DynamicTexture(`weather-${type}-tex`, { width: size, height: size }, this.scene, true);
    const ctx = texture.getContext();
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(255, 255, 255, 0)';
    ctx.fillRect(0, 0, size, size);

    if (type === 'rain') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = size * 0.2;
      ctx.beginPath();
      ctx.moveTo(size * 0.5, 0);
      ctx.lineTo(size * 0.5, size);
      ctx.stroke();
    } else {
      const radius = size * 0.3;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(size * 0.5, size * 0.5, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    texture.update(false);
    texture.hasAlpha = true;
    texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    this._particleTextures[type] = texture;
    return texture;
  }

  _getPlayerPosition() {
    if (this.player?.mesh?.position) {
      return this._scratchVec.copyFrom(this.player.mesh.position);
    }
    if (this.scene?.activeCamera?.position) {
      return this._scratchVec.copyFrom(this.scene.activeCamera.position);
    }
    return null;
  }

  _randomRange(min, max) {
    return min + Math.random() * (max - min);
  }

  setPlayer(player) {
    this.player = player ?? null;
  }

  exposeDebugHelpers() {
    if (typeof window === 'undefined') return;
    const api = (options = {}) => {
      if (options.resume === true) {
        this.setAutoWeather(true);
        this.setAutoTime(true);
        return this.getState();
      }

      if (typeof options.autoWeather === 'boolean') {
        this.setAutoWeather(options.autoWeather);
      }
      if (typeof options.autoTime === 'boolean') {
        this.setAutoTime(options.autoTime);
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
      'setWeatherDebug({ weather: "rain", timeOfDay: "night", instant: true })\n' +
      'Options: weather="sunny|rain|snow|thunderstorm", timeOfDay="day|night",\n' +
      'autoWeather=<bool>, autoTime=<bool>, instant=<bool>, resume=true.'
    );
    Object.defineProperty(window, 'setWeatherDebug', {
      value: api,
      configurable: true,
      writable: false,
    });
  }
}

export { WEATHER_TYPES, WEATHER_LABELS, TIME_OF_DAY, TIME_OF_DAY_LABELS };
