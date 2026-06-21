using Microsoft.AspNetCore.SignalR;
using Server.Configs;
using Server.Core;
using Server.DTOs;
using Server.Entities;
using Server.Services;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Server.Hubs;

public class MatchHub : Hub
{
    private readonly RoomManager _roomManager;
    private readonly ConfigManager _configManager;
    private readonly RedisService _redisService;

    public MatchHub(RoomManager roomManager, ConfigManager configManager, RedisService redisService)
    {
        _roomManager = roomManager;
        _configManager = configManager;
        _redisService = redisService;
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _roomManager.RemovePlayer(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    // Called automatically by the client when switching from Lobby to Game
    // Expect the secure token from the client
    public async Task JoinLiveMatch(string roomId, string matchToken)
    {
        // 1. Ask Redis to validate the token (Cross-server verification!)
        var tokenData = await _redisService.ValidateAndConsumeToken(matchToken);

        if (tokenData == null || tokenData.Value.RoomId != roomId)
        {
            Console.WriteLine($"[SECURITY] Invalid or expired Match Token rejected for {Context.ConnectionId}");
            return;
        }

        string oldConnectionId = tokenData.Value.OldConnectionId;

        var room = _roomManager.GetRoom(roomId);

        // --- NEW: Worker Room Hydration ---
        if (room == null)
        {
            var transferData = await _redisService.GetRoomTransferData(roomId);
            if (transferData != null)
            {
                // Create the room on the Worker!
                room = _roomManager.GetOrCreateRoom(roomId, _configManager);
                room.RoomName = transferData.RoomName;
                room.HostConnectionId = transferData.HostConnectionId;
                room.CurrentMapId = transferData.CurrentMapId;
                room.State.CurrentDifficulty = transferData.Difficulty;

                // Rebuild the players in RAM
                foreach (var pDto in transferData.Players)
                {
                    var newPlayer = new Server.Entities.PlayerEntity
                    {
                        ConnectionId = pDto.OldConnectionId, // Keep old ID temporarily until stitched
                        Name = pDto.Name,
                        Team = "Player",
                        X = 640,
                        Y = 360,
                        ConfigId = pDto.ConfigId
                    };

                    if (_configManager.Characters.ContainsKey(pDto.ConfigId))
                        newPlayer.Initialize(_configManager.Characters[pDto.ConfigId], _configManager);

                    GenerateShopForPlayer(newPlayer, _configManager, 1);
                    room.State.Players.TryAdd(pDto.OldConnectionId, newPlayer);
                }

                // Start the game loop physics!
                room.StartMatch();
            }
        }
        if (room != null && room.State.Players.TryRemove(oldConnectionId, out var player))
        {
            // 2. Stitch the player to this specific Worker Node's RAM
            player.ConnectionId = Context.ConnectionId;
            room.State.Players.TryAdd(Context.ConnectionId, player);

            if (room.HostConnectionId == oldConnectionId)
                room.HostConnectionId = Context.ConnectionId;

            _roomManager.UpdatePlayerConnectionId(oldConnectionId, Context.ConnectionId, roomId);

            Console.WriteLine($"[MATCH] Redis Token Accepted! Player ID: {Context.ConnectionId}");
            await SendPlayerUI(player, room.State);
        }
    }

    public void SendInput(PlayerInputDto input)
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null) return;

        if (room.State.Players.TryGetValue(Context.ConnectionId, out var player))
        {
            float length = (float)Math.Sqrt(input.DirX * input.DirX + input.DirY * input.DirY);
            player.AimX = input.AimX;
            player.AimY = input.AimY;
            if (length > 0)
            {
                player.InputX = input.DirX / length;
                player.InputY = input.DirY / length;
            }
            else
            {
                player.InputX = 0;
                player.InputY = 0;
            }
        }
    }

    public async Task SendChatMessage(string message)
    {
        if (string.IsNullOrWhiteSpace(message)) return;
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null) return;

