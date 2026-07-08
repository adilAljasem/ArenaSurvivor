using System.Collections.Concurrent;
using Microsoft.Extensions.Options;
using Server.Configs;
using Server.Data;

namespace Server.Core;

public class RoomManager
{
    private readonly ConcurrentDictionary<string, GameRoom> _rooms = new();

    // connectionId → roomId  (for SignalR hub routing)
    private readonly ConcurrentDictionary<string, string> _playerToRoomMap = new();

    // authenticated PlayerId (JWT claim) → roomId  (for one-room-per-player enforcement)
    private readonly ConcurrentDictionary<string, string> _playerIdToRoomId = new();

    private readonly IServiceProvider _serviceProvider;
    private readonly RoomSettings _roomSettings;

    public RoomManager(IServiceProvider serviceProvider, IOptions<RoomSettings> roomSettings)
    {
        _serviceProvider = serviceProvider;
        _roomSettings = roomSettings.Value;
    }

    // ─── ROOM CREATION ────────────────────────────────────────────────────────

    public GameRoom GetOrCreateRoom(string roomId, ConfigManager configManager) =>
        _rooms.GetOrAdd(roomId, id => new GameRoom(id, configManager, _roomSettings, _serviceProvider));

    // ─── LOBBY QUERIES ────────────────────────────────────────────────────────

    public IEnumerable<object> GetRoomSummaries() =>
        _rooms.Values
            .Where(r => r.State.Status != RoomStatus.ScheduledForDeletion)
            .Select(r => new
            {
                roomId = r.RoomId,
                roomName = r.RoomName,
                hasPassword = !string.IsNullOrEmpty(r.Password),
                playerCount = r.State.Players.Count,
                maxPlayers = r.GetMaxPlayers(),
                phase = r.State.Phase.ToString(),
                wave = r.State.CurrentWave,
                mapId = r.CurrentMapId
            })
            .ToList();

    public GameRoom? GetRoom(string roomId)
    {
        _rooms.TryGetValue(roomId, out var room);
        return room;
    }

    public GameRoom? GetRoomForPlayer(string connectionId)
    {
        if (_playerToRoomMap.TryGetValue(connectionId, out var roomId))
            return GetRoom(roomId);
        return null;
    }

    // ─── ONE-ROOM-PER-PLAYER ─────────────────────────────────────────────────

    // Returns the room this authenticated player is currently registered in, if any.
    public GameRoom? GetRoomByPlayerId(string playerId)
    {
        if (_playerIdToRoomId.TryGetValue(playerId, out var roomId))
            return GetRoom(roomId);
        return null;
    }



    // Call when a player joins or creates a room (lobby + match stitch).
    public void RegisterPlayerInRoom(string playerId, string roomId) =>
        _playerIdToRoomId[playerId] = roomId;

    // Call when a player intentionally leaves (lobby LeaveRoom / lobby disconnect).
    public void UnregisterPlayerFromRoom(string playerId) =>
        _playerIdToRoomId.TryRemove(playerId, out _);

    // Force-delete a room and clean up all its player registrations.
    // Used when a solo player starts a new game after abandoning an old one.
    public void ForceDeleteRoom(string roomId)
    {
        if (!_rooms.TryRemove(roomId, out var room)) return;
        foreach (var player in room.State.Players.Values)
        {
            _playerIdToRoomId.TryRemove(player.PlayerId, out _);
            _playerToRoomMap.TryRemove(player.ConnectionId, out _);
        }
        Console.WriteLine($"[ROOM] Room {roomId} force-deleted (player started fresh).");
    }

    // ─── CONNECTION ROUTING ───────────────────────────────────────────────────

    public void AssignPlayerToRoom(string connectionId, string roomId) =>
        _playerToRoomMap[connectionId] = roomId;

    public void UpdatePlayerConnectionId(string oldId, string newId, string roomId)
    {
        _playerToRoomMap.TryRemove(oldId, out _);
        _playerToRoomMap[newId] = roomId;
    }

    public IEnumerable<GameRoom> GetAllRooms() => _rooms.Values;

    // ─── MATCH DISCONNECT ─────────────────────────────────────────────────────
    // Removes ONLY the routing entry. The entity stays alive for reconnect.
    // The playerId→roomId mapping is intentionally kept so the one-room rule
    // remains enforced while the player is away.
    public void RemovePlayer(string connectionId)
    {
        if (!_playerToRoomMap.TryRemove(connectionId, out var roomId)) return;
        if (!_rooms.TryGetValue(roomId, out var room)) return;

        var stillConnected = GetActiveConnectionIds(room);

        if (!stillConnected.Any())
        {
            room.State.Status = RoomStatus.Paused_AwaitingPlayers;
            room.State.PauseTimer = room.PauseTimeoutSeconds;
            Console.WriteLine($"[ROOM] Room {roomId} is empty. Paused for {_roomSettings.PauseTimeoutMinutes} min.");
        }
        else if (room.HostConnectionId == connectionId)
        {
            room.HostConnectionId = stillConnected.First();
            Console.WriteLine($"[ROOM] Host migrated in Room {roomId} to {room.HostConnectionId}");
        }
    }

    // ─── LOBBY LEAVE / DISCONNECT ─────────────────────────────────────────────
    // Removes routing entry AND erases the entity (pre-match departure).
    public void RemovePlayerFromLobby(string connectionId)
    {
        if (!_playerToRoomMap.TryRemove(connectionId, out var roomId)) return;
        if (!_rooms.TryGetValue(roomId, out var room)) return;

        // Unregister the authenticated ID before erasing the entity
        if (room.State.Players.TryGetValue(connectionId, out var playerEntity))
            _playerIdToRoomId.TryRemove(playerEntity.PlayerId, out _);

        room.State.Players.TryRemove(connectionId, out _);

        var stillConnected = GetActiveConnectionIds(room);

        if (!stillConnected.Any())
        {
            room.State.Status = RoomStatus.ScheduledForDeletion;
            Console.WriteLine($"[ROOM] Pre-match Room {roomId} is empty. Scheduled for deletion.");
        }
        else if (room.HostConnectionId == connectionId)
        {
            room.HostConnectionId = stillConnected.First();
            Console.WriteLine($"[ROOM] Host migrated in Room {roomId} to {room.HostConnectionId}");
        }
    }

    // ─── GARBAGE COLLECTION ───────────────────────────────────────────────────

    public void CleanupDeletedRooms()
    {
        foreach (var kvp in _rooms)
        {
            if (kvp.Value.State.Status != RoomStatus.ScheduledForDeletion) continue;

            // Unregister all players so the one-room rule does not block them from new games
            foreach (var player in kvp.Value.State.Players.Values)
                _playerIdToRoomId.TryRemove(player.PlayerId, out _);

            if (_rooms.TryRemove(kvp.Key, out _))
                Console.WriteLine($"[ROOM] Room {kvp.Key} evicted from memory.");
        }
    }

    // ─── HELPERS ─────────────────────────────────────────────────────────────

    private List<string> GetActiveConnectionIds(GameRoom room) =>
        room.State.Players.Values
            .Select(p => p.ConnectionId)
            .Intersect(_playerToRoomMap.Keys)
            .ToList();
}