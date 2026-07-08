using System.ComponentModel.DataAnnotations;

namespace Server.Data;

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

    // Recorded at registration, server-side, from the account's own creation moment — this is
    // the actual evidence of acceptance, not just the client-side checkbox being checked.
    public DateTime? TermsAcceptedAt { get; set; }

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

/// <summary>
/// Permanent per-player running totals, updated incrementally (by delta) every time a
/// MatchRecord is saved. This is what "Lifetime" achievements read from — NOT the raw
/// MatchRecord table — so match history can be pruned/archived on any retention schedule
/// without affecting a player's earned progress. Also turns lifetime achievement checks from
/// an O(match count) full-history scan into an O(1) row lookup.
/// </summary>
public class UserLifetimeStats
{
    [Key]
    public Guid PlayerId { get; set; }

    public long TotalKills { get; set; }
    public long TotalDeaths { get; set; }
    public double TotalDamageDealt { get; set; }
    public double TotalDamageTaken { get; set; }
    public double TotalHealingDone { get; set; }
    public double TotalShieldingDone { get; set; }

    // Incremented once per NEW match (not per wave-save), so this stays an accurate match count
    // even though a single match triggers many saves as waves progress.
    public int MatchesPlayed { get; set; }

    // Running maximums (not sums) — safe to just compare-and-set on every save, no delta math needed.
    public int BestWaveEver { get; set; }

    // JSON-serialized Dictionary<string,int>: best wave ever reached per characterId.
    public string BestWavePerCharacterJson { get; set; } = "{}";

    // JSON-serialized Dictionary<string,int>: best wave ever reached per difficulty.
    public string BestWavePerDifficultyJson { get; set; } = "{}";

    // JSON-serialized Dictionary<string,float>: best-ever peak value per stat (mirrors
    // PlayerEntity.PeakStats, but the all-time high across every match, not just the current one).
    public string BestPeakStatsJson { get; set; } = "{}";

    // JSON-serialized Dictionary<string,float>: best-ever SINGLE-MATCH value for kills/
    // damageDealt/damageTaken/healingDone/shieldingDone. Without this, a "SingleMatchStat"
    // achievement's progress bar would silently reset if the match containing someone's
    // personal best ever got pruned — this makes progress display fully independent of
    // whether the underlying MatchRecord still exists.
    public string BestSingleMatchStatsJson { get; set; } = "{}";

    public DateTime LastUpdated { get; set; } = DateTime.UtcNow;
}