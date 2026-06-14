namespace Server.Core.Events;

public struct SpawnProjectileEvent : IGameEvent
{
    public string ProjectileConfigId { get; }
    public string OwnerId { get; }
    public string Team { get; }
    public float StartX { get; }
    public float StartY { get; }
    public float DirX { get; }
    public float DirY { get; }
    public float PhysicalDamage { get; }
    public float MagicDamage { get; }
    public bool IsCritical { get; }

    public SpawnProjectileEvent(string configId, string ownerId, string team, float x, float y, float dx, float dy, float physDmg, float magicDmg, bool isCrit)
    {
        ProjectileConfigId = configId;
        OwnerId = ownerId;
        Team = team;
        StartX = x;
        StartY = y;
        DirX = dx;
        DirY = dy;
        PhysicalDamage = physDmg;
        MagicDamage = magicDmg;
        IsCritical = isCrit;
    }
}