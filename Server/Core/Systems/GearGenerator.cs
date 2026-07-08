using Server.Configs;
using Server.Entities;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Server.Core.Systems;

// =====================================================================================
// DRY HELPER: SHARED GEAR LOGIC
// =====================================================================================
internal static class GearGeneratorHelper
{
    public static void RollRandomStatsAndSkills(Dictionary<string, float> rolledStats, List<ActiveSkill> targetSkills, BaseGearConfig cfg, float luck, ConfigManager configs, List<string> baseGrantedSkills = null)
    {
        float luckMult = 1f + Math.Max(0, luck / 100f);

        // 1. Roll Random Stats
        if (cfg.AllowedRandomStats != null && cfg.AllowedRandomStats.Count > 0 && Random.Shared.NextDouble() < (cfg.StatRollChance * luckMult))
        {
            int statsToRoll = Random.Shared.Next(1, cfg.MaxRandomStats + 1);
            var availableStats = cfg.AllowedRandomStats.Keys.ToList();

            for (int i = 0; i < statsToRoll; i++)
            {
                string statToRoll = availableStats[Random.Shared.Next(availableStats.Count)];
                var bounds = cfg.AllowedRandomStats[statToRoll];
                float rollAmount = bounds.Min + (float)(Random.Shared.NextDouble() * (bounds.Max - bounds.Min));

                AddToStat(rolledStats, statToRoll, (float)Math.Round(rollAmount, 2));
            }
        }

        // 2. Roll Random Skills
        var finalSkills = baseGrantedSkills != null ? new List<string>(baseGrantedSkills) : new List<string>();

        if (cfg.AllowedRandomSkills != null && cfg.AllowedRandomSkills.Count > 0 && Random.Shared.NextDouble() < (cfg.SkillRollChance * luckMult))
        {
            int skillsToRoll = Random.Shared.Next(1, cfg.MaxRandomSkills + 1);
            for (int i = 0; i < skillsToRoll; i++)
            {
                string skillToRoll = cfg.AllowedRandomSkills[Random.Shared.Next(cfg.AllowedRandomSkills.Count)];
                if (!finalSkills.Contains(skillToRoll)) finalSkills.Add(skillToRoll);
            }
        }

        // 3. Initialize Cooldowns
        foreach (var skillId in finalSkills)
        {
            if (configs.Skills.TryGetValue(skillId, out var skillCfg))
                targetSkills.Add(new ActiveSkill { ConfigId = skillId, CurrentCooldown = skillCfg.CooldownSeconds });
        }
    }

    public static void MergeGearData(
        List<string> outAncestry, Dictionary<string, float> outStats, List<ActiveSkill> outSkills,
        List<string> anc1, Dictionary<string, float> stats1, List<ActiveSkill> skills1,
        List<string> anc2, Dictionary<string, float> stats2, List<ActiveSkill> skills2,
        ConfigManager configs)
    {
        // Merge Ancestry (for calculating final base stats)
        if (anc1 != null) outAncestry.AddRange(anc1);
        if (anc2 != null) outAncestry.AddRange(anc2);

        // Merge Rolled Stats
        foreach (var kv in stats1) AddToStat(outStats, kv.Key, kv.Value);
        foreach (var kv in stats2) AddToStat(outStats, kv.Key, kv.Value);

        // Merge Skills
        var allSkills = skills1.Select(s => s.ConfigId).Concat(skills2.Select(s => s.ConfigId)).ToList();
        foreach (var skillId in allSkills)
        {
            if (configs.Skills.TryGetValue(skillId, out var skillCfg))
                outSkills.Add(new ActiveSkill { ConfigId = skillId, CurrentCooldown = skillCfg.CooldownSeconds });
        }
    }

    public static void AddToStat(Dictionary<string, float> dict, string key, float amount)
    {
        if (dict.ContainsKey(key)) dict[key] += amount;
        else dict[key] = amount;
    }

    public static void UpgradeScalingSkills(List<ActiveSkill> skills, int newLevel, ConfigManager configs)
    {
        // 1. FIRST, upgrade all scaling skills to the new gear level
        foreach (var skill in skills)
        {
            if (configs.Skills.TryGetValue(skill.ConfigId, out var sCfg) && sCfg.ScalesWithGearLevel)
            {
                // Find the skill in the same family that matches the new gear level
                var upgradedSkill = configs.Skills.Values.FirstOrDefault(s => s.SkillFamily == sCfg.SkillFamily && s.Tier == newLevel);
                if (upgradedSkill != null && upgradedSkill.Id != skill.ConfigId)
                {
                    skill.ConfigId = upgradedSkill.Id;
                    skill.CurrentCooldown = upgradedSkill.CooldownSeconds;
                }
            }
        }

        // 2. THEN remove duplicates! 
        // (If a T1 and T2 merged into this gear, they both just got upgraded to identical T3 skills.
        // Removing duplicates NOW leaves exactly one T3 skill.)
        var distinctSkills = skills.GroupBy(s => s.ConfigId).Select(g => g.First()).ToList();
        skills.Clear();
        skills.AddRange(distinctSkills);
    }

}

// =====================================================================================
// WEAPON GENERATOR
// =====================================================================================
public static class WeaponGenerator
{
    public static EquippedWeapon GenerateWeapon(string configId, PlayerEntity player, ConfigManager configs, int startingLevel = 1)
        => GenerateWeapon(configId, player.GetTotalStat("luck", configs), configs, startingLevel);

