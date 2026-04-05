using Server.Configs;
using Server.DTOs;
using Server.Entities;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Server.Core.Systems;

public static class CombatSystem
{
    public static void ProcessShooting(float dt, GameState state, ConfigManager configs)
    {
        // --- 1. PLAYER WEAPONS ---
        foreach (var player in state.Players.Values)
        {
            foreach (var weapon in player.Weapons)
            {
                weapon.CurrentCooldown -= dt;

                if (weapon.CurrentCooldown <= 0 && (player.AimX != 0 || player.AimY != 0))
                {
                    var config = configs.Weapons[weapon.ConfigId];
                    weapon.CurrentCooldown = config.CooldownSeconds;

                    float spawnX = player.X;
                    float spawnY = player.Y;
                    float offset = 24f;

                    if (weapon.SlotIndex == 0) spawnX += offset;
                    else if (weapon.SlotIndex == 1) spawnX -= offset;
                    else if (weapon.SlotIndex == 2) spawnY -= offset;
                    else if (weapon.SlotIndex == 3) spawnY += offset;

                    float dirX = player.AimX - spawnX;
                    float dirY = player.AimY - spawnY;
                    float length = (float)Math.Sqrt(dirX * dirX + dirY * dirY);

                    if (length > 0)
                    {
                        float attackSpeedPct = player.GetTotalStat("attackSpeedPercent", configs);
                        weapon.CurrentCooldown = config.CooldownSeconds / Math.Max(0.1f, (1f + attackSpeedPct));

                        player.FiredWeaponsThisTick.Add(weapon.SlotIndex);

                        float baseMelee = weapon.TotalBaseStats.GetValueOrDefault("meleeDamage", 0f);
                        float baseRanged = weapon.TotalBaseStats.GetValueOrDefault("rangedDamage", 0f);
                        float baseElemental = weapon.TotalBaseStats.GetValueOrDefault("elementalDamage", 0f);

                        if (weapon.RolledStats.TryGetValue("meleeDamage", out var rm)) baseMelee += rm;
                        if (weapon.RolledStats.TryGetValue("rangedDamage", out var rr)) baseRanged += rr;
                        if (weapon.RolledStats.TryGetValue("elementalDamage", out var re)) baseElemental += re;

                        float finalDamage = baseMelee + baseRanged + baseElemental;

                        if (config.DamageScaling != null)
                        {
                            foreach (var scale in config.DamageScaling)
                            {
                                finalDamage += player.GetTotalStat(scale.Key, configs) * scale.Value;
                            }
                        }

                        float damagePercent = player.GetTotalStat("damagePercent", configs);
                        finalDamage = finalDamage * (1f + damagePercent);

                        float localLifeSteal = config.Mechanics != null && config.Mechanics.ContainsKey("lifeSteal")
                                               ? config.Mechanics["lifeSteal"] : 0f;
                        float globalLifeSteal = player.GetTotalStat("lifeSteal", configs);
                        float totalLifeStealForThisAttack = localLifeSteal + globalLifeSteal;

                        float finalRange = config.Range + player.GetTotalStat("range", configs);

                        string projId = config.ProjectileId ?? "9mm_bullet";
                        if (configs.Projectiles.TryGetValue(projId, out var projConfig))
                        {
                            float speedMultiplier = 1f + player.GetTotalStat("projectileSpeedPercent", configs);
                            float finalSpeed = projConfig.BaseSpeed * speedMultiplier;

                            var combinedEffects = new List<string>();
                            if (config.ApplyEffectsOnHit != null) combinedEffects.AddRange(config.ApplyEffectsOnHit);
                            if (projConfig.ApplyEffectsOnHit != null) combinedEffects.AddRange(projConfig.ApplyEffectsOnHit);

                            float computedLifespan = finalSpeed > 0 ? (finalRange / finalSpeed) : 0.15f;
                            if (projConfig.Lifespan > 0) computedLifespan = projConfig.Lifespan;
                            if (config.Lifespan > 0) computedLifespan = config.Lifespan;

                            var bullet = new ProjectileEntity
                            {
                                ConfigId = projConfig.Id,
                                OwnerId = player.ConnectionId,
                                X = spawnX,
                                Y = spawnY,
                                VelX = (dirX / length) * finalSpeed,
                                VelY = (dirY / length) * finalSpeed,
                                Damage = finalDamage,
                                LifeStealChance = totalLifeStealForThisAttack,
                                HitRadius = projConfig.HitRadius,
                                PierceCount = projConfig.PierceCount,
                                Lifespan = computedLifespan,
                                ApplyEffectsOnHit = combinedEffects
                            };
                            state.Projectiles.TryAdd(bullet.Id, bullet);
                        }
                    }
                }
            }
        }

        // --- 2. ENEMY WEAPONS ---
        foreach (var enemy in state.Enemies.Values)
        {
            if (enemy.ActionState == "Dead" || enemy.Weapons.Count == 0) continue;

            // Friendly summons (Team != "Enemy") shoot at hostile enemies; hostile enemies shoot at players
            if (enemy.Team != "Enemy")
            {
                // Find the closest hostile enemy to aim at
                EnemyEntity? summonTarget = null;
                float bestSummonDistSq = float.MaxValue;
                foreach (var hostile in state.Enemies.Values)
                {
                    if (hostile.Id == enemy.Id || hostile.ActionState == "Dead") continue;
                    if (hostile.Team == enemy.Team) continue; // Skip same-team entities
                    float dx = hostile.X - enemy.X;
                    float dy = hostile.Y - enemy.Y;
                    float distSq = dx * dx + dy * dy;
                    if (distSq < bestSummonDistSq) { bestSummonDistSq = distSq; summonTarget = hostile; }
                }

                if (summonTarget == null) continue;

                float summonDirX = summonTarget.X - enemy.X;
                float summonDirY = summonTarget.Y - enemy.Y;
                float summonDirLen = (float)Math.Sqrt(summonDirX * summonDirX + summonDirY * summonDirY);
                if (summonDirLen <= 0) continue;

                enemy.AimX = summonTarget.X;
                enemy.AimY = summonTarget.Y;

                float summonAttackRadius = 300f;
                if (configs.Enemies.TryGetValue(enemy.ConfigId, out var summonEnemyCfg))
                    summonAttackRadius = summonEnemyCfg.AttackRadius;

                if (bestSummonDistSq > summonAttackRadius * summonAttackRadius) continue;

                foreach (var weapon in enemy.Weapons)
                {
                    weapon.CurrentCooldown -= dt;
                    if (weapon.CurrentCooldown > 0) continue;
                    if (!configs.Weapons.TryGetValue(weapon.ConfigId, out var wCfgS)) continue;

                    weapon.CurrentCooldown = wCfgS.CooldownSeconds;

                    float baseMelee = weapon.TotalBaseStats.GetValueOrDefault("meleeDamage", 0f);
                    float baseRanged = weapon.TotalBaseStats.GetValueOrDefault("rangedDamage", 0f);
                    float baseElemental = weapon.TotalBaseStats.GetValueOrDefault("elementalDamage", 0f);

                    if (weapon.RolledStats.TryGetValue("meleeDamage", out var rm2)) baseMelee += rm2;
                    if (weapon.RolledStats.TryGetValue("rangedDamage", out var rr2)) baseRanged += rr2;
                    if (weapon.RolledStats.TryGetValue("elementalDamage", out var re2)) baseElemental += re2;

                    float finalDmg2 = (baseMelee + baseRanged + baseElemental) * (1f + enemy.GetTotalStat("damagePercent", configs));

                    if (wCfgS.DamageScaling != null)
                        foreach (var scale in wCfgS.DamageScaling)
                            finalDmg2 += enemy.GetTotalStat(scale.Key, configs) * scale.Value;

                    float finalRange2 = wCfgS.Range + enemy.GetTotalStat("range", configs);
                    string projId2 = wCfgS.ProjectileId;
                    if (string.IsNullOrEmpty(projId2) || !configs.Projectiles.TryGetValue(projId2, out var pCfg2)) continue;

                    float finalSpeed2 = pCfg2.BaseSpeed;
                    float lifespan2 = finalSpeed2 > 0 ? (finalRange2 / finalSpeed2) : 0.15f;
                    if (pCfg2.Lifespan > 0) lifespan2 = pCfg2.Lifespan;
                    if (wCfgS.Lifespan > 0) lifespan2 = wCfgS.Lifespan;

                    var combined2 = new List<string>();
                    if (wCfgS.ApplyEffectsOnHit != null) combined2.AddRange(wCfgS.ApplyEffectsOnHit);
                    if (pCfg2.ApplyEffectsOnHit != null) combined2.AddRange(pCfg2.ApplyEffectsOnHit);

                    enemy.FiredWeaponsThisTick.Add(weapon.SlotIndex);

                    var bullet2 = new ProjectileEntity
                    {
                        ConfigId = pCfg2.Id,
                        OwnerId = enemy.Id,
                        X = enemy.X, Y = enemy.Y,
                        VelX = (summonDirX / summonDirLen) * finalSpeed2,
                        VelY = (summonDirY / summonDirLen) * finalSpeed2,
                        Damage = finalDmg2,
                        HitRadius = pCfg2.HitRadius,
                        PierceCount = pCfg2.PierceCount,
                        Lifespan = lifespan2,
                        ApplyEffectsOnHit = combined2,
                        Team = enemy.Team
                    };
                    state.Projectiles.TryAdd(bullet2.Id, bullet2);
                }
                continue;
            }

            // Find the closest player to aim at
            PlayerEntity? target = null;
            float bestDistSq = float.MaxValue;
            foreach (var player in state.Players.Values)
            {
                float dx = player.X - enemy.X;
                float dy = player.Y - enemy.Y;
                float distSq = dx * dx + dy * dy;
                if (distSq < bestDistSq)
                {
                    bestDistSq = distSq;
                    target = player;
                }
            }

            if (target == null) continue;

            float dirToTargetX = target.X - enemy.X;
            float dirToTargetY = target.Y - enemy.Y;
            float dirLength = (float)Math.Sqrt(dirToTargetX * dirToTargetX + dirToTargetY * dirToTargetY);
            if (dirLength <= 0) continue;

            // Always update aim direction so weapon sprites point at target
            enemy.AimX = target.X;
            enemy.AimY = target.Y;

            // Fetch the config to check the attack radius
            float attackRadius = 300f;
            if (configs.Enemies.TryGetValue(enemy.ConfigId, out var enemyCfg))
                attackRadius = enemyCfg.AttackRadius;

            // Weapons only fire when the player is inside the attack radius
            if (bestDistSq > attackRadius * attackRadius) continue;

            foreach (var weapon in enemy.Weapons)
            {
                weapon.CurrentCooldown -= dt;
                if (weapon.CurrentCooldown > 0) continue;

                if (!configs.Weapons.TryGetValue(weapon.ConfigId, out var weaponConfig)) continue;

                weapon.CurrentCooldown = weaponConfig.CooldownSeconds;

                float baseMelee = weapon.TotalBaseStats.GetValueOrDefault("meleeDamage", 0f);
                float baseRanged = weapon.TotalBaseStats.GetValueOrDefault("rangedDamage", 0f);
                float baseElemental = weapon.TotalBaseStats.GetValueOrDefault("elementalDamage", 0f);

                if (weapon.RolledStats.TryGetValue("meleeDamage", out var rm)) baseMelee += rm;
                if (weapon.RolledStats.TryGetValue("rangedDamage", out var rr)) baseRanged += rr;
                if (weapon.RolledStats.TryGetValue("elementalDamage", out var re)) baseElemental += re;

                float finalDamage = baseMelee + baseRanged + baseElemental;

                if (weaponConfig.DamageScaling != null)
                {
                    foreach (var scale in weaponConfig.DamageScaling)
                        finalDamage += enemy.GetTotalStat(scale.Key, configs) * scale.Value;
                }

                float damagePercent = enemy.GetTotalStat("damagePercent", configs);
                finalDamage = finalDamage * (1f + damagePercent);

                float finalRange = weaponConfig.Range + enemy.GetTotalStat("range", configs);

                string projId = weaponConfig.ProjectileId;
                if (string.IsNullOrEmpty(projId) || !configs.Projectiles.TryGetValue(projId, out var projConfig)) continue;

                float finalSpeed = projConfig.BaseSpeed;
                float computedLifespan = finalSpeed > 0 ? (finalRange / finalSpeed) : 0.15f;
                if (projConfig.Lifespan > 0) computedLifespan = projConfig.Lifespan;
                if (weaponConfig.Lifespan > 0) computedLifespan = weaponConfig.Lifespan;

                var combinedEffects = new List<string>();
                if (weaponConfig.ApplyEffectsOnHit != null) combinedEffects.AddRange(weaponConfig.ApplyEffectsOnHit);
                if (projConfig.ApplyEffectsOnHit != null) combinedEffects.AddRange(projConfig.ApplyEffectsOnHit);

                enemy.FiredWeaponsThisTick.Add(weapon.SlotIndex);

                var bullet = new ProjectileEntity
                {
                    ConfigId = projConfig.Id,
                    OwnerId = enemy.Id,
                    X = enemy.X,
                    Y = enemy.Y,
                    VelX = (dirToTargetX / dirLength) * finalSpeed,
                    VelY = (dirToTargetY / dirLength) * finalSpeed,
                    Damage = finalDamage,
                    LifeStealChance = 0f,
                    HitRadius = projConfig.HitRadius,
                    PierceCount = projConfig.PierceCount,
                    Lifespan = computedLifespan,
                    ApplyEffectsOnHit = combinedEffects
                };
                state.Projectiles.TryAdd(bullet.Id, bullet);
            }
        }
    }

