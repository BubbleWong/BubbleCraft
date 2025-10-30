import { CHUNK_SIZE, BLOCK_TYPES, BLOCK_TYPE_LABELS, BLOCK_COLORS, FLOWER_UI_COLOR } from '../constants.js';
import { WEATHER_LABELS, TIME_OF_DAY_LABELS } from '../gameplay/systems/WeatherSystem.js';

const HEART_PER_POINT = 2;

function blockColorToCss(type) {
  let base = BLOCK_COLORS[type];
  if (!base && type === BLOCK_TYPES.flower) base = FLOWER_UI_COLOR;
  if (!base) return 'rgba(255, 255, 255, 0.18)';
  const [r, g, b] = base.map((channel) => Math.round(channel * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

export class HudManager {
  constructor({ hudEl, inventoryEl, healthEl, rightEl }) {
    this.hudEl = hudEl ?? null;
    this.inventoryEl = inventoryEl ?? null;
    this.healthEl = healthEl ?? null;
    this.rightEl = rightEl ?? null;

    this.inventory = null;
    this.activeSlot = 0;
    this.worldInfo = null;
    this.targetInfo = null;
    this.detailsExpanded = false;
    this.fpsValue = 0;
  }

  bindInventory(inventory) {
    this.inventory = inventory;
  }

  refreshInventory(inventory = this.inventory, activeIndex = this.activeSlot) {
    if (!this.inventoryEl || !inventory) return;
    this.inventoryEl.innerHTML = '';
    for (let i = 0; i < inventory.slotCount; i += 1) {
      const slotData = inventory.getSlot(i);
      const slot = document.createElement('div');
      slot.className = 'inventory__slot';
      if (i === activeIndex) slot.classList.add('inventory__slot--active');
      if (!slotData) {
        slot.classList.add('inventory__slot--empty');
      } else {
        const item = document.createElement('div');
        item.className = 'inventory__item';
        item.style.backgroundColor = blockColorToCss(slotData.type);
        item.textContent = BLOCK_TYPE_LABELS[slotData.type] ?? `#${slotData.type}`;
        slot.append(item);

        const count = document.createElement('span');
        count.className = 'inventory__count';
        count.textContent = String(slotData.count);
        slot.append(count);
      }

      const keyHint = document.createElement('span');
      keyHint.className = 'inventory__key';
      keyHint.textContent = String(i + 1);
      slot.append(keyHint);

      this.inventoryEl.append(slot);
    }
  }

  setActiveSlot(index) {
    this.activeSlot = index;
    this.refreshInventory();
  }

  updateWorldInfo({ position = null, weatherState = null, blockTotals = null } = {}) {
    this.worldInfo = { position, weatherState, blockTotals };
    this._render();
  }

  updateStatus({ selectedType = BLOCK_TYPES.air, targetedType = null, distance = null } = {}) {
    this.targetInfo = { selectedType, targetedType, distance };
    this._render();
  }

  updateHealth(current, max) {
    if (!this.healthEl) return;
    const totalHearts = Math.max(1, Math.ceil(max / HEART_PER_POINT));
    const fragments = [];
    let remaining = Math.max(0, Math.min(max, current));
    for (let i = 0; i < totalHearts; i += 1) {
      let className = 'health__heart';
      if (remaining >= HEART_PER_POINT) {
        className += ' health__heart--full';
        remaining -= HEART_PER_POINT;
      } else if (remaining === 1) {
        className += ' health__heart--half';
        remaining = 0;
      } else {
        className += ' health__heart--empty';
      }
      fragments.push(`<div class="${className}"></div>`);
    }
    this.healthEl.innerHTML = fragments.join('');
    const heartsValue = (current / HEART_PER_POINT).toFixed(1).replace(/\.0$/, '');
    this.healthEl.setAttribute('aria-label', `Health: ${heartsValue} hearts`);
    this.healthEl.classList.toggle('hidden', false);
  }

  setPointerLock(locked) {
    if (this.inventoryEl) {
      this.inventoryEl.classList.toggle('hidden', !locked);
    }
  }

  toggleDetails(force = null) {
    if (!this.rightEl) return;
    if (typeof force === 'boolean') {
      this.detailsExpanded = force;
    } else {
      this.detailsExpanded = !this.detailsExpanded;
    }
    this._render();
  }

  updateFps(fps) {
    if (!Number.isFinite(fps)) {
      this.fpsValue = 0;
    } else {
      this.fpsValue = Math.max(0, fps);
    }
    this._render();
  }

  _render() {
    const worldInfo = this.worldInfo;

    const mainLines = [];
    const rightLines = [];
    const position = worldInfo?.position ?? null;
    const weatherState = worldInfo?.weatherState ?? null;
    const blockTotals = worldInfo?.blockTotals ?? null;

    if (weatherState) {
      const weatherLabel = WEATHER_LABELS[weatherState.weather] ?? weatherState.weather;
      const timeLabel = TIME_OF_DAY_LABELS[weatherState.timeOfDay] ?? weatherState.timeOfDay;
      const flags = [];
      if (!weatherState.autoWeather) flags.push('manual weather');
      if (!weatherState.autoTime) flags.push('manual time');
      const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
      mainLines.push(`Weather: ${weatherLabel} · ${timeLabel}${suffix}`);
    }

    if (position) {
      mainLines.push(`GPS: ${position.x.toFixed(1)} ${position.y.toFixed(1)} ${position.z.toFixed(1)}`);
    }

    rightLines.push(`FPS: ${this.fpsValue.toFixed(1)}`);

    if (this.detailsExpanded) {
      const targetInfo = this.targetInfo ?? { selectedType: BLOCK_TYPES.air, targetedType: null, distance: null };
      const { selectedType, targetedType, distance } = targetInfo;
      const selectedLabel = BLOCK_TYPE_LABELS[selectedType] ?? 'Empty';
      let targetLabel = 'None';
      if (Number.isInteger(targetedType)) {
        targetLabel = BLOCK_TYPE_LABELS[targetedType] ?? `Block ${targetedType}`;
      }
      const distanceText = Number.isFinite(distance) ? `${distance.toFixed(2)}m` : '—';
      rightLines.push(`Held: ${selectedLabel}`);
      rightLines.push(`Target: ${targetLabel}`);
      rightLines.push(`Dist: ${distanceText}`);

      if (position) {
        const chunkX = Math.floor(position.x / CHUNK_SIZE);
        const chunkZ = Math.floor(position.z / CHUNK_SIZE);
        rightLines.push(`Chunk: ${chunkX}, ${chunkZ}`);
      }

      if (Array.isArray(blockTotals)) {
        let typeCount = 0;
        const blockLines = [];
        for (const [key, label] of Object.entries(BLOCK_TYPE_LABELS)) {
          const typeIndex = Number(key);
          const amount = blockTotals[typeIndex] ?? 0;
          if (amount > 0) {
            typeCount += 1;
            blockLines.push(`${label}: ${amount}`);
          }
        }
        rightLines.push(`Types: ${typeCount}`);
        rightLines.push(...blockLines);
      }
    }

    if (this.hudEl) {
      this.hudEl.innerHTML = mainLines.map((text) => `<div>${text}</div>`).join('');
    }
    if (this.rightEl) {
      this.rightEl.innerHTML = rightLines.map((text) => `<div>${text}</div>`).join('');
    }
  }
}
