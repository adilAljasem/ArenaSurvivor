import * as Phaser from 'phaser';
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { ShopUI, SkillActionBar, Tooltip } from './ui/UI';
import { EscMenu } from './ui/EscMenu';
import { ActorRenderer, VfxRenderer, WorldRenderer, precalculateSpriteTops } from './RenderSystems';
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
  synergizedSkills: { configId: string, currentCooldown: number }[];
}
interface ServerEnemy {
  id: string; configId: string; x: number; y: number; velX?: number;
  currentHp: number; maxHp: number; actionState: string; activeEffects: string[];
  currentCastingSkillId: string; currentCastTimer: number; maxCastTimer: number;
  aimX?: number; aimY?: number; firedWeapons: number[];
  weapons: { configId: string; slotIndex: number; level: number; rolledStats: Record<string, number>; totalBaseStats: Record<string, number>; }[];
  team: string;
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
interface DamageEvent { x: number; y: number; amount: number; isCritical: boolean; isDodge: boolean; isBlock: boolean; }
interface BeamEvent { startX: number; startY: number; targetX: number; targetY: number; width: number; colorTint: string; }

export interface GameStatePayload {
  players: ServerPlayer[]; enemies: ServerEnemy[]; projectiles: ServerProjectile[];
  pickups: ServerPickup[]; damageEvents: DamageEvent[]; aoeEvents: AoeEvent[];
  phase: string; currentWave: number; timeRemaining: number;
  beamEvents: BeamEvent[];
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
  private skillActionBar!: SkillActionBar;
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
  private lastBandwidthTime: number = 0;
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
    this.load.spritesheet('characters_sheet1', 'assets/Characters/char1.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('ammo_sheet2', '/assets/Weapons/ammo2.png', { frameWidth: 240, frameHeight: 218 });
    this.load.spritesheet('goblinCavebat_sheet', '/assets/Enemies/goblin-cavbat.png', { frameWidth: 400, frameHeight: 268 });

    this.load.spritesheet('skill_icons', '/assets/Skills/skillsicon.png', { frameWidth: 312, frameHeight: 307 });
    this.load.spritesheet('Enemies1_sheet', '/assets/Enemies/mosquito-fly devil - fly fortest.png', { frameWidth: 64, frameHeight: 64 });




    this.load.audio('sfx_shoot', 'assets/Audio/weapon-fire-1.wav');
    this.load.audio('ball-shoot', 'assets/Audio/ball-tap.wav');
    this.load.audio('sword-shoot', 'assets/Audio/sword-strikes.wav');



  }

  create() {
    this.cameras.main.setBackgroundColor('#2d2d2d');
    this.groundTooltip = new Tooltip(this);
    this.skillActionBar = new SkillActionBar(this);
    this.skillActionBar.updateLayout(this.scale.width, this.scale.height);

    // Initialise the global AudioManager with this scene's sound system
    AudioManager.getInstance().init(this);

    // >>> FIX: Map Initialization moved strictly to Handshake Event! <<<
    // >>> BULLETPROOF HANDSHAKE WRAPPER <<<
    const initConfigs = () => {
      // Prevent running twice if hot reloaded
      if (this.isMapInitialized) return;
      if (!masterConfigs || Object.keys(masterConfigs).length === 0) return;

      if (this.anims) this.createAnimations(masterConfigs);

      const mapIdToUse = masterConfigs.currentMapId || masterConfigs.CurrentMapId ||
        (masterConfigs.maps ? Object.keys(masterConfigs.maps)[0] : null) ||
        (masterConfigs.Maps ? Object.keys(masterConfigs.Maps)[0] : null);

      if (mapIdToUse) {
        const currentMap = (masterConfigs.maps && masterConfigs.maps[mapIdToUse]) || (masterConfigs.Maps && masterConfigs.Maps[mapIdToUse]);

        if (currentMap) {
          this.isMapInitialized = true;
          this.mapWidth = currentMap.width || currentMap.Width;
          this.mapHeight = currentMap.height || currentMap.Height;

          this.add.grid(this.mapWidth / 2, this.mapHeight / 2, this.mapWidth, this.mapHeight, 64, 64, 0x1a1a1a, 1, 0x333333, 1).setDepth(-2);
          const border = this.add.graphics();
          border.lineStyle(16, 0xff0000, 1);
          border.strokeRect(10, 10, this.mapWidth - 20, this.mapHeight - 20);
          border.setDepth(-1);
          border.postFX.addGlow(0xff0000, 6, 0, false, 0.1, 15);
          this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);
        }
      }
    };

