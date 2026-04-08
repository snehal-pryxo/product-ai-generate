import { useState, useCallback, useEffect, useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  ActionList,
  EmptyState,
  IndexTable,
  InlineStack,
  Modal,
  Page,
  Popover,
  ProgressBar,
  Select,
  Tabs,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import {
  PRODUCT_DESCRIPTION_TEMPLATES,
  PRODUCT_META_DESCRIPTION_TEMPLATES,
  PRODUCT_META_TITLE_TEMPLATES,
} from "../lib/productPromptTemplateLibrary";
import {
  COLLECTION_DESCRIPTION_TEMPLATES,
  COLLECTION_META_DESCRIPTION_TEMPLATES,
  COLLECTION_META_TITLE_TEMPLATES,
} from "../lib/collectionPromptTemplateLibrary";
import {
  PAGE_BODY_TEMPLATES,
  PAGE_META_DESCRIPTION_TEMPLATES,
  PAGE_META_TITLE_TEMPLATES,
} from "../lib/pagePromptTemplateLibrary";
import {
  BLOG_BODY_TEMPLATES,
  BLOG_META_DESCRIPTION_TEMPLATES,
  BLOG_META_TITLE_TEMPLATES,
} from "../lib/blogPromptTemplateLibrary";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import {
  buildProductContentPrompt,
  buildCollectionContentPrompt,
  buildPageContentPrompt,
  buildBlogContentPrompt,
} from "../lib/contentPromptTemplates";
import { buildInsufficientCreditsError, deductCredits } from "../lib/credits.server";
/* global process */

// ─── Constants ───────────────────────────────────────────────────────────────
const CREDITS_PER_GENERATION = 3;
const FETCH_BATCH_SIZE = 250;
const DEFAULT_AI_MODEL = "gpt-4o-mini";
const DEFAULT_OLLAMA_MODEL = "llama3.2:1b";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const OPENAI_RATE_LIMIT_RETRY_DELAY_MS = 20000;
const OPENAI_RATE_LIMIT_ERROR_PATTERN = /rate limit|too many requests|429/i;
const OPENAI_QUOTA_ERROR_PATTERN = /quota|billing|insufficient_quota/i;
const OPENAI_MODEL_ACCESS_ERROR_PATTERN = /does not exist|do not have access|not found/i;
const OPENAI_OLLAMA_FALLBACK_ERROR_PATTERN =
  /quota|billing|insufficient_quota|OPENAI_API_KEY is missing|does not exist|do not have access|rate limit|too many requests|429/i;
const ENABLED_ENV_VALUE_PATTERN = /^(1|true|yes)$/i;

function creditsForGenerateScope(scope) {
  return scope === "all" ? CREDITS_PER_GENERATION : 1;
}

function getGenerateScopeOptions(contentType) {
  const mainLabel = contentType === "pages" || contentType === "blog" ? "Content" : "Description";
  return [
    { value: "all", label: "All" },
    { value: "main", label: mainLabel },
    { value: "meta_title", label: "Meta Title" },
    { value: "meta_description", label: "Meta Description" },
  ];
}

const LANGUAGE_OPTIONS = [
  { label: "English (US)", value: "English (US)" },
  { label: "English (UK)", value: "English (UK)" },
  { label: "Hindi", value: "Hindi" },
];

const AI_MODEL_OPTIONS = [
  { label: "GPT-4.1 Mini", value: "gpt-4.1-mini" },
  { label: "GPT-4.1", value: "gpt-4.1" },
  { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
];

function getScopeDisplayLabel(contentType, scope) {
  const mainLabel = contentType === "pages" || contentType === "blog" ? "Content" : "Description";
  if (scope === "main") return mainLabel;
  if (scope === "meta_title") return "Meta Title";
  if (scope === "meta_description") return "Meta Description";
  return "All";
}

function getContentTypeDisplayLabel(contentType) {
  if (contentType === "products") return "product";
  if (contentType === "collections") return "collection";
  if (contentType === "pages") return "page";
  if (contentType === "blog") return "blog";
  return "item";
}

// ─── GraphQL ─────────────────────────────────────────────────────────────────
const PRODUCT_LIST_QUERY = `#graphql
  query ProductList($first: Int, $after: String) {
    products(first: $first, after: $after, sortKey: TITLE) {
      edges {
        node {
          id title handle status updatedAt
          descriptionHtml
          seo { title description }
          featuredMedia {
            preview {
              image { url altText }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = `#graphql
  mutation ProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id title descriptionHtml seo { title description } }
      userErrors { field message }
    }
  }
`;

const COLLECTION_LIST_QUERY = `#graphql
  query CollectionList($first: Int, $after: String) {
    collections(first: $first, after: $after, sortKey: TITLE) {
      edges {
        node {
          id title handle updatedAt
          descriptionHtml
          seo { title description }
          image { url altText }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const COLLECTION_UPDATE_MUTATION = `#graphql
  mutation CollectionUpdateInput($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection { id title descriptionHtml seo { title description } }
      userErrors { field message }
    }
  }
`;

const PAGES_QUERY = `#graphql
  query GetPages($first: Int!, $after: String) {
    pages(first: $first, after: $after) {
      edges {
        node {
          id title handle body bodySummary updatedAt
          metafields(first: 5, namespace: "global") {
            edges { node { key value } }
          }
        }
        cursor
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PAGE_UPDATE_MUTATION = `#graphql
  mutation PageUpdate($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page { id title body }
      userErrors { field message }
    }
  }
`;

const METAFIELDS_SET_MUTATION = `#graphql
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { key value }
      userErrors { field message }
    }
  }
`;

const ARTICLES_QUERY = `#graphql
  query GetArticles($first: Int!) {
    articles(first: $first) {
      edges {
        node {
          id title body handle publishedAt
          blog { id title }
          metafields(first: 5, namespace: "global") {
            edges { node { key value } }
          }
        }
      }
    }
  }
`;

const ARTICLE_UPDATE_MUTATION = `#graphql
  mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article { id title }
      userErrors { field message }
    }
  }
`;

// ─── Server helpers ───────────────────────────────────────────────────────────
function stripHtml(html) {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanInlineText(value, maxLength) {
  return (value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function toParagraphHtml(value) {
  const text = (value || "").trim();
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value || "");
}

function normalizeGeneratedHtml(value) {
  const text = (value || "").trim();
  if (!text) return "";
  if (looksLikeHtml(text)) return text;
  return toParagraphHtml(text);
}

function canUseOllamaFallback() {
  const baseUrl = (process.env.OLLAMA_BASE_URL || "").trim();
  const enabledValue = (process.env.ENABLE_OLLAMA_FALLBACK || "").trim();
  return Boolean(baseUrl) && ENABLED_ENV_VALUE_PATTERN.test(enabledValue);
}

function parseGenerationContent(rawContent, modelName) {
  if (!rawContent || typeof rawContent !== "string") throw new Error("AI response was empty.");
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    const m = rawContent.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI response format was invalid.");
    parsed = JSON.parse(m[0]);
  }
  return {
    description: (
      parsed?.productDescription ||
      parsed?.collectionDescription ||
      parsed?.pageBody ||
      parsed?.articleBody ||
      parsed?.description ||
      parsed?.body ||
      ""
    ).trim(),
    seoTitle: cleanInlineText(parsed?.seoTitle || "", 70),
    seoDescription: cleanInlineText(parsed?.seoDescription || "", 160),
    aiModel: modelName || null,
  };
}

async function generateContentWithOpenAI(prompt, shopApiKey, preferredModel = null) {
  const apiKey = shopApiKey || process.env.OPENAI_API_KEY;
  const configuredModel = preferredModel || process.env.OPENAI_MODEL || DEFAULT_AI_MODEL;
  if (!apiKey) throw new Error("OpenAI API key is not configured.");

  const payload = (model) => ({
    model,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are an expert Shopify copywriter. Always return valid JSON with the requested keys." },
      { role: "user", content: prompt },
    ],
  });

  async function send(model, attempt = 0) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload(model)),
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    const errMsg = data?.error?.message || `OpenAI request failed with status ${res.status}.`;
    const errCode = String(data?.error?.code || "").toLowerCase();

    if (!res.ok && res.status === 429 && attempt < 1 && OPENAI_RATE_LIMIT_ERROR_PATTERN.test(errMsg)) {
      await new Promise((r) => setTimeout(r, OPENAI_RATE_LIMIT_RETRY_DELAY_MS));
      return send(model, attempt + 1);
    }
    if (!res.ok) {
      const shouldFallback =
        model !== DEFAULT_AI_MODEL &&
        (OPENAI_MODEL_ACCESS_ERROR_PATTERN.test(errMsg) ||
          OPENAI_QUOTA_ERROR_PATTERN.test(errMsg) ||
          errCode === "insufficient_quota");
      if (shouldFallback) return send(DEFAULT_AI_MODEL, 0);
      throw new Error(errMsg);
    }
    return parseGenerationContent(data?.choices?.[0]?.message?.content, data?.model || model);
  }
  return send(configuredModel);
}

async function generateContentWithAnthropic(prompt, apiKey, preferredModel = null) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Anthropic API key is not configured.");
  const model = preferredModel || "claude-haiku-4-5-20251001";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: "You are an expert Shopify copywriter. Always return valid JSON with the requested keys. No markdown, no code fences.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic request failed with status ${res.status}.`);
  return parseGenerationContent(data?.content?.[0]?.text, data?.model || model);
}

async function generateContentWithOllama(prompt) {
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model, stream: false, format: "json", options: { temperature: 0.7 },
      messages: [
        { role: "system", content: "You are an expert Shopify copywriter. Always return valid JSON with the requested keys." },
        { role: "user", content: prompt },
      ],
    }),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(data?.error || `Ollama request failed with status ${res.status}.`);
  return parseGenerationContent(data?.message?.content, data?.model || model);
}

