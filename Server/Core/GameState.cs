using System.Collections.Concurrent;
using Server.Entities;

namespace Server.Core;

public enum GamePhase { WaitingForPlayers, WaveActive, ShopPhase }
public enum RoomStatus { Active, Paused_AwaitingPlayers, GracePeriod, ScheduledForDeletion } // NEW

public class SpectatorEntity
{
    public string ConnectionId { get; set; } = string.Empty;
    public float CameraX { get; set; } = 640;
    public float CameraY { get; set; } = 360;
}

public class GameState
{
    public ConcurrentDictionary<string, PlayerEntity> Players { get; } = new();
    public ConcurrentDictionary<string, EnemyEntity> Enemies { get; } = new();
    public ConcurrentDictionary<string, ProjectileEntity> Projectiles { get; } = new();
    public ConcurrentDictionary<string, PickupEntity> Pickups { get; } = new();
    public ConcurrentDictionary<string, SpectatorEntity> Spectators { get; } = new(); // NEW

    public GamePhase Phase { get; set; } = GamePhase.WaitingForPlayers;

    // --- NEW ROOM LIFECYCLE PROPERTIES ---
    public RoomStatus Status { get; set; } = RoomStatus.Active;
    public float PauseTimer { get; set; } = 0f;


    public int CurrentWave { get; set; } = 1;
    public float PhaseTimer { get; set; } = 0f;
    public string CurrentDifficulty { get; set; } = "easy";
    public bool SkipShopPhase { get; set; } = false;
    public bool AllowSpectators { get; set; } = true;
    public float TimeScale { get; set; } = 1f;

}