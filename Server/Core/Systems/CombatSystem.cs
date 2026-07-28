using Server.Configs;
using Server.Entities;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Server.Core.Systems;

public class CombatSystem : IGameSystem
{
    private EventBus _eventBus = null!;
    private ConfigManager _configs = null!;

    public void Initialize(EventBus eventBus, ConfigManager configs)
    {
        _eventBus = eventBus;
        _configs = configs;
        _eventBus.Subscribe<SpawnProjectileEvent>(OnSpawnProjectile);
    }

    public void Update(float dt, GameState state)
    {
        ProcessShooting(dt, state);
        ProcessCollisions(dt, state);
    }

    private void OnSpawnProjectile(SpawnProjectileEvent ev, GameState state)
    {
        foreach (var proj in ev.Projectiles)
        {
            state.Projectiles.TryAdd(proj.Id, proj);
        }
    }


    // Shared: both players and enemies place a weapon muzzle the same way - offset applied
    // along one axis based on slot index (0=right, 1=left, 2=up, 3=down).
    private static (float spawnX, float spawnY) ApplySlotOffset(float originX, float originY, int slotIndex, float offset)
    {
        float spawnX = originX, spawnY = originY;
        if (slotIndex == 0) spawnX += offset;
        else if (slotIndex == 1) spawnX -= offset;
        else if (slotIndex == 2) spawnY -= offset;
        else if (slotIndex == 3) spawnY += offset;
        return (spawnX, spawnY);
    }


