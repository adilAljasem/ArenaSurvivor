using Server.Configs;
using Server.Core;
using Server.Core.Systems;
using System;
using System.Linq;

namespace Server.Entities;

public class EnemyEntity : BaseActorEntity
{
    private static int _enemyIdCounter = 0;
    public string Id { get; set; } = Interlocked.Increment(ref _enemyIdCounter).ToString();
    public string ConfigId { get; set; } = string.Empty;
    public float HitRadius { get; set; }

    // Networked state and internal timer for animations
    public float DespawnTimer { get; set; } = 1.0f;
    public float AttackCooldown { get; set; } = 0f;

    // Aim direction (toward current target) – sent to client for weapon rotation
    public float AimX { get; set; }
    public float AimY { get; set; }

    // Tracks which weapon slots fired this tick (cleared at end of network tick)
    public List<int> FiredWeaponsThisTick { get; set; } = new();

    // Initializes the enemy with the Master Stat List so it never crashes
    public void Initialize(Configs.EnemyConfig config, float spawnX, float spawnY, ConfigManager configManager)
    {
        Team = "Enemy";
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

        if (config.StartingSkills != null)
        {
            foreach (var skillId in config.StartingSkills)
            {
                Skills.Add(new ActiveSkill { ConfigId = skillId, IsCasting = false, CurrentCooldown = 0f });
            }
        }

        // 3. Equip starting weapons from config (with optional per-slot tier override)
        if (config.StartingWeapons != null)
        {
            for (int i = 0; i < config.StartingWeapons.Count; i++)
            {
                var weaponId = config.StartingWeapons[i];
                if (configManager.Weapons.ContainsKey(weaponId))
                {
                    int tier = (config.StartingWeaponTiers != null && i < config.StartingWeaponTiers.Count)
                        ? config.StartingWeaponTiers[i] : 1;
                    var weapon = WeaponGenerator.GenerateWeapon(weaponId, 0f, configManager, tier);
                    weapon.SlotIndex = Weapons.Count;
                    Weapons.Add(weapon);
                }
            }
        }

        // 4. Equip starting items from config (with optional per-slot tier override)
        if (config.StartingItems != null)
        {
            for (int i = 0; i < config.StartingItems.Count; i++)
            {
                var itemId = config.StartingItems[i];
                if (configManager.Items.ContainsKey(itemId))
                {
                    int tier = (config.StartingItemTiers != null && i < config.StartingItemTiers.Count)
                        ? config.StartingItemTiers[i] : 1;
                    var item = ItemGenerator.GenerateItem(itemId, 0f, configManager, tier);
                    item.SlotIndex = OwnedItems.Count;
                    OwnedItems.Add(item);
                }
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

        // Active Effects (Buffs & Debuffs)
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

        // Weapon and item stat bonuses (mirrors player logic)
        foreach (var weapon in Weapons)
        {
            if (weapon.TotalBaseStats != null && weapon.TotalBaseStats.TryGetValue(statName, out float wBase))
                dynamicFlat += wBase;
            if (weapon.RolledStats != null && weapon.RolledStats.TryGetValue(statName, out float wRoll))
                dynamicFlat += wRoll;
        }

        foreach (var item in OwnedItems)
        {
            if (item.TotalBaseStats != null && item.TotalBaseStats.TryGetValue(statName, out float iBase))
                dynamicFlat += iBase;
            if (item.RolledStats != null && item.RolledStats.TryGetValue(statName, out float iRoll))
                dynamicFlat += iRoll;
        }

        return baseStat + dynamicFlat;
    }
}