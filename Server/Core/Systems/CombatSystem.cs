using Server.Configs;
using Server.DTOs;
using Server.Entities;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Server.Core.Systems;

public static class CombatSystem
{

    public static void ProcessRegen(float dt, GameState state, ConfigManager configs)
    {
        // Smoothly heal Players over time
        foreach (var player in state.Players.Values)
        {
            if (player.ActionState == "Dead") continue;
            float regen = player.GetTotalStat("hpRegen", configs);
            if (regen > 0 && player.CurrentHp < player.GetTotalStat("maxHp", configs))
            {
                player.CurrentHp = Math.Min(player.GetTotalStat("maxHp", configs), player.CurrentHp + (regen * dt));
            }
        }

        // Smoothly heal Enemies over time
        foreach (var enemy in state.Enemies.Values)
        {
            if (enemy.ActionState == "Dead") continue;
            float regen = enemy.GetTotalStat("hpRegen", configs);
            if (regen > 0 && enemy.CurrentHp < enemy.GetTotalStat("maxHp", configs))
            {
                enemy.CurrentHp = Math.Min(enemy.GetTotalStat("maxHp", configs), enemy.CurrentHp + (regen * dt));
            }
        }
    }
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

                    // >>> DYNAMIC OFFSET FIX: Match Client Exactly! <<<
                    float entityScale = 1.0f;
                    if (configs.Characters.TryGetValue(player.ConfigId, out var pCfg)) entityScale = pCfg.Scale;
                    float offset = (10f * entityScale) + 15f;

                    float spawnX = player.X;
                    float spawnY = player.Y;

                    if (weapon.SlotIndex == 0) spawnX += offset;
                    else if (weapon.SlotIndex == 1) spawnX -= offset;
                    else if (weapon.SlotIndex == 2) spawnY -= offset;
                    else if (weapon.SlotIndex == 3) spawnY += offset;

                    float dirX = player.AimX - player.X;
                    float dirY = player.AimY - player.Y;
                    float length = (float)Math.Sqrt(dirX * dirX + dirY * dirY);


                    if (length > 0)
                    {
                        float attackSpeedPct = player.GetTotalStat("attackSpeedPercent", configs);
                        weapon.CurrentCooldown = config.CooldownSeconds / Math.Max(0.1f, (1f + attackSpeedPct));

                        player.FiredWeaponsThisTick.Add(weapon.SlotIndex);

                        // >>> CRIT IMPLEMENTED HERE <<<
                        var (physDmg, magicDmg, isCrit) = CalculateWeaponDamageSplit(player, config, weapon, configs);

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

                            var newBullets = ProjectileFactory.Create(
                                projConfig, player.ConnectionId, "Player",
                                spawnX, spawnY, dirX, dirY,
                                physDmg, magicDmg,
                                finalSpeed, totalLifeStealForThisAttack, config.ApplyEffectsOnHit, 1, computedLifespan,
                                isCrit // <<< PASS CRIT TO FACTORY
                            );

                            foreach (var b in newBullets) state.Projectiles.TryAdd(b.Id, b);
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
                    if (hostile.Team == enemy.Team) continue;
                    float dx = hostile.X - enemy.X;
                    float dy = hostile.Y - enemy.Y;
                    float distSq = dx * dx + dy * dy;
                    if (distSq < bestSummonDistSq) { bestSummonDistSq = distSq; summonTarget = hostile; }
                }

                if (summonTarget == null) continue;

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

                    // >>> ENEMY ATTACK SPEED SCALING <<<
                    float attackSpeedPct = enemy.GetTotalStat("attackSpeedPercent", configs);
                    weapon.CurrentCooldown = wCfgS.CooldownSeconds / Math.Max(0.1f, (1f + attackSpeedPct));

                    float entityScale = 1.0f;
                    if (configs.Enemies.TryGetValue(enemy.ConfigId, out var eCfg)) entityScale = eCfg.Scale;
                    float offset = (40f * entityScale) + 30f;
                    float spawnX = enemy.X;
                    float spawnY = enemy.Y;

