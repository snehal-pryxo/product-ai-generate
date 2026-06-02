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
  Box,
  BlockStack,
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
import {
  CollectionIcon,
  ProductIcon,
  SearchIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  XIcon,
  ExternalIcon,
} from "@shopify/polaris-icons";
import { openAddCreditModal } from "../components/AddCreditModal";
import db from "../db.server";
import { inngest } from "../inngest/client";
import { authenticate } from "../shopify.server";
import { buildCollectionContentPrompt, getCollectionSystemPrompt } from "../lib/contentPromptTemplates";
import { TemplateLibraryModal } from "../components/TemplateLibraryModal";
import { getExactWordLengthOption, normalizeStoredGlobalSettings, readGlobalSettings } from "../lib/globalSettings";
import {
  readStoredCollectionPromptTemplateSelection,
  COLLECTION_DESCRIPTION_TEMPLATES,
  COLLECTION_META_DESCRIPTION_TEMPLATES,
  COLLECTION_META_TITLE_TEMPLATES,
} from "../lib/collectionPromptTemplateLibrary";
import {
  buildInsufficientCreditsError,
  creditsForBatch,
  creditsForContentTypes,
  deductCredits,
  parseSelectedContentTypes,
} from "../lib/credits.server";
const FETCH_BATCH_SIZE = 250;
const BULK_GENERATE_INTENT = "bulk_generate";
const COLLECTION_PRODUCTS_MODE = "collection-products";
const MAX_BULK_ITEMS = 500;
const MIN_BULK_COLLECTION_SELECTION_ERROR = "Select at least one collection for bulk generation.";
const MAX_BULK_COLLECTION_SELECTION_ERROR = `You can bulk generate up to ${MAX_BULK_ITEMS} collections at a time.`;
const COLLECTION_CONTENT_TYPES = ["description", "meta_title", "meta_description"];
const DEFAULT_COLLECTION_CONTENT_TYPES = ["description", "meta_title", "meta_description"];
const COLLECTION_CONTENT_TYPE_CREDIT_COSTS = {
  description: 1,
  meta_title: 1,
  meta_description: 1,
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


const DEFAULT_COLLECTION_DESCRIPTION_CUSTOM_PROMPT = `Write a clear, engaging, and SEO-friendly collection description for the given collection.

Focus on:
- What type of products are in this collection
- Who this collection is best for
- Key value/benefits customers get
- Search-friendly structure with natural keywords

Format:
- 1 short intro paragraph
- 3-5 bullet points for highlights
- 1 closing CTA line

Tone: clear, trustworthy, and conversion-focused.`;

const DEFAULT_META_DESCRIPTION_CUSTOM_PROMPT = `Generate SEO-optimized meta description for given collection.

Focus on:
- Primary keyword naturally included
- Clear value proposition
- Call to action
- 140-160 characters max
- Compelling and click-worthy

Format: Engaging description that drives clicks from search results.`;

const DEFAULT_META_TITLE_CUSTOM_PROMPT = `Generate SEO-optimized meta title for the given collection.

Requirements:
- Primary keyword placement
- Brand name inclusion
- Under 60 characters
- Compelling and descriptive
- Search-friendly format

Focus on click-through rate optimization.`;


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
          image {
            url
            altText
          }
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
            updatedAt
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

const COLLECTION_PRODUCT_SEARCH_QUERY = `#graphql
  query CollectionProductSearch(
    $first: Int
    $after: String
    $query: String
  ) {
    products(first: $first, after: $after, query: $query, sortKey: TITLE) {
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
          updatedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const COLLECTION_TITLE_QUERY = `#graphql
  query CollectionTitle($id: ID!) {
    collection(id: $id) {
      title
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

function toSearchQuery(search) {
  if (!search) return "";
  const escapedSearch = escapeSearchValue(search);
  const titleQuery = escapedSearch.includes(" ") ? `"${escapedSearch}"` : escapedSearch;
  return `title:${titleQuery}`;
}

function toCollectionProductSearchQuery(collectionId, searchQuery) {
  const collectionLegacyId = String(collectionId || "").split("/").pop();
  return [collectionLegacyId ? `collection_id:${collectionLegacyId}` : "", searchQuery]
    .filter(Boolean)
    .join(" ");
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

function toProductStatusMeta(status) {
  if (status === "ACTIVE") return { label: "Active", tone: "success" };
  if (status === "DRAFT") return { label: "Draft", tone: "warning" };
  if (status === "ARCHIVED") return { label: "Archived", tone: "caution" };
  return { label: status || "Unknown", tone: "neutral" };
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

function clientCreditsForContentTypes(contentTypes) {
  return (contentTypes || []).reduce(
    (sum, type) => sum + (COLLECTION_CONTENT_TYPE_CREDIT_COSTS[type] ?? 1),
    0,
  );
}

function clientCreditsForBatch(contentTypes, itemsCount) {
  if (!itemsCount || itemsCount < 1) return 0;
  return clientCreditsForContentTypes(contentTypes) * itemsCount;
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

function toLegacyResourceId(gid) {
  return String(gid || "").split("/").pop() || "";
}

async function fetchCollectionProducts(admin, collectionId, searchQuery = "") {
  const productNodes = [];
  let productCursor;
  let collectionTitle = "";
  const productSearchQuery = toCollectionProductSearchQuery(collectionId, searchQuery);

  if (searchQuery) {
    const titleRes = await admin.graphql(COLLECTION_TITLE_QUERY, { variables: { id: collectionId } });
    const titleJson = await titleRes.json();
    collectionTitle = titleJson?.data?.collection?.title || "";

    while (true) {
      const productRes = await admin.graphql(COLLECTION_PRODUCT_SEARCH_QUERY, {
        variables: {
          first: FETCH_BATCH_SIZE,
          after: productCursor,
          query: productSearchQuery || undefined,
        },
      });
      const productJson = await productRes.json();
      const productConnection = productJson?.data?.products;
      if (!productConnection) break;

      const nodes = (productConnection.edges || []).map(({ node }) => node);
      productNodes.push(...nodes);

      if (!productConnection.pageInfo?.hasNextPage || !productConnection.pageInfo?.endCursor) {
        break;
      }
      productCursor = productConnection.pageInfo.endCursor;
    }

    return {
      collectionTitle,
      products: productNodes.map((node) => ({
        id: node.id,
        title: node.title,
        handle: node.handle || "",
        status: node.status,
        descriptionHtml: node.descriptionHtml || "",
        seoTitleValue: node.seo?.title || "",
        seoDescriptionValue: node.seo?.description || "",
        updatedAt: node.updatedAt,
      })),
    };
  }

  while (true) {
    const productRes = await admin.graphql(COLLECTION_PRODUCTS_QUERY, {
      variables: {
        id: collectionId,
        first: FETCH_BATCH_SIZE,
        after: productCursor,
      },
    });
    const productJson = await productRes.json();
    const collectionData = productJson?.data?.collection;
    if (!collectionData) break;
    collectionTitle = collectionData.title || collectionTitle;

    const productConnection = collectionData.products;
    const nodes = (productConnection?.edges || []).map(({ node }) => node);
    productNodes.push(...nodes);

    if (!productConnection?.pageInfo?.hasNextPage || !productConnection?.pageInfo?.endCursor) {
      break;
    }
    productCursor = productConnection.pageInfo.endCursor;
  }

  return {
    collectionTitle,
    products: productNodes.map((node) => ({
      id: node.id,
      title: node.title,
      handle: node.handle || "",
      status: node.status,
      descriptionHtml: node.descriptionHtml || "",
      seoTitleValue: node.seo?.title || "",
      seoDescriptionValue: node.seo?.description || "",
      updatedAt: node.updatedAt,
    })),
  };
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
      system: getCollectionSystemPrompt(),
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
        parts: [{ text: getCollectionSystemPrompt() }],
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
        content: getCollectionSystemPrompt(),
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
    collectionDescription: (
      parsed?.collectionDescription ||
      parsed?.productDescription ||
      parsed?.description ||
      ""
    ).trim(),
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
            content: getCollectionSystemPrompt(),
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

  if (aiProvider === "gemini") {
    return await generateContentWithGemini(input, geminiKey);
  }

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
      const bulkMode = readFormString(formData, "bulkMode");
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

      if (bulkMode === COLLECTION_PRODUCTS_MODE) {
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
        const selectedProductsCollectionId = readFormString(formData, "productsCollectionId");
        const selectedProductIdsRaw = formData.get("selectedCollectionProductIds");
        let selectedCollectionProductIds = [];
        if (typeof selectedProductIdsRaw === "string" && selectedProductIdsRaw.trim()) {
          try {
            const parsed = JSON.parse(selectedProductIdsRaw);
            if (Array.isArray(parsed)) {
              selectedCollectionProductIds = parsed;
            }
          } catch {
            selectedCollectionProductIds = [];
          }
        }
        const selectedProductIdSet = new Set(
          selectedCollectionProductIds.map((value) => String(value || "").trim()).filter(Boolean),
        );
        const selectedContentTypes = parseSelectedContentTypes(
          formData.get("contentTypes"),
          COLLECTION_CONTENT_TYPES,
          DEFAULT_COLLECTION_CONTENT_TYPES,
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

        const collectionsWithProducts = await Promise.all(
          bulkCollections.map(async (collection) => {
            const fetched = await fetchCollectionProducts(admin, collection.id);
            const allProducts = fetched.products || [];
            const targetProducts =
              selectedProductIdSet.size > 0 && selectedProductsCollectionId === collection.id
                ? allProducts.filter((product) => selectedProductIdSet.has(product.id))
                : allProducts;

            return {
              id: collection.id,
              title: collection.title || fetched.collectionTitle || "Untitled Collection",
              products: targetProducts,
            };
          }),
        );

        const targetProductsCount = collectionsWithProducts.reduce(
          (sum, collection) => sum + collection.products.length,
          0,
        );

        if (targetProductsCount < 1) {
          return {
            ok: false,
            intent,
            error: "No products found in selected collections.",
          };
        }

        const availableCredits = shopData?.credits ?? 150;
        const requiredCredits = creditsForBatch(selectedContentTypes, targetProductsCount);
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

        // Flatten all products across selected collections into a single items array
        const jobItems = collectionsWithProducts.flatMap((col) =>
          col.products.map((p) => ({
            productId: p.id,
            productTitle: p.title,
            productDescHtml: p.descriptionHtml || "",
            productSeoTitle: p.seoTitleValue || "",
            productSeoDesc: p.seoDescriptionValue || "",
            collectionId: col.id,
            collectionTitle: col.title,
          }))
        );

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
        };

        const job = await db.bulkJob.create({
          data: {
            shop: session.shop,
            jobType: "collection_product",
            status: "pending",
            totalItems: jobItems.length,
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
            jobType: "collection_product",
            items: jobItems,
            settings: jobSettings,
          },
        });

        return {
          ok: true,
          intent,
          queued: true,
          jobId: job.id,
          mode: COLLECTION_PRODUCTS_MODE,
          total: jobItems.length,
          newCredits: reservedCredits,
          creditsUsedTotal: reservedCreditsUsedTotal,
        };
      }

      const language = readFormString(formData, "language") || "English";
      const tone = readFormString(formData, "tone") || "Neutral";
      const lengthOption = getExactWordLengthOption(globalSettings, "collectionDescWords");
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
        COLLECTION_CONTENT_TYPES,
        DEFAULT_COLLECTION_CONTENT_TYPES,
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
      const requiredCredits = creditsForBatch(selectedContentTypes, bulkCollections.length);

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
      };

      const jobItems = bulkCollections.map((c) => ({
        id: c.id,
        title: c.title,
        descriptionHtml: c.descriptionHtml || "",
        seoTitle: c.seoTitleValue || "",
        seoDescription: c.seoDescriptionValue || "",
      }));

      const job = await db.bulkJob.create({
        data: {
          shop: session.shop,
          jobType: "collection",
          status: "pending",
          totalItems: bulkCollections.length,
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
          jobType: "collection",
          items: jobItems,
          settings: jobSettings,
        },
      });

      return {
        ok: true,
        intent,
        queued: true,
        jobId: job.id,
        total: bulkCollections.length,
        newCredits: reservedCredits,
        creditsUsedTotal: reservedCreditsUsedTotal,
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
    select: {
      openaiApiKey: true,
      anthropicApiKey: true,
      geminiApiKey: true,
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
  const productsCollectionId = (url.searchParams.get("productsCollectionId") || "").trim();
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
      filters: { search, productsCollectionId },
      collections: [],
      collectionProducts: [],
      collectionProductsTitle: "",
      hasOpenaiKey: !!(shopData?.openaiApiKey || process.env.OPENAI_API_KEY),
      hasAnthropicKey: !!(shopData?.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
      hasGeminiKey: !!(shopData?.geminiApiKey || process.env.GOOGLE_GEMINI_API_KEY),
      defaultAiProvider: shopData?.defaultAiProvider || "auto",
      credits: shopData?.credits ?? 150,
      creditsUsedTotal: shopData?.creditsUsedTotal ?? 0,
      shopOwnerName,
    };
  }

  const collectionIds = collectionNodes.map((node) => node.id);

  const generatedContentByCollectionId = new Map();
  const generatedContents = await db.collectionGeneratedContent.findMany({
    where: {
      shop: session.shop,
      collectionId: { in: collectionIds },
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

  const collectionProductCountRows = await db.collectionProductGeneratedContent.groupBy({
    by: ["collectionId"],
    where: { shop: session.shop, collectionId: { in: collectionIds } },
    _count: { productId: true },
  });
  const collectionProductCountMap = new Map(
    collectionProductCountRows.map((row) => [row.collectionId, row._count.productId]),
  );

  const collections = collectionNodes.map((node) => {
    const generatedContent = generatedContentByCollectionId.get(node.id);
    return {
      id: node.id,
      title: node.title,
      handle: node.handle,
      imageUrl: node.image?.url || "",
      imageAlt: node.image?.altText || `${node.title} image`,
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
      generatedProductsCount: collectionProductCountMap.get(node.id) || 0,
      updatedAt: formatDate(node.updatedAt),
      adminUrl: toLegacyResourceId(node.id)
        ? `https://${session.shop}/admin/collections/${toLegacyResourceId(node.id)}`
        : "",
    };
  });

  let collectionProducts = [];
  let collectionProductsTitle = "";
  if (productsCollectionId) {
    const fetched = await fetchCollectionProducts(admin, productsCollectionId, query);
    collectionProductsTitle = fetched.collectionTitle;
    const collectionProductGeneratedContentByProductId = new Map();
    if (fetched.products.length > 0) {
      const collectionProductGeneratedContents = await db.collectionProductGeneratedContent.findMany({
        where: {
          shop: session.shop,
          collectionId: productsCollectionId,
          productId: { in: fetched.products.map((node) => node.id) },
        },
        select: {
          productId: true,
          appliedToProduct: true,
          updatedAt: true,
        },
      });

      collectionProductGeneratedContents.forEach((entry) => {
        collectionProductGeneratedContentByProductId.set(entry.productId, entry);
      });
    }
    collectionProducts = fetched.products.map((node) => ({
      id: node.id,
      title: node.title,
      status: toProductStatusMeta(node.status),
      appStatus: toAppGenerationStatusMeta(collectionProductGeneratedContentByProductId.get(node.id)),
      generatedTime: formatRelativeGenerationTime(collectionProductGeneratedContentByProductId.get(node.id)?.updatedAt),
      descriptionHtml: node.descriptionHtml || "",
      seoTitleValue: node.seoTitleValue || "",
      seoDescriptionValue: node.seoDescriptionValue || "",
      descriptionStatus: evaluateDescription(stripHtml(node.descriptionHtml || "")),
      updatedAt: formatDate(node.updatedAt),
    }));
  }

  return {
    filters: { search, productsCollectionId },
    collections,
    collectionProducts,
    collectionProductsTitle,
    hasOpenaiKey: !!(shopData?.openaiApiKey || process.env.OPENAI_API_KEY),
    hasAnthropicKey: !!(shopData?.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
    hasGeminiKey: !!(shopData?.geminiApiKey || process.env.GOOGLE_GEMINI_API_KEY),
    defaultAiProvider: shopData?.defaultAiProvider || "auto",
    credits: shopData?.credits ?? 150,
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

const COLLECTION_BULK_SESSION_KEYS = {
  collections: "product-ai-generate:collections-bulk-state",
  collectionProducts: "product-ai-generate:collection-products-bulk-state",
};

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

export default function CollectionsPage() {
  const {
    filters,
    collections,
    collectionProducts,
    collectionProductsTitle,
    defaultAiProvider,
    credits,
    shopOwnerName,
  } = useLoaderData();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const sectionMode = new URLSearchParams(location.search).get("mode");
  const isCollectionProductsMode = sectionMode === COLLECTION_PRODUCTS_MODE;
  const activeDescriptionDefaultPrompt = DEFAULT_COLLECTION_DESCRIPTION_CUSTOM_PROMPT;
  const activeMetaDescriptionDefaultPrompt = DEFAULT_META_DESCRIPTION_CUSTOM_PROMPT;
  const activeMetaTitleDefaultPrompt = DEFAULT_META_TITLE_CUSTOM_PROMPT;
  const activeTemplateLibraryByTab = {
    description: COLLECTION_DESCRIPTION_TEMPLATES,
    meta_description: COLLECTION_META_DESCRIPTION_TEMPLATES,
    meta_title: COLLECTION_META_TITLE_TEMPLATES,
  };
  const revalidator = useRevalidator();
  const bulkFetcher = useFetcher();
  const shopify = useAppBridge();
  const collectionBulkSessionKey = isCollectionProductsMode
    ? COLLECTION_BULK_SESSION_KEYS.collectionProducts
    : COLLECTION_BULK_SESSION_KEYS.collections;
  const initialBulkSessionStateRef = useRef(readBulkSessionState(collectionBulkSessionKey));
  const initialBulkSessionState = initialBulkSessionStateRef.current;
  const [searchValue, setSearchValue] = useState(filters.search);
  const [fallbackCollections, setFallbackCollections] = useState(collections);
  const [bulkDescTemplate, setBulkDescTemplate] = useState(() => initialBulkSessionState.bulkDescTemplate || "");
  const [bulkMetaDescTemplate, setBulkMetaDescTemplate] = useState(() => initialBulkSessionState.bulkMetaDescTemplate || "");
  const [bulkMetaTitleTemplate, setBulkMetaTitleTemplate] = useState(() => initialBulkSessionState.bulkMetaTitleTemplate || "");
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
  const [selectedCollectionIds, setSelectedCollectionIds] = useState(() => readArrayState(initialBulkSessionState.selectedCollectionIds));
  const [bulkValidationMessage, setBulkValidationMessage] = useState(null);
  const [bulkContentTypes, setBulkContentTypes] = useState(() =>
    readArrayState(initialBulkSessionState.bulkContentTypes, ["description"]),
  );
  const [selectedDescTemplateId, setSelectedDescTemplateId] = useState("");
  const [selectedMetaDescTemplateId, setSelectedMetaDescTemplateId] = useState("");
  const [selectedMetaTitleTemplateId, setSelectedMetaTitleTemplateId] = useState("");
  const bulkResultHandledRef = useRef(false);
  const [bulkDescKeywords, setBulkDescKeywords] = useState(() => readGlobalSettings().collectionDescKeywords || "");
  const [bulkMetaTitleKeywords, setBulkMetaTitleKeywords] = useState(() => readGlobalSettings().collectionMetaTitleKeywords || "");
  const [bulkMetaDescKeywords, setBulkMetaDescKeywords] = useState(() => readGlobalSettings().collectionMetaDescKeywords || "");
  const [useCustomDescInstructions, setUseCustomDescInstructions] = useState(() => !!initialBulkSessionState.useCustomDescInstructions);
  const [useCustomMetaDescInstructions, setUseCustomMetaDescInstructions] = useState(() => !!initialBulkSessionState.useCustomMetaDescInstructions);
  const [useCustomMetaTitleInstructions, setUseCustomMetaTitleInstructions] = useState(() => !!initialBulkSessionState.useCustomMetaTitleInstructions);
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
  const [templateLibraryContentType, setTemplateLibraryContentType] = useState("description");
  const [outputLanguage, setOutputLanguage] = useState(() => readGlobalSettings().language || "English");
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showCollectionSearchBar, setShowCollectionSearchBar] = useState(false);
  const [addTitleAsHeading, setAddTitleAsHeading] = useState(false);
  const [preserveOldDescription, setPreserveOldDescription] = useState(false);
  const [removeImagesFromDescription, setRemoveImagesFromDescription] = useState(false);
  const [queueStatusById, setQueueStatusById] = useState({});
  const [selectedCollectionProductIds, setSelectedCollectionProductIds] = useState(() =>
    readArrayState(initialBulkSessionState.selectedCollectionProductIds),
  );
  const queueIntervalRef = useRef(null);
  const previousModeRef = useRef(isCollectionProductsMode);
  const [statusTabIndex, setStatusTabIndex] = useState(0);

  useEffect(() => {
    const templateSelection = readStoredCollectionPromptTemplateSelection();
    if (!initialBulkSessionState.useCustomMetaTitleInstructions && templateSelection.metaTitlePromptTemplate) {
      setBulkMetaTitleTemplate(templateSelection.metaTitlePromptTemplate);
      setUseCustomMetaTitleInstructions(true);
    }
    if (!initialBulkSessionState.useCustomMetaDescInstructions && templateSelection.metaDescriptionPromptTemplate) {
      setBulkMetaDescTemplate(templateSelection.metaDescriptionPromptTemplate);
      setUseCustomMetaDescInstructions(true);
    }
  }, [initialBulkSessionState]);

  useEffect(() => {
    setSearchValue(filters.search);
  }, [filters.search]);

  useEffect(() => {
    if (!bulkContentTypes.includes("description")) {
      setShowAdvancedSettings(false);
    }
  }, [bulkContentTypes]);

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
    const statusFilter = statusTabIndex === 1 ? "active" : statusTabIndex === 2 ? "draft" : "all";
    return sourceCollections.filter((collection) => {
      const matchesSearch =
        !normalizedSearch || collection.title.toLowerCase().includes(normalizedSearch);
      if (!matchesSearch) return false;

      if (statusFilter === "all") return true;
      const isActive = collection.appStatus?.label?.toLowerCase() === "active";
      return statusFilter === "active" ? isActive : !isActive;
    });
  }, [normalizedSearch, sourceCollections, statusTabIndex]);

  const visibleCollectionIds = useMemo(
    () => filteredCollections.map((collection) => collection.id),
    [filteredCollections],
  );

  const visibleCollectionProductIds = useMemo(
    () => collectionProducts.map((product) => product.id),
    [collectionProducts],
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

  useEffect(() => {
    if (!isCollectionProductsMode || visibleCollectionProductIds.length === 0) {
      return;
    }

    setSelectedCollectionProductIds((current) => {
      const visibleSet = new Set(visibleCollectionProductIds);
      return current.filter((id) => visibleSet.has(id));
    });
  }, [isCollectionProductsMode, visibleCollectionProductIds]);

  useEffect(() => {
    if (previousModeRef.current === isCollectionProductsMode) {
      return;
    }

    const previousKey = previousModeRef.current
      ? COLLECTION_BULK_SESSION_KEYS.collectionProducts
      : COLLECTION_BULK_SESSION_KEYS.collections;

    writeBulkSessionState(previousKey, {
      selectedCollectionIds,
      selectedCollectionProductIds,
      bulkContentTypes,
      bulkDescTemplate,
      bulkMetaDescTemplate,
      bulkMetaTitleTemplate,
      useCustomDescInstructions,
      useCustomMetaDescInstructions,
      useCustomMetaTitleInstructions,
    });

    const nextState = readBulkSessionState(collectionBulkSessionKey);
    setSelectedCollectionIds(readArrayState(nextState.selectedCollectionIds));
    setSelectedCollectionProductIds(readArrayState(nextState.selectedCollectionProductIds));
    setBulkContentTypes(readArrayState(nextState.bulkContentTypes, ["description"]));
    setBulkDescTemplate(nextState.bulkDescTemplate || "");
    setBulkMetaDescTemplate(nextState.bulkMetaDescTemplate || "");
    setBulkMetaTitleTemplate(nextState.bulkMetaTitleTemplate || "");
    setUseCustomDescInstructions(!!nextState.useCustomDescInstructions);
    setUseCustomMetaDescInstructions(!!nextState.useCustomMetaDescInstructions);
    setUseCustomMetaTitleInstructions(!!nextState.useCustomMetaTitleInstructions);
    setTemplateLibraryOpen(false);
    setTemplateLibraryContentType("description");
    setQueueStatusById({});
    setBulkResult(null);
    setBulkValidationMessage(null);
    previousModeRef.current = isCollectionProductsMode;
  }, [
    bulkContentTypes,
    bulkDescTemplate,
    bulkMetaDescTemplate,
    bulkMetaTitleTemplate,
    collectionBulkSessionKey,
    isCollectionProductsMode,
    selectedCollectionIds,
    selectedCollectionProductIds,
    useCustomDescInstructions,
    useCustomMetaDescInstructions,
    useCustomMetaTitleInstructions,
  ]);

  useEffect(() => {
    writeBulkSessionState(collectionBulkSessionKey, {
      selectedCollectionIds,
      selectedCollectionProductIds,
      bulkContentTypes,
      bulkDescTemplate,
      bulkMetaDescTemplate,
      bulkMetaTitleTemplate,
      useCustomDescInstructions,
      useCustomMetaDescInstructions,
      useCustomMetaTitleInstructions,
    });
  }, [
    bulkContentTypes,
    bulkDescTemplate,
    bulkMetaDescTemplate,
    bulkMetaTitleTemplate,
    collectionBulkSessionKey,
    selectedCollectionIds,
    selectedCollectionProductIds,
    useCustomDescInstructions,
    useCustomMetaDescInstructions,
    useCustomMetaTitleInstructions,
  ]);

  const activeProductsCollection = useMemo(
    () =>
      collections.find((collection) => collection.id === filters.productsCollectionId) ||
      filteredCollections.find((collection) => collection.id === filters.productsCollectionId) ||
      null,
    [collections, filteredCollections, filters.productsCollectionId],
  );

  const targetCollectionsForBulk = useMemo(() => {
    if (!isCollectionProductsMode) {
      return selectedCollections;
    }

    if (activeProductsCollection && selectedCollectionProductIds.length > 0) {
      return [activeProductsCollection];
    }

    return selectedCollections;
  }, [
    activeProductsCollection,
    isCollectionProductsMode,
    selectedCollectionProductIds.length,
    selectedCollections,
  ]);

  const exceedsBulkLimit = targetCollectionsForBulk.length > MAX_BULK_ITEMS;
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
    ({ search = searchValue.trim(), productsCollectionId = filters.productsCollectionId } = {}) => {
      const current = new URLSearchParams(location.search);
      const params = new URLSearchParams();
      ["shop", "host", "embedded"].forEach((key) => {
        const value = current.get(key);
        if (value) params.set(key, value);
      });
      if (isCollectionProductsMode) params.set("mode", COLLECTION_PRODUCTS_MODE);
      if (search) params.set("q", search);
      if (productsCollectionId) params.set("productsCollectionId", productsCollectionId);
      const query = params.toString();
      return query ? `?${query}` : "";
    },
    [filters.productsCollectionId, isCollectionProductsMode, location.search, searchValue],
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
      navigate(makeUrl({ search: nextSearch, productsCollectionId: filters.productsCollectionId }), { replace: true });
    }, 180);

    return () => clearTimeout(timeoutId);
  }, [filters.productsCollectionId, filters.search, makeUrl, navigate, searchValue]);

  const handleSearchInput = useCallback((value) => {
    setSearchValue(value || "");
  }, []);

  const handleBulkGenerate = useCallback(() => {
    if (targetCollectionsForBulk.length === 0) {
      setBulkValidationMessage(
        isCollectionProductsMode
          ? "Select at least one collection product for bulk generation."
          : MIN_BULK_COLLECTION_SELECTION_ERROR,
      );
      return;
    }
    if (targetCollectionsForBulk.length > MAX_BULK_ITEMS) {
      setBulkValidationMessage(MAX_BULK_COLLECTION_SELECTION_ERROR);
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
    targetCollectionsForBulk.forEach((collection, index) => {
      initialQueueState[collection.id] = index === 0 ? "processing" : "queued";
    });
    setQueueStatusById(initialQueueState);
    if (queueIntervalRef.current) clearInterval(queueIntervalRef.current);
    let processingIndex = 0;
    queueIntervalRef.current = setInterval(() => {
      processingIndex += 1;
      setQueueStatusById((prev) => {
        const next = { ...prev };
        if (targetCollectionsForBulk[processingIndex - 1] && next[targetCollectionsForBulk[processingIndex - 1].id] === "processing") {
          next[targetCollectionsForBulk[processingIndex - 1].id] = "queued";
        }
        if (targetCollectionsForBulk[processingIndex] && next[targetCollectionsForBulk[processingIndex].id] === "queued") {
          next[targetCollectionsForBulk[processingIndex].id] = "processing";
        }
        return next;
      });
    }, 1400);

    const payload = new FormData();
    payload.append("intent", BULK_GENERATE_INTENT);
    payload.append("bulkMode", isCollectionProductsMode ? COLLECTION_PRODUCTS_MODE : "collections");
    payload.append("collections", JSON.stringify(
      targetCollectionsForBulk.map((c) => ({
        id: c.id,
        title: c.title,
        descriptionHtml: c.descriptionHtml,
        seoTitleValue: c.seoTitleValue,
        seoDescriptionValue: c.seoDescriptionValue,
      })),
    ));
    payload.append("productsCollectionId", filters.productsCollectionId || "");
    payload.append("selectedCollectionProductIds", JSON.stringify(selectedCollectionProductIds));
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
    payload.append("useCustomDescInstructions", useCustomDescInstructions ? "1" : "0");
    payload.append("useCustomMetaTitleInstructions", useCustomMetaTitleInstructions ? "1" : "0");
    payload.append("useCustomMetaDescInstructions", useCustomMetaDescInstructions ? "1" : "0");
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
    outputLanguage,
    useCustomDescInstructions,
    useCustomMetaDescInstructions,
    useCustomMetaTitleInstructions,
    addTitleAsHeading,
    preserveOldDescription,
    removeImagesFromDescription,
    filters.productsCollectionId,
    isCollectionProductsMode,
    selectedCollectionProductIds,
    targetCollectionsForBulk,
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
        shopify.toast.show(`Generating ${response.total} items in the background.`);
        window.setTimeout(() => navigateInApp("/app/jobs", ""), 600);
      } else {
        const creditsMessage =
          typeof response.creditsUsed === "number"
            ? ` ${response.creditsUsed} credits used${typeof response.newCredits === "number" ? `. Remaining: ${response.newCredits}` : ""}.`
            : "";
        shopify.toast.show(`Bulk generate complete: ${response.succeeded}/${response.total} updated.${creditsMessage}`);
        revalidator.revalidate();
      }
      return;
    }
    setBulkValidationMessage(response.error || "Bulk generation failed.");
  }, [bulkFetcher.state, bulkFetcher.data, isCollectionProductsMode, navigateInApp, revalidator, shopify]);

  useEffect(() => () => {
    if (queueIntervalRef.current) clearInterval(queueIntervalRef.current);
  }, []);

  useEffect(() => {
    if (targetCollectionsForBulk.length > MAX_BULK_ITEMS) {
      if (bulkValidationMessage !== MAX_BULK_COLLECTION_SELECTION_ERROR) {
        setBulkValidationMessage(MAX_BULK_COLLECTION_SELECTION_ERROR);
      }
      return;
    }

    if (
      targetCollectionsForBulk.length > 0 &&
      (
        bulkValidationMessage === MIN_BULK_COLLECTION_SELECTION_ERROR ||
        bulkValidationMessage === "Select at least one collection product for bulk generation."
      )
    ) {
      setBulkValidationMessage(null);
      return;
    }

    if (bulkValidationMessage === MAX_BULK_COLLECTION_SELECTION_ERROR) {
      setBulkValidationMessage(null);
    }
  }, [bulkValidationMessage, targetCollectionsForBulk.length]);

  const updateBulkField = (field) => (value) =>
    setBulkSettings((prev) => ({ ...prev, [field]: value }));

  const estimatedTargetItems = useMemo(() => {
    if (!isCollectionProductsMode) {
      return selectedCollections.length;
    }

    return targetCollectionsForBulk.reduce((sum, collection) => {
      if (
        filters.productsCollectionId &&
        filters.productsCollectionId === collection.id &&
        selectedCollectionProductIds.length > 0
      ) {
        return sum + selectedCollectionProductIds.length;
      }
      return sum + (collection.productsCount || 0);
    }, 0);
  }, [
    filters.productsCollectionId,
    isCollectionProductsMode,
    selectedCollectionProductIds.length,
    selectedCollections.length,
    targetCollectionsForBulk,
  ]);

  const bulkCreditsPerItem = clientCreditsForContentTypes(bulkContentTypes);
  const requiredBulkCredits = clientCreditsForBatch(bulkContentTypes, estimatedTargetItems);
  const insufficientCredits = requiredBulkCredits > 0 && requiredBulkCredits > credits;

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

  const allVisibleCollectionProductsSelected =
    visibleCollectionProductIds.length > 0 &&
    selectedCollectionProductIds.length === visibleCollectionProductIds.length;
  const collectionProductsSelectionIndeterminate =
    selectedCollectionProductIds.length > 0 &&
    selectedCollectionProductIds.length < visibleCollectionProductIds.length;

  const handleToggleSelectAllCollectionProducts = useCallback(
    (checked) => {
      setSelectedCollectionProductIds(checked ? [...visibleCollectionProductIds] : []);
    },
    [visibleCollectionProductIds],
  );

  const handleToggleCollectionProductSelection = useCallback(
    (productId) => (checked) => {
      setSelectedCollectionProductIds((current) => {
        if (checked) {
          return current.includes(productId) ? current : [...current, productId];
        }
        return current.filter((id) => id !== productId);
      });
    },
    [],
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
        {isCollectionProductsMode ? (
          <button
            type="button"
            onClick={() =>
              navigate(
                makeUrl({
                  search: filters.search,
                  productsCollectionId: collection.id,
                }),
              )
            }
            style={{
              background: "none",
              border: "none",
              padding: 0,
              textAlign: "left",
              width: "100%",
              cursor: "pointer",
            }}
          >
            <BlockStack gap="050">
              <Text as="span" variant="bodyMd" fontWeight="medium">
                <span className="collections-name-clamp">{collection.title}</span>
              </Text>
              <InlineStack gap="200" blockAlign="center">
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "3px 10px",
                    borderRadius: "999px",
                    background: "#bfdbfe",
                    color: "#1e3a8a",
                    fontSize: "12px",
                    lineHeight: 1.2,
                  }}
                >
                  {collection.productsCount} product{collection.productsCount === 1 ? "" : "s"}
                </span>
                <Button
                  icon={ExternalIcon}
                  variant="tertiary"
                  size="slim"
                  url={collection.adminUrl || undefined}
                  external
                  accessibilityLabel={`Open ${collection.title} in Shopify admin`}
                  disabled={!collection.adminUrl}
                />
              </InlineStack>
            </BlockStack>
          </button>
        ) : (
          <Text as="span" variant="bodyMd" fontWeight="medium">
            <span className="collections-name-clamp">{collection.title}</span>
          </Text>
        )}
      </IndexTable.Cell>

      {isCollectionProductsMode && (
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone={collection.generatedProductsCount > 0 ? "success" : "subdued"}>
            {collection.generatedProductsCount > 0
              ? `${collection.generatedProductsCount} / ${collection.productsCount} generated`
              : "None generated"}
          </Text>
        </IndexTable.Cell>
      )}

      {!isCollectionProductsMode && (
        <IndexTable.Cell>{renderBadge(collection.descriptionStatus)}</IndexTable.Cell>
      )}

      {!isCollectionProductsMode && (
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
      )}

    </IndexTable.Row>
  ));

  const sectionTabs = [
    { id: "products", content: "Products", to: { pathname: "/app/products", search: "" } },
    { id: "collections", content: "Collections", to: { pathname: "/app/collections", search: "" } },
    {
      id: "collection-products",
      content: "Collection Product",
      to: { pathname: "/app/collections", search: `?mode=${COLLECTION_PRODUCTS_MODE}` },
    },
  ];
  const statusTabs = [
    { id: "all", content: "All" },
    { id: "active", content: "Active" },
    { id: "draft", content: "Draft" },
  ];
  const activeSectionId = location.pathname.startsWith("/app/products")
    ? "products"
    : isCollectionProductsMode
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
              Collections
            </div>
            <div style={{ fontSize: "13px", color: "#000000", lineHeight: 1.4, fontWeight: 500,marginTop: "10px" }}>
              <Text as="p" variant="bodySm" tone="subdued">- You can select multiple collections (up to {MAX_BULK_ITEMS}) for bulk content generation</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {isCollectionProductsMode
                  ? "- Generate Description, Meta Title, and Meta Description for products under the selected collection"
                  : "- Generates Collection Description, Meta Title, and Meta Description directly on each selected collection"}
              </Text>
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
        {/* ── LEFT: Collection List ── */}
        <div className="app-split-main" style={{ flex: "1 1 0", minWidth: "0" }}>
          {/* ── Products / Collections tab bar ── */}
          <div className="app-toolbar app-segmented-tabs" style={{ marginBottom: "20px", maxWidth: "640px" }}>
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
                      onSelect={setStatusTabIndex}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1 1 0", minWidth: 0, justifyContent: "flex-end" }}>
                    {showCollectionSearchBar ? (
                      <>
                        <div style={{ flex: "1 1 0", minWidth: "300px" }}>
                          <TextField
                            label="Search collections"
                            labelHidden
                            placeholder="Search collections here..."
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
                          onClick={() => setShowCollectionSearchBar(false)}
                        />
                      </>
                    ) : (
                      <Button
                        icon={SearchIcon}
                        variant="secondary"
                        accessibilityLabel="Show search"
                        onClick={() => setShowCollectionSearchBar(true)}
                      />
                    )}
                    <Text as="span" variant="bodySm" tone="subdued">
                      {selectedCollections.length} selected
                    </Text>
                  </div>
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
                    itemCount={filteredCollections.length}
                    headings={[
                      {
                        title: (
                          <Checkbox
                            label={`Select all visible (${filteredCollections.length})`}
                            labelHidden
                            checked={allVisibleSelected}
                            indeterminate={selectionIndeterminate}
                            onChange={handleToggleSelectAllVisible}
                          />
                        ),
                      },
                      { title: "Collection" },
                      ...(isCollectionProductsMode ? [{ title: "Products Generated" }] : []),
                      ...(!isCollectionProductsMode
                        ? [
                            { title: "Short" },
                            { title: "Status" },
                          ]
                        : []),
                    ]}
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
                </InlineStack>
              </div>
            </BlockStack>
          </Card>

          {isCollectionProductsMode && filters.productsCollectionId ? (
            <div style={{ marginTop: "16px" }}>
              <Card padding="0">
                <BlockStack gap="0">
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                    <Text as="h3" variant="headingSm" fontWeight="semibold">
                      Collection Products{collectionProductsTitle ? `: ${collectionProductsTitle}` : ""}
                    </Text>
                  </div>
                  {collectionProducts.length === 0 ? (
                    <Box padding="400">
                      <Text as="p" tone="subdued">
                        No products found for the selected collection.
                      </Text>
                    </Box>
                  ) : (
                    <div className="collections-table-wrap app-table-scroll">
                      <IndexTable
                        resourceName={{ singular: "product", plural: "products" }}
                        itemCount={collectionProducts.length}
                        headings={[
                          {
                            title: (
                              <Checkbox
                                label={`Select all visible (${collectionProducts.length})`}
                                labelHidden
                                checked={allVisibleCollectionProductsSelected}
                                indeterminate={collectionProductsSelectionIndeterminate}
                                onChange={handleToggleSelectAllCollectionProducts}
                              />
                            ),
                          },
                          { title: "Product" },
                          { title: "App Status" },
                          { title: "Generated In" },
                        ]}
                        selectable={false}
                      >
                        {collectionProducts.map((product, index) => (
                          <IndexTable.Row id={product.id} key={product.id} position={index}>
                            <IndexTable.Cell>
                              <Checkbox
                                label={`Select ${product.title}`}
                                labelHidden
                                checked={selectedCollectionProductIds.includes(product.id)}
                                onChange={handleToggleCollectionProductSelection(product.id)}
                              />
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text as="span" variant="bodyMd" fontWeight="medium">
                                {product.title}
                              </Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              {isBulkGenerating && selectedCollectionProductIds.includes(product.id) ? (
                                <InlineStack gap="100" blockAlign="center">
                                  <Spinner size="small" />
                                  <Text as="span" tone="subdued">Generating...</Text>
                                </InlineStack>
                              ) : (
                                renderBadge(product.appStatus)
                              )}
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {product.generatedTime || "-"}
                              </Text>
                            </IndexTable.Cell>
                          </IndexTable.Row>
                        ))}
                      </IndexTable>
                    </div>
                  )}
                </BlockStack>
              </Card>
            </div>
          ) : null}
        </div>

        {/* ── RIGHT: Bulk Settings Panel ── */}
        <div className="app-split-side" style={{ flex: "1 1 0", width: "420px", maxWidth: "100%" }}>
          <Card padding="0">
            {/* Header */}
            <div style={{ padding: "16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd" fontWeight="bold">
                  {isCollectionProductsMode ? "Collection Product Bulk Settings" : "Collection Bulk Settings"}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {[
                    bulkContentTypes.includes("description") ? "Descriptions" : null,
                    bulkContentTypes.includes("meta_description") ? "Meta Descriptions" : null,
                    bulkContentTypes.includes("meta_title") ? "Meta Titles" : null,
                  ].filter(Boolean).join(", ")} will be generated for{" "}
                  {isCollectionProductsMode
                    ? `${estimatedTargetItems} product${estimatedTargetItems !== 1 ? "s" : ""}`
                    : `${selectedCollections.length} collection${selectedCollections.length !== 1 ? "s" : ""}`}
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
                      if (v) setBulkDescTemplate(activeDescriptionDefaultPrompt);
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
                        onClick={() => { setBulkDescTemplate(activeDescriptionDefaultPrompt); setUseCustomDescInstructions(true); }}
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
                      if (v) setBulkMetaDescTemplate(activeMetaDescriptionDefaultPrompt);
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
                        onClick={() => { setBulkMetaDescTemplate(activeMetaDescriptionDefaultPrompt); setUseCustomMetaDescInstructions(true); }}
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
                      if (v) setBulkMetaTitleTemplate(activeMetaTitleDefaultPrompt);
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
                        onClick={() => { setBulkMetaTitleTemplate(activeMetaTitleDefaultPrompt); setUseCustomMetaTitleInstructions(true); }}
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
                            label={
                              <span style={{ fontWeight: 600, fontSize: "13px" }}>
                                Add {isCollectionProductsMode ? "Product" : "Collection"} Title as heading tag in the description
                              </span>
                            }
                            checked={addTitleAsHeading}
                            onChange={(v) => setAddTitleAsHeading(v)}
                          />
                          <p style={{ margin: "4px 0 0 24px", fontSize: "12px", color: "#6b7280", lineHeight: "1.45" }}>
                            This will add your {isCollectionProductsMode ? "Product" : "Collection"} Title as the main heading in the description.
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
                Estimated credits used: {requiredBulkCredits} (
                {isCollectionProductsMode
                  ? `${estimatedTargetItems} products`
                  : `${selectedCollections.length} collections`} x {bulkCreditsPerItem} credits each)
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
                disabled={isBulkGenerating || targetCollectionsForBulk.length === 0 || exceedsBulkLimit || !hasRequiredBulkTemplates || insufficientCredits}
                loading={isBulkGenerating}
                tone="success"
              >
                {isCollectionProductsMode
                  ? `Generate ${estimatedTargetItems} items (${requiredBulkCredits} credits)`
                  : `Generate ${selectedCollections.length} items (${requiredBulkCredits} credits)`}
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
          font-size: 14px !important;
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
        .collections-table-wrap {
          max-height: 62vh;
          overflow-y: auto;
          overflow-x: hidden;
        }
        .app-table-scroll {
          max-height: 62vh;
          overflow: auto;
        }
        .collections-table-wrap .Polaris-IndexTable__ScrollContainer {
          overflow-x: hidden;
        }
        .collections-table-wrap .Polaris-IndexTable__StickyTable {
          display: none !important;
        }
        .collections-table-wrap .Polaris-IndexTable__Table {
          width: 100%;
          table-layout: fixed;
        }
        .collections-table-wrap .Polaris-IndexTable__Table th:first-child,
        .collections-table-wrap .Polaris-IndexTable__Table td:first-child {
          width: 46px;
          padding-right: 4px;
        }
        .collections-table-wrap .Polaris-IndexTable__Table th:nth-child(2),
        .collections-table-wrap .Polaris-IndexTable__Table td:nth-child(2) {
          padding-left: 4px;
        }
        .collections-name-clamp {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          white-space: normal;
          overflow-wrap: anywhere;
          line-height: 1.35;
        }
        .app-toolbar-fixed button,
        .app-toolbar .Polaris-Tabs__Title {
          font-size: 14px !important;
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
          { id: "meta_title", label: "Meta Title" },
          { id: "meta_description", label: "Meta Description" },
        ]}
        initialTab={templateLibraryContentType}
        templatesByTab={activeTemplateLibraryByTab}
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





