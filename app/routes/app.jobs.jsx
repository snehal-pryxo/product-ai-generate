import { useEffect, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
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

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

function statusBadge(status) {
  const tones = {
    pending: "info",
    processing: "attention",
    completed: "success",
    partial: "warning",
    failed: "critical",
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

function stripHtml(html) {
  return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function truncateText(value, max = 260) {
  const text = stripHtml(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function DetailBlock({ label, value, html = false }) {
  const text = html ? truncateText(value) : String(value || "").trim();
  if (!text) return null;
  return (
    <BlockStack gap="050">
      <Text as="p" variant="bodySm" fontWeight="semibold">{label}</Text>
      <Text as="p" variant="bodySm" tone="subdued">{text}</Text>
    </BlockStack>
  );
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
    },
  });
  return {
    jobs: jobs.map((j) => ({
      ...j,
      failedItemIds: parseJsonField(j.failedItemIds),
      completedItemIds: parseJsonField(j.completedItemIds),
    })),
  };
};

function ProductsModal({ job, onClose }) {
  // Build unified list: succeeded first, then failed
  const succeededItems = job.completedItemIds.map((item) => ({ ...item, status: "succeeded" }));
  const failedItems = job.failedItemIds.map((item) => ({ ...item, status: "failed" }));
  const allItems = [...succeededItems, ...failedItems];

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
                    {item.status === "succeeded" && (
                      <BlockStack gap="200">
                        <DetailBlock label="Description" value={item.descriptionHtml} html />
                        <DetailBlock label="Meta Title" value={item.seoTitle} />
                        <DetailBlock label="Meta Description" value={item.seoDescription} />
                        <DetailBlock label="FAQ" value={item.faqHtml} html />
                      </BlockStack>
                    )}
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
                        job.status === "processing" || job.status === "completed" || job.status === "partial" ? (
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

                  {hasDetails && (
                    <Box>
                      <Button variant="plain" onClick={() => setSelectedJob(job)}>
                        View Generated SEO Content ({job.completedItems} succeeded
                        {job.failedItems > 0 ? `, ${job.failedItems} failed` : ""})
                      </Button>
                    </Box>
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
