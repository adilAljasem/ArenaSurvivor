using Server.Configs;
using Server.Core;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Server.Entities;

public class PlayerEntity : BaseActorEntity
{
    public string ConnectionId { get; set; } = string.Empty;
    public string ConfigId { get; set; } = "char_well_rounded";

    public int Level { get; set; } = 1;
    public float CurrentXp { get; set; }
    public int PendingLevelUps { get; set; }
    public Dictionary<string, float> PendingStatDiff { get; } = new();
    public List<Configs.LevelUpCardConfig> CurrentLevelUpChoices { get; set; } = new();

    // The formula for how much XP you need to reach the next level
    public float GetXpRequirement() => 5 + (Level * 3);

    // >>> THE FIX: Changing movement flags the entity as Dirty for "IsStandingStill" traits <<<
    private float _inputX;
    public float InputX
    {
        get => _inputX;
        set { if (_inputX != value) { _inputX = value; StatsNeedRecalculation = true; } }
    }

    private float _inputY;
    public float InputY
    {
        get => _inputY;
        set { if (_inputY != value) { _inputY = value; StatsNeedRecalculation = true; } }
    }

    public float AimX { get; set; }
    public float AimY { get; set; }

    public List<int> FiredWeaponsThisTick { get; set; } = new();

    // Economy & Shop
    public int Gold { get; set; } = 5000;
    public int CurrentRerollCost { get; set; } = 2;
    public List<DTOs.ShopItemDto> CurrentShop { get; set; } = new();

    // Mechanics
    public List<string> Traits { get; set; } = new();
    public bool DuplicateNextPurchase { get; set; }

    public List<string> SynergizedTraits { get; private set; } = new();
    public List<ActiveSkill> SynergizedSkills { get; private set; } = new();
    public int CurrentSkillIndex { get; set; } = 0;

    // Initializes the player with the Master Stat List so it never crashes
    public void Initialize(CharacterConfig config, ConfigManager configManager)
    {
        Team = "Player";

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

        if (config.StartingSkills != null)
        {
            foreach (var skillId in config.StartingSkills)
            {
                Skills.Add(new ActiveSkill { ConfigId = skillId, IsCasting = false, CurrentCooldown = 0f });
            }
        }

        // Set starting health to whatever the dictionary calculated for maxHp
        CurrentHp = Stats.GetFinalStat("maxHp");

        // Give Starting Gear
        if (config.StartingWeapons != null)
        {
            foreach (var wId in config.StartingWeapons)
            {
                if (configManager.Weapons.ContainsKey(wId))
                {
                    var newWeapon = Server.Core.Systems.WeaponGenerator.GenerateWeapon(wId, this, configManager, 1);
                    newWeapon.SlotIndex = Weapons.Count;
                    Weapons.Add(newWeapon);
                }
            }
        }

        if (config.StartingItems != null)
        {
            foreach (var itemId in config.StartingItems)
            {
                if (configManager.Items.ContainsKey(itemId))
                {
                    var newItem = Server.Core.Systems.ItemGenerator.GenerateItem(itemId, this, configManager, 1);
                    newItem.SlotIndex = OwnedItems.Count;
                    OwnedItems.Add(newItem);
                }
            }
        }
        RecalculateSynergies(configManager);
    }

