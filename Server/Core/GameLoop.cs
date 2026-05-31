using Microsoft.AspNetCore.SignalR;
using Server.Configs;
using Server.Core.Systems;
using Server.Entities;
using Server.Hubs;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Server.Core;

public class GameLoop : BackgroundService
{
    private readonly IHubContext<GameHub> _hubContext;
    private readonly GameState _gameState;
    private readonly ConfigManager _configManager;
    private readonly int _tickRateMs = 50; // 20 Ticks Per Second
    private DateTime _lastSpawnTime = DateTime.UtcNow;
    private Configs.MapConfig? _currentMap;

    public GameLoop(IHubContext<GameHub> hubContext, GameState gameState, ConfigManager configManager)
    {
        _hubContext = hubContext;
        _gameState = gameState;
        _configManager = configManager;
        _configManager.LoadConfigs(); // Load JSON on startup


        // Initialize the current map from config
        if (_configManager.Maps.TryGetValue("map_forest", out var initialMap))
            _currentMap = initialMap;

        // >>> Listen for Hot Reloads and push to all connected players! <<<
        _configManager.OnConfigsReloaded += async () =>
        {
            // Update current map on hot reload
            if (_configManager.Maps.TryGetValue("map_forest", out var reloadedMap))
                _currentMap = reloadedMap;
            var payload = new
            {
                enemies = _configManager.Enemies,
                projectiles = _configManager.Projectiles,
                weapons = _configManager.Weapons,
                items = _configManager.Items,
                characters = _configManager.Characters,
                effects = _configManager.Effects,
                skills = _configManager.Skills,
                maps = _configManager.Maps,
                traits = _configManager.Traits,
                currentMapId = "map_forest"
            };
            await _hubContext.Clients.All.SendAsync("ReceiveHandshake", payload);
        };
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var lastTickTime = DateTime.UtcNow;

        while (!stoppingToken.IsCancellationRequested)
        {
            var currentTickTime = DateTime.UtcNow;
            float dt = (float)(currentTickTime - lastTickTime).TotalSeconds;
            lastTickTime = currentTickTime;

            var prevProjectiles = _gameState.Projectiles.Keys.ToHashSet();

            // 1. Manage State & Timers
            UpdateGamePhases(dt);

            // 2. Process Game Logic based on Phase
            if (_gameState.Phase == GamePhase.WaveActive)
            {
                if (_gameState.PhaseTimer <= 0)
                {
                    await HandleWaveEndTransition();
                }
                else
                {
                    HandleEnemySpawning(currentTickTime);
                }
            }
            else if (_gameState.Phase == GamePhase.ShopPhase && _gameState.PhaseTimer <= 0)
            {
                StartNextWave();
            }

            // 3. >>> THE CLEANED UP SIMULATION LOOP <<<
            var tickDamageEvents = new List<Server.DTOs.DamageEventDto>();
            var tickAoeEvents = new List<Server.DTOs.AoeEventDto>();
            var tickBeamEvents = new List<Server.DTOs.BeamEventDto>();


            // Run all Systems
            MovementSystem.Process(dt, _gameState, _configManager);
            EffectSystem.Process(dt, _gameState, _configManager, tickDamageEvents, tickAoeEvents, tickBeamEvents);
            CombatSystem.ProcessShooting(dt, _gameState, _configManager);
            SkillSystem.Process(dt, _gameState, _configManager, tickDamageEvents, tickAoeEvents, tickBeamEvents);
            CombatSystem.ProcessCollisions(dt, _gameState, _configManager, tickDamageEvents, tickAoeEvents, tickBeamEvents);
            var currProjectiles = _gameState.Projectiles.Keys.ToHashSet();
            var newProjIds = currProjectiles.Except(prevProjectiles).ToList();
            var destroyedProjIds = prevProjectiles.Except(currProjectiles).ToList();

            var tickNewProjectiles = newProjIds.Select(id => _gameState.Projectiles[id]).ToList();
            var tickDestroyedProjectiles = destroyedProjIds;

            // 4. Broadcast to Clients via the cleanly isolated Network System!
            await NetworkSystem.BroadcastStateAsync(
                _hubContext, _gameState, _configManager,
                tickDamageEvents, tickAoeEvents, tickBeamEvents,
                tickNewProjectiles, tickDestroyedProjectiles,
                stoppingToken
            );

            // 5. Maintain Tick Rate
            var executionTime = DateTime.UtcNow - currentTickTime;
            var delay = _tickRateMs - (int)executionTime.TotalMilliseconds;
            if (delay > 0) await Task.Delay(delay, stoppingToken);
        }
    }

