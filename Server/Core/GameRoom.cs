using Microsoft.AspNetCore.SignalR;
using Server.Configs;
using Server.Core.Systems;
using Server.Entities;
using Server.Hubs;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;

namespace Server.Core;

// 1. THE SANDBOX: Holds everything needed for ONE single match.
public class GameRoom
{
    public string RoomId { get; }
    public GameState State { get; }
    public EventBus LocalEventBus { get; }

    private readonly List<IGameSystem> _systems = new();
    private readonly ConfigManager _configs;

    public GameRoom(string roomId, ConfigManager configs, IHubContext<GameHub> hubContext)
    {
        RoomId = roomId;
        _configs = configs;
        State = new GameState();
        LocalEventBus = new EventBus();

        // Instantiate fresh systems specifically for THIS room
        _systems.Add(new HealthSystem());
        _systems.Add(new SkillSystem());
        _systems.Add(new EffectSystem());
        _systems.Add(new CombatSystem());
        
        // Pass the RoomId to the NetworkSystem so it only broadcasts to this room's players
        _systems.Add(new NetworkSystem(hubContext, roomId)); 

        // Initialize all systems and bind them to THIS room's EventBus
        foreach (var sys in _systems)
        {
            sys.Initialize(LocalEventBus, _configs);
        }
    }

    public void Tick(float dt)
    {
        // 1. Process all events that happened in this specific room
        LocalEventBus.ProcessQueue();

        // 2. Update physics/combat/health for this room
        foreach (var sys in _systems)
        {
            sys.Update(dt, State);
        }
    }
}

// 2. THE MANAGER: Keeps track of all active rooms on this Worker Node
public class RoomManager
{
    private readonly ConcurrentDictionary<string, GameRoom> _activeRooms = new();
    private readonly ConfigManager _configs;
    private readonly IHubContext<GameHub> _hubContext;

    public RoomManager(ConfigManager configs, IHubContext<GameHub> hubContext)
    {
        _configs = configs;
        _hubContext = hubContext;
    }

    public GameRoom CreateRoom(string roomId)
    {
        var room = new GameRoom(roomId, _configs, _hubContext);
        _activeRooms.TryAdd(roomId, room);
        return room;
    }

    public void RemoveRoom(string roomId)
    {
        _activeRooms.TryRemove(roomId, out _);
    }

    public IEnumerable<GameRoom> GetAllRooms()
    {
        return _activeRooms.Values;
    }
    
    public GameRoom? GetRoom(string roomId)
    {
        _activeRooms.TryGetValue(roomId, out var room);
        return room;
    }
}