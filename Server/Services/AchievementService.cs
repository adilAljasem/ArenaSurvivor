using Microsoft.EntityFrameworkCore;
using Server.Configs;
using Server.Data;
using Server.DTOs;
using System.Text.Json;

namespace Server.Core.Services;

/// <summary>
/// Stateless service (safe as a Singleton — takes ApplicationDbContext per-call rather than
/// holding one). Evaluates AchievementConfig conditions and unlocks new UserAchievement rows.
///
/// IMPORTANT: "Lifetime" scope conditions read from UserLifetimeStats — a permanent per-player
/// aggregate row maintained incrementally by UpdateLifetimeStatsAsync — NOT from scanning the
/// full MatchRecord table. This is what makes it safe to prune/archive old MatchRecord rows on
/// any retention schedule without silently undoing players' earned lifetime progress, and keeps
/// lifetime checks O(1) instead of O(match count) as history grows. "SingleMatch" scope still
/// reads the just-saved MatchRecord directly, since that's inherently about one specific match.
///
/// ConditionType reference:
///   "LifetimeStat"       (Lifetime)   — running total of StatName. StatName is one of:
///                                       "kills","deaths","damageDealt","damageTaken","healingDone","shieldingDone".
///   "SingleMatchStat"    (SingleMatch)— same StatName options, checked against one match's row.
///   "HighestWaveReached" (either)     — best wave reached (single match, or best-ever if Lifetime).
///   "MatchesPlayed"      (Lifetime)   — total matches played.
///   "MaxStatByWave"      (SingleMatch)— StatName (ANY key in ConfigManager.AllStats, e.g. "maxHp",
///                                       "critChance") peaked at/above Threshold while HighestWave
///                                       was still at or below ConditionStat (the wave limit).
///   "MaxStatReached"     (Lifetime)   — StatName ever peaked at/above Threshold in any match, no wave limit.
///   "NoHitWaveClear"     (SingleMatch)— reached wave Threshold with zero damage taken so far.
///   "LimitedWeaponsWaveCleared" (SingleMatch) — reached wave Threshold while never exceeding
///                                       ConditionStat weapon slots filled at once.
///   "CharacterWaveCleared" (either)   — reached wave Threshold playing character ConditionStat.
///   "DifficultyWaveCleared" (either)  — reached wave Threshold on difficulty ConditionStat.
///   "GearMaxLevel"        (flag)      — evaluated live via EvaluateFlagAsync, not through this
///                                       match-record pipeline at all (see MatchHub.BuyItem).
/// </summary>
public class AchievementService
{
    private readonly ConfigManager _configs;

    public AchievementService(ConfigManager configs)
    {
        _configs = configs;
    }

    // Fixed MatchRecord columns exposed as a flexible named-stat accessor, so "LifetimeStat"/
    // "SingleMatchStat" cover kills/damage/healing/shielding through ONE condition type instead
    // of a dedicated ConditionType string per stat.
    private static float GetMatchStatValue(MatchRecord m, string statName) => statName switch
    {
        "kills" => m.Kills,
        "deaths" => m.Deaths,
        "damageDealt" => m.TotalDamageDealt,
        "damageTaken" => m.TotalDamageTaken,
        "healingDone" => m.TotalHealingDone,
        "shieldingDone" => m.TotalShieldingDone,
        _ => 0f
    };

    private static float GetLifetimeStatValue(UserLifetimeStats s, string statName) => statName switch
    {
        "kills" => s.TotalKills,
        "deaths" => s.TotalDeaths,
        "damageDealt" => (float)s.TotalDamageDealt,
        "damageTaken" => (float)s.TotalDamageTaken,
        "healingDone" => (float)s.TotalHealingDone,
        "shieldingDone" => (float)s.TotalShieldingDone,
        _ => 0f
    };

    private static Dictionary<string, float> ParsePeakStats(MatchRecord m) => ParseFloatMap(m.PeakStatsJson);

    private static Dictionary<string, float> ParseFloatMap(string json)
    {
        if (string.IsNullOrEmpty(json)) return new();
        try { return JsonSerializer.Deserialize<Dictionary<string, float>>(json) ?? new(); }
        catch { return new(); }
    }

    private static Dictionary<string, int> ParseIntMap(string json)
    {
        if (string.IsNullOrEmpty(json)) return new();
        try { return JsonSerializer.Deserialize<Dictionary<string, int>>(json) ?? new(); }
        catch { return new(); }
    }

