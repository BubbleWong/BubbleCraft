const KEY_BINDINGS = {
  forward: new Set(['KeyW', 'ArrowUp']),
  backward: new Set(['KeyS', 'ArrowDown']),
  left: new Set(['KeyA', 'ArrowLeft']),
  right: new Set(['KeyD', 'ArrowRight']),
  jump: new Set(['Space']),
  crouch: new Set(['ShiftLeft', 'ShiftRight']),
};

const LOOK_SENSITIVITY = (Math.PI / 180) * 0.12; // radians per pixel
const MAX_PITCH = (Math.PI / 2) * 0.96;
const HOTBAR_SLOT_COUNT = 9;
const SPRINT_DOUBLE_TAP_INTERVAL_MS = 280;

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
    this._sprintSources = new Set();
    this._crouchHold = false;
    this._crouchToggle = false;
    this._lastForwardTapTime = 0;
    this._touchSprintPointers = new Set();
    this._pointerLocked = false;
    this._yaw = 0;
    this._pitch = 0;
    this._hotbarIndex = 0;
    this._hotbarDirty = true;
    this._toggleHudDetailsRequested = false;
    this._touchSprintButton = null;
    this._touchCrouchButton = null;

    this._handleKeyDown = (event) => this._onKeyDown(event);
    this._handleKeyUp = (event) => this._onKeyUp(event);
    this._handlePointerMove = (event) => this._onPointerMove(event);
    this._handlePointerLockChange = () => this._syncPointerLockState();
    this._handlePointerLockError = () => this._onPointerLockError();
    this._handleBlur = () => this._resetKeys();
    this._handleOverlayPointerDown = (event) => this._onOverlayPointerDown(event);
    this._handleTouchSprintDown = (event) => this._onTouchSprintDown(event);
    this._handleTouchSprintEnd = (event) => this._onTouchSprintEnd(event);
    this._handleTouchCrouch = (event) => this._onTouchCrouchToggle(event);

    document.addEventListener('pointerlockchange', this._handlePointerLockChange);
    document.addEventListener('pointerlockerror', this._handlePointerLockError);
    window.addEventListener('keydown', this._handleKeyDown);
    window.addEventListener('keyup', this._handleKeyUp);
    window.addEventListener('blur', this._handleBlur);
    window.addEventListener('mousemove', this._handlePointerMove);

    if (this.overlay) {
      this.overlay.addEventListener('pointerdown', this._handleOverlayPointerDown);
    }

    if (this.canvas) {
      this.canvas.addEventListener('click', () => {
        if (!this._pointerLocked) this.requestPointerLock({ source: 'canvas' });
      });
    }

    this._bindTouchButtons();

    this._syncPointerLockState();
  }

  dispose() {
    document.removeEventListener('pointerlockchange', this._handlePointerLockChange);
    document.removeEventListener('pointerlockerror', this._handlePointerLockError);
    window.removeEventListener('keydown', this._handleKeyDown);
    window.removeEventListener('keyup', this._handleKeyUp);
    window.removeEventListener('blur', this._handleBlur);
    window.removeEventListener('mousemove', this._handlePointerMove);
    if (this.overlay) {
      this.overlay.removeEventListener('pointerdown', this._handleOverlayPointerDown);
    }
    if (this._touchSprintButton) {
      this._touchSprintButton.removeEventListener('pointerdown', this._handleTouchSprintDown);
      this._touchSprintButton.removeEventListener('pointerup', this._handleTouchSprintEnd);
      this._touchSprintButton.removeEventListener('pointercancel', this._handleTouchSprintEnd);
      this._touchSprintButton.removeEventListener('pointerleave', this._handleTouchSprintEnd);
      this._touchSprintButton = null;
    }
    if (this._touchCrouchButton) {
      this._touchCrouchButton.removeEventListener('pointerdown', this._handleTouchCrouch);
      this._touchCrouchButton = null;
    }
  }

  requestPointerLock({ source = null } = {}) {
    if (this.canvas && this.canvas.requestPointerLock) {
      const handleFailure = (error) => {
        if (error && error.name !== 'SecurityError') {
          // eslint-disable-next-line no-console
          console.warn('Pointer lock request failed', error);
        }
        if (source === 'overlay' && this.overlay) {
          this.overlay.classList.remove('hidden');
        }
      };
      try {
        this.canvas.focus?.();
        const result = this.canvas.requestPointerLock();
        if (result?.catch instanceof Function) {
          result.catch((error) => handleFailure(error));
        }
      } catch (error) {
        handleFailure(error);
      }
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
    const crouch = this._isCrouchActive();
    if (crouch && this._sprintActive) {
      this._clearSprintSources();
    }
    const sprint = !crouch && this._sprintActive;

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
      crouch,
      sprint,
      pointerLocked: this._pointerLocked,
      hotbarIndex: this._hotbarIndex,
      hotbarChanged: this._consumeHotbarDirty(),
      toggleHudDetails: this._consumeToggleHudDetails(),
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

  _consumeToggleHudDetails() {
    const requested = this._toggleHudDetailsRequested;
    this._toggleHudDetailsRequested = false;
    return requested;
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

    if (KEY_BINDINGS.crouch.has(event.code)) {
      event.preventDefault();
      this._setCrouchHold(true);
    }

    if (KEY_BINDINGS.forward.has(event.code)) {
      this._handleForwardTap();
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

    if (event.code === 'KeyI') {
      event.preventDefault();
      this._toggleHudDetailsRequested = true;
    }

    if (event.code === 'KeyC') {
      event.preventDefault();
      this._toggleCrouch();
    }
  }

  _onKeyUp(event) {
    this._keys.delete(event.code);
    this._updateAxes();

    if (KEY_BINDINGS.crouch.has(event.code)) {
      this._setCrouchHold(false);
    }

    if (KEY_BINDINGS.forward.has(event.code)) {
      this._setSprintSource('doubleTap', false);
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
    this._crouchHold = false;
    this._touchSprintPointers.clear();
    this._clearSprintSources();
    this._updateCrouchIndicator();
    this._lastForwardTapTime = 0;
  }

  _onPointerLockError() {
    if (!document.pointerLockElement && this.overlay) {
      this.overlay.classList.remove('hidden');
    }
  }

  _onOverlayPointerDown(event) {
    if (this._pointerLocked) return;
    if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    event.preventDefault();
    this.requestPointerLock({ source: 'overlay' });
  }

  _setHotbarIndex(index) {
    if (index === this._hotbarIndex) return;
    this._hotbarIndex = index;
    this._hotbarDirty = true;
  }

  _isCrouchActive() {
    return this._crouchHold || this._crouchToggle;
  }

  _setCrouchHold(active) {
    if (this._crouchHold === active) return;
    this._crouchHold = active;
    if (!active) {
      this._lastForwardTapTime = 0;
    } else {
      this._clearSprintSources();
    }
    this._updateCrouchIndicator();
  }

  _toggleCrouch() {
    this._crouchToggle = !this._crouchToggle;
    if (this._crouchToggle) {
      this._clearSprintSources();
    }
    this._updateCrouchIndicator();
  }

  _updateCrouchIndicator() {
    if (!this._touchCrouchButton) return;
    const active = this._isCrouchActive();
    try {
      this._touchCrouchButton.classList.toggle('touch-button--active', active);
      this._touchCrouchButton.setAttribute('aria-pressed', String(active));
    } catch (error) {
      // ignore DOM update failures
    }
  }

  _setSprintSource(source, active) {
    if (active) {
      this._sprintSources.add(source);
    } else {
      this._sprintSources.delete(source);
    }
    const next = this._sprintSources.size > 0;
    if (next !== this._sprintActive) {
      this._sprintActive = next;
      this._updateSprintIndicator();
    }
  }

  _clearSprintSources() {
    if (this._sprintSources.size === 0 && !this._sprintActive) return;
    this._sprintSources.clear();
    if (this._sprintActive) {
      this._sprintActive = false;
      this._updateSprintIndicator();
    }
  }

  _updateSprintIndicator() {
    if (!this._touchSprintButton) return;
    try {
      this._touchSprintButton.classList.toggle('touch-button--active', this._sprintActive);
      this._touchSprintButton.setAttribute('aria-pressed', String(this._sprintActive));
    } catch (error) {
      // ignore DOM update failures
    }
  }

  _handleForwardTap() {
    const now = performance.now();
    if (this._pointerLocked && this._lastForwardTapTime && (now - this._lastForwardTapTime) <= SPRINT_DOUBLE_TAP_INTERVAL_MS) {
      this._setSprintSource('doubleTap', true);
    }
    this._lastForwardTapTime = now;
  }

  _bindTouchButtons() {
    if (typeof document === 'undefined') return;
    this._touchSprintButton = document.getElementById('touch-action-sprint');
    this._touchCrouchButton = document.getElementById('touch-action-crouch');

    if (this._touchSprintButton) {
      this._touchSprintButton.setAttribute('aria-pressed', 'false');
      this._touchSprintButton.addEventListener('pointerdown', this._handleTouchSprintDown);
      this._touchSprintButton.addEventListener('pointerup', this._handleTouchSprintEnd);
      this._touchSprintButton.addEventListener('pointercancel', this._handleTouchSprintEnd);
      this._touchSprintButton.addEventListener('pointerleave', this._handleTouchSprintEnd);
    }

    if (this._touchCrouchButton) {
      this._touchCrouchButton.setAttribute('aria-pressed', 'false');
      this._touchCrouchButton.addEventListener('pointerdown', this._handleTouchCrouch);
    }

    this._updateCrouchIndicator();
    this._updateSprintIndicator();
  }

  _isTouchPointer(event) {
    const type = event.pointerType;
    if (typeof type === 'string') {
      return type.toLowerCase() === 'touch';
    }
    return typeof window !== 'undefined' && 'ontouchstart' in window;
  }

  _onTouchSprintDown(event) {
    if (!this._isTouchPointer(event)) return;
    event.preventDefault();
    this._touchSprintPointers.add(event.pointerId);
    if (event.target?.setPointerCapture) {
      try {
        event.target.setPointerCapture(event.pointerId);
      } catch (error) {
        // ignore capture failures
      }
    }
    this._setSprintSource('touch', true);
  }

  _onTouchSprintEnd(event) {
    if (!this._touchSprintPointers.has(event.pointerId)) return;
    this._touchSprintPointers.delete(event.pointerId);
    if (event.target?.releasePointerCapture) {
      try {
        event.target.releasePointerCapture(event.pointerId);
      } catch (error) {
        // ignore release failures
      }
    }
    if (this._touchSprintPointers.size === 0) {
      this._setSprintSource('touch', false);
    }
  }

  _onTouchCrouchToggle(event) {
    if (!this._isTouchPointer(event)) return;
    event.preventDefault();
    this._toggleCrouch();
  }
}
