import { useEffect, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  Badge,
  BlockStack,
  Box,
  Card,
  DataTable,
  EmptyState,
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
      creditsAllocated: true,
      creditsUsed: true,
      createdAt: true,
      completedAt: true,
    },
  });
  return {
    jobs: jobs.map((j) => ({
      ...j,
      failedItemIds: j.failedItemIds ? JSON.parse(j.failedItemIds) : [],
    })),
  };
};

export default function JobsPage() {
  const { jobs: initialJobs } = useLoaderData();
  const revalidator = useRevalidator();
  const [expandedJobId, setExpandedJobId] = useState(null);
  const intervalRef = useRef(null);

  const hasActiveJobs = initialJobs.some((j) => j.status === "pending" || j.status === "processing");

  useEffect(() => {
    if (hasActiveJobs && !intervalRef.current) {
      intervalRef.current = setInterval(() => {
        revalidator.revalidate();
      }, POLL_INTERVAL_MS);
    }
    if (!hasActiveJobs && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [hasActiveJobs, revalidator]);

  return (
    <Page title="Bulk Jobs">
      <BlockStack gap="400">
        {initialJobs.length === 0 ? (
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
          initialJobs.map((job) => (
            <Card key={job.id}>
              <BlockStack gap="300">
                <Box>
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
                </Box>

                {job.failedItemIds?.length > 0 && (
                  <Box paddingBlockStart="200">
                    <button
                      type="button"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#2c6ecb", fontSize: 13 }}
                      onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                    >
                      {expandedJobId === job.id ? "Hide" : "Show"} {job.failedItemIds.length} failed item(s)
                    </button>

                    {expandedJobId === job.id && (
                      <Box paddingBlockStart="200">
                        {job.failedItemIds.map((fi, idx) => (
                          <Box key={idx} paddingBlockEnd="100">
                            <Text as="p" variant="bodySm">
                              <strong>{fi.title || fi.id}</strong>:{" "}
                              <span style={{ color: "#d82c0d" }}>{fi.error || "Unknown error"}</span>
                            </Text>
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>
                )}
              </BlockStack>
            </Card>
          ))
        )}
      </BlockStack>
    </Page>
  );
}
