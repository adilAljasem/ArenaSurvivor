using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Server.Configs;
using Server.Core;
using Server.Data;
using Server.Hubs;
using Server.Services;
using StackExchange.Redis;



var builder = WebApplication.CreateBuilder(args);

// ─── THREAD POOL ─────────────────────────────────────────────────────────────
int minThreads = Environment.ProcessorCount * 4;
ThreadPool.GetMinThreads(out var wt, out var iot);
ThreadPool.SetMinThreads(Math.Max(wt, minThreads), Math.Max(iot, minThreads));
Console.WriteLine($"[BOOT] ThreadPool: min {minThreads} threads.");

// ─── BIND CONFIGURATION ───────────────────────────────────────────────────────
builder.Services.Configure<ServerConfig>(builder.Configuration.GetSection("ServerConfig"));
builder.Services.Configure<RedisConfig>(builder.Configuration.GetSection("RedisConfig"));
builder.Services.Configure<RoomSettings>(builder.Configuration.GetSection("RoomSettings"));
builder.Services.Configure<EmailSettings>(builder.Configuration.GetSection("EmailSettings"));
builder.Services.Configure<JwtSettings>(builder.Configuration.GetSection("JwtSettings"));

var serverConfig = builder.Configuration.GetSection("ServerConfig").Get<ServerConfig>() ?? new ServerConfig();
var redisConfig = builder.Configuration.GetSection("RedisConfig").Get<RedisConfig>() ?? new RedisConfig();
var jwtSettings = builder.Configuration.GetSection("JwtSettings").Get<JwtSettings>() ?? new JwtSettings();

// ─── DATABASE (PostgreSQL) ────────────────────────────────────────────────────
// NuGet: dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL
builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

// ─── JWT AUTHENTICATION ───────────────────────────────────────────────────────
// NuGet: dotnet add package Microsoft.AspNetCore.Authentication.JwtBearer
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtSettings.Issuer,
            ValidAudience = jwtSettings.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.SecretKey))
        };

        // SignalR cannot send Authorization headers over WebSockets,
        // so the client passes the token as ?access_token= in the query string.
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var token = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(token) &&
                    (path.StartsWithSegments("/lobbyHub") || path.StartsWithSegments("/matchHub")))
                {
                    context.Token = token;
                }
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

// ─── GAME SERVICES ────────────────────────────────────────────────────────────
builder.Services.AddSingleton<Server.Configs.ConfigManager>();
builder.Services.AddSingleton<RoomManager>();
builder.Services.AddSingleton<Server.Core.Services.AchievementService>();

// ─── ROLE-BASED SERVICES ─────────────────────────────────────────────────────
var serverRole = serverConfig.Role;
if (serverRole == "Worker" || serverRole == "Dev")
{
    Console.WriteLine("[BOOT] Starting as WORKER. Initializing game loop.");
    builder.Services.AddHostedService<GameLoop>();
    builder.Services.AddHostedService<Server.Core.Services.WorkerHeartbeatService>();
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        if (serverConfig.AllowedCorsOrigins?.Length > 0)
        {
            policy.WithOrigins(serverConfig.AllowedCorsOrigins)
                  .AllowAnyHeader()
                  .AllowAnyMethod()
                  .AllowCredentials();
        }
    });
});

// ─── REDIS ────────────────────────────────────────────────────────────────────
builder.Services.AddSingleton<IConnectionMultiplexer>(
    ConnectionMultiplexer.Connect(redisConfig.ConnectionString));
builder.Services.AddSingleton<RedisService>();

// ─── SIGNALR + REDIS BACKPLANE ────────────────────────────────────────────────

builder.Services.AddSingleton<Microsoft.AspNetCore.SignalR.IUserIdProvider, PlayerIdUserIdProvider>();

builder.Services.AddSignalR()
    .AddStackExchangeRedis(redisConfig.ConnectionString, options =>
    {
        options.Configuration.ChannelPrefix = redisConfig.ChannelPrefix;
    });

// ─── EMAIL + CONTROLLERS (Master / Dev only) ──────────────────────────────────
if (serverRole == "Master" || serverRole == "Dev")
{
    builder.Services.AddScoped<EmailService>();
    builder.Services.AddControllers();
}

// ─── RATE LIMITING ─────────────────────────────────────────────────────────────
// This is one layer of defense-in-depth alongside Traefik's edge rate limit (docker-compose)
// and the in-hub chat/command throttle (MatchHub) — each catches a different kind of abuse.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // Strict policy for auth endpoints — the highest-value target for automated abuse
    // (credential stuffing on /login, fake account spam on /register). Applied via
    // [EnableRateLimiting("auth")] on the relevant AuthController actions.
    options.AddPolicy("auth", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    // General-purpose limiter for every other HTTP request, keyed by IP. SignalR hub paths are
    // deliberately exempted here: a hub connection is one long-lived request, not many separate
    // ones, so per-HTTP-request limiting can't see (or usefully stop) a flood of hub METHOD
    // calls like chat spam — that's handled separately, in-hub, per method instead.
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(httpContext =>
    {
        var path = httpContext.Request.Path;
        if (path.StartsWithSegments("/lobbyHub") || path.StartsWithSegments("/matchHub"))
            return RateLimitPartition.GetNoLimiter("signalr");

        string key = httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 100,
            Window = TimeSpan.FromSeconds(10),
            QueueLimit = 0
        });
    });
});

// ─── BUILD ────────────────────────────────────────────────────────────────────
var app = builder.Build();

// Run EF migrations automatically on startup (safe to call repeatedly)
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    await db.Database.MigrateAsync();
}

app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

Console.WriteLine($"[BOOT] Role: {serverRole}");

if (serverRole == "Master" || serverRole == "Dev")
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
    app.MapHub<LobbyHub>("/lobbyHub");
    app.MapControllers();

    Console.WriteLine("[BOOT] Mapped: /lobbyHub, /api/auth/*");
}

if (serverRole == "Worker" || serverRole == "Dev")
{
    app.MapHub<MatchHub>("/matchHub");
    Console.WriteLine("[BOOT] Mapped: /matchHub");
}

// ─── REDIS PUB/SUB FOR FORCE LOGOUT ──────────────────────────────────────────
var redisMultiplexer = app.Services.GetRequiredService<IConnectionMultiplexer>();
var sub = redisMultiplexer.GetSubscriber();
sub.Subscribe("force_logout", async (channel, message) =>
{
    string playerId = message.ToString();

    // Kick from LobbyHub (Master Node)
    var lobbyHub = app.Services.GetService<IHubContext<LobbyHub>>();
    if (lobbyHub != null)
    {
        await lobbyHub.Clients.User(playerId).SendAsync("ForceDisconnect", "Logged in from another location.");
    }

    // Kick from MatchHub (Worker Nodes)
    var matchHub = app.Services.GetService<IHubContext<MatchHub>>();
    if (matchHub != null)
    {
        await matchHub.Clients.User(playerId).SendAsync("ForceDisconnect", "Logged in from another location.");
    }
});

app.Run();

public class PlayerIdUserIdProvider : Microsoft.AspNetCore.SignalR.IUserIdProvider
{
    public string? GetUserId(Microsoft.AspNetCore.SignalR.HubConnectionContext connection)
    {
        return connection.User?.FindFirst("PlayerId")?.Value;
    }
}