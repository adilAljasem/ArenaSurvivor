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
        if (isFirstCalc) InitializeMaxHp(player, player.Stats.GetFinalStat("maxHp"));

        // TIER 1 FIX: snapshot these ONCE per player per tick instead of touching the live lists
        // on every stat iteration below. BuyItem/RecycleGear/TryPickupLoot can Add/Remove from
        // these from a hub thread at any moment - iterating the live list here would throw
        // "Collection was modified" if that lands mid-loop. Iterating a snapshot means a
        // concurrent purchase can never corrupt this pass; worst case this tick's stats are
        // computed against gear from a few milliseconds ago, which self-corrects next tick.
        var ownedItemsSnapshot = player.OwnedItems.ToList();
        var weaponsSnapshot = player.Weapons.ToList();
        var activeTraits = player.GetActiveTraits(_configs).ToList();

        foreach (var statName in _configs.AllStats)
        {
            float baseStat = player.Stats.GetFinalStat(statName);
            float flatBonus = 0f;
            float percentBonus = 0f;

            StatContributionHelper.AddGearContributions(ownedItemsSnapshot, weaponsSnapshot, statName, _configs, ref flatBonus, ref percentBonus);

            foreach (var item in ownedItemsSnapshot)
            {
                if (_configs.Items.TryGetValue(item.ConfigId, out var itemConfig))
                    flatBonus += EvaluateDynamicModifiers(itemConfig.DynamicModifiers, statName, player, item.Level, state);
            }


            // Status Effects (players scale by StackCount - see useStackCount note in RecalculateEnemy)
            StatContributionHelper.AddEffectContributions(player.ActiveEffects, statName, _configs, ref flatBonus, ref percentBonus, useStackCount: true);

            // Character Config (player-only: base character passives)
            if (_configs.Characters.TryGetValue(player.ConfigId, out var charConfig))
            {
                if (charConfig.StatMultipliers != null && charConfig.StatMultipliers.TryGetValue(statName, out float cMult)) percentBonus += cMult;
                flatBonus += EvaluateDynamicModifiers(charConfig.DynamicModifiers, statName, player, 1f, state);
            }

            // Traits (player-only)
            foreach (var traitId in activeTraits)
            {
                if (_configs.Traits != null && _configs.Traits.TryGetValue(traitId, out var traitCfg))
                {
                    if (traitCfg.StatBonuses != null && traitCfg.StatBonuses.TryGetValue(statName, out var bonus)) flatBonus += bonus;
                    if (traitCfg.StatMultipliers != null && traitCfg.StatMultipliers.TryGetValue(statName, out var mult)) percentBonus += mult;
                    flatBonus += EvaluateDynamicModifiers(traitCfg.DynamicModifiers, statName, player, 1f, state);
                }
            }

            float finalValue = StatContributionHelper.ComputeFinalValue(baseStat, flatBonus, percentBonus, statName);

            if (!player.CachedStats.TryGetValue(statName, out float oldVal) || oldVal != finalValue)
                player.PendingStatDiff[statName] = finalValue;

            player.CachedStats[statName] = finalValue;
            player.CachedStatMultipliers[statName] = percentBonus;

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
        if (isFirstCalc) InitializeMaxHp(enemy, enemy.Stats.GetFinalStat("maxHp"));

        _configs.Enemies.TryGetValue(enemy.ConfigId, out var enemyConfig);

        foreach (var statName in _configs.AllStats)
        {
            float baseStat = enemy.Stats.GetFinalStat(statName);
            float flatBonus = 0f;
            float percentBonus = 0f;

            StatContributionHelper.AddGearContributions(enemy.OwnedItems, enemy.Weapons, statName, _configs, ref flatBonus, ref percentBonus);

            // BEHAVIOR NOTE: original RecalculateEnemy did NOT multiply StatModifiers by
            // effect.StackCount the way RecalculatePlayer does - stacking a debuff on an enemy N
            // times added the same flat amount as stacking it once. Preserved as-is
            // (useStackCount: false) so this refactor doesn't silently change enemy balance.
            // Change to `true` once you confirm whether that was intentional or a bug.
            StatContributionHelper.AddEffectContributions(enemy.ActiveEffects, statName, _configs, ref flatBonus, ref percentBonus, useStackCount: false);

            // Enemy Config (enemy-only: base enemy passives + dynamic modifiers)
            if (enemyConfig != null)
            {
                if (enemyConfig.StatMultipliers != null && enemyConfig.StatMultipliers.TryGetValue(statName, out float eMult)) percentBonus += eMult;
                flatBonus += EvaluateDynamicModifiers(enemyConfig.DynamicModifiers, statName, enemy, 1f, state);
            }

            float finalValue = StatContributionHelper.ComputeFinalValue(baseStat, flatBonus, percentBonus, statName);

            enemy.CachedStats[statName] = finalValue;
            enemy.CachedStatMultipliers[statName] = percentBonus;
        }

        enemy.CurrentMaxHp = Math.Max(1f, enemy.CachedStats.GetValueOrDefault("maxHp", 10f));
        if (isFirstCalc) enemy.CurrentHp = enemy.CurrentMaxHp;
        enemy.StatsNeedRecalculation = false;
    }

    private static void InitializeMaxHp(BaseActorEntity actor, float baseMaxHp)
    {
        actor.CurrentMaxHp = Math.Max(1f, baseMaxHp);
        actor.CurrentHp = actor.CurrentMaxHp;
    }


    // Generalized to BaseActorEntity so player AND enemy dynamic modifiers run through ONE
    // implementation instead of RecalculateEnemy re-implementing a subset of this switch inline.
    //
    // BEHAVIOR NOTE: the old enemy-only inline switch only handled MissingHealthPercent/PerXStat,
    // didn't clamp CurrentHp before computing MissingHealthPercent, and never multiplied by
    // itemLevel. This version clamps CurrentHp to [0, maxHp] (guards the single-tick window where
    // a lethal hit can leave CurrentHp negative before the death event processes) and enemy call
    // sites pass itemLevel: 1f (a no-op multiplier). It also means EnemyConfig can now legitimately
    // use PerItemOwned/PerEnemyAlive/IsStandingStill modifiers, which previously would have
    // silently done nothing for enemies. Flag me if you want the old enemy behavior byte-for-byte.
    private float EvaluateDynamicModifiers(IEnumerable<DynamicModifier> modifiers, string statName, BaseActorEntity actor, float itemLevel, GameState state)
    {
        float flatBonus = 0f;
        if (modifiers == null) return flatBonus;

        foreach (var mod in modifiers.Where(m => m.TargetStat == statName))
        {
            float safeThreshold = Math.Max(0.01f, mod.ConditionThreshold);

            switch (mod.ConditionType)
            {
                case "MissingHealthPercent":
                    float maxHp = Math.Max(1f, actor.Stats.GetFinalStat("maxHp"));
                    float safeCurrentHp = Math.Clamp(actor.CurrentHp, 0f, maxHp);
                    float missingHpPercent = 1f - (safeCurrentHp / maxHp);
                    int chunksHp = (int)Math.Floor(missingHpPercent / safeThreshold);
                    flatBonus += (mod.Amount * chunksHp * itemLevel);
                    break;

                case "PerXStat":
                    if (!string.IsNullOrEmpty(mod.ConditionStat))
                    {
                        float sourceStatValue = actor.CachedStats.GetValueOrDefault(mod.ConditionStat, 0f);
                        float safeSourceStat = Math.Max(0f, sourceStatValue);
                        int chunksStat = (int)Math.Floor(safeSourceStat / safeThreshold);
                        flatBonus += (mod.Amount * chunksStat * itemLevel);
                    }
                    break;

                case "IsStandingStill":
                    // Player-only concept - enemies have no input to check, so this is a no-op for them.
                    if (actor is PlayerEntity p && p.InputX == 0 && p.InputY == 0) flatBonus += (mod.Amount * itemLevel);
                    break;

                case "PerItemOwned":
                    flatBonus += (actor.OwnedItems.Count * mod.Amount * itemLevel);
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

internal static class StatContributionHelper
{
    public static void AddGearContributions(
        List<EquippedItem> items, List<EquippedWeapon> weapons, string statName, ConfigManager configs,
        ref float flatBonus, ref float percentBonus)
    {
        foreach (var item in items)
        {
            if (item.TotalBaseStats != null && item.TotalBaseStats.TryGetValue(statName, out float iBase)) flatBonus += iBase;
            if (item.RolledStats != null && item.RolledStats.TryGetValue(statName, out float iRoll)) flatBonus += iRoll;

            if (configs.Items.TryGetValue(item.ConfigId, out var itemConfig)
                && itemConfig.StatMultipliers != null
                && itemConfig.StatMultipliers.TryGetValue(statName, out float iMult))
                percentBonus += iMult;
        }

        // meleeDamage/rangedDamage/magicDamage are the weapon's OWN identity stat - excluded
        // from flatBonus here (see GearGenerator.cs comment for the full story).
        bool isWeaponDamageStat = statName == "meleeDamage" || statName == "rangedDamage" || statName == "magicDamage";

        foreach (var weapon in weapons)
        {
            if (!isWeaponDamageStat)
            {
                if (weapon.TotalBaseStats != null && weapon.TotalBaseStats.TryGetValue(statName, out float wBase)) flatBonus += wBase;
                if (weapon.RolledStats != null && weapon.RolledStats.TryGetValue(statName, out var wRoll)) flatBonus += wRoll;
            }

            if (configs.Weapons.TryGetValue(weapon.ConfigId, out var weaponConfig))
            {
                if (weaponConfig.StatBonuses != null && weaponConfig.StatBonuses.TryGetValue(statName, out float wStatBonus)) flatBonus += wStatBonus;
                if (weaponConfig.StatMultipliers != null && weaponConfig.StatMultipliers.TryGetValue(statName, out float wMult)) percentBonus += wMult;
            }
        }
    }

    // useStackCount: true for players, false for enemies - see the note in RecalculateEnemy.
    public static void AddEffectContributions(
        List<ActiveEffect> activeEffects, string statName, ConfigManager configs,
        ref float flatBonus, ref float percentBonus, bool useStackCount)
    {
        foreach (var effect in activeEffects)
        {
            if (!configs.Effects.TryGetValue(effect.ConfigId, out var effectConfig)) continue;

            int stackMultiplier = useStackCount ? effect.StackCount : 1;

            if (effectConfig.StatModifiers != null && effectConfig.StatModifiers.TryGetValue(statName, out float amount))
                flatBonus += amount * stackMultiplier;
            if (effectConfig.StatMultipliers != null && effectConfig.StatMultipliers.TryGetValue(statName, out float mult))
                percentBonus += mult * stackMultiplier;
        }
    }

    // Shared asymmetric final-value formula + the shared clamp for chance-based stats.
    public static float ComputeFinalValue(float baseStat, float flatBonus, float percentBonus, string statName)
    {
        float statValue = baseStat + flatBonus;
        float finalValue = percentBonus >= 0f
            ? statValue * (1f + percentBonus)
            : statValue / (1f + Math.Abs(percentBonus));

        if (statName == "critChance" || statName == "projectileBlockChance" || statName == "dodge")
            finalValue = Math.Clamp(finalValue, 0f, 1f);

        return finalValue;
    }
}
