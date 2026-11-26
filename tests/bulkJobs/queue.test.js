import { beforeEach, describe, expect, it } from "vitest";
import db from "../../app/db.server";
import {
  claimJob,
  claimNextJob,
  completeItem,
  createWorkerBulkJob,
  finalizeJob,
  getNextPendingItems,
  InsufficientCreditsError,
  requestCancel,
} from "../../app/lib/bulkJobs/queue.server";
import { LeaseLostError } from "../../app/lib/bulkJobs/errors.server";
import {
  createShop,
  productGid,
  productSettings,
  resetDatabase,
  shopCredits,
  shopDomain,
} from "../support/fixtures";

const LEASE = { leaseMs: 60000 };

async function newJob(shop, count, { creditsPerItem = 2 } = {}) {
  return createWorkerBulkJob({
    shop,
    jobType: "product",
    items: Array.from({ length: count }, (_, i) => ({ resourceId: productGid(i + 1) })),
    contentTypes: ["description", "meta_title"],
    settings: productSettings({ creditsPerItem }),
    requiredCredits: count * creditsPerItem,
  });
}

beforeEach(resetDatabase);

describe("creating a bulk job", () => {
  it("reserves credits and stores one ID-only item row per product, in one transaction", async () => {
    const shop = shopDomain("create");
    await createShop(shop, 1000);

    const created = await newJob(shop, 25);

    const job = await db.bulkJob.findUnique({ where: { id: created.jobId } });
    expect(job).toMatchObject({ runner: "worker", status: "pending", totalItems: 25, creditsAllocated: 50, itemsData: "[]" });
    const items = await db.bulkJobItem.findMany({ where: { jobId: created.jobId }, orderBy: { position: "asc" } });
    expect(items).toHaveLength(25);
    expect(items.map((i) => i.position)).toEqual([...Array(25).keys()]);
    expect(items[0]).toMatchObject({ resourceId: productGid(1), status: "pending", attempts: 0 });
    expect(await shopCredits(shop)).toEqual({ credits: 950, creditsUsedTotal: 50 });
    expect(created.credits).toBe(950);
  });

  it("creates nothing and charges nothing when credits are insufficient", async () => {
    const shop = shopDomain("poor");
    await createShop(shop, 10);

    await expect(newJob(shop, 25)).rejects.toBeInstanceOf(InsufficientCreditsError);

    expect(await db.bulkJob.count({ where: { shop } })).toBe(0);
    expect(await db.bulkJobItem.count()).toBe(0);
    expect(await shopCredits(shop)).toEqual({ credits: 10, creditsUsedTotal: 0 });
  });

  it("never over-spends credits when two jobs are created at the same moment", async () => {
    const shop = shopDomain("race");
    await createShop(shop, 100);

    const results = await Promise.allSettled([newJob(shop, 30), newJob(shop, 30)]); // 60 credits each

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")[0].reason).toBeInstanceOf(InsufficientCreditsError);
    expect(await db.bulkJob.count({ where: { shop } })).toBe(1);
    expect(await shopCredits(shop)).toEqual({ credits: 40, creditsUsedTotal: 60 });
  });
});

