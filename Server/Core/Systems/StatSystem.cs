using Server.Configs;
using Server.Entities;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Server.Core.Systems;

public class StatSystem : IGameSystem
{
    private ConfigManager _configs = null!;

    public StatSystem() { }

    public void Initialize(EventBus eventBus, ConfigManager configs)
    {
        _configs = configs;
    }

    public void Update(float dt, GameState state)
    {
        foreach (var player in state.Players.Values)
        {
            if (player.CachedStats.Count == 0) player.StatsNeedRecalculation = true;
            if (player.StatsNeedRecalculation) RecalculatePlayer(player, state);
        }

        foreach (var enemy in state.Enemies.Values)
        {
            if (enemy.CachedStats.Count == 0) enemy.StatsNeedRecalculation = true;
            if (enemy.StatsNeedRecalculation) RecalculateEnemy(enemy, state);
        }
    }

    private void RecalculatePlayer(PlayerEntity player, GameState state)
    {
        bool isFirstCalc = player.CachedStats.Count == 0;

        // >>> FIX 1: Initialize HP safely before the loop
        if (isFirstCalc)
        {
            player.CurrentMaxHp = Math.Max(1f, player.Stats.GetFinalStat("maxHp"));
            player.CurrentHp = player.CurrentMaxHp;
        }

        foreach (var statName in _configs.AllStats)
        {
            float baseStat = player.Stats.GetFinalStat(statName);
            float dynamicFlat = 0f;
            float traitMultiplier = 1f;

            foreach (var item in player.OwnedItems)
            {
                if (item.TotalBaseStats != null && item.TotalBaseStats.TryGetValue(statName, out float iBase)) dynamicFlat += iBase;
                if (item.RolledStats != null && item.RolledStats.TryGetValue(statName, out float iRoll)) dynamicFlat += iRoll;
                if (_configs.Items.TryGetValue(item.ConfigId, out var itemConfig))
                    dynamicFlat += EvaluateDynamicModifiers(itemConfig.DynamicModifiers, statName, player, item.Level, state);
            }

            foreach (var weapon in player.Weapons)
            {
                if (weapon.TotalBaseStats != null && weapon.TotalBaseStats.TryGetValue(statName, out float wBase)) dynamicFlat += wBase;
                if (weapon.RolledStats != null && weapon.RolledStats.TryGetValue(statName, out var wRoll)) dynamicFlat += wRoll;
            }

            foreach (var effect in player.ActiveEffects)
            {
                if (_configs.Effects.TryGetValue(effect.ConfigId, out var effectConfig) && effectConfig.StatModifiers != null && effectConfig.StatModifiers.TryGetValue(statName, out float amount))
                    dynamicFlat += amount;
            }

            if (_configs.Characters.TryGetValue(player.ConfigId, out var charConfig))
                dynamicFlat += EvaluateDynamicModifiers(charConfig.DynamicModifiers, statName, player, 1f, state);

            var activeTraits = player.GetActiveTraits(_configs);
            foreach (var traitId in activeTraits)
            {
                if (_configs.Traits != null && _configs.Traits.TryGetValue(traitId, out var traitCfg))
                {
                    if (traitCfg.StatBonuses != null && traitCfg.StatBonuses.TryGetValue(statName, out var bonus)) dynamicFlat += bonus;
                    if (traitCfg.StatMultipliers != null && traitCfg.StatMultipliers.TryGetValue(statName, out var mult)) traitMultiplier *= mult;
                    dynamicFlat += EvaluateDynamicModifiers(traitCfg.DynamicModifiers, statName, player, 1f, state);
                }
            }

            float finalValue = (baseStat + dynamicFlat) * traitMultiplier;
            if (statName == "critChance" || statName == "projectileBlockChance") finalValue = Math.Min(1.0f, finalValue);

            // Record only the stats that actually changed for Network delta compression
            if (!player.CachedStats.TryGetValue(statName, out float oldVal) || oldVal != finalValue)
                player.PendingStatDiff[statName] = finalValue;

            player.CachedStats[statName] = finalValue;
        }

        player.CurrentMaxHp = player.CachedStats.GetValueOrDefault("maxHp", 100f);
        if (isFirstCalc) player.CurrentHp = player.CurrentMaxHp;

        player.StatsNeedRecalculation = false;
    }

