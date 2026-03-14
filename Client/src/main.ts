import * as Phaser from 'phaser';
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { ShopUI } from './ui/ShopUI';

// --- SIGNALR CONNECTION ---
const connection = new HubConnectionBuilder()
  .withUrl("http://localhost:5000/gameHub") // Ensure this matches your .NET port
  .withAutomaticReconnect()
  .build();

// --- INTERFACES ---
interface EquippedWeapon { configId: string; slotIndex: number; level: number; }
interface ShopItem { configId: string; name: string; price: number; }
interface ServerPlayer { connectionId: string; x: number; y: number; weapons: EquippedWeapon[]; currentHp: number; maxHp: number; gold: number; currentShop: ShopItem[]; stats: any; ownedItems: any; }
interface ServerEnemy { id: string; configId: string; x: number; y: number; currentHp: number; maxHp: number; actionState: string; }
interface ServerProjectile { id: string; x: number; y: number; }
interface ServerPickup { id: string; x: number; y: number; value: number; }
interface DamageEvent { x: number; y: number; amount: number; }

interface GameStatePayload {
  players: ServerPlayer[]; enemies: ServerEnemy[]; projectiles: ServerProjectile[];
  pickups: ServerPickup[]; damageEvents: DamageEvent[];
  phase: string; currentWave: number; timeRemaining: number;
}

// Global dictionary to store the JSON configs sent by the server
let masterConfigs: any = {};

connection.on("ReceiveHandshake", (payload: any) => {
  masterConfigs = payload; // Contains .enemies, .weapons, .items
  console.log("Handshake received. Configs loaded:", masterConfigs);
});

connection.start().then(() => console.log("SignalR Connected!")).catch((err: any) => console.error(err));

// --- PHASER SCENE ---
class GameScene extends Phaser.Scene {
  // Game World Sprites
  private playerSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private enemySprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private projectileSprites: Map<string, Phaser.GameObjects.Rectangle> = new Map();
  private pickupSprites: Map<string, Phaser.GameObjects.Arc> = new Map();
  private targetPositions: Map<string, { x: number, y: number }> = new Map();
  private goldUIText!: Phaser.GameObjects.Text;
  // Input & State
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: any;
  private currentPhase: string = "WaitingForPlayers";
  private previousPhase: string = "WaitingForPlayers"; // >>> NEW: Tracks phase changes! <<<
  private manuallyClosedShop: boolean = false;
  // UI Modules
  private shopUIModule!: ShopUI;
  private waveUIText!: Phaser.GameObjects.Text;

  constructor() { super('GameScene'); }

  preload() {
    // If your grid is made of 32x32 pixel squares:
    this.load.spritesheet('enemies_sheet', 'assets/enemies_sheet.png', {
      frameWidth: 32,
      frameHeight: 32
    });

    // If your items grid is made of 16x16 pixel squares:
    this.load.spritesheet('items_sheet', 'assets/items_sheet.png', {
      frameWidth: 16,
      frameHeight: 16
    });

    this.load.spritesheet('weapons_sheet', 'assets/weapons_sheet.png', {
      frameWidth: 32,
      frameHeight: 32
    });
  }

  create() {
    this.cameras.main.setBackgroundColor('#2d2d2d');




    // 1. Setup Input
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    }
    this.input.mouse?.disableContextMenu();