    public static void ProcessCollisions(float dt, GameState state, ConfigManager configs, List<DamageEventDto> tickDamageEvents, List<AoeEventDto> tickAoeEvents)
    {
        var projectilesToRemove = new List<string>();
        var pickupsToRemove = new List<string>();

        // 1. Projectiles vs Enemies
        foreach (var proj in state.Projectiles.Values)
        {
            float prevX = proj.X;
            float prevY = proj.Y;

            proj.X += proj.VelX * dt;
            proj.Y += proj.VelY * dt;
            proj.Lifespan -= dt;

            if (proj.Lifespan <= 0)
            {
                projectilesToRemove.Add(proj.Id);
                continue;
            }

            // Player-fired projectiles, and projectiles fired by friendly summons (Team != "Enemy"), can hit hostile enemies
            bool isPlayerProjectile = state.Players.ContainsKey(proj.OwnerId) ||
                (state.Enemies.TryGetValue(proj.OwnerId, out var projOwner) && projOwner.Team != "Enemy");

            if (isPlayerProjectile)
            {
                foreach (var enemy in state.Enemies.Values)
                {
                    if (enemy.ActionState == "Dead" || proj.HitEnemies.Contains(enemy.Id)) continue;
                    if (enemy.Team != "Enemy") continue; // Never hit friendly summons

                    float combinedRadius = proj.HitRadius + enemy.HitRadius;
                    float hitThresholdSq = combinedRadius * combinedRadius;

                    float dx = proj.X - prevX;
                    float dy = proj.Y - prevY;
                    float fx = enemy.X - prevX;
                    float fy = enemy.Y - prevY;

                    float lengthSq = (dx * dx) + (dy * dy);
                    float t = lengthSq == 0 ? 0 : Math.Max(0, Math.Min(1, (fx * dx + fy * dy) / lengthSq));

                    float closestX = prevX + t * dx;
                    float closestY = prevY + t * dy;

                    float distX = closestX - enemy.X;
                    float distY = closestY - enemy.Y;
                    float distSqToSegment = (distX * distX) + (distY * distY);

                    if (distSqToSegment <= hitThresholdSq)
                    {
                        enemy.CurrentHp -= proj.Damage;
                        proj.HitEnemies.Add(enemy.Id);

                        tickDamageEvents.Add(new DamageEventDto { X = enemy.X, Y = enemy.Y, Amount = proj.Damage });

                        if (proj.ApplyEffectsOnHit != null)
                        {
                            foreach (var effectId in proj.ApplyEffectsOnHit)
                            {
                                if (configs.Effects.TryGetValue(effectId, out var effectConfig))
                                {
                                    var existing = enemy.ActiveEffects.FirstOrDefault(e => e.ConfigId == effectId);
                                    if (existing != null) existing.TimeRemaining = effectConfig.Duration;
                                    else enemy.ActiveEffects.Add(new ActiveEffect { ConfigId = effectId, TimeRemaining = effectConfig.Duration });
                                }
                            }
                        }

                        if (Random.Shared.NextDouble() < proj.LifeStealChance)
                        {
                            if (state.Players.TryGetValue(proj.OwnerId, out var p))
                            {
                                float maxHp = p.GetTotalStat("maxHp", configs);
                                p.CurrentHp = Math.Min(maxHp, p.CurrentHp + 1f);
                            }
                        }

                        if (enemy.CurrentHp <= 0 && enemy.ActionState != "Dead")
                        {
                            enemy.ActionState = "Dead";

                            // Gold drop
                            var gold = new PickupEntity { X = enemy.X, Y = enemy.Y, Value = 1 };
                            state.Pickups.TryAdd(gold.Id, gold);

                            // Gear drops (weapon and item loot rolls)
                            if (configs.Enemies.TryGetValue(enemy.ConfigId, out var eCfg))
                            {
                                SpawnGearDrops(enemy, eCfg, state, configs);

                                // Death skills
                                SkillSystem.FireOnDeathSkills(enemy.Id, enemy.X, enemy.Y, enemy.Team, eCfg.OnDeathSkills, state, configs, tickDamageEvents, tickAoeEvents);
                            }
                        }

                        if (proj.HitEnemies.Count > proj.PierceCount)
                        {
                            projectilesToRemove.Add(proj.Id);
                            break;
                        }
                    }
                }
            }
        }

        // 2. Players vs Pickups (Gold / XP only – weapons and items require manual spacebar pickup)
        foreach (var player in state.Players.Values)
        {
            foreach (var pickup in state.Pickups.Values)
            {
                if (pickupsToRemove.Contains(pickup.Id)) continue;

                float distSq = (player.X - pickup.X) * (player.X - pickup.X) + (player.Y - pickup.Y) * (player.Y - pickup.Y);
                if (distSq < 625) // 25 radius
                {
                    if (pickup.Type == PickupType.Gold)
                    {
                        player.Gold += pickup.Value;
                        player.GainXp(pickup.Value, configs);
                        pickupsToRemove.Add(pickup.Id);
                    }
                    // Weapon and Item pickups are handled by TryPickupLoot (manual spacebar)
                }
            }
        }

        foreach (var id in projectilesToRemove) state.Projectiles.TryRemove(id, out _);
        foreach (var id in pickupsToRemove) state.Pickups.TryRemove(id, out _);
    }

