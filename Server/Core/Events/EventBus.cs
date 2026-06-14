using System;
using System.Collections.Generic;

namespace Server.Core.Events;

// =====================================================================
// 1. THE INTERFACE
// =====================================================================
public interface IGameEvent { }

// =====================================================================
// 2. THE MESSAGE BUS
// =====================================================================
public class EventBus
{
    // Holds immediate listeners
    private readonly Dictionary<Type, List<Delegate>> _subscribers = new();
    
    // Holds deferred events to be processed safely at the end of the frame
    private readonly Queue<IGameEvent> _eventQueue = new();

    /// <summary>
    /// Register a system to listen for a specific event type.
    /// </summary>
    public void Subscribe<T>(Action<T> handler) where T : IGameEvent
    {
        var type = typeof(T);
        if (!_subscribers.ContainsKey(type))
        {
            _subscribers[type] = new List<Delegate>();
        }
        _subscribers[type].Add(handler);
    }

    /// <summary>
    /// Unregister a system from listening.
    /// </summary>
    public void Unsubscribe<T>(Action<T> handler) where T : IGameEvent
    {
        var type = typeof(T);
        if (_subscribers.TryGetValue(type, out var handlers))
        {
            handlers.Remove(handler);
        }
    }

    /// <summary>
    /// Fires the event immediately. The listener executes right here, right now.
    /// </summary>
    public void Publish<T>(T gameEvent) where T : IGameEvent
    {
        var type = typeof(T);
        if (_subscribers.TryGetValue(type, out var handlers))
        {
            foreach (var handler in handlers)
            {
                // Cast back to the specific action type and invoke
                ((Action<T>)handler)(gameEvent);
            }
        }
    }

    /// <summary>
    /// Queues the event to be processed at the end of the tick. 
    /// This is vital for avoiding collection-modified exceptions!
    /// </summary>
    public void Queue(IGameEvent gameEvent)
    {
        _eventQueue.Enqueue(gameEvent);
    }

    /// <summary>
    /// Call this ONCE at the very end of your GameLoop tick.
    /// </summary>
    public void ProcessQueue()
    {
        // Process everything currently in the queue.
        // We capture the count so if events spawn NEW events, they wait until next frame!
        int count = _eventQueue.Count;
        for (int i = 0; i < count; i++)
        {
            var gameEvent = _eventQueue.Dequeue();
            
            // We have to use a slightly slower reflection invoke here because the queue 
            // is untyped, but for end-of-frame resolution, it's perfectly fine.
            var type = gameEvent.GetType();
            if (_subscribers.TryGetValue(type, out var handlers))
            {
                foreach (var handler in handlers)
                {
                    handler.DynamicInvoke(gameEvent);
                }
            }
        }
    }
}

// =====================================================================
// 3. YOUR FIRST CORE EVENTS
// =====================================================================

/// <summary>
/// Fired when an entity takes a hit. CombatSystem listens to this to do the math.
/// </summary>
public struct DamageEvent : IGameEvent
{
    public string TargetId { get; }
    public string SourceId { get; }
    public float PhysicalDamage { get; }
    public float MagicDamage { get; }
    public bool IsCritical { get; }

    public DamageEvent(string targetId, string sourceId, float physDmg, float magicDmg, bool isCrit)
    {
        TargetId = targetId;
        SourceId = sourceId;
        PhysicalDamage = physDmg;
        MagicDamage = magicDmg;
        IsCritical = isCrit;
    }
}

/// <summary>
/// Fired when HP reaches 0. A CleanupSystem listens to this to handle drops and removal.
/// </summary>
public struct DeathEvent : IGameEvent
{
    public string DeadEntityId { get; }
    public string KillerId { get; }
    public float X { get; }
    public float Y { get; }

    public DeathEvent(string deadEntityId, string killerId, float x, float y)
    {
        DeadEntityId = deadEntityId;
        KillerId = killerId;
        X = x;
        Y = y;
    }
}