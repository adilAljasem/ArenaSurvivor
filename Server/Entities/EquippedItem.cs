namespace Server.Entities;
using System.Collections.Generic;

public class EquippedItem
{
    public string ConfigId { get; set; } = string.Empty;
    public int SlotIndex { get; set; }
    public int Level { get; set; } = 1;

    public List<string> MergedConfigIds { get; set; } = new();
    
    public Dictionary<string, float> TotalBaseStats { get; set; } = new();
    public Dictionary<string, float> RolledStats { get; set; } = new();
    
    // Tracks the cooldowns for the random skills attached to this item
    public List<ActiveSkill> ItemSkills { get; set; } = new();
}