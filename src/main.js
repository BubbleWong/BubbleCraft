import { GameApp } from './core/GameApp.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const crosshair = document.getElementById('crosshair');
const hud = document.getElementById('hud');
const fpsHud = document.getElementById('hud-fps');
const loadingOverlay = document.getElementById('loading');
const loadingLabel = document.getElementById('loading-label');
const loadingBar = document.getElementById('loading-bar');
const loadingPercent = document.getElementById('loading-percent');

const loadingUi = {
  overlay: loadingOverlay,
  labelEl: loadingLabel,
  barEl: loadingBar,
  percentEl: loadingPercent,
};

const app = new GameApp({
  canvas,
  overlay,
  crosshair,
  hud,
  fpsHud,
  loadingUi,
});

app.init().catch((error) => {
  console.error('Failed to initialise game', error);
  if (loadingLabel) {
    loadingLabel.textContent = 'Failed to start game.';
  }
  if (loadingOverlay) {
    loadingOverlay.classList.remove('hidden');
  }
});
