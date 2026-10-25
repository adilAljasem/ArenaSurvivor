using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using Server.Configs;
using Server.Core;
using Server.Core.Services;
using Server.Core.Systems;
using Server.Data;
using Server.DTOs;
using Server.Entities;
using Server.Services;
using Microsoft.EntityFrameworkCore;
using System.Linq;
using System.Security.Claims;

namespace Server.Hubs;

[Authorize]
public class MatchHub : Hub
{
    private readonly RoomManager _roomManager;
    private readonly ConfigManager _configManager;
    private readonly RedisService _redisService;
    private readonly RoomConfig _roomConfig;
    private readonly ServerConfig _serverConfig;
    private readonly ApplicationDbContext _db;
    private readonly AchievementService _achievementService;

    public MatchHub(RoomManager roomManager, ConfigManager configManager, RedisService redisService, IOptions<RoomConfig> roomConfig,
                      IOptions<ServerConfig> serverConfig, ApplicationDbContext db, AchievementService achievementService)
    {
        _roomManager = roomManager;
        _configManager = configManager;
        _redisService = redisService;
        _roomConfig = roomConfig.Value;
        _serverConfig = serverConfig.Value;
        _db = db;
        _achievementService = achievementService;
    }

    public override async Task OnConnectedAsync()
    {
        string? playerId = Context.User?.FindFirst("PlayerId")?.Value;
        if (!string.IsNullOrEmpty(playerId))
        {
            string? jwtSessionId = Context.User?.FindFirst("SessionId")?.Value;
            string? activeSessionId = await _redisService.GetActiveSession(playerId);
            if (string.IsNullOrEmpty(activeSessionId) && !string.IsNullOrEmpty(jwtSessionId) && Guid.TryParse(playerId, out var pid))
            {
                var userExists = await _db.Users.AsNoTracking().AnyAsync(u => u.PlayerId == pid && !u.IsBanned);
                if (userExists)
                {
                    await _redisService.SetActiveSession(playerId, jwtSessionId);
                    activeSessionId = jwtSessionId;
                }
            }
            
            if (string.IsNullOrEmpty(jwtSessionId) || jwtSessionId != activeSessionId)
            {
                string reason = string.IsNullOrEmpty(activeSessionId) ? "Session expired. Please log in again." : "Logged in from another location.";
                await Clients.Caller.SendAsync("ForceDisconnect", reason);
                await Task.Delay(100);
                Context.Abort();
                return;
            }

            await _redisService.AddOnlinePlayer(playerId);
        }
        await base.OnConnectedAsync();
    }

    // Reads the PlayerId claim from the validated JWT — the client cannot forge this.
    private string GetPlayerId() =>
        Context.User?.FindFirst("PlayerId")?.Value
        ?? throw new HubException("Not authenticated.");
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        string? playerId = Context.User?.FindFirst("PlayerId")?.Value;
        if (!string.IsNullOrEmpty(playerId))
            await _redisService.RemoveOnlinePlayer(playerId);

        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        string? disconnectName = null;

        if (room != null && room.State.Players.TryGetValue(Context.ConnectionId, out var player))
        {
            disconnectName = player.Name;
        }

        _roomManager.RemovePlayer(Context.ConnectionId);

        if (room != null && room.State.Phase != GamePhase.WaitingForPlayers)
        {
            // Find players who are ACTUALLY still connected
            var activeConnections = room.State.Players.Values
                .Select(p => p.ConnectionId)
                .Where(cid => _roomManager.GetRoomForPlayer(cid) != null)
                .ToList();

            if (activeConnections.Count == 0)
            {
                // NO ONE IS LEFT - Pause the game
                room.State.Status = RoomStatus.Paused_AwaitingPlayers;

                // Safely grab the 3 minutes from your config
                float timeoutMinutes = _roomConfig.PauseTimeoutMinutes;
                room.State.PauseTimer = timeoutMinutes * 60f;

                Console.WriteLine($"[MATCH] Room {room.RoomId} is empty. Paused for {timeoutMinutes} minutes.");
            }
            else if (!string.IsNullOrEmpty(disconnectName))
            {
                // SOMEONE IS LEFT - Send the message ONLY to the people still online
                await Clients.Clients(activeConnections).SendAsync("ReceiveChatMessage", "System", $"{disconnectName} disconnected.");
            }
        }

