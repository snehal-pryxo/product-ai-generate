import db from "../db.server";
import { getApiKeys, callAIRaw } from "./generateContent.server";
import { deductCredits, refundCredits } from "./credits.server";
import {
  buildProductSchemaPrompt,
  buildArticleSchemaPrompt,
  buildPageSchemaPrompt,
  buildProductFaqPrompt,
  buildArticleFaqPrompt,
  buildCombinedProductPrompt,
  buildLlmsTxtPrompt,
} from "./aiVisibilityPrompts";

export const CREDITS_SCHEMA = 2;
export const CREDITS_FAQ = 5;
export const CREDITS_COMBINED = 5;
const SHOPIFY_ADMIN_API_VERSION = "2026-04";
const METAFIELD_NAMESPACE = "content_ai_geo";
const METAFIELD_TYPE = "json";
const PRODUCT_UPDATE_DESCRIPTION_MUTATION = `#graphql
  mutation ProductUpdateDescription($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id descriptionHtml }
      userErrors { field message }
    }
  }
`;

export function calcLlmsTxtCredits(itemCount) {
  return Math.min(20, Math.max(5, Math.ceil(itemCount / 10)));
}

export function calculateScore({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt }) {
  let score = 0;
  if (hasSeoTitle) score += 15;
  if (hasSeoDescription) score += 15;
  if (hasContent) score += 15;
  if (hasSchema) score += 40;
  if (hasLlmsTxt) score += 15;
  return score;
}

export function scoreBreakdown({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt }) {
  return [
    { signal: "Meta title", points: 15, achieved: hasSeoTitle },
    { signal: "Meta description", points: 15, achieved: hasSeoDescription },
    { signal: "Body / description content", points: 15, achieved: hasContent },
    { signal: "Schema markup generated", points: 40, achieved: hasSchema },
    { signal: "Included in llms.txt", points: 15, achieved: hasLlmsTxt },
  ];
}

const METAFIELDS_SET_MUTATION = `#graphql
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key }
      userErrors { field message }
    }
  }
`;

function getAdminContext(adminContext) {
  if (typeof adminContext === "function") {
    return { adminGraphQL: adminContext, accessToken: null };
  }
  return {
    adminGraphQL: adminContext?.adminGraphQL,
    accessToken: adminContext?.accessToken || null,
  };
}

function restIdFromGid(gid) {
  const id = String(gid || "").split("/").pop();
  if (!id || id === String(gid || "")) throw new Error(`Invalid Shopify resource ID: ${gid}`);
  return id;
}

function restResourcePath(resourceType, resource) {
  const id = restIdFromGid(resource.id);
  if (resourceType === "product") return `products/${id}`;
  if (resourceType === "collection") return `collections/${id}`;
  if (resourceType === "article") return `articles/${id}`;
  if (resourceType === "page") return `pages/${id}`;
  throw new Error(`Unsupported metafield resourceType: ${resourceType}`);
}

async function shopifyRestJson(shop, accessToken, path, options = {}) {
  if (!accessToken) throw new Error("Missing Shopify access token for REST metafield write.");

  const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text };
    }
  }

  if (!response.ok) {
    const message = json?.errors || json?.error || json?.message || response.statusText;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }

  return json;
}

async function writeMetafieldWithGraphQL(adminGraphQL, ownerId, key, jsonValue) {
  try {
    const res = await adminGraphQL(METAFIELDS_SET_MUTATION, {
      variables: {
        metafields: [{ ownerId, namespace: METAFIELD_NAMESPACE, key, type: METAFIELD_TYPE, value: jsonValue }],
      },
    });
    const json = await res.json();
    const graphQLErrors = json?.errors || [];
    if (graphQLErrors.length > 0) {
      throw new Error(graphQLErrors.map((e) => e.message).join(", "));
    }

    const payload = json?.data?.metafieldsSet;
    const userErrors = payload?.userErrors || [];
    if (userErrors.length > 0) {
      throw new Error(userErrors.map((e) => e.message).join(", "));
    }

    const metafieldId = payload?.metafields?.[0]?.id;
    if (!metafieldId) throw new Error("Shopify did not return a metafield ID.");
    return metafieldId;
  } catch (err) {
    throw new Error(`Unable to write ${key} metafield: ${err?.message || "unknown Shopify error"}`);
  }
}

