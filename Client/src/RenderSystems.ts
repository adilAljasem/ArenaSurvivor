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
  // HP background + fill + segment markers used to be 3 separate game objects
  // (2 Rectangles + 1 Graphics), each contributing its own draw call. A WebGL batch
  // flush happens every time the renderer hits a different object/texture type, so
  // interleaving Rectangle/Graphics/Sprite/Text per actor was forcing several batch
  // flushes per actor just for the HP bar. Drawing bg+fill+markers into ONE Graphics
  // object per actor collapses that to a single draw call, with identical pixels.
  hpBarGfx: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  baseWidth: number;
  weaponsContainer: Phaser.GameObjects.Container;
  // Weapon sprites keyed by slot index, replacing weaponsContainer.getByName()/.each()
  // linear scans (both O(weapon count) per actor per frame) with O(1) lookups.
  weaponSprites: Map<number, Phaser.GameObjects.Sprite>;
  castCircle: Phaser.GameObjects.Ellipse;
  // Cast bar background + fill merged into one Graphics object for the same reason
  // as hpBarGfx above.
  castBarGfx: Phaser.GameObjects.Graphics;
  wasDead: boolean;
  prevActionState: string | undefined;
  prevCastSkillId: string | undefined;
  prevHp: number | undefined;
  flashTimer: number;
  // Cache the raw fields that drove the last FX rebuild, instead of re-building a
  // concatenated string key from them every frame just to compare.
  lastFxActionState: string;
  lastFxCastSkillId: string;
  lastFxEffectsKey: string;
  wasFlashing: boolean;
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
    enemyList?: any[]
  ): Set<string> {
    const activeIds = new Set<string>();

    actorList.forEach((actor: any) => {
      // 1. Identify Identity & Configs
      const safeId = isPlayer ? (actor.connectionId || actor.ConnectionId) : (actor.id || actor.Id);
      activeIds.add(safeId);

      const targetX = actor.x ?? actor.X ?? 0;
      const targetY = actor.y ?? actor.Y ?? 0;
      targets.set(safeId, { x: targetX, y: targetY });

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

        const hpBarGfx = scene.add.graphics();
        const castBarGfx = scene.add.graphics().setVisible(false);

        const hpText = scene.add.text(0, 0, '', {
          fontFamily: "'Segoe UI', Tahoma, sans-serif",
          fontSize: '10px',
          color: '#ffffff',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 3,
          resolution: 3
        }).setOrigin(0.5, 0.5).setVisible(false);

        const weaponsContainer = scene.add.container(0, 0);

        // Same anchor/order as before: castCircle, body, hpBarGfx, hpText, weapons, castBarGfx.
        // Grouping the two Graphics objects with the Sprite/Text in a stable order also helps
        // the WebGL batcher merge consecutive same-type draws across actors in the list.
        container.add([castCircle, bodySprite, hpBarGfx, hpText, weaponsContainer, castBarGfx]);

        const refs: ActorRefs = {
          bodySprite, hpBarGfx, hpText,
          baseWidth: uiWidth,
          weaponsContainer,
          weaponSprites: new Map(),
          castCircle, castBarGfx,
          wasDead: false,
          prevActionState: undefined,
          prevCastSkillId: undefined,
          prevHp: undefined,
          flashTimer: 0,
          lastFxActionState: '',
          lastFxCastSkillId: '',
          lastFxEffectsKey: '',
          wasFlashing: false,
        };
        (container as any).__refs = refs;

        sprites.set(safeId, container);
      }

      // 3. UPDATE UI BARS
      const container = sprites.get(safeId)!;
      const refs = getRefs(container);
      const body = refs.bodySprite as Phaser.GameObjects.Sprite;

      let topY = -16;
      let bottomY = 16;
      let realHeight = 32;

      // 1. Check if you manually defined the height in the JSON!
      const explicitVisualHeight = config?.visualHeight ?? config?.VisualHeight;

      if (explicitVisualHeight !== undefined && explicitVisualHeight !== null) {
        // Use the manual JSON height
        const halfHeight = (explicitVisualHeight * scale) / 2;
        topY = -halfHeight - 20; // Health bar sits 20px above their head
        bottomY = halfHeight + 10; // Cast bar sits 10px below their feet
        realHeight = explicitVisualHeight * scale;
      } else {
        // 2. Fallback if you haven't updated the JSON for this monster yet
        const bodyHalfHeight = (body && body.displayHeight) ? body.displayHeight / 2 : 16;
        topY = -bodyHalfHeight - 20;
        bottomY = bodyHalfHeight + 10;
        realHeight = bodyHalfHeight * 2;
      }


      const hpBarGfx = refs.hpBarGfx;
      const baseW = refs.baseWidth ?? 32;

      hpBarGfx.y = topY;

      const currentHp = actor.currentHp ?? actor.CurrentHp ?? 0;
      const maxHp = actor.maxHp ?? actor.MaxHp ?? 1;
      const currentShield = actor.currentShield ?? 0; // <<< NEW

      // If shield exceeds max HP, the bar scales down to fit everything natively!
      const totalCapacity = Math.max(maxHp, currentHp + currentShield);

      const fillWidth = baseW * Math.max(0, currentHp / totalCapacity);
      const shieldWidth = baseW * Math.max(0, currentShield / totalCapacity);

      hpBarGfx.clear();
      hpBarGfx.fillStyle(0x000000, 1);
      hpBarGfx.fillRect(-baseW / 2, -3, baseW, 6);

      // Draw HP
      if (fillWidth > 0) {
        hpBarGfx.fillStyle(hpColor, 1);
        hpBarGfx.fillRect(-baseW / 2, -3, fillWidth, 6);
      }

      // Draw Shield (White) right where the HP ends!
      if (shieldWidth > 0) {
        hpBarGfx.fillStyle(0xffffff, 1);
        hpBarGfx.fillRect((-baseW / 2) + fillWidth, -3, shieldWidth, 6);
      }

      // Draw segment ticks based on total capacity so the visual scaling stays true
      if (totalCapacity > 50) {
        hpBarGfx.lineStyle(2, 0x000000, 1.0);
        const segments = Math.floor(totalCapacity / 50);
        const pixelsPer50 = baseW / (totalCapacity / 50);

        for (let i = 1; i <= segments; i++) {
          const lineX = -(baseW / 2) + (i * pixelsPer50);
          if (lineX >= (baseW / 2) - 1.5) continue;
          hpBarGfx.beginPath().moveTo(lineX, -4).lineTo(lineX, 4).strokePath();
        }
      }

      const actionState = actor.actionState || actor.ActionState || "Idle";
      const currentCast = actor.currentCastTimer || actor.CurrentCastTimer || 0;
      const maxCast = actor.maxCastTimer || actor.MaxCastTimer || 0;

      const hpText = refs.hpText;
      if (hpText) {
        const shouldShow = scene.data.get('showHealthNumbers') === true && actionState !== "Dead";

        if (shouldShow) {
          hpText.y = topY;
          // >>> NEW: Add shield to the floating text if active
          if (currentShield > 0) {
            hpText.setText(`${Math.round(currentHp)} (+${Math.round(currentShield)}) / ${Math.round(maxHp)}`);
          } else {
            hpText.setText(`${Math.round(currentHp)} / ${Math.round(maxHp)}`);
          }
          hpText.setVisible(true);
        } else if (hpText.visible) {
          hpText.setVisible(false);
        }
      }

      const castBarGfx = refs.castBarGfx;
      const castCircle = refs.castCircle;

      castBarGfx.y = bottomY + 6;
      castCircle.y = bottomY;

      // Extract the casting config if available to check the UI toggle
      const castingSkillId = actor.currentCastingSkillId || actor.CurrentCastingSkillId;
      const skillCfg = castingSkillId ? ((configs.skills || configs.Skills)?.[castingSkillId]) : null;
      const showCastBar = skillCfg ? (skillCfg.showCastBar !== false && skillCfg.ShowCastBar !== false) : true;

      if (actionState === "Casting" && maxCast > 0 && showCastBar) {
        castCircle.setVisible(true);
        castCircle.scaleX = 0.8 + Math.sin(scene.time.now / 100) * 0.2;

        // Same geometry as before: bg rect 40x6 centered, with a 1px gray stroke, plus a
        // gold fill rect anchored at the left edge shrinking as cast progresses.
        const castFillWidth = 40 * Math.max(0, 1 - (currentCast / maxCast));
        castBarGfx.clear();
        castBarGfx.fillStyle(0x000000, 1);
        castBarGfx.fillRect(-20, -3, 40, 6);
        castBarGfx.lineStyle(1, 0x555555, 1);
        castBarGfx.strokeRect(-20, -3, 40, 6);
        if (castFillWidth > 0) {
          castBarGfx.fillStyle(0xffd700, 1);
          castBarGfx.fillRect(-20, -3, castFillWidth, 6);
        }
        castBarGfx.setVisible(true);
      } else {
        castBarGfx.setVisible(false);
        castCircle.setVisible(false);
      }

      // 4. WEAPONS
      const weaponsContainer = refs.weaponsContainer;
      const activeWeaponSlots = new Set<number>();
      const weaponsList = actor.weapons || actor.Weapons || [];

      weaponsList.forEach((w: any) => {
        const slotIndex = w.slotIndex ?? w.SlotIndex;
        const wConfigId = w.configId || w.ConfigId;
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
          // Default to player aim (mouse pointer)
          let aimX = actor.aimX ?? actor.AimX ?? targetX;
          let aimY = actor.aimY ?? actor.AimY ?? targetY;

          // ✅ AutoShot Visual Rotation Tracking
          // Same behavior as before (in-range target preferred, else absolute closest),
          // but merged into a single enemy scan instead of two full passes.
          const isAutoShot = wConfig.autoShot === true || wConfig.AutoShot === true;
          if (isPlayer && isAutoShot && enemyList && enemyList.length > 0) {
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

            for (let ei = 0; ei < enemyList.length; ei++) {
              const enemy = enemyList[ei];
              const eState = enemy.actionState || enemy.ActionState || "Idle";
              if (eState === "Dead") continue;
              const eTeam = enemy.team || enemy.Team || "Enemy";
              if (eTeam !== "Enemy") continue;

              const ex = enemy.x ?? enemy.X ?? 0;
              const ey = enemy.y ?? enemy.Y ?? 0;
              const dx = ex - weaponWorldX;
              const dy = ey - weaponWorldY;
              const distSq = dx * dx + dy * dy;

              if (distSq <= bestInRangeDistSq) {
                bestInRangeDistSq = distSq;
                bestInRangeX = ex; bestInRangeY = ey;
                foundInRange = true;
              }
              if (distSq < bestAnyDistSq) {
                bestAnyDistSq = distSq;
                bestAnyX = ex; bestAnyY = ey;
                foundAny = true;
              }
            }

            if (foundInRange) {
              aimX = bestInRangeX; aimY = bestInRangeY;
            } else if (foundAny) {
              aimX = bestAnyX; aimY = bestAnyY;
            }
          }

          const angle = Math.atan2(aimY - targetY, aimX - targetX);

          sprite.rotation = angle;
          sprite.setFlipY(Math.abs(angle) > Math.PI / 2);

          const firedList = actor.firedWeapons || actor.FiredWeapons || [];
          if (firedList.includes(slotIndex) && !scene.tweens.isTweening(sprite)) {
            const animType = wConfig.attackAnimType || 'recoil';
            if (animType === 'stab') {
              scene.tweens.add({ targets: sprite, x: wx + Math.cos(angle) * 20, y: wy + Math.sin(angle) * 20, yoyo: true, duration: 100, ease: 'Power2' });
            } else if (animType === 'recoil') {
              scene.tweens.add({ targets: sprite, x: wx + Math.cos(angle) * -15, y: wy + Math.sin(angle) * -15, yoyo: true, duration: 80, ease: 'Cubic.easeOut' });
            } else if (animType === 'swing') {
              scene.tweens.add({ targets: sprite, angle: sprite.angle + 360, duration: 150, ease: 'Linear' });
            }
            if (isPlayer && wConfig.soundFire) AudioManager.getInstance().playSfx(wConfig.soundFire);
          }

          if (!scene.tweens.isTweening(sprite)) { sprite.x = wx; sprite.y = wy; }
        }
      });

      // Remove sprites for slots that are no longer active. Iterating the small
      // weaponSprites map (almost always 1-4 entries) instead of every container
      // child avoids a linear scan of the whole container per actor per frame.
      if (refs.weaponSprites.size > 0) {
        refs.weaponSprites.forEach((child, slot) => {
          if (!activeWeaponSlots.has(slot)) {
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
          refs.flashTimer = scene.time.now + 150;
          AudioManager.getInstance().playLastProjectileHitSound();
        }
        refs.prevHp = currentHp;

        applyVisualFX(scene, container, refs, body as Phaser.GameObjects.Sprite, actor, configs, topY, bottomY, realHeight);
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

      let color = '#ffffff';

      let stroke = '#000000';
      let textStr = Math.round(Math.abs(amt)).toString();
      let finalScale = 0.5;

      // >>> DODGE & BLOCK VISUALS <<<
      if (isDodge) {
        color = '#00e5ff'; // Cyan
        stroke = '#005b9f';
        textStr = 'DODGE';
        finalScale = 0.6;
      } else if (isBlock) {
        color = '#b0bec5'; // Silver/Gray
        stroke = '#455a64';
        textStr = 'BLOCK';
        finalScale = 0.6;
      } else if (isHeal) {
        color = '#00ff00';
        textStr = `+${textStr}`;
      } else if (isCrit) {
        color = '#ffeb3b'; // Yellow
        stroke = '#d32f2f'; // Red stroke
        textStr = `💥 ${textStr}`;
        finalScale = 0.75;
      }

      const floatingText = scene.add.text(startX, startY, textStr, {
        fontFamily: "'Segoe UI', Tahoma, sans-serif",
        fontSize: '20px',
        color: color,
        fontStyle: isCrit || isDodge || isBlock ? 'italic bold' : 'bold',
        stroke: stroke,
        strokeThickness: isCrit ? 6 : 4
      }).setOrigin(0.5).setDepth(20).setScale(finalScale);

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
  realHeight: number = 32 // <--- New parameter!
) {
  // Compare the raw fields directly instead of concatenating them into a string every
  // frame for every actor just to compare strings - same result, no allocation/join cost
  // on the (very common) frame where nothing changed.
  const castSkillId = entity.currentCastingSkillId || '';
  const effectsKey = (entity.activeEffects || []).join(',');
  const isFlashing = scene.time.now < (refs.flashTimer || 0);

  const unchanged = refs.lastFxActionState === entity.actionState &&
    refs.lastFxCastSkillId === castSkillId &&
    refs.lastFxEffectsKey === effectsKey &&
    refs.wasFlashing === isFlashing;
  if (unchanged) return;

  refs.lastFxActionState = entity.actionState;
  refs.lastFxCastSkillId = castSkillId;
  refs.lastFxEffectsKey = effectsKey;
  refs.wasFlashing = isFlashing;

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
      const x = ev.x ?? ev.X;
      const y = ev.y ?? ev.Y;
      const radius = ev.radius ?? ev.Radius;
      const configId = ev.configId ?? ev.ConfigId;

      // >>> NEW: Extract the isFriendly flag from the server! <<<
      const isFriendly = ev.isFriendly ?? ev.IsFriendly ?? false;

      const config = skillConfigs[configId];
      if (!config) return;

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
        // If baseRadius is unset (0), fall back to flatVfxScale alone -- old behavior,
        // for skills where art size is intentionally decoupled from the hitbox.
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
        // >>> NEW: Default to Green for Friendly, Red for Enemy <<<
        let colorHex = isFriendly ? 0x00ff00 : 0xff0000;

        const colorStr = config.colorTint || config.ColorTint;

        // If you explicitly set a colorTint in JSON, it will override the Green/Red.
        if (colorStr) {
          colorHex = parseColor(colorStr, colorHex);
        }

        const visualRadius = radius > 0 ? radius : 60;

        const ring = scene.add.circle(x, y, visualRadius, colorHex, 0.3);
        ring.setStrokeStyle(4, colorHex, 1);
        ring.setDepth(299);
        ring.setScale(0.1);

        scene.tweens.add({
          targets: ring,
          scale: 1.0,
          alpha: 0,
          duration: 800, // >>> FIX: Slowed down from 400ms to 800ms! <<<
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
  static renderBeamEvents(scene: Phaser.Scene, beamEvents: any[], configs: any, activeBeams: Map<string, { beam: Phaser.GameObjects.Rectangle, core: Phaser.GameObjects.Rectangle }>) {
    if (!beamEvents || beamEvents.length === 0) return;

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
        // setOrigin(0, 0.5): left-center anchor, so the rectangle grows away from the
        // caster along its rotation axis instead of growing from its own center.
        const beam = scene.add.rectangle(startX, startY, length, width, colorHex, 0.85);
        beam.setOrigin(0, 0.5);
        beam.setDepth(298);

        // Thin bright core on top of the wider translucent body reads better than a flat
        // single-color bar, without needing any art.
        const core = scene.add.rectangle(startX, startY, length, Math.max(2, width * 0.25), 0xffffff, 0.9);
        core.setOrigin(0, 0.5);
        core.setDepth(299);

        entry = { beam, core };
        activeBeams.set(key, entry);
      }

      // Reposition + restretch every tick. setSize controls the rectangle's actual collision
      // geometry, not just visuals, but Phaser's renderer reads geometry+position+rotation
      // fresh each frame, so this is enough to make it track the caster smoothly.
      entry.beam.setPosition(startX, startY);
      entry.beam.rotation = angle;
      entry.beam.setSize(length, width);

      entry.core.setPosition(startX, startY);
      entry.core.rotation = angle;
      entry.core.setSize(length, Math.max(2, width * 0.25));
    });
  }

  // Called when the server confirms a channel has ended (timer expired, or the skill was
  // force-reset). Destroys the persistent beam objects and removes the map entry.
  static endBeam(casterId: string, skillId: string, activeBeams: Map<string, { beam: Phaser.GameObjects.Rectangle, core: Phaser.GameObjects.Rectangle }>) {
    const key = `${casterId}:${skillId}`;
    const entry = activeBeams.get(key);
    if (!entry) return;

    entry.beam.destroy();
    entry.core.destroy();
    activeBeams.delete(key);
  }
}