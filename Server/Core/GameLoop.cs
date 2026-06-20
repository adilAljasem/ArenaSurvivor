using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Server.Configs;
using Server.Hubs;
using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Server.Core;

public class GameLoop : BackgroundService
{
    private readonly IHubContext<MatchHub> _hubContext;
    private readonly RoomManager _roomManager;
    private readonly ConfigManager _configManager;
    private readonly int _tickRateMs = 50; // 20 TPS

    public GameLoop(IHubContext<MatchHub> hubContext, RoomManager roomManager, ConfigManager configManager)
    {
        _hubContext = hubContext;
        _roomManager = roomManager;
        _configManager = configManager;

        _configManager.LoadConfigs();

        // Push global JSON updates to ALL players if a reload occurs
        _configManager.OnConfigsReloaded += async () =>
        {
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

            // Fetch all active rooms and execute their Ticks concurrently
            var activeRooms = _roomManager.GetAllRooms();
            var tasks = activeRooms.Select(room => room.TickAsync(dt, stoppingToken));

            await Task.WhenAll(tasks);

            var executionTime = DateTime.UtcNow - currentTickTime;
            var delay = _tickRateMs - (int)executionTime.TotalMilliseconds;

            if (delay > 0)
                await Task.Delay(delay, stoppingToken);
        }
    }
}