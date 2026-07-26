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
// BASE CONFIG CLASSES (DRY)
// =================================================================================

/// <summary>
/// Shared base for WeaponConfig and ItemConfig.
/// Contains all properties that every piece of gear must have.
/// </summary>
public abstract class BaseGearConfig
{
    // --- Identity ---
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int Tier { get; set; }
    public int Price { get; set; }
    public bool AllowDuplicates { get; set; } = false;

    // --- Visuals ---
    public string TextureKey { get; set; } = string.Empty;
    public int IconFrame { get; set; }
    public float Scale { get; set; } = 1.0f;

    // --- Shared Traits ---
    public List<string> Traits { get; set; } = new();
    public List<string> GrantedSkills { get; set; } = new();

    // --- Fixed Stat Bonuses ---
    public Dictionary<string, float> StatBonuses { get; set; } = new();
    public Dictionary<string, float> StatMultipliers { get; set; } = new();

    // --- Random Roll Properties ---
    public float StatRollChance { get; set; } = 0f;
    public int MaxRandomStats { get; set; } = 0;
    public Dictionary<string, StatRollConfig> AllowedRandomStats { get; set; } = new();
    public float SkillRollChance { get; set; } = 0f;
    public int MaxRandomSkills { get; set; } = 0;
    public List<string> AllowedRandomSkills { get; set; } = new();

    // --- Drop & Shop Availability ---
    /// <summary>Whether this gear can be dropped by enemies. Default: true.</summary>
    public bool CanDrop { get; set; } = true;

    /// <summary>Whether this gear appears in the player shop. Default: true.</summary>
    public bool AvailableInShop { get; set; } = true;
    public int MaxLevel { get; set; } = 5;

    /// <summary>
    /// Achievement ids the player must have ALL of to see/purchase this gear.
    /// Empty (default) = unlocked for everyone. Enforced server-side in
    /// MatchHub.GenerateShopForPlayer, so locked gear simply never rolls in the shop.
    /// </summary>
    public List<string> RequiredAchievements { get; set; } = new();

    /// <summary>
    /// Character config ids allowed to see/purchase this gear (e.g. ["char_wizard", "char_shaman"]
    /// for a wand only they can use). Empty (default) = every character can see it. Same
    /// enforcement point as RequiredAchievements — MatchHub.GenerateShopForPlayer — so restricted
    /// gear simply never rolls for a character that isn't on the list.
    /// </summary>
    public List<string> AllowedCharacters { get; set; } = new();
}

// =================================================================================
// CORE ENTITIES
// =================================================================================

public class CharacterConfig
{
    // --- Identity ---
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public float HitRadius { get; set; } = 15f;

    // --- Visuals & Animations ---
    public string TextureKey { get; set; } = string.Empty;
    public int IconFrame { get; set; }
    public bool DefaultFacingRight { get; set; } = true;
    public float Scale { get; set; } = 1.0f; // <<< ADD THIS
    public float? WeaponOffset { get; set; }
    public float? VisualHeight { get; set; }


    /// <summary>
    /// Direct escape hatch, bypassing Scale/VisualHeight/WeaponScaleInfluence entirely: if
    /// set, this character's weapons always render at exactly this fraction of their own
    /// designed WeaponConfig.Scale (e.g. 0.25 = always 25%), regardless of body size. Leave
    /// unset (null) to use the normal WeaponScaleInfluence blend above. MUST stay nullable -
    /// a plain float would default to 0 for every character that doesn't set this, which
    /// would render every unconfigured character's weapons at zero scale (invisible).
    /// </summary>
    public float? WeaponScaleOverride { get; set; } = null;

    public int[]? AnimIdle { get; set; }
    public int AnimIdleFrameRate { get; set; } = 10;
    public int[]? AnimMove { get; set; }
    public int AnimMoveFrameRate { get; set; } = 15;
    public int[]? AnimAttack { get; set; }
    public int[]? AnimDeath { get; set; }
    public int AnimDeathFrameRate { get; set; } = 15;

