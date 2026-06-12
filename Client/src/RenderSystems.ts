import * as Phaser from 'phaser';
import { AudioManager } from './AudioManager';

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
      const weaponOffset = isPlayer ? (10 * scale) + 15 : (40 * scale) + 30;

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

        const hpBg = scene.add.rectangle(0, 0, uiWidth, 6, 0x000000);
        const hpFill = scene.add.rectangle(-uiWidth / 2, 0, uiWidth, 6, hpColor).setOrigin(0, 0.5);
        const hpMarkers = scene.add.graphics();

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

        const castBarBg = scene.add.rectangle(0, 0, 40, 6, 0x000000).setOrigin(0.5, 0.5).setStrokeStyle(1, 0x555555).setVisible(false);
        const castBarFill = scene.add.rectangle(-20, 0, 40, 6, 0xffd700).setOrigin(0, 0.5).setVisible(false);

        container.add([castCircle, bodySprite, hpBg, hpFill, hpMarkers, hpText, weaponsContainer, castBarBg, castBarFill]);

        container.setData('bodySprite', bodySprite);
        container.setData('hpBg', hpBg);
        container.setData('hpFill', hpFill);
        container.setData('hpMarkers', hpMarkers);
        container.setData('hpText', hpText);
        container.setData('baseWidth', uiWidth);
        container.setData('weaponsContainer', weaponsContainer);
        container.setData('castCircle', castCircle);
        container.setData('castBarBg', castBarBg);
        container.setData('castBarFill', castBarFill);

        sprites.set(safeId, container);
      }

      // 3. UPDATE UI BARS
      const container = sprites.get(safeId)!;
      const body = container.getData('bodySprite') as Phaser.GameObjects.Sprite;

      let topY = -16;
      if (config?.calculatedTopOffset !== undefined) {
        topY = (config.calculatedTopOffset * scale) - 12;
      } else {
        const bodyHalfHeight = (body && body.displayHeight) ? body.displayHeight / 2 : 16;
        topY = -bodyHalfHeight - 12;
      }

      const bottomY = (body && body.displayHeight) ? body.displayHeight / (isPlayer ? 2 : 3) : 16;

      const hpBg = container.getData('hpBg') as Phaser.GameObjects.Rectangle;
      const hpFill = container.getData('hpFill') as Phaser.GameObjects.Rectangle;
      const hpMarkers = container.getData('hpMarkers') as Phaser.GameObjects.Graphics;
      const baseW = container.getData('baseWidth') as number ?? 32;

      hpBg.y = topY;
      hpFill.y = topY;
      hpMarkers.y = topY;

      const currentHp = actor.currentHp ?? actor.CurrentHp ?? 0;
      const maxHp = actor.maxHp ?? actor.MaxHp ?? 1;
      hpFill.width = baseW * Math.max(0, currentHp / maxHp);
      hpFill.fillColor = hpColor;



      hpMarkers.clear();
      if (maxHp > 50) {
        hpMarkers.lineStyle(2, 0x000000, 1.0);
        const segments = Math.floor(maxHp / 50);
        const pixelsPer50 = baseW / Math.floor(maxHp / 50);

        for (let i = 1; i <= segments; i++) {
          const lineX = -(baseW / 2) + (i * pixelsPer50);
          if (lineX >= (baseW / 2) - 1.5) continue;
          hpMarkers.beginPath().moveTo(lineX, -4).lineTo(lineX, 4).strokePath();
        }
      }

      const actionState = actor.actionState || actor.ActionState || "Idle";
      const currentCast = actor.currentCastTimer || actor.CurrentCastTimer || 0;
      const maxCast = actor.maxCastTimer || actor.MaxCastTimer || 0;

      const hpText = container.getData('hpText') as Phaser.GameObjects.Text;
      if (hpText) {
        hpText.y = topY; // Stick it right in the middle of the health bar
        hpText.setText(`${Math.round(currentHp)} / ${Math.round(maxHp)}`);

        // Only show it if the 'U' key flag is true, AND the entity is not dead
        const shouldShow = scene.data.get('showHealthNumbers') === true && actionState !== "Dead";
        hpText.setVisible(shouldShow);
      }

      const castBarBg = container.getData('castBarBg') as Phaser.GameObjects.Rectangle;
      const castBarFill = container.getData('castBarFill') as Phaser.GameObjects.Rectangle;
      const castCircle = container.getData('castCircle') as Phaser.GameObjects.Ellipse;

      castBarBg.y = bottomY + 6;
      castBarFill.y = bottomY + 6;
      castCircle.y = bottomY;

      // Extract the casting config if available to check the UI toggle
      const castingSkillId = actor.currentCastingSkillId || actor.CurrentCastingSkillId;
      const skillCfg = castingSkillId ? ((configs.skills || configs.Skills)?.[castingSkillId]) : null;
      const showCastBar = skillCfg ? (skillCfg.showCastBar !== false && skillCfg.ShowCastBar !== false) : true;

      if (actionState === "Casting" && maxCast > 0 && showCastBar) {
        castBarBg.setVisible(true);
        castBarFill.setVisible(true);
        castCircle.setVisible(true);
        castCircle.scaleX = 0.8 + Math.sin(scene.time.now / 100) * 0.2;
        castBarFill.width = 40 * Math.max(0, 1 - (currentCast / maxCast));
      } else {
        castBarBg.setVisible(false);
        castBarFill.setVisible(false);
        castCircle.setVisible(false);
      }

      // 4. WEAPONS
      const weaponsContainer = container.getData('weaponsContainer') as Phaser.GameObjects.Container;
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
        let sprite = weaponsContainer.getByName(`weapon_${slotIndex}`) as Phaser.GameObjects.Sprite;

        if (!sprite && wConfig && wConfig.textureKey && scene.textures.exists(wConfig.textureKey)) {
          sprite = scene.add.sprite(wx, wy, wConfig.textureKey).setName(`weapon_${slotIndex}`);
          if (wConfig.iconFrame !== undefined) sprite.setFrame(wConfig.iconFrame);
          sprite.setScale(wConfig.scale || 1.0);
          if (wConfig.defaultFacingRight === false) sprite.setFlipX(true);
          weaponsContainer.add(sprite);
        }

        if (sprite && wConfig) {
          // Default to player aim (mouse pointer)
          let aimX = actor.aimX ?? actor.AimX ?? targetX;
          let aimY = actor.aimY ?? actor.AimY ?? targetY;

          // ✅ NEW: AutoShot Visual Rotation Tracking
          const isAutoShot = wConfig.autoShot === true || wConfig.AutoShot === true;
          if (isPlayer && isAutoShot && enemyList && enemyList.length > 0) {
            const baseRange = wConfig.range ?? wConfig.Range ?? 300;
            const latestStats = scene.data.get('latestPlayerStats');
            const rangeBonus = latestStats?.range ?? 0;
            const finalRange = baseRange + rangeBonus;

            let bestDistSq = finalRange * finalRange;
            let targetFound = false;

            const weaponWorldX = targetX + wx;
            const weaponWorldY = targetY + wy;

            // 1. Scan for the closest enemy within weapon range
            enemyList.forEach((enemy: any) => {
              const ex = enemy.x ?? enemy.X ?? 0;
              const ey = enemy.y ?? enemy.Y ?? 0;
              const eState = enemy.actionState || enemy.ActionState || "Idle";
              const eTeam = enemy.team || enemy.Team || "Enemy";

              if (eState !== "Dead" && eTeam === "Enemy") {
                const dx = ex - weaponWorldX;
                const dy = ey - weaponWorldY;
                const distSq = dx * dx + dy * dy;

                if (distSq <= bestDistSq) {
                  bestDistSq = distSq;
                  aimX = ex;
                  aimY = ey;
                  targetFound = true;
                }
              }
            });

            // 2. Fallback: If no enemy is in range, aim at the absolute closest enemy 
            // so the gun doesn't awkwardly snap back to the mouse pointer
            if (!targetFound) {
              let absoluteClosestDistSq = Number.MAX_VALUE;
              enemyList.forEach((enemy: any) => {
                const eState = enemy.actionState || enemy.ActionState || "Idle";
                const eTeam = enemy.team || enemy.Team || "Enemy";

                if (eState !== "Dead" && eTeam === "Enemy") {
                  const dx = (enemy.x ?? enemy.X) - weaponWorldX;
                  const dy = (enemy.y ?? enemy.Y) - weaponWorldY;
                  const distSq = dx * dx + dy * dy;

                  if (distSq < absoluteClosestDistSq) {
                    absoluteClosestDistSq = distSq;
                    aimX = enemy.x ?? enemy.X;
                    aimY = enemy.y ?? enemy.Y;
                  }
                }
              });
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

      weaponsContainer.each((child: Phaser.GameObjects.Sprite) => {
        if (!child.name?.startsWith('weapon_')) return;
        const slot = parseInt(child.name.split('_')[1]);
        if (!isNaN(slot) && !activeWeaponSlots.has(slot)) child.destroy();
      });

      // 5. ENEMY DEATH SKILL VISUALIZER (Only runs for enemies)
      if (!isPlayer) {
        const wasDead = container.getData('wasDead') || false;
        if (actionState === 'Dead' && !wasDead) {
          container.setData('wasDead', true);
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

        const prevActionState = container.getData('prevActionState');
        const prevCastSkillId = container.getData('prevCastSkillId') as string | undefined;

        if (prevActionState === 'Casting' && actionState !== 'Casting' && prevCastSkillId) {
          const sCfg = (configs.skills || configs.Skills)?.[prevCastSkillId];
          if (sCfg?.soundCast) AudioManager.getInstance().playSfx(sCfg.soundCast);
        }

        container.setData('prevActionState', actionState);
        if (actionState === 'Casting' && castingSkillId) container.setData('prevCastSkillId', castingSkillId);

        const prevHp = container.getData('prevHp');
        if (prevHp !== undefined && currentHp < prevHp) {
          container.setData('flashTimer', scene.time.now + 150);
          AudioManager.getInstance().playLastProjectileHitSound();
        }
        container.setData('prevHp', currentHp);

        applyVisualFX(scene, container, body as Phaser.GameObjects.Sprite, actor, configs, topY);
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

        // 1. GENTLE CAMERA BUMP (CRITS ONLY)
        // Removed all normal-hit shaking. Crits now produce a micro-bump (40ms).
        if (isCrit && Math.random() < 0.5) {
          const cam = scene.cameras.main;

          // Only trigger if the camera isn't already tweening from a previous hit
          if (!scene.tweens.isTweening(cam)) {
            scene.tweens.add({
              targets: cam,
              zoom: 1.002, // Zoom in by just 1.5%
              rotation: (Math.random() - 0.5) * 0.005, // Microscopic random tilt
              duration: 50, // Fast punch in
              yoyo: true,   // Automatically reverse back to normal
              ease: 'Sine.easeInOut' // Smooth curve, no jagged snapping
            });
          }
        }
        // 2. CHUNKY BROTATO PARTICLES
        if (Math.random() < 0.35 || isCrit) {
          let hitColor = 0xff0000; // Default Red
          let closestDistSq = 999999;

          if (state.enemies) {
            state.enemies.forEach((e: any) => {
              const ex = e.x ?? e.X ?? 0;
              const ey = e.y ?? e.Y ?? 0;
              const distSq = (ex - startX) * (ex - startX) + (ey - startY) * (ey - startY);

              if (distSq < closestDistSq && distSq < 10000) {
                closestDistSq = distSq;
                const eCfg = configs.enemies?.[e.configId || e.ConfigId] || configs.Enemies?.[e.configId || e.ConfigId];
                if (eCfg && eCfg.calculatedBloodColor !== undefined) {
                  hitColor = eCfg.calculatedBloodColor;
                }
              }
            });
          }

          const numParticles = isCrit ? 8 : 4;
          for (let i = 0; i < numParticles; i++) {
            // MASSIVE SIZE INCREASE: 20 to 32 pixels wide
            const pSize = Phaser.Math.Between(20, 32);
            const p = scene.add.rectangle(startX, startY, pSize, pSize, hitColor).setDepth(19);

            // Add a solid black border to make the chunky particles pop against the map
            p.setStrokeStyle(2, 0x000000, 1);

            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 120 + 60; // Faster burst outward

            scene.tweens.add({
              targets: p,
              x: startX + Math.cos(angle) * speed,
              y: startY + Math.sin(angle) * speed,
              scale: 0,
              alpha: 1, // Kept at full opacity so they stay visible while shrinking
              duration: Math.random() * 300 + 200,
              ease: 'Cubic.easeOut', // Snappier popping animation
              onComplete: () => p.destroy()
            });
          }
        }
      }
      // ====================================================================
      // ====================================================================

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
      let color = 0x00ffff;
      if (beam.colorTint) {
        const parsed = parseInt(beam.colorTint.replace(/^#|^0x/i, ''), 16);
        if (!isNaN(parsed)) color = parsed;
      }

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

export function applyVisualFX(scene: Phaser.Scene, container: Phaser.GameObjects.Container, mainSprite: Phaser.GameObjects.Sprite, entity: any, masterConfigs: any, topY: number = -40) {
  const currentFxState = `${entity.actionState}_${entity.currentCastingSkillId || ''}_${(entity.activeEffects || []).join(',')}`;
  const isFlashing = scene.time.now < (container.getData('flashTimer') || 0);

  if (container.getData('lastFxState') === currentFxState && container.getData('wasFlashing') === isFlashing) return;
  container.setData('lastFxState', currentFxState);
  container.setData('wasFlashing', isFlashing);

  container.list.filter(c => c.name === 'overhead_fx').forEach(c => c.destroy());

  if (isFlashing) mainSprite.setTintFill(0xffffff);
  else mainSprite.clearTint();

  let yOffset = topY - 12;

  const renderConfig = (config: any, isSkill: boolean) => {
    const tex = isSkill ? (config.chargeVfxTextureKey || config.ChargeVfxTextureKey || config.textureKey || config.TextureKey) : (config.textureKey || config.TextureKey);
    const animArray = isSkill ? (config.chargeVfxAnimFrames || config.ChargeVfxAnimFrames || config.animSkill || config.AnimSkill) : (config.animEffect || config.AnimEffect);
    const colorTint = config.colorTint || config.ColorTint;
    const frameRate = isSkill ? (config.chargeVfxFrameRate || config.ChargeVfxFrameRate || config.animFrameRate || config.AnimFrameRate || 15) : (config.animEffectFrameRate || config.AnimEffectFrameRate || 15);
    const vfxScale = isSkill ? (config.chargeVfxScale || config.ChargeVfxScale || 1.0) : (config.scale || config.Scale || 1.0);
    const isRepeated = config.isRepeated ?? config.IsRepeated ?? true;

    // 2. Play the Charge Animation Overhead
    if (animArray && animArray.length === 2 && tex) {
      const fxSprite = scene.add.sprite(0, yOffset, tex).setName('overhead_fx');
      fxSprite.setScale(vfxScale);
      container.add(fxSprite);

      const animKey = `${config.id || config.Id}_${isSkill ? 'charge' : 'anim'}`;
      if (!scene.anims.exists(animKey)) {
        scene.anims.create({
          key: animKey,
          frames: scene.anims.generateFrameNumbers(tex, { start: animArray[0], end: animArray[1] }),
          frameRate: frameRate,
          repeat: isRepeated ? -1 : 0
        });
      }
      fxSprite.play(animKey);
      yOffset -= (24 * vfxScale);
    }
    // >>> THE FIX: Add !isSkill to prevent the character from turning red while casting! <<<
    else if (colorTint && !isFlashing && !isSkill) {
      const tintValue = typeof colorTint === 'string' ? parseInt(colorTint.replace(/^#|^0x/i, ''), 16) : colorTint;
      mainSprite.setTint(tintValue);
    }
    // 4. Static Icon 
    else if (!isSkill) {
      const iconFrame = config.iconFrame ?? config.IconFrame;
      if (iconFrame !== undefined && tex) {
        const fxSprite = scene.add.sprite(0, yOffset, tex, iconFrame).setName('overhead_fx');
        container.add(fxSprite);
        yOffset -= 24;
      }
    }
  };

  // Render Charging Overhead
  if (entity.actionState === 'Casting' && entity.currentCastingSkillId) {
    const skillConfig = (masterConfigs.skills || masterConfigs.Skills)?.[entity.currentCastingSkillId] ?? null;
    if (skillConfig) renderConfig(skillConfig, true);
  }

  if (entity.activeEffects && entity.activeEffects.length > 0) {
    entity.activeEffects.forEach((effectId: string) => {
      const effectConfig = (masterConfigs.effects || masterConfigs.Effects)?.[effectId] ?? null;
      if (effectConfig) renderConfig(effectConfig, false);
    });
  }
}

export function precalculateSpriteTops(scene: Phaser.Scene, masterConfigs: any) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const processConfigs = (configGroup: any) => {
    if (!configGroup) return;

    for (const key in configGroup) {
      const config = configGroup[key];
      if (!config.textureKey || !scene.textures.exists(config.textureKey)) continue;
      if (config.calculatedTopOffset !== undefined) continue;

      const texture = scene.textures.get(config.textureKey);
      const frame = texture.get(config.iconFrame || 0);

      canvas.width = frame.cutWidth;
      canvas.height = frame.cutHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const sourceImage = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      ctx.drawImage(sourceImage, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, frame.cutWidth, frame.cutHeight);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      let topY = 0;
      let foundTop = false;

      // >>> NEW: Variables to track average color
      let rSum = 0, gSum = 0, bSum = 0, pixelCount = 0;

      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const idx = (y * canvas.width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const alpha = data[idx + 3];

          // If the pixel is visible
          if (alpha > 10) {
            if (!foundTop) {
              topY = y;
              foundTop = true;
            }

            // Add the pixel's color to our average pool
            rSum += r;
            gSum += g;
            bSum += b;
            pixelCount++;
          }
        }
      }

      const centerY = frame.cutHeight / 2;
      config.calculatedTopOffset = topY - centerY;

      // >>> NEW: Calculate the average color of the sprite and save it as a hex number!
      if (pixelCount > 0) {
        const avgR = Math.round(rSum / pixelCount);
        const avgG = Math.round(gSum / pixelCount);
        const avgB = Math.round(bSum / pixelCount);
        config.calculatedBloodColor = (avgR << 16) | (avgG << 8) | avgB;
      } else {
        config.calculatedBloodColor = 0xff0000; // Fallback red just in case
      }
    }
  };

  processConfigs(masterConfigs.characters);
  processConfigs(masterConfigs.enemies);
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

        const vfxScale = config.vfxScale || config.VfxScale || 1.0;
        sprite.setScale(vfxScale);

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
          colorHex = typeof colorStr === 'string' ? parseInt(colorStr.replace(/^#|^0x/i, ''), 16) : colorStr;
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
}