// using Server.Configs;
// using Server.Core;
// using System;
// using System.Collections.Generic;
// using System.Linq;

// namespace Server.Entities;

// public class PlayerEntity : BaseActorEntity
// {
//     public string ConnectionId { get; set; } = string.Empty;
//     public string ConfigId { get; set; } = "char_well_rounded";

//     public int Level { get; set; } = 1;
//     public float CurrentXp { get; set; }
//     public int PendingLevelUps { get; set; }
//     public List<Configs.LevelUpCardConfig> CurrentLevelUpChoices { get; set; } = new();

//     // The formula for how much XP you need to reach the next level
//     public float GetXpRequirement() => 5 + (Level * 3);

//     // Physics & Inputs
//     public float InputX { get; set; }
//     public float InputY { get; set; }
//     public float AimX { get; set; }
//     public float AimY { get; set; }
//     public List<int> FiredWeaponsThisTick { get; set; } = new();

//     // Economy & Shop
//     public int Gold { get; set; } = 5000;
//     public int CurrentRerollCost { get; set; } = 2;
//     public List<DTOs.ShopItemDto> CurrentShop { get; set; } = new();

//     // Mechanics
//     public List<string> Traits { get; set; } = new();
//     public bool DuplicateNextPurchase { get; set; }

//     public List<string> SynergizedTraits { get; private set; } = new();
//     public List<ActiveSkill> SynergizedSkills { get; private set; } = new();
//     public int CurrentSkillIndex { get; set; } = 0;

//     // Initializes the player with the Master Stat List so it never crashes
//     public void Initialize(CharacterConfig config, ConfigManager configManager)
//     {
//         Team = "Player";

//         // 1. Initialize EVERY stat dynamically from the JSON file!
//         foreach (var stat in configManager.AllStats)
//         {
//             Stats.InitializeStat(stat, 0f);
//         }

//         // 2. Overwrite with Character's base stats from JSON
//         if (config.BaseStats != null)
//         {
//             foreach (var stat in config.BaseStats)
//             {
//                 Stats.InitializeStat(stat.Key, stat.Value);
//             }
//         }

//         if (config.Traits != null)
//         {
//             foreach (var trait in config.Traits) Traits.Add(trait);
//         }

//         if (config.StartingSkills != null)
//         {
//             foreach (var skillId in config.StartingSkills)
//             {
//                 Skills.Add(new ActiveSkill { ConfigId = skillId, IsCasting = false, CurrentCooldown = 0f });
//             }
//         }

//         // Set starting health to whatever the dictionary calculated for maxHp
//         CurrentHp = Stats.GetFinalStat("maxHp");

//         // Give Starting Gear
//         if (config.StartingWeapons != null)
//         {
//             foreach (var wId in config.StartingWeapons)
//             {
//                 if (configManager.Weapons.ContainsKey(wId))
//                 {
//                     var newWeapon = Server.Core.Systems.WeaponGenerator.GenerateWeapon(wId, this, configManager, 1);
//                     newWeapon.SlotIndex = Weapons.Count;
//                     Weapons.Add(newWeapon);
//                 }
//             }
//         }

//         if (config.StartingItems != null)
//         {
//             foreach (var itemId in config.StartingItems)
//             {
//                 if (configManager.Items.ContainsKey(itemId))
//                 {
//                     var newItem = Server.Core.Systems.ItemGenerator.GenerateItem(itemId, this, configManager, 1);
//                     newItem.SlotIndex = OwnedItems.Count;
//                     OwnedItems.Add(newItem);
//                 }
//             }
//         }
//         RecalculateSynergies(configManager);
//     }

//     /// <summary>
//     /// Run this ONCE whenever the player buys, merges, drops gear, or levels up.
//     /// It pools all gear, counts duplicates, and upgrades skills/traits!
//     /// </summary>
//     public void RecalculateSynergies(ConfigManager configs)
//     {
//         // --- 1. POOL EVERYTHING ---
//         var rawTraits = new List<string>(this.Traits);
//         var rawSkills = new List<string>(this.Skills.Select(s => s.ConfigId));

//         foreach (var item in OwnedItems)
//         {
//             if (configs.Items.TryGetValue(item.ConfigId, out var iCfg) && iCfg.Traits != null) rawTraits.AddRange(iCfg.Traits);
//             rawSkills.AddRange(item.ItemSkills.Select(s => s.ConfigId));
//         }

