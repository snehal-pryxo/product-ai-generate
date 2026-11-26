// The bulk worker loop: keeps up to `concurrency` jobs running, claiming new
// ones as slots free up. Stopping is graceful — in-flight batches finish and
// their jobs are released so another worker resumes them immediately.

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { claimNextJob } from "../lib/bulkJobs/queue.server";
import { processJob } from "../lib/bulkJobs/processor.server";

export function createWorkerId() {
  return `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

export function createWorkerRunner({ config, deps, workerId = createWorkerId(), logger = console }) {
  const active = new Map(); // jobId -> promise
  let stopping = false;
  let wake = null;

  const sleep = (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => { clearTimeout(timer); resolve(); };
  });

  async function fillSlots() {
    while (!stopping && active.size < config.concurrency) {
      const job = await claimNextJob(workerId, { leaseMs: config.leaseMs, excludeIds: [...active.keys()] });
      if (!job) return;
      logger.info?.(`[bulk-worker] ${workerId} claimed job ${job.id} (${job.jobType}, ${job.totalItems} items, shop ${job.shop})`);
      const run = processJob(job, { workerId, config, deps, logger, shouldStop: () => stopping })
        .catch((error) => logger.error?.(`[bulk-worker] job ${job.id} crashed: ${error?.stack || error}`))
        .finally(() => {
          active.delete(job.id);
          wake?.();
        });
      active.set(job.id, run);
    }
  }

  async function run() {
    logger.info?.(`[bulk-worker] ${workerId} started (concurrency ${config.concurrency}, batch ${config.batchSize})`);
    while (!stopping) {
      try {
        await fillSlots();
      } catch (error) {
        logger.error?.(`[bulk-worker] claim loop error: ${error?.message || error}`);
      }
      await sleep(config.pollIntervalMs);
    }
    await Promise.allSettled([...active.values()]);
    logger.info?.(`[bulk-worker] ${workerId} stopped`);
  }

  function stop() {
    stopping = true;
    wake?.();
  }

  return { run, stop, workerId, get activeCount() { return active.size; } };
}
