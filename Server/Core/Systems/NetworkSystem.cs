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

public static class NetworkSystem
{
    // =========================================================================
    // CACHES & CONSTANTS
    // =========================================================================
    private static ConcurrentDictionary<string, HashSet<string>> _clientKnownEnemies = new();
    private static ConcurrentDictionary<string, HashSet<string>> _clientKnownPickups = new();

    private static byte GetStateId(string state) => state switch
    {
        "Moving" => 1,
        "Attacking" => 2,
        "Casting" => 3,
        "Dead" => 4,
        _ => 0
    };

    // We use a small internal DTO to pass flattened arrays between our helper methods
    private class FlatState
    {
        public List<object[]> Players { get; set; } = new();
        public List<object[]> Enemies { get; set; } = new();
        public List<object[]> NewBullets { get; set; } = new();
        public List<object[]> Pickups { get; set; } = new();
        public List<object[]> Damage { get; set; } = new();
        public List<object[]> Aoe { get; set; } = new();
    }

    // Flat enemy array indices (must match FlattenGlobalState order)
    private static class EnemyIdx
    {
        public const int Id = 0;
        public const int ConfigId = 1;
        public const int X = 2;
        public const int Y = 3;
        public const int CurrentHp = 4;
        public const int MaxHp = 5;
        public const int StateId = 6;
        public const int CastingSkillId = 7;
        public const int CastTimer = 8;
        public const int MaxCastTimer = 9;
        public const int ActiveEffects = 10;
    }

    // =========================================================================
    // 1. THE MAIN ORCHESTRATOR
    // =========================================================================
    public static async Task BroadcastStateAsync(
        IHubContext<GameHub> hubContext, GameState gameState, ConfigManager configManager,
        List<DamageEventDto> tickDamageEvents, List<AoeEventDto> tickAoeEvents,
        List<ProjectileEntity> tickNewProjectiles, List<string> tickDestroyedProjectiles,
        CancellationToken stoppingToken)
    {
        if (gameState.Players.IsEmpty) return;

        // Step 1: Flatten all global game data ONCE per tick
        var globalFlatState = FlattenGlobalState(gameState, configManager, tickDamageEvents, tickAoeEvents, tickNewProjectiles);

        float mapW = 4000f;
        float mapH = 4000f;
        if (configManager.Maps != null && configManager.Maps.TryGetValue("map_forest", out var currentMap))
        {
            mapW = currentMap.Width;
            mapH = currentMap.Height;
        }

        // Process and send the custom payload for each connected player
        foreach (var player in gameState.Players.Values)
        {
            // Step 2: Camera Viewport Culling
            var visibleState = CullForViewport(player, mapW, mapH, globalFlatState);

            // Step 3: Delta Compression (Memory Diffing)
            var enemyDeltas = ProcessEnemyDeltas(player.ConnectionId, visibleState.Enemies);
            var pickupDeltas = ProcessPickupDeltas(player.ConnectionId, visibleState.Pickups);

            // Step 4: Build Final Payload (omit empty arrays to reduce bandwidth)
            var payload = new
            {
                p = visibleState.Players,
                e = enemyDeltas.Full.Count > 0 ? enemyDeltas.Full : null,
                me = enemyDeltas.Mini.Count > 0 ? enemyDeltas.Mini : null,
                de = enemyDeltas.Destroyed.Count > 0 ? enemyDeltas.Destroyed : null,
                nb = visibleState.NewBullets.Count > 0 ? visibleState.NewBullets : null,
                db = tickDestroyedProjectiles.Count > 0 ? tickDestroyedProjectiles : null,
                pk = pickupDeltas.Full.Count > 0 ? pickupDeltas.Full : null,
                dpk = pickupDeltas.Destroyed.Count > 0 ? pickupDeltas.Destroyed : null,
                dmg = visibleState.Damage.Count > 0 ? visibleState.Damage : null,
                aoe = visibleState.Aoe.Count > 0 ? visibleState.Aoe : null,
                ph = (byte)gameState.Phase,
                w = gameState.CurrentWave,
                tr = Math.Max(0, (int)gameState.PhaseTimer),
            };

            // Step 5: Compress & Send
            byte[] compressedBytes = CompressPayload(payload);
            await hubContext.Clients.Client(player.ConnectionId).SendAsync("UpdateStateCompressed", compressedBytes, cancellationToken: stoppingToken);
        }

        // Step 6: End of Tick Cleanup
        PerformCleanup(gameState);
    }

