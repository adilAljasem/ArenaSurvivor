using StackExchange.Redis;
using System;
using System.Text.Json;
using System.Threading.Tasks;

namespace Server.Services;

// ─── FIX: Replaced anonymous JSON object with a proper typed record.
// The old code used an "OldConnectionId" field to secretly hold a PlayerId,
// which was confusing and caused naming inconsistency across all call sites.
file record MatchTokenData(string PlayerId, string RoomId);

public class RedisService
{
    private readonly IConnectionMultiplexer _redis;

    public RedisService(IConnectionMultiplexer redis)
    {
        _redis = redis;
    }

    // Master Node calls this to issue a secure, one-time-use match ticket.
    public async Task SaveMatchToken(string token, string playerId, string roomId)
    {
        var db = _redis.GetDatabase();
        var data = JsonSerializer.Serialize(new MatchTokenData(playerId, roomId));
        await db.StringSetAsync($"match_token:{token}", data, TimeSpan.FromMinutes(2));
    }

    // Worker Node calls this to validate the ticket.
    // Returns null if the token is missing, expired, or malformed.
    public async Task<(string PlayerId, string RoomId)?> ValidateAndConsumeToken(string token)
    {
        var db = _redis.GetDatabase();
        var data = await db.StringGetAsync($"match_token:{token}");
        if (data.IsNullOrEmpty) return null;

        // Delete immediately so the token can never be replayed.
        await db.KeyDeleteAsync($"match_token:{token}");

        var tokenData = JsonSerializer.Deserialize<MatchTokenData>(data.ToString());
        if (tokenData == null) return null;

        return (tokenData.PlayerId, tokenData.RoomId);
    }

    public async Task SaveRoomTransferData(RoomTransferDto dto)
    {
        var db = _redis.GetDatabase();
        var json = JsonSerializer.Serialize(dto);
        await db.StringSetAsync($"room_transfer:{dto.RoomId}", json, TimeSpan.FromMinutes(2));
    }

    public async Task<RoomTransferDto?> GetRoomTransferData(string roomId)
    {
        var db = _redis.GetDatabase();
        var json = await db.StringGetAsync($"room_transfer:{roomId}");
        if (json.IsNullOrEmpty) return null;
        return JsonSerializer.Deserialize<RoomTransferDto>(json.ToString());
    }

    public async Task SaveRoomWorkerRoute(string roomId, string workerPublicUrl)
    {
        var db = _redis.GetDatabase();
        await db.StringSetAsync($"room_route:{roomId}", workerPublicUrl, TimeSpan.FromHours(2));
    }

    public async Task<string?> GetRoomWorkerRoute(string roomId)
    {
        var db = _redis.GetDatabase();
        var data = await db.StringGetAsync($"room_route:{roomId}");


        return data.IsNullOrEmpty ? null : data.ToString();
    }

    public async Task PublishForceLogout(string playerId)
    {
        var sub = _redis.GetSubscriber();
        await sub.PublishAsync("force_logout", playerId);
    }

    public async Task SetActiveSession(string playerId, string sessionId)
    {
        var db = _redis.GetDatabase();
        // Expires in 7 days (matching your JWT expiration)
        await db.StringSetAsync($"session:{playerId}", sessionId, TimeSpan.FromDays(7));
    }

    public async Task<string?> GetActiveSession(string playerId)
    {
        var db = _redis.GetDatabase();
        var val = await db.StringGetAsync($"session:{playerId}");
        return val.IsNullOrEmpty ? null : val.ToString();
    }
}

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
}