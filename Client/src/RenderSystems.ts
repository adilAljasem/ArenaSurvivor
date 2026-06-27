import * as Phaser from 'phaser';
import { AudioManager } from './AudioManager';

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



    // Grab camera bounds for culling...
    const cam = scene.cameras.main;
    const viewLeft = cam.worldView.x - 100;


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


        const weaponsContainer = scene.add.container(0, 0);

        container.add([castCircle, bodySprite, hpText, weaponsContainer]);

        const refs: ActorRefs = {
          bodySprite, hpText, baseWidth: uiWidth, weaponsContainer,
          weaponSprites: new Map(), castCircle, wasDead: false,
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

      // Aggressive Camera Culling for the Network Tick
      const cam = scene.cameras.main;
      const viewLeft = cam.scrollX - 100;
      const viewRight = cam.scrollX + cam.width + 100;
      const viewTop = cam.scrollY - 100;
      const viewBottom = cam.scrollY + cam.height + 100;

      const isVisible = targetX >= viewLeft && targetX <= viewRight && targetY >= viewTop && targetY <= viewBottom;

      if (!isVisible) {
        if (container.visible) container.setVisible(false);
        return;
      }

      if (!container.visible) container.setVisible(true);

      // >>> FIX: Declare local variables so Sections 4, 5, and 6 can use them! <<<
      // >>> FIX: Declare local variables so Sections 4, 5, and 6 can use them! <<<
      const actionState = actor.actionState || actor.ActionState || "Idle";
      const currentHp = actor.currentHp ?? actor.CurrentHp ?? 0;
      const maxHp = actor.maxHp ?? actor.MaxHp ?? 1;

      // FIX: Added 'CurrentShield' fallback in case the server sends PascalCase!
      const currentShield = actor.currentShield ?? actor.CurrentShield ?? 0;

      const currentCastTimer = actor.currentCastTimer || actor.CurrentCastTimer || 0;
      const maxCastTimer = actor.maxCastTimer || actor.MaxCastTimer || 0;

      // >>> NEW: Dynamic Visual Height Calculation <<<
      const visualHeight = config?.visualHeight ?? config?.VisualHeight ?? 32;
      let realHeight = visualHeight * scale;

      let topY = -(realHeight / 2) - 6;
      let bottomY = (realHeight / 2);

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
      const castingSkillId = actor.currentCastingSkillId || actor.CurrentCastingSkillId;
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
      const weaponsList = actor.weapons || actor.Weapons || [];

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

          // >>> UPDATE AURA POSITION & ANIMATION EVERY FRAME <<<
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
          let aimX = actor.aimX ?? actor.AimX ?? targetX;
          let aimY = actor.aimY ?? actor.AimY ?? targetY;

          // >>> SYNC FIX: Check if the weapon is firing THIS EXACT FRAME before calculating aim
          const firedList = actor.firedWeapons || actor.FiredWeapons || [];
          const isFiringThisFrame = firedList.includes(slotIndex);

          // ✅ AutoShot Visual Rotation Tracking
          const isAutoShot = wConfig.autoShot === true || wConfig.AutoShot === true;
          if (isPlayer && isAutoShot && enemyList && enemyList.length > 0) {

            const frameCount = scene.game.loop.frame;
            const throttleOffset = slotIndex;

            if (!sprite.data) sprite.setDataEnabled();

            // >>> FPS & SYNC FIX: Use 5-frame throttle for idle aiming, but FORCE instant recalculation if firing! <<<
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
                // >>> THE JITTER FIX <<<
                // Don't set the aim to the player's exact center (targetX/Y). 
                // Because of the 5-frame throttle, as the player walks away from that cached coordinate,
                // the math calculates a negative angle and flips the weapon backward!
                // Fallback to the player's actual mouse/joystick aim.
                const fallbackAimX = actor.aimX ?? actor.AimX ?? (targetX + 100);
                const fallbackAimY = actor.aimY ?? actor.AimY ?? targetY;
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

          // >>> FPS FIX 4: Avoid O(N) Scene Tween Lookups (Updated to use our isFiringThisFrame boolean) <<<
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

        const castingSkillId = actor.currentCastingSkillId || actor.CurrentCastingSkillId;
        const skillCfg = castingSkillId ? ((configs.skills || configs.Skills)?.[castingSkillId]) : null;
        const stopMoving = skillCfg?.stopMoving === true || skillCfg?.StopMoving === true;
        const isObstacle = !isPlayer && (config.baseStats?.movementSpeed === 0 || config.BaseStats?.movementSpeed === 0);

        // Check if they have weapons equipped
        const weaponsList = actor.weapons || actor.Weapons || [];
        const hasWeapons = weaponsList.length > 0;

        const meleeAimX = actor.aimX ?? actor.AimX ?? container.x;
        const meleeAimY = actor.aimY ?? actor.AimY ?? container.y;
        const distToAim = Math.sqrt(Math.pow(meleeAimX - container.x, 2) + Math.pow(meleeAimY - container.y, 2));
        const attackRadius = config.attackRadius ?? config.AttackRadius ?? 40;
        const inMeleeRange = distToAim <= (attackRadius + 15);

        let targetAnim = `${config.id}_idle`;

        // 1. Determine if they are physically allowed to move
        const isActuallyMoving = isMoving && !stopMoving && !isObstacle;

        // >>> THE GLITCH FIX: Check if an attack animation is physically playing right now! <<<
        const isCurrentlyAttacking = body.anims?.currentAnim?.key?.endsWith('_attack') && body.anims?.isPlaying;

        if (actionState === "Dead" && config.animDeath) {
          targetAnim = `${config.id}_death`;
        } else if (!hasWeapons && config.animAttack && (actionState === "Attacking" || (actionState === "Casting" && inMeleeRange && !stopMoving))) {
          // 2. Force attack if Server says Attacking OR they are doing a mobile cast right in your face
          targetAnim = `${config.id}_attack`;
        } else if (isCurrentlyAttacking) {
          // 3. If they are already in the middle of swinging, LET IT FINISH!
          // >>> TS FIX: Added optional chaining and a fallback! <<<
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

        // >>> NEW: DYNAMIC ANIMATION SPEED SCALING <<<
        if (actionState === "Attacking") {
          // Check if there is an attackSpeedPercent stat coming from the server
          const atkSpeedPct = actor.stats?.attackSpeedPercent ?? 0;
          body.anims.timeScale = 1 + atkSpeedPct; // Speds up the animation dynamically!
        } else {
          // Reset to normal speed for walking/idle
          body.anims.timeScale = 1;
        }

        const isDefaultRight = config.defaultFacingRight !== false;
        const aimX = actor.aimX ?? actor.AimX;
        const velX = actor.velX ?? actor.VelX ?? (targetX - container.x);

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
          else if (faceLeft || aimX < targetX - 1) body.setFlipX(isDefaultRight);
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

        // >>> Pass currentTime at the very end of this function call <<<
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

    const pickupList = state.pickups || state.Pickups || [];
    pickupList.forEach((pickup: any) => {
      const safeId = pickup.id || pickup.Id;
      activePickups.add(safeId);
      if (!pickups.has(safeId)) {
        const pType = pickup.type ?? pickup.Type ?? 0;
        const gearConfigId = pickup.gearConfigId || pickup.GearConfigId || '';

        let sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;

        if (pType === 1 && gearConfigId) {
          const wConfig = configs.weapons ? (configs.weapons[gearConfigId] || configs.Weapons?.[gearConfigId]) : null;
          if (wConfig && wConfig.textureKey && scene.textures.exists(wConfig.textureKey)) {
            sprite = scene.add.sprite(pickup.x ?? pickup.X, pickup.y ?? pickup.Y, wConfig.textureKey);
            if (wConfig.iconFrame !== undefined) (sprite as Phaser.GameObjects.Sprite).setFrame(wConfig.iconFrame);
            sprite.setScale(wConfig.scale || 1.0);
          } else {
            sprite = scene.add.rectangle(pickup.x ?? pickup.X, pickup.y ?? pickup.Y, 14, 14, 0xffaa00).setStrokeStyle(2, 0xffffff) as any;
          }
        } else if (pType === 2 && gearConfigId) {
          const iConfig = configs.items ? (configs.items[gearConfigId] || configs.Items?.[gearConfigId]) : null;
          if (iConfig && iConfig.textureKey && scene.textures.exists(iConfig.textureKey)) {
            sprite = scene.add.sprite(pickup.x ?? pickup.X, pickup.y ?? pickup.Y, iConfig.textureKey);
            if (iConfig.iconFrame !== undefined) (sprite as Phaser.GameObjects.Sprite).setFrame(iConfig.iconFrame);
            sprite.setScale(iConfig.scale || 1.0);
          } else {
            sprite = scene.add.rectangle(pickup.x ?? pickup.X, pickup.y ?? pickup.Y, 14, 14, 0x00aaff).setStrokeStyle(2, 0xffffff) as any;
          }
        } else {
          sprite = scene.textures.exists('items_sheet')
            ? scene.add.sprite(pickup.x ?? pickup.X, pickup.y ?? pickup.Y, 'items_sheet', 6)
            : scene.add.rectangle(pickup.x ?? pickup.X, pickup.y ?? pickup.Y, 12, 12, 0x000000).setStrokeStyle(2, 0x00ff00) as any;
        }

        (sprite as any).setDepth(5);
        pickups.set(safeId, sprite as any);
      }
    });

    const dmgList = state.damageEvents || state.DamageEvents || [];
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
      // >>> REVISED: CHUNKY PARTICLES & GENTLE CAMERA BUMP <<<
      // ====================================================================
      if (!isDodge && !isBlock && !isHeal) {

        const playerList = state.players || state.Players || [];
        const enemyList = state.enemies || state.Enemies || [];

        // >>> THE FIX: CHECK IF THE HIT TARGET IS FRIENDLY <<<
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
              zoom: 1.002,
              rotation: (Math.random() - 0.5) * 0.005,
              duration: 50,
              yoyo: true,
              ease: 'Sine.easeInOut'
            });
          }
        }

        // 2. CHUNKY BROTATO PARTICLES 
        // >>> We now skip this entirely if isFriendlyHit is true! <<<
        // Same safety-valve reasoning as the floating-number cap below: a crit-heavy
        // spike bypasses the 35% random skip (crits always spawn particles), and each
        // burst is up to 8 Rectangle+tween pairs, so an uncapped pile of simultaneous
        // crits could spawn hundreds of objects in one tick.
        if (!isFriendlyHit && (Math.random() < 0.35 || isCrit) && particleBurstsThisTick < MAX_PARTICLE_BURSTS_PER_TICK) {
          particleBurstsThisTick++;
          const numParticles = isCrit ? 8 : 4;
          for (let i = 0; i < numParticles; i++) {
            const pSize = Phaser.Math.Between(20, 32);
            const p = scene.add.rectangle(startX, startY, pSize, pSize, hitColor).setDepth(19);

            p.setStrokeStyle(2, 0x000000, 1);

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
              onComplete: () => p.destroy()
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

      // >>> DODGE & BLOCK VISUALS <<<
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

      // >>> APPLY THE COLOR HERE <<<
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


    const beamList = state.beamEvents || state.BeamEvents || [];
    beamList.forEach((beam: any) => {
      const color = beam.colorTint ? parseColor(beam.colorTint, 0x00ffff) : 0x00ffff;

      const length = Phaser.Math.Distance.Between(beam.startX, beam.startY, beam.targetX, beam.targetY);
      const angle = Phaser.Math.Angle.Between(beam.startX, beam.startY, beam.targetX, beam.targetY);

      // 1. The Glow (Thick, colored, semi-transparent, ADD blend mode for light effect)
      const glow = scene.add.rectangle(beam.startX, beam.startY, length, beam.width, color, 0.6)
        .setOrigin(0, 0.5)
        .setRotation(angle)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(15);

      // 2. The Core (Thin, stark white, solid)
      const core = scene.add.rectangle(beam.startX, beam.startY, length, Math.max(2, beam.width * 0.3), 0xffffff, 1.0)
        .setOrigin(0, 0.5)
        .setRotation(angle)
        .setDepth(16);

      // 3. The Anime "Snap" Tween (fades out while shrinking thickness to 0)
      scene.tweens.add({
        targets: [glow, core],
        alpha: 0,
        scaleY: 0, // This is the secret! It shrinks the thickness of the rectangle!
        duration: 50,
        ease: 'Linear',
        onComplete: () => { glow.destroy(); core.destroy(); }
      });
    });

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
  currentTime: number // <--- 1. Add the new parameter here!
) {
  const castSkillId = entity.currentCastingSkillId || '';
  const effectsKey = (entity.activeEffects || []).join(',');

  // <--- 2. Use currentTime here instead of scene.time.now!
  const isFlashing = currentTime < (refs.flashTimer || 0);

  // >>> OPTIMIZATION 1: Handle Flashing Independently!
  if (isFlashing !== refs.wasFlashing) {
    refs.wasFlashing = isFlashing;
    if (isFlashing) mainSprite.setTintFill(0xffffff);
    else mainSprite.clearTint();
  }

  // >>> OPTIMIZATION 2: Only rebuild FX if the actual effects/state changed, NOT when flashing!
  const fxUnchanged = refs.lastFxActionState === entity.actionState &&
    refs.lastFxCastSkillId === castSkillId &&
    refs.lastFxEffectsKey === effectsKey;

  if (fxUnchanged) return; // Skip recreating UI!

  refs.lastFxActionState = entity.actionState;
  refs.lastFxCastSkillId = castSkillId;
  refs.lastFxEffectsKey = effectsKey;

  // Clean up old FX ONLY because the state actually changed
  container.list.filter(c => c.name === 'overhead_fx' || c.name === 'status_fx').forEach(c => c.destroy());
  if (isFlashing) mainSprite.setTintFill(0xffffff);
  else mainSprite.clearTint();

  // =========================================================
  // 1. OVERHEAD: SKILL CHARGING ANIMATIONS
  // =========================================================
  if (entity.actionState === 'Casting' && entity.currentCastingSkillId) {
    const skillConfig = (masterConfigs.skills || masterConfigs.Skills)?.[entity.currentCastingSkillId] ?? null;
    if (skillConfig) {
      const tex = skillConfig.chargeVfxTextureKey || skillConfig.ChargeVfxTextureKey || skillConfig.textureKey || skillConfig.TextureKey;
      const animArray = skillConfig.chargeVfxAnimFrames || skillConfig.ChargeVfxAnimFrames || skillConfig.animSkill || skillConfig.AnimSkill;
      const frameRate = skillConfig.chargeVfxFrameRate || skillConfig.ChargeVfxFrameRate || skillConfig.animFrameRate || skillConfig.AnimFrameRate || 15;
      const isRepeated = skillConfig.isRepeated ?? skillConfig.IsRepeated ?? true;

      // >>> TRUE HEIGHT SCALING <<<
      // A standard character is roughly 32 visible pixels tall.
      // We calculate how many times bigger the TRUE pixel height is.
      const visualProportion = realHeight / 32.0;

      // Dampen it: It grows with the boss, but never goes above 2.5x size
      const dampedScale = Math.min(2.5, Math.max(0.5, 1.0 + (visualProportion - 1.0) * 0.4));
      const baseVfxScale = skillConfig.chargeVfxScale || skillConfig.ChargeVfxScale || 1.0;
      const finalVfxScale = baseVfxScale * dampedScale;

      if (animArray && animArray.length === 2 && tex) {
        // Float height dynamically scales too, keeping it above the health bar
        const floatHeight = topY - (40 * finalVfxScale); // Pushed further up into the sky
        const fxSprite = scene.add.sprite(0, floatHeight, tex).setName('overhead_fx');
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

    // Because topY is now pushed -32 pixels up, topY + 16 places the icons 
    // exactly underneath the health bar, totally clear of the sprite's head!
    const effectY = topY - 14; // Negative pushes it up, sitting neatly on top of the health bar
    entity.activeEffects.forEach((effectId: string) => {
      const effectConfig = (masterConfigs.effects || masterConfigs.Effects)?.[effectId] ?? null;
      if (!effectConfig) return;

      const tex = effectConfig.textureKey || effectConfig.TextureKey;
      const frame = effectConfig.iconFrame ?? effectConfig.IconFrame ?? 0;
      const colorTint = effectConfig.colorTint || effectConfig.ColorTint;
      const isBuff = effectConfig.isBuff ?? effectConfig.IsBuff ?? false;

      if (tex) {
        const iconSprite = scene.add.sprite(currentX, effectY, tex, frame).setName('status_fx');
        iconSprite.setDisplaySize(iconSize, iconSize);

        const glowColor = isBuff ? 0x00ff00 : 0xff0000;

        // Add the ? right after preFX
        iconSprite.preFX?.addGlow(glowColor, 2, 0, false, 0.1, 4);

        container.add(iconSprite);
        currentX += (iconSize + spacing);
      }

      if (colorTint && !isFlashing) {
        mainSprite.setTint(parseColor(colorTint, 0xffffff));
      }
    });
  }
}



export class VfxRenderer {
  static renderAoeEvents(scene: Phaser.Scene, aoeEvents: any[], configs: any) {
    if (!aoeEvents || aoeEvents.length === 0) return;

    const skillConfigs = configs.skills || configs.Skills;
    if (!skillConfigs) return;

    aoeEvents.forEach(ev => {
      const configId = ev.configId ?? ev.ConfigId;
      const config = skillConfigs[configId];
      if (!config) return;

      // >>> THE INVISIBILITY FIX: If there is no colorTint, abort drawing the AOE entirely! <<<
      const colorStr = config.colorTint ?? config.ColorTint;
      if (!colorStr || colorStr === "") {
        return;
      }

      // If we made it here, the skill has a colorTint, so we proceed with drawing it.
      const x = ev.x ?? ev.X;
      const y = ev.y ?? ev.Y;
      const radius = ev.radius ?? ev.Radius;
      const isFriendly = ev.isFriendly ?? ev.IsFriendly ?? false;

      const vfxTex = config.vfxTextureKey || config.VfxTextureKey;
      const vfxFrames = config.vfxAnimFrames || config.VfxAnimFrames;

      // --- OPTION A: PLAY SPRITE BURST ---
      if (vfxTex && vfxFrames) {
        const animKey = `${configId}_vfx`;
        const sprite = scene.add.sprite(x, y, vfxTex).setDepth(300);

        const flatVfxScale = config.vfxScale || config.VfxScale || 1.0;
        const baseRadius = config.vfxBaseRadius || config.VfxBaseRadius || 0;

        // If the art's base radius is known, scale it to match the skill's actual radius
        // (e.g. drawn for 100px, skill radius is 140px -> scale 1.4x), then apply the flat
        // VfxScale on top as a manual fine-tune (art padding, stylistic oversize, etc.).
        const finalScale = baseRadius > 0 && radius > 0
          ? (radius / baseRadius) * flatVfxScale
          : flatVfxScale;

        sprite.setScale(finalScale);

        if (!scene.anims.exists(animKey)) {
          const frameRate = config.vfxFrameRate || config.VfxFrameRate || 15;
          scene.anims.create({
            key: animKey,
            frames: scene.anims.generateFrameNumbers(vfxTex, { start: vfxFrames[0], end: vfxFrames[1] }),
            frameRate: frameRate,
            repeat: 0
          });
        }

        sprite.play(animKey);
        sprite.once('animationcomplete', () => sprite.destroy());
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
  static renderBeamEvents(scene: Phaser.Scene, beamEvents: any[], configs: any, activeBeams: Map<string, any>) {
    // 1. Mark all existing beams as NOT updated this tick (Prep for Garbage Collection)
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

        const dx = targetX - startX;
        const dy = targetY - startY;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length <= 0) return;

        const angle = Math.atan2(dy, dx);

        let colorHex = 0xff3030;
        const colorStr = ev.colorTint ?? ev.ColorTint;
        if (colorStr) {
          colorHex = parseColor(colorStr, colorHex);
        }

        const key = `${casterId}:${skillId}`;
        let entry = activeBeams.get(key);

        if (!entry) {
          // >>> NEW: Visually upgraded beams with glow nodes and light blending! <<<
          const beam = scene.add.rectangle(startX, startY, length, width, colorHex, 0.85);
          beam.setOrigin(0, 0.5).setDepth(298).setBlendMode(Phaser.BlendModes.ADD);

          const core = scene.add.rectangle(startX, startY, length, Math.max(2, width * 0.25), 0xffffff, 0.9);
          core.setOrigin(0, 0.5).setDepth(299).setBlendMode(Phaser.BlendModes.ADD);

          const startGlow = scene.add.circle(startX, startY, width * 1.5, colorHex, 0.8);
          startGlow.setDepth(300).setBlendMode(Phaser.BlendModes.ADD);

          const impactGlow = scene.add.circle(targetX, targetY, width * 1.8, colorHex, 0.9);
          impactGlow.setDepth(300).setBlendMode(Phaser.BlendModes.ADD);

          entry = { beam, core, startGlow, impactGlow, baseWidth: width, colorHex };
          activeBeams.set(key, entry);
        }

        entry.updatedThisTick = true;

        // >>> NEW: Sine wave pulse animation so the beam flutters and vibrates! <<<
        const pulse = Math.sin(scene.time.now / 30); // Fast oscillation
        const currentWidth = entry.baseWidth * (1 + (pulse * 0.15)); // 15% thickness flutter
        const alphaShift = pulse * 0.15; // Fluctuate transparency 

        entry.beam.setPosition(startX, startY);
        entry.beam.rotation = angle;
        entry.beam.setSize(length, currentWidth);
        entry.beam.fillColor = colorHex;
        entry.beam.alpha = 0.7 + alphaShift;

        entry.core.setPosition(startX, startY);
        entry.core.rotation = angle;
        entry.core.setSize(length, Math.max(2, currentWidth * 0.25));
        entry.core.alpha = 0.8 + alphaShift;

        // Anchor the glowing orbs to the caster's hand and the impact point
        entry.startGlow.setRadius(currentWidth * (1.2 + pulse * 0.2));
        entry.startGlow.alpha = 0.7 + alphaShift;
        entry.startGlow.fillColor = colorHex;

        entry.impactGlow.setRadius(currentWidth * (1.5 + pulse * 0.3));
        entry.impactGlow.alpha = 0.8 + alphaShift;
        entry.impactGlow.fillColor = colorHex;
      });
    }

    // 2. GARBAGE COLLECTION: Destroy any beam that the server didn't explicitly send an update for.
    // This perfectly fixes beams getting stuck if an enemy dies or a cast is interrupted!
    activeBeams.forEach((entry, key) => {
      if (!entry.updatedThisTick) {
        entry.beam.destroy();
        entry.core.destroy();
        if (entry.startGlow) entry.startGlow.destroy();
        if (entry.impactGlow) entry.impactGlow.destroy();
        activeBeams.delete(key);
      }
    });
  }

  static endBeam(casterId: string, skillId: string, activeBeams: Map<string, any>) {
    const key = `${casterId}:${skillId}`;
    const entry = activeBeams.get(key);
    if (!entry) return;

    entry.beam.destroy();
    entry.core.destroy();
    if (entry.startGlow) entry.startGlow.destroy();
    if (entry.impactGlow) entry.impactGlow.destroy();
    activeBeams.delete(key);
  }
}

