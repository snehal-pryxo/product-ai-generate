import { execSync } from "child_process";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 8000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isConnectionError(message = "") {
  return /too many connections|08004|1040|ECONNREFUSED|connect_timeout|connection refused/i.test(
    message
  );
}

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

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\n▶ prisma migrate deploy (attempt ${attempt}/${MAX_RETRIES})`);
      execSync("prisma migrate deploy", { stdio: "inherit" });
      console.log("✔ Migrations applied successfully.");
      return;
    } catch (err) {
      lastError = err;
      const errText = String(err?.message ?? "") + String(err?.stderr ?? "") + String(err?.stdout ?? "");
      const connErr = isConnectionError(errText);

      if (!connErr) {
        // Schema error, bad credentials, etc. — fail the build immediately.
        console.error("\n✖ Migration failed (non-connection error). Aborting build.");
        process.exit(1);
      }

      if (attempt < MAX_RETRIES) {
        console.warn(
          `  Connection error on attempt ${attempt}. Waiting ${RETRY_DELAY_MS / 1000}s before retry…`
        );
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  // All retries exhausted with connection errors only.
  // The DB server is at max_connections (typically from production Lambda
  // instances running without the connection-limit fix).
  // We proceed with a warning instead of failing the build so this deployment
  // — which contains the connection-limit fix — can actually land and reduce
  // the connection count going forward.
  // If there ARE pending schema migrations this is unsafe; log loudly.
  console.warn(`
⚠️  WARNING: prisma migrate deploy could not connect after ${MAX_RETRIES} attempts.
    Reason: MySQL max_connections exhausted (error 1040).
    The build will continue so the connection-pool fix can be deployed.
    Ensure no pending schema migrations are present.
    After this deployment reduces Lambda connections, run migrations manually.
`);
}

runMigrate();
