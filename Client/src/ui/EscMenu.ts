import * as Phaser from 'phaser';
import { AudioManager } from '../AudioManager';
import { UIHelpers } from './UI';

type VisibleGameObject = Phaser.GameObjects.GameObject & { setVisible: (v: boolean) => void; alpha?: number; };

interface ActiveDrag {
  handleGraphics: Phaser.GameObjects.Graphics;
  fillGraphics: Phaser.GameObjects.Graphics;
  valueText: Phaser.GameObjects.Text;
  trackLeft: number;
  trackRight: number;
  trackWidth: number;
  cy: number; // >>> FIX 1: Lock the Y coordinate so the slider doesn't drag up and down
  onChange: (v: number) => void;
}

export class EscMenu {
  private _elements: VisibleGameObject[] = [];
  private _mainViewElements: VisibleGameObject[] = [];
  private _optionsViewElements: VisibleGameObject[] = [];

  private _visible: boolean = false;
  private _activeDrag: ActiveDrag | null = null;
  private readonly scene: Phaser.Scene;

  private readonly DEPTH = 5000;
  private readonly TRACK_W = 260;
  private readonly TRACK_H = 10;
  private readonly HANDLE_RADIUS = 12;
  private readonly PANEL_W = 400;
  private readonly PANEL_H = 380; // >>> FIX 2: Taller panel to fit all 4 sliders and Back button

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this._build();

