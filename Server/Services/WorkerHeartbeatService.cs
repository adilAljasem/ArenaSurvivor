using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options; 
using StackExchange.Redis;
using Server.Core;
using Server.Configs; 
using System;
using System.Diagnostics;
using System.IO; // <-- Required for File.ReadLines
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Server.Core.Services;

public class WorkerHeartbeatService : BackgroundService
{
    private readonly IConnectionMultiplexer _redis;
    private readonly RoomManager _roomManager;
    private readonly ServerConfig _serverConfig; 

    private readonly string _workerId = Guid.NewGuid().ToString();

    // State tracker for Linux system CPU calculation
    private (long Idle, long Total) _lastCpuTicks = (0, 0);
    private DateTime _lastCheckTime = DateTime.UtcNow;

    public WorkerHeartbeatService(IConnectionMultiplexer redis, RoomManager roomManager, IOptions<ServerConfig> serverConfig)
    {
        _redis = redis;
        _roomManager = roomManager;
        _serverConfig = serverConfig.Value; 
    }

    private double GetHostSystemCpuUsage()
    {
        try
        {
            // /proc/stat is mapped from the host into the Docker container by default
            var lines = File.ReadLines("/proc/stat").First().Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var times = lines.Skip(1).Select(long.Parse).ToArray();
            
            long idle = times[3] + times[4]; // idle + iowait
            long total = times.Sum();

            long idleDelta = idle - _lastCpuTicks.Idle;
            long totalDelta = total - _lastCpuTicks.Total;

            _lastCpuTicks = (idle, total);

            if (totalDelta == 0) return 0;
            
            return Math.Round((1.0 - ((double)idleDelta / totalDelta)) * 100, 2);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[WARNING] Failed to read /proc/stat: {ex.Message}");
            return 0.0;
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var db = _redis.GetDatabase();
        var currentProcess = Process.GetCurrentProcess();

        while (!stoppingToken.IsCancellationRequested)
        {
            currentProcess.Refresh();
            long ramUsageMB = currentProcess.WorkingSet64 / (1024 * 1024);

            var currentTime = DateTime.UtcNow;
            
            // We still need timePassedMs to calculate Network Mbps correctly
            double timePassedMs = (currentTime - _lastCheckTime).TotalMilliseconds;
            double intervalSeconds = timePassedMs / 1000.0; 
            _lastCheckTime = currentTime;

            // Fetch the true host CPU usage using our new Linux helper
            double cpuUsagePercent = GetHostSystemCpuUsage();

            var allRooms = _roomManager.GetAllRooms().ToList(); 
            int roomCount = allRooms.Count;

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
                CpuUsage = cpuUsagePercent,
                RamUsageMB = ramUsageMB,
                NetworkMbps = Math.Round(workerTotalNetworkMbps, 3),
                LastUpdated = DateTime.UtcNow
            });

            await db.HashSetAsync("active_workers", _workerId, data);

            await Task.Delay(5000, stoppingToken);
        }
    }
}