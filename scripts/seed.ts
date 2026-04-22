/**
 * Seeds the database with starter tracked accounts.
 * Run: pnpm db:seed
 * Safe to re-run — uses upsert so existing accounts are not overwritten.
 */
import "dotenv/config";
import { db } from "@sports-engine/db";

const STARTER_ACCOUNTS = [
  // MLB focused
  { username: "Jomboy_Media",     displayName: "Jomboy Media",     sportFocus: ["MLB"],        priority: 10 },
  { username: "MLBPicksRookie",   displayName: "MLB Picks Rookie", sportFocus: ["MLB"],        priority: 20 },

  // NBA focused
  { username: "NBABetInsider",    displayName: "NBA Bet Insider",  sportFocus: ["NBA"],        priority: 10 },
  { username: "LockedOnPicks",    displayName: "Locked On Picks",  sportFocus: ["NBA", "NFL"], priority: 20 },

  // Multi-sport
  { username: "SharpSidesPro",   displayName: "Sharp Sides Pro",  sportFocus: ["MLB", "NBA"], priority: 5  },
  { username: "BettingPros",     displayName: "BettingPros",      sportFocus: [],             priority: 15 },
  { username: "TheActionNetwork",displayName: "Action Network",   sportFocus: [],             priority: 15 },
  { username: "VegasInsider",    displayName: "Vegas Insider",    sportFocus: [],             priority: 20 },
];

async function main() {
  console.log("Seeding tracked accounts...\n");

  for (const acct of STARTER_ACCOUNTS) {
    await db.trackedAccount.upsert({
      where: { username: acct.username },
      update: {},
      create: {
        username: acct.username,
        displayName: acct.displayName,
        sportFocus: acct.sportFocus,
        priority: acct.priority,
        active: true,
      },
    });
    console.log(`  ✓ @${acct.username}`);
  }

  const total = await db.trackedAccount.count();
  console.log(`\nDone — ${total} total accounts in DB.`);

  await db.$disconnect();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
