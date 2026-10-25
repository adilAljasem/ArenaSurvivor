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

    // --- NEW: Persistent Ground & Aura Tracker ---
    private class PersistentSkill
    {
        public string UniqueId { get; set; } = Guid.NewGuid().ToString(); // Solves the visual overwrite bug!
        public SkillConfig Config { get; set; } = null!;
        public string CasterId { get; set; } = string.Empty;
        public string? SourceProjectileId { get; set; }
        public float X { get; set; }
        public float Y { get; set; }
        public string Team { get; set; } = string.Empty;
        public float TimeRemaining { get; set; }
        public float TimeSinceLastTick { get; set; }
        public bool StickToCaster { get; set; }
        public float PrecalculatedDamage { get; set; }
    }
    private List<PersistentSkill> _persistentSkills = new();
    private List<(string EntityId, float TargetX, float TargetY)> _delayedTeleports = new();
    private Dictionary<string, int> _summonSequence = new();

    public void Initialize(EventBus eventBus, ConfigManager configs)
    {
        _eventBus = eventBus;
        _configs = configs;

        _eventBus.Subscribe<RequestSkillCastEvent>(OnRequestSkillCast);
        _eventBus.Subscribe<TriggerDeathSkillsEvent>(OnTriggerDeathSkills);
        _eventBus.Subscribe<ResetPlayerSkillsEvent>(OnResetPlayerSkills);
        _eventBus.Subscribe<BeamEndedEvent>(OnBeamEnded);
    }

    private void OnBeamEnded(BeamEndedEvent ev, GameState state)
    {
        // Resets the spawn cycle when the channel finishes
        _summonSequence.Remove($"{ev.CasterId}_{ev.SkillId}");
    }

    private void OnRequestSkillCast(RequestSkillCastEvent ev, GameState state)
    {
        var config = ev.Skill;
        string casterId = ev.CasterId;
        float startX = ev.StartX;
        float startY = ev.StartY;
        string team = ev.Team;
        ProjectileEntity? sourceProjectile = !string.IsNullOrEmpty(ev.SourceProjectileId) && state.Projectiles.TryGetValue(ev.SourceProjectileId, out var sp) ? sp : null;

        BaseActorEntity? caster = EntityResolver.ResolveActor(state, casterId);


        float finalSpellDamage = config.BaseDamage;
        if (caster != null && Math.Abs(finalSpellDamage) > 0)
        {
            bool isHeal = finalSpellDamage < 0;
            float rawAbsoluteDamage = Math.Abs(finalSpellDamage);

            if (!isHeal)
            {
                // Immune skills skip outside damage scaling entirely - damage stays exactly
                // BaseDamage, unaffected by the caster's magicDamage or damagePercent stats.
                if (!config.Immune)
                {
                    float magicBonus = caster.GetTotalStat("magicDamage", _configs);
                    float damagePercent = caster.GetTotalStat("damagePercent", _configs);
                    rawAbsoluteDamage = (rawAbsoluteDamage + (magicBonus * 0.5f)) * (1f + damagePercent);
                }
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
            if (caster != null)
            {
                // Direct self-damage/self-heal: finalSpellDamage was already computed above with the
                // same magicDamage/damagePercent scaling (or Immune bypass) every other damage-dealing
                // ActionType gets - it just never had anywhere to go for SelfBuff before now.
                // Deliberately NOT run through CombatSystem.CalculateMitigatedDamage: this is a
                // self-inflicted hit, so the caster's own armor/magicDefense shouldn't water it down.
                // Wrap it in CalculateMitigatedDamage(0f, finalSpellDamage, caster, _configs) instead
                // if you'd rather a tankier character take less from their own skill.
                if (Math.Abs(finalSpellDamage) > 0)
                {
                    _eventBus.Publish(new DamageAppliedEvent
                    {
                        TargetId = casterId,
                        AttackerId = casterId,
                        Amount = finalSpellDamage,
                        IsCritical = false,
                        IsDodge = false,
                        IsBlock = false
                    });
                }

                if (config.ApplyEffects != null)
                {
                    foreach (var effectId in config.ApplyEffects)
                    {
                        _eventBus.Publish(new ApplyEffectEvent { TargetId = casterId, EffectConfigId = effectId, CasterId = casterId });
                    }
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
                var closest = TargetingHelper.FindClosestTarget(startX, startY, float.MaxValue, TargetingHelper.GetHostileTargets(state, team)); // Projectile block
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

                float rangeBasedLifespan = projConfig.BaseSpeed > 0 ? (config.Range / Math.Max(1f, projConfig.BaseSpeed)) : 0.15f;
                float computedLifespan = rangeBasedLifespan;
                if (config.TargetType == SkillTargetType.ClosestAlly && projConfig.BaseSpeed > 0)
                    computedLifespan = Math.Max(computedLifespan, (length * 1.2f) / projConfig.BaseSpeed);
                if (config.ChannelDurationSeconds > 0) computedLifespan = config.ChannelDurationSeconds;
                if (projConfig.Lifespan > 0) computedLifespan = projConfig.Lifespan;
                if (config.Lifespan > 0) computedLifespan = config.Lifespan;

                // FLOOR: same principle as CombatSystem's weapon-fire calc, but NOT applied when
                // ChannelDurationSeconds is driving the lifespan - that's an intentional "lives exactly as
                // long as the channel" design, not a range miscalculation, so it's allowed to be shorter.
                if (config.ChannelDurationSeconds <= 0)
                    computedLifespan = Math.Max(computedLifespan, rangeBasedLifespan);


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
                _eventBus.Publish(new SpawnProjectileEvent { Projectiles = newBullets });
            }
        }

        if (config.ActionType == SkillActionType.Beam)
        {
            float baseAngle = 0f;
            bool hasValidTarget = true;
            var hostileTargets = TargetingHelper.GetHostileTargets(state, team);

            if (config.TargetType == SkillTargetType.ClosestEnemy)
            {
                var closest = TargetingHelper.FindClosestTarget(startX, startY, float.MaxValue, hostileTargets); // Beam block
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

            string beamIdentityId = sourceProjectile?.Id ?? casterId;

            _eventBus.Publish(new BeamVisualEvent
            {
                Dto = new BeamEventDto { StartX = startX, StartY = startY, TargetX = endX, TargetY = endY, Width = config.BeamWidth, ColorTint = config.ColorTint },
                CasterId = beamIdentityId,
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
                float targetHitRadius = target is EnemyEntity e
                                    ? (_configs.Enemies.TryGetValue(e.ConfigId, out var eCfg) ? eCfg.HitRadius : 15f)
                                    : (_configs.Characters.TryGetValue(((PlayerEntity)target).ConfigId, out var pCfg) ? pCfg.HitRadius : 15f);

                float effectiveRadius = (config.BeamWidth / 2) + targetHitRadius;
                if (distSqToSegment <= (effectiveRadius * effectiveRadius))
                {
                    float mitigatedDamage = CombatSystem.CalculateMitigatedDamage(0f, finalSpellDamage, target, _configs);
                    _eventBus.Publish(new DamageAppliedEvent { TargetId = EntityResolver.GetId(target), AttackerId = casterId, Amount = mitigatedDamage, IsCritical = false, IsDodge = false, IsBlock = false });
                }
            }
        }
        if (config.ActionType == SkillActionType.Dash)
        {
            float targetX = startX;
            float targetY = startY;
            bool hasValidTarget = false;

            // 1. Find the target to dash towards[cite: 6]
            if (config.TargetType == SkillTargetType.ClosestEnemy)
            {
                var hostileTargets = TargetingHelper.GetHostileTargets(state, team);
                var closest = TargetingHelper.FindClosestTarget(startX, startY, float.MaxValue, hostileTargets);
                if (closest != null)
                {
                    targetX = closest.X;
                    targetY = closest.Y;
                    hasValidTarget = true;
                }
            }
            else if (config.TargetType == SkillTargetType.AimDirection)
            {
                if (caster is PlayerEntity p) { targetX = p.AimX; targetY = p.AimY; hasValidTarget = true; }
                else if (caster is EnemyEntity e) { targetX = e.AimX; targetY = e.AimY; hasValidTarget = true; }
            }
            if (hasValidTarget && caster != null)
            {
                float dx = targetX - startX;
                float dy = targetY - startY;
                float length = (float)Math.Sqrt(dx * dx + dy * dy);

                if (length > 0)
                {
                    // ALWAYS travel the full dash distance! 
                    // This ensures the boss bulldozes through the player and overshoots them, 
                    // instead of stopping directly on top of their exact coordinate.[cite: 6]
                    float dashDist = config.Range;
                    float dirX = dx / length;
                    float dirY = dy / length;

                    float endX = startX + (dirX * dashDist);
                    float endY = startY + (dirY * dashDist);

                    float mapW = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMap) ? currentMap.Width : 4000f;
                    float mapH = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMapH) ? currentMapH.Height : 4000f;
                    endX = Math.Clamp(endX, 35, mapW - 35);
                    endY = Math.Clamp(endY, 35, mapH - 35);

                    // 2. Snap the Caster. (The client's interpolation smoothly slides them here at high speed!)[cite: 2]
                    caster.SetPosition(endX, endY);

                    // 3. Visual Effect: Draw a beam connecting start and end so players see the charge path[cite: 6]
                    _eventBus.Publish(new BeamVisualEvent
                    {
                        Dto = new BeamEventDto { StartX = startX, StartY = startY, TargetX = endX, TargetY = endY, Width = config.BeamWidth > 0 ? config.BeamWidth : 60f, ColorTint = config.ColorTint },
                        CasterId = casterId,
                        SkillId = config.Id
                    });

                    // 4. Collision: Hit everything along the path using your existing Beam math[cite: 6]
                    var enemiesToHit = team == "Player"
                        ? state.Enemies.Values.Where(e => e.Team != "Player").Cast<BaseActorEntity>()
                        : state.Players.Values.Cast<BaseActorEntity>().Concat(state.Enemies.Values.Where(e => e.Team != "Enemy"));

                    foreach (var target in enemiesToHit)
                    {
                        if (target.ActionState == "Dead") continue;
                        float fx = target.X - startX; float fy = target.Y - startY;
                        float rx = endX - startX; float ry = endY - startY;
                        float rayLenSq = rx * rx + ry * ry;
                        float t = rayLenSq == 0 ? 0 : Math.Max(0, Math.Min(1, (fx * rx + fy * ry) / rayLenSq));

                        float closestX = startX + t * rx; float closestY = startY + t * ry;
                        float distX = closestX - target.X; float distY = closestY - target.Y;
                        float distSqToSegment = (distX * distX) + (distY * distY);

                        float targetHitRadius = target is EnemyEntity e
                                            ? (_configs.Enemies.TryGetValue(e.ConfigId, out var eCfg) ? eCfg.HitRadius : 15f)
                                            : (_configs.Characters.TryGetValue(((PlayerEntity)target).ConfigId, out var pCfg) ? pCfg.HitRadius : 15f);

                        float effectiveRadius = (config.BeamWidth > 0 ? config.BeamWidth / 2f : 30f) + targetHitRadius;

                        if (distSqToSegment <= (effectiveRadius * effectiveRadius))
                        {
                            float mitigatedDamage = CombatSystem.CalculateMitigatedDamage(0f, Math.Abs(finalSpellDamage), target, _configs);
                            _eventBus.Publish(new DamageAppliedEvent { TargetId = EntityResolver.GetId(target), AttackerId = casterId, Amount = mitigatedDamage, IsCritical = false, IsDodge = false, IsBlock = false });

                            if (config.ApplyEffects != null)
                            {
                                foreach (var effectId in config.ApplyEffects)
                                    _eventBus.Publish(new ApplyEffectEvent { TargetId = EntityResolver.GetId(target), EffectConfigId = effectId, CasterId = casterId });
                            }
                        }
                    }

                    // 5. Fire Trail (Data-Driven Payload): Drop a secondary skill along the path[cite: 6]
                    if (!string.IsNullOrEmpty(config.ProjectileId) && _configs.Skills.TryGetValue(config.ProjectileId, out var trailSkill))
                    {
                        // Fallback: If ProjectileCount is 1 (the default) or 0, calculate 1 puddle per 100 pixels.
                        // Otherwise, use the exact ProjectileCount requested from the JSON.[cite: 10]
                        int totalPuddles = config.ProjectileCount > 1
                            ? config.ProjectileCount
                            : Math.Max(1, (int)(dashDist / 100f) + 1);

                        for (int i = 0; i < totalPuddles; i++)
                        {
                            // If only 1 puddle, drop it in the middle. Otherwise, space them evenly from start to end.[cite: 6]
                            float t = (totalPuddles == 1) ? 0.5f : (float)i / (totalPuddles - 1);
                            float puddleX = startX + (dirX * dashDist * t);
                            float puddleY = startY + (dirY * dashDist * t);

                            _eventBus.Publish(new RequestSkillCastEvent
                            {
                                Skill = trailSkill,
                                CasterId = casterId,
                                StartX = puddleX,
                                StartY = puddleY,
                                Team = team
                            });
                        }
                    }
                }
            }
        }


        if (config.ActionType == SkillActionType.Teleport)
        {
            float targetX = startX;
            float targetY = startY;
            bool hasValidTarget = false;

            // 1. Find the target to teleport behind[cite: 6]
            if (config.TargetType == SkillTargetType.ClosestEnemy)
            {
                var hostileTargets = TargetingHelper.GetHostileTargets(state, team);
                var closest = TargetingHelper.FindClosestTarget(startX, startY, float.MaxValue, hostileTargets);
                if (closest != null)
                {
                    targetX = closest.X;
                    targetY = closest.Y;
                    hasValidTarget = true;
                }
            }
            else if (config.TargetType == SkillTargetType.AimDirection)
            {
                if (caster is PlayerEntity p) { targetX = p.AimX; targetY = p.AimY; hasValidTarget = true; }
                else if (caster is EnemyEntity e) { targetX = e.AimX; targetY = e.AimY; hasValidTarget = true; }
            }

            if (hasValidTarget && caster != null)
            {
                float dx = targetX - startX;
                float dy = targetY - startY;
                float length = (float)Math.Sqrt(dx * dx + dy * dy);

                float endX = targetX;
                float endY = targetY;

                if (length > 0)
                {
                    // Teleport slightly behind the target (overshoot by 100 pixels)[cite: 6]
                    float dirX = dx / length;
                    float dirY = dy / length;
                    endX = targetX + (dirX * 100f);
                    endY = targetY + (dirY * 100f);
                }

                // Keep inside map bounds[cite: 6]
                float mapW = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMap) ? currentMap.Width : 4000f;
                float mapH = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMapH) ? currentMapH.Height : 4000f;
                endX = Math.Clamp(endX, 35, mapW - 35);
                endY = Math.Clamp(endY, 35, mapH - 35);

                // 2. Instantly snap the caster to the new position[cite: 15]
                caster.SetPosition(endX, endY);

                // 3. Payload: Cast the secondary skill at the new location[cite: 6, 10]
                if (!string.IsNullOrEmpty(config.ProjectileId) && _configs.Skills.TryGetValue(config.ProjectileId, out var payloadSkill))
                {
                    _eventBus.Publish(new RequestSkillCastEvent
                    {
                        Skill = payloadSkill,
                        CasterId = casterId,
                        StartX = endX,
                        StartY = endY,
                        Team = team
                    });
                }
            }
        }





        if (config.ActionType == SkillActionType.Summon)
        {
            if (config.SummonConfigIds == null || config.SummonConfigIds.Count == 0) return;

            float mapW = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMap) ? currentMap.Width : 4000f;
            float mapH = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMapH) ? currentMapH.Height : 4000f;

            // Retrieve the current sequence index for this specific caster and skill
            string seqKey = $"{casterId}_{config.Id}";
            if (!_summonSequence.TryGetValue(seqKey, out int spawnIndex)) spawnIndex = 0;

            // Increment by how many we are spawning this tick
            _summonSequence[seqKey] = spawnIndex + config.SummonCount;

            for (int i = 0; i < config.SummonCount; i++)
            {
                // Always pick the sequential index
                int currentIndex = spawnIndex + i;
                string chosenId = config.SummonConfigIds[currentIndex % config.SummonConfigIds.Count];

                if (!string.IsNullOrEmpty(chosenId) && _configs.Enemies.TryGetValue(chosenId, out var summonConfig))
                {
                    // Space them out mathematically in a circle based on the total array size
                    float angle = currentIndex * ((float)Math.PI * 2) / Math.Max(1, config.SummonConfigIds.Count);

                    // Always push them exactly to the edge of the radius
                    float dist = config.SummonRadius;

                    float spawnX = Math.Clamp(startX + (float)Math.Cos(angle) * dist, 35, mapW - 35);
                    float spawnY = Math.Clamp(startY + (float)Math.Sin(angle) * dist, 35, mapH - 35);

                    var newSummon = new EnemyEntity();
                    newSummon.Initialize(summonConfig, spawnX, spawnY, _configs);
                    newSummon.CurrentHp = newSummon.GetTotalStat("maxHp", _configs);
                    newSummon.SetTeam(team);
                    state.Enemies.TryAdd(newSummon.Id, newSummon);
                }
            }
            return;
        }

        if (config.ActionType == SkillActionType.Clone)
        {
            float mapW = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMap) ? currentMap.Width : 4000f;
            float mapH = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMapH) ? currentMapH.Height : 4000f;

            int totalEntities = config.SummonCount + 1;
            var spawnPoints = new List<(float X, float Y)>();

            float baseAngle = (float)(Random.Shared.NextDouble() * Math.PI * 2);
            float radius = config.SummonRadius > 150f ? config.SummonRadius : 250f;

            for (int i = 0; i < totalEntities; i++)
            {
                float angle = baseAngle + (i * (float)(Math.PI * 2) / totalEntities);
                float px = Math.Clamp(startX + (float)Math.Cos(angle) * radius, 35, mapW - 35);
                float py = Math.Clamp(startY + (float)Math.Sin(angle) * radius, 35, mapH - 35);
                spawnPoints.Add((px, py));
            }

            spawnPoints = spawnPoints.OrderBy(p => Random.Shared.Next()).ToList();

            // Mask the initial spawn overlap with a massive VFX burst at the center!
            _eventBus.Publish(new AoeVisualEvent
            {
                Dto = new AoeEventDto { X = startX, Y = startY, Radius = 80f, IsFriendly = (team == "Player"), ConfigId = config.Id },
                CasterId = casterId,
                SkillId = config.Id
            });

            // 1. Queue the caster to teleport NEXT frame so it slides smoothly
            if (caster != null)
            {
                _delayedTeleports.Add((casterId, spawnPoints[0].X, spawnPoints[0].Y));
            }

            // 2. SPAWN THE CLONES AT THE CENTER (They will slide out alongside the boss next frame)
            for (int i = 0; i < config.SummonCount; i++)
            {
                var point = spawnPoints[i + 1];
                var clone = new EnemyEntity();

                string cloneConfigId = (config.SummonConfigIds != null && config.SummonConfigIds.Count > 0)
                             ? config.SummonConfigIds[Random.Shared.Next(config.SummonConfigIds.Count)]
                             : string.Empty;

                if (!string.IsNullOrEmpty(cloneConfigId) && _configs.Enemies.TryGetValue(cloneConfigId, out var cloneConfig))
                {
                    clone.Initialize(cloneConfig, startX, startY, _configs);
                    clone.Skills.Clear();
                    clone.Weapons.Clear();
                    clone.OwnedItems.Clear();
                }
                else
                {
                    clone.SetPosition(startX, startY);
                }

                clone.SetTeam(team);
                clone.DespawnTimer = config.Lifespan > 0 ? config.Lifespan : 10f;

                // Queue the clone to teleport to its specific spot next frame
                _delayedTeleports.Add((clone.Id, point.X, point.Y));

                if (caster != null)
                {
                    // >>> ADD THESE LINES: Sync the skill rotation and wipe the spawn delay! <<<
                    clone.CurrentSkillIndex = caster.CurrentSkillIndex;

                    if (caster is EnemyEntity casterEnemy)
                    {
                        clone.SkillWaitTimer = casterEnemy.SkillWaitTimer;
                        clone.AttackCooldown = casterEnemy.AttackCooldown;
                    }
                    else
                    {
                        clone.SkillWaitTimer = 0f;
                    }

                    foreach (var kvp in caster.DynamicSkillTimers)
                    {
                        clone.DynamicSkillTimers[kvp.Key] = kvp.Value;
                    }
                    // Copy Stats
                    foreach (var stat in caster.CachedStats)
                    {
                        clone.Stats.InitializeStat(stat.Key, stat.Value);
                        clone.CachedStats[stat.Key] = stat.Value;
                    }
                    clone.CurrentMaxHp = caster.CurrentMaxHp;
                    clone.CurrentHp = caster.CurrentHp;

                    // Manually copy the current shield amount
                    clone.ModifyShield(caster.CurrentShield);

                    // Copy Active Status Effects (Buffs & Debuffs)
                    foreach (var effect in caster.ActiveEffects)
                    {
                        clone.ActiveEffects.Add(new ActiveEffect
                        {
                            ConfigId = effect.ConfigId,
                            TimeRemaining = effect.TimeRemaining,
                            TimeSinceLastTick = effect.TimeSinceLastTick,
                            SourceId = effect.SourceId,
                            GrantedShieldAmount = effect.GrantedShieldAmount,
                            StackCount = effect.StackCount,
                            IsTeamSwitcher = effect.IsTeamSwitcher,
                            Caster = effect.Caster
                        });
                    }

                    // Copy Skills with precise active timers
                    foreach (var skill in caster.Skills)
                    {
                        if (_configs.Skills.TryGetValue(skill.ConfigId, out var sCfg) && sCfg.ActionType == SkillActionType.Clone)
                            continue;

                        clone.Skills.Add(new ActiveSkill
                        {
                            ConfigId = skill.ConfigId,
                            CurrentCooldown = skill.CurrentCooldown,
                            CurrentCastTimer = skill.CurrentCastTimer,
                            CurrentChannelTimer = skill.CurrentChannelTimer,
                            TimeSinceLastTick = skill.TimeSinceLastTick,
                            SourceEffectId = skill.SourceEffectId,
                            IsDynamic = skill.IsDynamic
                        });
                    }

                    // Copy Weapons with precise active timers
                    foreach (var weapon in caster.Weapons)
                    {
                        clone.Weapons.Add(new EquippedWeapon
                        {
                            ConfigId = weapon.ConfigId,
                            Level = weapon.Level,
                            SlotIndex = weapon.SlotIndex,
                            CurrentCooldown = weapon.CurrentCooldown, // <-- Ensures exact firing sync
                            TotalBaseStats = weapon.TotalBaseStats != null ? new Dictionary<string, float>(weapon.TotalBaseStats) : new Dictionary<string, float>(),
                            RolledStats = weapon.RolledStats != null ? new Dictionary<string, float>(weapon.RolledStats) : new Dictionary<string, float>(),
                            MergedConfigIds = new List<string>(weapon.MergedConfigIds),
                            SourceEffectId = weapon.SourceEffectId
                        });
                    }
                }

                state.Enemies.TryAdd(clone.Id, clone);
            }
            return;
        }



        if (config.ActionType == SkillActionType.AoE || config.ActionType == SkillActionType.Vacuum)
        {
            float targetX = startX;
            float targetY = startY;

            if (config.TargetType == SkillTargetType.ClosestEnemy)
            {
                var hostileTargets = TargetingHelper.GetHostileTargets(state, team);
                var closest = TargetingHelper.FindClosestTarget(startX, startY, config.Range > 0 ? config.Range * config.Range : float.MaxValue, hostileTargets);
                if (closest != null) { targetX = closest.X; targetY = closest.Y; }
            }
            else if (config.TargetType == SkillTargetType.AimDirection || config.TargetType == SkillTargetType.Ground)
            {
                float aimX = startX, aimY = startY;
                if (caster is PlayerEntity p) { aimX = p.AimX; aimY = p.AimY; }
                else if (caster is EnemyEntity e) { aimX = e.AimX; aimY = e.AimY; }

                if (config.TargetType == SkillTargetType.Ground)
                {
                    // Ground drops exactly at the caster's feet and stays there
                    targetX = startX;
                    targetY = startY;
                }
                else // AimDirection
                {
                    float dx = aimX - startX;
                    float dy = aimY - startY;
                    float length = (float)Math.Sqrt(dx * dx + dy * dy);
                    if (length > 0)
                    {
                        float dist = config.Range > 0 ? config.Range : 300f;
                        targetX = startX + (dx / length) * dist;
                        targetY = startY + (dy / length) * dist;
                    }
                }
            }

            // Keep inside bounds
            float mapW = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMap) ? currentMap.Width : 4000f;
            float mapH = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMapH) ? currentMapH.Height : 4000f;
            targetX = Math.Clamp(targetX, 35, mapW - 35);
            targetY = Math.Clamp(targetY, 35, mapH - 35);

            if (config.Lifespan > 0)
            {
                // Prevent the projectile from infinitely cloning the skill!
                if (!string.IsNullOrEmpty(ev.SourceProjectileId) &&
                    _persistentSkills.Any(p => p.SourceProjectileId == ev.SourceProjectileId && p.Config.Id == config.Id))
                {
                    return;
                }

                // Register as a persistent ground effect / aura
                var ps = new PersistentSkill
                {
                    // >>> NEW: Use the Projectile ID as the UniqueId so the client can link them!
                    UniqueId = !string.IsNullOrEmpty(ev.SourceProjectileId) ? ev.SourceProjectileId : Guid.NewGuid().ToString(),
                    Config = config,
                    CasterId = casterId,
                    SourceProjectileId = ev.SourceProjectileId,
                    X = targetX,
                    Y = targetY,
                    Team = team,
                    TimeRemaining = config.Lifespan,
                    TimeSinceLastTick = config.TickRate > 0 ? config.TickRate : 0.5f, // Force immediate first tick
                    StickToCaster = (config.TargetType == SkillTargetType.Self),
                    PrecalculatedDamage = finalSpellDamage
                };
                _persistentSkills.Add(ps);
                return;
            }
            else
            {
                // Instant cast (Explosions, instant pulls)
                var ps = new PersistentSkill
                {
                    UniqueId = casterId,
                    Config = config,
                    CasterId = casterId,
                    X = targetX,
                    Y = targetY,
                    Team = team,
                    PrecalculatedDamage = finalSpellDamage
                };
                if (config.ActionType == SkillActionType.AoE) ExecuteAoE(ps, state);
                else if (config.ActionType == SkillActionType.Vacuum) ExecuteVacuum(ps, state);
            }
        }



    }

    private void ExecuteAoE(PersistentSkill ps, GameState state)
    {
        bool isHeal = ps.Config.BaseDamage < 0;
        float actualDamage = isHeal ? -Math.Abs(ps.PrecalculatedDamage) : ps.PrecalculatedDamage;
        bool isPlayerTeam = string.IsNullOrEmpty(ps.Team) || ps.Team == "Player";

        _eventBus.Publish(new AoeVisualEvent
        {
            Dto = new AoeEventDto { X = ps.X, Y = ps.Y, Radius = ps.Config.Radius, IsFriendly = isPlayerTeam, ConfigId = ps.Config.Id },
            CasterId = ps.UniqueId, // Hijack with unique ID so client draws independent visual loops[cite: 8]
            SkillId = ps.Config.Id
        });

        float radiusSq = ps.Config.Radius * ps.Config.Radius;

        void ApplyAoeToCandidates(IEnumerable<BaseActorEntity> candidates, bool mitigate)
        {
            foreach (var target in candidates)
            {
                float distSq = (target.X - ps.X) * (target.X - ps.X) + (target.Y - ps.Y) * (target.Y - ps.Y);
                if (distSq > radiusSq) continue;

                float appliedAmount = mitigate ? CombatSystem.CalculateMitigatedDamage(0f, actualDamage, target, _configs) : actualDamage;
                _eventBus.Publish(new DamageAppliedEvent { TargetId = EntityResolver.GetId(target), AttackerId = ps.CasterId, Amount = appliedAmount, IsCritical = false, IsDodge = false, IsBlock = false });

                if (ps.Config.ApplyEffects != null)
                {
                    foreach (var effectId in ps.Config.ApplyEffects)
                        _eventBus.Publish(new ApplyEffectEvent { TargetId = EntityResolver.GetId(target), EffectConfigId = effectId, CasterId = ps.CasterId });
                }
            }
        }

        if (isPlayerTeam)
        {
            if (!isHeal) ApplyAoeToCandidates(state.Enemies.Values.Where(e => e.ActionState != "Dead" && e.Team != "Player"), mitigate: true);
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
            else ApplyAoeToCandidates(state.Enemies.Values.Where(e => e.ActionState != "Dead" && e.Team == "Enemy"), mitigate: false);
        }
    }

    private void ExecuteVacuum(PersistentSkill ps, GameState state, bool applyPull = true)
    {
        bool isPlayerTeam = string.IsNullOrEmpty(ps.Team) || ps.Team == "Player";

        // Only publish for instant casts. Persistent skills publish continuously in ProcessPersistentSkills!
        if (applyPull)
        {
            _eventBus.Publish(new AoeVisualEvent
            {
                Dto = new AoeEventDto { X = ps.X, Y = ps.Y, Radius = ps.Config.Radius, IsFriendly = isPlayerTeam, ConfigId = ps.Config.Id },
                CasterId = ps.UniqueId,
                SkillId = ps.Config.Id
            });
        }

        float radiusSq = ps.Config.Radius * ps.Config.Radius;
        var enemiesToHit = ps.Team == "Player"
            ? state.Enemies.Values.Where(e => e.Team != "Player").Cast<BaseActorEntity>()
            : state.Players.Values.Cast<BaseActorEntity>().Concat(state.Enemies.Values.Where(e => e.Team != "Enemy"));

        float pullStrength = ps.Config.BeamWidth > 0 ? ps.Config.BeamWidth : 100f;

        foreach (var target in enemiesToHit)
        {
            if (target.ActionState == "Dead") continue;

            float dx = ps.X - target.X;
            float dy = ps.Y - target.Y;
            float distSq = (dx * dx) + (dy * dy);

            if (distSq <= radiusSq)
            {
                float dist = (float)Math.Sqrt(distSq);

                // Only snap the player for instant casts. Persistent casts handle smooth pull externally!
                if (dist > 0 && applyPull)
                {
                    float actualPull = Math.Min(pullStrength, dist);
                    float newX = target.X + (dx / dist) * actualPull;
                    float newY = target.Y + (dy / dist) * actualPull;

                    float mapW = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMap) ? currentMap.Width : 4000f;
                    float mapH = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMapH) ? currentMapH.Height : 4000f;
                    newX = Math.Clamp(newX, 35, mapW - 35);
                    newY = Math.Clamp(newY, 35, mapH - 35);

                    target.SetPosition(newX, newY);
                }

                if (Math.Abs(ps.PrecalculatedDamage) > 0)
                {
                    float mitigatedDamage = CombatSystem.CalculateMitigatedDamage(0f, Math.Abs(ps.PrecalculatedDamage), target, _configs);
                    _eventBus.Publish(new DamageAppliedEvent { TargetId = EntityResolver.GetId(target), AttackerId = ps.CasterId, Amount = mitigatedDamage, IsCritical = false, IsDodge = false, IsBlock = false });
                }

                if (ps.Config.ApplyEffects != null)
                {
                    foreach (var effectId in ps.Config.ApplyEffects)
                        _eventBus.Publish(new ApplyEffectEvent { TargetId = EntityResolver.GetId(target), EffectConfigId = effectId, CasterId = ps.CasterId });
                }
            }
        }
    }

    private void OnTriggerDeathSkills(TriggerDeathSkillsEvent ev, GameState state)
    {
        foreach (var skillId in ev.Skills)
        {
            if (_configs.Skills.TryGetValue(skillId, out var skillConfig))
            {
                _eventBus.Publish(new RequestSkillCastEvent { Skill = skillConfig, CasterId = ev.EntityId, StartX = ev.X, StartY = ev.Y, Team = ev.Team });
            }
        }
    }

    private void OnResetPlayerSkills(ResetPlayerSkillsEvent ev, GameState state)
    {
        foreach (var player in state.Players.Values)
        {
            player.SetActionState("Idle");
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
        if (_delayedTeleports.Count > 0)
        {
            foreach (var tp in _delayedTeleports)
            {
                var actor = EntityResolver.ResolveActor(state, tp.EntityId);
                if (actor != null) actor.SetPosition(tp.TargetX, tp.TargetY);
            }
            _delayedTeleports.Clear();
        }
        ProcessPersistentSkills(dt, state);
        ProcessEnemySkills(dt, state);
        ProcessPlayerSkills(dt, state);
    }

    private void ProcessPersistentSkills(float dt, GameState state)
    {
        for (int i = _persistentSkills.Count - 1; i >= 0; i--)
        {
            var ps = _persistentSkills[i];
            ps.TimeRemaining -= dt;
            ps.TimeSinceLastTick += dt;

            // If it's an aura (TargetType == Self), stick to the caster's movement
            if (ps.StickToCaster)
            {
                // <<< NEW: Handle Projectile tracking vs Caster tracking
                if (!string.IsNullOrEmpty(ps.SourceProjectileId))
                {
                    if (state.Projectiles.TryGetValue(ps.SourceProjectileId, out var proj))
                    {
                        ps.X = proj.X;
                        ps.Y = proj.Y;
                    }
                    else
                    {
                        // Projectile died! End the skill immediately.
                        _eventBus.Publish(new BeamEndedEvent { CasterId = ps.UniqueId, SkillId = ps.Config.Id });
                        _persistentSkills.RemoveAt(i);
                        continue;
                    }
                }
                else
                {
                    // Normal Behavior: Stick to the character
                    var caster = EntityResolver.ResolveActor(state, ps.CasterId);
                    if (caster == null || caster.ActionState == "Dead")
                    {
                        _eventBus.Publish(new BeamEndedEvent { CasterId = ps.UniqueId, SkillId = ps.Config.Id });
                        _persistentSkills.RemoveAt(i);
                        continue;
                    }
                    ps.X = caster.X;
                    ps.Y = caster.Y;
                }
            }

            // 1. PUBLISH VISUAL EVERY FRAME: Prevents the client from destroying the animation between ticks!
            bool isPlayerTeam = string.IsNullOrEmpty(ps.Team) || ps.Team == "Player";
            _eventBus.Publish(new AoeVisualEvent
            {
                Dto = new AoeEventDto { X = ps.X, Y = ps.Y, Radius = ps.Config.Radius, IsFriendly = isPlayerTeam, ConfigId = ps.Config.Id },
                CasterId = ps.UniqueId,
                SkillId = ps.Config.Id
            });

            // 2. CONTINUOUS PULL FOR VACUUMS: Smoothly pulls targets using dt so players can escape!
            if (ps.Config.ActionType == SkillActionType.Vacuum)
            {
                float pullSpeed = ps.Config.BeamWidth > 0 ? ps.Config.BeamWidth : 100f; // Treat BeamWidth as Speed
                float radiusSq = ps.Config.Radius * ps.Config.Radius;
                var enemiesToHit = ps.Team == "Player"
                    ? state.Enemies.Values.Where(e => e.Team != "Player").Cast<BaseActorEntity>()
                    : state.Players.Values.Cast<BaseActorEntity>().Concat(state.Enemies.Values.Where(e => e.Team != "Enemy"));

                foreach (var target in enemiesToHit)
                {
                    if (target.ActionState == "Dead") continue;

                    float dx = ps.X - target.X;
                    float dy = ps.Y - target.Y;
                    float distSq = (dx * dx) + (dy * dy);

                    if (distSq <= radiusSq)
                    {
                        float dist = (float)Math.Sqrt(distSq);
                        if (dist > 0)
                        {
                            float actualPull = Math.Min(pullSpeed * dt, dist);
                            float newX = target.X + (dx / dist) * actualPull;
                            float newY = target.Y + (dy / dist) * actualPull;

                            float mapW = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMap) ? currentMap.Width : 4000f;
                            float mapH = _configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMapH) ? currentMapH.Height : 4000f;
                            newX = Math.Clamp(newX, 35, mapW - 35);
                            newY = Math.Clamp(newY, 35, mapH - 35);

                            target.SetPosition(newX, newY);
                        }
                    }
                }
            }

            float tickRate = ps.Config.TickRate > 0 ? ps.Config.TickRate : 0.5f;
            if (ps.TimeSinceLastTick >= tickRate)
            {
                ps.TimeSinceLastTick %= tickRate;
                if (ps.Config.ActionType == SkillActionType.AoE) ExecuteAoE(ps, state);
                // Disable the instant-snap pull when applying tick damage
                else if (ps.Config.ActionType == SkillActionType.Vacuum) ExecuteVacuum(ps, state, false);
            }

            // Cleanup when the lifespan expires
            if (ps.TimeRemaining <= 0)
            {
                _eventBus.Publish(new BeamEndedEvent { CasterId = ps.UniqueId, SkillId = ps.Config.Id });
                _persistentSkills.RemoveAt(i);
            }
        }
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
                SkillStateHelper.TickSkillTimers(skill, skillConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team, state, _eventBus, dt, hasteMult);
            }

            var busySkill = SkillStateHelper.FindBusySkill(enemy.Skills, _configs);
            bool isCasting = false;

            if (busySkill != null && _configs.Skills.TryGetValue(busySkill.ConfigId, out var busyConfig))
            {
                // Immune skills always run their cooldown/cast time at the full
                // configured value, regardless of the caster's haste stat.
                float busyEffectiveHasteMult = busyConfig.Immune ? 1f : hasteMult;

                if (busySkill.CurrentCastTimer > 0)
                {
                    isCasting = true;
                    enemy.CurrentCastingSkillId = busySkill.ConfigId;
                    enemy.CurrentCastTimer = busySkill.CurrentCastTimer;
                    enemy.MaxCastTimer = busyConfig.CastTimeSeconds / busyEffectiveHasteMult;
                    busySkill.CurrentCastTimer -= dt;
                    if (busySkill.CurrentCastTimer <= 0)
                    {
                        if (busyConfig.ChannelDurationSeconds > 0) { busySkill.CurrentChannelTimer = busyConfig.ChannelDurationSeconds; if (!busyConfig.IsRepeated) SkillStateHelper.RequestSkillCast(_eventBus, busyConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team); }
                        else { SkillStateHelper.RequestSkillCast(_eventBus, busyConfig, enemy.Id, enemy.X, enemy.Y, enemy.Team); busySkill.CurrentCooldown = busyConfig.CooldownSeconds / busyEffectiveHasteMult; }
                    }
                }
                else
                {
                    enemy.CurrentCastingSkillId = string.Empty;
                    enemy.CurrentCastTimer = 0;
                    enemy.MaxCastTimer = 0;
                }
            }

            // NOTE: unlike ProcessPlayerSkills below, enemies do NOT clear ActionState from
            // "Casting" to "Idle" once wind-up ends and channeling begins - they stay "Casting"
            // for the whole channel. Real behavioral difference from players, preserved exactly.
            if (isCasting) enemy.SetActionState("Casting");
            else if (busySkill == null) { if (enemy.ActionState == "Casting") enemy.SetActionState("Idle"); enemy.CurrentCastingSkillId = string.Empty; enemy.CurrentCastTimer = 0f; enemy.MaxCastTimer = 0f; }

            if (busySkill == null && enemy.Skills.Count > 0 && !enemy.IsIncapacitated(_configs))
            {
                enemy.CurrentSkillIndex = SkillStateHelper.TryAutoTriggerSkill(enemy.Skills, enemy.CurrentSkillIndex, enemy.Id, enemy.X, enemy.Y, enemy.Team, state, _configs, _eventBus, hasteMult);
            }

            if (_configs.Enemies.TryGetValue(enemy.ConfigId, out var eConfig) && eConfig.DynamicSkills != null && !enemy.IsIncapacitated(_configs))
            {
                SkillStateHelper.ProcessDynamicSkillTriggers(eConfig.DynamicSkills, enemy.DynamicSkillTimers, enemy.Skills,
                    enemy.CurrentHp, enemy.GetTotalStat("maxHp", _configs), enemy.Id, enemy.X, enemy.Y, enemy.Team,
                    state, _configs, _eventBus, dt, hasteMult);
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
                SkillStateHelper.TickSkillTimers(skill, config, player.ConnectionId, player.X, player.Y, player.Team, state, _eventBus, dt, hasteMult);
            }

            var busySkill = SkillStateHelper.FindBusySkill(player.SynergizedSkills, _configs);
            bool isCasting = false;

            if (busySkill != null && _configs.Skills.TryGetValue(busySkill.ConfigId, out var busyConfig))
            {
                // Immune skills always run their cooldown/cast time at the full
                // configured value, regardless of the caster's haste stat.
                float busyEffectiveHasteMult = busyConfig.Immune ? 1f : hasteMult;

                if (busySkill.CurrentCastTimer > 0)
                {
                    isCasting = true;
                    player.CurrentCastingSkillId = busySkill.ConfigId;
                    player.CurrentCastTimer = busySkill.CurrentCastTimer;
                    player.MaxCastTimer = busyConfig.CastTimeSeconds / busyEffectiveHasteMult;
                    busySkill.CurrentCastTimer -= dt;
                    if (busySkill.CurrentCastTimer <= 0)
                    {
                        if (busyConfig.ChannelDurationSeconds > 0) { busySkill.CurrentChannelTimer = busyConfig.ChannelDurationSeconds; if (!busyConfig.IsRepeated) SkillStateHelper.RequestSkillCast(_eventBus, busyConfig, player.ConnectionId, player.X, player.Y, player.Team); }
                        else { SkillStateHelper.RequestSkillCast(_eventBus, busyConfig, player.ConnectionId, player.X, player.Y, player.Team); busySkill.CurrentCooldown = busyConfig.CooldownSeconds / busyEffectiveHasteMult; }
                    }
                }
                else
                {
                    player.CurrentCastingSkillId = string.Empty;
                    player.CurrentCastTimer = 0;
                    player.MaxCastTimer = 0;
                }
            }

            // Players DO get ActionState cleared "Casting" -> "Idle" once the wind-up ends and
            // channeling begins, so MovementSystem (authority on Moving/Idle) can let them move -
            // see the contrasting note in ProcessEnemySkills above.
            if (busySkill != null)
            {
                if (isCasting) player.SetActionState("Casting");
                else if (player.ActionState == "Casting") player.SetActionState("Idle");
            }

            else
            {
                player.CurrentCastingSkillId = string.Empty;
                player.CurrentCastTimer = 0f;
                player.MaxCastTimer = 0f;
            }

            if (busySkill == null && state.Phase == GamePhase.WaveActive && player.SynergizedSkills.Count > 0 && !player.IsIncapacitated(_configs))
            {
                player.CurrentSkillIndex = SkillStateHelper.TryAutoTriggerSkill(player.SynergizedSkills, player.CurrentSkillIndex, player.ConnectionId, player.X, player.Y, player.Team, state, _configs, _eventBus, hasteMult);
            }

            if (_configs.Characters.TryGetValue(player.ConfigId, out var pConfig) && pConfig.DynamicSkills != null && !player.IsIncapacitated(_configs))
            {
                SkillStateHelper.ProcessDynamicSkillTriggers(pConfig.DynamicSkills, player.DynamicSkillTimers, player.SynergizedSkills,
                    player.CurrentHp, player.GetTotalStat("maxHp", _configs), player.ConnectionId, player.X, player.Y, player.Team,
                    state, _configs, _eventBus, dt, hasteMult);
            }
        }
    }


    private void ExecuteSkill(SkillConfig config, string casterId, float startX, float startY, string team, GameState state, ConfigManager configs, EventBus eventBus, ProjectileEntity? sourceProjectile = null)
        => SkillStateHelper.RequestSkillCast(eventBus, config, casterId, startX, startY, team, sourceProjectile);



}

