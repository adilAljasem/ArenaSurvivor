namespace Server.Entities;

public class ProjectileEntity
{
    private static int _projIdCounter = 0;
    public string Id { get; set; } = Interlocked.Increment(ref _projIdCounter).ToString(); public string ConfigId { get; set; } = string.Empty; // Tells the UI what sprite to draw!
    public string OwnerId { get; set; } = string.Empty;
    public float X { get; set; }
    public float Y { get; set; }
    public float VelX { get; set; }
    public float VelY { get; set; }
    public float Damage { get; set; }
    public float LifeStealChance { get; set; }
    // >>> NEW: Melee & Pierce Mechanics! <<<
    public float HitRadius { get; set; } = 15f;
    public float Lifespan { get; set; } = 1f;
    public int PierceCount { get; set; } = 0;
    // >>> NEW: Orbit & Death Mechanics <<<
    public string MovementBehavior { get; set; } = "Linear";
    public float OrbitRadius { get; set; }
    public float OrbitAngleOffset { get; set; }
    public string OnDeathSkillId { get; set; } = string.Empty;

    public string Team { get; set; } = string.Empty;
    public HashSet<string> HitEnemies { get; set; } = new();
    public List<string> ApplyEffectsOnHit { get; set; } = new();
}