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

    // --- Admin panel ---
    public bool IsAdmin { get; set; } = false;
    public bool IsBanned { get; set; } = false;
    public string? BanReason { get; set; }
    public DateTime? BannedAt { get; set; }
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

    // Peak values reached during the match — used by achievements that need more than the
    // final/cumulative totals (e.g. "clear wave 20 with only 2 weapons", "reach 5000 max HP").
    public int PeakWeaponsEquipped { get; set; }

    // JSON-serialized Dictionary<string,float> of the highest value every stat reached this
    // match (keyed by the same stat names as ConfigManager.AllStats). Stored as a blob rather
    // than one column per stat so new stats never require a migration.
    public string PeakStatsJson { get; set; } = "{}";

    public DateTime MatchDate { get; set; } = DateTime.UtcNow;
}

public class UserAchievement
{
    [Key]
    public int Id { get; set; }
    public Guid UserId { get; set; }

    // Matches AchievementConfig.Id (data-driven, not an FK — config can be hot-reloaded/edited
    // freely without touching the DB).
    public string AchievementId { get; set; } = string.Empty;

    public DateTime UnlockedAt { get; set; } = DateTime.UtcNow;
}