//         foreach (var weapon in Weapons)
//         {
//             if (configs.Weapons.TryGetValue(weapon.ConfigId, out var wCfg) && wCfg.Traits != null) rawTraits.AddRange(wCfg.Traits);
//             rawSkills.AddRange(weapon.WeaponSkills.Select(s => s.ConfigId));
//         }

//         // --- 2. RESOLVE TRAIT SYNERGIES ---
//         SynergizedTraits.Clear();
//         var traitGroups = rawTraits.GroupBy(t => t);

//         foreach (var group in traitGroups)
//         {
//             string currentId = group.Key;
//             int count = group.Count();

//             // Upgrade the trait for every duplicate found
//             for (int i = 1; i < count; i++)
//             {
//                 if (configs.Traits.TryGetValue(currentId, out var tCfg) && !string.IsNullOrEmpty(tCfg.NextLevelId))
//                     currentId = tCfg.NextLevelId;
//                 else
//                     break; // Max level reached
//             }
//             SynergizedTraits.Add(currentId);
//         }

//         // --- 3. RESOLVE SKILL SYNERGIES ---
//         var previousSkills = new Dictionary<string, ActiveSkill>();
//         foreach (var s in SynergizedSkills) previousSkills[s.ConfigId] = s; // Save cooldowns!

//         SynergizedSkills.Clear();
//         var skillGroups = rawSkills.GroupBy(s => s);

//         foreach (var group in skillGroups)
//         {
//             string currentId = group.Key;
//             int count = group.Count();

//             // Upgrade the skill for every duplicate found
//             for (int i = 1; i < count; i++)
//             {
//                 if (configs.Skills.TryGetValue(currentId, out var sCfg) && !string.IsNullOrEmpty(sCfg.NextLevelId))
//                     currentId = sCfg.NextLevelId;
//                 else
//                     break; // Max level reached
//             }

//             // Restore the cooldown if they already had this specific skill level actively ticking
//             float cooldown = previousSkills.ContainsKey(currentId) ? previousSkills[currentId].CurrentCooldown : 0f;
//             float castTimer = previousSkills.ContainsKey(currentId) ? previousSkills[currentId].CurrentCastTimer : 0f;
//             float channelTimer = previousSkills.ContainsKey(currentId) ? previousSkills[currentId].CurrentChannelTimer : 0f;
//             SynergizedSkills.Add(new ActiveSkill
//             {
//                 ConfigId = currentId,
//                 CurrentCooldown = cooldown,
//                 CurrentCastTimer = castTimer,
//                 CurrentChannelTimer = channelTimer
//             });
//         }
//     }

//     /// <summary>
//     /// Update GetActiveTraits to simply return the cached, highly-optimized list.
//     /// </summary>
//     public List<string> GetActiveTraits(ConfigManager configs)
//     {
//         return SynergizedTraits;
//     }

//     /// <summary>
//     /// A DRY helper that safely sums up ANY engine mechanic value across all active traits.
//     /// Supports negative values natively!
//     /// </summary>
//     public float GetEngineMechanic(string mechanicKey, ConfigManager configs)
//     {
//         float totalValue = 0f;
//         var activeTraits = GetActiveTraits(configs);

//         foreach (var traitId in activeTraits)
//         {
//             if (configs.Traits != null && configs.Traits.TryGetValue(traitId, out var traitCfg))
//             {
//                 if (traitCfg.EngineMechanics != null && traitCfg.EngineMechanics.TryGetValue(mechanicKey, out var value))
//                 {
//                     totalValue += value;
//                 }
//             }
//         }
//         return totalValue;
//     }

//     /// <summary>
//     /// DRY Helper to evaluate Dynamic Modifiers from any source (Traits, Items, or Character Config)
//     /// </summary>
//     private float EvaluateDynamicModifiers(IEnumerable<DynamicModifier> modifiers, string statName, ConfigManager configManager, float itemLevel = 1f, GameState state = null)
//     {
//         float flatBonus = 0f;
//         if (modifiers == null) return flatBonus;

//         foreach (var mod in modifiers.Where(m => m.TargetStat == statName))
//         {
//             // Architect Safety: Prevent DivideByZero exceptions if you accidentally set ConditionThreshold to 0 in JSON
//             float safeThreshold = Math.Max(0.01f, mod.ConditionThreshold);