    private void RecalculateEnemy(EnemyEntity enemy, GameState state)
    {
        bool isFirstCalc = enemy.CachedStats.Count == 0;

        // >>> FIX 1: Prevent 0 HP from triggering low-health buffs on spawn!
        if (isFirstCalc)
        {
            enemy.CurrentMaxHp = Math.Max(1f, enemy.Stats.GetFinalStat("maxHp"));
            enemy.CurrentHp = enemy.CurrentMaxHp;
        }

        foreach (var statName in _configs.AllStats)
        {
            float baseStat = enemy.Stats.GetFinalStat(statName);
            float dynamicFlat = 0f;

            if (_configs.Enemies.TryGetValue(enemy.ConfigId, out var config) && config.DynamicModifiers != null)
            {
                foreach (var mod in config.DynamicModifiers.Where(m => m.TargetStat == statName))
                {
                    if (mod.ConditionType == "MissingHealthPercent")
                    {
                        float missingHpPercent = 1f - (enemy.CurrentHp / Math.Max(1f, enemy.Stats.GetFinalStat("maxHp")));
                        int chunks = (int)Math.Floor(missingHpPercent / Math.Max(0.01f, mod.ConditionThreshold));
                        dynamicFlat += (mod.Amount * chunks);
                    }
                    else if (mod.ConditionType == "PerXStat" && !string.IsNullOrEmpty(mod.ConditionStat))
                    {
                        float sourceStatValue = enemy.CachedStats.GetValueOrDefault(mod.ConditionStat, 0f);
                        int chunks = (int)Math.Floor(sourceStatValue / Math.Max(0.01f, mod.ConditionThreshold));
                        dynamicFlat += (mod.Amount * chunks);
                    }
                }
            }

            foreach (var effect in enemy.ActiveEffects)
            {
                if (_configs.Effects.TryGetValue(effect.ConfigId, out var effectConfig) && effectConfig.StatModifiers != null && effectConfig.StatModifiers.TryGetValue(statName, out float amount))
                    dynamicFlat += amount;
            }

            foreach (var weapon in enemy.Weapons)
            {
                if (weapon.TotalBaseStats != null && weapon.TotalBaseStats.TryGetValue(statName, out float wBase)) dynamicFlat += wBase;
                if (weapon.RolledStats != null && weapon.RolledStats.TryGetValue(statName, out float wRoll)) dynamicFlat += wRoll;
            }

            foreach (var item in enemy.OwnedItems)
            {
                if (item.TotalBaseStats != null && item.TotalBaseStats.TryGetValue(statName, out float iBase)) dynamicFlat += iBase;
                if (item.RolledStats != null && item.RolledStats.TryGetValue(statName, out float iRoll)) dynamicFlat += iRoll;
            }

            float finalValue = baseStat + dynamicFlat;
            if (statName == "critChance" || statName == "projectileBlockChance") finalValue = Math.Min(1.0f, finalValue);

            enemy.CachedStats[statName] = finalValue;
        }

        enemy.CurrentMaxHp = enemy.CachedStats.GetValueOrDefault("maxHp", 10f);
        if (isFirstCalc) enemy.CurrentHp = enemy.CurrentMaxHp;

        enemy.StatsNeedRecalculation = false;
    }

    private float EvaluateDynamicModifiers(IEnumerable<DynamicModifier> modifiers, string statName, PlayerEntity player, float itemLevel, GameState state)
    {
        float flatBonus = 0f;
        if (modifiers == null) return flatBonus;

        foreach (var mod in modifiers.Where(m => m.TargetStat == statName))
        {
            float safeThreshold = Math.Max(0.01f, mod.ConditionThreshold);

            switch (mod.ConditionType)
            {
                case "MissingHealthPercent":
                    float maxHp = Math.Max(1f, player.Stats.GetFinalStat("maxHp"));
                    float safeCurrentHp = Math.Clamp(player.CurrentHp, 0f, maxHp);
                    float missingHpPercent = 1f - (safeCurrentHp / maxHp);
                    int chunksHp = (int)Math.Floor(missingHpPercent / safeThreshold);
                    flatBonus += (mod.Amount * chunksHp * itemLevel);
                    break;

                case "PerXStat":
                    if (!string.IsNullOrEmpty(mod.ConditionStat))
                    {
                        float sourceStatValue = player.CachedStats.GetValueOrDefault(mod.ConditionStat, 0f);
                        float safeSourceStat = Math.Max(0f, sourceStatValue);
                        int chunksStat = (int)Math.Floor(safeSourceStat / safeThreshold);
                        flatBonus += (mod.Amount * chunksStat * itemLevel);
                    }
                    break;

                case "IsStandingStill":
                    if (player.InputX == 0 && player.InputY == 0) flatBonus += (mod.Amount * itemLevel);
                    break;

                case "PerItemOwned":
                    flatBonus += (player.OwnedItems.Count * mod.Amount * itemLevel);
                    break;

                case "PerEnemyAlive":
                    if (state != null)
                    {
                        int activeEnemies = state.Enemies.Count(e => e.Value.ActionState != "Dead");
                        flatBonus += (activeEnemies * mod.Amount * itemLevel);
                    }
                    break;
            }
        }
        return flatBonus;
    }
}