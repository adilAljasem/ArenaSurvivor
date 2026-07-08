namespace Server.Configs;

public class ServerConfig
{
    public string? FrontendUrl { get; set; }
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

public class RoomConfig
{
    public int PauseTimeoutMinutes { get; set; } = 3;
    public bool AllowSpectators { get; set; } = false;

}

public class EmailSettings
{
    public string From { get; set; } = string.Empty;
    public string SmtpServer { get; set; } = string.Empty;
    public int Port { get; set; } = 587;
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public bool UseSsl { get; set; } = true;
}

public class JwtSettings
{
    public string SecretKey { get; set; } = string.Empty;
    public string Issuer { get; set; } = "ArenaSurvivor";
    public string Audience { get; set; } = "ArenaSurvivorPlayers";
    public int ExpirationDays { get; set; } = 30;
}

public class RoomSettings
{
    public int PauseTimeoutMinutes { get; set; } = 10;
    public int GracePeriodSeconds { get; set; } = 180;
    public bool AllowSpectators { get; set; } = true;
}
