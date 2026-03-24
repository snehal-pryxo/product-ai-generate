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
  Tabs,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import db from "../db.server";
import { authenticate } from "../shopify.server";
/* global process */

const PAGE_SIZE = 8;
const STATUS_FILTERS = ["all", "active", "draft"];
const EDIT_MODAL_ID = "product-edit-modal";
const GENERATE_ALL_INTENT = "generate_all";
const GENERATE_SEO_TITLE_INTENT = "generate_seo_title";
const GENERATE_SEO_DESCRIPTION_INTENT = "generate_seo_description";
const UPDATE_PRODUCT_INTENT = "update_product";
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
const KEYWORD_CHIPS = ["[Description]", "[Category]", "[Variant Titles]", "[Vendor]"];
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
    intent === GENERATE_SEO_TITLE_INTENT
      ? "Primary focus: generate a strong meta title."
      : intent === GENERATE_SEO_DESCRIPTION_INTENT
        ? "Primary focus: generate a strong meta description."
        : "Primary focus: generate product description, meta title, and meta description.";

  return [
    "Generate Shopify-ready content and return strict JSON only.",
    "",
    focus,
    `Language: ${language || "English"}`,
    `Tone: ${tone || "Neutral"}`,
    `Description word range: ${min}-${max}`,
    `Description format: ${format || "Single paragraph"}`,
    `Product title: ${title || "Untitled product"}`,
    `Current product description: ${descriptionText || "Not available"}`,
    `Current meta title (SEO title): ${seoTitle || "Not available"}`,
    `Current meta description (SEO description): ${seoDescription || "Not available"}`,
    `Keywords/context: ${contextKeywords || "Not provided"}`,
    "",
    "Return only valid JSON with these keys:",
    '{ "productDescription": "...", "seoTitle": "...", "seoDescription": "..." }',
    "",
    "Rules:",
    "- No markdown, no code fences.",
    "- Meta title max 70 characters.",
    "- Meta description max 160 characters.",
    "- Product description should be natural and conversion-focused.",
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

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = readFormString(formData, "intent");
  const productId = readFormString(formData, "productId");

  if (!productId) {
    return { ok: false, intent, error: "Product id is required." };
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
      intent === GENERATE_SEO_TITLE_INTENT ||
      intent === GENERATE_SEO_DESCRIPTION_INTENT
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

      if (intent === GENERATE_ALL_INTENT && generated.productDescription) {
        nextDescription = toParagraphHtml(generated.productDescription);
      }
      if (
        (intent === GENERATE_ALL_INTENT || intent === GENERATE_SEO_TITLE_INTENT) &&
        generated.seoTitle
      ) {
        nextSeoTitle = generated.seoTitle;
      }
      if (
        (intent === GENERATE_ALL_INTENT || intent === GENERATE_SEO_DESCRIPTION_INTENT) &&
        generated.seoDescription
      ) {
        nextSeoDescription = generated.seoDescription;
      }

      await writeGenerationLog({
        shop: session.shop,
        productId,
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

      return {
        ok: true,
        intent,
        productId,
        message: "AI content generated successfully.",
        content: {
          description: nextDescription,
          seoTitle: nextSeoTitle,
          seoDescription: nextSeoDescription,
        },
      };
    }

    if (intent === UPDATE_PRODUCT_INTENT) {
      const updateResponse = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
        variables: {
          product: {
            id: productId,
            descriptionHtml,
            seo: {
              title: seoTitle,
              description: seoDescription,
            },
          },
        },
      });

      const updateJson = await updateResponse.json();
      const graphqlErrors =
        updateJson?.errors?.map((item) => item?.message).filter(Boolean) || [];
      if (graphqlErrors.length > 0) {
        return {
          ok: false,
          intent,
          productId,
          error: graphqlErrors.join(" "),
        };
      }

      const userErrors = updateJson?.data?.productUpdate?.userErrors || [];
      if (userErrors.length > 0) {
        return {
          ok: false,
          intent,
          productId,
          error: userErrors.map((item) => item?.message).filter(Boolean).join(" "),
        };
      }

      const updatedProduct = updateJson?.data?.productUpdate?.product;

      await writeGenerationLog({
        shop: session.shop,
        productId,
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

      return {
        ok: true,
        intent,
        productId,
        message: "Product updated successfully in Shopify.",
        content: {
          description: updatedProduct?.descriptionHtml || descriptionHtml,
          seoTitle: updatedProduct?.seo?.title || seoTitle,
          seoDescription: updatedProduct?.seo?.description || seoDescription,
        },
      };
    }

    return { ok: false, intent, productId, error: "Unsupported action." };
  } catch (error) {
    console.error("Product content action failed", error);
    return {
      ok: false,
      intent,
      productId,
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
  const statusParam = (url.searchParams.get("status") || "all").toLowerCase();
  const status = STATUS_FILTERS.includes(statusParam) ? statusParam : "all";
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const isPreviousPage = Boolean(before && !after);

  const query = toSearchQuery({ search: searchForQuery, status });

  const response = await admin.graphql(
    `#graphql
      query ProductList(
        $first: Int
        $last: Int
        $after: String
        $before: String
        $query: String
      ) {
        products(
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
              status
              descriptionHtml
              seo {
                title
                description
              }
              featuredImage {
                url
                altText
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
  const productConnection = responseJson?.data?.products;

  if (!productConnection) {
    console.error("Failed to fetch products", responseJson?.errors);
    return {
      filters: { search, status },
      products: [],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
    };
  }

  const products = productConnection.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    descriptionHtml: node.descriptionHtml || "",
    descriptionText: stripHtml(node.descriptionHtml),
    status: toStatusMeta(node.status),
    seoTitle: evaluateSeoTitle(node.seo?.title || node.title),
    seoDescription: evaluateSeoDescription(node.seo?.description),
    seoTitleValue: node.seo?.title || "",
    seoDescriptionValue: node.seo?.description || "",
    imageUrl: node.featuredImage?.url || null,
    imageAlt: node.featuredImage?.altText || node.title,
  }));

  return {
    filters: { search, status },
    products,
    pageInfo: productConnection.pageInfo,
    hasOpenaiKey: !!(shopData?.openaiApiKey || process.env.OPENAI_API_KEY),
    hasAnthropicKey: !!(shopData?.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
    defaultAiProvider: shopData?.defaultAiProvider || "auto",
  };
};

export default function ProductsPage() {
  const { filters, products, pageInfo, hasOpenaiKey, hasAnthropicKey, defaultAiProvider } = useLoaderData();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const generateFetcher = useFetcher();
  const updateFetcher = useFetcher();
  const descriptionEditorRef = useRef(null);
  const [searchValue, setSearchValue] = useState(filters.search);
  const [fallbackProducts, setFallbackProducts] = useState(products);
  const [editingProduct, setEditingProduct] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editForm, setEditForm] = useState(editInitialState);
  const [modalMessage, setModalMessage] = useState(null);

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

  const makeUrl = useCallback(
    ({ status = filters.status, search = searchValue.trim(), before, after } = {}) => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (status && status !== "all") params.set("status", status);
      if (before) params.set("before", before);
      if (after) params.set("after", after);
      const query = params.toString();
      return query ? `?${query}` : "";
    },
    [filters.status, searchValue],
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
    setEditingProduct(null);
    setModalOpen(false);
    setEditForm(editInitialState);
    setModalMessage(null);
  }, []);

  const openEditModal = useCallback((product) => {
    setEditingProduct(product);
    setModalMessage(null);
    setEditForm({
      ...editInitialState,
      aiProvider: defaultAiProvider,
      title: product.title || "",
      description: product.descriptionHtml || product.descriptionText || "",
      seoTitle: product.seoTitleValue || "",
      seoDescription: product.seoDescriptionValue || "",
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
      if (!editingProduct?.id) return;

      setModalMessage(null);
      const payload = {
        intent,
        productId: editingProduct.id,
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

      if (intent === UPDATE_PRODUCT_INTENT) {
        updateFetcher.submit(payload, { method: "post" });
        return;
      }

      generateFetcher.submit(payload, { method: "post" });
    },
    [editForm, editingProduct, generateFetcher, updateFetcher],
  );

  const handleGenerateSeoTitle = useCallback(
    () => submitEditAction(GENERATE_SEO_TITLE_INTENT),
    [submitEditAction],
  );

  const handleGenerateSeoDescription = useCallback(
    () => submitEditAction(GENERATE_SEO_DESCRIPTION_INTENT),
    [submitEditAction],
  );

  const handleGenerate = useCallback(
    () => submitEditAction(GENERATE_ALL_INTENT),
    [submitEditAction],
  );

  const handleUpdateProduct = useCallback(
    () => submitEditAction(UPDATE_PRODUCT_INTENT),
    [submitEditAction],
  );

  const isGenerating = generateFetcher.state !== "idle";
  const isUpdating = updateFetcher.state !== "idle";
  const canUpdateProduct = Boolean(editingProduct?.id) && !isGenerating && !isUpdating;

  useEffect(() => {
    const response = generateFetcher.data;
    if (!response || response.productId !== editingProduct?.id) return;

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
  }, [editingProduct?.id, generateFetcher.data]);

  useEffect(() => {
    const response = updateFetcher.data;
    if (!response || response.productId !== editingProduct?.id) return;

    if (!response.ok) {
      setModalMessage({
        tone: "critical",
        text: response.error || "Product update failed.",
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
      text: response.message || "Product updated successfully.",
    });
    revalidator.revalidate();
  }, [editingProduct?.id, revalidator, updateFetcher.data]);

  const seoTitleStatus = evaluateSeoTitle(editForm.seoTitle);
  const seoDescriptionStatus = evaluateSeoDescription(editForm.seoDescription);
  const isDescriptionEmpty = !stripHtml(editForm.description).trim();
  const seoTitlePalette = toSeoPalette(seoTitleStatus.tone);
  const seoDescriptionPalette = toSeoPalette(seoDescriptionStatus.tone);
  const seoTitleLength = editForm.seoTitle.length;
  const seoDescriptionLength = editForm.seoDescription.length;

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
    { title: "Image" },
    { title: "Title" },
    { title: "Status" },
    { title: "Meta Title" },
    { title: "Meta Description" },
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

  const rowMarkup = filteredProducts.map((product, index) => (
    <IndexTable.Row id={product.id} key={product.id} position={index}>
      <IndexTable.Cell>
        {product.imageUrl ? (
          <Thumbnail
            source={product.imageUrl}
            alt={product.imageAlt}
            size="small"
          />
        ) : (
          <Thumbnail
            source=""
            alt={product.imageAlt}
            size="small"
          />
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="medium" as="span">
          {product.title}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {renderBadge({ label: product.status.label, tone: product.status.tone })}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {renderBadge({ label: product.seoTitle.label, tone: product.seoTitle.tone })}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {renderBadge({ label: product.seoDescription.label, tone: product.seoDescription.tone })}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button onClick={() => openEditModal(product)}>Edit Content</Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Products"
      primaryAction={
        <Button disabled>Upgrade for Bulk Generation</Button>
      }
      secondaryActions={[
        {
          content: "Refresh",
          onAction: () => navigate(makeUrl({})),
        },
        {
          content: "Back",
          url: "/app",
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <TextField
                label="Search products"
                labelHidden
                placeholder="Search by product title..."
                value={searchValue}
                onChange={handleSearchInput}
                autoComplete="off"
                prefix={
                  isSearchLoading ? <Spinner size="small" /> : undefined
                }
              />

              <Tabs
                tabs={statusTabs}
                selected={statusTabIndex}
                onSelect={handleTabChange}
              />

              {isSearchLoading ? (
                <Box padding="400">
                  <InlineStack align="center">
                    <Spinner size="small" />
                  </InlineStack>
                </Box>
              ) : filteredProducts.length === 0 ? (
                <EmptyState
                  heading="No products found"
                  image=""
                >
                  <Text as="p" tone="subdued">
                    Try adjusting your search or filter to find what you are looking for.
                  </Text>
                </EmptyState>
              ) : (
                <IndexTable
                  resourceName={resourceName}
                  itemCount={filteredProducts.length}
                  headings={headings}
                  selectable={false}
                >
                  {rowMarkup}
                </IndexTable>
              )}

              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" tone="subdued">
                  {filteredProducts.length} results{" "}
                  {isLoading && !isSearchLoading ? "(Loading...)" : ""}
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

      <style>{`.Polaris-Modal-Dialog__Modal { max-width: 66rem !important; }`}</style>
      <Modal
        open={modalOpen}
        onClose={resetEditModalState}
        title="Edit Product Content"
        large
        primaryAction={
          editingProduct
            ? {
                content: isUpdating ? "Updating..." : "Update Product",
                onAction: handleUpdateProduct,
                disabled: !canUpdateProduct,
                loading: isUpdating,
              }
            : undefined
        }
        secondaryActions={
          editingProduct
            ? [
                {
                  content: "Close",
                  onAction: resetEditModalState,
                },
              ]
            : [
                {
                  content: "Close",
                  onAction: resetEditModalState,
                },
              ]
        }
      >
        <Modal.Section>
          {!editingProduct ? (
            <Banner tone="info">
              Select a product and click <strong>Edit Content</strong> to open editor.
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
                {/* Left column: description + SEO fields */}
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 5, lg: 5, xl: 5 }}>
                <Card>
                  <BlockStack gap="400">
                    <TextField
                      label="Product Title"
                      value={editForm.title}
                      readOnly
                      autoComplete="off"
                      onChange={(value) => updateEditField("title", value || "")}
                    />

                    <BlockStack gap="200">
                      <Text variant="headingSm" as="h3">
                        Description
                      </Text>

                      <Box
                        borderWidth="025"
                        borderColor="border"
                        borderRadius="200"
                        background="bg-surface"
                      >
                        {/* Toolbar */}
                        <Box
                          padding="200"
                          background="bg-surface-secondary"
                          borderBlockEndWidth="025"
                          borderColor="border"
                        >
                          <InlineStack gap="200" blockAlign="center" wrap>
                          <Box minWidth="130px">
                            <Select
                              label="Description style"
                              labelHidden
                              options={descriptionStyleSelectOptions}
                              value={editForm.descriptionStyle}
                              onChange={handleDescriptionStyleChange}
                            />
                          </Box>
                          <ButtonGroup>
                            <Button
                              size="slim"
                              onClick={() => applyDescriptionCommand("bold")}
                              accessibilityLabel="Bold"
                            >
                              <strong>B</strong>
                            </Button>
                            <Button
                              size="slim"
                              onClick={() => applyDescriptionCommand("italic")}
                              accessibilityLabel="Italic"
                            >
                              <em>I</em>
                            </Button>
                            <Button
                              size="slim"
                              onClick={() => applyDescriptionCommand("underline")}
                              accessibilityLabel="Underline"
                            >
                              <span style={{ textDecoration: "underline" }}>U</span>
                            </Button>
                            <Button
                              size="slim"
                              onClick={() => applyDescriptionCommand("strikeThrough")}
                              accessibilityLabel="Strikethrough"
                            >
                              <span style={{ textDecoration: "line-through" }}>S</span>
                            </Button>
                            <Button
                              size="slim"
                              onClick={handleDescriptionLink}
                              accessibilityLabel="Link"
                            >
                              Link
                            </Button>
                            <Button
                              size="slim"
                              onClick={() => applyDescriptionCommand("insertUnorderedList")}
                              accessibilityLabel="Bullet list"
                            >
                              UL
                            </Button>
                            <Button
                              size="slim"
                              onClick={() => applyDescriptionCommand("insertOrderedList")}
                              accessibilityLabel="Numbered list"
                            >
                              OL
                            </Button>
                            <Button
                              size="slim"
                              onClick={() => applyDescriptionCommand("removeFormat")}
                              accessibilityLabel="Clear formatting"
                            >
                              Clear
                            </Button>
                          </ButtonGroup>
                          </InlineStack>
                        </Box>

                        {/* Editor body */}
                        <Box padding="300" background="bg-surface">
                          <div style={{ position: "relative", minHeight: "120px" }}>
                          {isDescriptionEmpty ? (
                            <span
                              style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                color: "var(--p-color-text-disabled)",
                                fontSize: "14px",
                                pointerEvents: "none",
                              }}
                            >
                              Enter product description...
                            </span>
                          ) : null}
                          <div
                            ref={descriptionEditorRef}
                            contentEditable
                            suppressContentEditableWarning
                            style={{
                              minHeight: "360px",
                              fontSize: "14px",
                              lineHeight: 1.55,
                              color: "var(--p-color-text)",
                              outline: "none",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                            role="textbox"
                            aria-label="Description body"
                            onInput={(event) =>
                              updateEditField("description", event.currentTarget.innerHTML || "")
                            }
                          />
                          </div>
                        </Box>
                      </Box>
                    </BlockStack>

                    <Divider />

                    {/* SEO Title */}
                    <BlockStack gap="200">
                      <InlineStack gap="200" blockAlign="center">
                        <Text variant="headingSm" as="h3">
                          Meta Title
                        </Text>
                        <Badge tone={toBadgeTone(seoTitleStatus.tone)}>
                          {seoTitleStatus.label}
                        </Badge>
                      </InlineStack>

                      <TextField
                          label="Meta Title"
                          labelHidden
                          value={editForm.seoTitle}
                          maxLength={70}
                          showCharacterCount
                          placeholder="Enter meta title..."
                          autoComplete="off"
                          onChange={(value) => updateEditField("seoTitle", value || "")}
                        />

                      <Text as="p" tone="subdued" variant="bodySm">
                        Optimal Meta Title length: 40 to 70 characters. (Too short: less than
                        40, Too long: more than 70)
                      </Text>

                      <InlineStack align="end">
                        <Button
                          onClick={handleGenerateSeoTitle}
                          loading={isGenerating}
                          disabled={isGenerating || isUpdating}
                        >
                          {isGenerating ? "Generating..." : "Generate"}
                        </Button>
                      </InlineStack>
                    </BlockStack>

                    <Divider />

                    {/* SEO Description */}
                    <BlockStack gap="200">
                      <InlineStack gap="200" blockAlign="center">
                        <Text variant="headingSm" as="h3">
                          Meta Description
                        </Text>
                        <Badge tone={toBadgeTone(seoDescriptionStatus.tone)}>
                          {seoDescriptionStatus.label}
                        </Badge>
                      </InlineStack>

                      <TextField
                          label="Meta Description"
                          labelHidden
                          value={editForm.seoDescription}
                          maxLength={160}
                          showCharacterCount
                          placeholder="Enter meta description..."
                          multiline={4}
                          autoComplete="off"
                          onChange={(value) => updateEditField("seoDescription", value || "")}
                        />

                      <Text as="p" tone="subdued" variant="bodySm">
                        Optimal Meta Description length: 140 to 160 characters. (Too short: less
                        than 140, Too long: more than 160)
                      </Text>

                      <InlineStack align="end">
                        <Button
                          onClick={handleGenerateSeoDescription}
                          loading={isGenerating}
                          disabled={isGenerating || isUpdating}
                        >
                          {isGenerating ? "Generating..." : "Generate"}
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </BlockStack>
                </Card>
                </Grid.Cell>

                {/* Right column: AI settings + generate */}
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 7, lg: 7, xl: 7 }}>
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
                        placeholder="List product features or keywords"
                        multiline={5}
                        autoComplete="off"
                        onChange={(value) =>
                          updateEditField("contextKeywords", value || "")
                        }
                      />
                      <InlineStack gap="200" wrap>
                        {KEYWORD_CHIPS.map((chip) => (
                          <Button
                            key={chip}
                            size="slim"
                            onClick={() => appendKeywordChip(chip)}
                          >
                            {chip}
                          </Button>
                        ))}
                      </InlineStack>
                    </BlockStack>

                    <Button
                      variant="primary"
                      fullWidth
                      onClick={handleGenerate}
                      loading={isGenerating}
                      disabled={isGenerating || isUpdating}
                    >
                      {isGenerating ? "Generating..." : "Generate"}
                    </Button>
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
