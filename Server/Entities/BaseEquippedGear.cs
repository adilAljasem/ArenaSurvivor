// namespace Server.Entities;
// using System.Collections.Generic;

// /// <summary>
// /// Shared base for EquippedWeapon and EquippedItem.
// /// Holds the identity, ancestry, pre-calculated stats, and rolled stats
// /// that are identical on both gear types.
// /// </summary>
// public abstract class BaseEquippedGear
// {
//     public string ConfigId { get; set; } = string.Empty;
//     public int Level { get; set; } = 1;

//     // Tracks which config IDs were merged to produce this gear (used for stat recalculation)
//     public List<string> MergedConfigIds { get; set; } = new();

//     // Pre-calculated sum of all base stats from every merged config
//     public Dictionary<string, float> TotalBaseStats { get; set; } = new();

//     // Unique random stats rolled specifically for this instance
//     public Dictionary<string, float> RolledStats { get; set; } = new();
// }