    /// <summary>
    /// Run this ONCE whenever the player buys, merges, drops gear, or levels up.
    /// It pools all gear, counts duplicates, and upgrades skills/traits!
    /// </summary>
    public void RecalculateSynergies(ConfigManager configs)
    {
        // --- 1. POOL EVERYTHING ---
        var rawTraits = new List<string>(this.Traits);
        var rawSkills = new List<string>(this.Skills.Select(s => s.ConfigId));

        foreach (var item in OwnedItems)
        {
            if (configs.Items.TryGetValue(item.ConfigId, out var iCfg) && iCfg.Traits != null) rawTraits.AddRange(iCfg.Traits);
            rawSkills.AddRange(item.ItemSkills.Select(s => s.ConfigId));
        }

        foreach (var weapon in Weapons)
        {
            if (configs.Weapons.TryGetValue(weapon.ConfigId, out var wCfg) && wCfg.Traits != null) rawTraits.AddRange(wCfg.Traits);
            rawSkills.AddRange(weapon.WeaponSkills.Select(s => s.ConfigId));
        }

        // --- 2. RESOLVE TRAIT SYNERGIES ---
        SynergizedTraits.Clear();
        var traitGroups = rawTraits.GroupBy(t => t);

        foreach (var group in traitGroups)
        {
            string currentId = group.Key;
            int count = group.Count();

            // Upgrade the trait for every duplicate found
            for (int i = 1; i < count; i++)
            {
                if (configs.Traits.TryGetValue(currentId, out var tCfg) && !string.IsNullOrEmpty(tCfg.NextLevelId))
                    currentId = tCfg.NextLevelId;
                else
                    break; // Max level reached
            }
            SynergizedTraits.Add(currentId);
        }

        // --- 3. RESOLVE SKILL SYNERGIES ---
        var previousSkills = new Dictionary<string, ActiveSkill>();
        foreach (var s in SynergizedSkills) previousSkills[s.ConfigId] = s; // Save cooldowns!

        SynergizedSkills.Clear();
        var skillGroups = rawSkills.GroupBy(s => s);

        foreach (var group in skillGroups)
        {
            string currentId = group.Key;
            int count = group.Count();

            // Upgrade the skill for every duplicate found
            for (int i = 1; i < count; i++)
            {
                if (configs.Skills.TryGetValue(currentId, out var sCfg) && !string.IsNullOrEmpty(sCfg.NextLevelId))
                    currentId = sCfg.NextLevelId;
                else
                    break; // Max level reached
            }

            // Restore the cooldown if they already had this specific skill level actively ticking
            float cooldown = previousSkills.ContainsKey(currentId) ? previousSkills[currentId].CurrentCooldown : 0f;
            float castTimer = previousSkills.ContainsKey(currentId) ? previousSkills[currentId].CurrentCastTimer : 0f;
            float channelTimer = previousSkills.ContainsKey(currentId) ? previousSkills[currentId].CurrentChannelTimer : 0f;
            SynergizedSkills.Add(new ActiveSkill
            {
                ConfigId = currentId,
                CurrentCooldown = cooldown,
                CurrentCastTimer = castTimer,
                CurrentChannelTimer = channelTimer
            });
        }
        // >>> NEW: Merging/Removing gear dirties the stats <<<
        StatsNeedRecalculation = true;
    }

    /// <summary>
    /// Update GetActiveTraits to simply return the cached, highly-optimized list.
    /// </summary>
    public List<string> GetActiveTraits(ConfigManager configs)
    {
        return SynergizedTraits;
    }

    /// <summary>
    /// A DRY helper that safely sums up ANY engine mechanic value across all active traits.
    /// Supports negative values natively!
    /// </summary>
    public float GetEngineMechanic(string mechanicKey, ConfigManager configs)
    {
        float totalValue = 0f;
        var activeTraits = GetActiveTraits(configs);

        foreach (var traitId in activeTraits)
        {
            if (configs.Traits != null && configs.Traits.TryGetValue(traitId, out var traitCfg))
            {
                if (traitCfg.EngineMechanics != null && traitCfg.EngineMechanics.TryGetValue(mechanicKey, out var value))
                {
                    totalValue += value;
                }
            }
        }
        return totalValue;
    }





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

    public bool TryAddOrMergeWeapon(EquippedWeapon incomingWeapon, ConfigManager configs)
    {
        configs.Weapons.TryGetValue(incomingWeapon.ConfigId, out var incomingCfg);

        // >>> NEW: Get the max level cap from the JSON <<<
        int maxLevel = incomingCfg?.MaxLevel ?? 5;

        bool allowDupes = incomingCfg?.AllowDuplicates ?? false;

        // 1. Find a match based on TIER and (FAMILY or EXACT ID)
        var match = Weapons.FirstOrDefault(w =>
        {
            if (!configs.Weapons.TryGetValue(w.ConfigId, out var existingCfg) || incomingCfg == null) return false;

            return existingCfg.Tier == incomingCfg.Tier &&
                               (
                                   (!string.IsNullOrEmpty(incomingCfg.WeaponFamily) && existingCfg.WeaponFamily == incomingCfg.WeaponFamily)
                                   || w.ConfigId == incomingWeapon.ConfigId
                               )
                               && w.Level < maxLevel; // <<< NEW: DO NOT MERGE IF IT HAS REACHED MAX LEVEL!
        });

        // 2. If we found a match, Merge them!
        if (match != null)
        {
            Weapons.Remove(match);
            var mergedWeapon = Server.Core.Systems.WeaponGenerator.MergeWeapons(match, incomingWeapon, configs);
            mergedWeapon.SlotIndex = match.SlotIndex;
            Weapons.Add(mergedWeapon);
            RecalculateSynergies(configs);
            return true;
        }

        // If we didn't merge (meaning it's either brand new OR our existing one is Max Level),
        // check if we are allowed to take up a new slot!
        if (!allowDupes && incomingCfg != null)
        {
            bool alreadyOwns = Weapons.Any(w =>
            {
                if (!configs.Weapons.TryGetValue(w.ConfigId, out var existCfg)) return false;
                return (!string.IsNullOrEmpty(incomingCfg.WeaponFamily) && existCfg.WeaponFamily == incomingCfg.WeaponFamily) || w.ConfigId == incomingWeapon.ConfigId;
            });

            if (alreadyOwns) return false; // REJECT! The shop will not deduct gold.
        }

        // 3. Otherwise, try to put it in an empty slot (Max 2 slots!)
        for (int i = 0; i < 2; i++)
        {
            if (!Weapons.Any(w => w.SlotIndex == i))
            {
                incomingWeapon.SlotIndex = i;
                Weapons.Add(incomingWeapon);
                RecalculateSynergies(configs);
                return true;
            }
        }
        return false; // Inventory is full
    }