    private void ProcessShooting(float dt, GameState state)
    {
        var activePlayers = state.Players.Values.Where(p => p.ActionState != "Dead").ToList();
        var allActiveEnemies = state.Enemies.Values.Where(e => e.ActionState != "Dead").ToList();
        var nonEnemyTeam = allActiveEnemies.Where(e => e.Team != "Enemy").ToList();
        var enemyTeam = allActiveEnemies.Where(e => e.Team == "Enemy").ToList();

        foreach (var player in activePlayers)
        {
            foreach (var weapon in player.Weapons.ToList())
            {
                weapon.CurrentCooldown -= dt;
                if (weapon.CurrentCooldown > 0) continue;
                var config = _configs.Weapons[weapon.ConfigId];

                float entityScale = 1.0f;
                float offset = 25f;
                if (_configs.Characters.TryGetValue(player.ConfigId, out var pCfg))
                {
                    entityScale = pCfg.Scale;
                    offset = pCfg.WeaponOffset.HasValue ? (pCfg.WeaponOffset.Value * entityScale) : ((10f * entityScale) + 15f);
                }

                float spawnX = player.X, spawnY = player.Y;
                if (weapon.SlotIndex == 0) spawnX += offset;
                else if (weapon.SlotIndex == 1) spawnX -= offset;
                else if (weapon.SlotIndex == 2) spawnY -= offset;
                else if (weapon.SlotIndex == 3) spawnY += offset;

                float dirX = 0, dirY = 0;
                bool shouldFire = false;

                if (config.AutoShot)
                {
                    float finalRange = config.Range + player.GetTotalStat("range", _configs);
                    float bestDist = float.MaxValue;
                    BaseActorEntity? target = null;
                    var hostileTargets = TargetingHelper.GetHostileTargets(state, player.Team);

                    foreach (var possibleTarget in hostileTargets)
                    {
                        // Get the target's radius and calculate distance to its EDGE
                        float targetHitRadius = possibleTarget is EnemyEntity e
                            ? (_configs.Enemies.TryGetValue(e.ConfigId, out var ec) ? ec.HitRadius : 15f)
                            : (_configs.Characters.TryGetValue(((PlayerEntity)possibleTarget).ConfigId, out var cc) ? cc.HitRadius : 15f);

                        float dist = (float)Math.Sqrt((possibleTarget.X - spawnX) * (possibleTarget.X - spawnX) + (possibleTarget.Y - spawnY) * (possibleTarget.Y - spawnY));
                        float distToEdge = dist - targetHitRadius;

                        // Check if the EDGE is within range
                        if (distToEdge <= finalRange && distToEdge < bestDist)
                        {
                            bestDist = distToEdge;
                            target = possibleTarget;
                        }
                    }
                    if (target != null) { dirX = target.X - spawnX; dirY = target.Y - spawnY; shouldFire = true; }
                }
                else
                {
                    if (player.AimX != 0 || player.AimY != 0) { dirX = player.AimX - player.X; dirY = player.AimY - player.Y; shouldFire = true; }
                }

                if (shouldFire)
                {
                    // --- COMMANDED STATE: ATTACKING ---
                    player.SetActionState("Attacking");

                    float length = (float)Math.Sqrt(dirX * dirX + dirY * dirY);
                    if (length > 0)
                    {
                        float attackSpeedPct = player.GetTotalStat("attackSpeedPercent", _configs);
                        weapon.CurrentCooldown = config.CooldownSeconds / Math.Max(0.1f, (1f + attackSpeedPct));
                        player.FiredWeaponsThisTick.Add(weapon.SlotIndex);

                        var (physDmg, magicDmg, isCrit) = CalculateWeaponDamageSplit(player, config, weapon, _configs);
                        float localLifeStealPercent = config.Mechanics != null && config.Mechanics.ContainsKey("lifeStealPercent") ? config.Mechanics["lifeStealPercent"] : 0f;
                        float totalLifeStealPercent = localLifeStealPercent + player.GetTotalStat("lifeStealPercent", _configs);

                        string projId = config.ProjectileId ?? "9mm_bullet";
                        if (_configs.Projectiles.TryGetValue(projId, out var projConfig))
                        {
                            float finalSpeed = projConfig.BaseSpeed * (1f + player.GetTotalStat("projectileSpeedPercent", _configs));

                            // Add 'offset' to the lifespan calculation so bullets fired from the opposite side 
                            // of the body still reach the full intended Range from the player's center.
                            float rangeBasedLifespan = projConfig.BaseSpeed > 0 ? ((config.Range + player.GetTotalStat("range", _configs) + offset) / finalSpeed) : 0.15f;

                            float computedLifespan = rangeBasedLifespan;
                            if (projConfig.Lifespan > 0) computedLifespan = projConfig.Lifespan;
                            if (config.Lifespan > 0) computedLifespan = config.Lifespan;
                            // FLOOR: a flat Lifespan configured on the projectile or weapon should extend flight time,
                            // never cut it short of the weapon's own stated Range - otherwise shots fired near max range
                            // die mid-flight before they can possibly reach the target.
                            computedLifespan = Math.Max(computedLifespan, rangeBasedLifespan);


                            var combinedEffects = new List<string>();
                            if (config.ApplyEffectsOnHit != null) combinedEffects.AddRange(config.ApplyEffectsOnHit);
                            if (projConfig.ApplyEffectsOnHit != null) combinedEffects.AddRange(projConfig.ApplyEffectsOnHit);

                            var shotDirections = ProjectileFactory.CalculateSpreadDirections(dirX, dirY, config.ProjectileCount, config.SpreadAngle);
                            var allNewBullets = new List<ProjectileEntity>();

                            foreach (var (spreadDirX, spreadDirY) in shotDirections)
                            {
                                allNewBullets.AddRange(ProjectileFactory.Create(
                                    projConfig, player.ConnectionId, player.Team, spawnX, spawnY, // <<< CHANGED HERE
                                    spreadDirX, spreadDirY,
                                    physDmg, magicDmg, finalSpeed, totalLifeStealPercent, combinedEffects,
                                    1, computedLifespan, isCrit
                                ));
                            }

                            _eventBus.Publish(new SpawnProjectileEvent { Projectiles = allNewBullets });
                        }
                    }
                }
            }
        }

        var parallelOptions = new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount };
        System.Threading.Tasks.Parallel.ForEach(allActiveEnemies, parallelOptions, enemy =>
        {
            if (enemy.Weapons.Count == 0) return;


            var opposingPlayers = enemy.Team == "Enemy" ? activePlayers : new List<PlayerEntity>();
            var opposingTeam = enemy.Team == "Enemy" ? nonEnemyTeam : enemyTeam;

            // >>> Use our new dynamic targeting helper instead of hardcoded lists!
            var hostileTargets = TargetingHelper.GetHostileTargets(state, enemy.Team);

            var target = TargetingHelper.FindClosestTarget(enemy.X, enemy.Y, float.MaxValue, hostileTargets);
            if (target == null) return;
            enemy.AimX = target.X; enemy.AimY = target.Y;

            // --- DYNAMIC ATTACK RADIUS CALCULATION ---
            float attackRadius = _configs.Enemies.TryGetValue(enemy.ConfigId, out var enemyCfg) ? enemyCfg.AttackRadius : 300f;

            if (enemy.Weapons.Count > 0)
            {
                float minWeaponRange = float.MaxValue;
                float bonusRange = enemy.GetTotalStat("range", _configs);

                foreach (var weapon in enemy.Weapons)
                {
                    if (_configs.Weapons.TryGetValue(weapon.ConfigId, out var wCfg))
                    {
                        float currentWeaponRange = Math.Max(0f, wCfg.Range + bonusRange);
                        if (currentWeaponRange < minWeaponRange)
                        {
                            minWeaponRange = currentWeaponRange;
                        }
                    }
                }

                if (minWeaponRange != float.MaxValue)
                {
                    attackRadius = minWeaponRange;
                }
            }

            // FIX: bestDistSq has to be computed against the resolved `target` now - it used to fall
            // out of the manual distance-tracking loop that TargetingHelper.FindClosestTarget replaced.
            float bestDistSq = (target.X - enemy.X) * (target.X - enemy.X) + (target.Y - enemy.Y) * (target.Y - enemy.Y);
            if (bestDistSq > attackRadius * attackRadius) return;
            if (enemy.IsIncapacitated(_configs)) return;

            foreach (var weapon in enemy.Weapons)
            {
                weapon.CurrentCooldown -= dt;
                if (weapon.CurrentCooldown > 0) continue;

                if (!_configs.Weapons.TryGetValue(weapon.ConfigId, out var wCfgS)) continue;

                weapon.CurrentCooldown = wCfgS.CooldownSeconds / Math.Max(0.1f, (1f + enemy.GetTotalStat("attackSpeedPercent", _configs)));

                float entityScale = enemyCfg?.Scale ?? 1.0f;
                float offset = enemyCfg?.WeaponOffset.HasValue == true ? (enemyCfg.WeaponOffset.Value * entityScale) : ((40f * entityScale) + 30f);
                var (spawnX, spawnY) = ApplySlotOffset(enemy.X, enemy.Y, weapon.SlotIndex, offset);

                float summonDirX = target.X - spawnX;
                float summonDirY = target.Y - spawnY;
                float summonDistSq = summonDirX * summonDirX + summonDirY * summonDirY;
                if (summonDistSq <= 0) continue;

                // --- COMMANDED STATE: ATTACKING ---
                enemy.SetActionState("Attacking");

                var (physDmg, magicDmg, isCrit) = CalculateWeaponDamageSplit(enemy, wCfgS, weapon, _configs);

                if (string.IsNullOrEmpty(wCfgS.ProjectileId) || !_configs.Projectiles.TryGetValue(wCfgS.ProjectileId, out var pCfg2)) continue;

                // FIX: attackRadius/bestDistSq above are measured from the enemy's CENTER, but the bullet
                // actually spawns from spawnX/spawnY (offset by the weapon's slot position). A weapon sitting
                // off to one side can end up genuinely farther from the target than Range would suggest, even
                // while the enemy itself is "in range." Floor against the REAL muzzle-to-target distance
                // instead of the configured Range, so this can never come up short regardless of offset.
                // We add an extra overshoot buffer (+100f) so the bullet fully pierces the player instead 
                // of expiring perfectly on their center pixel right before the collision check runs.
                float actualDistance = (float)Math.Sqrt(summonDistSq);
                float rangeBasedLifespan = pCfg2.BaseSpeed > 0
                    ? (Math.Max(actualDistance + 100f, wCfgS.Range + enemy.GetTotalStat("range", _configs) + offset) / pCfg2.BaseSpeed)
                    : 0.15f;
                float computedLifespan = rangeBasedLifespan; if (pCfg2.Lifespan > 0) computedLifespan = pCfg2.Lifespan;
                if (wCfgS.Lifespan > 0) computedLifespan = wCfgS.Lifespan;
                computedLifespan = Math.Max(computedLifespan, rangeBasedLifespan);


                // Same floor as the player-fire branch above.
                computedLifespan = Math.Max(computedLifespan, rangeBasedLifespan);

                var combined2 = new List<string>();
                if (wCfgS.ApplyEffectsOnHit != null) combined2.AddRange(wCfgS.ApplyEffectsOnHit);
                if (pCfg2.ApplyEffectsOnHit != null) combined2.AddRange(pCfg2.ApplyEffectsOnHit);

                enemy.FiredWeaponsThisTick.Add(weapon.SlotIndex);
                if (pCfg2.MovementBehavior == "Cleave" || pCfg2.MovementBehavior == "Whirlwind") { spawnX = enemy.X; spawnY = enemy.Y; }

                var newBullets = ProjectileFactory.Create(pCfg2, enemy.Id, enemy.Team, spawnX, spawnY, summonDirX, summonDirY, physDmg, magicDmg, pCfg2.BaseSpeed, 0f, combined2, 1, computedLifespan, isCrit);
                _eventBus.Publish(new SpawnProjectileEvent { Projectiles = newBullets });
            }
        });
    }

    private void HandleProjectileDeath(ProjectileEntity p, GameState state)
    {
        // Read directly from the config instead of the entity so we never miss the triggers!
        if (_configs.Projectiles.TryGetValue(p.ConfigId, out var projConfig))
        {
            if (!string.IsNullOrEmpty(projConfig.TickSkillId) && _configs.Skills.TryGetValue(projConfig.TickSkillId, out var tickSkillCfg) && tickSkillCfg.ActionType == SkillActionType.Beam)
                _eventBus.Publish(new BeamEndedEvent { CasterId = p.Id, SkillId = projConfig.TickSkillId });

            if (!string.IsNullOrEmpty(projConfig.OnDeathSkillId) && _configs.Skills.TryGetValue(projConfig.OnDeathSkillId, out var deathSkill))
                _eventBus.Publish(new RequestSkillCastEvent { Skill = deathSkill, CasterId = p.OwnerId, StartX = p.X, StartY = p.Y, Team = p.Team });
        }
    }



    private void ProcessCollisions(float dt, GameState state)
    {
        var projectilesToRemove = new System.Collections.Concurrent.ConcurrentBag<string>();
        var pickupsToRemove = new System.Collections.Concurrent.ConcurrentBag<string>();
        var parallelOptions = new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount };

        var hostileEnemies = state.Enemies.Values.Where(e => e.Team == "Enemy" && e.ActionState != "Dead").Cast<BaseActorEntity>()
                    .Concat(state.Players.Values.Where(p => p.Team == "Enemy" && p.ActionState != "Dead")).ToList(); // <<< ADDED PLAYERS ON ENEMY TEAM

        var playerTeam = state.Players.Values.Where(p => p.Team != "Enemy" && p.ActionState != "Dead").Cast<BaseActorEntity>()
            .Concat(state.Enemies.Values.Where(e => e.Team != "Enemy" && e.ActionState != "Dead")).ToList();

        float mapW = 4000f, mapH = 4000f;
        if (_configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMap))
        {
            mapW = currentMap.Width; mapH = currentMap.Height;
        }

        System.Threading.Tasks.Parallel.ForEach(state.Projectiles.Values, parallelOptions, proj =>
        {
            float prevX = proj.X, prevY = proj.Y;
            if (proj.MovementBehavior == "Orbital")
            {
                BaseActorEntity? owner = state.Players.GetValueOrDefault(proj.OwnerId) ?? (BaseActorEntity?)state.Enemies.GetValueOrDefault(proj.OwnerId);
                if (owner != null && owner.ActionState != "Dead")
                {
                    proj.OrbitAngleOffset += (proj.OrbitSpeed * (float)(Math.PI / 180.0)) * dt;
                    proj.X = owner.X + (float)Math.Cos(proj.OrbitAngleOffset) * proj.OrbitRadius;
                    proj.Y = owner.Y + (float)Math.Sin(proj.OrbitAngleOffset) * proj.OrbitRadius;
                }
                else proj.Lifespan = 0;
            }
            else
            {
                proj.X += proj.VelX * dt;
                proj.Y += proj.VelY * dt;

                if (proj.BounceCount > 0)
                {
                    bool bounced = false;

                    // Bounce off left/right walls and bump it slightly inwards to prevent sticking
                    if (proj.X <= 0 || proj.X >= mapW)
                    {
                        proj.VelX = -proj.VelX;
                        proj.X = Math.Clamp(proj.X, 5, mapW - 5);
                        bounced = true;
                    }

                    // Bounce off top/bottom walls
                    if (proj.Y <= 0 || proj.Y >= mapH)
                    {
                        proj.VelY = -proj.VelY;
                        proj.Y = Math.Clamp(proj.Y, 5, mapH - 5);
                        bounced = true;
                    }

                    if (bounced)
                    {
                        proj.BounceCount--;

                        // Tell the server to delete the current instance so the client deletes the old sprite
                        projectilesToRemove.Add(proj.Id);

                        // Spawn an exact clone with the new velocity! 
                        // The client receives this as a "new" bullet and renders the bounce seamlessly.
                        var bouncedProj = new ProjectileEntity
                        {
                            ConfigId = proj.ConfigId,
                            OwnerId = proj.OwnerId,
                            Team = proj.Team,
                            X = proj.X,
                            Y = proj.Y,
                            VelX = proj.VelX,
                            VelY = proj.VelY,
                            PhysicalDamage = proj.PhysicalDamage,
                            MagicDamage = proj.MagicDamage,
                            LifeStealChance = proj.LifeStealChance,
                            HitRadius = proj.HitRadius,
                            Lifespan = proj.Lifespan - dt,
                            PierceCount = proj.PierceCount,
                            BounceCount = proj.BounceCount,
                            SweepAngle = proj.SweepAngle,
                            MovementBehavior = proj.MovementBehavior,
                            OrbitRadius = proj.OrbitRadius,
                            OrbitAngleOffset = proj.OrbitAngleOffset,
                            OrbitSpeed = proj.OrbitSpeed,
                            OnDeathSkillId = proj.OnDeathSkillId,
                            TickRate = proj.TickRate,
                            TickSkillId = proj.TickSkillId,
                            TimeSinceLastTick = proj.TimeSinceLastTick + dt,

                            // FIX: Reset the hit memory so it can damage the same enemies on the way back!
                            HitEnemies = new HashSet<string>(),
                            ApplyEffectsOnHit = new List<string>(proj.ApplyEffectsOnHit),
                            IsCritical = proj.IsCritical,

                            // FIX: Also reset the orbital hit cooldowns if this happens to be an orbiting projectile
                            OrbitHitCooldowns = new Dictionary<string, float>(),
                            OrbitHitInterval = proj.OrbitHitInterval,
                            IsFriendlyProjectile = proj.IsFriendlyProjectile
                        };

                        _eventBus.Publish(new SpawnProjectileEvent { Projectiles = new List<ProjectileEntity> { bouncedProj } });
                        return; // Skip remaining collision logic for this tick since we replaced it
                    }
                }
            }
            proj.Lifespan -= dt;

            // --- READ TICK DATA DIRECTLY FROM CONFIG ---
            string actualTickSkillId = proj.TickSkillId;
            float actualTickRate = proj.TickRate;

            // FIX: Renamed 'pCfg' to 'tickProjCfg' to avoid scope collision!
            if (_configs.Projectiles.TryGetValue(proj.ConfigId, out var tickProjCfg))
            {
                if (!string.IsNullOrEmpty(tickProjCfg.TickSkillId)) actualTickSkillId = tickProjCfg.TickSkillId;
                if (tickProjCfg.TickRate > 0) actualTickRate = tickProjCfg.TickRate;
            }

            SkillConfig? tickSkill = null;
            bool hasTickSkill = false;
            if (!string.IsNullOrEmpty(actualTickSkillId)) hasTickSkill = _configs.Skills.TryGetValue(actualTickSkillId, out tickSkill);
            float effectiveTickRate = actualTickRate > 0 ? actualTickRate : (hasTickSkill && tickSkill != null ? tickSkill.CooldownSeconds : 0f);

            if (effectiveTickRate > 0)
            {
                proj.TimeSinceLastTick += dt;
                float safeTickRate = Math.Max(0.1f, effectiveTickRate);
                if (proj.TimeSinceLastTick >= safeTickRate)
                {
                    proj.TimeSinceLastTick %= safeTickRate;
                    proj.HitEnemies.Clear();
                    if (hasTickSkill && tickSkill != null)
                        _eventBus.Publish(new RequestSkillCastEvent { Skill = tickSkill, CasterId = proj.OwnerId, StartX = proj.X, StartY = proj.Y, Team = proj.Team, SourceProjectileId = proj.Id });
                }
            }

            bool isOrbital = proj.MovementBehavior == "Orbital";
            if (proj.Lifespan <= 0 || (!isOrbital && proj.HitEnemies.Count > proj.PierceCount))
            {
                projectilesToRemove.Add(proj.Id);
                HandleProjectileDeath(proj, state);
                return;
            }


            // <<< CHANGED: Rely on the bullet's Team, not the Owner's dictionary!
            bool isPlayerTeamProj = proj.Team != "Enemy";
            var targets = proj.IsFriendlyProjectile ? (isPlayerTeamProj ? playerTeam : hostileEnemies) : (isPlayerTeamProj ? hostileEnemies : playerTeam);

            foreach (var target in targets)
            {
                string tId = target is PlayerEntity pTarget ? pTarget.ConnectionId : ((EnemyEntity)target).Id;

                // >>> FIX: We deleted the immunity line here so you can catch your own healing orbs! <<<

                if (isOrbital)
                {
                    if (proj.OrbitHitCooldowns.TryGetValue(tId, out float remainingCooldown))
                    {
                        remainingCooldown -= dt;
                        if (remainingCooldown > 0) { proj.OrbitHitCooldowns[tId] = remainingCooldown; continue; }
                        proj.OrbitHitCooldowns.Remove(tId);
                    }
                }
                else if (proj.HitEnemies.Contains(tId)) continue;

                float targetHitRadius = target is EnemyEntity e
                                    ? (_configs.Enemies.TryGetValue(e.ConfigId, out var eCfg) ? eCfg.HitRadius : 15f)
                                    : (_configs.Characters.TryGetValue(((PlayerEntity)target).ConfigId, out var pCfg) ? pCfg.HitRadius : 15f); float hitThresholdSq = (proj.HitRadius + targetHitRadius) * (proj.HitRadius + targetHitRadius);
                bool isHit = false;

                if (proj.MovementBehavior == "Orbital") isHit = ((proj.X - target.X) * (proj.X - target.X) + (proj.Y - target.Y) * (proj.Y - target.Y)) <= hitThresholdSq;
                else
                {
                    float dx = proj.X - prevX, dy = proj.Y - prevY, fx = target.X - prevX, fy = target.Y - prevY;
                    float lenSq = dx * dx + dy * dy;
                    float t = lenSq == 0 ? 0 : Math.Max(0, Math.Min(1, (fx * dx + fy * dy) / lenSq));
                    float cX = prevX + t * dx, cY = prevY + t * dy;
                    isHit = ((cX - target.X) * (cX - target.X) + (cY - target.Y) * (cY - target.Y)) <= hitThresholdSq;
                }

                if (isHit)
                {
                    if (proj.IsFriendlyProjectile)
                    {
                        if (isOrbital) proj.OrbitHitCooldowns[tId] = proj.OrbitHitInterval;
                        else proj.HitEnemies.Add(tId);

                        if (proj.MagicDamage < 0)
                            _eventBus.Publish(new DamageAppliedEvent { TargetId = tId, AttackerId = proj.OwnerId, Amount = proj.MagicDamage, IsCritical = false, IsDodge = false, IsBlock = false });

                        if (proj.ApplyEffectsOnHit != null && proj.ApplyEffectsOnHit.Count > 0)
                        {
                            // proj.OwnerId IS the caster's ID already - no need to resolve the entity just to read
                            // its ID back out again, the way the original did via casterEntity.
                            foreach (var effectId in proj.ApplyEffectsOnHit)
                                _eventBus.Publish(new ApplyEffectEvent { TargetId = tId, EffectConfigId = effectId, CasterId = proj.OwnerId });
                        }


                        if (!isOrbital && proj.HitEnemies.Count > proj.PierceCount) { projectilesToRemove.Add(proj.Id); break; }
                    }
                    else
                    {
                        float dodgeChance = Math.Clamp(target.GetTotalStat("dodge", _configs), 0f, 0.9f);
                        bool isDodge = dodgeChance > 0 && Random.Shared.NextDouble() <= dodgeChance;
                        float blockChance = 0f;
                        if (target is PlayerEntity pTargetBlock) blockChance = Math.Clamp(pTargetBlock.GetEngineMechanic("projectileBlockChance", _configs), 0f, 0.9f);
                        bool isBlock = !isDodge && blockChance > 0 && Random.Shared.NextDouble() <= blockChance;
                        float finalDamage = isDodge || isBlock ? 0 : CalculateMitigatedDamage(proj.PhysicalDamage, proj.MagicDamage, target, _configs);

                        _eventBus.Publish(new DamageAppliedEvent { TargetId = tId, AttackerId = proj.OwnerId, Amount = finalDamage, IsCritical = proj.IsCritical, IsDodge = isDodge, IsBlock = isBlock });

                        if (isOrbital) proj.OrbitHitCooldowns[tId] = proj.OrbitHitInterval;
                        else proj.HitEnemies.Add(tId);

                        if (!isDodge && !isBlock)
                        {
                            if (proj.ApplyEffectsOnHit != null)
                            {
                                foreach (var effectId in proj.ApplyEffectsOnHit)
                                    _eventBus.Publish(new ApplyEffectEvent { TargetId = tId, EffectConfigId = effectId, CasterId = proj.OwnerId });
                            }
                            if (Random.Shared.NextDouble() < proj.LifeStealChance && state.Players.TryGetValue(proj.OwnerId, out var pHeal))
                            {
                                lock (pHeal) { pHeal.CurrentHp = Math.Min(pHeal.GetTotalStat("maxHp", _configs), pHeal.CurrentHp + 1f); }
                            }
                        }

                        if (isBlock || (!isOrbital && proj.HitEnemies.Count > proj.PierceCount))
                        {
                            projectilesToRemove.Add(proj.Id);
                            HandleProjectileDeath(proj, state);
                            break;
                        }

                    }
                }
            }
        });

        if (!_configs.Difficulties.TryGetValue(state.CurrentDifficulty, out var currentDiff)) currentDiff = new DifficultyConfig();
        foreach (var player in state.Players.Values)
        {
            float bonusPickupRange = player.GetTotalStat("pickupRange", _configs);
            float magneticRadius = 25f + bonusPickupRange;
            float magneticRadiusSq = magneticRadius * magneticRadius;

            // The tiny core radius where the gold actually gets absorbed
            float collectionRadiusSq = 25f * 25f;

            foreach (var pickup in state.Pickups.Values)
            {
                if (pickupsToRemove.Contains(pickup.Id)) continue;

                float dx = player.X - pickup.X;
                float dy = player.Y - pickup.Y;
                float distSq = (dx * dx) + (dy * dy);

                // 1. Is it close enough to instantly collect?
                if (distSq < collectionRadiusSq)
                {
                    if (pickup.Type == PickupType.Gold)
                    {
                        player.Gold += (int)Math.Max(1, pickup.Value * currentDiff.GoldMultiplier);
                        player.GainXp(pickup.Value, _configs, currentDiff);
                        pickupsToRemove.Add(pickup.Id);
                    }
                }
                // 2. Is it outside collection range, but inside Vacuum range?
                else if (distSq < magneticRadiusSq)
                {
                    // >>> FIX: ONLY vacuum gold! Leave weapons and items on the floor. <<<
                    if (pickup.Type == PickupType.Gold)
                    {
                        // Calculate the direction towards the player
                        float dist = (float)Math.Sqrt(distSq);
                        float dirX = dx / dist;
                        float dirY = dy / dist;

                        // Fly towards the player at 600 units per second!
                        float vacuumSpeed = 600f;
                        pickup.X += dirX * vacuumSpeed * dt;
                        pickup.Y += dirY * vacuumSpeed * dt;
                        pickup.IsMoving = true;
                    }
                }
            }
        }

        var meleeEnemies = state.Enemies.Values.Where(e => e.ActionState != "Dead" && e.Weapons.Count == 0).ToList();
        Parallel.ForEach(meleeEnemies, parallelOptions, enemy =>
        {
            if (!_configs.Enemies.TryGetValue(enemy.ConfigId, out var enemyCfg)) return;
            if (enemy.IsIncapacitated(_configs)) return;
            float attackSpeedPct = enemy.GetTotalStat("attackSpeedPercent", _configs);
            float scaledDuration = enemyCfg.AttackDuration / Math.Max(0.1f, (1f + attackSpeedPct));
            bool isRooted = enemy.ActionState == "Casting" && !string.IsNullOrEmpty(enemy.CurrentCastingSkillId) && _configs.Skills.TryGetValue(enemy.CurrentCastingSkillId, out var eCastCfg) && eCastCfg.StopMoving;

            if (!isRooted && (enemy.ActionState == "Attacking" || enemy.ActionState == "Casting") && Math.Abs(enemy.AttackCooldown - scaledDuration) < (dt * 2))
            {
                float meleeDmg = enemy.GetTotalStat("meleeDamage", _configs);
                if (meleeDmg <= 0) return;
                var targets = enemy.Team == "Enemy" ? playerTeam : hostileEnemies;
                float attackRadiusSq = enemyCfg.AttackRadius * enemyCfg.AttackRadius;
                foreach (var target in targets)
                {
                    if ((target.X - enemy.X) * (target.X - enemy.X) + (target.Y - enemy.Y) * (target.Y - enemy.Y) <= attackRadiusSq)
                    {
                        float dodgeChance = Math.Clamp(target.GetTotalStat("dodge", _configs), 0f, 0.9f);
                        bool isDodge = dodgeChance > 0 && Random.Shared.NextDouble() <= dodgeChance;
                        float finalDamage = isDodge ? 0 : CalculateMitigatedDamage(meleeDmg, 0f, target, _configs);
                        _eventBus.Publish(new DamageAppliedEvent { TargetId = EntityResolver.GetId(target), AttackerId = enemy.Id, Amount = finalDamage, IsCritical = false, IsDodge = isDodge, IsBlock = false });
                    }
                }
                enemy.AttackCooldown = scaledDuration - (dt * 3f);
            }
        });

        foreach (var id in projectilesToRemove) state.Projectiles.TryRemove(id, out _);
        foreach (var id in pickupsToRemove) state.Pickups.TryRemove(id, out _);
    }

    internal static float CalculateMitigatedDamage(float physDmg, float magicDmg, BaseActorEntity target, ConfigManager configs)
    {
        float baseArmor = Math.Max(0f, target.GetTotalStat("armor", configs));
        float baseMagicDef = Math.Max(0f, target.GetTotalStat("magicDefense", configs));
        float defensePercent = target.GetTotalStat("defensePercent", configs);
        float finalArmor = baseArmor * (1f + defensePercent);
        float finalMagicDef = baseMagicDef * (1f + defensePercent);
        float mitigatedPhys = physDmg * (100f / (100f + finalArmor));
        float mitigatedMagic = magicDmg * (100f / (100f + finalMagicDef));
        return mitigatedPhys + mitigatedMagic;
    }

    public static (float phys, float magic, bool isCrit) CalculateWeaponDamageSplit(BaseActorEntity actor, WeaponConfig wCfg, EquippedWeapon weapon, ConfigManager configs)
    {
        float meleeDamage = weapon.TotalBaseStats.GetValueOrDefault("meleeDamage", 0f) + weapon.RolledStats.GetValueOrDefault("meleeDamage", 0f);
        float rangedDamage = weapon.TotalBaseStats.GetValueOrDefault("rangedDamage", 0f) + weapon.RolledStats.GetValueOrDefault("rangedDamage", 0f);
        float magicDamage = weapon.TotalBaseStats.GetValueOrDefault("magicDamage", 0f) + weapon.RolledStats.GetValueOrDefault("magicDamage", 0f);
        float otherPhysBonus = 0f;

        if (wCfg.DamageScaling != null)
        {
            foreach (var scale in wCfg.DamageScaling)
            {
                float bonus = actor.GetTotalStat(scale.Key, configs) * scale.Value;
                if (scale.Key == "magicDamage" || scale.Key == "elementalDamage") magicDamage += bonus;
                else if (scale.Key == "rangedDamage") rangedDamage += bonus;
                else if (scale.Key == "meleeDamage") meleeDamage += bonus;
                else otherPhysBonus += bonus;
            }
        }

        // >>> Order matters here: weapon's own damage + damageScaling bonus first, then the
        // global damagePercent stat, and ONLY THEN the per-type statMultiplier - so the
        // multiplier scales the fully-formed damage number, not an intermediate one.
        float damagePercent = actor.GetTotalStat("damagePercent", configs);
        meleeDamage *= (1f + damagePercent);
        rangedDamage *= (1f + damagePercent);
        magicDamage *= (1f + damagePercent);
        otherPhysBonus *= (1f + damagePercent);

        // The actor's meleeDamage/rangedDamage/magicDamage statMultiplier scales the weapon's
        // own final damage directly, not just the character's personal item/trait bonus pool
        // (which used to be the only place a -100%/+100% multiplier had any real effect).
        // Same asymmetric rule as everywhere else: +100% doubles, -100% halves (never fully zeroes).
        meleeDamage = ApplyStatMultiplier(meleeDamage, actor.GetStatMultiplier("meleeDamage"));
        rangedDamage = ApplyStatMultiplier(rangedDamage, actor.GetStatMultiplier("rangedDamage"));
        magicDamage = ApplyStatMultiplier(magicDamage, actor.GetStatMultiplier("magicDamage"));

        float physDamage = meleeDamage + rangedDamage + otherPhysBonus;
        physDamage = Math.Max(0f, physDamage);
        magicDamage = Math.Max(0f, magicDamage);
        bool isCrit = false;
        if (physDamage > 0 && Random.Shared.NextDouble() <= Math.Clamp(actor.GetTotalStat("critChance", configs), 0f, 1f))
        {
            isCrit = true;
            physDamage *= Math.Max(1.5f, actor.GetTotalStat("critMultiplier", configs));
        }
        return (physDamage, magicDamage, isCrit);
    }

    // Shared asymmetric multiplier rule (see StatSystem.cs): positive percentBonus multiplies
    // the value up, negative percentBonus divides it down instead of subtracting, so a malus
    // can reduce a damage value toward zero without ever flipping its sign or fully erasing it
    // in one step (a build with enough flat damage behind it can still out-scale the malus).
    private static float ApplyStatMultiplier(float value, float percentBonus)
    {
        return percentBonus >= 0f
            ? value * (1f + percentBonus)
            : value / (1f + Math.Abs(percentBonus));
    }
}