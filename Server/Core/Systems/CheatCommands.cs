using System;
using System.Linq;
using System.Threading.Tasks;
using System.Collections.Generic;
using Microsoft.AspNetCore.SignalR;
using Server.Configs;
using Server.Core;
using Server.Entities;

namespace Server.Commands;

// 1. The Interface
public interface ICheatCommand
{
    string Description { get; }
    Task ExecuteAsync(string[] args, GameRoom state, ConfigManager configs, string playerId, IClientProxy caller);
}

// 2. The Dispatcher (The Gatekeeper)
public static class CommandDispatcher
{
    private static readonly Dictionary<string, ICheatCommand> _commands = new(StringComparer.OrdinalIgnoreCase);

    static CommandDispatcher()
    {
        // Your existing commands
        _commands["setwave"] = new SetWaveCommand();
        _commands["skipphase"] = new SkipPhaseCommand();
        _commands["spawnenemy"] = new SpawnEnemyCommand();

        // The new commands
        _commands["heal"] = new HealCommand();
        _commands["givegold"] = new GiveGoldCommand();
        _commands["givexp"] = new GiveXpCommand();
        _commands["killall"] = new KillAllCommand();
        _commands["giveweapon"] = new GiveWeaponCommand();

        _commands["addtime"] = new AddTimeCommand();
        _commands["removetime"] = new RemoveTimeCommand();
        _commands["toggleshop"] = new ToggleShopCommand();
        _commands["givestat"] = new GiveStatCommand();

        _commands["debugstats"] = new DebugStatsCommand();
        _commands["timescale"] = new TimeScaleCommand();


        _commands["giveskill"] = new GiveSkillCommand();
        _commands["setstat"] = new SetStatCommand();
        _commands["titan"] = new TitanCommand();
        _commands["clearskills"] = new ClearSkillsCommand();


    }

    public static async Task ExecuteAsync(string input, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        var parts = input.TrimStart('/').Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return;

        var cmdName = parts[0];
        if (_commands.TryGetValue(cmdName, out var command))
        {
            try
            {
                await command.ExecuteAsync(parts.Skip(1).ToArray(), room, configs, playerId, caller);
            }
            catch (Exception ex)
            {
                await caller.SendAsync("ReceiveChatMessage", "System", $"Error: {ex.Message}");
            }
        }
        else
        {
            await caller.SendAsync("ReceiveChatMessage", "System", $"Unknown command: /{cmdName}");
        }
    }
}


public class DebugStatsCommand : ICheatCommand
{
    public string Description => "Prints stats of all nearby enemies.";
    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (!room.State.Players.TryGetValue(playerId, out var player)) return;

        var lines = new System.Text.StringBuilder();
        foreach (var enemy in room.State.Enemies.Values)
        {
            float dx = enemy.X - player.X, dy = enemy.Y - player.Y;
            if (dx * dx + dy * dy > 600 * 600) continue; // only nearby

            float maxHp = enemy.CachedStats.GetValueOrDefault("maxHp", -1f);
            lines.AppendLine($"[{enemy.ConfigId} #{enemy.Id}] " +
                             $"HP={enemy.CurrentHp}/{enemy.CurrentMaxHp} " +
                             $"CachedMaxHp={maxHp} " +
                             $"State={enemy.ActionState}");
        }

        string output = lines.Length > 0 ? lines.ToString() : "No nearby enemies.";
        await caller.SendAsync("ReceiveChatMessage", "System", output);
    }
}


// =====================================================================
// 3. YOUR SPECIFIC COMMAND CLASSES
// =====================================================================

public class SetWaveCommand : ICheatCommand
{
    public string Description => "Sets the current wave. Usage: /setwave <number>";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length == 0 || !int.TryParse(args[0], out int targetWave))
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /setwave <number>");
            return;
        }

        room.State.CurrentWave = targetWave;
        // End the current phase immediately so the new wave loads cleanly
        room.State.PhaseTimer = 0;


        await caller.SendAsync("ReceiveChatMessage", "System", $"Warped to Wave {targetWave}!");
    }
}

public class SkipPhaseCommand : ICheatCommand
{
    public string Description => "Skips the current phase timer instantly.";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        room.State.PhaseTimer = 0;
        await caller.SendAsync("ReceiveChatMessage", "System", "Phase skipped!");
    }
}

