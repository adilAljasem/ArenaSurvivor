using Server.Configs;
using Server.Entities;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Server.Core.Systems;

public static class WeaponGenerator
{
    public static EquippedWeapon GenerateWeapon(string configId, PlayerEntity player, ConfigManager configs, int startingLevel = 1)
    {
        var weaponConfig = configs.Weapons[configId];

        // >>> FIX 1: Removed `Level = startingLevel` <<<
        var newWeapon = new EquippedWeapon { ConfigId = configId, Level = startingLevel };
        // >>> FIX 2: Add the JSON ID to the ancestry array! <<<
        // If startingLevel is 1, it adds "pistol" once. 
        // If you ever force-spawn a Level 2 weapon, it adds "pistol" twice!
        for (int i = 0; i < startingLevel; i++)
        {
            newWeapon.MergedConfigIds.Add(configId);
        }

        // 1. Calculate Luck Multiplier (e.g., 20 Luck = +20% chance to succeed)
        float luckMult = 1f + Math.Max(0, player.GetTotalStat("luck", configs) / 100f);

        // 2. Roll Random Stats
        if (weaponConfig.AllowedRandomStats != null && weaponConfig.AllowedRandomStats.Count > 0
            && Random.Shared.NextDouble() < (weaponConfig.StatRollChance * luckMult))
        {
            int statsToRoll = Random.Shared.Next(1, weaponConfig.MaxRandomStats + 1);
            for (int i = 0; i < statsToRoll; i++)
            {
                string statToRoll = weaponConfig.AllowedRandomStats[Random.Shared.Next(weaponConfig.AllowedRandomStats.Count)];

                // Roll a random value between 5 and 15 (Adjust this formula as needed!)
                float rollAmount = (float)Math.Round(Random.Shared.NextDouble() * 10f + 5f, 1);

                if (newWeapon.RolledStats.ContainsKey(statToRoll)) newWeapon.RolledStats[statToRoll] += rollAmount;
                else newWeapon.RolledStats[statToRoll] = rollAmount;
            }
        }

        // 3. Roll Random Skills
        var finalSkills = weaponConfig.GrantedSkills != null ? new List<string>(weaponConfig.GrantedSkills) : new List<string>();

        if (weaponConfig.AllowedRandomSkills != null && weaponConfig.AllowedRandomSkills.Count > 0
            && Random.Shared.NextDouble() < (weaponConfig.SkillRollChance * luckMult))
        {
            int skillsToRoll = Random.Shared.Next(1, weaponConfig.MaxRandomSkills + 1);
            for (int i = 0; i < skillsToRoll; i++)
            {
                string skillToRoll = weaponConfig.AllowedRandomSkills[Random.Shared.Next(weaponConfig.AllowedRandomSkills.Count)];
                if (!finalSkills.Contains(skillToRoll)) finalSkills.Add(skillToRoll);
            }
        }

        // 4. Initialize the Cooldown Trackers for these skills
        foreach (var skillId in finalSkills)
        {
            if (configs.Skills.TryGetValue(skillId, out var skillCfg))
            {
                newWeapon.WeaponSkills.Add(new ActiveSkill { ConfigId = skillId, CurrentCooldown = skillCfg.CooldownSeconds });
            }
        }
        return newWeapon;
    }

    public static EquippedWeapon MergeWeapons(EquippedWeapon w1, EquippedWeapon w2, ConfigManager configs)
    {
        // >>> NEW: Find out which weapon is the higher Tier <<<
        configs.Weapons.TryGetValue(w1.ConfigId, out var cfg1);
        configs.Weapons.TryGetValue(w2.ConfigId, out var cfg2);

        int tier1 = cfg1?.Tier ?? 1;
        int tier2 = cfg2?.Tier ?? 1;

        // The final weapon keeps the ConfigId of the strongest one!
        string bestConfigId = tier2 > tier1 ? w2.ConfigId : w1.ConfigId;

        // Combine them!
        var newW = new EquippedWeapon
        {
            ConfigId = bestConfigId,
            SlotIndex = w1.SlotIndex,
            // >>> FIX: Add the Levels together so the UI knows it upgraded! <<<
            Level = w1.Level + w2.Level
        };

        // ====================================================================
        // >>> FIX 2: COMBINE THEIR ANCESTRY (MERGED CONFIG IDS) <<<
        // This takes all the base items used to make weapon 1, and adds 
        // all the base items used to make weapon 2 into one big list!
        // ====================================================================
        if (w1.MergedConfigIds != null) newW.MergedConfigIds.AddRange(w1.MergedConfigIds);
        if (w2.MergedConfigIds != null) newW.MergedConfigIds.AddRange(w2.MergedConfigIds);

        // Combine both sets of random stats!
        foreach (var kv in w1.RolledStats) newW.RolledStats[kv.Key] = kv.Value;
        foreach (var kv in w2.RolledStats)
        {
            if (newW.RolledStats.ContainsKey(kv.Key)) newW.RolledStats[kv.Key] += kv.Value;
            else newW.RolledStats[kv.Key] = kv.Value;
        }

        // Combine Skills
        var allSkills = w1.WeaponSkills.Select(s => s.ConfigId).Union(w2.WeaponSkills.Select(s => s.ConfigId)).ToList();
        foreach (var skillId in allSkills)
        {
            if (configs.Skills.TryGetValue(skillId, out var skillCfg))
            {
                newW.WeaponSkills.Add(new ActiveSkill { ConfigId = skillId, CurrentCooldown = skillCfg.CooldownSeconds });
            }
        }
        CalculateTotalBaseStats(newW, configs);


        return newW;
    }

    // Helper to calculate the final base stats based on Ancestry!
    public static void CalculateTotalBaseStats(EquippedWeapon weapon, ConfigManager configs)
    {
        weapon.TotalBaseStats.Clear();
        foreach (var id in weapon.MergedConfigIds)
        {
            if (configs.Weapons.TryGetValue(id, out var cfg))
            {
                if (cfg.MeleeDamage > 0) AddToStat(weapon.TotalBaseStats, "meleeDamage", cfg.MeleeDamage);
                if (cfg.RangedDamage > 0) AddToStat(weapon.TotalBaseStats, "rangedDamage", cfg.RangedDamage);
                if (cfg.ElementalDamage > 0) AddToStat(weapon.TotalBaseStats, "elementalDamage", cfg.ElementalDamage);

                // If you have other base stats in your JSON, they get added perfectly here!
                if (cfg.StatBonuses != null)
                {
                    foreach (var kv in cfg.StatBonuses) AddToStat(weapon.TotalBaseStats, kv.Key, kv.Value);
                }
            }
        }
    }

    private static void AddToStat(Dictionary<string, float> dict, string key, float amount)
    {
        if (dict.ContainsKey(key)) dict[key] += amount;
        else dict[key] = amount;
    }
}