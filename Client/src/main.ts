import * as Phaser from 'phaser';
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { ShopUI } from './ui/UI';
import { PlayerRenderer, EnemyRenderer, WorldRenderer } from './RenderSystems';

// --- SIGNALR CONNECTION ---
const connection = new HubConnectionBuilder()
  .withUrl("http://localhost:5000/gameHub")
  .withAutomaticReconnect()
  .build();

// --- INTERFACES ---
interface EquippedWeapon { configId: string; slotIndex: number; level: number; }
interface ShopItem { configId: string; name: string; price: number; }
interface AoeEvent { x: number; y: number; radius: number; isFriendly: boolean; }
interface ServerPlayer {
  connectionId: string; configId: string; actionState: string;
  x: number; y: number; velX?: number;
  weapons: EquippedWeapon[]; currentHp: number; maxHp: number; gold: number;
  currentShop: ShopItem[]; stats: any; ownedItems: any;
  aimX: number; aimY: number; firedWeapons: number[]; activeEffects: string[];
  currentCastingSkillId: string; currentCastTimer: number; maxCastTimer: number;
}
interface ServerEnemy {
  id: string; configId: string; x: number; y: number; velX?: number;
  currentHp: number; maxHp: number; actionState: string; activeEffects: string[];
  currentCastingSkillId: string; currentCastTimer: number; maxCastTimer: number;
}
interface ServerProjectile { id: string; configId: string; x: number; y: number; velX: number; velY: number; }
interface ServerPickup { id: string; x: number; y: number; value: number; }
interface DamageEvent { x: number; y: number; amount: number; }

export interface GameStatePayload {
  players: ServerPlayer[]; enemies: ServerEnemy[]; projectiles: ServerProjectile[];
  pickups: ServerPickup[]; damageEvents: DamageEvent[]; aoeEvents: AoeEvent[];
  phase: string; currentWave: number; timeRemaining: number;
}

// Global dictionary to store the JSON configs
let masterConfigs: any = {};

connection.on("ReceiveHandshake", (payload: any) => {
  masterConfigs = payload;
  console.log("Handshake received. Configs loaded:", masterConfigs);
  window.dispatchEvent(new Event('configsReady'));
});

connection.start().then(() => console.log("SignalR Connected!")).catch((err: any) => console.error(err));

// --- PHASER SCENE ---
class GameScene extends Phaser.Scene {
  private playerSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private enemySprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private projectileSprites: Map<string, Phaser.GameObjects.Rectangle | Phaser.GameObjects.Sprite> = new Map();
  private pickupSprites: Map<string, Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle> = new Map();
  private targetPositions: Map<string, { x: number, y: number }> = new Map();

  private goldUIText!: Phaser.GameObjects.Text;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: any;
  private currentPhase: string = "WaitingForPlayers";
  private previousPhase: string = "WaitingForPlayers";
  private manuallyClosedShop: boolean = false;
  private shopUIModule!: ShopUI;
  private waveUIText!: Phaser.GameObjects.Text;

  private isDebugMode: boolean = false;
  private debugGraphics!: Phaser.GameObjects.Graphics;

  // >>> NEW: PERFORMANCE TRACKERS <<<
  private perfText!: Phaser.GameObjects.Text;
  private bytesReceivedSinceLastTick: number = 0;
  private lastBandwidthTime: number = 0;
  private currentKbps: string = "0.00";

  private currentDrawCalls: number = 0;
  private maxDrawCalls: number = 0;
  private pingMs: number = 0;

  constructor() { super('GameScene'); }

