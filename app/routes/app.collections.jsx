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
  Button,
  Card,
  Checkbox,
  EmptyState,
  Icon,
  IndexTable,
  InlineStack,
  Page,
  Pagination,
  Select,
  Spinner,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import { CollectionIcon, ProductIcon } from "@shopify/polaris-icons";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { buildCollectionContentPrompt } from "../lib/contentPromptTemplates";
import { TemplateLibraryModal } from "../components/TemplateLibraryModal";
import { readGlobalSettings } from "../lib/globalSettings";
import {
  readStoredCollectionPromptTemplateSelection,
} from "../lib/collectionPromptTemplateLibrary";
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
/* global process */

const FETCH_BATCH_SIZE = 250;
const BULK_GENERATE_INTENT = "bulk_generate";
const MAX_BULK_ITEMS = 50;
const TABLE_PAGE_SIZE = 10;
const MIN_BULK_COLLECTION_SELECTION_ERROR = "Select at least one collection for bulk generation.";
const MAX_BULK_COLLECTION_SELECTION_ERROR = `You can bulk generate up to ${MAX_BULK_ITEMS} collections at a time.`;
const COLLECTION_CONTENT_TYPES = ["description", "meta_title", "meta_description"];
const DEFAULT_COLLECTION_CONTENT_TYPES = ["description", "meta_title", "meta_description"];
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

const TONE_OPTIONS = [
  { label: "Professional", value: "professional" },
  { label: "Friendly", value: "friendly" },
  { label: "Casual", value: "casual" },
  { label: "Formal", value: "formal" },
  { label: "Enthusiastic", value: "enthusiastic" },
  { label: "Informative", value: "informative" },
];

const LENGTH_OPTIONS = [
  { label: "Short (50-150 words)", value: "short (50-150 words)" },
  { label: "Medium (150-300 words)", value: "medium (150-300 words)" },
  { label: "Long (300-500 words)", value: "long (300-500 words)" },
  { label: "Very Long (500+ words)", value: "very long (500+ words)" },
];

