using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using Server.Configs;
using Server.Core;
using Server.Core.Systems;
using Server.DTOs;
using Server.Entities;
using Server.Services;
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

    public MatchHub(RoomManager roomManager, ConfigManager configManager, RedisService redisService, IOptions<RoomConfig> roomConfig,
                      IOptions<ServerConfig> serverConfig)
    {
        _roomManager = roomManager;
        _configManager = configManager;
        _redisService = redisService;
        _roomConfig = roomConfig.Value;
        _serverConfig = serverConfig.Value;
    }

    public override async Task OnConnectedAsync()
    {
        string? playerId = Context.User?.FindFirst("PlayerId")?.Value;
        if (!string.IsNullOrEmpty(playerId))
        {
            string? jwtSessionId = Context.User?.FindFirst("SessionId")?.Value;
            string? activeSessionId = await _redisService.GetActiveSession(playerId);

            if (string.IsNullOrEmpty(jwtSessionId) || jwtSessionId != activeSessionId)
            {
                await Clients.Caller.SendAsync("MatchError", "Logged in from another location.");
                Context.Abort();
                return;
            }
        }
        await base.OnConnectedAsync();
    }

    // Reads the PlayerId claim from the validated JWT — the client cannot forge this.
    private string GetPlayerId() =>
        Context.User?.FindFirst("PlayerId")?.Value
        ?? throw new HubException("Not authenticated.");
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
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
                        Team = "Player",
                        X = 640,
                        Y = 360,
                        ConfigId = dto.ConfigId
                    };
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
            currentMapId = room.CurrentMapId
        });

        await SendPlayerUI(stitchedPlayer!, room.State);

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

        if (message.StartsWith("/"))
            await Server.Commands.CommandDispatcher.ExecuteAsync(message, room, _configManager, Context.ConnectionId, Clients.Caller);
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

    public static void GenerateShopForPlayer(PlayerEntity player, ConfigManager configManager, int currentWave)
    {
        float luck = player.GetTotalStat("luck", configManager);
        player.CurrentShop = player.CurrentShop.Where(i => i.IsLocked).ToList();
        int slots = 3 - player.CurrentShop.Count;

        for (int i = 0; i < slots; i++)
        {
            int tier = RollRarityTier(luck, 4);
            var weapons = configManager.Weapons.Values.Where(w => w.Tier == tier && w.AvailableInShop).ToList();
            var items = configManager.Items.Values.Where(it => it.Tier == tier && it.AvailableInShop).ToList();
            if (!weapons.Any()) weapons = configManager.Weapons.Values.Where(w => w.Tier <= tier && w.AvailableInShop).ToList();
            if (!items.Any()) items = configManager.Items.Values.Where(it => it.Tier <= tier && it.AvailableInShop).ToList();

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
        lock (player)
        {
            var shopItem = player.CurrentShop.FirstOrDefault(i => i.ConfigId == configId && !i.IsLocked);
            if (shopItem == null || player.Gold < shopItem.Price) return;
            bool success = false;
            if (_configManager.Weapons.TryGetValue(configId, out _))
            {
                var w = new EquippedWeapon { ConfigId = shopItem.ConfigId, Level = 1, RolledStats = shopItem.RolledStats ?? new(), TotalBaseStats = shopItem.TotalBaseStats ?? new() };
                w.MergedConfigIds.Add(configId);
                if (shopItem.WeaponSkills != null) foreach (var sid in shopItem.WeaponSkills) if (_configManager.Skills.TryGetValue(sid, out var sc)) w.WeaponSkills.Add(new ActiveSkill { ConfigId = sid, CurrentCooldown = sc.CooldownSeconds });
                success = player.TryAddOrMergeWeapon(w, _configManager);
            }
            else if (_configManager.Items.TryGetValue(configId, out var itemConfig))
            {
                var it = new EquippedItem { ConfigId = shopItem.ConfigId, Level = 1, RolledStats = shopItem.RolledStats ?? new(), TotalBaseStats = shopItem.TotalBaseStats ?? new() };
                it.MergedConfigIds.Add(configId);
                if (shopItem.WeaponSkills != null) foreach (var sid in shopItem.WeaponSkills) if (_configManager.Skills.TryGetValue(sid, out var sc)) it.ItemSkills.Add(new ActiveSkill { ConfigId = sid, CurrentCooldown = sc.CooldownSeconds });
                success = player.TryAddOrMergeItem(it, _configManager);
                if (success && itemConfig.Traits != null) { bool g = false; foreach (var t in itemConfig.Traits) if (!player.Traits.Contains(t)) { player.Traits.Add(t); g = true; } if (g) player.StatsNeedRecalculation = true; }
            }
            if (success) { player.Gold -= shopItem.Price; player.CurrentShop.Remove(shopItem); }
        }
        await SendPlayerUI(player, room.State);
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
        lock (player)
        {
            if (!room.State.Pickups.TryGetValue(pickupId, out var pickup)) return;
            float dx = player.X - pickup.X, dy = player.Y - pickup.Y;
            if (dx * dx + dy * dy > 2500) return;
            bool success = false;
            if (pickup.Type == PickupType.Weapon && pickup.DroppedWeapon != null) { pickup.DroppedWeapon.Level = 1; pickup.DroppedWeapon.MergedConfigIds.Clear(); pickup.DroppedWeapon.MergedConfigIds.Add(pickup.DroppedWeapon.ConfigId); success = player.TryAddOrMergeWeapon(pickup.DroppedWeapon, _configManager); }
            else if (pickup.Type == PickupType.Item && pickup.DroppedItem != null) { pickup.DroppedItem.Level = 1; pickup.DroppedItem.MergedConfigIds.Clear(); pickup.DroppedItem.MergedConfigIds.Add(pickup.DroppedItem.ConfigId); success = player.TryAddOrMergeItem(pickup.DroppedItem, _configManager); }
            if (success) room.State.Pickups.TryRemove(pickupId, out _);
        }
        await SendPlayerUI(player, room.State);
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
                // 1. Safely find the actual weapon matching the SlotIndex
                var w = player.Weapons.FirstOrDefault(x => x.SlotIndex == slotIndex);
                if (w != null)
                {
                    if (_configManager.Weapons.TryGetValue(w.ConfigId, out var wc)) basePrice = wc.Price;

                    // 2. Remove the weapon from the list first
                    player.Weapons.Remove(w);

                    // 3. Strip skills that came from this weapon and are no longer granted by any remaining gear
                    if (w.WeaponSkills != null)
                    {
                        foreach (var ws in w.WeaponSkills)
                        {
                            bool grantedElsewhere =
                                player.Weapons.Any(ow => ow.WeaponSkills?.Any(s => s.ConfigId == ws.ConfigId) == true) ||
                                player.OwnedItems.Any(oi => oi.ItemSkills?.Any(s => s.ConfigId == ws.ConfigId) == true);
                            if (!grantedElsewhere)
                                player.SynergizedSkills.RemoveAll(s => s.ConfigId == ws.ConfigId);
                        }
                    }

                    // 4. Attempt the full rebuild (may crash if it relies on the weapon still being in the list)
                    try { player.RemoveWeapon(slotIndex, _configManager); } catch { }
                }
            }
            else
            {
                // 1. Safely find the actual item matching the SlotIndex
                var it = player.OwnedItems.FirstOrDefault(x => x.SlotIndex == slotIndex);
                if (it != null)
                {
                    if (_configManager.Items.TryGetValue(it.ConfigId, out var ic)) basePrice = ic.Price;

                    // 2. Remove the item from the list first
                    player.OwnedItems.Remove(it);

                    // 3. Strip skills that came from this item and are no longer granted by any remaining gear
                    if (it.ItemSkills != null)
                    {
                        foreach (var itemSkill in it.ItemSkills)
                        {
                            bool grantedElsewhere =
                                player.Weapons.Any(ow => ow.WeaponSkills?.Any(s => s.ConfigId == itemSkill.ConfigId) == true) ||
                                player.OwnedItems.Any(oi => oi.ItemSkills?.Any(s => s.ConfigId == itemSkill.ConfigId) == true);
                            if (!grantedElsewhere)
                                player.SynergizedSkills.RemoveAll(s => s.ConfigId == itemSkill.ConfigId);
                        }
                    }

                    // 4. Attempt the full rebuild
                    try { player.RemoveItem(slotIndex, _configManager); } catch { }
                }
            }

            // 4. Grant the gold payout (Guaranteed minimum of 1 gold)
            int payout = (int)Math.Floor(basePrice * 0.25f * diff.RecycleValueMultiplier);
            player.Gold += Math.Max(1, payout);

            // 5. Force stats to completely recalculate without the gear equipped
            player.StatsNeedRecalculation = true;
        }

        // 6. Because we didn't crash, the UI will successfully update!
        await SendPlayerUI(player, room.State);
    }
}