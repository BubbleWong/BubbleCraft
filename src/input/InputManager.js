const KEY_BINDINGS = {
  forward: new Set(['KeyW']),
  backward: new Set(['KeyS']),
  left: new Set(['KeyA']),
  right: new Set(['KeyD']),
  jump: new Set(['Space']),
  crouch: new Set(['ShiftLeft', 'ShiftRight']),
};

const LOOK_KEY_BINDINGS = {
  yawLeft: new Set(['ArrowLeft']),
  yawRight: new Set(['ArrowRight']),
  pitchUp: new Set(['ArrowUp']),
  pitchDown: new Set(['ArrowDown']),
};

const LOOK_SENSITIVITY = (Math.PI / 180) * 0.12; // radians per pixel
const MAX_PITCH = (Math.PI / 2) * 0.96;
const HOTBAR_SLOT_COUNT = 9;
const SPRINT_DOUBLE_TAP_INTERVAL_MS = 360;
const KEY_LOOK_SPEED = (Math.PI / 180) * 120; // radians per second

const GAMEPAD_DEADZONE = 0.08;
const GAMEPAD_LOOK_SPEED = 5.5; // Multiplier for look
const TOUCH_LOOK_MULTIPLIER = 0.85;
const TOUCH_MOVE_DEADZONE = 0.12;
const GAMEPAD_BUTTONS = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
};

export class InputManager {
  constructor({ canvas, overlay, crosshair, onPointerLockChanged } = {}) {
    this.canvas = canvas;
    this.overlay = overlay ?? null;
    this.crosshair = crosshair ?? null;
    this.onPointerLockChanged = onPointerLockChanged ?? (() => {});

    this._keys = new Set();
    this._moveAxis = { x: 0, y: 0 };
    this._lookDelta = { x: 0, y: 0 };
    this._lookKeys = {
      yawLeft: false,
      yawRight: false,
      pitchUp: false,
      pitchDown: false,
    };
    this._keyLookAxis = { x: 0, y: 0 };
    this._jumpRequested = false;
    this._sprintActive = false;
    this._sprintSources = new Set();
    this._crouchHold = false;
    this._crouchToggle = false;
    this._lastForwardReleaseTime = 0;
    this._touchSprintPointers = new Set();
    this._pointerLocked = false;
    this._yaw = 0;
    this._pitch = 0;
    this._hotbarIndex = 0;
    this._hotbarDirty = true;
    this._toggleHudDetailsRequested = false;
    this._cycleCameraViewRequested = false;
    this._touchSprintButton = null;
    this._touchCrouchButton = null;
    this._lastPollTime = this._now();
    this._prevGamepadButtons = new Array(16).fill(false);
    this._gamepadActionState = { break: false, place: false };
    this._gamepadMove = { x: 0, y: 0 };
    this._touchActionState = { break: false, place: false };
    this._touchMoveAxis = { x: 0, y: 0 };
    this._touchMovePointerId = null;
    this._touchLookPointerId = null;
    this._touchLookLast = null;
    this._usingGamepad = false;
    this._usingTouch = false;
    this._touchSupported = this._detectTouchSupport();
    this._touchControlsEl = null;
    this._touchMovePad = null;
    this._touchMoveKnob = null;
    this._touchJumpButton = null;
    this._touchAttackButton = null;
    this._touchPlaceButton = null;

    this._handleKeyDown = (event) => this._onKeyDown(event);
    this._handleKeyUp = (event) => this._onKeyUp(event);
    this._handlePointerMove = (event) => this._onPointerMove(event);
    this._handlePointerLockChange = () => this._syncPointerLockState();
    this._handlePointerLockError = () => this._onPointerLockError();
    this._handleBlur = () => this._resetKeys();
    this._handleOverlayPointerDown = (event) => this._onOverlayPointerDown(event);
    this._handleCanvasPointerDown = (event) => this._onCanvasPointerDown(event);
    this._handleCanvasPointerMove = (event) => this._onCanvasPointerMove(event);
    this._handleCanvasPointerUp = (event) => this._onCanvasPointerUp(event);
    this._handleTouchMoveStart = (event) => this._onTouchMoveStart(event);
    this._handleTouchMoveDrag = (event) => this._onTouchMoveDrag(event);
    this._handleTouchMoveEnd = (event) => this._onTouchMoveEnd(event);
    this._handleTouchJump = (event) => this._onTouchJump(event);
    this._handleTouchAttack = (event) => this._onTouchAttack(event);
    this._handleTouchPlace = (event) => this._onTouchPlace(event);
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
      this.canvas.addEventListener('pointerdown', this._handleCanvasPointerDown);
      this.canvas.addEventListener('pointermove', this._handleCanvasPointerMove);
      this.canvas.addEventListener('pointerup', this._handleCanvasPointerUp);
      this.canvas.addEventListener('pointercancel', this._handleCanvasPointerUp);
    }