function buildAccessTokenGraphQLClient(shop, accessToken) {
  if (!accessToken) return null;
  return async (query, options = {}) => {
    const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables: options.variables || {} }),
    });
    return {
      json: async () => response.json(),
    };
  };
}

async function writeMetafieldWithRest({ shop, accessToken, resourceType, resource, key, jsonValue }) {
  const resourcePath = restResourcePath(resourceType, resource);
  const query = new URLSearchParams({ namespace: METAFIELD_NAMESPACE, key }).toString();
  const existingJson = await shopifyRestJson(shop, accessToken, `${resourcePath}/metafields.json?${query}`);
  const existing = (existingJson?.metafields || []).find(
    (metafield) => metafield.namespace === METAFIELD_NAMESPACE && metafield.key === key,
  );
  const body = {
    metafield: {
      namespace: METAFIELD_NAMESPACE,
      key,
      type: METAFIELD_TYPE,
      value: jsonValue,
    },
  };

  const result = existing?.id
    ? await shopifyRestJson(shop, accessToken, `${resourcePath}/metafields/${existing.id}.json`, {
        method: "PUT",
        body: {
          metafield: {
            id: existing.id,
            namespace: METAFIELD_NAMESPACE,
            key,
            value: jsonValue,
            type: METAFIELD_TYPE,
          },
        },
      })
    : await shopifyRestJson(shop, accessToken, `${resourcePath}/metafields.json`, {
        method: "POST",
        body,
      });

  const metafield = result?.metafield;
  if (!metafield?.id && !metafield?.admin_graphql_api_id) {
    throw new Error(`Shopify REST did not return a ${key} metafield ID.`);
  }
  return metafield.admin_graphql_api_id || `gid://shopify/Metafield/${metafield.id}`;
}

async function writeResourceMetafield({ shop, adminGraphQL, accessToken, resourceType, resource, key, jsonValue }) {
  try {
    if (!adminGraphQL) throw new Error("Missing Shopify GraphQL client.");
    return await writeMetafieldWithGraphQL(adminGraphQL, resource.id, key, jsonValue);
  } catch (graphqlErr) {
    try {
      return await writeMetafieldWithRest({ shop, accessToken, resourceType, resource, key, jsonValue });
    } catch (restErr) {
      throw new Error(
        `Unable to write ${key} metafield on ${resourceType}: GraphQL failed (${graphqlErr?.message || "unknown error"}); REST failed (${restErr?.message || "unknown error"}).`,
      );
    }
  }
}

function parseJsonResponse(raw) {
  const text = (typeof raw === "string" ? raw : JSON.stringify(raw)).trim();
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    throw new Error(`AI returned invalid JSON: ${stripped.substring(0, 200)}`);
  }
}

async function getAiOptions(shop) {
  const keys = await getApiKeys(shop);
  return {
    aiProvider: keys.defaultAiProvider || "auto",
    openaiKey: keys.openaiApiKey,
    anthropicKey: keys.anthropicApiKey,
    geminiKey: keys.geminiApiKey,
  };
}

