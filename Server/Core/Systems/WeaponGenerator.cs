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
        var newWeapon = new EquippedWeapon { ConfigId = configId, Level = startingLevel };

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
        // Bump the Level (Tier) up by 1!
        var newW = new EquippedWeapon { ConfigId = w1.ConfigId, SlotIndex = w1.SlotIndex, Level = w1.Level + 1 };
        
        // Combine both sets of random stats!
        foreach (var kv in w1.RolledStats) newW.RolledStats[kv.Key] = kv.Value;
        foreach (var kv in w2.RolledStats)
        {
            if (newW.RolledStats.ContainsKey(kv.Key)) newW.RolledStats[kv.Key] += kv.Value;
            else newW.RolledStats[kv.Key] = kv.Value;
        }

        // Combine Skills (Union ensures no duplicate IDs break the system)
        var allSkills = w1.WeaponSkills.Select(s => s.ConfigId).Union(w2.WeaponSkills.Select(s => s.ConfigId)).ToList();

        foreach (var skillId in allSkills)
        {
            if (configs.Skills.TryGetValue(skillId, out var skillCfg))
            {
                newW.WeaponSkills.Add(new ActiveSkill { ConfigId = skillId, CurrentCooldown = skillCfg.CooldownSeconds });
            }
        }

        return newW;
    }
}