public class SpawnEnemyCommand : ICheatCommand
{
    public string Description => "Spawns enemies near you. Usage: /spawnenemy <configId> [count]";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length == 0)
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /spawnenemy <configId> [count]");
            return;
        }

        string enemyId = args[0];
        int count = args.Length > 1 && int.TryParse(args[1], out int c) ? c : 1;

        if (!configs.Enemies.TryGetValue(enemyId, out var eCfg))
        {
            await caller.SendAsync("ReceiveChatMessage", "System", $"Enemy ID '{enemyId}' not found in JSON!");
            return;
        }

        // Find the player who called the cheat so we can spawn the enemy near them
        if (room.State.Players.TryGetValue(playerId, out var player))
        {
            for (int i = 0; i < count; i++)
            {
                var newEnemy = new EnemyEntity();
                // Spawn in a slight random radius around the player
                float ox = (float)(Random.Shared.NextDouble() * 200 - 100);
                float oy = (float)(Random.Shared.NextDouble() * 200 - 100);

                newEnemy.Initialize(eCfg, player.X + ox, player.Y + oy, configs);
                newEnemy.CurrentHp = newEnemy.GetTotalStat("maxHp", configs);

                room.State.Enemies.TryAdd(newEnemy.Id, newEnemy);
            }
            await caller.SendAsync("ReceiveChatMessage", "System", $"Spawned {count}x {eCfg.Name}!");
        }
    }
}

public class HealCommand : ICheatCommand
{
    public string Description => "Heals you to full HP. Usage: /heal";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (room.State.Players.TryGetValue(playerId, out var player))
        {
            player.CurrentHp = player.GetTotalStat("maxHp", configs);
            await caller.SendAsync("ReceiveChatMessage", "System", "Healed to max HP!");
        }
    }
}

public class GiveGoldCommand : ICheatCommand
{
    public string Description => "Gives you gold. Usage: /givegold <amount>";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length == 0 || !int.TryParse(args[0], out int amount))
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /givegold <amount>");
            return;
        }

        if (room.State.Players.TryGetValue(playerId, out var player))
        {
            player.Gold += amount;
            await caller.SendAsync("ReceiveChatMessage", "System", $"Added {amount} gold!");
        }
    }
}

public class GiveXpCommand : ICheatCommand
{
    public string Description => "Gives you XP. Usage: /givexp <amount>";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length == 0 || !int.TryParse(args[0], out int amount))
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /givexp <amount>");
            return;
        }

        if (room.State.Players.TryGetValue(playerId, out var player))
        {
            if (!configs.Difficulties.TryGetValue(room.State.CurrentDifficulty, out var diff)) diff = new DifficultyConfig();
            player.GainXp(amount, configs, diff);
            await caller.SendAsync("ReceiveChatMessage", "System", $"Added {amount} XP!");
        }
    }
}

public class KillAllCommand : ICheatCommand
{
    public string Description => "Kills all enemies on screen. Usage: /killall";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        int count = 0;
        foreach (var enemy in room.State.Enemies.Values)
        {
            if (enemy.ActionState != "Dead" && enemy.Team == "Enemy")
            {
                enemy.CurrentHp = 0;
                enemy.SetActionState("Dead");
                count++;
            }
        }
        await caller.SendAsync("ReceiveChatMessage", "System", $"Nuked {count} enemies!");
    }
}

public class GiveWeaponCommand : ICheatCommand
{
    public string Description => "Forces a weapon into your inventory. Usage: /giveweapon <configId>";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length == 0)
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /giveweapon <configId>");
            return;
        }

        if (room.State.Players.TryGetValue(playerId, out var player))
        {
            string wId = args[0];
            if (configs.Weapons.TryGetValue(wId, out var wCfg))
            {
                // Generate a fresh Level 1 weapon
                var newWeapon = Server.Core.Systems.WeaponGenerator.GenerateWeapon(wId, player, configs, 1);

                // Use your existing inventory logic to add/merge it safely
                bool success = player.TryAddOrMergeWeapon(newWeapon, configs);

                if (success) await caller.SendAsync("ReceiveChatMessage", "System", $"Added weapon: {wCfg.Name}!");
                else await caller.SendAsync("ReceiveChatMessage", "System", "Inventory full or merge failed!");
            }
            else
            {
                await caller.SendAsync("ReceiveChatMessage", "System", $"Weapon ID '{wId}' not found!");
            }
        }
    }
}

