import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  EmptyState,
  InlineStack,
  Modal,
  Page,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { requestCancel } from "../lib/bulkJobs/queue.server";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

function statusBadge(status) {
  const tones = {
    pending: "info",
    processing: "attention",
    completed: "success",
    partial: "warning",
    failed: "critical",
    cancelled: undefined,
  };
  return (
    <Badge tone={tones[status] || "info"} progress={status === "processing" ? "partiallyComplete" : undefined}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function jobTypeLabel(jobType) {
  if (jobType === "collection_product") return "Collection Products";
  if (jobType === "collection") return "Collections";
  return "Products";
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString();
}

function parseJsonField(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}


export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const since = new Date(Date.now() - THIRTY_DAYS_MS);
  const jobs = await db.bulkJob.findMany({
    where: { shop: session.shop, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      jobType: true,
      status: true,
      totalItems: true,
      completedItems: true,
      failedItems: true,
      failedItemIds: true,
      completedItemIds: true,
      createdAt: true,
      completedAt: true,
      runner: true,
      cancelRequestedAt: true,
      lastError: true,
      writeBackFailedItems: true,
    },
  });

  // Items generated (and charged) but not saved to Shopify, for the details modal.
  const jobsWithWriteBackFailures = jobs.filter((j) => j.writeBackFailedItems > 0).map((j) => j.id);
  const unsavedRows = jobsWithWriteBackFailures.length
    ? await db.bulkJobItem.findMany({
        where: { jobId: { in: jobsWithWriteBackFailures }, writeBackStatus: "failed" },
        orderBy: { position: "asc" },
        select: { jobId: true, resourceId: true, title: true, writeBackError: true },
        take: 2000,
      })
    : [];
  const unsavedByJob = new Map();
  for (const row of unsavedRows) {
    if (!unsavedByJob.has(row.jobId)) unsavedByJob.set(row.jobId, []);
    unsavedByJob.get(row.jobId).push({ id: row.resourceId, title: row.title, error: row.writeBackError });
  }

  return {
    jobs: jobs.map((j) => ({
      ...j,
      failedItemIds: parseJsonField(j.failedItemIds),
      completedItemIds: parseJsonField(j.completedItemIds),
      unsavedItems: unsavedByJob.get(j.id) || [],
    })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") !== "cancel") {
    return { ok: false, error: "Unsupported action." };
  }
  const jobId = String(formData.get("jobId") || "");
  const result = await requestCancel({ jobId, shop: session.shop });
  if (!result.ok) return { ok: false, error: "This job can no longer be cancelled." };
  return { ok: true, cancelled: result.cancelled };
};

function isActive(job) {
  return job.status === "pending" || job.status === "processing";
}

function progressSummary(job) {
  const processed = job.completedItems + job.failedItems;
  const percent = job.totalItems > 0 ? Math.round((processed / job.totalItems) * 100) : 0;
  const parts = [
    `Processed ${processed} of ${job.totalItems} (${percent}%)`,
    `${job.completedItems} completed`,
    `${job.failedItems} failed`,
  ];
  if (job.writeBackFailedItems > 0) parts.push(`${job.writeBackFailedItems} generated but not saved to Shopify`);
  if (isActive(job)) parts.push(`${Math.max(0, job.totalItems - processed)} remaining`);
  if (job.status === "cancelled") parts.push(`${Math.max(0, job.totalItems - processed)} cancelled (not charged)`);
  return parts.join(" · ");
}

function CancelJobButton({ job }) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== "idle";
  if (job.runner !== "worker" || !isActive(job)) return null;
  if (job.cancelRequestedAt || fetcher.data?.ok) {
    return <Text as="span" variant="bodySm" tone="subdued">Cancelling…</Text>;
  }
  return (
    <Button
      variant="plain"
      tone="critical"
      loading={submitting}
      onClick={() => fetcher.submit({ intent: "cancel", jobId: job.id }, { method: "post" })}
    >
      Cancel job
    </Button>
  );
}

function ProductsModal({ job, onClose }) {
  // Build unified list: succeeded first, then failed. Items generated but not
  // saved to Shopify are shown as failed with the Shopify error.
  const unsaved = new Map((job.unsavedItems || []).map((item) => [item.id, item]));
  const succeededItems = job.completedItemIds
    .filter((item) => !unsaved.has(item.id))
    .map((item) => ({ ...item, status: "succeeded" }));
  const unsavedItems = [...unsaved.values()].map((item) => ({
    ...item,
    status: "failed",
    error: `Generated, but not saved to Shopify: ${item.error || "unknown error"}`,
  }));
  const failedItems = job.failedItemIds.map((item) => ({ ...item, status: "failed" }));
  const allItems = [...succeededItems, ...unsavedItems, ...failedItems];

  return (
    <Modal
      open
      onClose={onClose}
      title={`${jobTypeLabel(job.jobType)} — ${job.completedItems} succeeded, ${job.failedItems} failed`}
      secondaryActions={[{ content: "Close", onAction: onClose }]}
    >
      <Modal.Section>
        {allItems.length === 0 ? (
          <Text as="p" tone="subdued">No item details available for this job.</Text>
        ) : (
          <BlockStack gap="200">
            {allItems.map((item, idx) => (
              <Box
                key={idx}
                padding="200"
                background={item.status === "succeeded" ? "bg-surface-success" : "bg-surface-critical"}
                borderRadius="200"
              >
                <InlineStack gap="200" blockAlign="start">
                  <Text as="span" variant="bodySm" fontWeight="bold" tone={item.status === "succeeded" ? "success" : "critical"}>
                    {item.status === "succeeded" ? "✓" : "✗"}
                  </Text>
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" fontWeight="semibold">{item.title || item.id}</Text>
                    {item.status === "failed" && item.error && (
                      <Text as="p" variant="bodySm" tone="critical">{item.error}</Text>
                    )}
                  </BlockStack>
                </InlineStack>
              </Box>
            ))}
          </BlockStack>
        )}
      </Modal.Section>
    </Modal>
  );
}

export default function JobsPage() {
  const { jobs } = useLoaderData();
  const revalidator = useRevalidator();
  const [selectedJob, setSelectedJob] = useState(null);
  const revalidatorStateRef = useRef(revalidator.state);

  const hasActiveJobs = jobs.some((j) => j.status === "pending" || j.status === "processing");

  useEffect(() => {
    revalidatorStateRef.current = revalidator.state;
  }, [revalidator.state]);

  useEffect(() => {
    if (!hasActiveJobs) return undefined;

    const intervalId = setInterval(() => {
      if (revalidatorStateRef.current === "idle") {
        revalidator.revalidate();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [hasActiveJobs, revalidator]);

  useEffect(() => {
    if (!selectedJob) return;
    const latestSelectedJob = jobs.find((job) => job.id === selectedJob.id);
    if (latestSelectedJob && latestSelectedJob !== selectedJob) {
      setSelectedJob(latestSelectedJob);
    }
  }, [jobs, selectedJob]);

  return (
    <Page title="Bulk Jobs">
      <BlockStack gap="400">
        {jobs.length === 0 ? (
          <Card>
            <EmptyState
              heading="No bulk jobs yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <Text as="p" variant="bodyMd" tone="subdued">
                Bulk jobs appear here after you run a bulk generation from the Products or Collections page.
              </Text>
            </EmptyState>
          </Card>
        ) : (
          jobs.map((job) => {
            const hasDetails = job.completedItemIds.length > 0 || job.failedItemIds.length > 0;
            return (
              <Card key={job.id}>
                <BlockStack gap="300">
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                    headings={["Type", "Items", "Status", "Progress", "Started", "Completed"]}
                    rows={[
                      [
                        jobTypeLabel(job.jobType),
                        `${job.totalItems}`,
                        statusBadge(job.status),
                        job.status !== "pending" ? (
                          <div style={{ minWidth: 120 }}>
                            <ProgressBar
                              progress={job.totalItems > 0 ? Math.round(((job.completedItems + job.failedItems) / job.totalItems) * 100) : 0}
                              size="small"
                              tone={job.failedItems > 0 ? "highlight" : "success"}
                            />
                            <Text as="span" variant="bodySm" tone="subdued">
                              {job.completedItems}/{job.totalItems}
                              {job.failedItems > 0 ? ` (${job.failedItems} failed)` : ""}
                            </Text>
                          </div>
                        ) : "—",
                        formatDate(job.createdAt),
                        formatDate(job.completedAt),
                      ],
                    ]}
                  />

                  {job.runner === "worker" && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {progressSummary(job)}
                    </Text>
                  )}

                  {job.lastError && !isActive(job) && (
                    <Text as="p" variant="bodySm" tone="critical">{job.lastError}</Text>
                  )}

                  {(hasDetails || (job.runner === "worker" && isActive(job))) && (
                    <InlineStack gap="400" blockAlign="center">
                      {hasDetails && (
                        <Button variant="plain" onClick={() => setSelectedJob(job)}>
                          View Generated SEO Content ({job.completedItems} succeeded
                          {job.failedItems > 0 ? `, ${job.failedItems} failed` : ""})
                        </Button>
                      )}
                      <CancelJobButton job={job} />
                    </InlineStack>
                  )}
                </BlockStack>
              </Card>
            );
          })
        )}
      </BlockStack>

      {selectedJob && (
        <ProductsModal job={selectedJob} onClose={() => setSelectedJob(null)} />
      )}
    </Page>
  );
}
