using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Server.Configs;
using Server.Core;
using Server.Core.Services;
using Server.Data;
using Server.DTOs;
using Server.Entities;
using Server.Services;
using StackExchange.Redis;
using System.Security.Claims;

namespace Server.Hubs;

[Authorize]
public class LobbyHub : Hub
{
    private readonly RoomManager _roomManager;
    private readonly ConfigManager _configManager;
    private readonly RedisService _redisService;
    private readonly IConnectionMultiplexer _redis;
    private readonly ServerConfig _serverConfig;
    private readonly ApplicationDbContext _db;
    private readonly AchievementService _achievementService;

    public LobbyHub(RoomManager roomManager, ConfigManager configManager, RedisService redisService,
        IConnectionMultiplexer redis, IOptions<ServerConfig> serverConfig, ApplicationDbContext db, AchievementService achievementService)
    {
        _roomManager = roomManager;
        _configManager = configManager;
        _redisService = redisService;
        _redis = redis;
        _serverConfig = serverConfig.Value;
        _db = db;
        _achievementService = achievementService;
    }

    // Reads the PlayerId claim from the validated JWT — the client cannot forge this.
    private string GetPlayerId() =>
        Context.User?.FindFirst("PlayerId")?.Value
        ?? throw new HubException("Not authenticated.");

    private string GetUsername() =>
        Context.User?.FindFirst("Username")?.Value ?? "Player";

    public string GetServerVersion() => _serverConfig.GameVersion;

    // Full config catalog for the main-menu Collection window — deliberately independent of
    // room join, since ReceiveHandshake (sent in InnerJoinRoom) only fires once a player has
    // created/joined a room, but Collection is reachable straight from the main menu.
    public async Task<object> GetCollectionCatalog()
    {
        Guid userId = Guid.Parse(GetPlayerId());
        var unlockedAchievements = await _achievementService.GetUnlockedAchievementIdsAsync(_db, userId);

        return new
        {
            enemies = _configManager.Enemies,
            weapons = _configManager.Weapons,
            items = _configManager.Items,
            characters = _configManager.Characters,
            achievements = _configManager.Achievements,
            skills = _configManager.Skills,
            effects = _configManager.Effects,
            traits = _configManager.Traits,
            maps = _configManager.Maps,
            difficulties = _configManager.Difficulties,
            myUnlockedAchievements = unlockedAchievements
        };
    }

    // Full achievement catalog + this player's unlock state + progress, for the
    // lobby main-menu "Achievements" button.
    public async Task<List<Server.DTOs.AchievementProgressDto>> GetAchievementCatalog()
    {
        Guid userId = Guid.Parse(GetPlayerId());
        return await _achievementService.GetCatalogWithProgressAsync(_db, userId);
    }

    // Top players across five categories over the last 7 days, for the main-menu "Scoreboard"
    // button. HighestWave is a per-player MAX (can't sum waves); everything else is a per-player
    // SUM across their matches in the window. Returns 50 per category (not just 10) so the
    // client can scroll past the top 10 rather than the leaderboard dead-ending there.
    public async Task<object> GetScoreboard()
    {
        var since = DateTime.UtcNow.AddDays(-7);
        var recentMatches = await _db.MatchRecords
            .Where(m => m.MatchDate >= since)
            .ToListAsync();

        var byPlayer = recentMatches.GroupBy(m => m.PlayerId).ToList();

        List<object> BuildBoard(Func<IGrouping<Guid, MatchRecord>, float> valueSelector)
        {
            return byPlayer
                .Select(g => new
                {
                    playerId = g.Key,
                    // Username is a per-match snapshot, not a live FK — use the most recent one
                    // in case the player renamed mid-window.
                    username = g.OrderByDescending(m => m.MatchDate).First().Username,
                    value = valueSelector(g)
                })
                .Where(x => x.value > 0)
                .OrderByDescending(x => x.value)
                .Take(50)
                .Cast<object>()
                .ToList();
        }

        var myPlayerId = Guid.Parse(GetPlayerId());

        return new
        {
            myPlayerId,
            highestWave = BuildBoard(g => g.Max(m => m.HighestWave)),
            healingDone = BuildBoard(g => g.Sum(m => m.TotalHealingDone)),
            damageDone = BuildBoard(g => g.Sum(m => m.TotalDamageDealt)),
            damageTaken = BuildBoard(g => g.Sum(m => m.TotalDamageTaken)),
            shieldDone = BuildBoard(g => g.Sum(m => m.TotalShieldingDone))
        };
    }

