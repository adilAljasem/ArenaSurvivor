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
        foreach (var player in state.Players.Values)
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
                    foreach (var enemy in state.Enemies.Values)
                    {
                        if (enemy.ActionState == "Dead" || enemy.Team == "Player") continue;
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

                            var newBullets = ProjectileFactory.Create(projConfig, player.ConnectionId, "Player", spawnX, spawnY, dirX, dirY, physDmg, magicDmg, finalSpeed, totalLifeSteal, combinedEffects, 1, computedLifespan, isCrit);
                            _eventBus.Publish(new SpawnProjectileEvent { Projectiles = newBullets, State = state });
                        }
                    }
                }
            }
        }

        foreach (var enemy in state.Enemies.Values)
        {
            if (enemy.ActionState == "Dead" || enemy.Weapons.Count == 0) continue;

            float bestDistSq = float.MaxValue, targetX = 0, targetY = 0;
            bool foundTarget = false;

            if (enemy.Team != "Enemy")
            {
                foreach (var hostile in state.Enemies.Values)
                {
                    if (hostile.Id == enemy.Id || hostile.ActionState == "Dead" || hostile.Team == enemy.Team) continue;
                    float distSq = (hostile.X - enemy.X) * (hostile.X - enemy.X) + (hostile.Y - enemy.Y) * (hostile.Y - enemy.Y);
                    if (distSq < bestDistSq) { bestDistSq = distSq; targetX = hostile.X; targetY = hostile.Y; foundTarget = true; }
                }
            }
            else
            {
                foreach (var player in state.Players.Values)
                {
                    float distSq = (player.X - enemy.X) * (player.X - enemy.X) + (player.Y - enemy.Y) * (player.Y - enemy.Y);
                    if (distSq < bestDistSq) { bestDistSq = distSq; targetX = player.X; targetY = player.Y; foundTarget = true; }
                }
                foreach (var summon in state.Enemies.Values)
                {
                    if (summon.ActionState == "Dead" || summon.Id == enemy.Id || summon.Team == "Enemy") continue;
                    float distSq = (summon.X - enemy.X) * (summon.X - enemy.X) + (summon.Y - enemy.Y) * (summon.Y - enemy.Y);
                    if (distSq < bestDistSq) { bestDistSq = distSq; targetX = summon.X; targetY = summon.Y; foundTarget = true; }
                }
            }

            if (!foundTarget) continue;
            enemy.AimX = targetX; enemy.AimY = targetY;

            float attackRadius = _configs.Enemies.TryGetValue(enemy.ConfigId, out var enemyCfg) ? enemyCfg.AttackRadius : 300f;
            if (bestDistSq > attackRadius * attackRadius) continue;

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
        }
    }

    private void ProcessCollisions(float dt, GameState state)
    {
        var projectilesToRemove = new List<string>();
        var pickupsToRemove = new List<string>();

        foreach (var proj in state.Projectiles.Values)
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

            if (!string.IsNullOrEmpty(proj.TickSkillId) && _configs.Skills.TryGetValue(proj.TickSkillId, out var tickSkill))
            {
                proj.TimeSinceLastTick += dt;
                float effectiveTickRate = Math.Max(0.1f, proj.TickRate > 0 ? proj.TickRate : tickSkill.CooldownSeconds);
                if (proj.TimeSinceLastTick >= effectiveTickRate)
                {
                    proj.TimeSinceLastTick %= effectiveTickRate;
                    // >>> FIX 1: EventBus <<<
                    _eventBus.Publish(new RequestSkillCastEvent { Skill = tickSkill, CasterId = proj.OwnerId, StartX = proj.X, StartY = proj.Y, Team = proj.Team, State = state, SourceProjectile = proj });
                }
            }

            if (proj.Lifespan <= 0 || proj.HitEnemies.Count > proj.PierceCount)
            {
                if (!projectilesToRemove.Contains(proj.Id))
                {
                    projectilesToRemove.Add(proj.Id);
                    if (!string.IsNullOrEmpty(proj.OnDeathSkillId) && _configs.Skills.TryGetValue(proj.OnDeathSkillId, out var deathSkill))
                    {
                        // >>> FIX 2: EventBus <<<
                        _eventBus.Publish(new RequestSkillCastEvent { Skill = deathSkill, CasterId = proj.OwnerId, StartX = proj.X, StartY = proj.Y, Team = proj.Team, State = state });
                    }
                }
                continue;
            }

            bool isPlayerProj = state.Players.ContainsKey(proj.OwnerId) || (state.Enemies.TryGetValue(proj.OwnerId, out var o) && o.Team != "Enemy");
            var targets = isPlayerProj ? state.Enemies.Values.Where(e => e.Team == "Enemy") : state.Players.Values.Cast<BaseActorEntity>().Concat(state.Enemies.Values.Where(e => e.Team != "Enemy"));

            foreach (var target in targets)
            {
                string tId = target is PlayerEntity pTarget ? pTarget.ConnectionId : ((EnemyEntity)target).Id;
                if (target.ActionState == "Dead" || proj.HitEnemies.Contains(tId)) continue;

                // >>> ABSOLUTE MANUAL CONTROL: No hidden scale multipliers <<<
                float targetHitRadius = 15f;
                if (target is EnemyEntity e)
                {
                    targetHitRadius = e.HitRadius;
                }
                else if (target is PlayerEntity p)
                {
                    // >>> THE FIX: Read strictly from the Character Config JSON <<<
                    targetHitRadius = _configs.Characters.TryGetValue(p.ConfigId, out var pCfg) ? pCfg.HitRadius : 15f;
                }

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
                        Target = target,
                        AttackerId = proj.OwnerId,
                        State = state,
                        Amount = finalDamage,
                        IsCritical = proj.IsCritical,
                        IsDodge = isDodge,
                        IsBlock = isBlock
                    });

                    proj.HitEnemies.Add(tId);

                    if (!isDodge && !isBlock)
                    {
                        if (proj.ApplyEffectsOnHit != null)
                        {
                            foreach (var effectId in proj.ApplyEffectsOnHit)
                            {
                                // >>> THE FIX: Publish event instead of manual insertion <<<
                                _eventBus.Publish(new ApplyEffectEvent { Target = target, EffectConfigId = effectId });
                            }
                        }

                        if (Random.Shared.NextDouble() < proj.LifeStealChance && state.Players.TryGetValue(proj.OwnerId, out var pHeal))
                            pHeal.CurrentHp = Math.Min(pHeal.GetTotalStat("maxHp", _configs), pHeal.CurrentHp + 1f);
                    }

                    if (isBlock || proj.HitEnemies.Count > proj.PierceCount)
                    {
                        if (!projectilesToRemove.Contains(proj.Id))
                        {
                            projectilesToRemove.Add(proj.Id);
                            if (!string.IsNullOrEmpty(proj.OnDeathSkillId) && _configs.Skills.TryGetValue(proj.OnDeathSkillId, out var deathSkill))
                            {
                                // >>> FIX 3: EventBus <<<
                                _eventBus.Publish(new RequestSkillCastEvent { Skill = deathSkill, CasterId = proj.OwnerId, StartX = proj.X, StartY = proj.Y, Team = proj.Team, State = state });
                            }
                        }
                        break;
                    }
                }
            }
        }

        if (!_configs.Difficulties.TryGetValue(state.CurrentDifficulty, out var currentDiff)) currentDiff = new DifficultyConfig();
        foreach (var player in state.Players.Values)
        {
            foreach (var pickup in state.Pickups.Values)
            {
                if (pickupsToRemove.Contains(pickup.Id)) continue;
                if ((player.X - pickup.X) * (player.X - pickup.X) + (player.Y - pickup.Y) * (player.Y - pickup.Y) < 625)
                {
                    if (pickup.Type == PickupType.Gold)
                    {
                        player.Gold += (int)Math.Max(1, pickup.Value * currentDiff.GoldMultiplier);
                        player.GainXp((int)Math.Max(1, pickup.Value * currentDiff.XpMultiplier), _configs);
                        pickupsToRemove.Add(pickup.Id);
                    }
                }
            }
        }

        foreach (var enemy in state.Enemies.Values)
        {
            if (enemy.ActionState == "Dead" || enemy.Weapons.Count > 0 || !_configs.Enemies.TryGetValue(enemy.ConfigId, out var enemyCfg)) continue;

            float attackSpeedPct = Math.Max(0f, enemy.GetTotalStat("attackSpeedPercent", _configs));
            float scaledDuration = enemyCfg.AttackDuration / (1f + attackSpeedPct);
            bool isRooted = enemy.ActionState == "Casting" && !string.IsNullOrEmpty(enemy.CurrentCastingSkillId) && _configs.Skills.TryGetValue(enemy.CurrentCastingSkillId, out var eCastCfg) && eCastCfg.StopMoving;

            if (!isRooted && (enemy.ActionState == "Attacking" || enemy.ActionState == "Casting") && Math.Abs(enemy.AttackCooldown - scaledDuration) < (dt * 2))
            {
                float meleeDmg = enemy.GetTotalStat("meleeDamage", _configs);
                if (meleeDmg <= 0) continue;

                var targets = enemy.Team == "Enemy" ? state.Players.Values.Cast<BaseActorEntity>().Concat(state.Enemies.Values.Where(e => e.Team != "Enemy")) : state.Enemies.Values.Where(e => e.Team == "Enemy");
                float attackRadiusSq = enemyCfg.AttackRadius * enemyCfg.AttackRadius;

                foreach (var target in targets)
                {
                    if (target.ActionState == "Dead") continue;
                    if ((target.X - enemy.X) * (target.X - enemy.X) + (target.Y - enemy.Y) * (target.Y - enemy.Y) <= attackRadiusSq)
                    {
                        float dodgeChance = Math.Clamp(target.GetTotalStat("dodge", _configs), 0f, 0.9f);
                        bool isDodge = dodgeChance > 0 && Random.Shared.NextDouble() <= dodgeChance;

                        _eventBus.Publish(new DamageAppliedEvent
                        {
                            Target = target,
                            AttackerId = enemy.Id,
                            State = state,
                            Amount = isDodge ? 0 : meleeDmg,
                            IsCritical = false,
                            IsDodge = isDodge,
                            IsBlock = false
                        });
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
        return (physDmg * (100f / (100f + armor))) + (magicDmg * (100f / (100f + magicDef)));
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

        float damagePercent = actor.GetTotalStat("damagePercent", configs);
        physDamage *= (1f + damagePercent);
        magicDamage *= (1f + damagePercent);

        bool isCrit = false;
        if (physDamage > 0 && Random.Shared.NextDouble() <= Math.Clamp(actor.GetTotalStat("critChance", configs), 0f, 1f))
        {
            isCrit = true;
            physDamage *= Math.Max(1.5f, actor.GetTotalStat("critMultiplier", configs));
        }

        return (physDamage, magicDamage, isCrit);
    }
}