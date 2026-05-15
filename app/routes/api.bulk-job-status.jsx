import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  if (!jobId) {
    return Response.json({ error: "jobId is required" }, { status: 400 });
  }

  const job = await db.bulkJob.findFirst({
    where: { id: jobId, shop: session.shop },
    select: {
      id: true,
      status: true,
      jobType: true,
      totalItems: true,
      completedItems: true,
      failedItems: true,
      failedItemIds: true,
      creditsAllocated: true,
      creditsUsed: true,
      createdAt: true,
      completedAt: true,
    },
  });

  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  return Response.json({
    id: job.id,
    status: job.status,
    jobType: job.jobType,
    totalItems: job.totalItems,
    completedItems: job.completedItems,
    failedItems: job.failedItems,
    failedItemIds: job.failedItemIds ? JSON.parse(job.failedItemIds) : [],
    creditsAllocated: job.creditsAllocated,
    creditsUsed: job.creditsUsed,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  });
};
