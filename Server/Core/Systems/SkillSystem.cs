using Server.Configs;
using Server.DTOs;
using Server.Entities;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Server.Core.Systems;

public static class SkillSystem
{
    public static void Process(float dt, GameState state, ConfigManager configs, List<DamageEventDto> damageEvents, List<AoeEventDto> aoeEvents)
    {
        // 1. Process Enemy Skills
        foreach (var enemy in state.Enemies.Values)
        {
            if (enemy.ActionState == "Dead") continue;

            if (configs.Enemies.TryGetValue(enemy.ConfigId, out var eConfig) && eConfig.DynamicSkills != null)
            {
                foreach (var trigger in eConfig.DynamicSkills)
                {
                    if (!enemy.DynamicSkillTimers.ContainsKey(trigger.SkillId)) enemy.DynamicSkillTimers[trigger.SkillId] = 0;
                    if (enemy.DynamicSkillTimers[trigger.SkillId] > 0) enemy.DynamicSkillTimers[trigger.SkillId] -= dt;

                    if (trigger.ConditionType == "MissingHealthPercent" && enemy.DynamicSkillTimers[trigger.SkillId] <= 0)
                    {
                        float hpPct = enemy.CurrentHp / enemy.GetTotalStat("maxHp", configs);
                        if (hpPct <= trigger.ConditionThreshold && configs.Skills.TryGetValue(trigger.SkillId, out var skillConfig))
                        {
                            if (enemy.CurrentCastingSkillId == trigger.SkillId) continue; // Don't interrupt itself!

                            float castTime = trigger.OverrideCastTime ?? skillConfig.CastTimeSeconds;
                            enemy.ActionState = "Casting";
                            enemy.CurrentCastingSkillId = trigger.SkillId;
                            enemy.MaxCastTimer = castTime;
                            enemy.CurrentCastTimer = castTime;
                            enemy.DynamicSkillTimers[trigger.SkillId] = trigger.Cooldown;

                            if (castTime <= 0)
                            {
                                ExecuteSkill(skillConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, state, configs);
                                enemy.ActionState = "Idle";
                                enemy.CurrentCastingSkillId = string.Empty;
                            }
                        }
                    }
                }
            }

            // >>> THE BULLETPROOF CASTING PIPELINE <<<
            // By checking the Timer instead of the State, spells can never be accidentally aborted!
            if (!string.IsNullOrEmpty(enemy.CurrentCastingSkillId) && enemy.CurrentCastTimer > 0)
            {
                enemy.ActionState = "Casting"; // FORCE the state so the client UI always shows it!
                enemy.CurrentCastTimer -= dt;
                if (enemy.CurrentCastTimer <= 0)
                {
                    if (configs.Skills.TryGetValue(enemy.CurrentCastingSkillId, out var castConfig))
                    {
                        ExecuteSkill(castConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, state, configs);
                    }
                    enemy.ActionState = "Idle";
                    enemy.CurrentCastingSkillId = string.Empty;
                }
            }
            else
            {
                foreach (var skill in enemy.Skills)
                {
                    skill.CurrentCooldown -= dt;
                    if (skill.CurrentCooldown <= 0 && configs.Skills.TryGetValue(skill.ConfigId, out var config) && config.TriggerType == SkillTriggerType.Auto)
                    {
                        enemy.ActionState = "Casting";
                        enemy.CurrentCastingSkillId = skill.ConfigId;
                        enemy.MaxCastTimer = config.CastTimeSeconds;
                        enemy.CurrentCastTimer = config.CastTimeSeconds;
                        skill.CurrentCooldown = config.CooldownSeconds;
                        break;
                    }
                }
            }
        }

        // 2. Process Player Skills
        foreach (var player in state.Players.Values)
        {
            if (player.ActionState == "Dead") continue;

            if (configs.Characters.TryGetValue(player.ConfigId, out var pConfig) && pConfig.DynamicSkills != null)
            {
                foreach (var trigger in pConfig.DynamicSkills)
                {
                    if (!player.DynamicSkillTimers.ContainsKey(trigger.SkillId)) player.DynamicSkillTimers[trigger.SkillId] = 0;
                    if (player.DynamicSkillTimers[trigger.SkillId] > 0) player.DynamicSkillTimers[trigger.SkillId] -= dt;

                    if (trigger.ConditionType == "MissingHealthPercent" && player.DynamicSkillTimers[trigger.SkillId] <= 0)
                    {
                        float hpPct = player.CurrentHp / player.GetTotalStat("maxHp", configs);
                        if (hpPct <= trigger.ConditionThreshold && configs.Skills.TryGetValue(trigger.SkillId, out var skillConfig))
                        {
                            if (player.CurrentCastingSkillId == trigger.SkillId) continue;

                            float castTime = trigger.OverrideCastTime ?? skillConfig.CastTimeSeconds;
                            player.ActionState = "Casting";
                            player.CurrentCastingSkillId = trigger.SkillId;
                            player.MaxCastTimer = castTime;
                            player.CurrentCastTimer = castTime;
                            player.DynamicSkillTimers[trigger.SkillId] = trigger.Cooldown;

                            if (castTime <= 0)
                            {
                                ExecuteSkill(skillConfig, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, state, configs);
                                player.ActionState = "Idle";
                                player.CurrentCastingSkillId = string.Empty;
                            }
                        }
                    }
                }
            }

            // >>> THE BULLETPROOF CASTING PIPELINE <<<
            if (!string.IsNullOrEmpty(player.CurrentCastingSkillId) && player.CurrentCastTimer > 0)
            {
                player.ActionState = "Casting"; // FORCE the state so client UI always shows it!
                player.CurrentCastTimer -= dt;
                if (player.CurrentCastTimer <= 0)
                {
                    if (configs.Skills.TryGetValue(player.CurrentCastingSkillId, out var castConfig))
                    {
                        ExecuteSkill(castConfig, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, state, configs);
                    }
                    player.ActionState = "Idle";
                    player.CurrentCastingSkillId = string.Empty;
                }
            }
            else
            {
                foreach (var skill in player.Skills)
                {
                    skill.CurrentCooldown -= dt;
                    if (skill.CurrentCooldown <= 0 && configs.Skills.TryGetValue(skill.ConfigId, out var config) && config.TriggerType == SkillTriggerType.Auto)
                    {
                        player.ActionState = "Casting";
                        player.CurrentCastingSkillId = skill.ConfigId;
                        player.MaxCastTimer = config.CastTimeSeconds;
                        player.CurrentCastTimer = config.CastTimeSeconds;
                        skill.CurrentCooldown = config.CooldownSeconds;
                        break;
                    }
                }
            }
        }
    }

