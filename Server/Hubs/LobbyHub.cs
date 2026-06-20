using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using Server.Configs;
using Server.Core;
using Server.Entities;
using Server.Services;
using StackExchange.Redis;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Server.Hubs;

public class LobbyHub : Hub
{
    private readonly RoomManager _roomManager;
    private readonly ConfigManager _configManager;
    private readonly RedisService _redisService;
    private IConnectionMultiplexer _redis;
    private readonly ServerConfig _serverConfig;

    public LobbyHub(RoomManager roomManager, ConfigManager configManager, RedisService redisService, IConnectionMultiplexer redis, IOptions<ServerConfig> serverConfig)
    {
        _roomManager = roomManager;
        _configManager = configManager;
        _redisService = redisService;
        _redis = redis;
        _serverConfig = serverConfig.Value;
    }

    public string GetServerVersion() => _serverConfig.GameVersion;

    public override async Task OnConnectedAsync()
    {
        Console.WriteLine($"[LOBBY] Player {Context.ConnectionId} connected.");
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);

        // ONLY remove the player if they leave while waiting in the lobby.
        // If the phase is WaveActive, they are just transferring to the MatchHub!
        if (room == null || room.State.Phase == GamePhase.WaitingForPlayers)
        {
            _roomManager.RemovePlayer(Context.ConnectionId);
            if (room != null) await BroadcastRoster(room);
            Console.WriteLine($"[LOBBY] Player abandoned match: {Context.ConnectionId}");
        }
        else
        {
            Console.WriteLine($"[LOBBY] Player {Context.ConnectionId} transferring to Match Worker...");
        }