    // 2. Initialize Game UI (Wave Timer)
    this.waveUIText = this.add.text(640, 20, 'Connecting...', {
      fontSize: '32px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5).setDepth(3000);

    this.goldUIText = this.add.text(20, 20, '💰 0', {
      fontSize: '28px', color: '#ffd700', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4
    }).setDepth(3000);


    // 3. Initialize Modular Shop UI
    this.shopUIModule = new ShopUI(this, connection);
    this.shopUIModule.setDepth(1000); // Ensure it's above the game world
    this.shopUIModule.setVisible(false);
    this.add.existing(this.shopUIModule);

    // 2. Update your Keybinds:
    this.input.keyboard?.on('keydown-B', () => {
      if (this.shopUIModule.visible) {
        this.shopUIModule.setVisible(false);
        this.manuallyClosedShop = true;
      } else {
        this.shopUIModule.setVisible(true);
        this.manuallyClosedShop = false;
      }
    });

    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.shopUIModule.visible) {
        this.shopUIModule.setVisible(false);
        this.manuallyClosedShop = true; // FIX: Remember that we closed it!
      }
    });

    // NEW EVENT LISTENER: Only triggers on wave end or when buying items!
    connection.on("UpdatePlayerUI", (uiData: any) => {
      if (this.shopUIModule) {
        this.shopUIModule.updateUIData(uiData, masterConfigs);
      }
    });

    // 5. Network Listener
    connection.on("UpdateState", (state: GameStatePayload) => {
      this.currentPhase = state.phase;

      const activePlayers = new Set<string>();
      const activeEnemies = new Set<string>();
      const activeProjectiles = new Set<string>();
      const activePickups = new Set<string>();

      // FIND THE LOCAL PLAYER AND UPDATE GOLD
      const myPlayer = state.players.find(p => p.connectionId === connection.connectionId);
      if (myPlayer) {
        this.goldUIText.setText(`💰 ${myPlayer.gold}`);

      }

      // --- AUTO-TOGGLE & UPDATE UI ---
      if (state.phase === "WaveActive") {
        this.waveUIText.setText(`Wave ${state.currentWave} - 0:${state.timeRemaining.toString().padStart(2, '0')}`);
        this.waveUIText.setColor('#ffffff');

        // >>> FIX 1: Only force the shop closed at the exact moment the wave starts! <<<
        if (this.previousPhase !== "WaveActive") {
          if (this.shopUIModule.visible) this.shopUIModule.setVisible(false);
          this.manuallyClosedShop = true;
        }
      } else if (state.phase === "ShopPhase") {
        this.waveUIText.setText(`SHOP PHASE - ${state.timeRemaining}s`);
        this.waveUIText.setColor('#00ff00');

        // >>> FIX 2: Only auto-open the shop at the exact moment the shop phase starts! <<<
        if (this.previousPhase !== "ShopPhase") {
          this.shopUIModule.setVisible(true);
          this.manuallyClosedShop = false;
        }
      }
      this.previousPhase = state.phase; // Remember for next frame!

      // --- GAME WORLD: PLAYERS ---
      state.players.forEach(sp => {
        activePlayers.add(sp.connectionId);
        this.targetPositions.set(sp.connectionId, { x: sp.x, y: sp.y });

        // 1. Create the Player container if they just joined
        if (!this.playerSprites.has(sp.connectionId)) {
          const container = this.add.container(sp.x, sp.y);
          const body = this.add.rectangle(0, 0, 32, 32, 0x00a8ff).setStrokeStyle(2, 0xffffff);
          const hpBg = this.add.rectangle(0, -24, 32, 6, 0x000000);
          const hpFill = this.add.rectangle(-16, -24, 32, 6, 0x00ff00).setOrigin(0, 0.5);

          const weaponsContainer = this.add.container(0, 0); // NEW: Sub-container for weapons

          container.add([body, hpBg, hpFill, weaponsContainer]);
          container.setData('hpFill', hpFill);
          container.setData('weaponsContainer', weaponsContainer); // Store it

          this.playerSprites.set(sp.connectionId, container);
        }

        const pContainer = this.playerSprites.get(sp.connectionId)!;
        const pHpFill = pContainer.getData('hpFill') as Phaser.GameObjects.Rectangle;
        pHpFill.width = 32 * Math.max(0, sp.currentHp / sp.maxHp);

        // 2. >>> FIX 3: DYNAMIC WEAPON RENDERING (Updates instantly on purchase!) <<<
        const weaponsContainer = pContainer.getData('weaponsContainer') as Phaser.GameObjects.Container;
        weaponsContainer.removeAll(true); // Clear old weapons

        sp.weapons.forEach(w => {
          let wx = 0, wy = 0; const offset = 26;

          // 4 Positions: Right, Left, Top, Bottom
          if (w.slotIndex === 0) { wx = offset; wy = 0; } // Right
          else if (w.slotIndex === 1) { wx = -offset; wy = 0; } // Left
          else if (w.slotIndex === 2) { wx = 0; wy = -offset; } // Top
          else if (w.slotIndex === 3) { wx = 0; wy = offset; } // Bottom

          const config = masterConfigs.weapons ? masterConfigs.weapons[w.configId] : null;
          if (config && config.textureKey) {
            // Draw the actual weapon image!
            const sprite = this.add.sprite(wx, wy, config.textureKey);
            if (config.iconFrame !== undefined) sprite.setFrame(config.iconFrame);
            sprite.setScale((config.scale || 1.0) * 0.7); // Scale down slightly so it looks good orbiting
            weaponsContainer.add(sprite);
          } else {
            weaponsContainer.add(this.add.rectangle(wx, wy, 12, 12, 0xffd700));
          }
        });
      });
      // --- GAME WORLD: ENEMIES ---
      state.enemies.forEach(se => {
        activeEnemies.add(se.id);
        this.targetPositions.set(se.id, { x: se.x, y: se.y });

        if (!this.enemySprites.has(se.id)) {
          const container = this.add.container(se.x, se.y);
          const config = masterConfigs.enemies ? masterConfigs.enemies[se.configId] : null;

          let body;
          if (config && config.textureKey) {
            body = this.add.sprite(0, 0, config.textureKey);
            body.setScale(config.scale || 1.0);
            if (config.animIdle) body.play(`${config.id}_idle`);
            else if (config.iconFrame !== undefined) body.setFrame(config.iconFrame);
          } else {
            body = this.add.rectangle(0, 0, 32, 32, 0xff0000);
          }

          const hpBg = this.add.rectangle(0, -24, 32, 4, 0x000000);
          const hpFill = this.add.rectangle(-16, -24, 32, 4, 0x00ff00).setOrigin(0, 0.5);

          container.add([body, hpBg, hpFill]);
          // FIX: Actually save the bodySprite so we can access it later!
          container.setData('bodySprite', body);
          container.setData('hpFill', hpFill);
          container.setData('baseWidth', 32);
          this.enemySprites.set(se.id, container);
        }

        const eContainer = this.enemySprites.get(se.id)!;

        // >>> FIX: MOVE HP BAR LOGIC OUTSIDE THE ANIMATION CHECK <<<
        const eHpFill = eContainer.getData('hpFill') as Phaser.GameObjects.Rectangle;
        const eBaseW = eContainer.getData('baseWidth') as number;
        const hpPercent = Math.max(0, se.currentHp / se.maxHp);
        eHpFill.width = eBaseW * hpPercent;

        if (hpPercent < 0.2) eHpFill.fillColor = 0xff0000;
        else if (hpPercent < 0.5) eHpFill.fillColor = 0xffff00;
        else eHpFill.fillColor = 0x00ff00;

        // Animation State Machine
        const body = eContainer.getData('bodySprite') as Phaser.GameObjects.Sprite;
        if (body && body.anims) {
          const config = masterConfigs.enemies[se.configId];
          if (config) {
            if (se.actionState === "Attacking" && config.animAttack) {
              if (body.anims.currentAnim?.key !== `${config.id}_attack`) body.play(`${config.id}_attack`);
            }
            else if (se.actionState === "Moving" && config.animIdle) {
              if (body.anims.currentAnim?.key !== `${config.id}_idle`) body.play(`${config.id}_idle`);
            }
          }
        }
      });


      // --- GAME WORLD: PROJECTILES ---
      state.projectiles.forEach(proj => {
        activeProjectiles.add(proj.id);
        this.targetPositions.set(proj.id, { x: proj.x, y: proj.y });
        if (!this.projectileSprites.has(proj.id)) {
          // Replace rectangle with your bullet image
          const sprite = this.add.sprite(proj.x, proj.y, 'bullet');

          // Optional: Rotate bullet based on velocity
          // (You'd need to send VelX and VelY in your payload to calculate Math.atan2 here)

          this.projectileSprites.set(proj.id, sprite as any);
        }
      });

      // --- GAME WORLD: PICKUPS (GOLD) ---
      state.pickups.forEach(pickup => {
        activePickups.add(pickup.id);
        if (!this.pickupSprites.has(pickup.id)) {
          // Replace circle with a coin image
          const sprite = this.add.sprite(pickup.x, pickup.y, 'gold_coin');
          this.pickupSprites.set(pickup.id, sprite as any);
        }
      });

      // --- GAME WORLD: FLOATING DAMAGE TEXT ---
      state.damageEvents.forEach(de => {
        const floatingText = this.add.text(de.x, de.y - 16, Math.round(de.amount).toString(), {
          fontSize: '18px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5);

        this.tweens.add({
          targets: floatingText,
          y: de.y - 40,
          alpha: 0,
          duration: 700,
          onComplete: () => floatingText.destroy()
        });
      });

      // --- CLEANUP ---
      this.cleanupSprites(this.playerSprites, activePlayers);
      this.cleanupSprites(this.enemySprites, activeEnemies);
      this.cleanupSprites(this.projectileSprites, activeProjectiles);
      this.cleanupSprites(this.pickupSprites, activePickups);
    });
  }

  update() {
    this.handleInput();
    this.smoothInterpolateSprites(this.playerSprites, 0.2);
    this.smoothInterpolateSprites(this.enemySprites, 0.2);
    this.smoothInterpolateSprites(this.projectileSprites, 0.4); // Bullets lerp faster
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
      DirX: dirX,
      DirY: dirY,
      AimX: pointer.worldX,
      AimY: pointer.worldY
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
    if (!configs.enemies) return;

    Object.values(configs.enemies).forEach((enemy: any) => {
      // 1. Create Idle Animation
      if (enemy.animIdle && enemy.animIdle.length === 2) {
        this.anims.create({
          key: `${enemy.id}_idle`,
          frames: this.anims.generateFrameNumbers(enemy.textureKey, {
            start: enemy.animIdle[0],
            end: enemy.animIdle[1]
          }),
          frameRate: 10,
          repeat: -1
        });
      }

      // 2. Create Attack Animation
      if (enemy.animAttack && enemy.animAttack.length === 2) {
        this.anims.create({
          key: `${enemy.id}_attack`,
          frames: this.anims.generateFrameNumbers(enemy.textureKey, {
            start: enemy.animAttack[0],
            end: enemy.animAttack[1]
          }),
          frameRate: 15,
          repeat: 0
        });
      }
    });
  }
}

// --- INITIALIZE PHASER ---
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  scale: {
      mode: Phaser.Scale.FIT, // Instantly scales to fit the screen
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 1920,
      height: 1080
  },
  scene: GameScene,
  parent: 'app'
};
new Phaser.Game(config);