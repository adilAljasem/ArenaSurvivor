using Microsoft.AspNetCore.SignalR;
using Server.Configs;
using Server.DTOs;
using Server.Entities;
using Server.Hubs;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Server.Core.Systems;

public class NetworkSystem : IGameSystem
{
    private EventBus _eventBus = null!;
    private readonly IHubContext<MatchHub> _hubContext;
    private ConcurrentBag<DamageEventDto> _damageEvents = new();
    private ConcurrentBag<AoeEventDto> _aoeEvents = new();
    private ConcurrentBag<BeamVisualEvent> _beamEvents = new();
    private ConcurrentBag<BeamEndedEvent> _beamEndedEvents = new();
    // FIX B: Cache a single empty dictionary to stop 30,000 allocations per second
    private static readonly Dictionary<string, float> _emptyStats = new();
    private readonly ConcurrentDictionary<string, HashSet<string>> _clientKnownEnemies = new();
    private readonly ConcurrentDictionary<string, HashSet<string>> _clientKnownPickups = new();
    private readonly ConcurrentDictionary<string, HashSet<string>> _clientKnownProjectiles = new();

    public NetworkSystem(IHubContext<MatchHub> hubContext)
    {
        _hubContext = hubContext;
    }

    public void Initialize(EventBus eventBus, ConfigManager configs)
    {
        _eventBus = eventBus;

        _eventBus.Subscribe<DamageAppliedEvent>(ev =>
        {
            _damageEvents.Add(new DamageEventDto
            {
                X = ev.Target.X,
                Y = ev.Target.Y,
                Amount = ev.Amount,
                IsCritical = ev.IsCritical,
                IsDodge = ev.IsDodge,
                IsBlock = ev.IsBlock
            });
        });

        _eventBus.Subscribe<AoeVisualEvent>(ev => _aoeEvents.Add(ev.Dto));
        _eventBus.Subscribe<BeamVisualEvent>(ev => _beamEvents.Add(ev));
        _eventBus.Subscribe<BeamEndedEvent>(ev => _beamEndedEvents.Add(ev));
        _eventBus.Subscribe<ChatMessageEvent>(ev =>
        {
            // We use _clientKnownEnemies.Keys because it holds a thread-safe list of all active ConnectionIds in this specific room!
            if (!_clientKnownEnemies.IsEmpty)
            {
                _hubContext.Clients.Clients(_clientKnownEnemies.Keys).SendAsync("ReceiveChatMessage", ev.Sender, ev.Message);
            }
        });
    }

    public void Update(float dt, GameState state)
    {

    }

    public async Task BroadcastFrameAsync(GameState gameState, ConfigManager configManager, List<ProjectileEntity> tickNewProjectiles, List<string> tickDestroyedProjectiles, CancellationToken stoppingToken)
    {
        if (gameState.Players.IsEmpty) return;

        var globalFlatState = FlattenGlobalState(gameState, configManager, _damageEvents, _aoeEvents, _beamEvents);

        // Sent unculled (not run through CullForViewport) and identically to every player:
        // it's tiny, and a client tracking a persistent beam object must always learn it
        // ended, even if the beam's last known position was outside that player's viewport.
        var beamEndedPayload = _beamEndedEvents.Count > 0
            ? _beamEndedEvents.Select(b => new object[] { b.CasterId, b.SkillId }).ToList()
            : null;

        float mapW = 4000f, mapH = 4000f;
        if (configManager.Maps != null && configManager.Maps.TryGetValue("map_forest", out var currentMap))
        {
            mapW = currentMap.Width; mapH = currentMap.Height;
        }

        foreach (var player in gameState.Players.Values)
        {
            var visibleState = CullForViewport(player, mapW, mapH, globalFlatState);

            var enemyDeltas = ProcessEnemyDeltas(player.ConnectionId, visibleState.Enemies);
            var pickupDeltas = ProcessPickupDeltas(player.ConnectionId, visibleState.Pickups);
            var projectileDeltas = ProcessProjectileDeltas(player.ConnectionId, visibleState.Projectiles);

            var payload = new
            {
                p = visibleState.Players,
                e = enemyDeltas.Full.Count > 0 ? enemyDeltas.Full : null,
                me = enemyDeltas.Mini.Count > 0 ? enemyDeltas.Mini : null,
                de = enemyDeltas.Destroyed.Count > 0 ? enemyDeltas.Destroyed : null,

                nb = projectileDeltas.Full.Count > 0 ? projectileDeltas.Full : null,
                db = projectileDeltas.Destroyed.Count > 0 ? projectileDeltas.Destroyed : null,

                pk = pickupDeltas.Full.Count > 0 ? pickupDeltas.Full : null,
                dpk = pickupDeltas.Destroyed.Count > 0 ? pickupDeltas.Destroyed : null,

                dmg = visibleState.Damage.Count > 0 ? visibleState.Damage : null,
                aoe = visibleState.Aoe.Count > 0 ? visibleState.Aoe : null,
                bm = visibleState.Beams.Count > 0 ? visibleState.Beams : null,
                be = beamEndedPayload,

                ph = (byte)gameState.Phase,
                w = gameState.CurrentWave,
                tr = Math.Max(0, (int)gameState.PhaseTimer),

            };

            byte[] compressedBytes = CompressPayload(payload);
            _ = _hubContext.Clients.Client(player.ConnectionId).SendAsync("UpdateStateCompressed", compressedBytes, cancellationToken: stoppingToken);
        }

        PerformCleanup(gameState);

        _damageEvents = new ConcurrentBag<DamageEventDto>();
        _aoeEvents = new ConcurrentBag<AoeEventDto>();
        _beamEvents = new ConcurrentBag<BeamVisualEvent>();
        _beamEndedEvents = new ConcurrentBag<BeamEndedEvent>();
    }

