import * as Phaser from 'phaser';
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { ShopUI, Tooltip } from './ui/UI';
import { EscMenu } from './ui/EscMenu';
import { PlayerRenderer, EnemyRenderer, WorldRenderer, precalculateSpriteTops } from './RenderSystems';
import { AudioManager } from './AudioManager';
import pako from 'pako';

// --- SIGNALR CONNECTION ---
const connection = new HubConnectionBuilder()
  .withUrl("http://localhost:5000/gameHub")
  .withAutomaticReconnect()
  .build();

// --- INTERFACES ---
interface EquippedWeapon { configId: string; slotIndex: number; level: number; }
interface ShopItem { configId: string; name: string; price: number; }
interface AoeEvent { x: number; y: number; radius: number; isFriendly: boolean; configId?: string; }
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
  aimX?: number; aimY?: number; firedWeapons: number[];
  weapons: { configId: string; slotIndex: number; level: number; rolledStats: Record<string, number>; totalBaseStats: Record<string, number>; }[];
}
interface ServerProjectile { id: string; configId: string; x: number; y: number; velX: number; velY: number; }
interface ServerPickup {
  id: string; x: number; y: number; value: number;
  type: number;         // 0=Gold, 1=Weapon, 2=Item
  gearConfigId: string;
  level: number;
  totalBaseStats: Record<string, number>;
  rolledStats: Record<string, number>;
  skills: string[];
}
interface DamageEvent { x: number; y: number; amount: number; }

export interface GameStatePayload {
  players: ServerPlayer[]; enemies: ServerEnemy[]; projectiles: ServerProjectile[];
  pickups: ServerPickup[]; damageEvents: DamageEvent[]; aoeEvents: AoeEvent[];
  phase: string; currentWave: number; timeRemaining: number;
}

let masterConfigs: any = {};

