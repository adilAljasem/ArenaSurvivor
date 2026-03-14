using Microsoft.AspNetCore.SignalR;
using Server.Configs;
using Server.Core;
using Server.DTOs;
using Server.Entities;

namespace Server.Hubs;

public class GameHub : Hub
{
    private readonly GameState _gameState;
    private readonly ConfigManager _configManager;

    public GameHub(GameState gameState, ConfigManager configManager)
    {
        _gameState = gameState;
        _configManager = configManager;
    }

    public override async Task OnConnectedAsync()
    {
        var newPlayer = new PlayerEntity
        {
            ConnectionId = Context.ConnectionId,
            X = 640,
            Y = 360
        };

        // >>> FIX: Initialize the player's stats from the data-driven config! <<<
        if (_configManager.Characters != null && _configManager.Characters.TryGetValue("char_well_rounded", out var charConfig))
        {
            // >>> Pass the ConfigManager! <<<
            newPlayer.Initialize(charConfig, _configManager);
        }
        else
        {
            // Fallback just in case you haven't created Characters.json yet
            newPlayer.Stats.InitializeStat("speed", 200f);
            newPlayer.Stats.InitializeStat("maxHp", 100f);
            newPlayer.CurrentHp = 100f;
        }

        newPlayer.Weapons.Add(new EquippedWeapon { ConfigId = "pistol", SlotIndex = 0 }); // Right
        newPlayer.Weapons.Add(new EquippedWeapon { ConfigId = "smg", SlotIndex = 1 });  // Left
        _gameState.Players.TryAdd(Context.ConnectionId, newPlayer);

        Core.GameLoop.GenerateShopForPlayer(newPlayer, _configManager, _gameState.CurrentWave);

        // --- THE HANDSHAKE ---
        // Send ALL the JSON configs to the person who just joined
        var handshakePayload = new
        {
            Enemies = _configManager.Enemies,
            Weapons = _configManager.Weapons, // <-- ADD THIS
            Items = _configManager.Items,
            Characters = _configManager.Characters, // <-- ADD THIS
            StatsList = _configManager.AllStats // >>> NEW: Send the master list! <<<
        };
        await Clients.Caller.SendAsync("ReceiveHandshake", handshakePayload);
        await SendPlayerUI(newPlayer);

        Console.WriteLine($"Player joined: {Context.ConnectionId}");
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _gameState.Players.TryRemove(Context.ConnectionId, out _);
        Console.WriteLine($"Player left: {Context.ConnectionId}");
        await base.OnDisconnectedAsync(exception);
    }

