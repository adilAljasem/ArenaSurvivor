using System.Text.Json.Serialization;
namespace Server.Configs;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum SkillTriggerType { Auto, Input }

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum SkillTargetType { Self, ClosestEnemy, AimDirection, Sweep, Down, ClosestAlly , Ground }
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum SkillActionType { Projectile, AoE, SelfBuff, Summon, Beam , Dash , Teleport, Vacuum }

