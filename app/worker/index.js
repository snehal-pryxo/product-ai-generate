// Entry point for the bulk generation worker container (`npm run worker:start`).
// Runs separately from the web app; both share the database.

// The web app caps its pool at 3 connections; the worker runs several jobs and
// up to `batchSize` items in parallel, so give it more unless configured.
process.env.DB_CONNECTION_LIMIT ||= "15";

const { getWorkerConfig } = await import("../lib/bulkJobs/config.server");
const { createProductionDeps } = await import("../lib/bulkJobs/deps.server");
const { createWorkerRunner } = await import("./runner.server");
const { default: db } = await import("../db.server");

const config = getWorkerConfig();
const runner = createWorkerRunner({ config, deps: createProductionDeps() });

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[bulk-worker] ${signal} received — finishing in-flight batches`);
  runner.stop();
  // Hard stop if a batch hangs; leases expire and jobs resume elsewhere.
  setTimeout(() => process.exit(1), 60000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("[bulk-worker] unhandled rejection:", reason);
});

try {
  await runner.run();
} finally {
  await db.$disconnect().catch(() => {});
}
process.exit(0);
