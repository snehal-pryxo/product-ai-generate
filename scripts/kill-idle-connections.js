/**
 * Kills idle (Sleep) MySQL connections for the current DB user so that
 * `prisma migrate deploy` can get a connection slot.
 *
 * Usage:  node scripts/kill-idle-connections.js
 *
 * Requires the DB user to have PROCESS privilege (to see other processes)
 * or at minimum the ability to see its own SHOW PROCESSLIST entries.
 */
import { PrismaClient } from "@prisma/client";

const MAX_CONNECT_RETRIES = 3;
const CONNECT_DELAY_MS = 5000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Parse current user from DATABASE_URL so we only kill our own connections.
  const dbUrl = process.env.DATABASE_URL ?? "";
  let currentUser = null;
  try {
    currentUser = new URL(dbUrl).username;
  } catch {}

  let prisma = null;

  for (let attempt = 1; attempt <= MAX_CONNECT_RETRIES; attempt++) {
    try {
      prisma = new PrismaClient({ datasourceUrl: dbUrl });
      await prisma.$connect();
      break;
    } catch (err) {
      console.warn(`Connect attempt ${attempt} failed: ${err.message}`);
      if (attempt === MAX_CONNECT_RETRIES) {
        console.error("Could not connect to MySQL. The server may be fully saturated.");
        console.error("Try again in a few minutes once Lambda instances cycle out.");
        process.exit(1);
      }
      await sleep(CONNECT_DELAY_MS);
    }
  }

  try {
    // SHOW PROCESSLIST only shows the current user's processes on shared hosting.
    const processes = await prisma.$queryRaw`SHOW PROCESSLIST`;

    const idle = processes.filter(
      (p) =>
        String(p.Command ?? p.command ?? "").toLowerCase() === "sleep" &&
        Number(p.Time ?? p.time ?? 0) > 30 // idle for >30 s
    );

    console.log(`Found ${processes.length} total connection(s), ${idle.length} idle (>30s).`);

    if (idle.length === 0) {
      console.log("No idle connections to kill.");
      return;
    }

    let killed = 0;
    for (const p of idle) {
      const id = p.Id ?? p.id;
      try {
        await prisma.$executeRawUnsafe(`KILL CONNECTION ${id}`);
        console.log(`  Killed connection ${id} (user: ${p.User ?? p.user}, time: ${p.Time ?? p.time}s)`);
        killed++;
      } catch (err) {
        console.warn(`  Could not kill ${id}: ${err.message}`);
      }
    }

    console.log(`\n✔ Killed ${killed}/${idle.length} idle connection(s).`);
    console.log("You can now retry: npx prisma migrate deploy");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
