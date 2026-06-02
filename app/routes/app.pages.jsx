import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useLoaderData, useNavigate, useFetcher, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { buildPageContentPrompt, getPageSystemPrompt } from "../lib/contentPromptTemplates";
import { TemplateLibraryModal } from "../components/TemplateLibraryModal";
import { RichTextEditor } from "../components/RichTextEditor";
import { getExactWordLengthOption, normalizeStoredGlobalSettings, readGlobalSettings } from "../lib/globalSettings";
import {
  readStoredPagePromptTemplateSelection,
  PAGE_BODY_TEMPLATES,
  PAGE_META_DESCRIPTION_TEMPLATES,
  PAGE_META_TITLE_TEMPLATES,
} from "../lib/pagePromptTemplateLibrary";
import {
  buildInsufficientCreditsError,
  deductCredits,
  parseSelectedContentTypes,
  refundCredits,
} from "../lib/credits.server";
import {
  Page,
  Card,
  BlockStack,
  Icon,
  Text,
  Button,
  TextField,
  Checkbox,
  Banner,
  Badge,
  IndexTable,
  Modal,
  InlineStack,
} from "@shopify/polaris";
import { PageIcon, ViewIcon } from "@shopify/polaris-icons";

const PAGE_CONTENT_TYPES = ["body", "meta_title", "meta_description"];
const DEFAULT_PAGE_CONTENT_TYPES = ["body", "meta_title", "meta_description"];

function parseShopGlobalSettings(shopData) {
  try {
    return normalizeStoredGlobalSettings(JSON.parse(shopData?.globalSettingsJson || "{}"));
  } catch {
    return normalizeStoredGlobalSettings();
  }
}

// ─── GraphQL ────────────────────────────────────────────────────────────────

const PAGES_QUERY = `#graphql
  query GetPages($first: Int!, $after: String) {
    pages(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          publishedAt
          bodySummary
          body
          metafields(first: 2, namespace: "global") {
            edges {
              node {
                key
                value
              }
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PAGE_UPDATE_MUTATION = `#graphql
  mutation PageUpdate($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page {
        id
        title
        body
      }
      userErrors { field message }
    }
  }
`;

// ─── AI helpers ─────────────────────────────────────────────────────────────

async function generateContentWithAnthropic(input, apiKey) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("No Anthropic API key available.");

  const startMs = Date.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: (process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001").trim(),
      max_tokens: 3500,
      messages: [{ role: "user", content: input.prompt }],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${err}`);
  }
  const data = await response.json();
  const generationMs = Date.now() - startMs;
  return {
    raw: data.content?.[0]?.text || "",
    aiModel: data?.model || (process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001").trim(),
    aiProvider: "anthropic",
    inputTokens: data?.usage?.input_tokens || 0,
    outputTokens: data?.usage?.output_tokens || 0,
    generationMs,
  };
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
        parts: [{ text: getPageSystemPrompt() }],
      },
      contents: [{ role: "user", parts: [{ text: input.prompt }] }],
      generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
    }),
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Gemini request failed with status ${response.status}.`);
  }
  const generationMs = Date.now() - startMs;
  return {
    raw: payload?.candidates?.[0]?.content?.parts?.[0]?.text || "",
    aiModel: model,
    aiProvider: "gemini",
    inputTokens: payload?.usageMetadata?.promptTokenCount || 0,
    outputTokens: payload?.usageMetadata?.candidatesTokenCount || 0,
    generationMs,
  };
}

async function generateContentWithOpenAI(input, shopApiKey) {
  const key = shopApiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("No OpenAI API key available.");

  const startMs = Date.now();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 3500,
      messages: [
        { role: "system", content: getPageSystemPrompt() },
        { role: "user", content: input.prompt },
      ],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${err}`);
  }
  const data = await response.json();
  const generationMs = Date.now() - startMs;
  return {
    raw: data.choices?.[0]?.message?.content || "",
    aiModel: data?.model || "gpt-4o-mini",
    aiProvider: "openai",
    inputTokens: data?.usage?.prompt_tokens || 0,
    outputTokens: data?.usage?.completion_tokens || 0,
    generationMs,
  };
}

async function generateContent(input, { aiProvider, shopOpenaiKey, shopAnthropicKey, shopGeminiKey }) {
  const openaiKey = shopOpenaiKey || process.env.OPENAI_API_KEY;
  const anthropicKey = shopAnthropicKey || process.env.ANTHROPIC_API_KEY;
  const geminiKey = shopGeminiKey || process.env.GOOGLE_GEMINI_API_KEY;

  if (aiProvider === "gemini") return generateContentWithGemini(input, geminiKey);
  if (aiProvider === "anthropic") return generateContentWithAnthropic(input, anthropicKey);
  if (aiProvider === "openai") return generateContentWithOpenAI(input, openaiKey);

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
      if (p === "ollama") throw new Error("Ollama is not supported in the Pages route.");
      return await generateContentWithOpenAI(input, openaiKey); // default / "openai"
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value || "");
}

