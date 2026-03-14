using Microsoft.AspNetCore.SignalR;
using Server.Configs;
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
                    HandleWaveEndTransition();
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

            // 3. Process World Updates
            ProcessPhysicsAndAI(dt);
            ProcessCombatAndShooting(dt);
            var tickDamageEvents = ProcessCollisions(dt);

            // 4. Broadcast to Clients
            await BroadcastStateAsync(tickDamageEvents, stoppingToken);

            // 5. Maintain Tick Rate
            var executionTime = DateTime.UtcNow - currentTickTime;
            var delay = _tickRateMs - (int)executionTime.TotalMilliseconds;
            if (delay > 0) await Task.Delay(delay, stoppingToken);
        }
    }

    // =================================================================================
    // CORE SYSTEMS
    // =================================================================================

    private void UpdateGamePhases(float dt)
    {
        if (_gameState.Phase == GamePhase.WaitingForPlayers && !_gameState.Players.IsEmpty)
        {
            _gameState.Phase = GamePhase.WaveActive;
            _gameState.PhaseTimer = 60f;
            _gameState.CurrentWave = 9; // Based on your current testing setup
        }

        if (_gameState.Phase != GamePhase.WaitingForPlayers)
        {
            _gameState.PhaseTimer -= dt;
        }
    }

    private void ProcessPhysicsAndAI(float dt)
    {
        // 1. PLAYER PHYSICS
        foreach (var player in _gameState.Players.Values)
        {
            if (player.InputX != 0 || player.InputY != 0)
            {
                // >>> FIX: Just one clean line for speed! <<<
                float finalSpeed = player.GetTotalStat("speed", _configManager);

                player.X += player.InputX * finalSpeed * dt;
                player.Y += player.InputY * finalSpeed * dt;
            }

            // HP Regeneration
            float regen = player.GetTotalStat("hpRegen", _configManager);
            if (regen > 0 && player.CurrentHp < player.GetTotalStat("maxHp", _configManager))
            {
                player.CurrentHp = Math.Min(player.GetTotalStat("maxHp", _configManager), player.CurrentHp + (regen * dt));
            }
        }

        // 2. ENEMY AI & PHYSICS
        foreach (var enemy in _gameState.Enemies.Values)
        {
            if (!_configManager.Enemies.TryGetValue(enemy.ConfigId, out var config)) continue;

            if (enemy.AttackCooldown > 0)
            {
                enemy.AttackCooldown -= dt;
                enemy.ActionState = "Attacking";
                continue;
            }

            PlayerEntity? target = null;
            float closestDistSq = float.MaxValue;
            foreach (var player in _gameState.Players.Values)
            {
                float distSq = (player.X - enemy.X) * (player.X - enemy.X) + (player.Y - enemy.Y) * (player.Y - enemy.Y);
                if (distSq < closestDistSq)
                {
                    closestDistSq = distSq;
                    target = player;
                }
            }

            if (target != null)
            {
                if (closestDistSq < 2500) // Attack range
                {
                    enemy.ActionState = "Attacking";
                    enemy.AttackCooldown = config.AttackDuration;
                }
                else
                {
                    enemy.ActionState = "Moving";
                    float dx = target.X - enemy.X;
                    float dy = target.Y - enemy.Y;
                    float length = (float)Math.Sqrt((dx * dx) + (dy * dy));

                    // >>> THE NEW ENEMY SPEED CALCULATION <<<
                    float finalSpeed = enemy.GetTotalStat("speed", _configManager);

                    enemy.X += (dx / length) * finalSpeed * dt;
                    enemy.Y += (dy / length) * finalSpeed * dt;
                }
            }
        }
    }

    private void ProcessCombatAndShooting(float dt)
    {
        foreach (var player in _gameState.Players.Values)
        {
            foreach (var weapon in player.Weapons)
            {
                weapon.CurrentCooldown -= dt;

                if (weapon.CurrentCooldown <= 0 && (player.AimX != 0 || player.AimY != 0))
                {
                    var config = _configManager.Weapons[weapon.ConfigId];
                    weapon.CurrentCooldown = config.CooldownSeconds;

                    float spawnX = player.X;
                    float spawnY = player.Y;
                    float offset = 24f;

                    if (weapon.SlotIndex == 0) spawnX += offset;
                    else if (weapon.SlotIndex == 1) spawnX -= offset;
                    else if (weapon.SlotIndex == 2) spawnY -= offset;
                    else if (weapon.SlotIndex == 3) spawnY += offset;

                    float dirX = player.AimX - spawnX;
                    float dirY = player.AimY - spawnY;
                    float length = (float)Math.Sqrt(dirX * dirX + dirY * dirY);

                    if (length > 0)
                    {
                        float attackSpeedPct = player.GetTotalStat("attackSpeedPercent", _configManager);
                        weapon.CurrentCooldown = config.CooldownSeconds / Math.Max(0.1f, (1f + attackSpeedPct));
                        // 1. DAMAGE: Weapon Base Damage + Player Stat Scaling
                        float finalDamage = config.MeleeDamage + config.RangedDamage + config.ElementalDamage;

                        if (config.DamageScaling != null)
                        {
                            foreach (var scale in config.DamageScaling)
                            {
                                // Adds the Player's Global Stat (e.g. Melee Damage) * The Weapon's Scaling multiplier
                                finalDamage += player.GetTotalStat(scale.Key, _configManager) * scale.Value;
                            }
                        }

                        // Apply Global % Damage Multiplier
                        float damagePercent = player.GetTotalStat("damagePercent", _configManager);
                        finalDamage = (finalDamage * weapon.Level) * (1f + damagePercent);

                        // 2. LIFE STEAL: Weapon Local Mechanics + Player Global Life Steal
                        float localLifeSteal = config.Mechanics != null && config.Mechanics.ContainsKey("lifeSteal")
                                               ? config.Mechanics["lifeSteal"] : 0f;
                        float globalLifeSteal = player.GetTotalStat("lifeSteal", _configManager);
                        float totalLifeStealForThisAttack = localLifeSteal + globalLifeSteal;

                        // 3. RANGE: Weapon Base + Player Global Range
                        float finalRange = config.Range + player.GetTotalStat("range", _configManager);

                        var bullet = new ProjectileEntity
                        {
                            OwnerId = player.ConnectionId,
                            X = spawnX,
                            Y = spawnY,
                            VelX = (dirX / length) * config.ProjectileSpeed,
                            VelY = (dirY / length) * config.ProjectileSpeed,
                            Damage = finalDamage,
                            MaxRange = finalRange,
                            LifeStealChance = totalLifeStealForThisAttack // Assign it to the bullet!
                        };
                        _gameState.Projectiles.TryAdd(bullet.Id, bullet);
                    }
                }
            }
        }
    }

    private List<Server.DTOs.DamageEventDto> ProcessCollisions(float dt)
    {
        var tickDamageEvents = new List<Server.DTOs.DamageEventDto>();
        var projectilesToRemove = new List<string>();
        var enemiesToRemove = new List<string>();
        var pickupsToRemove = new List<string>();

        // 1. Projectiles vs Enemies
        foreach (var proj in _gameState.Projectiles.Values)
        {
            proj.X += proj.VelX * dt;
            proj.Y += proj.VelY * dt;
            proj.MaxRange -= (float)Math.Sqrt((proj.VelX * dt) * (proj.VelX * dt) + (proj.VelY * dt) * (proj.VelY * dt));

            if (proj.MaxRange <= 0)
            {
                projectilesToRemove.Add(proj.Id);
                continue;
            }

            foreach (var enemy in _gameState.Enemies.Values)
            {
                if (enemiesToRemove.Contains(enemy.Id)) continue;
                if (enemy.CurrentHp <= 0) continue;

                float distSq = (proj.X - enemy.X) * (proj.X - enemy.X) + (proj.Y - enemy.Y) * (proj.Y - enemy.Y);
                if (distSq < 400) // Collision detected!
                {
                    enemy.CurrentHp -= proj.Damage;
                    projectilesToRemove.Add(proj.Id);

                    tickDamageEvents.Add(new Server.DTOs.DamageEventDto { X = enemy.X, Y = enemy.Y, Amount = proj.Damage });

                    // >>> NEW: LOCAL WEAPON LIFE STEAL LOGIC <<<
                    if (Random.Shared.NextDouble() < proj.LifeStealChance)
                    {
                        if (_gameState.Players.TryGetValue(proj.OwnerId, out var player))
                        {
                            float maxHp = player.GetTotalStat("maxHp", _configManager);
                            player.CurrentHp = Math.Min(maxHp, player.CurrentHp + 1f);
                        }
                    }

                    if (enemy.CurrentHp <= 0)
                    {
                        enemiesToRemove.Add(enemy.Id);
                        var gold = new PickupEntity { X = enemy.X, Y = enemy.Y, Value = 1 };
                        _gameState.Pickups.TryAdd(gold.Id, gold);
                    }

                    break; // Stop checking other enemies for this specific bullet
                }
            }
        }

        // 2. Players vs Pickups (Gold)
        foreach (var player in _gameState.Players.Values)
        {
            foreach (var pickup in _gameState.Pickups.Values)
            {
                if (pickupsToRemove.Contains(pickup.Id)) continue;

                float distSq = (player.X - pickup.X) * (player.X - pickup.X) + (player.Y - pickup.Y) * (player.Y - pickup.Y);
                if (distSq < 625)
                {
                    player.Gold += pickup.Value;

                    // >>> NEW: Grant XP whenever you pick up a drop! <<<
                    player.GainXp(pickup.Value, _configManager);

                    pickupsToRemove.Add(pickup.Id);
                }
            }
        }

        // 3. Cleanup
        foreach (var id in projectilesToRemove) _gameState.Projectiles.TryRemove(id, out _);
        foreach (var id in enemiesToRemove) _gameState.Enemies.TryRemove(id, out _);
        foreach (var id in pickupsToRemove) _gameState.Pickups.TryRemove(id, out _);

        return tickDamageEvents;
    }

    // =================================================================================
    // WAVE & SHOP MANAGEMENT
    // =================================================================================

    // Add 'async Task' here
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

        // 2. >>> NEW: THE CO-OP LOOT SWEEP <<<
        // Sum up the value of every gold piece left on the floor
        int totalLootValue = _gameState.Pickups.Values.Sum(p => p.Value);
        _gameState.Pickups.Clear(); // Sweep the floor clean!

        if (totalLootValue > 0 && !_gameState.Players.IsEmpty)
        {
            // Divide the loot evenly among all connected players
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
                        // >>> FIX: Uses the unified Amount property! <<<
                        player.Stats.AddModifier(effect.StatName, effect.Amount * stackCount, 0);
                    }
                }
            }

            // EVENT PAYLOAD: Only send this massive data block when the shop opens!
            var uiData = new
            {
                player.Gold,
                player.CurrentShop,
                player.Weapons,
                OwnedItems = player.OwnedItems.Select(kvp => new { ConfigId = kvp.Key, Count = kvp.Value }).ToArray(),
                CurrentRerollCost = player.CurrentRerollCost,
                CurrentWave = _gameState.CurrentWave,

                // >>> THE PURE DATA-DRIVEN MAGIC <<<
                // This dynamically checks every stat the player has mathematically touched, 
                // calculates the modifiers, and builds a dictionary automatically!
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

            // Boss Spawn Logic (Every 10 waves)
            if (_gameState.CurrentWave % 10 == 0)
            {
                bool bossAlreadySpawend = _gameState.Enemies.Values.Any(e => _configManager.Enemies[e.ConfigId].IsBoss);

                if (!bossAlreadySpawend && _gameState.PhaseTimer > 50f)
                {
                    var bossConfigs = _configManager.Enemies.Values.Where(e => e.IsBoss && e.Tier <= maxAllowedTier).ToList();
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
                var availableEnemies = _configManager.Enemies.Values.Where(e => !e.IsBoss).ToList();

                int targetTier = maxAllowedTier;
                if (maxAllowedTier > 1 && Random.Shared.Next(0, 100) < 50)
                {
                    targetTier = Random.Shared.Next(1, maxAllowedTier);
                }

                var tierSpecificEnemies = availableEnemies.Where(e => e.Tier == targetTier).ToList();
                if (!tierSpecificEnemies.Any()) tierSpecificEnemies = availableEnemies.Where(e => e.Tier == 1).ToList();

                var enemyToSpawn = tierSpecificEnemies[Random.Shared.Next(tierSpecificEnemies.Count)];
                SpawnEnemy(enemyToSpawn);
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

        // >>> FIX: Use the dynamic dictionary instead of the old hardcoded property! <<<
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

    private async Task BroadcastStateAsync(List<Server.DTOs.DamageEventDto> tickDamageEvents, CancellationToken stoppingToken)
    {
        if (!_gameState.Players.IsEmpty)
        {
            // FAST PAYLOAD
            var playersDto = _gameState.Players.Values.Select(p => new
            {
                p.ConnectionId,
                p.X,
                p.Y,
                p.CurrentHp,
                MaxHp = p.GetTotalStat("maxHp", _configManager), // Automatically handles dynamic HP buffs
                p.Gold,
                Weapons = p.Weapons
            });

            var payload = new
            {
                Players = playersDto,
                Enemies = _gameState.Enemies.Values,
                Projectiles = _gameState.Projectiles.Values,
                Pickups = _gameState.Pickups.Values,
                DamageEvents = tickDamageEvents,
                Phase = _gameState.Phase.ToString(),
                CurrentWave = _gameState.CurrentWave,
                TimeRemaining = Math.Max(0, (int)_gameState.PhaseTimer)
            };
            await _hubContext.Clients.All.SendAsync("UpdateState", payload, cancellationToken: stoppingToken);
        }
    }
}