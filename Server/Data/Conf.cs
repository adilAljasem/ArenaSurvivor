using System.ComponentModel.DataAnnotations;

namespace Server.Configs;

public class EmailSettings
{
    public string From { get; set; } = string.Empty;
    public string SmtpServer { get; set; } = string.Empty;
    public int Port { get; set; } = 587;
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public bool UseSsl { get; set; } = true;
}

public class JwtSettings
{
    public string SecretKey { get; set; } = string.Empty;
    public string Issuer { get; set; } = "ArenaSurvivor";
    public string Audience { get; set; } = "ArenaSurvivorPlayers";
    public int ExpirationDays { get; set; } = 30;
}

public class RoomSettings
{
    public int PauseTimeoutMinutes { get; set; } = 10;
    public int GracePeriodSeconds { get; set; } = 180;
    public bool AllowSpectators { get; set; } = true;
}


public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;

    // The persistent in-game identity — generated once on register, never changes.
    // This is what the server puts in the JWT and uses to identify the player in rooms.
    public Guid PlayerId { get; set; } = Guid.NewGuid();

    public bool IsEmailVerified { get; set; } = false;
    public string? VerificationToken { get; set; }
    public DateTime? VerificationTokenExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? ResetToken { get; set; }
    public DateTime? ResetTokenExpiresAt { get; set; }
}

public class MatchRecord
{
    [Key]
    public int Id { get; set; }
    public Guid PlayerId { get; set; }
    public string RoomId { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string ConfigId { get; set; } = string.Empty; // The character they played
    
    public string Difficulty { get; set; } = string.Empty;
    public int HighestWave { get; set; }
    
    public float TotalDamageDealt { get; set; }
    public float TotalDamageTaken { get; set; }
    public float TotalHealingDone { get; set; }
    public float TotalShieldingDone { get; set; }
    public int Kills { get; set; }
    public int Deaths { get; set; }
    
    public DateTime MatchDate { get; set; } = DateTime.UtcNow;
}

public class AchievementConfig
{
    public string Id { get; set; }
    public string Name { get; set; }
    public string Description { get; set; }
    public int Tier { get; set; }              // 1-4, same scale as gear
    public string TextureKey { get; set; }
    public int IconFrame { get; set; }
    public bool Hidden { get; set; }            // secret until unlocked
    public string Scope { get; set; }           // "Lifetime" | "SingleMatch"
    public string ConditionType { get; set; }   // "TotalKills", "HighestWaveReached", "TotalDamageDealt", "CharacterWaveCleared", etc.
    public string ConditionStat { get; set; }   // optional: characterId/difficulty for scoped conditions
    public float Threshold { get; set; }
}

