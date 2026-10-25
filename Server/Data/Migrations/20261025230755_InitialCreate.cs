using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MatchRecords",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PlayerId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<string>(type: "text", nullable: false),
                    Username = table.Column<string>(type: "text", nullable: false),
                    ConfigId = table.Column<string>(type: "text", nullable: false),
                    Difficulty = table.Column<string>(type: "text", nullable: false),
                    HighestWave = table.Column<int>(type: "integer", nullable: false),
                    TotalDamageDealt = table.Column<float>(type: "real", nullable: false),
                    TotalDamageTaken = table.Column<float>(type: "real", nullable: false),
                    TotalHealingDone = table.Column<float>(type: "real", nullable: false),
                    TotalShieldingDone = table.Column<float>(type: "real", nullable: false),
                    Kills = table.Column<int>(type: "integer", nullable: false),
                    Deaths = table.Column<int>(type: "integer", nullable: false),
                    PeakWeaponsEquipped = table.Column<int>(type: "integer", nullable: false),
                    PeakStatsJson = table.Column<string>(type: "text", nullable: false),
                    MatchDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MatchRecords", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "UserAchievements",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AchievementId = table.Column<string>(type: "text", nullable: false),
                    UnlockedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserAchievements", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "UserLifetimeStats",
                columns: table => new
                {
                    PlayerId = table.Column<Guid>(type: "uuid", nullable: false),
                    TotalKills = table.Column<long>(type: "bigint", nullable: false),
                    TotalDeaths = table.Column<long>(type: "bigint", nullable: false),
                    TotalDamageDealt = table.Column<double>(type: "double precision", nullable: false),
                    TotalDamageTaken = table.Column<double>(type: "double precision", nullable: false),
                    TotalHealingDone = table.Column<double>(type: "double precision", nullable: false),
                    TotalShieldingDone = table.Column<double>(type: "double precision", nullable: false),
                    MatchesPlayed = table.Column<int>(type: "integer", nullable: false),
                    BestWaveEver = table.Column<int>(type: "integer", nullable: false),
                    BestWavePerCharacterJson = table.Column<string>(type: "text", nullable: false),
                    BestWavePerDifficultyJson = table.Column<string>(type: "text", nullable: false),
                    BestPeakStatsJson = table.Column<string>(type: "text", nullable: false),
                    BestSingleMatchStatsJson = table.Column<string>(type: "text", nullable: false),
                    LastUpdated = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserLifetimeStats", x => x.PlayerId);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Username = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    PasswordHash = table.Column<string>(type: "text", nullable: false),
                    PlayerId = table.Column<Guid>(type: "uuid", nullable: false),
                    IsEmailVerified = table.Column<bool>(type: "boolean", nullable: false),
                    VerificationToken = table.Column<string>(type: "text", nullable: true),
                    VerificationTokenExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ResetToken = table.Column<string>(type: "text", nullable: true),
                    ResetTokenExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    TermsAcceptedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsAdmin = table.Column<bool>(type: "boolean", nullable: false),
                    IsBanned = table.Column<bool>(type: "boolean", nullable: false),
                    BanReason = table.Column<string>(type: "text", nullable: true),
                    BannedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MatchRecords_Difficulty_HighestWave",
                table: "MatchRecords",
                columns: new[] { "Difficulty", "HighestWave" });

            migrationBuilder.CreateIndex(
                name: "IX_UserAchievements_UserId_AchievementId",
                table: "UserAchievements",
                columns: new[] { "UserId", "AchievementId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_Email",
                table: "Users",
                column: "Email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_PlayerId",
                table: "Users",
                column: "PlayerId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_Username",
                table: "Users",
                column: "Username",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MatchRecords");

            migrationBuilder.DropTable(
                name: "UserAchievements");

            migrationBuilder.DropTable(
                name: "UserLifetimeStats");

            migrationBuilder.DropTable(
                name: "Users");
        }
    }
}