export async function generateSchema(shop, adminContext, resourceType, resource) {
  const { adminGraphQL, accessToken } = getAdminContext(adminContext);
  const aiOptions = await getAiOptions(shop);
  let promptObj;
  let schemaType;

  if (resourceType === "product") {
    const variant = resource.variants?.edges?.[0]?.node;
    promptObj = buildProductSchemaPrompt({
      title: resource.title,
      description: (resource.description || "").substring(0, 500),
      vendor: resource.vendor,
      productType: resource.productType,
      price: variant?.price || resource.priceRangeV2?.minVariantPrice?.amount,
      currencyCode: resource.priceRangeV2?.minVariantPrice?.currencyCode || "USD",
      available: resource.status === "ACTIVE",
      url: `https://${shop}/products/${resource.handle}`,
    });
    schemaType = "Product";
  } else if (resourceType === "article") {
    promptObj = buildArticleSchemaPrompt({
      title: resource.title,
      summary: resource.summary,
      body: resource.body,
      authorName: resource.author?.name,
      publishedAt: resource.publishedAt,
      url: `https://${shop}/blogs/${resource.blog?.handle || "news"}/${resource.handle}`,
      blogTitle: resource.blog?.title,
    });
    schemaType = "BlogPosting";
  } else if (resourceType === "page") {
    promptObj = buildPageSchemaPrompt({
      title: resource.title,
      body: resource.body,
      url: `https://${shop}/pages/${resource.handle}`,
    });
    schemaType = "WebPage";
  } else {
    throw new Error(`Unsupported resourceType: ${resourceType}`);
  }

  await deductCredits({ shopDomain: shop, creditsUsed: CREDITS_SCHEMA });
  try {
    const raw = await callAIRaw(promptObj.prompt, promptObj.systemPrompt, aiOptions);
    const obj = parseJsonResponse(raw);
    const schemaJson = JSON.stringify(obj);

    const metafieldId = await writeResourceMetafield({
      shop,
      adminGraphQL,
      accessToken,
      resourceType,
      resource,
      key: "schema_json",
      jsonValue: schemaJson,
    });

    await db.aiVisibilitySchema.upsert({
      where: { shop_resourceType_resourceId: { shop, resourceType, resourceId: resource.id } },
      create: { shop, resourceType, resourceId: resource.id, schemaType, schemaJson, metafieldId, creditsUsed: CREDITS_SCHEMA },
      update: { schemaJson, metafieldId, creditsUsed: CREDITS_SCHEMA, updatedAt: new Date() },
    });

    return { schemaJson, creditsUsed: CREDITS_SCHEMA };
  } catch (err) {
    await refundCredits({ shopDomain: shop, creditsRefunded: CREDITS_SCHEMA });
    throw err;
  }
}

export async function generateProductSchemaForBulk(shop, accessToken, resource, aiOptions) {
  const variant = resource.variants?.edges?.[0]?.node;
  const promptObj = buildProductSchemaPrompt({
    title: resource.title,
    description: (resource.description || resource.descriptionHtml || "").substring(0, 500),
    vendor: resource.vendor,
    productType: resource.productType,
    price: variant?.price || resource.priceRangeV2?.minVariantPrice?.amount,
    currencyCode: resource.priceRangeV2?.minVariantPrice?.currencyCode || "USD",
    available: resource.status === "ACTIVE",
    url: `https://${shop}/products/${resource.handle || ""}`,
  });

  const raw = await callAIRaw(promptObj.prompt, promptObj.systemPrompt, aiOptions);
  const obj = parseJsonResponse(raw);
  const schemaJson = JSON.stringify(obj);
  const metafieldId = await writeResourceMetafield({
    shop,
    accessToken,
    resourceType: "product",
    resource,
    key: "schema_json",
    jsonValue: schemaJson,
  });

  await db.aiVisibilitySchema.upsert({
    where: { shop_resourceType_resourceId: { shop, resourceType: "product", resourceId: resource.id } },
    create: { shop, resourceType: "product", resourceId: resource.id, schemaType: "Product", schemaJson, metafieldId, creditsUsed: CREDITS_SCHEMA },
    update: { schemaJson, metafieldId, creditsUsed: CREDITS_SCHEMA, updatedAt: new Date() },
  });

  return { schemaJson, creditsUsed: CREDITS_SCHEMA };
}

function buildFaqPageJson(items) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((qa) => ({
      "@type": "Question",
      name: qa.question,
      acceptedAnswer: { "@type": "Answer", text: qa.answer },
    })),
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildFaqHtml(items) {
  if (!items.length) return "";
  return [
    '<section data-content-ai-faq="true">',
    "<h2>Frequently Asked Questions</h2>",
    ...items.map((qa) => (
      `<h3>${escapeHtml(qa.question)}</h3><p>${escapeHtml(qa.answer)}</p>`
    )),
    "</section>",
  ].join("");
}

