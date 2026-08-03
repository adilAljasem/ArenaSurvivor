using Server.Configs;
using Server.Entities;
using System;
using System.Linq;

namespace Server.Core.Systems;

public class HealthSystem : IGameSystem
{
    private EventBus _eventBus = null!;
    private ConfigManager _configs = null!;

    public void Initialize(EventBus eventBus, ConfigManager configs)
    {
        _eventBus = eventBus;
        _configs = configs;
        _eventBus.Subscribe<DamageAppliedEvent>(OnDamageApplied);
        _eventBus.Subscribe<EntityDeathEvent>(OnEntityDeath);
    }

    public void Update(float dt, GameState state)
    {
        ProcessRegen(dt, state);
        ProcessDespawns(dt, state);
    }
    private void ProcessDespawns(float dt, GameState state)
    {
        foreach (var enemy in state.Enemies.Values)
        {
            if (enemy.ActionState == "Dead") continue;

            // If the entity has a valid despawn timer running
            if (enemy.DespawnTimer > 0)
            {
                enemy.DespawnTimer -= dt;
                if (enemy.DespawnTimer <= 0)
                {
                    // Deal massive damage to trigger the normal death pipeline
                    _eventBus.Publish(new DamageAppliedEvent
                    {
                        TargetId = enemy.Id,
                        AttackerId = enemy.Id, // Self-inflicted
                        Amount = 999999f,
                        IsCritical = false,
                        IsDodge = false,
                        IsBlock = false
                    });
                }
            }
        }
    }

    private void ProcessRegen(float dt, GameState state)
    {
        foreach (var player in state.Players.Values)
        {
            if (player.ActionState == "Dead") continue;
            float regen = player.CachedStats.GetValueOrDefault("hpRegen", 0f);
            if (regen > 0 && player.CurrentHp < player.CurrentMaxHp)
                player.CurrentHp = Math.Min(player.CurrentMaxHp, player.CurrentHp + (regen * dt));
        }

        foreach (var enemy in state.Enemies.Values)
        {
            if (enemy.ActionState == "Dead") continue;
            float regen = enemy.CachedStats.GetValueOrDefault("hpRegen", 0f);
            if (regen > 0 && enemy.CurrentHp < enemy.CurrentMaxHp)
                enemy.CurrentHp = Math.Min(enemy.CurrentMaxHp, enemy.CurrentHp + (regen * dt));
        }
    }

    private void OnEntityDeath(EntityDeathEvent ev, GameState state)
    {
        if (ev.IsPlayer && state.Players.TryGetValue(ev.EntityId, out var deadPlayer))
            deadPlayer.Deaths++;

        if (state.Players.TryGetValue(ev.KillerId, out var killer))
            killer.Kills++;
    }

    private void OnDamageApplied(DamageAppliedEvent ev, GameState state)
    {
        // NEW: the target is resolved by ID at execution time instead of held as a direct
        // reference on the event. If it's gone (e.g. the player disconnected between publish
        // and processing), this just no-ops instead of operating on stale/removed state.
        var target = EntityResolver.ResolveActor(state, ev.TargetId);
        if (target == null || target.ActionState == "Dead" || ev.IsDodge || ev.IsBlock) return;

        var attackerPlayer = state.Players.GetValueOrDefault(ev.AttackerId);
        var targetPlayer = target as PlayerEntity;

        // --- HEALING ---
        if (ev.Amount < 0)
        {
            float maxHp = target.GetTotalStat("maxHp", _configs);
            float rawHeal = -ev.Amount;
            float healPower = GetHealerHealPower(ev.AttackerId, target, state);

            float actualHeal = Math.Min(maxHp - target.CurrentHp, Math.Max(0f, rawHeal * (1f + healPower / 100f)));
            target.CurrentHp += actualHeal;

            if (attackerPlayer != null)
            {
                attackerPlayer.TotalHealingDone += actualHeal;
            }
            return;
        }

        // --- SHIELD MITIGATION ---
        // NOTE: the original mutated `ev.Amount` directly here (`ev.Amount = remainingDamage`) -
        // that's now illegal since Amount is init-only, and it's exactly the post-publish event
        // mutation Rule 3 forbids. Using a local variable instead fixes the same bug the rule
        // was written to prevent: a second subscriber to DamageAppliedEvent would previously have
        // seen whatever the first subscriber left in ev.Amount, in enqueue order, silently.
        float remainingDamage = ev.Amount;
        if (remainingDamage > 0 && target.CurrentShield > 0)
        {
            foreach (var effect in target.ActiveEffects.Where(e => e.GrantedShieldAmount > 0))
            {
                if (remainingDamage <= 0) break;
                float absorb = Math.Min(effect.GrantedShieldAmount, remainingDamage);
                effect.GrantedShieldAmount -= absorb;
                target.ModifyShield(-absorb);
                remainingDamage -= absorb;

                if (effect.Caster is PlayerEntity shieldCaster)
                {
                    shieldCaster.TotalShieldingDone += absorb;
                }
                else if (targetPlayer != null)
                {
                    targetPlayer.TotalShieldingDone += absorb;
                }
            }
            target.ClampShieldNonNegative();
        }


        // --- DAMAGE TRACKING ---
        if (remainingDamage > 0)
        {
            if (attackerPlayer != null) attackerPlayer.TotalDamageDealt += remainingDamage;
            if (targetPlayer != null) targetPlayer.TotalDamageTaken += remainingDamage;

            target.CurrentHp -= remainingDamage;
        }

        // --- DEATH TRIGGER ---
        if (target.CurrentHp <= 0 && target.ActionState != "Dead")
        {
            target.SetActionState("Dead");
            bool isPlayer = target is PlayerEntity;
            string entityId = EntityResolver.GetId(target);
            string configId = isPlayer ? ((PlayerEntity)target).ConfigId : ((EnemyEntity)target).ConfigId;

            _eventBus.Publish(new EntityDeathEvent
            {
                EntityId = entityId,
                KillerId = ev.AttackerId,
                X = target.X,
                Y = target.Y,
                Team = target.Team,
                ConfigId = configId,
                IsPlayer = isPlayer
            });
        }
    }

    private float GetHealerHealPower(string attackerId, BaseActorEntity target, GameState state)
    {
        var healer = EntityResolver.ResolveActor(state, attackerId);
        if (healer != null) return healer.CachedStats.GetValueOrDefault("healPower", 0f);
        return target.CachedStats.GetValueOrDefault("healPower", 0f);
    }
}