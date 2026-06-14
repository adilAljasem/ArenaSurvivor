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
    private readonly int _tickRateMs = 50;
    private DateTime _lastSpawnTime = DateTime.UtcNow;
    private Configs.MapConfig? _currentMap;

    private readonly EventBus _eventBus = new();
    private readonly List<IGameSystem> _systems = new();
    private readonly HealthSystem _healthSystem = new();
    private readonly SkillSystem _skillSystem = new();
    private readonly NetworkSystem _networkSystem;

    public GameLoop(IHubContext<GameHub> hubContext, GameState gameState, ConfigManager configManager)
    {
        _hubContext = hubContext;
        _gameState = gameState;
        _configManager = configManager;
        _configManager.LoadConfigs();
        _networkSystem = new NetworkSystem(_hubContext);

        if (_configManager.Maps.TryGetValue("map_forest", out var initialMap))
            _currentMap = initialMap;

        // Initialize EDA Systems
        _systems.Add(new StatSystem());
        _systems.Add(_healthSystem);
        _systems.Add(new LootSystem());
        _systems.Add(new EffectSystem());
        _systems.Add(new MovementSystem());
        _systems.Add(new CombatSystem());
        _systems.Add(_skillSystem);
        _systems.Add(_networkSystem);

        foreach (var system in _systems) system.Initialize(_eventBus, _configManager);

        _configManager.OnConfigsReloaded += async () =>
        {
            if (_configManager.Maps.TryGetValue("map_forest", out var reloadedMap)) _currentMap = reloadedMap;
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

            UpdateGamePhases(dt);

            if (_gameState.Phase == GamePhase.WaveActive)
            {
                if (_gameState.PhaseTimer <= 0) await HandleWaveEndTransition();
                else HandleEnemySpawning(currentTickTime);
            }
            else if (_gameState.Phase == GamePhase.ShopPhase && _gameState.PhaseTimer <= 0) StartNextWave();

            foreach (var system in _systems)
            {
                system.Update(dt, _gameState);
            }

            _eventBus.ProcessQueue();

            var currProjectiles = _gameState.Projectiles.Keys.ToHashSet();
            var newProjIds = currProjectiles.Except(prevProjectiles).ToList();
            var destroyedProjIds = prevProjectiles.Except(currProjectiles).ToList();
            var tickNewProjectiles = newProjIds.Select(id => _gameState.Projectiles[id]).ToList();

            await _networkSystem.BroadcastFrameAsync(_gameState, _configManager, tickNewProjectiles, destroyedProjIds, stoppingToken);

            var executionTime = DateTime.UtcNow - currentTickTime;
            var delay = _tickRateMs - (int)executionTime.TotalMilliseconds;
            if (delay > 0) await Task.Delay(delay, stoppingToken);
        }
    }

    private void UpdateGamePhases(float dt)
    {
        if (_gameState.Phase == GamePhase.WaitingForPlayers && !_gameState.Players.IsEmpty)
        {
            _gameState.Phase = GamePhase.WaveActive;
            float waveBonus = _gameState.Players.Values.Sum(p => p.GetEngineMechanic("bonusWaveSeconds", _configManager));
            _gameState.PhaseTimer = Math.Max(60f, 5f + waveBonus);
            _gameState.CurrentWave = 1;
        }

        if (_gameState.Phase != GamePhase.WaitingForPlayers) _gameState.PhaseTimer -= dt;
    }

    private async Task HandleWaveEndTransition()
    {
        _gameState.Phase = GamePhase.ShopPhase;
        _gameState.PhaseTimer = 30f;

        foreach (var enemy in _gameState.Enemies.Values)
        {
            var gold = new PickupEntity { X = enemy.X, Y = enemy.Y, Value = 1 };
            _gameState.Pickups.TryAdd(gold.Id, gold);
        }

        _gameState.Enemies.Clear();
        _gameState.Projectiles.Clear();

        _eventBus.Publish(new ResetPlayerSkillsEvent { State = _gameState });

        int totalLootValue = _gameState.Pickups.Values.Where(p => p.Type == PickupType.Gold).Sum(p => p.Value);

        var goldPickupIds = _gameState.Pickups.Values.Where(p => p.Type == PickupType.Gold).Select(p => p.Id).ToList();
        foreach (var id in goldPickupIds) _gameState.Pickups.TryRemove(id, out _);

        if (totalLootValue > 0 && !_gameState.Players.IsEmpty)
        {
            int lootPerPlayer = (int)Math.Max(1, Math.Floor((double)totalLootValue / _gameState.Players.Count));
            foreach (var player in _gameState.Players.Values)
            {
                player.Gold += lootPerPlayer;
                player.GainXp(lootPerPlayer, _configManager);
            }
        }

        if (!_configManager.Difficulties.TryGetValue(_gameState.CurrentDifficulty, out var currentDiff)) currentDiff = new DifficultyConfig();

        int calculatedRerollCost = currentDiff.BaseRerollCost + (int)((_gameState.CurrentWave - 1) * currentDiff.RerollCostIncreasePerWave);

        foreach (var player in _gameState.Players.Values)
        {
            player.CurrentRerollCost = calculatedRerollCost;
            GenerateShopForPlayer(player, _configManager, _gameState.CurrentWave);

            foreach (var item in player.OwnedItems)
            {
                if (_configManager.Items.TryGetValue(item.ConfigId, out var itemConfig))
                {
                    foreach (var effect in itemConfig.EffectsAtWaveEnd)
                    {
                        player.Stats.AddModifier(effect.StatName, effect.Amount * item.Level, 0);
                    }
                    player.StatsNeedRecalculation = true;
                }
            }

            if (player.PendingLevelUps > 0 && player.CurrentLevelUpChoices.Count == 0)
            {
                float playerLuck = player.GetTotalStat("luck", _configManager);
                player.CurrentLevelUpChoices = new List<Configs.LevelUpCardConfig>();
                int maxCardTier = _configManager.LevelUpCards.Values.Any() ? _configManager.LevelUpCards.Values.Max(c => c.Tier) : 1;

                for (int i = 0; i < 3; i++)
                {
                    int targetTier = RollRarityTier(playerLuck, maxCardTier);
                    var validCards = _configManager.LevelUpCards.Values.Where(c => c.Tier == targetTier).ToList();
                    if (validCards.Count == 0) validCards = _configManager.LevelUpCards.Values.Where(c => c.Tier <= targetTier).ToList();
                    if (validCards.Count > 0) player.CurrentLevelUpChoices.Add(validCards[Random.Shared.Next(validCards.Count)]);
                }
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
        if (_gameState.SkipShopPhase) StartNextWave();
    }

    private void StartNextWave()
    {
        _gameState.Phase = GamePhase.WaveActive;
        float waveBonus = _gameState.Players.Values.Sum(p => p.GetEngineMechanic("bonusWaveSeconds", _configManager));
        _gameState.PhaseTimer = Math.Max(60f, 5f + waveBonus);
        _gameState.CurrentWave++;

        var leftoverLootIds = _gameState.Pickups.Values.Where(p => p.Type == PickupType.Weapon || p.Type == PickupType.Item).Select(p => p.Id).ToList();
        foreach (var id in leftoverLootIds) _gameState.Pickups.TryRemove(id, out _);
    }

    private void HandleEnemySpawning(DateTime currentTickTime)
    {
        if (!_configManager.Difficulties.TryGetValue(_gameState.CurrentDifficulty, out var currentDiff))
            currentDiff = new DifficultyConfig();

        float waveReduction = (_gameState.CurrentWave - 1) * currentDiff.DelayDecreasePerWave;
        float baseDelay = Math.Max(currentDiff.MinimumSpawnDelay, currentDiff.InitialSpawnDelay - waveReduction);
        float totalSpawnBonus = _gameState.Players.Values.Sum(p => p.GetEngineMechanic("enemySpawnRateMult", _configManager));
        float denominator = Math.Max(0.1f, (1f + totalSpawnBonus) * Math.Max(1, _gameState.Players.Count));
        float finalSpawnRate = Math.Max(0.05f, baseDelay / denominator);

        if ((currentTickTime - _lastSpawnTime).TotalSeconds > finalSpawnRate && !_gameState.Players.IsEmpty)
        {
            if (_gameState.Enemies.Count >= currentDiff.MaxActiveEnemies) return;

            _lastSpawnTime = currentTickTime;
            bool skipRegularSpawn = false;
            bool bossAlreadySpawend = _gameState.Enemies.Values.Any(e => _configManager.Enemies[e.ConfigId].IsBoss);

            if (!bossAlreadySpawend && _gameState.PhaseTimer > 50f)
            {
                var validBosses = _configManager.Enemies.Values.Where(e => e.IsBoss && !e.IsSummonOnly && e.SpawnOnWaves != null && e.SpawnOnWaves.Contains(_gameState.CurrentWave)).ToList();
                if (validBosses.Any())
                {
                    var bossConfig = validBosses[Random.Shared.Next(validBosses.Count)];
                    SpawnEnemy(bossConfig);
                    skipRegularSpawn = true;
                }
            }

            if (!skipRegularSpawn)
            {
                var validEnemies = _configManager.Enemies.Values
                    .Where(e => !e.IsBoss && !e.IsSummonOnly && e.MinWave <= _gameState.CurrentWave && e.MaxWave >= _gameState.CurrentWave)
                    .Where(e => e.AllowedDifficulties == null || e.AllowedDifficulties.Count == 0 || e.AllowedDifficulties.Contains(_gameState.CurrentDifficulty))
                    .ToList();

                if (validEnemies.Any())
                {
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
        float spawnX = 0, spawnY = 0;
        float w = _currentMap?.Width ?? 4000f, h = _currentMap?.Height ?? 4000f;

        int edge = Random.Shared.Next(4);
        if (edge == 0) { spawnX = Random.Shared.Next(-200, (int)w + 200); spawnY = Random.Shared.Next(-200, -50); }
        else if (edge == 1) { spawnX = Random.Shared.Next(-200, (int)w + 200); spawnY = Random.Shared.Next((int)h + 50, (int)h + 200); }
        else if (edge == 2) { spawnX = Random.Shared.Next(-200, -50); spawnY = Random.Shared.Next(-200, (int)h + 200); }
        else { spawnX = Random.Shared.Next((int)w + 50, (int)w + 200); spawnY = Random.Shared.Next(-200, (int)h + 200); }

        newEnemy.Initialize(config, spawnX, spawnY, _configManager);

        if (!_configManager.Difficulties.TryGetValue(_gameState.CurrentDifficulty, out var currentDiff)) currentDiff = new DifficultyConfig();
        float waveBonus = (_gameState.CurrentWave - 1) * currentDiff.EnemyBaseScaling;
        float tierBonus = (config.Tier - 1) * 0.5f;
        int playerCount = Math.Max(1, _gameState.Players.Count);
        float playerStatBonus = (playerCount - 1) * (currentDiff.EnemyScalingPerPlayer - 1f);
        float finalMultiplier = waveBonus + tierBonus + playerStatBonus;

        newEnemy.Stats.AddModifier("maxHp", 0, finalMultiplier);
        newEnemy.Stats.AddModifier("damagePercent", 0, finalMultiplier);

        _gameState.Enemies.TryAdd(newEnemy.Id, newEnemy);
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
                player.CurrentShop.Add(new Server.DTOs.ShopItemDto
                {
                    ConfigId = w.Id,
                    Name = w.Name,
                    Price = w.Price,
                    TotalBaseStats = previewWeapon.TotalBaseStats,
                    RolledStats = previewWeapon.RolledStats,
                    WeaponSkills = previewWeapon.WeaponSkills.Select(s => s.ConfigId).ToList()
                });
            }
            else if (tierItems.Any())
            {
                var item = tierItems[Random.Shared.Next(tierItems.Count)];
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