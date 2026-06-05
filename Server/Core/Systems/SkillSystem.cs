using Server.Configs;
using Server.DTOs;
using Server.Entities;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Server.Core.Systems;

public static class SkillSystem
{
public static void Process(float dt, GameState state, ConfigManager configs,
        List<DamageEventDto> damageEvents, List<AoeEventDto> aoeEvents, List<BeamEventDto> beamEvents)
    {
        // =====================================================================
        // 1. PROCESS ENEMY SKILLS
        // =====================================================================
        foreach (var enemy in state.Enemies.Values)
        {
            if (enemy.ActionState == "Dead") continue;
            
            bool isCasting = false;

            // >>> 1. TICK ALL COOLDOWNS IN THE BACKGROUND <<<
            foreach (var skill in enemy.Skills)
            {
                if (skill.CurrentCooldown > 0) skill.CurrentCooldown -= dt;
            }

            // >>> 2. PROCESS ONLY THE ACTIVE CAST / CHANNEL <<<
            var activeSkill = enemy.Skills.FirstOrDefault(s => s.CurrentCastTimer > 0 || s.CurrentChannelTimer > 0);
            if (activeSkill != null && configs.Skills.TryGetValue(activeSkill.ConfigId, out var activeConfig))
            {
                isCasting = true;
                enemy.CurrentCastingSkillId = activeSkill.ConfigId;

                if (activeSkill.CurrentCastTimer > 0)
                {
                    enemy.CurrentCastTimer = activeSkill.CurrentCastTimer;
                    enemy.MaxCastTimer = activeConfig.CastTimeSeconds;
                    activeSkill.CurrentCastTimer -= dt;

                    if (activeSkill.CurrentCastTimer <= 0)
                    {
                        // FIXED LOGIC: True channeling spells run in Phase B. Everything else executes RIGHT NOW.
                        bool isChannelingSpell = activeConfig.ChannelDurationSeconds > 0 && activeConfig.IsRepeated;
                        
                        if (!isChannelingSpell) 
                            ExecuteSkill(activeConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);

                        if (isChannelingSpell)
                            activeSkill.CurrentChannelTimer = activeConfig.ChannelDurationSeconds;
                        else
                            activeSkill.CurrentCooldown = activeConfig.CooldownSeconds;
                    }
                }
                else if (activeSkill.CurrentChannelTimer > 0)
                {
                    enemy.CurrentCastTimer = activeSkill.CurrentChannelTimer;
                    enemy.MaxCastTimer = activeConfig.ChannelDurationSeconds;
                    activeSkill.CurrentChannelTimer -= dt;

                    if (activeConfig.IsRepeated) 
                        ExecuteSkill(activeConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);

                    if (activeSkill.CurrentChannelTimer <= 0)
                        activeSkill.CurrentCooldown = activeConfig.CooldownSeconds;
                }
            }

            enemy.ActionState = isCasting ? "Casting" : "Idle";

            if (!isCasting)
            {
                enemy.CurrentCastingSkillId = string.Empty;
                enemy.CurrentCastTimer = 0f;
                enemy.MaxCastTimer = 0f;
            }

            // >>> 3. ROUND-ROBIN QUEUE <<<
            if (!isCasting && enemy.Skills.Count > 0)
            {
                for (int i = 0; i < enemy.Skills.Count; i++)
                {
                    int checkIndex = (enemy.CurrentSkillIndex + i) % enemy.Skills.Count;
                    var skill = enemy.Skills[checkIndex];

                    if (configs.Skills.TryGetValue(skill.ConfigId, out var config) && config.TriggerType == SkillTriggerType.Auto)
                    {
                        if (config.CastTimeSeconds <= 0 && config.CooldownSeconds <= 0 && config.ChannelDurationSeconds <= 0)
                        {
                            ExecuteSkill(config, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                            continue;
                        }

                        if (skill.CurrentCooldown <= 0 && skill.CurrentCastTimer <= 0 && skill.CurrentChannelTimer <= 0)
                        {
                            if (config.CastTimeSeconds > 0)
                                skill.CurrentCastTimer = config.CastTimeSeconds;
                            else if (config.ChannelDurationSeconds > 0 && config.IsRepeated)
                                skill.CurrentChannelTimer = config.ChannelDurationSeconds;
                            else
                            {
                                ExecuteSkill(config, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                skill.CurrentCooldown = config.CooldownSeconds;
                            }
                            enemy.CurrentSkillIndex = (checkIndex + 1) % enemy.Skills.Count;
                            break;
                        }
                    }
                }
            }
            
            // >>> 4. DYNAMIC SKILLS <<<
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
                            var dSkill = enemy.Skills.FirstOrDefault(s => s.ConfigId == trigger.SkillId);
                            if (dSkill != null && (dSkill.CurrentCastTimer > 0 || dSkill.CurrentChannelTimer > 0)) continue;

                            float castTime = trigger.OverrideCastTime ?? skillConfig.CastTimeSeconds;
                            if (dSkill == null) { dSkill = new ActiveSkill { ConfigId = trigger.SkillId }; enemy.Skills.Add(dSkill); }

                            enemy.DynamicSkillTimers[trigger.SkillId] = trigger.Cooldown;

                            if (castTime <= 0)
                            {
                                bool isChannelingSpell = skillConfig.ChannelDurationSeconds > 0 && skillConfig.IsRepeated;
                                if (isChannelingSpell)
                                    dSkill.CurrentChannelTimer = skillConfig.ChannelDurationSeconds;
                                else
                                {
                                    ExecuteSkill(skillConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                    dSkill.CurrentCooldown = skillConfig.CooldownSeconds;
                                }
                            }
                            else
                            {
                                dSkill.CurrentCastTimer = castTime;
                            }
                        }
                    }
                }
            }
        }