    // --- Stats & Mechanics ---
    public Dictionary<string, float> BaseStats { get; set; } = new();
    public Dictionary<string, float> StatMultipliers { get; set; } = new();
    public List<string> Traits { get; set; } = new();
    public List<DynamicModifier> DynamicModifiers { get; set; } = new();

    // >>> ADD THESE STARTING GEAR LISTS <<<
    public List<string> StartingWeapons { get; set; } = new();
    public List<string> StartingItems { get; set; } = new();

    public List<string> StartingSkills { get; set; } = new();
    public List<string> OnDeathSkills { get; set; } = new();
    public List<DynamicSkillTrigger> DynamicSkills { get; set; } = new();

    /// <summary>
    /// Achievement ids the player must have ALL of to select this character.
    /// Empty (default) = unlocked for everyone. Enforced server-side in LobbyHub.SelectCharacter.
    /// </summary>
    public List<string> RequiredAchievements { get; set; } = new();
}

public class EnemyConfig
{
    // --- Identity ---
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool MovesRandomly { get; set; } = false;
    public int Tier { get; set; }
    public bool IsBoss { get; set; }
    public int MinWave { get; set; } = 1;
    public int MaxWave { get; set; } = 999;
    public int SpawnWeight { get; set; } = 50;
    public List<int> SpawnOnWaves { get; set; } = new();
    public float? WeaponOffset { get; set; }
    public float? VisualHeight { get; set; }

    /// <summary>
    /// Direct escape hatch, bypassing Scale/VisualHeight/WeaponScaleInfluence entirely: if
    /// set, this enemy's weapons always render at exactly this fraction of their own designed
    /// WeaponConfig.Scale (e.g. 0.25 = always 25%), regardless of body size. Leave unset
    /// (null) to use the normal WeaponScaleInfluence blend above. MUST stay nullable - a
    /// plain float would default to 0 for every enemy that doesn't set this, which would
    /// render every unconfigured enemy's weapons at zero scale (invisible).
    /// </summary>
    public float? WeaponScaleOverride { get; set; } = null;

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
    public int[]? AnimDeath { get; set; }
    public int AnimDeathFrameRate { get; set; } = 15;

    // --- Physics & Stats ---
    public float HitRadius { get; set; } = 15f;
    public float AttackDuration { get; set; } = 0.5f;
    /// <summary>Max distance (px) at which this enemy fires its equipped weapons. Spells always bypass this.</summary>
    public float AttackRadius { get; set; } = 10f;
    public Dictionary<string, float> BaseStats { get; set; } = new();
    public Dictionary<string, float> StatMultipliers { get; set; } = new();

    public List<string> StartingSkills { get; set; } = new();

    // --- Starting Equipment ---
    /// <summary>Weapon config IDs this enemy spawns equipped with.</summary>
    public List<string> StartingWeapons { get; set; } = new();

    /// <summary>Per-slot tier override for StartingWeapons (index-aligned). Omit to use tier 1.</summary>
    public List<int>? StartingWeaponTiers { get; set; }

    /// <summary>Item config IDs this enemy spawns holding.</summary>
    public List<string> StartingItems { get; set; } = new();

    /// <summary>Per-slot tier override for StartingItems (index-aligned). Omit to use tier 1.</summary>
    public List<int>? StartingItemTiers { get; set; }

    // --- Drop Chances ---
    /// <summary>Per-weapon roll probability when the enemy dies (e.g. 0.05 = 5%).</summary>
    public float WeaponDropChance { get; set; } = 0f;

    /// <summary>Per-item roll probability when the enemy dies (e.g. 0.10 = 10%).</summary>
    public float ItemDropChance { get; set; } = 0f;

    // --- Modifiers ---
    public List<DynamicModifier> DynamicModifiers { get; set; } = new();
    public List<string> OnDeathSkills { get; set; } = new();
    public List<DynamicSkillTrigger> DynamicSkills { get; set; } = new();
    public List<string> AllowedDifficulties { get; set; } = new();

}

// =================================================================================
// EQUIPMENT, ITEMS & PROJECTILES
// =================================================================================