        await base.OnDisconnectedAsync(exception);
    }

    // >>> NEW: Add this explicit quit method anywhere inside MatchHub
    public async Task LeaveRoom()
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null) return;

        // Permanently remove their entity from the room state
        if (room.State.Players.TryRemove(Context.ConnectionId, out var player))
        {
            room.EventBus.Publish(new ChatMessageEvent
            {
                Sender = "System",
                Message = $"{player.Name} permanently abandoned the match."
            });
        }

        _roomManager.RemovePlayer(Context.ConnectionId);

        int onlineCount = room.State.Players.Values.Count(p => _roomManager.GetRoomForPlayer(p.ConnectionId) != null);
        if (onlineCount == 0)
        {
            // The last player explicitly quit, delete immediately.
            room.State.Status = RoomStatus.ScheduledForDeletion;
            Console.WriteLine($"[MATCH] All players explicitly abandoned Room {room.RoomId}. Scheduled for immediate deletion.");
        }
    }

    public async Task JoinLiveMatch(string roomId, string matchToken, bool isSpectator)
    {
        // ─── 1. TOKEN VALIDATION ─────────────────────────────────────────────
        string playerId = GetPlayerId(); // From JWT — cannot be spoofed

        var tokenData = await _redisService.ValidateAndConsumeToken(matchToken);
        if (tokenData == null || tokenData.Value.RoomId != roomId || tokenData.Value.PlayerId != playerId)
        {
            Console.WriteLine($"[SECURITY] Invalid token for PlayerId={playerId}, Connection={Context.ConnectionId}");
            await Clients.Caller.SendAsync("MatchError", "Invalid or expired match token. Please return to the lobby.");
            return;
        }

        // ─── 2. FETCH TRANSFER DATA BEFORE ACQUIRING LOCK ────────────────────
        var existingRoom = _roomManager.GetRoom(roomId);
        RoomTransferDto? transferData = null;
        if (existingRoom == null || existingRoom.State.Players.IsEmpty)
            transferData = await _redisService.GetRoomTransferData(roomId);

        var room = _roomManager.GetOrCreateRoom(roomId, _configManager);

        PlayerEntity? stitchedPlayer = null;
        bool isStitched = false;

        // ─── 3. CRITICAL SECTION ─────────────────────────────────────────────
        string? systemAnnouncement = null;
        lock (room)
        {
            // --- A. SPECTATOR PATH ---
            if (isSpectator)
            {
                if (room.State.AllowSpectators)
                {
                    room.State.Spectators.TryAdd(Context.ConnectionId, new SpectatorEntity { ConnectionId = Context.ConnectionId });
                    _roomManager.AssignPlayerToRoom(Context.ConnectionId, roomId);
                    isStitched = true;
                }
                goto AfterLock;
            }

            // --- B. HYDRATION (first player spins up the room on this Worker) ---
            if (room.State.Players.IsEmpty && transferData != null)
            {
                room.RoomName = transferData.RoomName;
                room.HostConnectionId = transferData.HostConnectionId;
                room.CurrentMapId = transferData.CurrentMapId;
                room.State.CurrentDifficulty = transferData.Difficulty;

                foreach (var dto in transferData.Players)
                {
                    var entity = new PlayerEntity
                    {
                        PlayerId = dto.PlayerId,
                        ConnectionId = dto.OldConnectionId, // Temp key, replaced on stitch
                        Name = dto.Name,
                        ConfigId = dto.ConfigId,
                        UnlockedAchievementIds = dto.UnlockedAchievementIds != null
                            ? new HashSet<string>(dto.UnlockedAchievementIds)
                            : new HashSet<string>()
                    };
                    // Team and X/Y are private-set now, so they can't ride along in the object initializer above.
                    entity.SetTeam("Player");
                    entity.SetPosition(640, 360);

                    if (_configManager.Characters.ContainsKey(dto.ConfigId))
                        entity.Initialize(_configManager.Characters[dto.ConfigId], _configManager);

                    GenerateShopForPlayer(entity, _configManager, 1);
                    room.State.Players.TryAdd(dto.OldConnectionId, entity);
                }
                room.ExpectedPlayerCount = transferData.Players.Count;
                room.StitchedPlayerCount = 0;
            }

            // --- C. STITCH: bind this live connection to the player's entity ---
            var existingKvp = room.State.Players.FirstOrDefault(p => p.Value.PlayerId == playerId);
            if (existingKvp.Value != null)
            {
                stitchedPlayer = existingKvp.Value;
                room.State.Players.TryRemove(existingKvp.Key, out _);
                stitchedPlayer.ConnectionId = Context.ConnectionId;
                room.State.Players.TryAdd(Context.ConnectionId, stitchedPlayer);

                if (room.HostConnectionId == existingKvp.Key)
                    room.HostConnectionId = Context.ConnectionId;

                _roomManager.AssignPlayerToRoom(Context.ConnectionId, roomId);
                _roomManager.RegisterPlayerInRoom(playerId, roomId); // Keep one-room rule enforced

                if (room.State.Phase == GamePhase.WaitingForPlayers)
                    room.StitchedPlayerCount++;

                // --- D. HANDLE UNPAUSE OR CONTINUED PAUSE ---
                if (room.State.Phase != GamePhase.WaitingForPlayers)
                {
                    int reconnectedCount = room.State.Players.Values
                        .Count(p => _roomManager.GetRoomForPlayer(p.ConnectionId) != null);

                    if (reconnectedCount >= room.State.Players.Count)
                    {
                        room.State.Status = RoomStatus.Active;
                        systemAnnouncement = $"{stitchedPlayer.Name} reconnected. All players present. Match resumed!";
                    }
                    else if (room.State.Status == RoomStatus.Paused_AwaitingPlayers)
                    {
                        int timeRemaining = (int)room.State.PauseTimer;
                        int minutes = timeRemaining / 60;
                        int seconds = timeRemaining % 60;
                        systemAnnouncement = $"{stitchedPlayer.Name} joined! Game remains paused for {minutes}m {seconds}s waiting for others.";
                    }
                    else
                    {
                        systemAnnouncement = $"{stitchedPlayer.Name} reconnected to the active match!";
                    }
                }

                isStitched = true;
            }
        }

    AfterLock:

        // ─── 4. RESPOND (outside the lock) ───────────────────────────────────

        if (isSpectator)
        {
            if (!room.State.AllowSpectators)
            {
                await Clients.Caller.SendAsync("MatchError", "Spectators are not allowed in this room.");
                return;
            }
            await Clients.Caller.SendAsync("AllPlayersSynced");
            return;
        }

        if (!isStitched)
        {
            Console.WriteLine($"[MATCH] No entity found for PlayerId={playerId} in Room {roomId}. Session expired.");
            await Clients.Caller.SendAsync("MatchError", "Session expired. The room no longer exists.");
            return;
        }

        // Re-send handshake so reconnecting clients get fresh configs
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
            currentMapId = room.CurrentMapId
        });

        await SendPlayerUI(stitchedPlayer!, room.State);

        // One immediate roster snapshot so nameplates/levels show up right away instead of
        // waiting for the next periodic broadcast from GameLoop (up to ~1s later).
        var initialRoster = room.State.Players.Values
            .Select(p => new { id = p.ConnectionId, name = p.Name, level = p.Level })
            .ToList();
        await Clients.Caller.SendAsync("ReceiveRoster", initialRoster);

        if (room.State.Phase == GamePhase.WaitingForPlayers)
        {
            if (room.StitchedPlayerCount == room.ExpectedPlayerCount)
            {
                Console.WriteLine($"[MATCH] All {room.ExpectedPlayerCount} player(s) synced! Launching Room {roomId}.");
                room.StartMatch();
                await Clients.Clients(room.State.Players.Keys).SendAsync("AllPlayersSynced");
            }
        }
        else
        {
            // Mid-match reconnect — drop the loading screen immediately
            await Clients.Caller.SendAsync("AllPlayersSynced");

            // Give the frontend 1.5 seconds to fully build the Chat UI before sending the message!
            if (!string.IsNullOrEmpty(systemAnnouncement))
            {
                await Task.Delay(1500);
                await Clients.Clients(room.State.Players.Keys).SendAsync("ReceiveChatMessage", "System", systemAnnouncement);
            }
        }
    }

    public void SendInput(PlayerInputDto input)
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null || !room.State.Players.TryGetValue(Context.ConnectionId, out var player)) return;
        if (player.IsDead) return; // dead players don't move (or aim/attack)

        float length = (float)Math.Sqrt(input.DirX * input.DirX + input.DirY * input.DirY);
        player.AimX = input.AimX;
        player.AimY = input.AimY;
        player.InputX = length > 0 ? input.DirX / length : 0;
        player.InputY = length > 0 ? input.DirY / length : 0;
    }

    public async Task SendChatMessage(string message)
    {
        if (string.IsNullOrWhiteSpace(message)) return;
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null) return;

        // Flood guard: covers both regular chat spam and rapid-fire "/" command abuse. HTTP-
        // level rate limiting can't see this — a SignalR hub connection is one long-lived
        // request, not many separate ones — so this has to live in the hub method itself.
        if (room.State.Players.TryGetValue(Context.ConnectionId, out var throttledPlayer))
        {
            if ((DateTime.UtcNow - throttledPlayer.LastChatMessageAt).TotalMilliseconds < 400)
                return; // silently drop — no need to tell a flooder they got rate limited
            throttledPlayer.LastChatMessageAt = DateTime.UtcNow;
        }

        if (message.StartsWith("/"))
        {
            // Cheat commands (setwave, givegold, killall, spawnenemy, etc.) are dangerous in a
            // multiplayer game — gate them behind a LIVE admin check, not the JWT's "IsAdmin"
            // claim, so a demoted admin loses cheat access immediately rather than whenever
            // their token happens to expire. Same posture as AdminOnlyAttribute.
            bool isAdmin = false;
            string? playerIdClaim = Context.User?.FindFirst("PlayerId")?.Value;
            if (!string.IsNullOrEmpty(playerIdClaim) && Guid.TryParse(playerIdClaim, out var pid))
            {
                var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.PlayerId == pid);
                isAdmin = user != null && user.IsAdmin && !user.IsBanned;
            }

            if (!isAdmin)
            {
                await Clients.Caller.SendAsync("ReceiveChatMessage", "System", "You don't have permission to use commands.");
                return;
            }

            await Server.Commands.CommandDispatcher.ExecuteAsync(message, room, _configManager, Context.ConnectionId, Clients.Caller);
        }
        else
        {
            string sender = room.State.Players.TryGetValue(Context.ConnectionId, out var player) ? player.Name : "Player";
            await Clients.Clients(room.State.Players.Keys).SendAsync("ReceiveChatMessage", sender, message);
        }
    }

    public void Ping() { }

    public async Task RequestUIUpdate()
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room != null && room.State.Players.TryGetValue(Context.ConnectionId, out var player))
            await SendPlayerUI(player, room.State);
    }

    // ─── SHOP & PROGRESSION ──────────────────────────────────────────────────

    private async Task SendPlayerUI(PlayerEntity player, GameState state)
    {
        if (player.PendingLevelUps > 0 && player.CurrentLevelUpChoices.Count == 0)
        {
            GenerateLevelUpChoicesForPlayer(player, _configManager);
        }

        await Clients.Caller.SendAsync("UpdatePlayerUI", new
        {
            player.Gold,
            player.CurrentShop,
            player.Weapons,
            OwnedItems = player.OwnedItems.Select(i => new { i.ConfigId, i.SlotIndex, i.Level, i.RolledStats, ItemSkills = i.ItemSkills.Select(s => s.ConfigId).ToList(), i.TotalBaseStats }).ToArray(),
            player.CurrentRerollCost,
            state.CurrentWave,
            player.Level,
            player.CurrentXp,
            XpRequired = player.GetXpRequirement(),
            player.PendingLevelUps,
            LevelUpChoices = player.CurrentLevelUpChoices,
            MaxItemSlots = player.GetMaxItemSlots(_configManager),
            Stats = _configManager.AllStats.ToDictionary(k => k, k => player.GetTotalStat(k, _configManager)),
            Phase = state.Phase.ToString()
        });
    }

    public static int RollRarityTier(float luck, int maxPossibleTier = 4)
    {
        float w1 = Math.Max(10f, 100f - luck);
        float w2 = Math.Max(0f, 20f + (luck * 1.5f));
        float w3 = Math.Max(0f, (luck - 10f) * 1.0f);

        // Tier 4 now requires > 100 Luck to even have a chance of appearing
        float w4 = Math.Max(0f, (luck - 100f) * 0.5f);

        if (maxPossibleTier < 4) w4 = 0;
        if (maxPossibleTier < 3) w3 = 0;
        if (maxPossibleTier < 2) w2 = 0;

        float total = w1 + w2 + w3 + w4;
        float roll = (float)(Random.Shared.NextDouble() * total);

        if (w4 > 0 && roll <= w4) return 4; roll -= w4;
        if (w3 > 0 && roll <= w3) return 3; roll -= w3;
        if (w2 > 0 && roll <= w2) return 2;
        return 1;
    }

    public static void GenerateLevelUpChoicesForPlayer(PlayerEntity player, ConfigManager configManager)
    {
        float luck = player.GetTotalStat("luck", configManager);
        player.CurrentLevelUpChoices = new List<Configs.LevelUpCardConfig>();
        int maxTier = configManager.LevelUpCards.Values.Any() ? configManager.LevelUpCards.Values.Max(c => c.Tier) : 1;

        for (int i = 0; i < 3; i++)
        {
            int tier = RollRarityTier(luck, maxTier);
            var cards = configManager.LevelUpCards.Values.Where(c => c.Tier == tier).ToList();
            if (!cards.Any()) cards = configManager.LevelUpCards.Values.Where(c => c.Tier <= tier).ToList();
            if (cards.Any()) player.CurrentLevelUpChoices.Add(cards[Random.Shared.Next(cards.Count)]);
        }
    }

    // Gear with an empty RequiredAchievements list is unlocked for everyone. Otherwise the
    // player needs ALL listed achievement ids.
    private static bool IsUnlockedFor(List<string> requiredAchievements, PlayerEntity player)
    {
        if (requiredAchievements == null || requiredAchievements.Count == 0) return true;
        return requiredAchievements.All(id => player.UnlockedAchievementIds.Contains(id));
    }

    // Gear with an empty AllowedCharacters list is available to every character. Otherwise the
    // player's current character (player.ConfigId, e.g. "char_wizard") must be on the list.
    private static bool IsAllowedForCharacter(List<string> allowedCharacters, PlayerEntity player)
    {
        if (allowedCharacters == null || allowedCharacters.Count == 0) return true;
        return allowedCharacters.Contains(player.ConfigId);
    }

    public static void GenerateShopForPlayer(PlayerEntity player, ConfigManager configManager, int currentWave)
    {
        float luck = player.GetTotalStat("luck", configManager);
        player.CurrentShop = player.CurrentShop.Where(i => i.IsLocked).ToList();
        int slots = 3 - player.CurrentShop.Count;

        for (int i = 0; i < slots; i++)
        {
            int tier = RollRarityTier(luck, 4);
            var weapons = configManager.Weapons.Values.Where(w => w.Tier == tier && w.AvailableInShop && IsUnlockedFor(w.RequiredAchievements, player) && IsAllowedForCharacter(w.AllowedCharacters, player)).ToList();
            var items = configManager.Items.Values.Where(it => it.Tier == tier && it.AvailableInShop && IsUnlockedFor(it.RequiredAchievements, player) && IsAllowedForCharacter(it.AllowedCharacters, player)).ToList();
            if (!weapons.Any()) weapons = configManager.Weapons.Values.Where(w => w.Tier <= tier && w.AvailableInShop && IsUnlockedFor(w.RequiredAchievements, player) && IsAllowedForCharacter(w.AllowedCharacters, player)).ToList();
            if (!items.Any()) items = configManager.Items.Values.Where(it => it.Tier <= tier && it.AvailableInShop && IsUnlockedFor(it.RequiredAchievements, player) && IsAllowedForCharacter(it.AllowedCharacters, player)).ToList();

            bool spawnWeapon = Random.Shared.Next(2) == 0 || !items.Any();
            if (spawnWeapon && weapons.Any())
            {
                var w = weapons[Random.Shared.Next(weapons.Count)];
                var p = WeaponGenerator.GenerateWeapon(w.Id, player, configManager, 1);
                player.CurrentShop.Add(new Server.DTOs.ShopItemDto { ConfigId = w.Id, Name = w.Name, Price = w.Price, TotalBaseStats = p.TotalBaseStats, RolledStats = p.RolledStats, WeaponSkills = p.WeaponSkills.Select(s => s.ConfigId).ToList() });
            }
            else if (items.Any())
            {
                var it = items[Random.Shared.Next(items.Count)];
                var p = ItemGenerator.GenerateItem(it.Id, player, configManager, 1);
                player.CurrentShop.Add(new Server.DTOs.ShopItemDto { ConfigId = it.Id, Name = it.Name, Price = it.Price, TotalBaseStats = p.TotalBaseStats, RolledStats = p.RolledStats, WeaponSkills = p.ItemSkills.Select(s => s.ConfigId).ToList() });
            }
        }
    }

    public async Task BuyItem(string configId)
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null || !room.State.Players.TryGetValue(Context.ConnectionId, out var player)) return;

        // We will store the result of the lock here so we can await it outside the lock
        string errorMessage = null;
        bool isSuccess = false;
        bool anyGearMaxed = false;

        lock (player)
        {
            var shopItem = player.CurrentShop.FirstOrDefault(i => i.ConfigId == configId && !i.IsLocked);

            if (shopItem == null) { errorMessage = "Item no longer available!"; }
            else if (player.Gold < shopItem.Price) { errorMessage = "Not enough gold!"; }
            else
            {
                bool isWeapon = _configManager.Weapons.TryGetValue(configId, out var wCfg);
                bool isItem = _configManager.Items.TryGetValue(configId, out var iCfg);

                bool allowDupes = isWeapon ? wCfg.AllowDuplicates : (isItem ? iCfg.AllowDuplicates : false);
                string family = isWeapon ? wCfg.WeaponFamily : (isItem ? iCfg.ItemFamily : string.Empty);

                bool conflict = false;
                if (!allowDupes)
                {
                    if (isWeapon)
                    {
                        foreach (var eq in player.Weapons)
                        {
                            if (eq.ConfigId == configId) continue;
                            if (_configManager.Weapons.TryGetValue(eq.ConfigId, out var eqCfg) && !string.IsNullOrEmpty(family) && eqCfg.WeaponFamily == family) conflict = true;
                        }
                    }
                    else if (isItem)
                    {
                        foreach (var eq in player.OwnedItems)
                        {
                            if (eq.ConfigId == configId) continue;
                            if (_configManager.Items.TryGetValue(eq.ConfigId, out var eqCfg) && !string.IsNullOrEmpty(family) && eqCfg.ItemFamily == family) conflict = true;
                        }
                    }
                }

                if (conflict) { errorMessage = "Cannot equip duplicates of this type!"; }
                else if (isItem)
                {
                    int maxSlots = player.GetMaxItemSlots(_configManager);
                    bool isMerge = player.OwnedItems.Any(i => i.ConfigId == configId);
                    if (!isMerge && player.OwnedItems.Count >= maxSlots) { errorMessage = "Inventory is Full!"; }
                }

                if (errorMessage == null)
                {
                    if (isWeapon)
                    {
                        var w = new EquippedWeapon { ConfigId = shopItem.ConfigId, Level = 1, RolledStats = shopItem.RolledStats ?? new(), TotalBaseStats = shopItem.TotalBaseStats ?? new() };
                        w.MergedConfigIds.Add(configId);
                        if (shopItem.WeaponSkills != null) foreach (var sid in shopItem.WeaponSkills) if (_configManager.Skills.TryGetValue(sid, out var sc)) w.WeaponSkills.Add(new ActiveSkill { ConfigId = sid, CurrentCooldown = sc.CooldownSeconds });
                        isSuccess = player.TryAddOrMergeWeapon(w, _configManager);
                        if (isSuccess && player.Weapons.Count > player.PeakWeaponsEquipped) player.PeakWeaponsEquipped = player.Weapons.Count;
                    }
                    else if (isItem)
                    {
                        var it = new EquippedItem { ConfigId = shopItem.ConfigId, Level = 1, RolledStats = shopItem.RolledStats ?? new(), TotalBaseStats = shopItem.TotalBaseStats ?? new() };
                        it.MergedConfigIds.Add(configId);
                        if (shopItem.WeaponSkills != null) foreach (var sid in shopItem.WeaponSkills) if (_configManager.Skills.TryGetValue(sid, out var sc)) it.ItemSkills.Add(new ActiveSkill { ConfigId = sid, CurrentCooldown = sc.CooldownSeconds });
                        isSuccess = player.TryAddOrMergeItem(it, _configManager);
                        if (isSuccess && iCfg.Traits != null) { bool g = false; foreach (var t in iCfg.Traits) if (!player.Traits.Contains(t)) { player.Traits.Add(t); g = true; } if (g) player.StatsNeedRecalculation = true; }
                    }

                    if (isSuccess)
                    {
                        player.Gold -= shopItem.Price;
                        player.CurrentShop.Remove(shopItem);

                        // "Level a weapon/item to its max level" achievement check.
                        anyGearMaxed = player.Weapons.Any(w2 => _configManager.Weapons.TryGetValue(w2.ConfigId, out var wc2) && w2.Level >= wc2.MaxLevel)
                                    || player.OwnedItems.Any(i2 => _configManager.Items.TryGetValue(i2.ConfigId, out var ic2) && i2.Level >= ic2.MaxLevel);
                    }
                    else
                    {
                        errorMessage = "Cannot equip this item!";
                    }
                }
            }
        }

        // --- SEND MESSAGES OUTSIDE THE LOCK WITH AWAIT ---
        if (errorMessage != null)
        {
            await Clients.Caller.SendAsync("ShopError", errorMessage);
            return;
        }

        if (isSuccess)
        {
            await Clients.Caller.SendAsync("ShopSuccess");
            await SendPlayerUI(player, room.State);

            if (anyGearMaxed)
            {
                var newlyUnlocked = await _achievementService.EvaluateFlagAsync(_db, Guid.Parse(GetPlayerId()), "GearMaxLevel");
                if (newlyUnlocked.Count > 0)
                {
                    player.UnlockedAchievementIds.UnionWith(newlyUnlocked);
                    await Clients.Caller.SendAsync("AchievementUnlocked", newlyUnlocked);
                }
            }
        }
    }

    public async Task SelectLevelUpStat(string cardId)
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null || !room.State.Players.TryGetValue(Context.ConnectionId, out var player)) return;
        lock (player)
        {
            if (player.PendingLevelUps > 0 && player.CurrentLevelUpChoices.Any(c => c.Id == cardId))
            {
                var card = player.CurrentLevelUpChoices.First(c => c.Id == cardId);
                player.Stats.AddModifier(card.StatName, card.Amount, 0);
                player.StatsNeedRecalculation = true;
                player.PendingLevelUps--;
                player.CurrentLevelUpChoices.Clear();
                if (player.PendingLevelUps > 0)
                    GenerateLevelUpChoicesForPlayer(player, _configManager);
            }
        }
        await SendPlayerUI(player, room.State);
    }

    public async Task RerollShop()
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null || !room.State.Players.TryGetValue(Context.ConnectionId, out var player)) return;
        if (!_configManager.Difficulties.TryGetValue(room.State.CurrentDifficulty, out var diff)) diff = new DifficultyConfig();
        lock (player)
        {
            if (player.Gold < player.CurrentRerollCost) return;
            player.Gold -= player.CurrentRerollCost;
            player.CurrentRerollCost += diff.RerollInflation;
            GenerateShopForPlayer(player, _configManager, room.State.CurrentWave);
        }
        await SendPlayerUI(player, room.State);
    }

    public async Task ToggleLock(string configId)
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null || !room.State.Players.TryGetValue(Context.ConnectionId, out var player)) return;
        var item = player.CurrentShop.FirstOrDefault(i => i.ConfigId == configId);
        if (item != null) { item.IsLocked = !item.IsLocked; await SendPlayerUI(player, room.State); }
    }

    public async Task TryPickupLoot(string pickupId)
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null || !room.State.Players.TryGetValue(Context.ConnectionId, out var player)) return;

        string? errorMessage = null;
        bool isSuccess = false;

        // >>> NEW VARIABLES TO TRACK ICON <<<
        string pickedUpItemName = "";
        int itemTier = 1;
        string textureKey = "";
        int iconFrame = 0;

        lock (player)
        {
            if (!room.State.Pickups.TryGetValue(pickupId, out var pickup)) return;
            float dx = player.X - pickup.X, dy = player.Y - pickup.Y;
            if (dx * dx + dy * dy > 2500) return; // Must be standing near it

            bool isWeapon = pickup.Type == PickupType.Weapon;
            bool isItem = pickup.Type == PickupType.Item;

            // --- WEAPON CHECKS ---
            if (isWeapon && pickup.DroppedWeapon != null)
            {
                var cfg = _configManager.Weapons.GetValueOrDefault(pickup.DroppedWeapon.ConfigId);

                // Restricted gear (e.g. a wand only wizard/shaman can use) still drops normally —
                // it's just not pickable by the wrong character. Checked first so nothing below
                // (duplicate checks, merging) runs for a character that was never allowed to have it.
                if (cfg != null && !IsAllowedForCharacter(cfg.AllowedCharacters, player))
                    errorMessage = "Your character cannot use this item!";

                // ... (Keep your existing duplicate checks here) ...
                if (errorMessage == null && cfg != null && !cfg.AllowDuplicates)
                {
                    if (player.Weapons.Any(w => w.ConfigId != pickup.DroppedWeapon.ConfigId && _configManager.Weapons.TryGetValue(w.ConfigId, out var eqCfg) && eqCfg.WeaponFamily == cfg.WeaponFamily))
                        errorMessage = "Cannot equip duplicates of this type!";
                }

                if (errorMessage == null)
                {
                    pickup.DroppedWeapon.Level = 1; pickup.DroppedWeapon.MergedConfigIds.Clear(); pickup.DroppedWeapon.MergedConfigIds.Add(pickup.DroppedWeapon.ConfigId);
                    if (player.TryAddOrMergeWeapon(pickup.DroppedWeapon, _configManager))
                    {
                        room.State.Pickups.TryRemove(pickupId, out _);
                        isSuccess = true;

                        // >>> CAPTURE WEAPON DATA <<<
                        pickedUpItemName = cfg?.Name ?? "Weapon";
                        itemTier = cfg?.Tier ?? 1;
                        textureKey = cfg?.TextureKey ?? "";
                        iconFrame = cfg?.IconFrame ?? 0;
                    }
                    else errorMessage = "Cannot equip this weapon!";
                }
            }
            // --- ITEM CHECKS ---
            else if (isItem && pickup.DroppedItem != null)
            {
                var cfg = _configManager.Items.GetValueOrDefault(pickup.DroppedItem.ConfigId);

                if (cfg != null && !IsAllowedForCharacter(cfg.AllowedCharacters, player))
                    errorMessage = "Your character cannot use this item!";

                // ... (Keep your existing duplicate & inventory checks here) ...
                if (errorMessage == null && cfg != null && !cfg.AllowDuplicates)
                {
                    if (player.OwnedItems.Any(i => i.ConfigId != pickup.DroppedItem.ConfigId && _configManager.Items.TryGetValue(i.ConfigId, out var eqCfg) && eqCfg.ItemFamily == cfg.ItemFamily))
                        errorMessage = "Cannot equip duplicates of this type!";
                }

                if (errorMessage == null)
                {
                    int maxSlots = player.GetMaxItemSlots(_configManager);
                    bool isMerge = player.OwnedItems.Any(i => i.ConfigId == pickup.DroppedItem!.ConfigId);

                    if (!isMerge && player.OwnedItems.Count >= maxSlots)
                    {
                        errorMessage = "Inventory is Full!";
                    }
                    else
                    {
                        pickup.DroppedItem.Level = 1; pickup.DroppedItem.MergedConfigIds.Clear(); pickup.DroppedItem.MergedConfigIds.Add(pickup.DroppedItem.ConfigId);
                        if (player.TryAddOrMergeItem(pickup.DroppedItem, _configManager))
                        {
                            room.State.Pickups.TryRemove(pickupId, out _);
                            isSuccess = true;

                            // >>> CAPTURE ITEM DATA <<<
                            pickedUpItemName = cfg?.Name ?? "Item";
                            itemTier = cfg?.Tier ?? 1;
                            textureKey = cfg?.TextureKey ?? "";
                            iconFrame = cfg?.IconFrame ?? 0;
                        }
                        else errorMessage = "Cannot equip this item!";
                    }
                }
            }
        }

        if (errorMessage != null)
        {
            await Clients.Caller.SendAsync("ShopError", errorMessage);
            return;
        }

        if (isSuccess)
        {
            // >>> ADD TEXTURE KEY AND FRAME TO THE BROADCAST <<<
            var connectionIds = room.State.Players.Keys.ToList();
            await Clients.Clients(connectionIds).SendAsync("LootNotification", player.Name ?? "Player", pickedUpItemName, itemTier, textureKey, iconFrame);
        }

        await SendPlayerUI(player, room.State);
    }
    public async Task RequestScoreboard()
    {
        // 1. Get the player's ID from their secure token
        string? playerId = Context.User?.FindFirst("PlayerId")?.Value;
        if (string.IsNullOrEmpty(playerId)) return;

        // 2. Use our new helper method to find their exact room!
        var room = _roomManager.GetRoomByPlayerId(playerId);
        if (room == null) return;

        // 3. Build the data
        var scoreboardData = room.State.Players.Values.Select(p => new object[] {
            p.ConnectionId,
            p.Name,
            p.ConfigId,
            (int)p.TotalDamageDealt,
            (int)p.TotalDamageTaken,
            (int)p.TotalHealingDone,
            (int)p.TotalShieldingDone,
            p.Kills,
            p.Deaths
        }).ToList();

        // 4. Send back to the caller
        await Clients.Caller.SendAsync("ReceiveScoreboard", scoreboardData);
    }
    public async Task RecycleGear(bool isWeapon, int slotIndex)
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null || !room.State.Players.TryGetValue(Context.ConnectionId, out var player)) return;
        if (!_configManager.Difficulties.TryGetValue(room.State.CurrentDifficulty, out var diff)) diff = new DifficultyConfig();

        lock (player)
        {
            int basePrice = 0;

            if (isWeapon)
            {
                var w = player.Weapons.FirstOrDefault(x => x.SlotIndex == slotIndex);
                if (w != null)
                {
                    if (_configManager.Weapons.TryGetValue(w.ConfigId, out var wc)) basePrice = wc.Price;
                    // FIX: DO NOT call player.Weapons.Remove(w) first! It breaks RemoveWeapon.
                    player.RemoveWeapon(slotIndex, _configManager);
                }
            }
            else
            {
                var it = player.OwnedItems.FirstOrDefault(x => x.SlotIndex == slotIndex);
                if (it != null)
                {
                    if (_configManager.Items.TryGetValue(it.ConfigId, out var ic)) basePrice = ic.Price;
                    // FIX: DO NOT call player.OwnedItems.Remove(it) first!
                    player.RemoveItem(slotIndex, _configManager);
                }
            }

            // Force a clean recalculation just to be absolutely certain
            player.RecalculateSynergies(_configManager);

            // Fetch active skills AFTER recalculation
            HashSet<string> validSkillIds = player.SynergizedSkills.Select(s => s.ConfigId).ToHashSet();

            // >>> INTERRUPT ONGOING ACTIONS <<<
            // If the player is currently casting or channeling a skill that was just deleted, cancel it!
            if (!string.IsNullOrEmpty(player.CurrentCastingSkillId) && !validSkillIds.Contains(player.CurrentCastingSkillId))
            {
                player.CurrentCastingSkillId = string.Empty;
                player.CurrentCastTimer = 0f;

                // Unfreeze the player so they can move and shoot again
                if (player.ActionState == "Casting" || player.ActionState == "Attacking")
                {
                    player.SetActionState("Idle");
                }
            }

            // --- 5. FINALIZE ---
            int payout = (int)Math.Floor(basePrice * 0.25f * diff.RecycleValueMultiplier);
            player.Gold += Math.Max(1, payout);
            player.StatsNeedRecalculation = true;
        }

        await SendPlayerUI(player, room.State);
    }
}