using Server.Configs;
using Server.Entities;
using System;

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

    private void OnDamageApplied(DamageAppliedEvent ev)
    {
        if (ev.Target.ActionState == "Dead") return;

        // 1. Ignore HP changes on Dodge/Block
        if (ev.IsDodge || ev.IsBlock) return;


        // 2. Handle Healing natively (Negative amount = Heal)
        if (ev.Amount < 0)
        {
            float maxHp = ev.Target.GetTotalStat("maxHp", _configs);
            ev.Target.CurrentHp = Math.Min(maxHp, ev.Target.CurrentHp - ev.Amount);
            return;
        }

        // >>> 3. NEW: SHIELD ABSORPTION LOGIC <<<
        if (ev.Amount > 0 && ev.Target.CurrentShield > 0)
        {
            float remainingDamage = ev.Amount;

            // Deplete the active shield effects greedily
            foreach (var effect in ev.Target.ActiveEffects.Where(e => e.GrantedShieldAmount > 0))
            {
                if (remainingDamage <= 0) break;
                float absorb = Math.Min(effect.GrantedShieldAmount, remainingDamage);

                effect.GrantedShieldAmount -= absorb;
                ev.Target.CurrentShield -= absorb;
                remainingDamage -= absorb;
            }

            // Ensure no negative shield anomalies
            ev.Target.CurrentShield = Math.Max(0, ev.Target.CurrentShield);

            // Pass whatever damage broke through the shield to the HP logic below
            ev.Amount = remainingDamage;
        }

        // 4. Apply Damage
        ev.Target.CurrentHp -= ev.Amount;

        // 5. Centralized Death Trigger
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
}