import { BLOCK_TYPES } from '../../constants.js';

export const HOTBAR_SLOT_COUNT = 9;
export const MAX_STACK_SIZE = 64;

export class Inventory {
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
        const transfer = Math.min(space, remaining);
        slot.count += transfer;
        remaining -= transfer;
      }
    }

    for (let i = 0; i < this.slotCount && remaining > 0; i += 1) {
      if (!this.slots[i]) {
        const transfer = Math.min(MAX_STACK_SIZE, remaining);
        this.slots[i] = { type, count: transfer };
        remaining -= transfer;
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
    if (slot.count === 0) {
      this.slots[index] = null;
    }
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
