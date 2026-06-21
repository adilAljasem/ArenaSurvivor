using StackExchange.Redis;
using System;
using System.Text.Json;
using System.Threading.Tasks;

namespace Server.Services;

public class RedisService
{
    private readonly IConnectionMultiplexer _redis;

    public RedisService(IConnectionMultiplexer redis)
    {
        _redis = redis;
    }

    // Master Node calls this to stash the VIP ticket
    public async Task SaveMatchToken(string token, string oldConnectionId, string roomId)
    {
        var db = _redis.GetDatabase();
        var data = JsonSerializer.Serialize(new { OldConnectionId = oldConnectionId, RoomId = roomId });
        
        // Tokens expire after 2 minutes. If the client doesn't connect by then, it's dead.
        await db.StringSetAsync($"match_token:{token}", data, TimeSpan.FromMinutes(2));
    }

    // Worker Node calls this to validate the ticket
    public async Task<(string OldConnectionId, string RoomId)?> ValidateAndConsumeToken(string token)
    {
        var db = _redis.GetDatabase();
        
        // 1. Try to get the token
        var data = await db.StringGetAsync($"match_token:{token}");
        if (data.IsNullOrEmpty) return null;

        // 2. CRITICAL: Delete the token immediately so it can never be reused (No replay attacks!)
        await db.KeyDeleteAsync($"match_token:{token}");

        // 3. Parse and return the data
        using var document = JsonDocument.Parse(data.ToString());
        var oldId = document.RootElement.GetProperty("OldConnectionId").GetString();
        var roomId = document.RootElement.GetProperty("RoomId").GetString();

        return (oldId, roomId);
    }

    public async Task SaveRoomTransferData(RoomTransferDto dto)
    {
        var db = _redis.GetDatabase();
        var json = JsonSerializer.Serialize(dto);
        // Worker must claim it within 2 minutes
        await db.StringSetAsync($"room_transfer:{dto.RoomId}", json, TimeSpan.FromMinutes(2)); 
    }

    public async Task<RoomTransferDto?> GetRoomTransferData(string roomId)
    {
        var db = _redis.GetDatabase();
        var json = await db.StringGetAsync($"room_transfer:{roomId}");
        if (json.IsNullOrEmpty) return null;
        return JsonSerializer.Deserialize<RoomTransferDto>(json.ToString());
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
    public string Name { get; set; } = string.Empty;
    public string ConfigId { get; set; } = string.Empty;
}