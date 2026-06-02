import { execSync } from "child_process";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 8000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Inject connection_limit=1 so the schema engine doesn't compete for slots
// with existing production Lambda instances during Vercel build.
function patchDatabaseUrl() {
  const base = process.env.DATABASE_URL ?? "";
  if (!base) return;
  try {
    const url = new URL(base);
    url.searchParams.set("connection_limit", "1");
    url.searchParams.set("connect_timeout", "60");
    process.env.DATABASE_URL = url.toString();
  } catch {
    // unparseable URL — leave as-is and let prisma report the real error
  }
}

async function runMigrate() {
  patchDatabaseUrl();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\n▶ prisma migrate deploy (attempt ${attempt}/${MAX_RETRIES})`);
      execSync("prisma migrate deploy", { stdio: "inherit" });
      console.log("✔ Migrations applied successfully.");
      return;
    } catch (err) {
      const isConnectionError =
        /too many connections|08004|1040|ECONNREFUSED|connect_timeout/i.test(
          err.message ?? ""
        );

      if (!isConnectionError || attempt === MAX_RETRIES) {
        console.error(`✖ Migration failed after ${attempt} attempt(s).`);
        process.exit(1);
      }

      console.warn(
        `  Connection error on attempt ${attempt}. Waiting ${RETRY_DELAY_MS / 1000}s before retry…`
      );
      await sleep(RETRY_DELAY_MS);
    }
  }
}

runMigrate();
