using System.Collections.Concurrent;
using System.Collections.Generic;
using Microsoft.AspNetCore.SignalR;
using Server.Configs;
using Server.Hubs;

namespace Server.Core;

public class RoomManager
{
    private readonly ConcurrentDictionary<string, GameRoom> _rooms = new();
    private readonly ConcurrentDictionary<string, string> _playerToRoomMap = new();
    private readonly IServiceProvider _serviceProvider;

    public RoomManager(IServiceProvider serviceProvider)
    {
        _serviceProvider = serviceProvider;
    }

    public GameRoom GetOrCreateRoom(string roomId, ConfigManager configManager)
    {
        return _rooms.GetOrAdd(roomId, id => new GameRoom(id, configManager, _serviceProvider));
    }

    // >>> NEW: Fetch lightweight summaries for the Lobby UI <<<
    public IEnumerable<object> GetRoomSummaries()
    {
        return _rooms.Values.Select(r => new
        {
            roomId = r.RoomId,
            roomName = r.RoomName,
            hasPassword = !string.IsNullOrEmpty(r.Password),
            playerCount = r.State.Players.Count,
            phase = r.State.Phase.ToString(),
            wave = r.State.CurrentWave,
            mapId = r.CurrentMapId // ADD THIS LINE
        }).ToList();
    }

    public GameRoom? GetRoom(string roomId)
    {
        _rooms.TryGetValue(roomId, out var room);
        return room;
    }

    public GameRoom? GetRoomForPlayer(string connectionId)
    {
        if (_playerToRoomMap.TryGetValue(connectionId, out var roomId))
        {
            return GetRoom(roomId);
        }
        return null;
    }

    public void AssignPlayerToRoom(string connectionId, string roomId)
    {
        _playerToRoomMap[connectionId] = roomId;
    }

    public void RemovePlayer(string connectionId)
    {
        if (_playerToRoomMap.TryRemove(connectionId, out var roomId))
        {
            if (_rooms.TryGetValue(roomId, out var room))
            {
                room.State.Players.TryRemove(connectionId, out _);

                // Cleanup empty rooms to free memory
                if (room.State.Players.IsEmpty)
                {
                    _rooms.TryRemove(roomId, out _);
                    Console.WriteLine($"[ROOM] Room {roomId} is empty and has been shut down.");
                }
                // >>> NEW: HOST MIGRATION <<<
                else if (room.HostConnectionId == connectionId)
                {
                    // Assign the first remaining player as the new Host!
                    room.HostConnectionId = room.State.Players.Keys.First();
                    Console.WriteLine($"[ROOM] Host migrated in Room {roomId} to {room.HostConnectionId}");
                }
            }
        }
    }

    public void UpdatePlayerConnectionId(string oldConnectionId, string newConnectionId, string roomId)
    {
        _playerToRoomMap.TryRemove(oldConnectionId, out _);
        _playerToRoomMap[newConnectionId] = roomId;
    }

    public IEnumerable<GameRoom> GetAllRooms() => _rooms.Values;
}