    this._bindTouchButtons();

    this._syncPointerLockState({ force: true });
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
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this._handleCanvasPointerDown);
      this.canvas.removeEventListener('pointermove', this._handleCanvasPointerMove);
      this.canvas.removeEventListener('pointerup', this._handleCanvasPointerUp);
      this.canvas.removeEventListener('pointercancel', this._handleCanvasPointerUp);
    }
    if (this._touchMovePad) {
      this._touchMovePad.removeEventListener('pointerdown', this._handleTouchMoveStart);
      this._touchMovePad.removeEventListener('pointermove', this._handleTouchMoveDrag);
      this._touchMovePad.removeEventListener('pointerup', this._handleTouchMoveEnd);
      this._touchMovePad.removeEventListener('pointercancel', this._handleTouchMoveEnd);
      this._touchMovePad = null;
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
    if (this._touchJumpButton) {
      this._touchJumpButton.removeEventListener('pointerdown', this._handleTouchJump);
      this._touchJumpButton = null;
    }
    if (this._touchAttackButton) {
      this._touchAttackButton.removeEventListener('pointerdown', this._handleTouchAttack);
      this._touchAttackButton = null;
    }
    if (this._touchPlaceButton) {
      this._touchPlaceButton.removeEventListener('pointerdown', this._handleTouchPlace);
      this._touchPlaceButton = null;
    }
    this._touchControlsEl = null;
    this._touchMoveKnob = null;
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

  isTouchMode() {
    return this._usingTouch;
  }

  isUsingGamepad() {
    return this._usingGamepad;
  }

  _now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  poll() {
    const now = this._now();
    let deltaSeconds = 0;
    if (this._lastPollTime != null) {
      deltaSeconds = Math.min(Math.max((now - this._lastPollTime) * 0.001, 0), 0.25);
    }
    this._lastPollTime = now;

    this._pollGamepad(deltaSeconds);
    this._syncInteractionUi();

    // Combine keyboard and gamepad movement
    const moveX = this._moveAxis.x + this._gamepadMove.x + this._touchMoveAxis.x;
    const moveY = this._moveAxis.y + this._gamepadMove.y + this._touchMoveAxis.y;

    // Clamp combined movement to max length 1.0
    const moveLenSq = moveX * moveX + moveY * moveY;
    const scale = moveLenSq > 1 ? 1 / Math.sqrt(moveLenSq) : 1;
    
    const move = { x: moveX * scale, y: moveY * scale };
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

    const keyLookX = this._keyLookAxis.x;
    const keyLookY = this._keyLookAxis.y;
    if (keyLookX !== 0 || keyLookY !== 0) {
      const yawDelta = keyLookX * KEY_LOOK_SPEED * deltaSeconds;
      const pitchDelta = keyLookY * KEY_LOOK_SPEED * deltaSeconds;
      this._yaw += yawDelta;
      this._pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this._pitch + pitchDelta));
    }

    this._lookDelta.x = 0;
    this._lookDelta.y = 0;
    this._jumpRequested = false;

    const actions = {
      break: this._gamepadActionState.break || this._touchActionState.break,
      place: this._gamepadActionState.place || this._touchActionState.place,
    };
    this._gamepadActionState.break = false;
    this._gamepadActionState.place = false;
    this._touchActionState.break = false;
    this._touchActionState.place = false;

    return {
      move,
      look: { yaw: this._yaw, pitch: this._pitch },
      jump,
      crouch,
      sprint,
      pointerLocked: this._pointerLocked,
      usingGamepad: this._usingGamepad,
      usingTouch: this._usingTouch,
      hotbarIndex: this._hotbarIndex,
      hotbarChanged: this._consumeHotbarDirty(),
      toggleHudDetails: this._consumeToggleHudDetails(),
      cycleCameraView: this._consumeCycleCameraView(),
      actions,
    };
  }

  _pollGamepad(deltaSeconds) {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) {
        this._usingGamepad = false;
        return;
    }

    const gamepads = navigator.getGamepads();
    const gamepad = gamepads[0]; // Use the first connected gamepad
    this._usingGamepad = !!gamepad;

    if (!gamepad) return;

    // Axes
    const leftX = Math.abs(gamepad.axes[0]) > GAMEPAD_DEADZONE ? gamepad.axes[0] : 0;
    const leftY = Math.abs(gamepad.axes[1]) > GAMEPAD_DEADZONE ? gamepad.axes[1] : 0;
    const rightX = Math.abs(gamepad.axes[2]) > GAMEPAD_DEADZONE ? gamepad.axes[2] : 0;
    const rightY = Math.abs(gamepad.axes[3]) > GAMEPAD_DEADZONE ? gamepad.axes[3] : 0;

    // Update gamepad move vector directly (always update to allow returning to 0)
    this._gamepadMove.x = leftX;
    this._gamepadMove.y = -leftY; // Invert Y for standard forward/back

    // Apply look directly to yaw/pitch (scaled) with squared curve for precision
    if (rightX !== 0 || rightY !== 0) {
      const yawDelta = (rightX * Math.abs(rightX)) * GAMEPAD_LOOK_SPEED * deltaSeconds;
      const pitchDelta = (rightY * Math.abs(rightY)) * GAMEPAD_LOOK_SPEED * deltaSeconds;
      
      this._yaw += yawDelta;
      this._pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this._pitch + pitchDelta));
    }


    // Buttons
    const buttons = gamepad.buttons;
    const pressed = (idx) => buttons[idx] && (typeof buttons[idx] === 'object' ? buttons[idx].pressed : buttons[idx] === 1.0);
    
    // Jump (A)
    if (pressed(GAMEPAD_BUTTONS.A)) {
      this._jumpRequested = true;
    }

    // Crouch (B or R3)
    const crouchPressed = pressed(GAMEPAD_BUTTONS.B) || pressed(GAMEPAD_BUTTONS.R3);
    this._setCrouchHold(crouchPressed);

    // Sprint (L3 - Toggle)
    if (pressed(GAMEPAD_BUTTONS.L3) && !this._prevGamepadButtons[GAMEPAD_BUTTONS.L3]) {
      // Toggle sprint on press
      const nextState = !this._sprintActive;
      this._setSprintSource('gamepad', nextState);
    }

    // Hotbar (LB/RB)
    if (pressed(GAMEPAD_BUTTONS.LB) && !this._prevGamepadButtons[GAMEPAD_BUTTONS.LB]) {
      this._setHotbarIndex(this._hotbarIndex - 1 < 0 ? HOTBAR_SLOT_COUNT - 1 : this._hotbarIndex - 1);
    }
    if (pressed(GAMEPAD_BUTTONS.RB) && !this._prevGamepadButtons[GAMEPAD_BUTTONS.RB]) {
      this._setHotbarIndex((this._hotbarIndex + 1) % HOTBAR_SLOT_COUNT);
    }

    // Actions (LT/RT)
    // Break (RT)
    if (pressed(GAMEPAD_BUTTONS.RT) && !this._prevGamepadButtons[GAMEPAD_BUTTONS.RT]) {
      this._gamepadActionState.break = true;
    }
    // Place (LT)
    if (pressed(GAMEPAD_BUTTONS.LT) && !this._prevGamepadButtons[GAMEPAD_BUTTONS.LT]) {
      this._gamepadActionState.place = true;
    }
    
    // Update previous state
    for (let i = 0; i < this._prevGamepadButtons.length; i++) {
      this._prevGamepadButtons[i] = pressed(i);
    }
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

  _consumeCycleCameraView() {
    const requested = this._cycleCameraViewRequested;
    this._cycleCameraViewRequested = false;
    return requested;
  }

  _onKeyDown(event) {
    const globalAction =
      event.code === 'F5' ||
      event.code === 'KeyI' ||
      event.code === 'KeyC' ||
      event.code.startsWith('Digit');
    if (!this._pointerLocked && !KEY_BINDINGS.jump.has(event.code) && !this._isLookKey(event.code) && !globalAction) return;

    if (event.repeat) return;
    this._keys.add(event.code);
    this._updateAxes();

    const handledLook = this._setLookKeyFromCode(event.code, true);
    if (handledLook) {
      event.preventDefault();
    }

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

    if (event.code === 'F5') {
      event.preventDefault();
      this._cycleCameraViewRequested = true;
    }
  }

  _onKeyUp(event) {
    this._keys.delete(event.code);
    this._updateAxes();

    const handledLook = this._setLookKeyFromCode(event.code, false);
    if (handledLook) {
      event.preventDefault();
    }

    if (KEY_BINDINGS.crouch.has(event.code)) {
      this._setCrouchHold(false);
    }

    if (KEY_BINDINGS.forward.has(event.code)) {
      this._setSprintSource('doubleTap', false);
      this._lastForwardReleaseTime = this._now();
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

  _syncPointerLockState({ force = false } = {}) {
    const locked = document.pointerLockElement === this.canvas;
    if (!force && locked === this._pointerLocked) {
      this._syncInteractionUi();
      return;
    }
    this._pointerLocked = locked;

    if (!locked) {
      this._resetKeys();
    }

    this._syncInteractionUi();
    this.onPointerLockChanged(locked);
  }

  _resetKeys() {
    if (this._keys.size > 0) {
      this._keys.clear();
      this._updateAxes();
    }
    this._lookKeys.yawLeft = false;
    this._lookKeys.yawRight = false;
    this._lookKeys.pitchUp = false;
    this._lookKeys.pitchDown = false;
    this._keyLookAxis.x = 0;
    this._keyLookAxis.y = 0;
    this._crouchHold = false;
    this._clearTouchMoveAxis();
    this._touchLookPointerId = null;
    this._touchLookLast = null;
    this._touchActionState.break = false;
    this._touchActionState.place = false;
    this._touchSprintPointers.clear();
    this._clearSprintSources();
    this._updateCrouchIndicator();
    this._lastForwardReleaseTime = 0;
    this._lastPollTime = this._now();
  }

  _onPointerLockError() {
    if (!document.pointerLockElement && this.overlay) {
      this.overlay.classList.remove('hidden');
    }
  }

  _onOverlayPointerDown(event) {
    if (this._pointerLocked) return;
    if (this._isTouchPointer(event)) {
      event.preventDefault();
      this._setTouchMode(true);
      return;
    }
    if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    event.preventDefault();
    this.requestPointerLock({ source: 'overlay' });
  }

  _onCanvasPointerDown(event) {
    if (this._isTouchPointer(event)) {
      if (!this._usingTouch) {
        this._setTouchMode(true);
      }
      if (event.target !== this.canvas || this._touchLookPointerId !== null) return;
      event.preventDefault();
      this._touchLookPointerId = event.pointerId;
      this._touchLookLast = { x: event.clientX, y: event.clientY };
      if (event.target?.setPointerCapture) {
        try {
          event.target.setPointerCapture(event.pointerId);
        } catch (error) {
          // ignore capture failures
        }
      }
      return;
    }

    if (this._usingTouch) {
      this._setTouchMode(false);
    }
    if (!this._pointerLocked) {
      this.requestPointerLock({ source: 'canvas' });
    }
  }

  _onCanvasPointerMove(event) {
    if (!this._isTouchPointer(event)) return;
    if (event.pointerId !== this._touchLookPointerId || !this._touchLookLast) return;
    const deltaX = event.clientX - this._touchLookLast.x;
    const deltaY = event.clientY - this._touchLookLast.y;
    this._touchLookLast = { x: event.clientX, y: event.clientY };
    this._lookDelta.x += deltaX * TOUCH_LOOK_MULTIPLIER;
    this._lookDelta.y += deltaY * TOUCH_LOOK_MULTIPLIER;
  }

  _onCanvasPointerUp(event) {
    if (!this._isTouchPointer(event)) return;
    if (event.pointerId !== this._touchLookPointerId) return;
    if (event.target?.releasePointerCapture) {
      try {
        event.target.releasePointerCapture(event.pointerId);
      } catch (error) {
        // ignore release failures
      }
    }
    this._touchLookPointerId = null;
    this._touchLookLast = null;
  }

  _isLookKey(code) {
    return LOOK_KEY_BINDINGS.yawLeft.has(code) ||
      LOOK_KEY_BINDINGS.yawRight.has(code) ||
      LOOK_KEY_BINDINGS.pitchUp.has(code) ||
      LOOK_KEY_BINDINGS.pitchDown.has(code);
  }

  _setLookKeyFromCode(code, active) {
    let matched = false;
    if (LOOK_KEY_BINDINGS.yawLeft.has(code)) {
      this._lookKeys.yawLeft = active;
      matched = true;
    } else if (LOOK_KEY_BINDINGS.yawRight.has(code)) {
      this._lookKeys.yawRight = active;
      matched = true;
    } else if (LOOK_KEY_BINDINGS.pitchUp.has(code)) {
      this._lookKeys.pitchUp = active;
      matched = true;
    } else if (LOOK_KEY_BINDINGS.pitchDown.has(code)) {
      this._lookKeys.pitchDown = active;
      matched = true;
    }

    if (matched) {
      this._recomputeKeyLookAxis();
    }
    return matched;
  }

  _recomputeKeyLookAxis() {
    this._keyLookAxis.x = (this._lookKeys.yawRight ? 1 : 0) - (this._lookKeys.yawLeft ? 1 : 0);
    this._keyLookAxis.y = (this._lookKeys.pitchDown ? 1 : 0) - (this._lookKeys.pitchUp ? 1 : 0);
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
      this._lastForwardReleaseTime = 0;
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
    const now = this._now();
    const lastRelease = this._lastForwardReleaseTime;
    if (this._pointerLocked && lastRelease && (now - lastRelease) <= SPRINT_DOUBLE_TAP_INTERVAL_MS) {
      this._setSprintSource('doubleTap', true);
    }
  }

  _bindTouchButtons() {
    if (typeof document === 'undefined') return;
    this._touchControlsEl = document.getElementById('touch-controls');
    this._touchMovePad = document.getElementById('touch-move-pad');
    this._touchMoveKnob = document.getElementById('touch-move-knob');
    this._touchJumpButton = document.getElementById('touch-action-jump');
    this._touchAttackButton = document.getElementById('touch-action-attack');
    this._touchPlaceButton = document.getElementById('touch-action-place');
    this._touchSprintButton = document.getElementById('touch-action-sprint');
    this._touchCrouchButton = document.getElementById('touch-action-crouch');

    if (this._touchMovePad) {
      this._touchMovePad.addEventListener('pointerdown', this._handleTouchMoveStart);
      this._touchMovePad.addEventListener('pointermove', this._handleTouchMoveDrag);
      this._touchMovePad.addEventListener('pointerup', this._handleTouchMoveEnd);
      this._touchMovePad.addEventListener('pointercancel', this._handleTouchMoveEnd);
    }
    if (this._touchJumpButton) {
      this._touchJumpButton.addEventListener('pointerdown', this._handleTouchJump);
    }
    if (this._touchAttackButton) {
      this._touchAttackButton.addEventListener('pointerdown', this._handleTouchAttack);
    }
    if (this._touchPlaceButton) {
      this._touchPlaceButton.addEventListener('pointerdown', this._handleTouchPlace);
    }
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
    this._syncInteractionUi();
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
    this._setTouchMode(true);
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
    this._setTouchMode(true);
    this._toggleCrouch();
  }

  _onTouchMoveStart(event) {
    if (!this._isTouchPointer(event)) return;
    event.preventDefault();
    this._setTouchMode(true);
    this._touchMovePointerId = event.pointerId;
    if (event.target?.setPointerCapture) {
      try {
        event.target.setPointerCapture(event.pointerId);
      } catch (error) {
        // ignore capture failures
      }
    }
    this._updateTouchMoveAxis(event);
  }

  _onTouchMoveDrag(event) {
    if (!this._isTouchPointer(event)) return;
    if (event.pointerId !== this._touchMovePointerId) return;
    event.preventDefault();
    this._updateTouchMoveAxis(event);
  }

  _onTouchMoveEnd(event) {
    if (!this._isTouchPointer(event)) return;
    if (event.pointerId !== this._touchMovePointerId) return;
    if (event.target?.releasePointerCapture) {
      try {
        event.target.releasePointerCapture(event.pointerId);
      } catch (error) {
        // ignore release failures
      }
    }
    this._touchMovePointerId = null;
    this._clearTouchMoveAxis();
  }

  _onTouchJump(event) {
    if (!this._isTouchPointer(event)) return;
    event.preventDefault();
    this._setTouchMode(true);
    this._jumpRequested = true;
  }

  _onTouchAttack(event) {
    if (!this._isTouchPointer(event)) return;
    event.preventDefault();
    this._setTouchMode(true);
    this._touchActionState.break = true;
  }

  _onTouchPlace(event) {
    if (!this._isTouchPointer(event)) return;
    event.preventDefault();
    this._setTouchMode(true);
    this._touchActionState.place = true;
  }

  _detectTouchSupport() {
    if (typeof navigator !== 'undefined' && Number.isFinite(navigator.maxTouchPoints) && navigator.maxTouchPoints > 0) {
      return true;
    }
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        if (window.matchMedia('(pointer: coarse)').matches) {
          return true;
        }
      } catch (error) {
        // ignore media query failures
      }
    }
    return typeof window !== 'undefined' && 'ontouchstart' in window;
  }

  _setTouchMode(active) {
    const next = Boolean(active && this._touchSupported);
    if (this._usingTouch === next) {
      this._syncInteractionUi();
      return;
    }
    this._usingTouch = next;
    if (!next) {
      this._touchLookPointerId = null;
      this._touchLookLast = null;
      this._clearTouchMoveAxis();
    }
    this._syncInteractionUi();
  }

  _syncInteractionUi() {
    const interactionActive = this._pointerLocked || this._usingTouch || this._usingGamepad;
    if (this.overlay) {
      this.overlay.classList.toggle('hidden', interactionActive);
    }
    if (this.crosshair) {
      this.crosshair.classList.toggle('hidden', !interactionActive);
    }
    if (this._touchControlsEl) {
      this._touchControlsEl.classList.toggle('hidden', !this._usingTouch);
      this._touchControlsEl.setAttribute('aria-hidden', String(!this._usingTouch));
    }
  }

  _updateTouchMoveAxis(event) {
    if (!this._touchMovePad) return;
    const rect = this._touchMovePad.getBoundingClientRect();
    const centerX = rect.left + rect.width * 0.5;
    const centerY = rect.top + rect.height * 0.5;
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.5);
    let dx = (event.clientX - centerX) / radius;
    let dy = (event.clientY - centerY) / radius;
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }
    if (length < TOUCH_MOVE_DEADZONE) {
      dx = 0;
      dy = 0;
    }
    this._touchMoveAxis.x = dx;
    this._touchMoveAxis.y = -dy;
    if (this._touchMoveKnob) {
      const knobTravel = radius * 0.45;
      this._touchMoveKnob.style.setProperty('--knob-x', `${dx * knobTravel}px`);
      this._touchMoveKnob.style.setProperty('--knob-y', `${dy * knobTravel}px`);
    }
  }

  _clearTouchMoveAxis() {
    this._touchMoveAxis.x = 0;
    this._touchMoveAxis.y = 0;
    if (this._touchMoveKnob) {
      this._touchMoveKnob.style.setProperty('--knob-x', '0px');
      this._touchMoveKnob.style.setProperty('--knob-y', '0px');
    }
  }
}
