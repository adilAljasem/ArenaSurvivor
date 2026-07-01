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
            float shieldToGrant = effectConfig.GrantedShield;
            if (shieldToGrant > 0 && ev.Caster != null)
            {
                // >>> FIX 4: Use GetTotalStat instead of CachedStats to guarantee all 
                // gear, traits, and base stats are correctly included in the calculation!
                float shieldPower = Math.Max(0f, ev.Caster.GetTotalStat("shieldPower", _configs));
                shieldToGrant *= (1f + shieldPower);
            }

            // >>> NEW: Build the caster ID so tick heals can look up the applier's healPower later.
            string casterId = string.Empty;
            if (ev.Caster != null)
                casterId = ev.Caster is PlayerEntity cp ? cp.ConnectionId : ((EnemyEntity)ev.Caster).Id;

            var existing = ev.Target.ActiveEffects.FirstOrDefault(e => e.ConfigId == ev.EffectConfigId);
            if (existing != null)
            {
                existing.TimeRemaining = effectConfig.Duration;
                if (shieldToGrant > 0)
                {
                    ev.Target.CurrentShield -= existing.GrantedShieldAmount;
                    existing.GrantedShieldAmount = shieldToGrant;
                    ev.Target.CurrentShield += shieldToGrant;
                }
                // SourceId stays as original applier
            }
            else
            {
                ev.Target.ActiveEffects.Add(new ActiveEffect
                {
                    ConfigId = ev.EffectConfigId,
                    TimeRemaining = effectConfig.Duration,
                    GrantedShieldAmount = shieldToGrant,
                    // >>> Who applied this effect — HealthSystem uses it to scale tick heals
                    // by the original applier's healPower (e.g. a doctor's HoT scales with their stat)
                    SourceId = casterId,

                    // >>> ADD THIS EXACT LINE RIGHT HERE <<<
                    Caster = ev.Caster
                });
                ev.Target.CurrentShield += shieldToGrant;
            }
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
                    Amount = config.TickDamage,
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