//             switch (mod.ConditionType)
//             {
//                 case "MissingHealthPercent":
//                     // 1. Get safe Max HP
//                     float maxHp = Math.Max(1f, Stats.GetFinalStat("maxHp"));

//                     // 2. THE FIX: Clamp HP between 0 and MaxHP. 
//                     // Prevents negative HP from granting >100% missing health, and prevents over-healing from breaking the math.
//                     float safeCurrentHp = Math.Clamp(CurrentHp, 0f, maxHp);

//                     // 3. Calculate safe percentage (guaranteed to be exactly between 0.0f and 1.0f)
//                     float missingHpPercent = 1f - (safeCurrentHp / maxHp);

//                     // 4. Calculate integer stacks
//                     int chunksHp = (int)Math.Floor(missingHpPercent / safeThreshold);

//                     flatBonus += (mod.Amount * chunksHp * itemLevel);
//                     break;

//                 case "PerXStat":
//                     if (!string.IsNullOrEmpty(mod.ConditionStat))
//                     {
//                         // Recursive lookup to get the source stat
//                         float sourceStatValue = GetTotalStat(mod.ConditionStat, configManager);

//                         // Architect Safety: Clamp to 0 so negative stats (like negative armor) 
//                         // don't accidentally reverse the formula and penalize the player.
//                         float safeSourceStat = Math.Max(0f, sourceStatValue);

//                         int chunksStat = (int)Math.Floor(safeSourceStat / safeThreshold);
//                         flatBonus += (mod.Amount * chunksStat * itemLevel);
//                     }
//                     break;

//                 case "IsStandingStill":
//                     if (this.InputX == 0 && this.InputY == 0)
//                         flatBonus += (mod.Amount * itemLevel);
//                     break;

//                 case "PerItemOwned":
//                     flatBonus += (this.OwnedItems.Count * mod.Amount * itemLevel);
//                     break;

//                 case "PerEnemyAlive":
//                     if (state != null)
//                     {
//                         // High Performance: We avoid allocating a new list, just lazily counting alive enemies
//                         int activeEnemies = state.Enemies.Count(e => e.Value.ActionState != "Dead");
//                         flatBonus += (activeEnemies * mod.Amount * itemLevel);
//                     }
//                     break;
//             }
//         }
//         return flatBonus;
//     }

//     // Calculates dynamic stats, passive item buffs, trait multipliers, and weapon buffs on the fly
//     public override float GetTotalStat(string statName, ConfigManager configManager, GameState state = null)
//     {
//         float baseStat = Stats.GetFinalStat(statName);
//         float dynamicFlat = 0f;
//         float traitMultiplier = 1f;

//         // --- 1. ITEMS ---
//         foreach (var item in OwnedItems)
//         {
//             if (item.TotalBaseStats != null && item.TotalBaseStats.TryGetValue(statName, out float iBase))
//                 dynamicFlat += iBase;

//             if (item.RolledStats != null && item.RolledStats.TryGetValue(statName, out float iRoll))
//                 dynamicFlat += iRoll;

//             if (configManager.Items.TryGetValue(item.ConfigId, out var itemConfig))
//             {
//                 dynamicFlat += EvaluateDynamicModifiers(itemConfig.DynamicModifiers, statName, configManager, item.Level, state);
//             }
//         }

//         // --- 2. WEAPONS ---
//         foreach (var weapon in Weapons)
//         {
//             if (weapon.TotalBaseStats != null && weapon.TotalBaseStats.TryGetValue(statName, out float wBase))
//                 dynamicFlat += wBase;

//             if (weapon.RolledStats != null && weapon.RolledStats.TryGetValue(statName, out var wRoll))
//                 dynamicFlat += wRoll;
//         }

//         // --- 3. ACTIVE EFFECTS (Buffs & Debuffs) ---
//         foreach (var effect in ActiveEffects)
//         {
//             if (configManager.Effects.TryGetValue(effect.ConfigId, out var effectConfig))
//             {
//                 if (effectConfig.StatModifiers != null && effectConfig.StatModifiers.TryGetValue(statName, out float amount))
//                 {
//                     dynamicFlat += amount;
//                 }
//             }
//         }

