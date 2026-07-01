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
        // Subscribe to death events to track Kills and Deaths
        _eventBus.Subscribe<EntityDeathEvent>(OnEntityDeath);
    }

    public void Update(float dt, GameState state)
    {
        ProcessRegen(dt, state);
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

    private void OnEntityDeath(EntityDeathEvent ev)
    {
        // 1. Track Deaths
        if (ev.IsPlayer && ev.State.Players.TryGetValue(ev.EntityId, out var deadPlayer))
            deadPlayer.Deaths++;

        // 2. Track Kills
        if (ev.State.Players.TryGetValue(ev.KillerId, out var killer))
            killer.Kills++;
    }

    private void OnDamageApplied(DamageAppliedEvent ev)
    {
        if (ev.Target.ActionState == "Dead" || ev.IsDodge || ev.IsBlock) return;

        var attackerPlayer = ev.State.Players.GetValueOrDefault(ev.AttackerId);
        var targetPlayer = ev.Target as PlayerEntity;

        // --- HEALING ---
        if (ev.Amount < 0)
        {
            float maxHp = ev.Target.GetTotalStat("maxHp", _configs);
            float rawHeal = -ev.Amount;
            float healPower = GetHealerHealPower(ev);

            float actualHeal = Math.Min(maxHp - ev.Target.CurrentHp, rawHeal * (1f + healPower));
            ev.Target.CurrentHp += actualHeal;

            // FIX: Only the person who CAST the heal (AttackerId) gets the credit.
            // If they healed themselves, they get credit. If they healed an ally, they get credit.
            if (attackerPlayer != null)
            {
                attackerPlayer.TotalHealingDone += actualHeal;
            }
            return;
        }

        // --- SHIELD MITIGATION ---
        if (ev.Amount > 0 && ev.Target.CurrentShield > 0)
        {
            float remainingDamage = ev.Amount;
            foreach (var effect in ev.Target.ActiveEffects.Where(e => e.GrantedShieldAmount > 0))
            {
                if (remainingDamage <= 0) break;
                float absorb = Math.Min(effect.GrantedShieldAmount, remainingDamage);
                effect.GrantedShieldAmount -= absorb;
                ev.Target.CurrentShield -= absorb;
                remainingDamage -= absorb;

                // >>> FIX: Award to Shielding instead of Healing <<<
                if (effect.Caster is PlayerEntity shieldCaster)
                {
                    shieldCaster.TotalShieldingDone += absorb;
                }
                else if (targetPlayer != null)
                {
                    targetPlayer.TotalShieldingDone += absorb;
                }
            }
            ev.Target.CurrentShield = Math.Max(0, ev.Target.CurrentShield);
            ev.Amount = remainingDamage;
        }

        // --- DAMAGE TRACKING ---
        if (ev.Amount > 0)
        {
            if (attackerPlayer != null) attackerPlayer.TotalDamageDealt += ev.Amount;
            // We no longer care about tracking Damage Taken for the UI, but we can leave the math here
            if (targetPlayer != null) targetPlayer.TotalDamageTaken += ev.Amount;

            ev.Target.CurrentHp -= ev.Amount;
        }

        // --- DEATH TRIGGER ---
        if (ev.Target.CurrentHp <= 0 && ev.Target.ActionState != "Dead")
        {
            ev.Target.ActionState = "Dead";
            bool isPlayer = ev.Target is PlayerEntity;
            string entityId = isPlayer ? ((PlayerEntity)ev.Target).ConnectionId : ((EnemyEntity)ev.Target).Id;
            string configId = isPlayer ? ((PlayerEntity)ev.Target).ConfigId : ((EnemyEntity)ev.Target).ConfigId;

            _eventBus.Publish(new EntityDeathEvent
            {
                EntityId = entityId,
                KillerId = ev.AttackerId,
                X = ev.Target.X,
                Y = ev.Target.Y,
                Team = ev.Target.Team,
                ConfigId = configId,
                IsPlayer = isPlayer,
                State = ev.State
            });
        }
    }

    private float GetHealerHealPower(DamageAppliedEvent ev)
    {
        if (!string.IsNullOrEmpty(ev.AttackerId) && ev.State != null)
        {
            BaseActorEntity? healer = ev.State.Players.GetValueOrDefault(ev.AttackerId) as BaseActorEntity
                ?? ev.State.Enemies.GetValueOrDefault(ev.AttackerId);
            if (healer != null) return healer.CachedStats.GetValueOrDefault("healPower", 0f);
        }
        return ev.Target.CachedStats.GetValueOrDefault("healPower", 0f);
    }
}