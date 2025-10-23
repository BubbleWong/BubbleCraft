import { BLOCK_TYPES, BLOCK_TYPE_LABELS, BLOCK_COLORS, FLOWER_UI_COLOR } from '../constants.js';
import { WEATHER_LABELS, TIME_OF_DAY_LABELS } from './weatherSystem.js';

const HEART_PER_POINT = 2;

function blockColorToCss(type) {
  let base = BLOCK_COLORS[type];
  if (!base && type === BLOCK_TYPES.flower) base = FLOWER_UI_COLOR;
  if (!base) return 'rgba(255, 255, 255, 0.18)';
  const [r, g, b] = base.map((channel) => Math.round(channel * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

export class HudManager {
  constructor({ hudEl, inventoryEl, healthEl }) {
    this.hudEl = hudEl ?? null;
    this.inventoryEl = inventoryEl ?? null;
    this.healthEl = healthEl ?? null;

    this.inventory = null;
    this.activeSlot = 0;
    this.worldInfo = null;
    this.targetInfo = null;
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

  _render() {
    if (!this.hudEl) return;
    if (!this.worldInfo) {
      this.hudEl.innerHTML = '';
      return;
    }

    const lines = [];
    const { position, weatherState, blockTotals } = this.worldInfo;

    if (weatherState) {
      const weatherLabel = WEATHER_LABELS[weatherState.weather] ?? weatherState.weather;
      const timeLabel = TIME_OF_DAY_LABELS[weatherState.timeOfDay] ?? weatherState.timeOfDay;
      const flags = [];
      if (!weatherState.autoWeather) flags.push('manual weather');
      if (!weatherState.autoTime) flags.push('manual time');
      const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
      lines.push(`Weather: ${weatherLabel} · ${timeLabel}${suffix}`);
    }

    if (position) {
      lines.push(`XYZ: ${position.x.toFixed(1)} ${position.y.toFixed(1)} ${position.z.toFixed(1)}`);
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
      lines.push(`Types: ${typeCount}`);
      lines.push(...blockLines);
    }

    if (this.targetInfo) {
      const { selectedType, targetedType, distance } = this.targetInfo;
      const selectedLabel = BLOCK_TYPE_LABELS[selectedType] ?? 'Empty';
      let targetLabel = 'None';
      if (Number.isInteger(targetedType)) {
        targetLabel = BLOCK_TYPE_LABELS[targetedType] ?? `Block ${targetedType}`;
      }
      const distanceText = Number.isFinite(distance) ? `${distance.toFixed(2)}m` : '—';
      lines.push(`Held: ${selectedLabel}`);
      lines.push(`Target: ${targetLabel}`);
      lines.push(`Dist: ${distanceText}`);
    }

    this.hudEl.innerHTML = lines.map((text) => `<div>${text}</div>`).join('');
  }
}
