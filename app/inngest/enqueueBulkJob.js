import { inngest } from "./client";
import db from "../db.server";
import { refundCredits } from "../lib/credits.server";

/**
 * Enqueue a bulk-generate job.
 *
 * Only the jobId is sent in the event payload — the worker loads items and
 * settings from the persisted bulkJob row. This keeps the Inngest event tiny
 * and constant-size regardless of item count, so it can never exceed Inngest's
 * 256KB per-event limit (which previously left large jobs stranded in
 * "pending" with the reserved credits never refunded).
 *
 * If the send is rejected, the reserved credits are refunded and the job is
 * marked "failed" so credits are never stranded on a job that will never run.
 */
export async function enqueueBulkJob({ jobId, shop, requiredCredits = 0 }) {
  try {
    await inngest.send({
      name: "content/bulk.generate",
      data: { jobId, shop },
    });
  } catch (error) {
    console.error("Failed to enqueue bulk job", jobId, error);
    if (requiredCredits > 0) {
      await refundCredits({ shopDomain: shop, creditsRefunded: requiredCredits }).catch(
        (refundError) => console.error("Refund after failed enqueue also failed", jobId, refundError),
      );
    }
    await db.bulkJob
      .update({ where: { id: jobId }, data: { status: "failed", completedAt: new Date() } })
      .catch(() => {});
    throw error;
  }
}
