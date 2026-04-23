import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useRevalidator,
} from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Icon,
  IndexTable,
  InlineStack,
  Page,
  Select,
  Spinner,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import { ProductIcon, CollectionIcon, SearchIcon, ChevronUpIcon, ChevronDownIcon, XIcon } from "@shopify/polaris-icons";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { buildProductContentPrompt } from "../lib/contentPromptTemplates";
import { TemplateLibraryModal } from "../components/TemplateLibraryModal";
import { readGlobalSettings } from "../lib/globalSettings";
import {
  readStoredProductPromptTemplateSelection,
  PRODUCT_DESCRIPTION_TEMPLATES,
  PRODUCT_META_DESCRIPTION_TEMPLATES,
  PRODUCT_META_TITLE_TEMPLATES,
} from "../lib/productPromptTemplateLibrary";
import {
  buildInsufficientCreditsError,
  creditsForBatch,
  creditsForContentTypes,
  deductCredits,
  parseSelectedContentTypes,
} from "../lib/credits.server";
/* global process */

const FETCH_BATCH_SIZE = 250;
const STATUS_FILTERS = ["all", "active", "draft"];
const BULK_GENERATE_INTENT = "bulk_generate";
const MAX_BULK_ITEMS = 50;
const MIN_BULK_PRODUCT_SELECTION_ERROR = "Select at least one product for bulk generation.";
const MAX_BULK_PRODUCT_SELECTION_ERROR = `You can bulk generate up to ${MAX_BULK_ITEMS} products at a time.`;
const PRODUCT_CONTENT_TYPES = ["description", "meta_title", "meta_description"];
const DEFAULT_PRODUCT_CONTENT_TYPES = ["description", "meta_title", "meta_description"];
const DEFAULT_AI_MODEL = "gpt-4o-mini";
const DEFAULT_OLLAMA_MODEL = "llama3.2:1b";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const OPENAI_RATE_LIMIT_RETRY_DELAY_MS = 20000;
const OPENAI_MODEL_ACCESS_ERROR_PATTERN = /does not exist|do not have access|not found/i;
const OPENAI_QUOTA_ERROR_PATTERN = /quota|billing|insufficient_quota/i;
const OPENAI_RATE_LIMIT_ERROR_PATTERN = /rate limit|too many requests|429/i;
const OPENAI_OLLAMA_FALLBACK_ERROR_PATTERN =
  /quota|billing|insufficient_quota|OPENAI_API_KEY is missing|does not exist|do not have access|rate limit|too many requests|429/i;
const ENABLED_ENV_VALUE_PATTERN = /^(1|true|yes)$/i;
const LANGUAGE_OPTIONS = [
  "English", "English (British)", "English (US)", "Arabic", "Bengali", "Bulgarian",
  "Chinese", "Chinese (Simplified)", "Chinese (Traditional)", "Croatian", "Czech",
  "Danish", "Dutch", "Finnish", "French", "German", "Greek", "Hebrew", "Hindi",
  "Hungarian", "Indonesian", "Italian", "Japanese", "Korean", "Malay", "Norwegian",
  "Polish", "Portuguese", "Romanian", "Russian", "Spanish", "Swedish", "Tamil",
  "Telugu", "Thai", "Turkish", "Ukrainian", "Urdu", "Vietnamese",
].map((l) => ({ label: l, value: l }));

const DEFAULT_DESCRIPTION_CUSTOM_PROMPT = `Write a clear, engaging, and professional product description for the given product. The description should be structured and easy to scan.

Follow this format:

Introduction - Start with 1-2 sentences that capture the product's essence: what it is, who it's for, and its main appeal.

Key Features - Highlight important attributes such as size, color, material, functionality, technology, or craftsmanship.

Benefits - Explain how the product helps the user, what problem it solves, or what experience it enhances.

Keep the tone trustworthy, simple, and appealing, like a top e-commerce store.
Avoid exaggeration. Adapt the level of detail depending on the product type.

Html format should be like this:
<p>
{Introduction text here}
</p>

<ul>
<li><b>{Feature name}</b>: {Feature text here}</li>
<li><b>{Feature name}</b>: {Feature text here}</li>
<li><b>{Feature name}</b>: {Feature text here}</li>
... and so on
</ul>

<p>
{Benefits text here}
</p>`;

const DEFAULT_META_DESCRIPTION_CUSTOM_PROMPT = `Write an SEO-friendly meta description for the given product.

Requirements:
- Primary keyword naturally included
- Clear value proposition
- Call to action
- 140-160 characters max
- Compelling and click-worthy

Format: Engaging description that drives clicks from search results.`;

const DEFAULT_META_TITLE_CUSTOM_PROMPT = `Write an SEO-friendly meta title for the given product.

Requirements:
- Primary keyword placement
- Brand name inclusion
- Under 60 characters
- Compelling and descriptive
- Search-friendly format

Focus on click-through rate optimization.`;
const COLLECTIONS_QUERY = `#graphql
  query GetCollections {
    collections(first: 100, sortKey: TITLE) {
      edges {
        node {
          id
          title
        }
      }
    }
  }
`;

const COLLECTION_PRODUCTS_QUERY = `#graphql
  query CollectionProducts(
    $id: ID!
    $first: Int
    $after: String
  ) {
    collection(id: $id) {
      id
      title
      products(first: $first, after: $after, sortKey: TITLE) {
        edges {
          node {
            id
            title
            handle
            status
            descriptionHtml
            seo {
              title
              description
            }
            }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  }
`;

