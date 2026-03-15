namespace Server.Configs;

public class CharacterConfig
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string TextureKey { get; set; } = string.Empty;
    public bool DefaultFacingRight { get; set; } = true;
    public int IconFrame { get; set; }

    // Starting stats: "maxHp": 150, "speed": 180, "dodge": 0.15
    public Dictionary<string, float> BaseStats { get; set; } = new();

    // Built-in character traits: "CannotHeal", "MoreEnemies"
    public List<string> Traits { get; set; } = new();
}

public class EnemyConfig
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int Tier { get; set; }
    public bool IsBoss { get; set; }
    public string TextureKey { get; set; } = string.Empty;
    public bool DefaultFacingRight { get; set; } = true;
    public float Scale { get; set; } = 1.0f;
    public int IconFrame { get; set; }
    public float HitRadius { get; set; } = 15f;


    // Animation data
    public int[] AnimIdle { get; set; } = Array.Empty<int>();
    public int[] AnimAttack { get; set; } = Array.Empty<int>();
    public int AnimIdleFrameRate { get; set; } = 10;
    public int AnimAttackFrameRate { get; set; } = 15;
    public float AttackDuration { get; set; } = 0.5f;

    // The universal stat dictionary! "maxHp": 30, "armor": 5, "lifeSteal": 0.1
    public Dictionary<string, float> BaseStats { get; set; } = new();
    // >>> NEW: Enemies can now have dynamic phases and conditions! <<<
    public List<DynamicModifier> DynamicModifiers { get; set; } = new();
}

public class WeaponConfig
{
    // 1. Core Engine Requirements (Used by the physics loop)
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int Tier { get; set; }
    public float CooldownSeconds { get; set; }
    public float MeleeDamage { get; set; }
    public float RangedDamage { get; set; }
    public float ElementalDamage { get; set; }
    public string ProjectileId { get; set; }
    public float ProjectileSpeed { get; set; }
    public float Range { get; set; }

    public string TextureKey { get; set; } = string.Empty;
    public int IconFrame { get; set; }

    // 2. THE DATA-DRIVEN RPG SYSTEMS
    // Any weapon-specific stat goes here: "critChance", "knockback", "pierce", "burnDamage"
    public Dictionary<string, float> Mechanics { get; set; } = new();

    // Stats given globally to the player while holding it: "maxHp", "speed"
    public Dictionary<string, float> StatBonuses { get; set; } = new();

    // How the base damage scales with player stats
    public Dictionary<string, float> DamageScaling { get; set; } = new();

    // Text-based behaviors: "ExplodesOnImpact", "Homing"
    public List<string> Traits { get; set; } = new();
}

public class WaveEndEffect
{
    public string StatName { get; set; } = string.Empty;
    public float Amount { get; set; }
}

public class DynamicModifier
{
    public string ConditionType { get; set; } = string.Empty; // e.g., "MissingHealthPercent"
    public float ConditionThreshold { get; set; } // e.g., 0.20
    public string TargetStat { get; set; } = string.Empty; // e.g., "maxHp"
    public float Amount { get; set; } // Clean and unified!
    public string ConditionStat { get; set; } = string.Empty;
}

public class ItemConfig
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int Price { get; set; }

    public string TextureKey { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;


    // The new mechanic lists!
    public List<string> Traits { get; set; } = new();
    public List<WaveEndEffect> EffectsAtWaveEnd { get; set; } = new();
    public List<DynamicModifier> DynamicModifiers { get; set; } = new();
    public List<string> EffectsOnPurchase { get; set; } = new();
    public Dictionary<string, float> StatBonuses { get; set; } = new();
}

public class LevelUpCardConfig
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int Tier { get; set; }
    public string StatName { get; set; } = string.Empty;
    public float Amount { get; set; }
}

public class ProjectileConfig
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;

    // --- Visuals ---
    public string TextureKey { get; set; } = string.Empty;
    public int IconFrame { get; set; }
    public float Scale { get; set; } = 1.0f;
    // --- Animations ---
    public int[]? AnimFly { get; set; }
    public int AnimFlyFrameRate { get; set; } = 15;

    public int[]? AnimHit { get; set; } // Optional explosion on impact!
    public int AnimHitFrameRate { get; set; } = 15;

    // --- Physics & Mechanics ---
    public float BaseSpeed { get; set; } = 500f;
    public float HitRadius { get; set; } = 15f;
    public int PierceCount { get; set; } = 0;
    public int BounceCount { get; set; } = 0;
}