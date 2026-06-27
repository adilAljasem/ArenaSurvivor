import * as Phaser from 'phaser';
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { ShopUI, SkillActionBar, Tooltip } from './ui/UI';
import { EscMenu } from './ui/EscMenu';
import { ActorRenderer, VfxRenderer, WorldRenderer } from './RenderSystems';
import { AudioManager } from './AudioManager';
import pako from 'pako';
import { LobbyUI, AuthUI } from './LobbyUI';


// --- SIGNALR CONNECTIONS ---
// 1. Master Node
export const isDev = import.meta.env.DEV;
export const envName = isDev ? "Development (Vite)" : "Production (Traefik)";
export const masterUrl = isDev ? "http://localhost:5000/lobbyHub" : "/lobbyHub";
export let activeWorkerUrl = "Waiting for match...";

const SKIP_LOBBY_IN_DEV = isDev && false;

// Mobile detection: touch device without a fine (mouse) pointer.
// This correctly distinguishes phones/tablets from touch-screen laptops (Surface, etc.).
export const isMobile = (() => {
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const hasFinePointer = window.matchMedia('(pointer:fine)').matches;
  return hasTouch && !hasFinePointer;
})();

// Written by setupMobileUI() joystick, read by handleInput().
export const mobileDir = { x: 0, y: 0 };


export const playerId = (() => {
  let id = localStorage.getItem('arena_playerId');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : 'p_' + Date.now();
    localStorage.setItem('arena_playerId', id);
  }
  return id;
})();


// 1. Master Node
export const lobbyConnection = new HubConnectionBuilder()
  .withUrl(masterUrl, {
    // JWT is read lazily from localStorage each time a connection is made
    accessTokenFactory: () => localStorage.getItem('arena_jwt') ?? ''
  })
  .withAutomaticReconnect()
  .build();
// 2. Worker Node (Starts with fallback, overwritten dynamically during Handoff!)
export let matchConnection: any = new HubConnectionBuilder()
  .withUrl("http://localhost:5000/matchHub")
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
  statDiff?: Record<string, number>;
  currentShield: number;
}
interface ServerEnemy {
  id: string; configId: string; x: number; y: number; velX?: number;
  currentHp: number; maxHp: number; actionState: string; activeEffects: string[];
  currentCastingSkillId: string; currentCastTimer: number; maxCastTimer: number;
  aimX?: number; aimY?: number; firedWeapons: number[];
  weapons: { configId: string; slotIndex: number; level: number; rolledStats: Record<string, number>; totalBaseStats: Record<string, number>; }[];
  team: string;
  currentShield: number;
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
interface BeamEvent { startX: number; startY: number; targetX: number; targetY: number; width: number; colorTint: string; casterId: string; skillId: string; }
interface BeamEndedEvent { casterId: string; skillId: string; }

export interface GameStatePayload {
  players: ServerPlayer[]; enemies: ServerEnemy[]; projectiles: ServerProjectile[];
  pickups: ServerPickup[]; damageEvents: DamageEvent[]; aoeEvents: AoeEvent[];
  phase: string; currentWave: number; timeRemaining: number;
  beamEvents: BeamEvent[];
  beamEndedEvents: BeamEndedEvent[];
}

let masterConfigs: any = {};

// We export this globally so any HTML UI component can read the latest stats
(window as any).playerCachedStats = {};

// --- PHASER SCENE ---
class GameScene extends Phaser.Scene {
  private playerSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private enemySprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private projectileSprites: Map<string, Phaser.GameObjects.Rectangle | Phaser.GameObjects.Sprite> = new Map();
  private pickupSprites: Map<string, Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle> = new Map();
  private activeBeams: Map<string, any> = new Map();
  private targetPositions: Map<string, { x: number, y: number }> = new Map();
  private skillActionBar!: SkillActionBar;
  private enemyCache: Map<string, ServerEnemy> = new Map();
  private pickupCache: Map<string, ServerPickup> = new Map();

  private goldUIText!: Phaser.GameObjects.Text;
  private waveUIText!: Phaser.GameObjects.Text;
  private shopUIModule!: ShopUI;
  private escMenu!: EscMenu;
  private perfText!: Phaser.GameObjects.Text;
  private versionText!: Phaser.GameObjects.Text;

  private activeEnemiesArray: ServerEnemy[] = [];
  private enemiesDirty: boolean = true;
  private hpGraphics!: Phaser.GameObjects.Graphics;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: any;
  private currentPhase: string = "WaitingForPlayers";
  private previousPhase: string = "WaitingForPlayers";
  private manuallyClosedShop: boolean = false;

  private spaceKey!: Phaser.Input.Keyboard.Key;
  private nearbyLootId: string | null = null;
  private groundTooltip!: Tooltip;

  private isMapInitialized: boolean = false;
  private mapWidth: number = 4000;
  private mapHeight: number = 4000;

  private lastInputSendTime: number = 0;
  private lastSentInput: string = "";

  private isDebugMode: boolean = false;
  private mobileUIInitialized: boolean = false;
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

  private handoffTimeout: ReturnType<typeof setTimeout> | null = null;
  private syncOverlay: HTMLElement | null = null;


  private pingIntervalId: ReturnType<typeof setInterval> | null = null;



  constructor() { super('GameScene'); }

