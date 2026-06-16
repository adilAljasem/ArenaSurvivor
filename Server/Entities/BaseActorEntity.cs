using Server.Core;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Server.Entities;

/// <summary>
/// Shared base for PlayerEntity and EnemyEntity.
/// Holds all properties that are common to any actor in the game world.
/// </summary>
public abstract class BaseActorEntity
{
    [JsonIgnore] public bool HasEcsEntity { get; set; } = false;
    [JsonIgnore] public Arch.Core.Entity EcsEntityId { get; set; }
    // --- World Position ---
    public float X { get; set; }
    public float Y { get; set; }

    public float CurrentSweepAngle { get; set; } = 0f;

    // --- Health ---
    public float CurrentHp { get; set; }

    // --- Stats ---
    public StatDictionary Stats { get; set; } = new();

    // --- Team & State ---
    public string Team { get; set; } = string.Empty;
    public string ActionState { get; set; } = "Idle";

    // --- Inventory ---
    public List<EquippedWeapon> Weapons { get; set; } = new();
    public List<EquippedItem> OwnedItems { get; set; } = new();

    // --- Status Effects ---
    public List<ActiveEffect> ActiveEffects { get; set; } = new();

    // --- Skills ---
    public List<ActiveSkill> Skills { get; set; } = new();
    public string CurrentCastingSkillId { get; set; } = string.Empty;
    public float CurrentCastTimer { get; set; }
    public float MaxCastTimer { get; set; }
    public Dictionary<string, float> DynamicSkillTimers { get; set; } = new();

    public abstract float GetTotalStat(string statName, Configs.ConfigManager configManager, GameState state = null);
}
