using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Server.Core.Services;
using Server.Data;
using Server.Services;
using StackExchange.Redis;

namespace Server.Controllers;

[ApiController]
[Route("api/admin")]
[Authorize]
[AdminOnly]
public class AdminController : ControllerBase
{
    private readonly ApplicationDbContext _db;
    private readonly IConnectionMultiplexer _redis;
    private readonly RedisService _redisService;
    private readonly AchievementService _achievementService;

    public AdminController(ApplicationDbContext db, IConnectionMultiplexer redis, RedisService redisService, AchievementService achievementService)
    {
        _db = db;
        _redis = redis;
        _redisService = redisService;
        _achievementService = achievementService;
    }

    private Guid RequestingPlayerId => Guid.Parse(User.FindFirst("PlayerId")!.Value);

    // Called once on page load to confirm the token holder is actually an admin before
    // rendering anything — if this 403s, the client redirects away.
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.PlayerId == RequestingPlayerId);
        if (user == null) return NotFound();
        return Ok(new { username = user.Username, playerId = user.PlayerId });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 1. DASHBOARD
    // ═══════════════════════════════════════════════════════════════════════
    [HttpGet("dashboard")]
    public async Task<IActionResult> GetDashboard()
    {
        var db = _redis.GetDatabase();
        var workersHash = await db.HashGetAllAsync("active_workers");

        var servers = new List<ServerStatusDto>();
        int totalRooms = 0;

        foreach (var entry in workersHash)
        {
            if (entry.Value.IsNullOrEmpty) continue;
            try
            {
                using var doc = JsonDocument.Parse(entry.Value.ToString());
                var root = doc.RootElement;
                var lastUpdated = root.GetProperty("LastUpdated").GetDateTime();
                bool isStale = (DateTime.UtcNow - lastUpdated).TotalSeconds > 20; // missed >4 heartbeats
                int activeRooms = root.GetProperty("ActiveRooms").GetInt32();
                totalRooms += activeRooms;

                servers.Add(new ServerStatusDto(
                    root.GetProperty("WorkerId").GetString() ?? "",
                    root.GetProperty("Url").GetString() ?? "",
                    activeRooms,
                    root.GetProperty("CpuUsage").GetDouble(),
                    root.GetProperty("RamUsageMB").GetInt64(),
                    lastUpdated,
                    isStale
                ));
            }
            catch
            {
                // Malformed/partial heartbeat entry — skip it rather than fail the whole dashboard.
            }
        }

        long onlinePlayers = await _redisService.GetOnlinePlayerCount();
        int totalUsers = await _db.Users.CountAsync();
        int totalBanned = await _db.Users.CountAsync(u => u.IsBanned);
        int totalMatches = await _db.MatchRecords.Select(m => m.RoomId).Distinct().CountAsync();
        long totalLifetimeKills = await _db.MatchRecords.SumAsync(m => (long?)m.Kills) ?? 0;
        int totalMatchRecordRows = await _db.MatchRecords.CountAsync();

        return Ok(new
        {
            servers = servers.OrderBy(s => s.WorkerId).ToList(),
            totalRooms,
            onlinePlayers,
            totalRegisteredUsers = totalUsers,
            totalBannedUsers = totalBanned,
            totalMatchesPlayed = totalMatches,
            totalMatchRecordRows,
            totalLifetimeKills
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. REDIS BROWSER
    // ═══════════════════════════════════════════════════════════════════════
    [HttpGet("redis/keys")]
    public async Task<IActionResult> GetRedisKeys([FromQuery] string pattern = "*", [FromQuery] int limit = 200)
    {
        var endpoints = _redis.GetEndPoints();
        if (endpoints.Length == 0) return Ok(new { keys = Array.Empty<object>(), truncated = false });

        var server = _redis.GetServer(endpoints[0]);
        var db = _redis.GetDatabase();
        limit = Math.Clamp(limit, 1, 500);

        var results = new List<object>();
        int count = 0;
        // IServer.Keys uses SCAN internally (not the blocking KEYS command), safe on a live server.
        foreach (var key in server.Keys(pattern: pattern, pageSize: 100))
        {
            if (count >= limit) { count++; break; }
            var type = await db.KeyTypeAsync(key);
            var ttl = await db.KeyTimeToLiveAsync(key);
            results.Add(new { key = key.ToString(), type = type.ToString(), ttlSeconds = ttl?.TotalSeconds });
            count++;
        }

        return Ok(new { keys = results, truncated = count > limit });
    }

    [HttpGet("redis/value")]
    public async Task<IActionResult> GetRedisValue([FromQuery] string key)
    {
        if (string.IsNullOrWhiteSpace(key)) return BadRequest(new { error = "key is required." });

        var db = _redis.GetDatabase();
        var type = await db.KeyTypeAsync(key);

        object? value = type switch
        {
            RedisType.String => (string?)(await db.StringGetAsync(key)),
            RedisType.Hash => (await db.HashGetAllAsync(key)).ToDictionary(e => e.Name.ToString(), e => e.Value.ToString()),
            RedisType.Set => (await db.SetMembersAsync(key)).Select(v => v.ToString()).ToArray(),
            RedisType.List => (await db.ListRangeAsync(key)).Select(v => v.ToString()).ToArray(),
            RedisType.SortedSet => (await db.SortedSetRangeByScoreWithScoresAsync(key))
                .Select(e => new { member = e.Element.ToString(), score = e.Score }).ToArray(),
            RedisType.None => null,
            _ => $"[unsupported type: {type}]"
        };

        if (value == null) return NotFound(new { error = "Key not found." });

        var ttl = await db.KeyTimeToLiveAsync(key);
        return Ok(new { key, type = type.ToString(), ttlSeconds = ttl?.TotalSeconds, value });
    }

    [HttpDelete("redis/value")]
    public async Task<IActionResult> DeleteRedisKey([FromQuery] string key)
    {
        if (string.IsNullOrWhiteSpace(key)) return BadRequest(new { error = "key is required." });
        var db = _redis.GetDatabase();
        bool deleted = await db.KeyDeleteAsync(key);
        return Ok(new { deleted });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 3. PLAYERS
    // ═══════════════════════════════════════════════════════════════════════
    [HttpGet("players/search")]
    public async Task<IActionResult> SearchPlayers([FromQuery] string query = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 25)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = _db.Users.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(query))
        {
            var lower = query.ToLower().Trim();
            q = q.Where(u => u.Username.ToLower().Contains(lower) || u.Email.ToLower().Contains(lower));
        }

        int total = await q.CountAsync();
        var users = await q.OrderBy(u => u.Username)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(u => new
            {
                u.PlayerId,
                u.Username,
                u.Email,
                u.IsAdmin,
                u.IsBanned,
                u.IsEmailVerified,
                u.CreatedAt
            })
            .ToListAsync();

        return Ok(new { total, page, pageSize, players = users });
    }

    [HttpGet("players/{playerId}")]
    public async Task<IActionResult> GetPlayerDetail(Guid playerId)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.PlayerId == playerId);
        if (user == null) return NotFound();

        var matches = await _db.MatchRecords
            .Where(m => m.PlayerId == playerId)
            .OrderByDescending(m => m.MatchDate)
            .Take(50)
            .ToListAsync();

        var achievementCatalog = await _achievementService.GetCatalogWithProgressAsync(_db, playerId);
        var unlocked = achievementCatalog.Where(a => a.IsUnlocked).OrderByDescending(a => a.UnlockedAt).ToList();

        return Ok(new
        {
            user = new
            {
                user.PlayerId,
                user.Username,
                user.Email,
                user.IsAdmin,
                user.IsBanned,
                user.BanReason,
                user.BannedAt,
                user.IsEmailVerified,
                user.CreatedAt
            },
            recentMatches = matches,
            achievementsUnlocked = unlocked.Count,
            achievementsTotal = achievementCatalog.Count,
            achievements = unlocked
        });
    }

    [HttpPost("players/{playerId}/ban")]
    public async Task<IActionResult> BanPlayer(Guid playerId, [FromBody] BanRequest req)
    {
        if (playerId == RequestingPlayerId)
            return BadRequest(new { error = "You can't ban yourself." });

        var user = await _db.Users.FirstOrDefaultAsync(u => u.PlayerId == playerId);
        if (user == null) return NotFound();

        user.IsBanned = true;
        user.BanReason = string.IsNullOrWhiteSpace(req.Reason) ? null : req.Reason.Trim();
        user.BannedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Immediately kick them from any active connection, cluster-wide (reuses the same
        // pub/sub mechanism as the "logged in elsewhere" force-logout).
        await _redisService.PublishForceLogout(playerId.ToString());

        return Ok(new { message = "Player banned." });
    }

    [HttpPost("players/{playerId}/unban")]
    public async Task<IActionResult> UnbanPlayer(Guid playerId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.PlayerId == playerId);
        if (user == null) return NotFound();

        user.IsBanned = false;
        user.BanReason = null;
        user.BannedAt = null;
        await _db.SaveChangesAsync();

        return Ok(new { message = "Player unbanned." });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 4. LIVE GAMES
    // ═══════════════════════════════════════════════════════════════════════
    [HttpGet("live-games")]
    public async Task<IActionResult> GetLiveGames()
    {
        var endpoints = _redis.GetEndPoints();
        if (endpoints.Length == 0) return Ok(new { games = Array.Empty<object>() });

        var server = _redis.GetServer(endpoints[0]);
        var db = _redis.GetDatabase();

        var games = new List<JsonElement>();
        foreach (var key in server.Keys(pattern: "room_stats:*", pageSize: 100))
        {
            var json = await db.StringGetAsync(key);
            if (json.IsNullOrEmpty) continue;
            try
            {
                using var doc = JsonDocument.Parse(json.ToString());
                games.Add(doc.RootElement.Clone());
            }
            catch
            {
                // Skip malformed entries rather than fail the whole page.
            }
        }

        return Ok(new { games });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. ALL MATCHES (history)
    // ═══════════════════════════════════════════════════════════════════════
    [HttpGet("matches")]
    public async Task<IActionResult> SearchMatches(
        [FromQuery] string query = "",
        [FromQuery] string difficulty = "",
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var q = _db.MatchRecords.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(query))
        {
            var lower = query.ToLower().Trim();
            q = q.Where(m => m.Username.ToLower().Contains(lower)
                           || m.ConfigId.ToLower().Contains(lower)
                           || m.RoomId.ToLower().Contains(lower));
        }
        if (!string.IsNullOrWhiteSpace(difficulty))
            q = q.Where(m => m.Difficulty == difficulty);

        int total = await q.CountAsync();
        var matches = await q.OrderByDescending(m => m.MatchDate)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync();

        return Ok(new { total, page, pageSize, matches });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 6. MATCH HISTORY CLEANUP
    // ═══════════════════════════════════════════════════════════════════════
    // Safe to prune now — Lifetime achievement progress lives permanently in
    // UserLifetimeStats (see AchievementService), not in these rows. Deleting old
    // MatchRecords only removes raw history from the "All Matches" admin view; it can
    // never undo anything a player has actually earned.
    //
    // Deliberately admin-triggered (a button click, not a silent background job) so you see
    // exactly what's about to happen before it happens — preview first, then confirm.

    [HttpGet("matches/cleanup-preview")]
    public async Task<IActionResult> PreviewCleanup([FromQuery] int olderThanDays = 90)
    {
        if (olderThanDays < 1) return BadRequest(new { error = "olderThanDays must be at least 1." });

        var cutoff = DateTime.UtcNow.AddDays(-olderThanDays);
        int matchingCount = await _db.MatchRecords.CountAsync(m => m.MatchDate < cutoff);
        int totalCount = await _db.MatchRecords.CountAsync();

        return Ok(new
        {
            cutoffDate = cutoff,
            matchesToDelete = matchingCount,
            totalMatches = totalCount,
            matchesRemaining = totalCount - matchingCount
        });
    }

    [HttpDelete("matches/cleanup")]
    public async Task<IActionResult> ExecuteCleanup([FromQuery] int olderThanDays = 90)
    {
        if (olderThanDays < 1) return BadRequest(new { error = "olderThanDays must be at least 1." });

        var cutoff = DateTime.UtcNow.AddDays(-olderThanDays);

        // Bulk delete rather than loading rows into memory first — this table is exactly the
        // one that can get large, so avoid materializing potentially hundreds of thousands of
        // entities just to remove them.
        int deleted = await _db.MatchRecords
            .Where(m => m.MatchDate < cutoff)
            .ExecuteDeleteAsync();

        return Ok(new { message = $"Deleted {deleted} match record(s) older than {olderThanDays} days.", deleted });
    }
}

public record BanRequest(string? Reason);
public record ServerStatusDto(string WorkerId, string Url, int ActiveRooms, double CpuUsage, long RamUsageMB, DateTime LastUpdated, bool IsStale);/// Requires the authenticated caller to be an admin. Checks the DB live on every request
/// rather than trusting the JWT's "IsAdmin" claim alone — that claim is baked in at login
/// for convenience, but this is the actual gate, so revoking admin access takes effect
/// immediately instead of waiting for the token to expire.
/// </summary>
public class AdminOnlyAttribute : Attribute, IAsyncAuthorizationFilter
{
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var user = context.HttpContext.User;
        if (user?.Identity?.IsAuthenticated != true)
        {
            context.Result = new Microsoft.AspNetCore.Mvc.UnauthorizedResult();
            return;
        }

        var playerIdClaim = user.FindFirst("PlayerId")?.Value;
        if (string.IsNullOrEmpty(playerIdClaim) || !Guid.TryParse(playerIdClaim, out var playerId))
        {
            context.Result = new Microsoft.AspNetCore.Mvc.ObjectResult(new { error = "Invalid token." }) { StatusCode = 403 };
            return;
        }

        var db = context.HttpContext.RequestServices.GetRequiredService<ApplicationDbContext>();
        var dbUser = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.PlayerId == playerId);

        if (dbUser == null || !dbUser.IsAdmin || dbUser.IsBanned)
        {
            context.Result = new Microsoft.AspNetCore.Mvc.ObjectResult(new { error = "Admin access required." }) { StatusCode = 403 };
        }
    }
}



