using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
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

public class GameRoom
{
    public string RoomId { get; }
    public string RoomName { get; set; } = "Arena";
    public string Password { get; set; } = string.Empty;
    public string HostConnectionId { get; set; } = string.Empty;
    public string CurrentMapId { get; set; } = "map_forest";
    public int ExpectedPlayerCount { get; set; } = 0;
    public int StitchedPlayerCount { get; set; } = 0;
    public GameState State { get; } = new();
    public EventBus EventBus { get; } = new();

    // Expose configured timeouts so RoomManager and MatchHub can read them
    // without needing their own copy of RoomSettings.
    public float PauseTimeoutSeconds { get; }
    public float GracePeriodSeconds { get; }

    private readonly ConfigManager _configManager;
    private readonly List<IGameSystem> _systems = new();
    private readonly NetworkSystem _networkSystem;
    private readonly IServiceProvider _serviceProvider;
    private readonly IHubContext<MatchHub> _matchHubContext;
    private readonly RoomManager _roomManager;

    private DateTime _lastSpawnTime = DateTime.UtcNow;
    private Configs.MapConfig? _currentMap;

    public GameRoom(string roomId, ConfigManager configManager, RoomSettings roomSettings, IServiceProvider serviceProvider)
    {
        RoomId = roomId;
        _serviceProvider = serviceProvider;
        _configManager = configManager;
        _matchHubContext = _serviceProvider.GetRequiredService<IHubContext<MatchHub>>();
        _networkSystem = new NetworkSystem(_matchHubContext);
        _roomManager = _serviceProvider.GetRequiredService<RoomManager>();

        // Apply config-driven defaults
        PauseTimeoutSeconds = roomSettings.PauseTimeoutMinutes * 60f;
        GracePeriodSeconds = roomSettings.GracePeriodSeconds;
        State.AllowSpectators = roomSettings.AllowSpectators;

        if (_configManager.Maps.TryGetValue("map_forest", out var initialMap))
            _currentMap = initialMap;

        _systems.Add(new StatSystem());
        _systems.Add(new HealthSystem());
        _systems.Add(new LootSystem());
        _systems.Add(new EffectSystem());
        _systems.Add(new MovementSystem());
        _systems.Add(new CombatSystem());
        _systems.Add(new SkillSystem());
        _systems.Add(_networkSystem);

        foreach (var system in _systems)
            system.Initialize(EventBus, _configManager);

        Console.WriteLine($"[ROOM] Initialized Sandbox for Room: {roomId}");
    }

    public async Task TickAsync(float dt, CancellationToken stoppingToken)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var currentTickTime = DateTime.UtcNow;
        var prevProjectiles = State.Projectiles.Keys.ToHashSet();

        bool isPaused = false;

        // ─── LIFECYCLE ────────────────────────────────────────────────────────
        if (State.Status == RoomStatus.Paused_AwaitingPlayers)
        {
            State.PauseTimer -= dt;

            // If 10 minutes pass and they didn't come back
            if (State.PauseTimer <= 0)
            {
                // 1. Find all players who are currently offline
                var missingPlayers = State.Players
                    .Where(p => _roomManager.GetRoomForPlayer(p.Value.ConnectionId) == null)
                    .ToList();

                // 2. Permanently remove them from the room
                foreach (var mp in missingPlayers)
                {
                    State.Players.TryRemove(mp.Key, out _);
                }

                // 3. Unpause the game for the players who stayed
                State.Status = RoomStatus.Active;
                EventBus.Publish(new ChatMessageEvent
                {
                    Sender = "System",
                    Message = "Pause timeout reached. Missing players were removed. Match resumed!"
                });
            }
        }
        else if (State.Status == RoomStatus.GracePeriod)
        {
            State.GracePeriodTimer -= dt;
            if (State.GracePeriodTimer <= 0)
            {
                // If we're still in GracePeriod when the timer hits zero, it means
                // not all players returned in time. Delete the room.
                // (If ALL players reconnected, JoinLiveMatch already promoted
                //  the room to Active, so we'd never reach this branch.)
                State.Status = RoomStatus.ScheduledForDeletion;
                Console.WriteLine($"[ROOM] Room {RoomId}: grace period expired. Room deleted.");
            }
            isPaused = true;
        }

        // ─── PHYSICS (only when not paused) ───────────────────────────────────
        if (!isPaused)
        {
            UpdateGamePhases(dt);

            if (State.Phase == GamePhase.WaveActive)
            {
                if (State.PhaseTimer <= 0) await HandleWaveEndTransition();
                else HandleEnemySpawning(currentTickTime);
            }
            else if (State.Phase == GamePhase.ShopPhase && State.PhaseTimer <= 0)
            {
                StartNextWave();
            }

            foreach (var system in _systems)
            {
                var sysTimer = System.Diagnostics.Stopwatch.StartNew();
                system.Update(dt, State);
                EventBus.ProcessQueue();
                sysTimer.Stop();

                if (sysTimer.ElapsedMilliseconds > 15)
                    Console.WriteLine($"[LAG SPIKE] {system.GetType().Name} took {sysTimer.ElapsedMilliseconds}ms!");
            }
        }
        else
        {
            // Process chat/events even when paused
            EventBus.ProcessQueue();
        }

