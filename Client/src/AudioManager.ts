import * as Phaser from 'phaser';

// ==========================================================================
// GLOBAL AUDIO MANAGER (Upgraded for Spatial Audio & Anti-Fatigue)
// ==========================================================================
export class AudioManager {
  private static _instance: AudioManager;

  masterSfxVolume: number = 1.0;
  masterMusicVolume: number = 1.0;

  private _scene: Phaser.Scene | null = null;
  private _lastProjectileHitSound: string = '';
  
  // Track when a sound was last played to prevent harsh overlapping
  private _lastPlayedTime: Map<string, number> = new Map();

  private constructor() {
    this._loadPreferences();
  }

  static getInstance(): AudioManager {
    if (!AudioManager._instance) {
      AudioManager._instance = new AudioManager();
    }
    return AudioManager._instance;
  }

  init(scene: Phaser.Scene): void {
    this._scene = scene;
  }

  /**
   * Play an SFX with Spatial Audio and Anti-Fatigue!
   * @param sourcePos Pass {x, y} to make the sound quieter if it's far from the camera!
   */
  playSfx(key: string, baseVolume: number = 1.0, sourcePos?: { x: number, y: number }): void {
    if (!this._scene || !key) return;

    // 1. ANTI-FATIGUE (Debounce)
    // Prevent the EXACT same sound from playing more than once every 40ms. 
    // This stops that harsh, robotic clipping noise when attack speed is very high!
    const now = this._scene.time.now;
    const lastPlayed = this._lastPlayedTime.get(key) || 0;
    if (now - lastPlayed < 40) return; 
    this._lastPlayedTime.set(key, now);

    // 2. SPATIAL AUDIO (Distance Attenuation)
    let spatialVolume = 1.0;
    if (sourcePos) {
      const cam = this._scene.cameras.main;
      // Calculate distance from the exact center of the player's screen to the sound
      const dist = Phaser.Math.Distance.Between(cam.midPoint.x, cam.midPoint.y, sourcePos.x, sourcePos.y);
      
      // If the sound is further than 80% of the screen width, it starts fading out
      const maxAudibleDist = Math.max(cam.width, cam.height) * 0.8; 
      
      // Decrease volume linearly as it gets further away
      spatialVolume = Phaser.Math.Clamp(1.0 - (dist / maxAudibleDist), 0, 1);
    }

    if (spatialVolume <= 0) return; // Don't play it at all if it's completely off-screen!

    // 3. PITCH VARIATION
    // Slightly randomize the pitch (-100 to 100 cents) so fast attacks sound organic!
    const randomDetune = Phaser.Math.Between(-100, 100);
    const finalVolume = baseVolume * this.masterSfxVolume * spatialVolume;

    try {
      if (this._scene.cache.audio.has(key)) {
        this._scene.sound.play(key, { volume: finalVolume, detune: randomDetune });
      }
    } catch (_) { }
  }

  playMusic(key: string, baseVolume: number = 1.0): void {
    if (!this._scene || !key || this.masterMusicVolume <= 0) return;
    try {
      if (this._scene.cache.audio.has(key)) {
        this._scene.sound.play(key, { volume: baseVolume * this.masterMusicVolume, loop: true });
      }
    } catch (_) { }
  }

  setLastProjectileHitSound(soundKey: string): void {
    this._lastProjectileHitSound = soundKey;
  }

  playLastProjectileHitSound(sourcePos?: { x: number, y: number }): void {
    if (this._lastProjectileHitSound) {
      this.playSfx(this._lastProjectileHitSound, 1.0, sourcePos);
    }
  }

  setSfxVolume(value: number): void {
    this.masterSfxVolume = Math.max(0, Math.min(1, value));
    this._savePreferences();
  }

  setMusicVolume(value: number): void {
    this.masterMusicVolume = Math.max(0, Math.min(1, value));
    this._savePreferences();
  }

  private _savePreferences(): void {
    try {
      localStorage.setItem('sfxVolume', this.masterSfxVolume.toString());
      localStorage.setItem('musicVolume', this.masterMusicVolume.toString());
    } catch (_) { }
  }

  private _loadPreferences(): void {
    try {
      const sfx = localStorage.getItem('sfxVolume');
      const music = localStorage.getItem('musicVolume');
      if (sfx !== null) this.masterSfxVolume = Math.max(0, Math.min(1, parseFloat(sfx)));
      if (music !== null) this.masterMusicVolume = Math.max(0, Math.min(1, parseFloat(music)));
    } catch (_) { }
  }
}