using Server.Configs;
using Server.Entities;
using System;
using System.Collections.Generic;

namespace Server.Core.Systems;

public static class ProjectileFactory
{
    public static List<ProjectileEntity> Create(
        ProjectileConfig projConfig,
        string ownerId,
        string team,
        float startX, float startY,
        float dirX, float dirY,
        float physicalDamage,
        float magicDamage,
        float finalSpeed, // Passed in so Player Stats can speed up bullets!
        float lifeStealChance,
        List<string> extraEffects,
        int count = 1,
        float lifespanOverride = 0f,
        bool isCritical = false,
        // >>> NEW: true when the projectile targets allied entities (heals / shields)
        bool isFriendly = false)
    {
        var results = new List<ProjectileEntity>();

        float length = (float)Math.Sqrt(dirX * dirX + dirY * dirY);
        if (length <= 0) return results;

        float baseAngle = (float)Math.Atan2(dirY, dirX);
        float angleStep = count > 1 ? (float)(Math.PI * 2 / count) : 0f;

        float lifespan = lifespanOverride > 0 ? lifespanOverride :
                         (projConfig.Lifespan > 0 ? projConfig.Lifespan : 5f);

        var combinedEffects = new List<string>();
        if (projConfig.ApplyEffectsOnHit != null) combinedEffects.AddRange(projConfig.ApplyEffectsOnHit);
        if (extraEffects != null) combinedEffects.AddRange(extraEffects);

        for (int i = 0; i < count; i++)
        {
            // If orbital, spread them in a perfect circle. Otherwise, shoot straight.
            float currentAngle = projConfig.MovementBehavior == "Orbital" ? angleStep * i : baseAngle;

            var bullet = new ProjectileEntity
            {
                ConfigId = projConfig.Id,
                OwnerId = ownerId,
                Team = team,
                X = startX,
                Y = startY,

                VelX = projConfig.MovementBehavior == "Orbital" ? 0 : (float)Math.Cos(currentAngle) * finalSpeed,
                VelY = projConfig.MovementBehavior == "Orbital" ? 0 : (float)Math.Sin(currentAngle) * finalSpeed,
                OrbitSpeed = projConfig.MovementBehavior == "Orbital" ? projConfig.OrbitSpeed : 0f,
                PhysicalDamage = physicalDamage,
                MagicDamage = magicDamage,
                LifeStealChance = lifeStealChance,
                HitRadius = projConfig.HitRadius,
                PierceCount = projConfig.PierceCount,
                Lifespan = lifespan,
                ApplyEffectsOnHit = combinedEffects,
                IsCritical = isCritical,

                MovementBehavior = projConfig.MovementBehavior,
                OrbitRadius = projConfig.OrbitRadius,
                OrbitAngleOffset = currentAngle,

                OnDeathSkillId = projConfig.OnDeathSkillId,
                TickRate = projConfig.TickRate,
                TickSkillId = projConfig.TickSkillId,

                // >>> NEW: Marks projectile to seek allies in ProcessCollisions
                IsFriendlyProjectile = isFriendly,
            };



            results.Add(bullet);
        }

        return results;
    }

    public static List<(float dirX, float dirY)> CalculateSpreadDirections(float baseDirX, float baseDirY, int count, float spreadAngleDegrees)
    {
        var directions = new List<(float dirX, float dirY)>();

        // Safety check: If only 1 projectile or no spread, just return the base direction
        if (count <= 1 || spreadAngleDegrees <= 0)
        {
            directions.Add((baseDirX, baseDirY));
            return directions;
        }

        // Convert base direction vector into an angle (in radians)
        float baseAngle = (float)Math.Atan2(baseDirY, baseDirX);
        float spreadRadians = spreadAngleDegrees * (float)(Math.PI / 180.0);

        // If it's a full 360 nova, divide evenly by the count.
        // If it's a cone (e.g. 45 degrees), divide by (count - 1) so the outer projectiles sit exactly on the edges.
        float angleStep = spreadAngleDegrees >= 360f ? (spreadRadians / count) : (spreadRadians / (count - 1));
        float startAngle = spreadAngleDegrees >= 360f ? baseAngle : baseAngle - (spreadRadians / 2f);

        for (int i = 0; i < count; i++)
        {
            float currentAngle = startAngle + (angleStep * i);

            // Convert the new angle back into X/Y direction vectors
            float newDirX = (float)Math.Cos(currentAngle);
            float newDirY = (float)Math.Sin(currentAngle);

            directions.Add((newDirX, newDirY));
        }

        return directions;
    }
}