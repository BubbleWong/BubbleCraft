const KEY_BINDINGS = {
  forward: new Set(['KeyW', 'ArrowUp']),
  backward: new Set(['KeyS', 'ArrowDown']),
  left: new Set(['KeyA', 'ArrowLeft']),
  right: new Set(['KeyD', 'ArrowRight']),
  jump: new Set(['Space']),
  sprint: new Set(['ShiftLeft', 'ShiftRight']),
};

const LOOK_SENSITIVITY = (Math.PI / 180) * 0.12; // radians per pixel
const MAX_PITCH = (Math.PI / 2) * 0.96;
const HOTBAR_SLOT_COUNT = 9;

export class InputManager {
  constructor({ canvas, overlay, crosshair, onPointerLockChanged } = {}) {
    this.canvas = canvas;
    this.overlay = overlay ?? null;
    this.crosshair = crosshair ?? null;
    this.onPointerLockChanged = onPointerLockChanged ?? (() => {});

    this._keys = new Set();
    this._moveAxis = { x: 0, y: 0 };
    this._lookDelta = { x: 0, y: 0 };
    this._jumpRequested = false;
    this._sprintActive = false;
    this._pointerLocked = false;
    this._yaw = 0;
    this._pitch = 0;
    this._hotbarIndex = 0;
    this._hotbarDirty = true;

    this._handleKeyDown = (event) => this._onKeyDown(event);
    this._handleKeyUp = (event) => this._onKeyUp(event);
    this._handlePointerMove = (event) => this._onPointerMove(event);
    this._handlePointerLockChange = () => this._syncPointerLockState();
    this._handleBlur = () => this._resetKeys();

    document.addEventListener('pointerlockchange', this._handlePointerLockChange);
    window.addEventListener('keydown', this._handleKeyDown);
    window.addEventListener('keyup', this._handleKeyUp);
    window.addEventListener('blur', this._handleBlur);
    window.addEventListener('mousemove', this._handlePointerMove);

    if (this.overlay) {
      this.overlay.addEventListener('click', () => {
        if (!this._pointerLocked) this.requestPointerLock();
      });
    }

    if (this.canvas) {
      this.canvas.addEventListener('click', () => {
        if (!this._pointerLocked) this.requestPointerLock();
      });
    }

    this._syncPointerLockState();
  }

  dispose() {
    document.removeEventListener('pointerlockchange', this._handlePointerLockChange);
    window.removeEventListener('keydown', this._handleKeyDown);
    window.removeEventListener('keyup', this._handleKeyUp);
    window.removeEventListener('blur', this._handleBlur);
    window.removeEventListener('mousemove', this._handlePointerMove);
  }

  requestPointerLock() {
    if (this.canvas && this.canvas.requestPointerLock) {
      this.canvas.requestPointerLock();
    }
  }

  releasePointerLock() {
    if (document.pointerLockElement && document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  setYawPitch(yaw, pitch) {
    this._yaw = yaw;
    this._pitch = pitch;
  }

  getYawPitch() {
    return { yaw: this._yaw, pitch: this._pitch };
  }

  getOrientation() {
    return this.getYawPitch();
  }

  poll() {
    const move = { x: this._moveAxis.x, y: this._moveAxis.y };
    const look = { x: this._lookDelta.x, y: this._lookDelta.y };
    const jump = this._jumpRequested;
    const sprint = this._sprintActive;

    if (look.x !== 0 || look.y !== 0) {
      this._yaw += look.x * LOOK_SENSITIVITY;
      this._pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this._pitch + look.y * LOOK_SENSITIVITY));
    }

    this._lookDelta.x = 0;
    this._lookDelta.y = 0;
    this._jumpRequested = false;

    return {
      move,
      look: { yaw: this._yaw, pitch: this._pitch },
      jump,
      sprint,
      pointerLocked: this._pointerLocked,
      hotbarIndex: this._hotbarIndex,
      hotbarChanged: this._consumeHotbarDirty(),
    };
  }

  isPointerLocked() {
    return this._pointerLocked;
  }

  _consumeHotbarDirty() {
    const dirty = this._hotbarDirty;
    this._hotbarDirty = false;
    return dirty;
  }

  _onKeyDown(event) {
    if (!this._pointerLocked && !KEY_BINDINGS.jump.has(event.code)) return;

    if (event.repeat) return;
    this._keys.add(event.code);
    this._updateAxes();

    if (KEY_BINDINGS.jump.has(event.code)) {
      event.preventDefault();
      this._jumpRequested = true;
    }

    if (KEY_BINDINGS.sprint.has(event.code)) {
      event.preventDefault();
      this._sprintActive = true;
    }

    if (KEY_BINDINGS.forward.has(event.code) ||
        KEY_BINDINGS.backward.has(event.code) ||
        KEY_BINDINGS.left.has(event.code) ||
        KEY_BINDINGS.right.has(event.code)) {
      event.preventDefault();
    }

    if (event.code.startsWith('Digit')) {
      const digit = Number.parseInt(event.code.slice(-1), 10);
      if (Number.isFinite(digit) && digit >= 1 && digit <= HOTBAR_SLOT_COUNT) {
        this._setHotbarIndex(digit - 1);
        event.preventDefault();
      }
    }
  }

  _onKeyUp(event) {
    this._keys.delete(event.code);
    this._updateAxes();

    if (KEY_BINDINGS.sprint.has(event.code)) {
      this._sprintActive = false;
    }

    if (event.code.startsWith('Digit')) {
      event.preventDefault();
    }
  }

  _updateAxes() {
    const forward = [...KEY_BINDINGS.forward].some((key) => this._keys.has(key)) ? 1 : 0;
    const backward = [...KEY_BINDINGS.backward].some((key) => this._keys.has(key)) ? 1 : 0;
    const left = [...KEY_BINDINGS.left].some((key) => this._keys.has(key)) ? 1 : 0;
    const right = [...KEY_BINDINGS.right].some((key) => this._keys.has(key)) ? 1 : 0;

    this._moveAxis.y = forward - backward;
    this._moveAxis.x = right - left;

    const lengthSq = this._moveAxis.x * this._moveAxis.x + this._moveAxis.y * this._moveAxis.y;
    if (lengthSq > 1) {
      const invLength = 1 / Math.sqrt(lengthSq);
      this._moveAxis.x *= invLength;
      this._moveAxis.y *= invLength;
    }
  }

  _onPointerMove(event) {
    if (!this._pointerLocked) return;
    this._lookDelta.x += event.movementX;
    this._lookDelta.y += event.movementY;
  }

  _syncPointerLockState() {
    const locked = document.pointerLockElement === this.canvas;
    if (locked === this._pointerLocked) return;
    this._pointerLocked = locked;

    if (!locked) {
      this._resetKeys();
    }

    if (this.overlay) {
      this.overlay.classList.toggle('hidden', locked);
    }
    if (this.crosshair) {
      this.crosshair.classList.toggle('hidden', !locked);
    }

    this.onPointerLockChanged(locked);
  }

  _resetKeys() {
    if (this._keys.size > 0) {
      this._keys.clear();
      this._updateAxes();
    }
    this._sprintActive = false;
  }

  _setHotbarIndex(index) {
    if (index === this._hotbarIndex) return;
    this._hotbarIndex = index;
    this._hotbarDirty = true;
  }
}
