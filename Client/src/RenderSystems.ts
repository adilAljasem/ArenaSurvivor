import * as Phaser from 'phaser';

export class PlayerRenderer {
  static render(scene: Phaser.Scene, state: any, sprites: Map<string, Phaser.GameObjects.Container>, configs: any, targets: Map<string, {x: number, y: number}>): Set<string> {
    const activeIds = new Set<string>();

    state.players.forEach((sp: any) => {
      activeIds.add(sp.connectionId || sp.ConnectionId);
      targets.set(sp.connectionId || sp.ConnectionId, { x: sp.x || sp.X, y: sp.y || sp.Y });

      const safeId = sp.connectionId || sp.ConnectionId;

      // 1. CREATE CONTAINER
      if (!sprites.has(safeId)) {
        const container = scene.add.container(sp.x || sp.X, sp.y || sp.Y);
        
        const castCircle = scene.add.ellipse(0, 16, 40, 15, 0x00ffff, 0.4);
        castCircle.setStrokeStyle(2, 0x00ffff, 1);
        castCircle.setVisible(false);

        let body;
        if (configs.characters && configs.characters["char_well_rounded"] && scene.textures.exists(configs.characters["char_well_rounded"].textureKey)) {
          const charCfg = configs.characters["char_well_rounded"];
          body = scene.add.sprite(0, 0, charCfg.textureKey, charCfg.iconFrame);
        } else {
          body = scene.add.rectangle(0, 0, 32, 32, 0x000000).setStrokeStyle(2, 0x00ff00);
        }

        const hpBg = scene.add.rectangle(0, -24, 32, 6, 0x000000);
        const hpFill = scene.add.rectangle(-16, -24, 32, 6, 0x00ff00).setOrigin(0, 0.5);
        const weaponsContainer = scene.add.container(0, 0);

        const castBarBg = scene.add.rectangle(0, 24, 40, 6, 0x000000).setOrigin(0.5, 0.5);
        castBarBg.setStrokeStyle(1, 0x555555);
        const castBarFill = scene.add.rectangle(-20, 24, 40, 6, 0xffd700).setOrigin(0, 0.5);
        castBarBg.setVisible(false);
        castBarFill.setVisible(false);

        container.add([castCircle, body, hpBg, hpFill, weaponsContainer, castBarBg, castBarFill]);
        
        container.setData('bodySprite', body);
        container.setData('hpFill', hpFill);
        container.setData('weaponsContainer', weaponsContainer);
        container.setData('castCircle', castCircle);
        container.setData('castBarBg', castBarBg);
        container.setData('castBarFill', castBarFill);

        sprites.set(safeId, container);
      }

      // 2. UPDATE UI BARS
      const pContainer = sprites.get(safeId)!;
      const pHpFill = pContainer.getData('hpFill') as Phaser.GameObjects.Rectangle;
      const currentHp = sp.currentHp ?? sp.CurrentHp ?? 0;
      const maxHp = sp.maxHp ?? sp.MaxHp ?? 1;
      pHpFill.width = 32 * Math.max(0, currentHp / maxHp);

      const pActionState = sp.actionState || sp.ActionState || "Idle";
      const currentCast = sp.currentCastTimer || sp.CurrentCastTimer || 0;
      const maxCast = sp.maxCastTimer || sp.MaxCastTimer || 0;
      
      const castBarBg = pContainer.getData('castBarBg') as Phaser.GameObjects.Rectangle;
      const castBarFill = pContainer.getData('castBarFill') as Phaser.GameObjects.Rectangle;
      const castCircle = pContainer.getData('castCircle') as Phaser.GameObjects.Ellipse;

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
      const body = pContainer.getData('bodySprite') as Phaser.GameObjects.Sprite;
      const configId = sp.configId || sp.ConfigId || "char_well_rounded";
      const config = configs.characters ? configs.characters[configId] : null;

      if (body && body.type === 'Sprite' && config) {
        let targetAnim = `${config.id}_idle`;

        if (pActionState === "Dead" && config.animDeath) targetAnim = `${config.id}_death`;
        else if (pActionState === "Casting") targetAnim = config.animAttack ? `${config.id}_attack` : `${config.id}_idle`;
        else if (pActionState === "Attacking" && config.animAttack) targetAnim = `${config.id}_attack`;
        else if (pActionState === "Moving" && config.animMove) targetAnim = `${config.id}_move`;

        const isCorrectAnim = body.anims && body.anims.currentAnim?.key === targetAnim;
        const isFinishedAttacking = body.anims && !body.anims.isPlaying && pActionState === "Attacking";

        if (!isCorrectAnim || isFinishedAttacking) body.play(targetAnim);

        // FLIPPING
        const isDefaultRight = config.defaultFacingRight !== false;
        const velX = sp.velX ?? sp.VelX ?? ((sp.x || sp.X) - pContainer.x);
        if (velX > 0.5) body.setFlipX(!isDefaultRight);
        else if (velX < -0.5) body.setFlipX(isDefaultRight);

        // CASTING VISUALS (Wind-Up + Pulse)
        if (pActionState === "Casting") {
          if (body.anims.isPlaying) body.anims.pause(); 
          const pulse = Math.abs(Math.sin(scene.time.now / 150)); 
          const tintColor = Phaser.Display.Color.Interpolate.ColorWithColor(
              Phaser.Display.Color.ValueToColor(0xffffff), 
              Phaser.Display.Color.ValueToColor(0x00ffff), 
              1, pulse
          );
          body.setTint(Phaser.Display.Color.GetColor(tintColor.r, tintColor.g, tintColor.b));
        } else {
          if (!body.anims.isPlaying && pActionState !== "Dead") body.anims.resume();

          let appliedTint = false;
          const activeList = sp.activeEffects || sp.ActiveEffects || [];
          if (activeList.length > 0 && configs.effects) {
            for (const effectId of activeList) {
              const effectConfig = configs.effects[effectId] || (configs.Effects && configs.Effects[effectId]);
              if (effectConfig && effectConfig.colorTint) {
                const safeHex = String(effectConfig.colorTint).replace('0x', '#');
                body.setTint(Phaser.Display.Color.HexStringToColor(safeHex).color);
                appliedTint = true; break;
              }
            }
          }
          if (!appliedTint) body.clearTint();
        }
      }

      // 4. WEAPONS
      const weaponsContainer = pContainer.getData('weaponsContainer') as Phaser.GameObjects.Container;
      const activeWeaponSlots = new Set<number>();
      const weaponsList = sp.weapons || sp.Weapons || [];

      weaponsList.forEach((w: any) => {
        const slotIndex = w.slotIndex ?? w.SlotIndex;
        const wConfigId = w.configId || w.ConfigId;
        activeWeaponSlots.add(slotIndex);
        
        let wx = 0, wy = 0; const offset = 26;
        if (slotIndex === 0) { wx = offset; wy = 0; }
        else if (slotIndex === 1) { wx = -offset; wy = 0; }
        else if (slotIndex === 2) { wx = 0; wy = -offset; }
        else if (slotIndex === 3) { wx = 0; wy = offset; }

        const config = configs.weapons ? (configs.weapons[wConfigId] || (configs.Weapons && configs.Weapons[wConfigId])) : null;
        let sprite = weaponsContainer.getByName(`weapon_${slotIndex}`) as Phaser.GameObjects.Sprite;

        if (!sprite && config && config.textureKey && scene.textures.exists(config.textureKey)) {
            sprite = scene.add.sprite(wx, wy, config.textureKey);
            if (config.iconFrame !== undefined) sprite.setFrame(config.iconFrame);
            sprite.setName(`weapon_${slotIndex}`);
            sprite.setScale(config.scale || 1.0);
            if (config.defaultFacingRight === false) sprite.setFlipX(true);
            weaponsContainer.add(sprite);
        }

        if (sprite && config) {
          const aimX = sp.aimX ?? sp.AimX ?? sp.x ?? sp.X;
          const aimY = sp.aimY ?? sp.AimY ?? sp.y ?? sp.Y;
          const angle = Math.atan2(aimY - (sp.y ?? sp.Y), aimX - (sp.x ?? sp.X));
          sprite.rotation = angle;
          sprite.setFlipY(Math.abs(angle) > Math.PI / 2);

          const firedList = sp.firedWeapons || sp.FiredWeapons || [];
          if (firedList.includes(slotIndex) && !scene.tweens.isTweening(sprite)) {
            const animType = config.attackAnimType || "recoil";
            if (animType === "stab") {
              scene.tweens.add({ targets: sprite, x: wx + Math.cos(angle) * 20, y: wy + Math.sin(angle) * 20, yoyo: true, duration: 100, ease: 'Power2' });
            } else if (animType === "recoil") {
              scene.tweens.add({ targets: sprite, x: wx + Math.cos(angle) * -15, y: wy + Math.sin(angle) * -15, yoyo: true, duration: 80, ease: 'Cubic.easeOut' });
            } else if (animType === "swing") {
              scene.tweens.add({ targets: sprite, angle: sprite.angle + 360, duration: 150, ease: 'Linear' });
            }
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
  static render(scene: Phaser.Scene, state: any, sprites: Map<string, Phaser.GameObjects.Container>, configs: any, targets: Map<string, {x: number, y: number}>): Set<string> {
    const activeIds = new Set<string>();

    state.enemies.forEach((se: any) => {
      const safeId = se.id || se.Id;
      activeIds.add(safeId);
      targets.set(safeId, { x: se.x || se.X, y: se.y || se.Y });

      const configId = se.configId || se.ConfigId;
      const config = configs.enemies ? (configs.enemies[configId] || (configs.Enemies && configs.Enemies[configId])) : null;

      // 1. CREATE CONTAINER
      if (!sprites.has(safeId)) {
        const container = scene.add.container(se.x || se.X, se.y || se.Y);

        const castCircle = scene.add.ellipse(0, 16, 40, 15, 0xffa500, 0.4); 
        castCircle.setStrokeStyle(2, 0xffa500, 1);
        castCircle.setVisible(false);

        let body;
        if (config && config.textureKey && scene.textures.exists(config.textureKey)) {
          body = scene.add.sprite(0, 0, config.textureKey);
          body.setScale(config.scale || 1.0);
          if (config.animIdle && scene.anims.exists(`${config.id}_idle`)) body.play(`${config.id}_idle`);
          else if (config.iconFrame !== undefined) body.setFrame(config.iconFrame);
        } else {
          body = scene.add.rectangle(0, 0, 32, 32, 0x000000).setStrokeStyle(2, 0x00ff00) as any;
        }

        const hpBg = scene.add.rectangle(0, -24, 32, 4, 0x000000);
        const hpFill = scene.add.rectangle(-16, -24, 32, 4, 0x00ff00).setOrigin(0, 0.5);

        const castBarBg = scene.add.rectangle(0, 24, 40, 6, 0x000000).setOrigin(0.5, 0.5);
        castBarBg.setStrokeStyle(1, 0x555555);
        const castBarFill = scene.add.rectangle(-20, 24, 40, 6, 0xffd700).setOrigin(0, 0.5);
        castBarBg.setVisible(false);
        castBarFill.setVisible(false);

        container.add([castCircle, body, hpBg, hpFill, castBarBg, castBarFill]);
        
        container.setData('bodySprite', body);
        container.setData('hpFill', hpFill);
        container.setData('baseWidth', 32 * (config?.scale || 1.0));
        container.setData('castCircle', castCircle);
        container.setData('castBarBg', castBarBg); 
        container.setData('castBarFill', castBarFill);

        sprites.set(safeId, container);
      }

      // 2. UPDATE UI BARS
      const eContainer = sprites.get(safeId)!;
      const eHpFill = eContainer.getData('hpFill') as Phaser.GameObjects.Rectangle;
      const eBaseW = eContainer.getData('baseWidth') as number;

      const currentHp = se.currentHp ?? se.CurrentHp ?? 0;
      const maxHp = se.maxHp ?? se.MaxHp ?? 1;
      const hpPercent = Math.max(0, currentHp / maxHp);
      
      eHpFill.width = eBaseW * hpPercent;
      eHpFill.fillColor = hpPercent < 0.2 ? 0xff0000 : (hpPercent < 0.5 ? 0xffff00 : 0x00ff00);

      const eActionState = se.actionState || se.ActionState || "Idle";
      const currentCast = se.currentCastTimer || se.CurrentCastTimer || 0;
      const maxCast = se.maxCastTimer || se.MaxCastTimer || 0;

      const castBarBg = eContainer.getData('castBarBg') as Phaser.GameObjects.Rectangle;
      const castBarFill = eContainer.getData('castBarFill') as Phaser.GameObjects.Rectangle;
      const castCircle = eContainer.getData('castCircle') as Phaser.GameObjects.Ellipse;

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

      // 3. ANIMATIONS & TINTING (INCLUDING OBSTACLE LOGIC!)
      const body = eContainer.getData('bodySprite') as Phaser.GameObjects.Sprite;
      
      if (body && body.type === 'Sprite' && config) {
        // Find base stats dynamically based on case
        const baseStats = config.baseStats || config.BaseStats;
        const isObstacle = baseStats && baseStats.speed === 0;
        
        let targetAnim = '';

        if (eActionState === "Dead" && config.animDeath) {
            targetAnim = `${config.id}_death`;
        } else if (eActionState === "Casting") {
            // >>> NEW: If it's an obstacle, fallback to idle or icon!
            if (isObstacle) {
                targetAnim = config.animIdle ? `${config.id}_idle` : '';
            } else {
                targetAnim = config.animAttack ? `${config.id}_attack` : (config.animIdle ? `${config.id}_idle` : '');
            }
        } else if (eActionState === "Attacking" && config.animAttack) {
            targetAnim = `${config.id}_attack`;
        } else if (eActionState === "Moving" && config.animMove) {
            targetAnim = `${config.id}_move`;
        } else if (config.animIdle) {
            targetAnim = `${config.id}_idle`;
        }

        // Apply Animation or Static Frame
        if (targetAnim !== '') {
            const isCorrectAnim = body.anims?.currentAnim?.key === targetAnim;
            const isFinishedAttacking = !body.anims?.isPlaying && eActionState === "Attacking";
            if (!isCorrectAnim || isFinishedAttacking) body.play(targetAnim);
        } else {
            if (body.anims?.isPlaying) body.anims.stop();
            if (config.iconFrame !== undefined) body.setFrame(config.iconFrame);
        }

        // FLIPPING
        const isDefaultRight = config.defaultFacingRight !== false;
        const velX = se.velX ?? se.VelX ?? ((se.x || se.X) - eContainer.x);
        if (velX > 0.1) body.setFlipX(!isDefaultRight);
        else if (velX < -0.1) body.setFlipX(isDefaultRight);

        // CASTING VISUALS (Wind-Up + Pulse)
        if (eActionState === "Casting") {
          
          // >>> NEW: Don't freeze Obstacles! Let the trees sway while they cast!
          if (!isObstacle && body.anims?.isPlaying) body.anims.pause(); 
          
          const pulse = Math.abs(Math.sin(scene.time.now / 150));
          const tintColor = Phaser.Display.Color.Interpolate.ColorWithColor(
              Phaser.Display.Color.ValueToColor(0xffffff),
              Phaser.Display.Color.ValueToColor(0xffa500), 
              1, pulse
          );
          body.setTint(Phaser.Display.Color.GetColor(tintColor.r, tintColor.g, tintColor.b));
        } else {
          if (!body.anims?.isPlaying && eActionState !== "Dead" && targetAnim !== '') body.anims?.resume();

          let appliedTint = false;
          const activeList = se.activeEffects || se.ActiveEffects || [];
          if (activeList.length > 0 && configs.effects) {
            for (const effectId of activeList) {
              const effectConfig = configs.effects[effectId] || (configs.Effects && configs.Effects[effectId]);
              if (effectConfig && effectConfig.colorTint) {
                const safeHex = String(effectConfig.colorTint).replace('0x', '#');
                body.setTint(Phaser.Display.Color.HexStringToColor(safeHex).color);
                appliedTint = true; break;
              }
            }
          }
          if (!appliedTint) body.clearTint();
        }
      }
    });

    return activeIds;
  }
}

export class WorldRenderer {
  static render(scene: Phaser.Scene, state: any, projectiles: Map<string, any>, pickups: Map<string, any>, configs: any, targets: Map<string, {x: number, y: number}>): { activeProjectiles: Set<string>, activePickups: Set<string> } {
    const activeProjectiles = new Set<string>();
    const activePickups = new Set<string>();

    const projList = state.projectiles || state.Projectiles || [];
    projList.forEach((proj: any) => {
      const safeId = proj.id || proj.Id;
      activeProjectiles.add(safeId);
      targets.set(safeId, { x: proj.x || proj.X, y: proj.y || proj.Y });

      let sprite = projectiles.get(safeId) as Phaser.GameObjects.Sprite;
      const configId = proj.configId || proj.ConfigId;
      const pConfig = configs.projectiles ? (configs.projectiles[configId] || (configs.Projectiles && configs.Projectiles[configId])) : null;

      if (!sprite) {
        if (pConfig && pConfig.textureKey && scene.textures.exists(pConfig.textureKey)) {
          sprite = scene.add.sprite(proj.x || proj.X, proj.y || proj.Y, pConfig.textureKey);
          if (pConfig.animFly) sprite.play(`${pConfig.id}_fly`);
          else if (pConfig.iconFrame !== undefined) sprite.setFrame(pConfig.iconFrame);
          sprite.setScale(pConfig.scale || 1.0);
        } else {
          sprite = scene.add.rectangle(proj.x || proj.X, proj.y || proj.Y, 10, 10, 0x000000).setStrokeStyle(2, 0x00ff00) as any;
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
        let sprite = scene.textures.exists('items_sheet') ? scene.add.sprite(pickup.x || pickup.X, pickup.y || pickup.Y, 'items_sheet', 6) : scene.add.rectangle(pickup.x || pickup.X, pickup.y || pickup.Y, 12, 12, 0x000000).setStrokeStyle(2, 0x00ff00);
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
      const color = aoe.isFriendly || aoe.IsFriendly ? 0x88ff88 : 0xff4444;
      const ring = scene.add.circle(aoe.x || aoe.X, aoe.y || aoe.Y, aoe.radius || aoe.Radius, color, 0.2);
      ring.setStrokeStyle(2, color, 0.8).setDepth(15).setScale(0.1);

      scene.tweens.add({ targets: ring, scale: 1.0, alpha: 0, duration: 500, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    });

    return { activeProjectiles, activePickups };
  }
}