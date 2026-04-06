import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
  useRevalidator,
} from "react-router";
import {
  Autocomplete,
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  EmptyState,
  IndexTable,
  InlineStack,
  Page,
  Select,
  Spinner,
  Tag,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { buildCollectionContentPrompt } from "../lib/contentPromptTemplates";
import {
  readStoredCollectionPromptTemplateSelection,
  COLLECTION_DESCRIPTION_TEMPLATES,
  COLLECTION_META_DESCRIPTION_TEMPLATES,
  COLLECTION_META_TITLE_TEMPLATES,
} from "../lib/collectionPromptTemplateLibrary";
import { TemplateLibraryModal } from "../components/TemplateLibraryModal";
/* global process */

const FETCH_BATCH_SIZE = 250;
const BULK_GENERATE_INTENT = "bulk_generate";
const MAX_BULK_ITEMS = 50;
const MIN_BULK_COLLECTION_SELECTION_ERROR = "Select at least one collection for bulk generation.";
const MAX_BULK_COLLECTION_SELECTION_ERROR = `You can bulk generate up to ${MAX_BULK_ITEMS} collections at a time.`;
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
          image {
            url
            altText
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
const LANGUAGE_OPTIONS = [
  "English",
  "English (British)",
  "English (US)",
  "Afrikaans",
  "Akan",
  "Albanian",
  "Amharic",
  "Arabic",
  "Armenian",
  "Assamese",
  "Aymara",
  "Azerbaijani",
  "Bambara",
  "Basque",
  "Belarusian",
  "Bengali",
  "Bhojpuri",
  "Bosnian",
  "Bulgarian",
  "Burmese",
  "Catalan",
  "Cebuano",
  "Chinese",
  "Chinese (Simplified)",
  "Chinese (Traditional)",
  "Corsican",
  "Croatian",
  "Czech",
  "Danish",
  "Dhivehi",
  "Dogri",
  "Dutch",
  "Esperanto",
  "Estonian",
  "Ewe",
  "Filipino",
  "Finnish",
  "French",
  "Frisian",
  "Galician",
  "Georgian",
  "German",
  "Greek",
  "Guarani",
  "Gujarati",
  "Haitian Creole",
  "Hausa",
  "Hawaiian",
  "Hebrew",
  "Hindi",
  "Hmong",
  "Hungarian",
  "Icelandic",
  "Igbo",
  "Ilocano",
  "Indonesian",
  "Irish",
  "Italian",
  "Japanese",
  "Javanese",
  "Kannada",
  "Kashmiri",
  "Kazakh",
  "Khmer",
  "Kinyarwanda",
  "Konkani",
  "Korean",
  "Krio",
  "Kurdish (Kurmanji)",
  "Kurdish (Sorani)",
  "Kyrgyz",
  "Lao",
  "Latin",
  "Latvian",
  "Lingala",
  "Lithuanian",
  "Luganda",
  "Luxembourgish",
  "Macedonian",
  "Maithili",
  "Malagasy",
  "Malay",
  "Malayalam",
  "Maltese",
  "Maori",
  "Marathi",
  "Meiteilon (Manipuri)",
  "Mizo",
  "Mongolian",
  "Nepali",
  "Norwegian",
  "Nyanja (Chichewa)",
  "Odia",
  "Oromo",
  "Pashto",
  "Persian",
  "Polish",
  "Portuguese",
  "Punjabi",
  "Quechua",
  "Romanian",
  "Russian",
  "Samoan",
  "Sanskrit",
  "Scots Gaelic",
  "Sepedi",
  "Serbian",
  "Sesotho",
  "Shona",
  "Sindhi",
  "Sinhala",
  "Slovak",
  "Slovenian",
  "Somali",
  "Spanish",
  "Sundanese",
  "Swahili",
  "Swedish",
  "Tajik",
  "Tamil",
  "Tatar",
  "Telugu",
  "Thai",
  "Tigrinya",
  "Tsonga",
  "Turkish",
  "Turkmen",
  "Twi",
  "Ukrainian",
  "Urdu",
  "Uyghur",
  "Uzbek",
  "Vietnamese",
  "Welsh",
  "Xhosa",
  "Yiddish",
  "Yoruba",
  "Zulu",
];
const TONE_OPTIONS = ["Professional", "Neutral", "Friendly", "Playful"];
const LENGTH_OPTIONS = ["50 - 150 words", "100 - 200 words", "200 - 300 words"];
const FORMAT_OPTIONS = [
  "Single paragraph",
  "1 Paragraph with Bullet List",
  "2 Paragraph",
  "3 Paragraph",
  "Custom Formatting",
];
const KEYWORD_CHIPS = ["[Description]"];
const BULK_KEYWORD_OPTIONS = [
  ...KEYWORD_CHIPS,
  "Benefits",
  "Features",
  "Materials",
  "Use cases",
  "Target audience",
];

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
  if (length < 80) return { label: "Too short", tone: "warning" };
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

function toSeoPalette(tone) {
  if (tone === "success") {
    return {
      background: "#d8f1df",
      border: "#b2e4be",
      text: "#1f7a39",
      dot: "#27a34a",
    };
  }

  if (tone === "warning" || tone === "caution") {
    return {
      background: "#f2cf92",
      border: "#e8bc74",
      text: "#7a4d10",
      dot: "#d48c1e",
    };
  }

  if (tone === "critical") {
    return {
      background: "#f4c8d2",
      border: "#eeb3c1",
      text: "#b13b53",
      dot: "#ef4f70",
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

function toParagraphHtml(value) {
  const plainText = (value || "").trim();
  if (!plainText) return "";

  return plainText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
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
    select: { openaiApiKey: true, anthropicApiKey: true },
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
              intent: "all",
            },
            {
              aiProvider,
              shopOpenaiKey: shopData?.openaiApiKey || null,
              shopAnthropicKey: shopData?.anthropicApiKey || null,
            },
          );

          const nextDescription = generated.collectionDescription
            ? toParagraphHtml(generated.collectionDescription)
            : c.descriptionHtml || "";
          const nextSeoTitle = generated.seoTitle || c.seoTitleValue || "";
          const nextSeoDescription = generated.seoDescription || c.seoDescriptionValue || "";

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
            intent: BULK_GENERATE_INTENT,
            language: language || null,
            tone: tone || null,
            lengthOption: lengthOption || null,
            formatOption: formatOption || null,
            contextKeywords: contextKeywords || null,
            aiModel: generated.aiModel || null,
            generatedDescription: nextDescription || null,
            generatedSeoTitle: nextSeoTitle || null,
            generatedSeoDescription: nextSeoDescription || null,
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
            aiModel: generated.aiModel || null,
            descriptionHtml: nextDescription || null,
            seoTitle: nextSeoTitle || null,
            seoDescription: nextSeoDescription || null,
            appliedToCollection: true,
          });

          return { id: c.id, title: c.title, seoTitle: nextSeoTitle, seoDescription: nextSeoDescription };
        }),
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      const itemResults = results.map((r, i) => ({
        id: bulkCollections[i].id,
        title: bulkCollections[i].title,
        status: r.status === "fulfilled" ? "success" : "failed",
        error: r.status === "rejected" ? r.reason?.message : null,
        seoTitle: r.status === "fulfilled" ? r.value.seoTitle : null,
        seoDescription: r.status === "fulfilled" ? r.value.seoDescription : null,
      }));
      return { ok: true, intent, succeeded, failed, total: bulkCollections.length, results: itemResults };
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
    select: { openaiApiKey: true, anthropicApiKey: true, defaultAiProvider: true },
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
      imageUrl: node.image?.url || null,
      imageAlt: node.image?.altText || node.title,
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
  const { filters, collections, defaultAiProvider } = useLoaderData();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const bulkFetcher = useFetcher();
  const shopify = useAppBridge();
  const [searchValue, setSearchValue] = useState(filters.search);
  const [fallbackCollections, setFallbackCollections] = useState(collections);
  const [bulkDescTemplate, setBulkDescTemplate] = useState("");
  const [bulkMetaDescTemplate, setBulkMetaDescTemplate] = useState("");
  const [bulkMetaTitleTemplate, setBulkMetaTitleTemplate] = useState("");
  const [bulkSettings, setBulkSettings] = useState({ ...bulkInitialSettings, aiProvider: defaultAiProvider });
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkKeywordQuery, setBulkKeywordQuery] = useState("");
  const [bulkSelectedKeywords, setBulkSelectedKeywords] = useState([]);
  const [bulkCustomKeywordInput, setBulkCustomKeywordInput] = useState("");
  const [bulkCustomKeywords, setBulkCustomKeywords] = useState([]);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState([]);
  const [bulkValidationMessage, setBulkValidationMessage] = useState(null);
  const [bulkContentTypes, setBulkContentTypes] = useState(["description"]);
  const [useCustomInstructions, setUseCustomInstructions] = useState(false);
  const [useCustomMetaDescInstructions, setUseCustomMetaDescInstructions] = useState(false);
  const [useCustomMetaTitleInstructions, setUseCustomMetaTitleInstructions] = useState(false);
  const [templateLib, setTemplateLib] = useState({ open: false, tab: "description", target: "descriptionPromptTemplate" });
  const [showAdvancedBulkSettings, setShowAdvancedBulkSettings] = useState(false);
  const bulkResultHandledRef = useRef(false);

  const collectionTemplatesByTab = {
    description: COLLECTION_DESCRIPTION_TEMPLATES,
    "seo-description": COLLECTION_META_DESCRIPTION_TEMPLATES,
    "seo-title": COLLECTION_META_TITLE_TEMPLATES,
  };
  const collectionTemplateTabs = [
    { id: "description", label: "Description" },
    { id: "seo-description", label: "Meta Description" },
    { id: "seo-title", label: "Meta Title" },
  ];
  function openCollectionTemplateLib(tab, target) {
    setTemplateLib({ open: true, tab, target });
  }
  function handleCollectionUseTemplate(templateText) {
    if (templateLib.target === "descriptionPromptTemplate") { setBulkDescTemplate(templateText); setUseCustomInstructions(true); }
    else if (templateLib.target === "metaDescriptionPromptTemplate") { setBulkMetaDescTemplate(templateText); setUseCustomMetaDescInstructions(true); }
    else if (templateLib.target === "metaTitlePromptTemplate") { setBulkMetaTitleTemplate(templateText); setUseCustomMetaTitleInstructions(true); }
    setTemplateLib((s) => ({ ...s, open: false }));
  }

  useEffect(() => {
    const templateSelection = readStoredCollectionPromptTemplateSelection();
    if (templateSelection.descriptionPromptTemplate) setBulkDescTemplate(templateSelection.descriptionPromptTemplate);
    if (templateSelection.metaTitlePromptTemplate) setBulkMetaTitleTemplate(templateSelection.metaTitlePromptTemplate);
    if (templateSelection.metaDescriptionPromptTemplate) setBulkMetaDescTemplate(templateSelection.metaDescriptionPromptTemplate);
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

  const visibleCollectionIds = useMemo(
    () => filteredCollections.map((collection) => collection.id),
    [filteredCollections],
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
    const contextKeywords = mergeUniqueKeywords(bulkSelectedKeywords, bulkCustomKeywords).join(", ");
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
    payload.append("language", bulkSettings.language);
    payload.append("tone", bulkSettings.tone);
    payload.append("length", bulkSettings.length);
    payload.append("format", bulkSettings.format);
    payload.append("contextKeywords", contextKeywords);
    payload.append("descriptionPromptTemplate", bulkDescTemplate || "");
    payload.append("metaTitlePromptTemplate", bulkMetaTitleTemplate || "");
    payload.append("metaDescriptionPromptTemplate", bulkMetaDescTemplate || "");
    payload.append("aiProvider", bulkSettings.aiProvider);
    bulkFetcher.submit(payload, { method: "post" });
  }, [
    bulkCustomKeywords,
    bulkDescTemplate,
    bulkMetaDescTemplate,
    bulkMetaTitleTemplate,
    bulkFetcher,
    bulkSelectedKeywords,
    bulkSettings,
    selectedCollections,
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
      shopify.toast.show(`Bulk generate complete: ${response.succeeded}/${response.total} updated.`);
      return;
    }
    setBulkValidationMessage(response.error || "Bulk generation failed.");
  }, [bulkFetcher.state, bulkFetcher.data, revalidator, shopify]);

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
    { title: "Select" },
    { title: "Image" },
    { title: "Title" },
    { title: "App Status" },
    { title: "Generated In" },
    { title: "SEO Title" },
    { title: "SEO Description" },
  ];

  const languageSelectOptions = LANGUAGE_OPTIONS.map((lang) => ({ label: lang, value: lang }));
  const toneSelectOptions = TONE_OPTIONS.map((t) => ({ label: t, value: t }));
  const lengthSelectOptions = LENGTH_OPTIONS.map((l) => ({ label: l, value: l }));
  const formatSelectOptions = FORMAT_OPTIONS.map((f) => ({ label: f, value: f }));

  const updateBulkField = (field) => (value) =>
    setBulkSettings((prev) => ({ ...prev, [field]: value }));

  const btnStyle = { padding: "5px 12px", borderRadius: "6px", border: "1px solid #1a1a1a", background: "#1a1a1a", color: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap" };
  const resetBtnStyle = { padding: "4px 10px", borderRadius: "5px", border: "1px solid #d1d5db", background: "#f9fafb", color: "#374151", cursor: "pointer", fontSize: "12px", fontWeight: 500 };

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

  const bulkKeywordOptions = useMemo(() => {
    const query = bulkKeywordQuery.trim().toLowerCase();
    return BULK_KEYWORD_OPTIONS
      .filter((keyword) => !bulkSelectedKeywords.includes(keyword))
      .filter((keyword) => !query || keyword.toLowerCase().includes(query))
      .map((keyword) => ({ label: keyword, value: keyword }));
  }, [bulkKeywordQuery, bulkSelectedKeywords]);

  const bulkKeywordTags = useMemo(
    () => mergeUniqueKeywords(bulkSelectedKeywords, bulkCustomKeywords),
    [bulkCustomKeywords, bulkSelectedKeywords],
  );

  const handleBulkKeywordSelect = useCallback((selected) => {
    setBulkSelectedKeywords(selected);
    setBulkKeywordQuery("");
  }, []);

  const handleAddBulkCustomKeyword = useCallback(() => {
    const nextKeyword = normalizeKeyword(bulkCustomKeywordInput);
    if (!nextKeyword) return;
    setBulkCustomKeywords((current) => mergeUniqueKeywords(current, [nextKeyword]));
    setBulkCustomKeywordInput("");
  }, [bulkCustomKeywordInput]);

  const handleRemoveBulkKeyword = useCallback((keywordToRemove) => {
    const target = keywordToRemove.toLowerCase();
    setBulkSelectedKeywords((current) =>
      current.filter((keyword) => keyword.toLowerCase() !== target),
    );
    setBulkCustomKeywords((current) =>
      current.filter((keyword) => keyword.toLowerCase() !== target),
    );
  }, []);

  const bulkKeywordTextField = (
    <Autocomplete.TextField
      label="AI Context & Keywords"
      value={bulkKeywordQuery}
      onChange={setBulkKeywordQuery}
      placeholder="Select one or more context keywords"
      autoComplete="off"
    />
  );

  const rowMarkup = filteredCollections.map((collection, index) => (
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
        {collection.imageUrl ? (
          <Thumbnail
            source={collection.imageUrl}
            alt={collection.imageAlt}
            size="small"
          />
        ) : (
          <Box
            width="52px"
            minHeight="52px"
            borderRadius="150"
            borderWidth="025"
            borderColor="border-secondary"
            background="bg-surface-secondary"
          >
            <InlineStack align="center" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                No img
              </Text>
            </InlineStack>
          </Box>
        )}
      </IndexTable.Cell>

      <IndexTable.Cell>
        <div className="collections-title-cell">
          <Text as="span" variant="bodyMd" fontWeight="medium">
            {collection.title}
          </Text>
        </div>
      </IndexTable.Cell>

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

      <IndexTable.Cell>
        <Text as="span" tone={collection.generatedTime === "Not generated" ? "subdued" : undefined}>
          {collection.generatedTime}
        </Text>
      </IndexTable.Cell>

      <IndexTable.Cell>
        {renderBadge(collection.seoTitle)}
      </IndexTable.Cell>

      <IndexTable.Cell>
        {renderBadge(collection.seoDescription)}
      </IndexTable.Cell>

    </IndexTable.Row>
  ));

  return (
    <Page fullWidth>
      {/* ── Hero Header ── */}
      <div style={{
        background: "linear-gradient(135deg, #1c0a00 0%, #431407 50%, #1a2e00 100%)",
        borderRadius: "6px",
        padding: "28px 32px",
        marginBottom: "24px",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: "-50px", right: "-50px", width: "220px", height: "220px", borderRadius: "50%", background: "radial-gradient(circle, rgba(249,115,22,0.3) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "-40px", left: "25%", width: "160px", height: "160px", borderRadius: "50%", background: "radial-gradient(circle, rgba(234,179,8,0.18) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 1, flexWrap: "wrap", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ width: "54px", height: "54px", borderRadius: "6px", background: "rgba(249,115,22,0.2)", border: "1px solid rgba(249,115,22,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", flexShrink: 0 }}>
              🗂️
            </div>
            <div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#ffffff", marginBottom: "3px", letterSpacing: "-0.3px" }}>Collections</div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.55)", lineHeight: 1.4 }}>Optimize your collection pages with AI-generated descriptions</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => navigate(makeUrl({}))}
              style={{ padding: "7px 16px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
            >↺ Refresh</button>
            <button
              onClick={() => navigate("/app")}
              style={{ padding: "7px 16px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
            >← Back</button>
            <button
              disabled
              style={{ padding: "7px 16px", borderRadius: "6px", border: "none", background: "linear-gradient(135deg, #f97316, #eab308)", color: "#fff", cursor: "not-allowed", fontSize: "13px", fontWeight: 600, opacity: 0.75 }}
            >⚡ Upgrade Plan</button>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "16px", alignItems: "flex-start", marginTop: "0" }}>
        {/* ── LEFT: Collection List ── */}
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
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

          {/* Products/Collections Tab Toggle */}
          <div style={{ marginBottom: "16px" }}>
            <InlineStack gap="0" blockAlign="center">
              <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: "6px", overflow: "hidden" }}>
                <button
                  onClick={() => navigate("/app/products")}
                  style={{ padding: "6px 16px", background: "#fff", color: "#374151", border: "none", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                >
                  Products
                </button>
                <button
                  onClick={() => {}}
                  style={{ padding: "6px 16px", background: "#1a1a1a", color: "#fff", border: "none", borderLeft: "1px solid #d1d5db", cursor: "pointer", fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}
                >
                  ✓ Collections
                </button>
              </div>
              <div style={{ marginLeft: "auto" }}>
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
            </InlineStack>
          </div>

          <Card padding="0">
            <BlockStack gap="0">
              <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <InlineStack align="space-between" blockAlign="center">
                  <Checkbox
                    label={`Select all visible (${filteredCollections.length})`}
                    checked={allVisibleSelected}
                    indeterminate={selectionIndeterminate}
                    onChange={handleToggleSelectAllVisible}
                  />
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
                <div className="collections-table-wrap">
                  <IndexTable
                    resourceName={{ singular: "collection", plural: "collections" }}
                    itemCount={filteredCollections.length}
                    headings={tableHeadings}
                    selectable={false}
                    loading={isSearchLoading}
                  >
                    {rowMarkup}
                  </IndexTable>
                </div>
              )}

              <div style={{ padding: "8px 16px", borderTop: "1px solid var(--p-color-border)" }}>
                <Text as="span" tone="subdued" variant="bodySm">
                  {filteredCollections.length} result{filteredCollections.length !== 1 ? "s" : ""}
                  {isSearchLoading ? " (Searching...)" : isLoading ? " (Loading...)" : ""}
                </Text>
              </div>
            </BlockStack>
          </Card>
        </div>

        {/* ── RIGHT: Bulk Settings Panel ── */}
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          <Card padding="0">
            <div style={{ padding: "16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd" fontWeight="bold">Collection Bulk Order Settings</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Descriptions will be generated for {selectedCollections.length} collection{selectedCollections.length !== 1 ? "s" : ""}
                </Text>
              </BlockStack>
            </div>

            {/* Content Type Pills */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {[
                  { id: "description", label: "Description" },
                  { id: "meta_description", label: "Meta Description" },
                  { id: "meta_title", label: "Meta Title" },
                ].map((type) => {
                  const isActive = bulkContentTypes.includes(type.id);
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
                        padding: "4px 12px",
                        borderRadius: "6px",
                        border: isActive ? "none" : "1px solid #d1d5db",
                        background: isActive ? "#1a1a1a" : "transparent",
                        color: isActive ? "#fff" : "#374151",
                        cursor: "pointer",
                        fontSize: "13px",
                        fontWeight: isActive ? 600 : 400,
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      {isActive && <span>✓</span>}
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
                options={languageSelectOptions}
                value={bulkSettings.language}
                onChange={updateBulkField("language")}
              />
            </div>

            {/* Description Settings */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm" fontWeight="semibold">Description</Text>
                <button onClick={() => openCollectionTemplateLib("description", "descriptionPromptTemplate")} style={btnStyle}>Browse Templates</button>
              </InlineStack>
              <div style={{ marginTop: "8px" }}>
                <Checkbox
                  label={<span style={{ fontSize: "13px", color: "#374151" }}>Use custom instructions <span style={{ fontSize: "13px" }}>✨</span></span>}
                  checked={useCustomInstructions}
                  onChange={setUseCustomInstructions}
                />
                {useCustomInstructions && (
                  <div style={{ marginTop: "8px" }}>
                    <TextField
                      label="Custom Prompt" labelHidden
                      value={bulkDescTemplate}
                      onChange={setBulkDescTemplate}
                      multiline={3}
                      placeholder="Enter custom instructions for description generation..."
                      autoComplete="off"
                    />
                    {bulkDescTemplate && (
                      <div style={{ marginTop: "4px" }}>
                        <button onClick={() => setBulkDescTemplate("")} style={resetBtnStyle}>↺ Reset to Default</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Meta Description Settings */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm" fontWeight="semibold">Meta Description</Text>
                <button onClick={() => openCollectionTemplateLib("seo-description", "metaDescriptionPromptTemplate")} style={btnStyle}>Browse Templates</button>
              </InlineStack>
              <div style={{ marginTop: "8px" }}>
                <Checkbox
                  label={<span style={{ fontSize: "13px", color: "#374151" }}>Use custom instructions <span style={{ fontSize: "13px" }}>✨</span></span>}
                  checked={useCustomMetaDescInstructions}
                  onChange={setUseCustomMetaDescInstructions}
                />
                {useCustomMetaDescInstructions && (
                  <div style={{ marginTop: "8px" }}>
                    <TextField
                      label="Custom Prompt" labelHidden
                      value={bulkMetaDescTemplate}
                      onChange={setBulkMetaDescTemplate}
                      multiline={3}
                      placeholder="Enter custom instructions for meta description generation..."
                      autoComplete="off"
                    />
                    {bulkMetaDescTemplate && (
                      <div style={{ marginTop: "4px" }}>
                        <button onClick={() => setBulkMetaDescTemplate("")} style={resetBtnStyle}>↺ Reset to Default</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Meta Title Settings */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm" fontWeight="semibold">Meta Title</Text>
                <button onClick={() => openCollectionTemplateLib("seo-title", "metaTitlePromptTemplate")} style={btnStyle}>Browse Templates</button>
              </InlineStack>
              <div style={{ marginTop: "8px" }}>
                <Checkbox
                  label={<span style={{ fontSize: "13px", color: "#374151" }}>Use custom instructions <span style={{ fontSize: "13px" }}>✨</span></span>}
                  checked={useCustomMetaTitleInstructions}
                  onChange={setUseCustomMetaTitleInstructions}
                />
                {useCustomMetaTitleInstructions && (
                  <div style={{ marginTop: "8px" }}>
                    <TextField
                      label="Custom Prompt" labelHidden
                      value={bulkMetaTitleTemplate}
                      onChange={setBulkMetaTitleTemplate}
                      multiline={3}
                      placeholder="Enter custom instructions for meta title generation..."
                      autoComplete="off"
                    />
                    {bulkMetaTitleTemplate && (
                      <div style={{ marginTop: "4px" }}>
                        <button onClick={() => setBulkMetaTitleTemplate("")} style={resetBtnStyle}>↺ Reset to Default</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Show Advanced Settings toggle */}
            <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <button
                onClick={() => setShowAdvancedBulkSettings((v) => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "13px", color: "#374151", display: "flex", alignItems: "center", gap: "6px", padding: "0", fontWeight: 500 }}
              >
                <span>{showAdvancedBulkSettings ? "▲" : "▼"}</span>
                {showAdvancedBulkSettings ? "Hide" : "Show"} Advanced Settings
              </button>
            </div>

            {/* Advanced Settings (collapsed by default) */}
            {showAdvancedBulkSettings && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <BlockStack gap="300">
                  <Select
                    label="Tone"
                    options={toneSelectOptions}
                    value={bulkSettings.tone}
                    onChange={updateBulkField("tone")}
                  />
                  <Select
                    label="Length"
                    options={lengthSelectOptions}
                    value={bulkSettings.length}
                    onChange={updateBulkField("length")}
                  />
                  <Select
                    label="Format"
                    options={formatSelectOptions}
                    value={bulkSettings.format}
                    onChange={updateBulkField("format")}
                  />
                  <BlockStack gap="200">
                    <Autocomplete
                      allowMultiple
                      options={bulkKeywordOptions}
                      selected={bulkSelectedKeywords}
                      textField={bulkKeywordTextField}
                      onSelect={handleBulkKeywordSelect}
                    />
                    <InlineStack gap="200" blockAlign="end">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Custom keyword"
                          labelHidden
                          value={bulkCustomKeywordInput}
                          onChange={setBulkCustomKeywordInput}
                          placeholder="Add custom keyword"
                          autoComplete="off"
                        />
                      </div>
                      <Button onClick={handleAddBulkCustomKeyword} disabled={!bulkCustomKeywordInput.trim()}>Add</Button>
                    </InlineStack>
                    {bulkKeywordTags.length > 0 && (
                      <InlineStack gap="200" wrap>
                        {bulkKeywordTags.map((keyword) => (
                          <Tag key={keyword} onRemove={() => handleRemoveBulkKeyword(keyword)}>{keyword}</Tag>
                        ))}
                      </InlineStack>
                    )}
                  </BlockStack>

                  <Select
                    label="AI Provider"
                    options={[
                      { label: "Auto", value: "auto" },
                      { label: "OpenAI", value: "openai" },
                      { label: "Anthropic", value: "anthropic" },
                      { label: "Ollama", value: "ollama" },
                    ]}
                    value={bulkSettings.aiProvider}
                    onChange={updateBulkField("aiProvider")}
                  />
                </BlockStack>
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

            {/* Validation error */}
            {bulkValidationMessage && (
              <div style={{ padding: "8px 16px" }}>
                <Banner tone="critical"><p>{bulkValidationMessage}</p></Banner>
              </div>
            )}

            {/* Generate Button */}
            <div style={{ padding: "12px 16px" }}>
              {isBulkGenerating && (
                <div style={{ marginBottom: "8px" }}>
                  <InlineStack align="center" blockAlign="center" gap="200">
                    <Spinner size="small" />
                    <Text variant="bodySm" tone="subdued">Generating for {selectedCollections.length} collections...</Text>
                  </InlineStack>
                </div>
              )}
              <Button
                fullWidth
                variant="primary"
                onClick={handleBulkGenerate}
                disabled={isBulkGenerating || selectedCollections.length === 0 || exceedsBulkLimit}
                tone="success"
                icon={<span style={{ fontSize: "14px" }}>✏️</span>}
              >
                {isBulkGenerating
                  ? "Generating..."
                  : `Generate ${selectedCollections.length} items (${selectedCollections.length} collections × ${bulkContentTypes.length} types)`}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <style>{`
        .collections-table-wrap .Polaris-IndexTable__ScrollContainer {
          overflow-x: hidden !important;
        }
        .collections-table-wrap .Polaris-IndexTable__TableCell {
          white-space: nowrap !important;
        }
        .collections-title-cell {
          max-width: 360px;
          white-space: normal !important;
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
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd" fontWeight="bold">Generation Results</Text>
                <Badge tone={bulkResult.failed > 0 ? "warning" : "success"}>
                  {bulkResult.succeeded}/{bulkResult.total} succeeded
                </Badge>
              </InlineStack>
            </div>
            <IndexTable
              resourceName={{ singular: "collection", plural: "collections" }}
              itemCount={bulkResult.results.length}
              selectable={false}
              headings={[
                { title: "Collection" },
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
          </Card>
        </div>
      )}

      {/* Template Library Popup */}
      <TemplateLibraryModal
        key={templateLib.tab}
        open={templateLib.open}
        onClose={() => setTemplateLib((s) => ({ ...s, open: false }))}
        tabs={collectionTemplateTabs}
        initialTab={templateLib.tab}
        templatesByTab={collectionTemplatesByTab}
        onUseTemplate={handleCollectionUseTemplate}
      />
    </Page>
  );
}
