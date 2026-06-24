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

    private void OnSpawnProjectile(SpawnProjectileEvent ev)
    {
        foreach (var proj in ev.Projectiles)
        {
            ev.State.Projectiles.TryAdd(proj.Id, proj);
        }
    }

    private void ProcessShooting(float dt, GameState state)
    {
        // >>> MASSIVE FIX: Pre-filter for shooting so we don't iterate 1500x1500 times
        var activePlayers = state.Players.Values.Where(p => p.ActionState != "Dead").ToList();
        var allActiveEnemies = state.Enemies.Values.Where(e => e.ActionState != "Dead").ToList();
        var nonEnemyTeam = allActiveEnemies.Where(e => e.Team != "Enemy").ToList();
        var enemyTeam = allActiveEnemies.Where(e => e.Team == "Enemy").ToList();

        // 1. Keep players sequential
        foreach (var player in activePlayers)
        {
            foreach (var weapon in player.Weapons)
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
                    float bestDistSq = finalRange * finalRange;
                    EnemyEntity? target = null;

                    // Players only scan the "Enemy" horde list
                    foreach (var enemy in enemyTeam)
                    {
                        float distSq = (enemy.X - spawnX) * (enemy.X - spawnX) + (enemy.Y - spawnY) * (enemy.Y - spawnY);
                        if (distSq <= bestDistSq) { bestDistSq = distSq; target = enemy; }
                    }
                    if (target != null) { dirX = target.X - spawnX; dirY = target.Y - spawnY; shouldFire = true; }
                }
                else
                {
                    if (player.AimX != 0 || player.AimY != 0) { dirX = player.AimX - player.X; dirY = player.AimY - player.Y; shouldFire = true; }
                }

                if (shouldFire)
                {
                    float length = (float)Math.Sqrt(dirX * dirX + dirY * dirY);
                    if (length > 0)
                    {
                        float attackSpeedPct = player.GetTotalStat("attackSpeedPercent", _configs);
                        weapon.CurrentCooldown = config.CooldownSeconds / Math.Max(0.1f, (1f + attackSpeedPct));
                        player.FiredWeaponsThisTick.Add(weapon.SlotIndex);

                        var (physDmg, magicDmg, isCrit) = CalculateWeaponDamageSplit(player, config, weapon, _configs);
                        float localLifeSteal = config.Mechanics != null && config.Mechanics.ContainsKey("lifeSteal") ? config.Mechanics["lifeSteal"] : 0f;
                        float totalLifeSteal = localLifeSteal + player.GetTotalStat("lifeSteal", _configs);

                        string projId = config.ProjectileId ?? "9mm_bullet";
                        if (_configs.Projectiles.TryGetValue(projId, out var projConfig))
                        {
                            float finalSpeed = projConfig.BaseSpeed * (1f + player.GetTotalStat("projectileSpeedPercent", _configs));
                            float computedLifespan = finalSpeed > 0 ? ((config.Range + player.GetTotalStat("range", _configs)) / finalSpeed) : 0.15f;
                            if (projConfig.Lifespan > 0) computedLifespan = projConfig.Lifespan;
                            if (config.Lifespan > 0) computedLifespan = config.Lifespan;

                            var combinedEffects = new List<string>();
                            if (config.ApplyEffectsOnHit != null) combinedEffects.AddRange(config.ApplyEffectsOnHit);
                            if (projConfig.ApplyEffectsOnHit != null) combinedEffects.AddRange(projConfig.ApplyEffectsOnHit);

                            var shotDirections = ProjectileFactory.CalculateSpreadDirections(dirX, dirY, config.ProjectileCount, config.SpreadAngle);
                            var allNewBullets = new List<ProjectileEntity>();

                            foreach (var (spreadDirX, spreadDirY) in shotDirections)
                            {
                                allNewBullets.AddRange(ProjectileFactory.Create(
                                    projConfig, player.ConnectionId, "Player", spawnX, spawnY,
                                    spreadDirX, spreadDirY,
                                    physDmg, magicDmg, finalSpeed, totalLifeSteal, combinedEffects,
                                    1, computedLifespan, isCrit
                                ));
                            }

                            _eventBus.Publish(new SpawnProjectileEvent { Projectiles = allNewBullets, State = state });
                        }
                    }
                }
            }
        }

        var parallelOptions = new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount };

        // 2. Parallelize enemy shooting utilizing the filtered lists
        System.Threading.Tasks.Parallel.ForEach(allActiveEnemies, parallelOptions, enemy =>
        {
            if (enemy.Weapons.Count == 0) return;

            float bestDistSq = float.MaxValue, targetX = 0, targetY = 0;
            bool foundTarget = false;

            // Only scan the opposing team
            var opposingPlayers = enemy.Team == "Enemy" ? activePlayers : new List<PlayerEntity>();
            foreach (var player in opposingPlayers)
            {
                float distSq = (player.X - enemy.X) * (player.X - enemy.X) + (player.Y - enemy.Y) * (player.Y - enemy.Y);
                if (distSq < bestDistSq) { bestDistSq = distSq; targetX = player.X; targetY = player.Y; foundTarget = true; }
            }

            var opposingTeam = enemy.Team == "Enemy" ? nonEnemyTeam : enemyTeam;
            foreach (var summon in opposingTeam)
            {
                if (summon.Id == enemy.Id) continue;
                float distSq = (summon.X - enemy.X) * (summon.X - enemy.X) + (summon.Y - enemy.Y) * (summon.Y - enemy.Y);
                if (distSq < bestDistSq) { bestDistSq = distSq; targetX = summon.X; targetY = summon.Y; foundTarget = true; }
            }

            if (!foundTarget) return;
            enemy.AimX = targetX; enemy.AimY = targetY;

            float attackRadius = _configs.Enemies.TryGetValue(enemy.ConfigId, out var enemyCfg) ? enemyCfg.AttackRadius : 300f;
            if (bestDistSq > attackRadius * attackRadius) return;

            foreach (var weapon in enemy.Weapons)
            {
                weapon.CurrentCooldown -= dt;
                if (weapon.CurrentCooldown > 0) continue;
                if (!_configs.Weapons.TryGetValue(weapon.ConfigId, out var wCfgS)) continue;

                weapon.CurrentCooldown = wCfgS.CooldownSeconds / Math.Max(0.1f, (1f + enemy.GetTotalStat("attackSpeedPercent", _configs)));

                float entityScale = enemyCfg?.Scale ?? 1.0f;
                float offset = enemyCfg?.WeaponOffset.HasValue == true ? (enemyCfg.WeaponOffset.Value * entityScale) : ((40f * entityScale) + 30f);
                float spawnX = enemy.X, spawnY = enemy.Y;

                if (weapon.SlotIndex == 0) spawnX += offset;
                else if (weapon.SlotIndex == 1) spawnX -= offset;
                else if (weapon.SlotIndex == 2) spawnY -= offset;
                else if (weapon.SlotIndex == 3) spawnY += offset;

                float summonDirX = targetX - spawnX;
                float summonDirY = targetY - spawnY;
                if (summonDirX * summonDirX + summonDirY * summonDirY <= 0) continue;

                var (physDmg, magicDmg, isCrit) = CalculateWeaponDamageSplit(enemy, wCfgS, weapon, _configs);

                if (string.IsNullOrEmpty(wCfgS.ProjectileId) || !_configs.Projectiles.TryGetValue(wCfgS.ProjectileId, out var pCfg2)) continue;

                float computedLifespan = pCfg2.BaseSpeed > 0 ? ((wCfgS.Range + enemy.GetTotalStat("range", _configs)) / pCfg2.BaseSpeed) : 0.15f;
                if (pCfg2.Lifespan > 0) computedLifespan = pCfg2.Lifespan;
                if (wCfgS.Lifespan > 0) computedLifespan = wCfgS.Lifespan;

                var combined2 = new List<string>();
                if (wCfgS.ApplyEffectsOnHit != null) combined2.AddRange(wCfgS.ApplyEffectsOnHit);
                if (pCfg2.ApplyEffectsOnHit != null) combined2.AddRange(pCfg2.ApplyEffectsOnHit);

                enemy.FiredWeaponsThisTick.Add(weapon.SlotIndex);

                if (pCfg2.MovementBehavior == "Cleave" || pCfg2.MovementBehavior == "Whirlwind") { spawnX = enemy.X; spawnY = enemy.Y; }

                var newBullets = ProjectileFactory.Create(pCfg2, enemy.Id, enemy.Team, spawnX, spawnY, summonDirX, summonDirY, physDmg, magicDmg, pCfg2.BaseSpeed, 0f, combined2, 1, computedLifespan, isCrit);
                _eventBus.Publish(new SpawnProjectileEvent { Projectiles = newBullets, State = state });
            }
        });
    }

    private void ProcessCollisions(float dt, GameState state)
    {
        // 1. Thread-safe bags are REQUIRED when multiple threads are destroying things
        var projectilesToRemove = new System.Collections.Concurrent.ConcurrentBag<string>();
        var pickupsToRemove = new System.Collections.Concurrent.ConcurrentBag<string>();
        var parallelOptions = new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount };

        // 2. Pre-filter the target lists ONCE to avoid locking the ConcurrentDictionary 300,000 times
        var hostileEnemies = state.Enemies.Values
            .Where(e => e.Team == "Enemy" && e.ActionState != "Dead")
            .Cast<BaseActorEntity>()
            .ToList();

        var playerTeam = state.Players.Values.Where(p => p.ActionState != "Dead").Cast<BaseActorEntity>()
            .Concat(state.Enemies.Values.Where(e => e.Team != "Enemy" && e.ActionState != "Dead"))
            .ToList();

        // ==========================================
        // PARALLELIZE PROJECTILE PHYSICS & COLLISIONS
        // ==========================================
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
            }
            proj.Lifespan -= dt;

            SkillConfig? tickSkill = null;
            bool hasTickSkill = false;

            if (!string.IsNullOrEmpty(proj.TickSkillId))
            {
                hasTickSkill = _configs.Skills.TryGetValue(proj.TickSkillId, out tickSkill);
            }

            float effectiveTickRate = proj.TickRate > 0 ? proj.TickRate : (hasTickSkill && tickSkill != null ? tickSkill.CooldownSeconds : 0f);

            if (effectiveTickRate > 0)
            {
                proj.TimeSinceLastTick += dt;
                float safeTickRate = Math.Max(0.1f, effectiveTickRate);

                if (proj.TimeSinceLastTick >= safeTickRate)
                {
                    proj.TimeSinceLastTick %= safeTickRate;
                    proj.HitEnemies.Clear();

                    if (hasTickSkill && tickSkill != null)
                    {
                        _eventBus.Publish(new RequestSkillCastEvent { Skill = tickSkill, CasterId = proj.OwnerId, StartX = proj.X, StartY = proj.Y, Team = proj.Team, State = state, SourceProjectile = proj });
                    }
                }
            }

            bool isOrbital = proj.MovementBehavior == "Orbital";

            if (proj.Lifespan <= 0 || (!isOrbital && proj.HitEnemies.Count > proj.PierceCount))
            {
                projectilesToRemove.Add(proj.Id);
                if (!string.IsNullOrEmpty(proj.OnDeathSkillId) && _configs.Skills.TryGetValue(proj.OnDeathSkillId, out var deathSkill))
                {
                    _eventBus.Publish(new RequestSkillCastEvent { Skill = deathSkill, CasterId = proj.OwnerId, StartX = proj.X, StartY = proj.Y, Team = proj.Team, State = state });
                }
                return; // Parallel lambda equivalent of 'continue'
            }

            bool isPlayerProj = state.Players.ContainsKey(proj.OwnerId) || (state.Enemies.TryGetValue(proj.OwnerId, out var o) && o.Team != "Enemy");
            var targets = isPlayerProj ? hostileEnemies : playerTeam;
            
            foreach (var target in targets)
            {
                string tId = target is PlayerEntity pTarget ? pTarget.ConnectionId : ((EnemyEntity)target).Id;

                if (isOrbital)
                {
                    if (proj.OrbitHitCooldowns.TryGetValue(tId, out float remainingCooldown))
                    {
                        remainingCooldown -= dt;
                        if (remainingCooldown > 0)
                        {
                            proj.OrbitHitCooldowns[tId] = remainingCooldown;
                            continue;
                        }
                        proj.OrbitHitCooldowns.Remove(tId);
                    }
                }
                else if (proj.HitEnemies.Contains(tId)) continue;

                float targetHitRadius = target is EnemyEntity e ? e.HitRadius : (_configs.Characters.TryGetValue(((PlayerEntity)target).ConfigId, out var pCfg) ? pCfg.HitRadius : 15f);

                float hitThresholdSq = (proj.HitRadius + targetHitRadius) * (proj.HitRadius + targetHitRadius);
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
                    float dodgeChance = Math.Clamp(target.GetTotalStat("dodge", _configs), 0f, 0.9f);
                    bool isDodge = dodgeChance > 0 && Random.Shared.NextDouble() <= dodgeChance;

                    float blockChance = 0f;
                    if (target is PlayerEntity pTargetBlock) blockChance = Math.Clamp(pTargetBlock.GetEngineMechanic("projectileBlockChance", _configs), 0f, 0.9f);
                    bool isBlock = !isDodge && blockChance > 0 && Random.Shared.NextDouble() <= blockChance;

                    float finalDamage = isDodge || isBlock ? 0 : CalculateMitigatedDamage(proj.PhysicalDamage, proj.MagicDamage, target, _configs);

                    _eventBus.Publish(new DamageAppliedEvent
                    {
                        Target = target, AttackerId = proj.OwnerId, State = state, Amount = finalDamage,
                        IsCritical = proj.IsCritical, IsDodge = isDodge, IsBlock = isBlock
                    });

                    if (isOrbital) proj.OrbitHitCooldowns[tId] = proj.OrbitHitInterval;
                    else proj.HitEnemies.Add(tId);

                    if (!isDodge && !isBlock)
                    {
                        if (proj.ApplyEffectsOnHit != null)
                        {
                            foreach (var effectId in proj.ApplyEffectsOnHit)
                                _eventBus.Publish(new ApplyEffectEvent { Target = target, EffectConfigId = effectId });
                        }

                        // THE FIX: Thread-safe locking when modifying player health across multiple bullet impacts
                        if (Random.Shared.NextDouble() < proj.LifeStealChance && state.Players.TryGetValue(proj.OwnerId, out var pHeal))
                        {
                            lock (pHeal) 
                            {
                                pHeal.CurrentHp = Math.Min(pHeal.GetTotalStat("maxHp", _configs), pHeal.CurrentHp + 1f);
                            }
                        }
                    }

                    if (isBlock || (!isOrbital && proj.HitEnemies.Count > proj.PierceCount))
                    {
                        projectilesToRemove.Add(proj.Id);
                        if (!string.IsNullOrEmpty(proj.OnDeathSkillId) && _configs.Skills.TryGetValue(proj.OnDeathSkillId, out var deathSkill))
                        {
                            _eventBus.Publish(new RequestSkillCastEvent { Skill = deathSkill, CasterId = proj.OwnerId, StartX = proj.X, StartY = proj.Y, Team = proj.Team, State = state });
                        }
                        break; 
                    }
                }
            }
        });

        // ==========================================
        // SEQUENTIAL PICKUPS (Very fast, low volume)
        // ==========================================
        if (!_configs.Difficulties.TryGetValue(state.CurrentDifficulty, out var currentDiff)) currentDiff = new DifficultyConfig();
        foreach (var player in state.Players.Values)
        {
            foreach (var pickup in state.Pickups.Values)
            {
                if ((player.X - pickup.X) * (player.X - pickup.X) + (player.Y - pickup.Y) * (player.Y - pickup.Y) < 625)
                {
                    if (pickup.Type == PickupType.Gold && !pickupsToRemove.Contains(pickup.Id))
                    {
                        player.Gold += (int)Math.Max(1, pickup.Value * currentDiff.GoldMultiplier);
                        player.GainXp((int)Math.Max(1, pickup.Value * currentDiff.XpMultiplier), _configs);
                        pickupsToRemove.Add(pickup.Id);
                    }
                }
            }
        }

        // ==========================================
        // PARALLELIZE ENEMY MELEE ATTACKS
        // ==========================================
        var meleeEnemies = state.Enemies.Values.Where(e => e.ActionState != "Dead" && e.Weapons.Count == 0).ToList();
        
        System.Threading.Tasks.Parallel.ForEach(meleeEnemies, parallelOptions, enemy =>
        {
            if (!_configs.Enemies.TryGetValue(enemy.ConfigId, out var enemyCfg)) return;

            float attackSpeedPct = Math.Max(0f, enemy.GetTotalStat("attackSpeedPercent", _configs));
            float scaledDuration = enemyCfg.AttackDuration / (1f + attackSpeedPct);
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

                        _eventBus.Publish(new DamageAppliedEvent
                        {
                            Target = target, AttackerId = enemy.Id, State = state, Amount = finalDamage,
                            IsCritical = false, IsDodge = isDodge, IsBlock = false
                        });
                    }
                }
                enemy.AttackCooldown = scaledDuration - (dt * 3f);
            }
        });

        // Clean up thread-safe bags
        foreach (var id in projectilesToRemove) state.Projectiles.TryRemove(id, out _);
        foreach (var id in pickupsToRemove) state.Pickups.TryRemove(id, out _);
    }

    internal static float CalculateMitigatedDamage(float physDmg, float magicDmg, BaseActorEntity target, ConfigManager configs)
    {
        // 1. Get the base flat stats
        float baseArmor = Math.Max(0f, target.GetTotalStat("armor", configs));
        float baseMagicDef = Math.Max(0f, target.GetTotalStat("magicDefense", configs));

        // 2. Get the percentage boost (e.g., 0.50 for 50% defense)
        float defensePercent = target.GetTotalStat("defensePercent", configs);

        // 3. Apply the percentage to scale the stats up! (Your idea)
        float finalArmor = baseArmor * (1f + defensePercent);
        float finalMagicDef = baseMagicDef * (1f + defensePercent);

        // 4. Run the standard MOBA mitigation formula using the boosted stats
        float mitigatedPhys = physDmg * (100f / (100f + finalArmor));
        float mitigatedMagic = magicDmg * (100f / (100f + finalMagicDef));

        return mitigatedPhys + mitigatedMagic;
    }

   public static (float phys, float magic, bool isCrit) CalculateWeaponDamageSplit(BaseActorEntity actor, WeaponConfig wCfg, EquippedWeapon weapon, ConfigManager configs)
    {
        float physDamage = weapon.TotalBaseStats.GetValueOrDefault("meleeDamage", 0f) + weapon.RolledStats.GetValueOrDefault("meleeDamage", 0f) +
                           weapon.TotalBaseStats.GetValueOrDefault("rangedDamage", 0f) + weapon.RolledStats.GetValueOrDefault("rangedDamage", 0f);
        float magicDamage = weapon.TotalBaseStats.GetValueOrDefault("magicDamage", 0f) + weapon.RolledStats.GetValueOrDefault("magicDamage", 0f);

        if (wCfg.DamageScaling != null)
        {
            foreach (var scale in wCfg.DamageScaling)
            {
                float bonus = actor.GetTotalStat(scale.Key, configs) * scale.Value;
                if (scale.Key == "magicDamage" || scale.Key == "elementalDamage") magicDamage += bonus;
                else physDamage += bonus;
            }
        }

        // Apply the general damage multiplier
        float damagePercent = actor.GetTotalStat("damagePercent", configs);
        physDamage *= (1f + damagePercent);
        magicDamage *= (1f + damagePercent);

        // >>> THE BROTATO SAFEGUARD: Clamp to 0 so negative stats don't heal enemies! <<<
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
}