    // =================================================================================
    // WAVE & SHOP MANAGEMENT
    // =================================================================================

    private void UpdateGamePhases(float dt)
    {
        if (_gameState.Phase == GamePhase.WaitingForPlayers && !_gameState.Players.IsEmpty)
        {
            _gameState.Phase = GamePhase.WaveActive;
            float waveBonus = _gameState.Players.Values.Sum(p => p.GetEngineMechanic("bonusWaveSeconds", _configManager));
            _gameState.PhaseTimer = Math.Max(10f, 60f + waveBonus); // Math.Max prevents the wave from being 0 seconds!
            _gameState.CurrentWave = 50;
        }

        if (_gameState.Phase != GamePhase.WaitingForPlayers)
        {
            _gameState.PhaseTimer -= dt;
        }
    }

    private async Task HandleWaveEndTransition()
    {
        _gameState.Phase = GamePhase.ShopPhase;
        _gameState.PhaseTimer = 30f;

        // 1. Convert surviving enemies to gold
        foreach (var enemy in _gameState.Enemies.Values)
        {
            var gold = new PickupEntity { X = enemy.X, Y = enemy.Y, Value = 1 };
            _gameState.Pickups.TryAdd(gold.Id, gold);
        }

        _gameState.Enemies.Clear();
        _gameState.Projectiles.Clear();

        // 2. The Co-Op Loot Sweep — auto-collect only Gold/XP; leave weapon & item drops on the ground
        int totalLootValue = _gameState.Pickups.Values
            .Where(p => p.Type == PickupType.Gold)
            .Sum(p => p.Value);

        // Remove only gold pickups; weapon/item pickups persist until the next wave starts
        var goldPickupIds = _gameState.Pickups.Values
            .Where(p => p.Type == PickupType.Gold)
            .Select(p => p.Id)
            .ToList();
        foreach (var id in goldPickupIds)
            _gameState.Pickups.TryRemove(id, out _);

        if (totalLootValue > 0 && !_gameState.Players.IsEmpty)
        {
            int lootPerPlayer = (int)Math.Max(1, Math.Floor((double)totalLootValue / _gameState.Players.Count));
            foreach (var player in _gameState.Players.Values)
            {
                player.Gold += lootPerPlayer;
                player.GainXp(lootPerPlayer, _configManager);
            }
        }

        // 3. Shop Setup & UI Broadcast
        foreach (var player in _gameState.Players.Values)
        {
            player.CurrentRerollCost = 2;
            GenerateShopForPlayer(player, _configManager, _gameState.CurrentWave);

            foreach (var item in player.OwnedItems)
            {
                if (_configManager.Items.TryGetValue(item.ConfigId, out var itemConfig))
                {
                    foreach (var effect in itemConfig.EffectsAtWaveEnd)
                    {
                        player.Stats.AddModifier(effect.StatName, effect.Amount * item.Level, 0);
                    }
                }
            }

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
                Level = player.Level,
                CurrentXp = player.CurrentXp,
                XpRequired = player.GetXpRequirement(),
                PendingLevelUps = player.PendingLevelUps,
                LevelUpChoices = player.CurrentLevelUpChoices,
                Stats = player.Stats.Stats.Keys.ToDictionary(k => k, k => player.GetTotalStat(k, _configManager))
            };
            await _hubContext.Clients.Client(player.ConnectionId).SendAsync("UpdatePlayerUI", uiData);
        }
    }

    private void StartNextWave()
    {
        _gameState.Phase = GamePhase.WaveActive;

        // >>> NEW: RUSHED TRAIT HOOK <<<
        float waveBonus = _gameState.Players.Values.Sum(p => p.GetEngineMechanic("bonusWaveSeconds", _configManager));
        _gameState.PhaseTimer = Math.Max(10f, 60f + waveBonus);

        _gameState.CurrentWave++;

        // Clear any weapon/item loot that was not picked up during the shop phase
        var leftoverLootIds = _gameState.Pickups.Values
            .Where(p => p.Type == PickupType.Weapon || p.Type == PickupType.Item)
            .Select(p => p.Id)
            .ToList();
        foreach (var id in leftoverLootIds)
            _gameState.Pickups.TryRemove(id, out _);
    }

    // =================================================================================
    // SPAWNING LOGIC
    // =================================================================================

    private void HandleEnemySpawning(DateTime currentTickTime)
    {
        float baseSpawnRate = Math.Max(0.5f, 2.0f - (_gameState.CurrentWave * 0.1f));

        // >>> NEW: THE MORE ENEMIES ENGINE HOOK <<<
        // Sum up the spawn multiplier across ALL players in the game
        float totalSpawnBonus = _gameState.Players.Values.Sum(p => p.GetEngineMechanic("enemySpawnRateMult", _configManager));

        // Math: 
        // If bonus is 0.10 (10% More), denominator = 1.10. Division makes the timer smaller (Faster spawns).
        // If bonus is -0.10 (10% Less), denominator = 0.90. Division makes the timer larger (Slower spawns).
        float denominator = Math.Max(0.1f, 1f + totalSpawnBonus);
        float finalSpawnRate = Math.Max(0.1f, baseSpawnRate / denominator);

        // Use finalSpawnRate for the timer check!
        if ((currentTickTime - _lastSpawnTime).TotalSeconds > finalSpawnRate && !_gameState.Players.IsEmpty)
        {
            _lastSpawnTime = currentTickTime;
            bool skipRegularSpawn = false;

            // Boss Spawn Logic (Explicit Waves)
            bool bossAlreadySpawend = _gameState.Enemies.Values.Any(e => _configManager.Enemies[e.ConfigId].IsBoss);

            if (!bossAlreadySpawend && _gameState.PhaseTimer > 50f)
            {
                // Find any boss whose "SpawnOnWaves" array contains the current wave!
                var validBosses = _configManager.Enemies.Values
                    .Where(e => e.IsBoss && !e.IsSummonOnly && e.SpawnOnWaves != null && e.SpawnOnWaves.Contains(_gameState.CurrentWave))
                    .ToList();

                if (validBosses.Any())
                {
                    var bossConfig = validBosses[Random.Shared.Next(validBosses.Count)];
                    SpawnEnemy(bossConfig);
                    Console.WriteLine($"BOSS SPAWNED: {bossConfig.Name} on Wave {_gameState.CurrentWave}!");
                    skipRegularSpawn = true;
                }
            }

            // Regular Spawn Logic (Min/Max Waves + Weighted Randomness)
            if (!skipRegularSpawn)
            {
                var validEnemies = _configManager.Enemies.Values
                    .Where(e => !e.IsBoss && !e.IsSummonOnly && e.MinWave <= _gameState.CurrentWave && e.MaxWave >= _gameState.CurrentWave)
                    .ToList();

                if (validEnemies.Any())
                {
                    // Weighted random selection
                    int totalWeight = validEnemies.Sum(e => e.SpawnWeight);
                    int randomWeight = Random.Shared.Next(0, totalWeight);
                    int cumulativeWeight = 0;

                    Configs.EnemyConfig selectedEnemy = validEnemies.First();

                    foreach (var enemy in validEnemies)
                    {
                        cumulativeWeight += enemy.SpawnWeight;
                        if (randomWeight < cumulativeWeight)
                        {
                            selectedEnemy = enemy;
                            break;
                        }
                    }

                    SpawnEnemy(selectedEnemy);
                }
            }
        }
    }

    private void SpawnEnemy(Configs.EnemyConfig config)
    {
        var newEnemy = new Server.Entities.EnemyEntity();
        float spawnX = 0;
        float spawnY = 0;

        // Use dynamic map size
        float w = _currentMap?.Width ?? 4000f;
        float h = _currentMap?.Height ?? 4000f;

        int edge = Random.Shared.Next(4);
        if (edge == 0) { spawnX = Random.Shared.Next(-200, (int)w + 200); spawnY = Random.Shared.Next(-200, -50); } // Top
        else if (edge == 1) { spawnX = Random.Shared.Next(-200, (int)w + 200); spawnY = Random.Shared.Next((int)h + 50, (int)h + 200); } // Bottom
        else if (edge == 2) { spawnX = Random.Shared.Next(-200, -50); spawnY = Random.Shared.Next(-200, (int)h + 200); } // Left
        else { spawnX = Random.Shared.Next((int)w + 50, (int)w + 200); spawnY = Random.Shared.Next(-200, (int)h + 200); } // Right

        newEnemy.Initialize(config, spawnX, spawnY, _configManager);

        float waveMultiplier = 1f + ((_gameState.CurrentWave - 1) * 0.2f);
        float tierMultiplier = 1f + ((config.Tier - 1) * 0.5f);

        newEnemy.Stats.AddModifier("maxHp", 0, (waveMultiplier * tierMultiplier) - 1f);
        newEnemy.Stats.AddModifier("meleeDamage", 0, ((_gameState.CurrentWave - 1) * 0.05f) * tierMultiplier);
        newEnemy.CurrentHp = newEnemy.GetTotalStat("maxHp", _configManager);

        _gameState.Enemies.TryAdd(newEnemy.Id, newEnemy);
    }

    // =================================================================================
    // SHOP HELPERS
    // =================================================================================

    public static void GenerateShopForPlayer(PlayerEntity player, ConfigManager configManager, int currentWave)
    {
        int maxAllowedTier = (currentWave / 5) + 1;
        var availableWeapons = configManager.Weapons.Values.Where(w => w.Tier <= maxAllowedTier && w.AvailableInShop).ToList();
        var availableItems = configManager.Items.Values.Where(i => i.AvailableInShop).ToList();

        player.CurrentShop = player.CurrentShop.Where(item => item.IsLocked).ToList();
        int slotsNeeded = 3 - player.CurrentShop.Count;

        for (int i = 0; i < slotsNeeded; i++)
        {
            bool spawnWeapon = Random.Shared.Next(0, 2) == 0 || availableItems.Count == 0;

            if (spawnWeapon && availableWeapons.Count > 0)
            {
                var w = availableWeapons[Random.Shared.Next(availableWeapons.Count)];
                var previewWeapon = Server.Core.Systems.WeaponGenerator.GenerateWeapon(w.Id, player, configManager, 1);

                var shopItem = new Server.DTOs.ShopItemDto
                {
                    ConfigId = w.Id,
                    Name = w.Name,
                    Price = w.Price,
                    TotalBaseStats = previewWeapon.TotalBaseStats, // <<< ADD THIS LINE
                    RolledStats = previewWeapon.RolledStats,
                    WeaponSkills = previewWeapon.WeaponSkills.Select(s => s.ConfigId).ToList()
                };

                // Just add it! No more messy server-side preview math.
                player.CurrentShop.Add(shopItem);
            }
            else if (availableItems.Count > 0)
            {
                var item = availableItems[Random.Shared.Next(availableItems.Count)];
                var previewItem = Server.Core.Systems.ItemGenerator.GenerateItem(item.Id, player, configManager, 1);

                player.CurrentShop.Add(new Server.DTOs.ShopItemDto
                {
                    ConfigId = item.Id,
                    Name = item.Name,
                    Price = item.Price,
                    TotalBaseStats = previewItem.TotalBaseStats,
                    RolledStats = previewItem.RolledStats,
                    WeaponSkills = previewItem.ItemSkills.Select(s => s.ConfigId).ToList()
                });
            }
        }
    }
}