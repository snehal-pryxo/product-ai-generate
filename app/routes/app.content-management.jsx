import { useState, useCallback, useEffect, useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useFetcher, useLoaderData, useLocation, useNavigate } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  ActionList,
  EmptyState,
  IndexTable,
  InlineStack,
  Modal,
  Page,
  Pagination,
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
import { TemplateLibraryModal } from "../components/TemplateLibraryModal";
import { RichTextEditor } from "../components/RichTextEditor";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import {
  buildProductContentPrompt,
  buildCollectionContentPrompt,
  buildPageContentPrompt,
  getSystemPromptForContentType,
} from "../lib/contentPromptTemplates";
import { buildInsufficientCreditsError, deductCredits } from "../lib/credits.server";
// ─── Constants ───────────────────────────────────────────────────────────────
const CREDITS_PER_GENERATION = 3;
const CREDITS_PER_FAQ_GENERATION = 5;
const FETCH_BATCH_SIZE = 250;
const DEFAULT_AI_MODEL = "gpt-4o-mini";
const DEFAULT_OLLAMA_MODEL = "llama3.2:1b";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const CONTENT_TABLE_PAGE_SIZE = 10;
const OPENAI_RATE_LIMIT_RETRY_DELAY_MS = 20000;
const OPENAI_RATE_LIMIT_ERROR_PATTERN = /rate limit|too many requests|429/i;
const OPENAI_QUOTA_ERROR_PATTERN = /quota|billing|insufficient_quota/i;
const OPENAI_MODEL_ACCESS_ERROR_PATTERN = /does not exist|do not have access|not found/i;
const OPENAI_OLLAMA_FALLBACK_ERROR_PATTERN =
  /quota|billing|insufficient_quota|OPENAI_API_KEY is missing|does not exist|do not have access|rate limit|too many requests|429/i;
const ENABLED_ENV_VALUE_PATTERN = /^(1|true|yes)$/i;
const BASE_AI_MODEL_OPTIONS = [
  { label: "Claude Haiku 4.5", value: "claude-haiku-4.5" },
  { label: "Claude Sonnet 4.6", value: "claude-sonnet-4.6" },
  { label: "GPT-4o Mini", value: "gpt-4o-mini" },
  { label: "Gemini Flash-Lite", value: "gemini-flash-lite" },
  { label: "DeepSeek V3.2", value: "deepseek-v3.2" },
  { label: "Cohere Command R+", value: "cohere-command-r-plus" },
];

const LANGUAGE_OPTIONS = [
  "English", "Arabic", "Bengali", "Bulgarian",
  "Chinese", "Chinese (Simplified)", "Chinese (Traditional)", "Croatian", "Czech",
  "Danish", "Dutch", "Finnish", "French", "German", "Greek", "Hebrew", "Hindi",
  "Hungarian", "Indonesian", "Italian", "Japanese", "Korean", "Malay", "Norwegian",
  "Polish", "Portuguese", "Romanian", "Russian", "Spanish", "Swedish", "Tamil",
  "Telugu", "Thai", "Turkish", "Ukrainian", "Urdu", "Vietnamese",
].map((language) => ({ label: language, value: language }));

function creditsForGenerateScope(scope) {
  if (scope === "faq") return CREDITS_PER_FAQ_GENERATION;
  return scope === "all" ? CREDITS_PER_GENERATION : 1;
}

function getGenerateScopeOptions(contentType) {
  const mainLabel = contentType === "pages" ? "Content" : "Description";
  const options = [
    { value: "main", label: mainLabel },
    { value: "meta_title", label: "Meta Title" },
    { value: "meta_description", label: "Meta Description" },
  ];
  if (contentType === "products") options.push({ value: "faq", label: "FAQ" });
  return options;
}

function resolveEnvDefaultAiModel() {
  return (
    (process.env.AI_MODEL || "").trim() ||
    (process.env.OPENAI_MODEL || "").trim() ||
    (process.env.OLLAMA_MODEL || "").trim() ||
    DEFAULT_AI_MODEL
  );
}

function toModelLabel(model) {
  return model
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getAiModelOptions(envModel) {
  const model = String(envModel || "").trim();
  if (!model) return BASE_AI_MODEL_OPTIONS;
  if (BASE_AI_MODEL_OPTIONS.some((option) => option.value === model)) return BASE_AI_MODEL_OPTIONS;
  return [{ label: `${toModelLabel(model)} (ENV)`, value: model }, ...BASE_AI_MODEL_OPTIONS];
}

function mapSelectedModelToRuntime(selectedModel) {
  const selected = String(selectedModel || "").trim().toLowerCase();
  if (!selected) return { runtimeModel: null, providerHint: null };
  if (selected === "claude-haiku-4.5") {
    return { runtimeModel: "claude-haiku-4-5-20251001", providerHint: "anthropic" };
  }
  if (selected === "claude-sonnet-4.6") {
    return { runtimeModel: "claude-sonnet-4-20250514", providerHint: "anthropic" };
  }
  if (selected.startsWith("gpt-")) return { runtimeModel: selectedModel, providerHint: "openai" };
  if (selected.includes("llama")) return { runtimeModel: selectedModel, providerHint: "ollama" };
  if (selected === "gemini-flash-lite") {
    return { runtimeModel: "gemini-2.5-flash-lite", providerHint: "gemini" };
  }
  return { runtimeModel: null, providerHint: null };
}

function getScopeDisplayLabel(contentType, scope) {
  const mainLabel = contentType === "pages" ? "Content" : "Description";
  if (scope === "main") return mainLabel;
  if (scope === "meta_title") return "Meta Title";
  if (scope === "meta_description") return "Meta Description";
  if (scope === "faq") return "FAQ";
  return "All";
}

function getContentTypeDisplayLabel(contentType) {
  if (contentType === "products") return "product";
  if (contentType === "collections") return "collection";
  if (contentType === "collection_products") return "collection product";
  if (contentType === "pages") return "page";
  return "item";
}

function firstNonEmptyHtml(...values) {
  for (const value of values) {
    if (stripHtml(value || "")) return value || "";
  }
  return "";
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function normalizeFaqItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      question: cleanInlineText(item?.question || item?.q || "", 180),
      answer: cleanInlineText(item?.answer || item?.a || "", 600),
    }))
    .filter((item) => item.question && item.answer)
    .slice(0, 8);
}

function buildFaqJson(faqItems) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  });
}

function buildFaqHtml(faqItems) {
  if (!faqItems.length) return "";
  return [
    '<section data-content-ai-faq="true">',
    "<h2>Frequently Asked Questions</h2>",
    ...faqItems.map((item) => `<h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p>`),
    "</section>",
  ].join("");
}

function buildFaqJsonFromHtml(faqHtml) {
  const html = String(faqHtml || "");
  const faqItems = [];
  const headingRegex = /<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>\s*<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    const question = cleanInlineText(stripHtml(match[1]), 180);
    const answer = cleanInlineText(stripHtml(match[2]), 600);
    if (question && answer && !/^frequently asked questions$/i.test(question)) {
      faqItems.push({ question, answer });
    }
  }
  return faqItems.length ? buildFaqJson(faqItems) : "";
}

function appendFaqHtmlToDescription(descriptionHtml, faqHtml) {
  const cleaned = String(descriptionHtml || "")
    .replace(/<section\b[^>]*data-content-ai-faq=["']true["'][^>]*>[\s\S]*?<\/section>/gi, "")
    .trim();
  return [cleaned, faqHtml].filter(Boolean).join("\n\n");
}

function defaultTemplateSelection() {
  return {
    mainTemplateId: "",
    metaTitleTemplateId: "",
    metaDescriptionTemplateId: "",
  };
}

function defaultCustomInstructionSettings() {
  return {
    main: { enabled: false, prompt: "" },
    meta_title: { enabled: false, prompt: "" },
    meta_description: { enabled: false, prompt: "" },
  };
}

function defaultGenerateModalPrefs() {
  return {
    templateSelection: defaultTemplateSelection(),
    customInstructions: defaultCustomInstructionSettings(),
  };
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

const PRODUCT_NODES_QUERY = `#graphql
  query ProductNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        status
        updatedAt
        descriptionHtml
        seo { title description }
        featuredMedia {
          preview {
            image { url altText }
          }
        }
      }
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toStructuredHtml(value) {
  const text = (value || "").trim();
  if (!text) return "";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
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

    const bulletMatch = line.match(/^[-*•]\s+(.+)/);
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

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value || "");
}

function normalizeGeneratedHtml(value) {
  const text = (value || "").trim();
  if (!text) return "";
  if (looksLikeHtml(text)) return text;
  return toStructuredHtml(text);
}

function sortByNewestGenerated(items) {
  return [...items].sort((a, b) => {
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bTime - aTime;
  });
}

function canUseOllamaFallback() {
  const baseUrl = (process.env.OLLAMA_BASE_URL || "").trim();
  const enabledValue = (process.env.ENABLE_OLLAMA_FALLBACK || "").trim();
  return Boolean(baseUrl) && ENABLED_ENV_VALUE_PATTERN.test(enabledValue);
}

function parseGenerationContent(rawContent, modelName, meta = {}) {
  if (!rawContent || typeof rawContent !== "string") throw new Error("AI response was empty.");
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    const m = rawContent.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI response format was invalid.");
    parsed = JSON.parse(m[0]);
  }
  const faqItems = normalizeFaqItems(parsed?.faqs || parsed?.faqItems || parsed?.faq);
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
    faqHtml: faqItems.length ? buildFaqHtml(faqItems) : normalizeGeneratedHtml(parsed?.faqHtml || ""),
    faqJson: faqItems.length ? buildFaqJson(faqItems) : (parsed?.faqJson ? JSON.stringify(parsed.faqJson) : ""),
    aiModel: modelName || null,
    aiProvider: meta.aiProvider || null,
    inputTokens: meta.inputTokens || 0,
    outputTokens: meta.outputTokens || 0,
    generationMs: meta.generationMs || 0,
  };
}

async function generateContentWithOpenAI(prompt, shopApiKey, preferredModel = null, systemPrompt = null) {
  const apiKey = shopApiKey || process.env.OPENAI_API_KEY;
  const configuredModel = preferredModel || process.env.OPENAI_MODEL || DEFAULT_AI_MODEL;
  if (!apiKey) throw new Error("OpenAI API key is not configured.");

  const payload = (model) => ({
    model,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt || "You are an expert Shopify copywriter. Always return valid JSON with the requested keys. No markdown. No code fences." },
      { role: "user", content: prompt },
    ],
  });

  async function send(model, attempt = 0) {
    const startMs = Date.now();
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
    const generationMs = Date.now() - startMs;
    const inputTokens = data?.usage?.prompt_tokens || 0;
    const outputTokens = data?.usage?.completion_tokens || 0;
    return parseGenerationContent(data?.choices?.[0]?.message?.content, data?.model || model, { aiProvider: "openai", inputTokens, outputTokens, generationMs });
  }
  return send(configuredModel);
}

async function generateContentWithAnthropic(prompt, apiKey, preferredModel = null, systemPrompt = null) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Anthropic API key is not configured.");
  const model = preferredModel || (process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001").trim();
  const startMs = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 2500,
      system: systemPrompt || "You are an expert Shopify copywriter. Always return valid JSON with the requested keys. No markdown. No code fences.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic request failed with status ${res.status}.`);
  const generationMs = Date.now() - startMs;
  const inputTokens = data?.usage?.input_tokens || 0;
  const outputTokens = data?.usage?.output_tokens || 0;
  return parseGenerationContent(data?.content?.[0]?.text, data?.model || model, { aiProvider: "anthropic", inputTokens, outputTokens, generationMs });
}

async function generateContentWithGemini(prompt, apiKey, preferredModel = null, systemPrompt = null) {
  const key = apiKey || process.env.GOOGLE_GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API key is not configured.");
  const model = preferredModel || (process.env.GEMINI_MODEL || "gemini-2.5-flash-lite").trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const startMs = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt || "You are an expert Shopify copywriter. Always return valid JSON with the requested keys. No markdown. No code fences." }],
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
    }),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(data?.error?.message || `Gemini request failed with status ${res.status}.`);
  const generationMs = Date.now() - startMs;
  const inputTokens = data?.usageMetadata?.promptTokenCount || 0;
  const outputTokens = data?.usageMetadata?.candidatesTokenCount || 0;
  const rawContent = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  return parseGenerationContent(rawContent, model, { aiProvider: "gemini", inputTokens, outputTokens, generationMs });
}

