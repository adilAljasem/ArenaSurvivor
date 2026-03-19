import * as Phaser from 'phaser';
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { ShopUI } from './ui/UI';

// --- SIGNALR CONNECTION ---
const connection = new HubConnectionBuilder()
  .withUrl("http://localhost:5000/gameHub") // Ensure this matches your .NET port
  .withAutomaticReconnect()
  .build();

// --- INTERFACES ---
interface EquippedWeapon { configId: string; slotIndex: number; level: number; }
interface ShopItem { configId: string; name: string; price: number; }
interface ServerPlayer {
  connectionId: string;
  configId: string;       // <--- NEW
  actionState: string;    // <--- NEW
  x: number;
  y: number;
  velX?: number;          // <--- NEW (The '?' means it's optional)
  weapons: EquippedWeapon[];
  currentHp: number;
  maxHp: number;
  gold: number;
  currentShop: ShopItem[];
  stats: any;
  ownedItems: any;
  aimX: number;           // <--- NEW
  aimY: number;           // <--- NEW
  firedWeapons: number[];
  activeEffects: string[];// <--- NEW
}
interface ServerEnemy {
  id: string;
  configId: string;
  x: number;
  y: number;
  velX?: number;          // <--- NEW (The '?' means it's optional)
  currentHp: number;
  maxHp: number;
  actionState: string;
  activeEffects: string[];
}
interface ServerProjectile {
  id: string;
  configId: string;
  x: number;
  y: number;
  velX: number; // <--- NEW
  velY: number; // <--- NEW
}
interface ServerPickup { id: string; x: number; y: number; value: number; }
interface DamageEvent { x: number; y: number; amount: number; }
interface ServerProjectile { id: string; configId: string; x: number; y: number; } // Added configId!

interface GameStatePayload {
  players: ServerPlayer[]; enemies: ServerEnemy[]; projectiles: ServerProjectile[];
  pickups: ServerPickup[]; damageEvents: DamageEvent[];
  phase: string; currentWave: number; timeRemaining: number;
}

