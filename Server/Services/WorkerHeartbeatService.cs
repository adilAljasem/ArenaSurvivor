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
            
            double cpuUsagePercent = (cpuUsedMs / (Environment.ProcessorCount * timePassedMs)) * 100;

            _lastTotalProcessorTime = currentTotalProcessorTime;
            _lastCheckTime = currentTime;

            int roomCount = _roomManager.GetAllRooms().Count();
            
            var data = JsonSerializer.Serialize(new { 
                WorkerId = _workerId, 
                // Use the PublicUrl right from your config system!
                Url = _serverConfig.PublicUrl, 
                ActiveRooms = roomCount,
                CpuUsage = Math.Round(cpuUsagePercent, 2),
                RamUsageMB = ramUsageMB,
                LastUpdated = DateTime.UtcNow
            });

            await db.HashSetAsync("active_workers", _workerId, data);

            // Publish per-room detail for the admin "Live Games" page. Short TTL (15s, longer
            // than this loop's 5s interval) so a crashed/killed worker's rooms disappear on
            // their own instead of needing explicit cleanup.
            foreach (var room in _roomManager.GetAllRooms())
            {
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
                    WorkerId = _workerId,
                    WorkerUrl = _serverConfig.PublicUrl,
                    LastUpdated = DateTime.UtcNow
                });
                await db.StringSetAsync($"room_stats:{room.RoomId}", roomData, TimeSpan.FromSeconds(15));
            }

            await Task.Delay(5000, stoppingToken); 
        }
    }
}