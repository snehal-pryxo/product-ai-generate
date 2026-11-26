// Runtime configuration for database-backed bulk jobs. All values come from env
// so the main app and the worker container can be tuned independently.

function intEnv(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  const value = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * "worker"  — new bulk jobs are queued in the database for the bulk worker.
 * "inngest" — new bulk jobs go to Inngest (legacy behaviour; the default until
 *             the worker is deployed and verified).
 */
export function getBulkJobRunner() {
  return String(process.env.BULK_JOB_RUNNER || "inngest").trim().toLowerCase() === "worker" ? "worker" : "inngest";
}

export function getWorkerConfig() {
  return {
    batchSize: intEnv("BULK_BATCH_SIZE", 10, { max: 50 }),
    concurrency: intEnv("BULK_WORKER_CONCURRENCY", 3, { max: 20 }),
    pollIntervalMs: intEnv("BULK_WORKER_POLL_MS", 3000, { min: 250 }),
    leaseMs: intEnv("BULK_JOB_LEASE_MS", 120000, { min: 10000 }),
    maxRetries: intEnv("BULK_MAX_RETRIES", 3, { max: 10 }),
    retryBaseDelayMs: intEnv("BULK_RETRY_BASE_DELAY_MS", 2000, { min: 0 }),
    // How many times an item may be picked up (each worker crash mid-batch
    // counts once) before it is failed as a poison item.
    maxItemAttempts: intEnv("BULK_MAX_ITEM_ATTEMPTS", 5, { max: 50 }),
  };
}