  preload() {
    this.load.spritesheet('mushroomEnemy', '/assets/Enemies/mushroom.png', { frameWidth: 80, frameHeight: 64 });
    this.load.spritesheet('weapons_sheet', '/assets/Weapons/weapons.png', { frameWidth: 176, frameHeight: 96 });
    this.load.spritesheet('tree', 'assets/obstacles/Tree Lights 02-Sheet.png', { frameWidth: 32, frameHeight: 64 });
    this.load.spritesheet('effects1', 'assets/Effects/effects1.png', { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('characters_sheet1', 'assets/Characters/char1.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('ammo_sheet2', '/assets/Weapons/ammo2.png', { frameWidth: 60, frameHeight: 54 });
    this.load.spritesheet('goblinCavebat_sheet', '/assets/Enemies/goblin-cavbat.png', { frameWidth: 83, frameHeight: 55.8 });
    this.load.spritesheet('spike_enemy', '/assets/Enemies/spike enemy.png', { frameWidth: 47, frameHeight: 38 });
    this.load.spritesheet('spring_enemy', '/assets/Enemies/spring enemy.png', { frameWidth: 48, frameHeight: 48 });
    this.load.spritesheet('effects2', '/assets/Effects/effect2.png', { frameWidth: 64, frameHeight: 96 });
    this.load.spritesheet('icons1', '/assets/Effects/icons1.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('explosion1', '/assets/Effects/explosion1.png', { frameWidth: 96, frameHeight: 96 });
    this.load.spritesheet('explosion2', '/assets/Effects/explosion2.png', { frameWidth: 128, frameHeight: 96 });
    this.load.spritesheet('skill_icons', '/assets/Skills/skillsicon.png', { frameWidth: 78, frameHeight: 76 });
    this.load.spritesheet('Enemies1_sheet', '/assets/Enemies/mosquito-fly devil - fly fortest.png', { frameWidth: 64, frameHeight: 64 });

    this.load.image('tex_grass', '/assets/obstacles/grass map.jpg');
    this.load.image('tex_sand', '/assets/obstacles/map1.jpg');

    this.load.audio('sfx_shoot', 'assets/Audio/weapon-fire-1.wav');
    this.load.audio('ball-shoot', 'assets/Audio/ball-tap.wav');
    this.load.audio('sword-shoot', 'assets/Audio/sword-strikes.wav');

    this.load.audio('ui_hover', '/assets/Audio/ui_hover.mp3');
    this.load.audio('ui_buy', '/assets/Audio/ui_buy.mp3');
    this.load.audio('ui_recycle', '/assets/Audio/ui_recycle.wav');
    this.load.audio('ui_levelup', '/assets/audio/ui_levelup.wav');
    this.load.audio('ui_click', '/assets/Audio/UI/btnclick.mp3');

    this.load.bitmapFont('damageFont', 'assets/fonts/fon.png', 'assets/fonts/fon.xml');
  }

  create() {
    const jwt = localStorage.getItem('arena_jwt');
    if (!jwt) {
      new AuthUI(() => window.location.reload());
      return; // Nothing else runs until the player logs in
    }

    this.cameras.main.setBackgroundColor('#2d2d2d');
    this.groundTooltip = new Tooltip(this);
    this.skillActionBar = new SkillActionBar(this);
    this.skillActionBar.updateLayout(this.scale.width, this.scale.height);
    this.hpGraphics = this.add.graphics().setDepth(50);

    AudioManager.getInstance().init(this);



    // ==========================================
    // 1. MASTER NODE (LOBBY) LISTENERS
    // ==========================================
    lobbyConnection.on("ReceiveHandshake", (payload: any) => {
      console.log("Handshake received from Lobby. Configs loaded.");
      this.applyHandshakePayload(payload);
    });



    lobbyConnection.on("MatchStarted", (roomId: string, matchToken: string, workerUrl: string) => {
      activeWorkerUrl = isDev ? "http://localhost:5000/matchHub" : workerUrl;

      const urlParams = new URLSearchParams(window.location.search);
      const isSpectator = urlParams.get('spectate') === 'true';

      // FIX: Use localStorage so reconnect works even after closing the tab.
      // sessionStorage survives F5 but not a full tab close.
      if (!isSpectator) {
        localStorage.setItem('currentRoomId', roomId);
      }

      // Show the sync/loading overlay.
      this.syncOverlay = document.getElementById('sync-overlay');
      if (!this.syncOverlay) {
        this.syncOverlay = document.createElement('div');
        this.syncOverlay.id = 'sync-overlay';
        this.syncOverlay.innerHTML = `
          <style>
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            .spinner { width: 50px; height: 50px; border: 5px solid rgba(191, 85, 236, 0.3); border-top-color: #bf55ec; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px; }
          </style>
          <div class="spinner"></div>
          <h2 style="color: white; font-family: 'Segoe UI', sans-serif;">Waiting for other players to join...</h2>
        `;
        this.syncOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(20,25,35,0.95);z-index:9999999;display:flex;flex-direction:column;justify-content:center;align-items:center;';
        document.body.appendChild(this.syncOverlay);
      }
      this.syncOverlay.style.display = 'flex';

      // FIX: Stop any existing worker connection before creating a new one.
      // Without this, the old connection is orphaned and leaks.
      if (matchConnection && matchConnection.state !== 'Disconnected') {
        matchConnection.stop().catch(() => { });
      }

      matchConnection = new HubConnectionBuilder()
        .withUrl(activeWorkerUrl, {
          accessTokenFactory: () => localStorage.getItem('arena_jwt') ?? ''
        })
        .withAutomaticReconnect()
        .build();


      // FIX: Register ALL worker listeners here (including MatchError and
      // AllPlayersSynced). Previously those two were inline below, which meant:
      //  (a) they were outside bindWorkerListeners, so they wouldn't be re-added
      //      after a withAutomaticReconnect() reconnection.
      //  (b) closures captured local variables that aren't accessible in
      //      bindWorkerListeners — solved by promoting them to class properties.
      this.bindWorkerListeners();

      // 15-second fault-tolerance timeout stored as a class property so
      // AllPlayersSynced (now in bindWorkerListeners) can clear it.
      if (this.handoffTimeout !== null) clearTimeout(this.handoffTimeout);
      this.handoffTimeout = setTimeout(() => {
        this.handoffTimeout = null;
        if (matchConnection.state === HubConnectionState.Connected) matchConnection.stop();
        if (this.syncOverlay) this.syncOverlay.style.display = 'none';

        const toastContainer = document.getElementById('toast-container');
        if (toastContainer) {
          const toast = document.createElement('div');
          toast.className = 'toast error';
          toast.innerHTML = `<div style="font-size: 12px; color: #aaa; text-transform: uppercase;">Connection Failed</div><div>Worker node failed to synchronize. Match aborted.</div>`;
          toastContainer.appendChild(toast);
          setTimeout(() => { toast.style.animation = 'fadeOut 0.3s ease-out forwards'; setTimeout(() => toast.remove(), 300); }, 4000);
        }
      }, 15000);

      matchConnection.start().then(() => {
        console.log("Connected to Worker! Waiting for sync...");
        const isSpec = new URLSearchParams(window.location.search).get('spectate') === 'true';
        matchConnection.invoke("JoinLiveMatch", roomId, matchToken, isSpec)
          .catch((err: any) => console.error(err));
      }).catch((err: any) => {
        if (this.handoffTimeout !== null) { clearTimeout(this.handoffTimeout); this.handoffTimeout = null; }
        if (this.syncOverlay) this.syncOverlay.style.display = 'none';
        console.error("Failed to connect to worker:", err);
      });
    });



    // ==========================================
    // UI & INPUT SETUP
    // ==========================================
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
      if (matchConnection && matchConnection.state === HubConnectionState.Connected) {
        const startTime = Date.now();
        matchConnection.invoke("Ping").then(() => { this.pingMs = Date.now() - startTime; }).catch(() => { });
      }
    }, 1000);

    this.waveUIText = this.add.text(this.scale.width / 2, 20, 'Connecting...', {
      fontSize: '32px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5).setDepth(3000).setScrollFactor(0);

    this.goldUIText = this.add.text(20, 20, '💰 0', {
      fontSize: '28px', color: '#ffd700', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4
    }).setDepth(3000).setScrollFactor(0);

    this.versionText = this.add.text(10, this.scale.height - 10, 'v1.0.0', {
      fontFamily: "'Segoe UI', Consolas, monospace", fontSize: '14px', color: '#aaaaaa'
    }).setOrigin(0, 1).setDepth(9999).setScrollFactor(0);

    this.perfText = this.add.text(10, this.scale.height - 35, '', {
      fontFamily: "'Segoe UI', Consolas, monospace", fontSize: '14px', color: '#00ff00',
      backgroundColor: '#000000aa', padding: { x: 8, y: 8 }
    }).setOrigin(0, 1).setDepth(9999).setVisible(false).setScrollFactor(0);

    this.shopUIModule = new ShopUI(this, matchConnection);
    this.shopUIModule.setDepth(1000);
    this.shopUIModule.setVisible(false);

    this.escMenu = new EscMenu(this);
    this.escMenu.setVisible(false);

    // >>> NEW: Listen for the explicit quit event to tell the server to delete the room
    this.events.on('quit_to_main_menu', () => {
      if (matchConnection && matchConnection.state === 'Connected') {
        // Tell the server we are quitting intentionally, then reload the page
        matchConnection.invoke("LeaveRoom").catch(() => { }).finally(() => {
          localStorage.removeItem('currentRoomId');
          const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
          window.location.href = cleanUrl;
        });
      } else {
        // Fallback if already disconnected
        localStorage.removeItem('currentRoomId');
        const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.location.href = cleanUrl;
      }
    });

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.versionText.setPosition(10, gameSize.height - 10);
      this.perfText.setPosition(10, gameSize.height - 35);
      this.waveUIText.setPosition(gameSize.width / 2, 20);
      this.escMenu.reposition(gameSize.width, gameSize.height);
      this.skillActionBar.updateLayout(gameSize.width, gameSize.height);
    });

    this.skillActionBar.setPosition(this.scale.width / 2, this.scale.height - 40);

    this.input.keyboard?.on('keydown-B', () => {
      const isNowVisible = !this.shopUIModule.visible;
      this.shopUIModule.setVisible(isNowVisible);
      this.manuallyClosedShop = !isNowVisible;

      if (isNowVisible && matchConnection && matchConnection.state === HubConnectionState.Connected) {
        matchConnection.invoke("RequestUIUpdate").catch((err: any) => {
          console.error("Failed to request UI update:", err);
        });
      }
    });

    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.shopUIModule.visible) {
        this.shopUIModule.setVisible(false);
        this.manuallyClosedShop = true;
      } else if (this.escMenu.visible) {
        this.escMenu.setVisible(false);
      } else {
        this.escMenu.setVisible(true);
      }
    });