connection.on("ReceiveHandshake", (payload: any) => {
  masterConfigs = payload;
  console.log("Handshake received. Configs loaded.");
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

  private enemyCache: Map<string, ServerEnemy> = new Map();
  private pickupCache: Map<string, ServerPickup> = new Map();

  private goldUIText!: Phaser.GameObjects.Text;
  private waveUIText!: Phaser.GameObjects.Text;
  private shopUIModule!: ShopUI;
  private escMenu!: EscMenu;
  private perfText!: Phaser.GameObjects.Text;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: any;
  private currentPhase: string = "WaitingForPlayers";
  private previousPhase: string = "WaitingForPlayers";
  private manuallyClosedShop: boolean = false;

  private hasScannedSprites: boolean = false;

  // Spacebar loot pickup
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private nearbyLootId: string | null = null;
  private groundTooltip!: Tooltip;

  // Map Variables
  private isMapInitialized: boolean = false;
  private mapWidth: number = 4000;
  private mapHeight: number = 4000;

  private lastInputSendTime: number = 0;
  private lastSentInput: string = "";

  private isDebugMode: boolean = false;
  private debugGraphics!: Phaser.GameObjects.Graphics;
  private bytesReceivedSinceLastTick: number = 0;
  private lastBandwidthTime: number = 0;
  private currentKbps: string = "0.00";
  private currentDrawCalls: number = 0;
  private maxDrawCalls: number = 0;
  private pingMs: number = 0;
  private lastNetworkEntitiesCount: number = 0;

  private compressedBytesReceived: number = 0;
  private uncompressedBytesReceived: number = 0;
  private currentCompressedKbps: string = "0.00";
  private currentUncompressedKbps: string = "0.00";

  // Memory-leak prevention: store handles to be cleaned up on shutdown
  private pingIntervalId: ReturnType<typeof setInterval> | null = null;

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
    this.load.spritesheet('effects1', 'assets/Effects/effects1.png', { frameWidth: 64, frameHeight: 64 });


    this.load.audio('sfx_shoot', 'assets/Audio/weapon-fire-1.wav');
    this.load.audio('ball-shoot', 'assets/Audio/ball-tap.wav');
    this.load.audio('sword-shoot', 'assets/Audio/sword-strikes.wav');



  }

  create() {
    this.cameras.main.setBackgroundColor('#2d2d2d');

    // Initialise the global AudioManager with this scene's sound system
    AudioManager.getInstance().init(this);

    // >>> FIX: Map Initialization moved strictly to Handshake Event! <<<
    window.addEventListener('configsReady', () => {
      if (this.anims) this.createAnimations(masterConfigs);

      // >>> FIX: Bulletproof map selection! If currentMapId is missing, grab the first map in the JSON! <<<
      const mapIdToUse = masterConfigs.currentMapId || masterConfigs.CurrentMapId ||
        (masterConfigs.maps ? Object.keys(masterConfigs.maps)[0] : null) ||
        (masterConfigs.Maps ? Object.keys(masterConfigs.Maps)[0] : null);

      if (!this.isMapInitialized && mapIdToUse) {
        const currentMap = (masterConfigs.maps && masterConfigs.maps[mapIdToUse]) || (masterConfigs.Maps && masterConfigs.Maps[mapIdToUse]);

        if (currentMap) {
          this.isMapInitialized = true;
          this.mapWidth = currentMap.width || currentMap.Width;
          this.mapHeight = currentMap.height || currentMap.Height;

          // 1. Draw Floor Grid
          this.add.grid(this.mapWidth / 2, this.mapHeight / 2, this.mapWidth, this.mapHeight, 64, 64, 0x1a1a1a, 1, 0x333333, 1).setDepth(-2);

          // 2. Draw Red Glowing Border (Inset by 10 pixels so the camera doesn't clip it!)
          const border = this.add.graphics();
          border.lineStyle(16, 0xff0000, 1);
          border.strokeRect(10, 10, this.mapWidth - 20, this.mapHeight - 20);
          border.setDepth(-1);
          border.postFX.addGlow(0xff0000, 6, 0, false, 0.1, 15);

          // 3. Lock Camera
          this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);
        }
      }
    }, { once: true });

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,A,S,D');
      this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    }
    this.input.mouse?.disableContextMenu();

    this.groundTooltip = new Tooltip(this);

    const renderer = this.game.renderer as any;
    const gl = renderer.gl;
    if (gl && !gl.__isHooked) {
      gl.__isHooked = true;
      let frameDraws = 0;
      const originalDrawElements = gl.drawElements;
      const originalDrawArrays = gl.drawArrays;
      gl.drawElements = function () { frameDraws++; return originalDrawElements.apply(this, arguments as any); };
      gl.drawArrays = function () { frameDraws++; return originalDrawArrays.apply(this, arguments as any); };
      this.game.events.on(Phaser.Core.Events.PRE_RENDER, () => { frameDraws = 0; });
      this.game.events.on(Phaser.Core.Events.POST_RENDER, () => {
        this.currentDrawCalls = frameDraws;
        if (this.currentDrawCalls > this.maxDrawCalls) this.maxDrawCalls = this.currentDrawCalls;
      });
    }

    this.pingIntervalId = setInterval(() => {
      if (connection.state === HubConnectionState.Connected) {
        const startTime = Date.now();
        connection.invoke("Ping").then(() => { this.pingMs = Date.now() - startTime; }).catch(() => { });
      }
    }, 1000);

    this.waveUIText = this.add.text(this.scale.width / 2, 20, 'Connecting...', {
      fontSize: '32px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5).setDepth(3000).setScrollFactor(0);

    this.goldUIText = this.add.text(20, 20, '💰 0', {
      fontSize: '28px', color: '#ffd700', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4
    }).setDepth(3000).setScrollFactor(0);

    this.perfText = this.add.text(10, this.scale.height - 10, '', {
      fontFamily: "'Segoe UI', Consolas, monospace", fontSize: '14px', color: '#00ff00',
      backgroundColor: '#000000aa', padding: { x: 8, y: 8 }
    }).setOrigin(0, 1).setDepth(9999).setVisible(false).setScrollFactor(0);

    this.shopUIModule = new ShopUI(this, connection);
    this.shopUIModule.setDepth(1000);
    this.shopUIModule.setVisible(false);

    // ESC Menu (appears when pressing ESC while no other panel is open)
    this.escMenu = new EscMenu(this);
    this.escMenu.setVisible(false);

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.perfText.setPosition(10, gameSize.height - 10);
      this.waveUIText.setPosition(gameSize.width / 2, 20);
      this.escMenu.reposition(gameSize.width, gameSize.height);
    });

    this.input.keyboard?.on('keydown-B', () => {
      this.shopUIModule.setVisible(!this.shopUIModule.visible);
      this.manuallyClosedShop = !this.shopUIModule.visible;
    });
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.shopUIModule.visible) {
        // First priority: close the shop
        this.shopUIModule.setVisible(false);
        this.manuallyClosedShop = true;
      } else if (this.escMenu.visible) {
        // Second priority: close the ESC menu
        this.escMenu.setVisible(false);
      } else {
        // Nothing open → open the ESC menu
        this.escMenu.setVisible(true);
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

    connection.on("UpdateStateCompressed", (compressedBase64: string) => {
      // 1. Dual-Tracker Math
      const compressedSize = compressedBase64.length + 50;
      this.compressedBytesReceived += compressedSize;

      // Decode Base64 and Decompress with Pako
      const binaryString = atob(compressedBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const decompressedBytes = pako.ungzip(bytes);
      const jsonString = new TextDecoder().decode(decompressedBytes);

      const uncompressedSize = new TextEncoder().encode(jsonString).length + 50;
      this.uncompressedBytesReceived += uncompressedSize;

      const rawState = JSON.parse(jsonString);

      this.lastNetworkEntitiesCount =
        (rawState.p?.length || 0) + (rawState.e?.length || 0) +
        (rawState.me?.length || 0) + (rawState.nb?.length || 0) + (rawState.pk?.length || 0);

      const PhaseMap = ["WaitingForPlayers", "WaveActive", "ShopPhase"];
      const StateMap = ["Idle", "Moving", "Attacking", "Casting", "Dead"];

      // ==========================================================
      // >>> 1. FIRE AND FORGET: PROJECTILES <<<
      // ==========================================================
      if (rawState.db) {
        rawState.db.forEach((id: string) => {
          const sprite = this.projectileSprites.get(id);
          if (sprite) {
            // Store this projectile's hit sound so renderers can play it on HP drop
            const configId = sprite.getData('configId') as string | undefined;
            if (configId) {
              const projCfg = masterConfigs.projectiles?.[configId] ?? masterConfigs.Projectiles?.[configId];
              if (projCfg?.soundHit) AudioManager.getInstance().setLastProjectileHitSound(projCfg.soundHit);
            }
            sprite.destroy();
            this.projectileSprites.delete(id);
          }
        });
      }

      if (rawState.nb) {
        rawState.nb.forEach((b: any[]) => {
          const id = b[0], configId = b[1], x = b[2], y = b[3], vx = b[4], vy = b[5];
          const config = masterConfigs.projectiles ? (masterConfigs.projectiles[configId] || masterConfigs.Projectiles?.[configId]) : null;

          let sprite: any;
          if (config && (config.textureKey || config.TextureKey)) {
            const tex = config.textureKey || config.TextureKey;
            const frame = config.iconFrame ?? config.IconFrame ?? 0;
            sprite = this.add.sprite(x, y, tex, frame);
            sprite.setScale(config.scale || config.Scale || 1.0);
            sprite.setRotation(Math.atan2(vy, vx));

            const animKey = `${configId}_fly`;
            if (this.anims && this.anims.exists(animKey)) {
              sprite.play(animKey);
            }
          } else {
            sprite = this.add.rectangle(x, y, 10, 10, 0xffff00);
          }
          sprite.setDepth(10);

          sprite.setData('vx', vx);
          sprite.setData('vy', vy);
          sprite.setData('configId', configId);

          this.projectileSprites.set(id, sprite);
        });
      }

      // ==========================================================
      // >>> 2. DELTA COMPRESSION: ENEMIES & PICKUPS <<<
      // ==========================================================
      rawState.de?.forEach((id: string) => this.enemyCache.delete(id));
      rawState.dpk?.forEach((id: string) => {
        this.pickupCache.delete(id);
        // If the nearby loot was just destroyed/picked up, clear the tooltip immediately
        if (id === this.nearbyLootId) {
          this.nearbyLootId = null;
          this.groundTooltip.hide();
        }
      });

      rawState.e?.forEach((e: any[]) => {
        this.enemyCache.set(e[0], {
          id: e[0], configId: e[1], x: e[2], y: e[3], currentHp: e[4], maxHp: e[5],
          aimX: e[6], aimY: e[7],
          actionState: StateMap[e[8]], currentCastingSkillId: e[9], currentCastTimer: e[10],
          maxCastTimer: e[11], activeEffects: e[12] || [],
          weapons: e[13]?.map((w: any[]) => ({
            configId: w[0], slotIndex: w[1], level: w[2], rolledStats: w[3] || {}, totalBaseStats: w[4] || {}
          })) || [],
          firedWeapons: e[14] || []
        });
      });
      rawState.pk?.forEach((pk: any[]) => {
        this.pickupCache.set(pk[0], {
          id: pk[0], x: pk[1], y: pk[2], value: pk[3],
          type: pk[4] ?? 0,
          gearConfigId: pk[5] || '',
          level: pk[6] ?? 1,
          totalBaseStats: pk[7] || {},
          rolledStats: pk[8] || {},
          skills: pk[9] || []
        });
      });

      rawState.me?.forEach((m: any[]) => {
        const cached = this.enemyCache.get(m[0]);
        if (cached) {
          cached.x = m[1]; cached.y = m[2]; cached.currentHp = m[3];
          cached.aimX = m[4]; cached.aimY = m[5];
          cached.actionState = StateMap[m[6]];

          // >>> FIX: Update the cache with Casts and Effects! <<<
          cached.currentCastingSkillId = m[7];
          cached.currentCastTimer = m[8];
          cached.maxCastTimer = m[9];
          cached.activeEffects = m[10] || [];
          cached.firedWeapons = m[11] || [];
        }
      });

      // ==========================================================
      // >>> 3. BUILD FINAL STATE FOR RENDERERS <<<
      // ==========================================================
      const state: GameStatePayload = {
        phase: PhaseMap[rawState.ph] || "WaitingForPlayers",
        currentWave: rawState.w, timeRemaining: rawState.tr,
        players: rawState.p?.map((p: any[]) => ({
          connectionId: p[0], x: p[1], y: p[2], aimX: p[3], aimY: p[4],
          currentHp: p[5], maxHp: p[6], gold: p[7], actionState: StateMap[p[8]],
          currentCastingSkillId: p[9], currentCastTimer: p[10], maxCastTimer: p[11],
          // >>> THE FIX: Read the Level, RolledStats, and WeaponSkills from the network! <<<
          // >>> THE FIX: Parse the new TotalBaseStats from the server payload (w[5])! <<<
          weapons: p[12]?.map((w: any[]) => ({
            configId: w[0],
            slotIndex: w[1],
            level: w[2],
            rolledStats: w[3] || {},
            weaponSkills: w[4] || [],
            totalBaseStats: w[5] || {}
          })) || [],

          firedWeapons: p[13] || [],
          activeEffects: p[14] || [],
          currentShop: [],
          stats: {},
          ownedItems: {}
        })) || [],

        enemies: Array.from(this.enemyCache.values()),
        pickups: Array.from(this.pickupCache.values()),
        projectiles: [], // Kept empty because Fire-and-Forget physics controls them!
        damageEvents: rawState.dmg?.map((d: any[]) => ({ x: d[0], y: d[1], amount: d[2] })) || [],
        aoeEvents: rawState.aoe?.map((a: any[]) => ({ x: a[0], y: a[1], radius: a[2], isFriendly: a[3], configId: a[4] })) || []
      };

      this.currentPhase = state.phase;
      const myPlayer = state.players.find(p => p.connectionId === connection.connectionId);
      if (myPlayer) {
        this.goldUIText.setText(`💰 ${myPlayer.gold}`);
      }

      // Detect the nearest gear loot within pickup radius and manage the ground tooltip
      const PICKUP_RADIUS_SQ = 50 * 50;
      let newNearbyLootId: string | null = null;
      if (myPlayer) {
        const cacheEntries = Array.from(this.pickupCache.entries());
        const found = cacheEntries.find(([, pickup]) => {
          if (pickup.type === 0) return false; // skip gold – auto-collected
          const dx = pickup.x - myPlayer.x;
          const dy = pickup.y - myPlayer.y;
          return dx * dx + dy * dy <= PICKUP_RADIUS_SQ;
        });
        if (found) newNearbyLootId = found[0];
      }

      if (newNearbyLootId !== this.nearbyLootId) {
        this.nearbyLootId = newNearbyLootId;
        if (newNearbyLootId) {
          const pickup = this.pickupCache.get(newNearbyLootId)!;
          const pType = pickup.type;
          const gearConfig = pType === 1
            ? (masterConfigs.weapons?.[pickup.gearConfigId])
            : (masterConfigs.items?.[pickup.gearConfigId]);
          if (gearConfig) {
            const cam = this.cameras.main;
            const screenX = (pickup.x - cam.scrollX) * cam.zoom;
            const screenY = (pickup.y - cam.scrollY) * cam.zoom - 80;
            this.groundTooltip.show(gearConfig, screenX, screenY, gearConfig.tier ?? 1, masterConfigs, pickup.totalBaseStats, pickup.rolledStats, pickup.skills);
          }
        } else {
          this.groundTooltip.hide();
        }
      }

      if (this.currentPhase === "WaveActive") {
        this.waveUIText.setText(`Wave ${state.currentWave} - 0:${state.timeRemaining.toString().padStart(2, '0')}`).setColor('#ffffff');
        if (this.previousPhase !== "WaveActive") { this.shopUIModule.setVisible(false); this.manuallyClosedShop = true; }
      } else if (this.currentPhase === "ShopPhase") {
        this.waveUIText.setText(`SHOP PHASE - ${state.timeRemaining}s`).setColor('#00ff00');
        if (this.previousPhase !== "ShopPhase") { this.shopUIModule.setVisible(true); this.manuallyClosedShop = false; }
      }
      this.previousPhase = this.currentPhase;

      state.projectiles = [];

      const activePlayers = PlayerRenderer.render(this, state, this.playerSprites, masterConfigs, this.targetPositions);
      const activeEnemies = EnemyRenderer.render(this, state, this.enemySprites, masterConfigs, this.targetPositions);

      // Pass a dummy map to WorldRenderer so it ignores our local bullets
      const dummyMap = new Map();
      const { activePickups } = WorldRenderer.render(this, state, dummyMap, this.pickupSprites, masterConfigs, this.targetPositions) as any;
      const mySprite = this.playerSprites.get(connection.connectionId || "");
      if (mySprite && !(this.cameras.main as any)._isFollowing) {
        this.cameras.main.startFollow(mySprite, true, 0.1, 0.1);
        (this.cameras.main as any)._isFollowing = true;
      }

      this.cleanupSprites(this.playerSprites, activePlayers);
      this.cleanupSprites(this.enemySprites, activeEnemies);
      this.cleanupSprites(this.pickupSprites, activePickups);
    });

    // Clean up external event listeners when the scene shuts down to prevent memory leaks
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.pingIntervalId !== null) {
        clearInterval(this.pingIntervalId);
        this.pingIntervalId = null;
      }
      connection.off('UpdatePlayerUI');
      connection.off('UpdateStateCompressed');
      this.game.events.off(Phaser.Core.Events.PRE_RENDER);
      this.game.events.off(Phaser.Core.Events.POST_RENDER);
    });
  }

  update(time: number, delta: number) {
    this.handleInput(time);
    this.smoothInterpolateSprites(this.playerSprites, 0.2);
    this.smoothInterpolateSprites(this.enemySprites, 0.2);

    // Keep ground tooltip positioned above the nearby loot pickup as the camera moves
    if (this.nearbyLootId && this.groundTooltip?.visible) {
      const pickup = this.pickupCache.get(this.nearbyLootId);
      if (pickup) {
        const cam = this.cameras.main;
        const screenX = (pickup.x - cam.scrollX) * cam.zoom;
        const screenY = (pickup.y - cam.scrollY) * cam.zoom - 80;
        this.groundTooltip.updatePosition(screenX, screenY);
      }
    }

    // Spacebar: manually pick up the nearest gear loot within range
    if (this.spaceKey && Phaser.Input.Keyboard.JustDown(this.spaceKey) && this.nearbyLootId) {
      connection.invoke("TryPickupLoot", this.nearbyLootId).catch((err: any) => console.error(err));
    }

    if (masterConfigs.enemies && !this.hasScannedSprites) {
      precalculateSpriteTops(this, masterConfigs);
      this.hasScannedSprites = true;
      console.log("Sprites scanned successfully!");
    }

    const dtSeconds = delta / 1000;
    this.projectileSprites.forEach((sprite) => {
      const vx = sprite.getData('vx');
      const vy = sprite.getData('vy');
      sprite.x += vx * dtSeconds;
      sprite.y += vy * dtSeconds;
    });

    if (this.isDebugMode) {
      if (time - this.lastBandwidthTime > 1000) {
        // Calculate both metrics!
        this.currentCompressedKbps = ((this.compressedBytesReceived * 8) / 1000).toFixed(2);
        this.currentUncompressedKbps = ((this.uncompressedBytesReceived * 8) / 1000).toFixed(2);

        this.compressedBytesReceived = 0;
        this.uncompressedBytesReceived = 0;
        this.lastBandwidthTime = time;
      }

      const fps = Math.round(this.game.loop.actualFps);
      const frameTime = this.game.loop.delta.toFixed(1);
      const renderedSprites = this.cameras.main.renderList.length;

      this.perfText.setText(
        `FPS     : ${fps}\n` +
        `Ping    : ${this.pingMs} ms\n` +
        `Logic   : ${frameTime} ms\n` +
        `Sprites : ${renderedSprites} (GPU Visuals)\n` +
        `Entities: ${this.lastNetworkEntitiesCount} (C# Network)\n` +
        `Draws   : ${this.currentDrawCalls} (Peak: ${this.maxDrawCalls})\n` +
        // >>> THE NEW DUAL TRACKER! <<<
        `Network : ${this.currentCompressedKbps} kbps (Raw: ${this.currentUncompressedKbps} kbps)`
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

  private handleInput(time: number) {
    if (!this.cursors || !this.wasd || connection.state !== HubConnectionState.Connected) return;

    let dirX = 0, dirY = 0;
    if (this.cursors.left.isDown || this.wasd.A.isDown) dirX = -1;
    if (this.cursors.right.isDown || this.wasd.D.isDown) dirX = 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) dirY = -1;
    if (this.cursors.down.isDown || this.wasd.S.isDown) dirY = 1;

    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

    const inputData = {
      DirX: dirX,
      DirY: dirY,
      AimX: Math.round(worldPoint.x),
      AimY: Math.round(worldPoint.y)
    };

    const inputString = JSON.stringify(inputData);
    if (inputString !== this.lastSentInput || time - this.lastInputSendTime > 100) {
      connection.invoke("SendInput", inputData).catch((err: any) => console.error(err));
      this.lastSentInput = inputString;
      this.lastInputSendTime = time;
    }
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
        if (typeof sprite.removeAll === 'function') sprite.removeAll(true);
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
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1920,
    height: 1080
  },
  scene: GameScene,
  parent: 'app',
  pixelArt: true,
  backgroundColor: '#2d2d2d'
};
new Phaser.Game(config);