async function generateContentWithOllama(prompt, preferredModel = null, systemPrompt = null) {
  const model = preferredModel || process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  const startMs = Date.now();
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model, stream: false, format: "json", options: { temperature: 0.7 },
      messages: [
        { role: "system", content: systemPrompt || "You are an expert Shopify copywriter. Always return valid JSON with the requested keys. No markdown. No code fences." },
        { role: "user", content: prompt },
      ],
    }),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(data?.error || `Ollama request failed with status ${res.status}.`);
  const generationMs = Date.now() - startMs;
  const inputTokens = data?.prompt_eval_count || 0;
  const outputTokens = data?.eval_count || 0;
  return parseGenerationContent(data?.message?.content, data?.model || model, { aiProvider: "ollama", inputTokens, outputTokens, generationMs });
}

async function runGeneration(
  prompt,
  { aiProvider = "auto", preferredModel = null, shopOpenaiKey = null, shopAnthropicKey = null, shopGeminiKey = null, systemPrompt = null } = {},
) {
  const openaiKey = shopOpenaiKey || process.env.OPENAI_API_KEY;
  const anthropicKey = shopAnthropicKey || process.env.ANTHROPIC_API_KEY;
  const geminiKey = shopGeminiKey || process.env.GOOGLE_GEMINI_API_KEY;

  if (aiProvider === "gemini") return generateContentWithGemini(prompt, geminiKey, preferredModel, systemPrompt);
  if (aiProvider === "anthropic") return generateContentWithAnthropic(prompt, anthropicKey, preferredModel, systemPrompt);
  if (aiProvider === "ollama") return generateContentWithOllama(prompt, preferredModel, systemPrompt);
  if (aiProvider === "openai") {
    try { return await generateContentWithOpenAI(prompt, openaiKey, preferredModel, systemPrompt); }
    catch (err) {
      if (OPENAI_OLLAMA_FALLBACK_ERROR_PATTERN.test(err?.message || "") && canUseOllamaFallback())
        return generateContentWithOllama(prompt, preferredModel, systemPrompt);
      throw err;
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
      if (p === "gemini") return await generateContentWithGemini(prompt, geminiKey, preferredModel, systemPrompt);
      if (p === "anthropic") return await generateContentWithAnthropic(prompt, anthropicKey, preferredModel, systemPrompt);
      if (p === "ollama") return await generateContentWithOllama(prompt, preferredModel, systemPrompt);
      return await generateContentWithOpenAI(prompt, openaiKey, preferredModel, systemPrompt); // default / "openai"
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function buildPrompt(
  contentType,
  item,
  templateOverrides = {},
  generateScope = "all",
  generationOptions = {},
) {
  if (generateScope === "faq" && contentType === "products") {
    return [
      "Task: Generate product FAQ content for a Shopify product.",
      "",
      "Inputs:",
      `- Product title: ${item.title || "Untitled product"}`,
      `- Language: ${generationOptions.language || "English"}`,
      `- Keywords and context: ${generationOptions.contextKeywords || "Not provided"}`,
      `- Current product description: ${stripHtml(item.descriptionHtml || "").slice(0, 1200) || "Not available"}`,
      "",
      "Output (return valid JSON only, no markdown, no backticks):",
      '{ "faqs": [{"question": "...", "answer": "..."}, ...] }',
      "",
      "Rules:",
      "- Generate 4 to 6 useful customer FAQ question-and-answer pairs.",
      "- Keep answers concise, accurate, and product-specific.",
      "- Do not invent policies, shipping times, warranties, prices, or claims not present in the inputs.",
    ].join("\n");
  }

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
  if (contentType === "collection_products") {
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
  if (contentType === "collection_products") {
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
  return null;
}

// ─── Loader ───────────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const requestedTab = (url.searchParams.get("tab") || "all").toLowerCase();
  const requestedFilter = (url.searchParams.get("filter") || "all").toLowerCase();
  const validTabs = new Set(["all", "products", "collections", "collection_products", "pages"]);
  const validFilters = new Set(["all", "unoptimized", "empty"]);
  const tab = validTabs.has(requestedTab) ? requestedTab : "all";
  const filter = validFilters.has(requestedFilter) ? requestedFilter : "all";

  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { credits: true, creditsUsedTotal: true, defaultAiProvider: true, openaiApiKey: true, anthropicApiKey: true, geminiApiKey: true },
  });
  const credits = shopData?.credits ?? 150;
  const defaultAiProvider = shopData?.defaultAiProvider || "auto";
  const envAiModel = resolveEnvDefaultAiModel();

  const shouldLoadProducts = tab === "all" || tab === "products";
  const shouldLoadCollections = tab === "all" || tab === "collections";
  const shouldLoadCollectionProducts = tab === "collection_products" || tab === "all";
  const shouldLoadPages = tab === "all" || tab === "pages";
  const shouldLoadBlog = false;

  const [
    productGeneratedRows,
    collectionGeneratedRows,
    collectionProductGeneratedRows,
    pageGeneratedRows,
    logRows,
  ] = await Promise.all([
    shouldLoadProducts
      ? db.productGeneratedContent.findMany({
          where: { shop: session.shop },
          select: {
            productId: true,
            productTitle: true,
            descriptionHtml: true,
            faqHtml: true,
            faqJson: true,
            seoTitle: true,
            seoDescription: true,
            contextKeywords: true,
            descriptionPromptTemplate: true,
            metaTitlePromptTemplate: true,
            metaDescriptionPromptTemplate: true,
            creditsUsed: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    shouldLoadCollections
      ? db.collectionGeneratedContent.findMany({
          where: { shop: session.shop },
          select: {
            collectionId: true,
            collectionTitle: true,
            descriptionHtml: true,
            seoTitle: true,
            seoDescription: true,
            creditsUsed: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    shouldLoadCollectionProducts
      ? db.collectionProductGeneratedContent.findMany({
          where: { shop: session.shop },
          select: {
            collectionId: true,
            collectionTitle: true,
            productId: true,
            productTitle: true,
            descriptionHtml: true,
            seoTitle: true,
            seoDescription: true,
            contextKeywords: true,
            descriptionPromptTemplate: true,
            metaTitlePromptTemplate: true,
            metaDescriptionPromptTemplate: true,
            creditsUsed: true,
            updatedAt: true,
            appliedToProduct: true,
          },
        })
      : Promise.resolve([]),
    shouldLoadPages
      ? db.pageGeneratedContent.findMany({
          where: { shop: session.shop },
          select: {
            pageId: true,
            pageTitle: true,
            bodyHtml: true,
            seoTitle: true,
            seoDescription: true,
            creditsUsed: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    db.generatedContentLog.findMany({
      where: { shop: session.shop },
      select: { productId: true, resourceType: true, creditsUsed: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const productGeneratedMap = new Map(productGeneratedRows.map((row) => [row.productId, row]));
  const collectionGeneratedMap = new Map(collectionGeneratedRows.map((row) => [row.collectionId, row]));
  const pageGeneratedMap = new Map(pageGeneratedRows.map((row) => [row.pageId, row]));
  const liveCollectionProductMap = new Map();

  if (shouldLoadCollectionProducts && collectionProductGeneratedRows.length > 0) {
    const productIds = [...new Set(collectionProductGeneratedRows.map((row) => row.productId).filter(Boolean))];
    for (let index = 0; index < productIds.length; index += 50) {
      const ids = productIds.slice(index, index + 50);
      try {
        const res = await admin.graphql(PRODUCT_NODES_QUERY, { variables: { ids } });
        const json = await res.json();
        (json?.data?.nodes || []).forEach((node) => {
          if (node?.id) liveCollectionProductMap.set(node.id, node);
        });
      } catch (error) {
        console.error("Failed to fetch live collection product content:", error);
      }
    }
  }

  const productCreditsMap = new Map(productGeneratedRows.map((row) => [row.productId, row.creditsUsed ?? 0]));
  const collectionCreditsMap = new Map(collectionGeneratedRows.map((row) => [row.collectionId, row.creditsUsed ?? 0]));
  const pageCreditsMap = new Map(pageGeneratedRows.map((row) => [row.pageId, row.creditsUsed ?? 0]));

  const logCreditsMapByType = {
    products: new Map(),
    collections: new Map(),
    pages: new Map(),
  };

  for (const row of logRows) {
    const itemId = row.productId;
    const creditsUsed = row.creditsUsed ?? 0;
    const type =
      row.resourceType === "collection"
        ? "collections"
        : row.resourceType === "page"
          ? "pages"
          : "products";
    if (!itemId) continue;
    const existing = Number(logCreditsMapByType[type].get(itemId) || 0);
    logCreditsMapByType[type].set(itemId, existing + creditsUsed);
  }

  const creditsUsageByType = logRows.reduce(
    (acc, row) => {
      const used = Number(row.creditsUsed || 0);
      if (!used) return acc;
      if (row.resourceType === "collection") {
        acc.collections += used;
      } else if (row.resourceType === "page") {
        acc.pages += used;
      } else if (row.resourceType === "collection_product") {
        acc.collection_products += used;
      } else {
        acc.products += used;
      }
      return acc;
    },
    { products: 0, collections: 0, collection_products: 0, pages: 0 },
  );

  const resolveCreditsUsed = (contentType, itemId) => {
    if (!itemId) return 0;
    if (contentType === "products") {
      const tableCredits = Number(productCreditsMap.get(itemId) || 0);
      const logCredits = Number(logCreditsMapByType.products.get(itemId) || 0);
      return Math.max(tableCredits, logCredits);
    }
    if (contentType === "collections") {
      const tableCredits = Number(collectionCreditsMap.get(itemId) || 0);
      const logCredits = Number(logCreditsMapByType.collections.get(itemId) || 0);
      return Math.max(tableCredits, logCredits);
    }
    if (contentType === "pages") {
      const tableCredits = Number(pageCreditsMap.get(itemId) || 0);
      const logCredits = Number(logCreditsMapByType.pages.get(itemId) || 0);
      return Math.max(tableCredits, logCredits);
    }
    return 0;
  };

  const generatedIdsByType = {
    products: new Set([
      ...productCreditsMap.keys(),
      ...logCreditsMapByType.products.keys(),
    ]),
    collections: new Set([
      ...collectionCreditsMap.keys(),
      ...logCreditsMapByType.collections.keys(),
    ]),
    pages: new Set([
      ...pageCreditsMap.keys(),
      ...logCreditsMapByType.pages.keys(),
    ]),
    blog: new Set(),
  };

  const isGeneratedItem = (contentType, itemId) => generatedIdsByType[contentType]?.has(itemId);

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
      allItems.push(...productNodes.filter((n) => isGeneratedItem("products", n.id)).map((n) => {
        const generated = productGeneratedMap.get(n.id) || {};
        return {
        ...generated,
        id: n.id,
        title: generated.productTitle || n.title,
        handle: n.handle,
        status: n.status,
        descriptionHtml: firstNonEmptyHtml(generated.descriptionHtml, n.descriptionHtml),
        faqHtml: generated.faqHtml || "",
        faqJson: generated.faqJson || "",
        seoTitle: firstNonEmptyText(generated.seoTitle, n.seo?.title),
        seoDescription: firstNonEmptyText(generated.seoDescription, n.seo?.description),
        imageUrl: n.featuredMedia?.preview?.image?.url || null,
        imageAlt: n.featuredMedia?.preview?.image?.altText || (generated.productTitle || n.title),
        updatedAt: generated.updatedAt || n.updatedAt || null,
        contentType: "products",
        creditsUsed: resolveCreditsUsed("products", n.id),
      };
      }));

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
      allItems.push(...collectionNodes.filter((n) => isGeneratedItem("collections", n.id)).map((n) => {
        const generated = collectionGeneratedMap.get(n.id) || {};
        return {
        ...generated,
        id: n.id,
        title: generated.collectionTitle || n.title,
        handle: n.handle,
        status: "Active",
        descriptionHtml: firstNonEmptyHtml(generated.descriptionHtml, n.descriptionHtml),
        seoTitle: firstNonEmptyText(generated.seoTitle, n.seo?.title),
        seoDescription: firstNonEmptyText(generated.seoDescription, n.seo?.description),
        imageUrl: n.image?.url || null,
        imageAlt: n.image?.altText || (generated.collectionTitle || n.title),
        updatedAt: generated.updatedAt || n.updatedAt || null,
        contentType: "collections",
        creditsUsed: resolveCreditsUsed("collections", n.id),
      };
      }));

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
      allItems.push(...pageNodes.filter((n) => isGeneratedItem("pages", n.id)).map((n) => {
        const mfMap = {};
        (n.metafields?.edges || []).forEach(({ node: mf }) => { mfMap[mf.key] = mf.value; });
        return {
          ...(pageGeneratedMap.get(n.id) || {}),
          id: n.id,
          title: pageGeneratedMap.get(n.id)?.pageTitle || n.title,
          handle: n.handle,
          status: "Active",
          descriptionHtml: firstNonEmptyHtml(pageGeneratedMap.get(n.id)?.bodyHtml, n.body),
          seoTitle: firstNonEmptyText(pageGeneratedMap.get(n.id)?.seoTitle, mfMap.title_tag),
          seoDescription: firstNonEmptyText(pageGeneratedMap.get(n.id)?.seoDescription, mfMap.description_tag),
          imageUrl: null,
          imageAlt: pageGeneratedMap.get(n.id)?.pageTitle || n.title,
          updatedAt: pageGeneratedMap.get(n.id)?.updatedAt || n.updatedAt || null,
          contentType: "pages",
          creditsUsed: resolveCreditsUsed("pages", n.id),
        };
      }));

      allItems.push(...collectionProductGeneratedRows.map((row) => {
        const liveProduct = liveCollectionProductMap.get(row.productId) || {};
        return {
        id: `${row.collectionId}::${row.productId}`,
        title: row.productTitle || liveProduct.title || row.productId,
        collectionTitle: row.collectionTitle || row.collectionId,
        productId: row.productId,
        collectionId: row.collectionId,
        handle: liveProduct.handle || "",
        status: row.appliedToProduct ? "Active" : "Generated",
        descriptionHtml: firstNonEmptyHtml(row.descriptionHtml, liveProduct.descriptionHtml),
        seoTitle: firstNonEmptyText(row.seoTitle, liveProduct.seo?.title),
        seoDescription: firstNonEmptyText(row.seoDescription, liveProduct.seo?.description),
        contextKeywords: row.contextKeywords || "",
        descriptionPromptTemplate: row.descriptionPromptTemplate || "",
        metaTitlePromptTemplate: row.metaTitlePromptTemplate || "",
        metaDescriptionPromptTemplate: row.metaDescriptionPromptTemplate || "",
        imageUrl: liveProduct.featuredMedia?.preview?.image?.url || null,
        imageAlt: liveProduct.featuredMedia?.preview?.image?.altText || row.productTitle || liveProduct.title || row.productId,
        updatedAt: row.updatedAt || liveProduct.updatedAt || null,
        contentType: "collection_products",
        creditsUsed: row.creditsUsed ?? 0,
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
      items = nodes.filter((n) => isGeneratedItem("products", n.id)).map((n) => {
        const generated = productGeneratedMap.get(n.id) || {};
        return {
        ...generated,
        id: n.id,
        title: generated.productTitle || n.title,
        handle: n.handle,
        status: n.status,
        descriptionHtml: firstNonEmptyHtml(generated.descriptionHtml, n.descriptionHtml),
        faqHtml: generated.faqHtml || "",
        faqJson: generated.faqJson || "",
        seoTitle: firstNonEmptyText(generated.seoTitle, n.seo?.title),
        seoDescription: firstNonEmptyText(generated.seoDescription, n.seo?.description),
        imageUrl: n.featuredMedia?.preview?.image?.url || null,
        imageAlt: n.featuredMedia?.preview?.image?.altText || (generated.productTitle || n.title),
        updatedAt: generated.updatedAt || n.updatedAt || null,
        contentType: "products",
        creditsUsed: resolveCreditsUsed("products", n.id),
      };
      });
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
      items = nodes.filter((n) => isGeneratedItem("collections", n.id)).map((n) => {
        const generated = collectionGeneratedMap.get(n.id) || {};
        return {
        ...generated,
        id: n.id,
        title: generated.collectionTitle || n.title,
        handle: n.handle,
        status: "Active",
        descriptionHtml: firstNonEmptyHtml(generated.descriptionHtml, n.descriptionHtml),
        seoTitle: firstNonEmptyText(generated.seoTitle, n.seo?.title),
        seoDescription: firstNonEmptyText(generated.seoDescription, n.seo?.description),
        imageUrl: n.image?.url || null,
        imageAlt: n.image?.altText || (generated.collectionTitle || n.title),
        updatedAt: generated.updatedAt || n.updatedAt || null,
        contentType: "collections",
        creditsUsed: resolveCreditsUsed("collections", n.id),
      };
      });
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
      items = nodes.filter((n) => isGeneratedItem("pages", n.id)).map((n) => {
        const mfMap = {};
        (n.metafields?.edges || []).forEach(({ node: mf }) => { mfMap[mf.key] = mf.value; });
        return {
          ...(pageGeneratedMap.get(n.id) || {}),
          id: n.id,
          title: pageGeneratedMap.get(n.id)?.pageTitle || n.title,
          handle: n.handle,
          status: "Active",
          descriptionHtml: firstNonEmptyHtml(pageGeneratedMap.get(n.id)?.bodyHtml, n.body),
          seoTitle: firstNonEmptyText(pageGeneratedMap.get(n.id)?.seoTitle, mfMap.title_tag),
          seoDescription: firstNonEmptyText(pageGeneratedMap.get(n.id)?.seoDescription, mfMap.description_tag),
          imageUrl: null,
          imageAlt: pageGeneratedMap.get(n.id)?.pageTitle || n.title,
          updatedAt: pageGeneratedMap.get(n.id)?.updatedAt || n.updatedAt || null,
          contentType: "pages",
          creditsUsed: resolveCreditsUsed("pages", n.id),
        };
      });
    } else if (tab === "collection_products") {
      items = collectionProductGeneratedRows.map((row) => {
        const liveProduct = liveCollectionProductMap.get(row.productId) || {};
        return {
        id: `${row.collectionId}::${row.productId}`,
        title: row.productTitle || liveProduct.title || row.productId,
        collectionTitle: row.collectionTitle || row.collectionId,
        productId: row.productId,
        collectionId: row.collectionId,
        handle: liveProduct.handle || "",
        status: row.appliedToProduct ? "Active" : "Generated",
        descriptionHtml: firstNonEmptyHtml(row.descriptionHtml, liveProduct.descriptionHtml),
        seoTitle: firstNonEmptyText(row.seoTitle, liveProduct.seo?.title),
        seoDescription: firstNonEmptyText(row.seoDescription, liveProduct.seo?.description),
        contextKeywords: row.contextKeywords || "",
        descriptionPromptTemplate: row.descriptionPromptTemplate || "",
        metaTitlePromptTemplate: row.metaTitlePromptTemplate || "",
        metaDescriptionPromptTemplate: row.metaDescriptionPromptTemplate || "",
        imageUrl: liveProduct.featuredMedia?.preview?.image?.url || null,
        imageAlt: liveProduct.featuredMedia?.preview?.image?.altText || row.productTitle || liveProduct.title || row.productId,
        updatedAt: row.updatedAt || liveProduct.updatedAt || null,
        contentType: "collection_products",
        creditsUsed: row.creditsUsed ?? 0,
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
  items = sortByNewestGenerated(items);

  return {
    tab,
    filter,
    items,
    credits,
    defaultAiProvider,
    envAiModel,
    creditsUsageByType,
    hasOpenaiKey: !!(shopData?.openaiApiKey || process.env.OPENAI_API_KEY),
    hasAnthropicKey: !!(shopData?.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
    hasGeminiKey: !!(shopData?.geminiApiKey || process.env.GOOGLE_GEMINI_API_KEY),
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
    select: { credits: true, defaultAiProvider: true, openaiApiKey: true, anthropicApiKey: true, geminiApiKey: true },
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
    const { runtimeModel, providerHint } = mapSelectedModelToRuntime(preferredModel);
    const resolvedAiProvider =
      providerHint || aiProvider;
    const generationLanguage = String(formData.get("language") || "English").trim() || "English";
    const additionalInformation = String(formData.get("additionalInformation") || "").trim();
    const contextKeywords = additionalInformation;
    const templateOverrides = {
      descriptionPromptTemplate: String(formData.get("descriptionPromptTemplate") || ""),
      bodyPromptTemplate: String(formData.get("bodyPromptTemplate") || ""),
      metaTitlePromptTemplate: String(formData.get("metaTitlePromptTemplate") || ""),
      metaDescriptionPromptTemplate: String(formData.get("metaDescriptionPromptTemplate") || ""),
    };
    const shouldGenerateMain = generateScope === "all" || generateScope === "main";
    const shouldGenerateMetaTitle = generateScope === "all" || generateScope === "meta_title";
    const shouldGenerateMetaDescription = generateScope === "all" || generateScope === "meta_description";
    const shouldGenerateFaq = contentType === "products" && generateScope === "faq";
    const customMainEnabled = String(formData.get("customMainEnabled") || "") === "1";
    const customMetaTitleEnabled = String(formData.get("customMetaTitleEnabled") || "") === "1";
    const customMetaDescriptionEnabled = String(formData.get("customMetaDescriptionEnabled") || "") === "1";
    const customMainPrompt = String(formData.get("customMainPrompt") || "").trim();
    const customMetaTitlePrompt = String(formData.get("customMetaTitlePrompt") || "").trim();
    const customMetaDescriptionPrompt = String(formData.get("customMetaDescriptionPrompt") || "").trim();
    const mainPromptTemplateValue =
      contentType === "pages" ? templateOverrides.bodyPromptTemplate : templateOverrides.descriptionPromptTemplate;

    if (!shouldGenerateFaq && shouldGenerateMain && !String(mainPromptTemplateValue || "").trim()) {
      return { ok: false, intent, error: "Main template/custom instructions are required." };
    }
    if (shouldGenerateMetaTitle && !String(templateOverrides.metaTitlePromptTemplate || "").trim()) {
      return { ok: false, intent, error: "Meta title template/custom instructions are required." };
    }
    if (shouldGenerateMetaDescription && !String(templateOverrides.metaDescriptionPromptTemplate || "").trim()) {
      return { ok: false, intent, error: "Meta description template/custom instructions are required." };
    }
    if (!shouldGenerateFaq && shouldGenerateMain && !customMainEnabled) {
      return { ok: false, intent, error: "Enable 'Use custom instructions' for main content." };
    }
    if (shouldGenerateMetaTitle && !customMetaTitleEnabled) {
      return { ok: false, intent, error: "Enable 'Use custom instructions' for meta title." };
    }
    if (shouldGenerateMetaDescription && !customMetaDescriptionEnabled) {
      return { ok: false, intent, error: "Enable 'Use custom instructions' for meta description." };
    }
    if (!shouldGenerateFaq && shouldGenerateMain && !customMainPrompt) {
      return { ok: false, intent, error: "Main custom instructions are required." };
    }
    if (shouldGenerateMetaTitle && !customMetaTitlePrompt) {
      return { ok: false, intent, error: "Meta title custom instructions are required." };
    }
    if (shouldGenerateMetaDescription && !customMetaDescriptionPrompt) {
      return { ok: false, intent, error: "Meta description custom instructions are required." };
    }

    try {
      const prompt = buildPrompt(contentType, item, templateOverrides, generateScope, {
        language: generationLanguage,
        contextKeywords,
      });
      const generated = await runGeneration(prompt, {
        aiProvider: resolvedAiProvider,
        preferredModel: runtimeModel || null,
        shopOpenaiKey: shopData?.openaiApiKey || null,
        shopAnthropicKey: shopData?.anthropicApiKey || null,
        shopGeminiKey: shopData?.geminiApiKey || null,
        systemPrompt: getSystemPromptForContentType(contentType),
      });

      if (!shouldGenerateFaq && shouldGenerateMain && !stripHtml(generated.description || "")) {
        throw new Error("AI response did not include generated description/content. Please retry or choose another model.");
      }
      if (shouldGenerateFaq && !stripHtml(generated.faqHtml || "")) {
        throw new Error("AI response did not include valid FAQ content. Please retry or choose another model.");
      }

      const descHtml = shouldGenerateFaq
        ? appendFaqHtmlToDescription(item.descriptionHtml || "", generated.faqHtml || "")
        : shouldGenerateMain && generated.description
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
      } else if (contentType === "collection_products") {
        const rawCollectionProductId = String(item.productId || item.id || "").trim();
        const productId = rawCollectionProductId.includes("::")
          ? rawCollectionProductId.split("::").pop()
          : rawCollectionProductId;
        if (!productId) throw new Error("Missing product id for collection product generation.");
        const res = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
          variables: {
            product: { id: productId, descriptionHtml: descHtml, seo: { title: seoTitle, description: seoDescription } },
          },
        });
        const json = await res.json();
        const errors = json?.data?.productUpdate?.userErrors || [];
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
        aiProvider: generated.aiProvider || null,
        inputTokens: generated.inputTokens || 0,
        outputTokens: generated.outputTokens || 0,
        generationMs: generated.generationMs || null,
        seoTitle: seoTitle || null,
        seoDescription: seoDescription || null,
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
            faqHtml: shouldGenerateFaq ? generated.faqHtml || null : null,
            faqJson: shouldGenerateFaq ? generated.faqJson || null : null,
            ...commonUpsertData,
            creditsUsed: creditsToUse,
            appliedToProduct: true,
          };
          const updateData = {
            ...(shouldGenerateMain
              ? {
                  descriptionPromptTemplate: templateOverrides.descriptionPromptTemplate || null,
                  descriptionHtml: descHtml || null,
                }
              : {}),
            ...(shouldGenerateFaq
              ? {
                  descriptionHtml: descHtml || null,
                  faqHtml: generated.faqHtml || null,
                  faqJson: generated.faqJson || null,
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
            creditsUsed: creditsToUse,
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
        } else if (contentType === "collection_products") {
          const rawCollectionProductId = String(item.productId || item.id || "").trim();
          const productId = rawCollectionProductId.includes("::")
            ? rawCollectionProductId.split("::").pop()
            : rawCollectionProductId;
          const collectionId = String(item.collectionId || "").trim();
          if (productId && collectionId) {
            const createData = {
              shop: session.shop,
              collectionId,
              collectionTitle: item.collectionTitle || null,
              productId,
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
              creditsUsed: creditsToUse,
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
            await db.collectionProductGeneratedContent.upsert({
              where: { shop_collectionId_productId: { shop: session.shop, collectionId, productId } },
              create: createData,
              update: updateData,
            });
          }
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
            creditsUsed: creditsToUse,
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
        }
      } catch (dbError) {
        console.error("Failed to persist content management generation configuration:", dbError);
      }

      // Log generation
      try {
        await db.generatedContentLog.create({
          data: {
            shop: session.shop,
            productId:
              contentType === "collection_products"
                ? (() => {
                    const raw = String(item.productId || item.id || "").trim();
                    return raw.includes("::") ? raw.split("::").pop() : raw;
                  })()
                : item.id,
            productTitle: item.title || null,
            intent: `content_management_${contentType}`,
            resourceType:
              contentType === "pages"
                ? "page"
                : contentType === "collections"
                  ? "collection"
                  : contentType === "collection_products"
                    ? "collection_product"
                    : "product",
            language: generationLanguage,
            tone: "Neutral",
            contextKeywords: contextKeywords || null,
            aiModel: generated.aiModel || null,
            aiProvider: generated.aiProvider || null,
            inputTokens: generated.inputTokens || 0,
            outputTokens: generated.outputTokens || 0,
            generationMs: generated.generationMs || null,
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
        faqHtml: generated.faqHtml || "",
        faqJson: generated.faqJson || "",
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
    const faqHtml = formData.get("faqHtml") || "";
    const faqJson = formData.get("faqJson") || buildFaqJsonFromHtml(faqHtml);
    const seoTitle = formData.get("seoTitle") || "";
    const seoDescription = formData.get("seoDescription") || "";
    const collectionId = String(formData.get("collectionId") || "").trim();
    const postedProductId = String(formData.get("productId") || "").trim();

    try {
      if (contentType === "products") {
        const productId = String(itemId || "").trim();
        if (!productId) throw new Error("Missing product id.");
        const res = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
          variables: {
            product: { id: productId, descriptionHtml, seo: { title: seoTitle, description: seoDescription } },
          },
        });
        const json = await res.json();
        const errors = json?.data?.productUpdate?.userErrors || [];
        if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
        await db.productGeneratedContent.upsert({
          where: { shop_productId: { shop: session.shop, productId } },
          create: {
            shop: session.shop,
            productId,
            descriptionHtml,
            faqHtml: faqHtml || null,
            faqJson: faqJson || null,
            seoTitle,
            seoDescription,
            appliedToProduct: true,
            creditsUsed: 0,
          },
          update: {
            descriptionHtml,
            faqHtml: faqHtml || null,
            faqJson: faqJson || null,
            seoTitle,
            seoDescription,
            appliedToProduct: true,
          },
        });
        const faqMetafields = [];
        if (faqJson) {
          faqMetafields.push({ ownerId: productId, namespace: "content_ai_geo", key: "faq_json", value: faqJson, type: "json" });
        }
        if (faqHtml) {
          faqMetafields.push({ ownerId: productId, namespace: "content_ai_geo", key: "faq_html", value: faqHtml, type: "multi_line_text_field" });
        }
        if (faqMetafields.length > 0) {
          const mfRes = await admin.graphql(METAFIELDS_SET_MUTATION, { variables: { metafields: faqMetafields } });
          const mfJson = await mfRes.json();
          const mfErrors = mfJson?.data?.metafieldsSet?.userErrors || [];
          if (mfErrors.length > 0) throw new Error(mfErrors.map((e) => e.message).join(", "));
        }
      } else if (contentType === "collection_products") {
        const productId = postedProductId || String(itemId || "").split("::").pop() || "";
        if (!productId) throw new Error("Missing product id for collection product save.");

        const res = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
          variables: {
            product: { id: productId, descriptionHtml, seo: { title: seoTitle, description: seoDescription } },
          },
        });
        const json = await res.json();
        const errors = json?.data?.productUpdate?.userErrors || [];
        if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));

        if (collectionId) {
          await db.collectionProductGeneratedContent.upsert({
            where: {
              shop_collectionId_productId: {
                shop: session.shop,
                collectionId,
                productId,
              },
            },
            create: {
              shop: session.shop,
              collectionId,
              productId,
              descriptionHtml,
              seoTitle,
              seoDescription,
              appliedToProduct: true,
              creditsUsed: 0,
            },
            update: {
              descriptionHtml,
              seoTitle,
              seoDescription,
              appliedToProduct: true,
            },
          });
        }
      } else if (contentType === "collections") {
        const collectionKey = String(itemId || "").trim();
        if (!collectionKey) throw new Error("Missing collection id.");
        const res = await admin.graphql(COLLECTION_UPDATE_MUTATION, {
          variables: { input: { id: collectionKey, descriptionHtml, seo: { title: seoTitle, description: seoDescription } } },
        });
        const json = await res.json();
        const errors = json?.data?.collectionUpdate?.userErrors || [];
        if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
        await db.collectionGeneratedContent.upsert({
          where: { shop_collectionId: { shop: session.shop, collectionId: collectionKey } },
          create: {
            shop: session.shop,
            collectionId: collectionKey,
            descriptionHtml,
            seoTitle,
            seoDescription,
            appliedToCollection: true,
            creditsUsed: 0,
          },
          update: {
            descriptionHtml,
            seoTitle,
            seoDescription,
            appliedToCollection: true,
          },
        });
      } else if (contentType === "pages") {
        const pageId = String(itemId || "").trim();
        if (!pageId) throw new Error("Missing page id.");
        const res = await admin.graphql(PAGE_UPDATE_MUTATION, {
          variables: { id: pageId, page: { body: descriptionHtml } },
        });
        const json = await res.json();
        const errors = json?.data?.pageUpdate?.userErrors || [];
        if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
        // Save SEO metafields for page
        const pageMetafields = [];
        if (seoTitle) pageMetafields.push({ ownerId: pageId, namespace: "global", key: "title_tag", value: seoTitle, type: "single_line_text_field" });
        if (seoDescription) pageMetafields.push({ ownerId: pageId, namespace: "global", key: "description_tag", value: seoDescription, type: "single_line_text_field" });
        if (pageMetafields.length > 0) {
          const mfRes = await admin.graphql(METAFIELDS_SET_MUTATION, { variables: { metafields: pageMetafields } });
          const mfJson = await mfRes.json();
          const mfErrors = mfJson?.data?.metafieldsSet?.userErrors || [];
          if (mfErrors.length > 0) throw new Error(mfErrors.map((e) => e.message).join(", "));
        }
        await db.pageGeneratedContent.upsert({
          where: { shop_pageId: { shop: session.shop, pageId } },
          create: {
            shop: session.shop,
            pageId,
            bodyHtml: descriptionHtml,
            seoTitle,
            seoDescription,
            appliedToPage: true,
            creditsUsed: 0,
          },
          update: {
            bodyHtml: descriptionHtml,
            seoTitle,
            seoDescription,
            appliedToPage: true,
          },
        });
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
      return { ok: true, intent, itemId, descriptionHtml, faqHtml, faqJson, seoTitle, seoDescription };
    } catch (err) {
      console.error("Save content failed:", err);
      return { ok: false, intent, error: err?.message || "Save failed." };
    }
  }

  return { ok: false, intent, error: "Unsupported action." };
};

// ─── Editor Modal ─────────────────────────────────────────────────────────────
// Each field (description, faq, seo) opens its own focused editor. No tabs —
// avoids fragile tab-index arithmetic and keeps each editor screen unambiguous.
function EditorModal({ open, item, field, contentType, onClose, onSave, isSaving }) {
  const [descHtml, setDescHtml] = useState("");
  const [faqHtml, setFaqHtml] = useState("");
  const [faqJson, setFaqJson] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");

  // Reset all fields whenever the modal opens for an item (or field changes).
  // Including `open` in the dep array ensures re-opening the same item after
  // an edit reflects the latest saved values, not the stale editor state.
  useEffect(() => {
    if (!open || !item) return;
    setDescHtml(item.descriptionHtml || "");
    setFaqHtml(item.faqHtml || "");
    setFaqJson(item.faqJson || "");
    setSeoTitle(item.seoTitle || "");
    setSeoDescription(item.seoDescription || "");
  }, [open, item, field]);

  if (!item) return null;

  const effectiveContentType = item.contentType || contentType;
  const canEditFaq = effectiveContentType === "products";

  const fieldLabels = {
    description: "Description",
    faq: "FAQ",
    seo: "Meta Title & Description",
    meta_title: "Meta Title & Description",
    meta_description: "Meta Title & Description",
  };
  const fieldLabel = fieldLabels[field] || "Content";
  const modalTitle = `Edit ${fieldLabel} — ${item.title}`;

  const handleSave = () => {
    onSave({
      itemId: item.id,
      descriptionHtml: descHtml,
      faqHtml: canEditFaq ? faqHtml : (item.faqHtml || ""),
      faqJson: canEditFaq
        ? (faqJson || buildFaqJsonFromHtml(faqHtml))
        : (item.faqJson || ""),
      seoTitle,
      seoDescription,
      contentType: effectiveContentType,
      collectionId: item.collectionId || "",
      productId: item.productId || "",
    });
  };

  const isDescField = field === "description";
  const isFaqField = field === "faq";
  const isSeoField = field === "seo" || field === "meta_title" || field === "meta_description";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={modalTitle}
      size="large"
      primaryAction={{
        content: isSaving ? "Saving…" : "Save to Shopify",
        onAction: handleSave,
        loading: isSaving,
        disabled: isSaving,
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        {isDescField && (
          <BlockStack gap="300">
            <Text variant="bodySm" as="p" tone="subdued">
              Edit the description. Changes are pushed directly to Shopify when you save.
            </Text>
            <RichTextEditor value={descHtml} onChange={setDescHtml} />
          </BlockStack>
        )}

        {isFaqField && canEditFaq && (
          <BlockStack gap="300">
            <Text variant="bodySm" as="p" tone="subdued">
              Edit FAQ content. Use <strong>H3 headings</strong> for questions and paragraph text for answers. Changes push to Shopify metafields.
            </Text>
            <RichTextEditor value={faqHtml} onChange={setFaqHtml} />
          </BlockStack>
        )}

        {isSeoField && (
          <BlockStack gap="400">
            <TextField
              label="Meta Title"
              value={seoTitle}
              onChange={setSeoTitle}
              maxLength={70}
              showCharacterCount
              helpText="Recommended: 50–70 characters"
              autoComplete="off"
              autoFocus={field === "meta_title" || field === "seo"}
            />
            <TextField
              label="Meta Description"
              value={seoDescription}
              onChange={setSeoDescription}
              maxLength={160}
              showCharacterCount
              multiline={3}
              helpText="Recommended: 120–160 characters"
              autoComplete="off"
              autoFocus={field === "meta_description"}
            />
          </BlockStack>
        )}
      </Modal.Section>
    </Modal>
  );
}

// ─── Keywords Input ───────────────────────────────────────────────────────────
const MAX_KEYWORDS = 5;

const DEFAULT_KEYWORD_SUGGESTIONS = [
  "high quality", "premium", "durable", "best value", "best selling",
  "eco-friendly", "handmade", "lightweight", "waterproof", "ergonomic",
];

function parseKeywordString(v) {
  return String(v || "")
    .split(/[,|]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function KeywordsInput({ value, onChange, savedSuggestions = [] }) {
  const lastEmittedRef = useRef("");

  const [keywords, setKeywords] = useState(() => parseKeywordString(value));
  const [inputValue, setInputValue] = useState("");

  // Sync with parent value changes (e.g. modal opens with item's contextKeywords).
  // Skip if the change originated from us to avoid re-parse loops.
  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    setKeywords(parseKeywordString(value));
  }, [value]);

  const emit = useCallback((next) => {
    const joined = next.join(", ");
    lastEmittedRef.current = joined;
    onChange(joined);
  }, [onChange]);

  const addKeyword = useCallback((raw) => {
    const clean = raw.trim().toLowerCase();
    if (!clean) return;
    setKeywords((prev) => {
      if (prev.includes(clean) || prev.length >= MAX_KEYWORDS) return prev;
      const next = [...prev, clean];
      emit(next);
      return next;
    });
  }, [emit]);

  const removeKeyword = useCallback((idx) => {
    setKeywords((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      emit(next);
      return next;
    });
  }, [emit]);

  const handleKeyDown = useCallback((e) => {
    if ((e.key === "Tab" || e.key === "Enter") && inputValue.trim()) {
      e.preventDefault();
      addKeyword(inputValue);
      setInputValue("");
      return;
    }
    if (e.key === "Backspace" && !inputValue) {
      setKeywords((prev) => {
        if (prev.length === 0) return prev;
        const next = prev.slice(0, -1);
        emit(next);
        return next;
      });
    }
  }, [addKeyword, emit, inputValue]);

  // Merge default + saved suggestions, de-dupe against already-selected
  const suggestions = Array.from(
    new Set([...savedSuggestions, ...DEFAULT_KEYWORD_SUGGESTIONS])
  ).filter((s) => !keywords.includes(s)).slice(0, 8);

  const atMax = keywords.length >= MAX_KEYWORDS;

  return (
    <div className="cai-kw-root">
      {/* Header */}
      <div className="cai-kw-header">
        <span className="cai-kw-label">Keywords</span>
        <span className="cai-kw-counter">{keywords.length}/{MAX_KEYWORDS}</span>
      </div>

      {/* Tag box + inline input */}
      <div className="cai-kw-box" onClick={() => document.getElementById("cai-kw-field")?.focus()}>
        {keywords.map((kw, idx) => (
          <span key={kw} className="cai-kw-tag">
            {kw}
            <button
              type="button"
              className="cai-kw-tag-remove"
              onClick={(e) => { e.stopPropagation(); removeKeyword(idx); }}
              aria-label={`Remove ${kw}`}
            >
              ×
            </button>
          </span>
        ))}
        {!atMax && (
          <input
            id="cai-kw-field"
            type="text"
            className="cai-kw-field"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={keywords.length === 0 ? "Type a keyword, press Tab or Enter to add" : ""}
            autoComplete="off"
          />
        )}
        {atMax && (
          <span className="cai-kw-max-note">Max {MAX_KEYWORDS} keywords</span>
        )}
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && !atMax && (
        <div className="cai-kw-suggestions">
          <span className="cai-kw-suggestions-label">From your saved keywords:</span>
          <div className="cai-kw-chips">
            {suggestions.map((kw) => (
              <button
                key={kw}
                type="button"
                className="cai-kw-chip"
                onClick={() => addKeyword(kw)}
              >
                + {kw}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GenerateTemplateModal({
  open,
  item,
  contentType,
  generateScope,
  templateSelection,
  customInstructions,
  language,
  additionalInformation,
  previewText,
  progress,
  onChange,
  onLanguageChange,
  onAdditionalInformationChange,
  onCustomInstructionToggle,
  onCustomInstructionPromptChange,
  onResetDefaults,
  onClose,
  onGenerate,
  onSave,
  isSaving,
  isGenerating,
}) {
  const [editablePreviewHtml, setEditablePreviewHtml] = useState("");
  const [editableMetaText, setEditableMetaText] = useState("");
  const isHydratedRef = useRef(false);
  const config = getGenerateTemplateConfig(contentType);
  const isFaqScope = contentType === "products" && generateScope === "faq";
  const showMain = generateScope === "all" || generateScope === "main" || isFaqScope;
  const showMetaTitle = generateScope === "all" || generateScope === "meta_title";
  const showMetaDescription = generateScope === "all" || generateScope === "meta_description";
  const modalCredits = creditsForGenerateScope(generateScope);
  const scopeLabel = getScopeDisplayLabel(contentType, generateScope);
  const itemTypeLabel = getContentTypeDisplayLabel(contentType);
  const titleScope = scopeLabel === "All" ? "content" : scopeLabel.toLowerCase();
  const hasExistingContent = Boolean(
    stripHtml(item?.descriptionHtml || "") ||
    String(item?.seoTitle || "").trim() ||
    String(item?.seoDescription || "").trim() ||
    stripHtml(item?.faqHtml || "")
  );

  useEffect(() => {
    isHydratedRef.current = true;
  }, []);

  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
  const [templateLibraryTab, setTemplateLibraryTab] = useState("description");
  const browseButtonLabel = "Browse Templates";
  const getScopeLabel = useCallback((scope) => {
    if (scope === "main") return contentType === "pages" ? "Body" : "Description";
    if (scope === "meta_title") return "Meta Title";
    return "Meta Description";
  }, [contentType]);
  const getDefaultPromptByScope = useCallback((scope) => {
    if (scope === "meta_title") {
      if (contentType === "collections" || contentType === "collection_products") {
        return "Generate SEO-optimized meta title for the given collection.\n\nRequirements:\n- Primary keyword placement\n- Brand name inclusion\n- Under 60 characters\n- Compelling and descriptive\n- Search-friendly format\n\nFocus on click-through rate optimization.";
      }
      if (contentType === "products") {
        return "Write an SEO-friendly meta title for the given product.\n\nRequirements:\n- Primary keyword placement\n- Brand name inclusion\n- Under 60 characters\n- Compelling and descriptive\n- Search-friendly format\n\nFocus on click-through rate optimization.";
      }
      return "Generate SEO-optimized meta title for the given page.\n\nRequirements:\n- Primary keyword placement\n- Brand name inclusion\n- Under 60 characters\n- Compelling and descriptive\n- Search-friendly format\n\nFocus on click-through rate optimization.";
    }
    if (scope === "meta_description") {
      if (contentType === "collections" || contentType === "collection_products") {
        return "Generate SEO-optimized meta description for given collection.\n\nFocus on:\n- Primary keyword naturally included\n- Clear value proposition\n- Call to action\n- 140-160 characters max\n- Compelling and click-worthy\n\nFormat: Engaging description that drives clicks from search results.";
      }
      if (contentType === "products") {
        return "Write an SEO-friendly meta description for the given product.\n\nRequirements:\n- Primary keyword naturally included\n- Clear value proposition\n- Call to action\n- 140-160 characters max\n- Compelling and click-worthy\n\nFormat: Engaging description that drives clicks from search results.";
      }
      return "Generate SEO-optimized meta description for given page.\n\nFocus on:\n- Primary keyword naturally included\n- Clear value proposition\n- Call to action\n- 140-160 characters max\n- Compelling and click-worthy\n\nFormat: Engaging description that drives clicks from search results.";
    }
    if (contentType === "pages") {
      return "Generate premium long-form page content for the given Shopify page.\n\nObjective:\nCreate clear, persuasive, SEO-aware content that is easy to scan and ready to publish.\n\nRequirements:\n- Understand the page type and user intent before writing.\n- Use heading/subheading structure.\n- Keep language simple, direct, and customer-focused.\n- Include natural keyword usage without stuffing.\n- End with a clear CTA.";
    }
    if (contentType === "collections" || contentType === "collection_products") {
      return "Write a clear, engaging, and SEO-friendly collection description for the given collection.\n\nFocus on:\n- What type of products are in this collection\n- Who this collection is best for\n- Key value/benefits customers get\n- Search-friendly structure with natural keywords\n\nFormat:\n- 1 short intro paragraph\n- 3-5 bullet points for highlights\n- 1 closing CTA line";
    }
    return "Write a clear, engaging, and professional product description for the given product.\n\nFollow this format:\n- Intro paragraph\n- Key features in bullets\n- Benefits and use-case value\n- Closing CTA";
  }, [contentType]);

  const visibleScopes = [
    ...(showMain && !isFaqScope ? ["main"] : []),
    ...(showMetaDescription ? ["meta_description"] : []),
    ...(showMetaTitle ? ["meta_title"] : []),
  ];

  const openTemplateLibraryForScope = useCallback((scope) => {
    const tabId = scope === "main" ? "description" : scope;
    setTemplateLibraryTab(tabId);
    setTemplateLibraryOpen(true);
  }, []);

  const handleUseTemplateFromLibrary = useCallback((templateText) => {
    if (!templateText) return;
    const scope = templateLibraryTab === "description" ? "main" : templateLibraryTab;
    if (templateLibraryTab === "meta_title") {
      const matched = (config?.metaTitleTemplates || []).find((template) => template.template === templateText);
      onChange("metaTitleTemplateId", matched?.id || "");
    } else if (templateLibraryTab === "meta_description") {
      const matched = (config?.metaDescriptionTemplates || []).find((template) => template.template === templateText);
      onChange("metaDescriptionTemplateId", matched?.id || "");
    } else {
      const matched = (config?.mainTemplates || []).find((template) => template.template === templateText);
      onChange("mainTemplateId", matched?.id || "");
    }
    onCustomInstructionPromptChange(scope, templateText);
    onCustomInstructionToggle(scope, true);
    setTemplateLibraryOpen(false);
  }, [
    config?.mainTemplates,
    config?.metaDescriptionTemplates,
    config?.metaTitleTemplates,
    onChange,
    onCustomInstructionPromptChange,
    onCustomInstructionToggle,
    templateLibraryTab,
  ]);
  useEffect(() => {
    if (!isHydratedRef.current || !open || !item) return;
    if (showMain) {
      setEditablePreviewHtml(normalizeGeneratedHtml(previewText || (isFaqScope ? item.faqHtml : item.descriptionHtml) || ""));
      setEditableMetaText("");
      return;
    }
    if (generateScope === "meta_title") {
      setEditableMetaText(previewText || item.seoTitle || "");
      setEditablePreviewHtml("");
      return;
    }
    setEditableMetaText(previewText || item.seoDescription || "");
    setEditablePreviewHtml("");
  }, [open, item, previewText, showMain, generateScope, isFaqScope]);

  const hasSavableContent = showMain
    ? Boolean(stripHtml(editablePreviewHtml))
    : Boolean(String(editableMetaText || "").trim());

  const handleSavePreview = useCallback(() => {
    if (!item || !onSave) return;
    const nextDescriptionHtml = showMain
      ? isFaqScope
        ? item.descriptionHtml || ""
        : normalizeGeneratedHtml(editablePreviewHtml || "")
      : item.descriptionHtml || "";
    const nextFaqHtml = isFaqScope ? normalizeGeneratedHtml(editablePreviewHtml || "") : item.faqHtml || "";
    const nextSeoTitle = generateScope === "meta_title"
      ? cleanInlineText(editableMetaText || "", 70)
      : (item.seoTitle || "");
    const nextSeoDescription = generateScope === "meta_description"
      ? cleanInlineText(editableMetaText || "", 160)
      : (item.seoDescription || "");

    onSave({
      itemId: item.id,
      contentType,
      descriptionHtml: nextDescriptionHtml,
      faqHtml: nextFaqHtml,
      faqJson: isFaqScope ? buildFaqJsonFromHtml(nextFaqHtml) : item.faqJson || "",
      seoTitle: nextSeoTitle,
      seoDescription: nextSeoDescription,
    });
  }, [contentType, editableMetaText, editablePreviewHtml, generateScope, isFaqScope, item, onSave, showMain]);

  const previewMetaText =
    !showMain && editableMetaText
      ? editableMetaText
      : !showMain
        ? `Generated ${scopeLabel} will appear here`
        : "";

  if (!open || !item || !config) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Generate ${itemTypeLabel} ${titleScope}`}
      className="content-mgmt-generate-modal"
      size="large"
      primaryAction={{
        content: isGenerating
          ? "Generating..."
          : `${hasExistingContent ? "Regenerate" : "Generate"} (${modalCredits} credits)`,
        onAction: onGenerate,
        loading: isGenerating,
        disabled: isGenerating,
      }}
      secondaryActions={[
        {
          content: isSaving ? "Saving..." : "Save",
          onAction: handleSavePreview,
          disabled: isGenerating || isSaving || !hasSavableContent,
        },
        { content: "Cancel", onAction: onClose, disabled: isGenerating || isSaving },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="300" className="content-mgmt-generate-modal__content">
          <Text as="p" variant="bodySm" tone="subdued">
            Select templates and options. Credits are deducted only after successful generation.
          </Text>

          {isGenerating ? (
            <BlockStack gap="150">
              <Text as="p" variant="bodySm" tone="subdued">Generating content...</Text>
              <ProgressBar progress={progress} size="small" />
            </BlockStack>
          ) : null}

          <div className="content-mgmt-generate-modal__grid">
            <div className="content-mgmt-generate-modal__left">
              <Card>
                <div className="content-mgmt-generate-modal__preview">
                  {showMain ? (
                    editablePreviewHtml ? (
                      <RichTextEditor value={editablePreviewHtml} onChange={setEditablePreviewHtml} />
                    ) : (
                      <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                        Generated content will appear here
                      </Text>
                    )
                  ) : (
                    <BlockStack gap="200">
                      <TextField
                        label={generateScope === "meta_title" ? "Meta title preview" : "Meta description preview"}
                        value={editableMetaText}
                        onChange={setEditableMetaText}
                        multiline={generateScope === "meta_description" ? 6 : 1}
                        autoComplete="off"
                        placeholder={previewMetaText}
                      />
                    </BlockStack>
                  )}
                </div>
              </Card>
            </div>

            <div className="content-mgmt-generate-modal__right">
              <BlockStack gap="300">
              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="headingSm">{itemTypeLabel[0].toUpperCase() + itemTypeLabel.slice(1)}</Text>
                  <div className="content-mgmt-generate-modal__item">
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

              <Card>
                <BlockStack gap="250">
                  <Text as="h3" variant="headingSm">Generation Options</Text>
                  <Select
                    label="Language"
                    options={LANGUAGE_OPTIONS}
                    value={language || "English"}
                    onChange={onLanguageChange}
                  />
                  <KeywordsInput
                    value={additionalInformation || ""}
                    onChange={onAdditionalInformationChange}
                    savedSuggestions={parseKeywordString(item?.contextKeywords || "")}
                  />
                </BlockStack>
              </Card>

              {visibleScopes.map((scope) => {
                const scopeState =
                  customInstructions?.[scope] || { enabled: false, prompt: "" };
                const scopeDefaultPrompt = getDefaultPromptByScope(scope);
                return (
                  <Card key={scope}>
                    <BlockStack gap="250">
                      <Text as="h3" variant="headingSm">{getScopeLabel(scope)}</Text>
                      <InlineStack align="space-between" blockAlign="center" wrap={false}>
                        <Checkbox
                          label={(
                            <span>
                              Use custom instructions <span style={{ color: "#f59e0b" }}>✦</span>
                            </span>
                          )}
                          checked={Boolean(scopeState.enabled)}
                          onChange={(checked) => {
                            onCustomInstructionToggle(scope, checked);
                            if (checked) {
                              onCustomInstructionPromptChange(scope, scopeDefaultPrompt);
                            }
                          }}
                        />
                        <Button variant="secondary" onClick={() => openTemplateLibraryForScope(scope)}>
                          {browseButtonLabel}
                        </Button>
                      </InlineStack>

                      {scopeState.enabled ? (
                        <BlockStack gap="200">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">Custom Prompt</Text>
                          <TextField
                            label="Custom Prompt"
                            labelHidden
                            value={scopeState.prompt || ""}
                            onChange={(value) => onCustomInstructionPromptChange(scope, value)}
                            multiline={12}
                            autoComplete="off"
                            placeholder="Write detailed instructions for style, tone, structure, and required points."
                          />
                          <InlineStack gap="200">
                            <Button variant="secondary" onClick={() => openTemplateLibraryForScope(scope)}>Browse Templates</Button>
                            <Button
                              variant="secondary"
                              onClick={() => onResetDefaults(scope, scopeDefaultPrompt)}
                            >
                              Reset to Default
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      ) : null}
                    </BlockStack>
                  </Card>
                );
              })}
              </BlockStack>
            </div>
          </div>
        </BlockStack>

        <TemplateLibraryModal
          key={`${contentType}-${templateLibraryTab}`}
          open={templateLibraryOpen}
          onClose={() => setTemplateLibraryOpen(false)}
          tabs={[
            { id: "description", label: contentType === "pages" ? "Body" : "Description" },
            { id: "meta_title", label: "Meta Title" },
            { id: "meta_description", label: "Meta Description" },
          ]}
          initialTab={templateLibraryTab}
          templatesByTab={{
            description: config?.mainTemplates || [],
            meta_title: config?.metaTitleTemplates || [],
            meta_description: config?.metaDescriptionTemplates || [],
          }}
          onUseTemplate={handleUseTemplateFromLibrary}
        />
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
  const { tab, filter, items, credits, defaultAiProvider, envAiModel, creditsUsageByType } = useLoaderData();
  const navigate = useNavigate();
  const location = useLocation();
  const shopify = useAppBridge();
  const generateFetcher = useFetcher();
  const saveFetcher = useFetcher();
  const isHydratedRef = useRef(false);
  const saveRequestInFlightRef = useRef(false);

  // Editor modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorItem, setEditorItem] = useState(null);
  const [editorField, setEditorField] = useState("description");
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [pendingGenerateItem, setPendingGenerateItem] = useState(null);
  const [pendingGenerateContentType, setPendingGenerateContentType] = useState(tab === "all" ? "products" : tab);
  const [pendingGenerateScope, setPendingGenerateScope] = useState("all");
  const [openGeneratePopoverId, setOpenGeneratePopoverId] = useState(null);
  const [generateTemplateSelection, setGenerateTemplateSelection] = useState(defaultTemplateSelection);
  const [customInstructions, setCustomInstructions] = useState(defaultCustomInstructionSettings);
  const [generatePrefsByType, setGeneratePrefsByType] = useState(() => ({
    products: defaultGenerateModalPrefs(),
    collections: defaultGenerateModalPrefs(),
    pages: defaultGenerateModalPrefs(),
    collection_products: defaultGenerateModalPrefs(),
  }));
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generatedPreviewText, setGeneratedPreviewText] = useState("");
  const [generationLanguage, setGenerationLanguage] = useState("English");
  const [generationAdditionalInformation, setGenerationAdditionalInformation] = useState("");

  // Track per-row generating state
  const [generatingId, setGeneratingId] = useState(null);
  const [localItems, setLocalItems] = useState(items);
  const [localCredits, setLocalCredits] = useState(credits);
  const [localCreditsUsageByType, setLocalCreditsUsageByType] = useState(
    creditsUsageByType || { products: 0, collections: 0, collection_products: 0, pages: 0 },
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [tableSearchValue, setTableSearchValue] = useState("");
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Mark hydration complete after first render
  useEffect(() => {
    isHydratedRef.current = true;
  }, []);

  // Sync items from loader (only after hydration to prevent hydration mismatch)
  useEffect(() => {
    if (!isHydratedRef.current) return;
    setLocalItems(items);
  }, [items]);

  useEffect(() => {
    if (!isHydratedRef.current) return;
    setCurrentPage(1);
  }, [tab, filter]);

  useEffect(() => {
    if (!isHydratedRef.current) return;
    setCurrentPage(1);
  }, [tableSearchValue]);

  // Sync credits from loader (only after hydration to prevent hydration mismatch)
  useEffect(() => {
    if (!isHydratedRef.current) return;
    setLocalCredits(credits);
  }, [credits]);

  useEffect(() => {
    if (!isHydratedRef.current) return;
    setLocalCreditsUsageByType(creditsUsageByType || { products: 0, collections: 0, collection_products: 0, pages: 0 });
  }, [creditsUsageByType]);

  useEffect(() => {
    if (!isHydratedRef.current) return;
    const totalPages = Math.max(1, Math.ceil(localItems.length / CONTENT_TABLE_PAGE_SIZE));
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [localItems.length, tableSearchValue]);

  // Handle generate response
  useEffect(() => {
    if (!isHydratedRef.current) return;
    if (generateFetcher.state !== "idle") return;
    const data = generateFetcher.data;
    if (!data || data.intent !== "generate_single") return;
    setGeneratingId(null);
    setGenerationProgress(100);
    if (data.ok) {
      setLocalCredits(data.newCredits);
      const usedCredits = Number(data.creditsUsed || 0);
      if (usedCredits > 0) {
        setLocalCreditsUsageByType((prev) => ({
          ...prev,
          [pendingGenerateContentType]: Number(prev?.[pendingGenerateContentType] || 0) + usedCredits,
        }));
      }
      setLocalItems((prev) =>
        sortByNewestGenerated(
          prev.map((it) =>
            it.id === data.itemId
              ? {
                  ...it,
                  descriptionHtml: data.descriptionHtml,
                  faqHtml: data.faqHtml || it.faqHtml || "",
                  faqJson: data.faqJson || it.faqJson || "",
                  seoTitle: data.seoTitle,
                  seoDescription: data.seoDescription,
                  creditsUsed: Number(it.creditsUsed || 0) + usedCredits,
                  updatedAt: new Date().toISOString(),
                }
              : it
          ),
        )
      );
      if (pendingGenerateScope === "main") {
        setGeneratedPreviewText(data.descriptionHtml || "");
      } else if (pendingGenerateScope === "meta_title") {
        setGeneratedPreviewText(data.seoTitle || "");
      } else if (pendingGenerateScope === "meta_description") {
        setGeneratedPreviewText(data.seoDescription || "");
      } else if (pendingGenerateScope === "faq") {
        setGeneratedPreviewText(data.faqHtml || "");
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
  }, [generateFetcher.state, generateFetcher.data, pendingGenerateScope, pendingGenerateContentType]);

  useEffect(() => {
    if (!isHydratedRef.current) return undefined;
    if (generateFetcher.state === "idle") return undefined;
    setGenerationProgress(12);
    const timer = setInterval(() => {
      setGenerationProgress((prev) => (prev >= 90 ? prev : prev + 8));
    }, 350);
    return () => clearInterval(timer);
  }, [generateFetcher.state]);

  // Handle save response
  useEffect(() => {
    if (!isHydratedRef.current) return;
    if (saveFetcher.state !== "idle") {
      saveRequestInFlightRef.current = true;
      return;
    }
    if (!saveRequestInFlightRef.current) return;
    saveRequestInFlightRef.current = false;

    const data = saveFetcher.data;
    if (!data || data.intent !== "save_content") return;
    if (data.ok) {
      setLocalItems((prev) =>
        sortByNewestGenerated(
          prev.map((it) =>
            it.id === data.itemId
              ? {
                  ...it,
                  descriptionHtml: data.descriptionHtml,
                  faqHtml: data.faqHtml || it.faqHtml || "",
                  faqJson: data.faqJson || it.faqJson || "",
                  seoTitle: data.seoTitle,
                  seoDescription: data.seoDescription,
                  updatedAt: new Date().toISOString(),
                }
              : it
          ),
        )
      );
      if (editorOpen) setEditorOpen(false);
      if (templateModalOpen) {
        setTemplateModalOpen(false);
        setPendingGenerateItem(null);
        setGeneratedPreviewText("");
      }
      shopify.toast.show("Content saved successfully!");
    } else {
      setErrorMessage(data.error || "Save failed.");
    }
  }, [editorOpen, saveFetcher.state, saveFetcher.data, templateModalOpen]);

  const mainTabs = [
    { id: "all", content: "All" },
    { id: "products", content: "Products" },
    { id: "collections", content: "Collections" },
    { id: "collection_products", content: "Collection Product" },
    { id: "pages", content: "Pages" },
  ];
  const mainTabIndex = mainTabs.findIndex((t) => t.id === tab);

  const filterTabs = [
    { id: "all", content: "All" },
    { id: "unoptimized", content: "Unoptimized" },
    { id: "empty", content: "Empty" },
  ];
  const filterTabIndex = filterTabs.findIndex((t) => t.id === filter);
  const buildContextSearch = useCallback(
    (params) => {
      const current = new URLSearchParams(location.search);
      const next = new URLSearchParams(params);
      ["shop", "host", "embedded"].forEach((key) => {
        const value = current.get(key);
        if (value && !next.has(key)) next.set(key, value);
      });
      const query = next.toString();
      return query ? `?${query}` : "";
    },
    [location.search],
  );

  const handleMainTabChange = useCallback(
    (idx) => navigate(buildContextSearch({ tab: mainTabs[idx].id, filter: "all" })),
    [buildContextSearch, navigate]
  );

  const handleFilterTabChange = useCallback(
    (idx) => navigate(buildContextSearch({ tab, filter: filterTabs[idx].id })),
    [buildContextSearch, navigate, tab]
  );

  const openEditor = useCallback((item, field = "description") => {
    setEditorItem(item);
    setEditorField(field);
    setEditorOpen(true);
  }, []);

  const handleSaveContent = useCallback(
    ({ itemId, descriptionHtml, faqHtml, faqJson, seoTitle, seoDescription, contentType, collectionId, productId }) => {
      const fd = new FormData();
      fd.append("intent", "save_content");
      fd.append("contentType", contentType || tab);
      fd.append("itemId", itemId);
      fd.append("descriptionHtml", descriptionHtml);
      fd.append("faqHtml", faqHtml || "");
      fd.append("faqJson", faqJson || "");
      fd.append("seoTitle", seoTitle);
      fd.append("seoDescription", seoDescription);
      if (collectionId) fd.append("collectionId", collectionId);
      if (productId) fd.append("productId", productId);
      saveFetcher.submit(fd, { method: "post" });
    },
    [saveFetcher, tab]
  );

  const handleGenerate = useCallback(
    (item, generateScope = "all") => {
      const effectiveContentType = item.contentType || tab;
      const savedPrefs = generatePrefsByType[effectiveContentType] || defaultGenerateModalPrefs();

      setPendingGenerateItem(item);
      setPendingGenerateContentType(effectiveContentType);
      setPendingGenerateScope(generateScope);
      setGenerateTemplateSelection(savedPrefs.templateSelection || defaultTemplateSelection());
      setCustomInstructions(savedPrefs.customInstructions || defaultCustomInstructionSettings());
      setGeneratedPreviewText("");
      setGenerationLanguage(item.language || "English");
      setGenerationAdditionalInformation(item.contextKeywords || "");
      setGenerationProgress(0);
      setTemplateModalOpen(true);
    },
    [generatePrefsByType, tab]
  );

  const updateGenerateTemplateSelection = useCallback((field, value) => {
    setGenerateTemplateSelection((prev) => {
      const next = { ...prev, [field]: value };
      if (pendingGenerateContentType) {
        setGeneratePrefsByType((all) => ({
          ...all,
          [pendingGenerateContentType]: {
            templateSelection: next,
            customInstructions: all[pendingGenerateContentType]?.customInstructions || defaultCustomInstructionSettings(),
          },
        }));
      }
      return next;
    });
  }, [pendingGenerateContentType]);

  const updateCustomInstructionToggle = useCallback((scope, checked) => {
    setCustomInstructions((prev) => {
      const next = {
        ...prev,
        [scope]: {
          ...(prev?.[scope] || { enabled: false, prompt: "" }),
          enabled: checked,
        },
      };
      if (pendingGenerateContentType) {
        setGeneratePrefsByType((all) => ({
          ...all,
          [pendingGenerateContentType]: {
            templateSelection: all[pendingGenerateContentType]?.templateSelection || defaultTemplateSelection(),
            customInstructions: next,
          },
        }));
      }
      return next;
    });
  }, [pendingGenerateContentType]);

  const updateCustomInstructionPrompt = useCallback((scope, value) => {
    setCustomInstructions((prev) => {
      const next = {
        ...prev,
        [scope]: {
          ...(prev?.[scope] || { enabled: false, prompt: "" }),
          prompt: value,
        },
      };
      if (pendingGenerateContentType) {
        setGeneratePrefsByType((all) => ({
          ...all,
          [pendingGenerateContentType]: {
            templateSelection: all[pendingGenerateContentType]?.templateSelection || defaultTemplateSelection(),
            customInstructions: next,
          },
        }));
      }
      return next;
    });
  }, [pendingGenerateContentType]);

  const resetGenerateModalDefaults = useCallback((scope, defaultPrompt = "") => {
    setCustomInstructions((prev) => {
      const next = {
        ...prev,
        [scope]: {
          enabled: Boolean(defaultPrompt),
          prompt: defaultPrompt || "",
        },
      };
      if (pendingGenerateContentType) {
        setGeneratePrefsByType((all) => ({
          ...all,
          [pendingGenerateContentType]: {
            templateSelection: all[pendingGenerateContentType]?.templateSelection || defaultTemplateSelection(),
            customInstructions: next,
          },
        }));
      }
      return next;
    });
  }, [pendingGenerateContentType]);

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
    const applyCustomInstructions = (templateText, enabledForScope, customInstructionState) => {
      const customText = String(customInstructionState?.prompt || "").trim();
      const shouldApply = Boolean(enabledForScope && customInstructionState?.enabled && customText);
      if (!shouldApply) return templateText;
      if (!templateText) return customText;
      return `${templateText}\n\nCustom Instructions:\n${customText}`;
    };
    const shouldGenerateMain = pendingGenerateScope === "all" || pendingGenerateScope === "main";
    const shouldGenerateMetaTitle = pendingGenerateScope === "all" || pendingGenerateScope === "meta_title";
    const shouldGenerateMetaDescription = pendingGenerateScope === "all" || pendingGenerateScope === "meta_description";
    const shouldGenerateFaq = pendingGenerateContentType === "products" && pendingGenerateScope === "faq";
    if (!shouldGenerateFaq && shouldGenerateMain && !String(mainTemplate || "").trim()) {
      setErrorMessage("Select a main template before generating.");
      return;
    }
    if (shouldGenerateMetaTitle && !String(metaTitleTemplate || "").trim()) {
      setErrorMessage("Select a meta title template before generating.");
      return;
    }
    if (shouldGenerateMetaDescription && !String(metaDescriptionTemplate || "").trim()) {
      setErrorMessage("Select a meta description template before generating.");
      return;
    }
    if (!shouldGenerateFaq && shouldGenerateMain && !customInstructions?.main?.enabled) {
      setErrorMessage("Enable 'Use custom instructions' for main content.");
      return;
    }
    if (shouldGenerateMetaTitle && !customInstructions?.meta_title?.enabled) {
      setErrorMessage("Enable 'Use custom instructions' for meta title.");
      return;
    }
    if (shouldGenerateMetaDescription && !customInstructions?.meta_description?.enabled) {
      setErrorMessage("Enable 'Use custom instructions' for meta description.");
      return;
    }
    if (!shouldGenerateFaq && shouldGenerateMain && !String(customInstructions?.main?.prompt || "").trim()) {
      setErrorMessage("Main custom instructions are required.");
      return;
    }
    if (shouldGenerateMetaTitle && !String(customInstructions?.meta_title?.prompt || "").trim()) {
      setErrorMessage("Meta title custom instructions are required.");
      return;
    }
    if (shouldGenerateMetaDescription && !String(customInstructions?.meta_description?.prompt || "").trim()) {
      setErrorMessage("Meta description custom instructions are required.");
      return;
    }
    const finalMainTemplate = applyCustomInstructions(mainTemplate, shouldGenerateMain, customInstructions?.main);
    const finalMetaTitleTemplate = applyCustomInstructions(metaTitleTemplate, shouldGenerateMetaTitle, customInstructions?.meta_title);
    const finalMetaDescriptionTemplate = applyCustomInstructions(
      metaDescriptionTemplate,
      shouldGenerateMetaDescription,
      customInstructions?.meta_description,
    );

    setErrorMessage(null);
    setGeneratingId(pendingGenerateItem.id);
    setGenerationProgress(6);
    setGeneratedPreviewText("");

    const fd = new FormData();
    fd.append("intent", "generate_single");
    fd.append("contentType", pendingGenerateContentType);
    fd.append("generateScope", pendingGenerateScope);
    fd.append("item", JSON.stringify(pendingGenerateItem));
    fd.append("language", generationLanguage || "English");
    fd.append("additionalInformation", generationAdditionalInformation || "");
    fd.append("aiProvider", defaultAiProvider || "auto");
    fd.append("aiModel", envAiModel || DEFAULT_AI_MODEL);
    fd.append("metaTitlePromptTemplate", finalMetaTitleTemplate);
    fd.append("metaDescriptionPromptTemplate", finalMetaDescriptionTemplate);
    fd.append("customMainEnabled", customInstructions?.main?.enabled ? "1" : "0");
    fd.append("customMetaTitleEnabled", customInstructions?.meta_title?.enabled ? "1" : "0");
    fd.append("customMetaDescriptionEnabled", customInstructions?.meta_description?.enabled ? "1" : "0");
    fd.append("customMainPrompt", String(customInstructions?.main?.prompt || ""));
    fd.append("customMetaTitlePrompt", String(customInstructions?.meta_title?.prompt || ""));
    fd.append("customMetaDescriptionPrompt", String(customInstructions?.meta_description?.prompt || ""));
    if (config?.mainPromptKey === "bodyPromptTemplate") {
      fd.append("bodyPromptTemplate", finalMainTemplate);
    } else {
      fd.append("descriptionPromptTemplate", finalMainTemplate);
    }
    generateFetcher.submit(fd, { method: "post" });
  }, [
    customInstructions,
    defaultAiProvider,
    envAiModel,
    generateFetcher,
    generateTemplateSelection.mainTemplateId,
    generateTemplateSelection.metaDescriptionTemplateId,
    generateTemplateSelection.metaTitleTemplateId,
    generationAdditionalInformation,
    generationLanguage,
    pendingGenerateContentType,
    pendingGenerateItem,
    pendingGenerateScope,
  ]);

  const isSaving = saveFetcher.state !== "idle";

  const tabLabel = mainTabs[mainTabIndex]?.id || "all";
  const singularLabel = {
    products: "Product",
    collections: "Collection",
    collection_products: "Collection Product",
    pages: "Page",
    blog: "Blog",
  }[tabLabel] || "Item";

  const headings = [
    { title: "Item" },
    { title: "Credits" },
    { title: "Description" },
    { title: "FAQ" },
    { title: "SEO Title" },
    { title: "SEO Description" },
    { title: "Generate" },
  ];

  const normalizedTableSearch = tableSearchValue.trim().toLowerCase();
  const visibleItems = normalizedTableSearch
    ? localItems.filter((item) => {
        const haystack = [
          item.title,
          item.collectionTitle,
          stripHtml(item.descriptionHtml || ""),
          item.seoTitle,
          item.seoDescription,
          item.contextKeywords,
          item.descriptionPromptTemplate,
          item.metaTitlePromptTemplate,
          item.metaDescriptionPromptTemplate,
          item.status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedTableSearch);
      })
    : localItems;

  const totalItems = visibleItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / CONTENT_TABLE_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * CONTENT_TABLE_PAGE_SIZE;
  const endIndex = Math.min(startIndex + CONTENT_TABLE_PAGE_SIZE, totalItems);
  const paginatedItems = visibleItems.slice(startIndex, endIndex);

  const rowMarkup = paginatedItems.map((item, idx) => {
    const isGenerating = generatingId === item.id;
    const effectiveContentType = item.contentType || tab;
    const scopeOptions = getGenerateScopeOptions(effectiveContentType);
    const isPopoverOpen = openGeneratePopoverId === item.id;
    const descText = truncateText(item.descriptionHtml, 90);
    const faqText = truncateText(stripHtml(item.faqHtml || ""), 80);
    const seoTitleText = truncateText(item.seoTitle, 70);
    const seoDescText = truncateText(item.seoDescription, 80);
    const hasGeneratedContent = Boolean(
      stripHtml(item.descriptionHtml || "") ||
      String(item.seoTitle || "").trim() ||
      String(item.seoDescription || "").trim() ||
      stripHtml(item.faqHtml || "")
    );

    return (
      <IndexTable.Row id={item.id} key={item.id} position={startIndex + idx}>
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
              {item.collectionTitle ? (
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                  Collection: {item.collectionTitle}
                </div>
              ) : null}
            </div>
          </InlineStack>
        </IndexTable.Cell>

        {/* Credits Used */}
        <IndexTable.Cell>
          <Badge tone="info">{Number(item.creditsUsed || 0)}</Badge>
        </IndexTable.Cell>

        {/* Description – clickable to open editor */}
        <IndexTable.Cell>
          <button
            type="button"
            onClick={() => openEditor(item, "description")}
            title="Click to edit description"
            className="content-mgmt-edit-cell-btn"
          >
            <span className="content-mgmt-edit-cell-text">
              {descText || <span style={{ color: "#9ca3af" }}>Add description</span>}
            </span>
            <span className="content-mgmt-edit-icon" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2.5a2.121 2.121 0 013 3L6 17H2v-4L14.5 2.5z"/>
              </svg>
            </span>
          </button>
        </IndexTable.Cell>

        {/* FAQ */}
        <IndexTable.Cell>
          <div className="content-mgmt-faq-cell">
            {effectiveContentType === "products" ? (
              <button
                type="button"
                onClick={() => openEditor(item, "faq")}
                title={faqText ? "Click to edit FAQ" : "Click to add FAQ"}
                className="content-mgmt-edit-cell-btn"
              >
                <span className="content-mgmt-edit-cell-text">
                  {faqText || <span style={{ color: "#9ca3af" }}>Add FAQ</span>}
                </span>
                <span className="content-mgmt-edit-icon" aria-hidden="true">
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 2.5a2.121 2.121 0 013 3L6 17H2v-4L14.5 2.5z"/>
                  </svg>
                </span>
              </button>
            ) : (
              <Text variant="bodySm" as="span" tone="subdued">—</Text>
            )}
          </div>
        </IndexTable.Cell>

        {/* SEO Title */}
        <IndexTable.Cell>
          <button
            type="button"
            onClick={() => openEditor(item, "meta_title")}
            title="Click to edit meta title"
            className="content-mgmt-edit-cell-btn"
          >
            <span className="content-mgmt-edit-cell-text">
              {seoTitleText || <span style={{ color: "#9ca3af" }}>Add meta title</span>}
            </span>
            <span className="content-mgmt-edit-icon" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2.5a2.121 2.121 0 013 3L6 17H2v-4L14.5 2.5z"/>
              </svg>
            </span>
          </button>
        </IndexTable.Cell>

        {/* SEO Description */}
        <IndexTable.Cell>
          <button
            type="button"
            onClick={() => openEditor(item, "meta_description")}
            title="Click to edit meta description"
            className="content-mgmt-edit-cell-btn"
          >
            <span className="content-mgmt-edit-cell-text">
              {seoDescText || <span style={{ color: "#9ca3af" }}>Add meta description</span>}
            </span>
            <span className="content-mgmt-edit-icon" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2.5a2.121 2.121 0 013 3L6 17H2v-4L14.5 2.5z"/>
              </svg>
            </span>
          </button>
        </IndexTable.Cell>

        {/* Generate button */}
        <IndexTable.Cell>
          <Popover
            active={isPopoverOpen}
            activator={
              <Button
                size="slim"
                loading={isGenerating}
                disabled={isGenerating || localCredits < 1}
                onClick={() => setOpenGeneratePopoverId((prev) => (prev === item.id ? null : item.id))}
                accessibilityLabel={`${hasGeneratedContent ? "Regenerate" : "Generate"} options`}
              >
                {hasGeneratedContent ? "Regenerate" : "Generate"}
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
      subtitle="Manage and generate content with AI to attract more customers (AI-generated records only)"
      primaryAction={
        <InlineStack gap="200" blockAlign="center">
          <button
            type="button"
            onClick={() => navigate({ pathname: "/app/analytics", search: buildContextSearch({}) })}
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

        {/* <Card>
          <BlockStack gap="200">
            <Text variant="headingSm" as="h3">Credits Used (By Content Type)</Text>
            <InlineStack gap="200" wrap>
              <Badge tone="info">Product: {localCreditsUsageByType.products || 0}</Badge>
              <Badge tone="info">Collection: {localCreditsUsageByType.collections || 0}</Badge>
              <Badge tone="info">Collection Product: {localCreditsUsageByType.collection_products || 0}</Badge>
              <Badge tone="info">Page: {localCreditsUsageByType.pages || 0}</Badge>
            </InlineStack>
          </BlockStack>
        </Card> */}

        {/* Main tabs: Products | Collections | Pages | Blog */}
        <Card padding="0">
          <Box padding="300" paddingBlockEnd="200">
            <BlockStack gap="300">
              <div className="content-mgmt-main-tabs-shell">
                <Tabs
                  tabs={mainTabs}
                  selected={mainTabIndex < 0 ? 0 : mainTabIndex}
                  onSelect={handleMainTabChange}
                />
              </div>

              <Tabs
                tabs={filterTabs}
                selected={filterTabIndex < 0 ? 0 : filterTabIndex}
                onSelect={handleFilterTabChange}
              />

              <TextField
                label="Search table"
                labelHidden
                value={tableSearchValue}
                onChange={setTableSearchValue}
                clearButton
                onClearButtonClick={() => setTableSearchValue("")}
                placeholder={`Search ${singularLabel.toLowerCase()} content...`}
                autoComplete="off"
              />
            </BlockStack>
          </Box>

          {/* Table */}
          {visibleItems.length === 0 ? (
            <EmptyState
              heading={`No AI-generated ${tabLabel} found`}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <Text as="p">
                {normalizedTableSearch
                  ? `No ${tabLabel} records match "${tableSearchValue.trim()}".`
                  : filter === "empty"
                  ? `No AI-generated ${tabLabel} items match empty content filter.`
                  : filter === "unoptimized"
                  ? `No AI-generated ${tabLabel} items match unoptimized filter.`
                  : `No AI-generated ${tabLabel} records are available yet.`}
              </Text>
            </EmptyState>
          ) : (
            <>
              <IndexTable
                resourceName={{ singular: singularLabel, plural: tabLabel }}
                itemCount={totalItems}
                headings={headings}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
              <Box padding="300" borderBlockStartWidth="025" borderColor="border">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Showing {totalItems === 0 ? 0 : startIndex + 1}-{endIndex} of {totalItems}
                  </Text>
                  <Pagination
                    hasPrevious={safeCurrentPage > 1}
                    onPrevious={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    hasNext={safeCurrentPage < totalPages}
                    onNext={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    label={`Page ${safeCurrentPage} of ${totalPages}`}
                  />
                </InlineStack>
              </Box>
            </>
          )}
        </Card>
      </BlockStack>

      <style>{`
        .content-mgmt-main-tabs-shell {
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 4px;
        }
        .content-mgmt-main-tabs-shell .Polaris-Tabs__Tab {
          border-radius: 10px;
        }
        .content-mgmt-main-tabs-shell .Polaris-Tabs__Tab--active,
        .content-mgmt-main-tabs-shell .Polaris-Tabs__Tab--active:hover,
        .content-mgmt-main-tabs-shell .Polaris-Tabs__Tab--active:focus {
          background: #e5e7eb;
          color: #111827;
          border-radius: 10px;
        }
        .content-mgmt-generate-modal__grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(360px, 1fr);
          gap: 16px;
          align-items: start;
        }
        .content-mgmt-generate-modal__left,
        .content-mgmt-generate-modal__right {
          min-width: 0;
        }
        .content-mgmt-generate-modal__preview {
          min-height: 520px;
          max-height: 68vh;
          overflow: auto;
        }
        .content-mgmt-generate-modal__item {
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 10px;
          background: #f9fafb;
        }
        .content-mgmt-keyword-field {
          border: 1px solid #d1d5db;
          border-radius: 8px;
          padding: 10px;
          background: #ffffff;
        }

        /* ── Keywords Input ── */
        .cai-kw-root {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cai-kw-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .cai-kw-label {
          font-size: 14px;
          font-weight: 500;
          color: #202223;
        }
        .cai-kw-counter {
          font-size: 13px;
          color: #6b7280;
        }
        .cai-kw-box {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          min-height: 42px;
          padding: 7px 12px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          background: #ffffff;
          cursor: text;
          transition: border-color 150ms ease, box-shadow 150ms ease;
        }
        .cai-kw-box:focus-within {
          border-color: #6366f1;
          box-shadow: 0 0 0 2px rgba(99,102,241,0.12);
        }
        .cai-kw-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
          border-radius: 20px;
          padding: 3px 6px 3px 10px;
          font-size: 13px;
          color: #374151;
          white-space: nowrap;
          line-height: 1.4;
        }
        .cai-kw-tag-remove {
          background: none;
          border: none;
          cursor: pointer;
          color: #9ca3af;
          font-size: 16px;
          line-height: 1;
          padding: 0 2px;
          display: flex;
          align-items: center;
          transition: color 100ms ease;
        }
        .cai-kw-tag-remove:hover { color: #ef4444; }
        .cai-kw-field {
          flex: 1;
          min-width: 160px;
          border: none;
          outline: none;
          font-size: 13px;
          color: #374151;
          background: transparent;
          padding: 2px 0;
        }
        .cai-kw-field::placeholder { color: #9ca3af; }
        .cai-kw-max-note {
          font-size: 12px;
          color: #9ca3af;
          padding: 2px 0;
        }
        .cai-kw-suggestions {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .cai-kw-suggestions-label {
          font-size: 12px;
          color: #6b7280;
        }
        .cai-kw-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .cai-kw-chip {
          background: none;
          border: 1px solid #e5e7eb;
          border-radius: 20px;
          padding: 4px 12px;
          font-size: 13px;
          color: #374151;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease;
          white-space: nowrap;
        }
        .cai-kw-chip:hover {
          background: #f3f4f6;
          border-color: #9ca3af;
        }
        .content-mgmt-faq-cell {
          width: 180px;
          min-width: 180px;
          max-width: 180px;
        }
        .content-mgmt-cell-button {
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          text-align: left;
          display: block;
          width: 100%;
          max-width: 100%;
        }
        .content-mgmt-edit-cell-btn {
          background: none;
          border: none;
          padding: 3px 6px 3px 0;
          cursor: pointer;
          text-align: left;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          max-width: 260px;
          width: 100%;
          border-radius: 6px;
          transition: background 120ms ease;
        }
        .content-mgmt-edit-cell-btn:hover {
          background: #f3f4f6;
        }
        .content-mgmt-edit-cell-text {
          flex: 1;
          min-width: 0;
          font-size: 13px;
          color: #374151;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.4;
        }
        .content-mgmt-edit-icon {
          flex-shrink: 0;
          color: #9ca3af;
          opacity: 0;
          transition: opacity 120ms ease;
          display: flex;
          align-items: center;
        }
        .content-mgmt-edit-cell-btn:hover .content-mgmt-edit-icon {
          opacity: 1;
          color: #6366f1;
        }
        @media (max-width: 960px) {
          .content-mgmt-generate-modal__grid {
            grid-template-columns: 1fr;
          }
          .content-mgmt-generate-modal__preview {
            min-height: 360px;
            max-height: 55vh;
          }
        }
      `}</style>

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
        customInstructions={customInstructions}
        language={generationLanguage}
        additionalInformation={generationAdditionalInformation}
        previewText={generatedPreviewText}
        progress={generationProgress}
        onChange={updateGenerateTemplateSelection}
        onLanguageChange={setGenerationLanguage}
        onAdditionalInformationChange={setGenerationAdditionalInformation}
        onCustomInstructionToggle={updateCustomInstructionToggle}
        onCustomInstructionPromptChange={updateCustomInstructionPrompt}
        onResetDefaults={resetGenerateModalDefaults}
        onClose={closeGenerateModal}
        onGenerate={handleConfirmGenerate}
        onSave={handleSaveContent}
        isSaving={isSaving}
        isGenerating={generateFetcher.state !== "idle"}
      />
    </Page>
  );
}
