using Server.Configs;
using Server.Core;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Server.Entities;

public class PlayerEntity
{
    public string ConnectionId { get; set; } = string.Empty;
    public float X { get; set; }
    public float Y { get; set; }

    public int Level { get; set; } = 1;
    public float CurrentXp { get; set; }
    public int PendingLevelUps { get; set; }
    public List<Configs.LevelUpCardConfig> CurrentLevelUpChoices { get; set; } = new();
    // The formula for how much XP you need to reach the next level
    public float GetXpRequirement() => 5 + (Level * 3);

    // Physics & Inputs
    public float InputX { get; set; }
    public float InputY { get; set; }
    public float AimX { get; set; }
    public float AimY { get; set; }

    // Active Resource Pool (Changes when you take damage or heal)
    public float CurrentHp { get; set; }

    // Economy & Shop
    public int Gold { get; set; }
    public int CurrentRerollCost { get; set; } = 2;
    public List<DTOs.ShopItemDto> CurrentShop { get; set; } = new();

    // The Unified Data-Driven Dictionary
    public StatDictionary Stats { get; set; } = new();

    // Inventory
    public List<EquippedWeapon> Weapons { get; set; } = new();
    public Dictionary<string, int> OwnedItems { get; set; } = new();

    // Mechanics
    public List<string> Traits { get; set; } = new();
    public bool DuplicateNextPurchase { get; set; }

    // Initializes the player with the Master Stat List so it never crashes
    public void Initialize(Configs.CharacterConfig config, ConfigManager configManager)
    {
        // 1. Initialize EVERY stat dynamically from the JSON file!
        foreach (var stat in configManager.AllStats)
        {
            Stats.InitializeStat(stat, 0f);
        }

        // 2. Overwrite with Character's base stats from JSON
        if (config.BaseStats != null)
        {
            foreach (var stat in config.BaseStats)
            {
                Stats.InitializeStat(stat.Key, stat.Value);
            }
        }

        if (config.Traits != null)
        {
            foreach (var trait in config.Traits) Traits.Add(trait);
        }

        // Set starting health to whatever the dictionary calculated for maxHp
        CurrentHp = Stats.GetFinalStat("maxHp");
    }

    // Calculates dynamic stats, passive item buffs, and weapon buffs on the fly
    public float GetTotalStat(string statName, ConfigManager configManager)
    {
        float baseStat = Stats.GetFinalStat(statName);
        float dynamicFlat = 0f; // All stats are added flatly to their buckets now!

        // --- 1. ITEMS ---
        foreach (var kvp in OwnedItems)
        {
            if (configManager.Items.TryGetValue(kvp.Key, out var itemConfig))
            {
                if (itemConfig.StatBonuses != null && itemConfig.StatBonuses.TryGetValue(statName, out float bonus))
                    dynamicFlat += (bonus * kvp.Value);

                if (itemConfig.DynamicModifiers != null)
                {
                    foreach (var mod in itemConfig.DynamicModifiers.Where(m => m.TargetStat == statName))
                    {
                        if (mod.ConditionType == "MissingHealthPercent")
                        {
                            float maxHp = Stats.GetFinalStat("maxHp");
                            float missingHpPercent = 1f - (CurrentHp / Math.Max(1f, maxHp));
                            int chunks = (int)Math.Floor(missingHpPercent / Math.Max(0.01f, mod.ConditionThreshold));
                            dynamicFlat += (mod.Amount * chunks * kvp.Value); // Unifed!
                        }
                        else if (mod.ConditionType == "PerXStat" && !string.IsNullOrEmpty(mod.ConditionStat))
                        {
                            float sourceStatValue = GetTotalStat(mod.ConditionStat, configManager);
                            int chunks = (int)Math.Floor(sourceStatValue / Math.Max(0.01f, mod.ConditionThreshold));
                            dynamicFlat += (mod.Amount * chunks * kvp.Value); // Unified!
                        }
                    }
                }
            }
        }

        // --- 2. WEAPONS ---
        foreach (var weapon in Weapons)
        {
            if (configManager.Weapons.TryGetValue(weapon.ConfigId, out var weaponConfig))
            {
                if (weaponConfig.StatBonuses != null && weaponConfig.StatBonuses.TryGetValue(statName, out float wBonus))
                    dynamicFlat += (wBonus * weapon.Level);
            }
        }

        return baseStat + dynamicFlat;
    }

    // The function that grants XP and checks for level ups!
    public void GainXp(float amount, Configs.ConfigManager configManager)
    {
        float xpBonus = GetTotalStat("xpGainPercent", configManager);
        CurrentXp += amount * (1f + xpBonus);

        while (CurrentXp >= GetXpRequirement())
        {
            CurrentXp -= GetXpRequirement();
            Level++;
            PendingLevelUps++; // Stores the level up for the shop phase!
        }
    }
}