                    if (weapon.SlotIndex == 0) spawnX += offset;
                    else if (weapon.SlotIndex == 1) spawnX -= offset;
                    else if (weapon.SlotIndex == 2) spawnY -= offset;
                    else if (weapon.SlotIndex == 3) spawnY += offset;

                    float summonDirX = summonTarget.X - spawnX;
                    float summonDirY = summonTarget.Y - spawnY;
                    float summonDirLen = (float)Math.Sqrt(summonDirX * summonDirX + summonDirY * summonDirY);
                    if (summonDirLen <= 0) continue;

                    // >>> CRIT IMPLEMENTED HERE <<<
                    var (physDmg, magicDmg, isCrit) = CalculateWeaponDamageSplit(enemy, wCfgS, weapon, configs);

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

                    var newBullets = ProjectileFactory.Create(
                        pCfg2, enemy.Id, enemy.Team,
                        spawnX, spawnY, summonDirX, summonDirY,
                        physDmg, magicDmg,
                        finalSpeed2, 0f, wCfgS.ApplyEffectsOnHit, 1, lifespan2,
                        isCrit // <<< PASS CRIT TO FACTORY
                    );

                    foreach (var b in newBullets) state.Projectiles.TryAdd(b.Id, b);
                }
                continue;
            }

            // Find the closest player OR friendly summon to aim at
            float bestDistSq = float.MaxValue;
            float targetX = 0;
            float targetY = 0;
            bool foundTarget = false;

            // 1. Check for closest Player
            foreach (var player in state.Players.Values)
            {
                float dx = player.X - enemy.X;
                float dy = player.Y - enemy.Y;
                float distSq = dx * dx + dy * dy;
                if (distSq < bestDistSq) { bestDistSq = distSq; targetX = player.X; targetY = player.Y; foundTarget = true; }
            }

            // 2. Check for closest Friendly Summon
            foreach (var summon in state.Enemies.Values)
            {
                if (summon.ActionState == "Dead" || summon.Id == enemy.Id) continue;
                if (summon.Team != "Enemy")
                {
                    float dx = summon.X - enemy.X;
                    float dy = summon.Y - enemy.Y;
                    float distSq = dx * dx + dy * dy;
                    if (distSq < bestDistSq) { bestDistSq = distSq; targetX = summon.X; targetY = summon.Y; foundTarget = true; }
                }
            }

            if (!foundTarget) continue;

            enemy.AimX = targetX;
            enemy.AimY = targetY;

            float attackRadius = 300f;
            if (configs.Enemies.TryGetValue(enemy.ConfigId, out var enemyCfg))
                attackRadius = enemyCfg.AttackRadius;

            if (bestDistSq > attackRadius * attackRadius) continue;

            foreach (var weapon in enemy.Weapons)
            {
                weapon.CurrentCooldown -= dt;
                if (weapon.CurrentCooldown > 0) continue;

                if (!configs.Weapons.TryGetValue(weapon.ConfigId, out var weaponConfig)) continue;

                // >>> ENEMY ATTACK SPEED SCALING <<<
                float attackSpeedPct = enemy.GetTotalStat("attackSpeedPercent", configs);
                weapon.CurrentCooldown = weaponConfig.CooldownSeconds / Math.Max(0.1f, (1f + attackSpeedPct));

                float entityScale = 1.0f;
                if (configs.Enemies.TryGetValue(enemy.ConfigId, out var eCfg)) entityScale = eCfg.Scale;
                float offset = (40f * entityScale) + 30f;

                float spawnX = enemy.X;
                float spawnY = enemy.Y;

                if (weapon.SlotIndex == 0) spawnX += offset;
                else if (weapon.SlotIndex == 1) spawnX -= offset;
                else if (weapon.SlotIndex == 2) spawnY -= offset;
                else if (weapon.SlotIndex == 3) spawnY += offset;

                float dirToTargetX = targetX - spawnX;
                float dirToTargetY = targetY - spawnY;
                float dirLength = (float)Math.Sqrt(dirToTargetX * dirToTargetX + dirToTargetY * dirToTargetY);
                if (dirLength <= 0) continue;

                // >>> CRIT IMPLEMENTED HERE <<<
                var (physDmg, magicDmg, isCrit) = CalculateWeaponDamageSplit(enemy, weaponConfig, weapon, configs);

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

                if (projConfig.MovementBehavior == "Cleave" || projConfig.MovementBehavior == "Whirlwind")
                {
                    spawnX = enemy.X;
                    spawnY = enemy.Y;
                }

                var newBullets = ProjectileFactory.Create(
                    projConfig, enemy.Id, enemy.Team,
                    spawnX, spawnY, dirToTargetX, dirToTargetY,
                    physDmg, magicDmg,
                    finalSpeed, 0f, weaponConfig.ApplyEffectsOnHit, 1, computedLifespan,
                    isCrit // <<< PASS CRIT TO FACTORY
                );

                foreach (var b in newBullets) state.Projectiles.TryAdd(b.Id, b);
            }
        }
    }

    public static void ProcessCollisions(float dt, GameState state, ConfigManager configs, List<DamageEventDto> tickDamageEvents, List<AoeEventDto> tickAoeEvents, List<BeamEventDto> tickBeamEvents)
    {
        var projectilesToRemove = new List<string>();
        var pickupsToRemove = new List<string>();

        // 1. Projectiles vs Enemies
        foreach (var proj in state.Projectiles.Values)
        {
            float prevX = proj.X;
            float prevY = proj.Y;

            if (proj.MovementBehavior == "Orbital")
            {
                BaseActorEntity owner = null;
                if (state.Players.TryGetValue(proj.OwnerId, out var p)) owner = p;
                else if (state.Enemies.TryGetValue(proj.OwnerId, out var e)) owner = e;

                if (owner != null && owner.ActionState != "Dead")
                {
                    float radiansPerSec = proj.OrbitSpeed * (float)(Math.PI / 180.0);
                    proj.OrbitAngleOffset += radiansPerSec * dt;

                    proj.X = owner.X + (float)Math.Cos(proj.OrbitAngleOffset) * proj.OrbitRadius;
                    proj.Y = owner.Y + (float)Math.Sin(proj.OrbitAngleOffset) * proj.OrbitRadius;
                }
                else
                {
                    proj.Lifespan = 0;
                }
            }
            else
            {
                proj.X += proj.VelX * dt;
                proj.Y += proj.VelY * dt;
            }

            proj.Lifespan -= dt;

            if (!string.IsNullOrEmpty(proj.TickSkillId) && configs.Skills.TryGetValue(proj.TickSkillId, out var tickSkill))
            {
                proj.TimeSinceLastTick += dt;

                float effectiveTickRate = proj.TickRate > 0 ? proj.TickRate : tickSkill.CooldownSeconds;
                if (effectiveTickRate <= 0) effectiveTickRate = 0.1f;

                if (proj.TimeSinceLastTick >= effectiveTickRate)
                {
                    proj.TimeSinceLastTick %= effectiveTickRate;
                    SkillSystem.ExecuteSkill(tickSkill, proj.OwnerId, proj.X, proj.Y, proj.Team, tickDamageEvents, tickAoeEvents, tickBeamEvents, state, configs, proj);
                }
            }

            bool isDead = proj.Lifespan <= 0 || proj.HitEnemies.Count > proj.PierceCount;

            if (isDead)
            {
                if (!projectilesToRemove.Contains(proj.Id))
                {
                    projectilesToRemove.Add(proj.Id);

                    if (!string.IsNullOrEmpty(proj.OnDeathSkillId) && configs.Skills.TryGetValue(proj.OnDeathSkillId, out var deathSkill))
                    {
                        SkillSystem.ExecuteSkill(deathSkill, proj.OwnerId, proj.X, proj.Y, proj.Team, tickDamageEvents, tickAoeEvents, tickBeamEvents, state, configs);
                    }
                }
                continue;
            }

            bool isPlayerProjectile = state.Players.ContainsKey(proj.OwnerId) ||
                (state.Enemies.TryGetValue(proj.OwnerId, out var projOwner) && projOwner.Team != "Enemy");

            if (isPlayerProjectile)
            {
                foreach (var enemy in state.Enemies.Values)
                {
                    if (enemy.ActionState == "Dead" || proj.HitEnemies.Contains(enemy.Id)) continue;
                    if (enemy.Team != "Enemy") continue;

                    float combinedRadius = proj.HitRadius + enemy.HitRadius;
                    float hitThresholdSq = combinedRadius * combinedRadius;

                    bool isHit = false;

                    if (proj.MovementBehavior == "Orbital")
                    {
                        float distX = proj.X - enemy.X;
                        float distY = proj.Y - enemy.Y;
                        isHit = (distX * distX) + (distY * distY) <= hitThresholdSq;
                    }
                    else
                    {
                        float dx = proj.X - prevX; float dy = proj.Y - prevY;
                        float fx = enemy.X - prevX; float fy = enemy.Y - prevY;

                        float lengthSq = (dx * dx) + (dy * dy);
                        float t = lengthSq == 0 ? 0 : Math.Max(0, Math.Min(1, (fx * dx + fy * dy) / lengthSq));

                        float closestX = prevX + t * dx; float closestY = prevY + t * dy;
                        float distX = closestX - enemy.X; float distY = closestY - enemy.Y;

                        isHit = (distX * distX) + (distY * distY) <= hitThresholdSq;
                    }

                    if (isHit)
                    {
                        // >>> ENEMY DODGE LOGIC <<<
                        float dodgeChance = Math.Clamp(enemy.GetTotalStat("dodge", configs), 0f, 0.9f);
                        if (dodgeChance > 0 && Random.Shared.NextDouble() <= dodgeChance)
                        {
                            tickDamageEvents.Add(new DamageEventDto { X = enemy.X, Y = enemy.Y, Amount = 0, IsDodge = true });
                            proj.HitEnemies.Add(enemy.Id);
                            // Even if dodged, it counts towards the projectile's pierce limit
                            if (proj.HitEnemies.Count > proj.PierceCount && !projectilesToRemove.Contains(proj.Id))
                                projectilesToRemove.Add(proj.Id);
                            continue; // Skip the damage logic!
                        }

                        // 1. Mitigate & Apply Damage
                        float finalDamage = CalculateMitigatedDamage(proj.PhysicalDamage, proj.MagicDamage, enemy, configs);
                        // =========================================================================
                        // FUTURE: REAL DAMAGE TRACKING PREP 
                        // =========================================================================
                        // If you add a "TotalDamageDealt" property to PlayerEntity, you can tally it here!
                        // if (state.Players.TryGetValue(proj.OwnerId, out var damageOwner)) {
                        //     damageOwner.TotalDamageDealt += finalDamage;
                        // }
                        // =========================================================================

                        enemy.CurrentHp -= finalDamage;
                        proj.HitEnemies.Add(enemy.Id);

                        // Pass the critical flag to the Damage DTO for the frontend UI pop!
                        tickDamageEvents.Add(new DamageEventDto { X = enemy.X, Y = enemy.Y, Amount = finalDamage, IsCritical = proj.IsCritical });

                        // 2. Apply Status Effects
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

                        // 3. Life Steal
                        if (Random.Shared.NextDouble() < proj.LifeStealChance)
                        {
                            if (state.Players.TryGetValue(proj.OwnerId, out var playerToHeal))
                            {
                                float maxHp = playerToHeal.GetTotalStat("maxHp", configs);
                                playerToHeal.CurrentHp = Math.Min(maxHp, playerToHeal.CurrentHp + 1f);
                            }
                        }

                        // 4. THE DEATH CHECK & HARVESTING
                        if (enemy.CurrentHp <= 0 && enemy.ActionState != "Dead")
                        {
                            enemy.ActionState = "Dead";

                            // >>> HARVESTING LOGIC <<<
                            int bonusGold = 0;
                            // proj.OwnerId is our killerId
                            if (state.Players.TryGetValue(proj.OwnerId, out var killer))
                            {
                                float harvesting = killer.GetTotalStat("harvesting", configs);
                                bonusGold = (int)Math.Floor(harvesting / 100f);
                                if (Random.Shared.NextDouble() < (harvesting % 100f) / 100f)
                                {
                                    bonusGold++;
                                }
                            }

                            // Add the bonus gold to the drop
                            var gold = new PickupEntity { X = enemy.X, Y = enemy.Y, Value = 1 + bonusGold };
                            state.Pickups.TryAdd(gold.Id, gold);

                            if (configs.Enemies.TryGetValue(enemy.ConfigId, out var eCfg))
                            {
                                SpawnGearDrops(enemy, eCfg, state, configs);
                                SkillSystem.FireOnDeathSkills(enemy.Id, enemy.X, enemy.Y, enemy.Team, eCfg.OnDeathSkills, state, configs, tickDamageEvents, tickAoeEvents, tickBeamEvents);
                            }
                        }

                        // 5. Pierce Check
                        if (proj.HitEnemies.Count > proj.PierceCount)
                        {
                            if (!projectilesToRemove.Contains(proj.Id))
                            {
                                projectilesToRemove.Add(proj.Id);
                                if (!string.IsNullOrEmpty(proj.OnDeathSkillId) && configs.Skills.TryGetValue(proj.OnDeathSkillId, out var deathSkill))
                                {
                                    SkillSystem.ExecuteSkill(deathSkill, proj.OwnerId, proj.X, proj.Y, proj.Team, tickDamageEvents, tickAoeEvents, tickBeamEvents, state, configs);
                                }
                            }
                            break;
                        }
                    }
                }
            }
            else
            {
                // 1. Hostile projectiles hitting Players
                foreach (var player in state.Players.Values)
                {
                    if (proj.HitEnemies.Contains(player.ConnectionId)) continue;

                    float combinedRadius = proj.HitRadius + 15f;
                    float hitThresholdSq = combinedRadius * combinedRadius;

                    float dx = proj.X - prevX; float dy = proj.Y - prevY;
                    float fx = player.X - prevX; float fy = player.Y - prevY;

                    float lengthSq = (dx * dx) + (dy * dy);
                    float t = lengthSq == 0 ? 0 : Math.Max(0, Math.Min(1, (fx * dx + fy * dy) / lengthSq));

                    float closestX = prevX + t * dx; float closestY = prevY + t * dy;
                    float distX = closestX - player.X; float distY = closestY - player.Y;
                    float distSqToSegment = (distX * distX) + (distY * distY);

                    if (distSqToSegment <= hitThresholdSq)
                    {
                        // >>> 2. NEW DODGE & BLOCK LOGIC <<<
                        // A. Check Dodge (Passes through but deals 0 damage)
                        float dodgeChance = Math.Clamp(player.GetTotalStat("dodge", configs), 0f, 0.9f); // Hard cap at 90%
                        if (dodgeChance > 0 && Random.Shared.NextDouble() <= dodgeChance)
                        {
                            tickDamageEvents.Add(new DamageEventDto { X = player.X, Y = player.Y, Amount = 0, IsDodge = true });
                            proj.HitEnemies.Add(player.ConnectionId);
                            if (proj.HitEnemies.Count > proj.PierceCount) projectilesToRemove.Add(proj.Id);
                            continue;
                        }

                        // B. Check Block (Destroys the projectile instantly)
                        float blockChance = Math.Clamp(player.GetEngineMechanic("projectileBlockChance", configs), 0f, 0.9f);
                        if (blockChance > 0 && Random.Shared.NextDouble() <= blockChance)
                        {
                            tickDamageEvents.Add(new DamageEventDto { X = player.X, Y = player.Y, Amount = 0, IsBlock = true });
                            if (!projectilesToRemove.Contains(proj.Id)) projectilesToRemove.Add(proj.Id);
                            break;
                        }

                        float finalDamage = CalculateMitigatedDamage(proj.PhysicalDamage, proj.MagicDamage, player, configs); player.CurrentHp -= finalDamage;
                        proj.HitEnemies.Add(player.ConnectionId);

                        tickDamageEvents.Add(new DamageEventDto { X = player.X, Y = player.Y, Amount = finalDamage, IsCritical = proj.IsCritical });

                        if (proj.ApplyEffectsOnHit != null)
                        {
                            foreach (var effectId in proj.ApplyEffectsOnHit)
                            {
                                if (configs.Effects.TryGetValue(effectId, out var effectConfig))
                                {
                                    var existing = player.ActiveEffects.FirstOrDefault(e => e.ConfigId == effectId);
                                    if (existing != null) existing.TimeRemaining = effectConfig.Duration;
                                    else player.ActiveEffects.Add(new ActiveEffect { ConfigId = effectId, TimeRemaining = effectConfig.Duration });
                                }
                            }
                        }

                        if (proj.HitEnemies.Count > proj.PierceCount)
                        {
                            projectilesToRemove.Add(proj.Id);
                            break;
                        }
                    }
                }

                // 2. Hostile projectiles hitting Friendly Summons
                if (!projectilesToRemove.Contains(proj.Id))
                {
                    foreach (var summon in state.Enemies.Values)
                    {
                        if (summon.ActionState == "Dead" || summon.Team == "Enemy" || proj.HitEnemies.Contains(summon.Id)) continue;

                        float combinedRadius = proj.HitRadius + summon.HitRadius;
                        float hitThresholdSq = combinedRadius * combinedRadius;

                        float dx = proj.X - prevX; float dy = proj.Y - prevY;
                        float fx = summon.X - prevX; float fy = summon.Y - prevY;

                        float lengthSq = (dx * dx) + (dy * dy);
                        float t = lengthSq == 0 ? 0 : Math.Max(0, Math.Min(1, (fx * dx + fy * dy) / lengthSq));

                        float closestX = prevX + t * dx; float closestY = prevY + t * dy;
                        float distX = closestX - summon.X; float distY = closestY - summon.Y;
                        float distSqToSegment = (distX * distX) + (distY * distY);

                        if (distSqToSegment <= hitThresholdSq)
                        {
                            // >>> SUMMON DODGE LOGIC <<<
                            float dodgeChance = Math.Clamp(summon.GetTotalStat("dodge", configs), 0f, 0.9f);
                            if (dodgeChance > 0 && Random.Shared.NextDouble() <= dodgeChance)
                            {
                                tickDamageEvents.Add(new DamageEventDto { X = summon.X, Y = summon.Y, Amount = 0, IsDodge = true });
                                proj.HitEnemies.Add(summon.Id);
                                if (proj.HitEnemies.Count > proj.PierceCount && !projectilesToRemove.Contains(proj.Id))
                                    projectilesToRemove.Add(proj.Id);
                                continue;
                            }

                            float finalDamage = CalculateMitigatedDamage(proj.PhysicalDamage, proj.MagicDamage, summon, configs);
                            summon.CurrentHp -= finalDamage;
                            proj.HitEnemies.Add(summon.Id);

                            tickDamageEvents.Add(new DamageEventDto { X = summon.X, Y = summon.Y, Amount = finalDamage, IsCritical = proj.IsCritical });

                            if (proj.ApplyEffectsOnHit != null)
                            {
                                foreach (var effectId in proj.ApplyEffectsOnHit)
                                {
                                    if (configs.Effects.TryGetValue(effectId, out var effectConfig))
                                    {
                                        var existing = summon.ActiveEffects.FirstOrDefault(e => e.ConfigId == effectId);
                                        if (existing != null) existing.TimeRemaining = effectConfig.Duration;
                                        else summon.ActiveEffects.Add(new ActiveEffect { ConfigId = effectId, TimeRemaining = effectConfig.Duration });
                                    }
                                }
                            }

                            if (summon.CurrentHp <= 0 && summon.ActionState != "Dead")
                            {
                                summon.ActionState = "Dead";
                                if (configs.Enemies.TryGetValue(summon.ConfigId, out var eCfg))
                                    SkillSystem.FireOnDeathSkills(summon.Id, summon.X, summon.Y, summon.Team, eCfg.OnDeathSkills, state, configs, tickDamageEvents, tickAoeEvents, tickBeamEvents);
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
                    if (pickup.Type == PickupType.Gold)
                    {
                        player.Gold += pickup.Value;
                        player.GainXp(pickup.Value, configs);
                        pickupsToRemove.Add(pickup.Id);
                    }
                }
            }
        }

        // 3. Enemy Normal Attacks (Contact / Bump Damage)
        foreach (var enemy in state.Enemies.Values)
        {
            if (enemy.ActionState == "Dead") continue;
            if (!configs.Enemies.TryGetValue(enemy.ConfigId, out var enemyCfg)) continue;

            if (enemy.Weapons.Count > 0) continue;

            // >>> 1. CALCULATE ATTACK SPEED & SHRINK DURATION <<<
            float attackSpeedPct = Math.Max(0f, enemy.GetTotalStat("attackSpeedPercent", configs));
            float scaledDuration = enemyCfg.AttackDuration / (1f + attackSpeedPct);

            // >>> FIX: BLOCK MELEE ATTACKS IF ROOTED BY A SPELL <<<
            bool isRootedBySpell = false;
            if (enemy.ActionState == "Casting" && !string.IsNullOrEmpty(enemy.CurrentCastingSkillId))
            {
                if (configs.Skills.TryGetValue(enemy.CurrentCastingSkillId, out var eCastCfg) && eCastCfg.StopMoving)
                {
                    isRootedBySpell = true;
                }
            }

            // >>> 2. USE THE SCALED DURATION IN THE CHECK <<<
            if (!isRootedBySpell && (enemy.ActionState == "Attacking" || enemy.ActionState == "Casting") && Math.Abs(enemy.AttackCooldown - scaledDuration) < (dt * 2))
            {
                float meleeDmg = enemy.GetTotalStat("meleeDamage", configs);
                if (meleeDmg <= 0) continue;

                float attackRadiusSq = enemyCfg.AttackRadius * enemyCfg.AttackRadius;

                if (enemy.Team == "Enemy")
                {
                    foreach (var player in state.Players.Values)
                    {
                        float distSq = (player.X - enemy.X) * (player.X - enemy.X) + (player.Y - enemy.Y) * (player.Y - enemy.Y);
                        if (distSq <= attackRadiusSq)
                        {
                            // >>> 3. NEW MELEE DODGE LOGIC <<<
                            float dodgeChance = Math.Clamp(player.GetTotalStat("dodge", configs), 0f, 0.9f);
                            if (dodgeChance > 0 && Random.Shared.NextDouble() <= dodgeChance)
                            {
                                tickDamageEvents.Add(new DamageEventDto { X = player.X, Y = player.Y, Amount = 0, IsDodge = true });
                                continue; // Skip damage!
                            }

                            player.CurrentHp -= meleeDmg;
                            tickDamageEvents.Add(new DamageEventDto { X = player.X, Y = player.Y, Amount = meleeDmg, IsCritical = false });
                        }
                    }

                    foreach (var summon in state.Enemies.Values)
                    {
                        if (summon.ActionState == "Dead" || summon.Team == "Enemy") continue;
                        float distSq = (summon.X - enemy.X) * (summon.X - enemy.X) + (summon.Y - enemy.Y) * (summon.Y - enemy.Y);
                        if (distSq <= attackRadiusSq)
                        {
                            float dodgeChance = Math.Clamp(summon.GetTotalStat("dodge", configs), 0f, 0.9f);
                            if (dodgeChance > 0 && Random.Shared.NextDouble() <= dodgeChance)
                            {
                                tickDamageEvents.Add(new DamageEventDto { X = summon.X, Y = summon.Y, Amount = 0, IsDodge = true });
                                continue;
                            }

                            summon.CurrentHp -= meleeDmg;
                            tickDamageEvents.Add(new DamageEventDto { X = summon.X, Y = summon.Y, Amount = meleeDmg, IsCritical = false });
                        }
                    }
                }
                else
                {
                    foreach (var hostile in state.Enemies.Values)
                    {
                        if (hostile.ActionState == "Dead" || hostile.Team != "Enemy") continue;
                        float distSq = (hostile.X - enemy.X) * (hostile.X - enemy.X) + (hostile.Y - enemy.Y) * (hostile.Y - enemy.Y);
                        if (distSq <= attackRadiusSq)
                        {
                            float dodgeChance = Math.Clamp(hostile.GetTotalStat("dodge", configs), 0f, 0.9f);
                            if (dodgeChance > 0 && Random.Shared.NextDouble() <= dodgeChance)
                            {
                                tickDamageEvents.Add(new DamageEventDto { X = hostile.X, Y = hostile.Y, Amount = 0, IsDodge = true });
                                continue;
                            }

                            hostile.CurrentHp -= meleeDmg;
                            tickDamageEvents.Add(new DamageEventDto { X = hostile.X, Y = hostile.Y, Amount = meleeDmg, IsCritical = false });
                        }
                    }
                }
            }
        }

        foreach (var id in projectilesToRemove) state.Projectiles.TryRemove(id, out _);
        foreach (var id in pickupsToRemove) state.Pickups.TryRemove(id, out _);
    }

    public static float CalculateMitigatedDamage(float physDmg, float magicDmg, BaseActorEntity target, ConfigManager configs)
    {
        float armor = Math.Max(0f, target.GetTotalStat("armor", configs));
        float magicDef = Math.Max(0f, target.GetTotalStat("magicDefense", configs));

        float physMult = 100f / (100f + armor);
        float magicMult = 100f / (100f + magicDef);

        return (physDmg * physMult) + (magicDmg * magicMult);
    }

    // =========================================================================
    // DRY HELPER: WEAPON MATH (CRIT IMPLEMENTED HERE)
    // =========================================================================
    public static (float phys, float magic, bool isCrit) CalculateWeaponDamageSplit(BaseActorEntity actor, WeaponConfig wCfg, EquippedWeapon weapon, ConfigManager configs)
    {
        float baseMelee = weapon.TotalBaseStats.GetValueOrDefault("meleeDamage", 0f) + weapon.RolledStats.GetValueOrDefault("meleeDamage", 0f);
        float baseRanged = weapon.TotalBaseStats.GetValueOrDefault("rangedDamage", 0f) + weapon.RolledStats.GetValueOrDefault("rangedDamage", 0f);
        float baseMagic = weapon.TotalBaseStats.GetValueOrDefault("magicDamage", 0f) + weapon.RolledStats.GetValueOrDefault("magicDamage", 0f);

        float physDamage = baseMelee + baseRanged;
        float magicDamage = baseMagic;

        if (wCfg.DamageScaling != null)
        {
            foreach (var scale in wCfg.DamageScaling)
            {
                float bonus = actor.GetTotalStat(scale.Key, configs) * scale.Value;
                if (scale.Key == "magicDamage" || scale.Key == "elementalDamage") magicDamage += bonus;
                else physDamage += bonus;
            }
        }

        float damagePercent = actor.GetTotalStat("damagePercent", configs);
        physDamage *= (1f + damagePercent);
        magicDamage *= (1f + damagePercent);

        // --- CRIT LOGIC ---
        bool isCrit = false;
        float critChance = Math.Clamp(actor.GetTotalStat("critChance", configs), 0f, 1f);

        // Crit strictly affects physical (melee/ranged) damage
        if (physDamage > 0 && Random.Shared.NextDouble() <= critChance)
        {
            isCrit = true;
            // Provide a minimum floor of 1.5x in case the player hasn't built any Crit Mult yet
            float critMult = Math.Max(1.5f, actor.GetTotalStat("critMultiplier", configs));
            physDamage *= critMult;
        }

        return (physDamage, magicDamage, isCrit);
    }

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