async function runGeneration(
  prompt,
  { aiProvider = "auto", preferredModel = null, shopOpenaiKey = null, shopAnthropicKey = null } = {},
) {
  const openaiKey = shopOpenaiKey || process.env.OPENAI_API_KEY;
  const anthropicKey = shopAnthropicKey || process.env.ANTHROPIC_API_KEY;

  if (aiProvider === "anthropic") return generateContentWithAnthropic(prompt, anthropicKey, preferredModel);
  if (aiProvider === "openai") {
    try { return await generateContentWithOpenAI(prompt, openaiKey, preferredModel); }
    catch (err) {
      if (OPENAI_OLLAMA_FALLBACK_ERROR_PATTERN.test(err?.message || "") && canUseOllamaFallback())
        return generateContentWithOllama(prompt);
      throw err;
    }
  }
  // auto mode
  const envProvider = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (envProvider === "ollama") {
    try { return await generateContentWithOllama(prompt); }
    catch (err) {
      if (!openaiKey) throw err;
      return generateContentWithOpenAI(prompt, openaiKey, preferredModel);
    }
  }
  try { return await generateContentWithOpenAI(prompt, openaiKey, preferredModel); }
  catch (err) {
    if (OPENAI_OLLAMA_FALLBACK_ERROR_PATTERN.test(err?.message || "") && canUseOllamaFallback())
      return generateContentWithOllama(prompt);
    throw err;
  }
}

function buildPrompt(
  contentType,
  item,
  templateOverrides = {},
  generateScope = "all",
  generationOptions = {},
) {
  const promptIntent =
    generateScope === "meta_title"
      ? "seo_title"
      : generateScope === "meta_description"
        ? "seo_description"
        : "all";
  const base = {
    language: generationOptions.language || "English",
    tone: "Neutral",
    lengthOption: "150 - 300 words",
    format: "Multiple sections with headings and paragraphs",
    contextKeywords: generationOptions.contextKeywords || "",
    descriptionPromptTemplate: "",
    metaTitlePromptTemplate: "",
    metaDescriptionPromptTemplate: "",
    intent: promptIntent,
  };

  if (contentType === "products") {
    return buildProductContentPrompt({
      ...base,
      title: item.title,
      descriptionText: stripHtml(item.descriptionHtml || ""),
      seoTitle: item.seoTitle || "",
      seoDescription: item.seoDescription || "",
      descriptionPromptTemplate: templateOverrides.descriptionPromptTemplate || "",
      metaTitlePromptTemplate: templateOverrides.metaTitlePromptTemplate || "",
      metaDescriptionPromptTemplate: templateOverrides.metaDescriptionPromptTemplate || "",
    });
  }
  if (contentType === "collections") {
    return buildCollectionContentPrompt({
      ...base,
      title: item.title,
      descriptionText: stripHtml(item.descriptionHtml || ""),
      seoTitle: item.seoTitle || "",
      seoDescription: item.seoDescription || "",
      descriptionPromptTemplate: templateOverrides.descriptionPromptTemplate || "",
      metaTitlePromptTemplate: templateOverrides.metaTitlePromptTemplate || "",
      metaDescriptionPromptTemplate: templateOverrides.metaDescriptionPromptTemplate || "",
    });
  }
  if (contentType === "pages") {
    return buildPageContentPrompt({
      pageTitle: item.title,
      pageType: "General",
      body: stripHtml(item.descriptionHtml || item.body || ""),
      language: generationOptions.language || "English",
      tone: "Neutral",
      length: "Medium",
      format: "Mixed headings and paragraphs",
      contextKeywords: generationOptions.contextKeywords || "",
      bodyPromptTemplate: templateOverrides.bodyPromptTemplate || "",
      metaTitlePromptTemplate: templateOverrides.metaTitlePromptTemplate || "",
      metaDescriptionPromptTemplate: templateOverrides.metaDescriptionPromptTemplate || "",
    });
  }
  if (contentType === "blog") {
    return buildBlogContentPrompt({
      articleType: "General",
      title: item.title,
      body: stripHtml(item.descriptionHtml || item.body || ""),
      language: generationOptions.language || "English",
      tone: "Neutral",
      length: "Medium",
      format: "Mixed headings and paragraphs",
      contextKeywords: generationOptions.contextKeywords || "",
      bodyPromptTemplate: templateOverrides.bodyPromptTemplate || "",
      metaTitlePromptTemplate: templateOverrides.metaTitlePromptTemplate || "",
      metaDescriptionPromptTemplate: templateOverrides.metaDescriptionPromptTemplate || "",
    });
  }
  throw new Error(`Unknown content type: ${contentType}`);
}

function getGenerateTemplateConfig(contentType) {
  if (contentType === "products") {
    return {
      mainLabel: "Description Template",
      mainTemplates: PRODUCT_DESCRIPTION_TEMPLATES,
      metaTitleTemplates: PRODUCT_META_TITLE_TEMPLATES,
      metaDescriptionTemplates: PRODUCT_META_DESCRIPTION_TEMPLATES,
      mainPromptKey: "descriptionPromptTemplate",
    };
  }
  if (contentType === "collections") {
    return {
      mainLabel: "Description Template",
      mainTemplates: COLLECTION_DESCRIPTION_TEMPLATES,
      metaTitleTemplates: COLLECTION_META_TITLE_TEMPLATES,
      metaDescriptionTemplates: COLLECTION_META_DESCRIPTION_TEMPLATES,
      mainPromptKey: "descriptionPromptTemplate",
    };
  }
  if (contentType === "pages") {
    return {
      mainLabel: "Content Template",
      mainTemplates: PAGE_BODY_TEMPLATES,
      metaTitleTemplates: PAGE_META_TITLE_TEMPLATES,
      metaDescriptionTemplates: PAGE_META_DESCRIPTION_TEMPLATES,
      mainPromptKey: "bodyPromptTemplate",
    };
  }
  if (contentType === "blog") {
    return {
      mainLabel: "Content Template",
      mainTemplates: BLOG_BODY_TEMPLATES,
      metaTitleTemplates: BLOG_META_TITLE_TEMPLATES,
      metaDescriptionTemplates: BLOG_META_DESCRIPTION_TEMPLATES,
      mainPromptKey: "bodyPromptTemplate",
    };
  }
  return null;
}

