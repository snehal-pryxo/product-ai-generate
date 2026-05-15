import { inngest } from "./client";
import db from "../db.server";
import {
  getApiKeys,
  generateProductItem,
  generateCollectionItem,
  generateCollectionProductItem,
  updateJobProgress,
} from "../lib/generateContent.server";
import { refundCredits } from "../lib/credits.server";

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function generateItem(jobType, item, settings, apiKeys) {
  if (jobType === "collection") return generateCollectionItem(item, settings, apiKeys);
  if (jobType === "collection_product") return generateCollectionProductItem(item, settings, apiKeys);
  return generateProductItem(item, settings, apiKeys);
}

export const bulkGenerateFunction = inngest.createFunction(
  {
    id: "bulk-generate-content",
    retries: 1,
    concurrency: { limit: 3 },
    triggers: [{ event: "content/bulk.generate" }],
    onFailure: async ({ event }) => {
      const { jobId, shop } = event.data.event.data;
      const job = await db.bulkJob.findUnique({
        where: { id: jobId },
        select: { status: true, creditsAllocated: true, creditsUsed: true },
      });
      if (job && !["completed", "partial", "failed"].includes(job.status)) {
        const creditsToRefund = (job.creditsAllocated ?? 0) - (job.creditsUsed ?? 0);
        if (creditsToRefund > 0) {
          await refundCredits({ shopDomain: shop, creditsRefunded: creditsToRefund });
        }
        await db.bulkJob.update({
          where: { id: jobId },
          data: { status: "failed", completedAt: new Date() },
        });
      }
    },
  },
  async ({ event, step }) => {
    const { jobId, shop, jobType, items, settings } = event.data;

    await step.run("mark-processing", () =>
      db.bulkJob.update({ where: { id: jobId }, data: { status: "processing" } }),
    );

    const apiKeys = await step.run("fetch-api-keys", () => getApiKeys(shop));

    const settingsWithShop = { ...settings, shop };
    const creditsPerItem = (settings.contentTypes?.length || 0);
    const chunks = chunkArray(items, 10);

    for (let i = 0; i < chunks.length; i++) {
      await step.run(`chunk-${i}`, async () => {
        const results = await Promise.allSettled(
          chunks[i].map((item) => generateItem(jobType, item, settingsWithShop, apiKeys)),
        );
        await updateJobProgress(jobId, chunks[i], results, creditsPerItem);
      });
    }

    await step.run("finalize", async () => {
      const job = await db.bulkJob.findUnique({ where: { id: jobId } });
      const creditsToRefund = job.creditsAllocated - job.creditsUsed;
      if (creditsToRefund > 0) {
        await refundCredits({ shopDomain: shop, creditsRefunded: creditsToRefund });
      }
      const status =
        job.failedItems === 0 ? "completed"
        : job.completedItems === 0 ? "failed"
        : "partial";
      await db.bulkJob.update({
        where: { id: jobId },
        data: { status, completedAt: new Date() },
      });
    });
  },
);