public class AddTimeCommand : ICheatCommand
{
    public string Description => "Adds seconds to the current phase. Usage: /addtime <seconds>";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length == 0 || !float.TryParse(args[0], out float seconds))
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /addtime <seconds>");
            return;
        }

        room.State.PhaseTimer += seconds;
        await caller.SendAsync("ReceiveChatMessage", "System", $"Added {seconds} seconds! Timer is now {Math.Round(room.State.PhaseTimer, 1)}s.");
    }
}

public class RemoveTimeCommand : ICheatCommand
{
    public string Description => "Removes seconds from the current phase. Usage: /removetime <seconds>";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length == 0 || !float.TryParse(args[0], out float seconds))
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /removetime <seconds>");
            return;
        }

        // Clamp to 0 so we don't break the game logic with negative time
        room.State.PhaseTimer = Math.Max(0, room.State.PhaseTimer - seconds);
        await caller.SendAsync("ReceiveChatMessage", "System", $"Removed {seconds} seconds! Timer is now {Math.Round(room.State.PhaseTimer, 1)}s.");
    }
}

public class ToggleShopCommand : ICheatCommand
{
    public string Description => "Toggles the shop phase permanently on/off. Usage: /toggleshop";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        room.State.SkipShopPhase = !room.State.SkipShopPhase;

        string status = room.State.SkipShopPhase ? "DISABLED (Skipping directly to combat)" : "ENABLED (Normal 30s shop phase)";

        // Bonus: If they type it while already IN the shop, skip it immediately!
        if (room.State.SkipShopPhase && room.State.Phase == GamePhase.ShopPhase)
        {
            room.State.PhaseTimer = 0;
        }

        await caller.SendAsync("ReceiveChatMessage", "System", $"Shop Phase is now {status}!");
    }
}

public class GiveStatCommand : ICheatCommand
{
    public string Description => "Gives you a specific stat bonus. Usage: /givestat <statName> <amount>";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length < 2 || !float.TryParse(args[1], out float amount))
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /givestat <statName> <amount>");
            return;
        }

        string statName = args[0];

        // Ensure they typed a valid stat
        if (!configs.AllStats.Contains(statName))
        {
            await caller.SendAsync("ReceiveChatMessage", "System", $"Invalid stat '{statName}'.");
            return;
        }

        if (room.State.Players.TryGetValue(playerId, out var player))
        {
            // Add a permanent flat modifier (0 means flat addition, not multiplier)
            player.Stats.AddModifier(statName, amount, 0);
            player.StatsNeedRecalculation = true;

            // If they are boosting maxHp, give them the health instantly so they don't stay at low HP
            if (statName == "maxHp")
            {
                player.CurrentHp += amount;
            }

            await caller.SendAsync("ReceiveChatMessage", "System", $"Added {amount} to {statName}!");
        }
    }
}


public class TimeScaleCommand : ICheatCommand
{
    public string Description => "Speeds up or slows down match time. Usage: /timescale <multiplier>";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length == 0 || !float.TryParse(args[0], out float scale) || scale <= 0f)
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /timescale <multiplier> (e.g. 2 = 2x speed, 0.5 = half speed, 1 = normal)");
            return;
        }

        scale = Math.Clamp(scale, 0.1f, 10f);
        room.State.TimeScale = scale;
        await caller.SendAsync("ReceiveChatMessage", "System", $"Time scale set to {scale}x!");
    }
}

public class GiveSkillCommand : ICheatCommand
{
    public string Description => "Forces a skill onto you. Usage: /giveskill <skillId>";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length == 0)
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /giveskill <skillId>");
            return;
        }

        string skillId = args[0];

        if (!configs.Skills.TryGetValue(skillId, out var skillCfg))
        {
            await caller.SendAsync("ReceiveChatMessage", "System", $"Skill ID '{skillId}' not found in JSON!");
            return;
        }

        if (room.State.Players.TryGetValue(playerId, out var player))
        {
            // Just like TryAddOrMergeWeapon/Item, we add a raw entry and let RecalculateSynergies
            // handle dedup + upgrading (adding the same id twice will bump it to its NextLevelId,
            // same as owning two copies of a weapon/item that grants it).
            player.Skills.Add(new ActiveSkill { ConfigId = skillId, IsCasting = false, CurrentCooldown = 0f });
            player.RecalculateSynergies(configs);

            await caller.SendAsync("ReceiveChatMessage", "System", $"Granted skill: {skillCfg.Name}!");
        }
    }
}

