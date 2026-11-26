import { beforeEach, describe, expect, it } from "vitest";
import db from "../../app/db.server";
import { claimNextJob, createWorkerBulkJob, requestCancel } from "../../app/lib/bulkJobs/queue.server";
import { processJob } from "../../app/lib/bulkJobs/processor.server";
import { createWorkerRunner } from "../../app/worker/runner.server";
import {
  aiError,
  buildDeps,
  createFakeGenerators,
  createFakeShopify,
  createShop,
  productGid,
  productSettings,
  resetDatabase,
  shopCredits,
  shopDomain,
  silentLogger,
  TEST_CONFIG,
} from "../support/fixtures";

const CREDITS_PER_ITEM = 2;

async function newJob(shop, count, { startCredits = 100000, settings = {} } = {}) {
  await createShop(shop, startCredits);
  return createWorkerBulkJob({
    shop,
    jobType: "product",
    items: Array.from({ length: count }, (_, i) => ({ resourceId: productGid(i + 1) })),
    contentTypes: ["description", "meta_title"],
    settings: productSettings({ creditsPerItem: CREDITS_PER_ITEM, ...settings }),
    requiredCredits: count * CREDITS_PER_ITEM,
  });
}

/** Claim and process jobs until nothing claimable is left. */
async function drain(workerId, deps, config = TEST_CONFIG) {
  const outcomes = [];
  for (;;) {
    const job = await claimNextJob(workerId, { leaseMs: config.leaseMs });
    if (!job) return outcomes;
    const outcome = await processJob(job, { workerId, config, deps, logger: silentLogger });
    if (outcome.outcome === "aborted") {
      throw new Error(`processJob aborted unexpectedly: ${outcome.error?.stack || outcome.error}`);
    }
    outcomes.push(outcome);
  }
}

async function getJob(jobId) {
  return db.bulkJob.findUnique({ where: { id: jobId } });
}

async function itemStatusCounts(jobId) {
  const rows = await db.bulkJobItem.groupBy({ by: ["status"], where: { jobId }, _count: true });
  return Object.fromEntries(rows.map((r) => [r.status, r._count]));
}

