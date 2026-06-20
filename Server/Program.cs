using Microsoft.AspNetCore.SignalR;
using Server.Hubs;
using Server.Core;
using Server.Services;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.AddSingleton<Server.Configs.ConfigManager>();
builder.Services.AddSingleton<RoomManager>();

// Default to "Dev" so everything runs on one machine for you!
var serverRole = Environment.GetEnvironmentVariable("SERVER_ROLE") ?? "Dev";

if (serverRole == "Worker" || serverRole == "Dev") 
{
    Console.WriteLine("[BOOT] Starting as WORKER Node. Initializing Physics & Game Loops.");
    builder.Services.AddHostedService<GameLoop>();

    // >>> NEW: Start Heartbeat <<<
    builder.Services.AddHostedService<Server.Core.Services.WorkerHeartbeatService>();
}

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:5173").AllowAnyHeader().AllowAnyMethod().AllowCredentials();
    });
});

// 1. Connect to Redis (Default local port is 6379)
var redisConfiguration = "192.168.2.85:6379";
builder.Services.AddSingleton<IConnectionMultiplexer>(ConnectionMultiplexer.Connect(redisConfiguration));
builder.Services.AddSingleton<RedisService>();

// 2. Add SignalR WITH the Redis Backplane!
builder.Services.AddSignalR().AddStackExchangeRedis(redisConfiguration, options =>
{
    options.Configuration.ChannelPrefix = "ArenaSurvivor"; // Keeps your keys organized
});

var app = builder.Build();
app.UseCors();

Console.WriteLine($"[BOOT] Server Role Active: {serverRole}");

// Route Mapping based on Role
if (serverRole == "Master" || serverRole == "Dev")
{
    app.MapHub<LobbyHub>("/lobbyHub");
    Console.WriteLine("[BOOT] Mapped: /lobbyHub");
}

if (serverRole == "Worker" || serverRole == "Dev")
{
    app.MapHub<MatchHub>("/matchHub");
    Console.WriteLine("[BOOT] Mapped: /matchHub");
}

app.Run();