  preload() {
    this.load.spritesheet('enemies_sheet1', '/assets/Enemies/enemy1.png', { frameWidth: 720, frameHeight: 490 });
    this.load.spritesheet('Flying_Forest', '/assets/Enemies/Flying Forest.png', { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('mushroomEnemy', '/assets/Enemies/mushroom.png', { frameWidth: 80, frameHeight: 64 });
    this.load.spritesheet('ironenemy', '/assets/Enemies/ironEnemy.png', { frameWidth: 180, frameHeight: 181 });
    this.load.spritesheet('weapons_sheet', '/assets/Weapons/weapons.png', { frameWidth: 704, frameHeight: 384 });
    this.load.spritesheet('ammo_sheet', '/assets/Weapons/ammo1.png', { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('items_sheet', 'assets/Enemies/items_sheet.png', { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('characters_sheet', 'assets/characters_sheet.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('tree', 'assets/obstacles/Tree Lights 02-Sheet.png', { frameWidth: 32, frameHeight: 64 });
  }

  create() {
    this.cameras.main.setBackgroundColor('#2d2d2d');

    if (masterConfigs.enemies) this.createAnimations(masterConfigs);
    window.addEventListener('configsReady', () => { if (this.anims) this.createAnimations(masterConfigs); });

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    }
    this.input.mouse?.disableContextMenu();

    this.waveUIText = this.add.text(this.scale.width / 2, 20, 'Connecting...', {
      fontSize: '32px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5).setDepth(3000);

    this.goldUIText = this.add.text(20, 20, '💰 0', {
      fontSize: '28px', color: '#ffd700', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4
    }).setDepth(3000);

    // >>> PERFORMANCE UI <<<
    this.perfText = this.add.text(10, this.scale.height - 10, '', {
      fontFamily: "'Segoe UI', Consolas, monospace",
      fontSize: '14px', color: '#00ff00',
      backgroundColor: '#000000aa',
      padding: { x: 8, y: 8 }
    }).setOrigin(0, 1).setDepth(9999).setVisible(false);

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.perfText.setPosition(10, gameSize.height - 10);
    });


    // >>> FIX: THE ULTIMATE DRAW CALL TRACKER (WebGL Hook) <<<
    const renderer = this.game.renderer as any;
    const gl = renderer.gl; // Access the browser's raw WebGL context

    if (gl && !gl.__isHooked) {
      gl.__isHooked = true;
      let frameDraws = 0;

      // 1. Intercept the GPU's native draw commands
      const originalDrawElements = gl.drawElements;
      const originalDrawArrays = gl.drawArrays;

      gl.drawElements = function () {
        frameDraws++;
        return originalDrawElements.apply(this, arguments as any);
      };
      gl.drawArrays = function () {
        frameDraws++;
        return originalDrawArrays.apply(this, arguments as any);
      };

      // 2. Reset the counter right before Phaser paints the frame
      this.game.events.on(Phaser.Core.Events.PRE_RENDER, () => {
        frameDraws = 0;
      });

      // 3. Save the final tally right after Phaser finishes
      this.game.events.on(Phaser.Core.Events.POST_RENDER, () => {
        this.currentDrawCalls = frameDraws;
        if (this.currentDrawCalls > this.maxDrawCalls) this.maxDrawCalls = this.currentDrawCalls;
      });
    }

    // >>> THE PING TRACKER <<<
    setInterval(() => {
      if (connection.state === HubConnectionState.Connected) {
        const startTime = Date.now();
        connection.invoke("Ping").then(() => {
          this.pingMs = Date.now() - startTime;
        }).catch(() => { });
      }
    }, 1000);

    this.shopUIModule = new ShopUI(this, connection);
    this.shopUIModule.setDepth(1000);
    this.shopUIModule.setVisible(false);
    this.add.existing(this.shopUIModule);

    this.input.keyboard?.on('keydown-B', () => {
      this.shopUIModule.setVisible(!this.shopUIModule.visible);
      this.manuallyClosedShop = !this.shopUIModule.visible;
    });

    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.shopUIModule.visible) {
        this.shopUIModule.setVisible(false);
        this.manuallyClosedShop = true;
      }
    });

    this.input.keyboard?.on('keydown-H', () => {
      this.isDebugMode = !this.isDebugMode;
      this.perfText.setVisible(this.isDebugMode);
    });

    this.debugGraphics = this.add.graphics().setDepth(9998);

    connection.on("UpdatePlayerUI", (uiData: any) => {
      if (this.shopUIModule) this.shopUIModule.updateUIData(uiData, masterConfigs);
    });

    connection.on("UpdateState", (state: any) => {
      const payloadString = JSON.stringify(state);
      this.bytesReceivedSinceLastTick += payloadString.length;

      this.currentPhase = state.phase || state.Phase;

      const pList = state.players || state.Players || [];
      const myPlayer = pList.find((p: any) => (p.connectionId || p.ConnectionId) === connection.connectionId);
      if (myPlayer) this.goldUIText.setText(`💰 ${myPlayer.gold ?? myPlayer.Gold}`);

      if (this.currentPhase === "WaveActive") {
        this.waveUIText.setText(`Wave ${state.currentWave || state.CurrentWave} - 0:${(state.timeRemaining || state.TimeRemaining).toString().padStart(2, '0')}`).setColor('#ffffff');
        if (this.previousPhase !== "WaveActive") { this.shopUIModule.setVisible(false); this.manuallyClosedShop = true; }
      } else if (this.currentPhase === "ShopPhase") {
        this.waveUIText.setText(`SHOP PHASE - ${state.timeRemaining || state.TimeRemaining}s`).setColor('#00ff00');
        if (this.previousPhase !== "ShopPhase") { this.shopUIModule.setVisible(true); this.manuallyClosedShop = false; }
      }
      this.previousPhase = this.currentPhase;

      const activePlayers = PlayerRenderer.render(this, state, this.playerSprites, masterConfigs, this.targetPositions);
      const activeEnemies = EnemyRenderer.render(this, state, this.enemySprites, masterConfigs, this.targetPositions);
      const { activeProjectiles, activePickups } = WorldRenderer.render(this, state, this.projectileSprites, this.pickupSprites, masterConfigs, this.targetPositions);

      this.cleanupSprites(this.playerSprites, activePlayers);
      this.cleanupSprites(this.enemySprites, activeEnemies);
      this.cleanupSprites(this.projectileSprites, activeProjectiles);
      this.cleanupSprites(this.pickupSprites, activePickups);
    });
  }

  // >>> FIX: Add time and delta parameters to standard Phaser update loop <<<
  update(time: number, delta: number) {
    this.handleInput();
    this.smoothInterpolateSprites(this.playerSprites, 0.2);
    this.smoothInterpolateSprites(this.enemySprites, 0.2);
    this.smoothInterpolateSprites(this.projectileSprites, 0.4);

    if (this.isDebugMode) {
      // Calculate Bandwidth Once Per Second
      if (time - this.lastBandwidthTime > 1000) {

        // >>> FIX: Convert Bytes to bits (x8), then bits to Kilobits (/1000) <<<
        const bits = this.bytesReceivedSinceLastTick * 8;
        this.currentKbps = (bits / 1000).toFixed(2);

        this.bytesReceivedSinceLastTick = 0;
        this.lastBandwidthTime = time;
      }

      const fps = Math.round(this.game.loop.actualFps);
      const frameTime = this.game.loop.delta.toFixed(1);

      // >>> NEW: Track exactly how many sprites Phaser tried to render <<<
      const renderedSprites = this.cameras.main.renderList.length;

      this.perfText.setText(
        `FPS     : ${fps}\n` +
        `Ping    : ${this.pingMs} ms\n` +
        `Logic   : ${frameTime} ms\n` +
        `Sprites : ${renderedSprites}\n` +
        `Draws   : ${this.currentDrawCalls} (Peak: ${this.maxDrawCalls})\n` +
        `Network : ${this.currentKbps} kbps\n` +
        `Memory  : ${this.enemySprites.size + this.projectileSprites.size + this.pickupSprites.size} Entities`
      );
    }

    this.debugGraphics.clear();
    if (this.isDebugMode) {
      this.playerSprites.forEach((sprite) => { this.debugGraphics.lineStyle(2, 0x00ffff); this.debugGraphics.strokeCircle(sprite.x, sprite.y, 15); });
      this.enemySprites.forEach((sprite) => {
        const configId = sprite.getData('configId');
        const config = masterConfigs.enemies ? (masterConfigs.enemies[configId] || masterConfigs.Enemies?.[configId]) : null;
        this.debugGraphics.lineStyle(2, 0xff0000); this.debugGraphics.strokeCircle(sprite.x, sprite.y, config ? (config.hitRadius || config.HitRadius || 15) : 15);
      });
      this.projectileSprites.forEach((sprite) => {
        const configId = (sprite as any).getData('configId');
        const config = masterConfigs.projectiles ? (masterConfigs.projectiles[configId] || masterConfigs.Projectiles?.[configId]) : null;
        this.debugGraphics.lineStyle(2, 0x00ff00); this.debugGraphics.strokeCircle(sprite.x, sprite.y, config ? (config.hitRadius || config.HitRadius || 10) : 10);
      });
      this.pickupSprites.forEach((sprite) => { this.debugGraphics.lineStyle(2, 0xffff00); this.debugGraphics.strokeCircle(sprite.x, sprite.y, 15); });
    }
  }

  private handleInput() {
    if (!this.cursors || !this.wasd || connection.state !== HubConnectionState.Connected) return;

    let dirX = 0, dirY = 0;
    if (this.cursors.left.isDown || this.wasd.A.isDown) dirX = -1;
    if (this.cursors.right.isDown || this.wasd.D.isDown) dirX = 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) dirY = -1;
    if (this.cursors.down.isDown || this.wasd.S.isDown) dirY = 1;

    const pointer = this.input.activePointer;
    connection.invoke("SendInput", {
      DirX: dirX, DirY: dirY, AimX: pointer.worldX, AimY: pointer.worldY
    }).catch((err: any) => console.error(err));
  }

  private smoothInterpolateSprites(map: Map<string, any>, speed: number = 0.2) {
    map.forEach((sprite, id) => {
      const target = this.targetPositions.get(id);
      if (target) {
        sprite.x = Phaser.Math.Linear(sprite.x, target.x, speed);
        sprite.y = Phaser.Math.Linear(sprite.y, target.y, speed);
      }
    });
  }

  private cleanupSprites(map: Map<string, any>, activeIds: Set<string>) {
    map.forEach((sprite, id) => {
      if (!activeIds.has(id)) {
        sprite.destroy();
        map.delete(id);
        this.targetPositions.delete(id);
      }
    });
  }

  private createAnimations(configs: any) {
    const allEntities = [
      ...(configs.enemies ? Object.values(configs.enemies) : []),
      ...(configs.Enemies ? Object.values(configs.Enemies) : []),
      ...(configs.projectiles ? Object.values(configs.projectiles) : []),
      ...(configs.characters ? Object.values(configs.characters) : []),
      ...(configs.skills ? Object.values(configs.skills) : []),
      ...(configs.effects ? Object.values(configs.effects) : [])
    ];

    allEntities.forEach((entity: any) => {
      if (!entity.textureKey && !entity.TextureKey) return;

      Object.keys(entity).forEach(key => {
        if (key.toLowerCase().startsWith('anim') && Array.isArray(entity[key]) && entity[key].length === 2) {
          const actionName = key.toLowerCase().replace('anim', '');
          const id = entity.id || entity.Id;
          const animKey = `${id}_${actionName}`;

          if (!this.anims.exists(animKey)) {
            const textureKey = entity.textureKey || entity.TextureKey;
            const customFrameRate = entity[`${key}FrameRate`] || 15;
            const shouldLoop = (actionName === 'attack' || actionName === 'hit' || actionName === 'death') ? 0 : -1;

            this.anims.create({
              key: animKey,
              frames: this.anims.generateFrameNumbers(textureKey, {
                start: entity[key][0],
                end: entity[key][1]
              }),
              frameRate: customFrameRate,
              repeat: shouldLoop
            });
          }
        }
      });
    });

    console.log("Automated Animation System Successfully Generated All Animations!");
  }
}

// --- INITIALIZE PHASER ---
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL, // <<< FORCE WEBGL INSTEAD OF AUTO!
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH, width: '100%', height: '100%' },
  scene: GameScene, parent: 'app', pixelArt: true
};
new Phaser.Game(config);