//         // --- 4. CHARACTER BASE MODIFIERS ---
//         if (configManager.Characters.TryGetValue(ConfigId, out var charConfig))
//         {
//             dynamicFlat += EvaluateDynamicModifiers(charConfig.DynamicModifiers, statName, configManager, 1f, state);
//         }

//         // --- 5. TRAITS (Bonuses, Modifiers, and Multipliers) ---
//         var activeTraits = GetActiveTraits(configManager);
//         foreach (var traitId in activeTraits)
//         {
//             if (configManager.Traits != null && configManager.Traits.TryGetValue(traitId, out var traitCfg))
//             {
//                 // A. Flat Bonuses
//                 if (traitCfg.StatBonuses != null && traitCfg.StatBonuses.TryGetValue(statName, out var bonus))
//                     dynamicFlat += bonus;

//                 // B. Multipliers (e.g., CannotHeal = 0.0 multiplier on hpRegen)
//                 if (traitCfg.StatMultipliers != null && traitCfg.StatMultipliers.TryGetValue(statName, out var mult))
//                     traitMultiplier *= mult;

//                 // C. Trait-specific Dynamic Modifiers
//                 dynamicFlat += EvaluateDynamicModifiers(traitCfg.DynamicModifiers, statName, configManager, 1f, state);
//             }
//         }

//         float finalValue = (baseStat + dynamicFlat) * traitMultiplier;

//         // >>> SERVER-SIDE HARD CAPS <<<
//         // Ensure UI and Game Logic always see a max of 1.0 (100%)
//         if (statName == "critChance" || statName == "projectileBlockChance")
//         {
//             finalValue = Math.Min(1.0f, finalValue);
//         }

//         return finalValue;
//     }

//     public void GainXp(float amount, Configs.ConfigManager configManager)
//     {
//         float xpBonus = GetTotalStat("xpGainPercent", configManager);
//         CurrentXp += amount * (1f + xpBonus);

//         while (CurrentXp >= GetXpRequirement())
//         {
//             CurrentXp -= GetXpRequirement();
//             Level++;
//             PendingLevelUps++; // Stores the level up for the shop phase!
//         }
//     }

//     public bool TryAddOrMergeWeapon(EquippedWeapon incomingWeapon, ConfigManager configs)
//     {
//         configs.Weapons.TryGetValue(incomingWeapon.ConfigId, out var incomingCfg);

//         // >>> NEW: Get the max level cap from the JSON <<<
//         int maxLevel = incomingCfg?.MaxLevel ?? 5;

//         bool allowDupes = incomingCfg?.AllowDuplicates ?? false;

//         // 1. Find a match based on TIER and (FAMILY or EXACT ID)
//         var match = Weapons.FirstOrDefault(w =>
//         {
//             if (!configs.Weapons.TryGetValue(w.ConfigId, out var existingCfg) || incomingCfg == null) return false;

//             return existingCfg.Tier == incomingCfg.Tier &&
//                                (
//                                    (!string.IsNullOrEmpty(incomingCfg.WeaponFamily) && existingCfg.WeaponFamily == incomingCfg.WeaponFamily)
//                                    || w.ConfigId == incomingWeapon.ConfigId
//                                )
//                                && w.Level < maxLevel; // <<< NEW: DO NOT MERGE IF IT HAS REACHED MAX LEVEL!
//         });

//         // 2. If we found a match, Merge them!
//         if (match != null)
//         {
//             Weapons.Remove(match);
//             var mergedWeapon = Server.Core.Systems.WeaponGenerator.MergeWeapons(match, incomingWeapon, configs);
//             mergedWeapon.SlotIndex = match.SlotIndex;
//             Weapons.Add(mergedWeapon);
//             RecalculateSynergies(configs);
//             return true;
//         }

//         // If we didn't merge (meaning it's either brand new OR our existing one is Max Level),
//         // check if we are allowed to take up a new slot!
//         if (!allowDupes && incomingCfg != null)
//         {
//             bool alreadyOwns = Weapons.Any(w =>
//             {
//                 if (!configs.Weapons.TryGetValue(w.ConfigId, out var existCfg)) return false;
//                 return (!string.IsNullOrEmpty(incomingCfg.WeaponFamily) && existCfg.WeaponFamily == incomingCfg.WeaponFamily) || w.ConfigId == incomingWeapon.ConfigId;
//             });

