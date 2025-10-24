export class GameContext {
  constructor({
    engine = null,
    scene = null,
    camera = null,
    eventBus = null,
  } = {}) {
    this.engine = engine;
    this.scene = scene;
    this.camera = camera;
    this.eventBus = eventBus;
    this.services = new Map();
  }

  registerService(key, service) {
    if (!key) throw new Error('Service key is required');
    this.services.set(key, service);
  }

  getService(key) {
    return this.services.get(key) ?? null;
  }

  dispose() {
    this.services.clear();
  }
}
