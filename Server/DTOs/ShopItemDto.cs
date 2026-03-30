namespace Server.DTOs;

public class ShopItemDto
{
    public string ConfigId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int Price { get; set; }
    public bool IsLocked { get; set; } = false; // NEW

    // >>> NEW: Store random stats before buying! <<<
    public Dictionary<string, float>? RolledStats { get; set; }
    public List<string>? WeaponSkills { get; set; }

}