// ─── Loader ───────────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const requestedTab = (url.searchParams.get("tab") || "all").toLowerCase();
  const requestedFilter = (url.searchParams.get("filter") || "all").toLowerCase();
  const validTabs = new Set(["all", "products", "collections", "pages", "blog"]);
  const validFilters = new Set(["all", "unoptimized", "empty"]);
  const tab = validTabs.has(requestedTab) ? requestedTab : "all";
  const filter = validFilters.has(requestedFilter) ? requestedFilter : "all";

  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { credits: true, creditsUsedTotal: true, defaultAiProvider: true, openaiApiKey: true, anthropicApiKey: true },
  });
  const credits = shopData?.credits ?? 100;
  const defaultAiProvider = shopData?.defaultAiProvider || "auto";

  const shouldLoadProducts = tab === "all" || tab === "products";
  const shouldLoadCollections = tab === "all" || tab === "collections";
  const shouldLoadPages = tab === "all" || tab === "pages";
  const shouldLoadBlog = tab === "all" || tab === "blog";

  const [
    productGeneratedRows,
    collectionGeneratedRows,
    pageGeneratedRows,
    blogGeneratedRows,
    logRows,
  ] = await Promise.all([
    shouldLoadProducts
      ? db.productGeneratedContent.findMany({
          where: { shop: session.shop },
          select: { productId: true, creditsUsed: true },
        })
      : Promise.resolve([]),
    shouldLoadCollections
      ? db.collectionGeneratedContent.findMany({
          where: { shop: session.shop },
          select: { collectionId: true, creditsUsed: true },
        })
      : Promise.resolve([]),
    shouldLoadPages
      ? db.pageGeneratedContent.findMany({
          where: { shop: session.shop },
          select: { pageId: true, creditsUsed: true },
        })
      : Promise.resolve([]),
    shouldLoadBlog
      ? db.blogArticleGeneratedContent.findMany({
          where: { shop: session.shop },
          select: { articleId: true, creditsUsed: true },
        })
      : Promise.resolve([]),
    db.generatedContentLog.findMany({
      where: { shop: session.shop },
      select: { productId: true, resourceType: true, creditsUsed: true },
    }),
  ]);

  const productCreditsMap = new Map(productGeneratedRows.map((row) => [row.productId, row.creditsUsed ?? 0]));
  const collectionCreditsMap = new Map(collectionGeneratedRows.map((row) => [row.collectionId, row.creditsUsed ?? 0]));
  const pageCreditsMap = new Map(pageGeneratedRows.map((row) => [row.pageId, row.creditsUsed ?? 0]));
  const blogCreditsMap = new Map(blogGeneratedRows.map((row) => [row.articleId, row.creditsUsed ?? 0]));

  const logCreditsMapByType = {
    products: new Map(),
    collections: new Map(),
    pages: new Map(),
    blog: new Map(),
  };

  for (const row of logRows) {
    const itemId = row.productId;
    const creditsUsed = row.creditsUsed ?? 0;
    const type =
      row.resourceType === "collection"
        ? "collections"
        : row.resourceType === "page"
          ? "pages"
          : row.resourceType === "blog"
            ? "blog"
            : "products";
    if (!itemId) continue;
    logCreditsMapByType[type].set(itemId, (logCreditsMapByType[type].get(itemId) || 0) + creditsUsed);
  }

  const resolveCreditsUsed = (contentType, itemId) => {
    if (!itemId) return 0;
    if (contentType === "products") {
      return productCreditsMap.get(itemId) ?? logCreditsMapByType.products.get(itemId) ?? 0;
    }
    if (contentType === "collections") {
      return collectionCreditsMap.get(itemId) ?? logCreditsMapByType.collections.get(itemId) ?? 0;
    }
    if (contentType === "pages") {
      return pageCreditsMap.get(itemId) ?? logCreditsMapByType.pages.get(itemId) ?? 0;
    }
    if (contentType === "blog") {
      return blogCreditsMap.get(itemId) ?? logCreditsMapByType.blog.get(itemId) ?? 0;
    }
    return 0;
  };

  let items = [];

  try {
    if (tab === "all") {
      // Fetch from all content types
      const allItems = [];

      // Fetch products
      const productNodes = [];
      let afterCursor = null;
      while (true) {
        const res = await admin.graphql(PRODUCT_LIST_QUERY, {
          variables: { first: FETCH_BATCH_SIZE, after: afterCursor },
        });
        const json = await res.json();
        const conn = json?.data?.products;
        if (!conn) break;
        productNodes.push(...(conn.edges || []).map((e) => ({ ...e.node, contentType: "products" })));
        if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) break;
        afterCursor = conn.pageInfo.endCursor;
      }
      allItems.push(...productNodes.map((n) => ({
        id: n.id,
        title: n.title,
        handle: n.handle,
        status: n.status,
        descriptionHtml: n.descriptionHtml || "",
        seoTitle: n.seo?.title || "",
        seoDescription: n.seo?.description || "",
        imageUrl: n.featuredMedia?.preview?.image?.url || null,
        imageAlt: n.featuredMedia?.preview?.image?.altText || n.title,
        updatedAt: n.updatedAt || null,
        contentType: "products",
        creditsUsed: resolveCreditsUsed("products", n.id),
      })));

      // Fetch collections
      const collectionNodes = [];
      afterCursor = null;
      while (true) {
        const res = await admin.graphql(COLLECTION_LIST_QUERY, {
          variables: { first: FETCH_BATCH_SIZE, after: afterCursor },
        });
        const json = await res.json();
        const conn = json?.data?.collections;
        if (!conn) break;
        collectionNodes.push(...(conn.edges || []).map((e) => ({ ...e.node, contentType: "collections" })));
        if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) break;
        afterCursor = conn.pageInfo.endCursor;
      }
      allItems.push(...collectionNodes.map((n) => ({
        id: n.id,
        title: n.title,
        handle: n.handle,
        status: "Active",
        descriptionHtml: n.descriptionHtml || "",
        seoTitle: n.seo?.title || "",
        seoDescription: n.seo?.description || "",
        imageUrl: n.image?.url || null,
        imageAlt: n.image?.altText || n.title,
        updatedAt: n.updatedAt || null,
        contentType: "collections",
        creditsUsed: resolveCreditsUsed("collections", n.id),
      })));

      // Fetch pages
      const pageNodes = [];
      afterCursor = null;
      while (true) {
        const res = await admin.graphql(PAGES_QUERY, {
          variables: { first: FETCH_BATCH_SIZE, after: afterCursor },
        });
        const json = await res.json();
        const conn = json?.data?.pages;
        if (!conn) break;
        pageNodes.push(...(conn.edges || []).map((e) => ({ ...e.node, contentType: "pages" })));
        if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) break;
        afterCursor = conn.pageInfo.endCursor;
      }
      allItems.push(...pageNodes.map((n) => {
        const mfMap = {};
        (n.metafields?.edges || []).forEach(({ node: mf }) => { mfMap[mf.key] = mf.value; });
        return {
          id: n.id,
          title: n.title,
          handle: n.handle,
          status: "Active",
          descriptionHtml: n.body || "",
          seoTitle: mfMap["title_tag"] || "",
          seoDescription: mfMap["description_tag"] || "",
          imageUrl: null,
          imageAlt: n.title,
          updatedAt: n.updatedAt || null,
          contentType: "pages",
          creditsUsed: resolveCreditsUsed("pages", n.id),
        };
      }));

      // Fetch blog articles
      const res = await admin.graphql(ARTICLES_QUERY, { variables: { first: 250 } });
      const json = await res.json();
      const edges = json?.data?.articles?.edges || [];
      allItems.push(...edges.map(({ node: n }) => {
        const mfMap = {};
        (n.metafields?.edges || []).forEach(({ node: mf }) => { mfMap[mf.key] = mf.value; });
        return {
          id: n.id,
          title: n.title,
          handle: n.handle,
          status: n.publishedAt ? "Active" : "Draft",
          descriptionHtml: n.body || "",
          seoTitle: mfMap["title_tag"] || "",
          seoDescription: mfMap["description_tag"] || "",
          imageUrl: null,
          imageAlt: n.title,
          updatedAt: n.publishedAt || null,
          contentType: "blog",
          blogTitle: n.blog?.title || "",
          creditsUsed: resolveCreditsUsed("blog", n.id),
        };
      }));

      items = allItems;
    } else if (tab === "products") {
      const nodes = [];
      let afterCursor;
      while (true) {
        const res = await admin.graphql(PRODUCT_LIST_QUERY, {
          variables: { first: FETCH_BATCH_SIZE, after: afterCursor },
        });
        const json = await res.json();
        const conn = json?.data?.products;
        if (!conn) break;
        nodes.push(...(conn.edges || []).map((e) => e.node));
        if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) break;
        afterCursor = conn.pageInfo.endCursor;
      }
      items = nodes.map((n) => ({
        id: n.id,
        title: n.title,
        handle: n.handle,
        status: n.status,
        descriptionHtml: n.descriptionHtml || "",
        seoTitle: n.seo?.title || "",
        seoDescription: n.seo?.description || "",
        imageUrl: n.featuredMedia?.preview?.image?.url || null,
        imageAlt: n.featuredMedia?.preview?.image?.altText || n.title,
        updatedAt: n.updatedAt || null,
        contentType: "products",
        creditsUsed: resolveCreditsUsed("products", n.id),
      }));
    } else if (tab === "collections") {
      const nodes = [];
      let afterCursor;
      while (true) {
        const res = await admin.graphql(COLLECTION_LIST_QUERY, {
          variables: { first: FETCH_BATCH_SIZE, after: afterCursor },
        });
        const json = await res.json();
        const conn = json?.data?.collections;
        if (!conn) break;
        nodes.push(...(conn.edges || []).map((e) => e.node));
        if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) break;
        afterCursor = conn.pageInfo.endCursor;
      }
      items = nodes.map((n) => ({
        id: n.id,
        title: n.title,
        handle: n.handle,
        status: "Active",
        descriptionHtml: n.descriptionHtml || "",
        seoTitle: n.seo?.title || "",
        seoDescription: n.seo?.description || "",
        imageUrl: n.image?.url || null,
        imageAlt: n.image?.altText || n.title,
        updatedAt: n.updatedAt || null,
        contentType: "collections",
        creditsUsed: resolveCreditsUsed("collections", n.id),
      }));
    } else if (tab === "pages") {
      const nodes = [];
      let afterCursor;
      while (true) {
        const res = await admin.graphql(PAGES_QUERY, {
          variables: { first: FETCH_BATCH_SIZE, after: afterCursor },
        });
        const json = await res.json();
        const conn = json?.data?.pages;
        if (!conn) break;
        nodes.push(...(conn.edges || []).map((e) => e.node));
        if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) break;
        afterCursor = conn.pageInfo.endCursor;
      }
      items = nodes.map((n) => {
        const mfMap = {};
        (n.metafields?.edges || []).forEach(({ node: mf }) => { mfMap[mf.key] = mf.value; });
        return {
          id: n.id,
          title: n.title,
          handle: n.handle,
          status: "Active",
          descriptionHtml: n.body || "",
          seoTitle: mfMap["title_tag"] || "",
          seoDescription: mfMap["description_tag"] || "",
          imageUrl: null,
          imageAlt: n.title,
          updatedAt: n.updatedAt || null,
          contentType: "pages",
          creditsUsed: resolveCreditsUsed("pages", n.id),
        };
      });
    } else if (tab === "blog") {
      const res = await admin.graphql(ARTICLES_QUERY, { variables: { first: 250 } });
      const json = await res.json();
      const edges = json?.data?.articles?.edges || [];
      items = edges.map(({ node: n }) => {
        const mfMap = {};
        (n.metafields?.edges || []).forEach(({ node: mf }) => { mfMap[mf.key] = mf.value; });
        return {
          id: n.id,
          title: n.title,
          handle: n.handle,
          status: n.publishedAt ? "Active" : "Draft",
          descriptionHtml: n.body || "",
          seoTitle: mfMap["title_tag"] || "",
          seoDescription: mfMap["description_tag"] || "",
          imageUrl: null,
          imageAlt: n.title,
          updatedAt: n.publishedAt || null,
          blogTitle: n.blog?.title || "",
          contentType: "blog",
          creditsUsed: resolveCreditsUsed("blog", n.id),
        };
      });
    }
  } catch (err) {
    console.error(`Content management loader error (tab=${tab}):`, err);
  }

  // Apply filter
  if (filter === "empty") {
    items = items.filter((item) => !stripHtml(item.descriptionHtml));
  } else if (filter === "unoptimized") {
    items = items.filter(
      (item) => !item.seoTitle || !item.seoDescription
    );
  }

  return {
    tab,
    filter,
    items,
    credits,
    defaultAiProvider,
    hasOpenaiKey: !!(shopData?.openaiApiKey || process.env.OPENAI_API_KEY),
    hasAnthropicKey: !!(shopData?.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
  };
};