    public static EquippedWeapon GenerateWeapon(string configId, float luck, ConfigManager configs, int startingLevel = 1)
    {
        var cfg = configs.Weapons[configId];
        var newWeapon = new EquippedWeapon { ConfigId = configId, Level = startingLevel };
        for (int i = 0; i < startingLevel; i++) newWeapon.MergedConfigIds.Add(configId);

        GearGeneratorHelper.RollRandomStatsAndSkills(newWeapon.RolledStats, newWeapon.WeaponSkills, cfg, luck, configs, cfg.GrantedSkills);
        CalculateTotalBaseStats(newWeapon, configs);
        return newWeapon;
    }

    public static EquippedWeapon MergeWeapons(EquippedWeapon w1, EquippedWeapon w2, ConfigManager configs)
    {
        configs.Weapons.TryGetValue(w1.ConfigId, out var cfg1);
        configs.Weapons.TryGetValue(w2.ConfigId, out var cfg2);

        string bestConfigId = (cfg2?.Tier ?? 1) > (cfg1?.Tier ?? 1) ? w2.ConfigId : w1.ConfigId;

        var newW = new EquippedWeapon { ConfigId = bestConfigId, SlotIndex = w1.SlotIndex, Level = Math.Max(w1.Level, w2.Level) + 1 };
        GearGeneratorHelper.MergeGearData(newW.MergedConfigIds, newW.RolledStats, newW.WeaponSkills,
                    w1.MergedConfigIds, w1.RolledStats, w1.WeaponSkills,
                    w2.MergedConfigIds, w2.RolledStats, w2.WeaponSkills, configs);

        GearGeneratorHelper.UpgradeScalingSkills(newW.WeaponSkills, newW.Level, configs);
        CalculateTotalBaseStats(newW, configs);
        return newW;
    }

    public static void CalculateTotalBaseStats(EquippedWeapon weapon, ConfigManager configs)
    {
        weapon.TotalBaseStats.Clear();
        foreach (var id in weapon.MergedConfigIds)
        {
            if (configs.Weapons.TryGetValue(id, out var cfg))
            {
                if (cfg.MeleeDamage > 0) GearGeneratorHelper.AddToStat(weapon.TotalBaseStats, "meleeDamage", cfg.MeleeDamage);
                if (cfg.RangedDamage > 0) GearGeneratorHelper.AddToStat(weapon.TotalBaseStats, "rangedDamage", cfg.RangedDamage);

                // >>> FIX CS1061: Use MagicDamage! <<<
                if (cfg.MagicDamage > 0) GearGeneratorHelper.AddToStat(weapon.TotalBaseStats, "magicDamage", cfg.MagicDamage);

                // >>> REMOVED: cfg.StatBonuses used to be folded in here too, which meant a
                // weapon's own core damage (e.g. rangedDamage: 50) and its statBonuses (e.g.
                // rangedDamage: 200) got summed into ONE TotalBaseStats value (250) via
                // AddToStat's +=. That's wrong: TotalBaseStats is read directly by
                // CombatSystem as "this weapon's own damage" and should stay scoped to the
                // weapon. StatBonuses are read separately, straight from the weapon's config,
                // in StatSystem.cs - that's what makes them apply to the player's own stats
                // instead of inflating the weapon's damage number.
            }
        }
    }
}

// =====================================================================================
// ITEM GENERATOR
// =====================================================================================
public static class ItemGenerator
{
    public static EquippedItem GenerateItem(string configId, PlayerEntity player, ConfigManager configs, int startingLevel = 1)
        => GenerateItem(configId, player.GetTotalStat("luck", configs), configs, startingLevel);

    public static EquippedItem GenerateItem(string configId, float luck, ConfigManager configs, int startingLevel = 1)
    {
        var cfg = configs.Items[configId];
        var newItem = new EquippedItem { ConfigId = configId, Level = startingLevel };
        for (int i = 0; i < startingLevel; i++) newItem.MergedConfigIds.Add(configId);

        GearGeneratorHelper.RollRandomStatsAndSkills(newItem.RolledStats, newItem.ItemSkills, cfg, luck, configs, cfg.GrantedSkills);
        CalculateTotalBaseStats(newItem, configs);
        return newItem;
    }

    public static EquippedItem MergeItems(EquippedItem i1, EquippedItem i2, ConfigManager configs)
    {
        configs.Items.TryGetValue(i1.ConfigId, out var cfg1);
        configs.Items.TryGetValue(i2.ConfigId, out var cfg2);

        string bestConfigId = (cfg2?.Tier ?? 1) > (cfg1?.Tier ?? 1) ? i2.ConfigId : i1.ConfigId;

        var newI = new EquippedItem { ConfigId = bestConfigId, SlotIndex = i1.SlotIndex, Level = Math.Max(i1.Level, i2.Level) + 1 };

        GearGeneratorHelper.MergeGearData(newI.MergedConfigIds, newI.RolledStats, newI.ItemSkills,
                    i1.MergedConfigIds, i1.RolledStats, i1.ItemSkills,
                    i2.MergedConfigIds, i2.RolledStats, i2.ItemSkills, configs);

        GearGeneratorHelper.UpgradeScalingSkills(newI.ItemSkills, newI.Level, configs);
        CalculateTotalBaseStats(newI, configs);
        return newI;
    }

    public static void CalculateTotalBaseStats(EquippedItem item, ConfigManager configs)
    {
        item.TotalBaseStats.Clear();
        foreach (var id in item.MergedConfigIds)
        {
            if (configs.Items.TryGetValue(id, out var cfg))
            {
                if (cfg.StatBonuses != null)
                    foreach (var kv in cfg.StatBonuses) GearGeneratorHelper.AddToStat(item.TotalBaseStats, kv.Key, kv.Value);
            }
        }
    }
}