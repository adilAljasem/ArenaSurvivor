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
            bool canMovePlayer = true;
            if (!string.IsNullOrEmpty(player.CurrentCastingSkillId) && player.CurrentCastTimer > 0)
            {
                if (configs.Skills.TryGetValue(player.CurrentCastingSkillId, out var pCastCfg) && pCastCfg.StopMoving)
                    canMovePlayer = false;
            }

            // >>> THE FIX: Added parentheses around the Input checks! <<<
            if (canMovePlayer && (player.InputX != 0 || player.InputY != 0))
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

            bool canMoveEnemy = true;
            if (!string.IsNullOrEmpty(enemy.CurrentCastingSkillId) && enemy.CurrentCastTimer > 0)
            {
                if (configs.Skills.TryGetValue(enemy.CurrentCastingSkillId, out var eCastCfg) && eCastCfg.StopMoving)
                    canMoveEnemy = false;
            }
            if (!canMoveEnemy) continue;

            // Reduce attack cooldown natively
            if (enemy.AttackCooldown > 0) enemy.AttackCooldown -= dt;

            // Find Target Logic
            float closestDistSq = float.MaxValue;
            float targetX = 0;
            float targetY = 0;
            bool foundTarget = false;

            // 1. Check for closest Player (Hostiles attack players, Friendly summons follow/protect players)
            foreach (var player in state.Players.Values)
            {
                float distSq = (player.X - enemy.X) * (player.X - enemy.X) + (player.Y - enemy.Y) * (player.Y - enemy.Y);
                if (distSq < closestDistSq) { closestDistSq = distSq; targetX = player.X; targetY = player.Y; foundTarget = true; }
            }

            // 2. Check for opposite Team Enemies
            foreach (var otherEnemy in state.Enemies.Values)
            {
                if (otherEnemy.ActionState == "Dead" || otherEnemy.Id == enemy.Id) continue;
                if (otherEnemy.Team != enemy.Team) // Only target opposite teams
                {
                    float distSq = (otherEnemy.X - enemy.X) * (otherEnemy.X - enemy.X) + (otherEnemy.Y - enemy.Y) * (otherEnemy.Y - enemy.Y);
                    if (distSq < closestDistSq) { closestDistSq = distSq; targetX = otherEnemy.X; targetY = otherEnemy.Y; foundTarget = true; }
                }
            }

            if (foundTarget)
            {
                enemy.AimX = targetX;
                enemy.AimY = targetY;

                float attackRadiusSq = config.AttackRadius * config.AttackRadius;
                if (closestDistSq <= attackRadiusSq)
                {
                    if (enemy.AttackCooldown <= 0)
                    {
                        enemy.ActionState = "Attacking";
                        enemy.AttackCooldown = config.AttackDuration;
                    }
                    else if (enemy.ActionState != "Attacking")
                    {
                        enemy.ActionState = "Idle";
                    }
                }
                else
                {
                    if (enemy.AttackCooldown <= 0)
                    {
                        enemy.ActionState = "Moving";
                        float dx = targetX - enemy.X;
                        float dy = targetY - enemy.Y;
                        float length = (float)Math.Sqrt((dx * dx) + (dy * dy));

                        // >>> THE FIX: PREVENT DIVIDE BY ZERO / NaN <<<
                        if (length > 0)
                        {
                            float finalSpeed = Math.Max(0f, enemy.GetTotalStat("speed", configs));
                            enemy.X += (dx / length) * finalSpeed * dt;
                            enemy.Y += (dy / length) * finalSpeed * dt;
                        }
                    }
                }
            }
            else
            {
                enemy.ActionState = "Idle";
            }

            enemy.X = Math.Clamp(enemy.X, 0, mapW);
            enemy.Y = Math.Clamp(enemy.Y, 0, mapH);
        }
    }
}