internal static class TargetingHelper
{
    public static IEnumerable<BaseActorEntity> GetHostileTargets(GameState state, string casterTeam)
    {
        // Return ANY entity (player or enemy) that does NOT share the caster's team
        var hostilePlayers = state.Players.Values.Where(p => p.ActionState != "Dead" && p.Team != casterTeam).Cast<BaseActorEntity>();
        var hostileEnemies = state.Enemies.Values.Where(e => e.ActionState != "Dead" && e.Team != casterTeam).Cast<BaseActorEntity>();

        return hostilePlayers.Concat(hostileEnemies);
    }

    public static BaseActorEntity? FindClosestTarget(float originX, float originY, float maxRangeSq, params IEnumerable<BaseActorEntity>[] candidateSets)
    {
        BaseActorEntity? closest = null;
        float closestDistSq = maxRangeSq;

        foreach (var set in candidateSets)
        {
            foreach (var candidate in set)
            {
                if (candidate.ActionState == "Dead") continue;
                float dx = candidate.X - originX;
                float dy = candidate.Y - originY;
                float distSq = dx * dx + dy * dy;
                if (distSq < closestDistSq) { closestDistSq = distSq; closest = candidate; }
            }
        }
        return closest;
    }

}

// =====================================================================================
// DRY HELPER: SHARED SKILL STATE-MACHINE MECHANICS
// (used identically by ProcessEnemySkills and ProcessPlayerSkills)
// Adjust the DynamicSkillTrigger type name below if yours differs.
// =====================================================================================
internal static class SkillStateHelper
{
    public static void RequestSkillCast(EventBus eventBus, SkillConfig config, string casterId, float startX, float startY, string team, ProjectileEntity? sourceProjectile = null)
    {
        eventBus.Publish(new RequestSkillCastEvent { Skill = config, CasterId = casterId, StartX = startX, StartY = startY, Team = team, SourceProjectileId = sourceProjectile?.Id });
    }

