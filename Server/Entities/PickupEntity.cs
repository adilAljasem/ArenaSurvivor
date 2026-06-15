// namespace Server.Entities;

// public enum PickupType
// {
//     Gold = 0,
//     Weapon = 1,
//     Item = 2
// }

// public class PickupEntity
// {
//     private static int _pickupIdCounter = 0;
//     public string Id { get; set; } = Interlocked.Increment(ref _pickupIdCounter).ToString();
//     public float X { get; set; }
//     public float Y { get; set; }

//     // Gold value (only relevant when Type == Gold)
//     public int Value { get; set; }

//     public PickupType Type { get; set; } = PickupType.Gold;

//     // Populated when Type == Weapon; null otherwise
//     public EquippedWeapon? DroppedWeapon { get; set; }

//     // Populated when Type == Item; null otherwise
//     public EquippedItem? DroppedItem { get; set; }
// }