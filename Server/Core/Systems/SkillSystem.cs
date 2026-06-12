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

            if (enemy.SkillWaitTimer > 0)
            {
                enemy.SkillWaitTimer -= dt;
                continue; // Skip all casting and cooldown logic until the timer finishes
            }

            bool isCasting = false;
            // >>> THE HASTE FIX: Calculate Haste Multiplier for Enemy <<<
            float hasteMult = (100f + Math.Max(0f, enemy.GetTotalStat("haste", configs))) / 100f; // For Enemy

            // >>> 1. TICK BACKGROUND TIMERS CONCURRENTLY <<<
            foreach (var skill in enemy.Skills)
            {
                if (!configs.Skills.TryGetValue(skill.ConfigId, out var config)) continue;

                // Phase C: Cooldown
                if (skill.CurrentCooldown > 0) skill.CurrentCooldown -= dt;

                // >>> THE FIX: Tick Cast Timers for Independent Skills in the background <<<
                if (config.IsIndependent && skill.CurrentCastTimer > 0)
                {
                    skill.CurrentCastTimer -= dt;
                    if (skill.CurrentCastTimer <= 0)
                    {
                        if (config.ChannelDurationSeconds > 0)
                        {
                            // LASER FIX: Do NOT divide channel duration by haste!
                            skill.CurrentChannelTimer = config.ChannelDurationSeconds;
                            if (!config.IsRepeated) ExecuteSkill(config, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                        }
                        else
                        {
                            ExecuteSkill(config, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                            skill.CurrentCooldown = config.CooldownSeconds / hasteMult; // < APPLY HASTE TO COOLDOWN
                        }
                    }
                }

                // Phase B: Duration/Channeling (DOES NOT lock the queue, NO cast bar!)
                if (skill.CurrentChannelTimer > 0)
                {
                    skill.CurrentChannelTimer -= dt;
                    if (config.IsRepeated) ExecuteSkill(config, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);

                    // Start cooldown the exact moment the duration ends!
                    if (skill.CurrentChannelTimer <= 0)
                    {
                        skill.CurrentCooldown = config.CooldownSeconds / hasteMult; // < APPLY HASTE TO COOLDOWN
                    }
                }
            }

            // >>> 2. PROCESS ACTIVE CASTING (Wind-up ONLY) <<<
            // Ignore Independent skills so they don't hijack the main casting bar!
            var activeCast = enemy.Skills.FirstOrDefault(s =>
                s.CurrentCastTimer > 0 &&
                (!configs.Skills.TryGetValue(s.ConfigId, out var c) || !c.IsIndependent));

            if (activeCast != null && configs.Skills.TryGetValue(activeCast.ConfigId, out var activeConfig))
            {
                isCasting = true;
                enemy.CurrentCastingSkillId = activeCast.ConfigId;
                enemy.CurrentCastTimer = activeCast.CurrentCastTimer;
                enemy.MaxCastTimer = activeConfig.CastTimeSeconds / hasteMult; // < APPLY HASTE TO UI BAR

                activeCast.CurrentCastTimer -= dt;

                if (activeCast.CurrentCastTimer <= 0)
                {
                    if (activeConfig.ChannelDurationSeconds > 0)
                    {
                        // LASER FIX: Do NOT divide channel duration by haste!
                        activeCast.CurrentChannelTimer = activeConfig.ChannelDurationSeconds;
                        if (!activeConfig.IsRepeated) ExecuteSkill(activeConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                    }
                    else
                    {
                        ExecuteSkill(activeConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                        activeCast.CurrentCooldown = activeConfig.CooldownSeconds / hasteMult; // < APPLY HASTE
                    }
                }
            }

            if (isCasting)
            {
                enemy.ActionState = "Casting";
            }
            else
            {
                // Only revert to Idle if we were the one who set it to Casting!
                if (enemy.ActionState == "Casting") enemy.ActionState = "Idle";

                enemy.CurrentCastingSkillId = string.Empty;
                enemy.CurrentCastTimer = 0f;
                enemy.MaxCastTimer = 0f;
            }


            // >>> 2.5 TRIGGER INDEPENDENT SKILLS <<<
            foreach (var skill in enemy.Skills)
            {
                if (configs.Skills.TryGetValue(skill.ConfigId, out var config) && config.IsIndependent)
                {
                    if (skill.CurrentCooldown <= 0 && skill.CurrentCastTimer <= 0 && skill.CurrentChannelTimer <= 0)
                    {
                        if (config.CastTimeSeconds > 0) skill.CurrentCastTimer = config.CastTimeSeconds / hasteMult; // < APPLY HASTE
                        else
                        {
                            if (config.ChannelDurationSeconds > 0)
                            {
                                // LASER FIX
                                skill.CurrentChannelTimer = config.ChannelDurationSeconds;
                                if (!config.IsRepeated) ExecuteSkill(config, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                            }
                            else
                            {
                                ExecuteSkill(config, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                skill.CurrentCooldown = config.CooldownSeconds / hasteMult; // < APPLY HASTE
                            }
                        }
                    }
                }
            }

            // >>> 3. ROUND-ROBIN QUEUE <<<
            if (!isCasting && enemy.Skills.Count > 0)
            {
                for (int i = 0; i < enemy.Skills.Count; i++)
                {
                    int checkIndex = (enemy.CurrentSkillIndex + i) % enemy.Skills.Count;
                    var skill = enemy.Skills[checkIndex];

                    if (configs.Skills.TryGetValue(skill.ConfigId, out var config))
                    {
                        // >>> THE FIX: Skip independent skills so they don't consume a queue turn! <<<
                        if (config.IsIndependent) continue;

                        if (config.TriggerType == SkillTriggerType.Auto)
                        {
                            if (config.CastTimeSeconds <= 0 && config.CooldownSeconds <= 0 && config.ChannelDurationSeconds <= 0)
                            {
                                ExecuteSkill(config, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                continue;
                            }

                            // MUST be completely idle: No Cooldown, Not Casting, and NOT IN DURATION!
                            if (skill.CurrentCooldown <= 0 && skill.CurrentCastTimer <= 0 && skill.CurrentChannelTimer <= 0)
                            {
                                if (config.CastTimeSeconds > 0)
                                {
                                    skill.CurrentCastTimer = config.CastTimeSeconds / hasteMult; // < APPLY HASTE
                                }
                                else
                                {
                                    if (config.ChannelDurationSeconds > 0)
                                    {
                                        // LASER FIX
                                        skill.CurrentChannelTimer = config.ChannelDurationSeconds;
                                        if (!config.IsRepeated) ExecuteSkill(config, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                    }
                                    else
                                    {
                                        ExecuteSkill(config, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                        skill.CurrentCooldown = config.CooldownSeconds / hasteMult; // < APPLY HASTE
                                    }
                                }
                                enemy.CurrentSkillIndex = (checkIndex + 1) % enemy.Skills.Count;
                                break;
                            }
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
                            var activeSkill = enemy.Skills.FirstOrDefault(s => s.ConfigId == trigger.SkillId);
                            if (activeSkill != null && (activeSkill.CurrentCastTimer > 0 || activeSkill.CurrentChannelTimer > 0)) continue;

                            float castTime = trigger.OverrideCastTime ?? skillConfig.CastTimeSeconds;
                            if (activeSkill == null) { activeSkill = new ActiveSkill { ConfigId = trigger.SkillId }; enemy.Skills.Add(activeSkill); }

                            enemy.DynamicSkillTimers[trigger.SkillId] = trigger.Cooldown;

                            if (castTime <= 0)
                            {
                                if (skillConfig.ChannelDurationSeconds > 0)
                                {
                                    // LASER FIX
                                    activeSkill.CurrentChannelTimer = skillConfig.ChannelDurationSeconds;
                                    if (!skillConfig.IsRepeated) ExecuteSkill(skillConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                }
                                else
                                {
                                    ExecuteSkill(skillConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                    activeSkill.CurrentCooldown = skillConfig.CooldownSeconds / hasteMult; // < APPLY HASTE
                                }
                            }
                            else
                            {
                                activeSkill.CurrentCastTimer = castTime / hasteMult; // < APPLY HASTE
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
            // >>> THE HASTE FIX: Calculate Haste Multiplier for Player <<<
            float hasteMult = (100f + Math.Max(0f, player.GetTotalStat("haste", configs))) / 100f; // For Player
            // >>> 1. TICK BACKGROUND TIMERS CONCURRENTLY <<<
            foreach (var skill in player.SynergizedSkills)
            {
                if (!configs.Skills.TryGetValue(skill.ConfigId, out var config)) continue;

                if (skill.CurrentCooldown > 0) skill.CurrentCooldown -= dt;

                // >>> THE FIX: Tick Cast Timers for Independent Skills in the background <<<
                if (config.IsIndependent && skill.CurrentCastTimer > 0)
                {
                    skill.CurrentCastTimer -= dt;
                    if (skill.CurrentCastTimer <= 0)
                    {
                        if (config.ChannelDurationSeconds > 0)
                        {
                            // LASER FIX
                            skill.CurrentChannelTimer = config.ChannelDurationSeconds;
                            if (!config.IsRepeated) ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                        }
                        else
                        {
                            ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                            skill.CurrentCooldown = config.CooldownSeconds / hasteMult; // < APPLY HASTE
                        }
                    }
                }

                if (skill.CurrentChannelTimer > 0)
                {
                    skill.CurrentChannelTimer -= dt;
                    if (config.IsRepeated) ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);

                    if (skill.CurrentChannelTimer <= 0)
                    {
                        skill.CurrentCooldown = config.CooldownSeconds / hasteMult; // < APPLY HASTE
                    }
                }
            }

            // >>> 2. PROCESS ACTIVE CASTING (Wind-up ONLY) <<<
            // Ignore Independent skills so they don't hijack the main casting bar!
            var activeCast = player.SynergizedSkills.FirstOrDefault(s =>
                s.CurrentCastTimer > 0 &&
                (!configs.Skills.TryGetValue(s.ConfigId, out var c) || !c.IsIndependent));

            if (activeCast != null && configs.Skills.TryGetValue(activeCast.ConfigId, out var activeConfig))
            {
                isCasting = true;
                player.CurrentCastingSkillId = activeCast.ConfigId;
                player.CurrentCastTimer = activeCast.CurrentCastTimer;
                player.MaxCastTimer = activeConfig.CastTimeSeconds / hasteMult; // < APPLY HASTE TO UI BAR

                activeCast.CurrentCastTimer -= dt;

                if (activeCast.CurrentCastTimer <= 0)
                {
                    if (activeConfig.ChannelDurationSeconds > 0)
                    {
                        // LASER FIX
                        activeCast.CurrentChannelTimer = activeConfig.ChannelDurationSeconds;
                        if (!activeConfig.IsRepeated) ExecuteSkill(activeConfig, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                    }
                    else
                    {
                        ExecuteSkill(activeConfig, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                        activeCast.CurrentCooldown = activeConfig.CooldownSeconds / hasteMult; // < APPLY HASTE
                    }
                }
            }

            if (isCasting)
            {
                player.ActionState = "Casting";
            }
            else
            {
                // Only revert to Idle if we were the one who set it to Casting!
                if (player.ActionState == "Casting") player.ActionState = "Idle";

                player.CurrentCastingSkillId = string.Empty;
                player.CurrentCastTimer = 0f;
                player.MaxCastTimer = 0f;
            }

            // >>> 2.5 TRIGGER INDEPENDENT SKILLS <<<
            foreach (var skill in player.SynergizedSkills)
            {
                if (configs.Skills.TryGetValue(skill.ConfigId, out var config) && config.IsIndependent)
                {
                    // >>> THE CEASEFIRE FIX: Don't waste auto-skills in the shop! <<<
                    if (config.TriggerType == SkillTriggerType.Auto && state.Phase != GamePhase.WaveActive) continue;

                    if (skill.CurrentCooldown <= 0 && skill.CurrentCastTimer <= 0 && skill.CurrentChannelTimer <= 0)
                    {
                        if (config.CastTimeSeconds > 0) skill.CurrentCastTimer = config.CastTimeSeconds / hasteMult; // < APPLY HASTE
                        else
                        {
                            if (config.ChannelDurationSeconds > 0)
                            {
                                // LASER FIX
                                skill.CurrentChannelTimer = config.ChannelDurationSeconds;
                                if (!config.IsRepeated) ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                            }
                            else
                            {
                                ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                skill.CurrentCooldown = config.CooldownSeconds / hasteMult; // < APPLY HASTE
                            }
                        }
                    }
                }
            }

            // >>> 3. ROUND-ROBIN QUEUE <<<
            if (!isCasting && player.SynergizedSkills.Count > 0)
            {
                for (int i = 0; i < player.SynergizedSkills.Count; i++)
                {
                    int checkIndex = (player.CurrentSkillIndex + i) % player.SynergizedSkills.Count;
                    var skill = player.SynergizedSkills[checkIndex];

                    if (configs.Skills.TryGetValue(skill.ConfigId, out var config))
                    {
                        // >>> THE FIX: Skip independent skills so they don't consume a queue turn! <<<
                        if (config.IsIndependent) continue;

                        if (config.TriggerType == SkillTriggerType.Auto)
                        {
                            // >>> THE CEASEFIRE FIX: Don't waste auto-skills in the shop! <<<
                            if (state.Phase != GamePhase.WaveActive) continue;
                            if (config.CastTimeSeconds <= 0 && config.CooldownSeconds <= 0 && config.ChannelDurationSeconds <= 0)
                            {
                                ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                continue;
                            }

                            // MUST be completely idle: No Cooldown, Not Casting, and NOT IN DURATION!
                            if (skill.CurrentCooldown <= 0 && skill.CurrentCastTimer <= 0 && skill.CurrentChannelTimer <= 0)
                            {
                                if (config.CastTimeSeconds > 0)
                                {
                                    skill.CurrentCastTimer = config.CastTimeSeconds / hasteMult; // < APPLY HASTE
                                }
                                else
                                {
                                    if (config.ChannelDurationSeconds > 0)
                                    {
                                        // LASER FIX
                                        skill.CurrentChannelTimer = config.ChannelDurationSeconds;
                                        if (!config.IsRepeated) ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                    }
                                    else
                                    {
                                        ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                        skill.CurrentCooldown = config.CooldownSeconds / hasteMult; // < APPLY HASTE
                                    }
                                }
                                player.CurrentSkillIndex = (checkIndex + 1) % player.SynergizedSkills.Count;
                                break;
                            }
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
                            var activeSkill = player.SynergizedSkills.FirstOrDefault(s => s.ConfigId == trigger.SkillId);
                            if (activeSkill != null && (activeSkill.CurrentCastTimer > 0 || activeSkill.CurrentChannelTimer > 0)) continue;

                            float castTime = trigger.OverrideCastTime ?? skillConfig.CastTimeSeconds;
                            if (activeSkill == null) { activeSkill = new ActiveSkill { ConfigId = trigger.SkillId }; player.SynergizedSkills.Add(activeSkill); }

                            player.DynamicSkillTimers[trigger.SkillId] = trigger.Cooldown;

                            if (castTime <= 0)
                            {
                                if (skillConfig.ChannelDurationSeconds > 0)
                                {
                                    // LASER FIX
                                    activeSkill.CurrentChannelTimer = skillConfig.ChannelDurationSeconds;
                                    if (!skillConfig.IsRepeated) ExecuteSkill(skillConfig, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                }
                                else
                                {
                                    ExecuteSkill(skillConfig, player.ConnectionId, player.X, player.Y, player.Team, damageEvents, aoeEvents, beamEvents, state, configs);
                                    activeSkill.CurrentCooldown = skillConfig.CooldownSeconds / hasteMult; // < APPLY HASTE
                                }
                            }
                            else
                            {
                                activeSkill.CurrentCastTimer = castTime / hasteMult; // < APPLY HASTE
                            }
                        }
                    }
                }
            }
        }
    }
    public static void ExecuteSkill(SkillConfig config, string casterId, float startX, float startY, string team,
        List<DamageEventDto> damageEvents, List<AoeEventDto> aoeEvents, List<BeamEventDto> beamEvents, GameState state, ConfigManager configs, ProjectileEntity sourceProjectile = null)
    {
        // >>> THE FIX: CALCULATE UNIVERSAL SPELL DAMAGE ONCE <<<
        BaseActorEntity caster = state.Players.ContainsKey(casterId) ? state.Players[casterId] :
                                 (state.Enemies.ContainsKey(casterId) ? state.Enemies[casterId] : null);

        float finalSpellDamage = config.BaseDamage;
        if (caster != null && Math.Abs(finalSpellDamage) > 0)
        {
            float magicBonus = caster.GetTotalStat("magicDamage", configs);
            float damagePercent = caster.GetTotalStat("damagePercent", configs);

            // Apply a 50% ratio to the magic stat so spells don't out-scale weapons instantly!
            finalSpellDamage = (finalSpellDamage + (magicBonus * 0.5f)) * (1f + damagePercent);
        }

        // --- ACTION: SELF BUFF ---
        if (config.ActionType == SkillActionType.SelfBuff)
        {

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



                int pCount = Math.Max(1, config.ProjectileCount);

                // >>> THE FIX: Bulletproof Lifespan Fallback Chain <<<
                // 1. Calculate default physics lifespan (Range / Speed)
                float computedLifespan = projConfig.BaseSpeed > 0 ? (config.Range / Math.Max(1f, projConfig.BaseSpeed)) : 0.15f;

                // 2. If the skill is a channeling skill (like Orbitals), default to the channel duration!
                if (config.ChannelDurationSeconds > 0) computedLifespan = config.ChannelDurationSeconds;

                // 3. If the Projectile JSON explicitly sets a strict lifespan (like the drone), override it!
                if (projConfig.Lifespan > 0) computedLifespan = projConfig.Lifespan;

                // 4. If the Skill JSON explicitly sets a lifespan override, this is the highest priority!
                if (config.Lifespan > 0) computedLifespan = config.Lifespan;

                var newBullets = ProjectileFactory.Create(
                                    projConfig, casterId, team, startX, startY, dirX, dirY,
                                    0f, finalSpellDamage,
                                    projConfig.BaseSpeed, 0f, config.ApplyEffects, pCount, computedLifespan
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

            // >>> THE FIX 1: Find all hostile targets (including friendly summons!) <<<
            IEnumerable<BaseActorEntity> hostileTargets;
            if (team == "Player")
            {
                hostileTargets = state.Enemies.Values.Where(e => e.Team != "Player").Cast<BaseActorEntity>();
            }
            else
            {
                hostileTargets = state.Players.Values.Cast<BaseActorEntity>()
                    .Concat(state.Enemies.Values.Where(e => e.Team != "Enemy").Cast<BaseActorEntity>());
            }

            if (config.TargetType == SkillTargetType.ClosestEnemy || config.TargetType == SkillTargetType.ClosestPlayer)
            {
                BaseActorEntity closest = null;
                float closestDistSq = float.MaxValue;

                foreach (var t in hostileTargets)
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

                if (caster is PlayerEntity p && (p.AimX != 0 || p.AimY != 0)) baseAngle = (float)Math.Atan2(p.AimY - startY, p.AimX - startX);
                else if (caster != null) baseAngle = 0;
            }
            else if (config.TargetType == SkillTargetType.Sweep)
            {
                // >>> THE DRONE FIX <<<
                if (sourceProjectile != null)
                {
                    // If a drone fired this, it uses its own independent angle
                    sourceProjectile.SweepAngle += config.SweepAngleSpeed;
                    baseAngle = sourceProjectile.SweepAngle;
                }
                else
                {
                    // If a player/enemy fired this, use their angle

                    if (caster != null) { caster.CurrentSweepAngle += config.SweepAngleSpeed; baseAngle = caster.CurrentSweepAngle; }
                }
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

            // >>> THE FIX 2: Apply damage to all hostile targets (including summons!) <<<
            foreach (var target in hostileTargets)
            {
                if (target.ActionState == "Dead") continue;

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
                    target.CurrentHp -= finalSpellDamage;
                    damageEvents.Add(new DamageEventDto { X = target.X, Y = target.Y, Amount = finalSpellDamage });

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
            float actualDamage = isHeal ? -Math.Abs(finalSpellDamage) : finalSpellDamage;
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

    // Add this right before the final closing brace of SkillSystem
    public static void ResetAllPlayerSkills(GameState state)
    {
        foreach (var player in state.Players.Values)
        {
            // 1. Force the player out of the Casting animation state
            player.ActionState = "Idle";
            player.CurrentCastingSkillId = string.Empty;
            player.CurrentCastTimer = 0f;
            player.MaxCastTimer = 0f;

            // 2. Clear out dynamic emergency triggers (like low HP skills)
            player.DynamicSkillTimers.Clear();

            // 3. Reset all active channels and cooldowns so they are fresh for the next wave
            foreach (var skill in player.SynergizedSkills)
            {
                skill.CurrentCastTimer = 0f;
                skill.CurrentChannelTimer = 0f;
                skill.CurrentCooldown = 0f;
            }
        }
    }
}