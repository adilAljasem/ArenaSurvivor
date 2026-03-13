namespace Server.Entities;

public class EquippedWeapon
{
    public string ConfigId { get; set; } = string.Empty;
    public int SlotIndex { get; set; } 
    public float CurrentCooldown { get; set; }
    public int Level { get; set; } = 1; // NEW: Merging upgrades this!
}