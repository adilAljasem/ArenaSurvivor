using Server.Configs;
using Server.Entities;
using System;

namespace Server.Core.Systems;

public class LootSystem : IGameSystem
{
    private EventBus _eventBus = null!;
    private ConfigManager _configs = null!;

    public void Initialize(EventBus eventBus, ConfigManager configs)
    {
        _eventBus = eventBus;
        _configs = configs;
        _eventBus.Subscribe<EntityDeathEvent>(OnEntityDeath);
    }

    public void Update(float dt, GameState state) { } // Event-driven only

    private void OnEntityDeath(EntityDeathEvent ev)
    {
        if (ev.IsPlayer) return;

        int bonusGold = 0;
        if (!string.IsNullOrEmpty(ev.KillerId) && ev.State.Players.TryGetValue(ev.KillerId, out var killer))
        {
            float harvesting = killer.GetTotalStat("harvesting", _configs);
            bonusGold = (int)Math.Floor(harvesting / 100f);
            if (Random.Shared.NextDouble() < (harvesting % 100f) / 100f) bonusGold++;
        }

        var gold = new PickupEntity { X = ev.X, Y = ev.Y, Value = 1 + bonusGold };
        ev.State.Pickups.TryAdd(gold.Id, gold);

        if (ev.State.Enemies.TryGetValue(ev.EntityId, out var enemy) && _configs.Enemies.TryGetValue(ev.ConfigId, out var eCfg))
        {
            SpawnGearDrops(enemy, eCfg, ev.State);

            // >>> THE FIX: Publish to EventBus instead of calling SkillSystem directly! <<<
            _eventBus.Publish(new TriggerDeathSkillsEvent
            {
                EntityId = ev.EntityId,
                X = ev.X,
                Y = ev.Y,
                Team = ev.Team,
                Skills = eCfg.OnDeathSkills,
                State = ev.State
            });
        }
    }

    private void SpawnGearDrops(EnemyEntity enemy, EnemyConfig config, GameState state)
    {
        float scatterRadius = 20f;
        foreach (var weapon in enemy.Weapons)
        {
            if (config.WeaponDropChance <= 0f || !_configs.Weapons.TryGetValue(weapon.ConfigId, out var wCfg) || !wCfg.CanDrop) continue;
            if (Random.Shared.NextDouble() >= config.WeaponDropChance) continue;
            float ox = (float)(Random.Shared.NextDouble() * scatterRadius * 2 - scatterRadius);
            float oy = (float)(Random.Shared.NextDouble() * scatterRadius * 2 - scatterRadius);
            var drop = new PickupEntity { X = enemy.X + ox, Y = enemy.Y + oy, Type = PickupType.Weapon, DroppedWeapon = weapon };
            state.Pickups.TryAdd(drop.Id, drop);
        }

        foreach (var item in enemy.OwnedItems)
        {
            if (config.ItemDropChance <= 0f || !_configs.Items.TryGetValue(item.ConfigId, out var iCfg) || !iCfg.CanDrop) continue;
            if (Random.Shared.NextDouble() >= config.ItemDropChance) continue;
            float ox = (float)(Random.Shared.NextDouble() * scatterRadius * 2 - scatterRadius);
            float oy = (float)(Random.Shared.NextDouble() * scatterRadius * 2 - scatterRadius);
            var drop = new PickupEntity { X = enemy.X + ox, Y = enemy.Y + oy, Type = PickupType.Item, DroppedItem = item };
            state.Pickups.TryAdd(drop.Id, drop);
        }
    }
}