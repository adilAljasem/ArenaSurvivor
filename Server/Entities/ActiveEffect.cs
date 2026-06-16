namespace Server.Entities;

public class ActiveEffect
{
    public string ConfigId { get; set; } = string.Empty;
    
    // How much longer this effect lasts
    public float TimeRemaining { get; set; }
    
    // Tracks when to deal the next "tick" of damage
    public float TimeSinceLastTick { get; set; }
    
    // Who caused this effect? (Useful if an enemy dies to poison and we need to know which Player gets the Gold/XP!)
    public string SourceId { get; set; } = string.Empty; 
}