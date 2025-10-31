import { BLOCK_TYPES } from '../../constants.js';

const DEFAULT_MASTER_GAIN = 0.7;
const DEFAULT_FX_GAIN = 0.85;
const DEFAULT_MUSIC_GAIN = 0.22;
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

const BGM_URL = new URL('../../assets/sounds/bgm-sunny.mp3', import.meta.url).href;

export class SoundManager {
  constructor({ eventBus = null } = {}) {
    this.eventBus = eventBus;
    this.context = null;
    this.masterGain = null;
    this.fxGain = null;
    this.musicGain = null;

    this.bgmBuffer = null;
    this.bgmSource = null;
    this.bgmPlaying = false;
    this.bgmStarted = false;
    this.bgmStartTime = 0;
    this.bgmOffset = 0;

    this.resumeRequested = false;
  }

  async ensureContext() {
    if (this.context) return this.context;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      this.context = new AudioCtx();
    } catch (error) {
      console.warn('Failed to create AudioContext:', error);
      this.context = null;
      return null;
    }
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = DEFAULT_MASTER_GAIN;
    this.masterGain.connect(this.context.destination);

    this.fxGain = this.context.createGain();
    this.fxGain.gain.value = DEFAULT_FX_GAIN;
    this.fxGain.connect(this.masterGain);

    this.musicGain = this.context.createGain();
    this.musicGain.gain.value = DEFAULT_MUSIC_GAIN;
    this.musicGain.connect(this.masterGain);
    return this.context;
  }

  async resume() {
    this.resumeRequested = true;
    const ctx = await this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (error) {
        if (error?.name !== 'SecurityError') {
          console.warn('Failed to resume audio context:', error);
        }
      }
    }
  }

  async loadBgmBuffer() {
    if (this.bgmBuffer) return this.bgmBuffer;
    const ctx = await this.ensureContext();
    if (!ctx) return null;
    try {
      const response = await fetch(BGM_URL);
      if (!response.ok) {
        throw new Error(`Failed to load BGM: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      this.bgmBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch (error) {
      console.warn('Unable to decode background music:', error);
      this.bgmBuffer = null;
    }
    return this.bgmBuffer;
  }

  prepareBgm() {
    return this.loadBgmBuffer();
  }

  stopBgmInternal() {
    if (this.bgmSource) {
      try {
        this.bgmSource.onended = null;
        this.bgmSource.stop();
      } catch (error) {
        // ignore
      }
      try {
        this.bgmSource.disconnect();
      } catch (error) {
        // ignore
      }
    }
    this.bgmSource = null;
  }

  async startBgm(offset = null) {
    const ctx = await this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (error) {
        if (error?.name !== 'SecurityError') {
          console.warn('Failed to resume audio context:', error);
        }
      }
    }
    await this.loadBgmBuffer();
    if (!this.bgmBuffer || this.bgmPlaying) return;

    const duration = this.bgmBuffer.duration || 0;
    let startOffset = this.bgmOffset;
    if (typeof offset === 'number') startOffset = offset;
    if (duration > 0) {
      startOffset = ((startOffset % duration) + duration) % duration;
    } else {
      startOffset = 0;
    }

    this.stopBgmInternal();
    const source = ctx.createBufferSource();
    source.buffer = this.bgmBuffer;
    source.loop = true;
    source.connect(this.musicGain ?? this.masterGain ?? ctx.destination);
    try {
      source.start(0, startOffset);
    } catch (error) {
      console.warn('Unable to start BGM:', error);
      return;
    }
    this.bgmSource = source;
    this.bgmOffset = startOffset;
    this.bgmStartTime = ctx.currentTime - startOffset;
    this.bgmStarted = true;
    this.bgmPlaying = true;
    source.onended = () => {
      if (this.bgmPlaying) {
        this.bgmPlaying = false;
      }
    };
  }

  pauseBgm() {
    if (!this.context) return;
    if (this.bgmPlaying && this.bgmBuffer) {
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
    if (!this.resumeRequested) return;
    if (this.bgmPlaying) return;
    if (!this.bgmStarted) {
      await this.startBgm(0);
      return;
    }
    await this.startBgm();
  }

  playFootstep(blockType) {
    const key = Number.isFinite(blockType) ? blockType : 'default';
    const profile = MATERIAL_SOUND_PROFILE[key] ?? MATERIAL_SOUND_PROFILE.default;
    this._playFootstepNoise(profile);
  }

  playJump() {
    this._playJumpTone();
  }

  playBlockBreak(blockType) {
    const key = Number.isFinite(blockType) ? blockType : 'default';
    const profile = MATERIAL_SOUND_PROFILE[key] ?? MATERIAL_SOUND_PROFILE.default;
    this._playBlockNoise(profile);
  }

  playBlockPlace(blockType) {
    const key = Number.isFinite(blockType) ? blockType : 'default';
    const profile = MATERIAL_SOUND_PROFILE[key] ?? MATERIAL_SOUND_PROFILE.default;
    this._playPlaceTone(profile);
  }

  dispose() {
    this.pauseBgm();
    if (this.context) {
      try {
        this.context.close();
      } catch (error) {
        // ignore
      }
    }
    this.context = null;
    this.masterGain = null;
    this.fxGain = null;
    this.musicGain = null;
    this.bgmBuffer = null;
    this.resumeRequested = false;
  }

  _playFootstepNoise(profile) {
    void this._withContext(async (ctx) => {
      const buffer = this._makeNoiseBuffer(ctx, 0.25);
      if (!buffer) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = profile.stepCutoff + Math.random() * 200 - 100;
      filter.Q.value = 1.2;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.fxGain ?? this.masterGain ?? ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0, now);
      gain.gain.linearRampToValueAtTime(0.35, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      src.start(now);
      src.stop(now + 0.25);
    });
  }

  _playJumpTone() {
    void this._withContext(async (ctx) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.frequency.value = 420;
      osc.connect(gain).connect(this.fxGain ?? this.masterGain ?? ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0, now);
      gain.gain.linearRampToValueAtTime(0.25, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.002, now + 0.32);
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.35);
    });
  }

  _playBlockNoise(profile) {
    void this._withContext(async (ctx) => {
      const buffer = this._makeNoiseBuffer(ctx, 0.35);
      if (!buffer) return;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = profile.breakCutoff + Math.random() * 250 - 120;
      filter.Q.value = profile.breakQ ?? 1;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      noise.connect(filter).connect(gain).connect(this.fxGain ?? this.masterGain ?? ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0, now);
      gain.gain.linearRampToValueAtTime(0.45, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      noise.start(now);
      noise.stop(now + 0.35);
    });
  }

  _playPlaceTone(profile) {
    void this._withContext(async (ctx) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const baseFreq = profile.placeFreq ?? 420;
      osc.frequency.value = baseFreq;
      osc.connect(gain).connect(this.fxGain ?? this.masterGain ?? ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0, now);
      gain.gain.linearRampToValueAtTime(0.28, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.002, now + 0.22);
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.9, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.25);
    });
  }

  _makeNoiseBuffer(ctx, durationSeconds) {
    if (!ctx) return null;
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSeconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    return buffer;
  }

  async _withContext(callback) {
    await this.resume();
    if (!this.context) return;
    try {
      await callback(this.context);
    } catch (error) {
      console.warn('Audio playback error:', error);
    }
  }
}
