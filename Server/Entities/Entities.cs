using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Text.Json.Serialization;
using Server.Configs;
using Server.Core;
using Server.Core.Systems;

namespace Server.Entities;

// ==========================================
// Base Classes
// ==========================================

/// <summary>
/// Shared base for PlayerEntity and EnemyEntity.
/// Holds all properties that are common to any actor in the game world.
/// </summary>
public abstract class BaseActorEntity
{
    // --- World Position ---
    public float X { get; private set; }
    public float Y { get; private set; }

    // Absolute placement - spawning, respawning, teleporting, network-transfer hydration.
    // No movement semantics, just "the entity is now here."
    public void SetPosition(float x, float y)
    {
        X = x;
        Y = y;
    }

    // Incremental movement - normal per-tick locomotion. Same underlying mutation as
    // SetPosition; the distinct name documents intent at call sites (MovementSystem).
    public void Translate(float deltaX, float deltaY)
    {
        X += deltaX;
        Y += deltaY;
    }

    // Left public get/set - not in scope for this slice (ActionState/Team/position/shield only).
    public float CurrentSweepAngle { get; set; } = 0f;

    public float CurrentShield { get; private set; }

    // Adds (positive) or removes (negative) shield. Deliberately NOT auto-clamped to >= 0 here -
    // EffectSystem's refresh sequence (subtract the old granted amount, then add the new one)
    // can pass through a genuinely negative intermediate before landing on a non-negative final
    // value, and clamping mid-sequence would silently change that math. Call
    // ClampShieldNonNegative() when you need the same "never below zero" cleanup the original
    // code did explicitly (see HealthSystem's post-mitigation line).
    public void ModifyShield(float amount) => CurrentShield += amount;

    public void ClampShieldNonNegative() => CurrentShield = Math.Max(0f, CurrentShield);

    // >>> THE FIX: Changing HP instantly flags the entity as Dirty! <
    private float _currentHp;
    public float CurrentHp
    {
        get => _currentHp;
        set
        {
            if (_currentHp != value)
            {
                _currentHp = value;
                StatsNeedRecalculation = true;
            }
        }
    }

    // --- Stats ---
    public StatDictionary Stats { get; set; } = new();

    // --- Team & State ---
    public string Team { get; private set; } = string.Empty;
    public string OriginalTeam { get; private set; } = string.Empty; // <<< NEW: Always remember the true loyalty
    public void SetTeam(string team)
    {
        // Snapshot the original team the very first time it is assigned (e.g., during Initialize)
        if (string.IsNullOrEmpty(OriginalTeam)) OriginalTeam = team;
        Team = team;
    }

    // <<< NEW: Clean reset helper for the EffectSystem
    public void RevertTeam()
    {
        if (!string.IsNullOrEmpty(OriginalTeam)) Team = OriginalTeam;
    }
    public string ActionState { get; private set; } = "Idle";
    public void SetActionState(string newState) => ActionState = newState;

    // Explicit death flag, separate from ActionState. ActionState is animation-driven and can
    // be overwritten every tick by movement/combat systems, so game-over/revive logic reads
    // this instead of relying on ActionState staying "Dead" between ticks.
    public bool IsDead { get; set; } = false;


    // --- Inventory ---
    public List<EquippedWeapon> Weapons { get; set; } = new();
    public List<EquippedItem> OwnedItems { get; set; } = new();

    // --- Status Effects ---
    public List<ActiveEffect> ActiveEffects { get; set; } = new();

    // --- Skills ---
    public List<ActiveSkill> Skills { get; set; } = new();
    public string CurrentCastingSkillId { get; set; } = string.Empty;
    public float CurrentCastTimer { get; set; }
    public float MaxCastTimer { get; set; }
    public Dictionary<string, float> DynamicSkillTimers { get; set; } = new();
    public int CurrentSkillIndex { get; set; } = 0;


    // >>> THE NEW ECS STAT CACHE <<<
    [JsonIgnore]
    public Dictionary<string, float> CachedStats { get; set; } = new();
    // >>> NEW: aggregate percent statMultiplier per stat, cached alongside CachedStats. Lets
    // systems apply the same malus/bonus directly to values that live outside CachedStats
    // (e.g. a weapon's own meleeDamage/rangedDamage/magicDamage in CombatSystem) instead of
    // only affecting this character's own stat pool.
    [JsonIgnore]
    public Dictionary<string, float> CachedStatMultipliers { get; set; } = new();
    [JsonIgnore]
    public bool StatsNeedRecalculation { get; set; } = true;
    public float CurrentMaxHp { get; set; }

