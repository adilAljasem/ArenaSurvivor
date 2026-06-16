namespace Server.Entities;

public class EquippedWeapon : BaseEquippedGear
{
    public int SlotIndex { get; set; }
    public float CurrentCooldown { get; set; }

    // Tracks the cooldowns for the random skills attached to this weapon
    public List<ActiveSkill> WeaponSkills { get; set; } = new();
}