    private static byte GetStateId(string state) => state switch
    {
        "Moving" => 1,
        "Attacking" => 2,
        "Casting" => 3,
        "Dead" => 4,
        _ => 0
    };

    private class FlatState
    {
        public List<object[]> Players { get; set; } = new();
        public List<object[]> Enemies { get; set; } = new();
        public List<object[]> Projectiles { get; set; } = new();
        public List<object[]> Pickups { get; set; } = new();
        public List<object[]> Damage { get; set; } = new();
        public List<object[]> Aoe { get; set; } = new();
        public List<object[]> Beams { get; set; } = new();
    }

    private static class EnemyIdx
    {
        public const int Id = 0; public const int ConfigId = 1; public const int X = 2; public const int Y = 3;
        public const int CurrentHp = 4; public const int MaxHp = 5; public const int AimX = 6; public const int AimY = 7;
        public const int StateId = 8; public const int CastingSkillId = 9; public const int CastTimer = 10;
        public const int MaxCastTimer = 11; public const int ActiveEffects = 12; public const int Weapons = 13;
        public const int FiredWeapons = 14; public const int Team = 15;
    }

    // FIX: Method signature updated to accept IEnumerable for thread-safe bags
    private static FlatState FlattenGlobalState(GameState gameState, ConfigManager configManager,
        IEnumerable<DamageEventDto> dmgEvents,
        IEnumerable<AoeEventDto> aoeEvents,
        IEnumerable<BeamVisualEvent> beamEvents)
    {
        return new FlatState
        {
            Players = gameState.Players.Values.Select(p => new object[] {
                p.ConnectionId, (int)p.X, (int)p.Y, (int)p.AimX, (int)p.AimY,
                (int)p.CurrentHp, (int)p.CurrentMaxHp, p.Gold, GetStateId(p.ActionState),
                p.CurrentCastingSkillId, Math.Round(p.CurrentCastTimer, 1), Math.Round(p.MaxCastTimer, 1),
                p.Weapons.Select(w => new object[] {
                    w.ConfigId, w.SlotIndex, w.Level,
                    w.RolledStats ?? _emptyStats,
                    w.WeaponSkills != null ? w.WeaponSkills.Select(s => s.ConfigId).ToList() : new List<string>(),
                    w.TotalBaseStats ?? _emptyStats
                }).ToList(),
                p.FiredWeaponsThisTick.ToList(),
                p.ActiveEffects.Select(e => e.ConfigId).ToList(),
                p.SynergizedSkills.Select(s => new object[] { s.ConfigId, Math.Round(Math.Max(0, s.CurrentCooldown), 1) }).ToList(),
                p.PendingStatDiff.Count > 0 ? (object)p.PendingStatDiff : null,
                (int)p.CurrentShield
            }).ToList(),

            Enemies = gameState.Enemies.Values.Select(e => new object[] {
                e.Id, e.ConfigId, (int)e.X, (int)e.Y, (int)e.CurrentHp, (int)e.CurrentMaxHp,
                (int)e.AimX, (int)e.AimY,
                GetStateId(e.ActionState), e.CurrentCastingSkillId, Math.Round(e.CurrentCastTimer, 1), Math.Round(e.MaxCastTimer, 1),
                e.ActiveEffects.Select(a => a.ConfigId).ToList(),
                e.Weapons.Select(w => new object[] {
                    w.ConfigId, w.SlotIndex, w.Level,
                    w.RolledStats ?? _emptyStats, // <--- Cache Fix
                    w.TotalBaseStats ?? _emptyStats // <--- Cache Fix
                }).ToList(),
                e.FiredWeaponsThisTick.ToList(),
                e.Team,
                e.CurrentShield
            }).ToList(),

            Projectiles = gameState.Projectiles.Values.Select(proj => proj.MovementBehavior == "Orbital"
                            ? new object[] { proj.Id, proj.ConfigId, (int)proj.X, (int)proj.Y, proj.OrbitSpeed, 0f, 1, proj.OwnerId, (int)proj.OrbitRadius, proj.OrbitAngleOffset }
                            : new object[] { proj.Id, proj.ConfigId, (int)proj.X, (int)proj.Y, (int)proj.VelX, (int)proj.VelY }
            ).ToList(),

            Pickups = gameState.Pickups.Values.Select(pk => new object[] {
                pk.Id, (int)pk.X, (int)pk.Y, pk.Value, (int)pk.Type,
                pk.DroppedWeapon?.ConfigId ?? pk.DroppedItem?.ConfigId ?? "",
                pk.DroppedWeapon?.Level ?? pk.DroppedItem?.Level ?? 1,
                pk.DroppedWeapon?.TotalBaseStats ?? pk.DroppedItem?.TotalBaseStats ?? _emptyStats, // <--- Cache Fix
                pk.DroppedWeapon?.RolledStats ?? pk.DroppedItem?.RolledStats ?? _emptyStats, // <--- Cache Fix
                (pk.DroppedWeapon != null ? (pk.DroppedWeapon.WeaponSkills?.Select(s => s.ConfigId).ToList() ?? new List<string>()) : (pk.DroppedItem?.ItemSkills?.Select(s => s.ConfigId).ToList() ?? new List<string>()))
            }).ToList(),

            Damage = dmgEvents.Select(d => new object[] { (int)d.X, (int)d.Y, (int)d.Amount, d.IsCritical ? 1 : 0, d.IsDodge ? 1 : 0, d.IsBlock ? 1 : 0 }).ToList(),
            Aoe = aoeEvents.Select(a => new object[] { (int)a.X, (int)a.Y, (int)a.Radius, a.IsFriendly, a.ConfigId }).ToList(),
            Beams = beamEvents.Select(b => new object[] { (int)b.Dto.StartX, (int)b.Dto.StartY, (int)b.Dto.TargetX, (int)b.Dto.TargetY, (int)b.Dto.Width, b.Dto.ColorTint, b.CasterId, b.SkillId }).ToList()
        };
    }