        if (message.StartsWith("/"))
        {
            await Server.Commands.CommandDispatcher.ExecuteAsync(message, room.State, _configManager, Context.ConnectionId, Clients.Caller);
        }
        else
        {
            string senderName = room.State.Players.TryGetValue(Context.ConnectionId, out var player) ? player.Name : "Player";
            await Clients.Clients(room.State.Players.Keys).SendAsync("ReceiveChatMessage", senderName, message);
        }
    }

    public void Ping() { }

    // =========================================================
    // UI & SHOP LOGIC
    // =========================================================

    public async Task RequestUIUpdate()
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room != null && room.State.Players.TryGetValue(Context.ConnectionId, out var player))
        {
            lock (player) { _ = SendPlayerUI(player, room.State); }
        }
    }

    private async Task SendPlayerUI(PlayerEntity player, GameState state)
    {
        if (player.PendingLevelUps > 0 && player.CurrentLevelUpChoices.Count == 0)
        {
            player.CurrentLevelUpChoices = _configManager.LevelUpCards.Values
                .OrderBy(x => Random.Shared.Next())
                .Take(3)
                .ToList();
        }

        var uiData = new
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
        };
        await Clients.Caller.SendAsync("UpdatePlayerUI", uiData);
    }

    public static int RollRarityTier(float luck, int maxPossibleTier = 4)
    {
        float weightT1 = Math.Max(10f, 100f - luck);
        float weightT2 = Math.Max(0f, 20f + (luck * 1.5f));
        float weightT3 = Math.Max(0f, (luck - 10f) * 1.0f);
        float weightT4 = Math.Max(0f, (luck - 30f) * 0.5f);

        if (maxPossibleTier < 4) weightT4 = 0;
        if (maxPossibleTier < 3) weightT3 = 0;
        if (maxPossibleTier < 2) weightT2 = 0;

        float totalWeight = weightT1 + weightT2 + weightT3 + weightT4;
        float roll = (float)(Random.Shared.NextDouble() * totalWeight);

        if (weightT4 > 0 && roll <= weightT4) return 4; roll -= weightT4;
        if (weightT3 > 0 && roll <= weightT3) return 3; roll -= weightT3;
        if (weightT2 > 0 && roll <= weightT2) return 2;
        return 1;
    }

    public static void GenerateShopForPlayer(PlayerEntity player, ConfigManager configManager, int currentWave)
    {
        float playerLuck = player.GetTotalStat("luck", configManager);
        player.CurrentShop = player.CurrentShop.Where(item => item.IsLocked).ToList();
        int slotsNeeded = 3 - player.CurrentShop.Count;

        for (int i = 0; i < slotsNeeded; i++)
        {
            int targetTier = RollRarityTier(playerLuck, 4);
            var tierWeapons = configManager.Weapons.Values.Where(w => w.Tier == targetTier && w.AvailableInShop).ToList();
            var tierItems = configManager.Items.Values.Where(itm => itm.Tier == targetTier && itm.AvailableInShop).ToList();

            if (!tierWeapons.Any()) tierWeapons = configManager.Weapons.Values.Where(w => w.Tier <= targetTier && w.AvailableInShop).ToList();
            if (!tierItems.Any()) tierItems = configManager.Items.Values.Where(itm => itm.Tier <= targetTier && itm.AvailableInShop).ToList();

            bool spawnWeapon = Random.Shared.Next(0, 2) == 0 || !tierItems.Any();

            if (spawnWeapon && tierWeapons.Any())
            {
                var w = tierWeapons[Random.Shared.Next(tierWeapons.Count)];
                var previewWeapon = Server.Core.Systems.WeaponGenerator.GenerateWeapon(w.Id, player, configManager, 1);
                player.CurrentShop.Add(new Server.DTOs.ShopItemDto { ConfigId = w.Id, Name = w.Name, Price = w.Price, TotalBaseStats = previewWeapon.TotalBaseStats, RolledStats = previewWeapon.RolledStats, WeaponSkills = previewWeapon.WeaponSkills.Select(s => s.ConfigId).ToList() });
            }
            else if (tierItems.Any())
            {
                var item = tierItems[Random.Shared.Next(tierItems.Count)];
                var previewItem = Server.Core.Systems.ItemGenerator.GenerateItem(item.Id, player, configManager, 1);
                player.CurrentShop.Add(new Server.DTOs.ShopItemDto { ConfigId = item.Id, Name = item.Name, Price = item.Price, TotalBaseStats = previewItem.TotalBaseStats, RolledStats = previewItem.RolledStats, WeaponSkills = previewItem.ItemSkills.Select(s => s.ConfigId).ToList() });
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

            if (_configManager.Weapons.TryGetValue(configId, out var weaponConfig))
            {
                var newWeapon = new Server.Entities.EquippedWeapon
                {
                    ConfigId = shopItem.ConfigId,
                    Level = 1,
                    RolledStats = shopItem.RolledStats ?? new Dictionary<string, float>(),
                    TotalBaseStats = shopItem.TotalBaseStats ?? new Dictionary<string, float>()
                };

                newWeapon.MergedConfigIds.Add(configId);

                if (shopItem.WeaponSkills != null)
                {
                    foreach (var skillId in shopItem.WeaponSkills)
                    {
                        if (_configManager.Skills.TryGetValue(skillId, out var skillCfg))
                            newWeapon.WeaponSkills.Add(new Server.Entities.ActiveSkill { ConfigId = skillId, CurrentCooldown = skillCfg.CooldownSeconds });
                    }
                }

                success = player.TryAddOrMergeWeapon(newWeapon, _configManager);
            }
            else if (_configManager.Items.TryGetValue(configId, out var itemConfig))
            {
                var newItem = new Server.Entities.EquippedItem
                {
                    ConfigId = shopItem.ConfigId,
                    Level = 1,
                    RolledStats = shopItem.RolledStats ?? new Dictionary<string, float>(),
                    TotalBaseStats = shopItem.TotalBaseStats ?? new Dictionary<string, float>()
                };

                newItem.MergedConfigIds.Add(configId);

                if (shopItem.WeaponSkills != null)
                {
                    foreach (var skillId in shopItem.WeaponSkills)
                    {
                        if (_configManager.Skills.TryGetValue(skillId, out var skillCfg))
                            newItem.ItemSkills.Add(new Server.Entities.ActiveSkill { ConfigId = skillId, CurrentCooldown = skillCfg.CooldownSeconds });
                    }
                }

                success = player.TryAddOrMergeItem(newItem, _configManager);

                if (success && itemConfig.Traits != null)
                {
                    bool gainedNewTrait = false;
                    foreach (var trait in itemConfig.Traits)
                    {
                        if (!player.Traits.Contains(trait))
                        {
                            player.Traits.Add(trait);
                            gainedNewTrait = true;
                        }
                    }
                    if (gainedNewTrait) player.StatsNeedRecalculation = true;
                }
            }

            if (success)
            {
                player.Gold -= shopItem.Price;
                player.CurrentShop.Remove(shopItem);
            }
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
                {
                    player.CurrentLevelUpChoices = _configManager.LevelUpCards.Values
                        .OrderBy(x => Random.Shared.Next())
                        .Take(3)
                        .ToList();
                }
            }
        }

        await SendPlayerUI(player, room.State);
    }

    public async Task RerollShop()
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null || !room.State.Players.TryGetValue(Context.ConnectionId, out var player)) return;

        if (!_configManager.Difficulties.TryGetValue(room.State.CurrentDifficulty, out var diffConfig))
            diffConfig = new DifficultyConfig();

        lock (player)
        {
            if (player.Gold >= player.CurrentRerollCost)
            {
                player.Gold -= player.CurrentRerollCost;
                player.CurrentRerollCost += diffConfig.RerollInflation;

                GenerateShopForPlayer(player, _configManager, room.State.CurrentWave);
            }
        }
        await SendPlayerUI(player, room.State);
    }

    public async Task ToggleLock(string configId)
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null || !room.State.Players.TryGetValue(Context.ConnectionId, out var player)) return;

        var item = player.CurrentShop.FirstOrDefault(i => i.ConfigId == configId);
        if (item != null)
        {
            item.IsLocked = !item.IsLocked;
            await SendPlayerUI(player, room.State);
        }
    }

    public async Task TryPickupLoot(string pickupId)
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null || !room.State.Players.TryGetValue(Context.ConnectionId, out var player)) return;

        lock (player)
        {
            if (room.State.Pickups.TryGetValue(pickupId, out var pickup))
            {
                float distSq = (player.X - pickup.X) * (player.X - pickup.X) + (player.Y - pickup.Y) * (player.Y - pickup.Y);
                if (distSq > 2500) return;

                bool success = false;

                if (pickup.Type == Server.Entities.PickupType.Weapon && pickup.DroppedWeapon != null)
                {
                    pickup.DroppedWeapon.Level = 1;
                    pickup.DroppedWeapon.MergedConfigIds.Clear();
                    pickup.DroppedWeapon.MergedConfigIds.Add(pickup.DroppedWeapon.ConfigId);
                    success = player.TryAddOrMergeWeapon(pickup.DroppedWeapon, _configManager);
                }
                else if (pickup.Type == Server.Entities.PickupType.Item && pickup.DroppedItem != null)
                {
                    pickup.DroppedItem.Level = 1;
                    pickup.DroppedItem.MergedConfigIds.Clear();
                    pickup.DroppedItem.MergedConfigIds.Add(pickup.DroppedItem.ConfigId);
                    success = player.TryAddOrMergeItem(pickup.DroppedItem, _configManager);
                }

                if (success)
                {
                    room.State.Pickups.TryRemove(pickupId, out _);
                }
            }
        }

        await SendPlayerUI(player, room.State);
    }

    public async Task RecycleGear(bool isWeapon, int slotIndex)
    {
        var room = _roomManager.GetRoomForPlayer(Context.ConnectionId);
        if (room == null || !room.State.Players.TryGetValue(Context.ConnectionId, out var player)) return;

        lock (player)
        {
            if (!_configManager.Difficulties.TryGetValue(room.State.CurrentDifficulty, out var currentDiff))
                currentDiff = new DifficultyConfig();

            int basePrice = 0;
            if (isWeapon)
            {
                var w = player.Weapons.FirstOrDefault(x => x.SlotIndex == slotIndex);
                if (w != null && _configManager.Weapons.TryGetValue(w.ConfigId, out var wCfg)) basePrice = wCfg.Price;
            }
            else
            {
                var i = player.OwnedItems.FirstOrDefault(x => x.SlotIndex == slotIndex);
                if (i != null && _configManager.Items.TryGetValue(i.ConfigId, out var iCfg)) basePrice = iCfg.Price;
            }

            if (basePrice >= 0)
            {
                int payout = (int)Math.Floor(basePrice * 0.10f * currentDiff.RecycleValueMultiplier);

                if (payout < 0 && player.Gold < Math.Abs(payout)) return;

                player.Gold += Math.Max(0, payout);

                if (isWeapon) player.RemoveWeapon(slotIndex, _configManager);
                else player.RemoveItem(slotIndex, _configManager);
            }
        }

        await SendPlayerUI(player, room.State);
    }
}