// ─── Action ───────────────────────────────────────────────────────────────────
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const contentType = formData.get("contentType");

  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { credits: true, defaultAiProvider: true, openaiApiKey: true, anthropicApiKey: true },
  });

  // ── Generate single item ──────────────────────────────────────────────────
  if (intent === "generate_single") {
    const generateScope = String(formData.get("generateScope") || "all");
    const creditsToUse = creditsForGenerateScope(generateScope);
    const currentCredits = shopData?.credits ?? 0;
    if (currentCredits < creditsToUse) {
      return {
        ok: false,
        intent,
        error: buildInsufficientCreditsError(creditsToUse, currentCredits),
      };
    }

    const itemJson = formData.get("item");
    let item;
    try { item = JSON.parse(itemJson || "{}"); } catch { item = {}; }

    const aiProvider = formData.get("aiProvider") || shopData?.defaultAiProvider || "auto";
    const preferredModel = String(formData.get("aiModel") || "").trim();
    const resolvedAiProvider =
      preferredModel.startsWith("claude-")
        ? "anthropic"
        : preferredModel.startsWith("gpt-")
          ? "openai"
          : aiProvider;
    const generationLanguage = String(formData.get("language") || "English").trim() || "English";
    const seoKeyword = String(formData.get("seoKeyword") || "").trim();
    const additionalInformation = String(formData.get("additionalInformation") || "").trim();
    const contextKeywords = [seoKeyword, additionalInformation].filter(Boolean).join(" | ");
    const templateOverrides = {
      descriptionPromptTemplate: String(formData.get("descriptionPromptTemplate") || ""),
      bodyPromptTemplate: String(formData.get("bodyPromptTemplate") || ""),
      metaTitlePromptTemplate: String(formData.get("metaTitlePromptTemplate") || ""),
      metaDescriptionPromptTemplate: String(formData.get("metaDescriptionPromptTemplate") || ""),
    };
    const shouldGenerateMain = generateScope === "all" || generateScope === "main";
    const shouldGenerateMetaTitle = generateScope === "all" || generateScope === "meta_title";
    const shouldGenerateMetaDescription = generateScope === "all" || generateScope === "meta_description";

    try {
      const prompt = buildPrompt(contentType, item, templateOverrides, generateScope, {
        language: generationLanguage,
        contextKeywords,
      });
      const generated = await runGeneration(prompt, {
        aiProvider: resolvedAiProvider,
        preferredModel: preferredModel || null,
        shopOpenaiKey: shopData?.openaiApiKey || null,
        shopAnthropicKey: shopData?.anthropicApiKey || null,
      });

      const descHtml = shouldGenerateMain && generated.description
        ? normalizeGeneratedHtml(generated.description)
        : item.descriptionHtml || "";
      const seoTitle = shouldGenerateMetaTitle
        ? (generated.seoTitle || item.seoTitle || "")
        : item.seoTitle || "";
      const seoDescription = shouldGenerateMetaDescription
        ? (generated.seoDescription || item.seoDescription || "")
        : item.seoDescription || "";

      // Save to Shopify
      if (contentType === "products") {
        const res = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
          variables: {
            product: { id: item.id, descriptionHtml: descHtml, seo: { title: seoTitle, description: seoDescription } },
          },
        });
        const json = await res.json();
        const errors = json?.data?.productUpdate?.userErrors || [];
        if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
      } else if (contentType === "collections") {
        const res = await admin.graphql(COLLECTION_UPDATE_MUTATION, {
          variables: { input: { id: item.id, descriptionHtml: descHtml, seo: { title: seoTitle, description: seoDescription } } },
        });
        const json = await res.json();
        const errors = json?.data?.collectionUpdate?.userErrors || [];
        if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
      } else if (contentType === "pages") {
        const res = await admin.graphql(PAGE_UPDATE_MUTATION, {
          variables: { id: item.id, page: { body: descHtml } },
        });
        const json = await res.json();
        const errors = json?.data?.pageUpdate?.userErrors || [];
        if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
        // Save SEO metafields for page
        if (seoTitle || seoDescription) {
          const metafields = [];
          if (seoTitle) metafields.push({ ownerId: item.id, namespace: "global", key: "title_tag", value: seoTitle, type: "single_line_text_field" });
          if (seoDescription) metafields.push({ ownerId: item.id, namespace: "global", key: "description_tag", value: seoDescription, type: "single_line_text_field" });
          if (metafields.length > 0) {
            const mfRes = await admin.graphql(METAFIELDS_SET_MUTATION, { variables: { metafields } });
            const mfJson = await mfRes.json();
            const mfErrors = mfJson?.data?.metafieldsSet?.userErrors || [];
            if (mfErrors.length > 0) throw new Error(mfErrors.map((e) => e.message).join(", "));
          }
        }
      } else if (contentType === "blog") {
        const res = await admin.graphql(ARTICLE_UPDATE_MUTATION, {
          variables: { id: item.id, article: { body: descHtml } },
        });
        const json = await res.json();
        const errors = json?.data?.articleUpdate?.userErrors || [];
        if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
        // Save SEO metafields for blog article
        if (seoTitle || seoDescription) {
          const metafields = [];
          if (seoTitle) metafields.push({ ownerId: item.id, namespace: "global", key: "title_tag", value: seoTitle, type: "single_line_text_field" });
          if (seoDescription) metafields.push({ ownerId: item.id, namespace: "global", key: "description_tag", value: seoDescription, type: "single_line_text_field" });
          if (metafields.length > 0) {
            const mfRes = await admin.graphql(METAFIELDS_SET_MUTATION, { variables: { metafields } });
            const mfJson = await mfRes.json();
            const mfErrors = mfJson?.data?.metafieldsSet?.userErrors || [];
            if (mfErrors.length > 0) throw new Error(mfErrors.map((e) => e.message).join(", "));
          }
        }
      }

      // Deduct credits
      const creditSnapshot = await deductCredits({
        shopDomain: session.shop,
        creditsUsed: creditsToUse,
      });

      const commonUpsertData = {
        language: generationLanguage,
        contextKeywords: contextKeywords || null,
        aiModel: generated.aiModel || null,
        seoTitle: seoTitle || null,
        seoDescription: seoDescription || null,
        creditsUsed: creditsToUse,
      };

      try {
        if (contentType === "products") {
          const createData = {
            shop: session.shop,
            productId: item.id,
            productTitle: item.title || null,
            language: generationLanguage,
            tone: "Neutral",
            contextKeywords: contextKeywords || null,
            descriptionPromptTemplate: shouldGenerateMain
              ? templateOverrides.descriptionPromptTemplate || null
              : null,
            metaTitlePromptTemplate: shouldGenerateMetaTitle
              ? templateOverrides.metaTitlePromptTemplate || null
              : null,
            metaDescriptionPromptTemplate: shouldGenerateMetaDescription
              ? templateOverrides.metaDescriptionPromptTemplate || null
              : null,
            descriptionHtml: descHtml || null,
            ...commonUpsertData,
            appliedToProduct: true,
          };
          const updateData = {
            ...(shouldGenerateMain
              ? {
                  descriptionPromptTemplate: templateOverrides.descriptionPromptTemplate || null,
                  descriptionHtml: descHtml || null,
                }
              : {}),
            ...(shouldGenerateMetaTitle
              ? { metaTitlePromptTemplate: templateOverrides.metaTitlePromptTemplate || null }
              : {}),
            ...(shouldGenerateMetaDescription
              ? { metaDescriptionPromptTemplate: templateOverrides.metaDescriptionPromptTemplate || null }
              : {}),
            ...commonUpsertData,
            creditsUsed: { increment: creditsToUse },
            appliedToProduct: true,
          };
          await db.productGeneratedContent.upsert({
            where: { shop_productId: { shop: session.shop, productId: item.id } },
            create: createData,
            update: updateData,
          });
        } else if (contentType === "collections") {
          const createData = {
            shop: session.shop,
            collectionId: item.id,
            collectionTitle: item.title || null,
            language: generationLanguage,
            tone: "Neutral",
            contextKeywords: contextKeywords || null,
            descriptionPromptTemplate: shouldGenerateMain
              ? templateOverrides.descriptionPromptTemplate || null
              : null,
            metaTitlePromptTemplate: shouldGenerateMetaTitle
              ? templateOverrides.metaTitlePromptTemplate || null
              : null,
            metaDescriptionPromptTemplate: shouldGenerateMetaDescription
              ? templateOverrides.metaDescriptionPromptTemplate || null
              : null,
            descriptionHtml: descHtml || null,
            ...commonUpsertData,
            appliedToCollection: true,
          };
          const updateData = {
            ...(shouldGenerateMain
              ? {
                  descriptionPromptTemplate: templateOverrides.descriptionPromptTemplate || null,
                  descriptionHtml: descHtml || null,
                }
              : {}),
            ...(shouldGenerateMetaTitle
              ? { metaTitlePromptTemplate: templateOverrides.metaTitlePromptTemplate || null }
              : {}),
            ...(shouldGenerateMetaDescription
              ? { metaDescriptionPromptTemplate: templateOverrides.metaDescriptionPromptTemplate || null }
              : {}),
            ...commonUpsertData,
            creditsUsed: { increment: creditsToUse },
            appliedToCollection: true,
          };
          await db.collectionGeneratedContent.upsert({
            where: { shop_collectionId: { shop: session.shop, collectionId: item.id } },
            create: createData,
            update: updateData,
          });
        } else if (contentType === "pages") {
          const createData = {
            shop: session.shop,
            pageId: item.id,
            pageTitle: item.title || null,
            pageType: "General",
            language: generationLanguage,
            tone: "Neutral",
            contextKeywords: contextKeywords || null,
            bodyPromptTemplate: shouldGenerateMain ? templateOverrides.bodyPromptTemplate || null : null,
            metaTitlePromptTemplate: shouldGenerateMetaTitle
              ? templateOverrides.metaTitlePromptTemplate || null
              : null,
            metaDescriptionPromptTemplate: shouldGenerateMetaDescription
              ? templateOverrides.metaDescriptionPromptTemplate || null
              : null,
            bodyHtml: descHtml || null,
            ...commonUpsertData,
            appliedToPage: true,
          };
          const updateData = {
            ...(shouldGenerateMain
              ? {
                  bodyPromptTemplate: templateOverrides.bodyPromptTemplate || null,
                  bodyHtml: descHtml || null,
                }
              : {}),
            ...(shouldGenerateMetaTitle
              ? { metaTitlePromptTemplate: templateOverrides.metaTitlePromptTemplate || null }
              : {}),
            ...(shouldGenerateMetaDescription
              ? { metaDescriptionPromptTemplate: templateOverrides.metaDescriptionPromptTemplate || null }
              : {}),
            ...commonUpsertData,
            creditsUsed: { increment: creditsToUse },
            appliedToPage: true,
          };
          await db.pageGeneratedContent.upsert({
            where: { shop_pageId: { shop: session.shop, pageId: item.id } },
            create: createData,
            update: updateData,
          });
        } else if (contentType === "blog") {
          const createData = {
            shop: session.shop,
            articleId: item.id,
            articleTitle: item.title || null,
            articleType: "General",
            language: generationLanguage,
            tone: "Neutral",
            contextKeywords: contextKeywords || null,
            bodyPromptTemplate: shouldGenerateMain ? templateOverrides.bodyPromptTemplate || null : null,
            metaTitlePromptTemplate: shouldGenerateMetaTitle
              ? templateOverrides.metaTitlePromptTemplate || null
              : null,
            metaDescriptionPromptTemplate: shouldGenerateMetaDescription
              ? templateOverrides.metaDescriptionPromptTemplate || null
              : null,
            bodyHtml: descHtml || null,
            ...commonUpsertData,
            appliedToShopify: true,
          };
          const updateData = {
            ...(shouldGenerateMain
              ? {
                  bodyPromptTemplate: templateOverrides.bodyPromptTemplate || null,
                  bodyHtml: descHtml || null,
                }
              : {}),
            ...(shouldGenerateMetaTitle
              ? { metaTitlePromptTemplate: templateOverrides.metaTitlePromptTemplate || null }
              : {}),
            ...(shouldGenerateMetaDescription
              ? { metaDescriptionPromptTemplate: templateOverrides.metaDescriptionPromptTemplate || null }
              : {}),
            ...commonUpsertData,
            creditsUsed: { increment: creditsToUse },
            appliedToShopify: true,
          };
          await db.blogArticleGeneratedContent.upsert({
            where: { shop_articleId: { shop: session.shop, articleId: item.id } },
            create: createData,
            update: updateData,
          });
        }
      } catch (dbError) {
        console.error("Failed to persist content management generation configuration:", dbError);
      }

      // Log generation
      try {
        await db.generatedContentLog.create({
          data: {
            shop: session.shop,
            productId: item.id,
            productTitle: item.title || null,
            intent: `content_management_${contentType}`,
            resourceType: contentType === "blog" ? "blog" : contentType === "pages" ? "page" : contentType === "collections" ? "collection" : "product",
            language: generationLanguage,
            tone: "Neutral",
            contextKeywords: contextKeywords || null,
            aiModel: generated.aiModel || null,
            generatedDescription: descHtml || null,
            generatedSeoTitle: seoTitle || null,
            generatedSeoDescription: seoDescription || null,
            creditsUsed: creditsToUse,
            appliedToProduct: true,
          },
        });
      } catch (_) { /* non-critical */ }

      return {
        ok: true,
        intent,
        itemId: item.id,
        descriptionHtml: descHtml,
        seoTitle,
        seoDescription,
        creditsUsed: creditsToUse,
        newCredits: creditSnapshot.credits,
        creditsUsedTotal: creditSnapshot.creditsUsedTotal,
      };
    } catch (err) {
      console.error("Content generation failed:", err);
      return { ok: false, intent, error: err?.message || "Generation failed." };
    }
  }

  // ── Save edited content ───────────────────────────────────────────────────
  if (intent === "save_content") {
    const itemId = formData.get("itemId");
    const descriptionHtml = formData.get("descriptionHtml") || "";
    const seoTitle = formData.get("seoTitle") || "";
    const seoDescription = formData.get("seoDescription") || "";

    try {
      if (contentType === "products") {
        const res = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
          variables: {
            product: { id: itemId, descriptionHtml, seo: { title: seoTitle, description: seoDescription } },
          },
        });
        const json = await res.json();
        const errors = json?.data?.productUpdate?.userErrors || [];
        if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
      } else if (contentType === "collections") {
        const res = await admin.graphql(COLLECTION_UPDATE_MUTATION, {
          variables: { input: { id: itemId, descriptionHtml, seo: { title: seoTitle, description: seoDescription } } },
        });
        const json = await res.json();
        const errors = json?.data?.collectionUpdate?.userErrors || [];
        if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
      } else if (contentType === "pages") {
        const res = await admin.graphql(PAGE_UPDATE_MUTATION, {
          variables: { id: itemId, page: { body: descriptionHtml } },
        });
        const json = await res.json();
        const errors = json?.data?.pageUpdate?.userErrors || [];
        if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
        // Save SEO metafields for page
        const pageMetafields = [];
        if (seoTitle) pageMetafields.push({ ownerId: itemId, namespace: "global", key: "title_tag", value: seoTitle, type: "single_line_text_field" });
        if (seoDescription) pageMetafields.push({ ownerId: itemId, namespace: "global", key: "description_tag", value: seoDescription, type: "single_line_text_field" });
        if (pageMetafields.length > 0) {
          const mfRes = await admin.graphql(METAFIELDS_SET_MUTATION, { variables: { metafields: pageMetafields } });
          const mfJson = await mfRes.json();
          const mfErrors = mfJson?.data?.metafieldsSet?.userErrors || [];
          if (mfErrors.length > 0) throw new Error(mfErrors.map((e) => e.message).join(", "));
        }
      } else if (contentType === "blog") {
        const res = await admin.graphql(ARTICLE_UPDATE_MUTATION, {
          variables: { id: itemId, article: { body: descriptionHtml } },
        });
        const json = await res.json();
        const errors = json?.data?.articleUpdate?.userErrors || [];
        if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
        // Save SEO metafields for blog article
        const blogMetafields = [];
        if (seoTitle) blogMetafields.push({ ownerId: itemId, namespace: "global", key: "title_tag", value: seoTitle, type: "single_line_text_field" });
        if (seoDescription) blogMetafields.push({ ownerId: itemId, namespace: "global", key: "description_tag", value: seoDescription, type: "single_line_text_field" });
        if (blogMetafields.length > 0) {
          const mfRes = await admin.graphql(METAFIELDS_SET_MUTATION, { variables: { metafields: blogMetafields } });
          const mfJson = await mfRes.json();
          const mfErrors = mfJson?.data?.metafieldsSet?.userErrors || [];
          if (mfErrors.length > 0) throw new Error(mfErrors.map((e) => e.message).join(", "));
        }
      }
      return { ok: true, intent, itemId, descriptionHtml, seoTitle, seoDescription };
    } catch (err) {
      console.error("Save content failed:", err);
      return { ok: false, intent, error: err?.message || "Save failed." };
    }
  }

  return { ok: false, intent, error: "Unsupported action." };
};

