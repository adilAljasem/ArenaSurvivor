using Server.Configs;
using Server.Entities;
using System;

namespace Server.Core.Systems;

public class MovementSystem : IGameSystem
{
    private ConfigManager _configs = null!;

    public void Initialize(EventBus eventBus, ConfigManager configs)
    {
        _configs = configs;
    }

   public void Update(float dt, GameState state)
    {
        float mapW = 4000f, mapH = 4000f;
        if (_configs.Maps != null && _configs.Maps.TryGetValue("map_forest", out var currentMap))
        {
            mapW = currentMap.Width; mapH = currentMap.Height;
        }

        // 1. Keep Players sequential
        foreach (var player in state.Players.Values)
        {
            bool canMovePlayer = true;
            if (!string.IsNullOrEmpty(player.CurrentCastingSkillId) && player.CurrentCastTimer > 0)
            {
                if (_configs.Skills.TryGetValue(player.CurrentCastingSkillId, out var pCastCfg) && pCastCfg.StopMoving)
                    canMovePlayer = false;
            }

            if (canMovePlayer && (player.InputX != 0 || player.InputY != 0))
            {
                float finalSpeed = Math.Max(0f, player.GetTotalStat("movementSpeed", _configs));
                player.X += player.InputX * finalSpeed * dt;
                player.Y += player.InputY * finalSpeed * dt;
            }

            player.X = Math.Clamp(player.X, 35, mapW - 35);
            player.Y = Math.Clamp(player.Y, 35, mapH - 35);
        }

        // >>> THE MASSIVE FIX: Pre-filter targets ONCE so threads don't hit the ConcurrentDictionary
        var activePlayers = state.Players.Values.Where(p => p.ActionState != "Dead").ToList();
        var allActiveEnemies = state.Enemies.Values.Where(e => e.ActionState != "Dead").ToList();
        
        var nonEnemyTeam = allActiveEnemies.Where(e => e.Team != "Enemy").ToList(); // Summons/Pets
        var enemyTeam = allActiveEnemies.Where(e => e.Team == "Enemy").ToList(); // The horde

        var parallelOptions = new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount };

