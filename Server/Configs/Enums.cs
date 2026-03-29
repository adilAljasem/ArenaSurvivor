using System.Text.Json.Serialization;
namespace Server.Configs;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum SkillTriggerType { Auto, Input }

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum SkillTargetType { Self, ClosestEnemy, ClosestPlayer, AimDirection }

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum SkillActionType { Projectile, AoE, SelfBuff , Summon }