        await base.OnDisconnectedAsync(exception);
    }
    public async Task<IEnumerable<object>> RequestLobbyData() => _roomManager.GetRoomSummaries();

    public async Task CreateRoom(string playerName, string roomName, string password, string difficulty)
    {
        string roomId = Guid.NewGuid().ToString().Substring(0, 6).ToUpper();
        var room = _roomManager.GetOrCreateRoom(roomId, _configManager);

        room.RoomName = string.IsNullOrWhiteSpace(roomName) ? $"{playerName}'s Arena" : roomName;
        room.Password = password ?? string.Empty;
        room.HostConnectionId = Context.ConnectionId;
        room.State.CurrentDifficulty = string.IsNullOrWhiteSpace(difficulty) ? "normal" : difficulty;
        room.CurrentMapId = "map_forest";

        await Clients.All.SendAsync("LobbyListUpdated");
        await InnerJoinRoom(room, playerName);
    }

    public async Task JoinRoom(string playerName, string roomId, string password)
    {
        var room = _roomManager.GetRoom(roomId);
        if (room == null) { await Clients.Caller.SendAsync("LobbyError", "Room not found."); return; }
        if (room.State.Phase != GamePhase.WaitingForPlayers) { await Clients.Caller.SendAsync("LobbyError", "Match already in progress."); return; }
        if (!string.IsNullOrEmpty(room.Password) && room.Password != password) { await Clients.Caller.SendAsync("LobbyError", "Incorrect password."); return; }

        await InnerJoinRoom(room, playerName);
    }

    private async Task InnerJoinRoom(GameRoom room, string playerName)
    {
        _roomManager.AssignPlayerToRoom(Context.ConnectionId, room.RoomId);

        var newPlayer = new PlayerEntity
        {
            ConnectionId = Context.ConnectionId,
            Name = playerName,
            Team = "Player",
            X = 640,
            Y = 360,
            IsReady = false,
            ConfigId = string.Empty
        };

        room.State.Players.TryAdd(Context.ConnectionId, newPlayer);
        MatchHub.GenerateShopForPlayer(newPlayer, _configManager, room.State.CurrentWave);

        var handshakePayload = new
        {
            version = _serverConfig.GameVersion,
            enemies = _configManager.Enemies,
            weapons = _configManager.Weapons,
            items = _configManager.Items,
            characters = _configManager.Characters,
            statsList = _configManager.AllStats,
            effects = _configManager.Effects,
            projectiles = _configManager.Projectiles,
            skills = _configManager.Skills,
            maps = _configManager.Maps,
            traits = _configManager.Traits,
            currentMapId = room.CurrentMapId
        };
        await Clients.Caller.SendAsync("ReceiveHandshake", handshakePayload);

        await Clients.Caller.SendAsync("RoomSettingsUpdated", new
        {
            roomName = room.RoomName,
            hasPassword = !string.IsNullOrEmpty(room.Password),
            difficulty = room.State.CurrentDifficulty,
            mapId = room.CurrentMapId
        });

        await BroadcastRoster(room);
    }

    public async Task UpdateRoomSettings(string roomName, string password, string difficulty, string mapId)
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);

        if (room != null && room.HostConnectionId == Context.ConnectionId && room.State.Phase == GamePhase.WaitingForPlayers)
        {
            room.RoomName = string.IsNullOrWhiteSpace(roomName) ? "Arena" : roomName;
            room.Password = password ?? string.Empty;
            room.State.CurrentDifficulty = difficulty;
            room.CurrentMapId = mapId;

            await Clients.Clients(room.State.Players.Keys).SendAsync("RoomSettingsUpdated", new
            {
                roomName = room.RoomName,
                hasPassword = !string.IsNullOrEmpty(room.Password),
                difficulty = room.State.CurrentDifficulty,
                mapId = room.CurrentMapId
            });
        }
    }

    public async Task SelectCharacter(string characterId)
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room != null && room.State.Players.TryGetValue(Context.ConnectionId, out var player) && room.State.Phase == GamePhase.WaitingForPlayers)
        {
            if (player.IsReady) return;

            if (_configManager.Characters.ContainsKey(characterId))
            {
                player.ConfigId = characterId;
                player.Initialize(_configManager.Characters[characterId], _configManager);

                player.CurrentShop.Clear();
                MatchHub.GenerateShopForPlayer(player, _configManager, 1);

                await BroadcastRoster(room);
            }
        }
    }

    public async Task ToggleReady()
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room != null && room.State.Players.TryGetValue(Context.ConnectionId, out var player) && room.State.Phase == GamePhase.WaitingForPlayers)
        {
            if (string.IsNullOrEmpty(player.ConfigId))
            {
                await Clients.Caller.SendAsync("LobbyError", "Please select a character first!");
                return;
            }

            player.IsReady = !player.IsReady;
            await BroadcastRoster(room);
        }
    }

    public async Task LeaveRoom()
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room != null)
        {
            _roomManager.RemovePlayer(Context.ConnectionId);
            if (_roomManager.GetRoom(room.RoomId) != null) await BroadcastRoster(room);
        }
    }

    public async Task SendChatMessage(string message)
    {
        if (string.IsNullOrWhiteSpace(message)) return;
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null) return;

        string senderName = room.State.Players.TryGetValue(Context.ConnectionId, out var player) ? player.Name : "Player";
        await Clients.Clients(room.State.Players.Keys).SendAsync("ReceiveChatMessage", senderName, message);
    }

    private async Task BroadcastRoster(GameRoom room)
    {
        var playersData = room.State.Players.Values.Select(p => new { id = p.ConnectionId, name = p.Name, isReady = p.IsReady, characterId = p.ConfigId }).ToList();
        await Clients.Clients(room.State.Players.Keys).SendAsync("UpdateLobbyRoster", new { roomId = room.RoomId, roomName = room.RoomName, hostId = room.HostConnectionId, players = playersData });
    }

    public async Task StartMatch()
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null || room.HostConnectionId != Context.ConnectionId) return;

        if (!room.State.Players.Values.All(p => p.IsReady))
        {
            await Clients.Caller.SendAsync("LobbyError", "Cannot start: Not all players are ready!");
            return;
        }

        // ==========================================
        // 1. DYNAMIC LOAD BALANCING (CPU/RAM Aware)
        // ==========================================
        var server = _redis.GetServer(_redis.GetEndPoints().First());
        var db = _redis.GetDatabase();
        var keys = server.Keys(pattern: "worker_node:*").ToList();

        string bestWorkerUrl = "http://localhost:5000/matchHub"; // Fallback
        double lowestLoadScore = double.MaxValue;

        foreach (var key in keys)
        {
            var data = await db.StringGetAsync(key);
            if (!data.IsNullOrEmpty)
            {
                var doc = System.Text.Json.JsonDocument.Parse(data.ToString());
                var root = doc.RootElement;

                int activeRooms = root.GetProperty("ActiveRooms").GetInt32();
                double cpuUsage = root.GetProperty("CpuUsage").GetDouble();
                long ramUsageMB = root.GetProperty("RamUsageMB").GetInt64();
                string url = root.GetProperty("Url").GetString();

                // If a server is melting down (>90% CPU), skip it entirely if possible
                if (cpuUsage > 90.0 && keys.Count > 1) continue;

                // Calculate a composite load score. 
                // Example Weighting: CPU is king. RAM is secondary. Rooms are minor.
                // Lower score is better.
                double score = (cpuUsage * 10) + (ramUsageMB * 0.1) + (activeRooms * 5);

                if (score < lowestLoadScore)
                {
                    lowestLoadScore = score;
                    bestWorkerUrl = url;
                }
            }
        }

        Console.WriteLine($"[LOBBY] Match starting. Routing players to Worker: {bestWorkerUrl} (Score: {lowestLoadScore})");
        room.StartMatch();

        // ==========================================
        // 2. SECURE HANDOFF
        // ==========================================
        foreach (var player in room.State.Players.Values)
        {
            string token = Guid.NewGuid().ToString();

            // Assuming you implemented RedisService to save the token!
            await _redisService.SaveMatchToken(token, player.ConnectionId, room.RoomId);

            // >>> NEW: Pass the bestWorkerUrl to the client! <<<
            await Clients.Client(player.ConnectionId).SendAsync("MatchStarted", room.RoomId, token, bestWorkerUrl);
        }
    }
}