//             if (alreadyOwns) return false; // REJECT! The shop will not deduct gold.
//         }

//         // 3. Otherwise, try to put it in an empty slot (Max 2 slots!)
//         for (int i = 0; i < 2; i++)
//         {
//             if (!Weapons.Any(w => w.SlotIndex == i))
//             {
//                 incomingWeapon.SlotIndex = i;
//                 Weapons.Add(incomingWeapon);
//                 RecalculateSynergies(configs);
//                 return true;
//             }
//         }
//         return false; // Inventory is full
//     }

//     // >>> NEW: Safe Gear Removal Methods <<<
//     public void RemoveWeapon(int slotIndex, ConfigManager configs)
//     {
//         var weapon = Weapons.FirstOrDefault(w => w.SlotIndex == slotIndex);
//         if (weapon != null)
//         {
//             Weapons.Remove(weapon);
//             // Shift remaining slots so there are no gaps
//             var sorted = Weapons.OrderBy(w => w.SlotIndex).ToList();
//             for (int i = 0; i < sorted.Count; i++) sorted[i].SlotIndex = i;
//             RecalculateSynergies(configs);
//         }
//     }

//     public void RemoveItem(int slotIndex, ConfigManager configs)
//     {
//         var item = OwnedItems.FirstOrDefault(i => i.SlotIndex == slotIndex);
//         if (item != null)
//         {
//             OwnedItems.Remove(item);
//             var sorted = OwnedItems.OrderBy(i => i.SlotIndex).ToList();
//             for (int i = 0; i < sorted.Count; i++) sorted[i].SlotIndex = i;
//             RecalculateSynergies(configs);
//         }
//     }

//     // >>> NEW: Dynamic Item Cap based on Traits <<<
//     public int GetMaxItemSlots(ConfigManager configs)
//     {
//         // Base 5 slots + any bonus slots from traits/items!
//         return (int)Math.Max(1, 5 + GetEngineMechanic("bonusItemSlots", configs));
//     }

//     public bool TryAddOrMergeItem(EquippedItem incomingItem, ConfigManager configs)
//     {
//         configs.Items.TryGetValue(incomingItem.ConfigId, out var incomingCfg);

//         int maxLevel = incomingCfg?.MaxLevel ?? 5;
//         bool allowDupes = incomingCfg?.AllowDuplicates ?? false;

//         // 1. Find a match based on TIER and (FAMILY or EXACT ID)
//         var match = OwnedItems.FirstOrDefault(i =>
//         {
//             if (!configs.Items.TryGetValue(i.ConfigId, out var existingCfg) || incomingCfg == null) return false;

//             return existingCfg.Tier == incomingCfg.Tier &&
//                                (
//                                    (!string.IsNullOrEmpty(incomingCfg.ItemFamily) && existingCfg.ItemFamily == incomingCfg.ItemFamily)
//                                    || i.ConfigId == incomingItem.ConfigId
//                                )
//                                && i.Level < maxLevel; // <<< NEW: DO NOT MERGE IF IT HAS REACHED MAX LEVEL!

//         });

//         // 2. If we found a match, Merge them!
//         if (match != null)
//         {
//             OwnedItems.Remove(match);
//             var mergedItem = Server.Core.Systems.ItemGenerator.MergeItems(match, incomingItem, configs);
//             mergedItem.SlotIndex = match.SlotIndex;
//             OwnedItems.Add(mergedItem);
//             RecalculateSynergies(configs);
//             return true;
//         }

//         if (!allowDupes && incomingCfg != null)
//         {
//             bool alreadyOwns = OwnedItems.Any(i =>
//             {
//                 if (!configs.Items.TryGetValue(i.ConfigId, out var existCfg)) return false;
//                 return (!string.IsNullOrEmpty(incomingCfg.ItemFamily) && existCfg.ItemFamily == incomingCfg.ItemFamily) || i.ConfigId == incomingItem.ConfigId;
//             });
            
//             if (alreadyOwns) return false; // REJECT!
//         }

//         // 3. Otherwise, check the dynamic inventory cap!
//         if (OwnedItems.Count >= GetMaxItemSlots(configs)) return false; // Inventory is full!

//         incomingItem.SlotIndex = OwnedItems.Count;
//         OwnedItems.Add(incomingItem);
//         RecalculateSynergies(configs);
//         return true;
//     }
// }