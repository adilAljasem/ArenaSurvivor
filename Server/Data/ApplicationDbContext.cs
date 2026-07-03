using Microsoft.EntityFrameworkCore;
using Server.Configs;

namespace Server.Data;

public class ApplicationDbContext : DbContext
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<MatchRecord> MatchRecords => Set<MatchRecord>();
    public DbSet<UserAchievement> UserAchievements => Set<UserAchievement>();
    public DbSet<UserLifetimeStats> UserLifetimeStats => Set<UserLifetimeStats>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(e =>
        {
            e.HasKey(u => u.Id);
            e.Property(u => u.Email).HasMaxLength(255).IsRequired();
            e.Property(u => u.Username).HasMaxLength(50).IsRequired();
            e.HasIndex(u => u.Email).IsUnique();
            e.HasIndex(u => u.Username).IsUnique();
            e.HasIndex(u => u.PlayerId).IsUnique();
        });

        modelBuilder.Entity<MatchRecord>()
            .HasIndex(m => new { m.Difficulty, m.HighestWave });

        modelBuilder.Entity<UserAchievement>()
            .HasIndex(u => new { u.UserId, u.AchievementId }).IsUnique();

    }
}