public class SetStatCommand : ICheatCommand
{
    public string Description => "Sets a stat to an exact value (supports negatives). Usage: /setstat <statName> <value>";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length < 2 || !float.TryParse(args[1], out float targetValue))
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /setstat <statName> <value> (e.g. /setstat armor -100)");
            return;
        }

        string statName = args[0];

        if (!configs.AllStats.Contains(statName))
        {
            await caller.SendAsync("ReceiveChatMessage", "System", $"Invalid stat '{statName}'.");
            return;
        }

        if (!room.State.Players.TryGetValue(playerId, out var player)) return;

        // Force a fresh recalculation so GetTotalStat below isn't a stale cached value from
        // a previous tick (e.g. right after a weapon swap that hasn't been reprocessed yet).
        player.StatsNeedRecalculation = true;

        // NOTE: player.Stats only exposes AddModifier (a relative/additive change), not a hard
        // "set absolute value" API as far as CheatCommands.cs / Entities.cs show me. So this
        // computes the exact delta needed to land on targetValue and applies THAT as the modifier,
        // which nets out to the exact number you asked for on this tick.
        //
        // Caveat: if StatDictionary.GetFinalStat or StatSystem's percent-multiplier stack changes
        // between ticks (e.g. an item/effect with a %-based modifier on this same stat expires or
        // is added later), the *base* delta stays fixed but the *final* cached stat can drift away
        // from targetValue again, because percentBonus is applied AFTER flatBonus in StatSystem
        // (finalValue = (baseStat + flatBonus) * (1 + percentBonus)). For a stat with 0% multipliers
        // on it (most raw/testing cases like armor, movementSpeed), this is a true hard "set" that
        // holds. If you want a real always-pinned override regardless of multipliers, that needs a
        // dedicated "StatOverrides" dictionary checked at the end of RecalculatePlayer/RecalculateEnemy
        // in StatSystem.cs - happy to wire that in if you paste StatDictionary.cs (or wherever
        // AddModifier/GetFinalStat/InitializeStat live), since I don't have that file yet.
        float currentValue = player.GetTotalStat(statName, configs);
        float delta = targetValue - currentValue;

        player.Stats.AddModifier(statName, delta, 0);
        player.StatsNeedRecalculation = true;

        if (statName == "maxHp")
        {
            // Keep HP in a sane range relative to the new max instead of leaving it clamped
            // against the old maxHp value.
            player.CurrentHp = Math.Max(1f, targetValue);
        }

        await caller.SendAsync("ReceiveChatMessage", "System", $"Set {statName} to {targetValue}!");
    }
}


public class TitanCommand : ICheatCommand
{
    public string Description => "Makes you nearly unkillable: 100000 armor, magicDefense, and maxHp. Usage: /titan";

    private static readonly (string stat, float value)[] Boosts =
    {
        ("armor", 100000f),
        ("magicDefense", 100000f),
        ("maxHp", 100000f)
    };

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (!room.State.Players.TryGetValue(playerId, out var player)) return;

        // Same trick as /setstat, just applied to three stats at once: compute the delta needed
        // so each stat's CURRENT total lands on the target, then add it the normal way via
        // AddModifier. Nothing new introduced - gear/effects still stack on top afterward.
        foreach (var (stat, value) in Boosts)
        {
            float currentValue = player.GetTotalStat(stat, configs);
            float delta = value - currentValue;
            player.Stats.AddModifier(stat, delta, 0f);
        }

        player.StatsNeedRecalculation = true;
        player.CurrentHp = 100000f;

        await caller.SendAsync("ReceiveChatMessage", "System", "Titan mode: 100000 armor / magicDefense / maxHp!");
    }
}


public class ClearSkillsCommand : ICheatCommand
{
    public string Description => "Removes every skill you've picked up (gear-granted skills will still reappear). Usage: /clearskills";

    public async Task ExecuteAsync(string[] args, GameRoom room, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (room.State.Players.TryGetValue(playerId, out var player))
        {
            int count = player.Skills.Count;
            player.Skills.Clear();
            player.RecalculateSynergies(configs);

            await caller.SendAsync("ReceiveChatMessage", "System", $"Cleared {count} skill(s)!");
        }
    }
}


