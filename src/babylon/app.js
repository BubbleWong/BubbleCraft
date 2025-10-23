import { InputManager } from './input.js';
import { PlayerController } from './player.js';
import { VoxelWorld } from './world/index.js';
import { HudManager } from './hud.js';
import { BlockInteraction } from './blockInteraction.js';
import { Inventory, HOTBAR_SLOT_COUNT } from './inventory.js';
import { WeatherSystem } from './weatherSystem.js';
const { PointerEventTypes } = BABYLON;
import { BLOCK_TYPES } from '../constants.js';

const HUD_UPDATE_INTERVAL = 0.2;
const FPS_UPDATE_INTERVAL = 0.5;
const FPS_SMOOTHING = 0.82;

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
    this.inventory = null;
    this.hud = null;
    this.blockInteraction = null;
    this.weatherSystem = null;
    this.hemisphereLight = null;
    this.sunLight = null;
    this.pointerObserver = null;

    this.maxHealth = 20;
    this.currentHealth = 20;
    this.activeHotbarIndex = 0;
    this.hudAccumulator = 0;
    this._fpsAccumulatorTime = 0;
    this._fpsFrameCount = 0;
    this._fpsSmoothed = 0;
    this._started = false;

    this._onCanvasContextMenu = (event) => {
      if (this.input?.isPointerLocked?.()) {
        event.preventDefault();
      }
    };
    this._onWheel = (event) => this._handleWheel(event);
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
    window.addEventListener('wheel', this._onWheel, { passive: false });
  }

  dispose() {
    if (this.canvas) {
      this.canvas.removeEventListener('contextmenu', this._onCanvasContextMenu);
    }
    window.removeEventListener('wheel', this._onWheel);
    if (this.pointerObserver) {
      this.scene?.onPointerObservable?.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
    this.input?.dispose();
    this.player?.dispose();
    this.world?.dispose();
    this.scene?.dispose();
    this.engine?.dispose();
    this._started = false;
  }

  _createEnvironment() {
    this.hemisphereLight = new BABYLON.HemisphericLight('ambient', new BABYLON.Vector3(0.25, 1, 0.3), this.scene);
    this.hemisphereLight.intensity = 0.55;

    this.sunLight = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.36, -0.9, 0.28), this.scene);
    this.sunLight.position = new BABYLON.Vector3(160, 220, -110);
    this.sunLight.intensity = 1.05;

    this.weatherSystem = new WeatherSystem({ scene: this.scene, sun: this.sunLight, hemisphere: this.hemisphereLight });
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

    this.inventory = new Inventory(HOTBAR_SLOT_COUNT);
    this.hud = new HudManager({
      hudEl: this.hudEl,
      inventoryEl: this.inventoryEl,
      healthEl: this.healthEl,
    });
    this.hud.bindInventory(this.inventory);
    this.currentHealth = this.maxHealth;
    this.hud.updateHealth(this.currentHealth, this.maxHealth);
    this.hud.setPointerLock(this.input?.isPointerLocked?.() ?? false);
    this._exposeHealthApi();

    const orientation = this.input.getOrientation?.();
    if (orientation) {
      this.player.setOrientation(orientation);
    }

    this.blockInteraction = new BlockInteraction({
      scene: this.scene,
      world: this.world,
      player: this.player,
      camera: this.camera,
      hud: this.hud,
      inventory: this.inventory,
      onInventoryChange: () => this._onInventoryChanged(),
    });

    if (!this.pointerObserver) {
      this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
        console.log('[pointer]', {
          pointerType: pointerInfo.type,
          button: pointerInfo.event?.button,
          locked: this.input?.isPointerLocked?.(),
        });
        if (!this.input?.isPointerLocked?.()) return;
        if (pointerInfo.type !== PointerEventTypes.POINTERDOWN) return;
        const evt = pointerInfo.event;
        if (evt.button === 0) {
          console.log('[pointer] queue break');
          this.blockInteraction?.queueBreak();
        } else if (evt.button === 2) {
          evt.preventDefault();
          console.log('[pointer] queue place');
          this.blockInteraction?.queuePlace();
        }
      });
    }

    this._seedStarterInventory();
    this._refreshInventoryUI();
    this._updateHudWorldInfo();
    this._updateFpsHud(0);

    if (this.canvas) {
      this.canvas.addEventListener('contextmenu', this._onCanvasContextMenu);
    }

    this._setLoadingState(false);
  }

  _registerUpdateLoop() {
    this.scene.onBeforeRenderObservable.add(() => {
      const delta = this.scene.getEngine().getDeltaTime() * 0.001;
      const frameInput = this.input?.poll?.() ?? null;

      if (this.player && frameInput) {
        if (frameInput.hotbarChanged) {
          this._setActiveHotbarIndex(frameInput.hotbarIndex);
        }

        this.player.update(delta, frameInput);
        this.blockInteraction?.update(frameInput);
      }

      this.weatherSystem?.update(delta);

      this.hudAccumulator += delta;
      if (this.hudAccumulator >= HUD_UPDATE_INTERVAL) {
        this._updateHudWorldInfo();
        this.hudAccumulator = 0;
      }

      this._fpsAccumulatorTime += delta;
      this._fpsFrameCount += 1;
      if (this._fpsAccumulatorTime >= FPS_UPDATE_INTERVAL) {
        const instantaneous = this._fpsFrameCount / this._fpsAccumulatorTime;
        this._updateFpsHud(instantaneous);
        this._fpsAccumulatorTime = 0;
        this._fpsFrameCount = 0;
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

  _exposeHealthApi() {
    try {
      Object.defineProperty(window, 'setHealthPoints', {
        value: (value) => {
          const numeric = Number(value);
          if (!Number.isFinite(numeric)) return;
          this.currentHealth = Math.max(0, Math.min(this.maxHealth, numeric));
          this.hud?.updateHealth(this.currentHealth, this.maxHealth);
        },
        configurable: true,
        writable: false,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to expose setHealthPoints API', error);
    }
  }

  _updateHudWorldInfo() {
    if (!this.hud || !this.player || !this.world) return;
    const position = this.player.mesh?.position ?? null;
    const weatherState = this.weatherSystem?.getState?.() ?? null;
    const blockTotals = this.world.getBlockTotals?.() ?? null;
    this.hud.updateWorldInfo({ position, weatherState, blockTotals });
  }

  _updateFpsHud(fps) {
    if (!this.fpsHud) return;
    const clamped = Number.isFinite(fps) ? Math.max(0, fps) : 0;
    this._fpsSmoothed = this._fpsSmoothed === 0
      ? clamped
      : this._fpsSmoothed * FPS_SMOOTHING + clamped * (1 - FPS_SMOOTHING);
    this.fpsHud.textContent = `FPS: ${this._fpsSmoothed.toFixed(1)}`;
  }

  _onInventoryChanged() {
    this._refreshInventoryUI();
    this._updateHudWorldInfo();
  }

  _seedStarterInventory() {
    if (!this.inventory) return;
    const starter = [
      { type: BLOCK_TYPES.grass, count: 32 },
      { type: BLOCK_TYPES.dirt, count: 48 },
      { type: BLOCK_TYPES.stone, count: 48 },
      { type: BLOCK_TYPES.wood, count: 32 },
      { type: BLOCK_TYPES.sand, count: 24 },
      { type: BLOCK_TYPES.leaves, count: 16 },
      { type: BLOCK_TYPES.gold, count: 12 },
      { type: BLOCK_TYPES.diamond, count: 8 },
      { type: BLOCK_TYPES.flower, count: 12 },
    ];
    starter.forEach(({ type, count }) => {
      this.inventory.add(type, count);
    });
  }

  _refreshInventoryUI(direction = 1) {
    if (!this.inventory) return;
    this._ensureActiveHotbarIndex(direction);
    this.blockInteraction?.setActiveSlot(this.activeHotbarIndex);
    this.hud?.setActiveSlot(this.activeHotbarIndex);
    this.hud?.refreshInventory(this.inventory, this.activeHotbarIndex);
  }

  _ensureActiveHotbarIndex(direction = 1) {
    if (!this.inventory || this.inventory.slotCount === 0) return;
    if (this.inventory.getSlot(this.activeHotbarIndex)) return;
    const fallback = this.inventory.findNextFilledSlot(this.activeHotbarIndex, direction);
    if (fallback !== -1) {
      this.activeHotbarIndex = fallback;
    }
  }

  _setActiveHotbarIndex(index) {
    if (!this.inventory || this.inventory.slotCount === 0) return;
    const normalized = ((index % this.inventory.slotCount) + this.inventory.slotCount) % this.inventory.slotCount;
    this.activeHotbarIndex = normalized;
    this._refreshInventoryUI();
  }

  _handleWheel(event) {
    if (!this.input?.isPointerLocked?.()) return;
    if (this._handleInventoryWheel(event.deltaY)) {
      event.preventDefault();
    }
  }

  _handleInventoryWheel(deltaY) {
    if (!this.inventory || deltaY === 0) return false;
    const direction = deltaY > 0 ? 1 : -1;
    if (this.inventory.slotCount === 0) return false;
    let nextIndex = (this.activeHotbarIndex + direction + this.inventory.slotCount) % this.inventory.slotCount;
    if (!this.inventory.getSlot(nextIndex)) {
      const fallback = this.inventory.findNextFilledSlot(this.activeHotbarIndex, direction);
      if (fallback !== -1) nextIndex = fallback;
    }
    this.activeHotbarIndex = nextIndex;
    this._refreshInventoryUI(direction);
    return true;
  }

}
