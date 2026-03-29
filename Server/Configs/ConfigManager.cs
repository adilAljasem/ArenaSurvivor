using System.Text.Json;

namespace Server.Configs;

public class ConfigManager
{
    // >>> NEW: The Hot Reload Event & Watcher <<<
    public event Action? OnConfigsReloaded;
    private FileSystemWatcher? _watcher;
    private DateTime _lastRead = DateTime.MinValue;


    public Dictionary<string, EnemyConfig> Enemies { get; private set; } = new();
    public Dictionary<string, WeaponConfig> Weapons { get; private set; } = new();
    public Dictionary<string, ItemConfig> Items { get; private set; } = new();
    public Dictionary<string, CharacterConfig> Characters { get; private set; } = new();
    public List<string> AllStats { get; private set; } = new();
    public Dictionary<string, LevelUpCardConfig> LevelUpCards { get; private set; } = new();
    public Dictionary<string, ProjectileConfig> Projectiles { get; private set; } = new();
    public Dictionary<string, EffectConfig> Effects { get; private set; } = new();
    public Dictionary<string, SkillConfig> Skills { get; private set; } = new(); // <<< ADD THIS
    public Dictionary<string, MapConfig> Maps { get; private set; } = new(); // <<< ADD THIS

    public ConfigManager()
    {
        LoadConfigs(); // Your existing load method
        StartWatching(); // Start listening for changes!
    }

    private void StartWatching()
    {
        // Watch the Configs folder for any .json file changes
        _watcher = new FileSystemWatcher("Configs", "*.json")
        {
            NotifyFilter = NotifyFilters.LastWrite,
            EnableRaisingEvents = true
        };

        _watcher.Changed += (sender, e) =>
        {
            // Debounce: Prevent the file from loading 5 times if VS Code saves weirdly
            if ((DateTime.Now - _lastRead).TotalMilliseconds < 500) return;
            _lastRead = DateTime.Now;

            Console.WriteLine($"\n[HOT RELOAD] Detected change in {e.Name}...");

            // Give the OS a tiny fraction of a second to release the file lock
            Thread.Sleep(100);

            try
            {
                LoadConfigs(); // Re-read all the JSON files
                Console.WriteLine("[HOT RELOAD] Success! Pushing to clients.");
                OnConfigsReloaded?.Invoke(); // Tell the GameLoop to update the clients!
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[HOT RELOAD] Failed to read JSON: {ex.Message}");
            }
        };
    }
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

        if (File.Exists("Configs/LevelUpCards.json"))
        {
            var lvlJson = File.ReadAllText("Configs/LevelUpCards.json");
            LevelUpCards = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, LevelUpCardConfig>>(
                lvlJson, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            ) ?? new();
            Console.WriteLine($"Loaded {LevelUpCards.Count} Level Up Cards.");
        }

        if (File.Exists("Configs/Projectiles.json"))
        {
            var projJson = File.ReadAllText("Configs/Projectiles.json");
            Projectiles = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, ProjectileConfig>>(
                projJson, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            ) ?? new();
            Console.WriteLine($"Loaded {Projectiles.Count} Projectiles.");
        }

        if (File.Exists("Configs/Effects.json"))
        {
            var effectJson = File.ReadAllText("Configs/Effects.json");
            Effects = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, EffectConfig>>(
                effectJson, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            ) ?? new();
            Console.WriteLine($"Loaded {Effects.Count} Effects.");
        }

        if (File.Exists("Configs/Skills.json"))
        {
            var skillsJson = File.ReadAllText("Configs/Skills.json");
            Skills = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, SkillConfig>>(
                skillsJson, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            ) ?? new();
            Console.WriteLine($"Loaded {Skills.Count} Skills.");
        }

        if (File.Exists("Configs/Maps.json"))
        {
            var mapsJson = File.ReadAllText("Configs/Maps.json");
            Maps = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, MapConfig>>(
                mapsJson, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            ) ?? new();
            Console.WriteLine($"Loaded {Maps.Count} Maps.");    
        }
    }
}