public class WeaponConfig : BaseGearConfig
{
    // --- Identity & Visuals ---
    public string WeaponFamily { get; set; } = string.Empty;

    /// <summary>
    /// The direction (in degrees) the weapon's sprite art naturally points when unrotated.
    /// 0 = art drawn facing right (old DefaultFacingRight = true). 180 = art drawn facing
    /// left (old DefaultFacingRight = false). Also supports any other direction the art was
    /// drawn in, e.g. 90 = drawn facing down, -90/270 = drawn facing up. The client subtracts
    /// this from the calculated aim angle so the sprite always visually points at its target
    /// regardless of which way the source art was originally drawn.
    /// </summary>
    public float DefaultFacingAngle { get; set; } = 0f;
    public string AttackAnimType { get; set; } = "recoil"; // Can be: "recoil", "stab", "swing", or "none"
    public bool AutoShot { get; set; } = true;

    // --- Core Combat Stats ---
    public float CooldownSeconds { get; set; }
    public float MeleeDamage { get; set; }
    public float RangedDamage { get; set; }
    public float MagicDamage { get; set; }
    public float Range { get; set; }
    public float Lifespan { get; set; } = 0f;

    // --- Projectile Links ---
    public string ProjectileId { get; set; } = string.Empty;
    public int ProjectileCount { get; set; } = 1;
    public float ProjectileSpeed { get; set; }
    public float SpreadAngle { get; set; } = 0f;

    // --- Audio ---
    public string SoundFire { get; set; } = string.Empty;

    // --- Scaling & Mechanics ---
    public Dictionary<string, float> Mechanics { get; set; } = new();     // "critChance", "knockback"
    public Dictionary<string, float> DamageScaling { get; set; } = new();
    public List<string> ApplyEffectsOnHit { get; set; } = new();                   // "ExplodesOnImpact", "Homing"
}

public class ItemConfig : BaseGearConfig
{

    // --- Merging Identity ---
    public string ItemFamily { get; set; } = string.Empty;

    // --- Fixed Stats & Effects ---
    public List<WaveEndEffect> EffectsAtWaveEnd { get; set; } = new();
    public List<string> EffectsOnPurchase { get; set; } = new();
    public List<DynamicModifier> DynamicModifiers { get; set; } = new();
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

    // >>> NEW: Event Chaining & Movement <<<
    public string OnDeathSkillId { get; set; } = string.Empty;
    public string MovementBehavior { get; set; } = "Linear"; // "Linear" or "Orbital"
    public float OrbitRadius { get; set; } = 100f;
    public float OrbitSpeed { get; set; } = 2f;
    public float SweepAngle { get; set; } = 90f;
    public float TickRate { get; set; } = 0f;
    public string TickSkillId { get; set; } = string.Empty;

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
    public string Description { get; set; } = string.Empty;
    public bool IsBuff { get; set; }
    public float GrantedShield { get; set; }
    public int MaxStack { get; set; } = 1;

    // --- Visuals ---
    public string TextureKey { get; set; } = string.Empty;
    public int? IconFrame { get; set; }
    public string ColorTint { get; set; } = string.Empty;
    public float Scale { get; set; } = 0.5f;

    // --- Timers & Damage ---
    public float Duration { get; set; }
    public float TickRate { get; set; }
    public string TickSkillId { get; set; } = string.Empty;
    public float TickDamage { get; set; }

    // --- Stat Changes ---
    public Dictionary<string, float> StatModifiers { get; set; } = new();
    public Dictionary<string, float> StatMultipliers { get; set; } = new();

    // --- Behavioral Lock ---
    // Hard gate for attack/cast triggers (see BaseActorEntity.IsIncapacitated in Entities.cs).
    // Unlike StatMultipliers, which can only scale a distance+cooldown-driven trigger down to a
    // floor, never fully block it, this directly prevents the entity from acting while active.
    public bool PreventsActions { get; set; } = false;
}



