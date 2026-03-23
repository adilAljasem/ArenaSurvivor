using Microsoft.AspNetCore.SignalR;
using Server.Configs;
using Server.Core.Systems; // <<< Brings in your new clean systems!
using Server.Entities;
using Server.Hubs;
using System.Collections.Concurrent;

namespace Server.Core;

public class GameLoop : BackgroundService
{
    private readonly IHubContext<GameHub> _hubContext;
    private readonly GameState _gameState;
    private readonly ConfigManager _configManager;
    private readonly int _tickRateMs = 50; // 20 Ticks Per Second
    private DateTime _lastSpawnTime = DateTime.UtcNow;

    public GameLoop(IHubContext<GameHub> hubContext, GameState gameState, ConfigManager configManager)
    {
        _hubContext = hubContext;
        _gameState = gameState;
        _configManager = configManager;
        _configManager.LoadConfigs(); // Load JSON on startup

        // >>> Listen for Hot Reloads and push to all connected players! <<<
        _configManager.OnConfigsReloaded += async () =>
        {
            var payload = new
            {
                enemies = _configManager.Enemies,
                projectiles = _configManager.Projectiles,
                weapons = _configManager.Weapons,
                items = _configManager.Items,
                characters = _configManager.Characters,
                effects = _configManager.Effects,
                skills = _configManager.Skills
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

            MovementSystem.Process(dt, _gameState, _configManager);
            EffectSystem.Process(dt, _gameState, _configManager, tickDamageEvents);
            CombatSystem.ProcessShooting(dt, _gameState, _configManager);
            SkillSystem.Process(dt, _gameState, _configManager, tickDamageEvents, tickAoeEvents);
            CombatSystem.ProcessCollisions(dt, _gameState, _configManager, tickDamageEvents);

            // 4. Broadcast to Clients
            await BroadcastStateAsync(tickDamageEvents, tickAoeEvents, stoppingToken);

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
            _gameState.PhaseTimer = 60f;
            _gameState.CurrentWave = 1; // Or whatever wave you are testing on!
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

        // 2. The Co-Op Loot Sweep
        int totalLootValue = _gameState.Pickups.Values.Sum(p => p.Value);
        _gameState.Pickups.Clear(); 

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

            foreach (var kvp in player.OwnedItems)
            {
                if (_configManager.Items.TryGetValue(kvp.Key, out var itemConfig))
                {
                    int stackCount = kvp.Value;
                    foreach (var effect in itemConfig.EffectsAtWaveEnd)
                    {
                        player.Stats.AddModifier(effect.StatName, effect.Amount * stackCount, 0);
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
                OwnedItems = player.OwnedItems.Select(kvp => new { ConfigId = kvp.Key, Count = kvp.Value }).ToArray(),
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
        _gameState.PhaseTimer = 60f;
        _gameState.CurrentWave++;
    }

    // =================================================================================
    // SPAWNING LOGIC
    // =================================================================================

    private void HandleEnemySpawning(DateTime currentTickTime)
    {
        int maxAllowedTier = (_gameState.CurrentWave / 5) + 1;
        float spawnRate = Math.Max(0.5f, 2.0f - (_gameState.CurrentWave * 0.1f));

        if ((currentTickTime - _lastSpawnTime).TotalSeconds > spawnRate && !_gameState.Players.IsEmpty)
        {
            _lastSpawnTime = currentTickTime;
            bool skipRegularSpawn = false;

            // Boss Spawn Logic
            if (_gameState.CurrentWave % 10 == 0)
            {
                bool bossAlreadySpawend = _gameState.Enemies.Values.Any(e => _configManager.Enemies[e.ConfigId].IsBoss);

                if (!bossAlreadySpawend && _gameState.PhaseTimer > 50f)
                {
                    // >>> FIX: Check !e.IsSummonOnly for Bosses! <<<
                    var bossConfigs = _configManager.Enemies.Values.Where(e => e.IsBoss && !e.IsSummonOnly && e.Tier <= maxAllowedTier).ToList();
                    if (bossConfigs.Any())
                    {
                        var bossConfig = bossConfigs[Random.Shared.Next(bossConfigs.Count)];
                        SpawnEnemy(bossConfig);
                        Console.WriteLine($"BOSS SPAWNED: {bossConfig.Name}!");
                        skipRegularSpawn = true;
                    }
                }
            }

            // Regular Spawn Logic
            if (!skipRegularSpawn)
            {
                // >>> FIX: Check !e.IsSummonOnly for regular enemies/trees! <<<
                var availableEnemies = _configManager.Enemies.Values.Where(e => !e.IsBoss && !e.IsSummonOnly).ToList();

                int targetTier = maxAllowedTier;
                if (maxAllowedTier > 1 && Random.Shared.Next(0, 100) < 50)
                {
                    targetTier = Random.Shared.Next(1, maxAllowedTier);
                }

                var tierSpecificEnemies = availableEnemies.Where(e => e.Tier == targetTier).ToList();
                if (!tierSpecificEnemies.Any()) tierSpecificEnemies = availableEnemies.Where(e => e.Tier == 1).ToList();

                if (tierSpecificEnemies.Any())
                {
                    var enemyToSpawn = tierSpecificEnemies[Random.Shared.Next(tierSpecificEnemies.Count)];
                    SpawnEnemy(enemyToSpawn);
                }
            }
        }
    }

    private void SpawnEnemy(Configs.EnemyConfig config)
    {
        var newEnemy = new Server.Entities.EnemyEntity();
        float spawnX = Random.Shared.Next(0, 1280);
        float spawnY = Random.Shared.Next(0, 720);
        newEnemy.Initialize(config, spawnX, spawnY, _configManager);

        float waveMultiplier = 1f + ((_gameState.CurrentWave - 1) * 0.2f);
        float tierMultiplier = 1f + ((config.Tier - 1) * 0.5f);

        newEnemy.Stats.AddModifier("maxHp", 0, (waveMultiplier * tierMultiplier) - 1f);
        newEnemy.Stats.AddModifier("meleeDamage", 0, ((_gameState.CurrentWave - 1) * 0.05f) * tierMultiplier);

        newEnemy.CurrentHp = newEnemy.GetTotalStat("maxHp", _configManager);

        _gameState.Enemies.TryAdd(newEnemy.Id, newEnemy);
    }

    // =================================================================================
    // SHOP HELPERS & NETWORK
    // =================================================================================

    public static void GenerateShopForPlayer(PlayerEntity player, ConfigManager configManager, int currentWave)
    {
        int maxAllowedTier = (currentWave / 5) + 1;
        var availableWeapons = configManager.Weapons.Values.Where(w => w.Tier <= maxAllowedTier).ToList();
        var availableItems = configManager.Items.Values.ToList();

        player.CurrentShop = player.CurrentShop.Where(item => item.IsLocked).ToList();
        int slotsNeeded = 3 - player.CurrentShop.Count;

        for (int i = 0; i < slotsNeeded; i++)
        {
            bool spawnWeapon = Random.Shared.Next(0, 2) == 0 || availableItems.Count == 0;

            if (spawnWeapon && availableWeapons.Count > 0)
            {
                var w = availableWeapons[Random.Shared.Next(availableWeapons.Count)];
                player.CurrentShop.Add(new Server.DTOs.ShopItemDto { ConfigId = w.Id, Name = w.Name, Price = w.Tier * 15 });
            }
            else if (availableItems.Count > 0)
            {
                var item = availableItems[Random.Shared.Next(availableItems.Count)];
                player.CurrentShop.Add(new Server.DTOs.ShopItemDto { ConfigId = item.Id, Name = item.Name, Price = 25 });
            }
        }
    }

    private async Task BroadcastStateAsync(List<Server.DTOs.DamageEventDto> tickDamageEvents, List<Server.DTOs.AoeEventDto> tickAoeEvents, CancellationToken stoppingToken)
    {
        if (!_gameState.Players.IsEmpty)
        {
            // 1. FORMAT PLAYERS
            var playersDto = _gameState.Players.Values.Select(p => new
            {
                p.ConnectionId,
                p.X,
                p.Y,
                p.AimX,
                p.AimY,
                p.CurrentHp,
                MaxHp = p.GetTotalStat("maxHp", _configManager),
                p.Gold,
                p.ActionState,            
                p.CurrentCastingSkillId,  
                p.CurrentCastTimer,       
                p.MaxCastTimer,           
                Weapons = p.Weapons,
                FiredWeapons = p.FiredWeaponsThisTick.ToList(),
                ActiveEffects = p.ActiveEffects.Select(e => e.ConfigId).ToList() 
            });

            // 2. FORMAT ENEMIES
            var enemiesDto = _gameState.Enemies.Values.Select(e => new
            {
                e.Id,
                e.ConfigId,
                e.X,
                e.Y,
                e.CurrentHp,
                e.ActionState,
                e.CurrentCastingSkillId, 
                e.CurrentCastTimer,      
                e.MaxCastTimer,          
                MaxHp = e.GetTotalStat("maxHp", _configManager), 
                ActiveEffects = e.ActiveEffects.Select(a => a.ConfigId).ToList() 
            });

            // 3. BUILD THE FINAL PAYLOAD
            var payload = new
            {
                Players = playersDto,
                Enemies = enemiesDto, 
                Projectiles = _gameState.Projectiles.Values,
                Pickups = _gameState.Pickups.Values,
                DamageEvents = tickDamageEvents,
                AoeEvents = tickAoeEvents,
                Phase = _gameState.Phase.ToString(),
                CurrentWave = _gameState.CurrentWave,
                TimeRemaining = Math.Max(0, (int)_gameState.PhaseTimer),
            };

            await _hubContext.Clients.All.SendAsync("UpdateState", payload, cancellationToken: stoppingToken);

            // 4. CLEANUP (Must happen AFTER SendAsync)
            foreach (var p in _gameState.Players.Values)
            {
                p.FiredWeaponsThisTick.Clear();
            }
        }
    }
}