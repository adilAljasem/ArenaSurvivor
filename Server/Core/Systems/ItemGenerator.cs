using Server.Configs;
using Server.Entities;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Server.Core.Systems;

public static class ItemGenerator
{
    public static EquippedItem GenerateItem(string configId, PlayerEntity player, ConfigManager configs, int startingLevel = 1)
        => GenerateItem(configId, player.GetTotalStat("luck", configs), configs, startingLevel);

    /// <summary>Generates an item using an explicit luck value — used when no PlayerEntity is available (e.g. enemy equipping).</summary>
    public static EquippedItem GenerateItem(string configId, float luck, ConfigManager configs, int startingLevel = 1)
    {
        var itemConfig = configs.Items[configId];
        var newItem = new EquippedItem { ConfigId = configId, Level = startingLevel };

        for (int i = 0; i < startingLevel; i++) newItem.MergedConfigIds.Add(configId);

        float luckMult = 1f + Math.Max(0, luck / 100f);

        // Roll Random Stats
        if (itemConfig.AllowedRandomStats != null && itemConfig.AllowedRandomStats.Count > 0
            && Random.Shared.NextDouble() < (itemConfig.StatRollChance * luckMult))
        {
            int statsToRoll = Random.Shared.Next(1, itemConfig.MaxRandomStats + 1);
            for (int i = 0; i < statsToRoll; i++)
            {
                string statToRoll = itemConfig.AllowedRandomStats[Random.Shared.Next(itemConfig.AllowedRandomStats.Count)];
                float rollAmount = (float)Math.Round(Random.Shared.NextDouble() * 10f + 5f, 1);

                if (newItem.RolledStats.ContainsKey(statToRoll)) newItem.RolledStats[statToRoll] += rollAmount;
                else newItem.RolledStats[statToRoll] = rollAmount;
            }
        }

        // Roll Random Skills
        var finalSkills = new List<string>();
        if (itemConfig.AllowedRandomSkills != null && itemConfig.AllowedRandomSkills.Count > 0
            && Random.Shared.NextDouble() < (itemConfig.SkillRollChance * luckMult))
        {
            int skillsToRoll = Random.Shared.Next(1, itemConfig.MaxRandomSkills + 1);
            for (int i = 0; i < skillsToRoll; i++)
            {
                string skillToRoll = itemConfig.AllowedRandomSkills[Random.Shared.Next(itemConfig.AllowedRandomSkills.Count)];
                if (!finalSkills.Contains(skillToRoll)) finalSkills.Add(skillToRoll);
            }
        }

        foreach (var skillId in finalSkills)
        {
            if (configs.Skills.TryGetValue(skillId, out var skillCfg))
                newItem.ItemSkills.Add(new ActiveSkill { ConfigId = skillId, CurrentCooldown = skillCfg.CooldownSeconds });
        }

        CalculateTotalBaseStats(newItem, configs);
        return newItem;
    }

    public static EquippedItem MergeItems(EquippedItem i1, EquippedItem i2, ConfigManager configs)
    {
        configs.Items.TryGetValue(i1.ConfigId, out var cfg1);
        configs.Items.TryGetValue(i2.ConfigId, out var cfg2);

        int tier1 = cfg1?.Tier ?? 1;
        int tier2 = cfg2?.Tier ?? 1;

        string bestConfigId = tier2 > tier1 ? i2.ConfigId : i1.ConfigId;

        var newI = new EquippedItem
        {
            ConfigId = bestConfigId,
            SlotIndex = i1.SlotIndex,
            Level = i1.Level + i2.Level
        };

        if (i1.MergedConfigIds != null) newI.MergedConfigIds.AddRange(i1.MergedConfigIds);
        if (i2.MergedConfigIds != null) newI.MergedConfigIds.AddRange(i2.MergedConfigIds);

        foreach (var kv in i1.RolledStats) newI.RolledStats[kv.Key] = kv.Value;
        foreach (var kv in i2.RolledStats)
        {
            if (newI.RolledStats.ContainsKey(kv.Key)) newI.RolledStats[kv.Key] += kv.Value;
            else newI.RolledStats[kv.Key] = kv.Value;
        }

        var allSkills = i1.ItemSkills.Select(s => s.ConfigId).Union(i2.ItemSkills.Select(s => s.ConfigId)).ToList();
        foreach (var skillId in allSkills)
        {
            if (configs.Skills.TryGetValue(skillId, out var skillCfg))
                newI.ItemSkills.Add(new ActiveSkill { ConfigId = skillId, CurrentCooldown = skillCfg.CooldownSeconds });
        }

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
                {
                    foreach (var kv in cfg.StatBonuses)
                    {
                        if (item.TotalBaseStats.ContainsKey(kv.Key)) item.TotalBaseStats[kv.Key] += kv.Value;
                        else item.TotalBaseStats[kv.Key] = kv.Value;
                    }
                }
            }
        }
    }
}