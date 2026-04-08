import { useState, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { buildPageContentPrompt } from "../lib/contentPromptTemplates";
import { readGlobalSettings } from "../lib/globalSettings";
import {
  readStoredPagePromptTemplateSelection,
  PAGE_BODY_TEMPLATES,
  PAGE_META_DESCRIPTION_TEMPLATES,
  PAGE_META_TITLE_TEMPLATES,
} from "../lib/pagePromptTemplateLibrary";
import {
  buildInsufficientCreditsError,
  creditsForBatch,
  creditsForContentTypes,
  deductCredits,
  parseSelectedContentTypes,
} from "../lib/credits.server";
import {
  Page,
  Card,
  BlockStack,
  Icon,
  Text,
  Button,
  Select,
  TextField,
  Banner,
  Badge,
  IndexTable,
  useIndexResourceState,
} from "@shopify/polaris";
import { PageIcon } from "@shopify/polaris-icons";

const PAGE_CONTENT_TYPES = ["body", "meta_title", "meta_description"];
const DEFAULT_PAGE_CONTENT_TYPES = ["body", "meta_title", "meta_description"];

// ─── GraphQL ────────────────────────────────────────────────────────────────

const PAGES_QUERY = `#graphql
  query GetPages($first: Int!, $after: String) {
    pages(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
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

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: input.prompt }],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${err}`);
  }
  const data = await response.json();
  return data.content?.[0]?.text || "";
}

