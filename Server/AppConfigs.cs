namespace Server.Configs;

public class ServerConfig
{
    public string Role { get; set; } = "Dev";
    public string PublicUrl { get; set; } = string.Empty;
    public string[] AllowedCorsOrigins { get; set; } = new[] { "http://localhost:5173" };
    public string GameVersion { get; set; } = "v1.0.0";
}

public class RedisConfig
{
    public string ConnectionString { get; set; } = "127.0.0.1:6379";
    public string ChannelPrefix { get; set; } = "ArenaSurvivor";
    public int TokenExpirationMinutes { get; set; } = 2;
}