const PRODUCT_LIST_QUERY = `#graphql
  query ProductList(
    $first: Int
    $after: String
    $query: String
  ) {
    products(
      first: $first
      after: $after
      query: $query
      sortKey: TITLE
    ) {
      edges {
        node {
          id
          title
          handle
          status
          descriptionHtml
          seo {
            title
            description
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = `#graphql
  mutation ProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        title
        descriptionHtml
        seo {
          title
          description
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function escapeSearchValue(value) {
  return value.replace(/[\\"]/g, "\\$&");
}

function toSearchQuery({ search, status }) {
  const filters = [];

  if (status !== "all") {
    filters.push(`status:${status}`);
  }

  if (search) {
    const escapedSearch = escapeSearchValue(search);
    const titleQuery = escapedSearch.includes(" ")
      ? `"${escapedSearch}"`
      : escapedSearch;
    filters.push(`title:${titleQuery}`);
  }

  return filters.join(" ");
}

function evaluateDescription(description) {
  if (!description || !description.trim()) return { label: "Missing", tone: "critical" };
  const length = description.trim().length;
  if (length < 80) return { label: "Short", tone: "warning" };
  return { label: "Good", tone: "success" };
}

function evaluateSeoTitle(title) {
  if (!title || !title.trim()) return { label: "Missing", tone: "critical" };
  const length = title.trim().length;
  if (length < 30) return { label: "Too short", tone: "warning" };
  if (length > 60) return { label: "Too long", tone: "warning" };
  return { label: "Good", tone: "success" };
}

function evaluateSeoDescription(description) {
  if (!description || !description.trim()) return { label: "Missing", tone: "critical" };
  const length = description.trim().length;
  if (length < 120) return { label: "Too short", tone: "warning" };
  if (length > 160) return { label: "Too long", tone: "warning" };
  return { label: "Good", tone: "success" };
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toStatusMeta(status) {
  if (status === "ACTIVE") return { label: "Active", tone: "success" };
  if (status === "ARCHIVED") return { label: "UNLISTED", tone: "caution" };
  if (status === "DRAFT") return { label: "Draft", tone: "warning" };
  return { label: status, tone: "neutral" };
}

function toAppGenerationStatusMeta(generatedContent) {
  if (!generatedContent) return { label: "Not generated", tone: "critical" };
  if (generatedContent.appliedToProduct) return { label: "Active", tone: "success" };
  return { label: "Generated", tone: "warning" };
}

function formatRelativeGenerationTime(value) {
  if (!value) return "Not generated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not generated";

  const diffMs = Math.max(0, Date.now() - date.getTime());
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < hourMs) {
    const minutes = Math.max(1, Math.floor(diffMs / minuteMs));
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.floor(diffMs / hourMs));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  const days = Math.max(1, Math.floor(diffMs / dayMs));
  return `${days} day${days === 1 ? "" : "s"}`;
}

function toBadgeTone(tone) {
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "caution") return "attention";
  if (tone === "critical") return "critical";
  return undefined;
}

function toSeoPalette(tone) {
  if (tone === "success") {
    return {
      background: "#9ff0b0",
      border: "#75d88f",
      text: "#146d39",
      dot: "#0b8b45",
    };
  }

  if (tone === "warning" || tone === "caution") {
    return {
      background: "#f8edb0",
      border: "#e4cd67",
      text: "#735b00",
      dot: "#b18400",
    };
  }

  if (tone === "critical") {
    return {
      background: "#ffd9d6",
      border: "#f3a9a1",
      text: "#8e2b23",
      dot: "#cc4133",
    };
  }

  return {
    background: "#e5e7eb",
    border: "#cfd4db",
    text: "#48515f",
    dot: "#7b8494",
  };
}

function renderBadge({ label, tone }) {
  return <Badge tone={toBadgeTone(tone)}>{label}</Badge>;
}

function readFormString(formData, key) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKeyword(value) {
  return (value || "").trim().replace(/\s+/g, " ");
}

function mergeUniqueKeywords(...keywordLists) {
  const merged = [];
  const seen = new Set();

  keywordLists.forEach((keywordList) => {
    (keywordList || []).forEach((rawKeyword) => {
      const keyword = normalizeKeyword(rawKeyword);
      if (!keyword) return;
      const key = keyword.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(keyword);
    });
  });

  return merged;
}

function cleanInlineText(value, maxLength) {
  return (value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value) {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value || "");
}

function toStructuredHtml(value) {
  const plainText = (value || "").trim();
  if (!plainText) return "";

  const lines = plainText.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraphLines = [];
  let listType = null;
  let listItems = [];
  let firstHeadingUsed = false;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    html.push(`<p>${escapeHtml(paragraphLines.join(" "))}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    html.push(`<${listType}>${listItems.map((item) => `<li>${item}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)/) || line.match(/^\u2022\s+(.+)/);
    const orderedMatch = line.match(/^\d+[.)]\s+(.+)/);
    if (bulletMatch || orderedMatch) {
      flushParagraph();
      const nextListType = bulletMatch ? "ul" : "ol";
      if (listType && listType !== nextListType) flushList();
      listType = nextListType;
      listItems.push(escapeHtml((bulletMatch?.[1] || orderedMatch?.[1] || "").trim()));
      continue;
    }

    flushList();
    const plainLine = line.replace(/:$/, "");
    const isHeadingCandidate =
      line.endsWith(":") ||
      (line.length <= 80 &&
        !/[.!?]$/.test(line) &&
        plainLine.split(/\s+/).length <= 12 &&
        /^[A-Z0-9]/.test(plainLine));

    if (isHeadingCandidate) {
      flushParagraph();
      if (!firstHeadingUsed) {
        html.push(`<h2>${escapeHtml(plainLine)}</h2>`);
        firstHeadingUsed = true;
      } else {
        html.push(`<h3>${escapeHtml(plainLine)}</h3>`);
      }
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return html.join("");
}

function normalizeGeneratedHtml(value) {
  const text = (value || "").trim();
  if (!text) return "";
  if (looksLikeHtml(text)) return text;
  return toStructuredHtml(text);
}

function buildGenerationPrompt({
  title,
  descriptionText,
  seoTitle,
  seoDescription,
  language,
  tone,
  lengthOption,
  format,
  contextKeywords,
  descriptionPromptTemplate,
  metaTitlePromptTemplate,
  metaDescriptionPromptTemplate,
}) {
  return buildProductContentPrompt({
    title,
    descriptionText,
    seoTitle,
    seoDescription,
    language,
    tone,
    lengthOption,
    format,
    contextKeywords,
    descriptionPromptTemplate,
    metaTitlePromptTemplate,
    metaDescriptionPromptTemplate,
    intent: "all",
  });
}

async function generateContentWithAnthropic(input, apiKey) {
  if (!apiKey) {
    throw new Error("Anthropic API key is not configured. Add it on the Dashboard Settings page.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system:
        "You are an expert Shopify copywriter. Always return valid JSON with the requested keys. No markdown, no code fences.",
      messages: [{ role: "user", content: buildGenerationPrompt(input) }],
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorMsg =
      payload?.error?.message || `Anthropic request failed with status ${response.status}.`;
    throw new Error(errorMsg);
  }

  const rawContent = payload?.content?.[0]?.text;
  return parseGenerationContent(rawContent, payload?.model || "claude-haiku-4-5-20251001");
}

async function generateContentWithOpenAI(input, shopApiKey) {
  const apiKey = shopApiKey || process.env.OPENAI_API_KEY;
  const configuredModel = process.env.OPENAI_MODEL || DEFAULT_AI_MODEL;
  if (!apiKey) {
    throw new Error("OpenAI API key is not configured. Add it on the Dashboard Settings page.");
  }

  const requestPayload = (model) => ({
    model,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an expert Shopify copywriter. Always return valid JSON with the requested keys.",
      },
      {
        role: "user",
        content: buildGenerationPrompt(input),
      },
    ],
  });

  async function sendChatRequest(model, attempt = 0) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestPayload(model)),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const result = {
      ok: response.ok,
      payload,
      model,
      status: response.status,
      retryAfterSeconds: Number.parseInt(response.headers.get("retry-after") || "", 10),
    };

    const details = getOpenAiErrorDetails(result);
    const shouldRetryRateLimit =
      !result.ok &&
      result.status === 429 &&
      attempt < 1 &&
      (OPENAI_RATE_LIMIT_ERROR_PATTERN.test(details.message) ||
        details.code === "rate_limit_exceeded");

    if (shouldRetryRateLimit) {
      const retryDelayMs =
        Number.isFinite(result.retryAfterSeconds) && result.retryAfterSeconds > 0
          ? result.retryAfterSeconds * 1000
          : OPENAI_RATE_LIMIT_RETRY_DELAY_MS;

      await new Promise((resolve) => setTimeout(resolve, Math.min(retryDelayMs, 30000)));
      return sendChatRequest(model, attempt + 1);
    }

    return result;
  }

  let result = await sendChatRequest(configuredModel);

  if (!result.ok) {
    const details = getOpenAiErrorDetails(result);
    const shouldFallback =
      configuredModel !== DEFAULT_AI_MODEL &&
      (OPENAI_MODEL_ACCESS_ERROR_PATTERN.test(details.message) ||
        OPENAI_QUOTA_ERROR_PATTERN.test(details.message) ||
        details.code === "insufficient_quota");

    if (shouldFallback) {
      result = await sendChatRequest(DEFAULT_AI_MODEL);
    }
  }

  if (!result.ok) {
    const details = getOpenAiErrorDetails(result);

    if (OPENAI_QUOTA_ERROR_PATTERN.test(details.message) || details.code === "insufficient_quota") {
      throw new Error(
        `${details.message} OpenAI project quota is exhausted. Add billing/credits in the same OpenAI project as this API key, or set AI_PROVIDER=ollama.`,
      );
    }

    if (
      OPENAI_RATE_LIMIT_ERROR_PATTERN.test(details.message) ||
      details.code === "rate_limit_exceeded"
    ) {
      throw new Error(
        `${details.message} OpenAI request limits are currently exhausted for this project. Wait and retry, or set AI_PROVIDER=ollama.`,
      );
    }

    throw new Error(details.message);
  }

  const rawContent = result.payload?.choices?.[0]?.message?.content;
  return parseGenerationContent(rawContent, result.payload?.model || result.model);
}

function getOpenAiErrorDetails(result) {
  const error = result?.payload?.error || {};
  const message =
    error?.message ||
    (result?.status ? `OpenAI request failed with status ${result.status}.` : "AI request failed.");

  return {
    message,
    code: String(error?.code || "").toLowerCase(),
  };
}

function shouldFallbackToOllamaFromOpenAiMessage(message) {
  return OPENAI_OLLAMA_FALLBACK_ERROR_PATTERN.test(message || "");
}

function canUseOllamaFallback() {
  const baseUrl = (process.env.OLLAMA_BASE_URL || "").trim();
  const enabledValue = (process.env.ENABLE_OLLAMA_FALLBACK || "").trim();

  return Boolean(baseUrl) && ENABLED_ENV_VALUE_PATTERN.test(enabledValue);
}

function parseGenerationContent(rawContent, modelName) {
  if (!rawContent || typeof rawContent !== "string") {
    throw new Error("AI response was empty.");
  }

  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("AI response format was invalid.");
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  return {
    productDescription: (parsed?.productDescription || parsed?.description || "").trim(),
    seoTitle: cleanInlineText(parsed?.seoTitle || "", 70),
    seoDescription: cleanInlineText(parsed?.seoDescription || "", 160),
    aiModel: modelName || null,
  };
}

async function generateContentWithOllama(input) {
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;

  let response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0.7 },
        messages: [
          {
            role: "system",
            content:
              "You are an expert Shopify copywriter. Always return valid JSON with the requested keys.",
          },
          {
            role: "user",
            content: buildGenerationPrompt(input),
          },
        ],
      }),
    });
  } catch (error) {
    const causeCode = error?.cause?.code || "";
    const isConnectionRefused =
      causeCode === "ECONNREFUSED" || /ECONNREFUSED|fetch failed/i.test(error?.message || "");
    const isLocalhostBaseUrl = /127\.0\.0\.1|localhost/i.test(baseUrl);

    if (isConnectionRefused && isLocalhostBaseUrl) {
      throw new Error(
        `Cannot reach Ollama at ${baseUrl}. In deployed environments, localhost points to the server itself. Set AI_PROVIDER=openai, or set OLLAMA_BASE_URL to a reachable remote Ollama server.`,
      );
    }

    throw new Error(
      `Failed to connect to Ollama at ${baseUrl}. ${error?.message || "Unknown network error."}`,
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.error || `Ollama request failed with status ${response.status}.`,
    );
  }

  return parseGenerationContent(payload?.message?.content, payload?.model || model);
}

async function generateContent(input, { aiProvider = "auto", shopOpenaiKey = null, shopAnthropicKey = null } = {}) {
  const openaiKey = shopOpenaiKey || process.env.OPENAI_API_KEY;
  const anthropicKey = shopAnthropicKey || process.env.ANTHROPIC_API_KEY;

  // User explicitly chose Claude / Anthropic
  if (aiProvider === "anthropic") {
    return await generateContentWithAnthropic(input, anthropicKey);
  }

  // User explicitly chose OpenAI
  if (aiProvider === "openai") {
    try {
      return await generateContentWithOpenAI(input, openaiKey);
    } catch (openAiError) {
      const message = openAiError?.message || "";
      const shouldTryOllama = shouldFallbackToOllamaFromOpenAiMessage(message) && canUseOllamaFallback();
      if (!shouldTryOllama) throw openAiError;
      try {
        return await generateContentWithOllama(input);
      } catch (ollamaError) {
        throw new Error(`${message} Local Ollama fallback failed: ${ollamaError?.message || "Unknown error."}`);
      }
    }
  }

  // Auto / env-based routing
  const provider = (process.env.AI_PROVIDER || "").trim().toLowerCase();

  if (provider === "ollama") {
    try {
      return await generateContentWithOllama(input);
    } catch (ollamaError) {
      if (!openaiKey) throw ollamaError;
      try {
        return await generateContentWithOpenAI(input, openaiKey);
      } catch (openAiError) {
        throw new Error(
          `${ollamaError?.message || "Ollama request failed."} OpenAI fallback failed: ${openAiError?.message || "Unknown error."}`,
        );
      }
    }
  }

  // Default: try OpenAI (or Anthropic if no OpenAI key but Anthropic key exists)
  if (!openaiKey && anthropicKey) {
    return await generateContentWithAnthropic(input, anthropicKey);
  }

  try {
    return await generateContentWithOpenAI(input, openaiKey);
  } catch (openAiError) {
    const message = openAiError?.message || "";
    const shouldTryOllama = shouldFallbackToOllamaFromOpenAiMessage(message) && canUseOllamaFallback();
    if (!shouldTryOllama) throw openAiError;
    try {
      return await generateContentWithOllama(input);
    } catch (ollamaError) {
      throw new Error(`${message} Local Ollama fallback failed: ${ollamaError?.message || "Unknown error."}`);
    }
  }
}

async function writeGenerationLog(data) {
  try {
    await db.generatedContentLog.create({ data });
  } catch (error) {
    console.error("Failed to store generated content log", error);
  }
}

async function upsertProductContent(data) {
  try {
    await db.productGeneratedContent.upsert({
      where: { shop_productId: { shop: data.shop, productId: data.productId } },
      create: data,
      update: data,
    });
  } catch (error) {
    console.error("Failed to upsert product generated content", error);
  }
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = readFormString(formData, "intent");

  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { openaiApiKey: true, anthropicApiKey: true, credits: true, creditsUsedTotal: true },
  });

  try {
    if (intent === BULK_GENERATE_INTENT) {
      const productsJson = formData.get("products");
      const bulkProducts = JSON.parse(productsJson || "[]");
      if (!Array.isArray(bulkProducts) || bulkProducts.length === 0) {
        return { ok: false, intent, error: MIN_BULK_PRODUCT_SELECTION_ERROR };
      }
      if (bulkProducts.length > MAX_BULK_ITEMS) {
        return {
          ok: false,
          intent,
          error: MAX_BULK_PRODUCT_SELECTION_ERROR,
        };
      }
      const language = readFormString(formData, "language") || "English";
      const tone = readFormString(formData, "tone") || "Neutral";
      const lengthOption = readFormString(formData, "length") || "50 - 150 words";
      const formatOption = readFormString(formData, "format") || "Single paragraph";
      const contextKeywords = readFormString(formData, "contextKeywords");
      const descriptionPromptTemplate = readFormString(formData, "descriptionPromptTemplate");
      const metaTitlePromptTemplate = readFormString(formData, "metaTitlePromptTemplate");
      const metaDescriptionPromptTemplate = readFormString(formData, "metaDescriptionPromptTemplate");
      const aiProvider = readFormString(formData, "aiProvider") || "auto";
      const addTitleAsHeadingFlag = !!readFormString(formData, "addTitleAsHeading");
      const preserveOldDescriptionFlag = !!readFormString(formData, "preserveOldDescription");
      const removeImagesFlag = !!readFormString(formData, "removeImagesFromDescription");
      const selectedContentTypes = parseSelectedContentTypes(
        formData.get("contentTypes"),
        PRODUCT_CONTENT_TYPES,
        DEFAULT_PRODUCT_CONTENT_TYPES,
      );
      const shouldUpdateDescription = selectedContentTypes.includes("description");
      const shouldUpdateMetaTitle = selectedContentTypes.includes("meta_title");
      const shouldUpdateMetaDescription = selectedContentTypes.includes("meta_description");
      const creditsPerItem = creditsForContentTypes(selectedContentTypes);
      const availableCredits = shopData?.credits ?? 100;
      const requiredCredits = creditsForBatch(selectedContentTypes, bulkProducts.length);

      if (availableCredits < requiredCredits) {
        return {
          ok: false,
          intent,
          error: buildInsufficientCreditsError(requiredCredits, availableCredits),
        };
      }

      const results = await Promise.allSettled(
        bulkProducts.map(async (p) => {
          const generated = await generateContent(
            {
              title: p.title,
              descriptionText: stripHtml(p.descriptionHtml || ""),
              seoTitle: p.seoTitleValue || "",
              seoDescription: p.seoDescriptionValue || "",
              language,
              tone,
              lengthOption,
              format: formatOption,
              contextKeywords,
              descriptionPromptTemplate,
              metaTitlePromptTemplate,
              metaDescriptionPromptTemplate,
              intent: shouldUpdateMetaTitle && !shouldUpdateDescription && !shouldUpdateMetaDescription
                ? "seo_title"
                : !shouldUpdateMetaTitle && !shouldUpdateDescription && shouldUpdateMetaDescription
                  ? "seo_description"
                  : "all",
            },
            {
              aiProvider,
              shopOpenaiKey: shopData?.openaiApiKey || null,
              shopAnthropicKey: shopData?.anthropicApiKey || null,
            },
          );

          let nextDescription = shouldUpdateDescription
            ? (generated.productDescription
              ? normalizeGeneratedHtml(generated.productDescription)
              : p.descriptionHtml || "")
            : p.descriptionHtml || "";
          if (shouldUpdateDescription && generated.productDescription) {
            if (removeImagesFlag) {
              nextDescription = nextDescription.replace(/<img\b[^>]*>/gi, "").replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "");
            }
            if (addTitleAsHeadingFlag && p.title) {
              nextDescription = `<h2>${p.title.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</h2>${nextDescription}`;
            }
            if (preserveOldDescriptionFlag && p.descriptionHtml) {
              const oldHtml = removeImagesFlag
                ? p.descriptionHtml.replace(/<img\b[^>]*>/gi, "").replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "")
                : p.descriptionHtml;
              nextDescription = nextDescription + oldHtml;
            }
          }
          const nextSeoTitle = shouldUpdateMetaTitle
            ? (generated.seoTitle || p.seoTitleValue || "")
            : (p.seoTitleValue || "");
          const nextSeoDescription = shouldUpdateMetaDescription
            ? (generated.seoDescription || p.seoDescriptionValue || "")
            : (p.seoDescriptionValue || "");

          const updateRes = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
            variables: {
              product: {
                id: p.id,
                descriptionHtml: nextDescription,
                seo: { title: nextSeoTitle, description: nextSeoDescription },
              },
            },
          });
          const updateJson = await updateRes.json();
          const userErrors = updateJson?.data?.productUpdate?.userErrors || [];
          if (userErrors.length > 0) throw new Error(userErrors.map((e) => e.message).join(", "));

          await writeGenerationLog({
            shop: session.shop,
            productId: p.id,
            productTitle: p.title || null,
            intent: "product_bulk_generate",
            resourceType: "product",
            language: language || null,
            tone: tone || null,
            lengthOption: lengthOption || null,
            formatOption: formatOption || null,
            contextKeywords: contextKeywords || null,
            aiModel: generated.aiModel || null,
            generatedDescription: nextDescription || null,
            generatedSeoTitle: nextSeoTitle || null,
            generatedSeoDescription: nextSeoDescription || null,
            creditsUsed: creditsPerItem,
            appliedToProduct: true,
          });

          await upsertProductContent({
            shop: session.shop,
            productId: p.id,
            productTitle: p.title || null,
            language: language || null,
            tone: tone || null,
            lengthOption: lengthOption || null,
            formatOption: formatOption || null,
            contextKeywords: contextKeywords || null,
            descriptionPromptTemplate: descriptionPromptTemplate || null,
            metaTitlePromptTemplate: metaTitlePromptTemplate || null,
            metaDescriptionPromptTemplate: metaDescriptionPromptTemplate || null,
            aiModel: generated.aiModel || null,
            descriptionHtml: nextDescription || null,
            seoTitle: nextSeoTitle || null,
            seoDescription: nextSeoDescription || null,
            creditsUsed: creditsPerItem,
            appliedToProduct: true,
          });

          return { id: p.id, title: p.title, seoTitle: nextSeoTitle, seoDescription: nextSeoDescription, description: nextDescription };
        }),
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      const creditsUsed = succeeded * creditsPerItem;
      let newCredits = availableCredits;
      let creditsUsedTotal = shopData?.creditsUsedTotal ?? 0;
      let creditWarning = null;

      if (creditsUsed > 0) {
        try {
          const creditSnapshot = await deductCredits({ shopDomain: session.shop, creditsUsed });
          newCredits = creditSnapshot.credits;
          creditsUsedTotal = creditSnapshot.creditsUsedTotal;
        } catch (creditError) {
          creditWarning = creditError?.message || "Credits could not be updated automatically.";
        }
      }

      const itemResults = results.map((r, i) => ({
        id: bulkProducts[i].id,
        title: bulkProducts[i].title,
        status: r.status === "fulfilled" ? "success" : "failed",
        error: r.status === "rejected" ? r.reason?.message : null,
        seoTitle: r.status === "fulfilled" ? r.value.seoTitle : null,
        seoDescription: r.status === "fulfilled" ? r.value.seoDescription : null,
      }));
      return {
        ok: true,
        intent,
        succeeded,
        failed,
        total: bulkProducts.length,
        results: itemResults,
        contentTypes: selectedContentTypes,
        creditsPerItem,
        creditsUsed,
        newCredits,
        creditsUsedTotal,
        creditWarning,
      };
    }

    return { ok: false, intent, error: "Unsupported action." };
  } catch (error) {
    console.error("Product content action failed", error);
    return {
      ok: false,
      intent,
      error: error?.message || "Failed to process request.",
    };
  }
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: {
      openaiApiKey: true,
      anthropicApiKey: true,
      defaultAiProvider: true,
      credits: true,
      creditsUsedTotal: true,
      ownerName: true,
      name: true,
    },
  });
  const shopDomain = String(session.shop || "").trim();
  const shopHandle = shopDomain.split(".")[0] || "Shop Owner";
  const fallbackOwnerName = shopHandle
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const shopOwnerName =
    (shopData?.ownerName || "").trim() ||
    (shopData?.name || "").trim() ||
    fallbackOwnerName ||
    "Shop Owner";
  const url = new URL(request.url);

  const search = (url.searchParams.get("q") || "").trim();
  const searchForQuery = search.length >= 2 ? search : "";
  const statusParam = (url.searchParams.get("status") || "all").toLowerCase();
  const status = STATUS_FILTERS.includes(statusParam) ? statusParam : "all";
  const collectionId = url.searchParams.get("collectionId") || "";

  // Fetch collections for the filter dropdown (runs in parallel with products)
  const collectionsPromise = admin.graphql(COLLECTIONS_QUERY).then((r) => r.json());
  const productNodes = [];

  if (collectionId) {
    let afterCursor;
    while (true) {
      const colRes = await admin.graphql(COLLECTION_PRODUCTS_QUERY, {
        variables: {
          id: collectionId,
          first: FETCH_BATCH_SIZE,
          after: afterCursor,
        },
      });
      const colJson = await colRes.json();
      const productConnection = colJson?.data?.collection?.products;
      if (!productConnection) break;

      const nodes = (productConnection.edges || []).map(({ node }) => node);
      productNodes.push(...nodes);

      if (!productConnection.pageInfo?.hasNextPage || !productConnection.pageInfo?.endCursor) {
        break;
      }
      afterCursor = productConnection.pageInfo.endCursor;
    }
  } else {
    const query = toSearchQuery({ search: searchForQuery, status });
    let afterCursor;
    while (true) {
      const response = await admin.graphql(PRODUCT_LIST_QUERY, {
        variables: {
          first: FETCH_BATCH_SIZE,
          after: afterCursor,
          query: query || undefined,
        },
      });
      const responseJson = await response.json();
      const productConnection = responseJson?.data?.products;
      if (!productConnection) break;

      const nodes = (productConnection.edges || []).map(({ node }) => node);
      productNodes.push(...nodes);

      if (!productConnection.pageInfo?.hasNextPage || !productConnection.pageInfo?.endCursor) {
        break;
      }
      afterCursor = productConnection.pageInfo.endCursor;
    }
  }

  const collectionsJson = await collectionsPromise;
  const collections = (collectionsJson?.data?.collections?.edges || []).map((e) => e.node);

  if (productNodes.length === 0) {
    return {
      filters: { search, status, collectionId },
      collections,
      products: [],
      hasOpenaiKey: !!(shopData?.openaiApiKey || process.env.OPENAI_API_KEY),
      hasAnthropicKey: !!(shopData?.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
      defaultAiProvider: shopData?.defaultAiProvider || "auto",
      credits: shopData?.credits ?? 100,
      creditsUsedTotal: shopData?.creditsUsedTotal ?? 0,
      shopOwnerName,
    };
  }
  const generatedContentByProductId = new Map();

  if (productNodes.length > 0) {
    const generatedContents = await db.productGeneratedContent.findMany({
      where: {
        shop: session.shop,
        productId: { in: productNodes.map((node) => node.id) },
      },
      select: {
        productId: true,
        appliedToProduct: true,
        updatedAt: true,
      },
    });

    generatedContents.forEach((entry) => {
      generatedContentByProductId.set(entry.productId, entry);
    });
  }

  const products = productNodes.map((node) => {
    const generatedContent = generatedContentByProductId.get(node.id);

    return {
      id: node.id,
      title: node.title,
      handle: node.handle,
      descriptionHtml: node.descriptionHtml || "",
      descriptionText: stripHtml(node.descriptionHtml),
      descriptionStatus: evaluateDescription(stripHtml(node.descriptionHtml)),
      status: toStatusMeta(node.status),
      appStatus: toAppGenerationStatusMeta(generatedContent),
      generatedTime: formatRelativeGenerationTime(generatedContent?.updatedAt),
      seoTitle: evaluateSeoTitle(node.seo?.title || node.title),
      seoDescription: evaluateSeoDescription(node.seo?.description),
      seoTitleValue: node.seo?.title || "",
      seoDescriptionValue: node.seo?.description || "",
    };
  });

  return {
    filters: { search, status, collectionId },
    collections,
    products,
    hasOpenaiKey: !!(shopData?.openaiApiKey || process.env.OPENAI_API_KEY),
    hasAnthropicKey: !!(shopData?.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
    defaultAiProvider: shopData?.defaultAiProvider || "auto",
    credits: shopData?.credits ?? 100,
    creditsUsedTotal: shopData?.creditsUsedTotal ?? 0,
    shopOwnerName,
  };
};

const bulkInitialSettings = {
  language: "English",
  tone: "Neutral",
  length: "50 - 150 words",
  format: "Single paragraph",
  aiProvider: "auto",
};

export default function ProductsPage() {
  const { filters, products, collections, defaultAiProvider, credits, shopOwnerName } = useLoaderData();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const bulkFetcher = useFetcher();
  const shopify = useAppBridge();
  const [searchValue, setSearchValue] = useState(filters.search);
  const [fallbackProducts, setFallbackProducts] = useState(products);
  const [bulkDescTemplate, setBulkDescTemplate] = useState("");
  const [bulkMetaDescTemplate, setBulkMetaDescTemplate] = useState("");
  const [bulkMetaTitleTemplate, setBulkMetaTitleTemplate] = useState("");
  const [bulkDescKeywords, setBulkDescKeywords] = useState(() => readGlobalSettings().productDescKeywords || "");
  const [bulkMetaTitleKeywords, setBulkMetaTitleKeywords] = useState(() => readGlobalSettings().productMetaTitleKeywords || "");
  const [bulkMetaDescKeywords, setBulkMetaDescKeywords] = useState(() => readGlobalSettings().productMetaDescKeywords || "");
  const [bulkSettings, setBulkSettings] = useState(() => {
    const gs = readGlobalSettings();
    return {
      ...bulkInitialSettings,
      tone: gs.tone || "professional",
      length: gs.length || "medium",
      aiProvider: gs.aiProvider || defaultAiProvider || "auto",
    };
  });
  const [bulkResult, setBulkResult] = useState(null);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [bulkValidationMessage, setBulkValidationMessage] = useState(null);
  const [bulkContentTypes, setBulkContentTypes] = useState(["description"]);
  const [selectedDescTemplateId, setSelectedDescTemplateId] = useState(
    () => PRODUCT_DESCRIPTION_TEMPLATES[0]?.id || ""
  );
  const [selectedMetaDescTemplateId, setSelectedMetaDescTemplateId] = useState(
    () => PRODUCT_META_DESCRIPTION_TEMPLATES[0]?.id || ""
  );
  const [selectedMetaTitleTemplateId, setSelectedMetaTitleTemplateId] = useState(
    () => PRODUCT_META_TITLE_TEMPLATES[0]?.id || ""
  );
  const bulkResultHandledRef = useRef(false);
  const [useCustomDescInstructions, setUseCustomDescInstructions] = useState(false);
  const [useCustomMetaDescInstructions, setUseCustomMetaDescInstructions] = useState(false);
  const [useCustomMetaTitleInstructions, setUseCustomMetaTitleInstructions] = useState(false);
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
  const [templateLibraryContentType, setTemplateLibraryContentType] = useState("description");
  const [outputLanguage, setOutputLanguage] = useState(() => readGlobalSettings().language || "English");
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showProductSearchBar, setShowProductSearchBar] = useState(false);
  const [addTitleAsHeading, setAddTitleAsHeading] = useState(false);
  const [preserveOldDescription, setPreserveOldDescription] = useState(false);
  const [removeImagesFromDescription, setRemoveImagesFromDescription] = useState(false);
  const [queueStatusById, setQueueStatusById] = useState({});
  const queueIntervalRef = useRef(null);

  useEffect(() => {
    const templateSelection = readStoredProductPromptTemplateSelection();
    if (templateSelection.metaTitlePromptTemplate) {
      setBulkMetaTitleTemplate(templateSelection.metaTitlePromptTemplate);
      setUseCustomMetaTitleInstructions(true);
    }
    if (templateSelection.metaDescriptionPromptTemplate) {
      setBulkMetaDescTemplate(templateSelection.metaDescriptionPromptTemplate);
      setUseCustomMetaDescInstructions(true);
    }
  }, []);

  useEffect(() => {
    setSearchValue(filters.search);
  }, [filters.search]);

  useEffect(() => {
    if (!filters.search || products.length > 0) {
      setFallbackProducts(products);
    }
  }, [filters.search, products]);

  const isLoading = navigation.state !== "idle";
  const isSearchLoading =
    isLoading &&
    searchValue.trim().toLowerCase() !== (filters.search || "").trim().toLowerCase();
  const normalizedSearch = searchValue.trim().toLowerCase();
  const sourceProducts = products.length > 0 ? products : fallbackProducts;

  const filteredProducts = useMemo(() => {
    if (!normalizedSearch) return products;
    return sourceProducts.filter((product) =>
      product.title.toLowerCase().includes(normalizedSearch),
    );
  }, [normalizedSearch, products, sourceProducts]);

  const visibleProductIds = useMemo(
    () => filteredProducts.map((product) => product.id),
    [filteredProducts],
  );

  useEffect(() => {
    setSelectedProductIds((current) => {
      const visibleSet = new Set(visibleProductIds);
      return current.filter((id) => visibleSet.has(id));
    });
  }, [visibleProductIds]);

  const selectedProducts = useMemo(
    () => filteredProducts.filter((product) => selectedProductIds.includes(product.id)),
    [filteredProducts, selectedProductIds],
  );
  const exceedsBulkLimit = selectedProducts.length > MAX_BULK_ITEMS;

  const makeUrl = useCallback(
    ({ status = filters.status, search = searchValue.trim(), collectionId = filters.collectionId } = {}) => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (status && status !== "all") params.set("status", status);
      if (collectionId) params.set("collectionId", collectionId);
      const query = params.toString();
      return query ? `?${query}` : "";
    },
    [filters.status, filters.collectionId, searchValue],
  );

  useEffect(() => {
    const nextSearch = searchValue.trim();
    if (nextSearch === filters.search) return;

    const timeoutId = setTimeout(() => {
      navigate(makeUrl({ search: nextSearch }), { replace: true });
    }, 180);

    return () => clearTimeout(timeoutId);
  }, [filters.search, makeUrl, navigate, searchValue]);

  const handleSearchInput = useCallback((value) => {
    setSearchValue(value || "");
  }, []);

  const handleBulkGenerate = useCallback(() => {
    if (selectedProducts.length === 0) {
      setBulkValidationMessage(MIN_BULK_PRODUCT_SELECTION_ERROR);
      return;
    }
    if (selectedProducts.length > MAX_BULK_ITEMS) {
      setBulkValidationMessage(MAX_BULK_PRODUCT_SELECTION_ERROR);
      return;
    }

    setBulkValidationMessage(null);
    setBulkResult(null);
    const initialQueueState = {};
    selectedProducts.forEach((product, index) => {
      initialQueueState[product.id] = index === 0 ? "processing" : "queued";
    });
    setQueueStatusById(initialQueueState);
    if (queueIntervalRef.current) clearInterval(queueIntervalRef.current);
    let processingIndex = 0;
    queueIntervalRef.current = setInterval(() => {
      processingIndex += 1;
      setQueueStatusById((prev) => {
        const next = { ...prev };
        if (selectedProducts[processingIndex - 1] && next[selectedProducts[processingIndex - 1].id] === "processing") {
          next[selectedProducts[processingIndex - 1].id] = "queued";
        }
        if (selectedProducts[processingIndex] && next[selectedProducts[processingIndex].id] === "queued") {
          next[selectedProducts[processingIndex].id] = "processing";
        }
        return next;
      });
    }, 1400);

    const payload = new FormData();
    payload.append("intent", BULK_GENERATE_INTENT);
    payload.append("products", JSON.stringify(
      selectedProducts.map((p) => ({
        id: p.id,
        title: p.title,
        descriptionHtml: p.descriptionHtml,
        seoTitleValue: p.seoTitleValue,
        seoDescriptionValue: p.seoDescriptionValue,
      }))
    ));
    payload.append("language", outputLanguage || "English");
    payload.append("tone", bulkSettings.tone);
    payload.append("length", bulkSettings.length);
    payload.append("format", bulkSettings.format);
    payload.append("descKeywords", bulkDescKeywords || "");
    payload.append("metaTitleKeywords", bulkMetaTitleKeywords || "");
    payload.append("metaDescKeywords", bulkMetaDescKeywords || "");
    const allKeywords = [bulkDescKeywords, bulkMetaTitleKeywords, bulkMetaDescKeywords].filter(Boolean).join(", ");
    payload.append("contextKeywords", allKeywords);
    payload.append("descriptionPromptTemplate", useCustomDescInstructions ? (bulkDescTemplate || "") : "");
    payload.append("metaTitlePromptTemplate", useCustomMetaTitleInstructions ? (bulkMetaTitleTemplate || "") : "");
    payload.append("metaDescriptionPromptTemplate", useCustomMetaDescInstructions ? (bulkMetaDescTemplate || "") : "");
    payload.append("contentTypes", JSON.stringify(bulkContentTypes));
    payload.append("aiProvider", bulkSettings.aiProvider);
    payload.append("addTitleAsHeading", addTitleAsHeading ? "1" : "");
    payload.append("preserveOldDescription", preserveOldDescription ? "1" : "");
    payload.append("removeImagesFromDescription", removeImagesFromDescription ? "1" : "");
    bulkFetcher.submit(payload, { method: "post" });
  }, [
    bulkDescKeywords,
    bulkMetaTitleKeywords,
    bulkMetaDescKeywords,
    bulkDescTemplate,
    bulkMetaDescTemplate,
    bulkMetaTitleTemplate,
    bulkContentTypes,
    bulkFetcher,
    bulkSettings,
    selectedProducts,
    outputLanguage,
    useCustomDescInstructions,
    useCustomMetaDescInstructions,
    useCustomMetaTitleInstructions,
    addTitleAsHeading,
    preserveOldDescription,
    removeImagesFromDescription,
    selectedProducts,
  ]);

  const isBulkGenerating = bulkFetcher.state !== "idle";

  useEffect(() => {
    if (bulkFetcher.state !== "idle") {
      bulkResultHandledRef.current = false;
      return;
    }

    const response = bulkFetcher.data;
    if (!response || response.intent !== BULK_GENERATE_INTENT || bulkResultHandledRef.current) return;
    bulkResultHandledRef.current = true;
    if (queueIntervalRef.current) {
      clearInterval(queueIntervalRef.current);
      queueIntervalRef.current = null;
    }
    setBulkResult(response);
    if (response.results && Array.isArray(response.results)) {
      const settledQueueState = {};
      response.results.forEach((item) => {
        settledQueueState[item.id] = item.status === "success" ? "completed" : "failed";
      });
      setQueueStatusById((prev) => ({ ...prev, ...settledQueueState }));
    }
    if (response.ok) {
      setBulkValidationMessage(null);
      revalidator.revalidate();
      const creditsMessage =
        typeof response.creditsUsed === "number"
          ? ` ${response.creditsUsed} credits used${typeof response.newCredits === "number" ? `. Remaining: ${response.newCredits}` : ""}.`
          : "";
      shopify.toast.show(`Bulk generate complete: ${response.succeeded}/${response.total} updated.${creditsMessage}`);
      navigate("/app/content-management?tab=products&filter=all");
      return;
    }
    setBulkValidationMessage(response.error || "Bulk generation failed.");
  }, [bulkFetcher.state, bulkFetcher.data, navigate, revalidator, shopify]);

  useEffect(() => () => {
    if (queueIntervalRef.current) clearInterval(queueIntervalRef.current);
  }, []);

  useEffect(() => {
    if (selectedProducts.length > MAX_BULK_ITEMS) {
      if (bulkValidationMessage !== MAX_BULK_PRODUCT_SELECTION_ERROR) {
        setBulkValidationMessage(MAX_BULK_PRODUCT_SELECTION_ERROR);
      }
      return;
    }

    if (selectedProducts.length > 0 && bulkValidationMessage === MIN_BULK_PRODUCT_SELECTION_ERROR) {
      setBulkValidationMessage(null);
      return;
    }

    if (bulkValidationMessage === MAX_BULK_PRODUCT_SELECTION_ERROR) {
      setBulkValidationMessage(null);
    }
  }, [bulkValidationMessage, selectedProducts.length]);

  const statusTabIndex = filters.status === "active" ? 1 : filters.status === "draft" ? 2 : 0;
  const statusTabs = [
    { id: "all", content: "All" },
    { id: "active", content: "Active" },
    { id: "draft", content: "Draft" },
  ];

  const handleTabChange = useCallback(
    (selectedTabIndex) => {
      const tab = statusTabs[selectedTabIndex];
      navigate(makeUrl({ status: tab.id }));
    },
    [makeUrl, navigate],
  );

  const resourceName = { singular: "product", plural: "products" };

  const headings = [
    { title: "Select" },
    { title: "Image" },
    { title: "Title" },
    { title: "App Status" },
    { title: "Generated In" },
    { title: "Meta Title" },
    { title: "Meta Description" },
    { title: "Actions" },
  ];


  const collectionOptions = [
    { label: "All Collections", value: "" },
    ...(collections || []).map((c) => ({ label: c.title, value: c.id })),
  ];

  const allVisibleSelected =
    visibleProductIds.length > 0 && selectedProductIds.length === visibleProductIds.length;
  const selectionIndeterminate =
    selectedProductIds.length > 0 && selectedProductIds.length < visibleProductIds.length;

  const handleToggleSelectAllVisible = useCallback(
    (checked) => {
      setSelectedProductIds(checked ? [...visibleProductIds] : []);
    },
    [visibleProductIds],
  );

  const handleToggleProductSelection = useCallback(
    (productId) => (checked) => {
      setSelectedProductIds((current) => {
        if (checked) {
          return current.includes(productId) ? current : [...current, productId];
        }
        return current.filter((id) => id !== productId);
      });
    },
    [],
  );

  const location = useLocation();
  const sectionMode = new URLSearchParams(location.search).get("mode");
  const sectionTabs = [
    { id: "products", content: "Products", to: { pathname: "/app/products", search: "" } },
    { id: "collections", content: "Collections", to: { pathname: "/app/collections", search: "" } },
    {
      id: "collection-products",
      content: "Collection Product",
      to: { pathname: "/app/collections", search: "?mode=collection-products" },
    },
  ];
  const activeSectionId = location.pathname?.startsWith("/app/products")
    ? "products"
    : sectionMode === "collection-products"
      ? "collection-products"
      : "collections";
  const activeSectionTabIndex = Math.max(
    0,
    sectionTabs.findIndex((tab) => tab.id === activeSectionId),
  );
  const handleSectionTabChange = useCallback(
    (selectedTabIndex) => {
      const nextTab = sectionTabs[selectedTabIndex];
      if (!nextTab?.to) return;
      navigate(nextTab.to);
    },
    [navigate, sectionTabs],
  );

  return (
    <Page fullWidth>
          {/* ── Hero Header ── */}
      <div style={{
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: "6px",
        padding: "28px 32px",
        marginBottom: "24px",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: "-50px", right: "-50px", width: "220px", height: "220px", borderRadius: "50%", background: "transparent", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "-40px", left: "25%", width: "160px", height: "160px", borderRadius: "50%", background: "transparent", pointerEvents: "none" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 1, flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "24px", fontWeight: 800, color: "#111827", marginBottom: "4px", letterSpacing: "-0.3px" }}>
              Products
            </div>
            <div style={{ fontSize: "14px", color: "#6b7280", lineHeight: 1.4, fontWeight: 600 }}>
              Generate AI-powered product descriptions, meta titles, and meta descriptions.
            </div>
          </div>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="headingSm" tone="subdued">{credits} credits.</Text>
            <Button onClick={() => navigate("/app/analytics")} variant="secondary">
              Upgrade
            </Button>
          </InlineStack>
        </div>
      </div>

      <div style={{ marginBottom: "16px" }}>
        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Choose individual products or an entire collection to generate AI-powered content
            </Text>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">- You can select multiple products (up to {MAX_BULK_ITEMS}) for bulk content generation</Text>
              <Text as="p" variant="bodySm" tone="subdued">- You can choose a single collection to generate content for all its products</Text>
            </BlockStack>
          </BlockStack>
        </Card>
      </div>

      <div
        className="app-split-layout"
        style={{
          marginTop: "0",
          display: "flex",
          gap: "16px",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {/* ── LEFT: Product List ── */}
        <div className="app-split-main" style={{ flex: "1 1 0", minWidth: "0" }}>
          {/* Products / Collections tab */}
          <div className="app-toolbar" style={{ marginBottom: "16px", maxWidth: "640px" }}>
            <Tabs
              tabs={sectionTabs}
              selected={activeSectionTabIndex}
              onSelect={handleSectionTabChange}
              fitted
            />
          </div>

          <Card padding="0">
            <BlockStack gap="0">
              <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <InlineStack align="space-between" blockAlign="center" wrap={false} gap="300">
                  <div style={{ flexShrink: 0 }}>
                    <Tabs
                      tabs={statusTabs}
                      selected={statusTabIndex}
                      onSelect={handleTabChange}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1 1 0", minWidth: 0, justifyContent: "flex-end" }}>
                    <div style={{ width: "260px", flexShrink: 0 }}>
                      <Select
                        label="Filter by Collection"
                        labelHidden
                        options={collectionOptions}
                        value={filters.collectionId || ""}
                        onChange={(val) => navigate(makeUrl({ collectionId: val }))}
                      />
                    </div>
                    {showProductSearchBar ? (
                      <>
                        <div style={{ flex: "1 1 0", minWidth: "280px" }}>
                          <TextField
                            label="Search products"
                            labelHidden
                            placeholder="Search by product title..."
                            value={searchValue}
                            onChange={handleSearchInput}
                            autoComplete="off"
                            prefix={isSearchLoading ? <Spinner size="small" /> : <Icon source={SearchIcon} tone="subdued" />}
                          />
                        </div>
                        <Button
                          icon={XIcon}
                          variant="secondary"
                          accessibilityLabel="Close search"
                          onClick={() => setShowProductSearchBar(false)}
                        />
                      </>
                    ) : (
                      <Button
                        icon={SearchIcon}
                        variant="secondary"
                        accessibilityLabel="Show search"
                        onClick={() => setShowProductSearchBar(true)}
                      />
                    )}
                  </div>
                </InlineStack>
              </div>

              {isSearchLoading ? (
                <Box padding="400">
                  <InlineStack align="center">
                    <Spinner size="small" />
                  </InlineStack>
                </Box>
              ) : filteredProducts.length === 0 ? (
                <EmptyState heading="No products found" image="">
                  <Text as="p" tone="subdued">Try adjusting your search or filter.</Text>
                </EmptyState>
              ) : (
                <div className="products-table-wrap app-table-scroll">
                  <IndexTable
                  resourceName={resourceName}
                  itemCount={filteredProducts.length}
                  headings={[
                    {
                      title: (
                        <Checkbox
                          label="Select all visible products"
                          labelHidden
                          checked={allVisibleSelected}
                          indeterminate={selectionIndeterminate}
                          onChange={handleToggleSelectAllVisible}
                        />
                      ),
                    },
                    { title: "Title" },
                    { title: "Short" },
                    { title: "Status" },
                  ]}
                  selectable={false}
                >
                  {filteredProducts.map((product, index) => (
                    <IndexTable.Row id={product.id} key={product.id} position={index}>
                      <IndexTable.Cell>
                        <Checkbox
                          label={`Select ${product.title}`}
                          labelHidden
                          checked={selectedProductIds.includes(product.id)}
                          onChange={handleToggleProductSelection(product.id)}
                        />
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <div
                          style={{
                            maxWidth: "240px",
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          <Text variant="bodyMd" fontWeight="medium" as="span">{product.title}</Text>
                        </div>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{renderBadge(product.descriptionStatus)}</IndexTable.Cell>
                      <IndexTable.Cell>
                        {isBulkGenerating && selectedProductIds.includes(product.id) ? (
                          <InlineStack gap="100" blockAlign="center">
                            <Spinner size="small" />
                            <Text as="span" tone="subdued">Generating...</Text>
                          </InlineStack>
                        ) : (
                          <Badge tone={toBadgeTone(product.status.tone)}>{product.status.label}</Badge>
                        )}
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                  </IndexTable>
                </div>
              )}

              <div style={{ padding: "8px 16px", borderTop: "1px solid var(--p-color-border)" }}>
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <Text as="span" tone="subdued" variant="bodySm">
                    {filteredProducts.length} results{" "}
                    {isLoading && !isSearchLoading ? "(Loading...)" : ""}
                  </Text>
                </InlineStack>
              </div>
            </BlockStack>
          </Card>
        </div>

        {/* ── RIGHT: Bulk Settings Panel ── */}
        <div className="app-split-side" style={{ flex: "1 1 0", width: "420px", maxWidth: "100%" }}>
          <Card padding="0">
            {/* Header */}
            <div style={{ padding: "16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd" fontWeight="bold">Product Bulk Order Settings</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {[
                    bulkContentTypes.includes("description") ? "Descriptions" : null,
                    bulkContentTypes.includes("meta_description") ? "Meta Descriptions" : null,
                    bulkContentTypes.includes("meta_title") ? "Meta Titles" : null,
                  ].filter(Boolean).join(", ")} will be generated for {selectedProducts.length} product{selectedProducts.length !== 1 ? "s" : ""}
                </Text>
              </BlockStack>
            </div>

            {/* Content Type Pills */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                {[
                  { id: "description", label: "Description" },
                  { id: "meta_description", label: "Meta Description" },
                  { id: "meta_title", label: "Meta Title" },
                ].map((type) => {
                  const isSelected = bulkContentTypes.includes(type.id);
                  return (
                    <button
                      key={type.id}
                      onClick={() => {
                        setBulkContentTypes((prev) =>
                          prev.includes(type.id)
                            ? prev.length > 1 ? prev.filter((t) => t !== type.id) : prev
                            : [...prev, type.id]
                        );
                      }}
                      style={{
                        padding: "5px 14px",
                        borderRadius: "20px",
                        border: isSelected ? "2px solid #1a1a1a" : "1px solid #d1d5db",
                        background: isSelected ? "#1a1a1a" : "#fff",
                        color: isSelected ? "#fff" : "#374151",
                        cursor: "pointer",
                        fontSize: "13px",
                        fontWeight: isSelected ? 600 : 400,
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                      }}
                    >
                      {isSelected && <span style={{ fontSize: "11px" }}>✓</span>}
                      {type.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Output Language */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <Select
                label="Output Language"
                options={LANGUAGE_OPTIONS}
                value={outputLanguage}
                onChange={setOutputLanguage}
              />
            </div>

            {/* Description Section */}
            {bulkContentTypes.includes("description") && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <Text as="h3" variant="headingSm" fontWeight="semibold">Description</Text>
                <div style={{ marginTop: "10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Checkbox
                    label={<span>Use custom instructions <span style={{ color: "#f59e0b", fontSize: "14px" }}>✦</span></span>}
                    checked={useCustomDescInstructions}
                    onChange={(v) => {
                      setUseCustomDescInstructions(v);
                      if (v) setBulkDescTemplate(DEFAULT_DESCRIPTION_CUSTOM_PROMPT);
                    }}
                  />
                  {!useCustomDescInstructions && (
                    <button
                      onClick={() => { setTemplateLibraryContentType("description"); setTemplateLibraryOpen(true); }}
                      style={{ padding: "6px 14px", background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                    >
                      Browse Templates
                    </button>
                  )}
                </div>
                {useCustomDescInstructions && (
                  <div style={{ marginTop: "8px" }}>
                    <Text as="p" variant="bodySm" fontWeight="semibold">Custom Prompt</Text>
                    <div style={{ marginTop: "4px" }}>
                      <TextField
                        label="Custom Prompt" labelHidden
                        multiline={8}
                        autoSize={false}
                        maxHeight={240}
                        minLength={0}
                        value={bulkDescTemplate}
                        onChange={setBulkDescTemplate}
                        autoComplete="off"
                        placeholder="Enter custom instructions for description generation..."
                      />
                    </div>
                    <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => { setTemplateLibraryContentType("description"); setTemplateLibraryOpen(true); }}
                        style={{ padding: "6px 14px", background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                      >
                        Browse Templates
                      </button>
                      <button
                        onClick={() => { setBulkDescTemplate(DEFAULT_DESCRIPTION_CUSTOM_PROMPT); setUseCustomDescInstructions(true); }}
                        style={{ padding: "6px 14px", background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                      >
                        Reset to Default
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Meta Description Section */}
            {bulkContentTypes.includes("meta_description") && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <Text as="h3" variant="headingSm" fontWeight="semibold">Meta Description</Text>
                <div style={{ marginTop: "10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Checkbox
                    label={<span>Use custom instructions <span style={{ color: "#f59e0b", fontSize: "14px" }}>✦</span></span>}
                    checked={useCustomMetaDescInstructions}
                    onChange={(v) => {
                      setUseCustomMetaDescInstructions(v);
                      if (v) setBulkMetaDescTemplate(DEFAULT_META_DESCRIPTION_CUSTOM_PROMPT);
                    }}
                  />
                  {!useCustomMetaDescInstructions && (
                    <button
                      onClick={() => { setTemplateLibraryContentType("meta_description"); setTemplateLibraryOpen(true); }}
                      style={{ padding: "6px 14px", background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                    >
                      Browse Templates
                    </button>
                  )}
                </div>
                {useCustomMetaDescInstructions && (
                  <div style={{ marginTop: "8px" }}>
                    <Text as="p" variant="bodySm" fontWeight="semibold">Custom Prompt</Text>
                    <div style={{ marginTop: "4px" }}>
                      <TextField
                        label="Custom Prompt" labelHidden
                        multiline={8}
                        autoSize={false}
                        maxHeight={240}
                        minLength={0}
                        value={bulkMetaDescTemplate}
                        onChange={setBulkMetaDescTemplate}
                        autoComplete="off"
                        placeholder="Enter custom instructions for meta description generation..."
                      />
                    </div>
                    <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => { setTemplateLibraryContentType("meta_description"); setTemplateLibraryOpen(true); }}
                        style={{ padding: "6px 14px", background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                      >
                        Browse Templates
                      </button>
                      <button
                        onClick={() => { setBulkMetaDescTemplate(DEFAULT_META_DESCRIPTION_CUSTOM_PROMPT); setUseCustomMetaDescInstructions(true); }}
                        style={{ padding: "6px 14px", background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                      >
                        Reset to Default
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Meta Title Section */}
            {bulkContentTypes.includes("meta_title") && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <Text as="h3" variant="headingSm" fontWeight="semibold">Meta Title</Text>
                <div style={{ marginTop: "10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Checkbox
                    label={<span>Use custom instructions <span style={{ color: "#f59e0b", fontSize: "14px" }}>✦</span></span>}
                    checked={useCustomMetaTitleInstructions}
                    onChange={(v) => {
                      setUseCustomMetaTitleInstructions(v);
                      if (v) setBulkMetaTitleTemplate(DEFAULT_META_TITLE_CUSTOM_PROMPT);
                    }}
                  />
                  {!useCustomMetaTitleInstructions && (
                    <button
                      onClick={() => { setTemplateLibraryContentType("meta_title"); setTemplateLibraryOpen(true); }}
                      style={{ padding: "6px 14px", background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                    >
                      Browse Templates
                    </button>
                  )}
                </div>
                {useCustomMetaTitleInstructions && (
                  <div style={{ marginTop: "8px" }}>
                    <Text as="p" variant="bodySm" fontWeight="semibold">Custom Prompt</Text>
                    <div style={{ marginTop: "4px" }}>
                      <TextField
                        label="Custom Prompt" labelHidden
                        multiline={8}
                        autoSize={false}
                        maxHeight={240}
                        minLength={0}
                        value={bulkMetaTitleTemplate}
                        onChange={setBulkMetaTitleTemplate}
                        autoComplete="off"
                        placeholder="Enter custom instructions for meta title generation..."
                      />
                    </div>
                    <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => { setTemplateLibraryContentType("meta_title"); setTemplateLibraryOpen(true); }}
                        style={{ padding: "6px 14px", background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                      >
                        Browse Templates
                      </button>
                      <button
                        onClick={() => { setBulkMetaTitleTemplate(DEFAULT_META_TITLE_CUSTOM_PROMPT); setUseCustomMetaTitleInstructions(true); }}
                        style={{ padding: "6px 14px", background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                      >
                        Reset to Default
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Show Advanced Settings */}
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <button
                onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "13px", fontWeight: 500, color: "#374151", display: "flex", alignItems: "center", gap: "6px", padding: 0 }}
              >
                <Icon source={showAdvancedSettings ? ChevronUpIcon : ChevronDownIcon} tone="subdued" />
                {showAdvancedSettings ? "Hide" : "Show"} Advanced Settings
              </button>
              {showAdvancedSettings && (
                <div style={{ marginTop: "12px" }}>
                  <BlockStack gap="300">
                    {bulkContentTypes.includes("meta_description") && (
                      <TextField
                        label="Meta Description Keywords"
                        value={bulkMetaDescKeywords}
                        onChange={setBulkMetaDescKeywords}
                        placeholder="e.g. fast shipping, handmade"
                        helpText="Keywords specific to meta descriptions"
                        autoComplete="off"
                      />
                    )}
                    {bulkContentTypes.includes("meta_title") && (
                      <TextField
                        label="Meta Title Keywords"
                        value={bulkMetaTitleKeywords}
                        onChange={setBulkMetaTitleKeywords}
                        placeholder="e.g. buy, shop, best"
                        helpText="Keywords specific to meta titles"
                        autoComplete="off"
                      />
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: "14px", paddingTop: "4px" }}>
                      <div>
                        <Checkbox
                          label={<span style={{ fontWeight: 600, fontSize: "13px" }}>Add Product Title as heading tag in the description</span>}
                          checked={addTitleAsHeading}
                          onChange={(v) => setAddTitleAsHeading(v)}
                        />
                        <p style={{ margin: "4px 0 0 24px", fontSize: "12px", color: "#6b7280", lineHeight: "1.45" }}>
                          This will add your Product Title as the main heading in the description.
                        </p>
                      </div>
                      <div>
                        <Checkbox
                          label={<span style={{ fontWeight: 600, fontSize: "13px" }}>Preserve old description and add new AI Generated content to the start of it</span>}
                          checked={preserveOldDescription}
                          onChange={(v) => setPreserveOldDescription(v)}
                        />
                        <p style={{ margin: "4px 0 0 24px", fontSize: "12px", color: "#6b7280", lineHeight: "1.45" }}>
                          This will keep your existing description and add the AI-generated content to the start of it.
                        </p>
                      </div>
                      <div>
                        <Checkbox
                          label={<span style={{ fontWeight: 600, fontSize: "13px" }}>Remove images from Product Description <span style={{ color: "#6b7280", fontWeight: 400 }}>(Recommended)</span></span>}
                          checked={removeImagesFromDescription}
                          onChange={(v) => setRemoveImagesFromDescription(v)}
                        />
                        <p style={{ margin: "4px 0 0 24px", fontSize: "12px", color: "#6b7280", lineHeight: "1.45" }}>
                          This will remove all images from your product descriptions to ensure clean text content.
                        </p>
                      </div>
                    </div>
                  </BlockStack>
                </div>
              )}
            </div>


            {/* Bulk result badge */}
            {bulkResult && (
              <div style={{ padding: "8px 16px" }}>
                <Badge tone={bulkResult.failed > 0 ? "warning" : "success"}>
                  {bulkResult.succeeded}/{bulkResult.total} updated
                  {bulkResult.failed > 0 ? ` · ${bulkResult.failed} failed` : ""}
                </Badge>
              </div>
            )}

            <div style={{ padding: "8px 16px", borderTop: "1px solid var(--p-color-border)" }}>
              <Text as="p" variant="bodySm" tone="subdued">
                Estimated credits: {selectedProducts.length * bulkContentTypes.length} ({selectedProducts.length} products × {bulkContentTypes.length} types)
              </Text>
            </div>

            {selectedProducts.length > 0 && (
              <div style={{ padding: "8px 16px", borderTop: "1px solid var(--p-color-border)" }}>
                <BlockStack gap="100">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="p" variant="bodySm" fontWeight="semibold">Queue Progress</Text>
                    {isBulkGenerating && <Spinner size="small" />}
                  </InlineStack>
                  {selectedProducts.slice(0, 10).map((product) => {
                    const status = queueStatusById[product.id] || "queued";
                    const tone = status === "completed" ? "success" : status === "failed" ? "critical" : status === "processing" ? "attention" : "info";
                    const label = status === "processing" ? "Processing" : status === "completed" ? "Completed" : status === "failed" ? "Failed" : "Queued";
                    return (
                      <InlineStack key={product.id} align="space-between" blockAlign="center">
                        <Text as="span" variant="bodySm" tone="subdued">{product.title}</Text>
                        <Badge tone={tone}>{label}</Badge>
                      </InlineStack>
                    );
                  })}
                </BlockStack>
              </div>
            )}

            {/* Validation error */}
            {bulkValidationMessage && (
              <div style={{ padding: "8px 16px" }}>
                <Banner tone="critical"><p>{bulkValidationMessage}</p></Banner>
              </div>
            )}

            {/* Generate Button */}
            <div style={{ padding: "12px 16px" }}>
              <Button
                fullWidth
                variant="primary"
                onClick={handleBulkGenerate}
                disabled={isBulkGenerating || selectedProducts.length === 0 || exceedsBulkLimit}
                loading={isBulkGenerating}
                tone="success"
              >
                {`Generate ${selectedProducts.length} items (${selectedProducts.length} products × ${bulkContentTypes.length} types)`}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* ── Generation Results Table ── */}
      {bulkResult && bulkResult.results && bulkResult.results.length > 0 && (
        <div style={{ marginTop: "24px" }}>
          <Card padding="0">
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd" fontWeight="bold">Generation Results</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {bulkResult.succeeded} product{bulkResult.succeeded !== 1 ? "s" : ""} updated · {bulkResult.failed > 0 ? `${bulkResult.failed} failed · ` : ""}{bulkResult.creditsUsed ?? 0} AI credits used
                  </Text>
                </BlockStack>
                <Badge tone={bulkResult.failed > 0 ? "warning" : "success"}>
                  {bulkResult.succeeded}/{bulkResult.total} succeeded
                </Badge>
              </InlineStack>
            </div>
            <div className="app-table-scroll">
              <IndexTable
                resourceName={{ singular: "product", plural: "products" }}
              itemCount={bulkResult.results.length}
              selectable={false}
              headings={[
                { title: "Title" },
                { title: "Status" },
                { title: "Meta Title" },
                { title: "Meta Description" },
              ]}
            >
              {bulkResult.results.map((r, index) => (
                <IndexTable.Row id={r.id} key={r.id} position={index}>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="semibold" as="span">{r.title}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {r.status === "success"
                      ? <Badge tone="success">Updated</Badge>
                      : <Badge tone="critical" title={r.error || ""}>Failed</Badge>}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm" tone={r.seoTitle ? undefined : "subdued"}>
                      {r.seoTitle ? r.seoTitle.slice(0, 55) + (r.seoTitle.length > 55 ? "…" : "") : "—"}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm" tone={r.seoDescription ? undefined : "subdued"}>
                      {r.seoDescription ? r.seoDescription.slice(0, 90) + (r.seoDescription.length > 90 ? "…" : "") : "—"}
                    </Text>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
              </IndexTable>
            </div>
          </Card>
        </div>
      )}

      <style>{`
        .products-table-wrap {
          max-height: 62vh;
          overflow-y: auto;
          overflow-x: hidden;
        }
        .app-table-scroll {
          max-height: 62vh;
          overflow: auto;
        }
        .products-table-wrap .Polaris-IndexTable__ScrollContainer {
          overflow-x: hidden;
        }
        .products-table-wrap .Polaris-IndexTable__StickyTable {
          display: none !important;
        }
        .products-table-wrap .Polaris-IndexTable__Table {
          width: 100%;
          table-layout: fixed;
        }
        .products-table-wrap .Polaris-IndexTable__Table th:first-child,
        .products-table-wrap .Polaris-IndexTable__Table td:first-child {
          width: 46px;
          padding-right: 4px;
        }
        .products-table-wrap .Polaris-IndexTable__Table th:nth-child(2),
        .products-table-wrap .Polaris-IndexTable__Table td:nth-child(2) {
          padding-left: 4px;
        }
      `}</style>

      <TemplateLibraryModal
        key={templateLibraryContentType}
        open={templateLibraryOpen}
        onClose={() => setTemplateLibraryOpen(false)}
        tabs={[
          { id: "description", label: "Description" },
          { id: "meta_title", label: "Meta Title" },
          { id: "meta_description", label: "Meta Description" },
        ]}
        initialTab={templateLibraryContentType}
        templatesByTab={{
          description: PRODUCT_DESCRIPTION_TEMPLATES,
          meta_description: PRODUCT_META_DESCRIPTION_TEMPLATES,
          meta_title: PRODUCT_META_TITLE_TEMPLATES,
        }}
        onUseTemplate={(templateText) => {
          if (templateLibraryContentType === "description") {
            setBulkDescTemplate(templateText);
            setUseCustomDescInstructions(true);
          } else if (templateLibraryContentType === "meta_description") {
            setBulkMetaDescTemplate(templateText);
            setUseCustomMetaDescInstructions(true);
          } else if (templateLibraryContentType === "meta_title") {
            setBulkMetaTitleTemplate(templateText);
            setUseCustomMetaTitleInstructions(true);
          }
        }}
      />
    </Page>
  );
}





