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
  Tag,
  Text,
  TextField,
} from "@shopify/polaris";
import { ProductIcon, CollectionIcon, SearchIcon, ChevronUpIcon, ChevronDownIcon, XIcon } from "@shopify/polaris-icons";
import { openAddCreditModal } from "../components/AddCreditModal";
import db from "../db.server";
import { inngest } from "../inngest/client";
import { authenticate } from "../shopify.server";
import { buildProductContentPrompt, getProductSystemPrompt } from "../lib/contentPromptTemplates";
import { TemplateLibraryModal } from "../components/TemplateLibraryModal";
import { getExactWordLengthOption, normalizeStoredGlobalSettings, readGlobalSettings } from "../lib/globalSettings";
import {
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
const FETCH_BATCH_SIZE = 250;
const MAX_FETCH_PAGES = 40; // cap at 10,000 products to prevent loader timeouts
const STATUS_FILTERS = ["all", "active", "draft"];
const BULK_GENERATE_INTENT = "bulk_generate";
const MAX_BULK_ITEMS = 1000;
const MIN_BULK_PRODUCT_SELECTION_ERROR = "Select at least one product for bulk generation.";
const MAX_BULK_PRODUCT_SELECTION_ERROR = `You can bulk generate up to ${MAX_BULK_ITEMS} products at a time.`;
const PRODUCT_CONTENT_TYPES = ["description", "meta_title", "meta_description", "faq"];
const DEFAULT_PRODUCT_CONTENT_TYPES = ["description", "meta_title", "meta_description"];
const PRODUCT_CONTENT_TYPE_CREDIT_COSTS = {
  description: 1,
  meta_title: 1,
  meta_description: 1,
  faq: 5,
};
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
  "English", "Arabic", "Bengali", "Bulgarian",
  "Chinese", "Chinese (Simplified)", "Chinese (Traditional)", "Croatian", "Czech",
  "Danish", "Dutch", "Finnish", "French", "German", "Greek", "Hebrew", "Hindi",
  "Hungarian", "Indonesian", "Italian", "Japanese", "Korean", "Malay", "Norwegian",
  "Polish", "Portuguese", "Romanian", "Russian", "Spanish", "Swedish", "Tamil",
  "Telugu", "Thai", "Turkish", "Ukrainian", "Urdu", "Vietnamese",
].map((l) => ({ label: l, value: l }));

function parseShopGlobalSettings(shopData) {
  try {
    return normalizeStoredGlobalSettings(JSON.parse(shopData?.globalSettingsJson || "{}"));
  } catch {
    return normalizeStoredGlobalSettings();
  }
}

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
          vendor
          productType
          status
          descriptionHtml
          seo {
            title
            description
          }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          variants(first: 1) { edges { node { price } } }
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

