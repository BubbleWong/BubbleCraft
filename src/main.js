import * as THREE from './vendor/three.module.js';
import { PointerLockControls } from './vendor/PointerLockControls.js';
import { World, BLOCK_TYPES, CHUNK_HEIGHT } from './world.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 75, 250);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
const controls = new PointerLockControls(camera, document.body);
scene.add(controls.getObject());

const hemisphere = new THREE.HemisphereLight(0xffffff, 0x506070, 0.55);
scene.add(hemisphere);

const sun = new THREE.DirectionalLight(0xffffff, 0.85);
sun.position.set(60, 120, 40);
scene.add(sun);

const world = new World(scene);
world.generate(2);

const spawn = world.getSpawnPoint();
controls.getObject().position.copy(spawn);
controls.getObject().position.y = Math.min(spawn.y, CHUNK_HEIGHT - 1);

overlay.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => overlay.classList.add('hidden'));
controls.addEventListener('unlock', () => overlay.classList.remove('hidden'));

const keyState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
};
let canJump = false;
const velocity = new THREE.Vector3(0, 0, 0);
const direction = new THREE.Vector3();
const playerHeight = 1.75;
const gravity = 40;
const walkAcceleration = 140;
const sprintMultiplier = 1.75;
const jumpImpulse = 15;

function setMovementState(code, pressed) {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':
      keyState.forward = pressed;
      break;
    case 'KeyS':
    case 'ArrowDown':
      keyState.backward = pressed;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      keyState.left = pressed;
      break;
    case 'KeyD':
    case 'ArrowRight':
      keyState.right = pressed;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      keyState.sprint = pressed;
      break;
    case 'Space':
      if (pressed && canJump) {
        velocity.y = jumpImpulse;
        canJump = false;
      }
      break;
    default:
      break;
  }
}

document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  setMovementState(event.code, true);
});

document.addEventListener('keyup', (event) => {
  setMovementState(event.code, false);
});

const raycaster = new THREE.Raycaster();
raycaster.far = 8;

function refreshRaycaster() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
}

document.addEventListener('mousedown', (event) => {
  if (!controls.isLocked) return;
  refreshRaycaster();

  if (event.button === 0) {
    const target = world.getRaycastTarget(raycaster, { place: false });
    if (target) {
      world.setBlock(target.x, target.y, target.z, BLOCK_TYPES.air);
    }
  } else if (event.button === 2) {
    event.preventDefault();
    const target = world.getRaycastTarget(raycaster, { place: true });
    if (target && target.y >= 0 && target.y < CHUNK_HEIGHT - 1) {
      const playerPos = controls.getObject().position;
      const distance = Math.hypot(target.x + 0.5 - playerPos.x, target.y + 0.5 - playerPos.y, target.z + 0.5 - playerPos.z);
      if (distance > 1.75) {
        world.setBlock(target.x, target.y, target.z, BLOCK_TYPES.grass);
      }
    }
  }
});

document.addEventListener('contextmenu', (event) => {
  if (controls.isLocked) event.preventDefault();
});

const clock = new THREE.Clock();

function updatePhysics(delta) {
  if (!controls.isLocked) return;

  velocity.x -= velocity.x * 10 * delta;
  velocity.z -= velocity.z * 10 * delta;
  velocity.y -= gravity * delta;

  direction.z = Number(keyState.forward) - Number(keyState.backward);
  direction.x = Number(keyState.right) - Number(keyState.left);
  direction.normalize();

  const accel = walkAcceleration * (keyState.sprint ? sprintMultiplier : 1);

  if (direction.z !== 0) velocity.z -= direction.z * accel * delta;
  if (direction.x !== 0) velocity.x -= direction.x * accel * delta;

  controls.moveRight(-velocity.x * delta);
  controls.moveForward(-velocity.z * delta);

  const object = controls.getObject();
  object.position.y += velocity.y * delta;

  const ground = world.getHeightAt(Math.floor(object.position.x), Math.floor(object.position.z)) + playerHeight;
  if (object.position.y < ground) {
    velocity.y = 0;
    object.position.y = ground;
    canJump = true;
  }
}

function animate() {
  const delta = Math.min(0.05, clock.getDelta());
  updatePhysics(delta);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
