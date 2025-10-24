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

const WEATHER_CONFIG = {
  [WEATHER_TYPES.SUNNY]: {
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
    lightningFrequency: 0.28,
    day: {
      sky: 0x303a45,
      fog: 0x303a45,
      fogNear: 45,
      fogFar: 120,
      sunIntensity: 0.42,
      sunColor: 0xdde1f0,
      hemisphereIntensity: 0.46,
      hemiSky: 0xb0b8c4,
      hemiGround: 0x222a30,
    },
    night: {
      sky: 0x121821,
      fog: 0x121821,
      fogNear: 24,
      fogFar: 90,
      sunIntensity: 0.08,
      sunColor: 0xb7c2d6,
      hemisphereIntensity: 0.22,
      hemiSky: 0x1d2936,
      hemiGround: 0x090d12,
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
  constructor({ scene, sun, hemisphere }) {
    this.scene = scene;
    this.sun = sun;
    this.hemisphere = hemisphere;

    this.autoWeatherEnabled = true;
    this.autoTimeEnabled = true;
    this.currentWeather = WEATHER_TYPES.SUNNY;
    this.currentTimeOfDay = TIME_OF_DAY.DAY;

    this.nextWeatherChangeAt = 0;
    this.nextTimeOfDayChangeAt = 0;

    this.currentSkyColor = color3FromHex(WEATHER_CONFIG.sunny?.day.sky ?? 0x87ceeb);
    this.targetSkyColor = this.currentSkyColor.clone();
    this.currentFogColor = color3FromHex(WEATHER_CONFIG.sunny?.day.fog ?? 0xaed9ff);
    this.targetFogColor = this.currentFogColor.clone();
    this.currentSunColor = color3FromHex(0xffffff);
    this.targetSunColor = this.currentSunColor.clone();
    this.currentHemisphereSky = this.hemisphere?.diffuse?.clone?.() ?? new BABYLON.Color3(1, 1, 1);
    this.targetHemisphereSky = this.currentHemisphereSky.clone();
    this.currentHemisphereGround = this.hemisphere?.groundColor?.clone?.() ?? new BABYLON.Color3(0.4, 0.4, 0.4);
    this.targetHemisphereGround = this.currentHemisphereGround.clone();

    this.currentSunIntensity = this.sun?.intensity ?? 1;
    this.targetSunIntensity = this.currentSunIntensity;
    this.currentHemisphereIntensity = this.hemisphere?.intensity ?? 0.5;
    this.targetHemisphereIntensity = this.currentHemisphereIntensity;
    this.currentFogNear = this.scene.fogStart ?? 85;
    this.currentFogFar = this.scene.fogEnd ?? 300;
    this.targetFogNear = this.currentFogNear;
    this.targetFogFar = this.currentFogFar;

    this.scene.clearColor = new BABYLON.Color4(this.currentSkyColor.r, this.currentSkyColor.g, this.currentSkyColor.b, 1);
    this.scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
    this.scene.fogColor = this.currentFogColor.clone();
    this.scene.fogStart = this.currentFogNear;
    this.scene.fogEnd = this.currentFogFar;

    this._updateTargetsFromState(true);
    this.scheduleNextWeatherChange();
    this.scheduleNextTimeOfDayChange();
  }

  update(deltaSeconds) {
    this._updateTimers();
    this._updateEnvironment(deltaSeconds);
  }

  getState() {
    return {
      weather: this.currentWeather,
      timeOfDay: this.currentTimeOfDay,
      autoWeather: this.autoWeatherEnabled,
      autoTime: this.autoTimeEnabled,
    };
  }

  setWeather(weather, { force = false, instant = false } = {}) {
    if (!WEATHER_CONFIG[weather]) return;
    if (!force && weather === this.currentWeather) {
      if (this.autoWeatherEnabled) this.scheduleNextWeatherChange();
      return;
    }
    this.currentWeather = weather;
    this._updateTargetsFromState(instant);
    if (this.autoWeatherEnabled) this.scheduleNextWeatherChange();
    else this.nextWeatherChangeAt = Number.POSITIVE_INFINITY;
  }

  setTimeOfDay(timeOfDay, { force = false, instant = false } = {}) {
    const normalized = timeOfDay === TIME_OF_DAY.NIGHT ? TIME_OF_DAY.NIGHT : TIME_OF_DAY.DAY;
    if (!force && normalized === this.currentTimeOfDay) {
      if (this.autoTimeEnabled) this.scheduleNextTimeOfDayChange();
      return;
    }
    this.currentTimeOfDay = normalized;
    this._updateTargetsFromState(instant);
    if (this.autoTimeEnabled) this.scheduleNextTimeOfDayChange();
    else this.nextTimeOfDayChangeAt = Number.POSITIVE_INFINITY;
  }

  setAutoWeather(enabled) {
    this.autoWeatherEnabled = Boolean(enabled);
    if (this.autoWeatherEnabled) this.scheduleNextWeatherChange();
  }

  setAutoTime(enabled) {
    this.autoTimeEnabled = Boolean(enabled);
    if (this.autoTimeEnabled) this.scheduleNextTimeOfDayChange();
  }

  scheduleNextWeatherChange() {
    const [min, max] = WEATHER_DURATION_RANGE_MS;
    const delay = min + Math.random() * (max - min);
    this.nextWeatherChangeAt = performance.now() + delay;
  }

  scheduleNextTimeOfDayChange() {
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
    if (this.scene) {
      this.scene.clearColor = new BABYLON.Color4(this.currentSkyColor.r, this.currentSkyColor.g, this.currentSkyColor.b, 1);
      this.scene.fogColor = this.currentFogColor.clone();
      this.scene.fogStart = this.currentFogNear;
      this.scene.fogEnd = this.currentFogFar;
    }
    if (this.sun) {
      this.sun.intensity = this.currentSunIntensity;
      if (this.sun.diffuse) this.sun.diffuse = this.currentSunColor.clone();
      if (this.sun.specular) this.sun.specular = this.currentSunColor.clone();
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
}

export { WEATHER_TYPES, WEATHER_LABELS, TIME_OF_DAY, TIME_OF_DAY_LABELS };