    private static FlatState CullForViewport(PlayerEntity player, float mapW, float mapH, FlatState globalState)
    {
        float logicalScreenWidth = 1920f;
        float logicalScreenHeight = 1080f;

        float minCamX = Math.Min(logicalScreenWidth / 2f, mapW / 2f);
        float maxCamX = Math.Max(minCamX, mapW - (logicalScreenWidth / 2f));
        float cameraX = Math.Clamp(player.X, minCamX, maxCamX);

        float minCamY = Math.Min(logicalScreenHeight / 2f, mapH / 2f);
        float maxCamY = Math.Max(minCamY, mapH - (logicalScreenHeight / 2f));
        float cameraY = Math.Clamp(player.Y, minCamY, maxCamY);

        float minX = cameraX - ((logicalScreenWidth + 400f) / 2);
        float maxX = cameraX + ((logicalScreenWidth + 400f) / 2);
        float minY = cameraY - ((logicalScreenHeight + 400f) / 2);
        float maxY = cameraY + ((logicalScreenHeight + 400f) / 2);

        return new FlatState
        {
            Players = globalState.Players.Where(p => (int)p[1] >= minX && (int)p[1] <= maxX && (int)p[2] >= minY && (int)p[2] <= maxY).ToList(),

            Enemies = globalState.Enemies.Where(e => (int)e[EnemyIdx.X] >= minX && (int)e[EnemyIdx.X] <= maxX && (int)e[EnemyIdx.Y] >= minY && (int)e[EnemyIdx.Y] <= maxY).ToList(),
            Pickups = globalState.Pickups.Where(pk => (int)pk[1] >= minX && (int)pk[1] <= maxX && (int)pk[2] >= minY && (int)pk[2] <= maxY).ToList(),
            Damage = globalState.Damage.Where(d => (int)d[0] >= minX && (int)d[0] <= maxX && (int)d[1] >= minY && (int)d[1] <= maxY).ToList(),
            Aoe = globalState.Aoe.Where(a => (int)a[0] >= minX && (int)a[0] <= maxX && (int)a[1] >= minY && (int)a[1] <= maxY).ToList(),
            Projectiles = globalState.Projectiles.Where(b => (b.Length > 6 && (int)b[6] == 1) || ((int)b[2] >= minX && (int)b[2] <= maxX && (int)b[3] >= minY && (int)b[3] <= maxY)).ToList(),
            Beams = globalState.Beams.Where(b => ((int)b[0] >= minX && (int)b[0] <= maxX && (int)b[1] >= minY && (int)b[1] <= maxY) || ((int)b[2] >= minX && (int)b[2] <= maxX && (int)b[3] >= minY && (int)b[3] <= maxY)).ToList()
        };
    }

