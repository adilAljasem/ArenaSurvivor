using Microsoft.Extensions.Hosting;
using StackExchange.Redis;
using Server.Core;
using System;
using System.Diagnostics;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Server.Core.Services;

public class WorkerHeartbeatService : BackgroundService
{
    private readonly IConnectionMultiplexer _redis;
    private readonly RoomManager _roomManager;
    private readonly string _workerId = Guid.NewGuid().ToString();
    private readonly string _workerUrl = Environment.GetEnvironmentVariable("WORKER_PUBLIC_URL") ?? "http://localhost:5000/matchHub";

    // Used for CPU calculation
    private TimeSpan _lastTotalProcessorTime = new TimeSpan();
    private DateTime _lastCheckTime = DateTime.UtcNow;

    public WorkerHeartbeatService(IConnectionMultiplexer redis, RoomManager roomManager)
    {
        _redis = redis;
        _roomManager = roomManager;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var db = _redis.GetDatabase();
        var currentProcess = Process.GetCurrentProcess();
        
        while (!stoppingToken.IsCancellationRequested)
        {
            // 1. Get RAM (Working Set in Megabytes)
            currentProcess.Refresh();
            long ramUsageMB = currentProcess.WorkingSet64 / (1024 * 1024);

            // 2. Get CPU % (Delta over the last 5 seconds)
            var currentTotalProcessorTime = currentProcess.TotalProcessorTime;
            var currentTime = DateTime.UtcNow;
            
            double cpuUsedMs = (currentTotalProcessorTime - _lastTotalProcessorTime).TotalMilliseconds;
            double timePassedMs = (currentTime - _lastCheckTime).TotalMilliseconds;
            
            // Divide by processor count to get a true 0-100% representation
            double cpuUsagePercent = (cpuUsedMs / (Environment.ProcessorCount * timePassedMs)) * 100;

            _lastTotalProcessorTime = currentTotalProcessorTime;
            _lastCheckTime = currentTime;

            int roomCount = _roomManager.GetAllRooms().Count();
            
            var data = JsonSerializer.Serialize(new { 
                WorkerId = _workerId, 
                Url = _workerUrl, 
                ActiveRooms = roomCount,
                CpuUsage = Math.Round(cpuUsagePercent, 2),
                RamUsageMB = ramUsageMB
            });

            // Write to Redis. Expires in 10 seconds.
            await db.StringSetAsync($"worker_node:{_workerId}", data, TimeSpan.FromSeconds(10));

            await Task.Delay(5000, stoppingToken); 
        }
    }
}