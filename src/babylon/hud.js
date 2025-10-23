import { BLOCK_TYPE_LABELS } from '../constants.js';

export class HudManager {
  constructor({ hudEl, inventoryEl, healthEl }) {
    this.hudEl = hudEl ?? null;
    this.inventoryEl = inventoryEl ?? null;
    this.healthEl = healthEl ?? null;

    this.blockPalette = [];
    this.activeSlot = 0;
  }

  configureInventory(palette) {
    this.blockPalette = palette.slice(0);
    if (!this.inventoryEl) return;
    this.inventoryEl.innerHTML = '';

    this.blockPalette.forEach((blockType, index) => {
      const slot = document.createElement('div');
      slot.className = 'inventory__slot';
      slot.dataset.blockType = String(blockType);

      const label = document.createElement('div');
      label.className = 'inventory__item';
      label.textContent = BLOCK_TYPE_LABELS[blockType] ?? `Block ${blockType}`;
      slot.append(label);

      const count = document.createElement('div');
      count.className = 'inventory__count';
      count.textContent = '∞';
      slot.append(count);

      const keyHint = document.createElement('div');
      keyHint.className = 'inventory__key';
      keyHint.textContent = String(index + 1);
      slot.append(keyHint);

      this.inventoryEl.append(slot);
    });

    this.setActiveSlot(this.activeSlot);
  }

  setActiveSlot(index) {
    this.activeSlot = index;
    if (!this.inventoryEl) return;
    const slots = this.inventoryEl.querySelectorAll('.inventory__slot');
    slots.forEach((slot, i) => {
      if (i === index) {
        slot.classList.add('inventory__slot--active');
      } else {
        slot.classList.remove('inventory__slot--active');
      }
    });
  }

  updateStatus({ selectedType, targetedType = null, distance = null } = {}) {
    if (!this.hudEl) return;
    const selected = BLOCK_TYPE_LABELS[selectedType] ?? 'Unknown';
    let targetText = 'None';
    if (Number.isFinite(targetedType)) {
      targetText = BLOCK_TYPE_LABELS[targetedType] ?? `Block ${targetedType}`;
    }
    const distanceText = Number.isFinite(distance) ? `${distance.toFixed(2)}m` : '—';
    this.hudEl.textContent = `Held: ${selected} | Target: ${targetText} | Dist: ${distanceText}`;
  }

  updateHealth(current, max) {
    if (!this.healthEl) return;
    const segments = [];
    const clampMax = Math.max(1, max);
    for (let i = 0; i < clampMax; i += 1) {
      const filled = i < current;
      segments.push(`<span style="color:${filled ? '#ff6b6b' : '#666'}">❤</span>`);
    }
    this.healthEl.innerHTML = segments.join(' ');
    this.healthEl.classList.toggle('hidden', false);
  }

  setPointerLock(locked) {
    if (this.inventoryEl) {
      this.inventoryEl.classList.toggle('hidden', !locked);
    }
  }
}
