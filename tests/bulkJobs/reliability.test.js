import { beforeEach, describe, expect, it } from "vitest";
import db from "../../app/db.server";
import {
  claimJob,
  claimNextJob,
  completeItem,
  createWorkerBulkJob,
  finalizeJob,
  getNextPendingItems,
  requestCancel,
} from "../../app/lib/bulkJobs/queue.server";
import { processJob } from "../../app/lib/bulkJobs/processor.server";
import { getSavedContentTimestamps } from "../../app/lib/bulkJobs/savedContent.server";
import { LeaseLostError } from "../../app/lib/bulkJobs/errors.server";
import {
  aiError,
  buildDeps,
  createFakeGenerators,
  createFakeShopify,
  createFakeWriteBack,
  createShop,
  productGid,
  productSettings,
  resetDatabase,
  shopCredits,
  shopDomain,
  shopifyError,
  silentLogger,
  TEST_CONFIG,
} from "../support/fixtures";

const START = 100000;

async function newJob(shop, count, { contentTypes = ["description", "meta_title"], creditsPerItem = 2, settings = {} } = {}) {
  await createShop(shop, START);
  return createWorkerBulkJob({
    shop,
    jobType: "product",
    items: Array.from({ length: count }, (_, i) => ({ resourceId: productGid(i + 1) })),
    contentTypes,
    settings: productSettings({ contentTypes, creditsPerItem, ...settings }),
    requiredCredits: count * creditsPerItem,
  });
}

async function drain(workerId, deps, config = TEST_CONFIG) {
  for (;;) {
    const job = await claimNextJob(workerId, { leaseMs: config.leaseMs });
    if (!job) return;
    const outcome = await processJob(job, { workerId, config, deps, logger: silentLogger });
    if (outcome.outcome === "aborted") throw new Error(`processJob aborted: ${outcome.error?.stack || outcome.error}`);
  }
}

const getJob = (jobId) => db.bulkJob.findUnique({ where: { id: jobId } });
const getItem = (jobId, n) => db.bulkJobItem.findFirst({ where: { jobId, resourceId: productGid(n) } });

