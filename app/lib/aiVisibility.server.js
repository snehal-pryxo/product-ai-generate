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

export function calcLlmsTxtCredits(itemCount) {
  return Math.min(20, Math.max(5, Math.ceil(itemCount / 10)));
}

export function calculateScore({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt }) {
  let score = 0;
  if (hasSeoTitle) score += 10;
  if (hasSeoDescription) score += 10;
  if (hasContent) score += 10;
  if (hasSchema) score += 30;
  if (hasFaq) score += 30;
  if (hasLlmsTxt) score += 10;
  return score;
}

export function scoreBreakdown({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt }) {
  return [
    { signal: "Meta title", points: 10, achieved: hasSeoTitle },
    { signal: "Meta description", points: 10, achieved: hasSeoDescription },
    { signal: "Body / description content", points: 10, achieved: hasContent },
    { signal: "Schema markup generated", points: 30, achieved: hasSchema },
    { signal: "FAQ section generated", points: 30, achieved: hasFaq },
    { signal: "Included in llms.txt", points: 10, achieved: hasLlmsTxt },
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

async function writeMetafield(adminGraphQL, ownerId, key, jsonValue) {
  try {
    const res = await adminGraphQL(METAFIELDS_SET_MUTATION, {
      variables: {
        metafields: [{ ownerId, namespace: "content_ai_geo", key, type: "json", value: jsonValue }],
      },
    });
    const json = await res.json();
    const errors = json?.data?.metafieldsSet?.userErrors || [];
    if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
    return json?.data?.metafieldsSet?.metafields?.[0]?.id || null;
  } catch {
    return null;
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

export async function generateSchema(shop, adminGraphQL, resourceType, resource) {
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
      price: variant?.price || resource.priceRange?.minVariantPrice?.amount,
      currencyCode: resource.priceRange?.minVariantPrice?.currencyCode || "USD",
      available: resource.availableForSale,
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

    const metafieldId = await writeMetafield(adminGraphQL, resource.id, "schema_json", schemaJson);

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

export async function generateFaq(shop, adminGraphQL, resourceType, resource) {
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
    const faqPageSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: arr.map((qa) => ({
        "@type": "Question",
        name: qa.question,
        acceptedAnswer: { "@type": "Answer", text: qa.answer },
      })),
    };
    const faqPageJson = JSON.stringify(faqPageSchema);

    const metafieldId = await writeMetafield(adminGraphQL, resource.id, "faq_json", faqPageJson);

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

export async function generateCombined(shop, adminGraphQL, resource) {
  const aiOptions = await getAiOptions(shop);
  const variant = resource.variants?.edges?.[0]?.node;
  const promptObj = buildCombinedProductPrompt({
    title: resource.title,
    description: (resource.description || "").substring(0, 500),
    vendor: resource.vendor,
    productType: resource.productType,
    price: variant?.price || resource.priceRange?.minVariantPrice?.amount,
    currencyCode: resource.priceRange?.minVariantPrice?.currencyCode || "USD",
    available: resource.availableForSale,
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

    await Promise.all([
      writeMetafield(adminGraphQL, resource.id, "schema_json", schemaJson),
      writeMetafield(adminGraphQL, resource.id, "faq_json", faqPageJson),
    ]);

    await db.aiVisibilitySchema.upsert({
      where: { shop_resourceType_resourceId: { shop, resourceType: "product", resourceId: resource.id } },
      create: { shop, resourceType: "product", resourceId: resource.id, schemaType: "Product", schemaJson, creditsUsed: CREDITS_COMBINED },
      update: { schemaJson, creditsUsed: CREDITS_COMBINED, updatedAt: new Date() },
    });
    await db.aiVisibilityFaq.upsert({
      where: { shop_resourceType_resourceId: { shop, resourceType: "product", resourceId: resource.id } },
      create: { shop, resourceType: "product", resourceId: resource.id, faqJson: faqPageJson, creditsUsed: 0 },
      update: { faqJson: faqPageJson, updatedAt: new Date() },
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
