using Server.Hubs;

var builder = WebApplication.CreateBuilder(args);

// Add SignalR
builder.Services.AddSignalR();
builder.Services.AddSingleton<Server.Core.GameState>();
builder.Services.AddSingleton<Server.Configs.ConfigManager>();
builder.Services.AddHostedService<Server.Core.GameLoop>();
// Allow the Phaser client to connect during local development
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:5173") // Default Vite port
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

var app = builder.Build();

app.UseCors();
app.MapHub<GameHub>("/gameHub");

app.Run();