    public void SendInput(PlayerInputDto input)
    {
        if (_gameState.Players.TryGetValue(Context.ConnectionId, out var player))
        {
            // Normalize the vector so diagonal movement isn't faster
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

    private async Task SendPlayerUI(PlayerEntity player)
    {
        // Generate choices if they leveled up!
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
            OwnedItems = player.OwnedItems.Select(kvp => new { ConfigId = kvp.Key, Count = kvp.Value }).ToArray(),
            CurrentRerollCost = player.CurrentRerollCost,
            CurrentWave = _gameState.CurrentWave,

            // >>> NEW: Send leveling data to the UI <<<
            Level = player.Level,
            CurrentXp = player.CurrentXp,
            XpRequired = player.GetXpRequirement(),
            PendingLevelUps = player.PendingLevelUps,
            LevelUpChoices = player.CurrentLevelUpChoices,

            Stats = _configManager.AllStats.ToDictionary(k => k, k => player.GetTotalStat(k, _configManager))
        };
        await Clients.Caller.SendAsync("UpdatePlayerUI", uiData);
    }

    public async Task BuyItem(string configId)
    {
        if (_gameState.Players.TryGetValue(Context.ConnectionId, out var player))
        {
            var shopItem = player.CurrentShop.FirstOrDefault(x => x.ConfigId == configId);
            if (shopItem == null || player.Gold < shopItem.Price) return;

            // 1. IS IT AN ITEM?
            if (_configManager.Items.TryGetValue(configId, out var itemConfig))
            {
                // >>> FIX: Check if they are at the 5 unique item limit! <<<
                if (!player.OwnedItems.ContainsKey(itemConfig.Id) && player.OwnedItems.Count >= 5)
                {
                    return; // Inventory full, abort purchase (gold is saved)
                }

                player.Gold -= shopItem.Price;

                if (player.DuplicateNextPurchase)
                {
                    player.DuplicateNextPurchase = false;
                    AddItemToInventory(player, itemConfig);
                    AddItemToInventory(player, itemConfig);
                }
                else
                {
                    AddItemToInventory(player, itemConfig);
                }

                player.CurrentShop.Remove(shopItem);
                await SendPlayerUI(player);
                return;
            }

            // 2. IS IT A WEAPON?
            if (_configManager.Weapons.TryGetValue(configId, out var weaponConfig))
            {
                var existingWeapon = player.Weapons.FirstOrDefault(w => w.ConfigId == configId);

                // If they already have it, upgrade it (bypasses max slot limit)
                if (existingWeapon != null)
                {
                    player.Gold -= shopItem.Price;
                    existingWeapon.Level++;
                    player.CurrentShop.Remove(shopItem);
                    await SendPlayerUI(player);
                    return;
                }

                // >>> FIX: Only deduct gold if they have an empty weapon slot! <<<
                if (player.Weapons.Count < 4)
                {
                    var usedSlots = player.Weapons.Select(w => w.SlotIndex).ToList();
                    int nextSlot = 0;
                    while (usedSlots.Contains(nextSlot)) nextSlot++;

                    player.Gold -= shopItem.Price;
                    player.Weapons.Add(new Server.Entities.EquippedWeapon { ConfigId = configId, SlotIndex = nextSlot, Level = 1 });
                    player.CurrentShop.Remove(shopItem);
                    await SendPlayerUI(player);
                }
            }
        }
    }

    public async Task SelectLevelUpStat(string cardId)
    {
        if (_gameState.Players.TryGetValue(Context.ConnectionId, out var player))
        {
            if (player.PendingLevelUps > 0)
            {
                var card = player.CurrentLevelUpChoices.FirstOrDefault(c => c.Id == cardId);
                if (card != null)
                {
                    // Applies the stat globally and permanently!
                    player.Stats.AddModifier(card.StatName, card.FlatAmount, card.PercentAmount);
                    player.PendingLevelUps--;
                    player.CurrentLevelUpChoices.Clear();
                    
                    await SendPlayerUI(player); // Recursively sends new cards if they leveled up multiple times!
                }
            }
        }
    }

    public async Task RerollShop()
    {
        if (_gameState.Players.TryGetValue(Context.ConnectionId, out var player))
        {
            if (player.Gold >= player.CurrentRerollCost)
            {
                // Deduct gold and increase cost for the next reroll
                player.Gold -= player.CurrentRerollCost;
                player.CurrentRerollCost += 1;

                // Regenerate the non-locked items
                Core.GameLoop.GenerateShopForPlayer(player, _configManager, _gameState.CurrentWave);
                await SendPlayerUI(player); // Add this at the end of the success blocks!
            }
        }
    }

    public async Task ToggleLock(string configId)
    {
        if (_gameState.Players.TryGetValue(Context.ConnectionId, out var player))
        {
            var item = player.CurrentShop.FirstOrDefault(i => i.ConfigId == configId);
            if (item != null)
            {
                item.IsLocked = !item.IsLocked; // Flip it!
                await SendPlayerUI(player); // Update the UI after toggling the lock
            }
        }
    }

    // Add this helper method right below BuyItem inside GameHub
    private void AddItemToInventory(Server.Entities.PlayerEntity player, Server.Configs.ItemConfig item)
    {
        if (!player.OwnedItems.TryAdd(item.Id, 1))
            player.OwnedItems[item.Id]++;

        foreach (var trait in item.Traits)
            player.Traits.Add(trait);

        if (item.EffectsOnPurchase.Contains("DuplicateNextItem"))
            player.DuplicateNextPurchase = true;
    }
}