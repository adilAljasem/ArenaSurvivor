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



        _gameState.Players.TryAdd(Context.ConnectionId, newPlayer);

        Core.GameLoop.GenerateShopForPlayer(newPlayer, _configManager, _gameState.CurrentWave);

        // --- THE HANDSHAKE ---
        // Send ALL the JSON configs to the person who just joined
        var handshakePayload = new
        {
            enemies = _configManager.Enemies,
            weapons = _configManager.Weapons,
            items = _configManager.Items,
            characters = _configManager.Characters,
            statsList = _configManager.AllStats,
            effects = _configManager.Effects,
            projectiles = _configManager.Projectiles,
            skills = _configManager.Skills,
            maps = _configManager.Maps,
            currentMapId = "map_forest"
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
            OwnedItems = player.OwnedItems.Select(i => new
            {
                ConfigId = i.ConfigId,
                SlotIndex = i.SlotIndex,
                Level = i.Level,
                RolledStats = i.RolledStats,
                ItemSkills = i.ItemSkills.Select(s => s.ConfigId).ToList(),
                TotalBaseStats = i.TotalBaseStats
            }).ToArray(),
            CurrentRerollCost = player.CurrentRerollCost,
            CurrentWave = _gameState.CurrentWave,

            // >>> NEW: Send leveling data to the UI <<<
            Level = player.Level,
            CurrentXp = player.CurrentXp,
            XpRequired = player.GetXpRequirement(),
            PendingLevelUps = player.PendingLevelUps,
            LevelUpChoices = player.CurrentLevelUpChoices,

            Stats = _configManager.AllStats.ToDictionary(k => k, k => player.GetTotalStat(k, _configManager)),

            // Include the current game phase so the client never renders shop/level-up cards during active waves
            Phase = _gameState.Phase.ToString()
        };
        await Clients.Caller.SendAsync("UpdatePlayerUI", uiData);
    }

    public async Task BuyItem(string configId)
    {
        if (!_gameState.Players.TryGetValue(Context.ConnectionId, out var player)) return;

        lock (player)
        {
            // Find the item in the player's personal shop
            var shopItem = player.CurrentShop.FirstOrDefault(i => i.ConfigId == configId && !i.IsLocked);
            if (shopItem == null || player.Gold < shopItem.Price) return;

            bool success = false;

            // --- 1. IS IT A WEAPON? ---
            if (_configManager.Weapons.TryGetValue(configId, out var weaponConfig))
            {
                var newWeapon = new Server.Entities.EquippedWeapon
                {
                    ConfigId = shopItem.ConfigId,
                    Level = 1,
                    RolledStats = shopItem.RolledStats ?? new Dictionary<string, float>(),
                    TotalBaseStats = shopItem.TotalBaseStats ?? new Dictionary<string, float>()
                };

                // Add the base config ID to the ancestry so future merges calculate stats correctly
                newWeapon.MergedConfigIds.Add(configId);

                if (shopItem.WeaponSkills != null)
                {
                    foreach (var skillId in shopItem.WeaponSkills)
                    {
                        if (_configManager.Skills.TryGetValue(skillId, out var skillCfg))
                            newWeapon.WeaponSkills.Add(new Server.Entities.ActiveSkill { ConfigId = skillId, CurrentCooldown = skillCfg.CooldownSeconds });
                    }
                }

                // >>> USE THE NEW HELPER <<<
                success = player.TryAddOrMergeWeapon(newWeapon, _configManager);
            }
            // --- 2. IS IT AN ITEM? ---
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

                // >>> USE THE NEW HELPER <<<
                success = player.TryAddOrMergeItem(newItem, _configManager);

                // If it's a new item, safely apply any permanent traits it grants
                if (success && itemConfig.Traits != null)
                {
                    foreach (var trait in itemConfig.Traits)
                    {
                        if (!player.Traits.Contains(trait)) player.Traits.Add(trait);
                    }
                }
            }

            // --- 3. FINALIZE TRANSACTION ---
            if (success)
            {
                player.Gold -= shopItem.Price;
                player.CurrentShop.Remove(shopItem);
            }
        }

        // Always update the UI instantly so the client sees the new gold and inventory!
        await SendPlayerUI(player);
    }

    public async Task SelectLevelUpStat(string cardId)
    {
        if (!_gameState.Players.TryGetValue(Context.ConnectionId, out var player)) return;

        lock (player)
        {
            if (player.PendingLevelUps > 0 && player.CurrentLevelUpChoices.Any(c => c.Id == cardId))
            {
                var card = player.CurrentLevelUpChoices.First(c => c.Id == cardId);

                // Apply the stat bonus
                player.Stats.AddModifier(card.StatName, card.Amount, 0);

                player.PendingLevelUps--;
                player.CurrentLevelUpChoices.Clear();

                // If they leveled up multiple times at once, generate the next batch of choices immediately
                if (player.PendingLevelUps > 0)
                {
                    player.CurrentLevelUpChoices = _configManager.LevelUpCards.Values
                        .OrderBy(x => Random.Shared.Next())
                        .Take(3)
                        .ToList();
                }
            }
        }

        // >>> THE FIX: Tell the client that the card was successfully consumed! <<<
        await SendPlayerUI(player);
    }

    public async Task RerollShop()
    {
        if (_gameState.Players.TryGetValue(Context.ConnectionId, out var player))
        {
            lock (player)
            {
                if (player.Gold >= player.CurrentRerollCost)
                {
                    // Deduct gold and increase cost for the next reroll
                    player.Gold -= player.CurrentRerollCost;
                    player.CurrentRerollCost += 1;

                    // Regenerate the non-locked items
                    Core.GameLoop.GenerateShopForPlayer(player, _configManager, _gameState.CurrentWave);
                }
            }
            await SendPlayerUI(player);
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
    // >>> NEW: The Ping Endpoint! <<<
    public void Ping()
    {
        // This is intentionally left empty. 
        // The client just needs the server to acknowledge the message to calculate latency!
    }

    /// <summary>
    /// Called by the client when the player presses Spacebar near a dropped weapon or item.
    /// Validates the player's proximity to the loot before adding it to their inventory.
    /// </summary>
    public async Task TryPickupLoot(string pickupId)
    {
        if (!_gameState.Players.TryGetValue(Context.ConnectionId, out var player)) return;

        lock (player)
        {
            if (_gameState.Pickups.TryGetValue(pickupId, out var pickup))
            {
                float distSq = (player.X - pickup.X) * (player.X - pickup.X) + (player.Y - pickup.Y) * (player.Y - pickup.Y);
                if (distSq > 2500) return; // Must be within 50 pixels

                bool success = false;

                if (pickup.Type == Server.Entities.PickupType.Weapon && pickup.DroppedWeapon != null)
                {
                    // Force dropped gear to act purely as a Level 1 material before merging!
                    pickup.DroppedWeapon.Level = 1;
                    pickup.DroppedWeapon.MergedConfigIds.Clear();
                    pickup.DroppedWeapon.MergedConfigIds.Add(pickup.DroppedWeapon.ConfigId);

                    success = player.TryAddOrMergeWeapon(pickup.DroppedWeapon, _configManager);
                }
                else if (pickup.Type == Server.Entities.PickupType.Item && pickup.DroppedItem != null)
                {
                    // Force dropped gear to act purely as a Level 1 material before merging!
                    pickup.DroppedItem.Level = 1;
                    pickup.DroppedItem.MergedConfigIds.Clear();
                    pickup.DroppedItem.MergedConfigIds.Add(pickup.DroppedItem.ConfigId);

                    success = player.TryAddOrMergeItem(pickup.DroppedItem, _configManager);
                }

                if (success)
                {
                    _gameState.Pickups.TryRemove(pickupId, out _);
                }
            }
        }

        // >>> FIX: Tell the UI to instantly update so the Shop/Inventory reflects the new gear! <<<
        await SendPlayerUI(player);
    }






}