        // 2. Parallelize Enemy Movement using the pre-filtered lists
        System.Threading.Tasks.Parallel.ForEach(allActiveEnemies, parallelOptions, enemy =>
        {
            if (!_configs.Enemies.TryGetValue(enemy.ConfigId, out var config)) return;

            bool canMoveEnemy = true;
            if (!string.IsNullOrEmpty(enemy.CurrentCastingSkillId) && enemy.CurrentCastTimer > 0)
            {
                if (_configs.Skills.TryGetValue(enemy.CurrentCastingSkillId, out var eCastCfg) && eCastCfg.StopMoving)
                    canMoveEnemy = false;
            }
            if (!canMoveEnemy) return;

            if (enemy.AttackCooldown > 0) enemy.AttackCooldown -= dt;

            if (config.MovesRandomly)
            {
                // ... (Keep existing random movement logic) ...
                bool isOutsideMap = enemy.X < 100 || enemy.X > mapW - 100 || enemy.Y < 100 || enemy.Y > mapH - 100;
                if (isOutsideMap)
                {
                    enemy.WanderTargetX = mapW / 2; enemy.WanderTargetY = mapH / 2; enemy.WanderTimer = 2.0f;
                }
                else
                {
                    enemy.WanderTimer -= dt;
                    if (enemy.WanderTimer <= 0 || enemy.WanderTargetX < 0)
                    {
                        enemy.WanderTargetX = Math.Clamp(enemy.X + Random.Shared.Next(-500, 500), 100, mapW - 100);
                        enemy.WanderTargetY = Math.Clamp(enemy.Y + Random.Shared.Next(-500, 500), 100, mapH - 100);
                        enemy.WanderTimer = (float)(Random.Shared.NextDouble() * 3.0 + 2.0);
                    }
                }

                float randDx = enemy.WanderTargetX - enemy.X, randDy = enemy.WanderTargetY - enemy.Y;
                float randLength = (float)Math.Sqrt(randDx * randDx + randDy * randDy);

                if (randLength > 10f)
                {
                    enemy.ActionState = "Moving";
                    float finalSpeed = Math.Max(0f, enemy.GetTotalStat("movementSpeed", _configs));
                    enemy.X += (randDx / randLength) * finalSpeed * dt;
                    enemy.Y += (randDy / randLength) * finalSpeed * dt;
                    enemy.AimX = enemy.WanderTargetX; enemy.AimY = enemy.WanderTargetY;
                }
                else enemy.ActionState = "Idle";

                enemy.X = Math.Clamp(enemy.X, 0, mapW);
                enemy.Y = Math.Clamp(enemy.Y, 0, mapH);
                return;
            }

            float closestDistSq = float.MaxValue, targetX = 0, targetY = 0;
            bool foundTarget = false;

            // CHECK 1: The players (Usually 1 to 4 checks)
            var targetPlayers = enemy.Team == "Enemy" ? activePlayers : new List<PlayerEntity>();
            foreach (var player in targetPlayers)
            {
                float distSq = (player.X - enemy.X) * (player.X - enemy.X) + (player.Y - enemy.Y) * (player.Y - enemy.Y);
                if (distSq < closestDistSq) { closestDistSq = distSq; targetX = player.X; targetY = player.Y; foundTarget = true; }
            }

            // CHECK 2: The opposing team's summons/minions (Usually 0 to 10 checks)
            var opposingTeam = enemy.Team == "Enemy" ? nonEnemyTeam : enemyTeam;
            foreach (var otherEnemy in opposingTeam)
            {
                if (otherEnemy.Id == enemy.Id) continue;
                float distSq = (otherEnemy.X - enemy.X) * (otherEnemy.X - enemy.X) + (otherEnemy.Y - enemy.Y) * (otherEnemy.Y - enemy.Y);
                if (distSq < closestDistSq) { closestDistSq = distSq; targetX = otherEnemy.X; targetY = otherEnemy.Y; foundTarget = true; }
            }

            if (foundTarget)
            {
                enemy.AimX = targetX; enemy.AimY = targetY;
                float attackRadiusSq = config.AttackRadius * config.AttackRadius;
                if (closestDistSq <= attackRadiusSq)
                {
                    if (enemy.AttackCooldown <= 0) { enemy.ActionState = "Attacking"; enemy.AttackCooldown = config.AttackDuration; }
                    else if (enemy.ActionState != "Attacking") enemy.ActionState = "Idle";
                }
                else
                {
                    if (enemy.AttackCooldown <= 0)
                    {
                        enemy.ActionState = "Moving";
                        float dx = targetX - enemy.X, dy = targetY - enemy.Y;
                        float length = (float)Math.Sqrt((dx * dx) + (dy * dy));
                        if (length > 0)
                        {
                            float finalSpeed = Math.Max(0f, enemy.GetTotalStat("movementSpeed", _configs));
                            enemy.X += (dx / length) * finalSpeed * dt;
                            enemy.Y += (dy / length) * finalSpeed * dt;
                        }
                    }
                }
            }
            else enemy.ActionState = "Idle";

            enemy.X = Math.Clamp(enemy.X, 0, mapW);
            enemy.Y = Math.Clamp(enemy.Y, 0, mapH);
        });
        
        // Despawn dead enemies (Sequential cleanup avoids Concurrent dictionary locking)
        foreach (var deadEnemy in state.Enemies.Values.Where(e => e.ActionState == "Dead"))
        {
            deadEnemy.DespawnTimer -= dt;
            if (deadEnemy.DespawnTimer <= 0) state.Enemies.TryRemove(deadEnemy.Id, out _);
        }
    }
}