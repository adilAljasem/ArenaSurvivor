using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Server.Migrations
{
    /// <inheritdoc />
    public partial class LifeTiemData : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserLifetimeStats");
        }
    }
}