    /// <summary>
    /// Maintains the permanent per-player aggregate — call once per player, per
    /// SaveMatchResultsToDatabaseAsync save, right alongside (not instead of) writing the
    /// MatchRecord row. Additive stats are passed as DELTAS (the change since this same
    /// match's last save) so repeated wave-end saves of one growing match don't double-count;
    /// max-tracked fields are passed as the match's current absolute values, since compare-
    /// and-set is naturally idempotent and needs no delta math.
    /// </summary>
    public async Task UpdateLifetimeStatsAsync(
        ApplicationDbContext db, Guid playerId,
        int killsDelta, int deathsDelta, float dmgDealtDelta, float dmgTakenDelta, float healDelta, float shieldDelta,
        bool isNewMatch,
        int currentHighestWave, string configId, string difficulty,
        int currentMatchKills, float currentMatchDmgDealt, float currentMatchDmgTaken, float currentMatchHealing, float currentMatchShielding,
        Dictionary<string, float> currentPeakStats)
    {
        var stats = await db.UserLifetimeStats.FirstOrDefaultAsync(s => s.PlayerId == playerId);
        if (stats == null)
        {
            stats = new UserLifetimeStats { PlayerId = playerId };
            db.UserLifetimeStats.Add(stats);
        }

        stats.TotalKills += killsDelta;
        stats.TotalDeaths += deathsDelta;
        stats.TotalDamageDealt += dmgDealtDelta;
        stats.TotalDamageTaken += dmgTakenDelta;
        stats.TotalHealingDone += healDelta;
        stats.TotalShieldingDone += shieldDelta;

        if (isNewMatch) stats.MatchesPlayed++;

        stats.BestWaveEver = Math.Max(stats.BestWaveEver, currentHighestWave);

        var perCharacter = ParseIntMap(stats.BestWavePerCharacterJson);
        perCharacter[configId] = Math.Max(perCharacter.GetValueOrDefault(configId, 0), currentHighestWave);
        stats.BestWavePerCharacterJson = JsonSerializer.Serialize(perCharacter);

        var perDifficulty = ParseIntMap(stats.BestWavePerDifficultyJson);
        perDifficulty[difficulty] = Math.Max(perDifficulty.GetValueOrDefault(difficulty, 0), currentHighestWave);
        stats.BestWavePerDifficultyJson = JsonSerializer.Serialize(perDifficulty);

        var bestPeaks = ParseFloatMap(stats.BestPeakStatsJson);
        foreach (var kv in currentPeakStats)
            bestPeaks[kv.Key] = Math.Max(bestPeaks.GetValueOrDefault(kv.Key, 0f), kv.Value);
        stats.BestPeakStatsJson = JsonSerializer.Serialize(bestPeaks);

        var bestSingleMatch = ParseFloatMap(stats.BestSingleMatchStatsJson);
        bestSingleMatch["kills"] = Math.Max(bestSingleMatch.GetValueOrDefault("kills", 0f), currentMatchKills);
        bestSingleMatch["damageDealt"] = Math.Max(bestSingleMatch.GetValueOrDefault("damageDealt", 0f), currentMatchDmgDealt);
        bestSingleMatch["damageTaken"] = Math.Max(bestSingleMatch.GetValueOrDefault("damageTaken", 0f), currentMatchDmgTaken);
        bestSingleMatch["healingDone"] = Math.Max(bestSingleMatch.GetValueOrDefault("healingDone", 0f), currentMatchHealing);
        bestSingleMatch["shieldingDone"] = Math.Max(bestSingleMatch.GetValueOrDefault("shieldingDone", 0f), currentMatchShielding);
        stats.BestSingleMatchStatsJson = JsonSerializer.Serialize(bestSingleMatch);

        stats.LastUpdated = DateTime.UtcNow;
        // Deliberately no SaveChangesAsync here — the caller (GameRoom) saves this in the same
        // batch as the MatchRecord write, so both land in one transaction.
    }

