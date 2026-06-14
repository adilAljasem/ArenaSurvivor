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
            var existing = ev.Target.ActiveEffects.FirstOrDefault(e => e.ConfigId == ev.EffectConfigId);
            if (existing != null) existing.TimeRemaining = effectConfig.Duration;
            else ev.Target.ActiveEffects.Add(new ActiveEffect { ConfigId = ev.EffectConfigId, TimeRemaining = effectConfig.Duration });
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

                _eventBus.Publish(new DamageAppliedEvent
                {
                    Target = entity,
                    State = state,
                    Amount = config.TickDamage,
                    IsCritical = false,
                    IsBlock = false,
                    IsDodge = false
                });

                if (!string.IsNullOrEmpty(config.TickSkillId) && _configs.Skills.TryGetValue(config.TickSkillId, out var tickSkill))
                {
                    string casterId = entity is PlayerEntity p ? p.ConnectionId : ((EnemyEntity)entity).Id;

                    // >>> THE FIX: Publish to the EventBus instead of calling SkillSystem directly! <<<
                    _eventBus.Publish(new RequestSkillCastEvent
                    {
                        Skill = tickSkill,
                        CasterId = casterId,
                        StartX = entity.X,
                        StartY = entity.Y,
                        Team = entity.Team,
                        State = state
                    });
                }
            }

            if (effect.TimeRemaining <= 0)
            {
                entity.ActiveEffects.RemoveAt(i);
                entity.StatsNeedRecalculation = true; // <<< THE FIX
            }
        }
    }
}