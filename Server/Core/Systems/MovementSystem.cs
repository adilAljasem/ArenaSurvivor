using Server.Configs;
using Server.Entities;
using System;

namespace Server.Core.Systems;

public static class MovementSystem
{
    public static void Process(float dt, GameState state, ConfigManager configs)
    {
        float mapW = 4000f;
        float mapH = 4000f;
        if (configs.Maps != null && configs.Maps.TryGetValue("map_forest", out var currentMap))
        {
            mapW = currentMap.Width;
            mapH = currentMap.Height;
        }

        // 1. PLAYER PHYSICS (Players always move!)
        foreach (var player in state.Players.Values)
        {
            if (player.InputX != 0 || player.InputY != 0)
            {
                float finalSpeed = Math.Max(0f, player.GetTotalStat("speed", configs));
                player.X += player.InputX * finalSpeed * dt;
                player.Y += player.InputY * finalSpeed * dt;
            }

            player.X = Math.Clamp(player.X, 35, mapW - 35);
            player.Y = Math.Clamp(player.Y, 35, mapH - 35);

            float regen = player.GetTotalStat("hpRegen", configs);
            if (regen > 0 && player.CurrentHp < player.GetTotalStat("maxHp", configs))
                player.CurrentHp = Math.Min(player.GetTotalStat("maxHp", configs), player.CurrentHp + (regen * dt));
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

            // >>> THE FIX: Look at the Timer, not the State string! <<<
            bool canMoveEnemy = true;
            if (!string.IsNullOrEmpty(enemy.CurrentCastingSkillId) && enemy.CurrentCastTimer > 0)
            {
                if (configs.Skills.TryGetValue(enemy.CurrentCastingSkillId, out var eCastCfg) && eCastCfg.StopMoving)
                {
                    canMoveEnemy = false;
                }
            }
            if (!canMoveEnemy) continue; // Skip movement completely if rooted by a spell!

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
                if (distSq < closestDistSq) { closestDistSq = distSq; target = player; }
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

            if (enemy.X >= 0 && enemy.X <= mapW && enemy.Y >= 0 && enemy.Y <= mapH)
            {
                enemy.X = Math.Clamp(enemy.X, 0, mapW);
                enemy.Y = Math.Clamp(enemy.Y, 0, mapH);
            }
        }
    }
}