// Global dictionary to store the JSON configs sent by the server
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

  // >>> NEW: Debug Mode Variables <<<
  private isDebugMode: boolean = false;
  private debugGraphics!: Phaser.GameObjects.Graphics;

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
  }

  create() {
    this.cameras.main.setBackgroundColor('#2d2d2d');

    // 1. Build animations on startup
    if (masterConfigs.enemies) {
      this.createAnimations(masterConfigs);
    }

    // 2. >>> NEW: ALWAYS listen for Hot Reloads and build any missing animations! <<<
    window.addEventListener('configsReady', () => {
      if (this.anims) {
        this.createAnimations(masterConfigs);
      }
    });

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

    this.shopUIModule = new ShopUI(this, connection);
    this.shopUIModule.setDepth(1000);
    this.shopUIModule.setVisible(false);
    this.add.existing(this.shopUIModule);

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
        this.manuallyClosedShop = true;
      }
    });

    // >>> NEW: Press 'H' to toggle Hitboxes! <<<
    this.input.keyboard?.on('keydown-H', () => {
      this.isDebugMode = !this.isDebugMode;
      console.log(`Debug Mode: ${this.isDebugMode ? "ON" : "OFF"}`);
    });

    // Create the debug drawing layer (Depth 9999 ensures it's on top of everything)
    this.debugGraphics = this.add.graphics().setDepth(9999);

    connection.on("UpdatePlayerUI", (uiData: any) => {
      if (this.shopUIModule) {
        this.shopUIModule.updateUIData(uiData, masterConfigs);
      }
    });

    connection.on("UpdateState", (state: GameStatePayload) => {
      this.currentPhase = state.phase;

      const activePlayers = new Set<string>();
      const activeEnemies = new Set<string>();
      const activeProjectiles = new Set<string>();
      const activePickups = new Set<string>();

      const myPlayer = state.players.find(p => p.connectionId === connection.connectionId);
      if (myPlayer) {
        this.goldUIText.setText(`💰 ${myPlayer.gold}`);
      }

      if (state.phase === "WaveActive") {
        this.waveUIText.setText(`Wave ${state.currentWave} - 0:${state.timeRemaining.toString().padStart(2, '0')}`);
        this.waveUIText.setColor('#ffffff');

        if (this.previousPhase !== "WaveActive") {
          if (this.shopUIModule.visible) this.shopUIModule.setVisible(false);
          this.manuallyClosedShop = true;
        }
      } else if (state.phase === "ShopPhase") {
        this.waveUIText.setText(`SHOP PHASE - ${state.timeRemaining}s`);
        this.waveUIText.setColor('#00ff00');

        if (this.previousPhase !== "ShopPhase") {
          this.shopUIModule.setVisible(true);
          this.manuallyClosedShop = false;
        }
      }
      this.previousPhase = state.phase;

      // --- GAME WORLD: PLAYERS ---
      state.players.forEach(sp => {
        activePlayers.add(sp.connectionId);
        this.targetPositions.set(sp.connectionId, { x: sp.x, y: sp.y });

        if (!this.playerSprites.has(sp.connectionId)) {
          const container = this.add.container(sp.x, sp.y);

          let body;
          if (masterConfigs.characters && masterConfigs.characters["char_well_rounded"] && this.textures.exists(masterConfigs.characters["char_well_rounded"].textureKey)) {
            const charCfg = masterConfigs.characters["char_well_rounded"];
            body = this.add.sprite(0, 0, charCfg.textureKey, charCfg.iconFrame);
          } else {
            // >>> GLOBAL FALLBACK: BLACK & GREEN BOX <<<
            body = this.add.rectangle(0, 0, 32, 32, 0x000000).setStrokeStyle(2, 0x00ff00);
          }

          const hpBg = this.add.rectangle(0, -24, 32, 6, 0x000000);
          const hpFill = this.add.rectangle(-16, -24, 32, 6, 0x00ff00).setOrigin(0, 0.5);
          const weaponsContainer = this.add.container(0, 0);

          container.add([body, hpBg, hpFill, weaponsContainer]);
          container.setData('bodySprite', body);
          container.setData('hpFill', hpFill);
          container.setData('weaponsContainer', weaponsContainer);

          this.playerSprites.set(sp.connectionId, container);
        }

        const pContainer = this.playerSprites.get(sp.connectionId)!;
        const pHpFill = pContainer.getData('hpFill') as Phaser.GameObjects.Rectangle;
        pHpFill.width = 32 * Math.max(0, sp.currentHp / sp.maxHp);

        // >>> THE PUPPET MASTER: PLAYER ANIMATIONS & FLIPPING <<<
        const body = pContainer.getData('bodySprite') as Phaser.GameObjects.Sprite;
        const config = masterConfigs.characters ? masterConfigs.characters[sp.configId] : null;

        if (body && body.type === 'Sprite' && config) {
          let targetAnim = `${config.id}_idle`;

          if (sp.actionState === "Dead" && config.animDeath) {
            targetAnim = `${config.id}_death`;
          } else if (sp.actionState === "Attacking" && config.animAttack) {
            targetAnim = `${config.id}_attack`;
          } else if (sp.actionState === "Moving" && config.animMove) {
            targetAnim = `${config.id}_move`;
          } else if (config.animIdle) {
            targetAnim = `${config.id}_idle`;
          }

          // Only play if the target animation is different, 
          // OR if it's an attack animation that has completely finished playing!
          const isCorrectAnim = body.anims && body.anims.currentAnim?.key === targetAnim;
          const isFinishedAttacking = body.anims && !body.anims.isPlaying && sp.actionState === "Attacking";

          if (!isCorrectAnim || isFinishedAttacking) {
            body.play(targetAnim);
          }

          // >>> THE INVERTED SPRITE FIX <<<
          const isDefaultRight = config.defaultFacingRight !== false;
          // Fallback to position comparison if Server doesn't send velX yet
          const moveDelta = sp.velX !== undefined ? sp.velX : (sp.x - pContainer.x);

          if (moveDelta > 0.5) {
            body.setFlipX(!isDefaultRight);
          } else if (moveDelta < -0.5) {
            body.setFlipX(isDefaultRight);
          }
        }

        const weaponsContainer = pContainer.getData('weaponsContainer') as Phaser.GameObjects.Container;
        const activeWeaponSlots = new Set<number>();

        sp.weapons.forEach(w => {
          activeWeaponSlots.add(w.slotIndex);

          // Base resting positions around the player
          let wx = 0, wy = 0; const offset = 26;
          if (w.slotIndex === 0) { wx = offset; wy = 0; }
          else if (w.slotIndex === 1) { wx = -offset; wy = 0; }
          else if (w.slotIndex === 2) { wx = 0; wy = -offset; }
          else if (w.slotIndex === 3) { wx = 0; wy = offset; }

          const config = masterConfigs.weapons ? masterConfigs.weapons[w.configId] : null;

          // Instead of deleting the weapon, try to find it!
          let sprite = weaponsContainer.getByName(`weapon_${w.slotIndex}`) as Phaser.GameObjects.Sprite;

          if (!sprite) {
            // It doesn't exist yet, so create it!
            if (config && config.textureKey && this.textures.exists(config.textureKey)) {
              sprite = this.add.sprite(wx, wy, config.textureKey);
              if (config.iconFrame !== undefined) sprite.setFrame(config.iconFrame);
              sprite.setName(`weapon_${w.slotIndex}`);

              // >>> FIX: Apply Scale and Facing Right <<<
              sprite.setScale(config.scale || 1.0);
              if (config.defaultFacingRight === false) sprite.setFlipX(true);

              weaponsContainer.add(sprite);
            }
          }

          if (sprite && config) {
            // 1. >>> AIM AT THE MOUSE & FIX UPSIDE-DOWN WEAPONS <<<
            const angle = Math.atan2(sp.aimY - sp.y, sp.aimX - sp.x);
            sprite.rotation = angle;

            // If the angle is aiming "Left" (past 90 degrees up or down), flip it vertically!
            if (Math.abs(angle) > Math.PI / 2) {
              sprite.setFlipY(true);
            } else {
              sprite.setFlipY(false);
            }

            // 2. >>> PROCEDURAL ANIMATIONS (TWEENS) <<<
            // If the server says this weapon fired this tick, animate it!
            if (sp.firedWeapons && sp.firedWeapons.includes(w.slotIndex)) {
              if (!this.tweens.isTweening(sprite)) { // Don't interrupt it if it's already swinging!
                const animType = config.attackAnimType || "recoil";

                if (animType === "stab") {
                  // Thrust forward toward the mouse!
                  this.tweens.add({
                    targets: sprite,
                    x: wx + Math.cos(angle) * 20,
                    y: wy + Math.sin(angle) * 20,
                    yoyo: true, duration: 100, ease: 'Power2'
                  });
                }
                else if (animType === "recoil") {
                  // Kick backwards away from the mouse!
                  this.tweens.add({
                    targets: sprite,
                    x: wx + Math.cos(angle) * -15,
                    y: wy + Math.sin(angle) * -15,
                    yoyo: true, duration: 80, ease: 'Cubic.easeOut'
                  });
                }
                else if (animType === "swing") {
                  // Do a 360 spin!
                  this.tweens.add({
                    targets: sprite,
                    angle: sprite.angle + 360,
                    duration: 150, ease: 'Linear'
                  });
                }
              }
            }

            // 3. Return to resting position if it's not currently animating
            if (!this.tweens.isTweening(sprite)) {
              sprite.x = wx;
              sprite.y = wy;
            }
          }
        });

        // Cleanup: If you sold a weapon, remove its sprite!
        weaponsContainer.each((child: Phaser.GameObjects.Sprite) => {
          const slotStr = child.name.split('_')[1];
          if (!activeWeaponSlots.has(parseInt(slotStr))) {
            child.destroy();
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
          if (config && config.textureKey && this.textures.exists(config.textureKey)) {
            body = this.add.sprite(0, 0, config.textureKey);
            body.setScale(config.scale || 1.0);

            if (config.animIdle && this.anims.exists(`${config.id}_idle`)) {
              body.play(`${config.id}_idle`);
            } else if (config.iconFrame !== undefined) {
              body.setFrame(config.iconFrame);
            }
          } else {
            // >>> GLOBAL FALLBACK: BLACK & GREEN BOX <<<
            body = this.add.rectangle(0, 0, 32, 32, 0x000000).setStrokeStyle(2, 0x00ff00) as any;
          }

          const hpBg = this.add.rectangle(0, -24, 32, 4, 0x000000);
          const hpFill = this.add.rectangle(-16, -24, 32, 4, 0x00ff00).setOrigin(0, 0.5);

          container.add([body, hpBg, hpFill]);
          container.setData('bodySprite', body);
          container.setData('hpFill', hpFill);
          container.setData('baseWidth', 32 * (config?.scale || 1.0));
          container.setData('configId', se.configId);
          this.enemySprites.set(se.id, container);
        }

        const eContainer = this.enemySprites.get(se.id)!;
        const eHpFill = eContainer.getData('hpFill') as Phaser.GameObjects.Rectangle;
        const eBaseW = eContainer.getData('baseWidth') as number;

        const hpPercent = Math.max(0, se.currentHp / se.maxHp);
        eHpFill.width = eBaseW * hpPercent;

        if (hpPercent < 0.2) eHpFill.fillColor = 0xff0000;
        else if (hpPercent < 0.5) eHpFill.fillColor = 0xffff00;
        else eHpFill.fillColor = 0x00ff00;

        // >>> THE PUPPET MASTER: ENEMY ANIMATIONS & FLIPPING <<<
        const body = eContainer.getData('bodySprite') as Phaser.GameObjects.Sprite;
        const config = masterConfigs.enemies ? masterConfigs.enemies[se.configId] : null;

        if (body && body.anims && config) {
          let targetAnim = `${config.id}_idle`;

          if (se.actionState === "Dead" && config.animDeath) {
            targetAnim = `${config.id}_death`;
          } else if (se.actionState === "Attacking" && config.animAttack) {
            targetAnim = `${config.id}_attack`;
          } else if (se.actionState === "Moving" && config.animMove) {
            targetAnim = `${config.id}_move`;
          } else if (config.animIdle) {
            targetAnim = `${config.id}_idle`;
          }

          // Only play if the target animation is different, 
          // OR if it's an attack animation that has completely finished playing!
          const isCorrectAnim = body.anims.currentAnim?.key === targetAnim;
          const isFinishedAttacking = !body.anims.isPlaying && se.actionState === "Attacking";

          if (!isCorrectAnim || isFinishedAttacking) {
            body.play(targetAnim);
          }
          // >>> THE INVERTED SPRITE FIX <<<
          const isDefaultRight = config.defaultFacingRight !== false;
          const moveDelta = se.velX !== undefined ? se.velX : (se.x - eContainer.x);

          // LOWERED THRESHOLD TO 0.1
          if (moveDelta > 0.1) {
            body.setFlipX(!isDefaultRight);
          } else if (moveDelta < -0.1) {
            body.setFlipX(isDefaultRight);
          }
          // >>> NEW: EFFECT VISUALS (COLOR TINTING) <<<
          let appliedTint = false;
          if (se.activeEffects && masterConfigs.effects) {
            // Find the first effect that has a colorTint
            for (const effectId of se.activeEffects) {
              const effectConfig = masterConfigs.effects[effectId];
              if (effectConfig && effectConfig.colorTint) {
                // Convert hex string "0x00ff00" to a real number
                body.setTint(parseInt(effectConfig.colorTint, 16));
                appliedTint = true;
                break; // Only apply one tint at a time
              }
            }
          }
          if (!appliedTint) body.clearTint(); // Remove tint if no effects are active!
        }
      });

      // --- GAME WORLD: PROJECTILES ---
      state.projectiles.forEach(proj => {
        activeProjectiles.add(proj.id);
        this.targetPositions.set(proj.id, { x: proj.x, y: proj.y });


        let sprite = this.projectileSprites.get(proj.id) as Phaser.GameObjects.Sprite;
        const pConfig = masterConfigs.projectiles ? masterConfigs.projectiles[proj.configId] : null;

        if (!sprite) {
          // 1. Spawning the Bullet
          if (pConfig && pConfig.textureKey && pConfig.textureKey.trim() !== "" && this.textures.exists(pConfig.textureKey)) {
            sprite = this.add.sprite(proj.x, proj.y, pConfig.textureKey);

            // Play animation or set static frame
            if (pConfig.animFly) sprite.play(`${pConfig.id}_fly`);
            else if (pConfig.iconFrame !== undefined) sprite.setFrame(pConfig.iconFrame);

            sprite.setScale(pConfig.scale || 1.0);
          } else {
            // Fallback box
            sprite = this.add.rectangle(proj.x, proj.y, 10, 10, 0x000000).setStrokeStyle(2, 0x00ff00) as any;
          }
          sprite.setDepth(10);
          // Save the configId so the debug drawer knows how big to draw the circle
          (sprite as any).setData('configId', proj.configId);
          this.projectileSprites.set(proj.id, sprite as any);
        }

        // 2. >>> NEW: ROTATE THE BULLET TO FACE VELOCITY <<<
        if (sprite.type === 'Sprite') {
          const target = this.targetPositions.get(proj.id);
          if (target) {
            if (proj.velX !== 0 || proj.velY !== 0) {
              sprite.rotation = Math.atan2(proj.velY, proj.velX);
            }
          }
        }
      });

      // --- GAME WORLD: PICKUPS (GOLD) ---
      state.pickups.forEach(pickup => {
        activePickups.add(pickup.id);
        if (!this.pickupSprites.has(pickup.id)) {
          let sprite;
          if (this.textures.exists('items_sheet')) {
            sprite = this.add.sprite(pickup.x, pickup.y, 'items_sheet', 6);
          } else {
            // >>> GLOBAL FALLBACK: BLACK & GREEN BOX <<<
            sprite = this.add.rectangle(pickup.x, pickup.y, 12, 12, 0x000000).setStrokeStyle(2, 0x00ff00);
          }
          this.pickupSprites.set(pickup.id, sprite as any);
        }
      });

      // --- GAME WORLD: FLOATING DAMAGE TEXT ---
      state.damageEvents.forEach(de => {
        const floatingText = this.add.text(de.x, de.y - 16, Math.round(de.amount).toString(), {
          fontSize: '18px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(20);

        this.tweens.add({
          targets: floatingText,
          y: de.y - 40,
          alpha: 0,
          duration: 700,
          onComplete: () => floatingText.destroy()
        });
      });

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
    this.smoothInterpolateSprites(this.projectileSprites, 0.4);

    // >>> NEW: THE DEBUG DRAWER <<<
    this.debugGraphics.clear(); // Clear the old circles from last frame

    if (this.isDebugMode) {
      // 1. Draw Player Hitboxes (Cyan)
      this.playerSprites.forEach((sprite) => {
        this.debugGraphics.lineStyle(2, 0x00ffff);
        this.debugGraphics.strokeCircle(sprite.x, sprite.y, 15); // Players are hardcoded to 15 for now
      });

      // 2. Draw Enemy Hitboxes (Red)
      this.enemySprites.forEach((sprite) => {
        const configId = sprite.getData('configId');
        const config = masterConfigs.enemies ? masterConfigs.enemies[configId] : null;

        // >>> FIX: Removed the * scale multiplier! <<<
        const radius = config ? (config.hitRadius || 15) : 15;

        this.debugGraphics.lineStyle(2, 0xff0000);
        this.debugGraphics.strokeCircle(sprite.x, sprite.y, radius);
      });

      // 3. Draw Projectile & Melee Hitboxes (Green)
      this.projectileSprites.forEach((sprite) => {
        const configId = (sprite as any).getData('configId');
        const config = masterConfigs.projectiles ? masterConfigs.projectiles[configId] : null;

        // >>> FIX: Removed the * scale multiplier! <<<
        const radius = config ? (config.hitRadius || 10) : 10;

        this.debugGraphics.lineStyle(2, 0x00ff00);
        this.debugGraphics.strokeCircle(sprite.x, sprite.y, radius);

        // 4. Draw Pickup Hitboxes (Yellow)
        this.pickupSprites.forEach((sprite, id) => {
          // >>> FUTURE-PROOFING <<<
          // Right now, Gold might be hardcoded on your server.
          // Later, when you make a Pickups.json, you will grab the ID like this:
          // const configId = (sprite as any).getData('configId');
          // const config = masterConfigs.pickups ? masterConfigs.pickups[configId] : null;
          // const radius = config ? config.hitRadius : 15;

          // For now, we will use a standard radius of 15 for all dropped items
          const radius = 15;

          this.debugGraphics.lineStyle(2, 0xffff00); // Yellow circle for dropped items
          this.debugGraphics.strokeCircle(sprite.x, sprite.y, radius);
        });
      });
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
    // 1. Combine all configurable entities into one giant array
    const allEntities = [
      ...(configs.enemies ? Object.values(configs.enemies) : []),
      ...(configs.projectiles ? Object.values(configs.projectiles) : []),
      ...(configs.characters ? Object.values(configs.characters) : [])
    ];

    // 2. Loop through every entity in the game
    allEntities.forEach((entity: any) => {
      if (!entity.textureKey) return; // Skip if it has no sprite sheet

      // 3. Look at every property inside the entity's JSON
      Object.keys(entity).forEach(key => {

        // 4. THE MAGIC: If the property starts with 'anim' and is an array of 2 numbers!
        if (key.startsWith('anim') && Array.isArray(entity[key]) && entity[key].length === 2) {

          // Extract the action name (e.g., 'animIdle' becomes 'idle', 'animFly' becomes 'fly')
          const actionName = key.replace('anim', '').toLowerCase();
          const animKey = `${entity.id}_${actionName}`;

          if (!this.anims.exists(animKey)) {
            // Check if there is a custom framerate defined in the JSON (e.g., 'animIdleFrameRate')
            const customFrameRate = entity[`${key}FrameRate`] || 15;

            // Attacks and Hits should only play once. Flying and Idling should loop forever (-1).
            const shouldLoop = (actionName === 'attack' || actionName === 'hit' || actionName === 'death') ? 0 : -1;
            this.anims.create({
              key: animKey,
              frames: this.anims.generateFrameNumbers(entity.textureKey, {
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
  type: Phaser.AUTO,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%'
  },
  scene: GameScene,
  parent: 'app',
  pixelArt: true
};
new Phaser.Game(config);