async function waitFor(predicate, { timeoutMs = 30000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timed out");
}

beforeEach(resetDatabase);

describe("processing jobs of different sizes", () => {
  for (const count of [10, 30, 100, 300, 631]) {
    it(`processes all ${count} products in batches of 10 and charges exactly once per product`, async () => {
      const shop = shopDomain(`size-${count}`);
      const shopify = createFakeShopify();
      const generators = createFakeGenerators();
      const { jobId } = await newJob(shop, count);

      await drain("worker-a", buildDeps({ shopify, generators }));

      const job = await getJob(jobId);
      expect(job).toMatchObject({
        status: "completed",
        completedItems: count,
        failedItems: 0,
        creditsAllocated: count * CREDITS_PER_ITEM,
        creditsUsed: count * CREDITS_PER_ITEM,
        creditsRefunded: 0,
        lockedBy: null,
      });
      expect(job.completedAt).not.toBeNull();
      expect(await itemStatusCounts(jobId)).toEqual({ completed: count });
      // Only one batch of product data is ever fetched at a time.
      expect(shopify.calls.batchSizes.every((n) => n <= 10)).toBe(true);
      expect(shopify.calls.batchSizes).toHaveLength(Math.ceil(count / 10));
      expect(generators.calls.generate).toBe(count);
      expect([...generators.attemptsById.values()].every((n) => n === 1)).toBe(true);
      expect(JSON.parse(job.completedItemIds)).toHaveLength(count);
      expect(await shopCredits(shop)).toEqual({
        credits: 100000 - count * CREDITS_PER_ITEM,
        creditsUsedTotal: count * CREDITS_PER_ITEM,
      });
    });
  }

  it("respects a configurable batch size", async () => {
    const shopify = createFakeShopify();
    await newJob(shopDomain("batch-size"), 45);
    await drain("worker-a", buildDeps({ shopify }), { ...TEST_CONFIG, batchSize: 20 });
    expect(shopify.calls.batchSizes).toEqual([20, 20, 5]);
  });
});

describe("AI failures", () => {
  it("retries temporary AI errors and still completes every product", async () => {
    const generators = createFakeGenerators((id, attempt) => {
      if (attempt === 1 && Number(id.split("/").pop()) <= 5) throw aiError("Rate limit reached", 429);
    });
    const { jobId } = await newJob(shopDomain("ai-retry"), 20);

    await drain("worker-a", buildDeps({ generators }));

    expect(await getJob(jobId)).toMatchObject({ status: "completed", completedItems: 20, creditsUsed: 40 });
    expect(generators.attemptsById.get(productGid(1))).toBe(2);
    expect(generators.attemptsById.get(productGid(6))).toBe(1);
  });

  it("fails an item after the maximum retries and refunds its credits (partial job)", async () => {
    const shop = shopDomain("ai-exhausted");
    const generators = createFakeGenerators((id) => {
      if (id === productGid(3)) throw aiError("Service unavailable", 503);
    });
    const { jobId } = await newJob(shop, 10);

    await drain("worker-a", buildDeps({ generators }));

    const job = await getJob(jobId);
    expect(job).toMatchObject({ status: "partial", completedItems: 9, failedItems: 1, creditsUsed: 18, creditsRefunded: 2 });
    expect(generators.attemptsById.get(productGid(3))).toBe(TEST_CONFIG.maxRetries);
    const failed = JSON.parse(job.failedItemIds);
    expect(failed).toEqual([expect.objectContaining({ id: productGid(3), error: "Service unavailable" })]);
    expect(await shopCredits(shop)).toEqual({ credits: 100000 - 18, creditsUsedTotal: 18 });
  });

  it("does not retry a permanent AI error", async () => {
    const generators = createFakeGenerators((id) => {
      if (id === productGid(2)) throw aiError("Invalid request", 400);
    });
    const { jobId } = await newJob(shopDomain("ai-permanent"), 5);

    await drain("worker-a", buildDeps({ generators }));

    expect(generators.attemptsById.get(productGid(2))).toBe(1);
    expect(await getJob(jobId)).toMatchObject({ status: "partial", completedItems: 4, failedItems: 1 });
  });

  it("stops the whole job when the AI key is rejected and refunds everything not generated", async () => {
    const shop = shopDomain("ai-key");
    const generators = createFakeGenerators((id) => {
      if (Number(id.split("/").pop()) > 12) throw aiError("Incorrect API key provided", 401);
    });
    const { jobId } = await newJob(shop, 40);

    await drain("worker-a", buildDeps({ generators }));

    const job = await getJob(jobId);
    expect(job.status).toBe("partial");
    expect(job.completedItems).toBe(12);
    expect(job.failedItems).toBe(28);
    expect(job.creditsRefunded).toBe(56);
    expect(job.lastError).toContain("Incorrect API key");
    expect(generators.calls.generate).toBeLessThan(40); // later batches never started
    expect(await shopCredits(shop)).toEqual({ credits: 100000 - 24, creditsUsedTotal: 24 });
  });
});

describe("Shopify failures", () => {
  it("backs off and retries when Shopify throttles requests", async () => {
    const shopify = createFakeShopify({ throttleFirst: 2 });
    const { jobId } = await newJob(shopDomain("throttle"), 15);

    await drain("worker-a", buildDeps({ shopify }));

    expect(shopify.calls.throttled).toBe(2);
    expect(await getJob(jobId)).toMatchObject({ status: "completed", completedItems: 15 });
  });

  it("fails deleted or inaccessible products without charging for them", async () => {
    const shop = shopDomain("deleted");
    const shopify = createFakeShopify({ missing: new Set([productGid(4), productGid(17)]) });
    const generators = createFakeGenerators();
    const { jobId } = await newJob(shop, 20);

    await drain("worker-a", buildDeps({ shopify, generators }));

    const job = await getJob(jobId);
    expect(job).toMatchObject({ status: "partial", completedItems: 18, failedItems: 2, creditsUsed: 36, creditsRefunded: 4 });
    expect(generators.attemptsById.has(productGid(4))).toBe(false);
    expect(JSON.parse(job.failedItemIds).map((f) => f.error)).toEqual([
      "Product no longer exists or is no longer accessible in Shopify.",
      "Product no longer exists or is no longer accessible in Shopify.",
    ]);
  });

  it("fails the job and refunds all credits when the store's session is gone (uninstalled / token revoked)", async () => {
    const shop = shopDomain("no-session");
    const authError = Object.assign(new Error("Could not find a session for shop"), { name: "SessionNotFoundError" });
    const { jobId } = await newJob(shop, 25);

    await drain("worker-a", buildDeps({ shopify: createFakeShopify({ authError }) }));

    const job = await getJob(jobId);
    expect(job).toMatchObject({ status: "failed", completedItems: 0, failedItems: 25, creditsRefunded: 50 });
    expect(job.lastError).toContain("Could not access the Shopify store");
    expect(await shopCredits(shop)).toEqual({ credits: 100000, creditsUsedTotal: 0 });
  });

  it("fails the job when Shopify rejects the access token", async () => {
    const shop = shopDomain("token-401");
    const shopify = createFakeShopify();
    const deps = buildDeps({ shopify });
    deps.getAdminContext = async () => ({
      admin: {
        graphql: async () => { throw Object.assign(new Error("Unauthorized"), { response: { code: 401 } }); },
      },
      session: { accessToken: "expired" },
    });
    const { jobId } = await newJob(shop, 5);

    await drain("worker-a", deps);

    expect(await getJob(jobId)).toMatchObject({ status: "failed", creditsRefunded: 10 });
    expect(await shopCredits(shop)).toEqual({ credits: 100000, creditsUsedTotal: 0 });
  });
});

describe("crash recovery", () => {
  it("resumes after a worker dies mid-batch, without double processing or double charging", async () => {
    const shop = shopDomain("crash");
    let releaseHang;
    const hang = new Promise((resolve) => { releaseHang = resolve; });
    const generators = createFakeGenerators(async (id, attempt) => {
      // Worker A freezes on product 25 (think: VPS restart mid-request).
      if (id === productGid(25) && attempt === 1) await hang;
    });
    const deps = buildDeps({ generators });
    const { jobId } = await newJob(shop, 50);

    const jobA = await claimNextJob("worker-a", { leaseMs: TEST_CONFIG.leaseMs });
    const zombie = processJob(jobA, { workerId: "worker-a", config: TEST_CONFIG, deps, logger: silentLogger });
    await waitFor(async () => (await getJob(jobId)).completedItems === 29);

    // Worker A stops heartbeating; its lease expires.
    await db.bulkJob.update({ where: { id: jobId }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await drain("worker-b", deps);
    expect((await getJob(jobId)).status).toBe("completed");

    // The frozen worker wakes up: its late writes must be rejected.
    releaseHang();
    expect(await zombie).toEqual({ outcome: "lease_lost" });

    const job = await getJob(jobId);
    expect(job).toMatchObject({ status: "completed", completedItems: 50, failedItems: 0, creditsUsed: 100, creditsRefunded: 0 });
    expect(await itemStatusCounts(jobId)).toEqual({ completed: 50 });
    expect(JSON.parse(job.completedItemIds)).toHaveLength(50);
    expect(await shopCredits(shop)).toEqual({ credits: 100000 - 100, creditsUsedTotal: 100 });
    const reprocessed = [...generators.attemptsById.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(reprocessed).toEqual([productGid(25)]); // only the item that was in flight
  });

  it("fails an item that keeps getting interrupted instead of looping forever", async () => {
    const { jobId } = await newJob(shopDomain("poison"), 3);
    const poison = await db.bulkJobItem.findFirst({ where: { jobId, position: 1 } });
    await db.bulkJobItem.update({ where: { id: poison.id }, data: { attempts: TEST_CONFIG.maxItemAttempts } });

    await drain("worker-a", buildDeps());

    expect(await getJob(jobId)).toMatchObject({ status: "partial", completedItems: 2, failedItems: 1, creditsRefunded: 2 });
    expect((await db.bulkJobItem.findUnique({ where: { id: poison.id } })).error).toContain("interrupted repeatedly");
  });

  it("releases its job on graceful shutdown so another worker resumes from where it stopped", async () => {
    const { jobId } = await newJob(shopDomain("shutdown"), 30);
    const generators = createFakeGenerators();
    const deps = buildDeps({ generators });
    let stop = false;
    const behaviourAfterFirstBatch = deps.generateProductItem;
    deps.generateProductItem = async (item, ...rest) => {
      await behaviourAfterFirstBatch(item, ...rest);
      if (generators.calls.generate >= 10) stop = true;
    };

    const job = await claimNextJob("worker-a", { leaseMs: TEST_CONFIG.leaseMs });
    const result = await processJob(job, { workerId: "worker-a", config: TEST_CONFIG, deps, logger: silentLogger, shouldStop: () => stop });
    expect(result).toEqual({ outcome: "released" });
    expect(await getJob(jobId)).toMatchObject({ status: "processing", completedItems: 10, lockedBy: null });

    await drain("worker-b", buildDeps({ generators }));
    expect(await getJob(jobId)).toMatchObject({ status: "completed", completedItems: 30, creditsUsed: 60 });
    expect(generators.calls.generate).toBe(30);
  });
});

describe("cancellation", () => {
  it("stops a running job at the next item, keeps completed work, and refunds the rest", async () => {
    const shop = shopDomain("cancel-mid");
    let jobId;
    const generators = createFakeGenerators(async (id) => {
      if (id === productGid(35)) await requestCancel({ jobId, shop });
    });
    ({ jobId } = await newJob(shop, 100));

    await drain("worker-a", buildDeps({ generators }));

    const job = await getJob(jobId);
    expect(job.status).toBe("cancelled");
    // Items of the batch already in flight when the cancel arrived may finish;
    // nothing after that batch is started.
    expect(job.completedItems).toBeGreaterThanOrEqual(30);
    expect(job.completedItems).toBeLessThanOrEqual(40);
    expect(generators.calls.generate).toBeLessThanOrEqual(40);
    const counts = await itemStatusCounts(jobId);
    expect(counts.completed).toBe(job.completedItems);
    expect(counts.cancelled).toBe(100 - job.completedItems);
    expect(job.creditsRefunded).toBe(200 - job.completedItems * CREDITS_PER_ITEM);
    expect(await shopCredits(shop)).toEqual({
      credits: 100000 - job.completedItems * CREDITS_PER_ITEM,
      creditsUsedTotal: job.completedItems * CREDITS_PER_ITEM,
    });
  });
});

describe("several shops and workers", () => {
  it("processes jobs from different shops with two workers, each item exactly once, credits kept separate", async () => {
    const jobs = [];
    for (const [name, count] of [["alpha", 37], ["beta", 52], ["gamma", 18], ["delta", 64]]) {
      const shop = shopDomain(`workers-${name}`);
      const { jobId } = await newJob(shop, count);
      jobs.push({ shop, jobId, count });
    }
    const generators = createFakeGenerators(async () => {
      await new Promise((r) => setTimeout(r, 1)); // let the two workers interleave
    });
    const deps = buildDeps({ generators });
    const config = { ...TEST_CONFIG, concurrency: 2 };
    const runners = [
      createWorkerRunner({ config, deps, workerId: "worker-1", logger: silentLogger }),
      createWorkerRunner({ config, deps, workerId: "worker-2", logger: silentLogger }),
    ];
    const running = runners.map((r) => r.run());

    await waitFor(async () => (await db.bulkJob.count({ where: { refundedAt: null } })) === 0, { timeoutMs: 60000 });
    runners.forEach((r) => r.stop());
    await Promise.all(running);

    for (const { shop, jobId, count } of jobs) {
      expect(await getJob(jobId)).toMatchObject({ status: "completed", completedItems: count, creditsUsed: count * 2 });
      expect(await shopCredits(shop)).toEqual({ credits: 100000 - count * 2, creditsUsedTotal: count * 2 });
    }
    // Product GIDs repeat across shops, so count generator calls instead of ids.
    expect(generators.calls.generate).toBe(37 + 52 + 18 + 64);
  });
});
