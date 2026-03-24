import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useFetcher,
  useLoaderData,
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
  ButtonGroup,
  Card,
  Divider,
  EmptyState,
  Grid,
  IndexTable,
  InlineStack,
  Layout,
  Modal,
  Page,
  Pagination,
  Select,
  Spinner,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import { ViewIcon, UndoIcon } from "@shopify/polaris-icons";
import db from "../db.server";
import { authenticate } from "../shopify.server";
/* global process */

const PAGE_SIZE = 8;
const EDIT_MODAL_ID = "collection-edit-modal";
const GENERATE_ALL_INTENT = "generate_all";
const GENERATE_META_TITLE_INTENT = "generate_meta_title";
const GENERATE_META_DESCRIPTION_INTENT = "generate_meta_description";
const UPDATE_COLLECTION_INTENT = "update_collection";
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
const DESCRIPTION_STYLE_OPTIONS = ["Normal", "Heading", "Subheading"];

const editInitialState = {
  title: "",
  description: "",
  descriptionStyle: "Normal",
  seoTitle: "",
  seoDescription: "",
  language: "English",
  tone: "Neutral",
  length: "50 - 150 words",
  format: "Single paragraph",
  contextKeywords: "",
  aiProvider: "auto",
};

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

function parseLengthRange(lengthOption) {
  const match = /(\d+)\s*-\s*(\d+)/.exec(lengthOption || "");
  if (!match) return { min: 50, max: 150 };
  return {
    min: Number(match[1]),
    max: Number(match[2]),
  };
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
  intent,
}) {
  const { min, max } = parseLengthRange(lengthOption);
  const focus =
    intent === GENERATE_META_TITLE_INTENT
      ? "Primary focus: generate a strong meta title."
      : intent === GENERATE_META_DESCRIPTION_INTENT
        ? "Primary focus: generate a strong meta description."
        : "Primary focus: generate collection description, meta title, and meta description.";

  return [
    "Generate Shopify-ready content and return strict JSON only.",
    "",
    focus,
    `Language: ${language || "English"}`,
    `Tone: ${tone || "Neutral"}`,
    `Description word range: ${min}-${max}`,
    `Description format: ${format || "Single paragraph"}`,
    `Collection title: ${title || "Untitled collection"}`,
    `Current collection description: ${descriptionText || "Not available"}`,
    `Current meta title (SEO title): ${seoTitle || "Not available"}`,
    `Current meta description (SEO description): ${seoDescription || "Not available"}`,
    `Keywords/context: ${contextKeywords || "Not provided"}`,
    "",
    "Return only valid JSON with these keys:",
    '{ "collectionDescription": "...", "seoTitle": "...", "seoDescription": "..." }',
    "",
    "Rules:",
    "- No markdown, no code fences.",
    "- Meta title max 70 characters.",
    "- Meta description max 160 characters.",
    "- Collection description should be natural and conversion-focused.",
  ].join("\n");
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
  const collectionId = readFormString(formData, "collectionId");

  if (!collectionId) {
    return { ok: false, intent, error: "Collection id is required." };
  }

  const title = readFormString(formData, "title");
  const descriptionHtml = readFormString(formData, "description");
  const seoTitle = readFormString(formData, "seoTitle");
  const seoDescription = readFormString(formData, "seoDescription");
  const language = readFormString(formData, "language");
  const tone = readFormString(formData, "tone");
  const lengthOption = readFormString(formData, "length");
  const formatOption = readFormString(formData, "format");
  const contextKeywords = readFormString(formData, "contextKeywords");
  const aiProvider = readFormString(formData, "aiProvider") || "auto";

  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { openaiApiKey: true, anthropicApiKey: true },
  });

  try {
    if (
      intent === GENERATE_ALL_INTENT ||
      intent === GENERATE_META_TITLE_INTENT ||
      intent === GENERATE_META_DESCRIPTION_INTENT
    ) {
      const generated = await generateContent(
        {
          title,
          descriptionText: stripHtml(descriptionHtml),
          seoTitle,
          seoDescription,
          language,
          tone,
          lengthOption,
          format: formatOption,
          contextKeywords,
          intent,
        },
        {
          aiProvider,
          shopOpenaiKey: shopData?.openaiApiKey || null,
          shopAnthropicKey: shopData?.anthropicApiKey || null,
        },
      );

      let nextDescription = descriptionHtml;
      let nextSeoTitle = seoTitle;
      let nextSeoDescription = seoDescription;

      if (intent === GENERATE_ALL_INTENT && generated.collectionDescription) {
        nextDescription = toParagraphHtml(generated.collectionDescription);
      }
      if (
        (intent === GENERATE_ALL_INTENT || intent === GENERATE_META_TITLE_INTENT) &&
        generated.seoTitle
      ) {
        nextSeoTitle = generated.seoTitle;
      }
      if (
        (intent === GENERATE_ALL_INTENT || intent === GENERATE_META_DESCRIPTION_INTENT) &&
        generated.seoDescription
      ) {
        nextSeoDescription = generated.seoDescription;
      }

      await writeGenerationLog({
        shop: session.shop,
        productId: collectionId,
        productTitle: title || null,
        intent,
        language: language || null,
        tone: tone || null,
        lengthOption: lengthOption || null,
        formatOption: formatOption || null,
        contextKeywords: contextKeywords || null,
        aiModel: generated.aiModel || null,
        generatedDescription: nextDescription || null,
        generatedSeoTitle: nextSeoTitle || null,
        generatedSeoDescription: nextSeoDescription || null,
        appliedToProduct: false,
      });

      await upsertCollectionGeneratedContent({
        shop: session.shop,
        collectionId,
        collectionTitle: title || null,
        language: language || null,
        tone: tone || null,
        lengthOption: lengthOption || null,
        formatOption: formatOption || null,
        contextKeywords: contextKeywords || null,
        aiModel: generated.aiModel || null,
        descriptionHtml: nextDescription || null,
        seoTitle: nextSeoTitle || null,
        seoDescription: nextSeoDescription || null,
        appliedToCollection: false,
      });

      return {
        ok: true,
        intent,
        collectionId,
        message: "AI content generated successfully.",
        content: {
          description: nextDescription,
          seoTitle: nextSeoTitle,
          seoDescription: nextSeoDescription,
        },
      };
    }

    if (intent === UPDATE_COLLECTION_INTENT) {
      const updateInputPayload = {
        id: collectionId,
        descriptionHtml,
        seo: {
          title: seoTitle,
          description: seoDescription,
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

      let updateJson = null;
      let lastGraphqlErrors = [];

      for (let attemptIndex = 0; attemptIndex < mutationAttempts.length; attemptIndex += 1) {
        const attempt = mutationAttempts[attemptIndex];
        const updateResponse = await admin.graphql(attempt.mutation, {
          variables: attempt.variables,
        });
        const candidate = await updateResponse.json();
        const graphqlErrors = candidate?.errors?.map((item) => item?.message).filter(Boolean) || [];

        if (graphqlErrors.length > 0) {
          lastGraphqlErrors = graphqlErrors;
          const schemaMismatch =
            /unknown type|unknown argument|cannot query field|is not defined|expected type/i.test(
              graphqlErrors.join(" "),
            );
          const isLastAttempt = attemptIndex === mutationAttempts.length - 1;
          if (!isLastAttempt && schemaMismatch) {
            continue;
          }

          return {
            ok: false,
            intent,
            collectionId,
            error: graphqlErrors.join(" "),
          };
        }

        updateJson = candidate;
        break;
      }

      if (!updateJson) {
        return {
          ok: false,
          intent,
          collectionId,
          error:
            lastGraphqlErrors.join(" ") ||
            "Unable to update collection due to GraphQL schema mismatch.",
        };
      }

      const userErrors = updateJson?.data?.collectionUpdate?.userErrors || [];
      if (userErrors.length > 0) {
        return {
          ok: false,
          intent,
          collectionId,
          error: userErrors.map((item) => item?.message).filter(Boolean).join(" "),
        };
      }

      const updatedCollection = updateJson?.data?.collectionUpdate?.collection;

      await writeGenerationLog({
        shop: session.shop,
        productId: collectionId,
        productTitle: title || null,
        intent,
        language: language || null,
        tone: tone || null,
        lengthOption: lengthOption || null,
        formatOption: formatOption || null,
        contextKeywords: contextKeywords || null,
        aiModel: null,
        generatedDescription: descriptionHtml || null,
        generatedSeoTitle: seoTitle || null,
        generatedSeoDescription: seoDescription || null,
        appliedToProduct: true,
      });

      await upsertCollectionGeneratedContent({
        shop: session.shop,
        collectionId,
        collectionTitle: title || null,
        language: language || null,
        tone: tone || null,
        lengthOption: lengthOption || null,
        formatOption: formatOption || null,
        contextKeywords: contextKeywords || null,
        aiModel: null,
        descriptionHtml: descriptionHtml || null,
        seoTitle: seoTitle || null,
        seoDescription: seoDescription || null,
        appliedToCollection: true,
      });

      return {
        ok: true,
        intent,
        collectionId,
        message: "Collection updated successfully in Shopify.",
        content: {
          description: updatedCollection?.descriptionHtml || descriptionHtml,
          seoTitle: updatedCollection?.seo?.title || seoTitle,
          seoDescription: updatedCollection?.seo?.description || seoDescription,
        },
      };
    }

    return { ok: false, intent, collectionId, error: "Unsupported action." };
  } catch (error) {
    console.error("Collection content action failed", error);
    return {
      ok: false,
      intent,
      collectionId,
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
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const isPreviousPage = Boolean(before && !after);

  const query = toSearchQuery(searchForQuery);

  const response = await admin.graphql(
    `#graphql
      query CollectionList(
        $first: Int
        $last: Int
        $after: String
        $before: String
        $query: String
      ) {
        collections(
          first: $first
          last: $last
          after: $after
          before: $before
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
            hasPreviousPage
            startCursor
            endCursor
          }
        }
      }
    `,
    {
      variables: {
        first: isPreviousPage ? undefined : PAGE_SIZE,
        last: isPreviousPage ? PAGE_SIZE : undefined,
        after: isPreviousPage ? undefined : after || undefined,
        before: isPreviousPage ? before : undefined,
        query: query || undefined,
      },
    },
  );

  const responseJson = await response.json();
  const collectionConnection = responseJson?.data?.collections;

  if (!collectionConnection) {
    console.error("Failed to fetch collections", responseJson?.errors);
    return {
      filters: { search },
      collections: [],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
    };
  }

  const collections = collectionConnection.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    descriptionHtml: node.descriptionHtml || "",
    descriptionText: stripHtml(node.descriptionHtml),
    descriptionStatus: evaluateDescription(stripHtml(node.descriptionHtml)),
    seoTitle: evaluateSeoTitle(node.seo?.title || node.title),
    seoDescription: evaluateSeoDescription(node.seo?.description),
    seoTitleValue: node.seo?.title || "",
    seoDescriptionValue: node.seo?.description || "",
    imageUrl: node.image?.url || null,
    imageAlt: node.image?.altText || node.title,
    collectionType: toCollectionTypeMeta(node.ruleSet),
    productsCount: node.productsCount?.count || 0,
    updatedAt: formatDate(node.updatedAt),
  }));

  return {
    filters: { search },
    collections,
    pageInfo: collectionConnection.pageInfo,
    hasOpenaiKey: !!(shopData?.openaiApiKey || process.env.OPENAI_API_KEY),
    hasAnthropicKey: !!(shopData?.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
    defaultAiProvider: shopData?.defaultAiProvider || "auto",
  };
};

export default function CollectionsPage() {
  const { filters, collections, pageInfo, hasOpenaiKey, hasAnthropicKey, defaultAiProvider } = useLoaderData();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const generateFetcher = useFetcher();
  const updateFetcher = useFetcher();
  const descriptionEditorRef = useRef(null);
  const [searchValue, setSearchValue] = useState(filters.search);
  const [fallbackCollections, setFallbackCollections] = useState(collections);
  const [editingCollection, setEditingCollection] = useState(null);
  const [editForm, setEditForm] = useState(editInitialState);
  const [modalMessage, setModalMessage] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

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

  const makeUrl = useCallback(
    ({ search = searchValue.trim(), before, after } = {}) => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (before) params.set("before", before);
      if (after) params.set("after", after);
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

  const resetEditModalState = useCallback(() => {
    setEditingCollection(null);
    setEditForm(editInitialState);
    setModalMessage(null);
    setModalOpen(false);
  }, []);

  const openEditModal = useCallback((collection) => {
    setEditingCollection(collection);
    setModalMessage(null);
    setEditForm({
      ...editInitialState,
      aiProvider: defaultAiProvider,
      title: collection.title || "",
      description: collection.descriptionHtml || collection.descriptionText || "",
      seoTitle: collection.seoTitleValue || "",
      seoDescription: collection.seoDescriptionValue || "",
    });
    setModalOpen(true);
  }, [defaultAiProvider]);

  const updateEditField = useCallback((field, value) => {
    setEditForm((current) => ({ ...current, [field]: value }));
  }, []);

  const appendKeywordChip = useCallback((chip) => {
    setEditForm((current) => {
      const currentValue = current.contextKeywords.trim();
      const nextValue = currentValue ? `${currentValue} ${chip}` : chip;
      return { ...current, contextKeywords: nextValue };
    });
  }, []);

  const applyDescriptionCommand = useCallback(
    (command, value) => {
      const editor = descriptionEditorRef.current;
      if (!editor || typeof document === "undefined") return;

      editor.focus();
      document.execCommand(command, false, value);
      updateEditField("description", editor.innerHTML || "");
    },
    [updateEditField],
  );

  const handleDescriptionStyleChange = useCallback(
    (styleValue) => {
      updateEditField("descriptionStyle", styleValue || "Normal");

      if (styleValue === "Heading") {
        applyDescriptionCommand("formatBlock", "H2");
        return;
      }

      if (styleValue === "Subheading") {
        applyDescriptionCommand("formatBlock", "H3");
        return;
      }

      applyDescriptionCommand("formatBlock", "P");
    },
    [applyDescriptionCommand, updateEditField],
  );

  const handleDescriptionLink = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = window.prompt("Enter link URL");
    if (!url) return;
    applyDescriptionCommand("createLink", url);
  }, [applyDescriptionCommand]);

  const submitEditAction = useCallback(
    (intent) => {
      if (!editingCollection?.id) return;

      setModalMessage(null);
      const payload = {
        intent,
        collectionId: editingCollection.id,
        title: editForm.title,
        description: editForm.description,
        seoTitle: editForm.seoTitle,
        seoDescription: editForm.seoDescription,
        language: editForm.language,
        tone: editForm.tone,
        length: editForm.length,
        format: editForm.format,
        contextKeywords: editForm.contextKeywords,
        aiProvider: editForm.aiProvider,
      };

      if (intent === UPDATE_COLLECTION_INTENT) {
        updateFetcher.submit(payload, { method: "post" });
        return;
      }

      generateFetcher.submit(payload, { method: "post" });
    },
    [editForm, editingCollection, generateFetcher, updateFetcher],
  );

  const handleGenerateMetaTitle = useCallback(
    () => submitEditAction(GENERATE_META_TITLE_INTENT),
    [submitEditAction],
  );

  const handleGenerateMetaDescription = useCallback(
    () => submitEditAction(GENERATE_META_DESCRIPTION_INTENT),
    [submitEditAction],
  );

  const handleGenerate = useCallback(
    () => submitEditAction(GENERATE_ALL_INTENT),
    [submitEditAction],
  );

  const handleUpdateCollection = useCallback(
    () => submitEditAction(UPDATE_COLLECTION_INTENT),
    [submitEditAction],
  );

  const isGenerating = generateFetcher.state !== "idle";
  const isUpdating = updateFetcher.state !== "idle";
  const canUpdateCollection = Boolean(editingCollection?.id) && !isGenerating && !isUpdating;

  useEffect(() => {
    const response = generateFetcher.data;
    if (!response || response.collectionId !== editingCollection?.id) return;

    if (!response.ok) {
      setModalMessage({
        tone: "critical",
        text: response.error || "AI generation failed.",
      });
      return;
    }

    setEditForm((current) => ({
      ...current,
      description: response.content?.description ?? current.description,
      seoTitle: response.content?.seoTitle ?? current.seoTitle,
      seoDescription: response.content?.seoDescription ?? current.seoDescription,
    }));

    setModalMessage({
      tone: "success",
      text: response.message || "AI content generated successfully.",
    });
  }, [editingCollection?.id, generateFetcher.data]);

  useEffect(() => {
    const response = updateFetcher.data;
    if (!response || response.collectionId !== editingCollection?.id) return;

    if (!response.ok) {
      setModalMessage({
        tone: "critical",
        text: response.error || "Collection update failed.",
      });
      return;
    }

    setEditForm((current) => ({
      ...current,
      description: response.content?.description ?? current.description,
      seoTitle: response.content?.seoTitle ?? current.seoTitle,
      seoDescription: response.content?.seoDescription ?? current.seoDescription,
    }));

    setModalMessage({
      tone: "success",
      text: response.message || "Collection updated successfully.",
    });
    revalidator.revalidate();
  }, [editingCollection?.id, revalidator, updateFetcher.data]);

  const metaTitleStatus = evaluateSeoTitle(editForm.seoTitle);
  const metaDescriptionStatus = evaluateSeoDescription(editForm.seoDescription);
  const isDescriptionEmpty = !stripHtml(editForm.description).trim();
  const metaTitleLength = editForm.seoTitle.length;
  const metaDescriptionLength = editForm.seoDescription.length;

  useEffect(() => {
    const editor = descriptionEditorRef.current;
    if (!editor) return;

    const nextHtml = editForm.description || "";
    if (editor.innerHTML !== nextHtml) {
      editor.innerHTML = nextHtml;
    }
  }, [editForm.description]);

  const previousUrl =
    pageInfo.hasPreviousPage && pageInfo.startCursor
      ? makeUrl({ search: filters.search, before: pageInfo.startCursor })
      : null;
  const nextUrl =
    pageInfo.hasNextPage && pageInfo.endCursor
      ? makeUrl({ search: filters.search, after: pageInfo.endCursor })
      : null;

  const tableHeadings = [
    { title: "Image" },
    { title: "Title" },
    { title: "SEO Title" },
    { title: "SEO Description" },
    { title: "Actions" },
  ];

  const languageSelectOptions = LANGUAGE_OPTIONS.map((lang) => ({ label: lang, value: lang }));
  const toneSelectOptions = TONE_OPTIONS.map((t) => ({ label: t, value: t }));
  const lengthSelectOptions = LENGTH_OPTIONS.map((l) => ({ label: l, value: l }));
  const formatSelectOptions = FORMAT_OPTIONS.map((f) => ({ label: f, value: f }));
  const descriptionStyleSelectOptions = DESCRIPTION_STYLE_OPTIONS.map((s) => ({
    label: s,
    value: s,
  }));
  const aiProviderOptions = [
    { label: "Auto (use configured key)", value: "auto" },
    ...(hasOpenaiKey ? [{ label: "ChatGPT (OpenAI)", value: "openai" }] : []),
    ...(hasAnthropicKey ? [{ label: "Claude (Anthropic)", value: "anthropic" }] : []),
  ];

  return (
    <Page title="Collections">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" align="start" blockAlign="center">
                <Button url="/app" variant="plain">
                  &larr; Back
                </Button>
                <Button onClick={() => navigate(makeUrl({}))}>Refresh</Button>
                <Button disabled>Upgrade for Bulk Generation</Button>
              </InlineStack>

              <TextField
                label="Search collections"
                labelHidden
                placeholder="Search by collection title..."
                value={searchValue}
                onChange={handleSearchInput}
                autoComplete="off"
                prefix={isSearchLoading ? <Spinner size="small" /> : undefined}
              />

              {filteredCollections.length === 0 ? (
                <EmptyState
                  heading="No collections found"
                  image=""
                >
                  <Text as="p" tone="subdued">
                    {normalizedSearch
                      ? `No collections match "${normalizedSearch}". Try a different search.`
                      : "No collections are available in your store."}
                  </Text>
                </EmptyState>
              ) : (
                <IndexTable
                  resourceName={{ singular: "collection", plural: "collections" }}
                  itemCount={filteredCollections.length}
                  headings={tableHeadings}
                  selectable={false}
                  loading={isSearchLoading}
                >
                  {filteredCollections.map((collection, index) => (
                    <IndexTable.Row
                      id={collection.id}
                      key={collection.id}
                      position={index}
                    >
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
                            borderRadius="200"
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
                        <Text as="span" variant="bodyMd" fontWeight="medium">
                          {collection.title}
                        </Text>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        {renderBadge(collection.seoTitle)}
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        {renderBadge(collection.seoDescription)}
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Button
                          size="slim"
                          onClick={() => openEditModal(collection)}
                        >
                          Edit Content
                        </Button>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}

              <InlineStack align="space-between" blockAlign="center" gap="300">
                <Text as="span" variant="bodySm" tone="subdued">
                  {filteredCollections.length} result{filteredCollections.length !== 1 ? "s" : ""}
                  {isSearchLoading ? " (Searching...)" : isLoading ? " (Loading...)" : ""}
                </Text>
                <Pagination
                  hasPrevious={Boolean(previousUrl)}
                  onPrevious={() => previousUrl && navigate(previousUrl)}
                  hasNext={Boolean(nextUrl)}
                  onNext={() => nextUrl && navigate(nextUrl)}
                />
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={resetEditModalState}
        title="Edit Collection Content"
        size="large"
      >
        <Modal.Section>
          {!editingCollection ? (
            <Banner tone="info">
              Select a collection and click <strong>Edit Content</strong> to open editor.
            </Banner>
          ) : (
            <BlockStack gap="400">
              {modalMessage ? (
                <Banner
                  tone={modalMessage.tone === "critical" ? "critical" : "success"}
                  onDismiss={() => setModalMessage(null)}
                >
                  {modalMessage.text}
                </Banner>
              ) : null}

              <Grid>
                {/* ── Left column: description + SEO ── */}
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 7, lg: 7, xl: 7 }}>
                  <Card>
                    <BlockStack gap="400">
                      <TextField
                        label="Collection Title"
                        value={editForm.title}
                        readOnly
                        autoComplete="off"
                      />

                      {/* Description editor */}
                      <BlockStack gap="200">
                        <Text as="p" variant="headingSm">Description</Text>
                        <Box
                          borderWidth="025"
                          borderColor="border"
                          borderRadius="200"
                          background="bg-surface"
                        >
                          <Box
                            padding="200"
                            background="bg-surface-secondary"
                            borderBlockEndWidth="025"
                            borderColor="border"
                          >
                            <InlineStack gap="200" blockAlign="center" wrap>
                              <Box minWidth="124px">
                                <Select
                                  label="Description style"
                                  labelHidden
                                  options={descriptionStyleSelectOptions}
                                  value={editForm.descriptionStyle}
                                  onChange={handleDescriptionStyleChange}
                                />
                              </Box>
                              <ButtonGroup>
                                <Button size="slim" onClick={() => applyDescriptionCommand("bold")} accessibilityLabel="Bold"><strong>B</strong></Button>
                                <Button size="slim" onClick={() => applyDescriptionCommand("italic")} accessibilityLabel="Italic"><em>I</em></Button>
                                <Button size="slim" onClick={() => applyDescriptionCommand("underline")} accessibilityLabel="Underline"><span style={{ textDecoration: "underline" }}>U</span></Button>
                                <Button size="slim" onClick={() => applyDescriptionCommand("strikeThrough")} accessibilityLabel="Strikethrough"><span style={{ textDecoration: "line-through" }}>S</span></Button>
                                <Button size="slim" onClick={handleDescriptionLink} accessibilityLabel="Link">Link</Button>
                                <Button size="slim" onClick={() => applyDescriptionCommand("insertUnorderedList")} accessibilityLabel="Bullet list">• List</Button>
                                <Button size="slim" onClick={() => applyDescriptionCommand("insertOrderedList")} accessibilityLabel="Numbered list">1. List</Button>
                                <Button size="slim" onClick={() => applyDescriptionCommand("removeFormat")} accessibilityLabel="Clear formatting">Clear</Button>
                              </ButtonGroup>
                            </InlineStack>
                          </Box>
                          <Box padding="300" background="bg-surface">
                            <div style={{ position: "relative", minHeight: "120px" }}>
                              {isDescriptionEmpty && (
                                <span style={{ position: "absolute", top: 0, left: 0, color: "var(--p-color-text-disabled)", fontSize: "14px", pointerEvents: "none" }}>
                                  Enter collection description…
                                </span>
                              )}
                              <div
                                ref={descriptionEditorRef}
                                contentEditable
                                suppressContentEditableWarning
                                style={{ minHeight: "120px", fontSize: "14px", lineHeight: 1.6, color: "var(--p-color-text)", outline: "none", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                                role="textbox"
                                aria-label="Description body"
                                onInput={(e) => updateEditField("description", e.currentTarget.innerHTML || "")}
                              />
                            </div>
                          </Box>
                        </Box>
                      </BlockStack>

                      <Divider />

                      {/* SEO Title */}
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="h3" variant="headingSm">SEO Title</Text>
                          <Badge tone={toBadgeTone(metaTitleStatus.tone)}>{metaTitleStatus.label}</Badge>
                          <Text as="span" variant="bodySm" tone="subdued">{metaTitleLength}/70</Text>
                        </InlineStack>
                        <TextField
                          label="SEO Title"
                          labelHidden
                          value={editForm.seoTitle}
                          onChange={(value) => updateEditField("seoTitle", value || "")}
                          maxLength={70}
                          showCharacterCount
                          placeholder="Enter SEO title…"
                          autoComplete="off"
                        />
                        <Text as="p" variant="bodySm" tone="subdued">
                          Optimal: 40–70 characters. Current: {metaTitleLength} chars.
                        </Text>
                        <InlineStack align="end">
                          <Button
                            variant="primary"
                            tone="success"
                            disabled={isGenerating || isUpdating}
                            onClick={handleGenerateMetaTitle}
                            loading={isGenerating}
                          >
                            {isGenerating ? "Generating…" : "Generate SEO Title"}
                          </Button>
                        </InlineStack>
                      </BlockStack>

                      <Divider />

                      {/* SEO Description */}
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="h3" variant="headingSm">SEO Description</Text>
                          <Badge tone={toBadgeTone(metaDescriptionStatus.tone)}>{metaDescriptionStatus.label}</Badge>
                          <Text as="span" variant="bodySm" tone="subdued">{metaDescriptionLength}/160</Text>
                        </InlineStack>
                        <TextField
                          label="SEO Description"
                          labelHidden
                          value={editForm.seoDescription}
                          onChange={(value) => updateEditField("seoDescription", value || "")}
                          maxLength={160}
                          showCharacterCount
                          multiline={4}
                          placeholder="Enter SEO description…"
                          autoComplete="off"
                        />
                        <Text as="p" variant="bodySm" tone="subdued">
                          Optimal: 140–160 characters. Current: {metaDescriptionLength} chars.
                        </Text>
                        <InlineStack align="end">
                          <Button
                            variant="primary"
                            tone="success"
                            disabled={isGenerating || isUpdating}
                            onClick={handleGenerateMetaDescription}
                            loading={isGenerating}
                          >
                            {isGenerating ? "Generating…" : "Generate SEO Description"}
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>

                {/* ── Right column: AI settings + actions ── */}
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 5, lg: 5, xl: 5 }}>
                  <Card>
                    <BlockStack gap="400">
                      <Text as="h3" variant="headingSm">AI Settings</Text>

                      <Select
                        label="AI Provider"
                        options={aiProviderOptions}
                        value={editForm.aiProvider}
                        onChange={(value) => updateEditField("aiProvider", value || "auto")}
                        helpText="Choose which AI to use for generation."
                      />

                      <Divider />

                      <Select
                        label="Language"
                        options={languageSelectOptions}
                        value={editForm.language}
                        onChange={(value) => updateEditField("language", value || "")}
                      />
                      <Select
                        label="Tone"
                        options={toneSelectOptions}
                        value={editForm.tone}
                        onChange={(value) => updateEditField("tone", value || "")}
                      />
                      <Select
                        label="Length (Words)"
                        options={lengthSelectOptions}
                        value={editForm.length}
                        onChange={(value) => updateEditField("length", value || "")}
                      />
                      <Select
                        label="Description Format"
                        options={formatSelectOptions}
                        value={editForm.format}
                        onChange={(value) => updateEditField("format", value || "")}
                      />

                      <BlockStack gap="200">
                        <TextField
                          label="AI Context & Keywords"
                          value={editForm.contextKeywords}
                          onChange={(value) => updateEditField("contextKeywords", value || "")}
                          multiline={4}
                          placeholder="List features, keywords, or brand notes…"
                          autoComplete="off"
                        />
                        <InlineStack gap="150" wrap>
                          {KEYWORD_CHIPS.map((chip) => (
                            <Button key={chip} size="slim" onClick={() => appendKeywordChip(chip)}>
                              {chip}
                            </Button>
                          ))}
                        </InlineStack>
                      </BlockStack>

                      <Divider />

                      <Button
                        variant="primary"
                        fullWidth
                        size="large"
                        disabled={isGenerating || isUpdating}
                        onClick={handleGenerate}
                        loading={isGenerating}
                      >
                        {isGenerating ? "Generating…" : "✦ Generate All Content"}
                      </Button>

                      <InlineStack align="space-between" blockAlign="center">
                        <ButtonGroup>
                          <Button
                            size="slim"
                            icon={ViewIcon}
                            accessibilityLabel="Preview"
                          />
                          <Button
                            size="slim"
                            icon={UndoIcon}
                            accessibilityLabel="Undo"
                          />
                          <Button
                            size="slim"
                            variant="plain"
                            tone="critical"
                            onClick={resetEditModalState}
                          >
                            Cancel
                          </Button>
                        </ButtonGroup>
                        <Button
                          variant="primary"
                          disabled={!canUpdateCollection}
                          onClick={handleUpdateCollection}
                          loading={isUpdating}
                        >
                          {isUpdating ? "Saving…" : "Save to Shopify"}
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              </Grid>
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}
