import * as Phaser from 'phaser';

// ==========================================================================
// GLOBAL AUDIO MANAGER
// Singleton that centralises all sound playback so every SFX and music
// track respects the player's volume preferences.
// ==========================================================================
export class AudioManager {
  private static _instance: AudioManager;

  /** Master SFX volume multiplier (0.0 – 1.0). */
  masterSfxVolume: number = 1.0;

  /** Master Music volume multiplier (0.0 – 1.0). */
  masterMusicVolume: number = 1.0;

  private _scene: Phaser.Scene | null = null;
  private _lastProjectileHitSound: string = '';

  private constructor() {
    this._loadPreferences();
  }

  /** Returns the singleton instance (creates it on first call). */
  static getInstance(): AudioManager {
    if (!AudioManager._instance) {
      AudioManager._instance = new AudioManager();
    }
    return AudioManager._instance;
  }

  /**
   * Must be called once during the Phaser scene's `create()` phase so the
   * manager has access to the Phaser sound system.
   */
  init(scene: Phaser.Scene): void {
    this._scene = scene;
  }

  /**
   * Play a sound effect.  The final volume is `baseVolume * masterSfxVolume`.
   * Silently skips if the audio key has not been loaded into the cache.
   */
  playSfx(key: string, baseVolume: number = 1.0): void {
    this._play(key, baseVolume * this.masterSfxVolume, false);
  }

  /**
   * Play a looping music track.  The final volume is
   * `baseVolume * masterMusicVolume`.
   * Silently skips if the audio key has not been loaded into the cache.
   */
  playMusic(key: string, baseVolume: number = 1.0): void {
    this._play(key, baseVolume * this.masterMusicVolume, true);
  }

  private _play(key: string, volume: number, loop: boolean): void {
    if (!this._scene || !key || volume <= 0) return;
    try {
      if (this._scene.cache.audio.has(key)) {
        this._scene.sound.play(key, { volume, loop });
      }
    } catch (_) { /* silently ignore any playback errors */ }
  }

  /**
   * Store the sound key of the most recently destroyed projectile so the
   * renderer can play it the instant an entity's HP drops.
   */
  setLastProjectileHitSound(soundKey: string): void {
    this._lastProjectileHitSound = soundKey;
  }

  /**
   * Play the sound that was stored by the last `setLastProjectileHitSound`
   * call.  Called from RenderSystems when an entity flashes white.
   */
  playLastProjectileHitSound(): void {
    if (this._lastProjectileHitSound) {
      this.playSfx(this._lastProjectileHitSound);
    }
  }

  /** Update master SFX volume and persist to localStorage. */
  setSfxVolume(value: number): void {
    this.masterSfxVolume = Math.max(0, Math.min(1, value));
    this._savePreferences();
  }

  /** Update master Music volume and persist to localStorage. */
  setMusicVolume(value: number): void {
    this.masterMusicVolume = Math.max(0, Math.min(1, value));
    this._savePreferences();
  }

  private _savePreferences(): void {
    try {
      localStorage.setItem('sfxVolume', this.masterSfxVolume.toString());
      localStorage.setItem('musicVolume', this.masterMusicVolume.toString());
    } catch (_) { /* ignore in environments without localStorage */ }
  }

  private _loadPreferences(): void {
    try {
      const sfx = localStorage.getItem('sfxVolume');
      const music = localStorage.getItem('musicVolume');
      if (sfx !== null) this.masterSfxVolume = Math.max(0, Math.min(1, parseFloat(sfx)));
      if (music !== null) this.masterMusicVolume = Math.max(0, Math.min(1, parseFloat(music)));
    } catch (_) { /* ignore */ }
  }
}
