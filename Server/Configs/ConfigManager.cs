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
    public Dictionary<string, AchievementConfig> Achievements { get; private set; } = new();

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


    private static readonly JsonSerializerOptions _jsonOptions = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

    // Required config - throws (caught by LoadConfigs' try/catch) if the file is missing/invalid.
    private static T LoadRequiredJsonConfig<T>(string path) where T : new()
        => JsonSerializer.Deserialize<T>(File.ReadAllText(path), _jsonOptions) ?? new();

    // Optional config - defaults to empty if the file doesn't exist.
    private static T LoadOptionalJsonConfig<T>(string path) where T : new()
        => File.Exists(path) ? (JsonSerializer.Deserialize<T>(File.ReadAllText(path), _jsonOptions) ?? new()) : new();



    public void LoadConfigs()
    {
        try
        {
            var newEnemies = LoadRequiredJsonConfig<Dictionary<string, EnemyConfig>>("Configs/Enemies.json");
            var newWeapons = LoadRequiredJsonConfig<Dictionary<string, WeaponConfig>>("Configs/Weapons.json");
            var newItems = LoadOptionalJsonConfig<Dictionary<string, ItemConfig>>("Configs/Items.json");
            var newCharacters = LoadOptionalJsonConfig<Dictionary<string, CharacterConfig>>("Configs/Characters.json");
            var newEffects = LoadOptionalJsonConfig<Dictionary<string, EffectConfig>>("Configs/Effects.json");
            var newSkills = LoadOptionalJsonConfig<Dictionary<string, SkillConfig>>("Configs/Skills.json");
            var newMaps = LoadOptionalJsonConfig<Dictionary<string, MapConfig>>("Configs/Maps.json");
            var newProjectiles = LoadOptionalJsonConfig<Dictionary<string, ProjectileConfig>>("Configs/Projectiles.json");
            var newLevelUpCards = LoadOptionalJsonConfig<Dictionary<string, LevelUpCardConfig>>("Configs/LevelUpCards.json");
            var newStats = LoadOptionalJsonConfig<List<string>>("Configs/Stats.json");
            var newTraits = LoadOptionalJsonConfig<Dictionary<string, TraitConfig>>("Configs/Traits.json");
            var newDifficulties = LoadOptionalJsonConfig<Dictionary<string, DifficultyConfig>>("Configs/Difficulties.json");
            var newAchievements = LoadOptionalJsonConfig<Dictionary<string, AchievementConfig>>("Configs/Achievements.json");

            foreach (var kvp in newAchievements)
                kvp.Value.Id = kvp.Key;

            // 2. ATOMIC SWAP (unchanged from here down)
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
            Achievements = newAchievements;

            Console.WriteLine($"[CONFIG] Loaded successfully: {Enemies.Count} Enemies, {Weapons.Count} Weapons, {Projectiles.Count} Projectiles.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[CONFIG ERROR] Failed to parse JSON. Game will continue using old configs. Error: {ex.Message}");
        }
    }

}