function escapeHtml(value) {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function stripHtml(value) {
  return (value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function evaluateContentShortStatus(content) {
  if (!content || !content.trim()) return { label: "Missing", tone: "critical" };
  if (content.trim().length < 80) return { label: "Short", tone: "warning" };
  return { label: "Good", tone: "success" };
}

function evaluatePagePublishStatus(publishedAt) {
  return publishedAt ? { label: "Active", tone: "success" } : { label: "Draft", tone: "warning" };
}

function buildGenerationPrompt({
  pageTitle,
  pageType,
  body,
  language,
  tone,
  length,
  format,
  contextKeywords,
  bodyPromptTemplate,
  metaTitlePromptTemplate,
  metaDescriptionPromptTemplate,
}) {
  return {
    prompt: buildPageContentPrompt({
      pageTitle,
      pageType,
      body,
      language,
      tone,
      length,
      format,
      contextKeywords,
      bodyPromptTemplate,
      metaTitlePromptTemplate,
      metaDescriptionPromptTemplate,
    }),
  };
}

async function upsertPageContent(data) {
  try {
    await db.pageGeneratedContent.upsert({
      where: { shop_pageId: { shop: data.shop, pageId: data.pageId } },
      create: data,
      update: data,
    });
  } catch (error) {
    console.error("Failed to upsert page generated content", error);
  }
}

async function writeGenerationLog(data) {
  try {
    await db.generatedContentLog.create({ data });
  } catch (error) {
    console.error("Failed to store page generation log", error);
  }
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  // Fetch pages from Shopify
  const response = await admin.graphql(PAGES_QUERY, {
    variables: { first: 50 },
  });
  const json = await response.json();
  const rawPages = (json.data?.pages?.edges || []).map((e) => {
    const node = e.node;
    const mfs = (node.metafields?.edges || []).map((me) => me.node);
    return {
      ...node,
      seo: {
        title: mfs.find((m) => m.key === "title_tag")?.value || "",
        description: mfs.find((m) => m.key === "description_tag")?.value || "",
      },
    };
  });

  // Fetch generate times from DB
  const pageIds = rawPages.map((p) => p.id);
  const generatedContents = pageIds.length > 0
    ? await db.pageGeneratedContent.findMany({
        where: { shop: session.shop, pageId: { in: pageIds } },
        select: { pageId: true, updatedAt: true },
      })
    : [];
  const generatedMap = Object.fromEntries(generatedContents.map((g) => [g.pageId, g.updatedAt]));
  const pages = rawPages.map((p) => ({ ...p, generatedAt: generatedMap[p.id] || null }));

  // Fetch shop API keys
  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { openaiApiKey: true, anthropicApiKey: true, geminiApiKey: true, defaultAiProvider: true, credits: true, creditsUsedTotal: true },
  });

  return {
    pages,
    shopDomain: session.shop,
    hasOpenaiKey: !!shopData?.openaiApiKey,
    hasAnthropicKey: !!shopData?.anthropicApiKey,
    hasGeminiKey: !!(shopData?.geminiApiKey || process.env.GOOGLE_GEMINI_API_KEY),
    defaultAiProvider: shopData?.defaultAiProvider || "auto",
    credits: shopData?.credits ?? 150,
    creditsUsedTotal: shopData?.creditsUsedTotal ?? 0,
  };
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "bulk_generate_pages") {
    const pagesJson = formData.get("pages") || "[]";
    const bulkPages = JSON.parse(pagesJson);
    const language = formData.get("language") || "en";
    const tone = formData.get("tone") || "professional";
    let length = formData.get("length") || "medium";
    const format = formData.get("format") || "paragraphs";
    const pageType = formData.get("pageType") || "About Us";
    const contextKeywords = formData.get("contextKeywords") || "";
    const bodyPromptTemplate = formData.get("bodyPromptTemplate") || "";
    const metaTitlePromptTemplate = formData.get("metaTitlePromptTemplate") || "";
    const metaDescriptionPromptTemplate = formData.get("metaDescriptionPromptTemplate") || "";
    const useCustomBodyInstructions = String(formData.get("useCustomBodyInstructions") || "") === "1";
    const useCustomMetaTitleInstructions = String(formData.get("useCustomMetaTitleInstructions") || "") === "1";
    const useCustomMetaDescInstructions = String(formData.get("useCustomMetaDescInstructions") || "") === "1";
    const aiProvider = formData.get("aiProvider") || "auto";
    const selectedContentTypes = parseSelectedContentTypes(
      formData.get("contentTypes"),
      PAGE_CONTENT_TYPES,
      DEFAULT_PAGE_CONTENT_TYPES,
    );
    if (selectedContentTypes.includes("body") && !String(bodyPromptTemplate || "").trim()) {
      return { success: false, intent, error: "Body template/custom instructions are required." };
    }
    if (selectedContentTypes.includes("body") && !useCustomBodyInstructions) {
      return { success: false, intent, error: "Enable 'Use custom instructions' for Body." };
    }
    if (selectedContentTypes.includes("meta_title") && !String(metaTitlePromptTemplate || "").trim()) {
      return { success: false, intent, error: "Meta title template/custom instructions are required." };
    }
    if (selectedContentTypes.includes("meta_title") && !useCustomMetaTitleInstructions) {
      return { success: false, intent, error: "Enable 'Use custom instructions' for Meta title." };
    }
    if (selectedContentTypes.includes("meta_description") && !String(metaDescriptionPromptTemplate || "").trim()) {
      return { success: false, intent, error: "Meta description template/custom instructions are required." };
    }
    if (selectedContentTypes.includes("meta_description") && !useCustomMetaDescInstructions) {
      return { success: false, intent, error: "Enable 'Use custom instructions' for Meta description." };
    }
    const shouldUpdateBody = selectedContentTypes.includes("body");
    const shouldUpdateMetaTitle = selectedContentTypes.includes("meta_title");
    const shouldUpdateMetaDescription = selectedContentTypes.includes("meta_description");

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
    const creditsPerItem = 0;
    const globalSettings = parseShopGlobalSettings(shopData);
    length = getExactWordLengthOption(globalSettings, "pageContentWords");
    const availableCredits = shopData?.credits ?? 150;
    const requiredCredits = 0;
    if (availableCredits < requiredCredits) {
      return {
        success: false,
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

    const results = await Promise.allSettled(
      bulkPages.map(async (p) => {
        const input = buildGenerationPrompt({
          pageTitle: p.title,
          pageType,
          body: p.body || "",
          language,
          tone,
          length,
          format,
          contextKeywords,
          bodyPromptTemplate,
          metaTitlePromptTemplate,
          metaDescriptionPromptTemplate,
        });
        const genResult = await generateContent(input, {
          aiProvider,
          shopOpenaiKey: shopData?.openaiApiKey,
          shopAnthropicKey: shopData?.anthropicApiKey,
          shopGeminiKey: shopData?.geminiApiKey || null,
        });
        const raw = genResult.raw;

        let parsed = { pageBody: "", seoTitle: "", seoDescription: "" };
        try {
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
        } catch { parsed.pageBody = raw; }
        const nextBody = shouldUpdateBody
          ? normalizeGeneratedHtml(parsed.pageBody || p.body || "")
          : p.body || "";
        const nextSeoTitle = shouldUpdateMetaTitle
          ? String(parsed.seoTitle || "").trim()
          : String(p.seoTitleValue || "").trim();
        const nextSeoDescription = shouldUpdateMetaDescription
          ? String(parsed.seoDescription || "").trim()
          : String(p.seoDescriptionValue || "").trim();

        await writeGenerationLog({
          shop: session.shop,
          productId: p.id,
          productTitle: p.title || null,
          intent: "page_bulk_generate",
          resourceType: "page",
          language: language || null,
          tone: tone || null,
          lengthOption: length || null,
          formatOption: format || null,
          contextKeywords: contextKeywords || null,
          aiModel: genResult.aiModel || null,
          aiProvider: genResult.aiProvider || null,
          inputTokens: genResult.inputTokens || 0,
          outputTokens: genResult.outputTokens || 0,
          generationMs: genResult.generationMs || null,
          generatedDescription: nextBody || null,
          generatedSeoTitle: nextSeoTitle || null,
          generatedSeoDescription: nextSeoDescription || null,
          creditsUsed: creditsPerItem,
          appliedToProduct: false,
        });

        return {
          id: p.id,
          title: p.title,
          body: nextBody,
          seoTitle: nextSeoTitle,
          seoDescription: nextSeoDescription,
          originalBody: p.body || "",
          originalSeoTitle: p.seoTitleValue || "",
          originalSeoDescription: p.seoDescriptionValue || "",
        };
      })
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    const creditsUsed = succeeded * creditsPerItem;
    const creditsToRefund = requiredCredits - creditsUsed;
    let newCredits = reservedCredits;
    let creditsUsedTotal = reservedCreditsUsedTotal;
    let creditWarning = null;

    if (creditsToRefund > 0) {
      try {
        const creditSnapshot = await refundCredits({ shopDomain: session.shop, creditsRefunded: creditsToRefund });
        newCredits = creditSnapshot.credits;
        creditsUsedTotal = creditSnapshot.creditsUsedTotal;
      } catch (creditError) {
        creditWarning = creditError?.message || "Unused credits could not be refunded automatically.";
      }
    }

    const itemResults = results.map((r, i) => ({
      id: bulkPages[i].id,
      title: bulkPages[i].title,
      status: r.status === "fulfilled" ? "success" : "failed",
      error: r.status === "rejected" ? r.reason?.message : null,
      seoTitle: r.status === "fulfilled" ? r.value.seoTitle : null,
      seoDescription: r.status === "fulfilled" ? r.value.seoDescription : null,
      body: r.status === "fulfilled" ? r.value.body : null,
      originalBody: r.status === "fulfilled" ? r.value.originalBody : bulkPages[i].body || "",
      originalSeoTitle: r.status === "fulfilled" ? r.value.originalSeoTitle : bulkPages[i].seoTitleValue || "",
      originalSeoDescription: r.status === "fulfilled" ? r.value.originalSeoDescription : bulkPages[i].seoDescriptionValue || "",
    }));
    return {
      success: true,
      intent,
      succeeded,
      failed,
      total: bulkPages.length,
      results: itemResults,
      contentTypes: selectedContentTypes,
      creditsPerItem,
      creditsUsed,
      newCredits,
      creditsUsedTotal,
      creditWarning,
    };
  }

  if (intent === "update_page") {
    const pageId = formData.get("pageId");
    const pageTitle = formData.get("pageTitle") || "";
    const body = formData.get("body") || "";
    const seoTitle = formData.get("seoTitle") || "";
    const seoDescription = formData.get("seoDescription") || "";
    const pageType = formData.get("pageType") || "";
    const language = formData.get("language") || "";
    const tone = formData.get("tone") || "";
    const length = formData.get("length") || "";
    const format = formData.get("format") || "";
    const contextKeywords = formData.get("contextKeywords") || "";

    try {
      const response = await admin.graphql(PAGE_UPDATE_MUTATION, {
        variables: {
          id: pageId,
          page: {
            body,
            metafields: [
              { namespace: "global", key: "title_tag", value: seoTitle, type: "single_line_text_field" },
              { namespace: "global", key: "description_tag", value: seoDescription, type: "single_line_text_field" },
            ],
          },
        },
      });
      const json = await response.json();
      const userErrors = json.data?.pageUpdate?.userErrors || [];
      if (userErrors.length > 0) {
        return { success: false, intent, error: userErrors.map((e) => e.message).join(", ") };
      }

      await upsertPageContent({
        shop: session.shop,
        pageId,
        pageTitle: pageTitle || null,
        pageType: pageType || null,
        language: language || null,
        tone: tone || null,
        lengthOption: length || null,
        formatOption: format || null,
        contextKeywords: contextKeywords || null,
        bodyPromptTemplate: null,
        metaTitlePromptTemplate: null,
        metaDescriptionPromptTemplate: null,
        aiModel: null,
        bodyHtml: body || null,
        seoTitle: seoTitle || null,
        seoDescription: seoDescription || null,
        appliedToPage: true,
      });

      return { success: true, intent, message: "Page updated successfully!" };
    } catch (err) {
      return { success: false, intent, error: err.message };
    }
  }

  return { success: false, error: "Unknown action." };
};

// ─── Options ─────────────────────────────────────────────────────────────────

const DEFAULT_BODY_CUSTOM_PROMPT = `Generate premium long-form page content for the given Shopify page.

Objective:
Create clear, persuasive, SEO-aware content that is easy to scan and ready to publish on a storefront page.

Requirements:
- Understand the page type and user intent before writing (About, Contact, FAQ, Policy, Landing, Custom).
- Write in a trustworthy, brand-consistent tone suitable for ecommerce.
- Keep language simple, direct, and customer-focused.
- Include natural keyword usage without stuffing.
- Ensure every section provides clear value to the shopper.

Content structure:
1. Opening section:
- Start with a strong headline and 1-2 short introductory paragraphs.
- Clearly explain what this page is about and why it matters to the visitor.

2. Core sections:
- Add meaningful subheadings (H2/H3) for major topics.
- Use concise paragraphs under each heading.
- Include bullet points where scannability improves readability.
- Add benefit-focused copy, not just feature statements.

3. Trust and clarity:
- Include reassurance statements where relevant (quality, support, shipping, returns, process, transparency).
- Avoid vague claims and overly promotional language.
- Keep facts practical and believable.

4. Conversion intent:
- Add a soft call-to-action in key sections.
- End with a clear final call-to-action aligned with the page purpose.

Style rules:
- No keyword stuffing.
- No clickbait language.
- No repetitive filler text.
- Avoid overly long paragraphs.
- Keep headings descriptive and human-readable.

Output format:
- Return valid clean HTML only.
- Use semantic tags where appropriate: <h2>, <h3>, <p>, <ul>, <li>, <strong>.
- Do not include markdown, code fences, or explanation outside the final HTML.
- Ensure output is directly publishable in Shopify page editor.`;

const DEFAULT_META_TITLE_CUSTOM_PROMPT = `Generate SEO-optimized meta title for the given page.

Requirements:
- Primary keyword placement
- Brand name inclusion
- Under 60 characters
- Compelling and descriptive
- Search-friendly format

Focus on click-through rate optimization.`;

const DEFAULT_META_DESCRIPTION_CUSTOM_PROMPT = `Generate SEO-optimized meta description for given page.

Focus on:
- Primary keyword naturally included
- Clear value proposition
- Call to action
- 140-160 characters max
- Compelling and click-worthy

Format: Engaging description that drives clicks from search results.`;

function PageEditorModal({
  open,
  page,
  body,
  seoTitle,
  seoDescription,
  onBodyChange,
  onSeoTitleChange,
  onSeoDescriptionChange,
  onClose,
  onSave,
  loading,
}) {
  if (!page) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit Page: ${page.title}`}
      primaryAction={{ content: loading ? "Saving..." : "Save", onAction: onSave, loading }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
      size="large"
    >
      <Modal.Section>
        <BlockStack gap="300">
          <RichTextEditor value={body} onChange={onBodyChange} />
          <TextField
            label="Meta Title"
            value={seoTitle}
            onChange={onSeoTitleChange}
            autoComplete="off"
            maxLength={70}
            showCharacterCount
          />
          <TextField
            label="Meta Description"
            value={seoDescription}
            onChange={onSeoDescriptionChange}
            autoComplete="off"
            multiline={4}
            maxLength={160}
            showCharacterCount
          />
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

function GeneratedPageReviewModal({
  open,
  page,
  body,
  seoTitle,
  seoDescription,
  onBodyChange,
  onSeoTitleChange,
  onSeoDescriptionChange,
  onCancel,
  onSave,
  onRegenerate,
  saving,
  regenerating,
}) {
  if (!page) return null;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`Review Generated Page: ${page.title}`}
      primaryAction={{ content: saving ? "Saving..." : "Save", onAction: onSave, loading: saving }}
      secondaryActions={[
        { content: "Cancel", onAction: onCancel, disabled: saving || regenerating },
        { content: regenerating ? "Regenerating..." : "Regenerate", onAction: onRegenerate, loading: regenerating, disabled: saving },
      ]}
      size="large"
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Banner tone="info">
            <p>Review the generated content before saving it to Shopify. Regenerate uses credits again.</p>
          </Banner>
          <RichTextEditor value={body} onChange={onBodyChange} />
          <TextField
            label="Meta Title"
            value={seoTitle}
            onChange={onSeoTitleChange}
            autoComplete="off"
            maxLength={70}
            showCharacterCount
          />
          <TextField
            label="Meta Description"
            value={seoDescription}
            onChange={onSeoDescriptionChange}
            autoComplete="off"
            multiline={4}
            maxLength={160}
            showCharacterCount
          />
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

export default function PagesPage() {
  const { pages, shopDomain, defaultAiProvider, credits } = useLoaderData();
  const navigate = useNavigate();
  const location = useLocation();
  const shopify = useAppBridge();

  const bulkFetcher = useFetcher();
  const editFetcher = useFetcher();
  const generatedSaveFetcher = useFetcher();
  const isBulkGenerating = bulkFetcher.state !== "idle";
  const isSavingPage = editFetcher.state !== "idle";
  const isSavingGeneratedPage = generatedSaveFetcher.state !== "idle";

  const [bulkSettings] = useState(() => {
    const gs = readGlobalSettings();
    return {
      tone: gs.tone || "professional",
      length: gs.length || "medium",
      format: "paragraphs",
      pageType: "About Us",
      aiProvider: gs.aiProvider || defaultAiProvider || "auto",
    };
  });
  const [bulkContentTypes, setBulkContentTypes] = useState(["body"]);
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkValidationMessage, setBulkValidationMessage] = useState(null);
  const [localCredits, setLocalCredits] = useState(credits);
  const [bulkBodyTemplate, setBulkBodyTemplate] = useState("");
  const [bulkMetaTitleTemplate, setBulkMetaTitleTemplate] = useState("");
  const [bulkMetaDescTemplate, setBulkMetaDescTemplate] = useState("");
  const [useCustomBodyInstructions, setUseCustomBodyInstructions] = useState(false);
  const [useCustomMetaTitleInstructions, setUseCustomMetaTitleInstructions] = useState(false);
  const [useCustomMetaDescInstructions, setUseCustomMetaDescInstructions] = useState(false);
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
  const [templateLibraryContentType, setTemplateLibraryContentType] = useState("body");
  const [bulkBodyKeywords] = useState(() => readGlobalSettings().pageContentKeywords || "");
  const [bulkMetaTitleKeywords] = useState(() => readGlobalSettings().pageMetaTitleKeywords || "");
  const [bulkMetaDescKeywords] = useState(() => readGlobalSettings().pageMetaDescKeywords || "");
  const [localPages, setLocalPages] = useState(pages);
  const [editingPage, setEditingPage] = useState(null);
  const [editBody, setEditBody] = useState("");
  const [editSeoTitle, setEditSeoTitle] = useState("");
  const [editSeoDescription, setEditSeoDescription] = useState("");
  const [generatedReviewItems, setGeneratedReviewItems] = useState([]);
  const [generatedReviewIndex, setGeneratedReviewIndex] = useState(0);
  const [generatedBody, setGeneratedBody] = useState("");
  const [generatedSeoTitle, setGeneratedSeoTitle] = useState("");
  const [generatedSeoDescription, setGeneratedSeoDescription] = useState("");
  const generatedRegenerateRef = useRef(false);
  const bulkResponseHandledRef = useRef(null);
  const generatedSaveResponseHandledRef = useRef(null);
  const currentGeneratedReview = generatedReviewItems[generatedReviewIndex] || null;
  const shopAdminHandle = String(shopDomain || "").replace(/\.myshopify\.com$/i, "");

  function getShopifyAdminPageUrl(page) {
    const pageId = String(page?.legacyResourceId || page?.id || "").split("/").pop();
    if (!shopAdminHandle || !pageId) return "";
    return `https://admin.shopify.com/store/${shopAdminHandle}/pages/${pageId}`;
  }

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

  const [selectedResources, setSelectedResources] = useState([]);
  const pageIds = useMemo(() => localPages.map((page) => page.id), [localPages]);
  const allResourcesSelected =
    pageIds.length > 0 && selectedResources.length === pageIds.length && pageIds.every((id) => selectedResources.includes(id));
  const selectionIndeterminate = selectedResources.length > 0 && !allResourcesSelected;
  const handleToggleSelectAllPages = useCallback(
    (checked) => {
      setSelectedResources(checked ? pageIds : []);
    },
    [pageIds],
  );
  const handleTogglePageSelection = useCallback(
    (pageId) => (checked) => {
      setSelectedResources((current) => {
        if (checked) return current.includes(pageId) ? current : [...current, pageId];
        return current.filter((id) => id !== pageId);
      });
    },
    [],
  );

  useEffect(() => {
    setSelectedResources((current) => current.filter((id) => pageIds.includes(id)));
  }, [pageIds]);

  const hasRequiredBulkTemplates = useMemo(() => {
    if (bulkContentTypes.includes("body")) {
      if (!useCustomBodyInstructions || !String(bulkBodyTemplate || "").trim()) return false;
    }
    if (bulkContentTypes.includes("meta_title")) {
      if (!useCustomMetaTitleInstructions || !String(bulkMetaTitleTemplate || "").trim()) return false;
    }
    if (bulkContentTypes.includes("meta_description")) {
      if (!useCustomMetaDescInstructions || !String(bulkMetaDescTemplate || "").trim()) return false;
    }
    return true;
  }, [
    bulkBodyTemplate,
    bulkContentTypes,
    bulkMetaDescTemplate,
    bulkMetaTitleTemplate,
    useCustomBodyInstructions,
    useCustomMetaDescInstructions,
    useCustomMetaTitleInstructions,
  ]);

  useEffect(() => {
    setLocalPages(pages);
  }, [pages]);

  useEffect(() => {
    const templateSelection = readStoredPagePromptTemplateSelection();
    if (templateSelection.bodyPromptTemplate) {
      setBulkBodyTemplate(templateSelection.bodyPromptTemplate);
      setUseCustomBodyInstructions(true);
    }
    if (templateSelection.metaTitlePromptTemplate) {
      setBulkMetaTitleTemplate(templateSelection.metaTitlePromptTemplate);
      setUseCustomMetaTitleInstructions(true);
    }
    if (templateSelection.metaDescriptionPromptTemplate) {
      setBulkMetaDescTemplate(templateSelection.metaDescriptionPromptTemplate);
      setUseCustomMetaDescInstructions(true);
    }
  }, []);

  function submitGeneratePages(pagesToGenerate) {
    const fd = new FormData();
    fd.append("intent", "bulk_generate_pages");
    fd.append("pages", JSON.stringify(pagesToGenerate.map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body || "",
      seoTitleValue: p.seo?.title || p.seoTitle || "",
      seoDescriptionValue: p.seo?.description || p.seoDescription || "",
    }))));
    fd.append("language", readGlobalSettings().language || "English");
    fd.append("tone", bulkSettings.tone);
    fd.append("length", bulkSettings.length);
    fd.append("format", bulkSettings.format);
    fd.append("pageType", bulkSettings.pageType);
    fd.append("bodyKeywords", bulkBodyKeywords || "");
    fd.append("metaTitleKeywords", bulkMetaTitleKeywords || "");
    fd.append("metaDescKeywords", bulkMetaDescKeywords || "");
    fd.append("contextKeywords", [bulkBodyKeywords, bulkMetaTitleKeywords, bulkMetaDescKeywords].filter(Boolean).join(", "));
    fd.append("bodyPromptTemplate", useCustomBodyInstructions ? (bulkBodyTemplate || "") : "");
    fd.append("metaTitlePromptTemplate", useCustomMetaTitleInstructions ? (bulkMetaTitleTemplate || "") : "");
    fd.append("metaDescriptionPromptTemplate", useCustomMetaDescInstructions ? (bulkMetaDescTemplate || "") : "");
    fd.append("useCustomBodyInstructions", useCustomBodyInstructions ? "1" : "0");
    fd.append("useCustomMetaTitleInstructions", useCustomMetaTitleInstructions ? "1" : "0");
    fd.append("useCustomMetaDescInstructions", useCustomMetaDescInstructions ? "1" : "0");
    fd.append("contentTypes", JSON.stringify(bulkContentTypes));
    fd.append("aiProvider", bulkSettings.aiProvider || defaultAiProvider || "auto");
    bulkFetcher.submit(fd, { method: "post" });
  }

  function handleBulkGenerate() {
    if (selectedResources.length === 0) {
      setBulkValidationMessage("Select at least one page to generate content for.");
      return;
    }
    if (bulkContentTypes.includes("body")) {
      if (!useCustomBodyInstructions) {
        setBulkValidationMessage("Enable 'Use custom instructions' for Body.");
        return;
      }
      if (!String(bulkBodyTemplate || "").trim()) {
        setBulkValidationMessage("Body template/custom instructions are required.");
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
    const selectedPages = localPages.filter((p) => selectedResources.includes(p.id));
    submitGeneratePages(selectedPages);
  }

  useEffect(() => {
    const data = bulkFetcher.data;
    if (!data || bulkFetcher.state !== "idle") return;
    if (bulkResponseHandledRef.current === data) return;
    bulkResponseHandledRef.current = data;
    if (data.success) {
      setBulkResult(data);
      const successfulItems = (data.results || []).filter((item) => item.status === "success");
      if (successfulItems.length > 0) {
        const wasRegenerate = generatedRegenerateRef.current && data.total === 1;
        let nextCurrent = successfulItems[0];
        if (wasRegenerate) {
          setGeneratedReviewItems((items) =>
            items.map((item, index) =>
              index === generatedReviewIndex ? { ...item, ...successfulItems[0] } : item,
            ),
          );
        } else {
          setGeneratedReviewItems(successfulItems);
          setGeneratedReviewIndex(0);
        }
        generatedRegenerateRef.current = false;
        setGeneratedBody(nextCurrent?.body || "");
        setGeneratedSeoTitle(nextCurrent?.seoTitle || "");
        setGeneratedSeoDescription(nextCurrent?.seoDescription || "");
      }
      generatedRegenerateRef.current = false;
      const creditsMessage =
        typeof data.creditsUsed === "number"
          ? ` ${data.creditsUsed} credits used${typeof data.newCredits === "number" ? `. Remaining: ${data.newCredits}` : ""}.`
          : "";
      if (typeof data.newCredits === "number") setLocalCredits(data.newCredits);
      shopify.toast.show(`Generated ${data.succeeded}/${data.total} pages. Review before saving.${creditsMessage}`);
    } else {
      generatedRegenerateRef.current = false;
      setBulkValidationMessage(data.error || "Bulk generation failed.");
    }
  }, [bulkFetcher.data, bulkFetcher.state, generatedReviewIndex, shopify]);

  function openPageEditor(page) {
    setEditingPage(page);
    setEditBody(page.body || "");
    setEditSeoTitle(page.seo?.title || "");
    setEditSeoDescription(page.seo?.description || "");
  }

  function handleSavePageEditor() {
    if (!editingPage) return;
    const fd = new FormData();
    fd.append("intent", "update_page");
    fd.append("pageId", editingPage.id);
    fd.append("pageTitle", editingPage.title || "");
    fd.append("body", editBody || "");
    fd.append("seoTitle", editSeoTitle || "");
    fd.append("seoDescription", editSeoDescription || "");
    fd.append("pageType", bulkSettings.pageType || "");
    fd.append("language", readGlobalSettings().language || "English");
    fd.append("tone", bulkSettings.tone || "professional");
    fd.append("length", bulkSettings.length || "medium");
    fd.append("format", bulkSettings.format || "paragraphs");
    fd.append("contextKeywords", [bulkBodyKeywords, bulkMetaTitleKeywords, bulkMetaDescKeywords].filter(Boolean).join(", "));
    editFetcher.submit(fd, { method: "post" });
  }

  useEffect(() => {
    const data = editFetcher.data;
    if (!data || editFetcher.state !== "idle") return;
    if (data.success) {
      setLocalPages((prev) =>
        prev.map((p) =>
          p.id === editingPage?.id
            ? {
                ...p,
                body: editBody,
                seo: { ...(p.seo || {}), title: editSeoTitle, description: editSeoDescription },
              }
            : p,
        ),
      );
      setEditingPage(null);
      shopify.toast.show(data.message || "Page updated successfully!");
      return;
    }
    shopify.toast.show(data.error || "Failed to update page");
  }, [editFetcher.data, editFetcher.state, editingPage?.id, editBody, editSeoDescription, editSeoTitle, shopify]);

  function handleCancelGeneratedReview() {
    setGeneratedReviewItems([]);
    setGeneratedReviewIndex(0);
    setGeneratedBody("");
    setGeneratedSeoTitle("");
    setGeneratedSeoDescription("");
  }

  function handleRegenerateGeneratedReview() {
    if (!currentGeneratedReview) return;
    generatedRegenerateRef.current = true;
    submitGeneratePages([{
      id: currentGeneratedReview.id,
      title: currentGeneratedReview.title,
      body: currentGeneratedReview.originalBody || "",
      seo: {
        title: currentGeneratedReview.originalSeoTitle || "",
        description: currentGeneratedReview.originalSeoDescription || "",
      },
    }]);
  }

  function handleSaveGeneratedReview() {
    if (!currentGeneratedReview) return;
    const fd = new FormData();
    fd.append("intent", "update_page");
    fd.append("pageId", currentGeneratedReview.id);
    fd.append("pageTitle", currentGeneratedReview.title || "");
    fd.append("body", generatedBody || "");
    fd.append("seoTitle", generatedSeoTitle || "");
    fd.append("seoDescription", generatedSeoDescription || "");
    fd.append("pageType", bulkSettings.pageType || "");
    fd.append("language", readGlobalSettings().language || "English");
    fd.append("tone", bulkSettings.tone || "professional");
    fd.append("length", bulkSettings.length || "medium");
    fd.append("format", bulkSettings.format || "paragraphs");
    fd.append("contextKeywords", [bulkBodyKeywords, bulkMetaTitleKeywords, bulkMetaDescKeywords].filter(Boolean).join(", "));
    generatedSaveFetcher.submit(fd, { method: "post" });
  }

  useEffect(() => {
    const data = generatedSaveFetcher.data;
    if (!data || generatedSaveFetcher.state !== "idle") return;
    if (generatedSaveResponseHandledRef.current === data) return;
    generatedSaveResponseHandledRef.current = data;
    if (data.success && currentGeneratedReview) {
      setLocalPages((prev) =>
        prev.map((p) =>
          p.id === currentGeneratedReview.id
            ? {
                ...p,
                body: generatedBody,
                seo: { ...(p.seo || {}), title: generatedSeoTitle, description: generatedSeoDescription },
              }
            : p,
        ),
      );
      handleCancelGeneratedReview();
      shopify.toast.show(data.message || "Generated page saved successfully!");
      window.setTimeout(() => navigateInApp("/app/content-management", "?tab=pages&filter=all"), 600);
      return;
    }
    shopify.toast.show(data.error || "Failed to save generated page");
  }, [
    currentGeneratedReview,
    generatedBody,
    generatedSaveFetcher.data,
    generatedSaveFetcher.state,
    generatedSeoDescription,
    generatedSeoTitle,
    navigateInApp,
    shopify,
  ]);

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
      }}>
        <div style={{ position: "absolute", top: "-50px", right: "-50px", width: "220px", height: "220px", borderRadius: "50%", background: "transparent", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "-40px", left: "25%", width: "160px", height: "160px", borderRadius: "50%", background: "transparent", pointerEvents: "none" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 1, flexWrap: "wrap", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ width: "46px", height: "46px", borderRadius: "6px", background: "#ffffff", border: "1px solid #d1d5db", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon source={PageIcon} tone="base" />
            </div>
            <div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#000000", marginBottom: "3px", letterSpacing: "-0.3px" }}>Storefront Pages</div>
              <div style={{ fontSize: "13px", color: "#000000", lineHeight: 1.4 }}>Generate and manage AI content for your Shopify storefront pages</div>
            </div>
          </div>
          <div style={{ "--p-color-text": "#000", "--p-color-bg-fill": "#ffffff", "--p-color-border": "#d1d5db" }}>
            {/* Credits badge */}
            <button
              type="button"
              onClick={() => navigateInApp("/app/analytics")}
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
                marginRight: "8px",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 20 20" fill="#f59e0b">
                <path d="M10 1L12.39 7.26L19 8.27L14.5 12.64L15.78 19.02L10 15.77L4.22 19.02L5.5 12.64L1 8.27L7.61 7.26L10 1Z"/>
              </svg>
              <span>{localCredits} credits.</span>
              <span style={{ color: "#000000" }}>Upgrade</span>
            </button>
            <Button onClick={() => navigateInApp("/app")} variant="secondary" size="slim">← Dashboard</Button>
          </div>
        </div>
      </div>

      <div
        className="app-split-layout"
        style={{
          display: "flex",
          gap: "16px",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {/* LEFT: Pages Table */}
        <div
          className="app-split-main"
          style={{ flex: "1 1 calc(50% - 8px)", maxWidth: "calc(50% - 8px)", minWidth: "320px" }}
        >
          {localPages.length === 0 && (
            <Banner tone="info">
              <p>No pages found in your store. Create pages in Shopify Admin first.</p>
            </Banner>
          )}
          <Card padding="0">
            <div className="app-table-scroll">
              <IndexTable
                resourceName={{ singular: "page", plural: "pages" }}
                itemCount={localPages.length}
                headings={[
                  {
                    title: (
                      <Checkbox
                        label="Select all pages"
                        labelHidden
                        checked={allResourcesSelected}
                        indeterminate={selectionIndeterminate}
                        onChange={handleToggleSelectAllPages}
                      />
                    ),
                  },
                  { title: "Title" },
                  { title: "Short" },
                  { title: "Status" },
                ]}
                selectable={false}
              >
              {localPages.map((page, index) => {
                const shortStatus = evaluateContentShortStatus(stripHtml(page.body || page.bodySummary || ""));
                const publishStatus = evaluatePagePublishStatus(page.publishedAt);
                return (
                  <IndexTable.Row
                    id={page.id}
                    key={page.id}
                    position={index}
                  >
                    <IndexTable.Cell>
                      <Checkbox
                        label={`Select ${page.title}`}
                        labelHidden
                        checked={selectedResources.includes(page.id)}
                        onChange={handleTogglePageSelection(page.id)}
                      />
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="150" blockAlign="center" wrap={false}>
                        <button
                          type="button"
                          onClick={() => openPageEditor(page)}
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                          title="Open page editor"
                        >
                          <Text variant="bodyMd" fontWeight="bold" as="span">{page.title}</Text>
                        </button>
                        <Button
                          size="micro"
                          variant="tertiary"
                          icon={ViewIcon}
                          url={getShopifyAdminPageUrl(page)}
                          external
                          disabled={!getShopifyAdminPageUrl(page)}
                          accessibilityLabel={`Open ${page.title} in Shopify admin`}
                        />
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={shortStatus.tone}>{shortStatus.label}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={publishStatus.tone}>{publishStatus.label}</Badge>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
              </IndexTable>
            </div>
          </Card>
        </div>

        {/* RIGHT: Bulk Settings Panel */}
        <div
          className="app-split-side"
          style={{ flex: "1 1 calc(50% - 8px)", maxWidth: "calc(50% - 8px)", minWidth: "320px" }}
        >
          <Card padding="0">
            <div style={{ padding: "16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd" fontWeight="bold">Page Bulk Settings</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {selectedResources.length > 0
                    ? `Content will be generated for ${selectedResources.length} page${selectedResources.length !== 1 ? "s" : ""}`
                    : "Select pages from the list to generate content"}
                </Text>
              </BlockStack>
            </div>

            {/* Content Type Pills */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {[
                  { id: "body", label: "Body" },
                  { id: "meta_description", label: "Meta Description" },
                  { id: "meta_title", label: "Meta Title" },
                ].map((type) => {
                  const isSelected = bulkContentTypes.includes(type.id);
                  return (
                    <button
                      key={type.id}
                      onClick={() => {
                        setBulkContentTypes((prev) =>
                          prev.includes(type.id) ? prev.filter((t) => t !== type.id) : [...prev, type.id]
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

            {/* Body Section */}
            {bulkContentTypes.includes("body") && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <Text as="h3" variant="headingSm" fontWeight="semibold">Body</Text>
                <div style={{ marginTop: "10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Checkbox
                    label={<span>Use custom instructions <span style={{ color: "#f59e0b", fontSize: "14px" }}>*</span></span>}
                    checked={useCustomBodyInstructions}
                    onChange={(value) => {
                      setUseCustomBodyInstructions(value);
                      if (value) setBulkBodyTemplate(DEFAULT_BODY_CUSTOM_PROMPT);
                    }}
                  />
                  {!useCustomBodyInstructions && (
                    <button
                      onClick={() => { setTemplateLibraryContentType("body"); setTemplateLibraryOpen(true); }}
                      style={{ padding: "6px 14px", background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                    >
                      Browse Templates
                    </button>
                  )}
                </div>
                {useCustomBodyInstructions && (
                  <div style={{ marginTop: "8px" }}>
                    <Text as="p" variant="bodySm" fontWeight="semibold">Custom Prompt</Text>
                    <div style={{ marginTop: "4px" }}>
                      <TextField
                        label="Custom Prompt"
                        labelHidden
                        multiline={8}
                        autoSize={false}
                        maxHeight={240}
                        minLength={0}
                        value={bulkBodyTemplate}
                        onChange={setBulkBodyTemplate}
                        autoComplete="off"
                        placeholder="Enter custom instructions for page body generation..."
                      />
                    </div>
                    <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => { setTemplateLibraryContentType("body"); setTemplateLibraryOpen(true); }}
                        style={{ padding: "6px 14px", background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                      >
                        Browse Templates
                      </button>
                      <button
                        onClick={() => { setBulkBodyTemplate(DEFAULT_BODY_CUSTOM_PROMPT); setUseCustomBodyInstructions(true); }}
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
                    label={<span>Use custom instructions <span style={{ color: "#f59e0b", fontSize: "14px" }}>*</span></span>}
                    checked={useCustomMetaTitleInstructions}
                    onChange={(value) => {
                      setUseCustomMetaTitleInstructions(value);
                      if (value) setBulkMetaTitleTemplate(DEFAULT_META_TITLE_CUSTOM_PROMPT);
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
                        label="Custom Prompt"
                        labelHidden
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

            {/* Meta Description Section */}
            {bulkContentTypes.includes("meta_description") && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <Text as="h3" variant="headingSm" fontWeight="semibold">Meta Description</Text>
                <div style={{ marginTop: "10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Checkbox
                    label={<span>Use custom instructions <span style={{ color: "#f59e0b", fontSize: "14px" }}>*</span></span>}
                    checked={useCustomMetaDescInstructions}
                    onChange={(value) => {
                      setUseCustomMetaDescInstructions(value);
                      if (value) setBulkMetaDescTemplate(DEFAULT_META_DESCRIPTION_CUSTOM_PROMPT);
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
                        label="Custom Prompt"
                        labelHidden
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

            {bulkValidationMessage && (
              <div style={{ padding: "8px 16px" }}>
                <Banner tone="warning"><p>{bulkValidationMessage}</p></Banner>
              </div>
            )}

            {bulkResult && (
              <div style={{ padding: "8px 16px" }}>
                <Banner tone={bulkResult.failed === 0 ? "success" : "warning"}>
                  <p>Generated {bulkResult.succeeded}/{bulkResult.total} pages{bulkResult.failed > 0 ? ` (${bulkResult.failed} failed)` : ""}.</p>
                </Banner>
              </div>
            )}

            {/* Generate Button */}
            <div style={{ padding: "12px 16px" }}>
              <Button
                style={{ width: "fit-content" }}
                variant="primary"
                onClick={handleBulkGenerate}
                disabled={isBulkGenerating || selectedResources.length === 0 || !hasRequiredBulkTemplates}
                loading={isBulkGenerating}
                tone="success"
              >
                {`Generate ${selectedResources.length} page${selectedResources.length !== 1 ? "s" : ""}`}
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
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd" fontWeight="bold">Generation Results</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {bulkResult.succeeded} page{bulkResult.succeeded !== 1 ? "s" : ""} generated for review · {bulkResult.failed > 0 ? `${bulkResult.failed} failed · ` : ""}{bulkResult.creditsUsed ?? 0} AI credits used
                </Text>
              </BlockStack>
            </div>
            <div className="app-table-scroll">
              <IndexTable
                resourceName={{ singular: "page", plural: "pages" }}
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
                      ? <Badge tone="success">Ready to review</Badge>
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
          { id: "body", label: "Body" },
          { id: "meta_title", label: "Meta Title" },
          { id: "meta_description", label: "Meta Description" },
        ]}
        initialTab={templateLibraryContentType}
        templatesByTab={{
          body: PAGE_BODY_TEMPLATES,
          meta_title: PAGE_META_TITLE_TEMPLATES,
          meta_description: PAGE_META_DESCRIPTION_TEMPLATES,
        }}
        onUseTemplate={(templateText) => {
          if (templateLibraryContentType === "body") {
            setBulkBodyTemplate(templateText);
            setUseCustomBodyInstructions(true);
          } else if (templateLibraryContentType === "meta_title") {
            setBulkMetaTitleTemplate(templateText);
            setUseCustomMetaTitleInstructions(true);
          } else if (templateLibraryContentType === "meta_description") {
            setBulkMetaDescTemplate(templateText);
            setUseCustomMetaDescInstructions(true);
          }
        }}
      />

      <GeneratedPageReviewModal
        open={Boolean(currentGeneratedReview)}
        page={currentGeneratedReview}
        body={generatedBody}
        seoTitle={generatedSeoTitle}
        seoDescription={generatedSeoDescription}
        onBodyChange={setGeneratedBody}
        onSeoTitleChange={setGeneratedSeoTitle}
        onSeoDescriptionChange={setGeneratedSeoDescription}
        onCancel={handleCancelGeneratedReview}
        onSave={handleSaveGeneratedReview}
        onRegenerate={handleRegenerateGeneratedReview}
        saving={isSavingGeneratedPage}
        regenerating={isBulkGenerating}
      />

      <PageEditorModal
        open={Boolean(editingPage)}
        page={editingPage}
        body={editBody}
        seoTitle={editSeoTitle}
        seoDescription={editSeoDescription}
        onBodyChange={setEditBody}
        onSeoTitleChange={setEditSeoTitle}
        onSeoDescriptionChange={setEditSeoDescription}
        onClose={() => setEditingPage(null)}
        onSave={handleSavePageEditor}
        loading={isSavingPage}
      />

    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