    // 1. Try to run it immediately (if SignalR was super fast)
    initConfigs();

    // 2. Also listen for the event (if Phaser loaded before SignalR finished)
    window.addEventListener('configsReady', initConfigs);


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

      // >>> Call the resizer on window change <<<
      this.skillActionBar.updateLayout(gameSize.width, gameSize.height);
    });

    this.skillActionBar.setPosition(this.scale.width / 2, this.scale.height - 40);

    this.input.keyboard?.on('keydown-B', () => {
      // 1. Toggle the visibility state
      const isNowVisible = !this.shopUIModule.visible;
      this.shopUIModule.setVisible(isNowVisible);
      this.manuallyClosedShop = !isNowVisible;

      // 2. If the menu was just OPENED, ask the server for fresh data!
      if (isNowVisible) {
        // Note: Ensure your SignalR connection object is correctly referenced here 
        // (it might be 'this.connection' or just 'connection' depending on your scope)
        connection.invoke("RequestUIUpdate").catch((err: any) => {
          console.error("Failed to request UI update:", err);
        });
      }
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

    // >>> NEW: U Key to Toggle Health Numbers <<<
    this.data.set('showHealthNumbers', false); // Default to hidden
    this.input.keyboard?.on('keydown-U', () => {
      const currentState = this.data.get('showHealthNumbers');
      this.data.set('showHealthNumbers', !currentState);
    });
    connection.on("UpdatePlayerUI", (uiData: any) => {
      this.data.set('latestPlayerStats', uiData.stats); // <<< SAVE STATS HERE
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

          if (b[6] === 1) {
            sprite.setData('isOrbital', true);
            sprite.setData('ownerId', b[7]);
            sprite.setData('orbitRadius', b[8]);
            sprite.setData('orbitAngleOffset', b[9]);
          }

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
          firedWeapons: e[14] || [],
          team: e[15]
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
          synergizedSkills: p[15]?.map((s: any[]) => ({
            configId: s[0],
            currentCooldown: s[1]
          })) || [],
          currentShop: [],
          stats: {},
          ownedItems: {}
        })) || [],

        enemies: Array.from(this.enemyCache.values()),
        pickups: Array.from(this.pickupCache.values()),
        projectiles: [], // Kept empty because Fire-and-Forget physics controls them!
        damageEvents: rawState.dmg?.map((d: any[]) => ({
          x: d[0],
          y: d[1],
          amount: d[2],
          isCritical: d[3] === 1,
          isDodge: d[4] === 1, // Read Dodge
          isBlock: d[5] === 1  // Read Block
        })) || [],
        aoeEvents: rawState.aoe?.map((a: any[]) => ({ x: a[0], y: a[1], radius: a[2], isFriendly: a[3], configId: a[4] })) || [],
        beamEvents: rawState.bm?.map((b: any[]) => ({ startX: b[0], startY: b[1], targetX: b[2], targetY: b[3], width: b[4], colorTint: b[5] })) || [] // <<< NEW
      };

      // 1. Parse the events from the payload (Assuming they are p[10] or whatever index you assigned)
      const aoeEvents = state.aoeEvents || [];

      // 2. Pass them to the renderer instantly
      VfxRenderer.renderAoeEvents(this, aoeEvents, masterConfigs);

      this.currentPhase = state.phase;
      const myPlayer = state.players.find(p => p.connectionId === connection.connectionId);
      if (myPlayer) {
        this.goldUIText.setText(`💰 ${myPlayer.gold}`);
        const pStats = this.data.get('latestPlayerStats') || {}; // <<< GET STATS
        this.skillActionBar.updateSkills(myPlayer.synergizedSkills, masterConfigs, pStats); // <<< PASS STATS
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
            this.groundTooltip.show(gearConfig, screenX, screenY, 1, masterConfigs, pickup.totalBaseStats, pickup.rolledStats, pickup.skills);
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

      const activePlayers = ActorRenderer.render(this, state.players, this.playerSprites, masterConfigs, this.targetPositions, true);

      // The 'false' flag at the end identifies them as Enemies
      const activeEnemies = ActorRenderer.render(this, state.enemies, this.enemySprites, masterConfigs, this.targetPositions, false);

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
    const dtSeconds = delta / 1000;


    if (this.skillActionBar) {
      this.skillActionBar.smoothTickCooldowns(dtSeconds);
    }

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

    // >>> FIX: Hybrid Physics (Linear vs Orbital) <<<
    this.projectileSprites.forEach((sprite) => {
      if (sprite.getData('isOrbital')) {
        const ownerId = sprite.getData('ownerId');
        const ownerSprite = this.playerSprites.get(ownerId) || this.enemySprites.get(ownerId);

        if (ownerSprite) {
          let angle = sprite.getData('orbitAngleOffset');
          const radius = sprite.getData('orbitRadius');

          // >>> FIX: vx holds OrbitSpeed in Degrees. Convert to Radians! <<<
          const degreesPerSec = sprite.getData('vx');
          const radiansPerSec = degreesPerSec * (Math.PI / 180);

          angle += radiansPerSec * dtSeconds;
          sprite.setData('orbitAngleOffset', angle);

          // Lock tightly to the smoothly interpolated visual position
          sprite.x = ownerSprite.x + Math.cos(angle) * radius;
          sprite.y = ownerSprite.y + Math.sin(angle) * radius;
        }
      } else {
        // Standard Fire-and-Forget Linear Physics
        const vx = sprite.getData('vx');
        const vy = sprite.getData('vy');
        sprite.x += vx * dtSeconds;
        sprite.y += vy * dtSeconds;
      }
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

        // --- 1. NEW: Handle VFX Animations for Skills ---
        if (key === 'vfxAnimFrames' || key === 'VfxAnimFrames') {
          const id = entity.id || entity.Id;
          const animKey = `${id}_vfx`;

          if (!this.anims.exists(animKey)) {
            const textureKey = entity.vfxTextureKey || entity.VfxTextureKey;
            const frameRate = entity.vfxFrameRate || entity.VfxFrameRate || 15;

            // Only create if a vfxTextureKey was actually provided in the JSON
            if (textureKey) {
              this.anims.create({
                key: animKey,
                frames: this.anims.generateFrameNumbers(textureKey, {
                  start: entity[key][0],
                  end: entity[key][1]
                }),
                frameRate: frameRate,
                repeat: 0 // VFX always plays exactly once and stops
              });
            }
          }
        }

        // --- 2. EXISTING: Handle standard Entity Animations (walk, attack, hit, death) ---
        else if (key.toLowerCase().startsWith('anim') && Array.isArray(entity[key]) && entity[key].length === 2) {
          const actionName = key.toLowerCase().replace('anim', '');
          const id = entity.id || entity.Id;
          const animKey = `${id}_${actionName}`;

          if (!this.anims.exists(animKey)) {
            const textureKey = entity.textureKey || entity.TextureKey;
            let customFrameRate = entity[`${key}FrameRate`] || 15;

            // >>> NEW: AUTO-CALCULATE ATTACK ANIMATION FPS <<<
            if (actionName === 'attack' && (entity.attackDuration || entity.AttackDuration)) {
              const duration = entity.attackDuration || entity.AttackDuration;
              const totalFrames = (entity[key][1] - entity[key][0]) + 1;
              customFrameRate = totalFrames / duration; // e.g., 9 frames / 0.4s = 22.5 FPS!
            }

            const shouldLoop = (actionName === 'attack' || actionName === 'hit' || actionName === 'death' || actionName === 'skill') ? 0 : -1;
            if (textureKey) {
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