const COLLECTION_UPDATE_MUTATION_INPUT = `#graphql
  mutation CollectionUpdateInput($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
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

const COLLECTION_UPDATE_MUTATION_FALLBACK = `#graphql
  mutation CollectionUpdateFallback($collection: CollectionUpdateInput!) {
    collectionUpdate(collection: $collection) {
      collection {
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

const COLLECTION_LIST_QUERY = `#graphql
  query CollectionList(
    $first: Int
    $after: String
    $query: String
  ) {
    collections(
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
          descriptionHtml
          updatedAt
          seo {
            title
            description
          }
          productsCount {
            count
          }
          ruleSet {
            appliedDisjunctively
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

function escapeSearchValue(value) {
  return value.replace(/[\\"]/g, "\\$&");
}

function toSearchQuery(search) {
  if (!search) return "";
  const escapedSearch = escapeSearchValue(search);
  const titleQuery = escapedSearch.includes(" ") ? `"${escapedSearch}"` : escapedSearch;
  return `title:${titleQuery}`;
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

function toCollectionTypeMeta(ruleSet) {
  if (ruleSet) return { label: "Smart", tone: "success" };
  return { label: "Manual", tone: "neutral" };
}

function toAppGenerationStatusMeta(generatedContent) {
  if (!generatedContent) return { label: "Not generated", tone: "critical" };
  if (generatedContent.appliedToCollection) return { label: "Active", tone: "success" };
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
  if (tone === "caution") return "caution";
  if (tone === "critical") return "critical";
  return "info";
}

function renderBadge({ label, tone }) {
  return <Badge tone={toBadgeTone(tone)}>{label}</Badge>;
}

function formatDate(dateValue) {
  if (!dateValue) return "-";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function readFormString(formData, key) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
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
  return buildCollectionContentPrompt({
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
    collectionDescription: (
      parsed?.collectionDescription ||
      parsed?.productDescription ||
      parsed?.description ||
      ""
    ).trim(),
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

  if (aiProvider === "anthropic") {
    return await generateContentWithAnthropic(input, anthropicKey);
  }

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

async function upsertCollectionGeneratedContent({
  shop,
  collectionId,
  collectionTitle,
  language,
  tone,
  lengthOption,
  formatOption,
  contextKeywords,
  descriptionPromptTemplate,
  metaTitlePromptTemplate,
  metaDescriptionPromptTemplate,
  aiModel,
  descriptionHtml,
  seoTitle,
  seoDescription,
  appliedToCollection,
}) {
  try {
    await db.collectionGeneratedContent.upsert({
      where: {
        shop_collectionId: {
          shop,
          collectionId,
        },
      },
      create: {
        shop,
        collectionId,
        collectionTitle,
        language,
        tone,
        lengthOption,
        formatOption,
        contextKeywords,
        descriptionPromptTemplate,
        metaTitlePromptTemplate,
        metaDescriptionPromptTemplate,
        aiModel,
        descriptionHtml,
        seoTitle,
        seoDescription,
        appliedToCollection,
      },
      update: {
        collectionTitle,
        language,
        tone,
        lengthOption,
        formatOption,
        contextKeywords,
        descriptionPromptTemplate,
        metaTitlePromptTemplate,
        metaDescriptionPromptTemplate,
        aiModel,
        descriptionHtml,
        seoTitle,
        seoDescription,
        appliedToCollection,
      },
    });
  } catch (error) {
    console.error("Failed to upsert collection generated content", error);
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
      const collectionsJson = formData.get("collections");
      const bulkCollections = JSON.parse(collectionsJson || "[]");
      if (!Array.isArray(bulkCollections) || bulkCollections.length === 0) {
        return { ok: false, intent, error: MIN_BULK_COLLECTION_SELECTION_ERROR };
      }
      if (bulkCollections.length > MAX_BULK_ITEMS) {
        return {
          ok: false,
          intent,
          error: MAX_BULK_COLLECTION_SELECTION_ERROR,
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
        COLLECTION_CONTENT_TYPES,
        DEFAULT_COLLECTION_CONTENT_TYPES,
      );
      const shouldUpdateDescription = selectedContentTypes.includes("description");
      const shouldUpdateMetaTitle = selectedContentTypes.includes("meta_title");
      const shouldUpdateMetaDescription = selectedContentTypes.includes("meta_description");
      const creditsPerItem = creditsForContentTypes(selectedContentTypes);
      const availableCredits = shopData?.credits ?? 100;
      const requiredCredits = creditsForBatch(selectedContentTypes, bulkCollections.length);

      if (availableCredits < requiredCredits) {
        return {
          ok: false,
          intent,
          error: buildInsufficientCreditsError(requiredCredits, availableCredits),
        };
      }

      const results = await Promise.allSettled(
        bulkCollections.map(async (c) => {
          const generated = await generateContent(
            {
              title: c.title,
              descriptionText: stripHtml(c.descriptionHtml || ""),
              seoTitle: c.seoTitleValue || "",
              seoDescription: c.seoDescriptionValue || "",
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
            ? (generated.collectionDescription
              ? normalizeGeneratedHtml(generated.collectionDescription)
              : c.descriptionHtml || "")
            : c.descriptionHtml || "";
          if (shouldUpdateDescription && generated.collectionDescription) {
            if (removeImagesFlag) {
              nextDescription = nextDescription.replace(/<img\b[^>]*>/gi, "").replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "");
            }
            if (addTitleAsHeadingFlag && c.title) {
              nextDescription = `<h2>${c.title.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</h2>${nextDescription}`;
            }
            if (preserveOldDescriptionFlag && c.descriptionHtml) {
              const oldHtml = removeImagesFlag
                ? c.descriptionHtml.replace(/<img\b[^>]*>/gi, "").replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "")
                : c.descriptionHtml;
              nextDescription = nextDescription + oldHtml;
            }
          }
          const nextSeoTitle = shouldUpdateMetaTitle
            ? (generated.seoTitle || c.seoTitleValue || "")
            : (c.seoTitleValue || "");
          const nextSeoDescription = shouldUpdateMetaDescription
            ? (generated.seoDescription || c.seoDescriptionValue || "")
            : (c.seoDescriptionValue || "");

          const updateInputPayload = {
            id: c.id,
            descriptionHtml: nextDescription,
            seo: {
              title: nextSeoTitle,
              description: nextSeoDescription,
            },
          };

          const mutationAttempts = [
            {
              mutation: COLLECTION_UPDATE_MUTATION_INPUT,
              variables: { input: updateInputPayload },
            },
            {
              mutation: COLLECTION_UPDATE_MUTATION_FALLBACK,
              variables: { collection: updateInputPayload },
            },
          ];

          let updated = false;
          for (let attemptIndex = 0; attemptIndex < mutationAttempts.length; attemptIndex += 1) {
            const attempt = mutationAttempts[attemptIndex];
            const updateResponse = await admin.graphql(attempt.mutation, {
              variables: attempt.variables,
            });
            const updateJson = await updateResponse.json();
            const graphqlErrors =
              updateJson?.errors?.map((item) => item?.message).filter(Boolean) || [];

            if (graphqlErrors.length > 0) {
              const schemaMismatch =
                /unknown type|unknown argument|cannot query field|is not defined|expected type/i.test(
                  graphqlErrors.join(" "),
                );
              const isLastAttempt = attemptIndex === mutationAttempts.length - 1;
              if (!isLastAttempt && schemaMismatch) {
                continue;
              }
              throw new Error(graphqlErrors.join(" "));
            }

            const userErrors = updateJson?.data?.collectionUpdate?.userErrors || [];
            if (userErrors.length > 0) {
              throw new Error(userErrors.map((item) => item?.message).filter(Boolean).join(" "));
            }

            updated = true;
            break;
          }

          if (!updated) {
            throw new Error("Failed to update collection in Shopify.");
          }

          await writeGenerationLog({
            shop: session.shop,
            productId: c.id,
            productTitle: c.title || null,
            intent: "collection_bulk_generate",
            resourceType: "collection",
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

          await upsertCollectionGeneratedContent({
            shop: session.shop,
            collectionId: c.id,
            collectionTitle: c.title || null,
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
            appliedToCollection: true,
          });

          return { id: c.id, title: c.title, seoTitle: nextSeoTitle, seoDescription: nextSeoDescription };
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
        id: bulkCollections[i].id,
        title: bulkCollections[i].title,
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
        total: bulkCollections.length,
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
    console.error("Collection content action failed", error);
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
    select: { openaiApiKey: true, anthropicApiKey: true, defaultAiProvider: true, credits: true, creditsUsedTotal: true },
  });
  const url = new URL(request.url);

  const search = (url.searchParams.get("q") || "").trim();
  const searchForQuery = search.length >= 2 ? search : "";
  const query = toSearchQuery(searchForQuery);

  const collectionNodes = [];
  let afterCursor;
  while (true) {
    const response = await admin.graphql(COLLECTION_LIST_QUERY, {
      variables: {
        first: FETCH_BATCH_SIZE,
        after: afterCursor,
        query: query || undefined,
      },
    });
    const responseJson = await response.json();
    const collectionConnection = responseJson?.data?.collections;
    if (!collectionConnection) break;

    const nodes = (collectionConnection.edges || []).map(({ node }) => node);
    collectionNodes.push(...nodes);

    if (!collectionConnection.pageInfo?.hasNextPage || !collectionConnection.pageInfo?.endCursor) {
      break;
    }
    afterCursor = collectionConnection.pageInfo.endCursor;
  }

  if (collectionNodes.length === 0) {
    return {
      filters: { search },
      collections: [],
      hasOpenaiKey: !!(shopData?.openaiApiKey || process.env.OPENAI_API_KEY),
      hasAnthropicKey: !!(shopData?.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
      defaultAiProvider: shopData?.defaultAiProvider || "auto",
      credits: shopData?.credits ?? 100,
      creditsUsedTotal: shopData?.creditsUsedTotal ?? 0,
    };
  }

  const generatedContentByCollectionId = new Map();
  const generatedContents = await db.collectionGeneratedContent.findMany({
    where: {
      shop: session.shop,
      collectionId: { in: collectionNodes.map((node) => node.id) },
    },
    select: {
      collectionId: true,
      appliedToCollection: true,
      updatedAt: true,
    },
  });

  generatedContents.forEach((entry) => {
    generatedContentByCollectionId.set(entry.collectionId, entry);
  });

  const collections = collectionNodes.map((node) => {
    const generatedContent = generatedContentByCollectionId.get(node.id);
    return {
      id: node.id,
      title: node.title,
      handle: node.handle,
      descriptionHtml: node.descriptionHtml || "",
      descriptionText: stripHtml(node.descriptionHtml),
      descriptionStatus: evaluateDescription(stripHtml(node.descriptionHtml)),
      appStatus: toAppGenerationStatusMeta(generatedContent),
      generatedTime: formatRelativeGenerationTime(generatedContent?.updatedAt),
      seoTitle: evaluateSeoTitle(node.seo?.title || node.title),
      seoDescription: evaluateSeoDescription(node.seo?.description),
      seoTitleValue: node.seo?.title || "",
      seoDescriptionValue: node.seo?.description || "",
      collectionType: toCollectionTypeMeta(node.ruleSet),
      productsCount: node.productsCount?.count || 0,
      updatedAt: formatDate(node.updatedAt),
    };
  });

  return {
    filters: { search },
    collections,
    hasOpenaiKey: !!(shopData?.openaiApiKey || process.env.OPENAI_API_KEY),
    hasAnthropicKey: !!(shopData?.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
    defaultAiProvider: shopData?.defaultAiProvider || "auto",
    credits: shopData?.credits ?? 100,
    creditsUsedTotal: shopData?.creditsUsedTotal ?? 0,
  };
};

const bulkInitialSettings = {
  language: "English",
  tone: "Neutral",
  length: "50 - 150 words",
  format: "Single paragraph",
  aiProvider: "auto",
};

export default function CollectionsPage() {
  const { filters, collections, defaultAiProvider, credits } = useLoaderData();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const revalidator = useRevalidator();
  const bulkFetcher = useFetcher();
  const shopify = useAppBridge();
  const [searchValue, setSearchValue] = useState(filters.search);
  const [fallbackCollections, setFallbackCollections] = useState(collections);
  const [bulkDescTemplate, setBulkDescTemplate] = useState(DEFAULT_DESCRIPTION_CUSTOM_PROMPT);
  const [bulkMetaDescTemplate, setBulkMetaDescTemplate] = useState("");
  const [bulkMetaTitleTemplate, setBulkMetaTitleTemplate] = useState("");
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
  const [selectedCollectionIds, setSelectedCollectionIds] = useState([]);
  const [bulkValidationMessage, setBulkValidationMessage] = useState(null);
  const [bulkContentTypes, setBulkContentTypes] = useState(["description"]);
  const [selectedDescTemplateId, setSelectedDescTemplateId] = useState("");
  const [selectedMetaDescTemplateId, setSelectedMetaDescTemplateId] = useState("");
  const [selectedMetaTitleTemplateId, setSelectedMetaTitleTemplateId] = useState("");
  const bulkResultHandledRef = useRef(false);
  const [bulkDescKeywords, setBulkDescKeywords] = useState(() => readGlobalSettings().collectionDescKeywords || "");
  const [bulkMetaTitleKeywords, setBulkMetaTitleKeywords] = useState(() => readGlobalSettings().collectionMetaTitleKeywords || "");
  const [bulkMetaDescKeywords, setBulkMetaDescKeywords] = useState(() => readGlobalSettings().collectionMetaDescKeywords || "");
  const [useCustomDescInstructions, setUseCustomDescInstructions] = useState(false);
  const [useCustomMetaDescInstructions, setUseCustomMetaDescInstructions] = useState(false);
  const [useCustomMetaTitleInstructions, setUseCustomMetaTitleInstructions] = useState(false);
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
  const [templateLibraryContentType, setTemplateLibraryContentType] = useState("description");
  const [currentPage, setCurrentPage] = useState(1);
  const [outputLanguage, setOutputLanguage] = useState(() => readGlobalSettings().language || "English");
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [addTitleAsHeading, setAddTitleAsHeading] = useState(false);
  const [preserveOldDescription, setPreserveOldDescription] = useState(false);
  const [removeImagesFromDescription, setRemoveImagesFromDescription] = useState(false);

  useEffect(() => {
    const templateSelection = readStoredCollectionPromptTemplateSelection();
    if (templateSelection.descriptionPromptTemplate) {
      setBulkDescTemplate(templateSelection.descriptionPromptTemplate);
    }
    if (templateSelection.metaTitlePromptTemplate) {
      setBulkMetaTitleTemplate(templateSelection.metaTitlePromptTemplate);
    }
    if (templateSelection.metaDescriptionPromptTemplate) {
      setBulkMetaDescTemplate(templateSelection.metaDescriptionPromptTemplate);
    }
  }, []);

  useEffect(() => {
    setSearchValue(filters.search);
  }, [filters.search]);

  useEffect(() => {
    if (!filters.search || collections.length > 0) {
      setFallbackCollections(collections);
    }
  }, [filters.search, collections]);

  const isLoading = navigation.state !== "idle";
  const isSearchLoading =
    isLoading &&
    searchValue.trim().toLowerCase() !== (filters.search || "").trim().toLowerCase();
  const normalizedSearch = searchValue.trim().toLowerCase();
  const sourceCollections = collections.length > 0 ? collections : fallbackCollections;

  const filteredCollections = useMemo(() => {
    if (!normalizedSearch) return collections;
    return sourceCollections.filter((collection) =>
      collection.title.toLowerCase().includes(normalizedSearch),
    );
  }, [normalizedSearch, collections, sourceCollections]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.search]);

  const totalPages = Math.max(1, Math.ceil(filteredCollections.length / TABLE_PAGE_SIZE));

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const paginatedCollections = useMemo(() => {
    const start = (currentPage - 1) * TABLE_PAGE_SIZE;
    return filteredCollections.slice(start, start + TABLE_PAGE_SIZE);
  }, [currentPage, filteredCollections]);

  const visibleCollectionIds = useMemo(
    () => paginatedCollections.map((collection) => collection.id),
    [paginatedCollections],
  );

  useEffect(() => {
    setSelectedCollectionIds((current) => {
      const visibleSet = new Set(visibleCollectionIds);
      return current.filter((id) => visibleSet.has(id));
    });
  }, [visibleCollectionIds]);

  const selectedCollections = useMemo(
    () => filteredCollections.filter((collection) => selectedCollectionIds.includes(collection.id)),
    [filteredCollections, selectedCollectionIds],
  );
  const exceedsBulkLimit = selectedCollections.length > MAX_BULK_ITEMS;

  const makeUrl = useCallback(
    ({ search = searchValue.trim() } = {}) => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      const query = params.toString();
      return query ? `?${query}` : "";
    },
    [searchValue],
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
    if (selectedCollections.length === 0) {
      setBulkValidationMessage(MIN_BULK_COLLECTION_SELECTION_ERROR);
      return;
    }
    if (selectedCollections.length > MAX_BULK_ITEMS) {
      setBulkValidationMessage(MAX_BULK_COLLECTION_SELECTION_ERROR);
      return;
    }

    setBulkValidationMessage(null);
    setBulkResult(null);
    const payload = new FormData();
    payload.append("intent", BULK_GENERATE_INTENT);
    payload.append("collections", JSON.stringify(
      selectedCollections.map((c) => ({
        id: c.id,
        title: c.title,
        descriptionHtml: c.descriptionHtml,
        seoTitleValue: c.seoTitleValue,
        seoDescriptionValue: c.seoDescriptionValue,
      })),
    ));
    payload.append("language", outputLanguage || "English");
    payload.append("tone", bulkSettings.tone);
    payload.append("length", bulkSettings.length);
    payload.append("format", bulkSettings.format);
    payload.append("descKeywords", bulkDescKeywords || "");
    payload.append("metaTitleKeywords", bulkMetaTitleKeywords || "");
    payload.append("metaDescKeywords", bulkMetaDescKeywords || "");
    payload.append("contextKeywords", [bulkDescKeywords, bulkMetaTitleKeywords, bulkMetaDescKeywords].filter(Boolean).join(", "));
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
    bulkDescTemplate,
    bulkMetaDescKeywords,
    bulkMetaDescTemplate,
    bulkMetaTitleKeywords,
    bulkMetaTitleTemplate,
    bulkContentTypes,
    bulkFetcher,
    bulkSettings,
    selectedCollections,
    outputLanguage,
    useCustomDescInstructions,
    useCustomMetaDescInstructions,
    useCustomMetaTitleInstructions,
    addTitleAsHeading,
    preserveOldDescription,
    removeImagesFromDescription,
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
    setBulkResult(response);
    if (response.ok) {
      setBulkValidationMessage(null);
      revalidator.revalidate();
      const creditsMessage =
        typeof response.creditsUsed === "number"
          ? ` ${response.creditsUsed} credits used${typeof response.newCredits === "number" ? `. Remaining: ${response.newCredits}` : ""}.`
          : "";
      shopify.toast.show(`Bulk generate complete: ${response.succeeded}/${response.total} updated.${creditsMessage}`);
      navigate("/app/content-management?tab=collections&filter=all");
      return;
    }
    setBulkValidationMessage(response.error || "Bulk generation failed.");
  }, [bulkFetcher.state, bulkFetcher.data, navigate, revalidator, shopify]);

  useEffect(() => {
    if (selectedCollections.length > MAX_BULK_ITEMS) {
      if (bulkValidationMessage !== MAX_BULK_COLLECTION_SELECTION_ERROR) {
        setBulkValidationMessage(MAX_BULK_COLLECTION_SELECTION_ERROR);
      }
      return;
    }

    if (selectedCollections.length > 0 && bulkValidationMessage === MIN_BULK_COLLECTION_SELECTION_ERROR) {
      setBulkValidationMessage(null);
      return;
    }

    if (bulkValidationMessage === MAX_BULK_COLLECTION_SELECTION_ERROR) {
      setBulkValidationMessage(null);
    }
  }, [bulkValidationMessage, selectedCollections.length]);

  const tableHeadings = [
    { title: "" },
    { title: "Title" },
    { title: "Short" },
    { title: "Status" },
  ];


  const updateBulkField = (field) => (value) =>
    setBulkSettings((prev) => ({ ...prev, [field]: value }));


  const allVisibleSelected =
    visibleCollectionIds.length > 0 && selectedCollectionIds.length === visibleCollectionIds.length;
  const selectionIndeterminate =
    selectedCollectionIds.length > 0 && selectedCollectionIds.length < visibleCollectionIds.length;

  const handleToggleSelectAllVisible = useCallback(
    (checked) => {
      setSelectedCollectionIds(checked ? [...visibleCollectionIds] : []);
    },
    [visibleCollectionIds],
  );

  const handleToggleCollectionSelection = useCallback(
    (collectionId) => (checked) => {
      setSelectedCollectionIds((current) => {
        if (checked) {
          return current.includes(collectionId) ? current : [...current, collectionId];
        }
        return current.filter((id) => id !== collectionId);
      });
    },
    [],
  );

  const rowMarkup = paginatedCollections.map((collection, index) => (
    <IndexTable.Row
      id={collection.id}
      key={collection.id}
      position={index}
    >
      <IndexTable.Cell>
        <Checkbox
          label={`Select ${collection.title}`}
          labelHidden
          checked={selectedCollectionIds.includes(collection.id)}
          onChange={handleToggleCollectionSelection(collection.id)}
        />
      </IndexTable.Cell>

      <IndexTable.Cell>
        <div className="collections-title-cell">
          <Text as="span" variant="bodyMd" fontWeight="medium">
            {collection.title}
          </Text>
        </div>
      </IndexTable.Cell>

      <IndexTable.Cell>{renderBadge(collection.descriptionStatus)}</IndexTable.Cell>

      <IndexTable.Cell>
        {isBulkGenerating && selectedCollectionIds.includes(collection.id) ? (
          <InlineStack gap="100" blockAlign="center">
            <Spinner size="small" />
            <Text as="span" tone="subdued">Generating...</Text>
          </InlineStack>
        ) : (
          renderBadge(collection.appStatus)
        )}
      </IndexTable.Cell>

    </IndexTable.Row>
  ));

  const sectionTabs = [
    { label: "Products", path: "/app/products", icon: ProductIcon },
    { label: "Collections", path: "/app/collections", icon: CollectionIcon },
  ];
  const activeSectionPath = location.pathname.startsWith("/app/collections")
    ? "/app/collections"
    : "/app/products";

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
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ width: "46px", height: "46px", borderRadius: "6px", background: "#ffffff", border: "1px solid #d1d5db", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon source={CollectionIcon} tone="base" />
            </div>
            <div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#000000", marginBottom: "3px", letterSpacing: "-0.3px" }}>Collections</div>
              <div style={{ fontSize: "13px", color: "#000000", lineHeight: 1.4 }}>Optimize your collection pages with AI-generated descriptions</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", "--p-color-text": "#000", "--p-color-bg-fill": "#ffffff", "--p-color-border": "#d1d5db" }}>
            {/* Credits badge */}
            <button
              type="button"
              onClick={() => navigate("/app/analytics")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                border: "1px solid #d1d5db",
                background: "#ffffff",
                borderRadius: 20,
                padding: "4px 10px",
                boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                fontSize: 12,
                fontWeight: 600,
                color: "#000000",
                lineHeight: 1,
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 20 20" fill="#f59e0b">
                <path d="M10 1L12.39 7.26L19 8.27L14.5 12.64L15.78 19.02L10 15.77L4.22 19.02L5.5 12.64L1 8.27L7.61 7.26L10 1Z"/>
              </svg>
              <span>{credits} credits.</span>
              <span style={{ color: "#000000" }}>Upgrade</span>
            </button>
            <Button onClick={() => navigate(makeUrl({}))} variant="secondary" size="slim">↺ Refresh</Button>
            <Button onClick={() => navigate("/app")} variant="secondary" size="slim">← Back</Button>
          </div>
        </div>
      </div>



      <div className="app-split-layout" style={{ marginTop: "0" }}>
        {/* ── LEFT: Collection List ── */}
        <div className="app-split-main">
          {/* Instructions Card */}
          <div style={{ marginBottom: "16px" }}>
            <Card>
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Choose a collection to generate AI-powered content for all its products
                </Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">• You can select multiple collections (up to {MAX_BULK_ITEMS}) for bulk content generation</Text>
                  <Text as="p" variant="bodySm" tone="subdued">• Content will be generated for all products within the selected collections</Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </div>

          {/* ── Products / Collections tab bar ── */}
          <div className="app-toolbar" style={{ marginBottom: "20px" }}>
            <div className="app-toolbar-fixed" style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: "10px", overflow: "hidden", background: "#fff", minWidth: "180px" }}>
              {sectionTabs.map((tab, index) => {
                const isActive = activeSectionPath === tab.path;
                return (
                <button
                  key={tab.label}
                  type="button"
                  onClick={() => navigate({ pathname: tab.path, search: location.search })}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 14px",
                    border: "none",
                    borderRight: index < sectionTabs.length - 1 ? "1px solid #e5e7eb" : "none",
                    background: isActive ? "#f3f4f6" : "transparent",
                    color: isActive ? "#111827" : "#6b7280",
                    fontWeight: isActive ? 600 : 500,
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  <Icon source={tab.icon} tone={isActive ? "accent" : "subdued"} />
                  {tab.label}
                </button>
                );
              })}
            </div>
          </div>

          <Card padding="0">
            <BlockStack gap="0">
              <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <Checkbox
                    label={`Select all visible (${filteredCollections.length})`}
                    checked={allVisibleSelected}
                    indeterminate={selectionIndeterminate}
                    onChange={handleToggleSelectAllVisible}
                  />
                  <div className="app-toolbar-grow" style={{ minWidth: "240px", maxWidth: "420px" }}>
                    <TextField
                      label="Search collections"
                      labelHidden
                      placeholder="Search by collection title..."
                      value={searchValue}
                      onChange={handleSearchInput}
                      autoComplete="off"
                      prefix={isSearchLoading ? <Spinner size="small" /> : undefined}
                    />
                  </div>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {selectedCollections.length} selected
                  </Text>
                </InlineStack>
              </div>

              {filteredCollections.length === 0 ? (
                <EmptyState heading="No collections found" image="">
                  <Text as="p" tone="subdued">
                    {normalizedSearch
                      ? `No collections match "${normalizedSearch}". Try a different search.`
                      : "No collections are available in your store."}
                  </Text>
                </EmptyState>
              ) : (
                <div className="collections-table-wrap app-table-scroll">
                  <IndexTable
                    resourceName={{ singular: "collection", plural: "collections" }}
                    itemCount={paginatedCollections.length}
                    headings={tableHeadings}
                    selectable={false}
                    loading={isSearchLoading}
                  >
                    {rowMarkup}
                  </IndexTable>
                </div>
              )}

              <div style={{ padding: "8px 16px", borderTop: "1px solid var(--p-color-border)" }}>
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <Text as="span" tone="subdued" variant="bodySm">
                    {filteredCollections.length} result{filteredCollections.length !== 1 ? "s" : ""}
                    {isSearchLoading ? " (Searching...)" : isLoading ? " (Loading...)" : ""}
                  </Text>
                  {filteredCollections.length > TABLE_PAGE_SIZE && (
                    <Pagination
                      hasPrevious={currentPage > 1}
                      onPrevious={() => setCurrentPage((page) => Math.max(1, page - 1))}
                      hasNext={currentPage < totalPages}
                      onNext={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    />
                  )}
                </InlineStack>
              </div>
            </BlockStack>
          </Card>
        </div>

        {/* ── RIGHT: Bulk Settings Panel ── */}
        <div className="app-split-side">
          <Card padding="0">
            {/* Header */}
            <div style={{ padding: "16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd" fontWeight="bold">Collection Bulk Order Settings</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {[
                    bulkContentTypes.includes("description") ? "Descriptions" : null,
                    bulkContentTypes.includes("meta_description") ? "Meta Descriptions" : null,
                    bulkContentTypes.includes("meta_title") ? "Meta Titles" : null,
                  ].filter(Boolean).join(", ")} will be generated for {selectedCollections.length} collection{selectedCollections.length !== 1 ? "s" : ""}
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
                    onChange={(v) => setUseCustomDescInstructions(v)}
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
                        onClick={() => { setBulkDescTemplate(DEFAULT_DESCRIPTION_CUSTOM_PROMPT); setUseCustomDescInstructions(false); }}
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
                    onChange={(v) => setUseCustomMetaDescInstructions(v)}
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
                        onClick={() => { setBulkMetaDescTemplate(""); setUseCustomMetaDescInstructions(false); }}
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
                    onChange={(v) => setUseCustomMetaTitleInstructions(v)}
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
                        onClick={() => { setBulkMetaTitleTemplate(""); setUseCustomMetaTitleInstructions(false); }}
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
                <span style={{ fontSize: "11px" }}>{showAdvancedSettings ? "∧" : "∨"}</span>
                {showAdvancedSettings ? "Hide" : "Show"} Advanced Settings
              </button>
              {showAdvancedSettings && (
                <div style={{ marginTop: "12px" }}>
                  <BlockStack gap="300">
                    {bulkContentTypes.includes("description") && (
                      <TextField
                        label="Description Keywords"
                        value={bulkDescKeywords}
                        onChange={setBulkDescKeywords}
                        placeholder="e.g. curated, seasonal"
                        helpText="Keywords specific to collection descriptions"
                        autoComplete="off"
                      />
                    )}
                    {bulkContentTypes.includes("meta_description") && (
                      <TextField
                        label="Meta Description Keywords"
                        value={bulkMetaDescKeywords}
                        onChange={setBulkMetaDescKeywords}
                        placeholder="e.g. wide selection, quality"
                        helpText="Keywords specific to meta descriptions"
                        autoComplete="off"
                      />
                    )}
                    {bulkContentTypes.includes("meta_title") && (
                      <TextField
                        label="Meta Title Keywords"
                        value={bulkMetaTitleKeywords}
                        onChange={setBulkMetaTitleKeywords}
                        placeholder="e.g. shop, explore"
                        helpText="Keywords specific to meta titles"
                        autoComplete="off"
                      />
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: "14px", paddingTop: "4px" }}>
                      <div>
                        <Checkbox
                          label={<span style={{ fontWeight: 600, fontSize: "13px" }}>Add Collection Title as heading tag in the description</span>}
                          checked={addTitleAsHeading}
                          onChange={(v) => setAddTitleAsHeading(v)}
                        />
                        <p style={{ margin: "4px 0 0 24px", fontSize: "12px", color: "#6b7280", lineHeight: "1.45" }}>
                          This will add your Collection Title as the main heading in the description.
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
                          label={<span style={{ fontWeight: 600, fontSize: "13px" }}>Remove images from Collection Description <span style={{ color: "#6b7280", fontWeight: 400 }}>(Recommended)</span></span>}
                          checked={removeImagesFromDescription}
                          onChange={(v) => setRemoveImagesFromDescription(v)}
                        />
                        <p style={{ margin: "4px 0 0 24px", fontSize: "12px", color: "#6b7280", lineHeight: "1.45" }}>
                          This will remove all images from your collection descriptions to ensure clean text content.
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
                disabled={isBulkGenerating || selectedCollections.length === 0 || exceedsBulkLimit}
                loading={isBulkGenerating}
                tone="success"
              >
                {`Generate ${selectedCollections.length} items (${selectedCollections.length} collections × ${bulkContentTypes.length} types)`}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <style>{`
        .collections-table-wrap .Polaris-IndexTable__ScrollContainer {
          overflow-x: hidden;
        }
        .collections-table-wrap .Polaris-IndexTable__Table {
          width: 100%;
          table-layout: fixed;
        }
        .collections-title-cell {
          max-width: 240px;
          white-space: normal;
          overflow-wrap: anywhere;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>

      {/* ── Generation Results Table ── */}
      {bulkResult && bulkResult.results && bulkResult.results.length > 0 && (
        <div style={{ marginTop: "24px" }}>
          <Card padding="0">
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd" fontWeight="bold">Generation Results</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {bulkResult.succeeded} collection{bulkResult.succeeded !== 1 ? "s" : ""} updated · {bulkResult.failed > 0 ? `${bulkResult.failed} failed · ` : ""}{bulkResult.creditsUsed ?? 0} AI credits used
                </Text>
              </BlockStack>
            </div>
            <div className="app-table-scroll">
              <IndexTable
                resourceName={{ singular: "collection", plural: "collections" }}
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
                    <Text variant="bodyMd" fontWeight="medium" as="span">{r.title}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {r.status === "success"
                      ? <Badge tone="success">Updated</Badge>
                      : <Badge tone="critical">Failed</Badge>}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm" tone={r.seoTitle ? undefined : "subdued"}>
                      {r.seoTitle ? r.seoTitle.slice(0, 60) + (r.seoTitle.length > 60 ? "…" : "") : "—"}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm" tone={r.seoDescription ? undefined : "subdued"}>
                      {r.seoDescription ? r.seoDescription.slice(0, 80) + (r.seoDescription.length > 80 ? "…" : "") : "—"}
                    </Text>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
              </IndexTable>
            </div>
          </Card>
        </div>
      )}

      <TemplateLibraryModal
        key={templateLibraryContentType}
        open={templateLibraryOpen}
        onClose={() => setTemplateLibraryOpen(false)}
        tabs={[
          { id: "description", label: "Description" },
          { id: "meta_description", label: "Meta Description" },
          { id: "meta_title", label: "Meta Title" },
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
