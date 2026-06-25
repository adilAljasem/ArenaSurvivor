using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;
using Server.Configs;
using Server.Data;

namespace Server.Services;

// NuGet: dotnet add package MailKit
public class EmailService
{
    private readonly EmailSettings _settings;

    public EmailService(IOptions<EmailSettings> settings)
    {
        _settings = settings.Value;
    }


    public async Task SendVerificationEmailAsync(string toEmail, string username, string verifyUrl)
    {
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress("Arena Survivor", _settings.From));
        message.To.Add(new MailboxAddress(username, toEmail));
        message.Subject = "Verify your Arena Survivor account";
        message.Body = new TextPart("html")
        {
            Text = $@"
                <div style=""font-family: sans-serif; max-width: 480px; margin: auto;"">
                    <h2>Welcome to Arena Survivor, {username}!</h2>
                    <p>Click the button below to verify your email address and activate your account:</p>
                    <a href=""{verifyUrl}"" style=""display:inline-block;padding:12px 28px;background:#bf55ec;color:white;border-radius:6px;text-decoration:none;font-weight:bold;"">
                        Verify My Account
                    </a>
                    <p style=""color:#888;margin-top:24px;"">This link expires in 24 hours.</p>
                </div>"
        };

        using var client = new SmtpClient();
        await client.ConnectAsync(_settings.SmtpServer, _settings.Port,
            _settings.UseSsl ? SecureSocketOptions.StartTls : SecureSocketOptions.None);
        await client.AuthenticateAsync(_settings.Username, _settings.Password);
        await client.SendAsync(message);
        await client.DisconnectAsync(true);
    }

    public async Task SendPasswordResetEmailAsync(string toEmail, string username, string resetUrl)
    {
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress("Arena Survivor", _settings.From));
        message.To.Add(new MailboxAddress(username, toEmail));
        message.Subject = "Reset your Arena Survivor password";

        // Use a slightly different theme color (Gold #e5b35c) to distinguish it from the verification email
        message.Body = new TextPart("html")
        {
            Text = $@"
                <div style=""font-family: sans-serif; max-width: 480px; margin: auto;"">
                    <h2>Password Reset Request</h2>
                    <p>Hi {username},</p>
                    <p>We received a request to reset your password for Arena Survivor. Click the button below to choose a new one:</p>
                    <a href=""{resetUrl}"" style=""display:inline-block;padding:12px 28px;background:#e5b35c;color:#14141c;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:10px;"">
                        Reset Password
                    </a>
                    <p style=""color:#888;margin-top:24px;font-size:13px;"">If you didn't request this, you can safely ignore this email. Your password won't change until you create a new one. This link expires in 1 hour.</p>
                </div>"
        };

        using var client = new SmtpClient();
        await client.ConnectAsync(_settings.SmtpServer, _settings.Port,
            _settings.UseSsl ? SecureSocketOptions.StartTls : SecureSocketOptions.None);
        await client.AuthenticateAsync(_settings.Username, _settings.Password);
        await client.SendAsync(message);
        await client.DisconnectAsync(true);
    }
}