    // Instantly returns O(1) without doing any math!
    public float GetTotalStat(string statName, Configs.ConfigManager configManager = null, GameState state = null)
    {
        return CachedStats.GetValueOrDefault(statName, 0f);
    }

    // Same asymmetric rule as StatSystem's final calculation: positive multiplies up, negative
    // divides down instead of subtracting. Use this to apply a stat's percent multiplier to a
    // value that isn't itself part of CachedStats (e.g. a weapon's own damage number).
    public float GetStatMultiplier(string statName)
    {
        return CachedStatMultipliers.GetValueOrDefault(statName, 0f);
    }


    public bool IsIncapacitated(Configs.ConfigManager configs)
    {
        foreach (var effect in ActiveEffects)
        {
            if (configs.Effects.TryGetValue(effect.ConfigId, out var cfg) && cfg.PreventsActions)
                return true;
        }
        return false;
    }

}

/// <summary>
/// Shared base for EquippedWeapon and EquippedItem.
/// Holds the identity, ancestry, pre-calculated stats, and rolled stats
/// that are identical on both gear types.
/// </summary>
public abstract class BaseEquippedGear
{
    public string ConfigId { get; set; } = string.Empty;
    public int Level { get; set; } = 1;
    public int SlotIndex { get; set; } // promoted from EquippedItem/EquippedWeapon - was identical on both
    public List<string> MergedConfigIds { get; set; } = new();
    public Dictionary<string, float> TotalBaseStats { get; set; } = new();
    public Dictionary<string, float> RolledStats { get; set; } = new();
    // >>> NEW: Tracks if this gear was granted by a temporary status effect
    public string SourceEffectId { get; set; } = string.Empty;

    // Lets shared generator/merge logic reach "this gear's skill list" generically.
    // WeaponSkills / ItemSkills stay as the existing named properties everywhere else in the
    // codebase (Entities.cs synergy logic, NetworkSystem.cs flattening, etc.) - this just aliases
    // them for the DRY helper below, no renames, no other call sites need to change.
    public abstract List<ActiveSkill> GearSkills { get; }
}


// ==========================================
// Component Classes
// ==========================================

public class ActiveEffect
{
    public string ConfigId { get; set; } = string.Empty;

    // How much longer this effect lasts
    public float TimeRemaining { get; set; }

    // Tracks when to deal the next "tick" of damage
    public float TimeSinceLastTick { get; set; }

    // Who caused this effect? (Useful if an enemy dies to poison and we need to know which Player gets the Gold/XP!)
    public string SourceId { get; set; } = string.Empty;
    public float GrantedShieldAmount { get; set; }
    public int StackCount { get; set; } = 1;
    // >>> NEW: Flags this specific instance as the active team-switcher
    public bool IsTeamSwitcher { get; set; } = false;

    [JsonIgnore]
    public BaseActorEntity? Caster { get; set; }
}

public class ActiveSkill
{
    public string ConfigId { get; set; } = string.Empty;
    public float CurrentCooldown { get; set; }

    public bool IsCasting { get; set; }
    public float CurrentCastTimer { get; set; }
    public float CurrentChannelTimer { get; set; }
    public float TimeSinceLastTick { get; set; }
    // >>> NEW: Tracks if this skill was granted by a temporary status effect
    public string SourceEffectId { get; set; } = string.Empty;
    // >>> NEW: Flag to hide this skill from the normal auto-attack AI
    public bool IsDynamic { get; set; } = false;

}

public class EquippedItem : BaseEquippedGear
{
    public List<ActiveSkill> ItemSkills { get; set; } = new();
    public override List<ActiveSkill> GearSkills => ItemSkills;
}

public class EquippedWeapon : BaseEquippedGear
{
    public float CurrentCooldown { get; set; }
    public List<ActiveSkill> WeaponSkills { get; set; } = new();
    public override List<ActiveSkill> GearSkills => WeaponSkills;
}


// ==========================================
// Entity Classes
// ==========================================

public class EnemyEntity : BaseActorEntity
{
    private static int _enemyIdCounter = 0;
    public string Id { get; set; } = "e_" + Interlocked.Increment(ref _enemyIdCounter).ToString();
    public string ConfigId { get; set; } = string.Empty;
    public float HitRadius { get; set; }

