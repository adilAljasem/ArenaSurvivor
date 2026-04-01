namespace Server.Entities;

public class EquippedWeapon
{
    public string ConfigId { get; set; } = string.Empty;
    public int SlotIndex { get; set; }
    public float CurrentCooldown { get; set; }
    public int Level { get; set; } = 1; // NEW: Merging upgrades this!
    // >>> NEW: Replaces "Level" and keeps bandwidth tiny! <<<
    // Example: ["pistol", "pistol_t2"]
    public List<string> MergedConfigIds { get; set; } = new();
    // >>> NEW: The server calculates the exact final base stats and stores them here! <<<
    public Dictionary<string, float> TotalBaseStats { get; set; } = new();

    // Remembers the unique stats rolled on THIS specific weapon
    public Dictionary<string, float> RolledStats { get; set; } = new();

    // Tracks the cooldowns for the random skills attached to this weapon
    public List<ActiveSkill> WeaponSkills { get; set; } = new();
}
