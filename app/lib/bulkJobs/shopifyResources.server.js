// Fetches fresh product/collection data from Shopify for one batch of a bulk job,
// and maps it to the item shapes the existing generation functions expect.

const PRODUCTS_BY_ID_QUERY = `#graphql
  query BulkJobProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        vendor
        productType
        status
        descriptionHtml
        seo { title description }
        priceRangeV2 { minVariantPrice { amount currencyCode } }
        variants(first: 1) { edges { node { price } } }
        featuredImage { url }
      }
    }
  }
`;

const COLLECTIONS_BY_ID_QUERY = `#graphql
  query BulkJobCollections($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Collection {
        id
        title
        handle
        descriptionHtml
        seo { title description }
      }
    }
  }
`;

function tagShopifyError(error) {
  if (error && typeof error === "object" && !error.source) error.source = "shopify";
  return error;
}

/**
 * Run an Admin GraphQL query through the app's authenticated admin client.
 * Errors are tagged `source: "shopify"` so a 401/403 is treated as fatal for the
 * job, while throttling/5xx are retried.
 */
export async function shopifyAdminQuery(admin, query, variables) {
  let json;
  try {
    const response = await admin.graphql(query, { variables });
    json = await response.json();
  } catch (error) {
    throw tagShopifyError(error);
  }
  const errors = json?.errors;
  if (errors && (Array.isArray(errors) ? errors.length : true)) {
    const list = Array.isArray(errors) ? errors : errors.graphQLErrors || [errors];
    const error = new Error(list.map((e) => e?.message).filter(Boolean).join("; ") || "Shopify GraphQL request failed.");
    error.graphQLErrors = list;
    throw tagShopifyError(error);
  }
  return json?.data;
}

/**
 * @returns {Promise<Map<string, object>>} node by GID. A selected resource that
 * was deleted (or is no longer accessible) is simply absent from the map.
 */
export async function fetchResourcesByIds(admin, ids, kind) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map();
  if (unique.length === 0) return map;
  const query = kind === "collection" ? COLLECTIONS_BY_ID_QUERY : PRODUCTS_BY_ID_QUERY;
  const data = await shopifyAdminQuery(admin, query, { ids: unique });
  for (const node of data?.nodes || []) {
    if (node?.id) map.set(node.id, node);
  }
  return map;
}

/** Shape a fetched node into the item object the job type's generator expects. */
export function toGenerationItem(jobType, node, itemRow) {
  if (jobType === "collection") {
    return {
      id: node.id,
      title: node.title,
      descriptionHtml: node.descriptionHtml || "",
      seoTitle: node.seo?.title || "",
      seoDescription: node.seo?.description || "",
    };
  }
  if (jobType === "collection_product") {
    return {
      productId: node.id,
      productTitle: node.title,
      productDescHtml: node.descriptionHtml || "",
      productSeoTitle: node.seo?.title || "",
      productSeoDesc: node.seo?.description || "",
      collectionId: itemRow.collectionId,
      collectionTitle: itemRow.collectionTitle || "",
    };
  }
  return {
    id: node.id,
    title: node.title,
    handle: node.handle || "",
    vendor: node.vendor || "",
    productType: node.productType || "",
    status: node.status || "ACTIVE",
    descriptionHtml: node.descriptionHtml || "",
    seoTitle: node.seo?.title || "",
    seoDescription: node.seo?.description || "",
    priceRangeV2: node.priceRangeV2 || null,
    variants: node.variants || null,
    featuredImage: node.featuredImage || null,
  };
}