// ─── Rich Text Editor ─────────────────────────────────────────────────────────
const tbBtnBase = {
  padding: "3px 6px",
  borderRadius: "4px",
  border: "1px solid transparent",
  background: "transparent",
  cursor: "pointer",
  fontSize: "13px",
  lineHeight: "1",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "26px",
};

function RichTextEditor({ value, onChange }) {
  const editorRef = useRef(null);
  const [showSource, setShowSource] = useState(false);
  const [sourceHtml, setSourceHtml] = useState(value || "");
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const savedSelectionRef = useRef(null);

  // Sync external value into editor on mount / when value prop changes from outside
  const lastValueRef = useRef(value);
  useEffect(() => {
    if (lastValueRef.current !== value) {
      lastValueRef.current = value;
      if (!showSource && editorRef.current) {
        editorRef.current.innerHTML = value || "";
      }
      if (showSource) setSourceHtml(value || "");
    }
  }, [value, showSource]);

  // Initialise on mount
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = value || "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exec = useCallback((cmd, arg = null) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(cmd, false, arg);
    if (onChange) onChange(editorRef.current.innerHTML || "");
  }, [onChange]);

  const handleInput = useCallback(() => {
    if (onChange && editorRef.current) onChange(editorRef.current.innerHTML || "");
  }, [onChange]);

  const toggleSource = useCallback(() => {
    if (!showSource) {
      const html = editorRef.current?.innerHTML || "";
      setSourceHtml(html);
    } else {
      if (editorRef.current) editorRef.current.innerHTML = sourceHtml;
      if (onChange) onChange(sourceHtml);
    }
    setShowSource((s) => !s);
  }, [showSource, sourceHtml, onChange]);

  const handleSourceChange = useCallback((e) => {
    setSourceHtml(e.target.value);
    if (onChange) onChange(e.target.value);
  }, [onChange]);

  const openLinkInput = useCallback(() => {
    // Save selection before opening the input
    const sel = window?.getSelection ? window.getSelection() : null;
    if (sel && sel.rangeCount > 0) {
      savedSelectionRef.current = sel.getRangeAt(0).cloneRange();
    }
    setLinkUrl("https://");
    setLinkInputOpen(true);
  }, []);

  const applyLink = useCallback(() => {
    if (savedSelectionRef.current && editorRef.current) {
      editorRef.current.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedSelectionRef.current);
    }
    if (linkUrl) exec("createLink", linkUrl);
    setLinkInputOpen(false);
    savedSelectionRef.current = null;
  }, [exec, linkUrl]);

  const tbBtn = (active = false) => ({
    ...tbBtnBase,
    background: active ? "#e3e3e3" : "transparent",
    border: active ? "1px solid #c9cccf" : "1px solid transparent",
  });

  return (
    <div style={{ border: "1px solid #c9cccf", borderRadius: "8px", overflow: "hidden" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "2px",
          padding: "6px 8px",
          borderBottom: "1px solid #e1e3e5",
          background: "#f6f6f7",
          flexWrap: "wrap",
        }}
      >
        {/* Paragraph format */}
        <select
          onChange={(e) => exec("formatBlock", e.target.value)}
          defaultValue="p"
          style={{
            fontSize: "12px",
            border: "1px solid #c9cccf",
            borderRadius: "4px",
            padding: "3px 6px",
            background: "#fff",
            cursor: "pointer",
            marginRight: "4px",
          }}
        >
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Heading 4</option>
          <option value="blockquote">Quote</option>
        </select>

        {/* Divider */}
        <span style={{ width: "1px", height: "20px", background: "#c9cccf", margin: "0 4px" }} />

        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("bold"); }} title="Bold" style={tbBtn()}>
          <b style={{ fontSize: "13px" }}>B</b>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("italic"); }} title="Italic" style={tbBtn()}>
          <em style={{ fontSize: "13px" }}>I</em>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("underline"); }} title="Underline" style={tbBtn()}>
          <u style={{ fontSize: "13px" }}>U</u>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("strikeThrough"); }} title="Strikethrough" style={tbBtn()}>
          <s style={{ fontSize: "13px" }}>S</s>
        </button>

        {/* Color input */}
        <span title="Text color" style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <label style={{ ...tbBtnBase, cursor: "pointer" }} title="Text Color">
            <span style={{ fontSize: "13px", fontWeight: 600 }}>A</span>
            <input
              type="color"
              onChange={(e) => exec("foreColor", e.target.value)}
              style={{ position: "absolute", opacity: 0, width: "26px", height: "26px", cursor: "pointer" }}
            />
          </label>
        </span>

        {/* Divider */}
        <span style={{ width: "1px", height: "20px", background: "#c9cccf", margin: "0 4px" }} />

        {/* Alignment */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("justifyLeft"); }} title="Align Left" style={tbBtn()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="1.5" rx="0.75"/><rect x="1" y="5.5" width="8" height="1.5" rx="0.75"/><rect x="1" y="9" width="12" height="1.5" rx="0.75"/><rect x="1" y="12.5" width="8" height="1.5" rx="0.75"/></svg>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("justifyCenter"); }} title="Align Center" style={tbBtn()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="1.5" rx="0.75"/><rect x="3" y="5.5" width="8" height="1.5" rx="0.75"/><rect x="1" y="9" width="12" height="1.5" rx="0.75"/><rect x="3" y="12.5" width="8" height="1.5" rx="0.75"/></svg>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("justifyRight"); }} title="Align Right" style={tbBtn()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="1.5" rx="0.75"/><rect x="5" y="5.5" width="8" height="1.5" rx="0.75"/><rect x="1" y="9" width="12" height="1.5" rx="0.75"/><rect x="5" y="12.5" width="8" height="1.5" rx="0.75"/></svg>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("justifyFull"); }} title="Justify" style={tbBtn()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="1.5" rx="0.75"/><rect x="1" y="5.5" width="12" height="1.5" rx="0.75"/><rect x="1" y="9" width="12" height="1.5" rx="0.75"/><rect x="1" y="12.5" width="12" height="1.5" rx="0.75"/></svg>
        </button>

        {/* Divider */}
        <span style={{ width: "1px", height: "20px", background: "#c9cccf", margin: "0 4px" }} />

        {/* Lists */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }} title="Bullet List" style={tbBtn()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="2" cy="3.25" r="1.25"/><rect x="5" y="2.5" width="8" height="1.5" rx="0.75"/><circle cx="2" cy="7" r="1.25"/><rect x="5" y="6.25" width="8" height="1.5" rx="0.75"/><circle cx="2" cy="10.75" r="1.25"/><rect x="5" y="10" width="8" height="1.5" rx="0.75"/></svg>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }} title="Numbered List" style={tbBtn()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="5" y="2.5" width="8" height="1.5" rx="0.75"/><rect x="5" y="6.25" width="8" height="1.5" rx="0.75"/><rect x="5" y="10" width="8" height="1.5" rx="0.75"/><text x="1" y="5" fontSize="4.5" fontFamily="monospace">1.</text><text x="1" y="8.75" fontSize="4.5" fontFamily="monospace">2.</text><text x="1" y="12.5" fontSize="4.5" fontFamily="monospace">3.</text></svg>
        </button>

        {/* Indent / Outdent */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("outdent"); }} title="Decrease indent" style={tbBtn()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="1.5" rx="0.75"/><rect x="5" y="5.5" width="8" height="1.5" rx="0.75"/><rect x="1" y="9" width="12" height="1.5" rx="0.75"/><path d="M1 7l3-2v4z"/></svg>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("indent"); }} title="Increase indent" style={tbBtn()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="1.5" rx="0.75"/><rect x="5" y="5.5" width="8" height="1.5" rx="0.75"/><rect x="1" y="9" width="12" height="1.5" rx="0.75"/><path d="M4 5l3 2-3 2z"/></svg>
        </button>

        {/* Divider */}
        <span style={{ width: "1px", height: "20px", background: "#c9cccf", margin: "0 4px" }} />

        {/* Link */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); openLinkInput(); }} title="Insert Link" style={tbBtn()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5.5 8.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5l-1 1"/>
            <path d="M8.5 5.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l1-1"/>
          </svg>
        </button>

        {/* Unlink */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("unlink"); }} title="Remove Link" style={tbBtn()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M9 5l-4 4M5.5 8.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5"/>
            <path d="M8.5 5.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5"/>
            <line x1="1" y1="1" x2="13" y2="13"/>
          </svg>
        </button>

        {/* Spacer */}
        <span style={{ flex: 1 }} />

        {/* Undo / Redo */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("undo"); }} title="Undo" style={tbBtn()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 6.5H9a3.5 3.5 0 010 7H5"/><path d="M4 4L2 6.5l2 2.5"/></svg>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("redo"); }} title="Redo" style={tbBtn()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 6.5H5a3.5 3.5 0 000 7H9"/><path d="M10 4l2 2.5L10 9"/></svg>
        </button>

        {/* Divider */}
        <span style={{ width: "1px", height: "20px", background: "#c9cccf", margin: "0 4px" }} />

        {/* HTML Source toggle */}
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); toggleSource(); }}
          title="HTML Source"
          style={{ ...tbBtn(showSource), fontFamily: "monospace", fontWeight: 600, fontSize: "11px" }}
        >
          {"</>"}
        </button>
      </div>

      {/* Inline link input */}
      {linkInputOpen && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: "8px",
            padding: "6px 10px", borderBottom: "1px solid #e1e3e5", background: "#f9fafb",
          }}
        >
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyLink(); if (e.key === "Escape") setLinkInputOpen(false); }}
            placeholder="https://example.com"
            autoFocus
            style={{ flex: 1, fontSize: "13px", border: "1px solid #c9cccf", borderRadius: "4px", padding: "4px 8px", outline: "none" }}
          />
          <button type="button" onClick={applyLink} style={{ ...tbBtnBase, background: "#1a1a1a", color: "#fff", border: "none", padding: "4px 10px", fontSize: "12px" }}>
            Apply
          </button>
          <button type="button" onClick={() => setLinkInputOpen(false)} style={{ ...tbBtnBase, fontSize: "12px" }}>
            Cancel
          </button>
        </div>
      )}

      {/* Content area */}
      {showSource ? (
        <textarea
          value={sourceHtml}
          onChange={handleSourceChange}
          spellCheck={false}
          style={{
            width: "100%",
            minHeight: "220px",
            padding: "12px",
            fontFamily: "monospace",
            fontSize: "12px",
            border: "none",
            outline: "none",
            resize: "vertical",
            boxSizing: "border-box",
            lineHeight: "1.5",
            background: "#fafafa",
          }}
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          style={{
            minHeight: "220px",
            padding: "12px 16px",
            outline: "none",
            fontSize: "14px",
            lineHeight: "1.6",
            overflowY: "auto",
            maxHeight: "400px",
          }}
        />
      )}
    </div>
  );
}