function appendFaqHtmlToDescription(descriptionHtml, faqHtml) {
  const cleaned = String(descriptionHtml || "")
    .replace(/<section\b[^>]*data-content-ai-faq=["']true["'][^>]*>[\s\S]*?<\/section>/gi, "")
    .trim();
  return [cleaned, faqHtml].filter(Boolean).join("\n\n");
}

async function updateProductDescriptionHtml(shop, accessToken, productId, descriptionHtml) {
  const adminGraphQL = buildAccessTokenGraphQLClient(shop, accessToken);
  if (!adminGraphQL) throw new Error("Missing Shopify access token for product FAQ write.");
  const res = await adminGraphQL(PRODUCT_UPDATE_DESCRIPTION_MUTATION, {
    variables: { product: { id: productId, descriptionHtml } },
  });
  const json = await res.json();
  const errors = json?.errors || json?.data?.productUpdate?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join(", "));
  }
}

export async function generateBulkFaq(shop, accessToken, resourceType, resource, aiOptions, options = {}) {
  const title = resource.title || resource.productTitle || resource.collectionTitle || "Untitled";
  const description = (
    resource.description ||
    resource.descriptionHtml ||
    resource.productDescHtml ||
    ""
  ).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().substring(0, 500);
  const promptObj = buildProductFaqPrompt({ title, description });
  const raw = await callAIRaw(promptObj.prompt, promptObj.systemPrompt, aiOptions);
  const arr = parseJsonResponse(raw);
  if (!Array.isArray(arr)) throw new Error("AI returned non-array for FAQ.");
  const faqJson = buildFaqPageJson(arr);
  const faqHtml = buildFaqHtml(arr);

  if (resourceType === "product" && options.appendToProductDescription !== false) {
    const nextDescriptionHtml = appendFaqHtmlToDescription(resource.descriptionHtml, faqHtml);
    await updateProductDescriptionHtml(shop, accessToken, resource.id, nextDescriptionHtml);
  }

  const metafieldId = await writeResourceMetafield({
    shop,
    adminGraphQL: buildAccessTokenGraphQLClient(shop, accessToken),
    accessToken,
    resourceType,
    resource,
    key: "faq_json",
    jsonValue: faqJson,
  });

  await db.aiVisibilityFaq.upsert({
    where: { shop_resourceType_resourceId: { shop, resourceType, resourceId: resource.id } },
    create: { shop, resourceType, resourceId: resource.id, faqJson, metafieldId, creditsUsed: CREDITS_FAQ },
    update: { faqJson, metafieldId, creditsUsed: CREDITS_FAQ, updatedAt: new Date() },
  });

  return { faqJson, faqHtml, creditsUsed: CREDITS_FAQ };
}

export async function generateFaq(shop, adminContext, resourceType, resource) {
  const { adminGraphQL, accessToken } = getAdminContext(adminContext);
  if (resourceType === "page") throw new Error("FAQ is not supported for pages.");
  const aiOptions = await getAiOptions(shop);
  let promptObj;

  if (resourceType === "product") {
    promptObj = buildProductFaqPrompt({
      title: resource.title,
      description: (resource.description || "").substring(0, 500),
    });
  } else if (resourceType === "article") {
    promptObj = buildArticleFaqPrompt({
      title: resource.title,
      body: resource.body,
    });
  } else {
    throw new Error(`Unsupported resourceType for FAQ: ${resourceType}`);
  }

  await deductCredits({ shopDomain: shop, creditsUsed: CREDITS_FAQ });
  try {
    const raw = await callAIRaw(promptObj.prompt, promptObj.systemPrompt, aiOptions);
    const arr = parseJsonResponse(raw);
    if (!Array.isArray(arr)) throw new Error("AI returned non-array for FAQ.");
    const faqPageJson = buildFaqPageJson(arr);

    const metafieldId = await writeResourceMetafield({
      shop,
      adminGraphQL,
      accessToken,
      resourceType,
      resource,
      key: "faq_json",
      jsonValue: faqPageJson,
    });

    await db.aiVisibilityFaq.upsert({
      where: { shop_resourceType_resourceId: { shop, resourceType, resourceId: resource.id } },
      create: { shop, resourceType, resourceId: resource.id, faqJson: faqPageJson, metafieldId, creditsUsed: CREDITS_FAQ },
      update: { faqJson: faqPageJson, metafieldId, creditsUsed: CREDITS_FAQ, updatedAt: new Date() },
    });

    return { faqJson: faqPageJson, creditsUsed: CREDITS_FAQ };
  } catch (err) {
    await refundCredits({ shopDomain: shop, creditsRefunded: CREDITS_FAQ });
    throw err;
  }
}

