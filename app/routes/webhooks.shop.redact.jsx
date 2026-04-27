import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR: shop/redact
 * Triggered 48 days after a shop uninstalls the app.
 * All shop data must be permanently deleted.
 */
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    await db.$transaction([
      db.generatedContentLog.deleteMany({ where: { shop } }),
      db.productGeneratedContent.deleteMany({ where: { shop } }),
      db.pageGeneratedContent.deleteMany({ where: { shop } }),
      db.collectionGeneratedContent.deleteMany({ where: { shop } }),
      db.collectionProductGeneratedContent.deleteMany({ where: { shop } }),
      db.blogGeneratedContent.deleteMany({ where: { shop } }),
      db.billingSubscription.deleteMany({ where: { shop } }),
      db.billingCreditPurchase.deleteMany({ where: { shop } }),
      db.session.deleteMany({ where: { shop } }),
      db.shop.deleteMany({ where: { shop } }),
    ]);

    console.log(`Successfully redacted all data for shop ${shop}`);
  } catch (error) {
    console.error(`Failed to redact data for shop ${shop}`, error);
  }

  return new Response();
};
