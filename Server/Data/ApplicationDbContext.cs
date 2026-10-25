using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations;
using Server.Configs;

namespace Server.Data;

public class ApplicationDbContext : DbContext
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<MatchRecord> MatchRecords => Set<MatchRecord>();
    public DbSet<UserAchievement> UserAchievements => Set<UserAchievement>();
    public DbSet<UserLifetimeStats> UserLifetimeStats => Set<UserLifetimeStats>();

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        base.OnConfiguring(optionsBuilder);
        optionsBuilder.ReplaceService<IHistoryRepository, YugabyteHistoryRepository>();
    }

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

#pragma warning disable EF1001
// YugabyteDB does not support EF Core 10's default "LOCK TABLE __EFMigrationsHistory IN ACCESS EXCLUSIVE MODE"
public class YugabyteHistoryRepository : Npgsql.EntityFrameworkCore.PostgreSQL.Migrations.Internal.NpgsqlHistoryRepository
{
    public YugabyteHistoryRepository(HistoryRepositoryDependencies dependencies) : base(dependencies) { }

    public override IMigrationsDatabaseLock AcquireDatabaseLock() => new NoOpMigrationsDatabaseLock(this);

    public override Task<IMigrationsDatabaseLock> AcquireDatabaseLockAsync(CancellationToken cancellationToken = default)
        => Task.FromResult<IMigrationsDatabaseLock>(new NoOpMigrationsDatabaseLock(this));

    private sealed class NoOpMigrationsDatabaseLock(IHistoryRepository historyRepository) : IMigrationsDatabaseLock
    {
        public IHistoryRepository HistoryRepository => historyRepository;
        public void Dispose() { }
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
#pragma warning restore EF1001
