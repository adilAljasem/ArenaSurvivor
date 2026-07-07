using Server.Configs;
using Server.Entities;

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

    private void OnApplyEffect(ApplyEffectEvent ev)
    {
        if (_configs.Effects.TryGetValue(ev.EffectConfigId, out var effectConfig))
        {
            string casterId = string.Empty;
            if (ev.Caster != null)
                casterId = ev.Caster is PlayerEntity cp ? cp.ConnectionId : ((EnemyEntity)ev.Caster).Id;

            float shieldToGrant = effectConfig.GrantedShield;
            if (shieldToGrant > 0 && ev.Caster != null)
            {
                float shieldPower = Math.Max(0f, ev.Caster.GetTotalStat("shieldPower", _configs));
                shieldToGrant *= (1f + shieldPower);
            }

            // Matching on ConfigId + SourceId (caster) instead of just ConfigId: player A and
            // player B applying the same debuff to the same target get two separate instances,
            // each with its own timer and stack count, instead of overwriting each other.
            var existing = ev.Target.ActiveEffects.FirstOrDefault(e => e.ConfigId == ev.EffectConfigId && e.SourceId == casterId);
            int maxStack = Math.Max(1, effectConfig.MaxStack);

            if (existing != null)
            {
                existing.TimeRemaining = effectConfig.Duration;
                existing.StackCount = Math.Min(maxStack, existing.StackCount + ev.StackAmount);

                if (shieldToGrant > 0)
                {
                    float newShield = shieldToGrant * existing.StackCount;
                    ev.Target.CurrentShield -= existing.GrantedShieldAmount;
                    existing.GrantedShieldAmount = newShield;
                    ev.Target.CurrentShield += newShield;
                }
            }
            else
            {
                int startingStacks = Math.Min(maxStack, ev.StackAmount);
                float initialShield = shieldToGrant * startingStacks;

                ev.Target.ActiveEffects.Add(new ActiveEffect
                {
                    ConfigId = ev.EffectConfigId,
                    TimeRemaining = effectConfig.Duration,
                    GrantedShieldAmount = initialShield,
                    StackCount = startingStacks,
                    SourceId = casterId,
                    Caster = ev.Caster
                });
                ev.Target.CurrentShield += initialShield;
            }

            // A stack change can shift a buff's magnitude — force StatSystem to pick it up.
            ev.Target.StatsNeedRecalculation = true;
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

                // >>> NEW: AttackerId = SourceId links the tick back to the original applier,
                // so HealthSystem.GetHealerHealPower looks up their healPower for tick heals (TickDamage < 0).
                _eventBus.Publish(new DamageAppliedEvent
                {
                    Target = entity,
                    AttackerId = effect.SourceId,
                    State = state,
                    Amount = config.TickDamage * effect.StackCount,
                    IsCritical = false,
                    IsBlock = false,
                    IsDodge = false
                });

                if (!string.IsNullOrEmpty(config.TickSkillId) && _configs.Skills.TryGetValue(config.TickSkillId, out var tickSkill))
                {
                    string skillCasterId = entity is PlayerEntity p ? p.ConnectionId : ((EnemyEntity)entity).Id;
                    _eventBus.Publish(new RequestSkillCastEvent
                    {
                        Skill = tickSkill,
                        CasterId = skillCasterId,
                        StartX = entity.X,
                        StartY = entity.Y,
                        Team = entity.Team,
                        State = state
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