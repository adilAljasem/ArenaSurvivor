using System.Text.Json;

namespace Server.Configs;

public class ConfigManager
{
    public Dictionary<string, EnemyConfig> Enemies { get; private set; } = new();
    public Dictionary<string, WeaponConfig> Weapons { get; private set; } = new();
    public Dictionary<string, ItemConfig> Items { get; private set; } = new();
    public Dictionary<string, CharacterConfig> Characters { get; private set; } = new();
    public List<string> AllStats { get; private set; } = new();
    public void LoadConfigs()
    {
        // Reads the JSON file into memory
        var enemyJson = File.ReadAllText("Configs/Enemies.json");
        Enemies = JsonSerializer.Deserialize<Dictionary<string, EnemyConfig>>(
            enemyJson,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
        ) ?? new();

        Console.WriteLine($"Loaded {Enemies.Count} Enemy Configs.");

        var weaponJson = File.ReadAllText("Configs/Weapons.json");
        Weapons = JsonSerializer.Deserialize<Dictionary<string, WeaponConfig>>(
            weaponJson,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
        ) ?? new();
        Console.WriteLine($"Loaded {Weapons.Count} Weapon Configs.");

        if (File.Exists("Configs/Items.json"))
        {
            var itemJson = File.ReadAllText("Configs/Items.json");
            Items = JsonSerializer.Deserialize<Dictionary<string, ItemConfig>>(
                itemJson,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            ) ?? new();
            Console.WriteLine($"Loaded {Items.Count} Item Configs.");
        }

        if (File.Exists("Configs/Characters.json"))
        {
            var charJson = File.ReadAllText("Configs/Characters.json");
            Characters = JsonSerializer.Deserialize<Dictionary<string, CharacterConfig>>(
                charJson,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            ) ?? new();
            Console.WriteLine($"Loaded {Characters.Count} Character Configs.");
        }

        if (File.Exists("Configs/Stats.json"))
        {
            var statsJson = File.ReadAllText("Configs/Stats.json");
            AllStats = System.Text.Json.JsonSerializer.Deserialize<List<string>>(statsJson) ?? new();
            Console.WriteLine($"Loaded {AllStats.Count} Master Stats.");
        }
    }
}