    // >>> FIX 1: Uses d.cy instead of ptr.y so the slider stays perfectly horizontal
    this.scene.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!this._visible || !this._activeDrag) return;
      const d = this._activeDrag;
      const clampedX = Phaser.Math.Clamp(ptr.x, d.trackLeft, d.trackRight);
      this.updateSliderVisual(d, clampedX);
    });

    this.scene.input.on('pointerup', () => { this._activeDrag = null; });
  }

  // Shared by the pointermove drag handler above and each slider's initial
  // pointerdown (in _buildModernSlider) - both need to recompute the value from
  // clampedX and redraw the fill/handle the same way, just at different call sites.
  private updateSliderVisual(d: ActiveDrag, clampedX: number): number {
    const value = (clampedX - d.trackLeft) / d.trackWidth;

    d.valueText.setText(`${Math.round(value * 100)}%`);
    d.onChange(value);

    d.fillGraphics.clear();
    d.fillGraphics.fillStyle(0xe5b35c, 1);
    d.fillGraphics.fillRoundedRect(d.trackLeft, d.cy - this.TRACK_H / 2, clampedX - d.trackLeft, this.TRACK_H, 5);

    d.handleGraphics.clear();
    d.handleGraphics.fillStyle(0xffffff, 1);
    d.handleGraphics.fillCircle(clampedX, d.cy, this.HANDLE_RADIUS);
    d.handleGraphics.lineStyle(2, 0xe5b35c, 1);
    d.handleGraphics.strokeCircle(clampedX, d.cy, this.HANDLE_RADIUS);

    return value;
  }

  get visible(): boolean { return this._visible; }

  setVisible(v: boolean): void {
    this._visible = v;

    // Always reset to Main View when opened
    if (v) this.switchView('main');
    else {
      for (const el of this._elements) el.setVisible(false);
    }
  }

  toggle(): void { this.setVisible(!this._visible); }

  updateLayout(width: number, height: number): void {
    for (const el of this._elements) {
      (el as unknown as Phaser.GameObjects.GameObject).destroy();
    }
    this._elements = [];
    this._mainViewElements = [];
    this._optionsViewElements = [];

    // Pass the new fullscreen dimensions to the builder
    this._build(width, height);

    if (!this._visible) {
      this.setVisible(false);
    } else {
      // If the menu was already open when the screen resized, keep it visible
      this.switchView('main');
    }
  }

  private switchView(target: 'main' | 'options') {
    this._elements.forEach(el => el.setVisible(true));

    if (target === 'main') {
      this._optionsViewElements.forEach(el => el.setVisible(false));
      this._mainViewElements.forEach(el => el.setVisible(true));
    } else {
      this._mainViewElements.forEach(el => el.setVisible(false));
      this._optionsViewElements.forEach(el => el.setVisible(true));
    }
  }

  private _build(customWidth?: number, customHeight?: number): void {
    const scene = this.scene;

    this.ensureExitIconTexture();

    // Use the new width/height if provided by the resize event, otherwise fallback to scale
    const width = customWidth ?? scene.scale.width;
    const height = customHeight ?? scene.scale.height;

    const cx = width / 2;
    const cy = height / 2;
    const D = this.DEPTH;

    // 1. Soft Dark Overlay
    const overlay = scene.add.rectangle(cx, cy, width, height, 0x000000, 0.85).setScrollFactor(0).setDepth(D).setInteractive();
    this._elements.push(overlay);

    // 2. Modern Rounded Panel (Mage Arena Theme)
    const panelGraphics = scene.add.graphics().setScrollFactor(0).setDepth(D + 1);

    panelGraphics.fillStyle(0x14141c, 1);
    panelGraphics.fillRoundedRect(cx - this.PANEL_W / 2, cy - this.PANEL_H / 2, this.PANEL_W, this.PANEL_H, 12);

    panelGraphics.lineStyle(3, 0xe5b35c, 1);
    panelGraphics.strokeRoundedRect(cx - this.PANEL_W / 2, cy - this.PANEL_H / 2, this.PANEL_W, this.PANEL_H, 12);
    this._elements.push(panelGraphics);

    // 3. Crisp Typography Title
    const title = scene.add.text(cx, cy - this.PANEL_H / 2 + 35, 'PAUSE MENU', {
      fontFamily: UIHelpers.FONT, fontSize: '28px', color: '#e5b35c', fontStyle: 'bold', letterSpacing: 2, resolution: 3
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 2);
    this._elements.push(title);

    // 4. Subtle Divider
    const divider = scene.add.graphics().setScrollFactor(0).setDepth(D + 2);
    divider.lineStyle(2, 0x2a1f43, 1);
    divider.beginPath();
    divider.moveTo(cx - 120, cy - this.PANEL_H / 2 + 70);
    divider.lineTo(cx + 120, cy - this.PANEL_H / 2 + 70);
    divider.strokePath();
    this._elements.push(divider);

    // ==========================================
    // VIEW 1: MAIN MENU
    // ==========================================

    // 1. Resume
    this.createButton(cx, cy - 60, "Resume Game", () => this.setVisible(false), this._mainViewElements, false);

    // 2. Options
    this.createButton(cx, cy, "Options", () => this.switchView('options'), this._mainViewElements, false);

    // 3. >>> NEW: Toggle Fullscreen
    this.createButton(cx, cy + 60, "Toggle Fullscreen", () => {
      if (this.scene.scale.isFullscreen) {
        this.scene.scale.stopFullscreen();
      } else {
        this.scene.scale.startFullscreen();
        // Optional: lock ESC key in desktop Chrome so one press doesn't exit fullscreen.
        try {
          if ((navigator as any).keyboard?.lock) {
            (navigator as any).keyboard.lock(['Escape']).catch(() => { });
          }
        } catch (_) { /* not supported on this device */ }
      }
    }, this._mainViewElements, false);



    // 4. Quit Button (Red/Danger)
    this.createButton(cx, cy + 120, "Back to Main Menu", () => {
      this.scene.events.emit('quit_to_main_menu');
    }, this._mainViewElements, true, EscMenu.EXIT_ICON_KEY);

    // ==========================================
    // VIEW 2: OPTIONS (SLIDERS)
    // ==========================================
    const am = AudioManager.getInstance();

    // >>> FIX 2: Even vertical spacing for all elements
    let optY = cy - 85;
    this._buildModernSlider(cx, optY, 'Master Vol', am.masterVolume, D + 2, v => am.setMasterVolume(v));
    this._buildModernSlider(cx, optY + 55, 'Music Vol', am.musicVolume, D + 2, v => am.setMusicVolume(v));
    this._buildModernSlider(cx, optY + 110, 'SFX Vol', am.sfxVolume, D + 2, v => am.setSfxVolume(v));
    this._buildModernSlider(cx, optY + 165, 'UI Vol', am.uiVolume, D + 2, v => am.setUiVolume(v));

    this.createButton(cx, cy + 140, "Back", () => this.switchView('main'), this._optionsViewElements, false);

    this.switchView('main');
  }

  // Shared by createButton's initial draw, pointerover, and pointerout - all three
  // previously repeated this exact clear/fill/stroke sequence with just different colors.
  private drawButtonBg(bg: Phaser.GameObjects.Graphics, fillColor: number, borderColor: number): void {
    bg.clear();
    bg.fillStyle(fillColor, 1);
    bg.fillRoundedRect(-120, -22.5, 240, 45, 8);
    bg.lineStyle(2, borderColor, 1);
    bg.strokeRoundedRect(-120, -22.5, 240, 45, 8);
  }

  private static readonly EXIT_ICON_KEY = 'esc_icon_exit';

  // Simple "power/exit" glyph (a ring with a gap at the top + a tick through the gap) drawn
  // once into a shared texture, same technique as the fx_spark/white_pixel textures elsewhere
  // in the codebase - generateTexture is a one-time cost, and _build() can run again on
  // resize, so this is guarded to skip regenerating if it's already there.
  private ensureExitIconTexture(): void {
    if (this.scene.textures.exists(EscMenu.EXIT_ICON_KEY)) return;

    const size = 32;
    const g = this.scene.add.graphics();
    g.lineStyle(3, 0xffffff, 1);
    g.beginPath();
    // Ring with a ~60° gap centered at the top (12 o'clock).
    g.arc(size / 2, size / 2, 11, Phaser.Math.DegToRad(-60), Phaser.Math.DegToRad(240), false);
    g.strokePath();
    // Vertical tick through the gap.
    g.lineBetween(size / 2, 2, size / 2, 14);
    g.generateTexture(EscMenu.EXIT_ICON_KEY, size, size);
    g.destroy();
  }

  private createButton(cx: number, cy: number, text: string, onClick: () => void, targetList: VisibleGameObject[], isDanger: boolean, iconKey?: string) {
    const btnGroup = this.scene.add.container(cx, cy).setDepth(this.DEPTH + 5).setScrollFactor(0);

    const bg = this.scene.add.graphics();

    const bgColor = isDanger ? 0x5c1f1f : 0x2a1f43;
    const hoverBgColor = isDanger ? 0x7a2929 : 0x4a3b69;
    const borderColor = isDanger ? 0xff4444 : 0xe5b35c;
    const hoverBorderColor = isDanger ? 0xff8888 : 0xffcf77;

    this.drawButtonBg(bg, bgColor, borderColor);

    const txt = this.scene.add.text(0, 0, text, {
      fontFamily: UIHelpers.FONT, fontSize: '18px', color: '#ffffff', fontStyle: 'bold', resolution: 3
    }).setOrigin(0.5);

    const groupChildren: Phaser.GameObjects.GameObject[] = [bg, txt];

    // Optional icon, white and slightly see-through so it reads as a subtle accent rather
    // than competing with the label. Positioned so the icon+label pair is centered as a
    // group (not just the text alone), same as a typical icon button.
    if (iconKey) {
      const iconSize = 20;
      const gap = 8;
      const icon = this.scene.add.image(0, 0, iconKey)
        .setDisplaySize(iconSize, iconSize)
        .setTint(0xffffff)
        .setAlpha(0.8);

      const totalWidth = iconSize + gap + txt.width;
      icon.x = -(totalWidth / 2) + (iconSize / 2);
      txt.x = -(totalWidth / 2) + iconSize + gap + (txt.width / 2);

      groupChildren.push(icon);
    }

    btnGroup.add(groupChildren);

    // >>> FIX 3: Hitboxes detached from containers so they don't offset when the camera moves
    const hitbox = this.scene.add.rectangle(cx, cy, 240, 45, 0x000000, 0)
      .setScrollFactor(0)
      .setDepth(this.DEPTH + 6)
      .setInteractive({ useHandCursor: true });

    hitbox.on('pointerover', () => {
      // >>> FIX 4: Removed ui_hover sound for Esc Menu
      this.drawButtonBg(bg, hoverBgColor, hoverBorderColor);
      this.scene.tweens.add({ targets: btnGroup, scale: 1.05, duration: 100 });
    });

    hitbox.on('pointerout', () => {
      this.drawButtonBg(bg, bgColor, borderColor);
      this.scene.tweens.add({ targets: btnGroup, scale: 1.0, duration: 100 });
    });

    hitbox.on('pointerdown', () => {
      AudioManager.getInstance().playUiSfx('ui_click');
      onClick();
    });

    targetList.push(btnGroup as any, hitbox as any);
    this._elements.push(btnGroup as any, hitbox as any);
  }

  private _buildModernSlider(cx: number, cy: number, label: string, initialValue: number, depth: number, onChange: (v: number) => void): void {
    const scene = this.scene;
    const halfTrack = this.TRACK_W / 2;
    const trackLeft = cx - halfTrack;
    const trackRight = cx + halfTrack;

    const labelText = scene.add.text(trackLeft, cy - 20, label, {
      fontFamily: UIHelpers.FONT, fontSize: '15px', color: '#a1a1aa', fontStyle: 'bold', resolution: 3
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(depth);
    this._optionsViewElements.push(labelText);
    this._elements.push(labelText);

    const valueText = scene.add.text(trackRight, cy - 20, `${Math.round(initialValue * 100)}%`, {
      fontFamily: UIHelpers.FONT, fontSize: '15px', color: '#e5b35c', fontStyle: 'bold', resolution: 3
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(depth);
    this._optionsViewElements.push(valueText);
    this._elements.push(valueText);

    const trackGraphics = scene.add.graphics().setScrollFactor(0).setDepth(depth);
    trackGraphics.fillStyle(0x0a0a0f, 1);
    trackGraphics.fillRoundedRect(trackLeft, cy - this.TRACK_H / 2, this.TRACK_W, this.TRACK_H, 5);
    trackGraphics.lineStyle(1, 0x2a1f43, 1);
    trackGraphics.strokeRoundedRect(trackLeft, cy - this.TRACK_H / 2, this.TRACK_W, this.TRACK_H, 5);
    this._optionsViewElements.push(trackGraphics);
    this._elements.push(trackGraphics);

    const fillGraphics = scene.add.graphics().setScrollFactor(0).setDepth(depth + 1);
    const fillWidth = Math.max(0, this.TRACK_W * initialValue);
    fillGraphics.fillStyle(0xe5b35c, 1);
    fillGraphics.fillRoundedRect(trackLeft, cy - this.TRACK_H / 2, fillWidth, this.TRACK_H, 5);
    this._optionsViewElements.push(fillGraphics);
    this._elements.push(fillGraphics);

    const handleGraphics = scene.add.graphics().setScrollFactor(0).setDepth(depth + 2);
    const handleX = trackLeft + fillWidth;
    handleGraphics.fillStyle(0xffffff, 1);
    handleGraphics.fillCircle(handleX, cy, this.HANDLE_RADIUS);
    handleGraphics.lineStyle(2, 0xe5b35c, 1);
    handleGraphics.strokeCircle(handleX, cy, this.HANDLE_RADIUS);
    this._optionsViewElements.push(handleGraphics);
    this._elements.push(handleGraphics);

    // >>> FIX 3: Detached Hitbox
    const hitbox = scene.add.rectangle(cx, cy, this.TRACK_W + 40, this.HANDLE_RADIUS * 3, 0x000000, 0)
      .setScrollFactor(0).setDepth(depth + 3).setInteractive({ useHandCursor: true });
    this._optionsViewElements.push(hitbox);
    this._elements.push(hitbox);

    const drag: ActiveDrag = {
      handleGraphics, fillGraphics, valueText, trackLeft, trackRight,
      trackWidth: this.TRACK_W, cy, onChange // >>> FIX 1: Passing `cy`
    };

    hitbox.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      this._activeDrag = drag;
      const clampedX = Phaser.Math.Clamp(ptr.x, trackLeft, trackRight);
      this.updateSliderVisual(drag, clampedX);
    });
  }
}