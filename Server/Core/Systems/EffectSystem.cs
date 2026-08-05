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

            // Match purely on ConfigId so that multiple actors applying the same effect 
            // share a single instance/stack limit instead of spamming separate effects.
            var existing = target.ActiveEffects.FirstOrDefault(e => e.ConfigId == ev.EffectConfigId);
            int maxStack = Math.Max(1, effectConfig.MaxStack);

            if (existing != null)
            {
                existing.TimeRemaining = effectConfig.Duration;
                existing.StackCount = Math.Min(maxStack, existing.StackCount + ev.StackAmount);

                // Overwrite the source/caster so the most recent attacker gets tick-damage credit
                existing.SourceId = casterId;
                existing.Caster = casterEntity;

                if (shieldToGrant > 0)
                {
                    float newShield = shieldToGrant * existing.StackCount;
                    target.ModifyShield(-existing.GrantedShieldAmount);
                    existing.GrantedShieldAmount = newShield;
                    target.ModifyShield(newShield);
                }

            }
            else
            {
                int startingStacks = Math.Min(maxStack, ev.StackAmount);
                float initialShield = shieldToGrant * startingStacks;

                // >>> NEW: Apply Team Switch if configured <<<
                bool isTeamSwitcher = false;
                if (!string.IsNullOrEmpty(effectConfig.OverrideTeam))
                {
                    target.SetTeam(effectConfig.OverrideTeam);
                    isTeamSwitcher = true;
                }

                target.ActiveEffects.Add(new ActiveEffect
                {
                    ConfigId = ev.EffectConfigId,
                    TimeRemaining = effectConfig.Duration,
                    GrantedShieldAmount = initialShield,
                    StackCount = startingStacks,
                    SourceId = casterId,
                    Caster = casterEntity,
                    IsTeamSwitcher = isTeamSwitcher // <<< ADDED FLAG
                });
                target.ModifyShield(initialShield);

                // >>> NEW: Grant temporary gear from the effect!
                bool gearAdded = false;

                if (effectConfig.GrantedWeapons != null && effectConfig.GrantedWeapons.Count > 0)
                {
                    foreach (var wId in effectConfig.GrantedWeapons)
                    {
                        if (_configs.Weapons.ContainsKey(wId))
                        {
                            // Use appropriate generation based on entity type to match Entities.cs logic
                            var weapon = target is PlayerEntity p
                                ? WeaponGenerator.GenerateWeapon(wId, p, _configs, 1)
                                : WeaponGenerator.GenerateWeapon(wId, 0f, _configs, 1);

                            weapon.SourceEffectId = ev.EffectConfigId;
                            weapon.SlotIndex = target.Weapons.Count;
                            target.Weapons.Add(weapon);
                            gearAdded = true;
                        }
                    }
                }

                if (effectConfig.GrantedItems != null && effectConfig.GrantedItems.Count > 0)
                {
                    foreach (var iId in effectConfig.GrantedItems)
                    {
                        if (_configs.Items.ContainsKey(iId))
                        {
                            var item = target is PlayerEntity p
                                ? ItemGenerator.GenerateItem(iId, p, _configs, 1)
                                : ItemGenerator.GenerateItem(iId, 0f, _configs, 1);

                            item.SourceEffectId = ev.EffectConfigId;
                            item.SlotIndex = target.OwnedItems.Count;
                            target.OwnedItems.Add(item);
                            gearAdded = true;
                        }
                    }
                }

                if (effectConfig.GrantedSkills != null && effectConfig.GrantedSkills.Count > 0)
                {
                    foreach (var sId in effectConfig.GrantedSkills)
                    {
                        if (_configs.Skills.ContainsKey(sId))
                        {
                            target.Skills.Add(new ActiveSkill { ConfigId = sId, SourceEffectId = ev.EffectConfigId, CurrentCooldown = 0f });
                            gearAdded = true;
                        }
                    }
                }

                // If a player got this, merge duplicate items/weapons/skills immediately
                if (gearAdded && target is PlayerEntity playerTarget)
                {
                    playerTarget.RecalculateSynergies(_configs);
                }
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
                // Only broadcast a damage event if the effect actually deals damage!
                if (Math.Abs(config.TickDamage) > 0)
                {
                    _eventBus.Publish(new DamageAppliedEvent
                    {
                        TargetId = EntityResolver.GetId(entity),
                        AttackerId = effect.SourceId,
                        Amount = config.TickDamage * effect.StackCount,
                        IsCritical = false,
                        IsBlock = false,
                        IsDodge = false
                    });
                }

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
                {
                    entity.ModifyShield(-effect.GrantedShieldAmount);
                    entity.ClampShieldNonNegative();
                }

                // >>> NEW: Revert Team if this effect was a team switcher <<<
                if (effect.IsTeamSwitcher)
                {
                    entity.RevertTeam();
                }

                // >>> NEW: Strip Temporary Gear!
                bool gearRemoved = false;

                if (entity.Weapons.RemoveAll(w => w.SourceEffectId == effect.ConfigId) > 0)
                {
                    gearRemoved = true;
                    // Condense slot indices so we don't leave empty gaps
                    var sortedW = entity.Weapons.OrderBy(w => w.SlotIndex).ToList();
                    for (int j = 0; j < sortedW.Count; j++) sortedW[j].SlotIndex = j;
                }

                if (entity.OwnedItems.RemoveAll(item => item.SourceEffectId == effect.ConfigId) > 0)
                {
                    gearRemoved = true;
                    var sortedI = entity.OwnedItems.OrderBy(item => item.SlotIndex).ToList();
                    for (int j = 0; j < sortedI.Count; j++) sortedI[j].SlotIndex = j;
                }

                if (entity.Skills.RemoveAll(s => s.SourceEffectId == effect.ConfigId) > 0)
                {
                    gearRemoved = true;
                }

                if (gearRemoved && entity is PlayerEntity p)
                {
                    p.RecalculateSynergies(_configs);
                }

                entity.ActiveEffects.RemoveAt(i);
                entity.StatsNeedRecalculation = true;
            }
        }
    }
}