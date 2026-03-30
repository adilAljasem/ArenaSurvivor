import * as Phaser from 'phaser';
import { AudioManager } from '../AudioManager';
import { UIHelpers } from './UI';

type VisibleGameObject = Phaser.GameObjects.GameObject & { setVisible: (v: boolean) => void };

interface ActiveDrag {
  handleGraphics: Phaser.GameObjects.Graphics;
  fillGraphics: Phaser.GameObjects.Graphics;
  valueText: Phaser.GameObjects.Text;
  trackLeft: number;
  trackRight: number;
  trackWidth: number;
  initialValue: number;
  onChange: (v: number) => void;
}

export class EscMenu {
  private _elements: VisibleGameObject[] = [];
  private _visible: boolean = false;
  private _activeDrag: ActiveDrag | null = null;
  private readonly scene: Phaser.Scene;

  private readonly DEPTH = 5000;
  private readonly TRACK_W = 260;
  private readonly TRACK_H = 8;
  private readonly HANDLE_RADIUS = 12;
  private readonly PANEL_W = 400;
  private readonly PANEL_H = 280;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this._build();

    this.scene.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!this._visible || !this._activeDrag) return;
      const d = this._activeDrag;
      const clampedX = Phaser.Math.Clamp(ptr.x, d.trackLeft, d.trackRight);
      const value = (clampedX - d.trackLeft) / d.trackWidth;
      
      d.valueText.setText(`${Math.round(value * 100)}%`);
      d.onChange(value);

      // Redraw the dynamic Handle and Fill smoothly
      d.fillGraphics.clear();
      d.fillGraphics.fillStyle(0x00d2ff, 1); // Neon Cyan Fill
      d.fillGraphics.fillRoundedRect(d.trackLeft, ptr.y - this.TRACK_H / 2, clampedX - d.trackLeft, this.TRACK_H, 4);

      d.handleGraphics.clear();
      d.handleGraphics.fillStyle(0xffffff, 1); // Pure white handle
      d.handleGraphics.fillCircle(clampedX, ptr.y, this.HANDLE_RADIUS);
      // Give the handle a subtle stroke
      d.handleGraphics.lineStyle(2, 0x00a0cc, 1);
      d.handleGraphics.strokeCircle(clampedX, ptr.y, this.HANDLE_RADIUS);
    });

    this.scene.input.on('pointerup', () => { this._activeDrag = null; });
  }

  get visible(): boolean { return this._visible; }

  setVisible(v: boolean): void {
    this._visible = v;
    for (const el of this._elements) el.setVisible(v);
  }

  toggle(): void { this.setVisible(!this._visible); }

  reposition(_width: number, _height: number): void {
    for (const el of this._elements) {
      (el as unknown as Phaser.GameObjects.GameObject).destroy();
    }
    this._elements = [];
    this._build();
    if (!this._visible) this.setVisible(false);
  }

  private _build(): void {
    const scene = this.scene;
    const { width, height } = scene.scale;
    const cx = width / 2;
    const cy = height / 2;
    const D = this.DEPTH;

    // 1. Soft Dark Overlay
    const overlay = scene.add.rectangle(cx, cy, width, height, 0x000000, 0.75).setScrollFactor(0).setDepth(D).setInteractive();
    this._elements.push(overlay);

    // 2. Modern Rounded Panel
    const panelGraphics = scene.add.graphics().setScrollFactor(0).setDepth(D + 1);
    // Drop shadow
    panelGraphics.fillStyle(0x000000, 0.5);
    panelGraphics.fillRoundedRect(cx - this.PANEL_W / 2 + 10, cy - this.PANEL_H / 2 + 10, this.PANEL_W, this.PANEL_H, 16);
    // Main Panel Background (Dark Blue/Grey)
    panelGraphics.fillStyle(0x1a1e24, 1);
    panelGraphics.fillRoundedRect(cx - this.PANEL_W / 2, cy - this.PANEL_H / 2, this.PANEL_W, this.PANEL_H, 16);
    // Subtle Glowing Border
    panelGraphics.lineStyle(2, 0x3a4454, 1);
    panelGraphics.strokeRoundedRect(cx - this.PANEL_W / 2, cy - this.PANEL_H / 2, this.PANEL_W, this.PANEL_H, 16);
    this._elements.push(panelGraphics);

    // 3. Crisp Typography Title
    const title = scene.add.text(cx, cy - this.PANEL_H / 2 + 35, 'SETTINGS', {
      fontFamily: UIHelpers.FONT, fontSize: '26px', color: '#ffffff', fontStyle: 'bold', letterSpacing: 2, resolution: 3
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 2);
    this._elements.push(title);

    // 4. Subtle Divider
    const divider = scene.add.graphics().setScrollFactor(0).setDepth(D + 2);
    divider.lineStyle(2, 0x2a303a, 1);
    divider.beginPath();
    divider.moveTo(cx - 100, cy - this.PANEL_H / 2 + 70);
    divider.lineTo(cx + 100, cy - this.PANEL_H / 2 + 70);
    divider.strokePath();
    this._elements.push(divider);

    // Hint text
    const hint = scene.add.text(cx, cy + this.PANEL_H / 2 - 25, 'Press ESC to return to game', {
      fontFamily: UIHelpers.FONT, fontSize: '14px', color: '#667080', resolution: 3
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 2);
    this._elements.push(hint);

    const am = AudioManager.getInstance();

    this._buildModernSlider(cx, cy - 30, 'SFX Volume', am.masterSfxVolume, D + 2, v => am.setSfxVolume(v));
    this._buildModernSlider(cx, cy + 50, 'Music Volume', am.masterMusicVolume, D + 2, v => am.setMusicVolume(v));
  }

  private _buildModernSlider(cx: number, cy: number, label: string, initialValue: number, depth: number, onChange: (v: number) => void): void {
    const scene = this.scene;
    const halfTrack = this.TRACK_W / 2;
    const trackLeft = cx - halfTrack;
    const trackRight = cx + halfTrack;

    // Label
    const labelText = scene.add.text(trackLeft, cy - 25, label, {
      fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#a0abbc', fontStyle: 'bold', resolution: 3
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(depth);
    this._elements.push(labelText);

    // Value Readout
    const valueText = scene.add.text(trackRight, cy - 25, `${Math.round(initialValue * 100)}%`, {
      fontFamily: UIHelpers.FONT, fontSize: '16px', color: '#00d2ff', fontStyle: 'bold', resolution: 3
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(depth);
    this._elements.push(valueText);

    // Base Track (Dark Rounded)
    const trackGraphics = scene.add.graphics().setScrollFactor(0).setDepth(depth);
    trackGraphics.fillStyle(0x0f1217, 1);
    trackGraphics.fillRoundedRect(trackLeft, cy - this.TRACK_H / 2, this.TRACK_W, this.TRACK_H, 4);
    this._elements.push(trackGraphics);

    // Dynamic Fill (Neon Cyan)
    const fillGraphics = scene.add.graphics().setScrollFactor(0).setDepth(depth + 1);
    const fillWidth = Math.max(0, this.TRACK_W * initialValue);
    fillGraphics.fillStyle(0x00d2ff, 1);
    fillGraphics.fillRoundedRect(trackLeft, cy - this.TRACK_H / 2, fillWidth, this.TRACK_H, 4);
    this._elements.push(fillGraphics);

    // Circular Draggable Handle
    const handleGraphics = scene.add.graphics().setScrollFactor(0).setDepth(depth + 2);
    const handleX = trackLeft + fillWidth;
    handleGraphics.fillStyle(0xffffff, 1);
    handleGraphics.fillCircle(handleX, cy, this.HANDLE_RADIUS);
    handleGraphics.lineStyle(2, 0x00a0cc, 1);
    handleGraphics.strokeCircle(handleX, cy, this.HANDLE_RADIUS);
    this._elements.push(handleGraphics);

    // Invisible Hitbox for Interaction
    const hitbox = scene.add.rectangle(cx, cy, this.TRACK_W + 40, this.HANDLE_RADIUS * 3, 0x000000, 0)
      .setScrollFactor(0).setDepth(depth + 3).setInteractive({ useHandCursor: true });
    this._elements.push(hitbox);

    const drag: ActiveDrag = {
      handleGraphics, fillGraphics, valueText, trackLeft, trackRight,
      trackWidth: this.TRACK_W, initialValue, onChange
    };

    hitbox.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      this._activeDrag = drag;
      // Instantly jump handle to click position
      const clampedX = Phaser.Math.Clamp(ptr.x, trackLeft, trackRight);
      const value = (clampedX - trackLeft) / this.TRACK_W;
      onChange(value);
      valueText.setText(`${Math.round(value * 100)}%`);
      
      fillGraphics.clear();
      fillGraphics.fillStyle(0x00d2ff, 1);
      fillGraphics.fillRoundedRect(trackLeft, cy - this.TRACK_H / 2, clampedX - trackLeft, this.TRACK_H, 4);

      handleGraphics.clear();
      handleGraphics.fillStyle(0xffffff, 1);
      handleGraphics.fillCircle(clampedX, cy, this.HANDLE_RADIUS);
      handleGraphics.lineStyle(2, 0x00a0cc, 1);
      handleGraphics.strokeCircle(clampedX, cy, this.HANDLE_RADIUS);
    });
  }
}