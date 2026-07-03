using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using Server.Configs;
using Server.Core.Systems;
using Server.Data;
using Server.Entities;
using Server.Hubs;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

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
    private int _lastAnnouncedPauseMinute = -1;
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
        _systems.Add(new SkillSystem());
        _systems.Add(new MovementSystem());
        _systems.Add(new CombatSystem());


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
            isPaused = true; // This securely locks the physics engine
            State.PauseTimer -= dt;

            // Broadcast to the console & EventBus every 1 minute
            int minutesLeft = (int)Math.Ceiling(State.PauseTimer / 60f);
            if (minutesLeft != _lastAnnouncedPauseMinute && minutesLeft > 0)
            {
                _lastAnnouncedPauseMinute = minutesLeft;
                EventBus.Publish(new ChatMessageEvent
                {
                    Sender = "System",
                    Message = $"Match paused. {minutesLeft} minute(s) remaining for missing players to return."
                });
                Console.WriteLine($"[ROOM] Room {RoomId} is empty/paused. {minutesLeft}m remaining.");
            }

            // When the 3 minutes finish...
            if (State.PauseTimer <= 0)
            {
                int onlineCount = State.Players.Values.Count(p => _roomManager.GetRoomForPlayer(p.ConnectionId) != null);

                if (onlineCount == 0)
                {
                    // NOBODY returned. Delete the match.
                    State.Status = RoomStatus.ScheduledForDeletion;
                    Console.WriteLine($"[ROOM] Room {RoomId}: pause timer expired. Room deleted.");
                    _ = SaveMatchResultsToDatabaseAsync();
                }
                else
                {
                    // SOMEONE returned! Kick the players who didn't make it back and unpause.
                    var missingPlayers = State.Players
                        .Where(p => _roomManager.GetRoomForPlayer(p.Value.ConnectionId) == null)
                        .ToList();

                    foreach (var mp in missingPlayers)
                    {
                        State.Players.TryRemove(mp.Key, out _);
                    }

                    State.Status = RoomStatus.Active;
                    isPaused = false; // Release the physics lock

                    EventBus.Publish(new ChatMessageEvent
                    {
                        Sender = "System",
                        Message = "Pause timeout reached. Missing players were removed. Match resumed!"
                    });
                }
            }
        }
        else
        {
            // Reset the minute tracker when the game is actively playing
            _lastAnnouncedPauseMinute = -1;
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
    private async Task SaveMatchResultsToDatabaseAsync()
    {
        try
        {
            using var scope = _serviceProvider.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var achievementService = scope.ServiceProvider.GetRequiredService<Server.Core.Services.AchievementService>();

            // Track which MatchRecord belongs to which player so we can evaluate
            // achievements against it right after it's saved.
            var savedRecordsByPlayerId = new Dictionary<Guid, MatchRecord>();

            foreach (var player in State.Players.Values)
            {
                if (!Guid.TryParse(player.PlayerId, out Guid parsedPlayerId)) continue;

                // 1. Look for an existing record for THIS player in THIS exact match
                var existingRecord = await db.MatchRecords
                    .FirstOrDefaultAsync(m => m.RoomId == RoomId && m.PlayerId == parsedPlayerId);

                // Snapshot "before" values for delta computation — needed to update the
                // permanent lifetime aggregate without double-counting on repeated wave-end
                // saves of this same growing match. 0 for a brand-new match (nothing before it).
                bool isNewMatch = existingRecord == null;
                int killsBefore = existingRecord?.Kills ?? 0;
                int deathsBefore = existingRecord?.Deaths ?? 0;
                float dmgDealtBefore = existingRecord?.TotalDamageDealt ?? 0f;
                float dmgTakenBefore = existingRecord?.TotalDamageTaken ?? 0f;
                float healBefore = existingRecord?.TotalHealingDone ?? 0f;
                float shieldBefore = existingRecord?.TotalShieldingDone ?? 0f;

                if (existingRecord != null)
                {
                    // 2. UPDATE existing record
                    existingRecord.HighestWave = State.CurrentWave;
                    existingRecord.TotalDamageDealt = player.TotalDamageDealt;
                    existingRecord.TotalDamageTaken = player.TotalDamageTaken;
                    existingRecord.TotalHealingDone = player.TotalHealingDone;
                    existingRecord.TotalShieldingDone = player.TotalShieldingDone;
                    existingRecord.Kills = player.Kills;
                    existingRecord.Deaths = player.Deaths;
                    existingRecord.PeakWeaponsEquipped = player.PeakWeaponsEquipped;
                    existingRecord.PeakStatsJson = JsonSerializer.Serialize(player.PeakStats);
                    // Note: We don't update MatchDate so it reflects when the match started
                    savedRecordsByPlayerId[parsedPlayerId] = existingRecord;
                }
                else
                {
                    // 3. INSERT new record (happens on Wave 1)
                    var newRecord = new MatchRecord
                    {
                        RoomId = RoomId,  // Link it to this room!
                        PlayerId = parsedPlayerId,
                        Username = player.Name,
                        ConfigId = player.ConfigId,
                        Difficulty = State.CurrentDifficulty,
                        HighestWave = State.CurrentWave,
                        TotalDamageDealt = player.TotalDamageDealt,
                        TotalDamageTaken = player.TotalDamageTaken,
                        TotalHealingDone = player.TotalHealingDone,
                        TotalShieldingDone = player.TotalShieldingDone,
                        Kills = player.Kills,
                        Deaths = player.Deaths,
                        PeakWeaponsEquipped = player.PeakWeaponsEquipped,
                        PeakStatsJson = JsonSerializer.Serialize(player.PeakStats),
                        MatchDate = DateTime.UtcNow
                    };
                    db.MatchRecords.Add(newRecord);
                    savedRecordsByPlayerId[parsedPlayerId] = newRecord;
                }

                // 4. Maintain the permanent lifetime aggregate (UserLifetimeStats) via delta,
                //    in the SAME transaction as the MatchRecord write. This is what makes it
                //    safe to prune old MatchRecord rows later without undoing achievement
                //    progress — see AchievementService's class-level doc comment.
                await achievementService.UpdateLifetimeStatsAsync(
                    db, parsedPlayerId,
                    killsDelta: player.Kills - killsBefore,
                    deathsDelta: player.Deaths - deathsBefore,
                    dmgDealtDelta: player.TotalDamageDealt - dmgDealtBefore,
                    dmgTakenDelta: player.TotalDamageTaken - dmgTakenBefore,
                    healDelta: player.TotalHealingDone - healBefore,
                    shieldDelta: player.TotalShieldingDone - shieldBefore,
                    isNewMatch: isNewMatch,
                    currentHighestWave: State.CurrentWave,
                    configId: player.ConfigId,
                    difficulty: State.CurrentDifficulty,
                    currentMatchKills: player.Kills,
                    currentMatchDmgDealt: player.TotalDamageDealt,
                    currentMatchDmgTaken: player.TotalDamageTaken,
                    currentMatchHealing: player.TotalHealingDone,
                    currentMatchShielding: player.TotalShieldingDone,
                    currentPeakStats: player.PeakStats
                );
            }

            // 4. Save all changes (both updates and inserts) at once
            await db.SaveChangesAsync();
            Console.WriteLine($"[DB] Match Records synced for Room {RoomId} at Wave {State.CurrentWave}.");

            // 5. Achievement evaluation — runs after the match state is safely persisted,
            //    so both "Lifetime" (aggregated across all matches) and "SingleMatch"
            //    (this match's own row) conditions see up-to-date numbers.
            foreach (var player in State.Players.Values)
            {
                if (!Guid.TryParse(player.PlayerId, out Guid parsedPlayerId)) continue;
                if (!savedRecordsByPlayerId.TryGetValue(parsedPlayerId, out var record)) continue;

                var newlyUnlocked = await achievementService.EvaluateAndUnlockAsync(db, parsedPlayerId, record);
                if (newlyUnlocked.Count > 0)
                {
                    player.UnlockedAchievementIds.UnionWith(newlyUnlocked);
                    await _matchHubContext.Clients.Client(player.ConnectionId)
                        .SendAsync("AchievementUnlocked", newlyUnlocked);
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[DB ERROR] Failed to sync Match Records: {ex.Message}");
        }
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
        _ = SaveMatchResultsToDatabaseAsync();
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
                MatchHub.GenerateLevelUpChoicesForPlayer(player, _configManager);
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

        // Compounding wave growth: EnemyBaseScaling is now read as a per-wave growth RATE (e.g.
        // 0.05 = 5% tougher than the PREVIOUS wave, not +5% flat every wave). Early waves stay
        // close to the old linear feel; late waves snowball, since each wave's bonus builds on
        // top of the last one instead of just adding a fixed step. Still fully controlled from
        // Configs/Difficulties.json — same field, same per-difficulty tuning, just a different
        // curve shape. Tune EnemyBaseScaling per difficulty to control how steep the late-game
        // spike is (e.g. easy=0.02, normal=0.05, hard=0.08).
        float waveMult = (float)(Math.Pow(1.0 + diff.EnemyBaseScaling, State.CurrentWave - 1) - 1.0);
        float mult = waveMult
                   + ((config.Tier - 1) * 0.5f)
                   + ((Math.Max(1, State.Players.Count) - 1) * (diff.EnemyScalingPerPlayer - 1f));

        enemy.Stats.AddModifier("maxHp", 0, mult);
        enemy.Stats.AddModifier("damagePercent", 0, mult);
        State.Enemies.TryAdd(enemy.Id, enemy);
    }
}