function toCollectionProductSearchQuery({ collectionId, search, status }) {
  const collectionLegacyId = String(collectionId || "").split("/").pop();
  const filters = [];
  if (collectionLegacyId) filters.push(`collection_id:${collectionLegacyId}`);
  const resourceQuery = toSearchQuery({ search, status });
  if (resourceQuery) filters.push(resourceQuery);
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

function clientCreditsForContentTypes(contentTypes) {
  return (contentTypes || []).reduce(
    (sum, type) => sum + (PRODUCT_CONTENT_TYPE_CREDIT_COSTS[type] ?? 1),
    0,
  );
}

function clientCreditsForBatch(contentTypes, itemsCount) {
  if (!itemsCount || itemsCount < 1) return 0;
  return clientCreditsForContentTypes(contentTypes) * itemsCount;
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

function splitKeywordString(value) {
  return String(value || "")
    .split(",")
    .map((keyword) => normalizeKeyword(keyword))
    .filter(Boolean);
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

function normalizeHeadingText(value) {
  return stripHtml(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function withSingleTitleHeading(html, title) {
  const normalizedTitle = normalizeHeadingText(title);
  if (!normalizedTitle) return html || "";

  const bodyWithoutDuplicateTitleHeadings = (html || "")
    .replace(/^\s*<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>\s*/i, "")
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (match, headingText) =>
      normalizeHeadingText(headingText) === normalizedTitle ? "" : match,
    )
    .trim();

  return `<h2>${escapeHtml(title)}</h2>${bodyWithoutDuplicateTitleHeadings}`;
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

  const startMs = Date.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: (process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001").trim(),
      max_tokens: 2500,
      system: getProductSystemPrompt(),
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

  const generationMs = Date.now() - startMs;
  const inputTokens = payload?.usage?.input_tokens || 0;
  const outputTokens = payload?.usage?.output_tokens || 0;
  const rawContent = payload?.content?.[0]?.text;
  return parseGenerationContent(rawContent, payload?.model || (process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001").trim(), { aiProvider: "anthropic", inputTokens, outputTokens, generationMs });
}

async function generateContentWithGemini(input, apiKey) {
  if (!apiKey) {
    throw new Error("Gemini API key is not configured. Set GOOGLE_GEMINI_API_KEY in your environment.");
  }
  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash-lite").trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const startMs = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: getProductSystemPrompt() }],
      },
      contents: [{ role: "user", parts: [{ text: buildGenerationPrompt(input) }] }],
      generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
    }),
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Gemini request failed with status ${response.status}.`);
  }
  const generationMs = Date.now() - startMs;
  const rawContent = payload?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  const inputTokens = payload?.usageMetadata?.promptTokenCount || 0;
  const outputTokens = payload?.usageMetadata?.candidatesTokenCount || 0;
  return parseGenerationContent(rawContent, model, { aiProvider: "gemini", inputTokens, outputTokens, generationMs });
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
        content: getProductSystemPrompt(),
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

  const startMs = Date.now();
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

  const generationMs = Date.now() - startMs;
  const inputTokens = result.payload?.usage?.prompt_tokens || 0;
  const outputTokens = result.payload?.usage?.completion_tokens || 0;
  const rawContent = result.payload?.choices?.[0]?.message?.content;
  return parseGenerationContent(rawContent, result.payload?.model || result.model, { aiProvider: "openai", inputTokens, outputTokens, generationMs });
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

function parseGenerationContent(rawContent, modelName, meta = {}) {
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
    aiProvider: meta.aiProvider || null,
    inputTokens: meta.inputTokens || 0,
    outputTokens: meta.outputTokens || 0,
    generationMs: meta.generationMs || 0,
  };
}

async function generateContentWithOllama(input) {
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;

  const startMs = Date.now();
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
            content: getProductSystemPrompt(),
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

  const generationMs = Date.now() - startMs;
  const inputTokens = payload?.prompt_eval_count || 0;
  const outputTokens = payload?.eval_count || 0;
  return parseGenerationContent(payload?.message?.content, payload?.model || model, { aiProvider: "ollama", inputTokens, outputTokens, generationMs });
}

async function generateContent(input, { aiProvider = "auto", shopOpenaiKey = null, shopAnthropicKey = null, shopGeminiKey = null } = {}) {
  const openaiKey = shopOpenaiKey || process.env.OPENAI_API_KEY;
  const anthropicKey = shopAnthropicKey || process.env.ANTHROPIC_API_KEY;
  const geminiKey = shopGeminiKey || process.env.GOOGLE_GEMINI_API_KEY;

  // User explicitly chose Gemini
  if (aiProvider === "gemini") {
    return await generateContentWithGemini(input, geminiKey);
  }

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
  const defaultProvider = (process.env.DEFAULT_AI_PROVIDER || "openai").trim().toLowerCase();
  const fallbackProvider = (process.env.FALLBACK_AI_PROVIDER || "").trim().toLowerCase();
  const providerChain = fallbackProvider && fallbackProvider !== defaultProvider
    ? [defaultProvider, fallbackProvider]
    : [defaultProvider];

  let lastError = null;
  for (const p of providerChain) {
    try {
      if (p === "gemini") return await generateContentWithGemini(input, geminiKey);
      if (p === "anthropic") return await generateContentWithAnthropic(input, anthropicKey);
      if (p === "ollama") return await generateContentWithOllama(input);
      return await generateContentWithOpenAI(input, openaiKey); // default / "openai"
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = readFormString(formData, "intent");

  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: {
      openaiApiKey: true,
      anthropicApiKey: true,
      geminiApiKey: true,
      credits: true,
      creditsUsedTotal: true,
      globalSettingsJson: true,
    },
  });
  const globalSettings = parseShopGlobalSettings(shopData);

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
      const collectionId = readFormString(formData, "collectionId") || "";
      const language = readFormString(formData, "language") || "English";
      const tone = readFormString(formData, "tone") || "Neutral";
      const lengthOption = getExactWordLengthOption(globalSettings, "productDescWords");
      const formatOption = readFormString(formData, "format") || "Single paragraph";
      const contextKeywords = readFormString(formData, "contextKeywords");
      const descriptionPromptTemplate = readFormString(formData, "descriptionPromptTemplate");
      const metaTitlePromptTemplate = readFormString(formData, "metaTitlePromptTemplate");
      const metaDescriptionPromptTemplate = readFormString(formData, "metaDescriptionPromptTemplate");
      const useCustomDescInstructions = readFormString(formData, "useCustomDescInstructions") === "1";
      const useCustomMetaTitleInstructions = readFormString(formData, "useCustomMetaTitleInstructions") === "1";
      const useCustomMetaDescInstructions = readFormString(formData, "useCustomMetaDescInstructions") === "1";
      const aiProvider = readFormString(formData, "aiProvider") || "auto";
      const addTitleAsHeadingFlag = !!readFormString(formData, "addTitleAsHeading");
      const preserveOldDescriptionFlag = !!readFormString(formData, "preserveOldDescription");
      const removeImagesFlag = !!readFormString(formData, "removeImagesFromDescription");
      const selectedContentTypes = parseSelectedContentTypes(
        formData.get("contentTypes"),
        PRODUCT_CONTENT_TYPES,
        DEFAULT_PRODUCT_CONTENT_TYPES,
      );
      if (selectedContentTypes.includes("description") && !descriptionPromptTemplate.trim()) {
        return { ok: false, intent, error: "Description template/custom instructions are required." };
      }
      if (selectedContentTypes.includes("description") && !useCustomDescInstructions) {
        return { ok: false, intent, error: "Enable 'Use custom instructions' for Description." };
      }
      if (selectedContentTypes.includes("meta_title") && !metaTitlePromptTemplate.trim()) {
        return { ok: false, intent, error: "Meta title template/custom instructions are required." };
      }
      if (selectedContentTypes.includes("meta_title") && !useCustomMetaTitleInstructions) {
        return { ok: false, intent, error: "Enable 'Use custom instructions' for Meta title." };
      }
      if (selectedContentTypes.includes("meta_description") && !metaDescriptionPromptTemplate.trim()) {
        return { ok: false, intent, error: "Meta description template/custom instructions are required." };
      }
      if (selectedContentTypes.includes("meta_description") && !useCustomMetaDescInstructions) {
        return { ok: false, intent, error: "Enable 'Use custom instructions' for Meta description." };
      }
      const shouldUpdateDescription = selectedContentTypes.includes("description");
      const shouldUpdateMetaTitle = selectedContentTypes.includes("meta_title");
      const shouldUpdateMetaDescription = selectedContentTypes.includes("meta_description");
      const creditsPerItem = creditsForContentTypes(selectedContentTypes);
      const availableCredits = shopData?.credits ?? 150;
      const requiredCredits = creditsForBatch(selectedContentTypes, bulkProducts.length);

      if (availableCredits < requiredCredits) {
        return {
          ok: false,
          intent,
          error: buildInsufficientCreditsError(requiredCredits, availableCredits),
        };
      }

      let reservedCredits = availableCredits;
      let reservedCreditsUsedTotal = shopData?.creditsUsedTotal ?? 0;
      if (requiredCredits > 0) {
        const creditSnapshot = await deductCredits({ shopDomain: session.shop, creditsUsed: requiredCredits });
        reservedCredits = creditSnapshot.credits;
        reservedCreditsUsedTotal = creditSnapshot.creditsUsedTotal;
      }

      const jobSettings = {
        language,
        tone,
        lengthOption,
        format: formatOption,
        contextKeywords: contextKeywords || "",
        descriptionPromptTemplate: descriptionPromptTemplate || "",
        metaTitlePromptTemplate: metaTitlePromptTemplate || "",
        metaDescriptionPromptTemplate: metaDescriptionPromptTemplate || "",
        contentTypes: selectedContentTypes,
        creditsPerItem,
        aiProvider,
        addTitleAsHeading: addTitleAsHeadingFlag,
        preserveOldDescription: preserveOldDescriptionFlag,
        removeImages: removeImagesFlag,
        collectionId: collectionId || "",
      };

      const jobItems = bulkProducts.map((p) => ({
        id: p.id,
        title: p.title,
        handle: p.handle || "",
        vendor: p.vendor || "",
        productType: p.productType || "",
        status: p.status || "ACTIVE",
        descriptionHtml: p.descriptionHtml || "",
        seoTitle: p.seoTitleValue || "",
        seoDescription: p.seoDescriptionValue || "",
        priceRangeV2: p.priceRangeV2 || null,
        variants: p.variants || null,
      }));

      const job = await db.bulkJob.create({
        data: {
          shop: session.shop,
          jobType: "product",
          status: "pending",
          totalItems: bulkProducts.length,
          contentTypes: JSON.stringify(selectedContentTypes),
          settings: JSON.stringify(jobSettings),
          itemsData: JSON.stringify(jobItems),
          creditsAllocated: requiredCredits,
        },
      });

      await inngest.send({
        name: "content/bulk.generate",
        data: {
          jobId: job.id,
          shop: session.shop,
          jobType: "product",
          items: jobItems,
          settings: jobSettings,
        },
      });

      return {
        ok: true,
        intent,
        queued: true,
        jobId: job.id,
        total: bulkProducts.length,
        newCredits: reservedCredits,
        creditsUsedTotal: reservedCreditsUsedTotal,
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
      geminiApiKey: true,
      defaultAiProvider: true,
      credits: true,
      creditsUsedTotal: true,
      globalSettingsJson: true,
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
  let parsedGlobalSettings = {};
  try { parsedGlobalSettings = JSON.parse(shopData?.globalSettingsJson || "{}"); } catch { /* ignore */ }

  // Fetch collections for the filter dropdown (runs in parallel with products)
  const collectionsPromise = admin.graphql(COLLECTIONS_QUERY).then((r) => r.json());
  const productNodes = [];

  if (collectionId) {
    const query = toCollectionProductSearchQuery({ collectionId, search: searchForQuery, status });
    let afterCursor;
    let page = 0;
    while (page < MAX_FETCH_PAGES) {
      page++;
      const colRes = await admin.graphql(PRODUCT_LIST_QUERY, {
        variables: {
          first: FETCH_BATCH_SIZE,
          after: afterCursor,
          query: query || undefined,
        },
      });
      const colJson = await colRes.json();
      const productConnection = colJson?.data?.products;
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
    let page = 0;
    while (page < MAX_FETCH_PAGES) {
      page++;
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
      hasGeminiKey: !!(shopData?.geminiApiKey || process.env.GOOGLE_GEMINI_API_KEY),
      defaultAiProvider: shopData?.defaultAiProvider || "auto",
      credits: shopData?.credits ?? 150,
      creditsUsedTotal: shopData?.creditsUsedTotal ?? 0,
      shopOwnerName,
      keywordLibrary: splitKeywordString(parsedGlobalSettings.productDescKeywords),
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
      vendor: node.vendor || "",
      productType: node.productType || "",
      priceRangeV2: node.priceRangeV2 || null,
      variants: node.variants || null,
      descriptionHtml: node.descriptionHtml || "",
      descriptionText: stripHtml(node.descriptionHtml),
      descriptionStatus: evaluateDescription(stripHtml(node.descriptionHtml)),
      status: toStatusMeta(node.status),
      statusValue: node.status,
      appStatus: toAppGenerationStatusMeta(generatedContent),
      generatedTime: formatRelativeGenerationTime(generatedContent?.updatedAt),
      seoTitle: evaluateSeoTitle(node.seo?.title || node.title),
      seoDescription: evaluateSeoDescription(node.seo?.description),
      seoTitleValue: node.seo?.title || "",
      seoDescriptionValue: node.seo?.description || "",
    };
  });

  const keywordLibrary = splitKeywordString(parsedGlobalSettings.productDescKeywords);

  return {
    filters: { search, status, collectionId },
    collections,
    products,
    keywordLibrary,
    hasOpenaiKey: !!(shopData?.openaiApiKey || process.env.OPENAI_API_KEY),
    hasAnthropicKey: !!(shopData?.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
    hasGeminiKey: !!(shopData?.geminiApiKey || process.env.GOOGLE_GEMINI_API_KEY),
    defaultAiProvider: shopData?.defaultAiProvider || "auto",
    credits: shopData?.credits ?? 150,
    creditsUsedTotal: shopData?.creditsUsedTotal ?? 0,
    shopOwnerName,
    shop: session.shop,
    appApiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

const bulkInitialSettings = {
  language: "English",
  tone: "Neutral",
  length: "50 - 150 words",
  format: "Single paragraph",
  aiProvider: "auto",
};

const PRODUCT_BULK_SESSION_KEY = "product-ai-generate:products-bulk-state";

function readBulkSessionState(key) {
  if (typeof window === "undefined") return {};
  window.__productAiGenerateBulkState = window.__productAiGenerateBulkState || {};
  return window.__productAiGenerateBulkState[key] || {};
}

function writeBulkSessionState(key, value) {
  if (typeof window === "undefined") return;
  window.__productAiGenerateBulkState = window.__productAiGenerateBulkState || {};
  window.__productAiGenerateBulkState[key] = value;
}

function readArrayState(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

export default function ProductsPage() {
  const { filters, products, collections, keywordLibrary = [], defaultAiProvider, credits, shopOwnerName, shop, appApiKey } = useLoaderData();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const revalidator = useRevalidator();
  const bulkFetcher = useFetcher();
  const shopify = useAppBridge();
  const initialBulkSessionStateRef = useRef(readBulkSessionState(PRODUCT_BULK_SESSION_KEY));
  const initialBulkSessionState = initialBulkSessionStateRef.current;
  const [searchValue, setSearchValue] = useState(filters.search);
  const [fallbackProducts, setFallbackProducts] = useState(products);
  const [bulkDescTemplate, setBulkDescTemplate] = useState("");
  const [bulkMetaDescTemplate, setBulkMetaDescTemplate] = useState("");
  const [bulkMetaTitleTemplate, setBulkMetaTitleTemplate] = useState("");
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [keywordInput, setKeywordInput] = useState("");
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
  const [selectedProductIds, setSelectedProductIds] = useState(() => readArrayState(initialBulkSessionState.selectedProductIds));
  const [bulkValidationMessage, setBulkValidationMessage] = useState(null);
  const [bulkContentTypes, setBulkContentTypes] = useState(() =>
    readArrayState(initialBulkSessionState.bulkContentTypes, ["description"]),
  );
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
    writeBulkSessionState(PRODUCT_BULK_SESSION_KEY, {
      selectedProductIds,
      bulkContentTypes,
    });
  }, [
    bulkContentTypes,
    selectedProductIds,
  ]);

  useEffect(() => {
    setSearchValue(filters.search);
  }, [filters.search]);

  useEffect(() => {
    if (!bulkContentTypes.includes("description")) {
      setShowAdvancedSettings(false);
    }
  }, [bulkContentTypes]);

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
  const bulkCreditsPerProduct = clientCreditsForContentTypes(bulkContentTypes);
  const requiredBulkCredits = clientCreditsForBatch(bulkContentTypes, selectedProducts.length);
  const insufficientCredits = requiredBulkCredits > 0 && requiredBulkCredits > credits;
  const isFaqTabSelected = bulkContentTypes.includes("faq");
  const faqProductPageUrl = appApiKey
    ? `https://${shop}/admin/themes/current/editor?template=product&addAppBlockId=${encodeURIComponent(appApiKey)}/faq-section&target=newAppsSection`
    : `https://${shop}/admin/themes/current/editor?template=product`;
  const hasRequiredBulkTemplates = useMemo(() => {
    if (bulkContentTypes.includes("description")) {
      if (!useCustomDescInstructions || !String(bulkDescTemplate || "").trim()) return false;
    }
    if (bulkContentTypes.includes("meta_title")) {
      if (!useCustomMetaTitleInstructions || !String(bulkMetaTitleTemplate || "").trim()) return false;
    }
    if (bulkContentTypes.includes("meta_description")) {
      if (!useCustomMetaDescInstructions || !String(bulkMetaDescTemplate || "").trim()) return false;
    }
    return true;
  }, [
    bulkContentTypes,
    bulkDescTemplate,
    bulkMetaDescTemplate,
    bulkMetaTitleTemplate,
    useCustomDescInstructions,
    useCustomMetaDescInstructions,
    useCustomMetaTitleInstructions,
  ]);

  const makeUrl = useCallback(
    ({ status = filters.status, search = searchValue.trim(), collectionId = filters.collectionId } = {}) => {
      const current = new URLSearchParams(location.search);
      const params = new URLSearchParams();
      ["shop", "host", "embedded"].forEach((key) => {
        const value = current.get(key);
        if (value) params.set(key, value);
      });
      if (search) params.set("q", search);
      if (status && status !== "all") params.set("status", status);
      if (collectionId) params.set("collectionId", collectionId);
      const query = params.toString();
      return query ? `?${query}` : "";
    },
    [filters.status, filters.collectionId, location.search, searchValue],
  );
  const navigateInApp = useCallback(
    (pathname, search = "") => {
      const current = new URLSearchParams(location.search);
      const next = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
      ["shop", "host", "embedded"].forEach((key) => {
        const value = current.get(key);
        if (value && !next.has(key)) next.set(key, value);
      });
      const query = next.toString();
      navigate({ pathname, search: query ? `?${query}` : "" });
    },
    [location.search, navigate],
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
    if (bulkContentTypes.includes("description")) {
      if (!useCustomDescInstructions) {
        setBulkValidationMessage("Enable 'Use custom instructions' for Description.");
        return;
      }
      if (!String(bulkDescTemplate || "").trim()) {
        setBulkValidationMessage("Description template/custom instructions are required.");
        return;
      }
    }
    if (bulkContentTypes.includes("meta_title")) {
      if (!useCustomMetaTitleInstructions) {
        setBulkValidationMessage("Enable 'Use custom instructions' for Meta title.");
        return;
      }
      if (!String(bulkMetaTitleTemplate || "").trim()) {
        setBulkValidationMessage("Meta title template/custom instructions are required.");
        return;
      }
    }
    if (bulkContentTypes.includes("meta_description")) {
      if (!useCustomMetaDescInstructions) {
        setBulkValidationMessage("Enable 'Use custom instructions' for Meta description.");
        return;
      }
      if (!String(bulkMetaDescTemplate || "").trim()) {
        setBulkValidationMessage("Meta description template/custom instructions are required.");
        return;
      }
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
        handle: p.handle,
        vendor: p.vendor,
        productType: p.productType,
        status: p.statusValue,
        descriptionHtml: p.descriptionHtml,
        seoTitleValue: p.seoTitleValue,
        seoDescriptionValue: p.seoDescriptionValue,
        priceRangeV2: p.priceRangeV2,
        variants: p.variants,
      }))
    ));
    payload.append("language", outputLanguage || "English");
    payload.append("tone", bulkSettings.tone);
    payload.append("length", bulkSettings.length);
    payload.append("format", bulkSettings.format);
    payload.append("contextKeywords", selectedKeywords.join(", "));
    payload.append("descriptionPromptTemplate", useCustomDescInstructions ? (bulkDescTemplate || "") : "");
    payload.append("metaTitlePromptTemplate", useCustomMetaTitleInstructions ? (bulkMetaTitleTemplate || "") : "");
    payload.append("metaDescriptionPromptTemplate", useCustomMetaDescInstructions ? (bulkMetaDescTemplate || "") : "");
    payload.append("useCustomDescInstructions", useCustomDescInstructions ? "1" : "0");
    payload.append("useCustomMetaTitleInstructions", useCustomMetaTitleInstructions ? "1" : "0");
    payload.append("useCustomMetaDescInstructions", useCustomMetaDescInstructions ? "1" : "0");
    payload.append("contentTypes", JSON.stringify(bulkContentTypes));
    payload.append("aiProvider", bulkSettings.aiProvider);
    payload.append("addTitleAsHeading", addTitleAsHeading ? "1" : "");
    payload.append("preserveOldDescription", preserveOldDescription ? "1" : "");
    payload.append("removeImagesFromDescription", removeImagesFromDescription ? "1" : "");
    payload.append("collectionId", filters.collectionId || "");
    bulkFetcher.submit(payload, { method: "post" });
  }, [
    selectedKeywords,
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
    filters,
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
      setQueueStatusById({});
      if (queueIntervalRef.current) { clearInterval(queueIntervalRef.current); queueIntervalRef.current = null; }
      if (response.queued) {
        shopify.toast.show(`Generating ${response.total} products in the background.`);
        window.setTimeout(() => navigateInApp("/app/jobs", ""), 600);
      } else {
        const creditsMessage =
          typeof response.creditsUsed === "number"
            ? ` ${response.creditsUsed} credits used${typeof response.newCredits === "number" ? `. Remaining: ${response.newCredits}` : ""}.`
            : "";
        shopify.toast.show(`Bulk generate complete: ${response.succeeded}/${response.total} updated.${creditsMessage}`);
        window.setTimeout(() => navigateInApp("/app/content-management", "?tab=products&filter=all"), 600);
        revalidator.revalidate();
      }
      return;
    }
    setBulkValidationMessage(response.error || "Bulk generation failed.");
  }, [bulkFetcher.state, bulkFetcher.data, navigateInApp, revalidator, shopify]);

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

  function addKeyword(kw) {
    const trimmed = kw.trim();
    if (!trimmed || selectedKeywords.length >= 5 || selectedKeywords.includes(trimmed)) return;
    setSelectedKeywords((prev) => [...prev, trimmed]);
  }

  function removeKeyword(kw) {
    setSelectedKeywords((prev) => prev.filter((k) => k !== kw));
  }

  function handleKeywordKeyDown(e) {
    if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      addKeyword(keywordInput);
      setKeywordInput("");
    }
  }

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
      navigateInApp(nextTab.to.pathname, nextTab.to.search);
    },
    [navigateInApp, sectionTabs],
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
            <div style={{ fontSize: "13px", color: "#000000", lineHeight: 1.4, fontWeight: 600,marginTop: "10px" }}>
              <Text as="p" variant="bodySm" tone="subdued">- You can select multiple products (up to {MAX_BULK_ITEMS}) for bulk content generation</Text>
              <Text as="p" variant="bodySm" tone="subdued">- You can choose a single collection to generate content for all its products</Text>
            </div>
          </div>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="headingSm" tone="subdued">{credits} credits.</Text>
            <Button onClick={() => navigateInApp("/app/pricing")} variant="secondary">
              Upgrade
            </Button>
          </InlineStack>
        </div>
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
        {isFaqTabSelected ? (
          <div style={{ flex: "1 1 100%", minWidth: 0 }}>
            <Card>
              <InlineStack align="space-between" blockAlign="center" gap="400" wrap>
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm" fontWeight="semibold">
                    FAQ Section on Product Page
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Add the FAQ block to your theme product page from the Apps section.
                  </Text>
                </BlockStack>
                <Button url={faqProductPageUrl} external variant="primary">
                  Add to Product Page
                </Button>
              </InlineStack>
            </Card>
          </div>
        ) : null}

        <div className="app-split-main" style={{ flex: "1 1 0", minWidth: "0" }}>
          {/* Products / Collections tab */}
          <div className="app-toolbar app-segmented-tabs" style={{ marginBottom: "16px", maxWidth: "640px" }}>
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
                    bulkContentTypes.includes("faq") ? "FAQ" : null,
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
                  { id: "faq", label: "FAQ" },
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

            {/* Keywords */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="bodySm" fontWeight="semibold">Keywords</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{selectedKeywords.length}/5</Text>
                </InlineStack>

                {selectedKeywords.length > 0 && (
                  <InlineStack gap="100" wrap>
                    {selectedKeywords.map((kw) => (
                      <Tag key={kw} onRemove={() => removeKeyword(kw)}>{kw}</Tag>
                    ))}
                  </InlineStack>
                )}

                {selectedKeywords.length < 5 && (
                  <TextField
                    label="Add keyword"
                    labelHidden
                    value={keywordInput}
                    onChange={setKeywordInput}
                    onKeyDown={handleKeywordKeyDown}
                    autoComplete="off"
                    placeholder="Type a keyword, press Tab or Enter to add"
                  />
                )}

                {keywordLibrary.filter((k) => !selectedKeywords.includes(k)).length > 0 && (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">From your saved keywords:</Text>
                    <InlineStack gap="100" wrap>
                      {keywordLibrary
                        .filter((k) => !selectedKeywords.includes(k))
                        .map((kw) => (
                          <button
                            key={kw}
                            onClick={() => addKeyword(kw)}
                            disabled={selectedKeywords.length >= 5}
                            style={{
                              background: "var(--p-color-bg-surface-secondary)",
                              border: "1px solid var(--p-color-border)",
                              borderRadius: "var(--p-border-radius-200)",
                              padding: "2px 10px",
                              cursor: selectedKeywords.length >= 5 ? "not-allowed" : "pointer",
                              fontSize: "12px",
                              opacity: selectedKeywords.length >= 5 ? 0.5 : 1,
                            }}
                          >
                            + {kw}
                          </button>
                        ))}
                    </InlineStack>
                  </BlockStack>
                )}
              </BlockStack>
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
            {bulkContentTypes.includes("description") && (
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
            )}


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
              <Text as="p" variant="bodySm" tone={insufficientCredits ? "critical" : "subdued"}>
                Estimated credits used: {requiredBulkCredits} ({selectedProducts.length} products x {bulkCreditsPerProduct} credits each)
                {insufficientCredits ? ` - not enough credits (${credits} available)` : ""}
              </Text>
            </div>

            {/* Validation error */}
            {bulkValidationMessage && (
              <div style={{ padding: "8px 16px" }}>
                <Banner tone="critical"><p>{bulkValidationMessage}</p></Banner>
              </div>
            )}

            {/* Generate Button */}
            <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button
                style={{ width: "fit-content" }}
                variant="primary"
                onClick={handleBulkGenerate}
                disabled={isBulkGenerating || selectedProducts.length === 0 || exceedsBulkLimit || !hasRequiredBulkTemplates || insufficientCredits}
                loading={isBulkGenerating}
                tone="success"
              >
                {`Generate ${selectedProducts.length} items (${requiredBulkCredits} credits)`}
              </Button>
              {insufficientCredits ? (
                <Button onClick={openAddCreditModal}>
                  Add Credit
                </Button>
              ) : null}
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
        .app-segmented-tabs .Polaris-Tabs {
          border: 1px solid #d1d5db;
          border-radius: 12px;
          background: #f3f4f6;
          padding: 2px;
        }
        .app-segmented-tabs .Polaris-Tabs__Wrapper {
          padding: 0 !important;
        }
        .app-segmented-tabs .Polaris-Tabs__Tab {
          min-height: 36px;
          border-radius: 10px;
        }
        .app-segmented-tabs .Polaris-Tabs__Title {
          font-size: 14px;
          font-weight: 600;
          color: #4b5563;
        }
        .app-segmented-tabs .Polaris-Tabs__Tab--active {
          background: #ffffff;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
        }
        .app-segmented-tabs .Polaris-Tabs__Tab--active .Polaris-Tabs__Title {
          color: #1f2937;
        }
        .app-segmented-tabs .Polaris-Tabs__Tab--active .Polaris-Tabs__Title::before {
          content: "✓ ";
          font-weight: 700;
        }
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