        // =====================================================================
        // 2. PROCESS PLAYER SKILLS
        // =====================================================================
        foreach (var player in state.Players.Values)
        {
            if (player.ActionState == "Dead") continue;
            
            bool isCasting = false;

            // >>> 1. TICK ALL COOLDOWNS IN THE BACKGROUND <<<
            foreach (var skill in player.SynergizedSkills)
            {
                if (skill.CurrentCooldown > 0) skill.CurrentCooldown -= dt;
            }

            // >>> 2. PROCESS ONLY THE ACTIVE CAST / CHANNEL <<<
            var activeSkill = player.SynergizedSkills.FirstOrDefault(s => s.CurrentCastTimer > 0 || s.CurrentChannelTimer > 0);
            if (activeSkill != null && configs.Skills.TryGetValue(activeSkill.ConfigId, out var activeConfig))
            {
                isCasting = true;
                player.CurrentCastingSkillId = activeSkill.ConfigId;

                if (activeSkill.CurrentCastTimer > 0)
                {
                    player.CurrentCastTimer = activeSkill.CurrentCastTimer;
                    player.MaxCastTimer = activeConfig.CastTimeSeconds;
                    activeSkill.CurrentCastTimer -= dt;

                    if (activeSkill.CurrentCastTimer <= 0)
                    {
                        // FIXED LOGIC: True channeling spells run in Phase B. Everything else executes RIGHT NOW.
                        bool isChannelingSpell = activeConfig.ChannelDurationSeconds > 0 && activeConfig.IsRepeated;
                        
                        if (!isChannelingSpell) 
                            ExecuteSkill(activeConfig, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);

                        if (isChannelingSpell)
                            activeSkill.CurrentChannelTimer = activeConfig.ChannelDurationSeconds;
                        else
                            activeSkill.CurrentCooldown = activeConfig.CooldownSeconds;
                    }
                }
                else if (activeSkill.CurrentChannelTimer > 0)
                {
                    player.CurrentCastTimer = activeSkill.CurrentChannelTimer;
                    player.MaxCastTimer = activeConfig.ChannelDurationSeconds;
                    activeSkill.CurrentChannelTimer -= dt;

                    if (activeConfig.IsRepeated) 
                        ExecuteSkill(activeConfig, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);

                    if (activeSkill.CurrentChannelTimer <= 0)
                        activeSkill.CurrentCooldown = activeConfig.CooldownSeconds;
                }
            }

            player.ActionState = isCasting ? "Casting" : "Idle";

            if (!isCasting)
            {
                player.CurrentCastingSkillId = string.Empty;
                player.CurrentCastTimer = 0f;
                player.MaxCastTimer = 0f;
            }

            // >>> 3. ROUND-ROBIN QUEUE <<<
            if (!isCasting && player.SynergizedSkills.Count > 0)
            {
                for (int i = 0; i < player.SynergizedSkills.Count; i++)
                {
                    int checkIndex = (player.CurrentSkillIndex + i) % player.SynergizedSkills.Count;
                    var skill = player.SynergizedSkills[checkIndex];

                    if (configs.Skills.TryGetValue(skill.ConfigId, out var config) && config.TriggerType == SkillTriggerType.Auto)
                    {
                        if (config.CastTimeSeconds <= 0 && config.CooldownSeconds <= 0 && config.ChannelDurationSeconds <= 0)
                        {
                            ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                            continue;
                        }

                        if (skill.CurrentCooldown <= 0 && skill.CurrentCastTimer <= 0 && skill.CurrentChannelTimer <= 0)
                        {
                            if (config.CastTimeSeconds > 0)
                                skill.CurrentCastTimer = config.CastTimeSeconds;
                            else if (config.ChannelDurationSeconds > 0 && config.IsRepeated)
                                skill.CurrentChannelTimer = config.ChannelDurationSeconds;
                            else
                            {
                                ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                skill.CurrentCooldown = config.CooldownSeconds;
                            }
                            player.CurrentSkillIndex = (checkIndex + 1) % player.SynergizedSkills.Count;
                            break;
                        }
                    }
                }
            }
            
            // >>> 4. DYNAMIC SKILLS <<<
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
                            var dSkill = player.SynergizedSkills.FirstOrDefault(s => s.ConfigId == trigger.SkillId);
                            if (dSkill != null && (dSkill.CurrentCastTimer > 0 || dSkill.CurrentChannelTimer > 0)) continue;

                            float castTime = trigger.OverrideCastTime ?? skillConfig.CastTimeSeconds;
                            if (dSkill == null) { dSkill = new ActiveSkill { ConfigId = trigger.SkillId }; player.SynergizedSkills.Add(dSkill); }
                            
                            player.DynamicSkillTimers[trigger.SkillId] = trigger.Cooldown;

                            if (castTime <= 0)
                            {
                                bool isChannelingSpell = skillConfig.ChannelDurationSeconds > 0 && skillConfig.IsRepeated;
                                if (isChannelingSpell)
                                    dSkill.CurrentChannelTimer = skillConfig.ChannelDurationSeconds;
                                else
                                {
                                    ExecuteSkill(skillConfig, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                    dSkill.CurrentCooldown = skillConfig.CooldownSeconds;
                                }
                            }
                            else
                            {
                                dSkill.CurrentCastTimer = castTime;
                            }
                        }
                    }
                }
            }
        }
    }

    public static void ExecuteSkill(SkillConfig config, string casterId, float startX, float startY, string team,
        List<DamageEventDto> damageEvents, List<AoeEventDto> aoeEvents, List<BeamEventDto> beamEvents, GameState state, ConfigManager configs)
    {
        // --- ACTION: SELF BUFF ---
        if (config.ActionType == SkillActionType.SelfBuff)
        {
            BaseActorEntity caster = state.Players.ContainsKey(casterId) ? state.Players[casterId] :
                                     (state.Enemies.ContainsKey(casterId) ? state.Enemies[casterId] : null);

            if (caster != null && config.ApplyEffects != null)
            {
                foreach (var effectId in config.ApplyEffects)
                {
                    if (configs.Effects.TryGetValue(effectId, out var effectConfig))
                    {
                        var existing = caster.ActiveEffects.FirstOrDefault(e => e.ConfigId == effectId);
                        if (existing != null) existing.TimeRemaining = effectConfig.Duration;
                        else caster.ActiveEffects.Add(new ActiveEffect { ConfigId = effectId, TimeRemaining = effectConfig.Duration });
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
                    if (enemy.ActionState == "Dead" || enemy.Team == team) continue;
                    float distSq = (enemy.X - startX) * (enemy.X - startX) + (enemy.Y - startY) * (enemy.Y - startY);
                    if (distSq < closestDistSq)
                    {
                        closestDistSq = distSq; targetX = enemy.X; targetY = enemy.Y;
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
                    if (distSq < closestDistSq) { closestDistSq = distSq; targetX = player.X; targetY = player.Y; }
                }
                foreach (var summon in state.Enemies.Values)
                {
                    if (summon.ActionState == "Dead" || summon.Team == team) continue;
                    float distSq = (summon.X - startX) * (summon.X - startX) + (summon.Y - startY) * (summon.Y - startY);
                    if (distSq < closestDistSq) { closestDistSq = distSq; targetX = summon.X; targetY = summon.Y; }
                }
                if (closestDistSq == float.MaxValue) return;
            }
            else if (config.TargetType == SkillTargetType.AimDirection && team == "Player")
            {
                if (state.Players.TryGetValue(casterId, out var p)) { targetX = p.AimX; targetY = p.AimY; }
            }
            else if (config.TargetType == SkillTargetType.Self)
            {
                targetX = startX; targetY = startY;
            }

            float dirX = targetX - startX;
            float dirY = targetY - startY;
            float length = (float)Math.Sqrt(dirX * dirX + dirY * dirY);

            if (length > 0)
            {
                // >>> FIX 1: EXPLICITLY DELETE OLD ORBITALS SO THEY NEVER OVERLAP! <<<
                if (projConfig.MovementBehavior == "Orbital")
                {
                    var toRemove = new List<string>();
                    foreach (var oldProj in state.Projectiles.Values)
                    {
                        if (oldProj.OwnerId == casterId && oldProj.ConfigId == projConfig.Id && oldProj.MovementBehavior == "Orbital")
                            toRemove.Add(oldProj.Id);
                    }
                    // Forcing deletion instantly removes them from physics and triggers Network System destruction
                    foreach (var id in toRemove) state.Projectiles.TryRemove(id, out _);
                }

                BaseActorEntity? caster = state.Players.ContainsKey(casterId) ? state.Players[casterId] :
                                 (state.Enemies.ContainsKey(casterId) ? state.Enemies[casterId] : null);

                float finalSpellDamage = config.BaseDamage;
                if (caster != null && finalSpellDamage > 0)
                {
                    float magicBonus = caster.GetTotalStat("magicDamage", configs);
                    float damagePercent = caster.GetTotalStat("damagePercent", configs);
                    finalSpellDamage = (finalSpellDamage + magicBonus) * (1f + damagePercent);
                }

                int pCount = Math.Max(1, config.ProjectileCount);
                float lifespan = config.Lifespan > 0 ? config.Lifespan : config.ChannelDurationSeconds;

                var newBullets = ProjectileFactory.Create(
                                    projConfig, casterId, team, startX, startY, dirX, dirY,
                                    0f, finalSpellDamage,
                                    projConfig.BaseSpeed, 0f, config.ApplyEffects, pCount, lifespan
                                );

                if (projConfig.MovementBehavior == "Orbital" && newBullets.Count > 0)
                {
                    float angleStep = (float)(Math.PI * 2 / newBullets.Count);
                    for (int i = 0; i < newBullets.Count; i++)
                    {
                        newBullets[i].OrbitAngleOffset = i * angleStep;
                    }
                }

                foreach (var b in newBullets) state.Projectiles.TryAdd(b.Id, b);
            }
        }

        // --- ACTION: BEAM (Lasers!) ---
        if (config.ActionType == SkillActionType.Beam)
        {
            float baseAngle = 0f;
            bool hasValidTarget = true;

            if (config.TargetType == SkillTargetType.ClosestEnemy)
            {
                var validTargets = team == "Player" ? state.Enemies.Values.Cast<BaseActorEntity>() : state.Players.Values.Cast<BaseActorEntity>();
                BaseActorEntity closest = null;
                float closestDistSq = float.MaxValue;

                foreach (var t in validTargets)
                {
                    if (t.ActionState == "Dead") continue;
                    float dSq = (t.X - startX) * (t.X - startX) + (t.Y - startY) * (t.Y - startY);
                    if (dSq < closestDistSq) { closestDistSq = dSq; closest = t; }
                }

                if (closest != null) baseAngle = (float)Math.Atan2(closest.Y - startY, closest.X - startX);
                else hasValidTarget = false;
            }
            else if (config.TargetType == SkillTargetType.AimDirection)
            {
                BaseActorEntity caster = state.Players.ContainsKey(casterId) ? state.Players[casterId] :
                                         (state.Enemies.ContainsKey(casterId) ? state.Enemies[casterId] : null);

                if (caster is PlayerEntity p && (p.AimX != 0 || p.AimY != 0)) baseAngle = (float)Math.Atan2(p.AimY - startY, p.AimX - startX);
                else if (caster != null) baseAngle = 0;
            }
            else if (config.TargetType == SkillTargetType.Sweep)
            {
                BaseActorEntity caster = state.Players.ContainsKey(casterId) ? state.Players[casterId] :
                                         (state.Enemies.ContainsKey(casterId) ? state.Enemies[casterId] : null);

                if (caster != null) { caster.CurrentSweepAngle += config.SweepAngleSpeed; baseAngle = caster.CurrentSweepAngle; }
            }
            else if (config.TargetType == SkillTargetType.Down)
            {
                baseAngle = (float)(Math.PI / 2);
            }

            if (!hasValidTarget) return;

            float dirX = (float)Math.Cos(baseAngle);
            float dirY = (float)Math.Sin(baseAngle);
            float endX = startX + (dirX * config.Range);
            float endY = startY + (dirY * config.Range);

            beamEvents.Add(new BeamEventDto { StartX = startX, StartY = startY, TargetX = endX, TargetY = endY, Width = config.BeamWidth, ColorTint = config.ColorTint });

            float hitThresholdSq = (config.BeamWidth / 2) * (config.BeamWidth / 2);
            var targets = team == "Player" ? state.Enemies.Values.Cast<BaseActorEntity>() : state.Players.Values.Cast<BaseActorEntity>();

            foreach (var target in targets)
            {
                if (target.ActionState == "Dead" || target.Team == team) continue;

                float fx = target.X - startX; float fy = target.Y - startY;
                float rx = endX - startX; float ry = endY - startY;
                float rayLenSq = rx * rx + ry * ry;

                float t = rayLenSq == 0 ? 0 : Math.Max(0, Math.Min(1, (fx * rx + fy * ry) / rayLenSq));
                float closestX = startX + t * rx; float closestY = startY + t * ry;

                float distX = closestX - target.X; float distY = closestY - target.Y;
                float distSqToSegment = (distX * distX) + (distY * distY);
                float effectiveRadius = (config.BeamWidth / 2) + 15f;

                if (distSqToSegment <= (effectiveRadius * effectiveRadius))
                {
                    target.CurrentHp -= config.BaseDamage;
                    damageEvents.Add(new DamageEventDto { X = target.X, Y = target.Y, Amount = config.BaseDamage });

                    if (target.CurrentHp <= 0 && target.ActionState != "Dead")
                    {
                        target.ActionState = "Dead";
                        if (target is EnemyEntity enemyTarget)
                        {
                            var gold = new PickupEntity { X = target.X, Y = target.Y, Value = 1 };
                            state.Pickups.TryAdd(gold.Id, gold);

                            if (configs.Enemies.TryGetValue(enemyTarget.ConfigId, out var eCfg))
                                FireOnDeathSkills(enemyTarget.Id, enemyTarget.X, enemyTarget.Y, enemyTarget.Team, eCfg.OnDeathSkills, state, configs, damageEvents, aoeEvents, beamEvents);
                        }
                    }
                }
            }
        }

        // --- ACTION: SUMMON ---
        if (config.ActionType == SkillActionType.Summon)
        {
            if (configs.Enemies.TryGetValue(config.SummonConfigId, out var summonConfig))
            {
                float mapW = configs.Maps != null && configs.Maps.TryGetValue("map_forest", out var currentMap) ? currentMap.Width : 4000f;
                float mapH = configs.Maps != null && configs.Maps.TryGetValue("map_forest", out var currentMapH) ? currentMapH.Height : 4000f;

                for (int i = 0; i < config.SummonCount; i++)
                {
                    float angle = (float)(Random.Shared.NextDouble() * Math.PI * 2);
                    float dist = (float)(Random.Shared.NextDouble() * config.SummonRadius);
                    float spawnX = Math.Clamp(startX + (float)Math.Cos(angle) * dist, 35, mapW - 35);
                    float spawnY = Math.Clamp(startY + (float)Math.Sin(angle) * dist, 35, mapH - 35);

                    var newSummon = new EnemyEntity();
                    newSummon.Initialize(summonConfig, spawnX, spawnY, configs);
                    newSummon.CurrentHp = newSummon.GetTotalStat("maxHp", configs);
                    newSummon.Team = team;

                    state.Enemies.TryAdd(newSummon.Id, newSummon);
                }
            }
            return;
        }

        // --- ACTION: UNIFIED AOE ---
        if (config.ActionType == SkillActionType.AoE)
        {
            bool isHeal = config.BaseDamage < 0;
            float actualDamage = isHeal ? -Math.Abs(config.BaseDamage) : config.BaseDamage;

            aoeEvents.Add(new AoeEventDto { X = startX, Y = startY, Radius = config.Radius, IsFriendly = string.IsNullOrEmpty(team) || team == "Player", ConfigId = config.Id });
            float radiusSq = config.Radius * config.Radius;

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

            bool isPlayerTeam = string.IsNullOrEmpty(team) || team == "Player";

            if (isPlayerTeam)
            {
                if (!isHeal)
                {
                    foreach (var enemy in state.Enemies.Values)
                    {
                        if (enemy.ActionState == "Dead" || enemy.Team == "Player") continue;

                        float distSq = (enemy.X - startX) * (enemy.X - startX) + (enemy.Y - startY) * (enemy.Y - startY);
                        if (distSq <= radiusSq)
                        {
                            enemy.CurrentHp -= actualDamage;
                            damageEvents.Add(new DamageEventDto { X = enemy.X, Y = enemy.Y, Amount = actualDamage });
                            ApplyAoeEffects(enemy.ActiveEffects);

                            if (enemy.CurrentHp <= 0 && enemy.ActionState != "Dead")
                            {
                                enemy.ActionState = "Dead";
                                var gold = new PickupEntity { X = enemy.X, Y = enemy.Y, Value = 1 };
                                state.Pickups.TryAdd(gold.Id, gold);

                                if (configs.Enemies.TryGetValue(enemy.ConfigId, out var eCfg))
                                    FireOnDeathSkills(enemy.Id, enemy.X, enemy.Y, enemy.Team, eCfg.OnDeathSkills, state, configs, damageEvents, aoeEvents, beamEvents);
                            }
                        }
                    }
                }
                else
                {
                    foreach (var ally in state.Players.Values)
                    {
                        float distSq = (ally.X - startX) * (ally.X - startX) + (ally.Y - startY) * (ally.Y - startY);
                        if (distSq <= radiusSq)
                        {
                            float healAmount = Math.Min(Math.Abs(actualDamage), ally.GetTotalStat("maxHp", configs) - ally.CurrentHp);
                            if (healAmount > 0) { ally.CurrentHp += healAmount; damageEvents.Add(new DamageEventDto { X = ally.X, Y = ally.Y, Amount = -healAmount }); }
                            ApplyAoeEffects(ally.ActiveEffects);
                        }
                    }
                    foreach (var summon in state.Enemies.Values)
                    {
                        if (summon.ActionState == "Dead" || summon.Team != "Player") continue;
                        float distSq = (summon.X - startX) * (summon.X - startX) + (summon.Y - startY) * (summon.Y - startY);
                        if (distSq <= radiusSq)
                        {
                            float healAmount = Math.Min(Math.Abs(actualDamage), summon.GetTotalStat("maxHp", configs) - summon.CurrentHp);
                            if (healAmount > 0) { summon.CurrentHp += healAmount; damageEvents.Add(new DamageEventDto { X = summon.X, Y = summon.Y, Amount = -healAmount }); }
                            ApplyAoeEffects(summon.ActiveEffects);
                        }
                    }
                }
            }
            else
            {
                if (!isHeal)
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
                    foreach (var summon in state.Enemies.Values)
                    {
                        if (summon.ActionState == "Dead" || summon.Team == "Enemy") continue;
                        float distSq = (summon.X - startX) * (summon.X - startX) + (summon.Y - startY) * (summon.Y - startY);
                        if (distSq <= radiusSq)
                        {
                            summon.CurrentHp -= actualDamage;
                            damageEvents.Add(new DamageEventDto { X = summon.X, Y = summon.Y, Amount = actualDamage });
                            ApplyAoeEffects(summon.ActiveEffects);

                            if (summon.CurrentHp <= 0 && summon.ActionState != "Dead")
                            {
                                summon.ActionState = "Dead";
                                if (configs.Enemies.TryGetValue(summon.ConfigId, out var eCfg))
                                    FireOnDeathSkills(summon.Id, summon.X, summon.Y, summon.Team, eCfg.OnDeathSkills, state, configs, damageEvents, aoeEvents, beamEvents);
                            }
                        }
                    }
                }
                else
                {
                    foreach (var ally in state.Enemies.Values)
                    {
                        if (ally.ActionState == "Dead" || ally.Team != "Enemy") continue;
                        float distSq = (ally.X - startX) * (ally.X - startX) + (ally.Y - startY) * (ally.Y - startY);
                        if (distSq <= radiusSq)
                        {
                            float healAmount = Math.Min(Math.Abs(actualDamage), ally.GetTotalStat("maxHp", configs) - ally.CurrentHp);
                            if (healAmount > 0) { ally.CurrentHp += healAmount; damageEvents.Add(new DamageEventDto { X = ally.X, Y = ally.Y, Amount = -healAmount }); }
                            ApplyAoeEffects(ally.ActiveEffects);
                        }
                    }
                }
            }
        }
    }

    public static void FireOnDeathSkills(string entityId, float x, float y, string team, List<string> onDeathSkills, GameState state, ConfigManager configs, List<DamageEventDto> damageEvents, List<AoeEventDto> aoeEvents, List<BeamEventDto> beamEvents)
    {
        if (onDeathSkills == null) return;
        foreach (var skillId in onDeathSkills)
        {
            if (configs.Skills.TryGetValue(skillId, out var skillConfig))
                ExecuteSkill(skillConfig, entityId, x, y, team, damageEvents, aoeEvents, beamEvents, state, configs);
        }
    }
}