async function generateContentWithOpenAI(input, shopApiKey) {
  const key = shopApiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("No OpenAI API key available.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 1024,
      messages: [{ role: "user", content: input.prompt }],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${err}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function generateContent(input, { aiProvider, shopOpenaiKey, shopAnthropicKey }) {
  const provider =
    aiProvider === "auto"
      ? shopOpenaiKey || process.env.OPENAI_API_KEY
        ? "openai"
        : "anthropic"
      : aiProvider;

  if (provider === "openai") return generateContentWithOpenAI(input, shopOpenaiKey);
  return generateContentWithAnthropic(input, shopAnthropicKey);
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

function normalizeGeneratedHtml(value) {
  const text = (value || "").trim();
  if (!text) return "";
  if (looksLikeHtml(text)) return text;
  return toParagraphHtml(text);
}

function stripHtml(value) {
  return (value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function evaluateContentShortStatus(content) {
  if (!content || !content.trim()) return { label: "Missing", tone: "critical" };
  if (content.trim().length < 80) return { label: "Short", tone: "warning" };
  return { label: "Good", tone: "success" };
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
    select: { openaiApiKey: true, anthropicApiKey: true, defaultAiProvider: true, credits: true, creditsUsedTotal: true },
  });

  return {
    pages,
    hasOpenaiKey: !!shopData?.openaiApiKey,
    hasAnthropicKey: !!shopData?.anthropicApiKey,
    defaultAiProvider: shopData?.defaultAiProvider || "auto",
    credits: shopData?.credits ?? 100,
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
    const length = formData.get("length") || "medium";
    const format = formData.get("format") || "paragraphs";
    const pageType = formData.get("pageType") || "About Us";
    const contextKeywords = formData.get("contextKeywords") || "";
    const bodyPromptTemplate = formData.get("bodyPromptTemplate") || "";
    const metaTitlePromptTemplate = formData.get("metaTitlePromptTemplate") || "";
    const metaDescriptionPromptTemplate = formData.get("metaDescriptionPromptTemplate") || "";
    const aiProvider = formData.get("aiProvider") || "auto";
    const selectedContentTypes = parseSelectedContentTypes(
      formData.get("contentTypes"),
      PAGE_CONTENT_TYPES,
      DEFAULT_PAGE_CONTENT_TYPES,
    );
    const shouldUpdateBody = selectedContentTypes.includes("body");
    const shouldUpdateMetaTitle = selectedContentTypes.includes("meta_title");
    const shouldUpdateMetaDescription = selectedContentTypes.includes("meta_description");
    const creditsPerItem = creditsForContentTypes(selectedContentTypes);

    const shopData = await db.shop.findUnique({
      where: { shop: session.shop },
      select: { openaiApiKey: true, anthropicApiKey: true, credits: true, creditsUsedTotal: true },
    });
    const availableCredits = shopData?.credits ?? 100;
    const requiredCredits = creditsForBatch(selectedContentTypes, bulkPages.length);
    if (availableCredits < requiredCredits) {
      return {
        success: false,
        intent,
        error: buildInsufficientCreditsError(requiredCredits, availableCredits),
      };
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
        const raw = await generateContent(input, {
          aiProvider,
          shopOpenaiKey: shopData?.openaiApiKey,
          shopAnthropicKey: shopData?.anthropicApiKey,
        });

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

        const response = await admin.graphql(PAGE_UPDATE_MUTATION, {
          variables: {
            id: p.id,
            page: {
              body: nextBody,
              metafields: [
                { namespace: "global", key: "title_tag", value: nextSeoTitle, type: "single_line_text_field" },
                { namespace: "global", key: "description_tag", value: nextSeoDescription, type: "single_line_text_field" },
              ],
            },
          },
        });
        const json = await response.json();
        const userErrors = json.data?.pageUpdate?.userErrors || [];
        if (userErrors.length > 0) throw new Error(userErrors.map((e) => e.message).join(", "));

        await upsertPageContent({
          shop: session.shop,
          pageId: p.id,
          pageTitle: p.title || null,
          pageType: pageType || null,
          language: language || null,
          tone: tone || null,
          lengthOption: length || null,
          formatOption: format || null,
          contextKeywords: contextKeywords || null,
          bodyPromptTemplate: bodyPromptTemplate || null,
          metaTitlePromptTemplate: metaTitlePromptTemplate || null,
          metaDescriptionPromptTemplate: metaDescriptionPromptTemplate || null,
          aiModel: aiProvider || null,
          bodyHtml: nextBody || null,
          seoTitle: nextSeoTitle || null,
          seoDescription: nextSeoDescription || null,
          creditsUsed: creditsPerItem,
          appliedToPage: true,
        });

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
          aiModel: aiProvider || null,
          generatedDescription: nextBody || null,
          generatedSeoTitle: nextSeoTitle || null,
          generatedSeoDescription: nextSeoDescription || null,
          creditsUsed: creditsPerItem,
          appliedToProduct: true,
        });

        return { id: p.id, title: p.title, seoTitle: nextSeoTitle, seoDescription: nextSeoDescription };
      })
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
      id: bulkPages[i].id,
      title: bulkPages[i].title,
      status: r.status === "fulfilled" ? "success" : "failed",
      error: r.status === "rejected" ? r.reason?.message : null,
      seoTitle: r.status === "fulfilled" ? r.value.seoTitle : null,
      seoDescription: r.status === "fulfilled" ? r.value.seoDescription : null,
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

const PAGE_TYPE_OPTIONS = [
  { label: "About Us", value: "About Us" },
  { label: "Contact", value: "Contact" },
  { label: "FAQ", value: "FAQ" },
  { label: "Privacy Policy", value: "Privacy Policy" },
  { label: "Terms of Service", value: "Terms of Service" },
  { label: "Shipping Policy", value: "Shipping Policy" },
  { label: "Refund Policy", value: "Refund Policy" },
  { label: "Landing Page", value: "Landing Page" },
  { label: "Blog Landing", value: "Blog Landing" },
  { label: "Custom", value: "Custom" },
];


const TONE_OPTIONS = [
  { label: "Professional", value: "professional" },
  { label: "Friendly", value: "friendly" },
  { label: "Casual", value: "casual" },
  { label: "Formal", value: "formal" },
  { label: "Enthusiastic", value: "enthusiastic" },
  { label: "Informative", value: "informative" },
];

const LENGTH_OPTIONS = [
  { label: "Short", value: "short" },
  { label: "Medium", value: "medium" },
  { label: "Long", value: "long" },
];

const FORMAT_OPTIONS = [
  { label: "Paragraphs", value: "paragraphs" },
  { label: "Bullet points", value: "bullet points" },
  { label: "Headings + paragraphs", value: "headings and paragraphs" },
  { label: "HTML", value: "HTML" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function PagesPage() {
  const { pages, defaultAiProvider, credits } = useLoaderData();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const bulkFetcher = useFetcher();
  const isBulkGenerating = bulkFetcher.state !== "idle";

  const [bulkSettings, setBulkSettings] = useState(() => {
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
  const [bulkBodyTemplate, setBulkBodyTemplate] = useState("");
  const [bulkMetaTitleTemplate, setBulkMetaTitleTemplate] = useState("");
  const [bulkMetaDescTemplate, setBulkMetaDescTemplate] = useState("");
  const [selectedBodyTemplateId, setSelectedBodyTemplateId] = useState("");
  const [selectedMetaTitleTemplateId, setSelectedMetaTitleTemplateId] = useState("");
  const [selectedMetaDescTemplateId, setSelectedMetaDescTemplateId] = useState("");
  const [bulkBodyKeywords, setBulkBodyKeywords] = useState(() => readGlobalSettings().pageContentKeywords || "");
  const [bulkMetaTitleKeywords, setBulkMetaTitleKeywords] = useState(() => readGlobalSettings().pageMetaTitleKeywords || "");
  const [bulkMetaDescKeywords, setBulkMetaDescKeywords] = useState(() => readGlobalSettings().pageMetaDescKeywords || "");

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(pages);

  useEffect(() => {
    const templateSelection = readStoredPagePromptTemplateSelection();
    if (templateSelection.bodyPromptTemplate) setBulkBodyTemplate(templateSelection.bodyPromptTemplate);
    if (templateSelection.metaTitlePromptTemplate) setBulkMetaTitleTemplate(templateSelection.metaTitlePromptTemplate);
    if (templateSelection.metaDescriptionPromptTemplate) setBulkMetaDescTemplate(templateSelection.metaDescriptionPromptTemplate);
  }, []);

  function handleBulkGenerate() {
    if (selectedResources.length === 0) {
      setBulkValidationMessage("Select at least one page to generate content for.");
      return;
    }
    setBulkValidationMessage(null);
    setBulkResult(null);
    const selectedPages = pages.filter((p) => selectedResources.includes(p.id));
    const fd = new FormData();
    fd.append("intent", "bulk_generate_pages");
    fd.append("pages", JSON.stringify(selectedPages.map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body || "",
      seoTitleValue: p.seo?.title || "",
      seoDescriptionValue: p.seo?.description || "",
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
    fd.append("bodyPromptTemplate", bulkBodyTemplate || "");
    fd.append("metaTitlePromptTemplate", bulkMetaTitleTemplate || "");
    fd.append("metaDescriptionPromptTemplate", bulkMetaDescTemplate || "");
    fd.append("contentTypes", JSON.stringify(bulkContentTypes));
    fd.append("aiProvider", bulkSettings.aiProvider || defaultAiProvider || "auto");
    bulkFetcher.submit(fd, { method: "post" });
  }

  useEffect(() => {
    const data = bulkFetcher.data;
    if (!data || bulkFetcher.state !== "idle") return;
    if (data.success) {
      setBulkResult(data);
      const creditsMessage =
        typeof data.creditsUsed === "number"
          ? ` ${data.creditsUsed} credits used${typeof data.newCredits === "number" ? `. Remaining: ${data.newCredits}` : ""}.`
          : "";
      shopify.toast.show(`Generated ${data.succeeded}/${data.total} pages successfully.${creditsMessage}`);
    } else {
      setBulkValidationMessage(data.error || "Bulk generation failed.");
    }
  }, [bulkFetcher.data, bulkFetcher.state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page fullWidth>
      {/* ── Hero Header ── */}
      <div style={{
        background: "linear-gradient(135deg, #00131a 0%, #064e3b 50%, #0c2a4a 100%)",
        borderRadius: "6px",
        padding: "28px 32px",
        marginBottom: "24px",
        position: "relative",
      }}>
        <div style={{ position: "absolute", top: "-50px", right: "-50px", width: "220px", height: "220px", borderRadius: "50%", background: "radial-gradient(circle, rgba(6,182,212,0.28) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "-40px", left: "25%", width: "160px", height: "160px", borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.2) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 1, flexWrap: "wrap", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ width: "46px", height: "46px", borderRadius: "6px", background: "rgba(6,182,212,0.2)", border: "1px solid rgba(6,182,212,0.4)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon source={PageIcon} tone="base" />
            </div>
            <div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#ffffff", marginBottom: "3px", letterSpacing: "-0.3px" }}>Storefront Pages</div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.55)", lineHeight: 1.4 }}>Generate and manage AI content for your Shopify storefront pages</div>
            </div>
          </div>
          <div style={{ "--p-color-text": "#fff", "--p-color-bg-fill": "rgba(255,255,255,0.08)", "--p-color-border": "rgba(255,255,255,0.25)" }}>
            {/* Credits badge */}
            <button
              type="button"
              onClick={() => navigate("/app/analytics")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                border: "1px solid rgba(255,255,255,0.3)",
                background: "rgba(255,255,255,0.1)",
                borderRadius: 20,
                padding: "4px 10px",
                boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                fontSize: 12,
                fontWeight: 600,
                color: "#ffffff",
                lineHeight: 1,
                whiteSpace: "nowrap",
                cursor: "pointer",
                marginRight: "8px",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 20 20" fill="#f59e0b">
                <path d="M10 1L12.39 7.26L19 8.27L14.5 12.64L15.78 19.02L10 15.77L4.22 19.02L5.5 12.64L1 8.27L7.61 7.26L10 1Z"/>
              </svg>
              <span>{credits} credits.</span>
              <span style={{ color: "#60d5ff" }}>Upgrade</span>
            </button>
            <Button onClick={() => navigate("/app")} variant="secondary" size="slim">← Dashboard</Button>
          </div>
        </div>
      </div>

      <div className="app-split-layout">
        {/* LEFT: Pages Table */}
        <div className="app-split-main">
          {pages.length === 0 && (
            <Banner tone="info">
              <p>No pages found in your store. Create pages in Shopify Admin first.</p>
            </Banner>
          )}
          <Card padding="0">
            <div className="app-table-scroll">
              <IndexTable
                resourceName={{ singular: "page", plural: "pages" }}
              itemCount={pages.length}
              selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Title" },
                { title: "Short" },
                { title: "Status" },
              ]}
            >
              {pages.map((page, index) => {
                const shortStatus = evaluateContentShortStatus(stripHtml(page.body || page.bodySummary || ""));
                return (
                  <IndexTable.Row
                    id={page.id}
                    key={page.id}
                    selected={selectedResources.includes(page.id)}
                    position={index}
                  >
                    <IndexTable.Cell>
                      <Text variant="bodyMd" fontWeight="bold" as="span">{page.title}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={shortStatus.tone}>{shortStatus.label}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {page.seo?.title
                        ? <Badge tone="success">Set</Badge>
                        : <Badge tone="attention">Missing</Badge>}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
              </IndexTable>
            </div>
          </Card>
        </div>

        {/* RIGHT: Bulk Settings Panel */}
        <div className="app-split-side">
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

            {/* Body Template Section */}
            {bulkContentTypes.includes("body") && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <Text as="h3" variant="headingSm" fontWeight="semibold">Body</Text>
                <div style={{ marginTop: "8px" }}>
                  <Select
                    label="Template" labelHidden
                    options={[{ label: "— Default (no template) —", value: "" }, ...PAGE_BODY_TEMPLATES.map((t) => ({ label: t.name, value: t.id }))]}
                    value={selectedBodyTemplateId}
                    onChange={(id) => { setSelectedBodyTemplateId(id); setBulkBodyTemplate(PAGE_BODY_TEMPLATES.find((t) => t.id === id)?.template || ""); }}
                  />
                </div>
                <div style={{ marginTop: "8px" }}>
                  <TextField
                    label="Body Keywords"
                    value={bulkBodyKeywords}
                    onChange={setBulkBodyKeywords}
                    placeholder="e.g. about us, mission, values"
                    helpText="Keywords specific to page body content"
                    autoComplete="off"
                  />
                </div>
              </div>
            )}

            {/* Meta Title Template Section */}
            {bulkContentTypes.includes("meta_title") && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <Text as="h3" variant="headingSm" fontWeight="semibold">Meta Title</Text>
                <div style={{ marginTop: "8px" }}>
                  <Select
                    label="Template" labelHidden
                    options={[{ label: "— Default (no template) —", value: "" }, ...PAGE_META_TITLE_TEMPLATES.map((t) => ({ label: t.name, value: t.id }))]}
                    value={selectedMetaTitleTemplateId}
                    onChange={(id) => { setSelectedMetaTitleTemplateId(id); setBulkMetaTitleTemplate(PAGE_META_TITLE_TEMPLATES.find((t) => t.id === id)?.template || ""); }}
                  />
                </div>
                <div style={{ marginTop: "8px" }}>
                  <TextField
                    label="Meta Title Keywords"
                    value={bulkMetaTitleKeywords}
                    onChange={setBulkMetaTitleKeywords}
                    placeholder="e.g. official, store"
                    helpText="Keywords specific to meta titles"
                    autoComplete="off"
                  />
                </div>
              </div>
            )}

            {/* Meta Description Template Section */}
            {bulkContentTypes.includes("meta_description") && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <Text as="h3" variant="headingSm" fontWeight="semibold">Meta Description</Text>
                <div style={{ marginTop: "8px" }}>
                  <Select
                    label="Template" labelHidden
                    options={[{ label: "— Default (no template) —", value: "" }, ...PAGE_META_DESCRIPTION_TEMPLATES.map((t) => ({ label: t.name, value: t.id }))]}
                    value={selectedMetaDescTemplateId}
                    onChange={(id) => { setSelectedMetaDescTemplateId(id); setBulkMetaDescTemplate(PAGE_META_DESCRIPTION_TEMPLATES.find((t) => t.id === id)?.template || ""); }}
                  />
                </div>
                <div style={{ marginTop: "8px" }}>
                  <TextField
                    label="Meta Desc Keywords"
                    value={bulkMetaDescKeywords}
                    onChange={setBulkMetaDescKeywords}
                    placeholder="e.g. learn more, discover"
                    helpText="Keywords specific to meta descriptions"
                    autoComplete="off"
                  />
                </div>
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
                fullWidth
                variant="primary"
                onClick={handleBulkGenerate}
                disabled={isBulkGenerating || selectedResources.length === 0}
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
                  {bulkResult.succeeded} page{bulkResult.succeeded !== 1 ? "s" : ""} updated · {bulkResult.failed > 0 ? `${bulkResult.failed} failed · ` : ""}{bulkResult.creditsUsed ?? 0} AI credits used
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

    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
