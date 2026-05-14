import * as Phaser from 'phaser';
import { AudioManager } from './AudioManager';

export class PlayerRenderer {
  static render(scene: Phaser.Scene, state: any, sprites: Map<string, Phaser.GameObjects.Container>, configs: any, targets: Map<string, { x: number, y: number }>): Set<string> {
    const activeIds = new Set<string>();

    state.players.forEach((sp: any) => {
      activeIds.add(sp.connectionId || sp.ConnectionId);
      targets.set(sp.connectionId || sp.ConnectionId, { x: sp.x ?? sp.X, y: sp.y ?? sp.Y });

      const safeId = sp.connectionId || sp.ConnectionId;

      // 1. CREATE CONTAINER
      if (!sprites.has(safeId)) {
        const container = scene.add.container(sp.x ?? sp.X, sp.y ?? sp.Y);

        const castCircle = scene.add.ellipse(0, 16, 40, 15, 0x00ffff, 0.4);
        castCircle.setStrokeStyle(2, 0x00ffff, 1);
        castCircle.setVisible(false);

        let bodySprite;
        if (configs.characters && configs.characters["char_well_rounded"] && scene.textures.exists(configs.characters["char_well_rounded"].textureKey)) {
          const charCfg = configs.characters["char_well_rounded"];
          bodySprite = scene.add.sprite(0, 0, charCfg.textureKey, charCfg.iconFrame);
        } else {
          bodySprite = scene.add.rectangle(0, 0, 32, 32, 0x000000).setStrokeStyle(2, 0x00ff00) as any;
        }

        const uiWidth = 32;
        const hpBg = scene.add.rectangle(0, 0, uiWidth, 6, 0x000000);
        const hpFill = scene.add.rectangle(-uiWidth / 2, 0, uiWidth, 6, 0x00ff00).setOrigin(0, 0.5);

        const hpMarkers = scene.add.graphics();
        const weaponsContainer = scene.add.container(0, 0);

        const castBarBg = scene.add.rectangle(0, 0, 40, 6, 0x000000).setOrigin(0.5, 0.5);
        castBarBg.setStrokeStyle(1, 0x555555);
        const castBarFill = scene.add.rectangle(-20, 0, 40, 6, 0xffd700).setOrigin(0, 0.5);
        castBarBg.setVisible(false);
        castBarFill.setVisible(false);

        container.add([castCircle, bodySprite, hpBg, hpFill, hpMarkers, weaponsContainer, castBarBg, castBarFill]);

        container.setData('bodySprite', bodySprite);
        container.setData('hpBg', hpBg);
        container.setData('hpFill', hpFill);
        container.setData('hpMarkers', hpMarkers);
        container.setData('baseWidth', uiWidth);
        container.setData('weaponsContainer', weaponsContainer);
        container.setData('castCircle', castCircle);
        container.setData('castBarBg', castBarBg);
        container.setData('castBarFill', castBarFill);

        sprites.set(safeId, container);
      }

      // 2. UPDATE UI BARS
      const pContainer = sprites.get(safeId)!;
      const body = pContainer.getData('bodySprite') as Phaser.GameObjects.Sprite;
      const configId = sp.configId || sp.ConfigId || "char_well_rounded";
      const config = configs.characters ? configs.characters[configId] : null;

      let topY = -16;
      const scale = config?.scale || 1.0;

      if (config?.calculatedTopOffset !== undefined) {
        topY = (config.calculatedTopOffset * scale) - 12;
      } else {
        const bodyHalfHeight = (body && body.displayHeight) ? body.displayHeight / 2 : 16;
        topY = -bodyHalfHeight - 12;
      }
      const bottomY = (body && body.displayHeight) ? body.displayHeight / 2 : 16;

      const pHpBg = pContainer.getData('hpBg') as Phaser.GameObjects.Rectangle;
      const pHpFill = pContainer.getData('hpFill') as Phaser.GameObjects.Rectangle;
      const hpMarkers = pContainer.getData('hpMarkers') as Phaser.GameObjects.Graphics;
      const pBaseW = pContainer.getData('baseWidth') as number ?? 32;

      pHpBg.y = topY;
      pHpFill.y = topY;
      hpMarkers.y = topY;

      const currentHp = sp.currentHp ?? sp.CurrentHp ?? 0;
      const maxHp = sp.maxHp ?? sp.MaxHp ?? 1;
      pHpFill.width = pBaseW * Math.max(0, currentHp / maxHp);

      hpMarkers.clear();
      if (maxHp > 50) {
        hpMarkers.lineStyle(2, 0x000000, 1.0);
        const segments = Math.floor(maxHp / 50);
        const pixelsPer50 = pBaseW / Math.floor(maxHp / 50);

        for (let i = 1; i <= segments; i++) {
          const lineX = -(pBaseW / 2) + (i * pixelsPer50);
          if (lineX >= (pBaseW / 2) - 1.5) continue;

          hpMarkers.beginPath();
          hpMarkers.moveTo(lineX, -4);
          hpMarkers.lineTo(lineX, 4);
          hpMarkers.strokePath();
        }
      }

      const pActionState = sp.actionState || sp.ActionState || "Idle";
      const currentCast = sp.currentCastTimer || sp.CurrentCastTimer || 0;
      const maxCast = sp.maxCastTimer || sp.MaxCastTimer || 0;

      const castBarBg = pContainer.getData('castBarBg') as Phaser.GameObjects.Rectangle;
      const castBarFill = pContainer.getData('castBarFill') as Phaser.GameObjects.Rectangle;
      const castCircle = pContainer.getData('castCircle') as Phaser.GameObjects.Ellipse;

      castBarBg.y = bottomY + 6;
      castBarFill.y = bottomY + 6;
      castCircle.y = bottomY;

      if (pActionState === "Casting" && maxCast > 0) {
        castBarBg.setVisible(true);
        castBarFill.setVisible(true);
        castCircle.setVisible(true);
        castCircle.scaleX = 0.8 + Math.sin(scene.time.now / 100) * 0.2;

        const fillPercent = Math.max(0, 1 - (currentCast / maxCast));
        castBarFill.width = 40 * fillPercent;
      } else {
        castBarBg.setVisible(false);
        castBarFill.setVisible(false);
        castCircle.setVisible(false);
      }

      // 3. ANIMATIONS & TINTING
      if (body && body.type === 'Sprite' && config) {

        body.setScale(config.scale || 1.0);

        // >>> THE FIX: Distance-to-Target Interpolation Tracking <<<
        const targetX = sp.x ?? sp.X;
        const targetY = sp.y ?? sp.Y;

        // If the visual container is more than 1 pixel away from the server's target, it is visibly moving/interpolating!
        const distToTarget = Math.abs(targetX - pContainer.x) + Math.abs(targetY - pContainer.y);
        const isMoving = distToTarget > 1.0;

        // Safely check StopMoving (defaults to false)
        let stopMoving = false;
        const castingSkillId = sp.currentCastingSkillId || sp.CurrentCastingSkillId;
        if (castingSkillId) {
          const skillCfg = (configs.skills || configs.Skills)?.[castingSkillId];
          if (skillCfg && (skillCfg.stopMoving === true || skillCfg.StopMoving === true)) stopMoving = true;
        }

        let targetAnim = `${config.id}_idle`;

        if (pActionState === "Dead" && config.animDeath) {
          targetAnim = `${config.id}_death`;
        } else if (pActionState === "Attacking" && config.animAttack) {
          targetAnim = `${config.id}_attack`;
        } else {
          // Smoothly play move animation if visually moving!
          if (isMoving && !stopMoving && config.animMove) {
            targetAnim = `${config.id}_move`;
          } else if (config.animIdle) {
            targetAnim = `${config.id}_idle`;
          }
        }

        const isCorrectAnim = body.anims && body.anims.currentAnim?.key === targetAnim;
        const isFinishedAttacking = body.anims && !body.anims.isPlaying && pActionState === "Attacking";

        if (targetAnim !== '' && (!isCorrectAnim || isFinishedAttacking)) {
          body.play(targetAnim);
        }

        const isDefaultRight = config.defaultFacingRight !== false;
        const aimX = sp.aimX ?? sp.AimX;
        const velX = sp.velX ?? sp.VelX ?? (targetX - pContainer.x);

        let faceRight = isDefaultRight;
        if (aimX !== undefined && Math.abs(aimX - targetX) > 1) {
          faceRight = aimX > targetX;
        } else {
          if (velX > 0.5) faceRight = true;
          else if (velX < -0.5) faceRight = false;
        }

        if (faceRight) body.setFlipX(!isDefaultRight);
        else body.setFlipX(isDefaultRight);

        if (!body.anims.isPlaying && pActionState !== "Dead") body.anims.resume();

        const prevActionState = pContainer.getData('prevActionState');
        const prevCastSkillId = pContainer.getData('prevCastSkillId') as string | undefined;
        if (prevActionState === 'Casting' && pActionState !== 'Casting' && prevCastSkillId) {
          const skillCfg = (configs.skills || configs.Skills)?.[prevCastSkillId];
          if (skillCfg?.soundCast) AudioManager.getInstance().playSfx(skillCfg.soundCast);
        }
        pContainer.setData('prevActionState', pActionState);
        if (pActionState === 'Casting') {
          if (castingSkillId) pContainer.setData('prevCastSkillId', castingSkillId);
        }

        const prevHp = pContainer.getData('prevHp');
        if (prevHp !== undefined && currentHp < prevHp) {
          pContainer.setData('flashTimer', scene.time.now + 150);
          AudioManager.getInstance().playLastProjectileHitSound();
        }
        pContainer.setData('prevHp', currentHp);

        applyVisualFX(scene, pContainer, body as Phaser.GameObjects.Sprite, sp, configs, topY);
      }

      // 4. WEAPONS
      const weaponsContainer = pContainer.getData('weaponsContainer') as Phaser.GameObjects.Container;
      const activeWeaponSlots = new Set<number>();
      const weaponsList = sp.weapons || sp.Weapons || [];

      // >>> DYNAMIC OFFSET FIX: Match Server Exactly! (Goal 1) <<<
      const entityScale = config.scale || 1.0;
      const offset = (10 * entityScale) + 15; // NEW "Smaller" gap

      weaponsList.forEach((w: any) => {
        const slotIndex = w.slotIndex ?? w.SlotIndex;
        const wConfigId = w.configId || w.ConfigId;
        activeWeaponSlots.add(slotIndex);

        let wx = 0, wy = 0;
        if (slotIndex === 0) { wx = offset; wy = 0; }
        else if (slotIndex === 1) { wx = -offset; wy = 0; }
        else if (slotIndex === 2) { wx = 0; wy = -offset; }
        else if (slotIndex === 3) { wx = 0; wy = offset; }

        const wConfig = configs.weapons ? (configs.weapons[wConfigId] || (configs.Weapons && configs.Weapons[wConfigId])) : null;
        let sprite = weaponsContainer.getByName(`weapon_${slotIndex}`) as Phaser.GameObjects.Sprite;

        if (!sprite && wConfig && wConfig.textureKey && scene.textures.exists(wConfig.textureKey)) {
          sprite = scene.add.sprite(wx, wy, wConfig.textureKey);
          if (wConfig.iconFrame !== undefined) sprite.setFrame(wConfig.iconFrame);
          sprite.setName(`weapon_${slotIndex}`);
          sprite.setScale(wConfig.scale || 1.0);
          if (wConfig.defaultFacingRight === false) sprite.setFlipX(true);
          weaponsContainer.add(sprite);
        }

        if (sprite && wConfig) {
          const aimX = sp.aimX ?? sp.AimX ?? sp.x ?? sp.X;
          const aimY = sp.aimY ?? sp.AimY ?? sp.y ?? sp.Y;
          const angle = Math.atan2(aimY - (sp.y ?? sp.Y), aimX - (sp.x ?? sp.X));
          sprite.rotation = angle;
          sprite.setFlipY(Math.abs(angle) > Math.PI / 2);

          const firedList = sp.firedWeapons || sp.FiredWeapons || [];
          if (firedList.includes(slotIndex) && !scene.tweens.isTweening(sprite)) {
            const animType = wConfig.attackAnimType || "recoil";
            if (animType === "stab") {
              scene.tweens.add({ targets: sprite, x: wx + Math.cos(angle) * 20, y: wy + Math.sin(angle) * 20, yoyo: true, duration: 100, ease: 'Power2' });
            } else if (animType === "recoil") {
              scene.tweens.add({ targets: sprite, x: wx + Math.cos(angle) * -15, y: wy + Math.sin(angle) * -15, yoyo: true, duration: 80, ease: 'Cubic.easeOut' });
            } else if (animType === "swing") {
              scene.tweens.add({ targets: sprite, angle: sprite.angle + 360, duration: 150, ease: 'Linear' });
            }
            // Play weapon fire sound
            if (wConfig.soundFire) AudioManager.getInstance().playSfx(wConfig.soundFire);
          }

          if (!scene.tweens.isTweening(sprite)) { sprite.x = wx; sprite.y = wy; }
        }
      });

      weaponsContainer.each((child: Phaser.GameObjects.Sprite) => {
        if (!activeWeaponSlots.has(parseInt(child.name.split('_')[1]))) child.destroy();
      });
    });

    return activeIds;
  }
}