    public static void ExecuteSkill(SkillConfig config, string casterId, float startX, float startY, string team,
        List<DamageEventDto> damageEvents, List<AoeEventDto> aoeEvents, GameState state, ConfigManager configs)
    {
        // --- ACTION: SELF BUFF ---
        if (config.ActionType == SkillActionType.SelfBuff)
        {
            if (team == "Player" && state.Players.TryGetValue(casterId, out var player))
            {
                foreach (var effect in config.ApplyEffects)
                {
                    var duration = configs.Effects.ContainsKey(effect) ? configs.Effects[effect].Duration : 3f;
                    player.ActiveEffects.Add(new ActiveEffect { ConfigId = effect, TimeRemaining = duration });
                }
            }
            else if (team == "Enemy" && state.Enemies.TryGetValue(casterId, out var enemy))
            {
                foreach (var effect in config.ApplyEffects)
                {
                    var duration = configs.Effects.ContainsKey(effect) ? configs.Effects[effect].Duration : 3f;
                    enemy.ActiveEffects.Add(new ActiveEffect { ConfigId = effect, TimeRemaining = duration });
                }
            }
            return;
        }



        // --- ACTION: PROJECTILE ---
        if (config.ActionType == SkillActionType.Projectile && configs.Projectiles.TryGetValue(config.ProjectileId, out var projConfig))
        {
            float targetX = startX + 1;
            float targetY = startY;

            if (config.TargetType == SkillTargetType.ClosestEnemy && team == "Player")
            {
                float closestDistSq = float.MaxValue;
                foreach (var enemy in state.Enemies.Values)
                {
                    if (enemy.ActionState == "Dead") continue;
                    float distSq = (enemy.X - startX) * (enemy.X - startX) + (enemy.Y - startY) * (enemy.Y - startY);
                    if (distSq < closestDistSq)
                    {
                        closestDistSq = distSq;
                        targetX = enemy.X;
                        targetY = enemy.Y;
                    }
                }
                if (closestDistSq == float.MaxValue) return;
            }
            else if (config.TargetType == SkillTargetType.ClosestPlayer && team == "Enemy")
            {
                float closestDistSq = float.MaxValue;
                foreach (var player in state.Players.Values)
                {
                    float distSq = (player.X - startX) * (player.X - startX) + (player.Y - startY) * (player.Y - startY);
                    if (distSq < closestDistSq)
                    {
                        closestDistSq = distSq;
                        targetX = player.X;
                        targetY = player.Y;
                    }
                }
                if (closestDistSq == float.MaxValue) return;
            }
            else if (config.TargetType == SkillTargetType.AimDirection && team == "Player")
            {
                if (state.Players.TryGetValue(casterId, out var p))
                {
                    targetX = p.AimX;
                    targetY = p.AimY;
                }
            }
            else if (config.TargetType == SkillTargetType.Self)
            {
                targetX = startX;
                targetY = startY;
            }

            float dirX = targetX - startX;
            float dirY = targetY - startY;
            float length = (float)Math.Sqrt(dirX * dirX + dirY * dirY);

            if (length > 0)
            {
                var bullet = new ProjectileEntity
                {
                    ConfigId = projConfig.Id,
                    OwnerId = casterId,
                    X = startX,
                    Y = startY,
                    VelX = (dirX / length) * projConfig.BaseSpeed,
                    VelY = (dirY / length) * projConfig.BaseSpeed,
                    Damage = config.BaseDamage,
                    HitRadius = projConfig.HitRadius,
                    Lifespan = 5f,
                    ApplyEffectsOnHit = new List<string>(config.ApplyEffects),
                    Team = team
                };

                state.Projectiles.TryAdd(bullet.Id, bullet);
            }
        }

        // --- ACTION: SUMMON ---
        // --- ACTION: SUMMON ---
        if (config.ActionType == SkillActionType.Summon)
        {
            if (configs.Enemies.TryGetValue(config.SummonConfigId, out var summonConfig))
            {
                // >>> THE FIX: Get the true dynamic map size! <<<
                float mapW = configs.Maps != null && configs.Maps.TryGetValue("map_forest", out var currentMap) ? currentMap.Width : 4000f;
                float mapH = configs.Maps != null && configs.Maps.TryGetValue("map_forest", out var currentMapH) ? currentMapH.Height : 4000f;

                for (int i = 0; i < config.SummonCount; i++)
                {
                    float angle = (float)(Random.Shared.NextDouble() * Math.PI * 2);
                    float dist = (float)(Random.Shared.NextDouble() * config.SummonRadius);
                    float spawnX = startX + (float)Math.Cos(angle) * dist;
                    float spawnY = startY + (float)Math.Sin(angle) * dist;

                    // >>> CLAMP TO THE ACTUAL MAP BOUNDARIES! <<<
                    spawnX = Math.Clamp(spawnX, 35, mapW - 35);
                    spawnY = Math.Clamp(spawnY, 35, mapH - 35);

                    var newSummon = new EnemyEntity();
                    newSummon.Initialize(summonConfig, spawnX, spawnY, configs);

                    newSummon.CurrentHp = newSummon.GetTotalStat("maxHp", configs);
                    newSummon.Team = team;

                    state.Enemies.TryAdd(newSummon.Id, newSummon);
                }
            }
            return;
        }

        // --- ACTION: UNIFIED AOE (Damage, Heal, & Effects) ---
        // --- ACTION: UNIFIED AOE (Damage, Heal, & Effects) ---
        if (config.ActionType == SkillActionType.AoE)
        {
            bool isHeal = config.BaseDamage < 0;
            float actualDamage = isHeal ? -Math.Abs(config.BaseDamage) : config.BaseDamage;

            // >>> FIX: Pass the config.Id to the DTO! <<<
            aoeEvents.Add(new AoeEventDto
            {
                X = startX,
                Y = startY,
                Radius = config.Radius,
                IsFriendly = isHeal || team == "Player",
                ConfigId = config.Id
            });

            float radiusSq = config.Radius * config.Radius;

            // Helper function to apply effects
            void ApplyAoeEffects(List<ActiveEffect> targetEffects)
            {
                if (config.ApplyEffects != null)
                {
                    foreach (var effectId in config.ApplyEffects)
                    {
                        if (configs.Effects.TryGetValue(effectId, out var effectConfig))
                        {
                            var existing = targetEffects.FirstOrDefault(e => e.ConfigId == effectId);
                            if (existing != null) existing.TimeRemaining = effectConfig.Duration;
                            else targetEffects.Add(new ActiveEffect { ConfigId = effectId, TimeRemaining = effectConfig.Duration });
                        }
                    }
                }
            }

            if (team == "Player")
            {
                if (!isHeal) // Hurt Enemies
                {
                    foreach (var enemy in state.Enemies.Values)
                    {
                        if (enemy.ActionState == "Dead") continue;
                        float distSq = (enemy.X - startX) * (enemy.X - startX) + (enemy.Y - startY) * (enemy.Y - startY);
                        if (distSq <= radiusSq)
                        {
                            enemy.CurrentHp -= actualDamage;
                            damageEvents.Add(new DamageEventDto { X = enemy.X, Y = enemy.Y, Amount = actualDamage });

                            // >>> FIX 1: Apply Stuns/Debuffs here! <<<
                            ApplyAoeEffects(enemy.ActiveEffects);

                            if (enemy.CurrentHp <= 0 && enemy.ActionState != "Dead")
                            {
                                enemy.ActionState = "Dead";
                                var gold = new PickupEntity { X = enemy.X, Y = enemy.Y, Value = 1 };
                                state.Pickups.TryAdd(gold.Id, gold);

                                // >>> THE FIX: Enemies killed by AoE spells now trigger Death Skills! <<<
                                if (configs.Enemies.TryGetValue(enemy.ConfigId, out var eCfg))
                                {
                                    FireOnDeathSkills(enemy.Id, enemy.X, enemy.Y, enemy.Team, eCfg.OnDeathSkills, state, configs, damageEvents, aoeEvents);
                                }
                            }
                        }
                    }
                }
                else // Heal Players
                {
                    foreach (var ally in state.Players.Values)
                    {
                        float distSq = (ally.X - startX) * (ally.X - startX) + (ally.Y - startY) * (ally.Y - startY);
                        if (distSq <= radiusSq)
                        {
                            float maxHp = ally.GetTotalStat("maxHp", configs);
                            float healAmount = Math.Min(Math.Abs(actualDamage), maxHp - ally.CurrentHp);
                            ally.CurrentHp += healAmount;

                            if (healAmount > 0) damageEvents.Add(new DamageEventDto { X = ally.X, Y = ally.Y, Amount = -healAmount });

                            // >>> Buffs (like Adrenaline) applied to healed allies! <<<
                            ApplyAoeEffects(ally.ActiveEffects);
                        }
                    }
                }
            }
            else if (team == "Enemy")
            {
                if (!isHeal) // Hurt Players
                {
                    foreach (var player in state.Players.Values)
                    {
                        float distSq = (player.X - startX) * (player.X - startX) + (player.Y - startY) * (player.Y - startY);
                        if (distSq <= radiusSq)
                        {
                            player.CurrentHp -= actualDamage;
                            damageEvents.Add(new DamageEventDto { X = player.X, Y = player.Y, Amount = actualDamage });
                            ApplyAoeEffects(player.ActiveEffects);
                        }
                    }
                }
                else // Heal Enemies (Boss healing its minions!)
                {
                    foreach (var ally in state.Enemies.Values)
                    {
                        if (ally.ActionState == "Dead") continue;
                        float distSq = (ally.X - startX) * (ally.X - startX) + (ally.Y - startY) * (ally.Y - startY);
                        if (distSq <= radiusSq)
                        {
                            float maxHp = ally.GetTotalStat("maxHp", configs);
                            float healAmount = Math.Min(Math.Abs(actualDamage), maxHp - ally.CurrentHp);
                            ally.CurrentHp += healAmount;

                            if (healAmount > 0) damageEvents.Add(new DamageEventDto { X = ally.X, Y = ally.Y, Amount = -healAmount });
                            ApplyAoeEffects(ally.ActiveEffects);
                        }
                    }
                }
            }
            return;
        }
    }
    public static void FireOnDeathSkills(string entityId, float x, float y, string team, List<string> onDeathSkills, GameState state, ConfigManager configs, List<DamageEventDto> damageEvents, List<AoeEventDto> aoeEvents)
    {
        if (onDeathSkills == null) return;
        foreach (var skillId in onDeathSkills)
        {
            if (configs.Skills.TryGetValue(skillId, out var skillConfig))
            {
                // Instantly execute the skill at the location where they died!
                ExecuteSkill(skillConfig, entityId, x, y, team, damageEvents, aoeEvents, state, configs);
            }
        }
    }
}