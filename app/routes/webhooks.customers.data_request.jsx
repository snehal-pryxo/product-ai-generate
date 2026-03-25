import { authenticate } from "../shopify.server";

/**
 * GDPR: customers/data_request
 * Triggered when a customer requests a copy of their data.
 * This app stores no personal customer data — only shop-level data
 * (AI-generated product/collection descriptions tied to the shop domain).
 * Response: 200 OK with no data to report.
 */
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(
    `No customer personal data stored for shop ${shop} — nothing to return.`
  );

  return new Response();
};