export async function generateCombined(shop, adminContext, resource) {
  const { adminGraphQL, accessToken } = getAdminContext(adminContext);
  const aiOptions = await getAiOptions(shop);
  const variant = resource.variants?.edges?.[0]?.node;
  const promptObj = buildCombinedProductPrompt({
    title: resource.title,
    description: (resource.description || "").substring(0, 500),
    vendor: resource.vendor,
    productType: resource.productType,
    price: variant?.price || resource.priceRangeV2?.minVariantPrice?.amount,
    currencyCode: resource.priceRangeV2?.minVariantPrice?.currencyCode || "USD",
    available: resource.status === "ACTIVE",
    url: `https://${shop}/products/${resource.handle}`,
  });

  await deductCredits({ shopDomain: shop, creditsUsed: CREDITS_COMBINED });
  try {
    const raw = await callAIRaw(promptObj.prompt, promptObj.systemPrompt, aiOptions);
    const parsed = parseJsonResponse(raw);
    const schemaJson = JSON.stringify(parsed.schema);
    const faqArr = Array.isArray(parsed.faqs) ? parsed.faqs : [];
    const faqPageSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqArr.map((qa) => ({
        "@type": "Question",
        name: qa.question,
        acceptedAnswer: { "@type": "Answer", text: qa.answer },
      })),
    };
    const faqPageJson = JSON.stringify(faqPageSchema);

    const [schemaMetafieldId, faqMetafieldId] = await Promise.all([
      writeResourceMetafield({
        shop,
        adminGraphQL,
        accessToken,
        resourceType: "product",
        resource,
        key: "schema_json",
        jsonValue: schemaJson,
      }),
      writeResourceMetafield({
        shop,
        adminGraphQL,
        accessToken,
        resourceType: "product",
        resource,
        key: "faq_json",
        jsonValue: faqPageJson,
      }),
    ]);

    await db.aiVisibilitySchema.upsert({
      where: { shop_resourceType_resourceId: { shop, resourceType: "product", resourceId: resource.id } },
      create: {
        shop,
        resourceType: "product",
        resourceId: resource.id,
        schemaType: "Product",
        schemaJson,
        metafieldId: schemaMetafieldId,
        creditsUsed: CREDITS_COMBINED,
      },
      update: { schemaJson, metafieldId: schemaMetafieldId, creditsUsed: CREDITS_COMBINED, updatedAt: new Date() },
    });
    await db.aiVisibilityFaq.upsert({
      where: { shop_resourceType_resourceId: { shop, resourceType: "product", resourceId: resource.id } },
      create: {
        shop,
        resourceType: "product",
        resourceId: resource.id,
        faqJson: faqPageJson,
        metafieldId: faqMetafieldId,
        creditsUsed: 0,
      },
      update: { faqJson: faqPageJson, metafieldId: faqMetafieldId, updatedAt: new Date() },
    });

    return { schemaJson, faqJson: faqPageJson, creditsUsed: CREDITS_COMBINED };
  } catch (err) {
    await refundCredits({ shopDomain: shop, creditsRefunded: CREDITS_COMBINED });
    throw err;
  }
}

export async function generateLlmsTxt(shop, { products, articles, pages, shopName, shopDomain }) {
  const itemCount = products.length + articles.length + pages.length;
  const credits = calcLlmsTxtCredits(itemCount);
  const aiOptions = await getAiOptions(shop);
  const promptObj = buildLlmsTxtPrompt({ shopName, shopDomain, products, articles, pages });

  await deductCredits({ shopDomain: shop, creditsUsed: credits });
  try {
    let content = await callAIRaw(promptObj.prompt, promptObj.systemPrompt, aiOptions);
    if (typeof content !== "string") content = JSON.stringify(content);

    await db.aiVisibilityLlmsTxt.upsert({
      where: { shop },
      create: { shop, content, itemCount, creditsUsed: credits },
      update: { content, itemCount, creditsUsed: credits, updatedAt: new Date() },
    });

    return { content, creditsUsed: credits };
  } catch (err) {
    await refundCredits({ shopDomain: shop, creditsRefunded: credits });
    throw err;
  }
}
