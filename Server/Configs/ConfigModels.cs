using System.Text.Json.Serialization;

namespace Server.Configs;

// =================================================================================
// HELPER CLASSES & MODIFIERS
// =================================================================================

public class WaveEndEffect
{
    public string StatName { get; set; } = string.Empty;
    public float Amount { get; set; }
}

public class DynamicModifier
{
    public string ConditionType { get; set; } = string.Empty; // e.g., "MissingHealthPercent"
    public string ConditionStat { get; set; } = string.Empty;
    public float ConditionThreshold { get; set; }             // e.g., 0.20
    public string TargetStat { get; set; } = string.Empty;    // e.g., "maxHp"
    public float Amount { get; set; }
}

// =================================================================================
// CORE ENTITIES
// =================================================================================

public class CharacterConfig
{
    // --- Identity ---
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;

    // --- Visuals & Animations ---
    public string TextureKey { get; set; } = string.Empty;
    public int IconFrame { get; set; }
    public bool DefaultFacingRight { get; set; } = true;

    public int[]? AnimIdle { get; set; }
    public int AnimIdleFrameRate { get; set; } = 10;
    public int[]? AnimMove { get; set; }
    public int AnimMoveFrameRate { get; set; } = 15;
    public int[]? AnimAttack { get; set; }
    public int AnimAttackFrameRate { get; set; } = 15;
    public int[]? AnimDeath { get; set; }
    public int AnimDeathFrameRate { get; set; } = 15;

    // --- Stats & Mechanics ---
    public Dictionary<string, float> BaseStats { get; set; } = new(); // "maxHp": 150, "speed": 180
    public List<string> Traits { get; set; } = new(); // "CannotHeal", "MoreEnemies"
    public List<DynamicModifier> DynamicModifiers { get; set; } = new();
    public List<string> StartingSkills { get; set; } = new();
    public List<string> OnDeathSkills { get; set; } = new();
    public List<DynamicSkillTrigger> DynamicSkills { get; set; } = new();       // "adrenaline_surge"
}

public class EnemyConfig
{
    // --- Identity ---
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int Tier { get; set; }
    public bool IsBoss { get; set; }

    // --- Visuals & Animations ---
    public string TextureKey { get; set; } = string.Empty;
    public int IconFrame { get; set; }
    public float Scale { get; set; } = 1.0f;
    public bool DefaultFacingRight { get; set; } = true;
    public bool IsSummonOnly { get; set; } = false;

    public int[]? AnimIdle { get; set; }
    public int AnimIdleFrameRate { get; set; } = 10;
    public int[]? AnimMove { get; set; }
    public int AnimMoveFrameRate { get; set; } = 15;
    public int[]? AnimAttack { get; set; }
    public int AnimAttackFrameRate { get; set; } = 15;
    public int[]? AnimDeath { get; set; }
    public int AnimDeathFrameRate { get; set; } = 15;

    // --- Physics & Stats ---
    public float HitRadius { get; set; } = 15f;
    public float AttackDuration { get; set; } = 0.5f;
    public Dictionary<string, float> BaseStats { get; set; } = new();

    public List<string> StartingSkills { get; set; } = new();

    // --- Modifiers ---
    public List<DynamicModifier> DynamicModifiers { get; set; } = new();
    public List<string> OnDeathSkills { get; set; } = new();
    public List<DynamicSkillTrigger> DynamicSkills { get; set; } = new();
}

// =================================================================================
// EQUIPMENT, ITEMS & PROJECTILES
// =================================================================================

public class WeaponConfig
{
    // --- Identity & Visuals ---
    public string Id { get; set; } = string.Empty;
    public string WeaponFamily { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int Tier { get; set; }
    public string TextureKey { get; set; } = string.Empty;
    public int IconFrame { get; set; }
    public float Scale { get; set; } = 1.0f;
    public bool DefaultFacingRight { get; set; } = true;
    public string AttackAnimType { get; set; } = "recoil"; // Can be: "recoil", "stab", "swing", or "none"

    // --- Core Combat Stats ---
    public float CooldownSeconds { get; set; }
    public float MeleeDamage { get; set; }
    public float RangedDamage { get; set; }
    public float ElementalDamage { get; set; }
    public float Range { get; set; }
    public float Lifespan { get; set; } = 0f;

    // --- Projectile Links ---
    public string ProjectileId { get; set; } = string.Empty;
    public float ProjectileSpeed { get; set; }

    // --- Audio ---
    public string SoundFire { get; set; } = string.Empty;

    // --- Scaling & Mechanics ---
    public Dictionary<string, float> Mechanics { get; set; } = new();     // "critChance", "knockback"
    public Dictionary<string, float> StatBonuses { get; set; } = new();   // "maxHp", "speed"
    public Dictionary<string, float> DamageScaling { get; set; } = new();
    public List<string> Traits { get; set; } = new();
    public List<string> ApplyEffectsOnHit { get; set; } = new();                   // "ExplodesOnImpact", "Homing"
    // --- Granted Skills ---
    public List<string> GrantedSkills { get; set; } = new();

    // --- Random Generation Limits ---
    public float StatRollChance { get; set; } = 0.50f; // 50% base chance
    public int MaxRandomStats { get; set; } = 2;
    public List<string> AllowedRandomStats { get; set; } = new();

    public float SkillRollChance { get; set; } = 0.15f; // 15% base chance
    public int MaxRandomSkills { get; set; } = 1;
    public List<string> AllowedRandomSkills { get; set; } = new();
}

public class ItemConfig
{
    // --- Identity & Visuals ---
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int Price { get; set; }
    public string TextureKey { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    // >>> NEW: Add Tier and Family for merging! <<<
    public int Tier { get; set; } = 1;
    public string ItemFamily { get; set; } = string.Empty;

    // --- Stat Modifiers & Effects ---
    public Dictionary<string, float> StatBonuses { get; set; } = new();
    public List<string> EffectsOnPurchase { get; set; } = new();
    public List<WaveEndEffect> EffectsAtWaveEnd { get; set; } = new();
    public List<DynamicModifier> DynamicModifiers { get; set; } = new();
    public List<string> Traits { get; set; } = new();
}

public class ProjectileConfig
{
    // --- Identity & Visuals ---
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string TextureKey { get; set; } = string.Empty;
    public int IconFrame { get; set; }
    public float Scale { get; set; } = 1.0f;

