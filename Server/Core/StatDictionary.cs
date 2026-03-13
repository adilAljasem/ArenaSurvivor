namespace Server.Core;

public class StatInfo
{
    public float BaseValue { get; set; }
    public float FlatModifier { get; set; }
    public float PercentModifier { get; set; }
}

public class StatDictionary
{
    // 1. Expose this so SignalR can send the whole dictionary to the client for the UI!
    public Dictionary<string, StatInfo> Stats { get; } = new();

    public void InitializeStat(string statName, float baseValue)
    {
        Stats[statName] = new StatInfo { BaseValue = baseValue, FlatModifier = 0, PercentModifier = 0 };
    }

    public float GetFinalStat(string statName)
    {
        if (!Stats.TryGetValue(statName, out var stat)) return 0f;
        // The core scaling formula: (Base + Flat) * (1 + Percent)
        return (stat.BaseValue + stat.FlatModifier) * (1f + stat.PercentModifier);
    }

    // Used when equipping weapons or leveling up
    public void AddModifier(string statName, float flatAmount, float percentAmount)
    {
        // 2. CRITICAL FIX: If an item grants a stat the player doesn't have yet, initialize it to 0 first!
        if (!Stats.ContainsKey(statName))
        {
            InitializeStat(statName, 0f);
        }
        
        Stats[statName].FlatModifier += flatAmount;
        Stats[statName].PercentModifier += percentAmount;
    }
}