// ─── Editor Modal ─────────────────────────────────────────────────────────────
function EditorModal({ open, item, field, contentType, onClose, onSave, isSaving }) {
  const [descHtml, setDescHtml] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [activeTab, setActiveTab] = useState(field === "seo" ? 1 : 0);

  useEffect(() => {
    if (item) {
      setDescHtml(item.descriptionHtml || "");
      setSeoTitle(item.seoTitle || "");
      setSeoDescription(item.seoDescription || "");
      setActiveTab(field === "seo" ? 1 : 0);
    }
  }, [item, field]);

  if (!item) return null;

  const tabs = [
    { id: "description", content: "Description" },
    { id: "seo", content: "SEO" },
  ];

  const handleSave = () => {
    onSave({
      itemId: item.id,
      descriptionHtml: descHtml,
      seoTitle,
      seoDescription,
      contentType: item.contentType || contentType,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item.title}
      size="large"
      primaryAction={{ content: isSaving ? "Saving…" : "Save", onAction: handleSave, loading: isSaving, disabled: isSaving }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section flush>
        <div style={{ borderBottom: "1px solid #e1e3e5" }}>
          <Tabs tabs={tabs} selected={activeTab} onSelect={setActiveTab} fitted />
        </div>
      </Modal.Section>

      <Modal.Section>
        {activeTab === 0 && (
          <BlockStack gap="300">
            <Text variant="bodyMd" as="p" tone="subdued">
              Edit the description content below. Use the toolbar to format text.
            </Text>
            <RichTextEditor value={descHtml} onChange={setDescHtml} />
          </BlockStack>
        )}

        {activeTab === 1 && (
          <BlockStack gap="400">
            <TextField
              label="SEO Title"
              value={seoTitle}
              onChange={setSeoTitle}
              maxLength={70}
              showCharacterCount
              helpText="Recommended: 50–70 characters"
              autoComplete="off"
            />
            <TextField
              label="SEO Description"
              value={seoDescription}
              onChange={setSeoDescription}
              maxLength={160}
              showCharacterCount
              multiline={3}
              helpText="Recommended: 120–160 characters"
              autoComplete="off"
            />
          </BlockStack>
        )}
      </Modal.Section>
    </Modal>
  );
}

function GenerateTemplateModal({
  open,
  item,
  contentType,
  generateScope,
  templateSelection,
  formValues,
  previewText,
  progress,
  onChange,
  onFormChange,
  onClose,
  onGenerate,
  isGenerating,
}) {
  if (!open || !item) return null;

  const config = getGenerateTemplateConfig(contentType);
  if (!config) return null;

  const mainOptions = [
    { label: `Default (${config.mainLabel})`, value: "" },
    ...config.mainTemplates.map((template) => ({ label: template.name, value: template.id })),
  ];
  const metaTitleOptions = [
    { label: "Default (Meta Title)", value: "" },
    ...config.metaTitleTemplates.map((template) => ({ label: template.name, value: template.id })),
  ];
  const metaDescriptionOptions = [
    { label: "Default (Meta Description)", value: "" },
    ...config.metaDescriptionTemplates.map((template) => ({ label: template.name, value: template.id })),
  ];
  const showMain = generateScope === "all" || generateScope === "main";
  const showMetaTitle = generateScope === "all" || generateScope === "meta_title";
  const showMetaDescription = generateScope === "all" || generateScope === "meta_description";
  const modalCredits = creditsForGenerateScope(generateScope);
  const scopeLabel = getScopeDisplayLabel(contentType, generateScope);
  const itemTypeLabel = getContentTypeDisplayLabel(contentType);
  const titleScope = scopeLabel === "All" ? "content" : scopeLabel.toLowerCase();
  const previewHtml = showMain ? previewText : "";
  const previewMetaText =
    !showMain && previewText
      ? previewText
      : !showMain
        ? `Generated ${scopeLabel} will appear here`
        : "";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Generate ${itemTypeLabel} ${titleScope}`}
      large
      primaryAction={{
        content: isGenerating ? "Generating..." : `Generate (${modalCredits} credits)`,
        onAction: onGenerate,
        loading: isGenerating,
        disabled: isGenerating,
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose, disabled: isGenerating }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text as="p" variant="bodySm" tone="subdued">
            Select templates and options. Credits are deducted only after successful generation.
          </Text>

          {isGenerating ? (
            <BlockStack gap="150">
              <Text as="p" variant="bodySm" tone="subdued">Generating content...</Text>
              <ProgressBar progress={progress} size="small" />
            </BlockStack>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 1fr) minmax(320px, 2fr)", gap: "16px" }}>
            <BlockStack gap="300">
              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="headingSm">{itemTypeLabel[0].toUpperCase() + itemTypeLabel.slice(1)}</Text>
                  <div style={{ border: "1px solid #e1e3e5", borderRadius: "12px", padding: "12px" }}>
                    <InlineStack gap="300" blockAlign="center" wrap={false}>
                      {item.imageUrl ? (
                        <Thumbnail source={item.imageUrl} alt={item.imageAlt || item.title} size="small" />
                      ) : (
                        <div className="content-mgmt-thumb-placeholder" aria-hidden="true" />
                      )}
                      <Text as="p" variant="bodyMd">{item.title}</Text>
                    </InlineStack>
                  </div>
                </BlockStack>
              </Card>

              <TextField
                label="SEO keyword"
                value={formValues.seoKeyword}
                onChange={(value) => onFormChange("seoKeyword", value)}
                autoComplete="off"
                placeholder="Keyword"
              />

              {showMain ? (
                <Select
                  label={config.mainLabel}
                  options={mainOptions}
                  value={templateSelection.mainTemplateId}
                  onChange={(value) => onChange("mainTemplateId", value)}
                />
              ) : null}
              {showMetaTitle ? (
                <Select
                  label="Meta Title Template"
                  options={metaTitleOptions}
                  value={templateSelection.metaTitleTemplateId}
                  onChange={(value) => onChange("metaTitleTemplateId", value)}
                />
              ) : null}
              {showMetaDescription ? (
                <Select
                  label="Meta Description Template"
                  options={metaDescriptionOptions}
                  value={templateSelection.metaDescriptionTemplateId}
                  onChange={(value) => onChange("metaDescriptionTemplateId", value)}
                />
              ) : null}

              <TextField
                label="Additional information"
                value={formValues.additionalInformation}
                onChange={(value) => onFormChange("additionalInformation", value)}
                multiline={4}
                autoComplete="off"
                placeholder="Add unique product details, specifications, key selling points, etc."
              />
              <Select
                label="Language"
                options={LANGUAGE_OPTIONS}
                value={formValues.language}
                onChange={(value) => onFormChange("language", value)}
              />
              <Select
                label="AI model"
                options={AI_MODEL_OPTIONS}
                value={formValues.aiModel}
                onChange={(value) => onFormChange("aiModel", value)}
              />
            </BlockStack>

            <Card>
              <div
                style={{
                  minHeight: "440px",
                  border: "1px solid #e1e3e5",
                  borderRadius: "12px",
                  padding: "16px",
                  overflowY: "auto",
                  background: "#ffffff",
                }}
              >
                {showMain ? (
                  previewHtml ? (
                    <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  ) : (
                    <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                      Generated content will appear here
                    </Text>
                  )
                ) : (
                  <Text as="p" variant="bodyMd" tone={previewText ? "base" : "subdued"} alignment="center">
                    {previewMetaText}
                  </Text>
                )}
              </div>
            </Card>
          </div>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

// ─── Client helpers ───────────────────────────────────────────────────────────
function truncateText(text, max = 80) {
  const plain = (text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return "";
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
      return `Today at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
    }
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return "—"; }
}