    public static void TickSkillTimers(
        ActiveSkill skill, SkillConfig skillConfig, string casterId, float x, float y, string team,
        GameState state, EventBus eventBus, float dt, float hasteMult)
    {
        // Immune skills always run their cooldown/cast time at the full configured
        // value, regardless of the caster's haste stat - nothing else about the skill changes.
        float effectiveHasteMult = skillConfig.Immune ? 1f : hasteMult;

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
                        RequestSkillCast(eventBus, skillConfig, casterId, x, y, team);
                    }
                }
                else
                {
                    RequestSkillCast(eventBus, skillConfig, casterId, x, y, team);
                }
            }

            if (skill.CurrentChannelTimer <= 0)
            {
                skill.CurrentCooldown = skillConfig.CooldownSeconds / effectiveHasteMult;
                skill.TimeSinceLastTick = 0f;
                eventBus.Publish(new BeamEndedEvent { CasterId = casterId, SkillId = skillConfig.Id });
            }
        }

        if (skillConfig.IsIndependent && skill.CurrentCastTimer > 0)
        {
            skill.CurrentCastTimer -= dt;
            if (skill.CurrentCastTimer <= 0)
            {
                if (skillConfig.ChannelDurationSeconds > 0) { skill.CurrentChannelTimer = skillConfig.ChannelDurationSeconds; if (!skillConfig.IsRepeated) RequestSkillCast(eventBus, skillConfig, casterId, x, y, team); }
                else { RequestSkillCast(eventBus, skillConfig, casterId, x, y, team); skill.CurrentCooldown = skillConfig.CooldownSeconds / effectiveHasteMult; }
            }
        }
    }

    public static ActiveSkill? FindBusySkill(List<ActiveSkill> skills, ConfigManager configs)
    {
        return skills.FirstOrDefault(s => (s.CurrentCastTimer > 0 || s.CurrentChannelTimer > 0)
            && configs.Skills.TryGetValue(s.ConfigId, out var c) && !c.IsIndependent);
    }

    // Round-robins looking for the next ready Auto skill. Returns the (possibly advanced)
    // index for the caller to store back on the entity.
    public static int TryAutoTriggerSkill(
        List<ActiveSkill> skills, int currentSkillIndex, string casterId, float x, float y, string team,
        GameState state, ConfigManager configs, EventBus eventBus, float hasteMult)
    {
        int skillIndex = currentSkillIndex;

        for (int i = 0; i < skills.Count; i++)
        {
            int checkIndex = (skillIndex + i) % skills.Count;
            var skill = skills[checkIndex];

            // >>> FIX: Skip dynamically triggered skills entirely!
            if (skill.IsDynamic) continue;

            if (!configs.Skills.TryGetValue(skill.ConfigId, out var config) || config.TriggerType != SkillTriggerType.Auto) continue;
            if (skill.CurrentCooldown > 0 || skill.CurrentCastTimer > 0 || skill.CurrentChannelTimer > 0) continue;
            skillIndex = (checkIndex + 1) % skills.Count;

            // Immune skills always run their cooldown/cast time at the full configured
            // value, regardless of the caster's haste stat.
            float effectiveHasteMult = config.Immune ? 1f : hasteMult;

            if (config.CastTimeSeconds > 0)
            {
                skill.CurrentCastTimer = config.CastTimeSeconds / effectiveHasteMult;
                if (!config.IsIndependent) return skillIndex;
            }
            else
            {
                if (config.ChannelDurationSeconds > 0) { skill.CurrentChannelTimer = config.ChannelDurationSeconds; if (!config.IsRepeated) RequestSkillCast(eventBus, config, casterId, x, y, team); }
                else { RequestSkillCast(eventBus, config, casterId, x, y, team); skill.CurrentCooldown = config.CooldownSeconds / effectiveHasteMult; }
                if (!config.IsIndependent) return skillIndex;
            }
        }
        return skillIndex;
    }

    // BEHAVIOR NOTE: unified to guard against maxHp == 0 (Math.Max(1f, maxHp)) - the original
    // enemy path divided by GetTotalStat("maxHp") directly with no guard. See caller notes.
    public static void ProcessDynamicSkillTriggers(
          IEnumerable<DynamicSkillTrigger> triggers, Dictionary<string, float> timers, List<ActiveSkill> skills,
          float currentHp, float maxHp, string casterId, float x, float y, string team,
          GameState state, ConfigManager configs, EventBus eventBus, float dt, float hasteMult)
    {
        foreach (var trigger in triggers)
        {
            if (!timers.ContainsKey(trigger.SkillId)) timers[trigger.SkillId] = 0;
            if (timers[trigger.SkillId] > 0) timers[trigger.SkillId] -= dt;

            // 1. Wait until the cooldown timer is ready
            if (timers[trigger.SkillId] > 0) continue;

            if (!configs.Skills.TryGetValue(trigger.SkillId, out var skillConfig)) continue;

            // 2. Evaluate the specific condition required to fire
            if (trigger.ConditionType == "MissingHealthPercent")
            {
                float hpPct = currentHp / Math.Max(1f, maxHp);
                if (hpPct > trigger.ConditionThreshold) continue;
            }
            else if (trigger.ConditionType == "TimerLoop")
            {
                // TimerLoop fires strictly on cooldown. We just let it pass through.
            }
            else
            {
                continue; // Unknown trigger condition, skip.
            }

            var activeSkill = skills.FirstOrDefault(s => s.ConfigId == trigger.SkillId);
            if (activeSkill != null && (activeSkill.CurrentCastTimer > 0 || activeSkill.CurrentChannelTimer > 0)) continue;

            float castTime = trigger.OverrideCastTime ?? skillConfig.CastTimeSeconds;

            // >>> FIX: Flag it as IsDynamic = true so the AI knows to ignore it!
            if (activeSkill == null) { activeSkill = new ActiveSkill { ConfigId = trigger.SkillId, IsDynamic = true }; skills.Add(activeSkill); }
            // >>> THIS IS THE FIX: Lock the trigger so it doesn't fire every single frame! <<<
            timers[trigger.SkillId] = trigger.Cooldown;

            // Immune skills always run their cooldown/cast time at the full configured
            // value, regardless of the caster's haste stat.
            float effectiveHasteMult = skillConfig.Immune ? 1f : hasteMult;

            if (castTime <= 0)
            {
                if (skillConfig.ChannelDurationSeconds > 0) { activeSkill.CurrentChannelTimer = skillConfig.ChannelDurationSeconds; if (!skillConfig.IsRepeated) RequestSkillCast(eventBus, skillConfig, casterId, x, y, team); }
                else { RequestSkillCast(eventBus, skillConfig, casterId, x, y, team); activeSkill.CurrentCooldown = skillConfig.CooldownSeconds / effectiveHasteMult; }
            }
            else activeSkill.CurrentCastTimer = castTime / effectiveHasteMult;
        }
    }
}