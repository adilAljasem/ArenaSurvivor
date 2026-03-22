using Server.Configs;
using Server.Entities;

namespace Server.Core.Systems;

public static class MovementSystem
{
    public static void Process(float dt, GameState state, ConfigManager configs)
    {
        // 1. PLAYER PHYSICS
        foreach (var player in state.Players.Values)
        {
            if (player.InputX != 0 || player.InputY != 0)
            {
                float finalSpeed = Math.Max(0f, player.GetTotalStat("speed", configs));
                player.X += player.InputX * finalSpeed * dt;
                player.Y += player.InputY * finalSpeed * dt;
            }

            float regen = player.GetTotalStat("hpRegen", configs);
            if (regen > 0 && player.CurrentHp < player.GetTotalStat("maxHp", configs))
            {
                player.CurrentHp = Math.Min(player.GetTotalStat("maxHp", configs), player.CurrentHp + (regen * dt));
            }
        }

        // 2. ENEMY AI & PHYSICS
        foreach (var enemy in state.Enemies.Values)
        {
            if (!configs.Enemies.TryGetValue(enemy.ConfigId, out var config)) continue;

            if (enemy.ActionState == "Dead")
            {
                enemy.DespawnTimer -= dt;
                if (enemy.DespawnTimer <= 0) state.Enemies.TryRemove(enemy.Id, out _);
                continue; 
            }

            if (enemy.ActionState == "Casting") continue;

            if (enemy.AttackCooldown > 0)
            {
                enemy.AttackCooldown -= dt;
                enemy.ActionState = "Attacking";
                continue;
            }

            PlayerEntity? target = null;
            float closestDistSq = float.MaxValue;
            foreach (var player in state.Players.Values)
            {
                float distSq = (player.X - enemy.X) * (player.X - enemy.X) + (player.Y - enemy.Y) * (player.Y - enemy.Y);
                if (distSq < closestDistSq)
                {
                    closestDistSq = distSq;
                    target = player;
                }
            }

            if (target != null)
            {
                if (closestDistSq < 2500) 
                {
                    enemy.ActionState = "Attacking";
                    enemy.AttackCooldown = config.AttackDuration;
                }
                else
                {
                    enemy.ActionState = "Moving";
                    float dx = target.X - enemy.X;
                    float dy = target.Y - enemy.Y;
                    float length = (float)Math.Sqrt((dx * dx) + (dy * dy));

                    float finalSpeed = Math.Max(0f, enemy.GetTotalStat("speed", configs));
                    enemy.X += (dx / length) * finalSpeed * dt;
                    enemy.Y += (dy / length) * finalSpeed * dt;
                }
            }
        }
    }
}