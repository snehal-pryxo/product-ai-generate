import { authenticate } from "../shopify.server";

/**
 * GDPR: customers/redact
 * Triggered when a customer requests deletion of their data.
 * This app stores no personal customer data — only shop-level data
 * (AI-generated product/collection descriptions tied to the shop domain).
 * Response: 200 OK — nothing to redact.
 */
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(
    `No customer personal data stored for shop ${shop} — nothing to redact.`
  );

  return new Response();
};
