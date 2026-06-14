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
        bool isCritical = false)
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
            // (In the future, you can easily add "Shotgun Spread" math right here!)
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
            };


            results.Add(bullet);
        }

        return results;
    }
}