import { InputManager } from './input.js';
import { PlayerController } from './player.js';
import { VoxelWorld } from './world/index.js';
import { HudManager } from './hud.js';
import { BlockInteraction } from './blockInteraction.js';
import { BLOCK_TYPES } from '../constants.js';

export class GameApp {
  constructor({ canvas, overlay, crosshair, hud, fpsHud, loadingUi } = {}) {
    this.canvas = canvas;
    this.overlay = overlay ?? null;
    this.crosshair = crosshair ?? null;
    this.hudEl = hud ?? null;
    this.fpsHud = fpsHud ?? null;
    this.loadingUi = loadingUi ?? null;
    this.inventoryEl = document.getElementById('inventory');
    this.healthEl = document.getElementById('health');

    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.input = null;
    this.world = null;
    this.player = null;
    this.hud = null;
    this.blockInteraction = null;

    this._frameAccumulator = 0;
    this._started = false;
  }

  async init() {
    if (!this.canvas) {
      throw new Error('Missing canvas element for Babylon engine');
    }

    this.engine = new BABYLON.Engine(this.canvas, true, { adaptToDeviceRatio: true, preserveDrawingBuffer: false });
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.62, 0.78, 1.0, 1.0);

    this.camera = new BABYLON.FreeCamera('player-camera', new BABYLON.Vector3(0, 32, -32), this.scene);
    this.camera.minZ = 0.05;
    this.camera.maxZ = 2000;
    this.camera.inertia = 0;
    this.camera.fov = BABYLON.Tools.ToRadians(70);
    this.camera.inputs.clear();

    this._createEnvironment();

    this.input = new InputManager({
      canvas: this.canvas,
      overlay: this.overlay,
      crosshair: this.crosshair,
      onPointerLockChanged: (locked) => {
        if (this.canvas && !locked) {
          this.canvas.style.cursor = 'auto';
        } else if (this.canvas) {
          this.canvas.style.cursor = 'none';
        }
        this.hud?.setPointerLock(locked);
      },
    });
    await this._loadWorld();

    this._registerUpdateLoop();
    this._started = true;

    this.engine.runRenderLoop(() => {
      if (!this.scene) return;
      const disposed = typeof this.scene.isDisposed === 'function' ? this.scene.isDisposed() : false;
      if (disposed) return;
      this.scene.render();
    });

    window.addEventListener('resize', () => this.engine?.resize());
  }

  dispose() {
    if (this.input) this.input.dispose();
    if (this.player) this.player.dispose();
    if (this.world) this.world.dispose();
    if (this.scene) this.scene.dispose();
    this.engine?.dispose();
    this._started = false;
  }

  _createEnvironment() {
    const ambient = new BABYLON.HemisphericLight('ambient', new BABYLON.Vector3(0.25, 1, 0.3), this.scene);
    ambient.intensity = 0.55;

    const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.36, -0.9, 0.28), this.scene);
    sun.position = new BABYLON.Vector3(160, 220, -110);
    sun.intensity = 1.05;
  }

  async _loadWorld() {
    this._setLoadingState(true, 'Generating terrain…', 0);
    this.world = new VoxelWorld(this.scene, { chunkRadius: 5 });
    const { spawnPoint } = await this.world.generate((progress) => {
      this._setLoadingState(true, 'Generating terrain…', Math.round(progress * 80));
    });

    this._setLoadingState(true, 'Spawning player…', 90);
    this.player = new PlayerController({
      scene: this.scene,
      world: this.world,
      camera: this.camera,
      input: this.input,
    });
    this.player.setSpawnPoint(spawnPoint);

    this.hud = new HudManager({
      hudEl: this.hudEl,
      inventoryEl: this.inventoryEl,
      healthEl: this.healthEl,
    });

    const orientation = this.input.getOrientation?.();
    if (orientation) {
      this.player.setOrientation(orientation);
    }

    const blockPalette = this._createBlockPalette();
    this.hud.configureInventory(blockPalette);
    this.hud.setActiveSlot(0);
    this.hud.updateHealth(20, 20);
    this.hud.setPointerLock(false);

    this.blockInteraction = new BlockInteraction({
      scene: this.scene,
      world: this.world,
      player: this.player,
      camera: this.camera,
      hud: this.hud,
      blockPalette,
    });
    this.blockInteraction.setActiveSlot(0);

    if (this.inventoryEl) {
      this.inventoryEl.classList.toggle('hidden', false);
    }

    if (this.canvas) {
      this.canvas.addEventListener('pointerdown', (event) => this._handlePointerDown(event));
      this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    }

    this._setLoadingState(false);
  }

  _registerUpdateLoop() {
    this.scene.onBeforeRenderObservable.add(() => {
      const delta = this.scene.getEngine().getDeltaTime() * 0.001;
      if (this.player) {
        const frameInput = this.input.poll();
        if (frameInput.hotbarChanged) {
          this.blockInteraction?.setActiveSlot(frameInput.hotbarIndex);
          this.hud?.setActiveSlot(frameInput.hotbarIndex);
        }

        this.player.update(delta, frameInput);
        this.blockInteraction?.update();
      }

      if (this.fpsHud) {
        this._frameAccumulator += delta;
        if (this._frameAccumulator >= 0.33) {
          this.fpsHud.textContent = `${this.engine.getFps().toFixed(0)} fps`;
          this._frameAccumulator = 0;
        }
      }
    });
  }

  _setLoadingState(active, label = '', percent = 0) {
    if (!this.loadingUi) return;
    const { overlay, labelEl, barEl, percentEl } = this.loadingUi;

    if (overlay) overlay.classList.toggle('hidden', !active);
    if (labelEl) labelEl.textContent = label;
    if (barEl) barEl.style.width = `${Math.max(0, percent)}%`;
    if (percentEl) percentEl.textContent = `${percent}%`;

    if (!active) {
      if (barEl) barEl.style.width = '100%';
      if (percentEl) percentEl.textContent = '100%';
    }
  }

  _createBlockPalette() {
    return [
      BLOCK_TYPES.grass,
      BLOCK_TYPES.dirt,
      BLOCK_TYPES.stone,
      BLOCK_TYPES.sand,
      BLOCK_TYPES.wood,
      BLOCK_TYPES.leaves,
      BLOCK_TYPES.gold,
      BLOCK_TYPES.diamond,
      BLOCK_TYPES.flower,
    ];
  }

  _handlePointerDown(event) {
    if (!this.input.isPointerLocked()) return;
    if (event.button === 0) {
      this.blockInteraction?.queueBreak();
    } else if (event.button === 2) {
      event.preventDefault();
      this.blockInteraction?.queuePlace();
    }
  }
}