    // Networked state and internal timer for animations
    public float DespawnTimer { get; set; } = 0.0f;
    public float AttackCooldown { get; set; } = 0f;
    public float SkillWaitTimer { get; set; } = 0f;

    public float WanderTargetX { get; set; } = -1f;
    public float WanderTargetY { get; set; } = -1f;
    public float WanderTimer { get; set; } = 0f;

    // Aim direction (toward current target) – sent to client for weapon rotation
    public float AimX { get; set; }
    public float AimY { get; set; }

    // Tracks which weapon slots fired this tick (cleared at end of network tick)
    public List<int> FiredWeaponsThisTick { get; set; } = new();

    // Initializes the enemy with the Master Stat List so it never crashes
    public void Initialize(Configs.EnemyConfig config, float spawnX, float spawnY, ConfigManager configManager)
    {
        SetTeam("Enemy");
        ConfigId = config.Id;
        SetPosition(spawnX, spawnY);


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

        foreach (var weapon in Weapons)
        {
            if (weapon.WeaponSkills != null)
            {
                foreach (var s in weapon.WeaponSkills)
                {
                    if (!Skills.Any(x => x.ConfigId == s.ConfigId))
                        Skills.Add(new ActiveSkill { ConfigId = s.ConfigId, CurrentCooldown = 0f });
                }
            }
        }
        foreach (var item in OwnedItems)
        {
            if (item.ItemSkills != null)
            {
                foreach (var s in item.ItemSkills)
                {
                    if (!Skills.Any(x => x.ConfigId == s.ConfigId))
                        Skills.Add(new ActiveSkill { ConfigId = s.ConfigId, CurrentCooldown = 0f });
                }
            }
        }

        CurrentHp = GetTotalStat("maxHp", configManager);
        SkillWaitTimer = (float)(Random.Shared.NextDouble() * 10.0 + 5.0);
    }
}

public class PlayerEntity : BaseActorEntity
{
    public string ConnectionId { get; set; } = string.Empty;
    public string PlayerId { get; set; } = string.Empty;
    public string ConfigId { get; set; } = "char_well_rounded";
    public string Name { get; set; } = "Guest";
    public bool IsReady { get; set; } = false;

    public int Level { get; set; } = 1;
    public float CurrentXp { get; set; }
    public int PendingLevelUps { get; set; }
    public Dictionary<string, float> PendingStatDiff { get; } = new();
    public List<Configs.LevelUpCardConfig> CurrentLevelUpChoices { get; set; } = new();
    public float TotalDamageDealt { get; set; } = 0;
    public float TotalDamageTaken { get; set; } = 0;
    public float TotalHealingDone { get; set; } = 0;
    public float TotalShieldingDone { get; set; } = 0;
    public int Kills { get; set; } = 0;
    public int Deaths { get; set; } = 0;

    // Populated once when the player joins the lobby (LobbyHub.InnerJoinRoom) from the DB,
    // and carried across to the Worker node via PlayerTransferDto on match handoff.
    // Used to gate character selection and filter locked gear out of the shop.
    [JsonIgnore]
    public HashSet<string> UnlockedAchievementIds { get; set; } = new();

    // --- Achievement tracking (match-scoped, not networked) ---
    // Highest number of weapon slots ever filled at once this match (used by achievements
    // like "clear wave 20 with only 2 weapons").
    [JsonIgnore]
    public int PeakWeaponsEquipped { get; set; } = 0;

    // Flood guard for SendChatMessage (covers both regular chat and "/" cheat commands) — see
    // MatchHub.SendChatMessage. Not networked, purely server-side bookkeeping.
    [JsonIgnore]
    public DateTime LastChatMessageAt { get; set; } = DateTime.MinValue;

    // Highest value ever reached this match for EVERY stat (keyed by the same stat names as
    // CachedStats/ConfigManager.AllStats — "maxHp", "critChance", "luck", whatever exists).
    // Powers generic "reach X of stat Y before wave Z" achievements without hardcoding a
    // dedicated field per stat. Updated in StatSystem.RecalculatePlayer.
    [JsonIgnore]
    public Dictionary<string, float> PeakStats { get; set; } = new();


    // Compounding level-up curve, same pattern as the enemy wave-scaling curve in
    // GameRoom.SpawnEnemy: each level requires XpGrowthRate more XP than the PREVIOUS level's
    // requirement, not a flat +N step. Early levels feel close to the old linear curve; late
    // levels snowball since the bonus compounds on top of itself instead of just adding.
    private const float XpBaseRequirement = 8f;
    private const float XpGrowthRate = 0.10f; // 12% more XP required per level than the last

