// Database-backed job queue for bulk AI generation.
//
// Guarantees, and the mechanism behind each:
//  * One worker per job      — a job is claimed with a single conditional UPDATE
//                              that only succeeds while no live lease exists.
//  * Fencing                 — every write that charges or finalizes a job is
//                              conditioned on `lockedBy = <this worker>`, so a
//                              worker whose lease expired cannot double-process.
//  * Charge each item once   — an item is charged in the same transaction that
//                              flips it from "pending" to "completed"; the flip
//                              only succeeds once.
//  * Refund exactly once     — the refund is applied in the same transaction
//                              that sets `refundedAt`, which is only set if NULL.
//  * Reserve credits safely  — the up-front deduction, the job row and its item
//                              rows are created in one transaction.

import { Prisma } from "@prisma/client";
import db from "../../db.server";
import { recordCreditRefund, recordGeneration } from "../activity.server";
import { getOrCreateShopCredits, buildInsufficientCreditsError } from "../credits.server";
import { errorMessage, LeaseLostError } from "./errors.server";

export const ACTIVE_STATUSES = ["pending", "processing"];
export const ITEM_STATUS = {
  pending: "pending",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

export class InsufficientCreditsError extends Error {
  constructor(message) {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}

const ITEM_INSERT_CHUNK = 1000;
const TITLE_MAX = 500;

// Connection blips, pool timeouts, deadlocks and lock-wait timeouts. Retrying
// the queue's writes is safe because each one is conditional: if a commit
// succeeded but its acknowledgement was lost, the retry finds the row already
// settled and changes nothing (no double charge, no double refund).
const RETRYABLE_DB_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2034"]);
const RETRYABLE_DB_MESSAGE = /Can't reach database server|Connection (reset|refused|closed|lost)|Server has closed the connection|deadlock|Lock wait timeout|Timed out fetching a new connection/i;

function isRetryableDbError(error) {
  return RETRYABLE_DB_CODES.has(error?.code) || RETRYABLE_DB_MESSAGE.test(String(error?.message || ""));
}

async function withDbRetry(fn, { attempts = 5, baseDelayMs = 100 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isRetryableDbError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
}

function clip(value, max = TITLE_MAX) {
  if (value === undefined || value === null) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Reserve credits and create a worker-run bulk job with one item row per
 * selected resource. Items hold identifiers only; product data is fetched from
 * Shopify a batch at a time when the job runs.
 *
 * @param {object} p
 * @param {string} p.shop
 * @param {"product"|"collection"|"collection_product"} p.jobType
 * @param {Array<{resourceId: string, collectionId?: string, collectionTitle?: string}>} p.items
 * @param {string[]} p.contentTypes
 * @param {object} p.settings  job settings (prompt options, creditsPerItem, ...)
 * @param {number} p.requiredCredits
 */
export async function createWorkerBulkJob({ shop, jobType, items, contentTypes, settings, requiredCredits }) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("A bulk job needs at least one item.");
  const credits = Math.max(0, Math.trunc(Number(requiredCredits) || 0));

  // Ensures the shop row exists and applies any due monthly plan credits first —
  // the same preparation deductCredits() has always done.
  await getOrCreateShopCredits(shop);

  const job = await db.$transaction(async (tx) => {
    if (credits > 0) {
      const reserved = await tx.shop.updateMany({
        where: { shop, credits: { gte: credits } },
        data: { credits: { decrement: credits }, creditsUsedTotal: { increment: credits } },
      });
      if (reserved.count === 0) {
        const row = await tx.shop.findUnique({ where: { shop }, select: { credits: true } });
        throw new InsufficientCreditsError(buildInsufficientCreditsError(credits, row?.credits ?? 0));
      }
    }

    const created = await tx.bulkJob.create({
      data: {
        shop,
        jobType,
        status: "pending",
        runner: "worker",
        totalItems: items.length,
        contentTypes: JSON.stringify(contentTypes || []),
        settings: JSON.stringify(settings || {}),
        itemsData: "[]",
        creditsAllocated: credits,
      },
      select: { id: true },
    });

    for (let start = 0; start < items.length; start += ITEM_INSERT_CHUNK) {
      await tx.bulkJobItem.createMany({
        data: items.slice(start, start + ITEM_INSERT_CHUNK).map((item, offset) => ({
          jobId: created.id,
          position: start + offset,
          resourceId: String(item.resourceId),
          collectionId: item.collectionId ? String(item.collectionId) : null,
          collectionTitle: clip(item.collectionTitle),
        })),
      });
    }
    return created;
  }, { timeout: 30000 });

  if (credits > 0) await recordGeneration(shop, credits);

  const snapshot = await db.shop.findUnique({
    where: { shop },
    select: { credits: true, creditsUsedTotal: true },
  });
  return { jobId: job.id, credits: snapshot?.credits ?? 0, creditsUsedTotal: snapshot?.creditsUsedTotal ?? 0 };
}

function leaseUntil(now, leaseMs) {
  return new Date(now.getTime() + leaseMs);
}

function claimableWhere(now) {
  return {
    runner: "worker",
    status: { in: ACTIVE_STATUSES },
    refundedAt: null,
    OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
  };
}

/**
 * Try to claim one specific job. Returns true only for the single caller whose
 * conditional UPDATE matched; concurrent callers get false.
 */
export async function claimJob(jobId, workerId, { leaseMs, now = new Date() }) {
  const claimed = await db.bulkJob.updateMany({
    where: { id: jobId, ...claimableWhere(now) },
    data: { lockedBy: workerId, lockedUntil: leaseUntil(now, leaseMs), heartbeatAt: now },
  });
  if (claimed.count !== 1) return false;
  await db.bulkJob.updateMany({
    where: { id: jobId, lockedBy: workerId, status: "pending" },
    data: { status: "processing", startedAt: now },
  });
  return true;
}

/**
 * Claim the oldest claimable job: a pending job, or a processing job whose
 * worker stopped renewing its lease (crash, restart, deploy).
 */
export async function claimNextJob(workerId, { leaseMs, now = new Date(), excludeIds = [] }) {
  const candidates = await db.bulkJob.findMany({
    where: { ...claimableWhere(now), ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 10,
    select: { id: true },
  });
  for (const candidate of candidates) {
    if (await claimJob(candidate.id, workerId, { leaseMs, now })) {
      return db.bulkJob.findUnique({
        where: { id: candidate.id },
        select: {
          id: true, shop: true, jobType: true, status: true, settings: true, contentTypes: true,
          totalItems: true, creditsAllocated: true, creditsUsed: true, cancelRequestedAt: true,
        },
      });
    }
  }
  return null;
}

/** Extend this worker's lease. Returns false if the lease was lost. */
export async function renewLease(jobId, workerId, { leaseMs, now = new Date() }) {
  const renewed = await db.bulkJob.updateMany({
    where: { id: jobId, lockedBy: workerId, refundedAt: null },
    data: { lockedUntil: leaseUntil(now, leaseMs), heartbeatAt: now },
  });
  return renewed.count === 1;
}

/** Give the job back (graceful shutdown) so another worker can resume it at once. */
export async function releaseLease(jobId, workerId) {
  await db.bulkJob.updateMany({
    where: { id: jobId, lockedBy: workerId },
    data: { lockedBy: null, lockedUntil: null },
  });
}

export async function isCancelRequested(jobId) {
  const row = await db.bulkJob.findUnique({ where: { id: jobId }, select: { cancelRequestedAt: true } });
  return Boolean(row?.cancelRequestedAt);
}

export async function getNextPendingItems(jobId, limit) {
  return db.bulkJobItem.findMany({
    where: { jobId, status: ITEM_STATUS.pending },
    orderBy: { position: "asc" },
    take: limit,
  });
}

export const WRITE_BACK = {
  pending: "pending",
  applied: "applied",
  failed: "failed",
  skipped: "skipped",
};

/**
 * Count one more pickup for these items (used to detect poison items after
 * repeated crashes) and stamp the first pickup time. Returns the items as now
 * stored, including `firstPickedUpAt`.
 */
export async function markItemsPickedUp(itemIds, now = new Date()) {
  if (!itemIds.length) return [];
  await db.$executeRaw`
    UPDATE bulk_job_items
    SET attempts = attempts + 1,
        firstPickedUpAt = COALESCE(firstPickedUpAt, ${now}),
        updatedAt = ${now}
    WHERE id IN (${Prisma.join(itemIds)}) AND status = ${ITEM_STATUS.pending}`;
  return db.bulkJobItem.findMany({ where: { id: { in: itemIds } }, orderBy: { position: "asc" } });
}

/** Completed (charged) items whose content has not been saved to Shopify yet. */
export async function getItemsAwaitingWriteBack(jobId, limit) {
  return db.bulkJobItem.findMany({
    where: { jobId, status: ITEM_STATUS.completed, writeBackStatus: WRITE_BACK.pending },
    orderBy: { position: "asc" },
    take: limit,
  });
}

/**
 * Record the outcome of saving an item's content to Shopify. Only the lease
 * holder may record it; each item's outcome is recorded once.
 */
export async function recordWriteBack({ jobId, workerId, item, error = null }) {
  const failed = Boolean(error);
  const message = failed ? errorMessage(error) : null;
  return withDbRetry(() => db.$transaction(async (tx) => {
    const settled = await tx.bulkJobItem.updateMany({
      where: { id: item.id, jobId, status: ITEM_STATUS.completed, writeBackStatus: WRITE_BACK.pending },
      data: { writeBackStatus: failed ? WRITE_BACK.failed : WRITE_BACK.applied, writeBackError: message },
    });
    if (settled.count === 0) return false;
    const fenced = await tx.$executeRaw`
      UPDATE bulk_jobs
      SET writeBackFailedItems = writeBackFailedItems + ${failed ? 1 : 0},
          heartbeatAt = NOW(3),
          updatedAt = NOW(3)
      WHERE id = ${jobId} AND lockedBy = ${workerId} AND refundedAt IS NULL`;
    if (fenced !== 1) throw new LeaseLostError(jobId);
    return true;
  }));
}

/**
 * Mark an item completed and charge its credits, atomically and at most once.
 * Returns true if this call did the charge, false if the item was already
 * settled. Throws LeaseLostError (and rolls back) if this worker lost the job.
 */
export async function completeItem({ jobId, workerId, item, title, creditsPerItem, writeBackRequired = false }) {
  const credits = Math.max(0, Math.trunc(Number(creditsPerItem) || 0));
  const safeTitle = clip(title ?? item.title);
  return withDbRetry(() => db.$transaction(async (tx) => {
    const settled = await tx.bulkJobItem.updateMany({
      where: { id: item.id, jobId, status: ITEM_STATUS.pending },
      data: {
        status: ITEM_STATUS.completed,
        title: safeTitle,
        creditsCharged: credits,
        processedAt: new Date(),
        error: null,
        writeBackStatus: writeBackRequired ? WRITE_BACK.pending : WRITE_BACK.skipped,
      },
    });
    if (settled.count === 0) return false;

    const charged = await tx.$executeRaw`
      UPDATE bulk_jobs
      SET completedItems = completedItems + 1,
          creditsUsed = creditsUsed + ${credits},
          completedItemIds = JSON_ARRAY_APPEND(COALESCE(NULLIF(completedItemIds, ''), '[]'), '$',
            JSON_OBJECT('id', ${item.resourceId}, 'title', ${safeTitle})),
          heartbeatAt = NOW(3),
          updatedAt = NOW(3)
      WHERE id = ${jobId} AND lockedBy = ${workerId} AND refundedAt IS NULL`;
    if (charged !== 1) throw new LeaseLostError(jobId);
    return true;
  }));
}

/** Mark an item failed (no charge). Same at-most-once and fencing rules as completeItem. */
export async function failItem({ jobId, workerId, item, title, error }) {
  const message = errorMessage(error);
  const safeTitle = clip(title ?? item.title);
  return withDbRetry(() => db.$transaction(async (tx) => {
    const settled = await tx.bulkJobItem.updateMany({
      where: { id: item.id, jobId, status: ITEM_STATUS.pending },
      data: { status: ITEM_STATUS.failed, title: safeTitle, error: message, processedAt: new Date() },
    });
    if (settled.count === 0) return false;

    const updated = await tx.$executeRaw`
      UPDATE bulk_jobs
      SET failedItems = failedItems + 1,
          failedItemIds = JSON_ARRAY_APPEND(COALESCE(NULLIF(failedItemIds, ''), '[]'), '$',
            JSON_OBJECT('id', ${item.resourceId}, 'title', ${safeTitle}, 'error', ${message})),
          heartbeatAt = NOW(3),
          updatedAt = NOW(3)
      WHERE id = ${jobId} AND lockedBy = ${workerId} AND refundedAt IS NULL`;
    if (updated !== 1) throw new LeaseLostError(jobId);
    return true;
  }));
}

function finalStatus(job, outcome) {
  if (outcome === "cancelled") return "cancelled";
  if (job.completedItems === 0) return "failed";
  // Generated but not saved to Shopify still counts as a partial failure.
  if (job.failedItems === 0 && job.writeBackFailedItems === 0) return "completed";
  return "partial";
}

/**
 * Settle a job: decide its final status, close out unprocessed items, and
 * refund unused credits — all in one transaction, at most once.
 *
 * @param {"done"|"cancelled"|"fatal"} outcome
 * @returns {Promise<{finalized: boolean, status?: string, refunded?: number}>}
 */
export async function finalizeJob({ jobId, workerId, outcome, error }) {
  const message = error ? errorMessage(error) : null;
  const result = await withDbRetry(() => db.$transaction(async (tx) => {
    const [job] = await tx.$queryRaw`
      SELECT id, shop, status, lockedBy, refundedAt, completedItems, failedItems, writeBackFailedItems,
             creditsAllocated, creditsUsed
      FROM bulk_jobs WHERE id = ${jobId} FOR UPDATE`;
    if (!job || job.refundedAt) return { finalized: false };
    if (job.lockedBy !== workerId) throw new LeaseLostError(jobId);

    let failedItems = Number(job.failedItems);
    let writeBackFailedItems = Number(job.writeBackFailedItems);

    if (outcome === "done") {
      const pending = await tx.bulkJobItem.count({ where: { jobId, status: ITEM_STATUS.pending } });
      if (pending > 0) throw new Error(`Cannot complete bulk job ${jobId}: ${pending} items are still pending.`);
    }

    // Generated (and charged) items whose Shopify save never ran — e.g. the job
    // stopped on a revoked token. Their content stays in the app.
    const unsaved = await tx.bulkJobItem.updateMany({
      where: { jobId, status: ITEM_STATUS.completed, writeBackStatus: WRITE_BACK.pending },
      data: {
        writeBackStatus: WRITE_BACK.failed,
        writeBackError: message || "The job stopped before this item's content was saved to Shopify.",
      },
    });
    if (unsaved.count > 0) {
      writeBackFailedItems += unsaved.count;
      await tx.$executeRaw`UPDATE bulk_jobs SET writeBackFailedItems = writeBackFailedItems + ${unsaved.count} WHERE id = ${jobId}`;
    }

    if (outcome === "cancelled") {
      await tx.bulkJobItem.updateMany({
        where: { jobId, status: ITEM_STATUS.pending },
        data: { status: ITEM_STATUS.cancelled, processedAt: new Date() },
      });
    } else if (outcome === "fatal") {
      const abandoned = await tx.bulkJobItem.updateMany({
        where: { jobId, status: ITEM_STATUS.pending },
        data: { status: ITEM_STATUS.failed, error: message, processedAt: new Date() },
      });
      if (abandoned.count > 0) {
        failedItems += abandoned.count;
        const summary = `${abandoned.count} remaining item${abandoned.count === 1 ? "" : "s"} not processed`;
        await tx.$executeRaw`
          UPDATE bulk_jobs
          SET failedItems = failedItems + ${abandoned.count},
              failedItemIds = JSON_ARRAY_APPEND(COALESCE(NULLIF(failedItemIds, ''), '[]'), '$',
                JSON_OBJECT('id', NULL, 'title', ${summary}, 'error', ${message}))
          WHERE id = ${jobId}`;
      }
    }

    const status = finalStatus({ completedItems: Number(job.completedItems), failedItems, writeBackFailedItems }, outcome);
    const refund = Math.max(0, Number(job.creditsAllocated) - Number(job.creditsUsed));
    const now = new Date();

    const closed = await tx.bulkJob.updateMany({
      where: { id: jobId, lockedBy: workerId, refundedAt: null },
      data: {
        status,
        completedAt: now,
        refundedAt: now,
        creditsRefunded: refund,
        lastError: message,
        lockedBy: null,
        lockedUntil: null,
      },
    });
    if (closed.count !== 1) throw new LeaseLostError(jobId);

    if (refund > 0) {
      await tx.$executeRaw`
        UPDATE shop
        SET credits = credits + ${refund},
            creditsUsedTotal = GREATEST(0, CAST(creditsUsedTotal AS SIGNED) - ${refund})
        WHERE shop = ${job.shop}`;
    }
    return { finalized: true, status, refunded: refund, shop: job.shop };
  }));

  if (result.finalized && result.refunded > 0) await recordCreditRefund(result.shop, result.refunded);
  return result;
}

/**
 * Merchant-initiated cancel. A job no worker holds yet is cancelled (and
 * refunded) right here, claimed under a one-off lease so it cannot race a
 * worker; a running job is flagged and its worker stops before the next item.
 */
export async function requestCancel({ jobId, shop, leaseMs = 60000 }) {
  const flagged = await db.bulkJob.updateMany({
    where: { id: jobId, shop, runner: "worker", status: { in: ACTIVE_STATUSES }, refundedAt: null },
    data: { cancelRequestedAt: new Date() },
  });
  if (flagged.count === 0) return { ok: false, reason: "not_cancellable" };

  const cancelToken = `cancel:${jobId}:${Date.now()}`;
  if (await claimJob(jobId, cancelToken, { leaseMs })) {
    const result = await finalizeJob({ jobId, workerId: cancelToken, outcome: "cancelled" });
    return { ok: true, cancelled: true, refunded: result.refunded ?? 0 };
  }
  return { ok: true, cancelled: false };
}