    // Rolls loot drops for all gear the dying enemy was carrying
    private static void SpawnGearDrops(EnemyEntity enemy, EnemyConfig config, GameState state, ConfigManager configs)
    {
        float scatterRadius = 20f;

        foreach (var weapon in enemy.Weapons)
        {
            if (config.WeaponDropChance <= 0f) continue;
            if (!configs.Weapons.TryGetValue(weapon.ConfigId, out var wCfg) || !wCfg.CanDrop) continue;
            if (Random.Shared.NextDouble() >= config.WeaponDropChance) continue;

            float ox = (float)(Random.Shared.NextDouble() * scatterRadius * 2 - scatterRadius);
            float oy = (float)(Random.Shared.NextDouble() * scatterRadius * 2 - scatterRadius);
            var drop = new PickupEntity
            {
                X = enemy.X + ox,
                Y = enemy.Y + oy,
                Type = PickupType.Weapon,
                DroppedWeapon = weapon
            };
            state.Pickups.TryAdd(drop.Id, drop);
        }

        foreach (var item in enemy.OwnedItems)
        {
            if (config.ItemDropChance <= 0f) continue;
            if (!configs.Items.TryGetValue(item.ConfigId, out var iCfg) || !iCfg.CanDrop) continue;
            if (Random.Shared.NextDouble() >= config.ItemDropChance) continue;

            float ox = (float)(Random.Shared.NextDouble() * scatterRadius * 2 - scatterRadius);
            float oy = (float)(Random.Shared.NextDouble() * scatterRadius * 2 - scatterRadius);
            var drop = new PickupEntity
            {
                X = enemy.X + ox,
                Y = enemy.Y + oy,
                Type = PickupType.Item,
                DroppedItem = item
            };
            state.Pickups.TryAdd(drop.Id, drop);
        }
    }
}