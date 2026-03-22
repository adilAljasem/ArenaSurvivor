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

            foreach (var skill in enemy.Skills)
            {
                if (!configs.Skills.TryGetValue(skill.ConfigId, out var config)) continue;

                if (skill.IsCasting)
                {
                    skill.CurrentCastTimer -= dt;
                    enemy.CurrentCastTimer = skill.CurrentCastTimer;

                    if (skill.CurrentCastTimer <= 0)
                    {
                        ExecuteSkill(config, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, state, configs);
                        skill.IsCasting = false;
                        skill.CurrentCooldown = config.CooldownSeconds;
                        enemy.ActionState = "Idle";
                        enemy.CurrentCastingSkillId = string.Empty;
                        enemy.CurrentCastTimer = 0;
                    }
                }
                else
                {
                    skill.CurrentCooldown -= dt;
                    if (skill.CurrentCooldown <= 0 && config.TriggerType == SkillTriggerType.Auto)
                    {
                        skill.IsCasting = true;
                        skill.CurrentCastTimer = config.CastTimeSeconds;
                        enemy.ActionState = "Casting";
                        enemy.CurrentCastingSkillId = skill.ConfigId;
                        enemy.MaxCastTimer = config.CastTimeSeconds;
                        enemy.CurrentCastTimer = config.CastTimeSeconds;
                    }
                }
            }
        }

        // 2. Process Player Skills
        foreach (var player in state.Players.Values)
        {
            foreach (var skill in player.Skills)
            {
                if (!configs.Skills.TryGetValue(skill.ConfigId, out var config)) continue;

                if (skill.IsCasting)
                {
                    skill.CurrentCastTimer -= dt;
                    player.CurrentCastTimer = skill.CurrentCastTimer;

                    if (skill.CurrentCastTimer <= 0)
                    {
                        ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, state, configs);
                        skill.IsCasting = false;
                        skill.CurrentCooldown = config.CooldownSeconds;
                        player.ActionState = "Idle";
                        player.CurrentCastingSkillId = string.Empty;
                        player.CurrentCastTimer = 0;
                    }
                }
                else
                {
                    skill.CurrentCooldown -= dt;
                    if (skill.CurrentCooldown <= 0 && config.TriggerType == SkillTriggerType.Auto)
                    {
                        skill.IsCasting = true;
                        skill.CurrentCastTimer = config.CastTimeSeconds;
                        player.ActionState = "Casting";
                        player.CurrentCastingSkillId = skill.ConfigId;
                        player.MaxCastTimer = config.CastTimeSeconds;
                        player.CurrentCastTimer = config.CastTimeSeconds;
                    }
                }
            }
        }
    }

    private static void ExecuteSkill(SkillConfig config, string casterId, float startX, float startY, string team, 
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

        // --- ACTION: AOE EXPLOSION ---
        if (config.ActionType == SkillActionType.AoE)
        {
            aoeEvents.Add(new AoeEventDto { X = startX, Y = startY, Radius = config.Radius, IsFriendly = (team == "Player") });
            float radiusSq = config.Radius * config.Radius;

            if (team == "Enemy")
            {
                foreach (var player in state.Players.Values)
                {
                    float distSq = (player.X - startX) * (player.X - startX) + (player.Y - startY) * (player.Y - startY);
                    if (distSq <= radiusSq)
                    {
                        player.CurrentHp -= config.BaseDamage;
                        damageEvents.Add(new DamageEventDto { X = player.X, Y = player.Y, Amount = config.BaseDamage });
                    }
                }
            }
            else if (team == "Player")
            {
                foreach (var enemy in state.Enemies.Values)
                {
                    if (enemy.ActionState == "Dead") continue;
                    float distSq = (enemy.X - startX) * (enemy.X - startX) + (enemy.Y - startY) * (enemy.Y - startY);
                    if (distSq <= radiusSq)
                    {
                        enemy.CurrentHp -= config.BaseDamage;
                        damageEvents.Add(new DamageEventDto { X = enemy.X, Y = enemy.Y, Amount = config.BaseDamage });

                        if (enemy.CurrentHp <= 0 && enemy.ActionState != "Dead")
                        {
                            enemy.ActionState = "Dead";
                            var gold = new PickupEntity { X = enemy.X, Y = enemy.Y, Value = 1 };
                            state.Pickups.TryAdd(gold.Id, gold);
                        }
                    }
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
        if (config.ActionType == SkillActionType.Summon)
        {
            if (configs.Enemies.TryGetValue(config.SummonConfigId, out var summonConfig))
            {
                for (int i = 0; i < config.SummonCount; i++)
                {
                    float angle = (float)(Random.Shared.NextDouble() * Math.PI * 2);
                    float dist = (float)(Random.Shared.NextDouble() * config.SummonRadius);
                    float spawnX = startX + (float)Math.Cos(angle) * dist;
                    float spawnY = startY + (float)Math.Sin(angle) * dist;

                    spawnX = Math.Clamp(spawnX, 0, 1280);
                    spawnY = Math.Clamp(spawnY, 0, 720);

                    var newSummon = new EnemyEntity();
                    newSummon.Initialize(summonConfig, spawnX, spawnY, configs);

                    newSummon.CurrentHp = newSummon.GetTotalStat("maxHp", configs);
                    newSummon.Team = team;
                    
                    state.Enemies.TryAdd(newSummon.Id, newSummon);
                }
            }
            return;
        }

        // --- ACTION: AOE HEAL ---
        if (config.ActionType == SkillActionType.AoEHeal)
        {
            aoeEvents.Add(new AoeEventDto { X = startX, Y = startY, Radius = config.Radius, IsFriendly = (team == "Player") });
            float radiusSq = config.Radius * config.Radius;

            if (team == "Player")
            {
                foreach (var ally in state.Players.Values)
                {
                    float distSq = (ally.X - startX) * (ally.X - startX) + (ally.Y - startY) * (ally.Y - startY);
                    if (distSq <= radiusSq)
                    {
                        float maxHp = ally.GetTotalStat("maxHp", configs);
                        float healAmount = Math.Min(config.BaseDamage, maxHp - ally.CurrentHp); 
                        ally.CurrentHp += healAmount;

                        if (healAmount > 0) damageEvents.Add(new DamageEventDto { X = ally.X, Y = ally.Y, Amount = -healAmount });
                    }
                }
            }

            foreach (var ally in state.Enemies.Values.Where(e => e.Team == team))
            {
                if (ally.ActionState == "Dead") continue;

                float distSq = (ally.X - startX) * (ally.X - startX) + (ally.Y - startY) * (ally.Y - startY);
                if (distSq <= radiusSq)
                {
                    float maxHp = ally.GetTotalStat("maxHp", configs);
                    float healAmount = Math.Min(config.BaseDamage, maxHp - ally.CurrentHp);
                    ally.CurrentHp += healAmount;

                    if (healAmount > 0) damageEvents.Add(new DamageEventDto { X = ally.X, Y = ally.Y, Amount = -healAmount });
                }
            }
            return;
        }
    }
}