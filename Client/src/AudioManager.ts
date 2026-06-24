import * as Phaser from 'phaser';

export class AudioManager {
  private static instance: AudioManager;

  // Core Volumes
  public masterVolume: number = 1.0;
  public sfxVolume: number = 1.0;
  public musicVolume: number = 1.0;

  // UI Specific Volume
  public uiVolume: number = 1.0;

  private scene?: Phaser.Scene;
  private currentMusic?: Phaser.Sound.BaseSound;

  private constructor() {
    // Load saved volumes from LocalStorage so they persist across reloads
    const savedMaster = localStorage.getItem('masterVolume');
    const savedSfx = localStorage.getItem('sfxVolume');
    const savedMusic = localStorage.getItem('musicVolume');
    const savedUi = localStorage.getItem('uiVolume'); // <--- NEW

    if (savedMaster !== null) this.masterVolume = parseFloat(savedMaster);
    if (savedSfx !== null) this.sfxVolume = parseFloat(savedSfx);
    if (savedMusic !== null) this.musicVolume = parseFloat(savedMusic);
    if (savedUi !== null) this.uiVolume = parseFloat(savedUi);
  }
  // >>> RESTORED PROJECTILE LOGIC <<<
  private lastProjectileHitSound: string = '';

  public init(scene: Phaser.Scene) {
    this.setScene(scene);
  }

  public setLastProjectileHitSound(key: string) {
    this.lastProjectileHitSound = key;
  }

  public playLastProjectileHitSound() {
    if (this.lastProjectileHitSound) {
      this.playSfx(this.lastProjectileHitSound);
    }
  }

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  public setScene(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // --- VOLUME SETTERS (Saves automatically) ---
  public setUiVolume(vol: number) {
    this.uiVolume = Phaser.Math.Clamp(vol, 0, 1);
    localStorage.setItem('uiVolume', this.uiVolume.toString());
  }

  public setMasterVolume(vol: number) {
    this.masterVolume = Phaser.Math.Clamp(vol, 0, 1);
    localStorage.setItem('masterVolume', this.masterVolume.toString());
    // Update currently playing music
    if (this.currentMusic && this.currentMusic.isPlaying) {
      (this.currentMusic as any).setVolume(this.musicVolume * this.masterVolume);
    }
  }

  public setSfxVolume(vol: number) {
    this.sfxVolume = Phaser.Math.Clamp(vol, 0, 1);
    localStorage.setItem('sfxVolume', this.sfxVolume.toString());
  }

  public setMusicVolume(vol: number) {
    this.musicVolume = Phaser.Math.Clamp(vol, 0, 1);
    localStorage.setItem('musicVolume', this.musicVolume.toString());
    if (this.currentMusic && this.currentMusic.isPlaying) {
      (this.currentMusic as any).setVolume(this.musicVolume * this.masterVolume);
    }
  }

  // --- PLAYBACK METHODS ---
  public playUiSfx(key: string) {
    if (!this.scene || !this.scene.sound) return;

    // Multiply by master volume to ensure master mute works on UI too
    const finalVolume = this.masterVolume * this.uiVolume;

    if (finalVolume > 0 && (this.scene.sound.get(key) || this.scene.cache.audio.exists(key))) {
      this.scene.sound.play(key, { volume: finalVolume });
    }
  }

  public playSfx(key: string, config?: Phaser.Types.Sound.SoundConfig) {
    if (!this.scene || !this.scene.sound) return;
    const finalVolume = this.masterVolume * this.sfxVolume * (config?.volume || 1);

    if (finalVolume > 0 && (this.scene.sound.get(key) || this.scene.cache.audio.exists(key))) {
      this.scene.sound.play(key, { ...config, volume: finalVolume });
    }
  }

  public playMusic(key: string) {
    if (!this.scene || !this.scene.sound) return;

    if (this.currentMusic && this.currentMusic.key === key && this.currentMusic.isPlaying) {
      return; // Already playing
    }

    if (this.currentMusic) {
      this.currentMusic.stop();
    }

    const finalVolume = this.masterVolume * this.musicVolume;

    if (this.scene.sound.get(key) || this.scene.cache.audio.exists(key)) {
      this.currentMusic = this.scene.sound.add(key, { volume: finalVolume, loop: true });
      this.currentMusic.play();
    }
  }
}