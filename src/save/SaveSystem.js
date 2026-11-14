const SAVE_VERSION = 1;

/**
 * Save system scaffold.
 *
 * The payload is versioned and namespaced so player pose, settings, crop and
 * water state can be stored together. Version 3 does not auto-save a pose from
 * the walkthrough; only UI settings are persisted today.
 */
export class SaveSystem {
  constructor({ key = 'verde-block4:save', storage = window.localStorage } = {}) {
    this.key = key;
    this.storage = storage;
  }

  hasSave() {
    try {
      return Boolean(this.storage.getItem(this.key));
    } catch (error) {
      return false;
    }
  }

  save({ player, settings, plants, water } = {}) {
    const payload = {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      player: player
        ? { x: player.position.x, z: player.position.z, yaw: player.yaw, pitch: player.pitch }
        : null,
      settings: settings ?? null,
      plants: plants ? { elapsedSeconds: plants.elapsedSeconds } : null,
      water: water ? { elapsedSeconds: water.elapsedSeconds } : null,
    };
    try {
      this.storage.setItem(this.key, JSON.stringify(payload));
      return payload;
    } catch (error) {
      return null;
    }
  }

  load() {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.version !== SAVE_VERSION) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  clear() {
    try {
      this.storage.removeItem(this.key);
    } catch (error) {
      // Nothing to do — storage unavailable.
    }
  }
}
