import { useState, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { buildPageContentPrompt } from "../lib/contentPromptTemplates";
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
  Divider,
  Box,
  Grid,
  Modal,
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

function buildGenerationPrompt({ pageTitle, pageType, body, language, tone, length, format, contextKeywords }) {
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

  if (intent === "generate_page_content") {
    const pageId = formData.get("pageId") || "";
    const pageTitle = formData.get("pageTitle") || "";
    const pageType = formData.get("pageType") || "About Us";
    const body = formData.get("body") || "";
    const language = formData.get("language") || "en";
    const tone = formData.get("tone") || "";
    const length = formData.get("length") || "";
    const format = formData.get("format") || "";
    const contextKeywords = formData.get("contextKeywords") || "";
    const aiProvider = formData.get("aiProvider") || "auto";

    const shopData = await db.shop.findUnique({
      where: { shop: session.shop },
      select: { openaiApiKey: true, anthropicApiKey: true },
    });

    try {
      const input = buildGenerationPrompt({
        pageTitle,
        pageType,
        body,
        language,
        tone,
        length,
        format,
        contextKeywords,
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
      } catch {
        parsed.pageBody = raw;
      }

      if (pageId) {
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
          aiModel: aiProvider || null,
          bodyHtml: parsed.pageBody || null,
          seoTitle: parsed.seoTitle || null,
          seoDescription: parsed.seoDescription || null,
          appliedToPage: false,
        });
      }

      return { success: true, intent, ...parsed };
    } catch (err) {
      return { success: false, intent, error: err.message };
    }
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

const KEYWORD_CHIPS = ["Brand Name", "Products", "Location", "Offer", "Discount", "Free Shipping"];

// ─── Edit modal initial state ─────────────────────────────────────────────────

const editInitialState = {
  pageId: "",
  title: "",
  body: "",
  seoTitle: "",
  seoDescription: "",
  aiProvider: "auto",
  pageType: "About Us",
  language: "en",
  tone: "professional",
  length: "medium",
  format: "paragraphs",
  contextKeywords: "",
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function PagesPage() {
  const { pages, defaultAiProvider } = useLoaderData();
  const navigate = useNavigate();
  const generateFetcher = useFetcher();
  const saveFetcher = useFetcher();
  const isGenerating = generateFetcher.state !== "idle";
  const isSaving = saveFetcher.state !== "idle";

  const shopify = useAppBridge();
  const [editModal, setEditModal] = useState(false);
  const [editState, setEditState] = useState(editInitialState);
  const [generationError, setGenerationError] = useState(null);

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(pages);

  function openEditModal(page) {
    setEditState({
      ...editInitialState,
      aiProvider: defaultAiProvider,
      pageId: page.id,
      title: page.title || "",
      body: page.body || "",
      seoTitle: page.seo?.title || "",
      seoDescription: page.seo?.description || "",
    });
    setGenerationError(null);
    setEditModal(true);
  }

  function closeEditModal() {
    setEditModal(false);
    setGenerationError(null);
  }

  function setField(field) {
    return (value) => setEditState((s) => ({ ...s, [field]: value }));
  }

  function appendKeyword(kw) {
    setEditState((s) => ({
      ...s,
      contextKeywords: s.contextKeywords ? `${s.contextKeywords}, ${kw}` : kw,
    }));
  }

  function handleGenerate() {
    setGenerationError(null);
    const fd = new FormData();
    fd.append("intent", "generate_page_content");
    fd.append("pageId", editState.pageId);
    fd.append("pageTitle", editState.title);
    fd.append("pageType", editState.pageType);
    fd.append("body", editState.body);
    fd.append("language", editState.language);
    fd.append("tone", editState.tone);
    fd.append("length", editState.length);
    fd.append("format", editState.format);
    fd.append("contextKeywords", editState.contextKeywords);
    fd.append("aiProvider", editState.aiProvider);
    generateFetcher.submit(fd, { method: "post" });
  }

  function handleSave() {
    const fd = new FormData();
    fd.append("intent", "update_page");
    fd.append("pageId", editState.pageId);
    fd.append("pageTitle", editState.title);
    fd.append("pageType", editState.pageType);
    fd.append("language", editState.language);
    fd.append("tone", editState.tone);
    fd.append("length", editState.length);
    fd.append("format", editState.format);
    fd.append("contextKeywords", editState.contextKeywords);
    fd.append("body", editState.body);
    fd.append("seoTitle", editState.seoTitle);
    fd.append("seoDescription", editState.seoDescription);
    saveFetcher.submit(fd, { method: "post" });
  }

  useEffect(() => {
    const data = generateFetcher.data;
    if (!data) return;
    if (data.success) {
      setEditState((s) => ({
        ...s,
        body: data.pageBody || s.body,
        seoTitle: data.seoTitle || s.seoTitle,
        seoDescription: data.seoDescription || s.seoDescription,
      }));
      setGenerationError(null);
    } else {
      setGenerationError(data.error || "Generation failed.");
    }
  }, [generateFetcher.data]);

  useEffect(() => {
    const data = saveFetcher.data;
    if (!data) return;
    if (data.success) {
      shopify.toast.show("Page updated successfully!");
      closeEditModal();
    } else {
      setGenerationError(data.error || "Save failed.");
    }
  }, [saveFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowMarkup = pages.map((page, index) => (
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
        <div className="pages-summary-cell">
          <Text variant="bodySm" tone="subdued" as="span">
            {page.bodySummary ? page.bodySummary.slice(0, 45) + "…" : "—"}
          </Text>
        </div>
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
      <IndexTable.Cell>
        <Button size="slim" onClick={() => openEditModal(page)}>Edit Content</Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page>
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

      <BlockStack gap="400">
        {pages.length === 0 && (
          <Banner tone="info">
            <p>No pages found in your store. Create pages in Shopify Admin first.</p>
          </Banner>
        )}

        <Card padding="0">
          <div className="pages-table-wrap">
            <IndexTable
              resourceName={{ singular: "page", plural: "pages" }}
              itemCount={pages.length}
              selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Title" },
                { title: "Summary" },
                { title: "SEO Title" },
                { title: "SEO Description" },
                { title: "Generated" },
                { title: "Action" },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </div>
        </Card>
      </BlockStack>

      {/* Edit Modal */}
      <style>{`
        .Polaris-Modal-Dialog__Modal { max-width: 66rem !important; }
        .pages-table-wrap .pages-summary-cell {
          width: 180px;
          max-width: 180px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
      <Modal
        open={editModal}
        onClose={closeEditModal}
        title={editState.title ? `Edit: ${editState.title}` : "Edit Page Content"}
        primaryAction={{ content: isSaving ? "Updating…" : "Update Page", onAction: handleSave, loading: isSaving }}
        secondaryActions={[{ content: "Cancel", onAction: closeEditModal }]}
      >
        <Modal.Section>
          {generationError && (
            <Box paddingBlockEnd="400">
              <Banner tone="critical" onDismiss={() => setGenerationError(null)}>
                <p>{generationError}</p>
              </Banner>
            </Box>
          )}
          <Grid>
            {/* Left column — 40% — content editor */}
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 8, lg: 8, xl: 8 }}>
              <BlockStack gap="400">
                <Text variant="headingSm" as="h3">Page Content</Text>

                <TextField
                  label="Body Content (HTML)"
                  value={editState.body}
                  onChange={setField("body")}
                  multiline={10}
                  autoComplete="off"
                  helpText="HTML is supported. This will replace your current page body."
                />

                <Divider />

                <Text variant="headingSm" as="h3">SEO</Text>

                <TextField
                  label="SEO Meta Title"
                  value={editState.seoTitle}
                  onChange={setField("seoTitle")}
                  autoComplete="off"
                  maxLength={60}
                  showCharacterCount
                  helpText="Recommended: 50–60 characters"
                />

                <TextField
                  label="SEO Meta Description"
                  value={editState.seoDescription}
                  onChange={setField("seoDescription")}
                  multiline={3}
                  autoComplete="off"
                  maxLength={160}
                  showCharacterCount
                  helpText="Recommended: 120–160 characters"
                />
              </BlockStack>
            </Grid.Cell>

            {/* Right column — 60% — AI settings */}
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
              <BlockStack gap="400">
                <Text variant="headingSm" as="h3">AI Content Generation</Text>

                <Select
                  label="Page Type"
                  options={PAGE_TYPE_OPTIONS}
                  value={editState.pageType}
                  onChange={setField("pageType")}
                />

                <Select
                  label="Language"
                  options={LANGUAGE_OPTIONS}
                  value={editState.language}
                  onChange={setField("language")}
                />

                <Select
                  label="Tone"
                  options={TONE_OPTIONS}
                  value={editState.tone}
                  onChange={setField("tone")}
                />

                <Select
                  label="Length"
                  options={LENGTH_OPTIONS}
                  value={editState.length}
                  onChange={setField("length")}
                />

                <Select
                  label="Format"
                  options={FORMAT_OPTIONS}
                  value={editState.format}
                  onChange={setField("format")}
                />

                <BlockStack gap="200">
                  <TextField
                    label="Keywords / Context"
                    value={editState.contextKeywords}
                    onChange={setField("contextKeywords")}
                    multiline={2}
                    autoComplete="off"
                    placeholder="e.g. eco-friendly, handmade, UK"
                  />
                  <InlineStack gap="200" wrap>
                    {KEYWORD_CHIPS.map((kw) => (
                      <Button key={kw} size="micro" onClick={() => appendKeyword(kw)}>
                        + {kw}
                      </Button>
                    ))}
                  </InlineStack>
                </BlockStack>

                <Divider />

                <InlineStack gap="300" align="start">
                  <Button
                    variant="primary"
                    onClick={handleGenerate}
                    loading={isGenerating}
                    disabled={isGenerating}
                  >
                    Generate Content
                  </Button>
                  {isGenerating && <Spinner size="small" />}
                </InlineStack>
              </BlockStack>
            </Grid.Cell>
          </Grid>
        </Modal.Section>
      </Modal>

      <Box paddingBlockEnd="800" />
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