    // =========================================================================
    // 2. HELPER: DATA FLATTENING (Runs ONCE per tick)
    // =========================================================================
    private static FlatState FlattenGlobalState(GameState gameState, ConfigManager configManager, List<DamageEventDto> dmgEvents, List<AoeEventDto> aoeEvents, List<ProjectileEntity> newProjectiles)
    {
        return new FlatState
        {
            Players = gameState.Players.Values.Select(p => new object[] {
                p.ConnectionId, (int)p.X, (int)p.Y, (int)p.AimX, (int)p.AimY,
                (int)p.CurrentHp, (int)p.GetTotalStat("maxHp", configManager), p.Gold, GetStateId(p.ActionState),
                p.CurrentCastingSkillId, Math.Round(p.CurrentCastTimer, 1), Math.Round(p.MaxCastTimer, 1),
                p.Weapons.Select(w => new object[] { w.ConfigId, w.SlotIndex, w.Level }).ToList(),
                p.FiredWeaponsThisTick.ToList(), p.ActiveEffects.Select(e => e.ConfigId).ToList()
            }).ToList(),

            Enemies = gameState.Enemies.Values.Select(e => new object[] {
                e.Id, e.ConfigId, (int)e.X, (int)e.Y, (int)e.CurrentHp, (int)e.GetTotalStat("maxHp", configManager),
                GetStateId(e.ActionState), e.CurrentCastingSkillId, Math.Round(e.CurrentCastTimer, 1), Math.Round(e.MaxCastTimer, 1),
                e.ActiveEffects.Select(a => a.ConfigId).ToList()
            }).ToList(),

            NewBullets = newProjectiles.Select(proj => new object[] {
                proj.Id, proj.ConfigId, (int)proj.X, (int)proj.Y, (int)proj.VelX, (int)proj.VelY
            }).ToList(),

            Pickups = gameState.Pickups.Values.Select(pk => new object[] { pk.Id, (int)pk.X, (int)pk.Y, pk.Value }).ToList(),
            Damage = dmgEvents.Select(d => new object[] { (int)d.X, (int)d.Y, (int)d.Amount }).ToList(),
            Aoe = aoeEvents.Select(a => new object[] { (int)a.X, (int)a.Y, (int)a.Radius, a.IsFriendly, a.ConfigId }).ToList()
        };
    }

    // =========================================================================
    // 3. HELPER: VIEWPORT CULLING (Runs PER PLAYER)
    // =========================================================================
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
            NewBullets = globalState.NewBullets.Where(b => (int)b[2] >= minX && (int)b[2] <= maxX && (int)b[3] >= minY && (int)b[3] <= maxY).ToList()
        };
    }

    // =========================================================================
    // 4. HELPERS: DELTA COMPRESSION
    // =========================================================================
    private static (List<object[]> Full, List<object[]> Mini, List<string> Destroyed) ProcessEnemyDeltas(string connectionId, List<object[]> visibleEnemies)
    {
        var knownEnemies = _clientKnownEnemies.GetOrAdd(connectionId, _ => new HashSet<string>());
        var visibleEnemyIds = visibleEnemies.Select(e => (string)e[EnemyIdx.Id]).ToHashSet();

        var newEnemyIds = visibleEnemyIds.Except(knownEnemies).ToHashSet();
        var destroyedEnemyIds = knownEnemies.Except(visibleEnemyIds).ToList();
        var existingEnemyIds = visibleEnemyIds.Intersect(knownEnemies).ToHashSet();

        _clientKnownEnemies[connectionId] = visibleEnemyIds; // Save memory for next tick

        var fullEnemies = visibleEnemies.Where(e => newEnemyIds.Contains((string)e[EnemyIdx.Id])).ToList();
        var miniEnemies = visibleEnemies
                          .Where(e => existingEnemyIds.Contains((string)e[EnemyIdx.Id]))
                          .Select(e => new object[] {
                        e[EnemyIdx.Id],
                        e[EnemyIdx.X],
                        e[EnemyIdx.Y],
                        e[EnemyIdx.CurrentHp],
                        e[EnemyIdx.StateId],
                        e[EnemyIdx.CastingSkillId],
                        e[EnemyIdx.CastTimer],
                        e[EnemyIdx.MaxCastTimer],
                        e[EnemyIdx.ActiveEffects]
                          })
                          .ToList();

        return (fullEnemies, miniEnemies, destroyedEnemyIds);
    }

    private static (List<object[]> Full, List<string> Destroyed) ProcessPickupDeltas(string connectionId, List<object[]> visiblePickups)
    {
        var knownPickups = _clientKnownPickups.GetOrAdd(connectionId, _ => new HashSet<string>());
        var visiblePickupIds = visiblePickups.Select(pk => (string)pk[0]).ToHashSet();

        var newPickupIds = visiblePickupIds.Except(knownPickups).ToHashSet();
        var destroyedPickupIds = knownPickups.Except(visiblePickupIds).ToList();

        _clientKnownPickups[connectionId] = visiblePickupIds;
        var fullPickups = visiblePickups.Where(pk => newPickupIds.Contains((string)pk[0])).ToList();

        return (fullPickups, destroyedPickupIds);
    }

    // =========================================================================
    // 5. HELPER: GZIP COMPRESSION
    // =========================================================================
    private static readonly JsonSerializerOptions _serializerOptions = new JsonSerializerOptions
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    private static byte[] CompressPayload(object payload)
    {
        string jsonString = JsonSerializer.Serialize(payload, _serializerOptions);
        byte[] jsonBytes = Encoding.UTF8.GetBytes(jsonString);

        using var ms = new MemoryStream();
        using (var gzip = new GZipStream(ms, CompressionLevel.Fastest))
        {
            gzip.Write(jsonBytes, 0, jsonBytes.Length);
        }
        return ms.ToArray();
    }

    // =========================================================================
    // 6. HELPER: TICK CLEANUP
    // =========================================================================
    private static void PerformCleanup(GameState gameState)
    {
        foreach (var p in gameState.Players.Values)
        {
            p.FiredWeaponsThisTick.Clear();
        }

        var disconnected = _clientKnownEnemies.Keys.Except(gameState.Players.Keys).ToList();
        foreach (var id in disconnected)
        {
            _clientKnownEnemies.TryRemove(id, out _);
            _clientKnownPickups.TryRemove(id, out _);
        }
    }
}