public class SkillConfig
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string SkillFamily { get; set; } = string.Empty;
    public int Tier { get; set; } = 1;
    public bool ScalesWithGearLevel { get; set; } = true;
    public bool ShowCastBar { get; set; } = true;
    // When true, this skill is fully immune to the caster's outside power-scaling stats:
    // haste (cooldown/cast time always run at their full configured duration), and
    // magicDamage/damagePercent (damage stays exactly BaseDamage, unscaled). Nothing else
    // about the skill (targeting, effects, healPower on heals, etc.) is affected.
    public bool Immune { get; set; } = false;
    // Every Nth character level (Level % LevelUpEveryXCharacterLevels == 0), this skill
    // auto-advances exactly one tier within its SkillFamily - same "find SkillFamily match
    // with Tier + 1" resolution the duplicate-merge loop in RecalculateSynergies uses, just
    // triggered by the player's own Level instead of a second copy being acquired.
    // 0 (default) disables this entirely - the skill only changes tier via merging or gear leveling.
    public int LevelUpEveryXCharacterLevels { get; set; } = 0;


    // --- Visuals ---
    public string TextureKey { get; set; } = string.Empty;
    public int? IconFrame { get; set; }
    public int[]? AnimSkill { get; set; }
    public int AnimFrameRate { get; set; } = 15;
    public bool IsRepeated { get; set; } = true;
    public bool IsIndependent { get; set; } = false;
    public string ColorTint { get; set; } = string.Empty;
    public string ChargeVfxTextureKey { get; set; } = string.Empty;
    public int[]? ChargeVfxAnimFrames { get; set; }
    public int ChargeVfxFrameRate { get; set; } = 15;
    public float ChargeVfxScale { get; set; } = 1.0f;

    // --- Post-Cast Effect Visuals (the actual skill effect: explosion burst, beam impact, etc.) ---
    // These were already read by VfxRenderer.renderAoeEvents on the client (config.vfxTextureKey
    // etc.) but never actually declared here, so they were silently dropped by deserialization.
    // If set, the AOE plays this sprite animation instead of falling back to the procedural
    // shockwave ring. Leave empty/unset to keep using the procedural ring (no art required).
    public string VfxTextureKey { get; set; } = string.Empty;
    public int[]? VfxAnimFrames { get; set; }
    public int VfxFrameRate { get; set; } = 15;
    public float VfxScale { get; set; } = 1.0f;

    // The radius (in world units) the VfxTextureKey art was actually drawn for. The client
    // uses this to auto-scale the sprite burst to match the skill's real Radius below, so
    // a later balance change to Radius doesn't visually desync from the hitbox. VfxScale
    // above still applies on top as a manual fine-tune multiplier (e.g. art has padding).
    // Leave at 0 to disable auto-scaling and use VfxScale as a flat scale instead (old behavior).
    public float VfxBaseRadius { get; set; } = 0f;

    // --- Timing ---
    public float CooldownSeconds { get; set; }
    public float CastTimeSeconds { get; set; }
    private float _channelDurationSeconds = 0f;
    public float ChannelDurationSeconds
    {
        get => _channelDurationSeconds > 0 ? _channelDurationSeconds : (ActionType == SkillActionType.Beam ? 0.5f : 0f);
        set => _channelDurationSeconds = value;
    }
    // --- Payload: Summon Specific ---
    public string SummonConfigId { get; set; } = string.Empty;
    public int SummonCount { get; set; } = 1;
    public float SummonRadius { get; set; } = 50f;

    // --- Mechanics ---
    public SkillTriggerType TriggerType { get; set; } = SkillTriggerType.Auto;
    public SkillTargetType TargetType { get; set; } = SkillTargetType.ClosestEnemy;
    public SkillActionType ActionType { get; set; } = SkillActionType.Projectile;

    // --- Payload ---
    public string ProjectileId { get; set; } = string.Empty;
    public int ProjectileCount { get; set; } = 1;
    public float SpreadAngle { get; set; } = 0f;
    public float BeamWidth { get; set; } = 10f;
    public float Range { get; set; } = 500f;
    public float SweepAngleSpeed { get; set; } = 0.2f;
    public float Radius { get; set; } = 0f;
    public float BaseDamage { get; set; } = 0f;
    public float TickRate { get; set; } = 0f;

    public float Lifespan { get; set; } = 0f;
    public List<string> ApplyEffects { get; set; } = new();
    public bool StopMoving { get; set; } = false;

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