    public override async Task OnConnectedAsync()
    {
        string playerId = GetPlayerId();
        string? jwtSessionId = Context.User?.FindFirst("SessionId")?.Value;
        string? activeSessionId = await _redisService.GetActiveSession(playerId);

        // If the JWT's session doesn't match the database, kill the connection immediately.
        if (string.IsNullOrEmpty(jwtSessionId) || jwtSessionId != activeSessionId)
        {
            await Clients.Caller.SendAsync("ForceDisconnect", "Logged in from another location.");
            Context.Abort();
            return;
        }

        await _redisService.AddOnlinePlayer(playerId);
        Console.WriteLine($"[LOBBY] {GetUsername()} ({Context.ConnectionId}) connected.");
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        // Best-effort: player might be transferring to a Worker (about to reconnect there and
        // re-add itself), so this can cause a brief blip in the admin dashboard's online count
        // rather than a wrong-forever state — acceptable for a coarse counter.
        string? playerId = Context.User?.FindFirst("PlayerId")?.Value;
        if (!string.IsNullOrEmpty(playerId))
            await _redisService.RemoveOnlinePlayer(playerId);

        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);

        if (room == null || room.State.Phase == GamePhase.WaitingForPlayers)
        {
            _roomManager.RemovePlayerFromLobby(Context.ConnectionId);
            if (room != null && room.State.Players.Count > 0)
                await BroadcastRoster(room);
            Console.WriteLine($"[LOBBY] {Context.ConnectionId} left pre-match.");
        }
        else
        {
            Console.WriteLine($"[LOBBY] {Context.ConnectionId} transferring to Match Worker...");
        }

