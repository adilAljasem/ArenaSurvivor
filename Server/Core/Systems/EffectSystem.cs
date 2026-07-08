using Server.Configs;
using Server.Entities;
using System;
using System.Linq;

namespace Server.Core.Systems;

public class EffectSystem : IGameSystem
{
    private EventBus _eventBus = null!;
    private ConfigManager _configs = null!;

    public void Initialize(EventBus eventBus, ConfigManager configs)
    {
        _eventBus = eventBus;
        _configs = configs;
        _eventBus.Subscribe<ApplyEffectEvent>(OnApplyEffect);
    }

    public void Update(float dt, GameState state)
    {
        foreach (var player in state.Players.Values) ProcessEffectsForEntity(dt, player, state);
        foreach (var enemy in state.Enemies.Values) ProcessEffectsForEntity(dt, enemy, state);
    }

    private void OnApplyEffect(ApplyEffectEvent ev, GameState state)
    {
        // NEW: resolve Target/Caster by ID at execution time instead of holding direct
        // references on the event. If the target vanished between publish and processing
        // (e.g. it died and got cleaned up earlier in the same queue flush), this just no-ops.
        var target = EntityResolver.ResolveActor(state, ev.TargetId);
        if (target == null) return;

        if (_configs.Effects.TryGetValue(ev.EffectConfigId, out var effectConfig))
        {
            var casterEntity = !string.IsNullOrEmpty(ev.CasterId) ? EntityResolver.ResolveActor(state, ev.CasterId) : null;
            string casterId = ev.CasterId ?? string.Empty;

            float shieldToGrant = effectConfig.GrantedShield;
            if (shieldToGrant > 0 && casterEntity != null)
            {
                float shieldPower = casterEntity.GetTotalStat("shieldPower", _configs);
                shieldToGrant = Math.Max(0f, shieldToGrant * (1f + shieldPower / 100f)); // same "100 = 1 unit" convention as healPower
            }

            // Matching on ConfigId + SourceId (caster) instead of just ConfigId: player A and
            // player B applying the same debuff to the same target get two separate instances,
            // each with its own timer and stack count, instead of overwriting each other.
            var existing = target.ActiveEffects.FirstOrDefault(e => e.ConfigId == ev.EffectConfigId && e.SourceId == casterId);
            int maxStack = Math.Max(1, effectConfig.MaxStack);

            if (existing != null)
            {
                existing.TimeRemaining = effectConfig.Duration;
                existing.StackCount = Math.Min(maxStack, existing.StackCount + ev.StackAmount);

                if (shieldToGrant > 0)
                {
                    float newShield = shieldToGrant * existing.StackCount;
                    target.CurrentShield -= existing.GrantedShieldAmount;
                    existing.GrantedShieldAmount = newShield;
                    target.CurrentShield += newShield;
                }
            }
            else
            {
                int startingStacks = Math.Min(maxStack, ev.StackAmount);
                float initialShield = shieldToGrant * startingStacks;

                target.ActiveEffects.Add(new ActiveEffect
                {
                    ConfigId = ev.EffectConfigId,
                    TimeRemaining = effectConfig.Duration,
                    GrantedShieldAmount = initialShield,
                    StackCount = startingStacks,
                    SourceId = casterId,
                    // ActiveEffect.Caster is a persistent per-entity component (long-lived state,
                    // not an event), so holding a resolved reference here is fine - it's the same
                    // kind of reference HealthSystem already reads back via effect.Caster.
                    Caster = casterEntity
                });
                target.CurrentShield += initialShield;
            }

            // A stack change can shift a buff's magnitude — force StatSystem to pick it up.
            target.StatsNeedRecalculation = true;
        }
    }

    private void ProcessEffectsForEntity(float dt, BaseActorEntity entity, GameState state)
    {
        if (entity.ActionState == "Dead")
        {
            if (entity.ActiveEffects.Count > 0)
            {
                entity.ActiveEffects.Clear();
                entity.StatsNeedRecalculation = true;
            }
            return;
        }

        for (int i = entity.ActiveEffects.Count - 1; i >= 0; i--)
        {
            var effect = entity.ActiveEffects[i];
            if (!_configs.Effects.TryGetValue(effect.ConfigId, out var config)) continue;

            effect.TimeRemaining -= dt;
            effect.TimeSinceLastTick += dt;

            if (config.TickRate > 0 && effect.TimeSinceLastTick >= config.TickRate)
            {
                effect.TimeSinceLastTick -= config.TickRate;

                // AttackerId = SourceId links the tick back to the original applier, so
                // HealthSystem.GetHealerHealPower looks up their healPower for tick heals.
                _eventBus.Publish(new DamageAppliedEvent
                {
                    TargetId = EntityResolver.GetId(entity),
                    AttackerId = effect.SourceId,
                    Amount = config.TickDamage * effect.StackCount,
                    IsCritical = false,
                    IsBlock = false,
                    IsDodge = false
                });

                if (!string.IsNullOrEmpty(config.TickSkillId) && _configs.Skills.TryGetValue(config.TickSkillId, out var tickSkill))
                {
                    _eventBus.Publish(new RequestSkillCastEvent
                    {
                        Skill = tickSkill,
                        CasterId = EntityResolver.GetId(entity),
                        StartX = entity.X,
                        StartY = entity.Y,
                        Team = entity.Team
                    });
                }
            }

            if (effect.TimeRemaining <= 0)
            {
                if (effect.GrantedShieldAmount > 0)
                    entity.CurrentShield = Math.Max(0, entity.CurrentShield - effect.GrantedShieldAmount);

                entity.ActiveEffects.RemoveAt(i);
                entity.StatsNeedRecalculation = true;
            }
        }
    }
}