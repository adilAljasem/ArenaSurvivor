namespace Server.Configs;

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


public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;

    // The persistent in-game identity — generated once on register, never changes.
    // This is what the server puts in the JWT and uses to identify the player in rooms.
    public Guid PlayerId { get; set; } = Guid.NewGuid();

    public bool IsEmailVerified { get; set; } = false;
    public string? VerificationToken { get; set; }
    public DateTime? VerificationTokenExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? ResetToken { get; set; }
    public DateTime? ResetTokenExpiresAt { get; set; }
}
