import { useState, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { buildPageContentPrompt } from "../lib/contentPromptTemplates";
import {
  readStoredPagePromptTemplateSelection,
  PAGE_BODY_TEMPLATES,
  PAGE_META_DESCRIPTION_TEMPLATES,
  PAGE_META_TITLE_TEMPLATES,
} from "../lib/pagePromptTemplateLibrary";
import { TemplateLibraryModal } from "../components/TemplateLibraryModal";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  Select,
  Banner,
  Badge,
  Checkbox,
  IndexTable,
  useIndexResourceState,
  Spinner,
} from "@shopify/polaris";

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
    select: { openaiApiKey: true, anthropicApiKey: true, defaultAiProvider: true },
  });

  return {
    pages,
    hasOpenaiKey: !!shopData?.openaiApiKey,
    hasAnthropicKey: !!shopData?.anthropicApiKey,
    defaultAiProvider: shopData?.defaultAiProvider || "auto",
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

    const shopData = await db.shop.findUnique({
      where: { shop: session.shop },
      select: { openaiApiKey: true, anthropicApiKey: true },
    });

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

        const response = await admin.graphql(PAGE_UPDATE_MUTATION, {
          variables: {
            id: p.id,
            page: {
              body: parsed.pageBody || p.body || "",
              metafields: [
                { namespace: "global", key: "title_tag", value: parsed.seoTitle || "", type: "single_line_text_field" },
                { namespace: "global", key: "description_tag", value: parsed.seoDescription || "", type: "single_line_text_field" },
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
          aiModel: aiProvider || null,
          bodyHtml: parsed.pageBody || null,
          seoTitle: parsed.seoTitle || null,
          seoDescription: parsed.seoDescription || null,
          appliedToPage: true,
        });

        return { id: p.id, title: p.title, seoTitle: parsed.seoTitle, seoDescription: parsed.seoDescription };
      })
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    const itemResults = results.map((r, i) => ({
      id: bulkPages[i].id,
      title: bulkPages[i].title,
      status: r.status === "fulfilled" ? "success" : "failed",
      error: r.status === "rejected" ? r.reason?.message : null,
      seoTitle: r.status === "fulfilled" ? r.value.seoTitle : null,
      seoDescription: r.status === "fulfilled" ? r.value.seoDescription : null,
    }));
    return { success: true, intent, succeeded, failed, total: bulkPages.length, results: itemResults };
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

const LANGUAGE_OPTIONS = [
  { label: "English", value: "en" },
  { label: "Spanish", value: "es" },
  { label: "French", value: "fr" },
  { label: "German", value: "de" },
  { label: "Italian", value: "it" },
  { label: "Portuguese", value: "pt" },
  { label: "Dutch", value: "nl" },
  { label: "Japanese", value: "ja" },
  { label: "Chinese (Simplified)", value: "zh" },
  { label: "Hindi", value: "hi" },
  { label: "Arabic", value: "ar" },
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
  const { pages, defaultAiProvider } = useLoaderData();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const bulkFetcher = useFetcher();
  const isBulkGenerating = bulkFetcher.state !== "idle";

  const [bulkSettings, setBulkSettings] = useState({
    language: "en",
    tone: "professional",
    length: "medium",
    format: "paragraphs",
    pageType: "About Us",
    aiProvider: defaultAiProvider || "auto",
  });
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkValidationMessage, setBulkValidationMessage] = useState(null);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [bulkBodyTemplate, setBulkBodyTemplate] = useState("");
  const [bulkMetaTitleTemplate, setBulkMetaTitleTemplate] = useState("");
  const [bulkMetaDescTemplate, setBulkMetaDescTemplate] = useState("");
  const [useCustomBodyInstructions, setUseCustomBodyInstructions] = useState(false);
  const [useCustomMetaTitleInstructions, setUseCustomMetaTitleInstructions] = useState(false);
  const [useCustomMetaDescInstructions, setUseCustomMetaDescInstructions] = useState(false);

  const [templateLib, setTemplateLib] = useState({ open: false, tab: "description", target: "pageBodyPromptTemplate" });

  const pageTemplatesByTab = {
    description: PAGE_BODY_TEMPLATES,
    "seo-description": PAGE_META_DESCRIPTION_TEMPLATES,
    "seo-title": PAGE_META_TITLE_TEMPLATES,
  };
  const pageTemplateTabs = [
    { id: "description", label: "Body" },
    { id: "seo-description", label: "Meta Description" },
    { id: "seo-title", label: "Meta Title" },
  ];
  function openPageTemplateLib(tab, target) {
    setTemplateLib({ open: true, tab, target });
  }
  function handlePageUseTemplate(templateText) {
    if (templateLib.target === "pageBodyPromptTemplate") { setBulkBodyTemplate(templateText); setUseCustomBodyInstructions(true); }
    else if (templateLib.target === "pageMetaTitlePromptTemplate") { setBulkMetaTitleTemplate(templateText); setUseCustomMetaTitleInstructions(true); }
    else if (templateLib.target === "pageMetaDescriptionPromptTemplate") { setBulkMetaDescTemplate(templateText); setUseCustomMetaDescInstructions(true); }
    setTemplateLib((s) => ({ ...s, open: false }));
  }

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
    fd.append("pages", JSON.stringify(selectedPages.map((p) => ({ id: p.id, title: p.title, body: p.body || "" }))));
    fd.append("language", bulkSettings.language);
    fd.append("tone", bulkSettings.tone);
    fd.append("length", bulkSettings.length);
    fd.append("format", bulkSettings.format);
    fd.append("pageType", bulkSettings.pageType);
    fd.append("contextKeywords", "");
    fd.append("bodyPromptTemplate", bulkBodyTemplate || "");
    fd.append("metaTitlePromptTemplate", bulkMetaTitleTemplate || "");
    fd.append("metaDescriptionPromptTemplate", bulkMetaDescTemplate || "");
    fd.append("aiProvider", bulkSettings.aiProvider);
    bulkFetcher.submit(fd, { method: "post" });
  }

  useEffect(() => {
    const data = bulkFetcher.data;
    if (!data || bulkFetcher.state !== "idle") return;
    if (data.success) {
      setBulkResult(data);
      shopify.toast.show(`Generated ${data.succeeded}/${data.total} pages successfully.`);
    } else {
      setBulkValidationMessage(data.error || "Bulk generation failed.");
    }
  }, [bulkFetcher.data, bulkFetcher.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const btnStyle = { padding: "5px 12px", borderRadius: "6px", border: "1px solid #1a1a1a", background: "#1a1a1a", color: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap" };
  const resetBtnStyle = { padding: "4px 10px", borderRadius: "5px", border: "1px solid #d1d5db", background: "#f9fafb", color: "#374151", cursor: "pointer", fontSize: "12px", fontWeight: 500 };

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
            <div style={{ width: "54px", height: "54px", borderRadius: "6px", background: "rgba(6,182,212,0.2)", border: "1px solid rgba(6,182,212,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", flexShrink: 0 }}>
              📄
            </div>
            <div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#ffffff", marginBottom: "3px", letterSpacing: "-0.3px" }}>Storefront Pages</div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.55)", lineHeight: 1.4 }}>Generate and manage AI content for your Shopify storefront pages</div>
            </div>
          </div>
          <button
            onClick={() => navigate("/app")}
            style={{ padding: "7px 16px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
          >← Dashboard</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
        {/* LEFT: Pages Table */}
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          {pages.length === 0 && (
            <Banner tone="info">
              <p>No pages found in your store. Create pages in Shopify Admin first.</p>
            </Banner>
          )}
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "page", plural: "pages" }}
              itemCount={pages.length}
              selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Title" },
                { title: "SEO Title" },
                { title: "SEO Description" },
                { title: "Generated" },
              ]}
            >
              {pages.map((page, index) => (
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
                    {page.seo?.title
                      ? <Badge tone="success">Set</Badge>
                      : <Badge tone="attention">Missing</Badge>}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {page.seo?.description
                      ? <Badge tone="success">Set</Badge>
                      : <Badge tone="attention">Missing</Badge>}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text variant="bodySm" tone="subdued" as="span">
                      {page.generatedAt
                        ? new Date(page.generatedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </Text>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </div>

        {/* RIGHT: Bulk Settings Panel */}
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
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

            {/* Page Type */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <Select
                label="Page Type"
                options={PAGE_TYPE_OPTIONS}
                value={bulkSettings.pageType}
                onChange={(v) => setBulkSettings((s) => ({ ...s, pageType: v }))}
              />
            </div>

            {/* Output Language */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <Select
                label="Output Language"
                options={LANGUAGE_OPTIONS}
                value={bulkSettings.language}
                onChange={(v) => setBulkSettings((s) => ({ ...s, language: v }))}
              />
            </div>

            {/* Body Template Section */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm" fontWeight="semibold">Body</Text>
                <button onClick={() => openPageTemplateLib("description", "pageBodyPromptTemplate")} style={btnStyle}>Browse Templates</button>
              </InlineStack>
              <div style={{ marginTop: "8px" }}>
                <Checkbox
                  label={<span style={{ fontSize: "13px", color: "#374151" }}>Use custom instructions <span style={{ fontSize: "13px" }}>✨</span></span>}
                  checked={useCustomBodyInstructions}
                  onChange={setUseCustomBodyInstructions}
                />
                {useCustomBodyInstructions && (
                  <div style={{ marginTop: "8px" }}>
                    <TextField
                      label="Body custom prompt" labelHidden
                      value={bulkBodyTemplate}
                      onChange={setBulkBodyTemplate}
                      multiline={3} autoComplete="off"
                      placeholder="Enter custom instructions for body generation..."
                    />
                    {bulkBodyTemplate && (
                      <div style={{ marginTop: "4px" }}>
                        <button onClick={() => setBulkBodyTemplate("")} style={resetBtnStyle}>↺ Reset to Default</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Meta Title Template Section */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm" fontWeight="semibold">Meta Title</Text>
                <button onClick={() => openPageTemplateLib("seo-title", "pageMetaTitlePromptTemplate")} style={btnStyle}>Browse Templates</button>
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
                      label="Meta title custom prompt" labelHidden
                      value={bulkMetaTitleTemplate}
                      onChange={setBulkMetaTitleTemplate}
                      multiline={3} autoComplete="off"
                      placeholder="Enter custom instructions for meta title generation..."
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

            {/* Meta Description Template Section */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm" fontWeight="semibold">Meta Description</Text>
                <button onClick={() => openPageTemplateLib("seo-description", "pageMetaDescriptionPromptTemplate")} style={btnStyle}>Browse Templates</button>
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
                      label="Meta description custom prompt" labelHidden
                      value={bulkMetaDescTemplate}
                      onChange={setBulkMetaDescTemplate}
                      multiline={3} autoComplete="off"
                      placeholder="Enter custom instructions for meta description generation..."
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

            {/* Advanced Settings Toggle */}
            <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <button
                onClick={() => setShowAdvancedSettings((v) => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "13px", color: "#374151", display: "flex", alignItems: "center", gap: "6px", padding: "0", fontWeight: 500 }}
              >
                <span>{showAdvancedSettings ? "▲" : "▼"}</span>
                {showAdvancedSettings ? "Hide" : "Show"} Advanced Settings
              </button>
            </div>

            {showAdvancedSettings && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <BlockStack gap="300">
                  <Select
                    label="Tone"
                    options={TONE_OPTIONS}
                    value={bulkSettings.tone}
                    onChange={(v) => setBulkSettings((s) => ({ ...s, tone: v }))}
                  />
                  <Select
                    label="Length"
                    options={LENGTH_OPTIONS}
                    value={bulkSettings.length}
                    onChange={(v) => setBulkSettings((s) => ({ ...s, length: v }))}
                  />
                  <Select
                    label="Format"
                    options={FORMAT_OPTIONS}
                    value={bulkSettings.format}
                    onChange={(v) => setBulkSettings((s) => ({ ...s, format: v }))}
                  />
                  <Select
                    label="AI Provider"
                    options={[
                      { label: "Auto", value: "auto" },
                      { label: "OpenAI", value: "openai" },
                      { label: "Anthropic", value: "anthropic" },
                    ]}
                    value={bulkSettings.aiProvider}
                    onChange={(v) => setBulkSettings((s) => ({ ...s, aiProvider: v }))}
                  />
                </BlockStack>
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
              {isBulkGenerating && (
                <div style={{ marginBottom: "8px" }}>
                  <InlineStack align="center" blockAlign="center" gap="200">
                    <Spinner size="small" />
                    <Text variant="bodySm" tone="subdued">Generating for {selectedResources.length} pages...</Text>
                  </InlineStack>
                </div>
              )}
              <Button
                fullWidth
                variant="primary"
                onClick={handleBulkGenerate}
                disabled={isBulkGenerating || selectedResources.length === 0}
                tone="success"
              >
                {isBulkGenerating
                  ? "Generating..."
                  : `Generate ${selectedResources.length} page${selectedResources.length !== 1 ? "s" : ""}`}
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
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd" fontWeight="bold">Generation Results</Text>
                <Badge tone={bulkResult.failed > 0 ? "warning" : "success"}>
                  {bulkResult.succeeded}/{bulkResult.total} succeeded
                </Badge>
              </InlineStack>
            </div>
            <IndexTable
              resourceName={{ singular: "page", plural: "pages" }}
              itemCount={bulkResult.results.length}
              selectable={false}
              headings={[
                { title: "Page" },
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
        tabs={pageTemplateTabs}
        initialTab={templateLib.tab}
        templatesByTab={pageTemplatesByTab}
        onUseTemplate={handlePageUseTemplate}
      />
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
