namespace Server.Entities;

public class ProjectileEntity
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string OwnerId { get; set; } = string.Empty; // So players don't shoot themselves
    public float X { get; set; }
    public float Y { get; set; }
    public float VelX { get; set; }
    public float VelY { get; set; }
    public float Damage { get; set; }
    public float MaxRange { get; set; }
    public float LifeStealChance { get; set; }
}