    public float GetXpRequirement() =>
        XpBaseRequirement * (float)Math.Pow(1f + XpGrowthRate, Level - 1);


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

    // Initializes the player with the Master Stat List so it never crashes
    public void Initialize(CharacterConfig config, ConfigManager configManager)
    {
        SetTeam("Player");

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

        // Convert raw skill IDs into Configs for processing
        var currentSkills = new List<SkillConfig>();
        foreach (var id in rawSkills)
        {
            if (configs.Skills.TryGetValue(id, out var sCfg)) currentSkills.Add(sCfg);
        }

        // 1. Auto-chess style merge loop for SkillFamily (2x T1 -> 1x T2)
        bool merged = true;
        while (merged)
        {
            merged = false;
            var familyGroups = currentSkills.Where(s => !string.IsNullOrEmpty(s.SkillFamily)).GroupBy(s => s.SkillFamily);

            foreach (var group in familyGroups)
            {
                // >>> FIX: Only allow merging if the skill has ScalesWithGearLevel set to true <<<
                var tierGroups = group.GroupBy(s => s.Tier)
                                      .Where(g => g.Count() >= 2 && g.First().ScalesWithGearLevel)
                                      .ToList();

                if (tierGroups.Any())
                {
                    var targetTierGroup = tierGroups.First();
                    int currentTier = targetTierGroup.Key;

                    var nextTierSkill = configs.Skills.Values.FirstOrDefault(s => s.SkillFamily == group.Key && s.Tier == currentTier + 1);
                    if (nextTierSkill != null)
                    {
                        currentSkills.Remove(targetTierGroup.ElementAt(0));
                        currentSkills.Remove(targetTierGroup.ElementAt(1));

                        currentSkills.Add(nextTierSkill);
                        merged = true;
                        break;
                    }
                }
            }
        }

        // 2. HIGHEST TIER FILTER (This is the specific fix for Bug 4!)
        // It strictly selects the best tier to use, but leaves the underlying gear untouched!
        var finalFilteredSkills = new List<SkillConfig>();
        var skillsByFamily = currentSkills.GroupBy(s => string.IsNullOrEmpty(s.SkillFamily) ? s.Id : s.SkillFamily);

        foreach (var group in skillsByFamily)
        {
            if (string.IsNullOrEmpty(group.First().SkillFamily))
            {
                // Skills with no family, keep unique ones
                finalFilteredSkills.AddRange(group.GroupBy(s => s.Id).Select(g => g.First()));
            }
            else
            {
                // Pick ONLY the single highest tier skill for this family
                var highestTierSkill = group.OrderByDescending(s => s.Tier).First();
                finalFilteredSkills.Add(highestTierSkill);
            }
        }

        // 3. Map finalized skills back to ActiveSkill states
        foreach (var finalizedSkill in finalFilteredSkills)
        {
            string currentId = finalizedSkill.Id;
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

    public void GainXp(float amount, Configs.ConfigManager configManager, DifficultyConfig diff)
    {
        float xpBonus = GetTotalStat("xpGainPercent", configManager);
        CurrentXp += amount * diff.XpMultiplier * (1f + xpBonus);

        bool leveledUp = false;
        while (CurrentXp >= GetXpRequirement())
        {
            CurrentXp -= GetXpRequirement();
            Level++;
            PendingLevelUps++;
            leveledUp = true;

            // Checked on every SINGLE Level++ step, not just once at the end comparing start
            // vs. final level - a big XP dump (e.g. /givexp) can cross several X-level
            // milestones in one call, and each one should still award its own tier-up rather
            // than only the last milestone reached.
            TryLevelUpSkillsForCharacterLevel(configManager);
        }

        // Skills may have just changed ConfigIds above - refresh SynergizedSkills/stats exactly
        // like every other place that mutates Skills or gear. (RecalculateSynergies' own
        // doc-comment already called out "or levels up" as a case it should cover.)
        if (leveledUp) RecalculateSynergies(configManager);
    }

    // Advances any currently-owned skill that's due for a tier-up at the level just reached.
    // Deliberately mirrors two rules already used elsewhere so this behaves exactly like
    // "the normal way" a skill levels:
    //   - SkillFamily + Tier resolution: same lookup as RecalculateSynergies' merge loop.
    //   - ScalesWithGearLevel gate: same gate GearGeneratorHelper.UpgradeScalingSkills uses -
    //     a skill flagged ScalesWithGearLevel = false is meant to stay one fixed tier forever,
    //     so it's skipped here too, same as it would be for gear-driven leveling.
    private void TryLevelUpSkillsForCharacterLevel(ConfigManager configs)
    {
        foreach (var skill in Skills)
        {
            if (!configs.Skills.TryGetValue(skill.ConfigId, out var sCfg)) continue;
            if (!sCfg.ScalesWithGearLevel) continue;
            if (sCfg.LevelUpEveryXCharacterLevels <= 0) continue;
            if (Level % sCfg.LevelUpEveryXCharacterLevels != 0) continue;

            var nextTierSkill = configs.Skills.Values.FirstOrDefault(
                s => s.SkillFamily == sCfg.SkillFamily && s.Tier == sCfg.Tier + 1);

            if (nextTierSkill != null)
            {
                skill.ConfigId = nextTierSkill.Id;
                skill.CurrentCooldown = nextTierSkill.CooldownSeconds;
            }
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

public class ProjectileEntity
{
    private static int _projIdCounter = 0;
    public string Id { get; set; } = "proj_" + Interlocked.Increment(ref _projIdCounter).ToString();
    public string ConfigId { get; set; } = string.Empty; // Tells the UI what sprite to draw!
    public string OwnerId { get; set; } = string.Empty;
    public float X { get; set; }
    public float Y { get; set; }
    public float VelX { get; set; }
    public float VelY { get; set; }
    public float PhysicalDamage { get; set; }
    public float MagicDamage { get; set; }
    public float LifeStealChance { get; set; }
    // >>> NEW: Melee & Pierce Mechanics! <<<
    public float HitRadius { get; set; } = 15f;
    public float Lifespan { get; set; } = 1f;
    public int PierceCount { get; set; } = 0;
    public int BounceCount { get; set; } = 0;
    public float SweepAngle { get; set; } = (float)(Random.Shared.NextDouble() * Math.PI * 2);
    // >>> NEW: Orbit & Death Mechanics <<<
    public string MovementBehavior { get; set; } = "Linear";
    public float OrbitRadius { get; set; }
    public float OrbitAngleOffset { get; set; }
    public float OrbitSpeed { get; set; }
    public string OnDeathSkillId { get; set; } = string.Empty;

    public float TickRate { get; set; }
    public string TickSkillId { get; set; } = string.Empty;
    public float TimeSinceLastTick { get; set; }

    public string Team { get; set; } = string.Empty;
    public HashSet<string> HitEnemies { get; set; } = new();
    public List<string> ApplyEffectsOnHit { get; set; } = new();
    public bool IsCritical { get; set; }

    // >>> ORBIT RE-HIT SUPPORT <<<
    // HitEnemies above is "pierce memory" for linear projectiles: once hit, never hit again, until the
    // projectile dies. Orbitals never die from pierce, so they need a per-target re-hit cooldown instead
    // of permanent pierce memory. Key = target id, Value = seconds remaining until this target can be hit again.
    public Dictionary<string, float> OrbitHitCooldowns { get; set; } = new();

    // How often (in seconds) an orbiting projectile can re-damage the same target while circling.
    public float OrbitHitInterval { get; set; } = 0.5f;

    // >>> NEW: When true, this projectile seeks allied targets (heals/shields) instead of enemies.
    // Set by ProjectileFactory when spawned from a ClosestAlly-targeted skill.
    public bool IsFriendlyProjectile { get; set; } = false;
}

public enum PickupType
{
    Gold = 0,
    Weapon = 1,
    Item = 2
}

public class PickupEntity
{
    private static int _pickupIdCounter = 0;
    public string Id { get; set; } = "pk_" + Interlocked.Increment(ref _pickupIdCounter).ToString();
    public float X { get; set; }
    public float Y { get; set; }

    // Gold value (only relevant when Type == Gold)
    public int Value { get; set; }

    public PickupType Type { get; set; } = PickupType.Gold;

    // Populated when Type == Weapon; null otherwise
    public EquippedWeapon? DroppedWeapon { get; set; }

    // Populated when Type == Item; null otherwise
    public EquippedItem? DroppedItem { get; set; }
    public bool IsMoving { get; set; } = false;
}