public class TraitConfig
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string NextLevelId { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public bool IsNegative { get; set; } = false;

    // Core Stat Changes
    public Dictionary<string, float> StatBonuses { get; set; } = new();
    public Dictionary<string, float> StatMultipliers { get; set; } = new();

    // Engine-Level Hooks (Supports negative floats naturally!)
    public Dictionary<string, float> EngineMechanics { get; set; } = new();

    // Advanced Conditions
    public List<DynamicModifier> DynamicModifiers { get; set; } = new();
    public List<string> GrantedSkills { get; set; } = new();
}

public class MapConfig
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public float Width { get; set; } = 4000f;
    public float Height { get; set; } = 4000f;
    public string TextureKey { get; set; } = string.Empty;
    public float TextureScale { get; set; } = 1.0f;
    public int MaxPlayers { get; set; } = 4;
}


public class StatRollConfig
{
    public float Min { get; set; }
    public float Max { get; set; }
}

public class DifficultyConfig
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;

    public float EnemyBaseScaling { get; set; } = 0.01f;
    public float EnemyScalingPerPlayer { get; set; } = 1.0f;

    // Spawn Rates
    public float InitialSpawnDelay { get; set; } = 2.0f;
    public float DelayDecreasePerWave { get; set; } = 0.1f;
    public float MinimumSpawnDelay { get; set; } = 0.3f;
    public int MaxActiveEnemies { get; set; } = 100;

    // Economy
    public float GoldMultiplier { get; set; } = 1.0f;
    public float XpMultiplier { get; set; } = 1.0f;
    public int BaseRerollCost { get; set; } = 2;
    public float RerollCostIncreasePerWave { get; set; } = 0.5f;
    public int RerollInflation { get; set; } = 2;

    public float RecycleValueMultiplier { get; set; } = 1.0f;
}

// =================================================================================
// ACHIEVEMENTS (data-driven, loaded from Configs/Achievements.json like everything else)
// =================================================================================

public class AchievementConfig
{
    // --- Identity ---
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    // --- Visuals (same Tier scale/coloring as WeaponConfig/ItemConfig) ---
    public int Tier { get; set; } = 1;
    public string TextureKey { get; set; } = string.Empty;
    public int IconFrame { get; set; }

    // If true, Name/Description/icon are hidden from the catalog until unlocked.
    public bool Hidden { get; set; } = false;

    // "Lifetime"    -> evaluated against aggregated stats across ALL of the player's matches.
    // "SingleMatch" -> evaluated against a single match's own stats; does not persist/carry
    //                  over if the match ends without hitting the threshold.
    public string Scope { get; set; } = "Lifetime";

    // Drives which stat AchievementService checks. See AchievementService.ConditionType
    // handling for the supported list (e.g. "LifetimeStat", "SingleMatchStat",
    // "HighestWaveReached", "MaxStatByWave", "MaxStatReached", "CharacterWaveCleared",
    // "DifficultyWaveCleared"...).
    public string ConditionType { get; set; } = string.Empty;

    // Optional scoping value used by conditions like CharacterWaveCleared (a characterId),
    // DifficultyWaveCleared (a difficultyId), LimitedWeaponsWaveCleared (max weapon count),
    // or MaxStatByWave (the wave limit — paired with StatName below).
    public string ConditionStat { get; set; } = string.Empty;

    // Which stat to read for stat-based conditions:
    //   - "LifetimeStat" / "SingleMatchStat": one of "kills", "deaths", "damageDealt",
    //     "damageTaken", "healingDone", "shieldingDone" (fixed MatchRecord columns).
    //   - "MaxStatByWave" / "MaxStatReached": ANY key from ConfigManager.AllStats
    //     (e.g. "maxHp", "critChance", "luck") — reads from the player's PeakStats map,
    //     so any stat that exists in your stat config works without server changes.
    public string StatName { get; set; } = string.Empty;

    public float Threshold { get; set; }
}