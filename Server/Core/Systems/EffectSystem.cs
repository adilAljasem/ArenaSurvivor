using Server.Configs;
using Server.DTOs;
using Server.Entities;

namespace Server.Core.Systems;

public static class EffectSystem
{
    public static void Process(float dt, GameState state, ConfigManager configs, List<DamageEventDto> damageEvents, List<AoeEventDto> aoeEvents)
    {
        // 1. Process Players
        foreach (var player in state.Players.Values)
        {
            for (int i = player.ActiveEffects.Count - 1; i >= 0; i--)
            {
                var effect = player.ActiveEffects[i];
                if (!configs.Effects.TryGetValue(effect.ConfigId, out var config)) continue;

                effect.TimeRemaining -= dt;
                effect.TimeSinceLastTick += dt;

                if (config.TickRate > 0 && effect.TimeSinceLastTick >= config.TickRate)
                {
                    effect.TimeSinceLastTick -= config.TickRate;
                    player.CurrentHp -= config.TickDamage;
                }

                if (effect.TimeRemaining <= 0) player.ActiveEffects.RemoveAt(i);
            }
        }

        // 2. Process Enemies
        foreach (var enemy in state.Enemies.Values)
        {
            for (int i = enemy.ActiveEffects.Count - 1; i >= 0; i--)
            {
                var effect = enemy.ActiveEffects[i];
                if (!configs.Effects.TryGetValue(effect.ConfigId, out var config)) continue;

                effect.TimeRemaining -= dt;
                effect.TimeSinceLastTick += dt;

                if (config.TickRate > 0 && effect.TimeSinceLastTick >= config.TickRate)
                {
                    effect.TimeSinceLastTick -= config.TickRate;
                    enemy.CurrentHp -= config.TickDamage;

                    damageEvents.Add(new DamageEventDto { X = enemy.X, Y = enemy.Y, Amount = config.TickDamage });

                    if (enemy.CurrentHp <= 0 && enemy.ActionState != "Dead")
                    {
                        enemy.ActionState = "Dead";
                        var gold = new PickupEntity { X = enemy.X, Y = enemy.Y, Value = 1 };
                        state.Pickups.TryAdd(gold.Id, gold);

                        // >>> FIRE DEATH SKILLS <<<
                        if (configs.Enemies.TryGetValue(enemy.ConfigId, out var eCfg))
                        {
                            SkillSystem.FireOnDeathSkills(enemy.Id, enemy.X, enemy.Y, enemy.Team, eCfg.OnDeathSkills, state, configs, damageEvents, aoeEvents);
                        }
                    }
                }

                if (effect.TimeRemaining <= 0) enemy.ActiveEffects.RemoveAt(i);
            }
        }
    }
}