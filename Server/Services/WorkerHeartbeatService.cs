using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options; // <-- Add this
using StackExchange.Redis;
using Server.Core;
using Server.Configs; // <-- Add this
using System;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Server.Core.Services;

public class WorkerHeartbeatService : BackgroundService
{
    private readonly IConnectionMultiplexer _redis;
    private readonly RoomManager _roomManager;
    private readonly ServerConfig _serverConfig; // <-- Add this

    private readonly string _workerId = Guid.NewGuid().ToString();

    // Used for CPU calculation
    private TimeSpan _lastTotalProcessorTime = new TimeSpan();
    private DateTime _lastCheckTime = DateTime.UtcNow;

    // Update the constructor to accept IOptions<ServerConfig>
    public WorkerHeartbeatService(IConnectionMultiplexer redis, RoomManager roomManager, IOptions<ServerConfig> serverConfig)
    {
        _redis = redis;
        _roomManager = roomManager;
        _serverConfig = serverConfig.Value; // <-- Store the config
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var db = _redis.GetDatabase();
        var currentProcess = Process.GetCurrentProcess();

        while (!stoppingToken.IsCancellationRequested)
        {
            currentProcess.Refresh();
            long ramUsageMB = currentProcess.WorkingSet64 / (1024 * 1024);

            var currentTotalProcessorTime = currentProcess.TotalProcessorTime;
            var currentTime = DateTime.UtcNow;

            double cpuUsedMs = (currentTotalProcessorTime - _lastTotalProcessorTime).TotalMilliseconds;
            double timePassedMs = (currentTime - _lastCheckTime).TotalMilliseconds;
            double intervalSeconds = timePassedMs / 1000.0; // real elapsed time, not an assumed 5s

            double cpuUsagePercent = (cpuUsedMs / (Environment.ProcessorCount * timePassedMs)) * 100;

            _lastTotalProcessorTime = currentTotalProcessorTime;
            _lastCheckTime = currentTime;

            var allRooms = _roomManager.GetAllRooms().ToList(); // was enumerated twice before; now once
            int roomCount = allRooms.Count;

            // Each room's bandwidth counter resets on read, so consume it exactly ONCE here
            // and reuse the value for both the per-room stat and the worker-level total.
            double workerTotalNetworkMbps = 0;

            foreach (var room in allRooms)
            {
                double roomNetworkMbps = room.ConsumeNetworkBandwidthMbps(intervalSeconds);
                workerTotalNetworkMbps += roomNetworkMbps;

                var roomData = JsonSerializer.Serialize(new
                {
                    RoomId = room.RoomId,
                    RoomName = room.RoomName,
                    Difficulty = room.State.CurrentDifficulty,
                    Wave = room.State.CurrentWave,
                    Phase = room.State.Phase.ToString(),
                    MapId = room.CurrentMapId,
                    PlayerCount = room.State.Players.Count,
                    PlayerNames = room.State.Players.Values.Select(p => p.Name).ToList(),
                    NetworkMbps = Math.Round(roomNetworkMbps, 3),
                    WorkerId = _workerId,
                    WorkerUrl = _serverConfig.PublicUrl,
                    LastUpdated = DateTime.UtcNow
                });
                await db.StringSetAsync($"room_stats:{room.RoomId}", roomData, TimeSpan.FromSeconds(15));
            }

            var data = JsonSerializer.Serialize(new
            {
                WorkerId = _workerId,
                Url = _serverConfig.PublicUrl,
                ActiveRooms = roomCount,
                CpuUsage = Math.Round(cpuUsagePercent, 2),
                RamUsageMB = ramUsageMB,
                NetworkMbps = Math.Round(workerTotalNetworkMbps, 3),
                LastUpdated = DateTime.UtcNow
            });

            await db.HashSetAsync("active_workers", _workerId, data);

            await Task.Delay(5000, stoppingToken);
        }
    }

}