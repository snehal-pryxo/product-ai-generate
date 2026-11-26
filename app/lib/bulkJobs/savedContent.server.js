// When each generation step last saved content for an item. A resumed item
// (after a worker crash or an aborted batch) skips every step whose content was
// saved at or after the item was first picked up for this job, so it is not
// regenerated, re-billed by the AI provider, or logged a second time.

import db from "../../db.server";

/**
 * @returns {Promise<{standard: Date|null, schema: Date|null, faq: Date|null}>}
 */
export async function getSavedContentTimestamps({ jobType, shop, item }) {
  if (jobType === "collection") {
    const row = await db.collectionGeneratedContent.findUnique({
      where: { shop_collectionId: { shop, collectionId: item.id } },
      select: { updatedAt: true },
    });
    return { standard: row?.updatedAt ?? null, schema: null, faq: null };
  }

  if (jobType === "collection_product") {
    const row = await db.collectionProductGeneratedContent.findUnique({
      where: { shop_collectionId_productId: { shop, collectionId: item.collectionId, productId: item.productId } },
      select: { updatedAt: true },
    });
    return { standard: row?.updatedAt ?? null, schema: null, faq: null };
  }

  const [content, schema, faq] = await Promise.all([
    db.productGeneratedContent.findUnique({
      where: { shop_productId: { shop, productId: item.id } },
      select: { updatedAt: true },
    }),
    db.aiVisibilitySchema.findUnique({
      where: { shop_resourceType_resourceId: { shop, resourceType: "product", resourceId: item.id } },
      select: { updatedAt: true },
    }),
    db.aiVisibilityFaq.findUnique({
      where: { shop_resourceType_resourceId: { shop, resourceType: "product", resourceId: item.id } },
      select: { updatedAt: true },
    }),
  ]);
  return {
    standard: content?.updatedAt ?? null,
    schema: schema?.updatedAt ?? null,
    faq: faq?.updatedAt ?? null,
  };
}
