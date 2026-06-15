// using Server.Configs;
// using Server.Core;
// using Server.Core.Systems;
// using System;
// using System.Linq;

// namespace Server.Entities;

// public class EnemyEntity : BaseActorEntity
// {
//     private static int _enemyIdCounter = 0;
//     public string Id { get; set; } = Interlocked.Increment(ref _enemyIdCounter).ToString();
//     public string ConfigId { get; set; } = string.Empty;
//     public float HitRadius { get; set; }

//     // Networked state and internal timer for animations
//     public float DespawnTimer { get; set; } = 1.0f;
//     public float AttackCooldown { get; set; } = 0f;
//     public float SkillWaitTimer { get; set; } = 0f;

//     public float WanderTargetX { get; set; } = -1f;
//     public float WanderTargetY { get; set; } = -1f;
//     public float WanderTimer { get; set; } = 0f;

//     // Aim direction (toward current target) – sent to client for weapon rotation
//     public float AimX { get; set; }
//     public float AimY { get; set; }

//     // Tracks which weapon slots fired this tick (cleared at end of network tick)
//     public List<int> FiredWeaponsThisTick { get; set; } = new();
//     public int CurrentSkillIndex { get; set; } = 0;

//     // Initializes the enemy with the Master Stat List so it never crashes
//     public void Initialize(Configs.EnemyConfig config, float spawnX, float spawnY, ConfigManager configManager)
//     {
//         Team = "Enemy";
//         ConfigId = config.Id;
//         X = spawnX;
//         Y = spawnY;

//         HitRadius = config.HitRadius * config.Scale;

//         // 1. Initialize EVERY stat dynamically from the JSON file!
//         foreach (var stat in configManager.AllStats)
//         {
//             Stats.InitializeStat(stat, 0f);
//         }

//         // 2. Overwrite with Enemy's base stats from JSON
//         if (config.BaseStats != null)
//         {
//             foreach (var stat in config.BaseStats)
//             {
//                 Stats.InitializeStat(stat.Key, stat.Value);
//             }
//         }

//         if (config.StartingSkills != null)
//         {
//             foreach (var skillId in config.StartingSkills)
//             {
//                 Skills.Add(new ActiveSkill { ConfigId = skillId, IsCasting = false, CurrentCooldown = 0f });
//             }
//         }

//         // 3. Equip starting weapons from config (with optional per-slot tier override)
//         if (config.StartingWeapons != null)
//         {
//             for (int i = 0; i < config.StartingWeapons.Count; i++)
//             {
//                 var weaponId = config.StartingWeapons[i];
//                 if (configManager.Weapons.ContainsKey(weaponId))
//                 {
//                     int tier = (config.StartingWeaponTiers != null && i < config.StartingWeaponTiers.Count)
//                         ? config.StartingWeaponTiers[i] : 1;
//                     var weapon = WeaponGenerator.GenerateWeapon(weaponId, 0f, configManager, tier);
//                     weapon.SlotIndex = Weapons.Count;
//                     Weapons.Add(weapon);
//                 }
//             }
//         }

//         // 4. Equip starting items from config (with optional per-slot tier override)
//         if (config.StartingItems != null)
//         {
//             for (int i = 0; i < config.StartingItems.Count; i++)
//             {
//                 var itemId = config.StartingItems[i];
//                 if (configManager.Items.ContainsKey(itemId))
//                 {
//                     int tier = (config.StartingItemTiers != null && i < config.StartingItemTiers.Count)
//                         ? config.StartingItemTiers[i] : 1;
//                     var item = ItemGenerator.GenerateItem(itemId, 0f, configManager, tier);
//                     item.SlotIndex = OwnedItems.Count;
//                     OwnedItems.Add(item);
//                 }
//             }
//         }

//         foreach (var weapon in Weapons)
//         {
//             if (weapon.WeaponSkills != null)
//             {
//                 foreach (var s in weapon.WeaponSkills)
//                 {
//                     if (!Skills.Any(x => x.ConfigId == s.ConfigId))
//                         Skills.Add(new ActiveSkill { ConfigId = s.ConfigId, CurrentCooldown = 0f });
//                 }
//             }
//         }
//         foreach (var item in OwnedItems)
//         {
//             if (item.ItemSkills != null)
//             {
//                 foreach (var s in item.ItemSkills)
//                 {
//                     if (!Skills.Any(x => x.ConfigId == s.ConfigId))
//                         Skills.Add(new ActiveSkill { ConfigId = s.ConfigId, CurrentCooldown = 0f });
//                 }
//             }
//         }

//         CurrentHp = GetTotalStat("maxHp", configManager);
//         SkillWaitTimer = (float)(Random.Shared.NextDouble() * 10.0 + 5.0);
//     }

   
// }