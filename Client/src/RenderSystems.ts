import * as Phaser from 'phaser';
import { AudioManager } from './AudioManager';
import { world, type ActorComponent } from './ECS';

// Cache parsed hex-color strings -> number. Same strings repeat every single
// frame for every actor/skill/effect, so avoid re-running parseInt+replace each time.
const colorCache: Map<string, number> = new Map();
function parseColor(colorStr: any, fallback: number): number {
  if (colorStr === undefined || colorStr === null) return fallback;
  if (typeof colorStr === 'number') return colorStr;
  let cached = colorCache.get(colorStr);
  if (cached === undefined) {
    cached = parseInt(colorStr.replace(/^#|^0x/i, ''), 16);
    if (isNaN(cached)) cached = fallback;
    colorCache.set(colorStr, cached);
  }
  return cached;
}

export let globalUiGraphics: Phaser.GameObjects.Graphics | null = null;

// Name/Level for nameplates. Populated externally (main.ts, from the low-frequency
// "ReceiveRoster" broadcast) rather than the 20Hz per-tick actor payload — these barely ever
// change, so there's no reason to pay a per-tick cost reading/updating them.
export const playerRosterInfo: Map<string, { name: string; level: number }> = new Map();

// Phaser's container.getData()/setData() lazily allocates a DataManager (its own
// event-emitter + Map) the first time it's touched, and every get/set after that goes
// through that indirection. At 500+ actors doing ~10 getData calls each per frame, that's
// thousands of event-emitter-backed map lookups a frame for data that never needs to be
// observable - it's pure internal bookkeeping. Stashing a plain object directly on the
// container (a regular JS property) and reading/writing its fields is just a property
// access, and is dramatically cheaper at scale with identical lifetime/cleanup semantics
// (it dies with the container, same as setData did).
interface ActorRefs {
  bodySprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;
  hpText: Phaser.GameObjects.BitmapText;
  baseWidth: number;
  weaponsContainer: Phaser.GameObjects.Container;
  weaponSprites: Map<number, Phaser.GameObjects.Sprite>;
  castCircle: Phaser.GameObjects.Ellipse;
  wasDead: boolean;

  // Nameplate (players only — null for enemies, so enemies pay zero extra cost).
  nameText: Phaser.GameObjects.BitmapText | null;
  levelText: Phaser.GameObjects.BitmapText | null;
  nameShadow: Phaser.GameObjects.BitmapText | null;
  levelShadow: Phaser.GameObjects.BitmapText | null;
  lastRosterName: string;
  lastRosterLevel: number;

  // VFX State Trackers
  prevActionState: string | undefined;
  prevCastSkillId: string | undefined;
  prevHp: number | undefined;
  flashTimer: number;
  lastFxActionState: string;
  lastFxCastSkillId: string;
  lastFxEffectsKey: string;
  wasFlashing: boolean;

  // --- ADD THESE NEW STATE TRACKERS FOR HEALTH BARS ---
  currentHp: number;
  maxHp: number;
  currentShield: number;
  topY: number;
  bottomY: number;      // <--- NEW: For the Cast Bar
  actionState: string;
  isFriendly: boolean;
  isPlayer: boolean;
  currentCastTimer: number;
  maxCastTimer: number; // <--- NEW: For the Cast Bar
  showCastBar: boolean; // <--- NEW: For the Cast Bar
}

function getRefs(container: Phaser.GameObjects.Container): ActorRefs {
  return (container as any).__refs as ActorRefs;
}

export class ActorRenderer {
  static render(
    scene: Phaser.Scene,
    actorList: any[],
    sprites: Map<string, Phaser.GameObjects.Container>,
    configs: any,
    targets: Map<string, { x: number, y: number }>,
    isPlayer: boolean,
    enemyList?: any[],
    hpGraphics?: Phaser.GameObjects.Graphics // <--- ADD THIS HERE
  ): Set<string> {
    const activeIds = new Set<string>();

    // >>> OPTIMIZATION: Cache the current time once per frame instead of 3000+ times
    const currentTime = scene.time.now;



    // Grab camera bounds for culling (zoom-aware — cam.width is screen pixels and no
    // longer matches world-space width once the fair-view letterbox zoom is applied,
    // so derive the cull box from cam.worldView, same fix as smoothInterpolateSprites)
    const cam = scene.cameras.main;
    const view = cam.worldView;
    const viewLeft = view.x - 100;
    const viewRight = view.right + 100;
    const viewTop = view.y - 100;
    const viewBottom = view.bottom + 100;


    actorList.forEach((actor: any) => {
      // 1. Identify Identity & Configs
      const safeId = isPlayer ? (actor.connectionId || actor.ConnectionId) : (actor.id || actor.Id);
      activeIds.add(safeId);

      const targetX = actor.x ?? actor.X ?? 0;
      const targetY = actor.y ?? actor.Y ?? 0;

      let target = targets.get(safeId);
      if (!target) {
        target = { x: targetX, y: targetY };
        targets.set(safeId, target);
      } else {
        target.x = targetX;
        target.y = targetY;
      }

      let configId = actor.configId || actor.ConfigId;
      if (isPlayer && !configId) configId = "char_well_rounded";

      let config: any = null;
      if (isPlayer) {
        config = configs.characters ? (configs.characters[configId] || configs.Characters?.[configId]) : null;
      } else {
        config = configs.enemies ? (configs.enemies[configId] || configs.Enemies?.[configId]) : null;
      }

      const scale = config?.scale || 1.0;
      const isBoss = !isPlayer && config?.isBoss;

      // Variables specific to actor type
      const castColor = isPlayer ? 0x00ffff : 0xffa500;
      const uiWidth = isPlayer ? 32 : (isBoss ? 80 : 32);
      const isFriendly = isPlayer || (actor.team || actor.Team) === 'Player';
      const hpColor = isFriendly ? 0x00ff00 : 0xff0000;

      // --- ECS INGEST ---
      // Normalize this tick's network data into a real component ONCE,
      // instead of re-deriving `actor.x ?? actor.X` style fallbacks at every
      // read site below (this function used to do that ~15 times). Stored
      // in World even for off-screen/culled actors below, so the component
      // store stays authoritative regardless of render culling.
      const comp: ActorComponent = {
        isPlayer, configId, team: actor.team || actor.Team || '',
        x: targetX, y: targetY,
        velX: actor.velX ?? actor.VelX,
        actionState: actor.actionState || actor.ActionState || "Idle",
        currentHp: actor.currentHp ?? actor.CurrentHp ?? 0,
        maxHp: actor.maxHp ?? actor.MaxHp ?? 1,
        currentShield: actor.currentShield ?? actor.CurrentShield ?? 0,
        aimX: actor.aimX ?? actor.AimX,
        aimY: actor.aimY ?? actor.AimY,
        firedWeapons: actor.firedWeapons || actor.FiredWeapons || [],
        weapons: actor.weapons || actor.Weapons || [],
        currentCastingSkillId: actor.currentCastingSkillId || actor.CurrentCastingSkillId,
        currentCastTimer: actor.currentCastTimer || actor.CurrentCastTimer || 0,
        maxCastTimer: actor.maxCastTimer || actor.MaxCastTimer || 0,
        stats: actor.stats,
      };
      world.upsertActor(safeId, comp);

      // Read the custom offset from the server's handshake config
      const explicitOffset = config?.weaponOffset ?? config?.WeaponOffset;
      const weaponOffset = explicitOffset !== undefined && explicitOffset !== null
        ? (explicitOffset * scale)
        : (isPlayer ? (10 * scale) + 15 : (40 * scale) + 30);


      // 2. CREATE CONTAINER
      if (!sprites.has(safeId)) {
        const container = scene.add.container(targetX, targetY);

        const castCircle = scene.add.ellipse(0, isPlayer ? 16 : 0, 40, 15, castColor, 0.4);
        castCircle.setStrokeStyle(2, castColor, 1);
        castCircle.setVisible(false);

        let bodySprite;
        if (config && config.textureKey && scene.textures.exists(config.textureKey)) {
          bodySprite = scene.add.sprite(0, 0, config.textureKey);
          bodySprite.setScale(scale);
          if (config.animIdle && scene.anims.exists(`${config.id}_idle`)) bodySprite.play(`${config.id}_idle`);
          else if (config.iconFrame !== undefined) bodySprite.setFrame(config.iconFrame);
        } else {
          bodySprite = scene.add.rectangle(0, 0, 32, 32, 0x000000).setStrokeStyle(2, 0x00ff00) as any;
        }

        // >>> OPTIMIZATION: Force distinct Z-Depths to fix visibility
        const hpText = scene.add.bitmapText(0, 0, 'damageFont', '', 10)
          .setOrigin(0.5, 0.5)
          .setVisible(false)
          .setDepth(55); // Depth 55 ensures text is ALWAYS on top

        // Nameplate — players only. Enemies never get these extra GameObjects, so this adds
        // zero cost to the (much larger) enemy population. Each has a black shadow duplicate
        // added to the container BEFORE it (so it draws behind, via list order) — a cheap
        // "poor man's outline" that makes the text readable against any background. The shadow
        // only costs anything when the real text changes (same setText cadence), never per-frame.
        const nameShadow = isPlayer
          ? scene.add.bitmapText(0, 0, 'damageFont', '', 10).setOrigin(0.5, 0.5).setTint(0x000000).setAlpha(0.9).setDepth(56)
          : null;
        const nameText = isPlayer
          ? scene.add.bitmapText(0, 0, 'damageFont', '', 10).setOrigin(0.5, 0.5).setTint(0xffffff).setDepth(57)
          : null;
        const levelShadow = isPlayer
          ? scene.add.bitmapText(0, 0, 'damageFont', '', 10).setOrigin(1, 0.5).setTint(0x000000).setAlpha(0.9).setDepth(56)
          : null;
        const levelText = isPlayer
          ? scene.add.bitmapText(0, 0, 'damageFont', '', 10).setOrigin(1, 0.5).setTint(0xffd700).setDepth(57)
          : null;

        const weaponsContainer = scene.add.container(0, 0);

        const containerChildren: Phaser.GameObjects.GameObject[] = [castCircle, bodySprite, hpText, weaponsContainer];
        if (nameShadow) containerChildren.push(nameShadow);
        if (nameText) containerChildren.push(nameText);
        if (levelShadow) containerChildren.push(levelShadow);
        if (levelText) containerChildren.push(levelText);
        container.add(containerChildren);

        const refs: ActorRefs = {
          bodySprite, hpText, baseWidth: uiWidth, weaponsContainer,
          weaponSprites: new Map(), castCircle, wasDead: false,
          nameText, levelText, nameShadow, levelShadow, lastRosterName: '', lastRosterLevel: -1,
          prevActionState: undefined, prevCastSkillId: undefined, prevHp: undefined,
          flashTimer: 0, lastFxActionState: '', lastFxCastSkillId: '', lastFxEffectsKey: '', wasFlashing: false,

          // Add default values for the new fields here:
          currentHp: 0, maxHp: 1, currentShield: 0, topY: 0, bottomY: 0,
          actionState: "Idle", isFriendly: isFriendly, isPlayer: isPlayer,
          currentCastTimer: 0, // <--- 2. ADD THIS!
          maxCastTimer: 0, showCastBar: true
        };
        (container as any).__refs = refs;

        sprites.set(safeId, container);
      }

      // 3. UPDATE UI BARS (Network Tick Only)
      const container = sprites.get(safeId)!;
      const refs = getRefs(container);
      const body = refs.bodySprite as Phaser.GameObjects.Sprite;

      // Aggressive Camera Culling for the Network Tick (uses the zoom-aware bounds computed once above)
      const isVisible = targetX >= viewLeft && targetX <= viewRight && targetY >= viewTop && targetY <= viewBottom;

      if (!isVisible) {
        if (container.visible) container.setVisible(false);
        return;
      }

      if (!container.visible) container.setVisible(true);

      // >>> Pulled from the component built at ingest above — no more
      // re-deriving camelCase/PascalCase fallbacks here. <
      const actionState = comp.actionState;
      const currentHp = comp.currentHp;
      const maxHp = comp.maxHp;
      const currentShield = comp.currentShield;
      const currentCastTimer = comp.currentCastTimer;
      const maxCastTimer = comp.maxCastTimer;

      // >>> NEW: Dynamic Visual Height Calculation <
      const visualHeight = config?.visualHeight ?? config?.VisualHeight ?? 32;
      let realHeight = visualHeight * scale;

      let topY = -(realHeight / 2) - 6;
      let bottomY = (realHeight / 2);

      // 0. UPDATE NAMEPLATE (players only). Position is cheap (plain number assignment) so it
      // tracks the bar every network tick. Text content comes from playerRosterInfo — populated
      // separately, at most once a second — and setText() only fires when that cached value
      // actually differs from what's currently drawn, since BitmapText re-layout isn't free at
      // 20 calls/sec × N players. In practice this means setText() runs once per player (on
      // join) and then again only on the rare level-up. Shadows always mirror the real text's
      // content on the same guard, so they never fall out of sync.
      if (isPlayer && refs.nameText && refs.levelText) {
        const isDead = actionState === "Dead";
        if (!isDead) {
          const roster = playerRosterInfo.get(safeId);
          const rosterName = roster?.name ?? '';
          const rosterLevel = roster?.level ?? 1;

          if (rosterName !== refs.lastRosterName) {
            refs.nameText.setText(rosterName);
            refs.nameShadow?.setText(rosterName);
            refs.lastRosterName = rosterName;
          }
          if (rosterLevel !== refs.lastRosterLevel) {
            const levelStr = `Lv.${rosterLevel}`;
            refs.levelText.setText(levelStr);
            refs.levelShadow?.setText(levelStr);
            refs.lastRosterLevel = rosterLevel;
          }

          // Name sits centered, tight above the bar. Level sits BELOW the name and to the
          // LEFT — its own row, between the name and the bar top, not sharing the name's row.
          const nameRowY = topY - 16;
          const levelRowY = topY - 6;
          const levelX = -(uiWidth / 2) - 4;

          refs.nameText.x = 0;
          refs.nameText.y = nameRowY;
          refs.levelText.x = levelX;
          refs.levelText.y = levelRowY;

          if (refs.nameShadow) { refs.nameShadow.x = 1; refs.nameShadow.y = nameRowY + 1; }
          if (refs.levelShadow) { refs.levelShadow.x = levelX + 1; refs.levelShadow.y = levelRowY + 1; }

          if (!refs.nameText.visible) refs.nameText.setVisible(true);
          if (!refs.levelText.visible) refs.levelText.setVisible(true);
          if (refs.nameShadow && !refs.nameShadow.visible) refs.nameShadow.setVisible(true);
          if (refs.levelShadow && !refs.levelShadow.visible) refs.levelShadow.setVisible(true);
        } else {
          if (refs.nameText.visible) refs.nameText.setVisible(false);
          if (refs.levelText.visible) refs.levelText.setVisible(false);
          if (refs.nameShadow?.visible) refs.nameShadow.setVisible(false);
          if (refs.levelShadow?.visible) refs.levelShadow.setVisible(false);
        }
      }

      // 1. UPDATE HEALTH TEXT (Toggled by 'u')
      const hpText = refs.hpText;
      if (hpText) {
        const shouldShow = scene.data.get('showHealthNumbers') === true && actionState !== "Dead";
        if (shouldShow) {
          hpText.y = topY - 12;
          const newHpString = currentShield > 0
            ? `${Math.round(currentHp)} (+${Math.round(currentShield)}) / ${Math.round(maxHp)}`
            : `${Math.round(currentHp)} / ${Math.round(maxHp)}`;

          if (hpText.text !== newHpString) hpText.setText(newHpString);
          if (!hpText.visible) hpText.setVisible(true);
        } else if (hpText.visible) {
          hpText.setVisible(false);
        }
      }

      // 2. EXTRACT CAST BAR LOGIC
      const castingSkillId = comp.currentCastingSkillId;
      const skillCfg = castingSkillId ? ((configs.skills || configs.Skills)?.[castingSkillId]) : null;
      const showCastBar = skillCfg ? (skillCfg.showCastBar !== false && skillCfg.ShowCastBar !== false) : true;

      // 3. SAVE ALL DATA FOR MAIN.TS TO DRAW AT 60FPS
      refs.currentHp = currentHp;
      refs.maxHp = maxHp;
      refs.currentShield = currentShield;
      refs.topY = topY;
      refs.bottomY = bottomY;
      refs.actionState = actionState;
      refs.isFriendly = isFriendly;
      refs.isPlayer = isPlayer;
      refs.currentCastTimer = currentCastTimer; // <--- 3. ADD THIS!
      refs.maxCastTimer = maxCastTimer;
      refs.showCastBar = showCastBar;

      // 4. WEAPONS
      const weaponsContainer = refs.weaponsContainer;
      const activeWeaponSlots = new Set<number>();
      const weaponsList = comp.weapons;

      // --- NEW: Generate a 4-Pointed Magical Star Texture ---
      if (!scene.textures.exists('fx_spark')) {
        const g = scene.add.graphics();
        g.fillStyle(0xffffff, 1);

        // Draw a star shape (16x16 size)
        g.beginPath();
        g.moveTo(8, 0);   // Top point
        g.lineTo(9.5, 6.5); // Inner Top-Right
        g.lineTo(16, 8);  // Right point
        g.lineTo(9.5, 9.5); // Inner Bottom-Right
        g.lineTo(8, 16);  // Bottom point
        g.lineTo(6.5, 9.5); // Inner Bottom-Left
        g.lineTo(0, 8);   // Left point
        g.lineTo(6.5, 6.5); // Inner Top-Left
        g.closePath();
        g.fillPath();

        g.generateTexture('fx_spark', 16, 16);
        g.destroy();
      }
      weaponsList.forEach((w: any) => {
        const slotIndex = w.slotIndex ?? w.SlotIndex;
        const wConfigId = w.configId || w.ConfigId;
        const level = w.level ?? w.Level ?? 1; // <--- EXTRACT WEAPON LEVEL
        activeWeaponSlots.add(slotIndex);

        let wx = 0, wy = 0;
        if (slotIndex === 0) { wx = weaponOffset; wy = 0; }
        else if (slotIndex === 1) { wx = -weaponOffset; wy = 0; }
        else if (slotIndex === 2) { wx = 0; wy = -weaponOffset; }
        else if (slotIndex === 3) { wx = 0; wy = weaponOffset; }

        const wConfig = configs.weapons ? (configs.weapons[wConfigId] || configs.Weapons?.[wConfigId]) : null;
        let sprite = refs.weaponSprites.get(slotIndex);

        if (!sprite && wConfig && wConfig.textureKey && scene.textures.exists(wConfig.textureKey)) {
          sprite = scene.add.sprite(wx, wy, wConfig.textureKey);
          if (wConfig.iconFrame !== undefined) sprite.setFrame(wConfig.iconFrame);
          sprite.setScale(wConfig.scale || 1.0);
          if (wConfig.defaultFacingRight === false) sprite.setFlipX(true);
          weaponsContainer.add(sprite);
          refs.weaponSprites.set(slotIndex, sprite);
        }

        if (sprite && wConfig) {

          // =======================================================
          // >>> NEW: WEAPON ENHANCEMENT VFX (Runes of Magic Style)
          // =======================================================
          const currentVfxLevel = (sprite as any).__vfxLevel;
          if (currentVfxLevel !== level) {
            (sprite as any).__vfxLevel = level;

            // 1. Clean up old FX if level changed
            if ((sprite as any).__aura) {
              (sprite as any).__aura.destroy();
              (sprite as any).__aura = null;
            }
            if ((sprite as any).__emitter) {
              (sprite as any).__emitter.destroy();
              (sprite as any).__emitter = null;
            }

            const wScale = wConfig.scale || 1.0;

            // 2. Apply Custom Sprite Aura (Level 7+)
            // PostFX glow looks blocky on scaled pixel art, so we use a blended duplicate sprite!
            if (level >= 7) {
              const aura = scene.add.sprite(wx, wy, wConfig.textureKey);
              if (wConfig.iconFrame !== undefined) aura.setFrame(wConfig.iconFrame);

              aura.setBlendMode(Phaser.BlendModes.ADD); // Makes it glow like light
              aura.setAlpha(0.6);
              aura.setTint(level >= 9 ? 0xff4400 : 0x00ffff); // Mythic Fiery Red vs Epic Cyan

              weaponsContainer.addAt(aura, 0); // Put it perfectly behind the weapon
              (sprite as any).__aura = aura;
            }

            // 3. Apply Particle Sparks (Level 3+)
            if (level >= 3) {
              const isLvl5 = level >= 5;

              const emitter = scene.add.particles(0, 0, 'fx_spark', {
                // REMOVED wScale: Fixed spawn box so it always spawns nicely around the weapon
                x: { min: -25, max: 25 },
                y: { min: -35, max: 25 },

                // SLOW MOTION MOVEMENT
                speed: { min: 5, max: 15 },
                angle: { min: -180, max: 180 },

                // REMOVED wScale: Stars are always a visible, consistent size now
                scale: { start: 0.8, end: 0 },
                alpha: { start: 1, end: 0 },

                lifespan: { min: 1200, max: 2500 },
                tint: [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xffffff],
                frequency: isLvl5 ? 400 : 800,
                blendMode: 'ADD'
              });

              // >>> FIX: Force the particles to render ABOVE the weapon sprite
              emitter.setDepth(10);

              weaponsContainer.add(emitter);
              emitter.startFollow(sprite);
              (sprite as any).__emitter = emitter;
            }
          }

          // >>> UPDATE AURA POSITION & ANIMATION EVERY FRAME <
          if ((sprite as any).__aura) {
            const aura = (sprite as any).__aura;
            aura.x = sprite.x;
            aura.y = sprite.y;
            aura.rotation = sprite.rotation;
            aura.setFlipY(sprite.flipY);
            aura.setFlipX(sprite.flipX);

            // Make the aura pulse slightly so it feels magical
            const pulseScale = (wConfig.scale || 1.0) * (1.15 + Math.sin(scene.time.now / 150) * 0.08);
            aura.setScale(pulseScale);
          }
          // =======================================================

          // Default to player aim (mouse pointer)
          let aimX = comp.aimX ?? targetX;
          let aimY = comp.aimY ?? targetY;

          // >>> SYNC FIX: Check if the weapon is firing THIS EXACT FRAME before calculating aim
          const firedList = comp.firedWeapons;
          const isFiringThisFrame = firedList.includes(slotIndex);

          // ✅ AutoShot Visual Rotation Tracking
          const isAutoShot = wConfig.autoShot === true || wConfig.AutoShot === true;
          if (isPlayer && isAutoShot && enemyList && enemyList.length > 0) {

            const frameCount = scene.game.loop.frame;
            const throttleOffset = slotIndex;

            if (!sprite.data) sprite.setDataEnabled();

            // >>> FPS & SYNC FIX: Use 5-frame throttle for idle aiming, but FORCE instant recalculation if firing! <
            if (isFiringThisFrame || (frameCount + throttleOffset) % 5 === 0 || !sprite.getData('cachedAimX')) {
              const baseRange = wConfig.range ?? wConfig.Range ?? 300;
              const latestStats = scene.data.get('latestPlayerStats');
              const rangeBonus = latestStats?.range ?? 0;
              const finalRange = baseRange + rangeBonus;
              const rangeSq = finalRange * finalRange;

              const weaponWorldX = targetX + wx;
              const weaponWorldY = targetY + wy;

              let bestInRangeDistSq = rangeSq;
              let bestInRangeX = 0, bestInRangeY = 0, foundInRange = false;

              let bestAnyDistSq = Number.MAX_VALUE;
              let bestAnyX = 0, bestAnyY = 0, foundAny = false;

              // We expand the cull box to ~1200 pixels (roughly screen size).
              // This allows weapons to track incoming enemies smoothly before they get in range,
              // while still saving CPU by skipping the 2000+ enemies way off the map.
              const searchRadius = Math.max(finalRange, 1200);

              for (let ei = 0; ei < enemyList.length; ei++) {
                const enemy = enemyList[ei];

                // Skip dead enemies
                const eState = enemy.actionState || enemy.ActionState || "Idle";
                if (eState === "Dead") continue;

                // Skip friendly targets
                const eTeam = enemy.team || enemy.Team || "Enemy";
                if (eTeam !== "Enemy") continue;

                const ex = enemy.x ?? enemy.X ?? 0;
                const dx = ex - weaponWorldX;
                if (Math.abs(dx) > searchRadius) continue; // Fast horizontal cull

                const ey = enemy.y ?? enemy.Y ?? 0;
                const dy = ey - weaponWorldY;
                if (Math.abs(dy) > searchRadius) continue; // Fast vertical cull

                const distSq = dx * dx + dy * dy;

                if (distSq <= rangeSq) {
                  if (distSq < bestInRangeDistSq) {
                    bestInRangeDistSq = distSq;
                    bestInRangeX = ex; bestInRangeY = ey;
                    foundInRange = true;
                  }
                }

                if (distSq < bestAnyDistSq) {
                  bestAnyDistSq = distSq;
                  bestAnyX = ex; bestAnyY = ey;
                  foundAny = true;
                }
              }

              if (foundInRange) {
                sprite.setData('cachedAimX', bestInRangeX);
                sprite.setData('cachedAimY', bestInRangeY);
              } else if (foundAny) {
                sprite.setData('cachedAimX', bestAnyX);
                sprite.setData('cachedAimY', bestAnyY);
              } else {
                // >>> THE JITTER FIX <
                // Don't set the aim to the player's exact center (targetX/Y). 
                // Because of the 5-frame throttle, as the player walks away from that cached coordinate,
                // the math calculates a negative angle and flips the weapon backward!
                // Fallback to the player's actual mouse/joystick aim.
                const fallbackAimX = comp.aimX ?? (targetX + 100);
                const fallbackAimY = comp.aimY ?? targetY;
                sprite.setData('cachedAimX', fallbackAimX);
                sprite.setData('cachedAimY', fallbackAimY);
              }
            }

            // Read from the throttled cache
            aimX = sprite.getData('cachedAimX');
            aimY = sprite.getData('cachedAimY');
          }

          const angle = Math.atan2(aimY - targetY, aimX - targetX);
          sprite.rotation = angle;
          sprite.setFlipY(Math.abs(angle) > Math.PI / 2);

          // >>> FPS FIX 4: Avoid O(N) Scene Tween Lookups (Updated to use our isFiringThisFrame boolean) <
          if (isFiringThisFrame && !(sprite as any).__isAnimatingAttack) {
            (sprite as any).__isAnimatingAttack = true;
            const animType = wConfig.attackAnimType || 'recoil';

            const cleanupTween = () => { (sprite as any).__isAnimatingAttack = false; };

            if (animType === 'stab') {
              scene.tweens.add({ targets: sprite, x: wx + Math.cos(angle) * 20, y: wy + Math.sin(angle) * 20, yoyo: true, duration: 100, ease: 'Power2', onComplete: cleanupTween });
            } else if (animType === 'recoil') {
              scene.tweens.add({ targets: sprite, x: wx + Math.cos(angle) * -15, y: wy + Math.sin(angle) * -15, yoyo: true, duration: 80, ease: 'Cubic.easeOut', onComplete: cleanupTween });
            } else if (animType === 'swing') {
              scene.tweens.add({ targets: sprite, angle: sprite.angle + 360, duration: 150, ease: 'Linear', onComplete: cleanupTween });
            } else {
              cleanupTween();
            }
            if (isPlayer && wConfig.soundFire) AudioManager.getInstance().playSfx(wConfig.soundFire);
          }

          if (!(sprite as any).__isAnimatingAttack) { sprite.x = wx; sprite.y = wy; }
        }
      });

      // Remove sprites & VFX for slots that are no longer active
      if (refs.weaponSprites.size > 0) {
        refs.weaponSprites.forEach((child, slot) => {
          if (!activeWeaponSlots.has(slot)) {
            // ---> NEW: Destroy Emitter and Aura if weapon is recycled/dropped
            if ((child as any).__emitter) {
              (child as any).__emitter.destroy();
            }
            if ((child as any).__aura) {
              (child as any).__aura.destroy();
            }
            child.destroy();
            refs.weaponSprites.delete(slot);
          }
        });
      }

      // 5. ENEMY DEATH SKILL VISUALIZER (Only runs for enemies)
      if (!isPlayer) {
        if (actionState === 'Dead' && !refs.wasDead) {
          refs.wasDead = true;
          const deathSkills = config?.onDeathSkills || config?.OnDeathSkills;

          if (deathSkills && deathSkills.length > 0) {
            deathSkills.forEach((skillId: string) => {
              const skill = (configs.skills || configs.Skills)?.[skillId];
              if (!skill) return;
              const aType = skill.actionType || skill.ActionType;

              if (aType === 'AoE' || aType === 1) {
                const r = skill.radius || skill.Radius || 200;
                let color = 0xff4444;
                const tint = skill.colorTint || skill.ColorTint;
                if (tint) {
                  const parsed = parseInt(tint.replace(/^#|^0x/i, ''), 16);
                  if (!isNaN(parsed)) color = parsed;
                }
                const ring = scene.add.circle(targetX, targetY, r, color, 0.7)
                  .setStrokeStyle(8, color, 1).setDepth(15).setScale(0.1);

                scene.tweens.add({
                  targets: ring, scale: 1.0, alpha: 0, duration: 800,
                  ease: 'Cubic.easeOut', onComplete: () => ring.destroy()
                });
              }
            });
          }
        }
      }

      // 6. ANIMATIONS & TINTING
      if (body && body.type === 'Sprite' && config) {
        body.setScale(scale);

        const distToTarget = Math.abs(targetX - container.x) + Math.abs(targetY - container.y);
        const isMoving = distToTarget > 1.0;

        const castingSkillId = comp.currentCastingSkillId;
        const skillCfg = castingSkillId ? ((configs.skills || configs.Skills)?.[castingSkillId]) : null;
        const stopMoving = skillCfg?.stopMoving === true || skillCfg?.StopMoving === true;
        const isObstacle = !isPlayer && (config.baseStats?.movementSpeed === 0 || config.BaseStats?.movementSpeed === 0);

        // Check if they have weapons equipped
        const weaponsList = comp.weapons;
        const hasWeapons = weaponsList.length > 0;

        const meleeAimX = comp.aimX ?? container.x;
        const meleeAimY = comp.aimY ?? container.y;
        const distToAim = Math.sqrt(Math.pow(meleeAimX - container.x, 2) + Math.pow(meleeAimY - container.y, 2));
        const attackRadius = config.attackRadius ?? config.AttackRadius ?? 40;
        const inMeleeRange = distToAim <= (attackRadius + 15);

        let targetAnim = `${config.id}_idle`;

        // 1. Determine if they are physically allowed to move
        const isActuallyMoving = isMoving && !stopMoving && !isObstacle;

        // >>> THE GLITCH FIX: Check if an attack animation is physically playing right now! <
        const isCurrentlyAttacking = body.anims?.currentAnim?.key?.endsWith('_attack') && body.anims?.isPlaying;

        if (actionState === "Dead" && config.animDeath) {
          targetAnim = `${config.id}_death`;
        } else if (!hasWeapons && config.animAttack && (actionState === "Attacking" || (actionState === "Casting" && inMeleeRange && !stopMoving))) {
          // 2. Force attack if Server says Attacking OR they are doing a mobile cast right in your face
          targetAnim = `${config.id}_attack`;
        } else if (isCurrentlyAttacking) {
          // 3. If they are already in the middle of swinging, LET IT FINISH!
          // >>> TS FIX: Added optional chaining and a fallback! <
          targetAnim = body.anims?.currentAnim?.key ?? `${config.id}_attack`;
        } else if (isActuallyMoving && config.animMove) {
          // 4. Move: They are moving
          targetAnim = `${config.id}_move`;
        } else if (config.animIdle) {
          // 5. Idle: Stopped for ANY reason
          targetAnim = `${config.id}_idle`;
        }

        const isCorrectAnim = body.anims?.currentAnim?.key === targetAnim;

        // Only restart if the attack finishes naturally
        const isFinishedAttacking = body.anims && !body.anims.isPlaying && targetAnim.endsWith('_attack');

        if (targetAnim !== '' && (!isCorrectAnim || isFinishedAttacking)) {
          body.play(targetAnim);
        }

        // >>> NEW: DYNAMIC ANIMATION SPEED SCALING <
        if (actionState === "Attacking") {
          // Check if there is an attackSpeedPercent stat coming from the server
          const atkSpeedPct = comp.stats?.attackSpeedPercent ?? 0;
          body.anims.timeScale = 1 + atkSpeedPct; // Speds up the animation dynamically!
        } else {
          // Reset to normal speed for walking/idle
          body.anims.timeScale = 1;
        }

        const isDefaultRight = config.defaultFacingRight !== false;
        const aimX = comp.aimX;
        const velX = comp.velX ?? (targetX - container.x);

        let faceRight = isDefaultRight;
        if (isPlayer) {
          if (aimX !== undefined && Math.abs(aimX - targetX) > 1) faceRight = aimX > targetX;
          else {
            if (velX > 0.5) faceRight = true;
            else if (velX < -0.5) faceRight = false;
          }
        } else {
          faceRight = velX > 0.1;
          const faceLeft = velX < -0.1;
          if ((actionState === "Attacking" || actionState === "Casting") && aimX !== undefined) {
            faceRight = aimX > targetX + 1;
          }
          if (faceRight) body.setFlipX(!isDefaultRight);
          else if (faceLeft || (aimX !== undefined && aimX < targetX - 1)) body.setFlipX(isDefaultRight);
        }

        if (isPlayer) {
          if (faceRight) body.setFlipX(!isDefaultRight);
          else body.setFlipX(isDefaultRight);
        }

        if (!body.anims?.isPlaying && actionState !== "Dead" && targetAnim !== '') body.anims?.resume();

        const prevActionState = refs.prevActionState;
        const prevCastSkillId = refs.prevCastSkillId;

        if (prevActionState === 'Casting' && actionState !== 'Casting' && prevCastSkillId) {
          const sCfg = (configs.skills || configs.Skills)?.[prevCastSkillId];
          if (sCfg?.soundCast) AudioManager.getInstance().playSfx(sCfg.soundCast);
        }

        refs.prevActionState = actionState;
        if (actionState === 'Casting' && castingSkillId) refs.prevCastSkillId = castingSkillId;

        const prevHp = refs.prevHp;
        if (prevHp !== undefined && currentHp < prevHp) {
          refs.flashTimer = currentTime + 150; // <--- Make sure this also uses currentTime!
          AudioManager.getInstance().playLastProjectileHitSound();
        }
        refs.prevHp = currentHp;

        // >>> Pass currentTime at the very end of this function call <
        applyVisualFX(scene, container, refs, body as Phaser.GameObjects.Sprite, actor, configs, topY, bottomY, realHeight, currentTime);
      }
    });

    return activeIds;
  }
}

// =========================================================================
// WORLD RENDERER & VISUAL FX (Unchanged/Slightly Cleaned)
// =========================================================================

export class WorldRenderer {
  static render(scene: Phaser.Scene, state: any, projectiles: Map<string, any>, pickups: Map<string, any>, configs: any, targets: Map<string, { x: number, y: number }>): { activeProjectiles: Set<string>, activePickups: Set<string> } {
    const activeProjectiles = new Set<string>();
    const activePickups = new Set<string>();

    // NOTE: state.projectiles is always [] today — the real projectile
    // system lives in main.ts (network ingest + a per-frame orbital/linear
    // movement loop in update(), not this network-tick renderer). This
    // branch is dead code in the current build; left untouched here and
    // slated for removal/replacement when projectiles move into World
    // (Phase 3), so this diff stays scoped to pickups only.
    const projList = state.projectiles || state.Projectiles || [];
    projList.forEach((proj: any) => {
      const safeId = proj.id || proj.Id;
      activeProjectiles.add(safeId);
      targets.set(safeId, { x: proj.x ?? proj.X, y: proj.y ?? proj.Y });

      let sprite = projectiles.get(safeId) as Phaser.GameObjects.Sprite;
      const configId = proj.configId || proj.ConfigId;
      const pConfig = configs.projectiles ? (configs.projectiles[configId] || configs.Projectiles?.[configId]) : null;

      if (!sprite) {
        if (pConfig && pConfig.textureKey && scene.textures.exists(pConfig.textureKey)) {
          sprite = scene.add.sprite(proj.x ?? proj.X, proj.y ?? proj.Y, pConfig.textureKey);
          if (pConfig.animFly) sprite.play(`${pConfig.id}_fly`);
          else if (pConfig.iconFrame !== undefined) sprite.setFrame(pConfig.iconFrame);
          sprite.setScale(pConfig.scale || 1.0);
        } else {
          sprite = scene.add.rectangle(proj.x ?? proj.X, proj.y ?? proj.Y, 10, 10, 0x000000).setStrokeStyle(2, 0x00ff00) as any;
        }
        sprite.setDepth(10);
        (sprite as any).setData('configId', configId);
        projectiles.set(safeId, sprite as any);
      }

      if (sprite.type === 'Sprite') {
        const target = targets.get(safeId);
        const velX = proj.velX ?? proj.VelX ?? 0;
        const velY = proj.velY ?? proj.VelY ?? 0;
        if (target && (velX !== 0 || velY !== 0)) {
          sprite.rotation = Math.atan2(velY, velX);
        }
      }
    });

    // Pickups are sourced directly from World — populated once per network
    // tick by the ingest code in main.ts, read here without the
    // intermediate `Array.from(pickupCache.values())` rebuild this used to
    // require. Pickups never move once spawned, so this loop only ever
    // needs to CREATE a sprite the first time it sees an id; everything
    // else about a pickup is immutable after spawn.
    world.pickups.forEach((pickup, safeId) => {
      activePickups.add(safeId);

      // >>> NEW: Feed the live X/Y to the interpolation engine! <<<
      targets.set(safeId, { x: pickup.x, y: pickup.y });

      if (!pickups.has(safeId)) {
        const pType = pickup.type;
        const gearConfigId = pickup.gearConfigId;

        let sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;

        if (pType === 1 && gearConfigId) {
          const wConfig = configs.weapons ? (configs.weapons[gearConfigId] || configs.Weapons?.[gearConfigId]) : null;
          if (wConfig && wConfig.textureKey && scene.textures.exists(wConfig.textureKey)) {
            sprite = scene.add.sprite(pickup.x, pickup.y, wConfig.textureKey);
            if (wConfig.iconFrame !== undefined) (sprite as Phaser.GameObjects.Sprite).setFrame(wConfig.iconFrame);
            sprite.setScale(wConfig.scale || 1.0);
          } else {
            sprite = scene.add.rectangle(pickup.x, pickup.y, 14, 14, 0xffaa00).setStrokeStyle(2, 0xffffff) as any;
          }
        } else if (pType === 2 && gearConfigId) {
          const iConfig = configs.items ? (configs.items[gearConfigId] || configs.Items?.[gearConfigId]) : null;
          if (iConfig && iConfig.textureKey && scene.textures.exists(iConfig.textureKey)) {
            sprite = scene.add.sprite(pickup.x, pickup.y, iConfig.textureKey);
            if (iConfig.iconFrame !== undefined) (sprite as Phaser.GameObjects.Sprite).setFrame(iConfig.iconFrame);
            sprite.setScale(iConfig.scale || 1.0);
          } else {
            sprite = scene.add.rectangle(pickup.x, pickup.y, 14, 14, 0x00aaff).setStrokeStyle(2, 0xffffff) as any;
          }
        } else {
          // --- DROPPED GOLD ---
          if (scene.textures.exists('tex_gold')) {
            const goldSprite = scene.add.sprite(pickup.x, pickup.y, 'tex_gold');
            goldSprite.setScale(1.5); // Adjust scale to your preference

            // Play the spinning animation!
            if (scene.anims.exists('gold_spin')) {
              goldSprite.play('gold_spin');
            }
            sprite = goldSprite;
          } else {
            sprite = scene.add.rectangle(pickup.x, pickup.y, 12, 12, 0xffd700).setStrokeStyle(2, 0xffaa00) as any;
          }
        }

        (sprite as any).setDepth(5);

        // --- SLOW MOTION HOVER ANIMATION ---
        const hoverTween = scene.tweens.add({
          targets: sprite,
          y: pickup.y - 12,                         // Float up 12 pixels
          duration: 1500 + Math.random() * 500,     // 1.5s to 2.0s per float
          ease: 'Sine.easeInOut',                   // Smooth slow-mo easing at top/bottom
          yoyo: true,                               // Go back down automatically
          repeat: -1,                               // Loop infinitely
          delay: Math.random() * 500                // Desync so they don't all bob at the exact same time
        });

        // >>> NEW: Store the tween so we can kill it if the gold starts flying! <<<
        (sprite as any).__hoverTween = hoverTween;

        pickups.set(safeId, sprite as any);
      } else {
        // >>> NEW: Stop bobbing if the vacuum sucked it up! <<<
        const sprite = pickups.get(safeId);
        if (sprite && (pickup as any).isMoving && (sprite as any).__hoverTween) {
          (sprite as any).__hoverTween.stop();
          (sprite as any).__hoverTween = null;
        }
      }
    });

    const dmgList = state.damageEvents || state.DamageEvents || [];

    // >>> NEW: Initialize the Particle Pool once per scene <
    let particlePool = scene.data.get('hitParticlePool');
    if (!particlePool) {
      particlePool = scene.add.group({
        classType: Phaser.GameObjects.Sprite,
        maxSize: 300, // Maximum particles on screen at once
        runChildUpdate: false
      });
      scene.data.set('hitParticlePool', particlePool);
    }
    // Safety valve: a single network tick during a big fight can carry far more damage
    // events than a player can usefully read as floating numbers anyway. Each one creates
    // a Text object (one of Phaser's most expensive single calls - canvas rasterize +
    // texture upload) plus particle Rectangles and several tweens. Capping how many get a
    // floating number prevents a spike (e.g. 150 simultaneous hits) from creating 150 Text
    // objects in one frame. The cap is set well above normal combat volume, so ordinary
    // fights are completely unaffected - this only engages during genuine overload.
    const MAX_FLOATING_NUMBERS_PER_TICK = 40;
    let floatingNumbersThisTick = 0;
    const MAX_PARTICLE_BURSTS_PER_TICK = 40;
    let particleBurstsThisTick = 0;
    dmgList.forEach((de: any) => {
      const startX = (de.x || de.X) + Phaser.Math.Between(-10, 10);
      const startY = (de.y || de.Y) - 16 + Phaser.Math.Between(-10, 10);
      const amt = de.amount ?? de.Amount ?? 0;
      const isHeal = amt < 0;
      const isCrit = de.isCritical ?? false;
      const isDodge = de.isDodge ?? false;
      const isBlock = de.isBlock ?? false;


      // ====================================================================
      // >>> REVISED: CHUNKY PARTICLES & GENTLE CAMERA BUMP <
      // ====================================================================
      if (!isDodge && !isBlock && !isHeal) {

        const playerList = state.players || state.Players || [];
        const enemyList = state.enemies || state.Enemies || [];

        // >>> THE FIX: CHECK IF THE HIT TARGET IS FRIENDLY <
        let isFriendlyHit = false;

        // 1. Check if hit is near a player
        for (let pi = 0; pi < playerList.length; pi++) {
          const p = playerList[pi];
          const px = p.x ?? p.X;
          const py = p.y ?? p.Y;
          if ((px - startX) * (px - startX) + (py - startY) * (py - startY) < 1600) {
            isFriendlyHit = true;
            break;
          }
        }

        // 2. Single pass over enemies: check for a nearby friendly summon (for the
        // friendly-hit flag) AND track the closest enemy's blood color (for particles),
        // since both previously scanned the same enemyList separately.
        let hitColor = 0xff0000; // Default Red
        let closestDistSq = 999999;

        if (!isFriendlyHit) {
          for (let ei = 0; ei < enemyList.length; ei++) {
            const e = enemyList[ei];
            const team = e.team ?? e.Team ?? "Enemy";
            const ex = e.x ?? e.X ?? 0;
            const ey = e.y ?? e.Y ?? 0;
            const distSq = (ex - startX) * (ex - startX) + (ey - startY) * (ey - startY);

            if (team !== "Enemy" && distSq < 1600) {
              isFriendlyHit = true;
              // Don't break: still need closest-enemy blood color below for symmetry
              // with prior behavior (the original ran both scans unconditionally).
            }
            if (distSq < closestDistSq && distSq < 10000) {
              closestDistSq = distSq;
              const eCfg = configs.enemies?.[e.configId || e.ConfigId] || configs.Enemies?.[e.configId || e.ConfigId];
              if (eCfg && eCfg.calculatedBloodColor !== undefined) {
                hitColor = eCfg.calculatedBloodColor;
              }
            }
          }
        }

        // 1. GENTLE CAMERA BUMP (CRITS ONLY)
        if (isCrit && Math.random() < 0.5) {
          const cam = scene.cameras.main;
          if (!scene.tweens.isTweening(cam)) {
            scene.tweens.add({
              targets: cam,
              zoom: cam.zoom * 1.002,
              rotation: (Math.random() - 0.5) * 0.005,
              duration: 50,
              yoyo: true,
              ease: 'Sine.easeInOut'
            });
          }
        }


        // 2. CHUNKY BROTATO PARTICLES 
        // >>> We now skip this entirely if isFriendlyHit is true! <
        // Same safety-valve reasoning as the floating-number cap below: a crit-heavy
        // spike bypasses the 35% random skip (crits always spawn particles), and each
        // burst is up to 8 Rectangle+tween pairs, so an uncapped pile of simultaneous
        // crits could spawn hundreds of objects in one tick.
        // 2. CHUNKY BROTATO PARTICLES (Now using Object Pooling + White Pixel)
        if (!isFriendlyHit && (Math.random() < 0.35 || isCrit) && particleBurstsThisTick < MAX_PARTICLE_BURSTS_PER_TICK) {
          particleBurstsThisTick++;
          const numParticles = isCrit ? 8 : 4;

          for (let i = 0; i < numParticles; i++) {
            // GET a particle from the pool
            const p = particlePool.get(startX, startY, 'white_pixel') as Phaser.GameObjects.Sprite;

            if (!p) continue; // If we hit the 300 cap, just skip spawning this particle

            // WAKE IT UP and reset its properties
            const pSize = Phaser.Math.Between(20, 32);
            p.setActive(true).setVisible(true);
            p.setPosition(startX, startY);
            p.setDisplaySize(pSize, pSize); p.setTint(hitColor);
            p.setDepth(19);
            p.setScale(1); // Reset scale in case a previous tween shrunk it
            p.setAlpha(1);

            // >>> THE FIX: Parse the string into a strict Number, and use setTintFill <
            const finalColor = parseColor(hitColor, 0xff0000);
            p.setTintFill(finalColor);

            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 120 + 60;

            scene.tweens.add({
              targets: p,
              x: startX + Math.cos(angle) * speed,
              y: startY + Math.sin(angle) * speed,
              scale: 0,
              alpha: 1,
              duration: Math.random() * 300 + 200,
              ease: 'Cubic.easeOut',
              onComplete: () => {
                // PUT IT TO SLEEP instead of p.destroy()
                p.setActive(false).setVisible(false);
              }
            });
          }
        }
      }
      // ====================================================================
      // ====================================================================

      // Cap applies only to the floating number itself - particles and camera bump above
      // already ran for this event. Once the cap is hit, the hit still happened, it just
      // doesn't get a popping number on screen (extremely unlikely to be noticed when it
      // only kicks in at 40+ simultaneous hits in one tick).
      if (floatingNumbersThisTick >= MAX_FLOATING_NUMBERS_PER_TICK) return;
      floatingNumbersThisTick++;

      // >>> FIX: Use raw Hex numbers for WebGL Tinting instead of CSS strings
      let tintColor = 0xffffff; // Default White
      let textStr = Math.round(Math.abs(amt)).toString();
      let finalScale = 0.5;

      // >>> DODGE & BLOCK VISUALS <
      if (isDodge) {
        tintColor = 0x00e5ff; // Cyan
        textStr = 'DODGE';
        finalScale = 0.6;
      } else if (isBlock) {
        tintColor = 0xb0bec5; // Silver/Gray
        textStr = 'BLOCK';
        finalScale = 0.6;
      } else if (isHeal) {
        tintColor = 0x00ff00; // Green
        textStr = `+${textStr}`;
      } else if (isCrit) {
        tintColor = 0xffeb3b; // Yellow
        textStr = `💥 ${textStr}`;
        finalScale = 0.75;
      }

      // Create the fast BitmapText
      const floatingText = scene.add.bitmapText(startX, startY, 'damageFont', textStr, 20)
        .setOrigin(0.5)
        .setDepth(20)
        .setScale(finalScale);

      // >>> APPLY THE COLOR HERE <
      floatingText.setTint(tintColor);


      scene.tweens.add({
        targets: floatingText,
        scale: finalScale * 1.5, // Pop larger
        y: startY - (isCrit ? 30 : 20), // Crits fly higher
        duration: isCrit ? 200 : 150,
        ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({
          targets: floatingText,
          y: floatingText.y - 30,
          alpha: 0,
          scale: finalScale * 0.8,
          duration: 400,
          onComplete: () => floatingText.destroy()
        })
      });
    });


    // NOTE: the old one-shot "flash" beam renderer that used to live here (drawing its
    // own glow+core rectangles straight from raw, un-smoothed server coordinates every
    // network tick) has been removed. It was superseded by VfxRenderer.renderBeamEvents +
    // updateBeams60FPS (the persistent, smoothly-interpolated beam system below), but was
    // never deleted — so every beam was being drawn twice: once smooth, once snapping to
    // the raw per-tick position. That second copy was the "2nd laser" / shake-on-movement.

    return { activeProjectiles, activePickups };
  }
}

export function applyVisualFX(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  refs: ActorRefs,
  mainSprite: Phaser.GameObjects.Sprite,
  entity: any,
  masterConfigs: any,
  topY: number,
  bottomY: number = 20,
  realHeight: number = 32,
  currentTime: number
) {
  const castSkillId = entity.currentCastingSkillId || '';
  const effectsKey = (entity.activeEffects || []).map((e: any) => `${e[0]}:${e[1]}`).join(',');

  const isFlashing = currentTime < (refs.flashTimer || 0);

  if (isFlashing !== refs.wasFlashing) {
    refs.wasFlashing = isFlashing;
    if (isFlashing) mainSprite.setTintFill(0xffffff);
    else mainSprite.clearTint();
  }

  // >>> THE FIX: Stop relying on ActionState for VFX caching! <
  // We only care if they died, or if their actual buffs/cast ID changed.
  const isDead = entity.actionState === 'Dead' || entity.ActionState === 'Dead';
  const currentLifeState = isDead ? "Dead" : "Alive";

  const fxUnchanged = refs.lastFxCastSkillId === castSkillId &&
    refs.lastFxEffectsKey === effectsKey &&
    refs.lastFxActionState === currentLifeState;

  if (fxUnchanged) return; // Skip recreating UI!

  refs.lastFxActionState = currentLifeState;
  refs.lastFxCastSkillId = castSkillId;
  refs.lastFxEffectsKey = effectsKey;

  // Clean up old FX ONLY because the state actually changed
  container.list.filter(c => c.name === 'overhead_fx' || c.name === 'status_fx').forEach(c => c.destroy());
  if (isFlashing) mainSprite.setTintFill(0xffffff);
  else mainSprite.clearTint();

  // =========================================================
  // 1. UNDERFOOT: SKILL CHARGING ANIMATIONS
  // =========================================================
  // Previously anchored off topY (above the sprite), which put it right in the middle of the
  // name/level/health-bar cluster — that's the overlap you saw. Anchored off bottomY instead,
  // which (like topY) is derived straight from realHeight = VisualHeight * scale, so:
  //   - Distance from the sprite/health-bar scales automatically with VisualHeight, and is
  //     directly tunable by editing VisualHeight in the character/enemy config — no separate
  //     offset field needed.
  //   - The added margin (40 * finalVfxScale) also grows with finalVfxScale, which itself
  //     grows (moderately — see dampedScale below) with VisualHeight, so a taller VisualHeight
  //     both pushes the animation further down AND scales it up a little, as intended.

  // >>> THE FIX: Base this strictly on the Cast ID and Timer, NOT ActionState <
  if (castSkillId && refs.currentCastTimer > 0 && !isDead) {
    const skillConfig = (masterConfigs.skills || masterConfigs.Skills)?.[castSkillId] ?? null;
    if (skillConfig) {
      const tex = skillConfig.chargeVfxTextureKey || skillConfig.ChargeVfxTextureKey || skillConfig.textureKey || skillConfig.TextureKey;
      const animArray = skillConfig.chargeVfxAnimFrames || skillConfig.ChargeVfxAnimFrames || skillConfig.animSkill || skillConfig.AnimSkill;
      const frameRate = skillConfig.chargeVfxFrameRate || skillConfig.ChargeVfxFrameRate || skillConfig.animFrameRate || skillConfig.AnimFrameRate || 15;
      const isRepeated = skillConfig.isRepeated ?? skillConfig.IsRepeated ?? true;

      // Standard baseline is plain sprite size (VisualHeight defaults to 32 — see topY/bottomY
      // above), then VisualHeight in the config scales both position and size from there.
      const visualProportion = realHeight / 32.0;
      const dampedScale = Math.min(2.5, Math.max(0.5, 1.0 + (visualProportion - 1.0) * 0.4));
      const baseVfxScale = skillConfig.chargeVfxScale || skillConfig.ChargeVfxScale || 1.0;
      const finalVfxScale = baseVfxScale * dampedScale;

      if (animArray && animArray.length === 2 && tex) {
        const floatHeight = bottomY + (18 * finalVfxScale);
        const fxSprite = scene.add.sprite(0, floatHeight, tex).setName('overhead_fx');
        fxSprite.setOrigin(0.5, 0.5);
        fxSprite.setX(0);
        fxSprite.setScale(finalVfxScale);
        container.add(fxSprite);

        const animKey = `${skillConfig.id || skillConfig.Id}_charge`;
        if (!scene.anims.exists(animKey)) {
          scene.anims.create({
            key: animKey,
            frames: scene.anims.generateFrameNumbers(tex, { start: animArray[0], end: animArray[1] }),
            frameRate: frameRate,
            repeat: isRepeated ? -1 : 0
          });
        }
        fxSprite.play(animKey);
      }
    }
  }

  // =========================================================
  // 2. STATUS BAR (MINI ICONS WITH GLOW)
  // =========================================================
  if (entity.activeEffects && entity.activeEffects.length > 0) {
    const iconSize = 20;
    const spacing = 6;

    const totalWidth = (entity.activeEffects.length * iconSize) + ((entity.activeEffects.length - 1) * spacing);
    let currentX = -(totalWidth / 2) + (iconSize / 2);

    // Players have a nameplate row at topY-16 (see nameplate update block above), so their
    // status icons sit above that. Enemies have no nameplate, so they keep the original
    // tighter offset right above the health bar.
    const effectY = (refs.isPlayer && refs.nameText) ? (topY - 32) : (topY - 14);
    entity.activeEffects.forEach((effectEntry: [string, number]) => {
      const [effectId, stackCount] = effectEntry;
      const effectConfig = (masterConfigs.effects || masterConfigs.Effects)?.[effectId] ?? null;

      if (!effectConfig) return;

      const tex = effectConfig.textureKey || effectConfig.TextureKey;
      const frame = effectConfig.iconFrame ?? effectConfig.IconFrame ?? 0;
      const colorTint = effectConfig.colorTint || effectConfig.ColorTint;
      const isBuff = effectConfig.isBuff ?? effectConfig.IsBuff ?? false;

      if (tex) {
        const glowColor = isBuff ? 0x00ff00 : 0xff0000;

        // The '0' at the end of the rectangle makes the black background 100% transparent
        const iconBg = scene.add.rectangle(currentX, effectY, iconSize + 2, iconSize + 2, 0x000000, 0)
          .setStrokeStyle(1.5, glowColor, 1)
          .setName('status_fx');
        container.add(iconBg);

        const iconSprite = scene.add.sprite(currentX, effectY, tex, frame).setName('status_fx');
        iconSprite.setDisplaySize(iconSize, iconSize);
        container.add(iconSprite);

        if (stackCount > 1) {
          const stackText = scene.add.text(currentX + iconSize / 2 - 2, effectY + iconSize / 2 - 2, `${stackCount}`, {
            fontSize: '11px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 3
          }).setOrigin(1, 1).setName('status_fx');
          container.add(stackText);
        }

        currentX += (iconSize + spacing);
      }

      if (colorTint && !isFlashing) {
        mainSprite.setTint(parseColor(colorTint, 0xffffff));
      }
    });
  }
}



export class VfxRenderer {
  static renderAoeEvents(scene: Phaser.Scene, aoeEvents: any[], configs: any, activeAoeLoops: Map<string, any>) {
    activeAoeLoops.forEach(entry => { entry.updatedThisTick = false; });

    if (aoeEvents && aoeEvents.length > 0) {
      const skillConfigs = configs.skills || configs.Skills;

      if (skillConfigs) {
        aoeEvents.forEach(ev => {
          const configId = ev.configId ?? ev.ConfigId;
          const config = skillConfigs[configId];
          if (!config) return;

          // >>> THE INVISIBILITY FIX: If there is no colorTint, abort drawing the AOE entirely! 
          const colorStr = config.colorTint ?? config.ColorTint;
          if (!colorStr || colorStr === "") {
            return;
          }

          // If we made it here, the skill has a colorTint, so we proceed with drawing it.
          const x = ev.x ?? ev.X;
          const y = ev.y ?? ev.Y;
          const radius = ev.radius ?? ev.Radius;
          const isFriendly = ev.isFriendly ?? ev.IsFriendly ?? false;
          const casterId = ev.casterId ?? ev.CasterId;
          const skillId = ev.skillId ?? ev.SkillId ?? configId;

          const vfxTex = config.vfxTextureKey || config.VfxTextureKey;
          const vfxFrames = config.vfxAnimFrames || config.VfxAnimFrames;
          const channelDuration = config.channelDurationSeconds ?? config.ChannelDurationSeconds ?? 0;
          const isRepeated = (config.isRepeated ?? config.IsRepeated ?? false) && channelDuration > 0;

          // --- OPTION A: PLAY SPRITE BURST/LOOP ---
          if (vfxTex && vfxFrames) {
            const animKey = `${configId}_vfx`;
            const flatVfxScale = config.vfxScale || config.VfxScale || 1.0;
            const baseRadius = config.vfxBaseRadius || config.VfxBaseRadius || 0;
            const finalScale = baseRadius > 0 && radius > 0
              ? (radius / baseRadius) * flatVfxScale
              : flatVfxScale;
            const frameRate = config.vfxFrameRate || config.VfxFrameRate || 15;

            if (!scene.anims.exists(animKey)) {
              scene.anims.create({
                key: animKey,
                frames: scene.anims.generateFrameNumbers(vfxTex, { start: vfxFrames[0], end: vfxFrames[1] }),
                frameRate: frameRate,
                repeat: isRepeated ? -1 : 0
              });
            }

            if (isRepeated && casterId) {
              // Persistent loop: one sprite per (caster, skill), repositioned every tick,
              // destroyed precisely on the matching BeamEndedEvent via endAoeLoop below.
              const key = `${casterId}:${skillId}`;
              let entry = activeAoeLoops.get(key);

              if (!entry) {
                const sprite = scene.add.sprite(x, y, vfxTex).setDepth(300);
                sprite.setScale(finalScale);
                sprite.play(animKey);
                entry = { sprite };
                activeAoeLoops.set(key, entry);
              } else {
                entry.sprite.setPosition(x, y);
                entry.sprite.setScale(finalScale);
              }
              entry.updatedThisTick = true;
            } else {
              // One-shot burst - exactly the old behavior.
              const sprite = scene.add.sprite(x, y, vfxTex).setDepth(300);
              sprite.setScale(finalScale);
              sprite.play(animKey);
              sprite.once('animationcomplete', () => sprite.destroy());
            }
          }
          // --- OPTION B: SMOOTH NOVA SHOCKWAVE (Fallback) ---
          else {
            // We parse the exact color specified in the JSON
            const colorHex = parseColor(colorStr, isFriendly ? 0x00ff00 : 0xff0000);

            const visualRadius = radius > 0 ? radius : 60;

            const ring = scene.add.circle(x, y, visualRadius, colorHex, 0.3);
            ring.setStrokeStyle(4, colorHex, 1);
            ring.setDepth(299);
            ring.setScale(0.1);

            scene.tweens.add({
              targets: ring,
              scale: 1.0,
              alpha: 0,
              duration: 800, // Slowed down for better visual flow
              ease: 'Cubic.easeOut',
              onComplete: () => ring.destroy()
            });
          }
        });
      }
    }

    // Safety net: destroy any looping AoE the server stopped reporting this tick, in case
    // endAoeLoop's BeamEndedEvent was ever missed (dropped packet, etc.) - same pattern as
    // renderBeamEvents' stale-beam cleanup below.
    activeAoeLoops.forEach((entry, key) => {
      if (!entry.updatedThisTick) {
        entry.sprite.destroy();
        activeAoeLoops.delete(key);
      }
    });
  }

  static endAoeLoop(casterId: string, skillId: string, activeAoeLoops: Map<string, any>) {
    const key = `${casterId}:${skillId}`;
    const entry = activeAoeLoops.get(key);
    if (!entry) return;
    entry.sprite.destroy();
    activeAoeLoops.delete(key);
  }


  // Beams are drawn procedurally, never as scaled sprite art, so the visual is always
  // pixel-exact to the hitbox the server used (StartX/StartY -> TargetX/TargetY, Width).
  // Technique: one rectangle, anchored at its LEFT edge, rotated to point at the target,
  // and stretched in length to match the distance. Width maps 1:1 to the rectangle height.
  //
  // PERSISTENT BEAMS: a channeled laser fires a BeamVisualEvent every server tick for its
  // whole duration. Treating each one as a disposable flash (spawn + fade + destroy) means
  // dozens of overlapping fades per second — wasteful, and any dropped packet shows as a
  // visible flicker. Instead we keep ONE beam object alive per (casterId, skillId) for the
  // whole channel and just reposition/restretch it every tick. The server tells us exactly
  // when to destroy it via a BeamEndedEvent (see endBeam), so there's no guessing from a
  // timeout — works correctly whether the beam tracks the caster's aim live (AimDirection)
  // or sweeps on its own (Sweep), since we don't care why the endpoints moved, just where
  // they are this tick.
  //
  // `activeBeams` is owned by the caller (the scene) and passed in, same pattern as
  // projectileSprites/playerSprites elsewhere — VfxRenderer itself stays stateless.
  // Direct 20 TPS update — one event from the server, one immediate reposition of the sprites.
  // No interpolation layer. No circles. Just beam + bright core, positioned exactly where the
  // server says, updated every network tick.
  static renderBeamEvents(scene: Phaser.Scene, beamEvents: any[], configs: any, activeBeams: Map<string, any>) {
    activeBeams.forEach(entry => { entry.updatedThisTick = false; });

    if (beamEvents && beamEvents.length > 0) {
      beamEvents.forEach(ev => {
        const startX = ev.startX ?? ev.StartX;
        const startY = ev.startY ?? ev.StartY;
        const targetX = ev.targetX ?? ev.TargetX;
        const targetY = ev.targetY ?? ev.TargetY;
        const width = ev.width ?? ev.Width ?? 10;
        const casterId = ev.casterId ?? ev.CasterId;
        const skillId = ev.skillId ?? ev.SkillId;

        let colorHex = 0xff3030;
        const colorStr = ev.colorTint ?? ev.ColorTint;
        if (colorStr) colorHex = parseColor(colorStr, colorHex);

        const key = `${casterId}:${skillId}`;
        let entry = activeBeams.get(key);

        if (!entry) {
          const beam = scene.add.sprite(startX, startY, 'white_pixel');
          beam.setOrigin(0, 0.5).setDepth(298).setBlendMode(Phaser.BlendModes.ADD)
            .setTintFill(colorHex).setAlpha(0.85);

          const core = scene.add.sprite(startX, startY, 'white_pixel');
          core.setOrigin(0, 0.5).setDepth(299).setBlendMode(Phaser.BlendModes.ADD)
            .setTintFill(0xffffff).setAlpha(0.9);

          // We now store the casterId so we can track the sprite!
          entry = { beam, core, baseWidth: width, colorHex, casterId };
          activeBeams.set(key, entry);
        }

        entry.updatedThisTick = true;
        // Save the raw network targets
        entry.serverStartX = startX;
        entry.serverStartY = startY;
        entry.serverTargetX = targetX;
        entry.serverTargetY = targetY;
      });
    }

    // Destroy beams the server stopped reporting this tick.
    activeBeams.forEach((entry, key) => {
      if (!entry.updatedThisTick) {
        entry.beam.destroy();
        entry.core.destroy();
        activeBeams.delete(key);
      }
    });
  }

  // >>> NEW: Run this at 60FPS to lock the beam smoothly to the moving sprites! <
  static updateBeams60FPS(scene: Phaser.Scene, activeBeams: Map<string, any>, playerSprites: Map<string, any>, enemySprites: Map<string, any>, delta: number) {
    // Same half-life as body interpolation, so the far end of the beam eases in step
    // with the caster instead of snapping to a new point every ~50ms network tick
    // (that snap is what reads as "shaking" whenever the caster is moving).
    const factor = 1 - Math.pow(2, -delta / 52);

    activeBeams.forEach(entry => {
      let currentStartX = entry.serverStartX;
      let currentStartY = entry.serverStartY;

      // Force the laser's start position to exactly match the smoothly moving sprite
      const casterContainer = playerSprites.get(entry.casterId) || enemySprites.get(entry.casterId);
      if (casterContainer) {
        currentStartX = casterContainer.x;
        currentStartY = casterContainer.y;
      }

      // Ease the endpoint toward the latest server value instead of snapping to it.
      if (entry.currentTargetX === undefined) {
        entry.currentTargetX = entry.serverTargetX;
        entry.currentTargetY = entry.serverTargetY;
      } else {
        entry.currentTargetX += (entry.serverTargetX - entry.currentTargetX) * factor;
        entry.currentTargetY += (entry.serverTargetY - entry.currentTargetY) * factor;
      }

      const dx = entry.currentTargetX - currentStartX;
      const dy = entry.currentTargetY - currentStartY;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length <= 0) return;

      const angle = Math.atan2(dy, dx);

      // 60FPS Pulsing Math (makes the laser look way smoother now!)
      const pulse = Math.sin(scene.time.now / 30);
      const currentWidth = entry.baseWidth * (1 + pulse * 0.15);
      const alphaShift = pulse * 0.15;

      entry.beam.setPosition(currentStartX, currentStartY);
      entry.beam.rotation = angle;
      entry.beam.setDisplaySize(length, currentWidth);
      entry.beam.alpha = 0.7 + alphaShift;

      entry.core.setPosition(currentStartX, currentStartY);
      entry.core.rotation = angle;
      entry.core.setDisplaySize(length, Math.max(2, currentWidth * 0.25));
      entry.core.alpha = 0.8 + alphaShift;
    });
  }

  static endBeam(casterId: string, skillId: string, activeBeams: Map<string, any>) {
    const key = `${casterId}:${skillId}`;
    const entry = activeBeams.get(key);
    if (!entry) return;
    entry.beam.destroy();
    entry.core.destroy();
    activeBeams.delete(key);
  }
}