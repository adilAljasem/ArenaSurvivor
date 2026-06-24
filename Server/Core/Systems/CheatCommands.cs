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
            if (dx*dx + dy*dy > 600*600) continue; // only nearby

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
            player.GainXp(amount, configs);
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
                enemy.ActionState = "Dead";
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