    // >>> NEW: Safe Gear Removal Methods <<<
    public void RemoveWeapon(int slotIndex, ConfigManager configs)
    {
        var weapon = Weapons.FirstOrDefault(w => w.SlotIndex == slotIndex);
        if (weapon != null)
        {
            Weapons.Remove(weapon);
            // Shift remaining slots so there are no gaps
            var sorted = Weapons.OrderBy(w => w.SlotIndex).ToList();
            for (int i = 0; i < sorted.Count; i++) sorted[i].SlotIndex = i;
            RecalculateSynergies(configs);
        }
    }

    public void RemoveItem(int slotIndex, ConfigManager configs)
    {
        var item = OwnedItems.FirstOrDefault(i => i.SlotIndex == slotIndex);
        if (item != null)
        {
            OwnedItems.Remove(item);
            var sorted = OwnedItems.OrderBy(i => i.SlotIndex).ToList();
            for (int i = 0; i < sorted.Count; i++) sorted[i].SlotIndex = i;
            RecalculateSynergies(configs);
        }
    }

    // >>> NEW: Dynamic Item Cap based on Traits <<<
    public int GetMaxItemSlots(ConfigManager configs)
    {
        // Base 5 slots + any bonus slots from traits/items!
        return (int)Math.Max(1, 5 + GetEngineMechanic("bonusItemSlots", configs));
    }

    public bool TryAddOrMergeItem(EquippedItem incomingItem, ConfigManager configs)
    {
        configs.Items.TryGetValue(incomingItem.ConfigId, out var incomingCfg);

        int maxLevel = incomingCfg?.MaxLevel ?? 5;
        bool allowDupes = incomingCfg?.AllowDuplicates ?? false;

        // 1. Find a match based on TIER and (FAMILY or EXACT ID)
        var match = OwnedItems.FirstOrDefault(i =>
        {
            if (!configs.Items.TryGetValue(i.ConfigId, out var existingCfg) || incomingCfg == null) return false;

            return existingCfg.Tier == incomingCfg.Tier &&
                               (
                                   (!string.IsNullOrEmpty(incomingCfg.ItemFamily) && existingCfg.ItemFamily == incomingCfg.ItemFamily)
                                   || i.ConfigId == incomingItem.ConfigId
                               )
                               && i.Level < maxLevel; // <<< NEW: DO NOT MERGE IF IT HAS REACHED MAX LEVEL!

        });

        // 2. If we found a match, Merge them!
        if (match != null)
        {
            OwnedItems.Remove(match);
            var mergedItem = Server.Core.Systems.ItemGenerator.MergeItems(match, incomingItem, configs);
            mergedItem.SlotIndex = match.SlotIndex;
            OwnedItems.Add(mergedItem);
            RecalculateSynergies(configs);
            return true;
        }

        if (!allowDupes && incomingCfg != null)
        {
            bool alreadyOwns = OwnedItems.Any(i =>
            {
                if (!configs.Items.TryGetValue(i.ConfigId, out var existCfg)) return false;
                return (!string.IsNullOrEmpty(incomingCfg.ItemFamily) && existCfg.ItemFamily == incomingCfg.ItemFamily) || i.ConfigId == incomingItem.ConfigId;
            });

            if (alreadyOwns) return false; // REJECT!
        }

        // 3. Otherwise, check the dynamic inventory cap!
        if (OwnedItems.Count >= GetMaxItemSlots(configs)) return false; // Inventory is full!

        incomingItem.SlotIndex = OwnedItems.Count;
        OwnedItems.Add(incomingItem);
        RecalculateSynergies(configs);
        return true;
    }
}