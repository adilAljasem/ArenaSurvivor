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

        var w1 = Server.Core.Systems.WeaponGenerator.GenerateWeapon("pistol", newPlayer, _configManager, 1);
        w1.SlotIndex = 0;
        newPlayer.Weapons.Add(w1);

        var w2 = Server.Core.Systems.WeaponGenerator.GenerateWeapon("smg", newPlayer, _configManager, 1);
        w2.SlotIndex = 1;
        newPlayer.Weapons.Add(w2);

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
        if (_gameState.Players.TryGetValue(Context.ConnectionId, out var player))
        {
            var shopItem = player.CurrentShop.FirstOrDefault(x => x.ConfigId == configId);
            if (shopItem == null || player.Gold < shopItem.Price) return;

            // 1. IS IT AN ITEM?
            if (_configManager.Items.TryGetValue(configId, out var itemConfig))
            {
                var newlyBoughtItem = Server.Core.Systems.ItemGenerator.GenerateItem(configId, player, _configManager, 1);
                newlyBoughtItem.RolledStats = shopItem.RolledStats ?? new Dictionary<string, float>();

                if (shopItem.WeaponSkills != null)
                {
                    foreach (var skillId in shopItem.WeaponSkills)
                    {
                        if (_configManager.Skills.TryGetValue(skillId, out var sCfg))
                            newlyBoughtItem.ItemSkills.Add(new Server.Entities.ActiveSkill { ConfigId = skillId, CurrentCooldown = sCfg.CooldownSeconds });
                    }
                }

                var existingItem = player.OwnedItems.FirstOrDefault(i =>
                    _configManager.Items.TryGetValue(i.ConfigId, out var existingCfg) &&
                    (
                        (!string.IsNullOrEmpty(itemConfig.ItemFamily) && existingCfg.ItemFamily == itemConfig.ItemFamily)
                        || i.ConfigId == configId
                    )
                );

                if (existingItem != null)
                {
                    player.Gold -= shopItem.Price;
                    var upgradedItem = Server.Core.Systems.ItemGenerator.MergeItems(existingItem, newlyBoughtItem, _configManager);
                    player.OwnedItems.Remove(existingItem);
                    player.OwnedItems.Add(upgradedItem);
                }
                else
                {
                    if (player.OwnedItems.Count < 5) // Assuming 5 max item slots
                    {
                        player.Gold -= shopItem.Price;
                        var usedSlots = player.OwnedItems.Select(i => i.SlotIndex).ToList();
                        int nextSlot = 0;
                        while (usedSlots.Contains(nextSlot)) nextSlot++;

                        newlyBoughtItem.SlotIndex = nextSlot;
                        player.OwnedItems.Add(newlyBoughtItem);

                        // Apply one-time traits
                        foreach (var trait in itemConfig.Traits) player.Traits.Add(trait);
                        if (itemConfig.EffectsOnPurchase.Contains("DuplicateNextItem")) player.DuplicateNextPurchase = true;
                    }
                    else return;
                }

                player.CurrentShop.Remove(shopItem);
                await SendPlayerUI(player);
                return;
            }

            // 2. IS IT A WEAPON?
            if (_configManager.Weapons.TryGetValue(configId, out var weaponConfig))
            {
                var newlyBoughtWeapon = new Server.Entities.EquippedWeapon
                {
                    ConfigId = configId,
                    Level = 1,
                    SlotIndex = 0,
                    RolledStats = shopItem.RolledStats ?? new Dictionary<string, float>()
                };
                newlyBoughtWeapon.MergedConfigIds.Add(configId);

                if (shopItem.WeaponSkills != null)
                {
                    foreach (var skillId in shopItem.WeaponSkills)
                    {
                        if (_configManager.Skills.TryGetValue(skillId, out var sCfg))
                        {
                            newlyBoughtWeapon.WeaponSkills.Add(new Server.Entities.ActiveSkill { ConfigId = skillId, CurrentCooldown = sCfg.CooldownSeconds });
                        }
                    }
                }

                var existingWeapon = player.Weapons.FirstOrDefault(w =>
                        _configManager.Weapons.TryGetValue(w.ConfigId, out var existingCfg) &&
                        (
                            // If both have a family, merge them!
                            (!string.IsNullOrEmpty(weaponConfig.WeaponFamily) && existingCfg.WeaponFamily == weaponConfig.WeaponFamily)
                            ||
                            // Fallback: If no family is defined, merge by exact ID
                            w.ConfigId == configId
                        )
                    );

                if (existingWeapon != null)
                {
                    player.Gold -= shopItem.Price;

                    // Merge using our pre-generated stats
                    var upgradedWeapon = Server.Core.Systems.WeaponGenerator.MergeWeapons(existingWeapon, newlyBoughtWeapon, _configManager);

                    player.Weapons.Remove(existingWeapon);
                    player.Weapons.Add(upgradedWeapon);
                }
                else
                {
                    if (player.Weapons.Count < 4)
                    {
                        player.Gold -= shopItem.Price;

                        var usedSlots = player.Weapons.Select(w => w.SlotIndex).ToList();
                        int nextSlot = 0;
                        while (usedSlots.Contains(nextSlot)) nextSlot++;

                        newlyBoughtWeapon.SlotIndex = nextSlot;
                        player.Weapons.Add(newlyBoughtWeapon);
                    }
                    else
                    {
                        return; // Inventory full, gold is saved.
                    }
                }

                player.CurrentShop.Remove(shopItem);
                await SendPlayerUI(player);
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
                    // >>> FIX: We just pass the single Amount. The math engine handles the rest! <<<
                    player.Stats.AddModifier(card.StatName, card.Amount, 0);

                    player.PendingLevelUps--;
                    player.CurrentLevelUpChoices.Clear();

                    await SendPlayerUI(player);
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
        if (!_gameState.Pickups.TryGetValue(pickupId, out var pickup)) return;

        // Validate the pickup is a weapon or item (gold is auto-collected)
        if (pickup.Type == Entities.PickupType.Gold) return;

        // Validate the player is close enough (50px radius, larger than the 25px auto-gold radius)
        float dx = player.X - pickup.X;
        float dy = player.Y - pickup.Y;
        if (dx * dx + dy * dy > 2500f) return; // 50² = 2500

        // Atomically remove the pickup so two players can't grab the same drop
        if (!_gameState.Pickups.TryRemove(pickupId, out _)) return;

        if (pickup.Type == Entities.PickupType.Weapon && pickup.DroppedWeapon != null)
        {
            var droppedWeapon = pickup.DroppedWeapon;
            _configManager.Weapons.TryGetValue(droppedWeapon.ConfigId, out var droppedWCfg);

            // Look for an existing weapon of the same family to merge with
            EquippedWeapon? matchingWeapon = null;
            if (!string.IsNullOrEmpty(droppedWCfg?.WeaponFamily))
            {
                matchingWeapon = player.Weapons.FirstOrDefault(ow =>
                    _configManager.Weapons.TryGetValue(ow.ConfigId, out var owCfg) &&
                    owCfg.WeaponFamily == droppedWCfg.WeaponFamily);
            }

            if (matchingWeapon != null)
            {
                var merged = Server.Core.Systems.WeaponGenerator.MergeWeapons(matchingWeapon, droppedWeapon, _configManager);
                merged.SlotIndex = matchingWeapon.SlotIndex;
                player.Weapons[matchingWeapon.SlotIndex] = merged;
            }
            else
            {
                droppedWeapon.SlotIndex = player.Weapons.Count;
                player.Weapons.Add(droppedWeapon);
            }
        }
        else if (pickup.Type == Entities.PickupType.Item && pickup.DroppedItem != null)
        {
            var droppedItem = pickup.DroppedItem;
            _configManager.Items.TryGetValue(droppedItem.ConfigId, out var droppedICfg);

            // Look for an existing item of the same family to merge with
            EquippedItem? matchingItem = null;
            if (!string.IsNullOrEmpty(droppedICfg?.ItemFamily))
            {
                matchingItem = player.OwnedItems.FirstOrDefault(oi =>
                    _configManager.Items.TryGetValue(oi.ConfigId, out var oiCfg) &&
                    oiCfg.ItemFamily == droppedICfg.ItemFamily);
            }

            if (matchingItem != null)
            {
                var merged = Server.Core.Systems.ItemGenerator.MergeItems(matchingItem, droppedItem, _configManager);
                merged.SlotIndex = matchingItem.SlotIndex;
                player.OwnedItems[matchingItem.SlotIndex] = merged;
            }
            else
            {
                droppedItem.SlotIndex = player.OwnedItems.Count;
                player.OwnedItems.Add(droppedItem);
            }
        }

        await SendPlayerUI(player);
    }

    
}