        await base.OnDisconnectedAsync(exception);
    }

    public async Task<IEnumerable<object>> RequestLobbyData() => _roomManager.GetRoomSummaries();

    public async Task CreateRoom(string playerName, string roomName, string password, string difficulty, string mapId)
    {
        string playerId = GetPlayerId();

        string username = GetUsername();


        // ─── ONE-ROOM RULE ────────────────────────────────────────────────────
        // If this player already owns a room, handle it:
        //   - Solo room (only they're in it): auto-delete and allow a fresh start
        //   - Multiplayer room: block the creation
        var existingRoom = _roomManager.GetRoomByPlayerId(playerId);
        if (existingRoom != null)
        {
            if (existingRoom.State.Players.Count == 1)
            {
                // Solo abandoned room → wipe it so the player can start fresh
                _roomManager.ForceDeleteRoom(existingRoom.RoomId);
                Console.WriteLine($"[LOBBY] Solo room {existingRoom.RoomId} cleaned up for player {playerId}.");
            }
            else
            {
                await Clients.Caller.SendAsync("LobbyError", "You're already in an active game with other players.");
                return;
            }
        }

        string roomId = Guid.NewGuid().ToString()[..6].ToUpper();
        var room = _roomManager.GetOrCreateRoom(roomId, _configManager);

        room.RoomName = string.IsNullOrWhiteSpace(roomName) ? $"{username}'s Arena" : roomName;
        room.Password = password ?? string.Empty;
        room.HostConnectionId = Context.ConnectionId;
        room.State.CurrentDifficulty = string.IsNullOrWhiteSpace(difficulty) ? "normal" : difficulty;
        room.CurrentMapId = !string.IsNullOrWhiteSpace(mapId) && _configManager.Maps.ContainsKey(mapId) ? mapId : "map_forest";

        _roomManager.RegisterPlayerInRoom(playerId, roomId);

        await Clients.All.SendAsync("LobbyListUpdated");
        await InnerJoinRoom(room, playerId, username);
    }

    public async Task JoinRoom(string playerName, string roomId, string password)
    {
        string playerId = GetPlayerId();
        string username = GetUsername();

        var room = _roomManager.GetRoom(roomId);
        if (room == null) { await Clients.Caller.SendAsync("LobbyError", "Room not found."); return; }
        if (room.State.Phase != GamePhase.WaitingForPlayers) { await Clients.Caller.SendAsync("LobbyError", "Match already in progress."); return; }
        if (!string.IsNullOrEmpty(room.Password) && room.Password != password) { await Clients.Caller.SendAsync("LobbyError", "Incorrect password."); return; }

        // A reconnecting player already occupies a slot — only block genuinely NEW joins
        // once the map's cap is reached.
        bool isReconnect = room.State.Players.Values.Any(p => p.PlayerId == playerId);
        if (!isReconnect && room.State.Players.Count >= room.GetMaxPlayers())
        {
            await Clients.Caller.SendAsync("LobbyError", "This room is full.");
            return;
        }

        _roomManager.RegisterPlayerInRoom(playerId, roomId);
        await InnerJoinRoom(room, playerId, username);
    }


    private async Task InnerJoinRoom(GameRoom room, string playerId, string playerName)
    {
        _roomManager.AssignPlayerToRoom(Context.ConnectionId, room.RoomId);

        var unlockedAchievements = await _achievementService.GetUnlockedAchievementIdsAsync(_db, Guid.Parse(playerId));

        var existingKvp = room.State.Players.FirstOrDefault(p => p.Value.PlayerId == playerId);

        if (existingKvp.Value != null)
        {
            // Reconnecting into the lobby — stitch to existing entity
            var existing = existingKvp.Value;
            room.State.Players.TryRemove(existingKvp.Key, out _);
            existing.ConnectionId = Context.ConnectionId;
            existing.UnlockedAchievementIds = unlockedAchievements;
            room.State.Players.TryAdd(Context.ConnectionId, existing);

            if (room.HostConnectionId == existingKvp.Key)
                room.HostConnectionId = Context.ConnectionId;

            if (room.State.Status == RoomStatus.Paused_AwaitingPlayers)
                room.State.Status = RoomStatus.Active;
        }
        else
        {
            var newPlayer = new PlayerEntity
            {
                PlayerId = playerId,
                ConnectionId = Context.ConnectionId,
                Name = playerName,
                IsReady = false,
                ConfigId = string.Empty,
                UnlockedAchievementIds = unlockedAchievements
            };
            newPlayer.SetTeam("Player");
            newPlayer.SetPosition(640, 360);


            room.State.Players.TryAdd(Context.ConnectionId, newPlayer);
            MatchHub.GenerateShopForPlayer(newPlayer, _configManager, room.State.CurrentWave);

            if (room.State.Status == RoomStatus.Paused_AwaitingPlayers)
            {
                room.State.Status = RoomStatus.Active;
                room.HostConnectionId = Context.ConnectionId;
            }
        }

        await Clients.Caller.SendAsync("ReceiveHandshake", new
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
            achievements = _configManager.Achievements,
            myUnlockedAchievements = unlockedAchievements,
            currentMapId = room.CurrentMapId
        });

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
        if (room == null || room.HostConnectionId != Context.ConnectionId || room.State.Phase != GamePhase.WaitingForPlayers) return;

        if (!string.IsNullOrWhiteSpace(mapId) && _configManager.Maps.TryGetValue(mapId, out var newMapCfg)
            && room.State.Players.Count > newMapCfg.MaxPlayers)
        {
            await Clients.Caller.SendAsync("LobbyError",
                $"Can't switch to {newMapCfg.Name} — it only supports {newMapCfg.MaxPlayers} players and this room has {room.State.Players.Count}.");
            return;
        }

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


    public async Task SelectCharacter(string characterId)
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null || !room.State.Players.TryGetValue(Context.ConnectionId, out var player)) return;
        if (room.State.Phase != GamePhase.WaitingForPlayers || player.IsReady) return;
        if (!_configManager.Characters.TryGetValue(characterId, out var charConfig)) return;

        if (charConfig.RequiredAchievements != null && charConfig.RequiredAchievements.Count > 0 &&
            !charConfig.RequiredAchievements.All(player.UnlockedAchievementIds.Contains))
        {
            await Clients.Caller.SendAsync("LobbyError", "This character is locked. Complete the required achievement(s) to unlock it.");
            return;
        }

        player.ConfigId = characterId;
        player.Initialize(_configManager.Characters[characterId], _configManager);
        player.CurrentShop.Clear();
        MatchHub.GenerateShopForPlayer(player, _configManager, 1);

        await BroadcastRoster(room);
    }

    public async Task ToggleReady()
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null || !room.State.Players.TryGetValue(Context.ConnectionId, out var player)) return;
        if (room.State.Phase != GamePhase.WaitingForPlayers) return;

        if (string.IsNullOrEmpty(player.ConfigId))
        {
            await Clients.Caller.SendAsync("LobbyError", "Please select a character first!");
            return;
        }

        player.IsReady = !player.IsReady;
        await BroadcastRoster(room);
    }

    public async Task LeaveRoom()
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null) return;

        _roomManager.RemovePlayerFromLobby(Context.ConnectionId);

        if (room.State.Players.Count > 0)
            await BroadcastRoster(room);
    }

    public async Task SendChatMessage(string message)
    {
        if (string.IsNullOrWhiteSpace(message)) return;
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null) return;

        string sender = room.State.Players.TryGetValue(Context.ConnectionId, out var player) ? player.Name : "Player";
        await Clients.Clients(room.State.Players.Keys).SendAsync("ReceiveChatMessage", sender, message);
    }

    private async Task BroadcastRoster(GameRoom room)
    {
        var playersData = room.State.Players.Values
            .Select(p => new { id = p.ConnectionId, name = p.Name, isReady = p.IsReady, characterId = p.ConfigId })
            .ToList();

        await Clients.Clients(room.State.Players.Keys).SendAsync("UpdateLobbyRoster", new
        {
            roomId = room.RoomId,
            roomName = room.RoomName,
            hostId = room.HostConnectionId,
            players = playersData
        });
    }

    public async Task RequestReconnect(string roomId)
    {
        string playerId = GetPlayerId();

        string? workerUrl = await _redisService.GetRoomWorkerRoute(roomId);
        if (string.IsNullOrEmpty(workerUrl))
        {
            await Clients.Caller.SendAsync("LobbyError", "Room has expired or does not exist.");
            return;
        }

        string token = Guid.NewGuid().ToString();
        await _redisService.SaveMatchToken(token, playerId, roomId);
        await Clients.Caller.SendAsync("MatchStarted", roomId, token, workerUrl);
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

        // ─── DYNAMIC LOAD BALANCING ───────────────────────────────────────────
        var db = _redis.GetDatabase();
        var activeWorkers = await db.HashGetAllAsync("active_workers");

        string bestWorkerUrl = "http://localhost:5000/matchHub";
        double lowestScore = double.MaxValue;

        foreach (var worker in activeWorkers)
        {
            if (worker.Value.IsNullOrEmpty) continue;

            try
            {
                var doc = System.Text.Json.JsonDocument.Parse(worker.Value.ToString());
                var root = doc.RootElement;

                if ((DateTime.UtcNow - root.GetProperty("LastUpdated").GetDateTime()).TotalSeconds > 15)
                {
                    await db.HashDeleteAsync("active_workers", worker.Name);
                    continue;
                }

                double cpu = root.GetProperty("CpuUsage").GetDouble();
                if (cpu > 90.0 && activeWorkers.Length > 1) continue;

                double score = (cpu * 10) + (root.GetProperty("RamUsageMB").GetInt64() * 0.1) + (root.GetProperty("ActiveRooms").GetInt32() * 5);
                if (score < lowestScore)
                {
                    lowestScore = score;
                    bestWorkerUrl = root.GetProperty("Url").GetString()!;
                }
            }
            catch (Exception ex)
            {
                // Malformed, partial, or stale-shape heartbeat entry (e.g. left over from an
                // older server build, or a worker that died mid-write) — one bad entry must
                // never crash match-starting for everyone. Skip it and self-heal by removing
                // it from Redis so it doesn't keep failing on every future StartMatch call.
                Console.WriteLine($"[LOBBY] Skipping malformed worker heartbeat '{worker.Name}': {ex.Message}");
                await db.HashDeleteAsync("active_workers", worker.Name);
            }
        }

        Console.WriteLine($"[LOBBY] Routing to Worker: {bestWorkerUrl} (Score: {lowestScore})");

        // ─── BUNDLE + HAND OFF TO WORKER ─────────────────────────────────────
        var transferDto = new RoomTransferDto
        {
            RoomId = room.RoomId,
            RoomName = room.RoomName,
            HostConnectionId = room.HostConnectionId,
            CurrentMapId = room.CurrentMapId,
            Difficulty = room.State.CurrentDifficulty,
            Players = room.State.Players.Values
                .Select(p => new PlayerTransferDto
                {
                    OldConnectionId = p.ConnectionId,
                    PlayerId = p.PlayerId,
                    Name = p.Name,
                    ConfigId = p.ConfigId,
                    UnlockedAchievementIds = p.UnlockedAchievementIds.ToList()
                })
                .ToList()
        };

        room.ExpectedPlayerCount = room.State.Players.Count;
        room.StitchedPlayerCount = 0;

        await _redisService.SaveRoomTransferData(transferDto);
        await _redisService.SaveRoomWorkerRoute(room.RoomId, bestWorkerUrl);

        foreach (var player in room.State.Players.Values)
        {
            string token = Guid.NewGuid().ToString();
            await _redisService.SaveMatchToken(token, player.PlayerId, room.RoomId);
            await Clients.Client(player.ConnectionId).SendAsync("MatchStarted", room.RoomId, token, bestWorkerUrl);
        }
    }
}