function statusBadge(status) {
  const s = (status || "").toLowerCase();
  if (s === "active") return <Badge tone="success">Active</Badge>;
  if (s === "draft") return <Badge tone="attention">Draft</Badge>;
  return <Badge>{status || "—"}</Badge>;
}


// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ContentManagementPage() {
  const { tab, filter, items, credits, defaultAiProvider } = useLoaderData();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const generateFetcher = useFetcher();
  const saveFetcher = useFetcher();

  // Editor modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorItem, setEditorItem] = useState(null);
  const [editorField, setEditorField] = useState("description");
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [pendingGenerateItem, setPendingGenerateItem] = useState(null);
  const [pendingGenerateContentType, setPendingGenerateContentType] = useState(tab === "all" ? "products" : tab);
  const [pendingGenerateScope, setPendingGenerateScope] = useState("all");
  const [openGeneratePopoverId, setOpenGeneratePopoverId] = useState(null);
  const [generateTemplateSelection, setGenerateTemplateSelection] = useState({
    mainTemplateId: "",
    metaTitleTemplateId: "",
    metaDescriptionTemplateId: "",
  });
  const [generateFormValues, setGenerateFormValues] = useState({
    seoKeyword: "",
    additionalInformation: "",
    language: "English (US)",
    aiModel: "gpt-4.1-mini",
  });
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generatedPreviewText, setGeneratedPreviewText] = useState("");

  // Track per-row generating state
  const [generatingId, setGeneratingId] = useState(null);
  const [localItems, setLocalItems] = useState(items);
  const [localCredits, setLocalCredits] = useState(credits);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Sync items from loader
  useEffect(() => { setLocalItems(items); }, [items]);
  useEffect(() => { setLocalCredits(credits); }, [credits]);

  // Handle generate response
  useEffect(() => {
    if (generateFetcher.state !== "idle") return;
    const data = generateFetcher.data;
    if (!data || data.intent !== "generate_single") return;
    setGeneratingId(null);
    setGenerationProgress(100);
    if (data.ok) {
      setLocalCredits(data.newCredits);
      setLocalItems((prev) =>
        prev.map((it) =>
          it.id === data.itemId
            ? { ...it, descriptionHtml: data.descriptionHtml, seoTitle: data.seoTitle, seoDescription: data.seoDescription }
            : it
        )
      );
      if (pendingGenerateScope === "main") {
        setGeneratedPreviewText(data.descriptionHtml || "");
      } else if (pendingGenerateScope === "meta_title") {
        setGeneratedPreviewText(data.seoTitle || "");
      } else if (pendingGenerateScope === "meta_description") {
        setGeneratedPreviewText(data.seoDescription || "");
      } else {
        setGeneratedPreviewText(data.descriptionHtml || "");
      }
      setSuccessMessage(
        `Content generated. ${data.creditsUsed || 0} credit${data.creditsUsed === 1 ? "" : "s"} used. Remaining: ${data.newCredits}.`,
      );
      setTimeout(() => setSuccessMessage(null), 5000);
      shopify.toast.show("Content generated successfully!");
    } else {
      setErrorMessage(data.error || "Generation failed.");
      setGenerationProgress(0);
    }
  }, [generateFetcher.state, generateFetcher.data, pendingGenerateScope, shopify]);

  useEffect(() => {
    if (generateFetcher.state === "idle") return undefined;
    setGenerationProgress(12);
    const timer = setInterval(() => {
      setGenerationProgress((prev) => (prev >= 90 ? prev : prev + 8));
    }, 350);
    return () => clearInterval(timer);
  }, [generateFetcher.state]);

  // Handle save response
  useEffect(() => {
    if (saveFetcher.state !== "idle") return;
    const data = saveFetcher.data;
    if (!data || data.intent !== "save_content") return;
    if (data.ok) {
      setLocalItems((prev) =>
        prev.map((it) =>
          it.id === data.itemId
            ? { ...it, descriptionHtml: data.descriptionHtml, seoTitle: data.seoTitle, seoDescription: data.seoDescription }
            : it
        )
      );
      setEditorOpen(false);
      shopify.toast.show("Content saved successfully!");
    } else {
      setErrorMessage(data.error || "Save failed.");
    }
  }, [saveFetcher.state, saveFetcher.data, shopify]);

  const mainTabs = [
    { id: "all", content: "All" },
    { id: "products", content: "Products" },
    { id: "collections", content: "Collections" },
    { id: "pages", content: "Pages" },
    { id: "blog", content: "Blog" },
  ];
  const mainTabIndex = mainTabs.findIndex((t) => t.id === tab);

  const filterTabs = [
    { id: "all", content: "All" },
    { id: "unoptimized", content: "Unoptimized" },
    { id: "empty", content: "Empty" },
  ];
  const filterTabIndex = filterTabs.findIndex((t) => t.id === filter);

  const handleMainTabChange = useCallback(
    (idx) => navigate(`?tab=${mainTabs[idx].id}&filter=all`),
    [navigate]
  );

  const handleFilterTabChange = useCallback(
    (idx) => navigate(`?tab=${tab}&filter=${filterTabs[idx].id}`),
    [navigate, tab]
  );

  const openEditor = useCallback((item, field = "description") => {
    setEditorItem(item);
    setEditorField(field);
    setEditorOpen(true);
  }, []);

  const handleSaveContent = useCallback(
    ({ itemId, descriptionHtml, seoTitle, seoDescription, contentType }) => {
      const fd = new FormData();
      fd.append("intent", "save_content");
      fd.append("contentType", contentType || tab);
      fd.append("itemId", itemId);
      fd.append("descriptionHtml", descriptionHtml);
      fd.append("seoTitle", seoTitle);
      fd.append("seoDescription", seoDescription);
      saveFetcher.submit(fd, { method: "post" });
    },
    [saveFetcher, tab]
  );

  const handleGenerate = useCallback(
    (item, generateScope = "all") => {
      const effectiveContentType = item.contentType || tab;
      setPendingGenerateItem(item);
      setPendingGenerateContentType(effectiveContentType);
      setPendingGenerateScope(generateScope);
      setGenerateTemplateSelection({
        mainTemplateId: "",
        metaTitleTemplateId: "",
        metaDescriptionTemplateId: "",
      });
      setGenerateFormValues({
        seoKeyword: item.title || "",
        additionalInformation: "",
        language: "English (US)",
        aiModel: "gpt-4.1-mini",
      });
      setGeneratedPreviewText("");
      setGenerationProgress(0);
      setTemplateModalOpen(true);
    },
    [tab]
  );

  const updateGenerateTemplateSelection = useCallback((field, value) => {
    setGenerateTemplateSelection((prev) => ({ ...prev, [field]: value }));
  }, []);

  const updateGenerateFormValues = useCallback((field, value) => {
    setGenerateFormValues((prev) => ({ ...prev, [field]: value }));
  }, []);

  const closeGenerateModal = useCallback(() => {
    if (generateFetcher.state !== "idle") return;
    setTemplateModalOpen(false);
    setPendingGenerateItem(null);
    setGeneratedPreviewText("");
    setGenerationProgress(0);
  }, [generateFetcher.state]);

  const handleConfirmGenerate = useCallback(() => {
    if (!pendingGenerateItem) return;
    const config = getGenerateTemplateConfig(pendingGenerateContentType);
    const mainTemplate =
      config?.mainTemplates.find((template) => template.id === generateTemplateSelection.mainTemplateId)?.template || "";
    const metaTitleTemplate =
      config?.metaTitleTemplates.find((template) => template.id === generateTemplateSelection.metaTitleTemplateId)?.template || "";
    const metaDescriptionTemplate =
      config?.metaDescriptionTemplates.find((template) => template.id === generateTemplateSelection.metaDescriptionTemplateId)?.template || "";

    setErrorMessage(null);
    setGeneratingId(pendingGenerateItem.id);
    setGenerationProgress(6);
    setGeneratedPreviewText("");

    const fd = new FormData();
    fd.append("intent", "generate_single");
    fd.append("contentType", pendingGenerateContentType);
    fd.append("generateScope", pendingGenerateScope);
    fd.append("item", JSON.stringify(pendingGenerateItem));
    fd.append("aiProvider", defaultAiProvider || "auto");
    fd.append("seoKeyword", generateFormValues.seoKeyword || "");
    fd.append("additionalInformation", generateFormValues.additionalInformation || "");
    fd.append("language", generateFormValues.language || "English (US)");
    fd.append("aiModel", generateFormValues.aiModel || "");
    fd.append("metaTitlePromptTemplate", metaTitleTemplate);
    fd.append("metaDescriptionPromptTemplate", metaDescriptionTemplate);
    if (config?.mainPromptKey === "bodyPromptTemplate") {
      fd.append("bodyPromptTemplate", mainTemplate);
    } else {
      fd.append("descriptionPromptTemplate", mainTemplate);
    }
    generateFetcher.submit(fd, { method: "post" });
  }, [
    defaultAiProvider,
    generateFetcher,
    generateTemplateSelection.mainTemplateId,
    generateTemplateSelection.metaDescriptionTemplateId,
    generateTemplateSelection.metaTitleTemplateId,
    generateFormValues.additionalInformation,
    generateFormValues.aiModel,
    generateFormValues.language,
    generateFormValues.seoKeyword,
    pendingGenerateContentType,
    pendingGenerateItem,
    pendingGenerateScope,
  ]);

  const isSaving = saveFetcher.state !== "idle";

  const tabLabel = mainTabs[mainTabIndex]?.id || "all";
  const singularLabel = { products: "Product", collections: "Collection", pages: "Page", blog: "Blog" }[tabLabel] || "Item";

  const headings = [
    { title: "Item" },
    { title: "Credits Used" },
    { title: "Status" },
    { title: "Description" },
    { title: "SEO Description" },
    { title: "Last Updated" },
    { title: "Generate" },
  ];

  const rowMarkup = localItems.map((item, idx) => {
    const isGenerating = generatingId === item.id;
    const effectiveContentType = item.contentType || tab;
    const scopeOptions = getGenerateScopeOptions(effectiveContentType);
    const isPopoverOpen = openGeneratePopoverId === item.id;
    const descText = truncateText(item.descriptionHtml, 90);
    const seoDescText = truncateText(item.seoDescription, 80);

    return (
      <IndexTable.Row id={item.id} key={item.id} position={idx}>
        {/* Name */}
        <IndexTable.Cell>
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            {item.imageUrl ? (
              <Thumbnail source={item.imageUrl} alt={item.imageAlt || item.title} size="small" />
            ) : (
              <div className="content-mgmt-thumb-placeholder" aria-hidden="true" />
            )}
            <div className="content-mgmt-title-cell" title={item.title}>
              {item.title}
            </div>
          </InlineStack>
        </IndexTable.Cell>

        {/* Credits used */}
        <IndexTable.Cell>
          <Badge tone={(item.creditsUsed || 0) > 0 ? "success" : "info"}>
            {item.creditsUsed || 0} credits
          </Badge>
        </IndexTable.Cell>

        {/* Status */}
        <IndexTable.Cell>{statusBadge(item.status)}</IndexTable.Cell>

        {/* Description – clickable to open editor */}
        <IndexTable.Cell>
          {descText ? (
            <button
              type="button"
              onClick={() => openEditor(item, "description")}
              title="Click to edit description"
              style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                textAlign: "left", maxWidth: "260px", display: "block",
              }}
            >
              <Text variant="bodySm" as="span" tone="subdued" truncate>
                {descText}
              </Text>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openEditor(item, "description")}
              title="Click to add description"
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
            >
              <Text variant="bodySm" as="span" tone="subdued">—</Text>
            </button>
          )}
        </IndexTable.Cell>

        {/* SEO Description – clickable */}
        <IndexTable.Cell>
          {seoDescText ? (
            <button
              type="button"
              onClick={() => openEditor(item, "seo")}
              title="Click to edit SEO"
              style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                textAlign: "left", maxWidth: "220px", display: "block",
              }}
            >
              <Text variant="bodySm" as="span" tone="subdued" truncate>
                {seoDescText}
              </Text>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openEditor(item, "seo")}
              title="Click to add SEO"
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
            >
              <Text variant="bodySm" as="span" tone="subdued">—</Text>
            </button>
          )}
        </IndexTable.Cell>

        {/* Last Updated */}
        <IndexTable.Cell>
          <Text variant="bodySm" as="span" tone="subdued">
            {formatDate(item.updatedAt)}
          </Text>
        </IndexTable.Cell>

        {/* Generate button */}
        <IndexTable.Cell>
          <Popover
            active={isPopoverOpen}
            activator={
              <Button
                size="slim"
                disclosure
                icon={
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 1L12.39 7.26L19 8.27L14.5 12.64L15.78 19.02L10 15.77L4.22 19.02L5.5 12.64L1 8.27L7.61 7.26L10 1Z" />
                  </svg>
                }
                onClick={() => setOpenGeneratePopoverId((prev) => (prev === item.id ? null : item.id))}
                loading={isGenerating}
                disabled={isGenerating || localCredits < 1}
              >
                Generate
              </Button>
            }
            onClose={() => setOpenGeneratePopoverId(null)}
          >
            <ActionList
              items={scopeOptions.map((option) => {
                const optionCredits = creditsForGenerateScope(option.value);
                return {
                  content: `${option.label} (${optionCredits} credit${optionCredits === 1 ? "" : "s"})`,
                  disabled: localCredits < optionCredits,
                  onAction: () => {
                    setOpenGeneratePopoverId(null);
                    handleGenerate(item, option.value);
                  },
                };
              })}
            />
          </Popover>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      fullWidth
      title="Content Management"
      subtitle="Manage and generate content with AI to attract more customers"
      primaryAction={
        <InlineStack gap="200" blockAlign="center">
          <button
            type="button"
            onClick={() => navigate("/app/analytics")}
            style={{
              padding: "6px 14px",
              borderRadius: "8px",
              background: localCredits < 10 ? "#fef3cd" : "#e3f5e1",
              border: `1px solid ${localCredits < 10 ? "#f5c518" : "#50b83c"}`,
              display: "flex",
              alignItems: "center",
              gap: "6px",
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill={localCredits < 10 ? "#b98900" : "#108043"}>
              <path d="M10 1L12.39 7.26L19 8.27L14.5 12.64L15.78 19.02L10 15.77L4.22 19.02L5.5 12.64L1 8.27L7.61 7.26L10 1Z"/>
            </svg>
            <Text variant="bodySm" fontWeight="semibold" as="span">
              {localCredits} Credits.
            </Text>
            <span style={{ color: "#2563eb", fontWeight: 600 }}>Upgrade</span>
          </button>
        </InlineStack>
      }
    >
      <BlockStack gap="400">
        {/* Error / Success banners */}
        {errorMessage && (
          <Banner tone="critical" onDismiss={() => setErrorMessage(null)}>
            <Text as="p">{errorMessage}</Text>
          </Banner>
        )}
        {successMessage && (
          <Banner tone="success" onDismiss={() => setSuccessMessage(null)}>
            <Text as="p">{successMessage}</Text>
          </Banner>
        )}

        {localCredits < 1 && (
          <Banner tone="warning">
            <Text as="p">
              You have {localCredits} credit{localCredits !== 1 ? "s" : ""} remaining. Generate actions require 1-3 credits based on selected scope.
            </Text>
          </Banner>
        )}

        {/* Main tabs: Products | Collections | Pages | Blog */}
        <Card padding="0">
          <Box padding="300" paddingBlockEnd="200">
            <BlockStack gap="300">
              <InlineStack gap="200" wrap>
                {mainTabs.map((tabItem, idx) => {
                  const selected = idx === (mainTabIndex < 0 ? 0 : mainTabIndex);
                  return (
                    <button
                      key={tabItem.id}
                      type="button"
                      onClick={() => handleMainTabChange(idx)}
                      className={`content-mgmt-tab-btn${selected ? " content-mgmt-tab-btn--active" : ""}`}
                    >
                      {tabItem.content}
                    </button>
                  );
                })}
              </InlineStack>

              <InlineStack gap="200" wrap>
                {filterTabs.map((tabItem, idx) => {
                  const selected = idx === (filterTabIndex < 0 ? 0 : filterTabIndex);
                  return (
                    <button
                      key={tabItem.id}
                      type="button"
                      onClick={() => handleFilterTabChange(idx)}
                      className={`content-mgmt-tab-btn${selected ? " content-mgmt-tab-btn--active" : ""}`}
                    >
                      {tabItem.content}
                    </button>
                  );
                })}
              </InlineStack>
            </BlockStack>
          </Box>

          {/* Table */}
          {localItems.length === 0 ? (
            <EmptyState
              heading={`No ${tabLabel} found`}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <Text as="p">
                {filter === "empty"
                  ? `All ${tabLabel} have descriptions.`
                  : filter === "unoptimized"
                  ? `All ${tabLabel} are fully optimized.`
                  : `No ${tabLabel} found in your store.`}
              </Text>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: singularLabel, plural: tabLabel }}
              itemCount={localItems.length}
              headings={headings}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          )}
        </Card>

        {/* Credit info footer */}
        <Box paddingBlockEnd="400">
          <Text variant="bodySm" as="p" tone="subdued" alignment="center">
            Generate All uses {CREDITS_PER_GENERATION} credits. Description/Content, Meta Title, and Meta Description each use 1 credit. Clicking a description or SEO cell opens the editor and saves are free.
          </Text>
        </Box>
      </BlockStack>

      {/* Editor Modal */}
      <EditorModal
        open={editorOpen}
        item={editorItem}
        field={editorField}
        contentType={tab}
        onClose={() => setEditorOpen(false)}
        onSave={handleSaveContent}
        isSaving={isSaving}
      />
      <GenerateTemplateModal
        open={templateModalOpen}
        item={pendingGenerateItem}
        contentType={pendingGenerateContentType}
        generateScope={pendingGenerateScope}
        templateSelection={generateTemplateSelection}
        formValues={generateFormValues}
        previewText={generatedPreviewText}
        progress={generationProgress}
        onChange={updateGenerateTemplateSelection}
        onFormChange={updateGenerateFormValues}
        onClose={closeGenerateModal}
        onGenerate={handleConfirmGenerate}
        isGenerating={generateFetcher.state !== "idle"}
      />
    </Page>
  );
}