        // ─── NETWORK (always broadcast so players see frozen state) ───────────
        var currProjectiles = State.Projectiles.Keys.ToHashSet();
        var newProjIds = currProjectiles.Except(prevProjectiles).ToList();
        var destroyedProjIds = prevProjectiles.Except(currProjectiles).ToList();
        var tickNewProjectiles = newProjIds.Select(id => State.Projectiles[id]).ToList();

        var netTimer = System.Diagnostics.Stopwatch.StartNew();
        await _networkSystem.BroadcastFrameAsync(State, _configManager, tickNewProjectiles, destroyedProjIds, stoppingToken);
        netTimer.Stop();

        if (netTimer.ElapsedMilliseconds > 20)
            Console.WriteLine($"[LAG SPIKE] NetworkSystem took {netTimer.ElapsedMilliseconds}ms!");

        sw.Stop();
        if (sw.ElapsedMilliseconds > 50)
            Console.WriteLine($"[CRITICAL] Total frame took {sw.ElapsedMilliseconds}ms! (Target: <50ms)");
    }

    private void UpdateGamePhases(float dt)
    {
        if (State.Phase != GamePhase.WaitingForPlayers) State.PhaseTimer -= dt;
    }

    public void StartMatch()
    {
        if (State.Phase == GamePhase.WaitingForPlayers)
        {
            State.Phase = GamePhase.WaveActive;
            float waveBonus = State.Players.Values.Sum(p => p.GetEngineMechanic("bonusWaveSeconds", _configManager));
            State.PhaseTimer = Math.Max(60f, 5f + waveBonus);
            State.CurrentWave = 1;
        }
    }

    private void StartNextWave()
    {
        State.Phase = GamePhase.WaveActive;
        float waveBonus = State.Players.Values.Sum(p => p.GetEngineMechanic("bonusWaveSeconds", _configManager));
        State.PhaseTimer = Math.Max(60f, 5f + waveBonus);
        State.CurrentWave++;

        var leftoverLoot = State.Pickups.Values
            .Where(p => p.Type == PickupType.Weapon || p.Type == PickupType.Item)
            .Select(p => p.Id).ToList();
        foreach (var id in leftoverLoot) State.Pickups.TryRemove(id, out _);
    }

    private async Task HandleWaveEndTransition()
    {
        State.Phase = GamePhase.ShopPhase;
        State.PhaseTimer = 30f;

        foreach (var enemy in State.Enemies.Values)
        {
            var gold = new PickupEntity { X = enemy.X, Y = enemy.Y, Value = 1 };
            State.Pickups.TryAdd(gold.Id, gold);
        }

        State.Enemies.Clear();
        State.Projectiles.Clear();

        EventBus.Publish(new ResetPlayerSkillsEvent { State = State });

        int totalGold = State.Pickups.Values.Where(p => p.Type == PickupType.Gold).Sum(p => p.Value);
        foreach (var id in State.Pickups.Values.Where(p => p.Type == PickupType.Gold).Select(p => p.Id).ToList())
            State.Pickups.TryRemove(id, out _);

        if (totalGold > 0 && !State.Players.IsEmpty)
        {
            int perPlayer = (int)Math.Max(1, Math.Floor((double)totalGold / State.Players.Count));
            foreach (var player in State.Players.Values)
            {
                player.Gold += perPlayer;
                player.GainXp(perPlayer, _configManager);
            }
        }

        if (!_configManager.Difficulties.TryGetValue(State.CurrentDifficulty, out var currentDiff))
            currentDiff = new DifficultyConfig();

        int rerollCost = currentDiff.BaseRerollCost + (int)((State.CurrentWave - 1) * currentDiff.RerollCostIncreasePerWave);

        foreach (var player in State.Players.Values)
        {
            player.CurrentRerollCost = rerollCost;
            MatchHub.GenerateShopForPlayer(player, _configManager, State.CurrentWave);

            foreach (var item in player.OwnedItems)
            {
                if (_configManager.Items.TryGetValue(item.ConfigId, out var itemConfig))
                {
                    foreach (var effect in itemConfig.EffectsAtWaveEnd)
                        player.Stats.AddModifier(effect.StatName, effect.Amount * item.Level, 0);
                    player.StatsNeedRecalculation = true;
                }
            }

            if (player.PendingLevelUps > 0 && player.CurrentLevelUpChoices.Count == 0)
            {
                float luck = player.GetTotalStat("luck", _configManager);
                player.CurrentLevelUpChoices = new List<Configs.LevelUpCardConfig>();
                int maxTier = _configManager.LevelUpCards.Values.Any() ? _configManager.LevelUpCards.Values.Max(c => c.Tier) : 1;

                for (int i = 0; i < 3; i++)
                {
                    int tier = MatchHub.RollRarityTier(luck, maxTier);
                    var cards = _configManager.LevelUpCards.Values.Where(c => c.Tier == tier).ToList();
                    if (!cards.Any()) cards = _configManager.LevelUpCards.Values.Where(c => c.Tier <= tier).ToList();
                    if (cards.Any()) player.CurrentLevelUpChoices.Add(cards[Random.Shared.Next(cards.Count)]);
                }
            }

            await _matchHubContext.Clients.Client(player.ConnectionId).SendAsync("UpdatePlayerUI", new
            {
                player.Gold,
                player.CurrentShop,
                player.Weapons,
                OwnedItems = player.OwnedItems.Select(i => new { i.ConfigId, i.SlotIndex, i.Level, i.RolledStats, ItemSkills = i.ItemSkills.Select(s => s.ConfigId).ToList(), i.TotalBaseStats }).ToArray(),
                player.CurrentRerollCost,
                State.CurrentWave,
                player.Level,
                player.CurrentXp,
                XpRequired = player.GetXpRequirement(),
                player.PendingLevelUps,
                LevelUpChoices = player.CurrentLevelUpChoices,
                Stats = player.Stats.Stats.Keys.ToDictionary(k => k, k => player.GetTotalStat(k, _configManager))
            });
        }

        if (State.SkipShopPhase) StartNextWave();
    }

    private void HandleEnemySpawning(DateTime currentTickTime)
    {
        if (!_configManager.Difficulties.TryGetValue(State.CurrentDifficulty, out var currentDiff))
            currentDiff = new DifficultyConfig();

        float waveReduction = (State.CurrentWave - 1) * currentDiff.DelayDecreasePerWave;
        float baseDelay = Math.Max(currentDiff.MinimumSpawnDelay, currentDiff.InitialSpawnDelay - waveReduction);
        float spawnBonus = State.Players.Values.Sum(p => p.GetEngineMechanic("enemySpawnRateMult", _configManager));
        float denom = Math.Max(0.1f, (1f + spawnBonus) * Math.Max(1, State.Players.Count));
        float finalRate = Math.Max(0.05f, baseDelay / denom);

        if ((currentTickTime - _lastSpawnTime).TotalSeconds <= finalRate || State.Players.IsEmpty) return;
        if (State.Enemies.Count >= currentDiff.MaxActiveEnemies) return;

        _lastSpawnTime = currentTickTime;
        bool skipRegular = false;

        if (!State.Enemies.Values.Any(e => _configManager.Enemies[e.ConfigId].IsBoss) && State.PhaseTimer > 50f)
        {
            var bosses = _configManager.Enemies.Values
                .Where(e => e.IsBoss && !e.IsSummonOnly && e.SpawnOnWaves != null && e.SpawnOnWaves.Contains(State.CurrentWave))
                .ToList();
            if (bosses.Any()) { SpawnEnemy(bosses[Random.Shared.Next(bosses.Count)]); skipRegular = true; }
        }

        if (!skipRegular)
        {
            var valid = _configManager.Enemies.Values
                .Where(e => !e.IsBoss && !e.IsSummonOnly && e.MinWave <= State.CurrentWave && e.MaxWave >= State.CurrentWave)
                .Where(e => e.AllowedDifficulties == null || e.AllowedDifficulties.Count == 0 || e.AllowedDifficulties.Contains(State.CurrentDifficulty))
                .ToList();

            if (valid.Any())
            {
                int totalWeight = valid.Sum(e => e.SpawnWeight);
                int roll = Random.Shared.Next(0, totalWeight);
                int cumulative = 0;
                var selected = valid.First();
                foreach (var e in valid)
                {
                    cumulative += e.SpawnWeight;
                    if (roll < cumulative) { selected = e; break; }
                }
                SpawnEnemy(selected);
            }
        }
    }

    private void SpawnEnemy(Configs.EnemyConfig config)
    {
        var enemy = new EnemyEntity();
        float w = _currentMap?.Width ?? 4000f, h = _currentMap?.Height ?? 4000f;

        int edge = Random.Shared.Next(4);
        float x, y;
        if (edge == 0) { x = Random.Shared.Next(-200, (int)w + 200); y = Random.Shared.Next(-200, -50); }
        else if (edge == 1) { x = Random.Shared.Next(-200, (int)w + 200); y = Random.Shared.Next((int)h + 50, (int)h + 200); }
        else if (edge == 2) { x = Random.Shared.Next(-200, -50); y = Random.Shared.Next(-200, (int)h + 200); }
        else { x = Random.Shared.Next((int)w + 50, (int)w + 200); y = Random.Shared.Next(-200, (int)h + 200); }

        enemy.Initialize(config, x, y, _configManager);

        if (!_configManager.Difficulties.TryGetValue(State.CurrentDifficulty, out var diff)) diff = new DifficultyConfig();
        float mult = ((State.CurrentWave - 1) * diff.EnemyBaseScaling)
                   + ((config.Tier - 1) * 0.5f)
                   + ((Math.Max(1, State.Players.Count) - 1) * (diff.EnemyScalingPerPlayer - 1f));

        enemy.Stats.AddModifier("maxHp", 0, mult);
        enemy.Stats.AddModifier("damagePercent", 0, mult);
        State.Enemies.TryAdd(enemy.Id, enemy);
    }
}