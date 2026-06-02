import { inngest } from "./client";
import db from "../db.server";
import {
  getApiKeys,
  generateProductItem,
  generateCollectionItem,
  generateCollectionProductItem,
  updateJobProgress,
  addProductsToCollection,
  applyProductToShopify,
  applyCollectionToShopify,
  applyCollectionProductToShopify,
} from "../lib/generateContent.server";
import { generateBulkFaq, generateProductSchemaForBulk } from "../lib/aiVisibility.server";
import { refundCredits } from "../lib/credits.server";

const STANDARD_CONTENT_TYPES = ["description", "meta_title", "meta_description"];

function contentTypesForJob(jobType, contentTypes) {
  const types = Array.isArray(contentTypes) ? contentTypes : [];
  if (jobType === "product") return types;
  return types.filter((type) => STANDARD_CONTENT_TYPES.includes(type));
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function generateItem(jobType, item, settings, apiKeys, accessToken) {
  const effectiveContentTypes = contentTypesForJob(jobType, settings.contentTypes);
  const standardContentTypes = effectiveContentTypes.filter((type) => STANDARD_CONTENT_TYPES.includes(type));
  const aiOptions = {
    aiProvider: settings.aiProvider,
    openaiKey: apiKeys.openaiApiKey,
    anthropicKey: apiKeys.anthropicApiKey,
    geminiKey: apiKeys.geminiApiKey,
  };

  if (jobType === "collection") {
    if (standardContentTypes.length > 0) {
      await generateCollectionItem(item, { ...settings, contentTypes: standardContentTypes }, apiKeys);
    }
    return { creditsUsed: settings.creditsPerItem ?? (effectiveContentTypes.length || 0) };
  }

  if (jobType === "collection_product") {
    if (standardContentTypes.length > 0) {
      await generateCollectionProductItem(item, { ...settings, contentTypes: standardContentTypes }, apiKeys);
    }
    return { creditsUsed: settings.creditsPerItem ?? (effectiveContentTypes.length || 0) };
  }

  if (standardContentTypes.length > 0) {
    await generateProductItem(item, { ...settings, contentTypes: standardContentTypes }, apiKeys);
  }
  if ((settings.contentTypes || []).includes("schema")) {
    await generateProductSchemaForBulk(settings.shop, accessToken, item, aiOptions);
  }
  if ((settings.contentTypes || []).includes("faq")) {
    await generateBulkFaq(settings.shop, accessToken, "product", item, aiOptions, {
      language: settings.language,
    });
  }

  return { creditsUsed: settings.creditsPerItem ?? (settings.contentTypes?.length || 0) };
}

async function fetchGeneratedDetails(jobType, item, shop) {
  if (jobType === "collection") {
    const row = await db.collectionGeneratedContent.findUnique({
      where: { shop_collectionId: { shop, collectionId: item.id } },
      select: { descriptionHtml: true, seoTitle: true, seoDescription: true },
    });
    return {
      descriptionHtml: row?.descriptionHtml || "",
      seoTitle: row?.seoTitle || "",
      seoDescription: row?.seoDescription || "",
      faqHtml: "",
    };
  }

  if (jobType === "collection_product") {
    const row = await db.collectionProductGeneratedContent.findUnique({
      where: {
        shop_collectionId_productId: {
          shop,
          collectionId: item.collectionId,
          productId: item.productId,
        },
      },
      select: { descriptionHtml: true, seoTitle: true, seoDescription: true },
    });
    const faqRow = await db.productGeneratedContent.findUnique({
      where: { shop_productId: { shop, productId: item.productId } },
      select: { faqHtml: true, faqJson: true },
    });
    return {
      descriptionHtml: row?.descriptionHtml || "",
      seoTitle: row?.seoTitle || "",
      seoDescription: row?.seoDescription || "",
      faqHtml: faqRow?.faqHtml || "",
      faqJson: faqRow?.faqJson || "",
    };
  }

  const row = await db.productGeneratedContent.findUnique({
    where: { shop_productId: { shop, productId: item.id } },
    select: { descriptionHtml: true, seoTitle: true, seoDescription: true, faqHtml: true, faqJson: true },
  });
  return {
    descriptionHtml: row?.descriptionHtml || "",
    seoTitle: row?.seoTitle || "",
    seoDescription: row?.seoDescription || "",
    faqHtml: row?.faqHtml || "",
    faqJson: row?.faqJson || "",
  };
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
    const shopData = await step.run("fetch-shop-access-token", () =>
      db.shop.findUnique({ where: { shop }, select: { accessToken: true } }),
    );

    const effectiveContentTypes = contentTypesForJob(jobType, settings.contentTypes);
    const settingsWithShop = {
      ...settings,
      shop,
      contentTypes: effectiveContentTypes,
      creditsPerItem: jobType === "product"
        ? settings.creditsPerItem ?? (effectiveContentTypes.length || 0)
        : effectiveContentTypes.length,
    };
    const creditsPerItem = settingsWithShop.creditsPerItem ?? (settingsWithShop.contentTypes?.length || 0);
    const chunks = chunkArray(items, 10);

    for (let i = 0; i < chunks.length; i++) {
      await step.run(`chunk-${i}`, async () => {
        const results = await Promise.allSettled(
          chunks[i].map(async (item) => {
            const result = await generateItem(jobType, item, settingsWithShop, apiKeys, shopData?.accessToken);
            const details = await fetchGeneratedDetails(jobType, item, shop);
            return { ...result, details };
          }),
        );
        await updateJobProgress(jobId, chunks[i], results, creditsPerItem);

        const successfulItems = chunks[i].filter((_, idx) => results[idx].status === "fulfilled");
        if (successfulItems.length > 0 && shopData?.accessToken) {
          // Add products to their Shopify collection
          if (jobType === "collection_product") {
            const byCollection = {};
            successfulItems.forEach((item) => {
              if (!byCollection[item.collectionId]) byCollection[item.collectionId] = [];
              byCollection[item.collectionId].push(item.productId);
            });
            await Promise.allSettled(
              Object.entries(byCollection).map(([colId, productIds]) =>
                addProductsToCollection(shop, shopData.accessToken, colId, productIds),
              ),
            );
          } else if (jobType === "product" && settingsWithShop.collectionId) {
            await addProductsToCollection(
              shop,
              shopData.accessToken,
              settingsWithShop.collectionId,
              successfulItems.map((item) => item.id),
            );
          }

          // Auto-apply generated content to Shopify Admin
          const applyableTypes = (settingsWithShop.contentTypes || []).filter((t) =>
            (jobType === "product" ? ["description", "meta_title", "meta_description", "faq"] : STANDARD_CONTENT_TYPES).includes(t),
          );
          if (applyableTypes.length > 0) {
            if (jobType === "product") {
              await Promise.allSettled(
                successfulItems.map((item) =>
                  applyProductToShopify(shop, shopData.accessToken, item.id, applyableTypes),
                ),
              );
            } else if (jobType === "collection") {
              await Promise.allSettled(
                successfulItems.map((item) =>
                  applyCollectionToShopify(shop, shopData.accessToken, item.id, applyableTypes),
                ),
              );
            } else if (jobType === "collection_product") {
              await Promise.allSettled(
                successfulItems.map((item) =>
                  applyCollectionProductToShopify(
                    shop, shopData.accessToken, item.collectionId, item.productId, applyableTypes,
                  ),
                ),
              );
            }
          }
        }
      });
    }

    await step.run("finalize", async () => {
      const job = await db.bulkJob.findUnique({ where: { id: jobId } });
      if (!job) return;
      const creditsToRefund = (job.creditsAllocated ?? 0) - (job.creditsUsed ?? 0);
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
