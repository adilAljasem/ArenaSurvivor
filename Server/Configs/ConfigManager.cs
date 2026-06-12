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
    public Dictionary<string, TraitConfig> Traits { get; private set; } = new(); // <<< ADD THIS
    public Dictionary<string, DifficultyConfig> Difficulties { get; private set; } = new();

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
        try
        {
            // 1. Load EVERYTHING into TEMPORARY variables first
            var newEnemies = JsonSerializer.Deserialize<Dictionary<string, EnemyConfig>>(
                File.ReadAllText("Configs/Enemies.json"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();

            var newWeapons = JsonSerializer.Deserialize<Dictionary<string, WeaponConfig>>(
                File.ReadAllText("Configs/Weapons.json"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();

            var newItems = File.Exists("Configs/Items.json") ? JsonSerializer.Deserialize<Dictionary<string, ItemConfig>>(
                File.ReadAllText("Configs/Items.json"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new() : new();

            var newCharacters = File.Exists("Configs/Characters.json") ? JsonSerializer.Deserialize<Dictionary<string, CharacterConfig>>(
                File.ReadAllText("Configs/Characters.json"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new() : new();

            var newEffects = File.Exists("Configs/Effects.json") ? JsonSerializer.Deserialize<Dictionary<string, EffectConfig>>(
                File.ReadAllText("Configs/Effects.json"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new() : new();

            var newSkills = File.Exists("Configs/Skills.json") ? JsonSerializer.Deserialize<Dictionary<string, SkillConfig>>(
                File.ReadAllText("Configs/Skills.json"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new() : new();

            var newMaps = File.Exists("Configs/Maps.json") ? JsonSerializer.Deserialize<Dictionary<string, MapConfig>>(
                File.ReadAllText("Configs/Maps.json"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new() : new();

            var newProjectiles = File.Exists("Configs/Projectiles.json") ? JsonSerializer.Deserialize<Dictionary<string, ProjectileConfig>>(
                File.ReadAllText("Configs/Projectiles.json"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new() : new();

            var newLevelUpCards = File.Exists("Configs/LevelUpCards.json") ? JsonSerializer.Deserialize<Dictionary<string, LevelUpCardConfig>>(
                File.ReadAllText("Configs/LevelUpCards.json"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new() : new();

            var newStats = File.Exists("Configs/Stats.json") ? JsonSerializer.Deserialize<List<string>>(
                File.ReadAllText("Configs/Stats.json")) ?? new() : new();

            var newTraits = File.Exists("Configs/Traits.json") ? JsonSerializer.Deserialize<Dictionary<string, TraitConfig>>(
                File.ReadAllText("Configs/Traits.json"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new() : new();

            var newDifficulties = File.Exists("Configs/Difficulties.json") ? JsonSerializer.Deserialize<Dictionary<string, DifficultyConfig>>(
            File.ReadAllText("Configs/Difficulties.json"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new() : new();

            // 2. ATOMIC SWAP: Reassign everything at the exact same time!
            Enemies = newEnemies;
            Weapons = newWeapons;
            Items = newItems;
            Characters = newCharacters;
            Effects = newEffects;
            Skills = newSkills;
            Maps = newMaps;
            Projectiles = newProjectiles;
            LevelUpCards = newLevelUpCards;
            AllStats = newStats;
            Traits = newTraits;
            Difficulties = newDifficulties;

            Console.WriteLine($"[CONFIG] Loaded successfully: {Enemies.Count} Enemies, {Weapons.Count} Weapons, {Projectiles.Count} Projectiles.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[CONFIG ERROR] Failed to parse JSON. Game will continue using old configs. Error: {ex.Message}");
        }
    }
}