describe("claiming jobs", () => {
  it("lets exactly one of many concurrent workers claim a job", async () => {
    const shop = shopDomain("claim");
    await createShop(shop, 1000);
    const { jobId } = await newJob(shop, 5);

    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, i) => claimJob(jobId, `worker-${i}`, LEASE)),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
    const job = await db.bulkJob.findUnique({ where: { id: jobId } });
    expect(job.status).toBe("processing");
    expect(job.lockedBy).toBe(`worker-${claims.indexOf(true)}`);
    expect(job.startedAt).not.toBeNull();
  });

  it("hands each of several jobs to exactly one worker", async () => {
    const shops = ["a", "b", "c"].map((n) => shopDomain(`multi-${n}`));
    for (const shop of shops) {
      await createShop(shop, 1000);
      await newJob(shop, 3);
    }

    const claimed = await Promise.all(
      Array.from({ length: 8 }, (_, i) => claimNextJob(`worker-${i}`, LEASE)),
    );

    const ids = claimed.filter(Boolean).map((job) => job.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("does not hand out a job whose lease is still live, but recovers it once the lease expires", async () => {
    const shop = shopDomain("lease");
    await createShop(shop, 1000);
    const { jobId } = await newJob(shop, 3);

    expect(await claimJob(jobId, "worker-a", LEASE)).toBe(true);
    expect(await claimNextJob("worker-b", LEASE)).toBeNull();

    // worker-a dies: its lease runs out
    await db.bulkJob.update({ where: { id: jobId }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const recovered = await claimNextJob("worker-b", LEASE);
    expect(recovered?.id).toBe(jobId);
    expect((await db.bulkJob.findUnique({ where: { id: jobId } })).lockedBy).toBe("worker-b");
  });

  it("never claims jobs that belong to Inngest", async () => {
    const shop = shopDomain("legacy");
    await createShop(shop, 1000);
    await db.bulkJob.create({
      data: {
        shop, jobType: "product", status: "pending", totalItems: 1, contentTypes: "[]",
        settings: "{}", itemsData: "[]", creditsAllocated: 0,
      },
    });
    expect(await claimNextJob("worker-a", LEASE)).toBeNull();
  });
});

describe("charging items", () => {
  it("charges an item exactly once even if completion is attempted twice", async () => {
    const shop = shopDomain("once");
    await createShop(shop, 1000);
    const { jobId } = await newJob(shop, 2);
    await claimJob(jobId, "worker-a", LEASE);
    const [item] = await getNextPendingItems(jobId, 1);

    const first = await completeItem({ jobId, workerId: "worker-a", item, title: "P1", creditsPerItem: 2 });
    const second = await completeItem({ jobId, workerId: "worker-a", item, title: "P1", creditsPerItem: 2 });

    expect([first, second]).toEqual([true, false]);
    const job = await db.bulkJob.findUnique({ where: { id: jobId } });
    expect(job).toMatchObject({ completedItems: 1, creditsUsed: 2 });
    expect(JSON.parse(job.completedItemIds)).toEqual([{ id: productGid(1), title: "P1" }]);
  });

  it("rejects writes from a worker that no longer holds the lease, leaving the item untouched", async () => {
    const shop = shopDomain("fence");
    await createShop(shop, 1000);
    const { jobId } = await newJob(shop, 1);
    await claimJob(jobId, "worker-a", LEASE);
    const [item] = await getNextPendingItems(jobId, 1);

    await expect(
      completeItem({ jobId, workerId: "stale-worker", item, title: "P1", creditsPerItem: 2 }),
    ).rejects.toBeInstanceOf(LeaseLostError);

    expect((await db.bulkJobItem.findUnique({ where: { id: item.id } })).status).toBe("pending");
    expect((await db.bulkJob.findUnique({ where: { id: jobId } })).creditsUsed).toBe(0);
  });
});

describe("refunds", () => {
  it("refunds unused credits exactly once, even when finalized concurrently", async () => {
    const shop = shopDomain("refund");
    await createShop(shop, 1000);
    const { jobId } = await newJob(shop, 10); // 20 credits reserved
    await claimJob(jobId, "worker-a", LEASE);
    const [item] = await getNextPendingItems(jobId, 1);
    await completeItem({ jobId, workerId: "worker-a", item, title: "P1", creditsPerItem: 2 });

    const results = await Promise.all([
      finalizeJob({ jobId, workerId: "worker-a", outcome: "cancelled" }),
      finalizeJob({ jobId, workerId: "worker-a", outcome: "cancelled" }),
    ]);

    expect(results.filter((r) => r.finalized)).toHaveLength(1);
    const job = await db.bulkJob.findUnique({ where: { id: jobId } });
    expect(job).toMatchObject({ status: "cancelled", creditsUsed: 2, creditsRefunded: 18 });
    expect(job.refundedAt).not.toBeNull();
    expect(await shopCredits(shop)).toEqual({ credits: 998, creditsUsedTotal: 2 });

    // A later attempt (e.g. a retried worker) is a no-op.
    const again = await finalizeJob({ jobId, workerId: "worker-a", outcome: "fatal", error: new Error("late") });
    expect(again.finalized).toBe(false);
    expect(await shopCredits(shop)).toEqual({ credits: 998, creditsUsedTotal: 2 });
  });
});

describe("cancellation requests", () => {
  it("cancels and fully refunds a job no worker has picked up yet", async () => {
    const shop = shopDomain("cancel-pending");
    await createShop(shop, 1000);
    const { jobId } = await newJob(shop, 10);

    const result = await requestCancel({ jobId, shop });

    expect(result).toMatchObject({ ok: true, cancelled: true, refunded: 20 });
    const job = await db.bulkJob.findUnique({ where: { id: jobId } });
    expect(job.status).toBe("cancelled");
    expect(await db.bulkJobItem.count({ where: { jobId, status: "cancelled" } })).toBe(10);
    expect(await shopCredits(shop)).toEqual({ credits: 1000, creditsUsedTotal: 0 });
  });

  it("only flags a running job; its worker stops and settles it", async () => {
    const shop = shopDomain("cancel-running");
    await createShop(shop, 1000);
    const { jobId } = await newJob(shop, 10);
    await claimJob(jobId, "worker-a", LEASE);

    const result = await requestCancel({ jobId, shop });

    expect(result).toEqual({ ok: true, cancelled: false });
    const job = await db.bulkJob.findUnique({ where: { id: jobId } });
    expect(job.status).toBe("processing");
    expect(job.cancelRequestedAt).not.toBeNull();
  });

  it("refuses to cancel another shop's job or a finished job", async () => {
    const shop = shopDomain("cancel-owner");
    await createShop(shop, 1000);
    const { jobId } = await newJob(shop, 1);

    expect(await requestCancel({ jobId, shop: shopDomain("someone-else") })).toMatchObject({ ok: false });
    await requestCancel({ jobId, shop });
    expect(await requestCancel({ jobId, shop })).toMatchObject({ ok: false });
  });
});
