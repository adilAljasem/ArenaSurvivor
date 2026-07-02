using Microsoft.EntityFrameworkCore;
using Server.Configs;
using Server.Data;
using Server.DTOs;
using System.Text.Json;

namespace Server.Core.Services;

/// <summary>
/// Stateless service (safe as a Singleton — takes ApplicationDbContext per-call rather than
/// holding one). Evaluates AchievementConfig conditions against a player's MatchRecord history
/// and unlocks new UserAchievement rows.
///
/// ConditionType reference:
///   "LifetimeStat"       (Lifetime)   — sum of StatName across ALL matches. StatName is one of:
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

    private static Dictionary<string, float> ParsePeakStats(MatchRecord m)
    {
        if (string.IsNullOrEmpty(m.PeakStatsJson)) return new();
        try { return JsonSerializer.Deserialize<Dictionary<string, float>>(m.PeakStatsJson) ?? new(); }
        catch { return new(); }
    }

    /// <summary>
    /// Call right after a MatchRecord has been saved (GameRoom.SaveMatchResultsToDatabaseAsync).
    /// Returns the list of newly-unlocked achievement ids (empty if none).
    /// </summary>
    public async Task<List<string>> EvaluateAndUnlockAsync(ApplicationDbContext db, Guid userId, MatchRecord currentMatch)
    {
        var alreadyUnlocked = await db.UserAchievements
            .Where(u => u.UserId == userId)
            .Select(u => u.AchievementId)
            .ToHashSetAsync();

        // Conditions with Lifetime scope need the player's full match history — fetch once
        // and reuse across all achievements rather than re-querying per achievement.
        List<MatchRecord>? allMyRecords = null;

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
                allMyRecords ??= await db.MatchRecords.Where(m => m.PlayerId == userId).ToListAsync();
                met = EvaluateLifetime(achievement, allMyRecords);
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

    private bool EvaluateLifetime(AchievementConfig a, List<MatchRecord> records)
    {
        var filtered = records.AsEnumerable();
        if (a.ConditionType == "CharacterWaveCleared" && !string.IsNullOrEmpty(a.ConditionStat))
            filtered = filtered.Where(m => m.ConfigId == a.ConditionStat);
        if (a.ConditionType == "DifficultyWaveCleared" && !string.IsNullOrEmpty(a.ConditionStat))
            filtered = filtered.Where(m => m.Difficulty == a.ConditionStat);

        var list = filtered.ToList();

        return a.ConditionType switch
        {
            "LifetimeStat" => list.Sum(m => GetMatchStatValue(m, a.StatName)) >= a.Threshold,
            "MatchesPlayed" => list.Count >= a.Threshold,
            "HighestWaveReached" or "CharacterWaveCleared" or "DifficultyWaveCleared"
                => (list.Count > 0 ? list.Max(m => m.HighestWave) : 0) >= a.Threshold,

            // Generic: any stat (StatName) ever peaked at/above Threshold in any single match,
            // with no wave-limit constraint (unlike MaxStatByWave).
            "MaxStatReached" => list.Count > 0 && list.Max(m => ParsePeakStats(m).GetValueOrDefault(a.StatName, 0f)) >= a.Threshold,

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

    /// <summary>Full catalog + unlock state + progress, for the lobby Achievements panel.</summary>
    public async Task<List<AchievementProgressDto>> GetCatalogWithProgressAsync(ApplicationDbContext db, Guid userId)
    {
        var unlocked = await db.UserAchievements
            .Where(u => u.UserId == userId)
            .ToDictionaryAsync(u => u.AchievementId, u => u.UnlockedAt);

        var myRecords = await db.MatchRecords.Where(m => m.PlayerId == userId).ToListAsync();

        var bestWavePerCharacter = myRecords.GroupBy(m => m.ConfigId).ToDictionary(g => g.Key, g => g.Max(m => m.HighestWave));
        var bestWavePerDifficulty = myRecords.GroupBy(m => m.Difficulty).ToDictionary(g => g.Key, g => g.Max(m => m.HighestWave));
        int bestWaveOverall = myRecords.Count > 0 ? myRecords.Max(m => m.HighestWave) : 0;
        int matchesPlayed = myRecords.Count;

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
                "LifetimeStat" => myRecords.Sum(m => GetMatchStatValue(m, a.StatName)),
                "SingleMatchStat" => myRecords.Count > 0 ? myRecords.Max(m => GetMatchStatValue(m, a.StatName)) : 0,
                "MatchesPlayed" => matchesPlayed,
                "HighestWaveReached" => bestWaveOverall,
                // Approximate: shows progress toward the wave target; the no-hit / weapon-limit
                // constraint itself is all-or-nothing and only visible via the unlock itself.
                "NoHitWaveClear" => bestWaveOverall,
                "LimitedWeaponsWaveCleared" => bestWaveOverall,
                "MaxStatByWave" or "MaxStatReached" => myRecords.Count > 0 ? myRecords.Max(m => ParsePeakStats(m).GetValueOrDefault(a.StatName, 0f)) : 0,
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