async function waitFor(predicate, { timeoutMs = 30000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timed out");
}

async function expireLease(jobId) {
  await db.bulkJob.update({ where: { id: jobId }, data: { lockedUntil: new Date(Date.now() - 1000) } });
}

beforeEach(resetDatabase);

describe("Shopify write-back", () => {
  it("records a permanent write-back failure without regenerating, keeps the charge, and marks the job partial", async () => {
    const shop = shopDomain("wb-permanent");
    const generators = createFakeGenerators();
    const writeBack = createFakeWriteBack((id) => {
      if (id === productGid(3)) {
        throw shopifyError("Shopify rejected the product update: Title can't be blank", undefined, { userErrors: [{ message: "Title can't be blank" }] });
      }
    });
    const { jobId } = await newJob(shop, 10);

    await drain("worker-a", buildDeps({ generators, writeBack }));

    const job = await getJob(jobId);
    expect(job).toMatchObject({
      status: "partial",
      completedItems: 10,
      failedItems: 0,
      writeBackFailedItems: 1,
      creditsUsed: 20,
      creditsRefunded: 0,
    });
    expect(await getItem(jobId, 3)).toMatchObject({
      status: "completed",
      writeBackStatus: "failed",
      writeBackError: expect.stringContaining("Title can't be blank"),
    });
    expect(await db.bulkJobItem.count({ where: { jobId, writeBackStatus: "applied" } })).toBe(9);
    expect(writeBack.attemptsById.get(productGid(3))).toBe(1); // permanent: not retried
    expect(generators.calls.generate).toBe(10); // no regeneration because of the failed save
    expect(await shopCredits(shop)).toEqual({ credits: START - 20, creditsUsedTotal: 20 });
  });

  it("retries temporary Shopify write-back errors and then applies the content", async () => {
    const generators = createFakeGenerators();
    const writeBack = createFakeWriteBack((id, attempt) => {
      if (attempt === 1 && Number(id.split("/").pop()) <= 4) {
        throw shopifyError("Shopify request failed with status 429.", 429, { retryAfter: 0 });
      }
      if (attempt === 1 && id === productGid(5)) throw shopifyError("Shopify request failed with status 502.", 502);
    });
    const { jobId } = await newJob(shopDomain("wb-retry"), 10);

    await drain("worker-a", buildDeps({ generators, writeBack }));

    expect(await getJob(jobId)).toMatchObject({ status: "completed", completedItems: 10, writeBackFailedItems: 0 });
    expect(await db.bulkJobItem.count({ where: { jobId, writeBackStatus: "applied" } })).toBe(10);
    expect(writeBack.attemptsById.get(productGid(1))).toBe(2);
    expect(writeBack.attemptsById.get(productGid(5))).toBe(2);
    expect(generators.calls.generate).toBe(10);
  });

  it("marks the save failed after the retry limit is reached", async () => {
    const writeBack = createFakeWriteBack((id) => {
      if (id === productGid(2)) throw shopifyError("Shopify request failed with status 503.", 503);
    });
    const { jobId } = await newJob(shopDomain("wb-exhausted"), 4);

    await drain("worker-a", buildDeps({ writeBack }));

    expect(writeBack.attemptsById.get(productGid(2))).toBe(TEST_CONFIG.maxRetries);
    expect(await getJob(jobId)).toMatchObject({ status: "partial", writeBackFailedItems: 1, completedItems: 4 });
  });

  it("stops the job when Shopify rejects the token during write-back; generated items stay charged, the rest are refunded", async () => {
    const shop = shopDomain("wb-401");
    const writeBack = createFakeWriteBack((id) => {
      if (Number(id.split("/").pop()) > 12) throw shopifyError("Shopify request failed with status 401.", 401);
    });
    const generators = createFakeGenerators();
    const { jobId } = await newJob(shop, 30);

    await drain("worker-a", buildDeps({ generators, writeBack }));

    const job = await getJob(jobId);
    // Batch 2 items already past the start check finish generating (charged);
    // those from 13 on can't be saved. Nothing after batch 2 is generated.
    const generated = job.completedItems;
    expect(job.status).toBe("partial");
    expect(generated).toBeGreaterThanOrEqual(13);
    expect(generated).toBeLessThanOrEqual(20);
    expect(job.failedItems).toBe(30 - generated);
    expect(job.writeBackFailedItems).toBe(generated - 12);
    expect(job.creditsRefunded).toBe((30 - generated) * 2);
    expect(generators.calls.generate).toBe(generated);
    expect(await shopCredits(shop)).toEqual({ credits: START - generated * 2, creditsUsedTotal: generated * 2 });
  });

  it("does not write back or mark anything when there is nothing to save", async () => {
    // contentTypes "schema" only: written by the generation step itself, no product update.
    const writeBack = createFakeWriteBack();
    const { jobId } = await newJob(shopDomain("wb-none"), 3, { contentTypes: ["schema"], creditsPerItem: 1 });

    await drain("worker-a", buildDeps({ writeBack }));

    expect(writeBack.calls.write).toBe(0);
    expect(await db.bulkJobItem.count({ where: { jobId, writeBackStatus: "skipped" } })).toBe(3);
    expect(await getJob(jobId)).toMatchObject({ status: "completed", completedItems: 3 });
  });
});

describe("crash recovery between generation, charging and saving", () => {
  it("resumes a crash after charging but before the Shopify save by saving only — no regeneration, no second charge", async () => {
    const shop = shopDomain("crash-before-save");
    let release;
    const hang = new Promise((resolve) => { release = resolve; });
    const generators = createFakeGenerators();
    const writeBack = createFakeWriteBack(async (id, attempt) => {
      if (id === productGid(15) && attempt === 1) await hang;
    });
    const deps = buildDeps({ generators, writeBack });
    const { jobId } = await newJob(shop, 30);

    const job = await claimNextJob("worker-a", { leaseMs: TEST_CONFIG.leaseMs });
    const zombie = processJob(job, { workerId: "worker-a", config: TEST_CONFIG, deps, logger: silentLogger });
    await waitFor(async () => (await getItem(jobId, 15))?.writeBackStatus === "pending"
      && (await getJob(jobId)).completedItems === 20);

    await expireLease(jobId);
    await drain("worker-b", deps);
    release();
    expect(await zombie).toEqual({ outcome: "lease_lost" });

    const final = await getJob(jobId);
    expect(final).toMatchObject({ status: "completed", completedItems: 30, writeBackFailedItems: 0, creditsUsed: 60, creditsRefunded: 0 });
    expect(await getItem(jobId, 15)).toMatchObject({ status: "completed", writeBackStatus: "applied" });
    expect([...generators.attemptsById.values()].every((n) => n === 1)).toBe(true); // nothing regenerated
    expect(generators.logCount(productGid(15))).toBe(1);
    expect(await shopCredits(shop)).toEqual({ credits: START - 60, creditsUsedTotal: 60 });
  });

  it("resumes a crash after content was saved but before the item was completed without regenerating or re-logging", async () => {
    const shop = shopDomain("crash-after-save");
    let release;
    const hang = new Promise((resolve) => { release = resolve; });
    const generators = createFakeGenerators(() => {}, {
      afterSave: async (id, attempt) => {
        if (id === productGid(25) && attempt === 1) await hang;
      },
    });
    const writeBack = createFakeWriteBack();
    const deps = buildDeps({ generators, writeBack });
    const { jobId } = await newJob(shop, 40);

    const job = await claimNextJob("worker-a", { leaseMs: TEST_CONFIG.leaseMs });
    const zombie = processJob(job, { workerId: "worker-a", config: TEST_CONFIG, deps, logger: silentLogger });
    await waitFor(async () => (await getJob(jobId)).completedItems === 29);

    await expireLease(jobId);
    await drain("worker-b", deps);
    release();
    expect(await zombie).toEqual({ outcome: "lease_lost" });

    expect(generators.attemptsById.get(productGid(25))).toBe(1); // skipped on resume
    expect(generators.logCount(productGid(25))).toBe(1); // one generation log
    expect(await getItem(jobId, 25)).toMatchObject({ status: "completed", attempts: 2, creditsCharged: 2, writeBackStatus: "applied" });
    expect(await getJob(jobId)).toMatchObject({ status: "completed", completedItems: 40, creditsUsed: 80 });
    expect(await shopCredits(shop)).toEqual({ credits: START - 80, creditsUsedTotal: 80 });
  });

  it("retries only the failed step of an item, so earlier steps are not regenerated or logged twice", async () => {
    const generators = createFakeGenerators((id, attempt, step) => {
      if (step === "faq" && id === productGid(2) && attempt === 1) throw aiError("Overloaded", 529);
    });
    const { jobId } = await newJob(shopDomain("step-retry"), 3, { contentTypes: ["description", "faq"], creditsPerItem: 6 });

    await drain("worker-a", buildDeps({ generators }));

    expect(await getJob(jobId)).toMatchObject({ status: "completed", completedItems: 3, creditsUsed: 18 });
    expect(generators.stepAttempts.get(`standard:${productGid(2)}`)).toBe(1);
    expect(generators.stepAttempts.get(`faq:${productGid(2)}`)).toBe(2);
    expect(generators.logCount(productGid(2), "standard")).toBe(1);
    expect(generators.logCount(productGid(2), "faq")).toBe(1);
  });
});

describe("cancellation during a running batch", () => {
  it("saves the items already generated in the batch, cancels the rest, and refunds exactly the unprocessed credits", async () => {
    const shop = shopDomain("cancel-batch");
    let jobId;
    const generators = createFakeGenerators(async (id) => {
      if (id === productGid(14)) await requestCancel({ jobId, shop });
    });
    const writeBack = createFakeWriteBack();
    ({ jobId } = await newJob(shop, 50));

    await drain("worker-a", buildDeps({ generators, writeBack }));

    const job = await getJob(jobId);
    const completed = job.completedItems;
    expect(job.status).toBe("cancelled");
    expect(completed).toBeGreaterThanOrEqual(10);
    expect(completed).toBeLessThanOrEqual(20);
    expect(await db.bulkJobItem.count({ where: { jobId, status: "completed", writeBackStatus: "applied" } })).toBe(completed);
    expect(writeBack.applied.size).toBe(completed);
    expect(await db.bulkJobItem.count({ where: { jobId, status: "cancelled" } })).toBe(50 - completed);
    expect(job.creditsUsed + job.creditsRefunded).toBe(job.creditsAllocated);
    expect(await shopCredits(shop)).toEqual({ credits: START - completed * 2, creditsUsedTotal: completed * 2 });
  });
});

describe("concurrent finalization and refunds", () => {
  it("never charges an item after its job was refunded, whatever order a charge and a finalize land in", async () => {
    for (let round = 0; round < 10; round += 1) {
      await resetDatabase();
      const shop = shopDomain(`race-${round}`);
      const { jobId } = await newJob(shop, 5);
      await claimJob(jobId, "worker-a", { leaseMs: 60000 });
      const items = await getNextPendingItems(jobId, 5);

      const results = await Promise.allSettled([
        finalizeJob({ jobId, workerId: "worker-a", outcome: "cancelled" }),
        ...items.map((item) => completeItem({ jobId, workerId: "worker-a", item, title: "P", creditsPerItem: 2 })),
      ]);

      for (const r of results.slice(1)) {
        if (r.status === "rejected") expect(r.reason).toBeInstanceOf(LeaseLostError);
      }
      const job = await getJob(jobId);
      const charged = await db.bulkJobItem.count({ where: { jobId, status: "completed" } });
      expect(job.completedItems).toBe(charged);
      expect(job.creditsUsed).toBe(charged * 2);
      expect(job.creditsUsed + job.creditsRefunded).toBe(10);
      expect(await shopCredits(shop)).toEqual({ credits: START - charged * 2, creditsUsedTotal: charged * 2 });
    }
  });

  it("refunds once when the merchant cancels just as the worker finishes the job", async () => {
    const shop = shopDomain("cancel-vs-done");
    const { jobId } = await newJob(shop, 3);
    await claimJob(jobId, "worker-a", { leaseMs: 60000 });
    const items = await getNextPendingItems(jobId, 3);
    await completeItem({ jobId, workerId: "worker-a", item: items[0], title: "P", creditsPerItem: 2 });
    await db.bulkJobItem.updateMany({ where: { jobId, status: "pending" }, data: { status: "failed" } });

    await Promise.allSettled([
      finalizeJob({ jobId, workerId: "worker-a", outcome: "done" }),
      requestCancel({ jobId, shop }),
      finalizeJob({ jobId, workerId: "worker-a", outcome: "cancelled" }),
    ]);

    const job = await getJob(jobId);
    expect(job.refundedAt).not.toBeNull();
    expect(job.creditsRefunded).toBe(4);
    expect(await shopCredits(shop)).toEqual({ credits: START - 2, creditsUsedTotal: 2 });
  });
});

describe("Shopify session problems", () => {
  it("picks up the current token and carries on when the one in hand was retired mid-batch", async () => {
    // The embedded app ran a token exchange while the worker held the old token:
    // Shopify retires the old token, so it now gets 401s.
    const shop = shopDomain("token-retired");
    const shopify = createFakeShopify();
    const writeBack = createFakeWriteBack();
    const deps = buildDeps({ shopify, writeBack });
    let contextCalls = 0;
    const baseGetAdminContext = deps.getAdminContext;
    deps.getAdminContext = async (s) => {
      contextCalls += 1;
      const ctx = await baseGetAdminContext(s);
      return { ...ctx, session: { accessToken: contextCalls === 1 ? "retired-token" : "current-token" } };
    };
    const write = deps.writeProductContentToShopify;
    deps.writeProductContentToShopify = async (s, token, ...rest) => {
      if (token === "retired-token") throw shopifyError("Shopify request failed with status 401.", 401);
      return write(s, token, ...rest);
    };
    const { jobId } = await newJob(shop, 10);

    await drain("worker-a", deps);

    expect(await getJob(jobId)).toMatchObject({ status: "completed", completedItems: 10, writeBackFailedItems: 0 });
    expect(writeBack.applied.size).toBe(10);
    expect(contextCalls).toBeGreaterThanOrEqual(2);
  });

  it("stops with a clear message (instead of looping) when the token can't be refreshed", async () => {
    const shop = shopDomain("refresh-fails");
    // What the Shopify library throws when a refresh is rejected.
    const refreshFailure = new Response(undefined, { status: 500, statusText: "Internal Server Error" });
    const shopify = createFakeShopify();
    const deps = buildDeps({ shopify });
    let calls = 0;
    deps.getAdminContext = async () => { calls += 1; throw refreshFailure; };
    const { jobId } = await newJob(shop, 12);

    await drain("worker-a", deps);

    expect(calls).toBe(5);
    const job = await getJob(jobId);
    expect(job).toMatchObject({ status: "failed", failedItems: 12, creditsRefunded: 24 });
    expect(job.lastError).toContain("Reopen the app");
    expect(await shopCredits(shop)).toEqual({ credits: START, creditsUsedTotal: 0 });
  });
});

describe("saved-content lookup (real tables)", () => {
  it("reports when each step's content was last saved", async () => {
    const shop = shopDomain("saved-lookup");
    const productId = productGid(77);
    const empty = await getSavedContentTimestamps({ jobType: "product", shop, item: { id: productId } });
    expect(empty).toEqual({ standard: null, schema: null, faq: null });

    await db.productGeneratedContent.create({ data: { shop, productId, descriptionHtml: "<p>x</p>" } });
    await db.aiVisibilityFaq.create({ data: { shop, resourceType: "product", resourceId: productId, faqJson: "{}" } });

    const saved = await getSavedContentTimestamps({ jobType: "product", shop, item: { id: productId } });
    expect(saved.standard).toBeInstanceOf(Date);
    expect(saved.faq).toBeInstanceOf(Date);
    expect(saved.schema).toBeNull();

    await db.productGeneratedContent.deleteMany({ where: { shop } });
    await db.aiVisibilityFaq.deleteMany({ where: { shop } });
  });
});
