using Server.Configs;
using Server.DTOs;
using Server.Entities;
using System;
using System.Collections.Generic;

namespace Server.Core.Systems;

public interface IGameSystem
{
    void Initialize(EventBus eventBus, ConfigManager configs);
    void Update(float dt, GameState state);
}

public class EventBus
{
    private readonly Dictionary<Type, List<Delegate>> _subscribers = new();

    // FIX: Must be ConcurrentQueue to handle simultaneous cross-thread publishing
    private readonly System.Collections.Concurrent.ConcurrentQueue<Action> _eventQueue = new();

    public void Subscribe<TEvent>(Action<TEvent> handler)
    {
        if (!_subscribers.ContainsKey(typeof(TEvent)))
            _subscribers[typeof(TEvent)] = new List<Delegate>();
        _subscribers[typeof(TEvent)].Add(handler);
    }

    public void Publish<TEvent>(TEvent ev)
    {
        if (_subscribers.TryGetValue(typeof(TEvent), out var handlers))
        {
            foreach (var handler in handlers)
            {
                var action = handler as Action<TEvent>;
                _eventQueue.Enqueue(() => action!(ev));
            }
        }
    }

    public void ProcessQueue()
    {
        int maxIterations = 10000;
        int iterations = 0;

        // FIX: Use TryDequeue for thread safety
        while (_eventQueue.TryDequeue(out var action) && iterations < maxIterations)
        {
            action.Invoke();
            iterations++;
        }

        if (iterations >= maxIterations)
        {
            Console.WriteLine("[WARNING] Event cascade limit reached! Possible infinite loop detected. Clearing queue.");
            _eventQueue.Clear();
        }
    }
}

public class DamageAppliedEvent
{
    public BaseActorEntity Target { get; set; } = null!;
    public string AttackerId { get; set; } = string.Empty;
    public GameState State { get; set; } = null!;
    public float Amount { get; set; }
    public bool IsCritical { get; set; }
    public bool IsDodge { get; set; }
    public bool IsBlock { get; set; }
}

public class EntityDeathEvent
{
    public string EntityId { get; set; } = string.Empty;
    public string KillerId { get; set; } = string.Empty;
    public float X { get; set; }
    public float Y { get; set; }
    public string Team { get; set; } = string.Empty;
    public string ConfigId { get; set; } = string.Empty;
    public bool IsPlayer { get; set; }
    public GameState State { get; set; } = null!;
}

public class RequestSkillCastEvent
{
    public SkillConfig Skill { get; set; } = null!;
    public string CasterId { get; set; } = string.Empty;
    public float StartX { get; set; }
    public float StartY { get; set; }
    public string Team { get; set; } = string.Empty;
    public GameState State { get; set; } = null!;
    public ProjectileEntity? SourceProjectile { get; set; }
}

public class TriggerDeathSkillsEvent
{
    public string EntityId { get; set; } = string.Empty;
    public float X { get; set; }
    public float Y { get; set; }
    public string Team { get; set; } = string.Empty;
    public List<string> Skills { get; set; } = new();
    public GameState State { get; set; } = null!;
}

public class ResetPlayerSkillsEvent
{
    public GameState State { get; set; } = null!;
}

public class ApplyEffectEvent
{
    public BaseActorEntity Target { get; set; } = null!;
    public string EffectConfigId { get; set; } = string.Empty;
}

public class SpawnProjectileEvent
{
    public List<ProjectileEntity> Projectiles { get; set; } = new();
    public GameState State { get; set; } = null!;
}

// Visual routing events
public class AoeVisualEvent { public AoeEventDto Dto { get; set; } = null!; }
public class BeamVisualEvent
{
    public BeamEventDto Dto { get; set; } = null!;

    // Identity for this beam instance, used by the client to track one persistent beam
    // object per (caster, skill) pair across ticks instead of spawning a new flash each tick.
    public string CasterId { get; set; } = string.Empty;
    public string SkillId { get; set; } = string.Empty;
}

// Fired the instant a channeled beam's CurrentChannelTimer expires (or the caster dies/is
// interrupted), so the client can destroy its persistent beam object precisely instead of
// guessing from a gap between BeamVisualEvent ticks (which would always be either too early,
// cutting the tail off, or leave a stale beam on screen if a packet ever drops).
public class BeamEndedEvent
{
    public string CasterId { get; set; } = string.Empty;
    public string SkillId { get; set; } = string.Empty;
}