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
    Task ExecuteAsync(string[] args, GameState state, ConfigManager configs, string playerId, IClientProxy caller);
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
    }

    public static async Task ExecuteAsync(string input, GameState state, ConfigManager configs, string playerId, IClientProxy caller)
    {
        var parts = input.TrimStart('/').Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return;

        var cmdName = parts[0];
        if (_commands.TryGetValue(cmdName, out var command))
        {
            try
            {
                await command.ExecuteAsync(parts.Skip(1).ToArray(), state, configs, playerId, caller);
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

// =====================================================================
// 3. YOUR SPECIFIC COMMAND CLASSES
// =====================================================================

public class SetWaveCommand : ICheatCommand
{
    public string Description => "Sets the current wave. Usage: /setwave <number>";

    public async Task ExecuteAsync(string[] args, GameState state, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length == 0 || !int.TryParse(args[0], out int targetWave))
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /setwave <number>");
            return;
        }

        state.CurrentWave = targetWave;
        // End the current phase immediately so the new wave loads cleanly
        state.PhaseTimer = 0;

        await caller.SendAsync("ReceiveChatMessage", "System", $"Warped to Wave {targetWave}!");
    }
}

public class SkipPhaseCommand : ICheatCommand
{
    public string Description => "Skips the current phase timer instantly.";

    public async Task ExecuteAsync(string[] args, GameState state, ConfigManager configs, string playerId, IClientProxy caller)
    {
        state.PhaseTimer = 0;
        await caller.SendAsync("ReceiveChatMessage", "System", "Phase skipped!");
    }
}

public class SpawnEnemyCommand : ICheatCommand
{
    public string Description => "Spawns enemies near you. Usage: /spawnenemy <configId> [count]";

    public async Task ExecuteAsync(string[] args, GameState state, ConfigManager configs, string playerId, IClientProxy caller)
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
        if (state.Players.TryGetValue(playerId, out var player))
        {
            for (int i = 0; i < count; i++)
            {
                var newEnemy = new EnemyEntity();
                // Spawn in a slight random radius around the player
                float ox = (float)(Random.Shared.NextDouble() * 200 - 100);
                float oy = (float)(Random.Shared.NextDouble() * 200 - 100);

                newEnemy.Initialize(eCfg, player.X + ox, player.Y + oy, configs);
                newEnemy.CurrentHp = newEnemy.GetTotalStat("maxHp", configs);

                state.Enemies.TryAdd(newEnemy.Id, newEnemy);
            }
            await caller.SendAsync("ReceiveChatMessage", "System", $"Spawned {count}x {eCfg.Name}!");
        }
    }
}

public class HealCommand : ICheatCommand
{
    public string Description => "Heals you to full HP. Usage: /heal";

    public async Task ExecuteAsync(string[] args, GameState state, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (state.Players.TryGetValue(playerId, out var player))
        {
            player.CurrentHp = player.GetTotalStat("maxHp", configs);
            await caller.SendAsync("ReceiveChatMessage", "System", "Healed to max HP!");
        }
    }
}

public class GiveGoldCommand : ICheatCommand
{
    public string Description => "Gives you gold. Usage: /givegold <amount>";

    public async Task ExecuteAsync(string[] args, GameState state, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length == 0 || !int.TryParse(args[0], out int amount))
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /givegold <amount>");
            return;
        }

        if (state.Players.TryGetValue(playerId, out var player))
        {
            player.Gold += amount;
            await caller.SendAsync("ReceiveChatMessage", "System", $"Added {amount} gold!");
        }
    }
}

public class GiveXpCommand : ICheatCommand
{
    public string Description => "Gives you XP. Usage: /givexp <amount>";

    public async Task ExecuteAsync(string[] args, GameState state, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length == 0 || !int.TryParse(args[0], out int amount))
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /givexp <amount>");
            return;
        }

        if (state.Players.TryGetValue(playerId, out var player))
        {
            player.GainXp(amount, configs);
            await caller.SendAsync("ReceiveChatMessage", "System", $"Added {amount} XP!");
        }
    }
}

public class KillAllCommand : ICheatCommand
{
    public string Description => "Kills all enemies on screen. Usage: /killall";

    public async Task ExecuteAsync(string[] args, GameState state, ConfigManager configs, string playerId, IClientProxy caller)
    {
        int count = 0;
        foreach (var enemy in state.Enemies.Values)
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

    public async Task ExecuteAsync(string[] args, GameState state, ConfigManager configs, string playerId, IClientProxy caller)
    {
        if (args.Length == 0)
        {
            await caller.SendAsync("ReceiveChatMessage", "System", "Usage: /giveweapon <configId>");
            return;
        }

        if (state.Players.TryGetValue(playerId, out var player))
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