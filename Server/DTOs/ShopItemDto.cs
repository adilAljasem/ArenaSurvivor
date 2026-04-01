namespace Server.DTOs;
using System.Collections.Generic;

public class ShopItemDto
{
    public string ConfigId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int Price { get; set; }
    public bool IsLocked { get; set; } = false;
    public Dictionary<string, float>? TotalBaseStats { get; set; }

    public Dictionary<string, float>? RolledStats { get; set; }
    public List<string>? WeaponSkills { get; set; }
}