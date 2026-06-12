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
                float finalSpeed = Math.Max(0f, player.GetTotalStat("movementSpeed", configs));
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

            // ==========================================================
            // >>> NEW: RANDOM WANDER LOGIC (WITH MAP ENTRY) <<<
            // ==========================================================
            if (config.MovesRandomly)
            {
                // 1. Are they outside or on the very edge of the map? (Spawn check)
                bool isOutsideMap = enemy.X < 100 || enemy.X > mapW - 100 || enemy.Y < 100 || enemy.Y > mapH - 100;

                if (isOutsideMap)
                {
                    // Force them to walk directly towards the center of the map!
                    enemy.WanderTargetX = mapW / 2;
                    enemy.WanderTargetY = mapH / 2;
                    enemy.WanderTimer = 2.0f; // Keep the timer paused while they enter
                }
                else
                {
                    enemy.WanderTimer -= dt;

                    // Pick a new spot if timer is up, or if we haven't picked one yet
                    if (enemy.WanderTimer <= 0 || enemy.WanderTargetX < 0)
                    {
                        // Pick a random spot within ~500 pixels, strictly inside the map bounds
                        enemy.WanderTargetX = Math.Clamp(enemy.X + Random.Shared.Next(-500, 500), 100, mapW - 100);
                        enemy.WanderTargetY = Math.Clamp(enemy.Y + Random.Shared.Next(-500, 500), 100, mapH - 100);

                        // Wander for 2 to 5 seconds before picking a new spot
                        enemy.WanderTimer = (float)(Random.Shared.NextDouble() * 3.0 + 2.0);
                    }
                }

                float dx = enemy.WanderTargetX - enemy.X;
                float dy = enemy.WanderTargetY - enemy.Y;
                float length = (float)Math.Sqrt(dx * dx + dy * dy);

                if (length > 10f) // Keep moving until close to the target spot
                {
                    enemy.ActionState = "Moving";
                    float finalSpeed = Math.Max(0f, enemy.GetTotalStat("movementSpeed", configs));
                    enemy.X += (dx / length) * finalSpeed * dt;
                    enemy.Y += (dy / length) * finalSpeed * dt;

                    // Look where they are walking so the sprite flips correctly!
                    enemy.AimX = enemy.WanderTargetX;
                    enemy.AimY = enemy.WanderTargetY;
                }
                else
                {
                    enemy.ActionState = "Idle";
                }

                enemy.X = Math.Clamp(enemy.X, 0, mapW);
                enemy.Y = Math.Clamp(enemy.Y, 0, mapH);

                // >>> CRITICAL: Skip the rest of the targeting logic so they don't chase players! <<<
                continue;
            }
            // ==========================================================

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
                            float finalSpeed = Math.Max(0f, enemy.GetTotalStat("movementSpeed", configs));
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