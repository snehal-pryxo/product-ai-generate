import db from "../db.server";
import { getApiKeys, callAIRaw } from "./generateContent.server";
import { deductCredits, refundCredits } from "./credits.server";
import {
  buildProductSchemaPrompt,
  buildCollectionSchemaPrompt,
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
export const CREDITS_LLMS_TXT = 6;
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

export function calcLlmsTxtCredits() {
  return CREDITS_LLMS_TXT;
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

async function writeMetafieldWithGraphQL(adminGraphQL, ownerId, key, value, type = METAFIELD_TYPE) {
  try {
    const res = await adminGraphQL(METAFIELDS_SET_MUTATION, {
      variables: {
        metafields: [{ ownerId, namespace: METAFIELD_NAMESPACE, key, type, value }],
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

async function writeMetafieldWithRest({ shop, accessToken, resourceType, resource, key, value, type = METAFIELD_TYPE }) {
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
      type,
      value,
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
            value,
            type,
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

async function writeResourceMetafield({ shop, adminGraphQL, accessToken, resourceType, resource, key, jsonValue, value, type = METAFIELD_TYPE }) {
  const metafieldValue = value ?? jsonValue;
  try {
    if (!adminGraphQL) throw new Error("Missing Shopify GraphQL client.");
    return await writeMetafieldWithGraphQL(adminGraphQL, resource.id, key, metafieldValue, type);
  } catch (graphqlErr) {
    try {
      return await writeMetafieldWithRest({ shop, accessToken, resourceType, resource, key, value: metafieldValue, type });
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

async function getAiVisibilityCreditCost(shop, defaultCost) {
  const shopData = await db.shop.findUnique({
    where: { shop },
    select: { billingPlanKey: true },
  });
  return (shopData?.billingPlanKey || "free") === "free" ? defaultCost : 0;
}

export async function generateSchema(shop, adminContext, resourceType, resource) {
  const { adminGraphQL, accessToken } = getAdminContext(adminContext);
  const aiOptions = await getAiOptions(shop);
  const credits = await getAiVisibilityCreditCost(shop, CREDITS_SCHEMA);
  let promptObj;
  let schemaType;

  if (resourceType === "product") {
    const variant = resource.variants?.edges?.[0]?.node;
    const productUrl = `https://${shop}/products/${resource.handle}`;
    const productImage = resource.featuredImage?.url || resource.image?.url || "";
    const price = variant?.price || resource.priceRangeV2?.minVariantPrice?.amount;
    const currencyCode = resource.priceRangeV2?.minVariantPrice?.currencyCode || "USD";
    promptObj = buildProductSchemaPrompt({
      title: resource.title,
      description: (resource.description || "").substring(0, 500),
      vendor: resource.vendor,
      productType: resource.productType,
      price,
      currencyCode,
      available: resource.status === "ACTIVE",
      url: productUrl,
      image: productImage,
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
  } else if (resourceType === "collection") {
    const collectionProducts = normalizeCollectionProductsForSchema(shop, resource);
    const collectionImage = resource.image?.url || collectionProducts.find((product) => product.image)?.image || "";
    promptObj = buildCollectionSchemaPrompt({
      title: resource.title,
      description: (resource.description || resource.descriptionHtml || "").substring(0, 500),
      url: `https://${shop}/collections/${resource.handle}`,
      image: collectionImage,
      products: collectionProducts,
    });
    schemaType = "CollectionPage";
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

  if (credits > 0) {
    await deductCredits({ shopDomain: shop, creditsUsed: credits });
  }
  try {
    const raw = await callAIRaw(promptObj.prompt, promptObj.systemPrompt, aiOptions);
    let obj = parseJsonResponse(raw);
    if (resourceType === "product") {
      const variant = resource.variants?.edges?.[0]?.node;
      const productUrl = `https://${shop}/products/${resource.handle}`;
      obj = normalizeProductSchema(obj, {
        title: resource.title,
        description: resource.description || "",
        url: productUrl,
        image: resource.featuredImage?.url || resource.image?.url || "",
        vendor: resource.vendor,
        price: variant?.price || resource.priceRangeV2?.minVariantPrice?.amount,
        currencyCode: resource.priceRangeV2?.minVariantPrice?.currencyCode || "USD",
        available: resource.status === "ACTIVE",
      });
    }
    if (resourceType === "collection") {
      const collectionProducts = normalizeCollectionProductsForSchema(shop, resource);
      const collectionImage = resource.image?.url || collectionProducts.find((product) => product.image)?.image || "";
      obj = normalizeCollectionPageSchema(obj, {
        title: resource.title,
        description: resource.description || resource.descriptionHtml || "",
        url: `https://${shop}/collections/${resource.handle}`,
        image: collectionImage,
        products: collectionProducts,
      });
    }
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
      create: { shop, resourceType, resourceId: resource.id, schemaType, schemaJson, metafieldId, creditsUsed: credits },
      update: { schemaJson, metafieldId, creditsUsed: credits, updatedAt: new Date() },
    });

    return { schemaJson, creditsUsed: credits };
  } catch (err) {
    if (credits > 0) {
      await refundCredits({ shopDomain: shop, creditsRefunded: credits });
    }
    throw err;
  }
}

function normalizeCollectionProductsForSchema(shop, collection) {
  return (collection?.products?.edges || collection?.products?.nodes || [])
    .map((entry) => entry?.node || entry)
    .filter((product) => product?.title)
    .map((product) => ({
      name: product.title,
      description: product.description || "",
      url: `https://${shop}/products/${product.handle || ""}`,
      image: product.featuredImage?.url || product.image?.url || "",
      price: product.priceRangeV2?.minVariantPrice?.amount || "",
      currencyCode: product.priceRangeV2?.minVariantPrice?.currencyCode || "",
    }));
}

function normalizeProductSchema(schema, { title, description, url, image, vendor, price, currencyCode, available }) {
  const cleanDescription = String(description || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = {
    ...(schema && typeof schema === "object" && !Array.isArray(schema) ? schema : {}),
    "@context": "https://schema.org",
    "@type": "Product",
    name: schema?.name || title,
    description: schema?.description || cleanDescription || title,
    url: schema?.url || url,
    brand: schema?.brand || { "@type": "Organization", name: vendor || "" },
    offers: {
      ...(schema?.offers && typeof schema.offers === "object" && !Array.isArray(schema.offers) ? schema.offers : {}),
      "@type": "Offer",
      price: schema?.offers?.price || price || "",
      priceCurrency: schema?.offers?.priceCurrency || currencyCode || "USD",
      availability: schema?.offers?.availability || `https://schema.org/${available ? "InStock" : "OutOfStock"}`,
      url: schema?.offers?.url || url,
    },
  };
  if (image) normalized.image = image;
  return normalized;
}

function normalizeCollectionPageSchema(schema, { title, description, url, image, products }) {
  const cleanDescription = String(description || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = {
    ...(schema && typeof schema === "object" && !Array.isArray(schema) ? schema : {}),
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: schema?.name || title,
    description: schema?.description || cleanDescription || title,
    url,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: products.map((product, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Product",
          name: product.name,
          url: product.url,
          ...(product.image ? { image: product.image } : {}),
          ...(product.description ? { description: product.description } : {}),
          ...(product.price
            ? {
                offers: {
                  "@type": "Offer",
                  price: product.price,
                  ...(product.currencyCode ? { priceCurrency: product.currencyCode } : {}),
                  url: product.url,
                },
              }
            : {}),
        },
      })),
    },
  };

  if (image) {
    normalized.image = image;
  } else {
    delete normalized.image;
  }

  return normalized;
}

export async function generateProductSchemaForBulk(shop, accessToken, resource, aiOptions, options = {}) {
  const credits = options.creditsUsed ?? 0;
  const variant = resource.variants?.edges?.[0]?.node;
  const productUrl = `https://${shop}/products/${resource.handle || ""}`;
  const productImage = resource.featuredImage?.url || resource.image?.url || "";
  const price = variant?.price || resource.priceRangeV2?.minVariantPrice?.amount;
  const currencyCode = resource.priceRangeV2?.minVariantPrice?.currencyCode || "USD";
  const promptObj = buildProductSchemaPrompt({
    title: resource.title,
    description: (resource.description || resource.descriptionHtml || "").substring(0, 500),
    vendor: resource.vendor,
    productType: resource.productType,
    price,
    currencyCode,
    available: resource.status === "ACTIVE",
    url: productUrl,
    image: productImage,
  });

  const raw = await callAIRaw(promptObj.prompt, promptObj.systemPrompt, aiOptions);
  const obj = normalizeProductSchema(parseJsonResponse(raw), {
    title: resource.title,
    description: resource.description || resource.descriptionHtml || "",
    url: productUrl,
    image: productImage,
    vendor: resource.vendor,
    price,
    currencyCode,
    available: resource.status === "ACTIVE",
  });
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
    create: { shop, resourceType: "product", resourceId: resource.id, schemaType: "Product", schemaJson, metafieldId, creditsUsed: credits },
    update: { schemaJson, metafieldId, creditsUsed: credits, updatedAt: new Date() },
  });

  return { schemaJson, creditsUsed: credits };
}

function buildFaqPageJson(items) {
  const normalizedItems = items.filter((qa) => qa?.question && qa?.answer).slice(0, 2);
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: normalizedItems.map((qa) => ({
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
  const normalizedItems = items.filter((qa) => qa?.question && qa?.answer).slice(0, 2);
  if (!normalizedItems.length) return "";
  return [
    '<section data-content-ai-faq="true">',
    "<h2>Frequently Asked Questions</h2>",
    ...normalizedItems.map((qa) => (
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
  const credits = options.creditsUsed ?? 0;
  const title = resource.title || resource.productTitle || resource.collectionTitle || "Untitled";
  const description = (
    resource.description ||
    resource.descriptionHtml ||
    resource.productDescHtml ||
    ""
  ).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().substring(0, 500);
  const promptObj = buildProductFaqPrompt({
    title,
    description,
    language: options.language || "English",
  });
  const raw = await callAIRaw(promptObj.prompt, promptObj.systemPrompt, aiOptions);
  const arr = parseJsonResponse(raw);
  if (!Array.isArray(arr)) throw new Error("AI returned non-array for FAQ.");
  const faqJson = buildFaqPageJson(arr);
  const faqHtml = buildFaqHtml(arr);

  if (resourceType === "product" && options.appendToProductDescription === true) {
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
  await writeResourceMetafield({
    shop,
    adminGraphQL: buildAccessTokenGraphQLClient(shop, accessToken),
    accessToken,
    resourceType,
    resource,
    key: "faq_html",
    type: "multi_line_text_field",
    value: faqHtml,
  });

  await db.aiVisibilityFaq.upsert({
    where: { shop_resourceType_resourceId: { shop, resourceType, resourceId: resource.id } },
    create: { shop, resourceType, resourceId: resource.id, faqJson, metafieldId, creditsUsed: credits },
    update: { faqJson, metafieldId, creditsUsed: credits, updatedAt: new Date() },
  });

  if (resourceType === "product") {
    await db.productGeneratedContent.upsert({
      where: { shop_productId: { shop, productId: resource.id } },
      create: {
        shop,
        productId: resource.id,
        productTitle: title || null,
        descriptionHtml: resource.descriptionHtml || null,
        faqHtml,
        faqJson,
        creditsUsed: credits,
        appliedToProduct: true,
      },
      update: {
        productTitle: title || null,
        faqHtml,
        faqJson,
        creditsUsed: credits,
        appliedToProduct: true,
        updatedAt: new Date(),
      },
    });
  }

  return { faqJson, faqHtml, creditsUsed: credits };
}

export async function generateFaq(shop, adminContext, resourceType, resource) {
  const { adminGraphQL, accessToken } = getAdminContext(adminContext);
  if (resourceType === "page") throw new Error("FAQ is not supported for pages.");
  const aiOptions = await getAiOptions(shop);
  const credits = await getAiVisibilityCreditCost(shop, CREDITS_FAQ);
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

  if (credits > 0) {
    await deductCredits({ shopDomain: shop, creditsUsed: credits });
  }
  try {
    const raw = await callAIRaw(promptObj.prompt, promptObj.systemPrompt, aiOptions);
    const arr = parseJsonResponse(raw);
    if (!Array.isArray(arr)) throw new Error("AI returned non-array for FAQ.");
    const faqPageJson = buildFaqPageJson(arr);
    const faqHtml = buildFaqHtml(arr);

    const metafieldId = await writeResourceMetafield({
      shop,
      adminGraphQL,
      accessToken,
      resourceType,
      resource,
      key: "faq_json",
      jsonValue: faqPageJson,
    });
    await writeResourceMetafield({
      shop,
      adminGraphQL,
      accessToken,
      resourceType,
      resource,
      key: "faq_html",
      type: "multi_line_text_field",
      value: faqHtml,
    });

    await db.aiVisibilityFaq.upsert({
      where: { shop_resourceType_resourceId: { shop, resourceType, resourceId: resource.id } },
      create: { shop, resourceType, resourceId: resource.id, faqJson: faqPageJson, metafieldId, creditsUsed: credits },
      update: { faqJson: faqPageJson, metafieldId, creditsUsed: credits, updatedAt: new Date() },
    });

    if (resourceType === "product") {
      await db.productGeneratedContent.upsert({
        where: { shop_productId: { shop, productId: resource.id } },
        create: {
          shop,
          productId: resource.id,
          productTitle: resource.title || null,
          descriptionHtml: resource.descriptionHtml || resource.description || null,
          faqHtml,
          faqJson: faqPageJson,
          creditsUsed: credits,
          appliedToProduct: true,
        },
        update: {
          productTitle: resource.title || null,
          faqHtml,
          faqJson: faqPageJson,
          creditsUsed: credits,
          appliedToProduct: true,
          updatedAt: new Date(),
        },
      });
    }

    return { faqJson: faqPageJson, faqHtml, creditsUsed: credits };
  } catch (err) {
    if (credits > 0) {
      await refundCredits({ shopDomain: shop, creditsRefunded: credits });
    }
    throw err;
  }
}

export async function generateCombined(shop, adminContext, resource) {
  const { adminGraphQL, accessToken } = getAdminContext(adminContext);
  const aiOptions = await getAiOptions(shop);
  const credits = await getAiVisibilityCreditCost(shop, CREDITS_COMBINED);
  const variant = resource.variants?.edges?.[0]?.node;
  const productUrl = `https://${shop}/products/${resource.handle}`;
  const productImage = resource.featuredImage?.url || resource.image?.url || "";
  const price = variant?.price || resource.priceRangeV2?.minVariantPrice?.amount;
  const currencyCode = resource.priceRangeV2?.minVariantPrice?.currencyCode || "USD";
  const promptObj = buildCombinedProductPrompt({
    title: resource.title,
    description: (resource.description || "").substring(0, 500),
    vendor: resource.vendor,
    productType: resource.productType,
    price,
    currencyCode,
    available: resource.status === "ACTIVE",
    url: productUrl,
    image: productImage,
  });

  if (credits > 0) {
    await deductCredits({ shopDomain: shop, creditsUsed: credits });
  }
  try {
    const raw = await callAIRaw(promptObj.prompt, promptObj.systemPrompt, aiOptions);
    const parsed = parseJsonResponse(raw);
    const schemaJson = JSON.stringify(normalizeProductSchema(parsed.schema, {
      title: resource.title,
      description: resource.description || resource.descriptionHtml || "",
      url: productUrl,
      image: productImage,
      vendor: resource.vendor,
      price,
      currencyCode,
      available: resource.status === "ACTIVE",
    }));
    const faqArr = (Array.isArray(parsed.faqs) ? parsed.faqs : []).filter((qa) => qa?.question && qa?.answer).slice(0, 2);
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
    const faqHtml = buildFaqHtml(faqArr);

    const [schemaMetafieldId, faqMetafieldId, faqHtmlMetafieldId] = await Promise.all([
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
      writeResourceMetafield({
        shop,
        adminGraphQL,
        accessToken,
        resourceType: "product",
        resource,
        key: "faq_html",
        type: "multi_line_text_field",
        value: faqHtml,
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
        creditsUsed: credits,
      },
      update: { schemaJson, metafieldId: schemaMetafieldId, creditsUsed: credits, updatedAt: new Date() },
    });
    await db.aiVisibilityFaq.upsert({
      where: { shop_resourceType_resourceId: { shop, resourceType: "product", resourceId: resource.id } },
      create: {
        shop,
        resourceType: "product",
        resourceId: resource.id,
        faqJson: faqPageJson,
        metafieldId: faqMetafieldId || faqHtmlMetafieldId,
        creditsUsed: 0,
      },
      update: { faqJson: faqPageJson, metafieldId: faqMetafieldId || faqHtmlMetafieldId, updatedAt: new Date() },
    });
    await db.productGeneratedContent.upsert({
      where: { shop_productId: { shop, productId: resource.id } },
      create: {
        shop,
        productId: resource.id,
        productTitle: resource.title || null,
        descriptionHtml: resource.descriptionHtml || resource.description || null,
        faqHtml,
        faqJson: faqPageJson,
        creditsUsed: credits,
        appliedToProduct: true,
      },
      update: {
        productTitle: resource.title || null,
        faqHtml,
        faqJson: faqPageJson,
        creditsUsed: credits,
        appliedToProduct: true,
        updatedAt: new Date(),
      },
    });

    return { schemaJson, faqJson: faqPageJson, faqHtml, creditsUsed: credits };
  } catch (err) {
    if (credits > 0) {
      await refundCredits({ shopDomain: shop, creditsRefunded: credits });
    }
    throw err;
  }
}

export async function generateLlmsTxt(shop, { products, articles, pages, collections = [], shopName, shopDomain }) {
  const itemCount = products.length + articles.length + pages.length + collections.length;
  const credits = calcLlmsTxtCredits();
  const aiOptions = await getAiOptions(shop);
  const promptObj = buildLlmsTxtPrompt({ shopName, shopDomain, products, articles, pages, collections });

  if (credits > 0) {
    await deductCredits({ shopDomain: shop, creditsUsed: credits });
  }
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
    if (credits > 0) {
      await refundCredits({ shopDomain: shop, creditsRefunded: credits });
    }
    throw err;
  }
}
