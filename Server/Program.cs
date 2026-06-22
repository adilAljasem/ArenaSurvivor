using Microsoft.AspNetCore.SignalR;
using Server.Hubs;
using Server.Core;
using Server.Services;
using StackExchange.Redis;
using Server.Configs;

var builder = WebApplication.CreateBuilder(args);

int workerThreads, ioThreads;
ThreadPool.GetMinThreads(out workerThreads, out ioThreads);

// Force the ThreadPool to immediately keep at least one thread warm per logical CPU core.
// Multiply by 2 or 4 if you have hyperthreading, to give it plenty of breathing room.
int minThreads = Environment.ProcessorCount * 4; 
ThreadPool.SetMinThreads(Math.Max(workerThreads, minThreads), Math.Max(ioThreads, minThreads));
Console.WriteLine($"[BOOT] ThreadPool Initialized with Minimum {minThreads} threads.");

// 1. Bind Configurations
builder.Services.Configure<ServerConfig>(builder.Configuration.GetSection("ServerConfig"));
builder.Services.Configure<RedisConfig>(builder.Configuration.GetSection("RedisConfig"));

var serverConfig = builder.Configuration.GetSection("ServerConfig").Get<ServerConfig>() ?? new ServerConfig();
var redisConfig = builder.Configuration.GetSection("RedisConfig").Get<RedisConfig>() ?? new RedisConfig();

builder.Services.AddSignalR();
builder.Services.AddSingleton<Server.Configs.ConfigManager>();
builder.Services.AddSingleton<RoomManager>();

// 2. Use Configured Role
var serverRole = serverConfig.Role;

if (serverRole == "Worker" || serverRole == "Dev")
{
    Console.WriteLine("[BOOT] Starting as WORKER Node. Initializing Physics & Game Loops.");
    builder.Services.AddHostedService<GameLoop>();
    builder.Services.AddHostedService<Server.Core.Services.WorkerHeartbeatService>();
}

// 3. Dynamic CORS Origins
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        if (serverConfig.AllowedCorsOrigins != null && serverConfig.AllowedCorsOrigins.Length > 0)
        {
            policy.WithOrigins(serverConfig.AllowedCorsOrigins)
                  .AllowAnyHeader()
                  .AllowAnyMethod()
                  .AllowCredentials(); // Required for SignalR WebSockets
        }
    });
});

// 4. Connect to Redis (Using Config!)
builder.Services.AddSingleton<IConnectionMultiplexer>(ConnectionMultiplexer.Connect(redisConfig.ConnectionString));
builder.Services.AddSingleton<RedisService>();

// 5. Add SignalR WITH the Redis Backplane (Using Config!)
builder.Services.AddSignalR().AddStackExchangeRedis(redisConfig.ConnectionString, options =>
{
    options.Configuration.ChannelPrefix = redisConfig.ChannelPrefix;
});

var app = builder.Build();
app.UseCors();

Console.WriteLine($"[BOOT] Server Role Active: {serverRole}");

// Route Mapping based on Role
if (serverRole == "Master" || serverRole == "Dev")
{
    app.UseDefaultFiles(); // Looks for index.html in wwwroot
    app.UseStaticFiles();  // Serves the assets in wwwroot
    app.MapHub<LobbyHub>("/lobbyHub");
    Console.WriteLine("[BOOT] Mapped: /lobbyHub");
}

if (serverRole == "Worker" || serverRole == "Dev")
{
    app.MapHub<MatchHub>("/matchHub");
    Console.WriteLine("[BOOT] Mapped: /matchHub");
}

app.Run();