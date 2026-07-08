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
    private readonly System.Collections.Concurrent.ConcurrentQueue<Action<GameState>> _eventQueue = new();

    public void Subscribe<TEvent>(Action<TEvent, GameState> handler)
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
                var action = handler as Action<TEvent, GameState>;
                // The event itself carries no GameState/entity references - only IDs and
                // immutable values. GameState is supplied fresh by ProcessQueue below, at the
                // moment each queued handler actually runs, not at Publish time - that's what
                // stops a handler from ever acting on state that went stale between publish
                // and processing (e.g. a target that disconnected mid-tick).
                _eventQueue.Enqueue((state) => action!(ev, state));
            }
        }
    }

    public void ProcessQueue(GameState state)
    {
        int maxIterations = 10000;
        int iterations = 0;

        while (_eventQueue.TryDequeue(out var action) && iterations < maxIterations)
        {
            action.Invoke(state);
            iterations++;
        }

        if (iterations >= maxIterations)
        {
            Console.WriteLine("[WARNING] Event cascade limit reached! Possible infinite loop detected. Clearing queue.");
            _eventQueue.Clear();
        }
    }
}

// =====================================================================================
// SAFETY + DRY HELPER: resolve an actor / its ID at the moment a queued handler actually
// runs, instead of an event holding a direct (and potentially stale) entity reference.
// This also replaces the `target is PlayerEntity p ? p.ConnectionId : ((EnemyEntity)target).Id`
// pattern that was hand-rolled in several places (HealthSystem, CombatSystem).
// =====================================================================================
internal static class EntityResolver
{
    public static BaseActorEntity? ResolveActor(GameState state, string id)
    {
        if (string.IsNullOrEmpty(id)) return null;
        if (state.Players.TryGetValue(id, out var player)) return player;
        if (state.Enemies.TryGetValue(id, out var enemy)) return enemy;
        return null;
    }

    public static string GetId(BaseActorEntity actor)
        => actor is PlayerEntity player ? player.ConnectionId : ((EnemyEntity)actor).Id;
}

public class DamageAppliedEvent
{
    public string TargetId { get; init; } = string.Empty;
    public string AttackerId { get; init; } = string.Empty;
    public float Amount { get; init; }
    public bool IsCritical { get; init; }
    public bool IsDodge { get; init; }
    public bool IsBlock { get; init; }
}

public class EntityDeathEvent
{
    public string EntityId { get; init; } = string.Empty;
    public string KillerId { get; init; } = string.Empty;
    public float X { get; init; }
    public float Y { get; init; }
    public string Team { get; init; } = string.Empty;
    public string ConfigId { get; init; } = string.Empty;
    public bool IsPlayer { get; init; }
}

public class RequestSkillCastEvent
{
    // SkillConfig stays a direct reference deliberately - see note above the file list.
    public SkillConfig Skill { get; init; } = null!;
    public string CasterId { get; init; } = string.Empty;
    public float StartX { get; init; }
    public float StartY { get; init; }
    public string Team { get; init; } = string.Empty;
    public string? SourceProjectileId { get; init; }
}

public class TriggerDeathSkillsEvent
{
    public string EntityId { get; init; } = string.Empty;
    public float X { get; init; }
    public float Y { get; init; }
    public string Team { get; init; } = string.Empty;
    public IReadOnlyList<string> Skills { get; init; } = Array.Empty<string>();
}

public class ResetPlayerSkillsEvent
{
    // No properties - this is purely a "reset everyone in the current room" signal.
    // GameState is supplied to the handler via EventBus.ProcessQueue, not carried here.
}

public class ApplyEffectEvent
{
    public string TargetId { get; init; } = string.Empty;
    public string EffectConfigId { get; init; } = string.Empty;
    public string? CasterId { get; init; }
    public int StackAmount { get; init; } = 1;
}

public class SpawnProjectileEvent
{
    public IReadOnlyList<ProjectileEntity> Projectiles { get; init; } = Array.Empty<ProjectileEntity>();
}

public class AoeVisualEvent
{
    public AoeEventDto Dto { get; init; } = null!;
    public string CasterId { get; init; } = string.Empty;
    public string SkillId { get; init; } = string.Empty;
}

public class BeamVisualEvent
{
    public BeamEventDto Dto { get; init; } = null!;
    public string CasterId { get; init; } = string.Empty;
    public string SkillId { get; init; } = string.Empty;
}

public class BeamEndedEvent
{
    public string CasterId { get; init; } = string.Empty;
    public string SkillId { get; init; } = string.Empty;
}

public class ChatMessageEvent
{
    public string Sender { get; init; } = "System";
    public string Message { get; init; } = string.Empty;
}