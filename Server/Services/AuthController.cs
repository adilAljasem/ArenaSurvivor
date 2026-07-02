using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Server.Configs;
using Server.Data;
using Server.Services;

namespace Server.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly ApplicationDbContext _db;
    private readonly EmailService _emailService;
    private readonly JwtSettings _jwt;
    private readonly ServerConfig _serverConfig;

    public AuthController(
        ApplicationDbContext db,
        EmailService emailService,
        IOptions<JwtSettings> jwt,
        IOptions<ServerConfig> serverConfig)
    {
        _db = db;
        _emailService = emailService;
        _jwt = jwt.Value;
        _serverConfig = serverConfig.Value;
    }

    [HttpGet("version")]
    public IActionResult GetVersion()
    {
        return Ok(new { version = _serverConfig.GameVersion });
    }

    // ─── REGISTER ────────────────────────────────────────────────────────────
    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest req)
    {
        try
        {
            // Basic validation[cite: 11]
            if (string.IsNullOrWhiteSpace(req.Email) || !req.Email.Contains('@'))
                return BadRequest(new { error = "Invalid email address." });
            if (req.Username.Length < 3 || req.Username.Length > 20 ||
                !Regex.IsMatch(req.Username, @"^[a-zA-Z0-9_]+$"))
                return BadRequest(new { error = "Username must be 3–20 characters: letters, digits, underscores." });
            if (req.Password.Length < 8)
                return BadRequest(new { error = "Password must be at least 8 characters." });

            // Safe Database Checks[cite: 11]
            if (await _db.Users.AnyAsync(u => u.Email == req.Email.ToLower()))
                return Conflict(new { error = "An account with this email already exists." });
            if (await _db.Users.AnyAsync(u => u.Username == req.Username))
                return Conflict(new { error = "Username is already taken." });

            string verificationToken = Guid.NewGuid().ToString("N"); // no dashes[cite: 11]

            var user = new User
            {
                Email = req.Email.ToLower().Trim(),
                Username = req.Username.Trim(),
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
                VerificationToken = verificationToken,
                VerificationTokenExpiresAt = DateTime.UtcNow.AddHours(24),
                PlayerId = Guid.NewGuid()
            };

            _db.Users.Add(user);
            await _db.SaveChangesAsync();

            // Build verification URL pointing at the frontend[cite: 11]
            string frontendUrl = _serverConfig.FrontendUrl ?? $"{Request.Scheme}://{Request.Host}";
            string verifyUrl = $"{frontendUrl}/?verify_token={verificationToken}";

            try
            {
                await _emailService.SendVerificationEmailAsync(user.Email, user.Username, verifyUrl);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AUTH SYSTEM] Non-fatal: Failed to send verification email to {user.Email}: {ex.Message}");
            }

            return Ok(new { message = "Account created! Check your email to verify your account." });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[AUTH CRITICAL] Registration Exception intercepted safely: {ex}");
            return StatusCode(500, new { error = "Internal server database error during registration. Please verify database migrations." });
        }
    }

    // ─── VERIFY EMAIL ─────────────────────────────────────────────────────────
    [HttpGet("verify")]
    public async Task<IActionResult> VerifyEmail([FromQuery] string token)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(token))
                return BadRequest(new { error = "Token parameter is missing." });

            var user = await _db.Users.FirstOrDefaultAsync(u => u.VerificationToken == token);

            if (user == null)
                return BadRequest(new { error = "Invalid or expired verification token." });
            if (user.IsEmailVerified)
                return Ok(new { message = "Email already verified. You can log in." });
            if (user.VerificationTokenExpiresAt < DateTime.UtcNow)
                return BadRequest(new { error = "Verification link has expired. Please register again." });

            user.IsEmailVerified = true;
            user.VerificationToken = null;
            user.VerificationTokenExpiresAt = null;
            await _db.SaveChangesAsync();

            return Ok(new { message = "Email verified! You can now log in." });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[AUTH CRITICAL] Verification Exception intercepted safely: {ex}");
            return StatusCode(500, new { error = "Internal server database error during email verification." });
        }
    }

    // ─── LOGIN ────────────────────────────────────────────────────────────────
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
                return BadRequest(new { error = "Email and password are required." });

            var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == req.Email.ToLower().Trim());

            if (user == null || !BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
                return Unauthorized(new { error = "Invalid email or password." });

            if (!user.IsEmailVerified)
                return Unauthorized(new { error = "Please verify your email before logging in." });

            if (user.IsBanned)
                return StatusCode(403, new { error = $"This account has been banned.{(string.IsNullOrWhiteSpace(user.BanReason) ? "" : $" Reason: {user.BanReason}")}" });

            // >>> NEW: 1. Kick old connections across the entire cluster
            var redisService = HttpContext.RequestServices.GetRequiredService<RedisService>();
            await redisService.PublishForceLogout(user.PlayerId.ToString());

            // >>> NEW: 2. Generate a new session ID and lock it in Redis
            string sessionId = Guid.NewGuid().ToString("N");
            await redisService.SetActiveSession(user.PlayerId.ToString(), sessionId);

            // >>> NEW: 3. Pass the sessionId into the JWT generator
            string token = GenerateJwt(user, sessionId);
            return Ok(new { token, username = user.Username, playerId = user.PlayerId });

        }
        catch (Exception ex)
        {
            Console.WriteLine($"[AUTH CRITICAL] Login Exception intercepted safely: {ex}");
            return StatusCode(500, new { error = "The server database is unreachable or table maps are missing. Contact administrator." });
        }
    }

    // ─── JWT GENERATION ───────────────────────────────────────────────────────
    private string GenerateJwt(User user, string sessionId)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.SecretKey));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim("PlayerId", user.PlayerId.ToString()),
            new Claim("Username", user.Username),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim("SessionId", sessionId), // <<< NEW: Bake the session into the token
            new Claim("IsAdmin", user.IsAdmin.ToString()) // Convenience claim — AdminOnlyAttribute still re-checks the DB live, so a stale token can't grant/retain admin after a demotion.
        };

        var tokenDescriptor = new JwtSecurityToken(
            issuer: _jwt.Issuer,
            audience: _jwt.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddDays(_jwt.ExpirationDays),
            signingCredentials: creds
        );

        return new JwtSecurityTokenHandler().WriteToken(tokenDescriptor);
    }

    // ─── FORGOT PASSWORD ─────────────────────────────────────────────────────
    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req.Email))
                return BadRequest(new { error = "Email is required." });

            var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == req.Email.ToLower().Trim());

            // Always return OK even if the email isn't found to prevent email enumeration attacks
            if (user == null)
                return Ok(new { message = "If that email exists, a reset link has been sent." });

            string resetToken = Guid.NewGuid().ToString("N");
            user.ResetToken = resetToken;
            user.ResetTokenExpiresAt = DateTime.UtcNow.AddHours(1); // 1 hour expiration
            await _db.SaveChangesAsync();

            string frontendUrl = _serverConfig.FrontendUrl ?? $"{Request.Scheme}://{Request.Host}";
            string resetUrl = $"{frontendUrl}/?reset_token={resetToken}";

            // You will need to add this method to your EmailService!
            await _emailService.SendPasswordResetEmailAsync(user.Email, user.Username, resetUrl);

            return Ok(new { message = "If that email exists, a reset link has been sent." });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[AUTH CRITICAL] Forgot Password Exception: {ex}");
            return StatusCode(500, new { error = "Internal server error." });
        }
    }

    // ─── RESET PASSWORD ──────────────────────────────────────────────────────
    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req.Token) || string.IsNullOrWhiteSpace(req.NewPassword))
                return BadRequest(new { error = "Token and new password are required." });

            if (req.NewPassword.Length < 8)
                return BadRequest(new { error = "Password must be at least 8 characters." });

            var user = await _db.Users.FirstOrDefaultAsync(u => u.ResetToken == req.Token);

            if (user == null || user.ResetTokenExpiresAt < DateTime.UtcNow)
                return BadRequest(new { error = "Invalid or expired reset token." });

            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.NewPassword);
            user.ResetToken = null;
            user.ResetTokenExpiresAt = null;
            await _db.SaveChangesAsync();

            return Ok(new { message = "Password updated successfully. You can now log in." });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[AUTH CRITICAL] Reset Password Exception: {ex}");
            return StatusCode(500, new { error = "Internal server error." });
        }
    }

    // ─── RESEND VERIFICATION ─────────────────────────────────────────────────────
    [HttpPost("resend-verification")]
    public async Task<IActionResult> ResendVerification([FromBody] ResendVerificationRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req.Email))
                return BadRequest(new { error = "Email is required." });

            var redisService = HttpContext.RequestServices.GetRequiredService<RedisService>();
            bool allowed = await redisService.CheckResendRateLimit(req.Email);
            if (!allowed)
                return StatusCode(429, new { error = "Please wait 60 seconds before requesting another email." });

            var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == req.Email.ToLower().Trim());

            // Return the same vague message regardless (prevents email enumeration).
            if (user == null || user.IsEmailVerified)
                return Ok(new { message = "If that email is pending verification, a new link was sent." });

            user.VerificationToken = Guid.NewGuid().ToString("N");
            user.VerificationTokenExpiresAt = DateTime.UtcNow.AddHours(24);
            await _db.SaveChangesAsync();

            string frontendUrl = _serverConfig.FrontendUrl ?? $"{Request.Scheme}://{Request.Host}";
            string verifyUrl = $"{frontendUrl}/?verify_token={user.VerificationToken}";

            try { await _emailService.SendVerificationEmailAsync(user.Email, user.Username, verifyUrl); }
            catch (Exception ex) { Console.WriteLine($"[AUTH] Resend email failed: {ex.Message}"); }

            return Ok(new { message = "If that email is pending verification, a new link was sent." });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[AUTH CRITICAL] Resend Verification Exception: {ex}");
            return StatusCode(500, new { error = "Internal server error." });
        }
    }

}

public record RegisterRequest(string Email, string Username, string Password);
public record LoginRequest(string Email, string Password);
public record ForgotPasswordRequest(string Email);
public record ResetPasswordRequest(string Token, string NewPassword);
public record ResendVerificationRequest(string Email);