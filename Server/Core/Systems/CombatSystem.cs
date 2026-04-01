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


                        // >>> FIX: Instantly read the cached server calculation! No more loops! <<<
                        float baseMelee = weapon.TotalBaseStats.GetValueOrDefault("meleeDamage", 0f);
                        float baseRanged = weapon.TotalBaseStats.GetValueOrDefault("rangedDamage", 0f);
                        float baseElemental = weapon.TotalBaseStats.GetValueOrDefault("elementalDamage", 0f);

                        // 2. Add any specific random rolls this specific weapon has!
                        if (weapon.RolledStats.TryGetValue("meleeDamage", out var rm)) baseMelee += rm;
                        if (weapon.RolledStats.TryGetValue("rangedDamage", out var rr)) baseRanged += rr;
                        if (weapon.RolledStats.TryGetValue("elementalDamage", out var re)) baseElemental += re;

                        float finalDamage = baseMelee + baseRanged + baseElemental;

                        // 3. Add Player Stat Scaling (e.g., +50% of your Engineering stat)
                        if (config.DamageScaling != null)
                        {
                            foreach (var scale in config.DamageScaling)
                            {
                                finalDamage += player.GetTotalStat(scale.Key, configs) * scale.Value;
                            }
                        }

                        // 4. Apply global damage percent (REMOVED * weapon.Level !!!)
                        float damagePercent = player.GetTotalStat("damagePercent", configs);
                        finalDamage = finalDamage * (1f + damagePercent);
                        // ====================================================================

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

            foreach (var enemy in state.Enemies.Values)
            {
                if (enemy.ActionState == "Dead" || proj.HitEnemies.Contains(enemy.Id)) continue;

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
                        var gold = new PickupEntity { X = enemy.X, Y = enemy.Y, Value = 1 };
                        state.Pickups.TryAdd(gold.Id, gold);

                        // >>> FIRE DEATH SKILLS <<<
                        if (configs.Enemies.TryGetValue(enemy.ConfigId, out var eCfg))
                        {
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

        // 2. Players vs Pickups
        foreach (var player in state.Players.Values)
        {
            foreach (var pickup in state.Pickups.Values)
            {
                if (pickupsToRemove.Contains(pickup.Id)) continue;

                float distSq = (player.X - pickup.X) * (player.X - pickup.X) + (player.Y - pickup.Y) * (player.Y - pickup.Y);
                if (distSq < 625) // 25 radius
                {
                    player.Gold += pickup.Value;
                    player.GainXp(pickup.Value, configs);
                    pickupsToRemove.Add(pickup.Id);
                }
            }
        }

        foreach (var id in projectilesToRemove) state.Projectiles.TryRemove(id, out _);
        foreach (var id in pickupsToRemove) state.Pickups.TryRemove(id, out _);
    }
}