    private (List<object[]> Full, List<object[]> Mini, List<string> Destroyed) ProcessEnemyDeltas(string connectionId, List<object[]> visibleEnemies)
    {
        var knownEnemies = _clientKnownEnemies.GetOrAdd(connectionId, _ => new HashSet<string>());
        var visibleEnemyIds = visibleEnemies.Select(e => (string)e[EnemyIdx.Id]).ToHashSet();

        var newEnemyIds = visibleEnemyIds.Except(knownEnemies).ToHashSet();
        var destroyedEnemyIds = knownEnemies.Except(visibleEnemyIds).ToList();
        var existingEnemyIds = visibleEnemyIds.Intersect(knownEnemies).ToHashSet();

        _clientKnownEnemies[connectionId] = visibleEnemyIds;

        var fullEnemies = visibleEnemies.Where(e => newEnemyIds.Contains((string)e[EnemyIdx.Id])).ToList();
        var miniEnemies = visibleEnemies
                          .Where(e => existingEnemyIds.Contains((string)e[EnemyIdx.Id]))
                          .Select(e => new object[] {
                        e[EnemyIdx.Id], e[EnemyIdx.X], e[EnemyIdx.Y], e[EnemyIdx.CurrentHp],e[EnemyIdx.MaxHp], e[EnemyIdx.AimX], e[EnemyIdx.AimY], e[EnemyIdx.StateId],
                        e[EnemyIdx.CastingSkillId], e[EnemyIdx.CastTimer], e[EnemyIdx.MaxCastTimer], e[EnemyIdx.ActiveEffects], e[EnemyIdx.FiredWeapons],
                        e[16]
                          }).ToList();

        return (fullEnemies, miniEnemies, destroyedEnemyIds);
    }

    private (List<object[]> Full, List<string> Destroyed) ProcessPickupDeltas(string connectionId, List<object[]> visiblePickups)
    {
        var knownPickups = _clientKnownPickups.GetOrAdd(connectionId, _ => new HashSet<string>());
        var visiblePickupIds = visiblePickups.Select(pk => (string)pk[0]).ToHashSet();

        var newPickupIds = visiblePickupIds.Except(knownPickups).ToHashSet();
        var destroyedPickupIds = knownPickups.Except(visiblePickupIds).ToList();

        _clientKnownPickups[connectionId] = visiblePickupIds;
        var fullPickups = visiblePickups.Where(pk => newPickupIds.Contains((string)pk[0])).ToList();

        return (fullPickups, destroyedPickupIds);
    }

    private (List<object[]> Full, List<string> Destroyed) ProcessProjectileDeltas(string connectionId, List<object[]> visibleProjectiles)
    {
        var knownProjectiles = _clientKnownProjectiles.GetOrAdd(connectionId, _ => new HashSet<string>());
        var visibleProjectileIds = visibleProjectiles.Select(p => (string)p[0]).ToHashSet();

        var newProjectileIds = visibleProjectileIds.Except(knownProjectiles).ToHashSet();
        var destroyedProjectileIds = knownProjectiles.Except(visibleProjectileIds).ToList();

        _clientKnownProjectiles[connectionId] = visibleProjectileIds;
        var fullProjectiles = visibleProjectiles.Where(p => newProjectileIds.Contains((string)p[0])).ToList();

        return (fullProjectiles, destroyedProjectileIds);
    }

    private static readonly JsonSerializerOptions _serializerOptions = new JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };

    private static byte[] CompressPayload(object payload)
    {
        // FIX: Pre-allocate 1 Megabyte of memory instantly. 
        // This stops the MemoryStream from constantly resizing and creating massive 
        // abandoned byte arrays that cause the 4-second Garbage Collection freezes!
        using var ms = new MemoryStream(1024 * 1024);

        using (var gzip = new GZipStream(ms, CompressionLevel.Fastest))
        {
            JsonSerializer.Serialize(gzip, payload, _serializerOptions);
        }
        return ms.ToArray();
    }

    private void PerformCleanup(GameState gameState)
    {
        foreach (var p in gameState.Players.Values)
        {
            p.FiredWeaponsThisTick.Clear();
            p.PendingStatDiff.Clear();
        }
        foreach (var e in gameState.Enemies.Values) e.FiredWeaponsThisTick.Clear();

        var disconnected = _clientKnownEnemies.Keys.Except(gameState.Players.Keys).ToList();
        foreach (var id in disconnected)
        {
            _clientKnownEnemies.TryRemove(id, out _);
            _clientKnownPickups.TryRemove(id, out _);
            _clientKnownProjectiles.TryRemove(id, out _);
        }
    }


}