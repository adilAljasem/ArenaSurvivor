// using Server.Core;
// using System.Collections.Generic;
// using System.Text.Json.Serialization;

// namespace Server.Entities;

// /// <summary>
// /// Shared base for PlayerEntity and EnemyEntity.
// /// Holds all properties that are common to any actor in the game world.
// /// </summary>
// public abstract class BaseActorEntity
// {
    
//     // --- World Position ---
//     public float X { get; set; }
//     public float Y { get; set; }

//     public float CurrentSweepAngle { get; set; } = 0f;


//     // >>> THE FIX: Changing HP instantly flags the entity as Dirty! <<<
//     private float _currentHp;
//     public float CurrentHp
//     {
//         get => _currentHp;
//         set
//         {
//             if (_currentHp != value)
//             {
//                 _currentHp = value;
//                 StatsNeedRecalculation = true;
//             }
//         }
//     }

//     // --- Stats ---
//     public StatDictionary Stats { get; set; } = new();

//     // --- Team & State ---
//     public string Team { get; set; } = string.Empty;
//     public string ActionState { get; set; } = "Idle";

//     // --- Inventory ---
//     public List<EquippedWeapon> Weapons { get; set; } = new();
//     public List<EquippedItem> OwnedItems { get; set; } = new();

//     // --- Status Effects ---
//     public List<ActiveEffect> ActiveEffects { get; set; } = new();

//     // --- Skills ---
//     public List<ActiveSkill> Skills { get; set; } = new();
//     public string CurrentCastingSkillId { get; set; } = string.Empty;
//     public float CurrentCastTimer { get; set; }
//     public float MaxCastTimer { get; set; }
//     public Dictionary<string, float> DynamicSkillTimers { get; set; } = new();

//     // >>> THE NEW ECS STAT CACHE <<<
//     [JsonIgnore]
//     public Dictionary<string, float> CachedStats { get; set; } = new();
//     [JsonIgnore]
//     public bool StatsNeedRecalculation { get; set; } = true;
//     public float CurrentMaxHp { get; set; }

//     // Instantly returns O(1) without doing any math!
//     public float GetTotalStat(string statName, Configs.ConfigManager configManager = null, GameState state = null)
//     {
//         return CachedStats.GetValueOrDefault(statName, 0f);
//     }
// }

