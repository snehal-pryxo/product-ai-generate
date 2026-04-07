import { useState, useCallback, useEffect, useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  IndexTable,
  InlineStack,
  Modal,
  Page,
  Spinner,
  Tabs,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import {
  buildProductContentPrompt,
  buildCollectionContentPrompt,
  buildPageContentPrompt,
  buildBlogContentPrompt,
} from "../lib/contentPromptTemplates";
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

async function generateContentWithOpenAI(prompt, shopApiKey) {
  const apiKey = shopApiKey || process.env.OPENAI_API_KEY;
  const configuredModel = process.env.OPENAI_MODEL || DEFAULT_AI_MODEL;
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

async function generateContentWithAnthropic(prompt, apiKey) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Anthropic API key is not configured.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: "You are an expert Shopify copywriter. Always return valid JSON with the requested keys. No markdown, no code fences.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic request failed with status ${res.status}.`);
  return parseGenerationContent(data?.content?.[0]?.text, data?.model || "claude-haiku");
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

async function runGeneration(prompt, { aiProvider = "auto", shopOpenaiKey = null, shopAnthropicKey = null } = {}) {
  const openaiKey = shopOpenaiKey || process.env.OPENAI_API_KEY;
  const anthropicKey = shopAnthropicKey || process.env.ANTHROPIC_API_KEY;

  if (aiProvider === "anthropic") return generateContentWithAnthropic(prompt, anthropicKey);
  if (aiProvider === "openai") {
    try { return await generateContentWithOpenAI(prompt, openaiKey); }
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
      return generateContentWithOpenAI(prompt, openaiKey);
    }
  }
  try { return await generateContentWithOpenAI(prompt, openaiKey); }
  catch (err) {
    if (OPENAI_OLLAMA_FALLBACK_ERROR_PATTERN.test(err?.message || "") && canUseOllamaFallback())
      return generateContentWithOllama(prompt);
    throw err;
  }
}

function buildPrompt(contentType, item) {
  const base = {
    language: "English",
    tone: "Neutral",
    lengthOption: "50 - 150 words",
    format: "Single paragraph",
    contextKeywords: "",
    descriptionPromptTemplate: "",
    metaTitlePromptTemplate: "",
    metaDescriptionPromptTemplate: "",
    intent: "all",
  };

  if (contentType === "products") {
    return buildProductContentPrompt({
      ...base,
      title: item.title,
      descriptionText: stripHtml(item.descriptionHtml || ""),
      seoTitle: item.seoTitle || "",
      seoDescription: item.seoDescription || "",
    });
  }
  if (contentType === "collections") {
    return buildCollectionContentPrompt({
      ...base,
      title: item.title,
      descriptionText: stripHtml(item.descriptionHtml || ""),
      seoTitle: item.seoTitle || "",
      seoDescription: item.seoDescription || "",
    });
  }
  if (contentType === "pages") {
    return buildPageContentPrompt({
      pageTitle: item.title,
      pageType: "General",
      body: stripHtml(item.body || ""),
      language: "English",
      tone: "Neutral",
      length: "Medium",
      format: "Mixed headings and paragraphs",
      contextKeywords: "",
      bodyPromptTemplate: "",
      metaTitlePromptTemplate: "",
      metaDescriptionPromptTemplate: "",
    });
  }
  if (contentType === "blog") {
    return buildBlogContentPrompt({
      articleType: "General",
      title: item.title,
      body: stripHtml(item.body || ""),
      language: "English",
      tone: "Neutral",
      length: "Medium",
      format: "Mixed headings and paragraphs",
      contextKeywords: "",
      bodyPromptTemplate: "",
      metaTitlePromptTemplate: "",
      metaDescriptionPromptTemplate: "",
    });
  }
  throw new Error(`Unknown content type: ${contentType}`);
}

// ─── Loader ───────────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") || "products";
  const filter = url.searchParams.get("filter") || "all";

  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { credits: true, defaultAiProvider: true, openaiApiKey: true, anthropicApiKey: true },
  });
  const credits = shopData?.credits ?? 100;
  const defaultAiProvider = shopData?.defaultAiProvider || "auto";

  let items = [];

  try {
    if (tab === "products") {
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
    const currentCredits = shopData?.credits ?? 0;
    if (currentCredits < CREDITS_PER_GENERATION) {
      return {
        ok: false,
        intent,
        error: `Insufficient credits. You need ${CREDITS_PER_GENERATION} credits to generate content. Current balance: ${currentCredits}.`,
      };
    }

    const itemJson = formData.get("item");
    let item;
    try { item = JSON.parse(itemJson || "{}"); } catch { item = {}; }

    const aiProvider = formData.get("aiProvider") || shopData?.defaultAiProvider || "auto";

    try {
      const prompt = buildPrompt(contentType, item);
      const generated = await runGeneration(prompt, {
        aiProvider,
        shopOpenaiKey: shopData?.openaiApiKey || null,
        shopAnthropicKey: shopData?.anthropicApiKey || null,
      });

      const descHtml = generated.description
        ? normalizeGeneratedHtml(generated.description)
        : item.descriptionHtml || "";
      const seoTitle = generated.seoTitle || item.seoTitle || "";
      const seoDescription = generated.seoDescription || item.seoDescription || "";

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
      } else if (contentType === "blog") {
        const res = await admin.graphql(ARTICLE_UPDATE_MUTATION, {
          variables: { id: item.id, article: { body: descHtml } },
        });
        const json = await res.json();
        const errors = json?.data?.articleUpdate?.userErrors || [];
        if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
      }

      // Deduct credits
      await db.shop.update({
        where: { shop: session.shop },
        data: { credits: { decrement: CREDITS_PER_GENERATION } },
      });

      // Log generation
      try {
        await db.generatedContentLog.create({
          data: {
            shop: session.shop,
            productId: item.id,
            productTitle: item.title || null,
            intent: `content_management_${contentType}`,
            language: "English",
            tone: "Neutral",
            aiModel: generated.aiModel || null,
            generatedDescription: descHtml || null,
            generatedSeoTitle: seoTitle || null,
            generatedSeoDescription: seoDescription || null,
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
        creditsUsed: CREDITS_PER_GENERATION,
        newCredits: currentCredits - CREDITS_PER_GENERATION,
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
      } else if (contentType === "blog") {
        const res = await admin.graphql(ARTICLE_UPDATE_MUTATION, {
          variables: { id: itemId, article: { body: descriptionHtml } },
        });
        const json = await res.json();
        const errors = json?.data?.articleUpdate?.userErrors || [];
        if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
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
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const generateFetcher = useFetcher();
  const saveFetcher = useFetcher();

  // Editor modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorItem, setEditorItem] = useState(null);
  const [editorField, setEditorField] = useState("description");

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
    if (data.ok) {
      setLocalCredits(data.newCredits);
      setLocalItems((prev) =>
        prev.map((it) =>
          it.id === data.itemId
            ? { ...it, descriptionHtml: data.descriptionHtml, seoTitle: data.seoTitle, seoDescription: data.seoDescription }
            : it
        )
      );
      setSuccessMessage(`Content generated. ${CREDITS_PER_GENERATION} credits used. Remaining: ${data.newCredits}.`);
      setTimeout(() => setSuccessMessage(null), 5000);
      shopify.toast.show("Content generated successfully!");
    } else {
      setErrorMessage(data.error || "Generation failed.");
    }
  }, [generateFetcher.state, generateFetcher.data, shopify]);

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
    ({ itemId, descriptionHtml, seoTitle, seoDescription }) => {
      const fd = new FormData();
      fd.append("intent", "save_content");
      fd.append("contentType", tab);
      fd.append("itemId", itemId);
      fd.append("descriptionHtml", descriptionHtml);
      fd.append("seoTitle", seoTitle);
      fd.append("seoDescription", seoDescription);
      saveFetcher.submit(fd, { method: "post" });
    },
    [saveFetcher, tab]
  );

  const handleGenerate = useCallback(
    (item) => {
      setErrorMessage(null);
      setGeneratingId(item.id);
      const fd = new FormData();
      fd.append("intent", "generate_single");
      fd.append("contentType", tab);
      fd.append("item", JSON.stringify(item));
      fd.append("aiProvider", defaultAiProvider || "auto");
      generateFetcher.submit(fd, { method: "post" });
    },
    [generateFetcher, tab, defaultAiProvider]
  );

  const isSaving = saveFetcher.state !== "idle";

  const tabLabel = mainTabs[mainTabIndex]?.id || "products";
  const singularLabel = { products: "Product", collections: "Collection", pages: "Page", blog: "Blog" }[tabLabel] || "Item";

  const headings = [
    { title: "" },
    { title: singularLabel },
    { title: "Status" },
    { title: "Description" },
    { title: "SEO Description" },
    { title: "Last Updated" },
    { title: "Specific Generate" },
  ];

  const rowMarkup = localItems.map((item, idx) => {
    const isGenerating = generatingId === item.id;
    const descText = truncateText(item.descriptionHtml, 90);
    const seoDescText = truncateText(item.seoDescription, 80);

    return (
      <IndexTable.Row id={item.id} key={item.id} position={idx}>
        {/* Thumbnail */}
        <IndexTable.Cell>
          {item.imageUrl ? (
            <Thumbnail source={item.imageUrl} alt={item.imageAlt} size="small" />
          ) : (
            <div
              style={{
                width: "40px", height: "40px", borderRadius: "6px",
                background: "#f6f6f7", border: "1px solid #e1e3e5",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="#8c9196">
                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2H5v2h2V5zm2 0h2v2h-2V5zm4 0h2v2h-2V5zM5 9h2v2H5V9zm4 0h2v2H9V9zm4 0h2v2h-2V9zM5 13h10v2H5v-2z" clipRule="evenodd"/>
              </svg>
            </div>
          )}
        </IndexTable.Cell>

        {/* Name */}
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="semibold" as="span">{item.title}</Text>
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
          <Button
            size="slim"
            icon={
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 1L12.39 7.26L19 8.27L14.5 12.64L15.78 19.02L10 15.77L4.22 19.02L5.5 12.64L1 8.27L7.61 7.26L10 1Z" />
              </svg>
            }
            onClick={() => handleGenerate(item)}
            loading={isGenerating}
            disabled={isGenerating || localCredits < CREDITS_PER_GENERATION}
          >
            Specific Generate
          </Button>
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
          <div
            style={{
              padding: "6px 14px",
              borderRadius: "8px",
              background: localCredits < 10 ? "#fef3cd" : "#e3f5e1",
              border: `1px solid ${localCredits < 10 ? "#f5c518" : "#50b83c"}`,
              display: "flex", alignItems: "center", gap: "6px",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill={localCredits < 10 ? "#b98900" : "#108043"}>
              <path d="M10 1L12.39 7.26L19 8.27L14.5 12.64L15.78 19.02L10 15.77L4.22 19.02L5.5 12.64L1 8.27L7.61 7.26L10 1Z"/>
            </svg>
            <Text variant="bodySm" fontWeight="semibold" as="span">
              {localCredits} Credits
            </Text>
          </div>
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

        {localCredits < CREDITS_PER_GENERATION && (
          <Banner tone="warning">
            <Text as="p">
              You have {localCredits} credit{localCredits !== 1 ? "s" : ""} remaining. Each generation costs {CREDITS_PER_GENERATION} credits.
            </Text>
          </Banner>
        )}

        {/* Main tabs: Products | Collections | Pages | Blog */}
        <Card padding="0">
          <Tabs
            tabs={mainTabs}
            selected={mainTabIndex < 0 ? 0 : mainTabIndex}
            onSelect={handleMainTabChange}
          >
            {/* Filter sub-tabs */}
            <Box paddingBlockStart="0">
              <div style={{ borderBottom: "1px solid #e1e3e5", paddingInline: "16px" }}>
                <Tabs
                  tabs={filterTabs}
                  selected={filterTabIndex < 0 ? 0 : filterTabIndex}
                  onSelect={handleFilterTabChange}
                />
              </div>

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
            </Box>
          </Tabs>
        </Card>

        {/* Credit info footer */}
        <Box paddingBlockEnd="400">
          <Text variant="bodySm" as="p" tone="subdued" alignment="center">
            Each AI generation costs {CREDITS_PER_GENERATION} credits (description + SEO title + SEO description). Clicking a description or SEO cell opens the editor — saves are free.
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
    </Page>
  );
}