    // --- Animations ---
    public int[]? AnimFly { get; set; }
    public int AnimFlyFrameRate { get; set; } = 15;
    public int[]? AnimHit { get; set; }
    public int AnimHitFrameRate { get; set; } = 15;

    // --- Physics & Mechanics ---
    public float Lifespan { get; set; } = 0f;
    public float BaseSpeed { get; set; } = 500f;
    public float HitRadius { get; set; } = 15f;
    public int PierceCount { get; set; } = 0;
    public int BounceCount { get; set; } = 0;
    public List<string> ApplyEffectsOnHit { get; set; } = new();

    // --- Audio ---
    public string SoundHit { get; set; } = string.Empty;
}

public class LevelUpCardConfig
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int Tier { get; set; }
    public string StatName { get; set; } = string.Empty;
    public float Amount { get; set; }
}

public class EffectConfig
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool IsBuff { get; set; }
    // --- Visuals ---
    public string TextureKey { get; set; } = string.Empty;
    public int? IconFrame { get; set; } // Added IconFrame!
    public int[]? AnimEffect { get; set; }
    public int AnimEffectFrameRate { get; set; } = 15;
    public bool IsRepeated { get; set; } = true; // Added IsRepeated!
    public string ColorTint { get; set; } = string.Empty;

    // --- Timers & Damage ---
    public float Duration { get; set; }
    public float TickRate { get; set; }
    public float TickDamage { get; set; }

    // --- Stat Changes ---
    public Dictionary<string, float> StatModifiers { get; set; } = new();
}



public class SkillConfig
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;

    // --- Visuals ---
    public string TextureKey { get; set; } = string.Empty;
    public int? IconFrame { get; set; }
    public int[]? AnimSkill { get; set; }
    public int AnimFrameRate { get; set; } = 15;
    public bool IsRepeated { get; set; } = true; // Added IsRepeated!
    public string ColorTint { get; set; } = string.Empty; // Added ColorTint!
    // --- Timing ---
    public float CooldownSeconds { get; set; }
    public float CastTimeSeconds { get; set; }

    // --- Payload: Summon Specific ---
    public string SummonConfigId { get; set; } = string.Empty; // e.g., "goblin_basic" or "tree"
    public int SummonCount { get; set; } = 1;
    public float SummonRadius { get; set; } = 50f; // Scatter them so they don't stack perfectly!

    // --- Mechanics ---
    public SkillTriggerType TriggerType { get; set; } = SkillTriggerType.Auto;
    public SkillTargetType TargetType { get; set; } = SkillTargetType.ClosestEnemy;
    public SkillActionType ActionType { get; set; } = SkillActionType.Projectile;

    // --- Payload ---
    public string ProjectileId { get; set; } = string.Empty;
    public float Radius { get; set; } = 0f;
    public float BaseDamage { get; set; } = 0f;
    public float Lifespan { get; set; } = 0f;
    public List<string> ApplyEffects { get; set; } = new();
    public bool StopMoving { get; set; } = true; // By default, casting roots the player in place!

    // --- Audio ---
    public string SoundCast { get; set; } = string.Empty;
    public string SoundHit { get; set; } = string.Empty;
}

public class DynamicSkillTrigger
{
    public string ConditionType { get; set; } = string.Empty; // e.g., "MissingHealthPercent"
    public float ConditionThreshold { get; set; } // e.g., 0.50 for 50%
    public string SkillId { get; set; } = string.Empty;
    public float Cooldown { get; set; } = 10f; // IMPORTANT: Prevents the skill from firing 20 times a second!
    public float? OverrideCastTime { get; set; }
}

public class MapConfig
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public float Width { get; set; } = 4000f;
    public float Height { get; set; } = 4000f;
}