    /// <summary>
    /// Call right after a MatchRecord (and its UserLifetimeStats delta) has been saved.
    /// Returns the list of newly-unlocked achievement ids (empty if none).
    /// </summary>
    public async Task<List<string>> EvaluateAndUnlockAsync(ApplicationDbContext db, Guid userId, MatchRecord currentMatch)
    {
        var alreadyUnlocked = await db.UserAchievements
            .Where(u => u.UserId == userId)
            .Select(u => u.AchievementId)
            .ToHashSetAsync();

        UserLifetimeStats? lifetimeStats = null;
        bool lifetimeStatsFetched = false;

        var newlyUnlocked = new List<string>();

        foreach (var achievement in _configs.Achievements.Values)
        {
            if (alreadyUnlocked.Contains(achievement.Id)) continue;

            bool met;
            if (achievement.Scope == "SingleMatch")
            {
                met = EvaluateSingleMatch(achievement, currentMatch);
            }
            else
            {
                if (!lifetimeStatsFetched)
                {
                    lifetimeStats = await db.UserLifetimeStats.FirstOrDefaultAsync(s => s.PlayerId == userId);
                    lifetimeStatsFetched = true;
                }
                met = lifetimeStats != null && EvaluateLifetime(achievement, lifetimeStats);
            }

            if (met)
            {
                db.UserAchievements.Add(new UserAchievement
                {
                    UserId = userId,
                    AchievementId = achievement.Id,
                    UnlockedAt = DateTime.UtcNow
                });
                newlyUnlocked.Add(achievement.Id);
            }
        }

        if (newlyUnlocked.Count > 0)
            await db.SaveChangesAsync();

        return newlyUnlocked;
    }

    private bool EvaluateSingleMatch(AchievementConfig a, MatchRecord m)
    {
        if (a.ConditionType == "CharacterWaveCleared" && m.ConfigId != a.ConditionStat) return false;
        if (a.ConditionType == "DifficultyWaveCleared" && m.Difficulty != a.ConditionStat) return false;

        return a.ConditionType switch
        {
            "SingleMatchStat" => GetMatchStatValue(m, a.StatName) >= a.Threshold,
            "HighestWaveReached" or "CharacterWaveCleared" or "DifficultyWaveCleared" => m.HighestWave >= a.Threshold,

            // Reach wave <Threshold> without ever taking damage. Approximate but effective:
            // evaluated right after every wave-end save, so it catches the moment
            // TotalDamageTaken is still 0 and HighestWave crosses the threshold — damage
            // taken in later waves doesn't retroactively invalidate an already-granted unlock.
            "NoHitWaveClear" => m.HighestWave >= a.Threshold && m.TotalDamageTaken <= 0f,

            // Reach wave <Threshold> while never having more than <ConditionStat> weapon
            // slots filled at once during the run.
            "LimitedWeaponsWaveCleared" => m.HighestWave >= a.Threshold
                && int.TryParse(a.ConditionStat, out int maxWeapons) && m.PeakWeaponsEquipped <= maxWeapons,

            // Generic: any stat (StatName) peaked at/above Threshold while HighestWave was
            // still at or below the wave limit (ConditionStat). Works for maxHp, critChance,
            // luck, or any future stat — no server code changes needed to add more.
            "MaxStatByWave" => int.TryParse(a.ConditionStat, out int waveLimit) && m.HighestWave <= waveLimit
                && ParsePeakStats(m).GetValueOrDefault(a.StatName, 0f) >= a.Threshold,

            _ => false
        };
    }

    private bool EvaluateLifetime(AchievementConfig a, UserLifetimeStats s)
    {
        if (a.ConditionType == "CharacterWaveCleared")
            return ParseIntMap(s.BestWavePerCharacterJson).GetValueOrDefault(a.ConditionStat, 0) >= a.Threshold;
        if (a.ConditionType == "DifficultyWaveCleared")
            return ParseIntMap(s.BestWavePerDifficultyJson).GetValueOrDefault(a.ConditionStat, 0) >= a.Threshold;

        return a.ConditionType switch
        {
            "LifetimeStat" => GetLifetimeStatValue(s, a.StatName) >= a.Threshold,
            "MatchesPlayed" => s.MatchesPlayed >= a.Threshold,
            "HighestWaveReached" => s.BestWaveEver >= a.Threshold,

            // Generic: any stat (StatName) ever peaked at/above Threshold in any single match,
            // with no wave-limit constraint (unlike MaxStatByWave).
            "MaxStatReached" => ParseFloatMap(s.BestPeakStatsJson).GetValueOrDefault(a.StatName, 0f) >= a.Threshold,

            _ => false
        };
    }