export class EnemyRenderer {
  static render(scene: Phaser.Scene, state: any, sprites: Map<string, Phaser.GameObjects.Container>, configs: any, targets: Map<string, { x: number, y: number }>): Set<string> {
    const activeIds = new Set<string>();

    state.enemies.forEach((se: any) => {
      const safeId = se.id || se.Id;
      activeIds.add(safeId);
      targets.set(safeId, { x: se.x ?? se.X, y: se.y ?? se.Y });

      const configId = se.configId || se.ConfigId;
      const config = configs.enemies ? (configs.enemies[configId] || (configs.Enemies && configs.Enemies[configId])) : null;

      // 1. CREATE CONTAINER
      if (!sprites.has(safeId)) {
        const container = scene.add.container(se.x ?? se.X, se.y ?? se.Y);

        const castCircle = scene.add.ellipse(0, 0, 40, 15, 0xffa500, 0.4);
        castCircle.setStrokeStyle(2, 0xffa500, 1);
        castCircle.setVisible(false);

        let bodySprite;
        if (config && config.textureKey && scene.textures.exists(config.textureKey)) {
          bodySprite = scene.add.sprite(0, 0, config.textureKey);
          bodySprite.setScale(config.scale || 1.0);
          if (config.animIdle && scene.anims.exists(`${config.id}_idle`)) bodySprite.play(`${config.id}_idle`);
          else if (config.iconFrame !== undefined) bodySprite.setFrame(config.iconFrame);
        } else {
          bodySprite = scene.add.rectangle(0, 0, 32, 32, 0x000000).setStrokeStyle(2, 0x00ff00) as any;
        }

        const uiWidth = config?.isBoss ? 80 : 32;
        const hpBg = scene.add.rectangle(0, 0, uiWidth, 6, 0x000000);
        const hpFill = scene.add.rectangle(-uiWidth / 2, 0, uiWidth, 6, 0x00ff00).setOrigin(0, 0.5);

        const hpMarkers = scene.add.graphics();
        const weaponsContainer = scene.add.container(0, 0);

        const castBarBg = scene.add.rectangle(0, 0, 40, 6, 0x000000).setOrigin(0.5, 0.5);
        castBarBg.setStrokeStyle(1, 0x555555);
        const castBarFill = scene.add.rectangle(-20, 0, 40, 6, 0xffd700).setOrigin(0, 0.5);
        castBarBg.setVisible(false);
        castBarFill.setVisible(false);

        container.add([castCircle, bodySprite, hpBg, hpFill, hpMarkers, weaponsContainer, castBarBg, castBarFill]);

        container.setData('bodySprite', bodySprite);
        container.setData('hpBg', hpBg);
        container.setData('hpFill', hpFill);
        container.setData('hpMarkers', hpMarkers);
        container.setData('baseWidth', uiWidth);
        container.setData('weaponsContainer', weaponsContainer);
        container.setData('castCircle', castCircle);
        container.setData('castBarBg', castBarBg);
        container.setData('castBarFill', castBarFill);
        container.setData('configId', configId);

        sprites.set(safeId, container);
      }

      // 2. UPDATE UI BARS
      const eContainer = sprites.get(safeId)!;
      const body = eContainer.getData('bodySprite') as Phaser.GameObjects.Sprite;

      let topY = -16;
      const scale = config?.scale || 1.0;

      if (config?.calculatedTopOffset !== undefined) {
        topY = (config.calculatedTopOffset * scale) - 12;
      } else {
        const bodyHalfHeight = (body && body.displayHeight) ? body.displayHeight / 2 : 16;
        topY = -bodyHalfHeight - 12;
      }

      const bottomY = (body && body.displayHeight) ? body.displayHeight / 3 : 16;

      const eHpBg = eContainer.getData('hpBg') as Phaser.GameObjects.Rectangle;
      const eHpFill = eContainer.getData('hpFill') as Phaser.GameObjects.Rectangle;
      const hpMarkers = eContainer.getData('hpMarkers') as Phaser.GameObjects.Graphics;
      const eBaseW = eContainer.getData('baseWidth') as number ?? 32;

      eHpBg.y = topY;
      eHpFill.y = topY;
      hpMarkers.y = topY;

      const currentHp = se.currentHp ?? se.CurrentHp ?? 0;
      const maxHp = se.maxHp ?? se.MaxHp ?? 1;
      const hpPercent = Math.max(0, currentHp / maxHp);

      eHpFill.width = eBaseW * hpPercent;
      eHpFill.fillColor = (se.team ?? se.Team) === 'Player' ? 0x00ff00 : 0xff0000;

      hpMarkers.clear();
      if (maxHp > 50) {
        hpMarkers.lineStyle(2, 0x000000, 1.0);
        const segments = Math.floor(maxHp / 50);
        const pixelsPer50 = eBaseW / Math.floor(maxHp / 50);

        for (let i = 1; i <= segments; i++) {
          const lineX = -(eBaseW / 2) + (i * pixelsPer50);
          if (lineX >= (eBaseW / 2) - 1.5) continue;

          hpMarkers.beginPath();
          hpMarkers.moveTo(lineX, -4);
          hpMarkers.lineTo(lineX, 4);
          hpMarkers.strokePath();
        }
      }

      const eActionState = se.actionState || se.ActionState || "Idle";
      const currentCast = se.currentCastTimer || se.CurrentCastTimer || 0;
      const maxCast = se.maxCastTimer || se.MaxCastTimer || 0;

      const castBarBg = eContainer.getData('castBarBg') as Phaser.GameObjects.Rectangle;
      const castBarFill = eContainer.getData('castBarFill') as Phaser.GameObjects.Rectangle;
      const castCircle = eContainer.getData('castCircle') as Phaser.GameObjects.Ellipse;

      castBarBg.y = bottomY + 6;
      castBarFill.y = bottomY + 6;
      castCircle.y = bottomY;

      if (eActionState === "Casting" && maxCast > 0) {
        castBarBg.setVisible(true);
        castBarFill.setVisible(true);
        castCircle.setVisible(true);
        castCircle.scaleX = 0.8 + Math.sin(scene.time.now / 100) * 0.2;

        const fillPercent = Math.max(0, 1 - (currentCast / maxCast));
        castBarFill.width = 40 * fillPercent;
      } else {
        castBarBg.setVisible(false);
        castBarFill.setVisible(false);
        castCircle.setVisible(false);
      }

      // 2.6 ENEMY WEAPONS
      const weaponsContainer = eContainer.getData('weaponsContainer') as Phaser.GameObjects.Container;
      const activeWeaponSlots = new Set<number>();
      const weaponsList = se.weapons || se.Weapons || [];

      // >>> DYNAMIC OFFSET FIX: Match Server Exactly! <<<
      const entityScale = config.scale || 1.0;
      const offset = (40 * entityScale) + 30;

      weaponsList.forEach((w: any) => {
        const slotIndex = w.slotIndex ?? w.SlotIndex;
        const wConfigId = w.configId || w.ConfigId;
        activeWeaponSlots.add(slotIndex);

        let wx = 0, wy = 0;
        if (slotIndex === 0) { wx = offset; wy = 0; }
        else if (slotIndex === 1) { wx = -offset; wy = 0; }
        else if (slotIndex === 2) { wx = 0; wy = -offset; }
        else if (slotIndex === 3) { wx = 0; wy = offset; }

        const wConfig = configs.weapons ? (configs.weapons[wConfigId] || (configs.Weapons && configs.Weapons[wConfigId])) : null;
        let sprite = weaponsContainer.getByName(`weapon_${slotIndex}`) as Phaser.GameObjects.Sprite;

        if (!sprite && wConfig && wConfig.textureKey && scene.textures.exists(wConfig.textureKey)) {
          sprite = scene.add.sprite(wx, wy, wConfig.textureKey);
          if (wConfig.iconFrame !== undefined) sprite.setFrame(wConfig.iconFrame);
          sprite.setName(`weapon_${slotIndex}`);
          sprite.setScale(wConfig.scale || 1.0);
          if (wConfig.defaultFacingRight === false) sprite.setFlipX(true);
          weaponsContainer.add(sprite);
        }

        if (sprite) {
          sprite.x = wx;
          sprite.y = wy;

          // Rotate the weapon sprite to aim at the enemy's current target
          const eAimX = se.aimX ?? se.AimX;
          const eAimY = se.aimY ?? se.AimY;
          if (eAimX !== undefined && eAimY !== undefined && wConfig) {
            const eX = se.x ?? se.X;
            const eY = se.y ?? se.Y;
            const angle = Math.atan2(eAimY - eY, eAimX - eX);
            sprite.rotation = angle;
            sprite.setFlipY(Math.abs(angle) > Math.PI / 2);

            const firedList: number[] = se.firedWeapons || se.FiredWeapons || [];
            if (firedList.includes(slotIndex) && !scene.tweens.isTweening(sprite)) {
              const animType = wConfig.attackAnimType || 'recoil';
              if (animType === 'stab') {
                scene.tweens.add({ targets: sprite, x: wx + Math.cos(angle) * 20, y: wy + Math.sin(angle) * 20, yoyo: true, duration: 100, ease: 'Power2' });
              } else if (animType === 'recoil') {
                scene.tweens.add({ targets: sprite, x: wx + Math.cos(angle) * -15, y: wy + Math.sin(angle) * -15, yoyo: true, duration: 80, ease: 'Cubic.easeOut' });
              } else if (animType === 'swing') {
                scene.tweens.add({ targets: sprite, angle: sprite.angle + 360, duration: 150, ease: 'Linear' });
              }
            }

            if (!scene.tweens.isTweening(sprite)) { sprite.x = wx; sprite.y = wy; }
          }
        }
      });

      weaponsContainer.each((child: any) => {
        if (!child.name?.startsWith('weapon_')) return;
        const slot = parseInt(child.name.split('_')[1]);
        if (!isNaN(slot) && !activeWeaponSlots.has(slot)) child.destroy();
      });

      // 2.5 CLIENT-SIDE DEATH SKILL AoE VISUAL
      const wasDead = eContainer.getData('wasDead') || false;
      if (eActionState === 'Dead' && !wasDead) {
        eContainer.setData('wasDead', true);
        const deathX = se.x ?? se.X;
        const deathY = se.y ?? se.Y;
        const eConfig = (configs.enemies || configs.Enemies)?.[configId];
        const deathSkills = eConfig?.onDeathSkills || eConfig?.OnDeathSkills;
        if (deathSkills && deathSkills.length > 0) {
          const skillConfigs = configs.skills || configs.Skills;
          deathSkills.forEach((skillId: string) => {
            const skill = skillConfigs?.[skillId];
            if (!skill) return;
            const aType = skill.actionType || skill.ActionType;
            if (aType === 'AoE' || aType === 1) {
              const r = skill.radius || skill.Radius || 200;
              let color = 0xff4444;
              const tint = skill.colorTint || skill.ColorTint;
              if (tint && tint.length > 0) {
                const parsed = parseInt(tint.replace(/^#|^0x/i, ''), 16);
                if (!isNaN(parsed)) color = parsed;
              }
              const ring = scene.add.circle(deathX, deathY, r, color, 0.7);
              ring.setStrokeStyle(8, color, 1).setDepth(15).setScale(0.1);
              scene.tweens.add({
                targets: ring, scale: 1.0, alpha: 0, duration: 800,
                ease: 'Cubic.easeOut', onComplete: () => ring.destroy()
              });
            }
          });
        }
      }

      // 3. ANIMATIONS & TINTING
      if (body && body.type === 'Sprite' && config) {
        const baseStats = config.baseStats || config.BaseStats;
        const isObstacle = baseStats && baseStats.speed === 0;

        // >>> THE FIX: Distance-to-Target Interpolation Tracking <<<
        const targetX = se.x ?? se.X;
        const targetY = se.y ?? se.Y;

        // If the visual container is more than 1 pixel away from the server's target, it is visibly moving/interpolating!
        const distToTarget = Math.abs(targetX - eContainer.x) + Math.abs(targetY - eContainer.y);
        const isActuallyMoving = distToTarget > 1.0;

        // Safely check StopMoving (defaults to false)
        let stopMoving = false;
        const castingSkillId = se.currentCastingSkillId || se.CurrentCastingSkillId;
        if (castingSkillId) {
          const skillCfg = (configs.skills || configs.Skills)?.[castingSkillId];
          if (skillCfg && (skillCfg.stopMoving === true || skillCfg.StopMoving === true)) stopMoving = true;
        }

        let targetAnim = '';

        if (eActionState === "Dead" && config.animDeath) {
          targetAnim = `${config.id}_death`;
        } else if (eActionState === "Attacking" && config.animAttack) {
          targetAnim = `${config.id}_attack`;
        } else {
          if (isActuallyMoving && !stopMoving && !isObstacle && config.animMove) {
            targetAnim = `${config.id}_move`;
          } else if (config.animIdle) {
            targetAnim = `${config.id}_idle`;
          }
        }

        if (targetAnim !== '') {
          const isCorrectAnim = body.anims?.currentAnim?.key === targetAnim;
          const isFinishedAttacking = !body.anims?.isPlaying && eActionState === "Attacking";
          if (!isCorrectAnim || isFinishedAttacking) body.play(targetAnim);
        } else {
          if (body.anims?.isPlaying) body.anims.stop();
          if (config.iconFrame !== undefined) body.setFrame(config.iconFrame);
        }

        const isDefaultRight = config.defaultFacingRight !== false;
        const velX = se.velX ?? se.VelX ?? (targetX - eContainer.x);

        let faceRight = velX > 0.1;
        let faceLeft = velX < -0.1;

        if ((eActionState === "Attacking" || eActionState === "Casting") && se.aimX !== undefined) {
          faceRight = se.aimX > targetX + 1;
          faceLeft = se.aimX < targetX - 1;
        }

        if (faceRight) {
          body.setFlipX(!isDefaultRight);
        } else if (faceLeft) {
          body.setFlipX(isDefaultRight);
        }

        if (!body.anims?.isPlaying && eActionState !== "Dead" && targetAnim !== '') body.anims?.resume();

        const prevActionState = eContainer.getData('prevActionState');
        const prevCastSkillId = eContainer.getData('prevCastSkillId') as string | undefined;
        if (prevActionState === 'Casting' && eActionState !== 'Casting' && prevCastSkillId) {
          const skillCfg = (configs.skills || configs.Skills)?.[prevCastSkillId];
          if (skillCfg?.soundCast) AudioManager.getInstance().playSfx(skillCfg.soundCast);
        }
        eContainer.setData('prevActionState', eActionState);
        if (eActionState === 'Casting') {
          if (castingSkillId) eContainer.setData('prevCastSkillId', castingSkillId);
        }

        const prevHp = eContainer.getData('prevHp');
        if (prevHp !== undefined && currentHp < prevHp) {
          eContainer.setData('flashTimer', scene.time.now + 150);
          AudioManager.getInstance().playLastProjectileHitSound();
        }
        eContainer.setData('prevHp', currentHp);

        applyVisualFX(scene, eContainer, body as Phaser.GameObjects.Sprite, se, configs, topY);
      }
    });

    return activeIds;
  }
}

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
      const pConfig = configs.projectiles ? (configs.projectiles[configId] || (configs.Projectiles && configs.Projectiles[configId])) : null;

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
          // Weapon drop — draw the weapon's icon
          const wConfig = configs.weapons ? (configs.weapons[gearConfigId] || (configs.Weapons && configs.Weapons[gearConfigId])) : null;
          if (wConfig && wConfig.textureKey && scene.textures.exists(wConfig.textureKey)) {
            sprite = scene.add.sprite(pickup.x ?? pickup.X, pickup.y ?? pickup.Y, wConfig.textureKey);
            if (wConfig.iconFrame !== undefined) (sprite as Phaser.GameObjects.Sprite).setFrame(wConfig.iconFrame);
            sprite.setScale(wConfig.scale || 1.0);
          } else {
            sprite = scene.add.rectangle(pickup.x ?? pickup.X, pickup.y ?? pickup.Y, 14, 14, 0xffaa00).setStrokeStyle(2, 0xffffff) as any;
          }
        } else if (pType === 2 && gearConfigId) {
          // Item drop — draw the item's icon
          const iConfig = configs.items ? (configs.items[gearConfigId] || (configs.Items && configs.Items[gearConfigId])) : null;
          if (iConfig && iConfig.textureKey && scene.textures.exists(iConfig.textureKey)) {
            sprite = scene.add.sprite(pickup.x ?? pickup.X, pickup.y ?? pickup.Y, iConfig.textureKey);
            if (iConfig.iconFrame !== undefined) (sprite as Phaser.GameObjects.Sprite).setFrame(iConfig.iconFrame);
            sprite.setScale(iConfig.scale || 1.0);
          } else {
            sprite = scene.add.rectangle(pickup.x ?? pickup.X, pickup.y ?? pickup.Y, 14, 14, 0x00aaff).setStrokeStyle(2, 0xffffff) as any;
          }
        } else {
          // Gold — use the existing coins sprite
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

      const floatingText = scene.add.text(startX, startY, isHeal ? `+${Math.round(Math.abs(amt))}` : Math.round(amt).toString(), {
        fontFamily: "'Segoe UI', Tahoma, sans-serif", fontSize: '20px', color: isHeal ? '#00ff00' : '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4
      }).setOrigin(0.5).setDepth(20).setScale(0.5);

      scene.tweens.add({
        targets: floatingText, scale: 1.2, y: startY - 20, duration: 150, ease: 'Back.easeOut',
        onComplete: () => scene.tweens.add({ targets: floatingText, y: floatingText.y - 30, alpha: 0, scale: 0.8, duration: 400, onComplete: () => floatingText.destroy() })
      });
    });

    const aoeList = state.aoeEvents || state.AoeEvents || [];
    aoeList.forEach((aoe: any) => {
      const configId = aoe.configId || aoe.ConfigId;
      const skillConfig = (configs.skills || configs.Skills)?.[configId] ?? null;

      // Play skill hit sound when an AoE event is received
      if (skillConfig?.soundHit) AudioManager.getInstance().playSfx(skillConfig.soundHit);

      let rendered = false;
      const radius = aoe.radius ?? aoe.Radius;
      const x = aoe.x ?? aoe.X;
      const y = aoe.y ?? aoe.Y;

      if (skillConfig) {
        const animArray = skillConfig.animSkill || skillConfig.AnimSkill;
        const textureKey = skillConfig.textureKey || skillConfig.TextureKey;
        const iconFrame = skillConfig.iconFrame ?? skillConfig.IconFrame;
        const colorTint = skillConfig.colorTint || skillConfig.ColorTint;
        const frameRate = skillConfig.animFrameRate || skillConfig.AnimFrameRate || 15;

        // Fallback 1: PLAY ANIMATION
        if (animArray && animArray.length === 2 && textureKey) {
          const fxSprite = scene.add.sprite(x, y, textureKey).setDepth(15);
          const animKey = `${skillConfig.id || skillConfig.Id}_anim`;

          if (!scene.anims.exists(animKey)) {
            scene.anims.create({
              key: animKey,
              frames: scene.anims.generateFrameNumbers(textureKey, { start: animArray[0], end: animArray[1] }),
              frameRate: frameRate,
              repeat: 0
            });
          }

          fxSprite.setScale((radius * 2) / (fxSprite.width || 64));
          fxSprite.play(animKey);
          fxSprite.once('animationcomplete', () => fxSprite.destroy());
          rendered = true;
        }
        // Fallback 2: EXPANDING ICON
        else if (iconFrame !== undefined && textureKey) {
          const fxSprite = scene.add.sprite(x, y, textureKey, iconFrame).setDepth(15);
          scene.tweens.add({
            targets: fxSprite,
            scale: (radius * 2) / (fxSprite.width || 64),
            alpha: 0,
            duration: 500,
            ease: 'Cubic.easeOut',
            onComplete: () => fxSprite.destroy()
          });
          rendered = true;
        }
        // Fallback 3: CUSTOM COLORED RING (Boosted Opacity for High Visibility)
        else if (colorTint) {
          const color = parseInt(colorTint.replace(/^#|^0x/i, ''), 16);
          const ring = scene.add.circle(x, y, radius, color, 0.8);
          ring.setStrokeStyle(10, color, 1).setDepth(15).setScale(0.1);
          scene.tweens.add({ targets: ring, scale: 1.0, alpha: 0, duration: 600, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
          rendered = true;
        }
      }

      // Default Fallback
      if (!rendered) {
        const isFriendly = aoe.isFriendly ?? aoe.IsFriendly;
        const color = isFriendly ? 0x00ff00 : 0xff0000;
        const ring = scene.add.circle(x, y, radius, color, 0.8);
        ring.setStrokeStyle(10, color, 1).setDepth(15).setScale(0.1);
        scene.tweens.add({ targets: ring, scale: 1.0, alpha: 0, duration: 600, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
      }
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
    const animArray = isSkill ? (config.animSkill || config.AnimSkill) : (config.animEffect || config.AnimEffect);
    const textureKey = config.textureKey || config.TextureKey;
    const iconFrame = config.iconFrame ?? config.IconFrame;
    const colorTint = config.colorTint || config.ColorTint;
    const isRepeated = config.isRepeated ?? config.IsRepeated ?? true;
    const frameRate = config.animFrameRate || config.AnimEffectFrameRate || config.AnimFrameRate || 15;

    if (animArray && animArray.length === 2 && textureKey) {
      const fxSprite = scene.add.sprite(0, yOffset, textureKey).setName('overhead_fx');
      container.add(fxSprite);
      const animKey = `${config.id || config.Id}_anim`;
      if (!scene.anims.exists(animKey)) {
        scene.anims.create({ key: animKey, frames: scene.anims.generateFrameNumbers(textureKey, { start: animArray[0], end: animArray[1] }), frameRate: frameRate, repeat: isRepeated ? -1 : 0 });
      }
      fxSprite.play(animKey);
      yOffset -= 24;
    }
    else if (iconFrame !== undefined && textureKey) {
      const fxSprite = scene.add.sprite(0, yOffset, textureKey, iconFrame).setName('overhead_fx');
      container.add(fxSprite);
      yOffset -= 24;
    }
    else if (colorTint && !isFlashing && !isSkill) {
      const tintValue = parseInt(colorTint.replace(/^#|^0x/i, ''), 16);
      mainSprite.setTint(tintValue);
    }
  };

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

      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const alpha = data[(y * canvas.width + x) * 4 + 3];
          if (alpha > 10) {
            topY = y;
            foundTop = true;
            break;
          }
        }
        if (foundTop) break;
      }

      const centerY = frame.cutHeight / 2;
      config.calculatedTopOffset = topY - centerY;

      console.log(`[Pixel Scanner] ${config.id || config.Id} head offset is ${config.calculatedTopOffset}px`);
    }
  };

  processConfigs(masterConfigs.characters);
  processConfigs(masterConfigs.enemies);
}