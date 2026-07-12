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
    // Shared "generate a fresh piece of gear" orchestration - identical between weapons and items
    // except which config dictionary is read and how CalculateTotalBaseStats is computed (passed
    // in as a delegate since that part is genuinely type-specific).
    public static TGear GenerateGear<TGear, TConfig>(
        string configId, float luck, ConfigManager configs, int startingLevel,
        TConfig cfg, Action<TGear, ConfigManager> calculateTotalBaseStats)
        where TGear : BaseEquippedGear, new()
        where TConfig : BaseGearConfig
    {
        var newGear = new TGear { ConfigId = configId, Level = startingLevel };
        for (int i = 0; i < startingLevel; i++) newGear.MergedConfigIds.Add(configId);

        RollRandomStatsAndSkills(newGear.RolledStats, newGear.GearSkills, cfg, luck, configs, cfg.GrantedSkills);
        calculateTotalBaseStats(newGear, configs);
        return newGear;
    }

    // Shared "merge two pieces of gear into a leveled-up one" orchestration - same relationship
    // to MergeWeapons/MergeItems as GenerateGear has to GenerateWeapon/GenerateItem above.
    public static TGear MergeGear<TGear, TConfig>(
        TGear g1, TGear g2, ConfigManager configs,
        IReadOnlyDictionary<string, TConfig> configLookup, Action<TGear, ConfigManager> calculateTotalBaseStats)
        where TGear : BaseEquippedGear, new()
        where TConfig : BaseGearConfig
    {
        configLookup.TryGetValue(g1.ConfigId, out var cfg1);
        configLookup.TryGetValue(g2.ConfigId, out var cfg2);

        string bestConfigId = (cfg2?.Tier ?? 1) > (cfg1?.Tier ?? 1) ? g2.ConfigId : g1.ConfigId;

        var newGear = new TGear { ConfigId = bestConfigId, SlotIndex = g1.SlotIndex, Level = Math.Max(g1.Level, g2.Level) + 1 };

        MergeGearData(newGear.MergedConfigIds, newGear.RolledStats, newGear.GearSkills,
                    g1.MergedConfigIds, g1.RolledStats, g1.GearSkills,
                    g2.MergedConfigIds, g2.RolledStats, g2.GearSkills, configs);

        UpgradeScalingSkills(newGear.GearSkills, newGear.Level, configs);
        calculateTotalBaseStats(newGear, configs);
        return newGear;
    }


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
        => GearGeneratorHelper.GenerateGear<EquippedWeapon, WeaponConfig>(configId, luck, configs, startingLevel, configs.Weapons[configId], CalculateTotalBaseStats);

    public static EquippedWeapon MergeWeapons(EquippedWeapon w1, EquippedWeapon w2, ConfigManager configs)
        => GearGeneratorHelper.MergeGear(w1, w2, configs, configs.Weapons, CalculateTotalBaseStats);

    // CalculateTotalBaseStats(EquippedWeapon, ConfigManager) - stays weapon-specific (reads
    // MeleeDamage/RangedDamage/MagicDamage directly off WeaponConfig).
    //
    // FIX: this used to sum MeleeDamage/RangedDamage/MagicDamage once per entry in
    // MergedConfigIds, meaning the weapon's primary damage grew with every level/merge. That's
    // wrong - the primary stat is fixed to the weapon's identity and should never scale.
    // Leveling instead scales the weapon's StatBonuses (see
    // StatContributionHelper.AddGearContributions in StatSystem.cs, which now sums each merged
    // copy's StatBonuses the same way ItemGenerator.CalculateTotalBaseStats below already does
    // for items). So this only ever reads the weapon's CURRENT config, once.
    public static void CalculateTotalBaseStats(EquippedWeapon weapon, ConfigManager configs)
    {
        weapon.TotalBaseStats.Clear();
        if (configs.Weapons.TryGetValue(weapon.ConfigId, out var cfg))
        {
            if (cfg.MeleeDamage > 0) GearGeneratorHelper.AddToStat(weapon.TotalBaseStats, "meleeDamage", cfg.MeleeDamage);
            if (cfg.RangedDamage > 0) GearGeneratorHelper.AddToStat(weapon.TotalBaseStats, "rangedDamage", cfg.RangedDamage);
            if (cfg.MagicDamage > 0) GearGeneratorHelper.AddToStat(weapon.TotalBaseStats, "magicDamage", cfg.MagicDamage);
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
        => GearGeneratorHelper.GenerateGear<EquippedItem, ItemConfig>(configId, luck, configs, startingLevel, configs.Items[configId], CalculateTotalBaseStats);

    public static EquippedItem MergeItems(EquippedItem i1, EquippedItem i2, ConfigManager configs)
        => GearGeneratorHelper.MergeGear(i1, i2, configs, configs.Items, CalculateTotalBaseStats);

    // CalculateTotalBaseStats(EquippedItem, ConfigManager) - unchanged, stays item-specific
    // (iterates the arbitrary StatBonuses dictionary off ItemConfig).
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