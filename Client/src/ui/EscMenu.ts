import * as Phaser from 'phaser';
import { AudioManager } from '../AudioManager';
import { UIHelpers } from './UI';

// ==========================================================================
// ESC MENU  – Settings overlay with SFX and Music volume sliders.
//
// Usage (from GameScene):
//   this.escMenu = new EscMenu(this);
//   this.escMenu.setVisible(false);
//
// ESC key handler:
//   if (shopVisible) closeShop();
//   else if (escMenu.visible) escMenu.setVisible(false);
//   else escMenu.setVisible(true);
// ==========================================================================

/** Phaser GameObjects that are used inside EscMenu all support setVisible. */
type VisibleGameObject = Phaser.GameObjects.GameObject & { setVisible: (v: boolean) => void };

interface ActiveDrag {
  handle: Phaser.GameObjects.Rectangle;
  fill: Phaser.GameObjects.Rectangle;
  valueText: Phaser.GameObjects.Text;
  trackLeft: number;
  trackRight: number;
  trackWidth: number;
  onChange: (v: number) => void;
}

export class EscMenu {
  private _elements: VisibleGameObject[] = [];
  private _visible: boolean = false;
  private _activeDrag: ActiveDrag | null = null;
  private readonly scene: Phaser.Scene;

  private readonly DEPTH = 5000;
  private readonly TRACK_W = 240;
  private readonly TRACK_H = 6;
  private readonly HANDLE_W = 14;
  private readonly HANDLE_H = 24;
  private readonly PANEL_W = 360;
  private readonly PANEL_H = 260;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this._build();

    // Scene-level pointer events drive slider dragging so we don't need
    // Phaser's built-in draggable (which can conflict with a scrolled camera).
    this.scene.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!this._visible || !this._activeDrag) return;
      const d = this._activeDrag;
      const clampedX = Phaser.Math.Clamp(ptr.x, d.trackLeft, d.trackRight);
      d.handle.x = clampedX;
      d.fill.width = clampedX - d.trackLeft;
      const value = (clampedX - d.trackLeft) / d.trackWidth;
      d.valueText.setText(`${Math.round(value * 100)}%`);
      d.onChange(value);
    });

    this.scene.input.on('pointerup', () => { this._activeDrag = null; });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  get visible(): boolean { return this._visible; }

  setVisible(v: boolean): void {
    this._visible = v;
    for (const el of this._elements) el.setVisible(v);
  }

  toggle(): void { this.setVisible(!this._visible); }

  /**
   * Call this from the scene's resize handler to keep the menu centred.
   * Destroys the current elements and rebuilds at the new centre position.
   */
  reposition(_width: number, _height: number): void {
    for (const el of this._elements) {
      (el as unknown as Phaser.GameObjects.GameObject).destroy();
    }
    this._elements = [];
    this._build();
    if (!this._visible) this.setVisible(false);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _build(): void {
    const scene = this.scene;
    const { width, height } = scene.scale;
    const cx = width / 2;
    const cy = height / 2;
    const D = this.DEPTH;

    // Full-screen dark overlay (also blocks accidental clicks to the game world)
    const overlay = scene.add.rectangle(cx, cy, width, height, 0x000000, 0.65)
      .setScrollFactor(0)
      .setDepth(D)
      .setInteractive(); // swallows pointer events so the game doesn't react
    this._elements.push(overlay);

    // Panel background
    const panel = scene.add.rectangle(cx, cy, this.PANEL_W, this.PANEL_H, 0x111111, 0.97)
      .setStrokeStyle(2, 0x555555)
      .setScrollFactor(0)
      .setDepth(D + 1);
    this._elements.push(panel);

    // Title
    const title = scene.add.text(cx, cy - this.PANEL_H / 2 + 28, '⚙ Settings', {
      fontFamily: UIHelpers.FONT,
      fontSize: '22px',
      color: '#ffd700',
      fontStyle: 'bold',
      resolution: 3
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 2);
    this._elements.push(title);

    // Divider line
    const divider = scene.add.graphics().setScrollFactor(0).setDepth(D + 2);
    divider.lineStyle(1, 0x444444, 1);
    divider.beginPath();
    divider.moveTo(cx - this.PANEL_W / 2 + 20, cy - this.PANEL_H / 2 + 50);
    divider.lineTo(cx + this.PANEL_W / 2 - 20, cy - this.PANEL_H / 2 + 50);
    divider.strokePath();
    this._elements.push(divider);

    // Hint text
    const hint = scene.add.text(cx, cy + this.PANEL_H / 2 - 24, 'Press ESC to close', {
      fontFamily: UIHelpers.FONT,
      fontSize: '13px',
      color: '#666666',
      resolution: 3
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 2);
    this._elements.push(hint);

    const am = AudioManager.getInstance();

    // SFX slider  (upper row)
    this._buildSlider(
      cx, cy - 50,
      '🔊 SFX Volume',
      am.masterSfxVolume,
      D + 2,
      v => am.setSfxVolume(v)
    );

    // Music slider (lower row)
    this._buildSlider(
      cx, cy + 40,
      '🎵 Music Volume',
      am.masterMusicVolume,
      D + 2,
      v => am.setMusicVolume(v)
    );
  }

  private _buildSlider(
    cx: number, cy: number,
    label: string,
    initialValue: number,
    depth: number,
    onChange: (v: number) => void
  ): void {
    const scene = this.scene;
    const halfTrack = this.TRACK_W / 2;
    const trackLeft = cx - halfTrack;
    const trackRight = cx + halfTrack;

    // Row label
    const labelText = scene.add.text(trackLeft, cy - 18, label, {
      fontFamily: UIHelpers.FONT,
      fontSize: '15px',
      color: '#aaaaaa',
      resolution: 3
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(depth);
    this._elements.push(labelText);

    // Percentage readout
    const valueText = scene.add.text(trackRight, cy - 18, `${Math.round(initialValue * 100)}%`, {
      fontFamily: UIHelpers.FONT,
      fontSize: '15px',
      color: '#ffffff',
      resolution: 3
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(depth);
    this._elements.push(valueText);

    // Track – grey background
    const track = scene.add.rectangle(cx, cy, this.TRACK_W, this.TRACK_H, 0x444444)
      .setScrollFactor(0).setDepth(depth);
    this._elements.push(track);

    // Track – coloured fill (left-anchored)
    const fillWidth = Math.max(0, this.TRACK_W * initialValue);
    const fill = scene.add.rectangle(trackLeft, cy, fillWidth, this.TRACK_H, 0x0099dd)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(depth + 1);
    this._elements.push(fill);

    // Draggable handle
    const handleX = trackLeft + this.TRACK_W * initialValue;
    const handle = scene.add.rectangle(handleX, cy, this.HANDLE_W, this.HANDLE_H, 0xffffff)
      .setScrollFactor(0).setDepth(depth + 2)
      .setInteractive({ useHandCursor: true });
    this._elements.push(handle);

    const drag: ActiveDrag = {
      handle, fill, valueText,
      trackLeft, trackRight,
      trackWidth: this.TRACK_W,
      onChange
    };

    handle.on('pointerdown', () => { this._activeDrag = drag; });
    handle.on('pointerover', () => handle.setFillStyle(0xdddddd));
    handle.on('pointerout',  () => { if (this._activeDrag !== drag) handle.setFillStyle(0xffffff); });
    handle.on('pointerup',   () => { this._activeDrag = null; handle.setFillStyle(0xffffff); });
  }
}
