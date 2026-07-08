using Server.Configs;
using Server.DTOs;
using Server.Entities;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Server.Core.Systems;

public class SkillSystem : IGameSystem
{
    private EventBus _eventBus = null!;
    private ConfigManager _configs = null!;

    public void Initialize(EventBus eventBus, ConfigManager configs)
    {
        _eventBus = eventBus;
        _configs = configs;

        _eventBus.Subscribe<RequestSkillCastEvent>(OnRequestSkillCast);
        _eventBus.Subscribe<TriggerDeathSkillsEvent>(OnTriggerDeathSkills);
        _eventBus.Subscribe<ResetPlayerSkillsEvent>(OnResetPlayerSkills);
    }

    private void OnRequestSkillCast(RequestSkillCastEvent ev)
    {
        var config = ev.Skill;
        string casterId = ev.CasterId;
        float startX = ev.StartX;
        float startY = ev.StartY;
        string team = ev.Team;
        var state = ev.State;
        var sourceProjectile = ev.SourceProjectile;

        BaseActorEntity? caster = state.Players.ContainsKey(casterId) ? state.Players[casterId] :
                                 (state.Enemies.ContainsKey(casterId) ? state.Enemies[casterId] : null);

        float finalSpellDamage = config.BaseDamage;
        if (caster != null && Math.Abs(finalSpellDamage) > 0)
        {
            bool isHeal = finalSpellDamage < 0;
            float rawAbsoluteDamage = Math.Abs(finalSpellDamage);

            if (!isHeal)
            {
                float magicBonus = caster.GetTotalStat("magicDamage", _configs);
                float damagePercent = caster.GetTotalStat("damagePercent", _configs);
                rawAbsoluteDamage = (rawAbsoluteDamage + (magicBonus * 0.5f)) * (1f + damagePercent);
                rawAbsoluteDamage = Math.Max(0f, rawAbsoluteDamage);
            }
            else
            {
                float healPower = caster.GetTotalStat("healPower", _configs);
                rawAbsoluteDamage = Math.Max(0f, rawAbsoluteDamage * (1f + healPower / 100f));
            }

            finalSpellDamage = isHeal ? -rawAbsoluteDamage : rawAbsoluteDamage;
        }

        // >>> THE RESTORED SELF-BUFF LOGIC <<<
        if (config.ActionType == SkillActionType.SelfBuff)
        {
            if (caster != null && config.ApplyEffects != null)
            {
                foreach (var effectId in config.ApplyEffects)
                {
                    _eventBus.Publish(new ApplyEffectEvent { Target = caster, EffectConfigId = effectId, Caster = caster });
                }
            }
            return;
        }

        // >>> THE UPDATED PROJECTILE LOGIC <<<
        if (config.ActionType == SkillActionType.Projectile && _configs.Projectiles.TryGetValue(config.ProjectileId, out var projConfig))
        {
            float targetX = startX + 1;
            float targetY = startY;
            string intendedTargetId = casterId;

            if (config.TargetType == SkillTargetType.ClosestEnemy)
            {
                var closest = TargetingHelper.FindClosestTarget(startX, startY, TargetingHelper.GetHostileTargets(state, team));
                if (closest == null) return;
                targetX = closest.X; targetY = closest.Y;
            }
            else if (config.TargetType == SkillTargetType.AimDirection && team == "Player")
            {
                if (state.Players.TryGetValue(casterId, out var p)) { targetX = p.AimX; targetY = p.AimY; }
            }
            else if (config.TargetType == SkillTargetType.Self)
            {
                targetX = startX; targetY = startY;
            }
            else if (config.TargetType == SkillTargetType.ClosestAlly)
            {
                float worstHpPct = float.MaxValue;
                bool foundAlly = false;
                float rangeSq = config.Range > 0 ? config.Range * config.Range : float.MaxValue;

                if (team == "Player")
                {
                    foreach (var ally in state.Players.Values)
                    {
                        if (ally.ActionState == "Dead") continue;
                        float distSq = (ally.X - startX) * (ally.X - startX) + (ally.Y - startY) * (ally.Y - startY);
                        if (distSq > rangeSq) continue;

                        float hpPct = ally.CurrentHp / Math.Max(1f, ally.CurrentMaxHp);
                        if (hpPct < worstHpPct) { worstHpPct = hpPct; targetX = ally.X; targetY = ally.Y; foundAlly = true; intendedTargetId = ally.ConnectionId; }
                    }
                    foreach (var summon in state.Enemies.Values)
                    {
                        if (summon.ActionState == "Dead" || summon.Team != "Player") continue;
                        float distSq = (summon.X - startX) * (summon.X - startX) + (summon.Y - startY) * (summon.Y - startY);
                        if (distSq > rangeSq) continue;

                        float hpPct = summon.CurrentHp / Math.Max(1f, summon.CurrentMaxHp);
                        if (hpPct < worstHpPct) { worstHpPct = hpPct; targetX = summon.X; targetY = summon.Y; foundAlly = true; intendedTargetId = summon.Id; }
                    }
                }
                else
                {
                    foreach (var ally in state.Enemies.Values)
                    {
                        if (ally.ActionState == "Dead" || ally.Team != team) continue;
                        float distSq = (ally.X - startX) * (ally.X - startX) + (ally.Y - startY) * (ally.Y - startY);
                        if (distSq > rangeSq) continue;

                        float hpPct = ally.CurrentHp / Math.Max(1f, ally.CurrentMaxHp);
                        if (hpPct < worstHpPct) { worstHpPct = hpPct; targetX = ally.X; targetY = ally.Y; foundAlly = true; intendedTargetId = ally.Id; }
                    }
                }
                if (!foundAlly) return;
            }

            float dirX = targetX - startX;
            float dirY = targetY - startY;
            float length = (float)Math.Sqrt(dirX * dirX + dirY * dirY);

            if (length == 0)
            {
                dirY = -1;
                length = 1;
            }

            if (length > 0)
            {
                if (projConfig.MovementBehavior == "Orbital")
                {
                    var toRemove = new List<string>();
                    foreach (var oldProj in state.Projectiles.Values)
                    {
                        if (oldProj.OwnerId == casterId && oldProj.ConfigId == projConfig.Id && oldProj.MovementBehavior == "Orbital")
                            toRemove.Add(oldProj.Id);
                    }
                    foreach (var id in toRemove) state.Projectiles.TryRemove(id, out _);
                }

                float computedLifespan = projConfig.BaseSpeed > 0 ? (config.Range / Math.Max(1f, projConfig.BaseSpeed)) : 0.15f;
                if (config.TargetType == SkillTargetType.ClosestAlly && projConfig.BaseSpeed > 0)
                    computedLifespan = Math.Max(computedLifespan, (length * 1.2f) / projConfig.BaseSpeed);
                if (config.ChannelDurationSeconds > 0) computedLifespan = config.ChannelDurationSeconds;
                if (projConfig.Lifespan > 0) computedLifespan = projConfig.Lifespan;
                if (config.Lifespan > 0) computedLifespan = config.Lifespan;

                int pCount = Math.Max(1, config.ProjectileCount);
                var shotDirections = ProjectileFactory.CalculateSpreadDirections(dirX, dirY, pCount, config.SpreadAngle);
                var newBullets = new List<ProjectileEntity>();
                bool isFriendlyProj = config.TargetType == SkillTargetType.ClosestAlly;

                foreach (var (spreadDirX, spreadDirY) in shotDirections)
                {
                    var createdBullets = ProjectileFactory.Create(
                        projConfig, casterId, team, startX, startY,
                        spreadDirX, spreadDirY,
                        0f, finalSpellDamage, projConfig.BaseSpeed, 0f, config.ApplyEffects,
                        1, computedLifespan,
                        isCritical: false,
                        isFriendly: isFriendlyProj
                    );

                    // FIXED: Increment PierceCount so the 'preventative' hit doesn't trigger immediate destruction
                    if (isFriendlyProj && intendedTargetId != casterId)
                    {
                        foreach (var b in createdBullets)
                        {
                            b.HitEnemies.Add(casterId);
                            b.PierceCount += 1;
                        }
                    }




                    newBullets.AddRange(createdBullets);
                }

                if (projConfig.MovementBehavior == "Orbital" && newBullets.Count > 0)
                {
                    float angleStep = (float)(Math.PI * 2 / newBullets.Count);
                    for (int i = 0; i < newBullets.Count; i++)
                    {
                        newBullets[i].OrbitAngleOffset = i * angleStep;
                    }
                }
                _eventBus.Publish(new SpawnProjectileEvent { Projectiles = newBullets, State = state });
            }
        }

        if (config.ActionType == SkillActionType.Beam)
        {
            float baseAngle = 0f;
            bool hasValidTarget = true;
            var hostileTargets = TargetingHelper.GetHostileTargets(state, team);

            if (config.TargetType == SkillTargetType.ClosestEnemy)
            {
                var closest = TargetingHelper.FindClosestTarget(startX, startY, hostileTargets);
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
                if (sourceProjectile != null) { sourceProjectile.SweepAngle += config.SweepAngleSpeed; baseAngle = sourceProjectile.SweepAngle; }
                else if (caster != null) { caster.CurrentSweepAngle += config.SweepAngleSpeed; baseAngle = caster.CurrentSweepAngle; }
            }
            else if (config.TargetType == SkillTargetType.Down) baseAngle = (float)(Math.PI / 2);

            if (!hasValidTarget) return;

            float dirX = (float)Math.Cos(baseAngle);
            float dirY = (float)Math.Sin(baseAngle);
            float endX = startX + (dirX * config.Range);
            float endY = startY + (dirY * config.Range);

            _eventBus.Publish(new BeamVisualEvent
            {
                Dto = new BeamEventDto { StartX = startX, StartY = startY, TargetX = endX, TargetY = endY, Width = config.BeamWidth, ColorTint = config.ColorTint },
                CasterId = casterId,
                SkillId = config.Id
            });

            float hitThresholdSq = (config.BeamWidth / 2) * (config.BeamWidth / 2);
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
                    float mitigatedDamage = CombatSystem.CalculateMitigatedDamage(0f, finalSpellDamage, target, _configs);
                    _eventBus.Publish(new DamageAppliedEvent { Target = target, AttackerId = casterId, State = state, Amount = mitigatedDamage, IsCritical = false, IsDodge = false, IsBlock = false });
                }
            }
        }

        if (config.ActionType == SkillActionType.Summon)
        {
            if (_configs.Enemies.TryGetValue(config.SummonConfigId, out var summonConfig))
            {
                float mapW = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMap) ? currentMap.Width : 4000f;
                float mapH = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMapH) ? currentMapH.Height : 4000f;
                for (int i = 0; i < config.SummonCount; i++)
                {
                    float angle = (float)(Random.Shared.NextDouble() * Math.PI * 2);
                    float dist = (float)(Random.Shared.NextDouble() * config.SummonRadius);
                    float spawnX = Math.Clamp(startX + (float)Math.Cos(angle) * dist, 35, mapW - 35);
                    float spawnY = Math.Clamp(startY + (float)Math.Sin(angle) * dist, 35, mapH - 35);
                    var newSummon = new EnemyEntity();
                    newSummon.Initialize(summonConfig, spawnX, spawnY, _configs);
                    newSummon.CurrentHp = newSummon.GetTotalStat("maxHp", _configs);
                    newSummon.Team = team;
                    state.Enemies.TryAdd(newSummon.Id, newSummon);
                }
            }
            return;
        }

        if (config.ActionType == SkillActionType.AoE)
        {
            bool isHeal = config.BaseDamage < 0;
            float actualDamage = isHeal ? -Math.Abs(finalSpellDamage) : finalSpellDamage;
            bool isPlayerTeam = string.IsNullOrEmpty(team) || team == "Player";

            _eventBus.Publish(new AoeVisualEvent
            {
                Dto = new AoeEventDto { X = startX, Y = startY, Radius = config.Radius, IsFriendly = isPlayerTeam, ConfigId = config.Id },
                CasterId = casterId,
                SkillId = config.Id
            });

            float radiusSq = config.Radius * config.Radius;

            void ApplyAoeEffects(BaseActorEntity target)
            {
                if (config.ApplyEffects != null)
                {
                    foreach (var effectId in config.ApplyEffects)
                        _eventBus.Publish(new ApplyEffectEvent { Target = target, EffectConfigId = effectId, Caster = caster });
                }
            }

            // Same "hit everyone within radius" shape regardless of team/heal - only the candidate
            // set and whether damage is mitigated differ (heals are never mitigated).
            void ApplyAoeToCandidates(IEnumerable<BaseActorEntity> candidates, bool mitigate)
            {
                foreach (var target in candidates)
                {
                    float distSq = (target.X - startX) * (target.X - startX) + (target.Y - startY) * (target.Y - startY);
                    if (distSq > radiusSq) continue;

                    float appliedAmount = mitigate ? CombatSystem.CalculateMitigatedDamage(0f, actualDamage, target, _configs) : actualDamage;
                    _eventBus.Publish(new DamageAppliedEvent { Target = target, AttackerId = casterId, State = state, Amount = appliedAmount, IsCritical = false, IsDodge = false, IsBlock = false });
                    ApplyAoeEffects(target);
                }
            }

            if (isPlayerTeam)
            {
                if (!isHeal)
                    ApplyAoeToCandidates(state.Enemies.Values.Where(e => e.ActionState != "Dead" && e.Team != "Player"), mitigate: true);
                else
                {
                    ApplyAoeToCandidates(state.Players.Values, mitigate: false);
                    ApplyAoeToCandidates(state.Enemies.Values.Where(e => e.ActionState != "Dead" && e.Team == "Player"), mitigate: false);
                }
            }
            else
            {
                if (!isHeal)
                {
                    ApplyAoeToCandidates(state.Players.Values, mitigate: true);
                    ApplyAoeToCandidates(state.Enemies.Values.Where(e => e.ActionState != "Dead" && e.Team != "Enemy"), mitigate: true);
                }
                else
                    ApplyAoeToCandidates(state.Enemies.Values.Where(e => e.ActionState != "Dead" && e.Team == "Enemy"), mitigate: false);
            }
        }

    }

    private void OnTriggerDeathSkills(TriggerDeathSkillsEvent ev)
    {
        if (ev.Skills == null) return;
        foreach (var skillId in ev.Skills)
        {
            if (_configs.Skills.TryGetValue(skillId, out var skillConfig))
            {
                _eventBus.Publish(new RequestSkillCastEvent { Skill = skillConfig, CasterId = ev.EntityId, StartX = ev.X, StartY = ev.Y, Team = ev.Team, State = ev.State });
            }
        }
    }

    private void OnResetPlayerSkills(ResetPlayerSkillsEvent ev)
    {
        foreach (var player in ev.State.Players.Values)
        {
            player.ActionState = "Idle";
            player.CurrentCastingSkillId = string.Empty;
            player.CurrentCastTimer = 0f;
            player.MaxCastTimer = 0f;
            player.DynamicSkillTimers.Clear();
            foreach (var skill in player.SynergizedSkills)
            {
                if (skill.CurrentChannelTimer > 0)
                    _eventBus.Publish(new BeamEndedEvent { CasterId = player.ConnectionId, SkillId = skill.ConfigId });
                skill.CurrentCastTimer = 0f; skill.CurrentChannelTimer = 0f; skill.CurrentCooldown = 0f;
            }
        }
    }

    public void Update(float dt, GameState state)
    {
        ProcessEnemySkills(dt, state);
        ProcessPlayerSkills(dt, state);
    }

    private void ProcessEnemySkills(float dt, GameState state)
    {
        foreach (var enemy in state.Enemies.Values)
        {
            if (enemy.ActionState == "Dead") continue;
            if (enemy.SkillWaitTimer > 0) { enemy.SkillWaitTimer -= dt; continue; }

            float hasteMult = (100f + Math.Max(0f, enemy.GetTotalStat("haste", _configs))) / 100f;

            foreach (var skill in enemy.Skills)
            {
                if (!_configs.Skills.TryGetValue(skill.ConfigId, out var skillConfig)) continue;
                if (skill.CurrentCooldown > 0) skill.CurrentCooldown -= dt;

                if (skill.CurrentChannelTimer > 0)
                {
                    skill.CurrentChannelTimer -= dt;

                    if (skillConfig.IsRepeated)
                    {
                        if (skillConfig.TickRate > 0)
                        {
                            skill.TimeSinceLastTick += dt;
                            if (skill.TimeSinceLastTick >= skillConfig.TickRate)
                            {
                                skill.TimeSinceLastTick -= skillConfig.TickRate;
                                ExecuteSkill(skillConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, state, _configs, _eventBus);
                            }
                        }
                        else
                        {
                            ExecuteSkill(skillConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, state, _configs, _eventBus);
                        }
                    }

                    if (skill.CurrentChannelTimer <= 0)
                    {
                        skill.CurrentCooldown = skillConfig.CooldownSeconds / hasteMult;
                        skill.TimeSinceLastTick = 0f;
                        _eventBus.Publish(new BeamEndedEvent { CasterId = enemy.Id, SkillId = skillConfig.Id });
                    }
                }


                if (skillConfig.IsIndependent && skill.CurrentCastTimer > 0)
                {
                    skill.CurrentCastTimer -= dt;
                    if (skill.CurrentCastTimer <= 0)
                    {
                        if (skillConfig.ChannelDurationSeconds > 0) { skill.CurrentChannelTimer = skillConfig.ChannelDurationSeconds; if (!skillConfig.IsRepeated) ExecuteSkill(skillConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, state, _configs, _eventBus); }
                        else { ExecuteSkill(skillConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, state, _configs, _eventBus); skill.CurrentCooldown = skillConfig.CooldownSeconds / hasteMult; }
                    }
                }
            }

            var busySkill = enemy.Skills.FirstOrDefault(s => (s.CurrentCastTimer > 0 || s.CurrentChannelTimer > 0) && (_configs.Skills.TryGetValue(s.ConfigId, out var c) && !c.IsIndependent));
            bool isCasting = false;

            if (busySkill != null && _configs.Skills.TryGetValue(busySkill.ConfigId, out var busyConfig))
            {
                if (busySkill.CurrentCastTimer > 0)
                {
                    isCasting = true;
                    enemy.CurrentCastingSkillId = busySkill.ConfigId; // Moved inside the condition
                    enemy.CurrentCastTimer = busySkill.CurrentCastTimer;
                    enemy.MaxCastTimer = busyConfig.CastTimeSeconds / hasteMult;
                    busySkill.CurrentCastTimer -= dt;
                    if (busySkill.CurrentCastTimer <= 0)
                    {
                        if (busyConfig.ChannelDurationSeconds > 0) { busySkill.CurrentChannelTimer = busyConfig.ChannelDurationSeconds; if (!busyConfig.IsRepeated) ExecuteSkill(busyConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, state, _configs, _eventBus); }
                        else { ExecuteSkill(busyConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, state, _configs, _eventBus); busySkill.CurrentCooldown = busyConfig.CooldownSeconds / hasteMult; }
                    }
                }
                else
                {
                    enemy.CurrentCastingSkillId = string.Empty;
                    enemy.CurrentCastTimer = 0;
                    enemy.MaxCastTimer = 0;
                }
            }

            if (isCasting) enemy.ActionState = "Casting";
            else if (busySkill == null) { if (enemy.ActionState == "Casting") enemy.ActionState = "Idle"; enemy.CurrentCastingSkillId = string.Empty; enemy.CurrentCastTimer = 0f; enemy.MaxCastTimer = 0f; }

            if (busySkill == null && enemy.Skills.Count > 0 && !enemy.IsIncapacitated(_configs))
            {
                for (int i = 0; i < enemy.Skills.Count; i++)
                {
                    int checkIndex = (enemy.CurrentSkillIndex + i) % enemy.Skills.Count;
                    var skill = enemy.Skills[checkIndex];
                    if (_configs.Skills.TryGetValue(skill.ConfigId, out var skillConfig) && skillConfig.TriggerType == SkillTriggerType.Auto)
                    {
                        if (skill.CurrentCooldown <= 0 && skill.CurrentCastTimer <= 0 && skill.CurrentChannelTimer <= 0)
                        {
                            enemy.CurrentSkillIndex = (checkIndex + 1) % enemy.Skills.Count;
                            if (skillConfig.CastTimeSeconds > 0) { skill.CurrentCastTimer = skillConfig.CastTimeSeconds / hasteMult; if (!skillConfig.IsIndependent) break; }
                            else
                            {
                                if (skillConfig.ChannelDurationSeconds > 0) { skill.CurrentChannelTimer = skillConfig.ChannelDurationSeconds; if (!skillConfig.IsRepeated) ExecuteSkill(skillConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, state, _configs, _eventBus); }
                                else { ExecuteSkill(skillConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, state, _configs, _eventBus); skill.CurrentCooldown = skillConfig.CooldownSeconds / hasteMult; }
                                if (!skillConfig.IsIndependent) break;
                            }
                        }
                    }
                }
            }

            if (_configs.Enemies.TryGetValue(enemy.ConfigId, out var eConfig) && eConfig.DynamicSkills != null && !enemy.IsIncapacitated(_configs))
            {
                foreach (var trigger in eConfig.DynamicSkills)
                {
                    if (!enemy.DynamicSkillTimers.ContainsKey(trigger.SkillId)) enemy.DynamicSkillTimers[trigger.SkillId] = 0;
                    if (enemy.DynamicSkillTimers[trigger.SkillId] > 0) enemy.DynamicSkillTimers[trigger.SkillId] -= dt;

                    if (trigger.ConditionType == "MissingHealthPercent" && enemy.DynamicSkillTimers[trigger.SkillId] <= 0)
                    {
                        float hpPct = enemy.CurrentHp / enemy.GetTotalStat("maxHp", _configs);
                        if (hpPct <= trigger.ConditionThreshold && _configs.Skills.TryGetValue(trigger.SkillId, out var skillConfig))
                        {
                            var activeSkill = enemy.Skills.FirstOrDefault(s => s.ConfigId == trigger.SkillId);
                            if (activeSkill != null && (activeSkill.CurrentCastTimer > 0 || activeSkill.CurrentChannelTimer > 0)) continue;
                            float castTime = trigger.OverrideCastTime ?? skillConfig.CastTimeSeconds;
                            if (activeSkill == null) { activeSkill = new ActiveSkill { ConfigId = trigger.SkillId }; enemy.Skills.Add(activeSkill); }
                            enemy.DynamicSkillTimers[trigger.SkillId] = trigger.Cooldown;

                            if (castTime <= 0)
                            {
                                if (skillConfig.ChannelDurationSeconds > 0) { activeSkill.CurrentChannelTimer = skillConfig.ChannelDurationSeconds; if (!skillConfig.IsRepeated) ExecuteSkill(skillConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, state, _configs, _eventBus); }
                                else { ExecuteSkill(skillConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, state, _configs, _eventBus); activeSkill.CurrentCooldown = skillConfig.CooldownSeconds / hasteMult; }
                            }
                            else activeSkill.CurrentCastTimer = castTime / hasteMult;
                        }
                    }
                }
            }
        }
    }

    private void ProcessPlayerSkills(float dt, GameState state)
    {
        foreach (var player in state.Players.Values)
        {
            if (player.ActionState == "Dead") continue;
            float hasteMult = (100f + Math.Max(0f, player.GetTotalStat("haste", _configs))) / 100f;

            foreach (var skill in player.SynergizedSkills)
            {
                if (!_configs.Skills.TryGetValue(skill.ConfigId, out var config)) continue;
                if (skill.CurrentCooldown > 0) skill.CurrentCooldown -= dt;

                if (skill.CurrentChannelTimer > 0)
                {
                    skill.CurrentChannelTimer -= dt;

                    if (config.IsRepeated)
                    {
                        if (config.TickRate > 0)
                        {
                            skill.TimeSinceLastTick += dt;
                            if (skill.TimeSinceLastTick >= config.TickRate)
                            {
                                skill.TimeSinceLastTick -= config.TickRate;
                                ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, state, _configs, _eventBus);
                            }
                        }
                        else
                        {
                            ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, state, _configs, _eventBus);
                        }
                    }

                    if (skill.CurrentChannelTimer <= 0)
                    {
                        skill.CurrentCooldown = config.CooldownSeconds / hasteMult;
                        skill.TimeSinceLastTick = 0f;
                        _eventBus.Publish(new BeamEndedEvent { CasterId = player.ConnectionId, SkillId = config.Id });
                    }

                }

                if (config.IsIndependent && skill.CurrentCastTimer > 0)
                {
                    skill.CurrentCastTimer -= dt;
                    if (skill.CurrentCastTimer <= 0)
                    {
                        if (config.ChannelDurationSeconds > 0) { skill.CurrentChannelTimer = config.ChannelDurationSeconds; if (!config.IsRepeated) ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, state, _configs, _eventBus); }
                        else { ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, state, _configs, _eventBus); skill.CurrentCooldown = config.CooldownSeconds / hasteMult; }
                    }
                }
            }

            var busySkill = player.SynergizedSkills.FirstOrDefault(s => (s.CurrentCastTimer > 0 || s.CurrentChannelTimer > 0) && (_configs.Skills.TryGetValue(s.ConfigId, out var c) && !c.IsIndependent));
            bool isCasting = false;

            if (busySkill != null && _configs.Skills.TryGetValue(busySkill.ConfigId, out var busyConfig))
            {
                // FIX: Only populate the CastingSkillId during the wind-up phase.
                if (busySkill.CurrentCastTimer > 0)
                {
                    isCasting = true;
                    player.CurrentCastingSkillId = busySkill.ConfigId; // Moved inside the condition
                    player.CurrentCastTimer = busySkill.CurrentCastTimer;
                    player.MaxCastTimer = busyConfig.CastTimeSeconds / hasteMult;
                    busySkill.CurrentCastTimer -= dt;
                    if (busySkill.CurrentCastTimer <= 0)
                    {
                        if (busyConfig.ChannelDurationSeconds > 0) { busySkill.CurrentChannelTimer = busyConfig.ChannelDurationSeconds; if (!busyConfig.IsRepeated) ExecuteSkill(busyConfig, player.ConnectionId, player.X, player.Y, player.Team, state, _configs, _eventBus); }
                        else { ExecuteSkill(busyConfig, player.ConnectionId, player.X, player.Y, player.Team, state, _configs, _eventBus); busySkill.CurrentCooldown = busyConfig.CooldownSeconds / hasteMult; }
                    }
                }
                else
                {
                    // FIX: Clear it during the channel phase so the client drops the animation lock
                    player.CurrentCastingSkillId = string.Empty;
                    player.CurrentCastTimer = 0;
                    player.MaxCastTimer = 0;
                }
            }

            // --- SKILL SYSTEM AUTHORITY (FIXED) ---
            if (busySkill != null)
            {
                if (isCasting)
                {
                    player.ActionState = "Casting";
                }
                else
                {
                    // We are in the CHANNELING phase (not the wind-up).
                    // We do NOT want to force "Idle" here because the MovementSystem 
                    // is the authority on whether the player is "Moving" or "Idle".
                    // We only clear the "Casting" state so MovementSystem knows it can move.
                    if (player.ActionState == "Casting")
                    {
                        player.ActionState = "Idle";
                    }
                }
            }
            else
            {
                player.CurrentCastingSkillId = string.Empty;
                player.CurrentCastTimer = 0f;
                player.MaxCastTimer = 0f;
            }

            if (busySkill == null && state.Phase == GamePhase.WaveActive && player.SynergizedSkills.Count > 0 && !player.IsIncapacitated(_configs))
            {
                for (int i = 0; i < player.SynergizedSkills.Count; i++)
                {
                    int checkIndex = (player.CurrentSkillIndex + i) % player.SynergizedSkills.Count;
                    var skill = player.SynergizedSkills[checkIndex];
                    if (_configs.Skills.TryGetValue(skill.ConfigId, out var config) && config.TriggerType == SkillTriggerType.Auto)
                    {
                        if (skill.CurrentCooldown <= 0 && skill.CurrentCastTimer <= 0 && skill.CurrentChannelTimer <= 0)
                        {
                            player.CurrentSkillIndex = (checkIndex + 1) % player.SynergizedSkills.Count;
                            if (config.CastTimeSeconds > 0) { skill.CurrentCastTimer = config.CastTimeSeconds / hasteMult; if (!config.IsIndependent) break; }
                            else
                            {
                                if (config.ChannelDurationSeconds > 0) { skill.CurrentChannelTimer = config.ChannelDurationSeconds; if (!config.IsRepeated) ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, state, _configs, _eventBus); }
                                else { ExecuteSkill(config, player.ConnectionId, player.X, player.Y, player.Team, state, _configs, _eventBus); skill.CurrentCooldown = config.CooldownSeconds / hasteMult; }
                                if (!config.IsIndependent) break;
                            }
                        }
                    }
                }
            }

            if (_configs.Characters.TryGetValue(player.ConfigId, out var pConfig) && pConfig.DynamicSkills != null && !player.IsIncapacitated(_configs))
            {
                foreach (var trigger in pConfig.DynamicSkills)
                {
                    if (!player.DynamicSkillTimers.ContainsKey(trigger.SkillId)) player.DynamicSkillTimers[trigger.SkillId] = 0;
                    if (player.DynamicSkillTimers[trigger.SkillId] > 0) player.DynamicSkillTimers[trigger.SkillId] -= dt;

                    if (trigger.ConditionType == "MissingHealthPercent" && player.DynamicSkillTimers[trigger.SkillId] <= 0)
                    {
                        float hpPct = player.CurrentHp / Math.Max(1f, player.GetTotalStat("maxHp", _configs));
                        if (hpPct <= trigger.ConditionThreshold && _configs.Skills.TryGetValue(trigger.SkillId, out var skillConfig))
                        {
                            var activeSkill = player.SynergizedSkills.FirstOrDefault(s => s.ConfigId == trigger.SkillId);
                            if (activeSkill != null && (activeSkill.CurrentCastTimer > 0 || activeSkill.CurrentChannelTimer > 0)) continue;
                            float castTime = trigger.OverrideCastTime ?? skillConfig.CastTimeSeconds;
                            if (activeSkill == null) { activeSkill = new ActiveSkill { ConfigId = trigger.SkillId }; player.SynergizedSkills.Add(activeSkill); }
                            player.DynamicSkillTimers[trigger.SkillId] = trigger.Cooldown;

                            if (castTime <= 0)
                            {
                                if (skillConfig.ChannelDurationSeconds > 0) { activeSkill.CurrentChannelTimer = skillConfig.ChannelDurationSeconds; if (!skillConfig.IsRepeated) ExecuteSkill(skillConfig, player.ConnectionId, player.X, player.Y, player.Team, state, _configs, _eventBus); }
                                else { ExecuteSkill(skillConfig, player.ConnectionId, player.X, player.Y, player.Team, state, _configs, _eventBus); activeSkill.CurrentCooldown = skillConfig.CooldownSeconds / hasteMult; }
                            }
                            else activeSkill.CurrentCastTimer = castTime / hasteMult;
                        }
                    }
                }
            }
        }
    }

    private void ExecuteSkill(SkillConfig config, string casterId, float startX, float startY, string team, GameState state, ConfigManager configs, EventBus eventBus, ProjectileEntity? sourceProjectile = null)
    {
        _eventBus.Publish(new RequestSkillCastEvent
        {
            Skill = config,
            CasterId = casterId,
            StartX = startX,
            StartY = startY,
            Team = team,
            State = state,
            SourceProjectile = sourceProjectile
        });
    }


}

internal static class TargetingHelper
{
    public static IEnumerable<BaseActorEntity> GetHostileTargets(GameState state, string casterTeam)
    {
        return casterTeam == "Player"
            ? state.Enemies.Values.Where(e => e.Team != "Player").Cast<BaseActorEntity>()
            : state.Players.Values.Cast<BaseActorEntity>().Concat(state.Enemies.Values.Where(e => e.Team != "Enemy").Cast<BaseActorEntity>());
    }

    public static BaseActorEntity? FindClosestTarget(float originX, float originY, IEnumerable<BaseActorEntity> candidates)
    {
        BaseActorEntity? closest = null;
        float closestDistSq = float.MaxValue;

        foreach (var candidate in candidates)
        {
            if (candidate.ActionState == "Dead") continue;
            float distSq = (candidate.X - originX) * (candidate.X - originX) + (candidate.Y - originY) * (candidate.Y - originY);
            if (distSq < closestDistSq) { closestDistSq = distSq; closest = candidate; }
        }
        return closest;
    }
}