    /// <summary>
    /// For achievements whose condition is checked live at the moment it becomes true
    /// (not derivable from MatchRecord history) — e.g. "level a weapon/item to max level".
    /// Caller has already verified the condition is true; this just unlocks any matching,
    /// not-yet-unlocked achievements of that ConditionType.
    /// </summary>
    public async Task<List<string>> EvaluateFlagAsync(ApplicationDbContext db, Guid userId, string conditionType)
    {
        var alreadyUnlocked = await db.UserAchievements
            .Where(u => u.UserId == userId)
            .Select(u => u.AchievementId)
            .ToHashSetAsync();

        var newlyUnlocked = new List<string>();
        foreach (var a in _configs.Achievements.Values.Where(x => x.ConditionType == conditionType))
        {
            if (alreadyUnlocked.Contains(a.Id)) continue;
            db.UserAchievements.Add(new UserAchievement { UserId = userId, AchievementId = a.Id, UnlockedAt = DateTime.UtcNow });
            newlyUnlocked.Add(a.Id);
        }

        if (newlyUnlocked.Count > 0)
            await db.SaveChangesAsync();

        return newlyUnlocked;
    }

    /// <summary>Just the unlocked ids — cheap, used to populate PlayerEntity.UnlockedAchievementIds on lobby join.</summary>
    public async Task<HashSet<string>> GetUnlockedAchievementIdsAsync(ApplicationDbContext db, Guid userId)
    {
        return await db.UserAchievements
            .Where(u => u.UserId == userId)
            .Select(u => u.AchievementId)
            .ToHashSetAsync();
    }

    /// <summary>Full catalog + unlock state + progress, for the lobby Achievements panel. O(1)
    /// against player history size — reads the aggregate row, never scans MatchRecords.</summary>
    public async Task<List<AchievementProgressDto>> GetCatalogWithProgressAsync(ApplicationDbContext db, Guid userId)
    {
        var unlocked = await db.UserAchievements
            .Where(u => u.UserId == userId)
            .ToDictionaryAsync(u => u.AchievementId, u => u.UnlockedAt);

        var stats = await db.UserLifetimeStats.FirstOrDefaultAsync(s => s.PlayerId == userId);
        var bestWavePerCharacter = stats != null ? ParseIntMap(stats.BestWavePerCharacterJson) : new();
        var bestWavePerDifficulty = stats != null ? ParseIntMap(stats.BestWavePerDifficultyJson) : new();
        var bestPeakStats = stats != null ? ParseFloatMap(stats.BestPeakStatsJson) : new();
        var bestSingleMatchStats = stats != null ? ParseFloatMap(stats.BestSingleMatchStatsJson) : new();

        var results = new List<AchievementProgressDto>();

        foreach (var a in _configs.Achievements.Values)
        {
            bool isUnlocked = unlocked.ContainsKey(a.Id);

            if (a.Hidden && !isUnlocked)
            {
                results.Add(new AchievementProgressDto
                {
                    Id = a.Id,
                    Tier = a.Tier,
                    IsUnlocked = false,
                    IsHidden = true,
                    Threshold = a.Threshold
                });
                continue;
            }

            float progress = a.ConditionType switch
            {
                "LifetimeStat" => stats != null ? GetLifetimeStatValue(stats, a.StatName) : 0,
                "SingleMatchStat" => bestSingleMatchStats.GetValueOrDefault(a.StatName, 0f),
                "MatchesPlayed" => stats?.MatchesPlayed ?? 0,
                "HighestWaveReached" => stats?.BestWaveEver ?? 0,
                // Approximate: shows progress toward the wave target; the no-hit / weapon-limit
                // constraint itself is all-or-nothing and only visible via the unlock itself.
                "NoHitWaveClear" => stats?.BestWaveEver ?? 0,
                "LimitedWeaponsWaveCleared" => stats?.BestWaveEver ?? 0,
                "MaxStatByWave" or "MaxStatReached" => bestPeakStats.GetValueOrDefault(a.StatName, 0f),
                "CharacterWaveCleared" => bestWavePerCharacter.GetValueOrDefault(a.ConditionStat, 0),
                "DifficultyWaveCleared" => bestWavePerDifficulty.GetValueOrDefault(a.ConditionStat, 0),
                _ => 0
            };

            results.Add(new AchievementProgressDto
            {
                Id = a.Id,
                Name = a.Name,
                Description = a.Description,
                Tier = a.Tier,
                TextureKey = a.TextureKey,
                IconFrame = a.IconFrame,
                IsUnlocked = isUnlocked,
                IsHidden = false,
                UnlockedAt = isUnlocked ? unlocked[a.Id] : null,
                Progress = Math.Min(progress, a.Threshold),
                Threshold = a.Threshold
            });
        }

        return results;
    }
}