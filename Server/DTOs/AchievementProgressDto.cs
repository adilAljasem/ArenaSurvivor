// namespace Server.DTOs;

// public class AchievementProgressDto
// {
//     public string Id { get; set; } = string.Empty;
//     public string Name { get; set; } = string.Empty;
//     public string Description { get; set; } = string.Empty;
//     public int Tier { get; set; }
//     public string TextureKey { get; set; } = string.Empty;
//     public int IconFrame { get; set; }

//     public bool IsUnlocked { get; set; }

//     // True when this is a Hidden achievement the player hasn't earned yet — Name/Description
//     // are intentionally left blank in that case so the catalog doesn't spoil it.
//     public bool IsHidden { get; set; }

//     public DateTime? UnlockedAt { get; set; }

//     // Current progress vs Threshold. For "SingleMatch" scope this is the player's best-ever
//     // single-match attempt at that condition, not a running lifetime total.
//     public float Progress { get; set; }
//     public float Threshold { get; set; }
// }