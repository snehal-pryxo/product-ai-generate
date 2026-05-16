import db from "../db.server";
import {
  buildProductContentPrompt,
  buildCollectionContentPrompt,
  getProductSystemPrompt,
  getCollectionSystemPrompt,
} from "./contentPromptTemplates";
import { creditsForContentTypes } from "./credits.server";

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

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

export async function getApiKeys(shop) {
  const row = await db.shop.findUnique({
    where: { shop },
    select: { openaiApiKey: true, anthropicApiKey: true, geminiApiKey: true, defaultAiProvider: true },
  });
  return {
    openaiApiKey: row?.openaiApiKey || null,
    anthropicApiKey: row?.anthropicApiKey || null,
    geminiApiKey: row?.geminiApiKey || null,
    defaultAiProvider: row?.defaultAiProvider || "auto",
  };
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function looksLikeHtml(text) {
  return /<[a-z][\s\S]*>/i.test(text);
}

export function stripHtml(html) {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanInlineText(value, maxLength) {
  const text = (value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return maxLength ? text.slice(0, maxLength) : text;
}

function toStructuredHtml(text) {
  const lines = text.split(/\n+/);
  const html = [];
  let paragraphLines = [];
  let listType = null;
  let listItems = [];
  let firstHeadingUsed = false;

  function flushParagraph() {
    if (paragraphLines.length > 0) {
      html.push(`<p>${paragraphLines.map(escapeHtml).join(" ")}</p>`);
      paragraphLines = [];
    }
  }
  function flushList() {
    if (listItems.length > 0) {
      const tag = listType || "ul";
      html.push(`<${tag}>${listItems.map((li) => `<li>${li}</li>`).join("")}</${tag}>`);
      listItems = [];
      listType = null;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { flushParagraph(); flushList(); continue; }

    const bulletMatch = line.match(/^[-*]\s+(.+)/) || line.match(/^•\s+(.+)/);
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
      (line.length <= 80 && !/[.!?]$/.test(line) && plainLine.split(/\s+/).length <= 12 && /^[A-Z0-9]/.test(plainLine));

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
  flushParagraph(); flushList();
  return html.join("");
}

export function normalizeGeneratedHtml(value) {
  const text = (value || "").trim();
  if (!text) return "";
  if (looksLikeHtml(text)) return text;
  return toStructuredHtml(text);
}

function normalizeHeadingText(value) {
  return stripHtml(value).replace(/\s+/g, " ").trim().toLowerCase();
}

export function withSingleTitleHeading(html, title) {
  const normalizedTitle = normalizeHeadingText(title);
  if (!normalizedTitle) return html || "";
  const bodyWithout = (html || "")
    .replace(/^\s*<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>\s*/i, "")
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (match, headingText) =>
      normalizeHeadingText(headingText) === normalizedTitle ? "" : match,
    )
    .trim();
  return `<h2>${escapeHtml(title)}</h2>${bodyWithout}`;
}

// ---------------------------------------------------------------------------
// AI response parser
// ---------------------------------------------------------------------------

function parseAIResponse(rawContent, modelName, meta = {}) {
  if (!rawContent || typeof rawContent !== "string") {
    throw new Error("AI response was empty.");
  }
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI response format was invalid.");
    parsed = JSON.parse(jsonMatch[0]);
  }
  return {
    description: (parsed?.productDescription || parsed?.collectionDescription || parsed?.description || "").trim(),
    seoTitle: cleanInlineText(parsed?.seoTitle || "", 70),
    seoDescription: cleanInlineText(parsed?.seoDescription || "", 160),
    aiModel: modelName || null,
    aiProvider: meta.aiProvider || null,
    inputTokens: meta.inputTokens || 0,
    outputTokens: meta.outputTokens || 0,
    generationMs: meta.generationMs || 0,
  };
}

// ---------------------------------------------------------------------------
// Provider functions  (prompt + systemPrompt already built by caller)
// ---------------------------------------------------------------------------

async function callWithAnthropic(prompt, systemPrompt, apiKey) {
  if (!apiKey) throw new Error("Anthropic API key is not configured.");
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
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Anthropic request failed with status ${response.status}.`);
  }
  const generationMs = Date.now() - startMs;
  const rawContent = payload?.content?.[0]?.text;
  return parseAIResponse(rawContent, payload?.model || (process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001").trim(), {
    aiProvider: "anthropic",
    inputTokens: payload?.usage?.input_tokens || 0,
    outputTokens: payload?.usage?.output_tokens || 0,
    generationMs,
  });
}

async function callWithGemini(prompt, systemPrompt, apiKey) {
  if (!apiKey) throw new Error("Gemini API key is not configured. Set GOOGLE_GEMINI_API_KEY in your environment.");
  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash-lite").trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const startMs = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
    }),
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.error?.message || `Gemini request failed with status ${response.status}.`);
  const generationMs = Date.now() - startMs;
  const rawContent = payload?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  return parseAIResponse(rawContent, model, {
    aiProvider: "gemini",
    inputTokens: payload?.usageMetadata?.promptTokenCount || 0,
    outputTokens: payload?.usageMetadata?.candidatesTokenCount || 0,
    generationMs,
  });
}

function getOpenAiErrorDetails(result) {
  const error = result?.payload?.error || {};
  return {
    message: error?.message || (result?.status ? `OpenAI request failed with status ${result.status}.` : "AI request failed."),
    code: String(error?.code || "").toLowerCase(),
  };
}

async function callWithOpenAI(prompt, systemPrompt, shopApiKey) {
  const apiKey = shopApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API key is not configured.");
  const configuredModel = process.env.OPENAI_MODEL || DEFAULT_AI_MODEL;

  const buildPayload = (model) => ({
    model,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
  });

  async function send(model, attempt = 0) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildPayload(model)),
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    const result = {
      ok: response.ok,
      payload,
      model,
      status: response.status,
      retryAfterSeconds: Number.parseInt(response.headers.get("retry-after") || "", 10),
    };
    const details = getOpenAiErrorDetails(result);
    const shouldRetry = !result.ok && result.status === 429 && attempt < 1 &&
      (OPENAI_RATE_LIMIT_ERROR_PATTERN.test(details.message) || details.code === "rate_limit_exceeded");
    if (shouldRetry) {
      const delay = Number.isFinite(result.retryAfterSeconds) && result.retryAfterSeconds > 0
        ? result.retryAfterSeconds * 1000 : OPENAI_RATE_LIMIT_RETRY_DELAY_MS;
      await new Promise((r) => setTimeout(r, Math.min(delay, 30000)));
      return send(model, attempt + 1);
    }
    return result;
  }

  const startMs = Date.now();
  let result = await send(configuredModel);

  if (!result.ok) {
    const details = getOpenAiErrorDetails(result);
    const shouldFallback = configuredModel !== DEFAULT_AI_MODEL &&
      (OPENAI_MODEL_ACCESS_ERROR_PATTERN.test(details.message) || OPENAI_QUOTA_ERROR_PATTERN.test(details.message) || details.code === "insufficient_quota");
    if (shouldFallback) result = await send(DEFAULT_AI_MODEL);
  }

  if (!result.ok) {
    const details = getOpenAiErrorDetails(result);
    if (OPENAI_QUOTA_ERROR_PATTERN.test(details.message) || details.code === "insufficient_quota") {
      throw new Error(`${details.message} OpenAI project quota is exhausted.`);
    }
    if (OPENAI_RATE_LIMIT_ERROR_PATTERN.test(details.message) || details.code === "rate_limit_exceeded") {
      throw new Error(`${details.message} OpenAI rate limits are exhausted. Wait and retry.`);
    }
    throw new Error(details.message);
  }

  const generationMs = Date.now() - startMs;
  return parseAIResponse(result.payload?.choices?.[0]?.message?.content, result.payload?.model || result.model, {
    aiProvider: "openai",
    inputTokens: result.payload?.usage?.prompt_tokens || 0,
    outputTokens: result.payload?.usage?.completion_tokens || 0,
    generationMs,
  });
}

async function callWithOllama(prompt, systemPrompt) {
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  const startMs = Date.now();
  let response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model, stream: false, format: "json", options: { temperature: 0.7 },
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
      }),
    });
  } catch (error) {
    const causeCode = error?.cause?.code || "";
    const isConnectionRefused = causeCode === "ECONNREFUSED" || /ECONNREFUSED|fetch failed/i.test(error?.message || "");
    const isLocalhostBaseUrl = /127\.0\.0\.1|localhost/i.test(baseUrl);
    if (isConnectionRefused && isLocalhostBaseUrl) {
      throw new Error(`Cannot reach Ollama at ${baseUrl}. In deployed environments, localhost is the server itself.`);
    }
    throw new Error(`Failed to connect to Ollama at ${baseUrl}. ${error?.message || ""}`);
  }
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.error || `Ollama request failed with status ${response.status}.`);
  const generationMs = Date.now() - startMs;
  return parseAIResponse(payload?.message?.content, payload?.model || model, {
    aiProvider: "ollama",
    inputTokens: payload?.prompt_eval_count || 0,
    outputTokens: payload?.eval_count || 0,
    generationMs,
  });
}

function canUseOllamaFallback() {
  return Boolean((process.env.OLLAMA_BASE_URL || "").trim()) &&
    ENABLED_ENV_VALUE_PATTERN.test((process.env.ENABLE_OLLAMA_FALLBACK || "").trim());
}

function shouldFallbackToOllama(message) {
  return OPENAI_OLLAMA_FALLBACK_ERROR_PATTERN.test(message || "");
}

async function callAI(prompt, systemPrompt, { aiProvider = "auto", openaiKey = null, anthropicKey = null, geminiKey = null } = {}) {
  const effectiveOpenai = openaiKey || process.env.OPENAI_API_KEY;
  const effectiveAnthropic = anthropicKey || process.env.ANTHROPIC_API_KEY;
  const effectiveGemini = geminiKey || process.env.GOOGLE_GEMINI_API_KEY;

  if (aiProvider === "gemini") return callWithGemini(prompt, systemPrompt, effectiveGemini);
  if (aiProvider === "anthropic") return callWithAnthropic(prompt, systemPrompt, effectiveAnthropic);
  if (aiProvider === "openai") {
    try {
      return await callWithOpenAI(prompt, systemPrompt, effectiveOpenai);
    } catch (err) {
      const msg = err?.message || "";
      if (shouldFallbackToOllama(msg) && canUseOllamaFallback()) {
        try { return await callWithOllama(prompt, systemPrompt); }
        catch (ollamaErr) { throw new Error(`${msg} Ollama fallback failed: ${ollamaErr?.message || ""}`); }
      }
      throw err;
    }
  }

  // Auto / env routing
  const defaultProvider = (process.env.DEFAULT_AI_PROVIDER || "openai").trim().toLowerCase();
  const fallbackProvider = (process.env.FALLBACK_AI_PROVIDER || "").trim().toLowerCase();
  const chain = fallbackProvider && fallbackProvider !== defaultProvider
    ? [defaultProvider, fallbackProvider] : [defaultProvider];

  let lastError = null;
  for (const p of chain) {
    try {
      if (p === "gemini") return await callWithGemini(prompt, systemPrompt, effectiveGemini);
      if (p === "anthropic") return await callWithAnthropic(prompt, systemPrompt, effectiveAnthropic);
      if (p === "ollama") return await callWithOllama(prompt, systemPrompt);
      return await callWithOpenAI(prompt, systemPrompt, effectiveOpenai);
    } catch (err) { lastError = err; }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Intent derivation
// ---------------------------------------------------------------------------

function deriveIntent(contentTypes) {
  const has = (t) => contentTypes.includes(t);
  if (has("meta_title") && !has("description") && !has("meta_description")) return "seo_title";
  if (!has("meta_title") && !has("description") && has("meta_description")) return "seo_description";
  return "all";
}

// ---------------------------------------------------------------------------
// Item-level generation functions
// ---------------------------------------------------------------------------

export async function generateProductItem(item, settings, apiKeys) {
  // item: { id, title, descriptionHtml, seoTitle, seoDescription }
  // settings: { contentTypes, language, tone, lengthOption, format, contextKeywords,
  //             descriptionPromptTemplate, metaTitlePromptTemplate, metaDescriptionPromptTemplate,
  //             aiProvider, addTitleAsHeading, preserveOldDescription, removeImages, shop }
  // apiKeys: { openaiApiKey, anthropicApiKey, geminiApiKey }
  const systemPrompt = getProductSystemPrompt();
  const prompt = buildProductContentPrompt({
    title: item.title,
    descriptionText: stripHtml(item.descriptionHtml || ""),
    seoTitle: item.seoTitle || "",
    seoDescription: item.seoDescription || "",
    language: settings.language,
    tone: settings.tone,
    lengthOption: settings.lengthOption,
    format: settings.format,
    contextKeywords: settings.contextKeywords,
    descriptionPromptTemplate: settings.descriptionPromptTemplate,
    metaTitlePromptTemplate: settings.metaTitlePromptTemplate,
    metaDescriptionPromptTemplate: settings.metaDescriptionPromptTemplate,
    intent: deriveIntent(settings.contentTypes),
  });

  const generated = await callAI(prompt, systemPrompt, {
    aiProvider: settings.aiProvider,
    openaiKey: apiKeys.openaiApiKey,
    anthropicKey: apiKeys.anthropicApiKey,
    geminiKey: apiKeys.geminiApiKey,
  });

  const shouldUpdateDescription = settings.contentTypes.includes("description");
  const shouldUpdateMetaTitle = settings.contentTypes.includes("meta_title");
  const shouldUpdateMetaDescription = settings.contentTypes.includes("meta_description");

  let nextDescription = shouldUpdateDescription
    ? (generated.description ? normalizeGeneratedHtml(generated.description) : item.descriptionHtml || "")
    : item.descriptionHtml || "";

  if (shouldUpdateDescription && generated.description) {
    if (settings.removeImages) {
      nextDescription = nextDescription
        .replace(/<img\b[^>]*>/gi, "")
        .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "");
    }
    if (settings.preserveOldDescription && item.descriptionHtml) {
      const oldHtml = settings.removeImages
        ? item.descriptionHtml.replace(/<img\b[^>]*>/gi, "").replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "")
        : item.descriptionHtml;
      nextDescription = nextDescription + oldHtml;
    }
    if (settings.addTitleAsHeading && item.title) {
      nextDescription = withSingleTitleHeading(nextDescription, item.title);
    }
  }

  const nextSeoTitle = shouldUpdateMetaTitle ? (generated.seoTitle || item.seoTitle || "") : (item.seoTitle || "");
  const nextSeoDescription = shouldUpdateMetaDescription ? (generated.seoDescription || item.seoDescription || "") : (item.seoDescription || "");
  const creditsPerItem = creditsForContentTypes(settings.contentTypes);

  await db.productGeneratedContent.upsert({
    where: { shop_productId: { shop: settings.shop, productId: item.id } },
    create: {
      shop: settings.shop,
      productId: item.id,
      productTitle: item.title || null,
      language: settings.language || null,
      tone: settings.tone || null,
      lengthOption: settings.lengthOption || null,
      formatOption: settings.format || null,
      contextKeywords: settings.contextKeywords || null,
      descriptionPromptTemplate: settings.descriptionPromptTemplate || null,
      metaTitlePromptTemplate: settings.metaTitlePromptTemplate || null,
      metaDescriptionPromptTemplate: settings.metaDescriptionPromptTemplate || null,
      aiModel: generated.aiModel || null,
      aiProvider: generated.aiProvider || null,
      inputTokens: generated.inputTokens || 0,
      outputTokens: generated.outputTokens || 0,
      generationMs: generated.generationMs || null,
      descriptionHtml: nextDescription || null,
      seoTitle: nextSeoTitle || null,
      seoDescription: nextSeoDescription || null,
      creditsUsed: creditsPerItem,
      appliedToProduct: false,
    },
    update: {
      productTitle: item.title || null,
      language: settings.language || null,
      tone: settings.tone || null,
      lengthOption: settings.lengthOption || null,
      formatOption: settings.format || null,
      contextKeywords: settings.contextKeywords || null,
      descriptionPromptTemplate: settings.descriptionPromptTemplate || null,
      metaTitlePromptTemplate: settings.metaTitlePromptTemplate || null,
      metaDescriptionPromptTemplate: settings.metaDescriptionPromptTemplate || null,
      aiModel: generated.aiModel || null,
      aiProvider: generated.aiProvider || null,
      inputTokens: generated.inputTokens || 0,
      outputTokens: generated.outputTokens || 0,
      generationMs: generated.generationMs || null,
      descriptionHtml: nextDescription || null,
      seoTitle: nextSeoTitle || null,
      seoDescription: nextSeoDescription || null,
      creditsUsed: creditsPerItem,
      appliedToProduct: false,
    },
  });

  await db.generatedContentLog.create({
    data: {
      shop: settings.shop,
      productId: item.id,
      productTitle: item.title || null,
      intent: "product_bulk_generate",
      resourceType: "product",
      language: settings.language || null,
      tone: settings.tone || null,
      lengthOption: settings.lengthOption || null,
      formatOption: settings.format || null,
      contextKeywords: settings.contextKeywords || null,
      aiModel: generated.aiModel || null,
      aiProvider: generated.aiProvider || null,
      inputTokens: generated.inputTokens || 0,
      outputTokens: generated.outputTokens || 0,
      generationMs: generated.generationMs || null,
      generatedDescription: nextDescription || null,
      generatedSeoTitle: nextSeoTitle || null,
      generatedSeoDescription: nextSeoDescription || null,
      creditsUsed: creditsPerItem,
      appliedToProduct: false,
    },
  });

  return { creditsUsed: creditsPerItem };
}

export async function generateCollectionItem(item, settings, apiKeys) {
  // item: { id, title, descriptionHtml, seoTitle, seoDescription }
  const systemPrompt = getCollectionSystemPrompt();
  const prompt = buildCollectionContentPrompt({
    title: item.title,
    descriptionText: stripHtml(item.descriptionHtml || ""),
    seoTitle: item.seoTitle || "",
    seoDescription: item.seoDescription || "",
    language: settings.language,
    tone: settings.tone,
    lengthOption: settings.lengthOption,
    format: settings.format,
    contextKeywords: settings.contextKeywords,
    descriptionPromptTemplate: settings.descriptionPromptTemplate,
    metaTitlePromptTemplate: settings.metaTitlePromptTemplate,
    metaDescriptionPromptTemplate: settings.metaDescriptionPromptTemplate,
    intent: deriveIntent(settings.contentTypes),
  });

  const generated = await callAI(prompt, systemPrompt, {
    aiProvider: settings.aiProvider,
    openaiKey: apiKeys.openaiApiKey,
    anthropicKey: apiKeys.anthropicApiKey,
    geminiKey: apiKeys.geminiApiKey,
  });

  const shouldUpdateDescription = settings.contentTypes.includes("description");
  const shouldUpdateMetaTitle = settings.contentTypes.includes("meta_title");
  const shouldUpdateMetaDescription = settings.contentTypes.includes("meta_description");

  let nextDescription = shouldUpdateDescription
    ? (generated.description ? normalizeGeneratedHtml(generated.description) : item.descriptionHtml || "")
    : item.descriptionHtml || "";

  if (shouldUpdateDescription && generated.description) {
    if (settings.removeImages) {
      nextDescription = nextDescription
        .replace(/<img\b[^>]*>/gi, "")
        .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "");
    }
    if (settings.preserveOldDescription && item.descriptionHtml) {
      const oldHtml = settings.removeImages
        ? item.descriptionHtml.replace(/<img\b[^>]*>/gi, "").replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "")
        : item.descriptionHtml;
      nextDescription = nextDescription + oldHtml;
    }
    if (settings.addTitleAsHeading && item.title) {
      nextDescription = withSingleTitleHeading(nextDescription, item.title);
    }
  }

  const nextSeoTitle = shouldUpdateMetaTitle ? (generated.seoTitle || item.seoTitle || "") : (item.seoTitle || "");
  const nextSeoDescription = shouldUpdateMetaDescription ? (generated.seoDescription || item.seoDescription || "") : (item.seoDescription || "");
  const creditsPerItem = creditsForContentTypes(settings.contentTypes);

  await db.collectionGeneratedContent.upsert({
    where: { shop_collectionId: { shop: settings.shop, collectionId: item.id } },
    create: {
      shop: settings.shop,
      collectionId: item.id,
      collectionTitle: item.title || null,
      language: settings.language || null,
      tone: settings.tone || null,
      lengthOption: settings.lengthOption || null,
      formatOption: settings.format || null,
      contextKeywords: settings.contextKeywords || null,
      descriptionPromptTemplate: settings.descriptionPromptTemplate || null,
      metaTitlePromptTemplate: settings.metaTitlePromptTemplate || null,
      metaDescriptionPromptTemplate: settings.metaDescriptionPromptTemplate || null,
      aiModel: generated.aiModel || null,
      aiProvider: generated.aiProvider || null,
      inputTokens: generated.inputTokens || 0,
      outputTokens: generated.outputTokens || 0,
      generationMs: generated.generationMs || null,
      descriptionHtml: nextDescription || null,
      seoTitle: nextSeoTitle || null,
      seoDescription: nextSeoDescription || null,
      creditsUsed: creditsPerItem,
      appliedToCollection: false,
    },
    update: {
      collectionTitle: item.title || null,
      language: settings.language || null,
      tone: settings.tone || null,
      lengthOption: settings.lengthOption || null,
      formatOption: settings.format || null,
      contextKeywords: settings.contextKeywords || null,
      descriptionPromptTemplate: settings.descriptionPromptTemplate || null,
      metaTitlePromptTemplate: settings.metaTitlePromptTemplate || null,
      metaDescriptionPromptTemplate: settings.metaDescriptionPromptTemplate || null,
      aiModel: generated.aiModel || null,
      aiProvider: generated.aiProvider || null,
      inputTokens: generated.inputTokens || 0,
      outputTokens: generated.outputTokens || 0,
      generationMs: generated.generationMs || null,
      descriptionHtml: nextDescription || null,
      seoTitle: nextSeoTitle || null,
      seoDescription: nextSeoDescription || null,
      creditsUsed: creditsPerItem,
      appliedToCollection: false,
    },
  });

  await db.generatedContentLog.create({
    data: {
      shop: settings.shop,
      productId: item.id,
      productTitle: item.title || null,
      intent: "collection_bulk_generate",
      resourceType: "collection",
      language: settings.language || null,
      tone: settings.tone || null,
      lengthOption: settings.lengthOption || null,
      formatOption: settings.format || null,
      contextKeywords: settings.contextKeywords || null,
      aiModel: generated.aiModel || null,
      aiProvider: generated.aiProvider || null,
      inputTokens: generated.inputTokens || 0,
      outputTokens: generated.outputTokens || 0,
      generationMs: generated.generationMs || null,
      generatedDescription: nextDescription || null,
      generatedSeoTitle: nextSeoTitle || null,
      generatedSeoDescription: nextSeoDescription || null,
      creditsUsed: creditsPerItem,
      appliedToProduct: false,
    },
  });

  return { creditsUsed: creditsPerItem };
}

export async function generateCollectionProductItem(item, settings, apiKeys) {
  // item: { productId, productTitle, productDescHtml, productSeoTitle, productSeoDesc, collectionId, collectionTitle }
  const systemPrompt = getCollectionSystemPrompt();
  const prompt = buildCollectionContentPrompt({
    title: item.productTitle,
    descriptionText: stripHtml(item.productDescHtml || ""),
    seoTitle: item.productSeoTitle || "",
    seoDescription: item.productSeoDesc || "",
    language: settings.language,
    tone: settings.tone,
    lengthOption: settings.lengthOption,
    format: settings.format,
    contextKeywords: settings.contextKeywords,
    descriptionPromptTemplate: settings.descriptionPromptTemplate,
    metaTitlePromptTemplate: settings.metaTitlePromptTemplate,
    metaDescriptionPromptTemplate: settings.metaDescriptionPromptTemplate,
    intent: deriveIntent(settings.contentTypes),
  });

  const generated = await callAI(prompt, systemPrompt, {
    aiProvider: settings.aiProvider,
    openaiKey: apiKeys.openaiApiKey,
    anthropicKey: apiKeys.anthropicApiKey,
    geminiKey: apiKeys.geminiApiKey,
  });

  const shouldUpdateDescription = settings.contentTypes.includes("description");
  const shouldUpdateMetaTitle = settings.contentTypes.includes("meta_title");
  const shouldUpdateMetaDescription = settings.contentTypes.includes("meta_description");

  let nextDescription = shouldUpdateDescription
    ? (generated.description ? normalizeGeneratedHtml(generated.description) : item.productDescHtml || "")
    : item.productDescHtml || "";

  if (shouldUpdateDescription && generated.description) {
    if (settings.removeImages) {
      nextDescription = nextDescription
        .replace(/<img\b[^>]*>/gi, "")
        .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "");
    }
    if (settings.preserveOldDescription && item.productDescHtml) {
      const oldHtml = settings.removeImages
        ? item.productDescHtml.replace(/<img\b[^>]*>/gi, "").replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "")
        : item.productDescHtml;
      nextDescription = nextDescription + oldHtml;
    }
    if (settings.addTitleAsHeading && item.productTitle) {
      nextDescription = withSingleTitleHeading(nextDescription, item.productTitle);
    }
  }

  const nextSeoTitle = shouldUpdateMetaTitle ? (generated.seoTitle || item.productSeoTitle || "") : (item.productSeoTitle || "");
  const nextSeoDescription = shouldUpdateMetaDescription ? (generated.seoDescription || item.productSeoDesc || "") : (item.productSeoDesc || "");
  const creditsPerItem = creditsForContentTypes(settings.contentTypes);

  await db.collectionProductGeneratedContent.upsert({
    where: {
      shop_collectionId_productId: {
        shop: settings.shop,
        collectionId: item.collectionId,
        productId: item.productId,
      },
    },
    create: {
      shop: settings.shop,
      collectionId: item.collectionId,
      collectionTitle: item.collectionTitle || null,
      productId: item.productId,
      productTitle: item.productTitle || null,
      language: settings.language || null,
      tone: settings.tone || null,
      lengthOption: settings.lengthOption || null,
      formatOption: settings.format || null,
      contextKeywords: settings.contextKeywords || null,
      descriptionPromptTemplate: settings.descriptionPromptTemplate || null,
      metaTitlePromptTemplate: settings.metaTitlePromptTemplate || null,
      metaDescriptionPromptTemplate: settings.metaDescriptionPromptTemplate || null,
      aiModel: generated.aiModel || null,
      aiProvider: generated.aiProvider || null,
      inputTokens: generated.inputTokens || 0,
      outputTokens: generated.outputTokens || 0,
      generationMs: generated.generationMs || null,
      descriptionHtml: nextDescription || null,
      seoTitle: nextSeoTitle || null,
      seoDescription: nextSeoDescription || null,
      creditsUsed: creditsPerItem,
      appliedToProduct: false,
    },
    update: {
      collectionTitle: item.collectionTitle || null,
      productTitle: item.productTitle || null,
      language: settings.language || null,
      tone: settings.tone || null,
      lengthOption: settings.lengthOption || null,
      formatOption: settings.format || null,
      contextKeywords: settings.contextKeywords || null,
      descriptionPromptTemplate: settings.descriptionPromptTemplate || null,
      metaTitlePromptTemplate: settings.metaTitlePromptTemplate || null,
      metaDescriptionPromptTemplate: settings.metaDescriptionPromptTemplate || null,
      aiModel: generated.aiModel || null,
      aiProvider: generated.aiProvider || null,
      inputTokens: generated.inputTokens || 0,
      outputTokens: generated.outputTokens || 0,
      generationMs: generated.generationMs || null,
      descriptionHtml: nextDescription || null,
      seoTitle: nextSeoTitle || null,
      seoDescription: nextSeoDescription || null,
      creditsUsed: creditsPerItem,
      appliedToProduct: false,
    },
  });

  await db.generatedContentLog.create({
    data: {
      shop: settings.shop,
      productId: item.productId,
      productTitle: item.productTitle || null,
      intent: "collection_product_bulk_generate",
      resourceType: "collection_product",
      language: settings.language || null,
      tone: settings.tone || null,
      lengthOption: settings.lengthOption || null,
      formatOption: settings.format || null,
      contextKeywords: settings.contextKeywords || null,
      aiModel: generated.aiModel || null,
      aiProvider: generated.aiProvider || null,
      inputTokens: generated.inputTokens || 0,
      outputTokens: generated.outputTokens || 0,
      generationMs: generated.generationMs || null,
      generatedDescription: nextDescription || null,
      generatedSeoTitle: nextSeoTitle || null,
      generatedSeoDescription: nextSeoDescription || null,
      creditsUsed: creditsPerItem,
      appliedToProduct: false,
    },
  });

  return { creditsUsed: creditsPerItem };
}

// ---------------------------------------------------------------------------
// Job progress
// ---------------------------------------------------------------------------

export async function updateJobProgress(jobId, chunkItems, results, creditsPerItem) {
  const completed = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  const newFailedItems = chunkItems
    .map((item, idx) =>
      results[idx].status === "rejected"
        ? { id: item.id || item.productId, title: item.title || item.productTitle, error: results[idx].reason?.message || "Unknown error" }
        : null,
    )
    .filter(Boolean);

  const newCompletedItems = chunkItems
    .map((item, idx) =>
      results[idx].status === "fulfilled"
        ? { id: item.id || item.productId, title: item.title || item.productTitle }
        : null,
    )
    .filter(Boolean);

  const job = await db.bulkJob.findUnique({
    where: { id: jobId },
    select: { failedItemIds: true, completedItemIds: true },
  });
  const existingFailed = job?.failedItemIds ? JSON.parse(job.failedItemIds) : [];
  const existingCompleted = job?.completedItemIds ? JSON.parse(job.completedItemIds) : [];

  await db.bulkJob.update({
    where: { id: jobId },
    data: {
      completedItems: { increment: completed },
      failedItems: { increment: failed },
      creditsUsed: { increment: completed * creditsPerItem },
      failedItemIds: JSON.stringify([...existingFailed, ...newFailedItems]),
      completedItemIds: JSON.stringify([...existingCompleted, ...newCompletedItems]),
    },
  });
}

// ---------------------------------------------------------------------------
// Raw AI callers (return raw text, bypass parseAIResponse)
// ---------------------------------------------------------------------------

async function callWithOpenAIRaw(prompt, systemPrompt, apiKey) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OpenAI API key is not configured.");
  const model = (process.env.OPENAI_MODEL || DEFAULT_AI_MODEL).trim();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI error ${res.status}`);
  return json?.choices?.[0]?.message?.content || "";
}

async function callWithAnthropicRaw(prompt, systemPrompt, apiKey) {
  if (!apiKey) throw new Error("Anthropic API key is not configured.");
  const model = (process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001").trim();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  if (!res.ok) throw new Error(json?.error?.message || `Anthropic error ${res.status}`);
  return json?.content?.[0]?.text || "";
}

async function callWithGeminiRaw(prompt, systemPrompt, apiKey) {
  if (!apiKey) throw new Error("Gemini API key is not configured.");
  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash-lite").trim();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 },
      }),
    }
  );
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  if (!res.ok) throw new Error(json?.error?.message || `Gemini error ${res.status}`);
  return json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

export async function callAIRaw(prompt, systemPrompt, { aiProvider = "auto", openaiKey = null, anthropicKey = null, geminiKey = null } = {}) {
  const effectiveOpenai = openaiKey || process.env.OPENAI_API_KEY;
  const effectiveAnthropic = anthropicKey || process.env.ANTHROPIC_API_KEY;
  const effectiveGemini = geminiKey || process.env.GOOGLE_GEMINI_API_KEY;

  if (aiProvider === "anthropic") return callWithAnthropicRaw(prompt, systemPrompt, effectiveAnthropic);
  if (aiProvider === "gemini") return callWithGeminiRaw(prompt, systemPrompt, effectiveGemini);
  return callWithOpenAIRaw(prompt, systemPrompt, effectiveOpenai);
}
