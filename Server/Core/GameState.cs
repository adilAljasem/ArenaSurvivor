using System.Collections.Concurrent;
using Server.Entities;

namespace Server.Core;

public enum GamePhase
{
    WaitingForPlayers,
    WaveActive,
    ShopPhase
}

public class GameState
{
    // Thread-safe dictionary to hold our players. Key = ConnectionId
    public ConcurrentDictionary<string, PlayerEntity> Players { get; } = new();
    public ConcurrentDictionary<string, EnemyEntity> Enemies { get; } = new();
    public ConcurrentDictionary<string, ProjectileEntity> Projectiles { get; } = new();
    public ConcurrentDictionary<string, PickupEntity> Pickups { get; } = new();

    // --- NEW WAVE MANAGER PROPERTIES ---
    public GamePhase Phase { get; set; } = GamePhase.WaitingForPlayers;
    public int CurrentWave { get; set; } = 1;
    public float PhaseTimer { get; set; } = 0f;
}