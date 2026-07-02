namespace Server.DTOs;
public class RoomTransferDto
{
    public string RoomId { get; set; } = string.Empty;
    public string RoomName { get; set; } = string.Empty;
    public string HostConnectionId { get; set; } = string.Empty;
    public string CurrentMapId { get; set; } = string.Empty;
    public string Difficulty { get; set; } = string.Empty;
    public List<PlayerTransferDto> Players { get; set; } = new();
}

public class PlayerTransferDto
{
    public string OldConnectionId { get; set; } = string.Empty;
    public string PlayerId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string ConfigId { get; set; } = string.Empty;
    public List<string> UnlockedAchievementIds { get; set; } = new();

}
public class DamageEventDto
{
    public float X { get; set; }
    public float Y { get; set; }
    public float Amount { get; set; }
    public bool IsCritical { get; set; }
    public bool IsDodge { get; set; } 
    public bool IsBlock { get; set; } 
}

public class PlayerInputDto
{
    public float DirX { get; set; }
    public float DirY { get; set; }
    public float AimX { get; set; } // Mouse X
    public float AimY { get; set; } // Mouse Y
}

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

public class BeamEventDto
{
    public float StartX { get; set; }
    public float StartY { get; set; }
    public float TargetX { get; set; }
    public float TargetY { get; set; }
    public float Width { get; set; }
    public string ColorTint { get; set; } = string.Empty;
}


public class AoeEventDto
{
    public float X { get; set; }
    public float Y { get; set; }
    public float Radius { get; set; }
    public bool IsFriendly { get; set; } 
    public string ConfigId { get; set; } = string.Empty; 
}


public class AchievementProgressDto
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public int Tier { get; set; }
    public string TextureKey { get; set; } = string.Empty;
    public int IconFrame { get; set; }

    public bool IsUnlocked { get; set; }

    // True when this is a Hidden achievement the player hasn't earned yet — Name/Description
    // are intentionally left blank in that case so the catalog doesn't spoil it.
    public bool IsHidden { get; set; }

    public DateTime? UnlockedAt { get; set; }

    // Current progress vs Threshold. For "SingleMatch" scope this is the player's best-ever
    // single-match attempt at that condition, not a running lifetime total.
    public float Progress { get; set; }
    public float Threshold { get; set; }
}