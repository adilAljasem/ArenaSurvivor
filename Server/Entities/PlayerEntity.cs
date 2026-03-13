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
        float dynamicFlat = 0f;
        float dynamicPercent = 0f;

        // --- 1. ITEMS ---
        foreach (var kvp in OwnedItems)
        {
            if (configManager.Items.TryGetValue(kvp.Key, out var itemConfig))
            {
                // Passive flat stats (e.g., +5 MaxHp)
                if (itemConfig.StatBonuses != null && itemConfig.StatBonuses.TryGetValue(statName, out float bonus))
                {
                    dynamicFlat += (bonus * kvp.Value);
                }

                // Dynamic Conditions (e.g., +Damage per Missing Health or Armor)
                if (itemConfig.DynamicModifiers != null)
                {
                    foreach (var mod in itemConfig.DynamicModifiers.Where(m => m.TargetStat == statName))
                    {
                        if (mod.ConditionType == "MissingHealthPercent")
                        {
                            float maxHp = Stats.GetFinalStat("maxHp");
                            float missingHpPercent = 1f - (CurrentHp / Math.Max(1f, maxHp));
                            int chunks = (int)Math.Floor(missingHpPercent / Math.Max(0.01f, mod.ConditionThreshold));
                            dynamicFlat += (mod.BonusFlat * chunks * kvp.Value);
                            dynamicPercent += (mod.BonusPercent * chunks * kvp.Value);
                        }
                        else if (mod.ConditionType == "PerXStat" && !string.IsNullOrEmpty(mod.ConditionStat))
                        {
                            // Recursively calculate the condition stat (e.g., finding current Armor)
                            float sourceStatValue = GetTotalStat(mod.ConditionStat, configManager);
                            int chunks = (int)Math.Floor(sourceStatValue / Math.Max(0.01f, mod.ConditionThreshold));
                            dynamicFlat += (mod.BonusFlat * chunks * kvp.Value);
                            dynamicPercent += (mod.BonusPercent * chunks * kvp.Value);
                        }
                    }
                }
            }
        }

        // --- 2. WEAPONS ---
        // Passive bonuses granted just by holding the weapon
        foreach (var weapon in Weapons)
        {
            if (configManager.Weapons.TryGetValue(weapon.ConfigId, out var weaponConfig))
            {
                if (weaponConfig.StatBonuses != null && weaponConfig.StatBonuses.TryGetValue(statName, out float wBonus))
                {
                    dynamicFlat += (wBonus * weapon.Level);
                }
            }
        }

        return (baseStat + dynamicFlat) * (1f + dynamicPercent);
    }
}