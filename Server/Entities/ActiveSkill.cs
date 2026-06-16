namespace Server.Entities;

public class ActiveSkill
{
    public string ConfigId { get; set; } = string.Empty;
    public float CurrentCooldown { get; set; }
    
    public bool IsCasting { get; set; }
    public float CurrentCastTimer { get; set; }
    public float CurrentChannelTimer { get; set; }
}