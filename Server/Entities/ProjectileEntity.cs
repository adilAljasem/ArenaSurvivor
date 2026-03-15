namespace Server.Entities;

public class ProjectileEntity
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string ConfigId { get; set; } = string.Empty; // Tells the UI what sprite to draw!
    public string OwnerId { get; set; } = string.Empty;
    public float X { get; set; }
    public float Y { get; set; }
    public float VelX { get; set; }
    public float VelY { get; set; }
    public float Damage { get; set; }
    public float DistanceTraveled { get; set; }
    public float LifeStealChance { get; set; }
    // >>> NEW: Melee & Pierce Mechanics! <<<
    public float HitRadius { get; set; } = 15f;
    public float Lifespan { get; set; } = 1f;
    public int PierceCount { get; set; } = 0;
    public HashSet<string> HitEnemies { get; set; } = new();
}