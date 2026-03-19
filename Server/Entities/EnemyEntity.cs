using Server.Configs;
using Server.Core;
using System;
using System.Linq;

namespace Server.Entities;

public class EnemyEntity
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string ConfigId { get; set; } = string.Empty;
    public float X { get; set; }
    public float Y { get; set; }
    public float CurrentHp { get; set; }
    public StatDictionary Stats { get; set; } = new();
    public float HitRadius { get; set; }

    // Networked state and internal timer for animations
    public string ActionState { get; set; } = "Idle";
    public float DespawnTimer { get; set; } = 1.0f;
    public float AttackCooldown { get; set; } = 0f;

    public List<ActiveEffect> ActiveEffects { get; set; } = new();

    // Initializes the enemy with the Master Stat List so it never crashes
    public void Initialize(Configs.EnemyConfig config, float spawnX, float spawnY, ConfigManager configManager)
    {
        ConfigId = config.Id;
        X = spawnX;
        Y = spawnY;

        HitRadius = config.HitRadius * config.Scale;

        // 1. Initialize EVERY stat dynamically from the JSON file!
        foreach (var stat in configManager.AllStats)
        {
            Stats.InitializeStat(stat, 0f);
        }

        // 2. Overwrite with Enemy's base stats from JSON
        if (config.BaseStats != null)
        {
            foreach (var stat in config.BaseStats)
            {
                Stats.InitializeStat(stat.Key, stat.Value);
            }
        }

        CurrentHp = Stats.GetFinalStat("maxHp");
    }

    public float GetTotalStat(string statName, ConfigManager configManager)
    {
        float baseStat = Stats.GetFinalStat(statName);
        float dynamicFlat = 0f;

        if (configManager.Enemies.TryGetValue(ConfigId, out var config))
        {
            if (config.DynamicModifiers != null)
            {
                foreach (var mod in config.DynamicModifiers.Where(m => m.TargetStat == statName))
                {
                    if (mod.ConditionType == "MissingHealthPercent")
                    {
                        float missingHpPercent = 1f - (CurrentHp / Math.Max(1f, Stats.GetFinalStat("maxHp")));
                        int chunks = (int)Math.Floor(missingHpPercent / Math.Max(0.01f, mod.ConditionThreshold));
                        dynamicFlat += (mod.Amount * chunks);
                    }
                    else if (mod.ConditionType == "PerXStat" && !string.IsNullOrEmpty(mod.ConditionStat))
                    {
                        float sourceStatValue = GetTotalStat(mod.ConditionStat, configManager);
                        int chunks = (int)Math.Floor(sourceStatValue / Math.Max(0.01f, mod.ConditionThreshold));
                        dynamicFlat += (mod.Amount * chunks);
                    }
                }
            }
        }

        // >>> NEW: ACTIVE EFFECTS (Buffs & Debuffs) <<<
        foreach (var effect in ActiveEffects)
        {
            if (configManager.Effects.TryGetValue(effect.ConfigId, out var effectConfig))
            {
                if (effectConfig.StatModifiers != null && effectConfig.StatModifiers.TryGetValue(statName, out float amount))
                {
                    dynamicFlat += amount;
                }
            }
        }

        return baseStat + dynamicFlat;
    }
}