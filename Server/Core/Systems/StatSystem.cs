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

        if (isFirstCalc)
        {
            player.CurrentMaxHp = Math.Max(1f, player.Stats.GetFinalStat("maxHp"));
            player.CurrentHp = player.CurrentMaxHp;
        }

        foreach (var statName in _configs.AllStats)
        {
            float baseStat = player.Stats.GetFinalStat(statName);

            // >>> NEW: Track Flat and Percentage separately <<<
            float flatBonus = 0f;
            float percentBonus = 0f;

            // 1. Items
            foreach (var item in player.OwnedItems)
            {
                if (item.TotalBaseStats != null && item.TotalBaseStats.TryGetValue(statName, out float iBase)) flatBonus += iBase;
                if (item.RolledStats != null && item.RolledStats.TryGetValue(statName, out float iRoll)) flatBonus += iRoll;

                if (_configs.Items.TryGetValue(item.ConfigId, out var itemConfig))
                {
                    if (itemConfig.StatMultipliers != null && itemConfig.StatMultipliers.TryGetValue(statName, out float iMult)) percentBonus += iMult;
                    flatBonus += EvaluateDynamicModifiers(itemConfig.DynamicModifiers, statName, player, item.Level, state);
                }
            }

            // 2. Weapons
            foreach (var weapon in player.Weapons)
            {
                if (weapon.TotalBaseStats != null && weapon.TotalBaseStats.TryGetValue(statName, out float wBase)) flatBonus += wBase;
                if (weapon.RolledStats != null && weapon.RolledStats.TryGetValue(statName, out var wRoll)) flatBonus += wRoll;

                if (_configs.Weapons.TryGetValue(weapon.ConfigId, out var weaponConfig))
                {
                    if (weaponConfig.StatMultipliers != null && weaponConfig.StatMultipliers.TryGetValue(statName, out float wMult)) percentBonus += wMult;
                }
            }

            // 3. Status Effects
            foreach (var effect in player.ActiveEffects)
            {
                if (_configs.Effects.TryGetValue(effect.ConfigId, out var effectConfig))
                {
                    if (effectConfig.StatModifiers != null && effectConfig.StatModifiers.TryGetValue(statName, out float amount)) flatBonus += amount;
                    if (effectConfig.StatMultipliers != null && effectConfig.StatMultipliers.TryGetValue(statName, out float mult)) percentBonus += mult;
                }
            }

            // 4. Character Config (Base character passives)
            if (_configs.Characters.TryGetValue(player.ConfigId, out var charConfig))
            {
                if (charConfig.StatMultipliers != null && charConfig.StatMultipliers.TryGetValue(statName, out float cMult)) percentBonus += cMult;
                flatBonus += EvaluateDynamicModifiers(charConfig.DynamicModifiers, statName, player, 1f, state);
            }

            // 5. Traits
            var activeTraits = player.GetActiveTraits(_configs);
            foreach (var traitId in activeTraits)
            {
                if (_configs.Traits != null && _configs.Traits.TryGetValue(traitId, out var traitCfg))
                {
                    if (traitCfg.StatBonuses != null && traitCfg.StatBonuses.TryGetValue(statName, out var bonus)) flatBonus += bonus;
                    if (traitCfg.StatMultipliers != null && traitCfg.StatMultipliers.TryGetValue(statName, out var mult)) percentBonus += mult;
                    flatBonus += EvaluateDynamicModifiers(traitCfg.DynamicModifiers, statName, player, 1f, state);
                }
            }

            // >>> FINAL CALCULATION (Brotato Math) <<<
            float finalValue = (baseStat + flatBonus) * (1f + percentBonus);

            // Clamp specific stats
            if (statName == "critChance" || statName == "projectileBlockChance" || statName == "dodge")
                finalValue = Math.Clamp(finalValue, 0f, 1f);

            // Record only the stats that actually changed for Network delta compression
            if (!player.CachedStats.TryGetValue(statName, out float oldVal) || oldVal != finalValue)
                player.PendingStatDiff[statName] = finalValue;

            player.CachedStats[statName] = finalValue;

            // Achievement tracking: remember the highest value this stat ever reached this match.
            if (!player.PeakStats.TryGetValue(statName, out float peakVal) || finalValue > peakVal)
                player.PeakStats[statName] = finalValue;
        }

        player.CurrentMaxHp = Math.Max(1f, player.CachedStats.GetValueOrDefault("maxHp", 100f));
        if (isFirstCalc) player.CurrentHp = player.CurrentMaxHp;

        player.StatsNeedRecalculation = false;
    }

    private void RecalculateEnemy(EnemyEntity enemy, GameState state)
    {
        bool isFirstCalc = enemy.CachedStats.Count == 0;

        if (isFirstCalc)
        {
            enemy.CurrentMaxHp = Math.Max(1f, enemy.Stats.GetFinalStat("maxHp"));
            enemy.CurrentHp = enemy.CurrentMaxHp;
        }

        foreach (var statName in _configs.AllStats)
        {
            float baseStat = enemy.Stats.GetFinalStat(statName);
            float flatBonus = 0f;
            float percentBonus = 0f;

            if (_configs.Enemies.TryGetValue(enemy.ConfigId, out var config))
            {
                if (config.StatMultipliers != null && config.StatMultipliers.TryGetValue(statName, out float eMult)) percentBonus += eMult;

                if (config.DynamicModifiers != null)
                {
                    foreach (var mod in config.DynamicModifiers.Where(m => m.TargetStat == statName))
                    {
                        if (mod.ConditionType == "MissingHealthPercent")
                        {
                            float missingHpPercent = 1f - (enemy.CurrentHp / Math.Max(1f, enemy.Stats.GetFinalStat("maxHp")));
                            int chunks = (int)Math.Floor(missingHpPercent / Math.Max(0.01f, mod.ConditionThreshold));
                            flatBonus += (mod.Amount * chunks);
                        }
                        else if (mod.ConditionType == "PerXStat" && !string.IsNullOrEmpty(mod.ConditionStat))
                        {
                            float sourceStatValue = enemy.CachedStats.GetValueOrDefault(mod.ConditionStat, 0f);
                            int chunks = (int)Math.Floor(sourceStatValue / Math.Max(0.01f, mod.ConditionThreshold));
                            flatBonus += (mod.Amount * chunks);
                        }
                    }
                }
            }

            foreach (var effect in enemy.ActiveEffects)
            {
                if (_configs.Effects.TryGetValue(effect.ConfigId, out var effectConfig))
                {
                    if (effectConfig.StatModifiers != null && effectConfig.StatModifiers.TryGetValue(statName, out float amount)) flatBonus += amount;
                    if (effectConfig.StatMultipliers != null && effectConfig.StatMultipliers.TryGetValue(statName, out float mult)) percentBonus += mult;
                }
            }

            foreach (var weapon in enemy.Weapons)
            {
                if (weapon.TotalBaseStats != null && weapon.TotalBaseStats.TryGetValue(statName, out float wBase)) flatBonus += wBase;
                if (weapon.RolledStats != null && weapon.RolledStats.TryGetValue(statName, out float wRoll)) flatBonus += wRoll;
                if (_configs.Weapons.TryGetValue(weapon.ConfigId, out var wConfig) && wConfig.StatMultipliers != null && wConfig.StatMultipliers.TryGetValue(statName, out float wMult)) percentBonus += wMult;
            }

            foreach (var item in enemy.OwnedItems)
            {
                if (item.TotalBaseStats != null && item.TotalBaseStats.TryGetValue(statName, out float iBase)) flatBonus += iBase;
                if (item.RolledStats != null && item.RolledStats.TryGetValue(statName, out float iRoll)) flatBonus += iRoll;
                if (_configs.Items.TryGetValue(item.ConfigId, out var iConfig) && iConfig.StatMultipliers != null && iConfig.StatMultipliers.TryGetValue(statName, out float iMult)) percentBonus += iMult;
            }

            float finalValue = (baseStat + flatBonus) * (1f + percentBonus);
            if (statName == "critChance" || statName == "projectileBlockChance" || statName == "dodge")
                finalValue = Math.Clamp(finalValue, 0f, 1f);

            enemy.CachedStats[statName] = finalValue;
        }

        enemy.CurrentMaxHp = Math.Max(1f, enemy.CachedStats.GetValueOrDefault("maxHp", 10f));
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