    // >>> NEW: The Browser Safety Fallback
    // If the browser forces an exit from fullscreen, ensure the menu pops up automatically
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) {
        // We just dropped out of fullscreen.
        // If the shop isn't open, forcefully open the pause menu.
        if (!this.shopUIModule.visible && !this.escMenu.visible) {
          this.escMenu.setVisible(true);
        }
      }
    });

    this.input.keyboard?.on('keydown-H', () => {
      this.isDebugMode = !this.isDebugMode;
      this.perfText.setVisible(this.isDebugMode);
    });

    this.debugGraphics = this.add.graphics().setDepth(9998);

    this.data.set('showHealthNumbers', false);
    this.input.keyboard?.on('keydown-U', () => {
      const currentState = this.data.get('showHealthNumbers');
      this.data.set('showHealthNumbers', !currentState);
    });

    // >>> NEW: Catch silent reconnect errors so we don't get soft-locked! <<<
    lobbyConnection.on("LobbyError", (msg: string) => {
      console.warn("Lobby Error Intercepted:", msg);

      // >>> NEW: Wipe credentials if hijacked
      if (msg.includes("location")) {
        localStorage.removeItem('arena_jwt');
        localStorage.removeItem('arena_username');
        localStorage.removeItem('arena_playerId');
      }

      if (msg.includes("expired") || msg.includes("not exist") || msg.includes("location")) {
        localStorage.removeItem('currentRoomId');
        const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.location.href = cleanUrl;
      }
    });

    // Initial Boot Sequence (Start the Master Node!)
    if (lobbyConnection.state === HubConnectionState.Disconnected) {
      lobbyConnection.start()
        .then(() => {
          console.log("SignalR Master Connected!");

          const urlParams = new URLSearchParams(window.location.search);
          const urlRoomId = urlParams.get('roomId');
          const isSpectate = urlParams.get('spectate') === 'true';
          const reconnectRoom = localStorage.getItem('currentRoomId');

          if (urlRoomId && isSpectate) {
            console.log("Joining as spectator...");
            lobbyConnection.invoke("RequestReconnect", urlRoomId);
          }
          else if (reconnectRoom) {
            console.log("Attempting to reconnect to match worker...");
            lobbyConnection.invoke("RequestReconnect", reconnectRoom);
          }
          else if (SKIP_LOBBY_IN_DEV) {
            console.log("[DEV QUICKSTART] Bypassing Lobby UI...");

            // 1. Instantly create a room
            lobbyConnection.invoke("CreateRoom", "DevPlayer", "Dev Auto Room", "", "easy");
            // 2. Automate the character selection and readying up
            let hasSelectedChar = false;

            // We hook into the roster updates just like the UI would
            lobbyConnection.on("UpdateLobbyRoster", (data: any) => {
              const me = data.players.find((p: any) => p.id === lobbyConnection.connectionId);
              if (!me) return;

              if (!hasSelectedChar && masterConfigs?.characters) {
                hasSelectedChar = true;

                // Grab the very first available character ID from your configs
                const firstCharId = Object.keys(masterConfigs.characters)[0];

                lobbyConnection.invoke("SelectCharacter", firstCharId).then(() => {
                  lobbyConnection.invoke("ToggleReady"); // Ready up automatically
                });
              }
              // 3. Once everyone (just us) is ready, launch the game
              else if (me.isReady && data.hostId === me.id) {
                const allReady = data.players.every((p: any) => p.isReady);
                if (allReady) {
                  lobbyConnection.invoke("StartMatch");
                }
              }
            });

          } else {
            // ---------------------------------------------------
            // Normal Production Flow (Loads the Lobby UI)
            // ---------------------------------------------------
            console.log("Launching Lobby UI...");
            const getIconBase64 = (textureKey: string, frame: number) => {
              if (this.textures.exists(textureKey)) return this.textures.getBase64(textureKey, frame);
              return null;
            };

            // 1. Build the UI
            new LobbyUI(lobbyConnection, getIconBase64, () => {
              console.log("Match joined. Entering Game mode!");
            }, playerId);

            // 2. >>> NEW: If a roomId is in the URL, instantly auto-join it! <<<
            if (urlRoomId) {
              console.log("Auto-joining lobby room from URL...");
              // It will bypass the login screen and jump straight into the room
              lobbyConnection.invoke("JoinRoom", "Traveler", urlRoomId, "");
            }

          }
        })
        .catch((err: any) => console.error("SignalR Master Connection Error:", err));
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.pingIntervalId !== null) {
        clearInterval(this.pingIntervalId);
        this.pingIntervalId = null;
      }
      if (matchConnection) {
        matchConnection.off('UpdatePlayerUI');
        matchConnection.off('UpdateStateCompressed');
      }
      lobbyConnection.off('ReceiveHandshake');
      lobbyConnection.off('MatchStarted');
      this.game.events.off(Phaser.Core.Events.PRE_RENDER);
      this.game.events.off(Phaser.Core.Events.POST_RENDER);

      this.activeBeams.forEach(entry => {
        entry.beam.destroy();
        entry.core.destroy();
        if (entry.startGlow) entry.startGlow.destroy();
        if (entry.impactGlow) entry.impactGlow.destroy();
      });
      this.activeBeams.clear();
    });
  }

  private applyHandshakePayload(payload: any): void {
    masterConfigs = payload;

    if (this.versionText) {
      this.versionText.setText(payload.version || 'v?.?.?');
    }

    // Guard: nothing to do if configs are empty or map already built.
    if (!masterConfigs || Object.keys(masterConfigs).length === 0) return;
    if (this.isMapInitialized) return;

    // Rebuild animations from fresh config data.
    if (this.anims) this.createAnimations(masterConfigs);

    const mapIdToUse =
      masterConfigs.currentMapId ||
      masterConfigs.CurrentMapId ||
      (masterConfigs.maps ? Object.keys(masterConfigs.maps)[0] : null) ||
      (masterConfigs.Maps ? Object.keys(masterConfigs.Maps)[0] : null);

    if (!mapIdToUse) return;

    const currentMap =
      masterConfigs.maps?.[mapIdToUse] ||
      masterConfigs.Maps?.[mapIdToUse];

    if (!currentMap) return;

    this.isMapInitialized = true;
    this.mapWidth = currentMap.width || currentMap.Width;
    this.mapHeight = currentMap.height || currentMap.Height;

    const mapTex = currentMap.textureKey || currentMap.TextureKey;
    const texScale = currentMap.textureScale ?? currentMap.TextureScale ?? 1.0;

    if (mapTex && this.textures.exists(mapTex)) {
      const groundTile = this.add
        .tileSprite(this.mapWidth / 2, this.mapHeight / 2, this.mapWidth, this.mapHeight, mapTex)
        .setDepth(-2);
      groundTile.setTileScale(texScale, texScale);
    } else {
      this.add.grid(
        this.mapWidth / 2, this.mapHeight / 2, this.mapWidth, this.mapHeight,
        64, 64, 0x1a1a1a, 1, 0x333333, 1
      ).setDepth(-2);
    }

    const border = this.add.graphics();
    border.lineStyle(16, 0xff0000, 1);
    border.strokeRect(10, 10, this.mapWidth - 20, this.mapHeight - 20);
    border.setDepth(-1);
    border.postFX.addGlow(0xff0000, 6, 0, false, 0.1, 15);
    this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);
  }



  // ==========================================
  // 2. WORKER NODE (MATCH) LISTENERS
  // ==========================================
  private bindWorkerListeners() {
    // .off() before .on() makes this method safe to call multiple times
    // (e.g., if withAutomaticReconnect fires and the connection is reused).

    const networkWorker = new Worker(new URL('./network.worker.ts', import.meta.url), { type: 'module' });

    networkWorker.onmessage = (e) => {
      const { rawState, compressedSize, uncompressedSize } = e.data;

      // 1. Update Network Statistics
      this.compressedBytesReceived += compressedSize;
      this.uncompressedBytesReceived += uncompressedSize;

      this.lastNetworkEntitiesCount =
        (rawState.p?.length || 0) + (rawState.e?.length || 0) +
        (rawState.me?.length || 0) + (rawState.nb?.length || 0) + (rawState.pk?.length || 0);

      const PhaseMap = ["WaitingForPlayers", "WaveActive", "ShopPhase"];
      const StateMap = ["Idle", "Moving", "Attacking", "Casting", "Dead"];

      // ==========================================
      // 2. PROCESS DELETIONS
      // ==========================================
      if (rawState.db) {
        rawState.db.forEach((id: string) => {
          const sprite = this.projectileSprites.get(id);
          if (sprite) {
            const configId = (sprite as any).__pdata?.configId as string | undefined;
            if (configId) {
              const projCfg = masterConfigs.projectiles?.[configId] ?? masterConfigs.Projectiles?.[configId];
              if (projCfg?.soundHit) AudioManager.getInstance().setLastProjectileHitSound(projCfg.soundHit);
            }
            sprite.destroy();
            this.projectileSprites.delete(id);
          }
        });
      }

      if (rawState.de?.length > 0) {
        rawState.de.forEach((id: string) => this.enemyCache.delete(id));
        this.enemiesDirty = true; // Mark array for rebuild
      }

      if (rawState.dpk?.length > 0) {
        rawState.dpk.forEach((id: string) => {
          this.pickupCache.delete(id);
          if (id === this.nearbyLootId) {
            this.nearbyLootId = null;
            this.groundTooltip.hide();
          }
        });
      }

      // ==========================================
      // 3. PROCESS ADDITIONS & UPDATES
      // ==========================================
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

          sprite.__pdata = {
            vx, vy, configId,
            isOrbital: b[6] === 1,
            ownerId: b[6] === 1 ? b[7] : undefined,
            orbitRadius: b[6] === 1 ? b[8] : undefined,
            orbitAngleOffset: b[6] === 1 ? b[9] : undefined,
          };

          this.projectileSprites.set(id, sprite);
        });
      }

      if (rawState.e?.length > 0) {
        rawState.e.forEach((e: any[]) => {
          this.enemyCache.set(e[0], {
            id: e[0], configId: e[1], x: e[2], y: e[3], currentHp: e[4], maxHp: e[5],
            aimX: e[6], aimY: e[7],
            actionState: StateMap[e[8]], currentCastingSkillId: e[9], currentCastTimer: e[10],
            maxCastTimer: e[11], activeEffects: e[12] || [],
            weapons: e[13]?.map((w: any[]) => ({
              configId: w[0], slotIndex: w[1], level: w[2], rolledStats: w[3] || {}, totalBaseStats: w[4] || {}
            })) || [],
            firedWeapons: e[14] || [],
            team: e[15],
            currentShield: e[16] || 0
          });
        });
        this.enemiesDirty = true; // Mark array for rebuild
      }

      if (rawState.pk) {
        rawState.pk.forEach((pk: any[]) => {
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
      }

      if (rawState.me) {
        rawState.me.forEach((m: any[]) => {
          const cached = this.enemyCache.get(m[0]);
          if (cached) {
            cached.x = m[1]; cached.y = m[2]; cached.currentHp = m[3]; cached.maxHp = m[4];
            cached.aimX = m[5]; cached.aimY = m[6]; cached.actionState = StateMap[m[7]];
            cached.currentCastingSkillId = m[8]; cached.currentCastTimer = m[9]; cached.maxCastTimer = m[10];
            cached.activeEffects = m[11] || []; cached.firedWeapons = m[12] || []; cached.currentShield = m[13] || 0;
          }
        });
      }

      // ==========================================
      // 4. REBUILD CACHE (ONLY IF NEEDED)
      // ==========================================
      if (this.enemiesDirty) {
        this.activeEnemiesArray = Array.from(this.enemyCache.values());
        this.enemiesDirty = false;
      }

      // ==========================================
      // 5. ASSEMBLE GAME STATE PAYLOAD
      // ==========================================
      const state: GameStatePayload = {
        phase: PhaseMap[rawState.ph] || "WaitingForPlayers",
        currentWave: rawState.w, timeRemaining: rawState.tr,
        players: rawState.p?.map((p: any[]) => ({
          connectionId: p[0], x: p[1], y: p[2], aimX: p[3], aimY: p[4],
          currentHp: p[5], maxHp: p[6], gold: p[7], actionState: StateMap[p[8]],
          currentCastingSkillId: p[9], currentCastTimer: p[10], maxCastTimer: p[11],
          weapons: p[12]?.map((w: any[]) => ({
            configId: w[0], slotIndex: w[1], level: w[2], rolledStats: w[3] || {},
            weaponSkills: w[4] || [], totalBaseStats: w[5] || {}
          })) || [],
          firedWeapons: p[13] || [],
          activeEffects: p[14] || [],
          synergizedSkills: p[15]?.map((s: any[]) => ({
            configId: s[0], currentCooldown: s[1]
          })) || [],
          statDiff: p[16],
          currentShield: p[17] || 0,
          currentShop: [], stats: {}, ownedItems: {}
        })) || [],

        enemies: this.activeEnemiesArray, // <--- Using the fast cached array!
        pickups: Array.from(this.pickupCache.values()),
        projectiles: [],

        damageEvents: rawState.dmg?.map((d: any[]) => ({
          x: d[0], y: d[1], amount: d[2],
          isCritical: d[3] === 1, isDodge: d[4] === 1, isBlock: d[5] === 1
        })) || [],
        aoeEvents: rawState.aoe?.map((a: any[]) => ({ x: a[0], y: a[1], radius: a[2], isFriendly: a[3], configId: a[4] })) || [],
        beamEvents: rawState.bm?.map((b: any[]) => ({ startX: b[0], startY: b[1], targetX: b[2], targetY: b[3], width: b[4], colorTint: b[5], casterId: b[6], skillId: b[7] })) || [],
        beamEndedEvents: rawState.be?.map((b: any[]) => ({ casterId: b[0], skillId: b[1] })) || []
      };

      // ==========================================
      // 6. RENDER VFX & UI
      // ==========================================
      const aoeEvents = state.aoeEvents || [];
      const beamEvents = state.beamEvents || [];
      const beamEndedEvents = state.beamEndedEvents || [];

      VfxRenderer.renderAoeEvents(this, aoeEvents, masterConfigs);
      VfxRenderer.renderBeamEvents(this, beamEvents, masterConfigs, this.activeBeams);
      beamEndedEvents.forEach((ev: { casterId: string, skillId: string }) => {
        VfxRenderer.endBeam(ev.casterId, ev.skillId, this.activeBeams);
      });

      this.currentPhase = state.phase;
      const myPlayer = state.players.find(p => p.connectionId === matchConnection.connectionId);

      if (myPlayer) {
        this.goldUIText.setText(`💰 ${myPlayer.gold}`);

        if (myPlayer.statDiff) {
          let currentStats = this.data.get('latestPlayerStats') || {};
          Object.assign(currentStats, myPlayer.statDiff);
          this.data.set('latestPlayerStats', currentStats);

          if (this.shopUIModule) {
            const currentLevel = this.data.get('playerLevel') || 1;
            this.shopUIModule.updateJustStats(currentStats, currentLevel);
          }

          const speedEl = document.getElementById('ui-stat-speed');
          if (speedEl) speedEl.innerText = Math.floor(currentStats["movementSpeed"] || 0).toString();

          const hpEl = document.getElementById('ui-stat-maxhp');
          if (hpEl) hpEl.innerText = Math.floor(currentStats["maxHp"] || 0).toString();

          const dmgEl = document.getElementById('ui-stat-damage');
          if (dmgEl) {
            const totalDmg = (currentStats["meleeDamage"] || 0) + (currentStats["magicDamage"] || 0);
            dmgEl.innerText = Math.floor(totalDmg).toString();
          }
        }

        const pStats = this.data.get('latestPlayerStats') || {};
        this.skillActionBar.updateSkills(myPlayer.synergizedSkills, masterConfigs, pStats);
      }

      // ==========================================
      // 7. LOOT TOOLTIP LOGIC
      // ==========================================
      const PICKUP_RADIUS_SQ = 50 * 50;
      let newNearbyLootId: string | null = null;
      if (myPlayer) {
        for (const [id, pickup] of this.pickupCache) {
          if (pickup.type === 0) continue;
          const dx = pickup.x - myPlayer.x;
          const dy = pickup.y - myPlayer.y;
          if (dx * dx + dy * dy <= PICKUP_RADIUS_SQ) {
            newNearbyLootId = id;
            break;
          }
        }
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

      // ==========================================
      // 8. PHASE TEXT UPDATES
      // ==========================================
      if (this.currentPhase === "WaitingForPlayers") {
        this.waveUIText.setText(`WAITING FOR HOST TO START...`).setColor('#bf55ec');
      } else if (this.currentPhase === "WaveActive") {
        this.waveUIText.setText(`Wave ${state.currentWave} - 0:${state.timeRemaining.toString().padStart(2, '0')}`).setColor('#ffffff');
        if (this.previousPhase !== "WaveActive") { this.shopUIModule.setVisible(false); this.manuallyClosedShop = true; }
      } else if (this.currentPhase === "ShopPhase") {
        this.waveUIText.setText(`SHOP PHASE - ${state.timeRemaining}s`).setColor('#00ff00');
        if (this.previousPhase !== "ShopPhase") { this.shopUIModule.setVisible(true); this.manuallyClosedShop = false; }
      }
      this.previousPhase = this.currentPhase;

      // ==========================================
      // 9. RENDER ACTORS & WORLD
      // ==========================================
      const activePlayers = ActorRenderer.render(this, state.players, this.playerSprites, masterConfigs, this.targetPositions, true, state.enemies, this.hpGraphics);
      const activeEnemies = ActorRenderer.render(this, state.enemies, this.enemySprites, masterConfigs, this.targetPositions, false, undefined, this.hpGraphics);
      const dummyMap = new Map();
      const { activePickups } = WorldRenderer.render(this, state, dummyMap, this.pickupSprites, masterConfigs, this.targetPositions) as any;

      const mySprite = this.playerSprites.get(matchConnection.connectionId || "");
      if (mySprite && !(this.cameras.main as any)._isFollowing) {
        this.cameras.main.startFollow(mySprite, true, 0.1, 0.1);
        (this.cameras.main as any)._isFollowing = true;
      }

      this.cleanupSprites(this.playerSprites, activePlayers);
      this.cleanupSprites(this.enemySprites, activeEnemies);
      this.cleanupSprites(this.pickupSprites, activePickups);
    };


    matchConnection.off("MatchError");
    matchConnection.on("MatchError", (msg: string) => {
      console.warn("[MatchHub] MatchError:", msg);

      // >>> NEW: Wipe credentials if hijacked mid-game
      if (msg.includes("location")) {
        localStorage.removeItem('arena_jwt');
        localStorage.removeItem('arena_username');
        localStorage.removeItem('arena_playerId');
      }

      localStorage.removeItem('currentRoomId');
      if (this.syncOverlay) this.syncOverlay.style.display = 'none';
      const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.location.href = cleanUrl;
    });

    matchConnection.off("AllPlayersSynced");
    matchConnection.on("AllPlayersSynced", () => {
      // FIX: Previously inline inside MatchStarted — moved here for the same reason.
      if (this.handoffTimeout !== null) { clearTimeout(this.handoffTimeout); this.handoffTimeout = null; }
      if (this.syncOverlay) this.syncOverlay.style.display = 'none';

      const lobbyWrapper = document.getElementById('lobby-ui-wrapper');
      if (lobbyWrapper) lobbyWrapper.style.display = 'none';

      lobbyConnection.stop().then(() => console.log("Safely dropped Master connection. Game On!"));

      setupChatUI(this, matchConnection);

      // Mobile HUD: joystick + ⚙️ + 🐛 — created once, after the lobby disappears.
      if (isMobile && !this.mobileUIInitialized) {
        this.mobileUIInitialized = true;
        this.setupMobileUI();
      }

      if (this.shopUIModule && typeof (this.shopUIModule as any).destroy === 'function') {

        (this.shopUIModule as any).destroy();
      }
      this.shopUIModule = new ShopUI(this, matchConnection);
      this.shopUIModule.setDepth(1000);
      this.shopUIModule.setVisible(false);
    });

    matchConnection.off("ReceiveHandshake");
    matchConnection.on("ReceiveHandshake", (payload: any) => {
      // This fires when the Worker re-sends configs on mid-match reconnect (F5).
      // Without this listener, masterConfigs stays empty → green boxes + gray map.
      console.log("Handshake received from Worker. Rebuilding configs...");
      this.applyHandshakePayload(payload);
    });


    matchConnection.off("UpdatePlayerUI");
    matchConnection.on("UpdatePlayerUI", (uiData: any) => {
      this.data.set('playerLevel', uiData.level || 1);

      if (uiData.stats || uiData.Stats) {
        this.data.set('latestPlayerStats', uiData.stats || uiData.Stats);
      }

      if (this.shopUIModule) {
        this.shopUIModule.updateUIData(uiData, masterConfigs);
      }
    });

    matchConnection.off("UpdateStateCompressed");

    matchConnection.on("UpdateStateCompressed", (compressedBase64: string) => {
      // Instead of freezing the main thread, we just hand the string to the worker!
      networkWorker.postMessage(compressedBase64);
    });
  }

  update(time: number, delta: number) {
    if (!this.debugGraphics) return;
    this.handleInput(time);
    this.smoothInterpolateSprites(this.playerSprites, 0.2);
    this.smoothInterpolateSprites(this.enemySprites, 0.2);
    const dtSeconds = delta / 1000;

    this.hpGraphics.clear();

    // --- NEW: Draw all health bars and cast bars in one batched pass! ---
    const drawHpBars = (map: Map<string, any>) => {
      map.forEach((sprite) => {
        if (!sprite.visible) return;

        const refs = sprite.__refs;
        if (!refs) return;

        // Hide the old pulsing ellipse fallback you had
        if (refs.castCircle) refs.castCircle.setVisible(false);

        const drawX = sprite.x - (refs.baseWidth / 2);
        const drawY = sprite.y + refs.topY;

        // --- 1. HEALTH & SHIELD BARS (League of Legends Style) ---
        const totalCapacity = Math.max(refs.maxHp, refs.currentHp + refs.currentShield);

        // Only draw if they are alive and missing health (or are a player)
        if (refs.actionState !== "Dead" && totalCapacity > 0 && (refs.currentHp < refs.maxHp || refs.currentShield > 0 || refs.isPlayer)) {

          const hpPct = Math.max(0, Math.min(1, refs.currentHp / totalCapacity));
          const shieldPct = Math.max(0, Math.min(1, refs.currentShield / totalCapacity));

          // Background (Black Border)
          this.hpGraphics.fillStyle(0x000000, 1);
          this.hpGraphics.fillRect(drawX - 1, drawY - 1, refs.baseWidth + 2, 8);

          // HP Fill (Green for friends, Red for enemies)
          this.hpGraphics.fillStyle(refs.isFriendly ? 0x2ecc71 : 0xe74c3c, 1);
          this.hpGraphics.fillRect(drawX, drawY, refs.baseWidth * hpPct, 6);

          // Shield Fill (Cyan/White) appended exactly at the end of the HP block!
          if (refs.currentShield > 0) {
            this.hpGraphics.fillStyle(0x00ffff, 1); // LoL often uses Cyan for magic shields
            this.hpGraphics.fillRect(drawX + (refs.baseWidth * hpPct), drawY, refs.baseWidth * shieldPct, 6);
          }
        }

        // --- 2. CAST BAR (Linear progress bar underneath) ---
        if (refs.actionState === "Casting" && refs.maxCastTimer > 0 && refs.showCastBar && refs.actionState !== "Dead") {
          const castY = drawY + 10; // Positioned neatly 10px below the health bar

          // Reverse the timer so it acts like a progress bar filling up from left to right
          const castProgress = 1.0 - Math.max(0, Math.min(1, refs.currentCastTimer / refs.maxCastTimer));

          // Background (Dark gray)
          this.hpGraphics.fillStyle(0x000000, 0.8);
          this.hpGraphics.fillRect(drawX - 1, castY - 1, refs.baseWidth + 2, 5);

          // Cast Fill (Yellow/Orange warning color)
          this.hpGraphics.fillStyle(0xffa500, 1);
          this.hpGraphics.fillRect(drawX, castY, refs.baseWidth * castProgress, 3);
        }
      });
    };

    // Execute the draw commands for all actors
    drawHpBars(this.playerSprites);
    drawHpBars(this.enemySprites);


    if (this.skillActionBar) {
      this.skillActionBar.smoothTickCooldowns(dtSeconds);
    }

    if (this.nearbyLootId && this.groundTooltip?.visible) {
      const pickup = this.pickupCache.get(this.nearbyLootId);
      if (pickup) {
        const cam = this.cameras.main;
        const screenX = (pickup.x - cam.scrollX) * cam.zoom;
        const screenY = (pickup.y - cam.scrollY) * cam.zoom - 80;
        this.groundTooltip.updatePosition(screenX, screenY);
      }
    }

    if (this.spaceKey && Phaser.Input.Keyboard.JustDown(this.spaceKey) && this.nearbyLootId && matchConnection) {
      matchConnection.invoke("TryPickupLoot", this.nearbyLootId).catch((err: any) => console.error(err));
    }

    this.projectileSprites.forEach((sprite) => {
      const pdata = (sprite as any).__pdata;
      if (!pdata) return;

      if (pdata.isOrbital) {
        const ownerSprite = this.playerSprites.get(pdata.ownerId) || this.enemySprites.get(pdata.ownerId);

        if (ownerSprite) {
          const radius = pdata.orbitRadius;
          const radiansPerSec = pdata.vx * (Math.PI / 180);
          let angle = pdata.orbitAngleOffset + radiansPerSec * dtSeconds;
          pdata.orbitAngleOffset = angle;

          sprite.x = ownerSprite.x + Math.cos(angle) * radius;
          sprite.y = ownerSprite.y + Math.sin(angle) * radius;

          const spinSign = Math.sign(radiansPerSec) || 1;
          sprite.rotation = angle + (spinSign * Math.PI) / 2;
        }
      } else {
        sprite.x += pdata.vx * dtSeconds;
        sprite.y += pdata.vy * dtSeconds;
      }
    });

    if (this.isDebugMode) {
      if (time - this.lastBandwidthTime > 1000) {
        this.currentCompressedKbps = ((this.compressedBytesReceived * 8) / 1000).toFixed(2);
        this.currentUncompressedKbps = ((this.uncompressedBytesReceived * 8) / 1000).toFixed(2);

        this.compressedBytesReceived = 0;
        this.uncompressedBytesReceived = 0;
        this.lastBandwidthTime = time;
      }

      const fps = Math.round(this.game.loop.actualFps);
      const frameTime = this.game.loop.delta.toFixed(1);
      const renderedSprites = this.cameras.main.renderList.length;

      // Grab the URL from the active connection
      this.perfText.setText(
        `Environment : ${envName}\n` +
        `Master Node : ${masterUrl}\n` +
        `Worker Node : ${activeWorkerUrl}\n` +
        `==================================\n` +
        `FPS         : ${fps}\n` +
        `Ping        : ${this.pingMs} ms\n` +
        `Logic       : ${frameTime} ms\n` +
        `Sprites     : ${renderedSprites} (GPU Visuals)\n` +
        `Entities    : ${this.lastNetworkEntitiesCount} (C# Network)\n` +
        `Draws       : ${this.currentDrawCalls} (Peak: ${this.maxDrawCalls})\n` +
        `Network     : ${this.currentCompressedKbps} kbps (Raw: ${this.currentUncompressedKbps} kbps)`
      );
    }

    this.debugGraphics.clear();
    if (this.isDebugMode) {
      this.playerSprites.forEach((sprite) => {
        this.debugGraphics.lineStyle(2, 0x00ffff);
        this.debugGraphics.strokeCircle(sprite.x, sprite.y, 15);
      });

      this.enemySprites.forEach((sprite) => {
        const configId = sprite.getData('configId');
        const config = masterConfigs.enemies ? (masterConfigs.enemies[configId] || masterConfigs.Enemies?.[configId]) : null;
        const hitR = config ? (config.hitRadius ?? config.HitRadius ?? 15) : 15;
        this.debugGraphics.lineStyle(2, 0xff0000);
        this.debugGraphics.strokeCircle(sprite.x, sprite.y, hitR);
      });

      this.projectileSprites.forEach((sprite) => {
        const configId = (sprite as any).__pdata?.configId;
        const config = masterConfigs.projectiles ? (masterConfigs.projectiles[configId] || masterConfigs.Projectiles?.[configId]) : null;
        const hitR = config ? (config.hitRadius ?? config.HitRadius ?? 10) : 10;
        this.debugGraphics.lineStyle(2, 0x00ff00);
        this.debugGraphics.strokeCircle(sprite.x, sprite.y, hitR);
      });

      this.pickupSprites.forEach((sprite) => {
        this.debugGraphics.lineStyle(2, 0xffff00);
        this.debugGraphics.strokeCircle(sprite.x, sprite.y, 15);
      });
    }
  }

  private handleInput(time: number) {
    if (!matchConnection || matchConnection.state !== HubConnectionState.Connected) return;

    let dirX = 0, dirY = 0;

    // Keyboard input — still works on mobile via Bluetooth keyboard.
    if (this.cursors && this.wasd) {
      if (this.cursors.left.isDown || this.wasd.A.isDown) dirX = -1;
      if (this.cursors.right.isDown || this.wasd.D.isDown) dirX = 1;
      if (this.cursors.up.isDown || this.wasd.W.isDown) dirY = -1;
      if (this.cursors.down.isDown || this.wasd.S.isDown) dirY = 1;
    }

    // Mobile virtual joystick overrides keyboard when the stick is pushed.
    if (isMobile && (mobileDir.x !== 0 || mobileDir.y !== 0)) {
      dirX = mobileDir.x;
      dirY = mobileDir.y;
    }

    // Aim: auto-aim on mobile, pointer on desktop.
    let aimX: number, aimY: number;
    if (isMobile) {
      const aim = this.getMobileAutoAim(dirX, dirY);
      aimX = aim.x; aimY = aim.y;
    } else {
      const wp = this.cameras.main.getWorldPoint(this.input.activePointer.x, this.input.activePointer.y);
      aimX = Math.round(wp.x); aimY = Math.round(wp.y);
    }

    const inputData = { DirX: dirX, DirY: dirY, AimX: aimX, AimY: aimY };
    const inputString = JSON.stringify(inputData);
    if (inputString !== this.lastSentInput || time - this.lastInputSendTime > 100) {
      matchConnection.invoke("SendInput", inputData).catch((err: any) => console.error(err));
      this.lastSentInput = inputString;
      this.lastInputSendTime = time;
    }
  }

  // Auto-aim at the nearest visible enemy; falls back to aiming ahead in the movement direction.
  private getMobileAutoAim(dirX: number, dirY: number): { x: number, y: number } {
    const mySprite = this.playerSprites.get(matchConnection.connectionId || '');
    if (!mySprite) return { x: 0, y: 0 };

    // Default: aim 300 px ahead in the movement direction.
    let aimX = Math.round(mySprite.x + dirX * 300);
    let aimY = Math.round(mySprite.y + dirY * 300);
    let nearestSq = Infinity;

    this.enemyCache.forEach(enemy => {
      const dx = enemy.x - mySprite.x;
      const dy = enemy.y - mySprite.y;
      const sq = dx * dx + dy * dy;
      if (sq < nearestSq) {
        nearestSq = sq;
        aimX = Math.round(enemy.x);
        aimY = Math.round(enemy.y);
      }
    });

    return { x: aimX, y: aimY };
  }

  private setupMobileUI(): void {
    const hud = document.createElement('div');
    hud.id = 'mobile-hud';
    hud.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5000;';
    hud.innerHTML = `
        <style>
            .m-icon-btn {
                position: absolute; top: 20px;
                width: 52px; height: 52px; border-radius: 50%;
                pointer-events: auto; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                font-size: 24px; -webkit-tap-highlight-color: transparent;
                transition: transform 0.1s; border: none; outline: none;
            }
            .m-icon-btn:active { transform: scale(0.88); }
            #mobile-settings-btn { right: 20px;  background: rgba(0,0,0,0.75); border: 2px solid #e5b35c; }
            #mobile-debug-btn    { right: 82px; background: rgba(0,0,0,0.75); border: 2px solid #00ff88; }

            #joystick-zone {
                position: absolute; bottom: 40px; left: 40px;
                width: 150px; height: 150px;
                pointer-events: auto; touch-action: none;
            }
            #joystick-base {
                position: absolute; inset: 0; border-radius: 50%;
                background: rgba(0,0,0,0.45); border: 3px solid rgba(229,179,92,0.4);
            }
            #joystick-thumb {
                position: absolute; width: 64px; height: 64px;
                top: 50%; left: 50%; transform: translate(-50%, -50%);
                border-radius: 50%;
                background: radial-gradient(circle, rgba(229,179,92,0.9) 0%, rgba(229,179,92,0.5) 100%);
                border: 2px solid #e5b35c;
                box-shadow: 0 0 12px rgba(229,179,92,0.35);
            }
        </style>

        <button id="mobile-settings-btn" class="m-icon-btn">⚙️</button>
        <button id="mobile-debug-btn"    class="m-icon-btn">🐛</button>

        <div id="joystick-zone">
            <div id="joystick-base"></div>
            <div id="joystick-thumb"></div>
        </div>
    `;
    document.body.appendChild(hud);

    // Push the chat history right so it doesn't sit behind the joystick.
    const chatWrap = document.getElementById('chat-wrapper');
    if (chatWrap) {
      chatWrap.style.left = '210px';
      chatWrap.style.width = 'calc(100vw - 230px)';
    }

    // ── Settings button → toggle ESC menu ────────────────────────────────────
    document.getElementById('mobile-settings-btn')!.addEventListener('click', () => {
      this.escMenu.toggle();
    });

    // ── Debug button → same as pressing H ────────────────────────────────────
    document.getElementById('mobile-debug-btn')!.addEventListener('click', () => {
      this.isDebugMode = !this.isDebugMode;
      this.perfText.setVisible(this.isDebugMode);
    });

    // ── Virtual joystick ─────────────────────────────────────────────────────
    const zone = document.getElementById('joystick-zone')!;
    const thumb = document.getElementById('joystick-thumb')!;
    const ZONE_R = 75; // px — half the zone width (150)

    let activeTouchId: number | null = null;
    let zoneRect: DOMRect = zone.getBoundingClientRect();
    window.addEventListener('resize', () => { zoneRect = zone.getBoundingClientRect(); });

    zone.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();
      if (activeTouchId !== null) return;
      activeTouchId = e.changedTouches[0].identifier;
      zoneRect = zone.getBoundingClientRect(); // refresh in case of layout shift
    }, { passive: false });

    zone.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();
      if (activeTouchId === null) return;

      let touch: Touch | null = null;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId) { touch = e.changedTouches[i]; break; }
      }
      if (!touch) return;

      const cx = zoneRect.left + ZONE_R;
      const cy = zoneRect.top + ZONE_R;
      let dx = touch.clientX - cx;
      let dy = touch.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > ZONE_R) { dx = dx / dist * ZONE_R; dy = dy / dist * ZONE_R; }

      // thumb center = (ZONE_R + dx, ZONE_R + dy) inside the zone
      // CSS transform:translate(-50%,-50%) handles the -32px centering offset
      thumb.style.left = `${ZONE_R + dx}px`;
      thumb.style.top = `${ZONE_R + dy}px`;

      mobileDir.x = dx / ZONE_R;
      mobileDir.y = dy / ZONE_R;
    }, { passive: false });

    const releaseJoystick = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId) {
          activeTouchId = null;
          mobileDir.x = 0;
          mobileDir.y = 0;
          thumb.style.left = '50%';
          thumb.style.top = '50%';
          break;
        }
      }
    };
    zone.addEventListener('touchend', releaseJoystick, { passive: false });
    zone.addEventListener('touchcancel', releaseJoystick, { passive: false });
  }

  private smoothInterpolateSprites(map: Map<string, any>, speed: number = 0.2) {
    const cam = this.cameras.main;
    // Add a 200px buffer outside the camera view
    const cullLeft = cam.scrollX - 200;
    const cullRight = cam.scrollX + cam.width + 200;
    const cullTop = cam.scrollY - 200;
    const cullBottom = cam.scrollY + cam.height + 200;

    map.forEach((sprite, id) => {
      const target = this.targetPositions.get(id);
      if (!target) return;

      // 1. Off-screen? Snap instantly, don't waste CPU interpolating unseen entities.
      if (target.x < cullLeft || target.x > cullRight || target.y < cullTop || target.y > cullBottom) {
        if (sprite.x !== target.x) sprite.x = target.x;
        if (sprite.y !== target.y) sprite.y = target.y;
        return;
      }

      // 2. On-screen? Interpolate with a 0.5px deadzone.
      // If a sprite is within half a pixel of its target, snap it to prevent endless micro-updates.
      const dx = target.x - sprite.x;
      const dy = target.y - sprite.y;

      if (Math.abs(dx) > 0.5) sprite.x += dx * speed;
      else if (sprite.x !== target.x) sprite.x = target.x;

      if (Math.abs(dy) > 0.5) sprite.y += dy * speed;
      else if (sprite.y !== target.y) sprite.y = target.y;
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
        if (key === 'vfxAnimFrames' || key === 'VfxAnimFrames') {
          const id = entity.id || entity.Id;
          const animKey = `${id}_vfx`;

          if (!this.anims.exists(animKey)) {
            const textureKey = entity.vfxTextureKey || entity.VfxTextureKey;
            const frameRate = entity.vfxFrameRate || entity.VfxFrameRate || 15;

            if (textureKey) {
              this.anims.create({
                key: animKey,
                frames: this.anims.generateFrameNumbers(textureKey, {
                  start: entity[key][0],
                  end: entity[key][1]
                }),
                frameRate: frameRate,
                repeat: 0
              });
            }
          }
        }
        else if (key.toLowerCase().startsWith('anim') && Array.isArray(entity[key]) && entity[key].length === 2) {
          const actionName = key.toLowerCase().replace('anim', '');
          const id = entity.id || entity.Id;
          const animKey = `${id}_${actionName}`;

          if (!this.anims.exists(animKey)) {
            const textureKey = entity.textureKey || entity.TextureKey;
            let customFrameRate = entity[`${key}FrameRate`] || 15;

            if (actionName === 'attack' && (entity.attackDuration || entity.AttackDuration)) {
              const duration = entity.attackDuration || entity.AttackDuration;
              const totalFrames = (entity[key][1] - entity[key][0]) + 1;
              customFrameRate = totalFrames / duration;
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

// =========================================================
// CHAT & COMMAND UI OVERLAY
// =========================================================
export function setupChatUI(scene: Phaser.Scene, connection: any) {
  const availableCommands = [
    { cmd: '/setwave', desc: '/setwave <number>' },
    { cmd: '/skipphase', desc: '/skipphase' },
    { cmd: '/spawnenemy', desc: '/spawnenemy <id> [count]' },
    { cmd: '/heal', desc: '/heal' },
    { cmd: '/givegold', desc: '/givegold <amount>' },
    { cmd: '/givexp', desc: '/givexp <amount>' },
    { cmd: '/killall', desc: '/killall' },
    { cmd: '/giveweapon', desc: '/giveweapon <configId>' },
    { cmd: '/addtime', desc: '/addtime <seconds>' },
    { cmd: '/removetime', desc: '/removetime <seconds>' },
    { cmd: '/toggleshop', desc: '/toggleshop' },
    { cmd: '/givestat', desc: '/givestat <statName> <amount>' },
  ];

  const chatHTML = `
    <style>
      #chat-wrapper { position: absolute; bottom: 20px; left: 20px; width: 350px; z-index: 10000; font-family: 'Segoe UI', sans-serif; pointer-events: none; }
      #chat-history { max-height: 200px; overflow-y: hidden; display: flex; flex-direction: column; justify-content: flex-end; margin-bottom: 5px; }
      .chat-msg { background: rgba(0,0,0,0.6); color: white; padding: 4px 8px; border-radius: 4px; margin-top: 2px; text-shadow: 1px 1px 1px black; width: fit-content; font-size: 14px; }
      .sys-msg { color: #00ffff; font-style: italic; }
      #chat-input-container { position: relative; display: none; pointer-events: auto; }
      #chat-input { width: 100%; padding: 10px; background: rgba(0,0,0,0.8); color: white; border: 1px solid #555; border-radius: 4px; outline: none; font-size: 14px; box-sizing: border-box; }
      #chat-suggestions { position: absolute; bottom: 100%; left: 0; width: 100%; background: rgba(0,0,0,0.9); border: 1px solid #555; border-bottom: none; border-radius: 4px 4px 0 0; color: white; display: none; flex-direction: column; }
      .suggestion-item { padding: 8px; cursor: pointer; border-bottom: 1px solid #333; font-size: 13px; }
      .suggestion-item:hover, .suggestion-item.active { background: #333; color: #00ff00; }
    </style>
    <div id="chat-wrapper">
      <div id="chat-history"></div>
      <div id="chat-input-container">
        <div id="chat-suggestions"></div>
        <input type="text" id="chat-input" placeholder="Type a message or /command..." autocomplete="off" />
      </div>
    </div>
  `;

  if (!document.getElementById('chat-wrapper')) {
    document.body.insertAdjacentHTML('beforeend', chatHTML);
  }

  const historyBox = document.getElementById('chat-history')!;
  const inputContainer = document.getElementById('chat-input-container')!;
  const inputEl = document.getElementById('chat-input') as HTMLInputElement;
  const suggestionsBox = document.getElementById('chat-suggestions')!;

  let isChatActive = false;
  let suggestionIndex = -1;
  let currentMatches: any[] = [];

  const addMessage = (sender: string, text: string) => {
    const isSystem = sender === "System";
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${isSystem ? 'sys-msg' : ''}`;
    msgDiv.innerText = isSystem ? text : `[${sender}]: ${text}`;
    historyBox.appendChild(msgDiv);

    if (historyBox.children.length > 10) historyBox.firstChild?.remove();

    if (!isChatActive) {
      setTimeout(() => { if (!isChatActive) msgDiv.style.opacity = '0.3'; }, 5000);
    }
  };

  // Remove old listeners to prevent duplicate text in chat
  connection.off("ReceiveChatMessage");
  connection.on("ReceiveChatMessage", (sender: string, msg: string) => {
    addMessage(sender, msg);
  });

  const drawSuggestions = () => {
    suggestionsBox.innerHTML = '';
    if (currentMatches.length > 0) {
      suggestionsBox.style.display = 'flex';
      currentMatches.forEach((m, idx) => {
        const item = document.createElement('div');
        item.className = 'suggestion-item' + (idx === suggestionIndex ? ' active' : '');
        item.innerText = m.desc;

        item.onclick = () => {
          inputEl.value = m.cmd + ' ';
          inputEl.focus();
          suggestionsBox.style.display = 'none';
          suggestionIndex = -1;
          currentMatches = [];
        };
        suggestionsBox.appendChild(item);
      });
    } else {
      suggestionsBox.style.display = 'none';
    }
  };

  inputEl.addEventListener('input', () => {
    const val = inputEl.value.toLowerCase();
    suggestionIndex = -1;

    if (val.startsWith('/')) {
      currentMatches = availableCommands.filter(c => c.cmd.startsWith(val));
    } else {
      currentMatches = [];
    }
    drawSuggestions();
  });

  inputEl.addEventListener('keydown', (e) => {
    e.stopPropagation();

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentMatches.length > 0) {
        suggestionIndex = (suggestionIndex + 1) % currentMatches.length;
        drawSuggestions();
      }
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentMatches.length > 0) {
        suggestionIndex = (suggestionIndex - 1 + currentMatches.length) % currentMatches.length;
        drawSuggestions();
      }
    }
    else if (e.key === 'Enter') {
      e.preventDefault();

      if (suggestionIndex >= 0 && currentMatches.length > 0) {
        inputEl.value = currentMatches[suggestionIndex].cmd + ' ';
        suggestionIndex = -1;
        currentMatches = [];
        drawSuggestions();
        return;
      }

      const text = inputEl.value.trim();
      if (text.length > 0) {
        connection.invoke("SendChatMessage", text).catch((err: any) => console.error(err));
      }

      inputEl.value = '';
      inputEl.blur();
      inputContainer.style.display = 'none';
      suggestionsBox.style.display = 'none';
      isChatActive = false;
      suggestionIndex = -1;
      currentMatches = [];
      Array.from(historyBox.children).forEach((child: any) => child.style.opacity = '0.3');

      setTimeout(() => {
        scene.input.keyboard!.enabled = true;
      }, 50);
    }
    else if (e.key === 'Escape') {
      e.preventDefault();
      inputEl.value = '';
      inputEl.blur();
      inputContainer.style.display = 'none';
      suggestionsBox.style.display = 'none';
      isChatActive = false;
      Array.from(historyBox.children).forEach((child: any) => child.style.opacity = '0.3');
      setTimeout(() => { scene.input.keyboard!.enabled = true; }, 50);
    }
  });

  scene.input.keyboard?.on('keydown-ENTER', () => {
    if (!isChatActive) {
      isChatActive = true;
      inputContainer.style.display = 'block';
      inputEl.focus();

      Array.from(historyBox.children).forEach((child: any) => child.style.opacity = '1.0');

      scene.input.keyboard!.enabled = false;
    }
  });
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