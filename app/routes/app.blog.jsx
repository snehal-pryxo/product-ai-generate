import { useState, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { buildBlogContentPrompt } from "../lib/contentPromptTemplates";
import {
  readStoredBlogPromptTemplateSelection,
  BLOG_BODY_TEMPLATES,
  BLOG_META_DESCRIPTION_TEMPLATES,
  BLOG_META_TITLE_TEMPLATES,
} from "../lib/blogPromptTemplateLibrary";
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
} from "@shopify/polaris";

// ─── GraphQL ─────────────────────────────────────────────────────────────────

const BLOGS_QUERY = `#graphql
  query GetBlogs {
    blogs(first: 20) {
      edges {
        node {
          id
          title
          handle
        }
      }
    }
  }
`;

const ARTICLES_QUERY = `#graphql
  query GetArticles($first: Int!) {
    articles(first: $first) {
      edges {
        node {
          id
          title
          body
          handle
          publishedAt
          blog {
            id
            title
          }
          metafields(first: 2, namespace: "global") {
            edges {
              node {
                key
                value
              }
            }
          }
        }
      }
    }
  }
`;

const ARTICLE_UPDATE_MUTATION = `#graphql
  mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article {
        id
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ─── AI helpers ───────────────────────────────────────────────────────────────

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
      max_tokens: 2048,
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
      max_tokens: 2048,
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
  articleType,
  title,
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
    prompt: buildBlogContentPrompt({
      articleType,
      title,
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

async function upsertBlogArticleContent(data) {
  try {
    await db.blogArticleGeneratedContent.upsert({
      where: { shop_articleId: { shop: data.shop, articleId: data.articleId } },
      create: data,
      update: data,
    });
  } catch (error) {
    console.error("Failed to upsert blog article generated content", error);
  }
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const [blogsRes, articlesRes] = await Promise.all([
    admin.graphql(BLOGS_QUERY),
    admin.graphql(ARTICLES_QUERY, { variables: { first: 50 } }),
  ]);

  const [blogsJson, articlesJson] = await Promise.all([
    blogsRes.json(),
    articlesRes.json(),
  ]);

  const blogs = (blogsJson.data?.blogs?.edges || []).map((e) => e.node);

  const rawArticles = (articlesJson.data?.articles?.edges || []).map((e) => {
    const node = e.node;
    const mfs = (node.metafields?.edges || []).map((me) => me.node);
    return {
      ...node,
      excerpt: "",
      seo: {
        title: mfs.find((m) => m.key === "title_tag")?.value || "",
        description: mfs.find((m) => m.key === "description_tag")?.value || "",
      },
    };
  });

  // Fetch generate times from DB
  const articleIds = rawArticles.map((a) => a.id);
  const generatedContents = articleIds.length > 0
    ? await db.blogArticleGeneratedContent.findMany({
        where: { shop: session.shop, articleId: { in: articleIds } },
        select: { articleId: true, updatedAt: true },
      })
    : [];
  const generatedMap = Object.fromEntries(generatedContents.map((g) => [g.articleId, g.updatedAt]));
  const articles = rawArticles.map((a) => ({ ...a, generatedAt: generatedMap[a.id] || null }));

  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { openaiApiKey: true, anthropicApiKey: true, defaultAiProvider: true },
  });

  return {
    blogs,
    articles,
    hasOpenaiKey: !!shopData?.openaiApiKey,
    hasAnthropicKey: !!shopData?.anthropicApiKey,
    defaultAiProvider: shopData?.defaultAiProvider || "auto",
  };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "bulk_generate_blog") {
    let bulkArticles;
    try {
      bulkArticles = JSON.parse(formData.get("articles") || "[]");
    } catch {
      return { success: false, intent, error: "Invalid articles payload." };
    }
    if (!Array.isArray(bulkArticles) || bulkArticles.length === 0) {
      return { success: false, intent, error: "No articles selected." };
    }
    const language = formData.get("language") || "en";
    const tone = formData.get("tone") || "professional";
    const length = formData.get("length") || "medium (around 600 words)";
    const format = formData.get("format") || "headings and paragraphs";
    const articleType = formData.get("articleType") || "How-To Guide";
    const bodyPromptTemplate = formData.get("bodyPromptTemplate") || "";
    const metaTitlePromptTemplate = formData.get("metaTitlePromptTemplate") || "";
    const metaDescriptionPromptTemplate = formData.get("metaDescriptionPromptTemplate") || "";
    const aiProvider = formData.get("aiProvider") || "auto";
    const shopData = await db.shop.findUnique({
      where: { shop: session.shop },
      select: { openaiApiKey: true, anthropicApiKey: true },
    });

    const results = await Promise.allSettled(
      bulkArticles.map(async (a) => {
        const input = buildGenerationPrompt({
          articleType,
          title: a.title || "",
          body: a.body || "",
          language,
          tone,
          length,
          format,
          contextKeywords: "",
          bodyPromptTemplate,
          metaTitlePromptTemplate,
          metaDescriptionPromptTemplate,
        });
        const raw = await generateContent(input, {
          aiProvider,
          shopOpenaiKey: shopData?.openaiApiKey,
          shopAnthropicKey: shopData?.anthropicApiKey,
        });
        let parsed = { articleTitle: "", articleBody: "", seoTitle: "", seoDescription: "" };
        try {
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
        } catch { parsed.articleBody = raw; }

        const nextBody = parsed.articleBody || a.body || "";
        const nextSeoTitle = parsed.seoTitle || "";
        const nextSeoDescription = parsed.seoDescription || "";

        if (a.id) {
          const metafields = [];
          if (nextSeoTitle) metafields.push({ namespace: "global", key: "title_tag", value: nextSeoTitle, type: "single_line_text_field" });
          if (nextSeoDescription) metafields.push({ namespace: "global", key: "description_tag", value: nextSeoDescription, type: "single_line_text_field" });
          await admin.graphql(ARTICLE_UPDATE_MUTATION, {
            variables: { id: a.id, article: { body: nextBody, metafields } },
          });
          await upsertBlogArticleContent({
            shop: session.shop,
            articleId: a.id,
            blogId: a.blogId || null,
            articleTitle: a.title || null,
            articleType: articleType || null,
            language: language || null,
            tone: tone || null,
            lengthOption: length || null,
            formatOption: format || null,
            contextKeywords: null,
            aiModel: aiProvider || null,
            bodyHtml: nextBody || null,
            seoTitle: nextSeoTitle || null,
            seoDescription: nextSeoDescription || null,
            isPublished: false,
            appliedToShopify: true,
          });
        }
        return { id: a.id, title: a.title, seoTitle: nextSeoTitle, seoDescription: nextSeoDescription };
      }),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    const itemResults = results.map((r, i) => ({
      id: bulkArticles[i].id,
      title: bulkArticles[i].title,
      status: r.status === "fulfilled" ? "success" : "failed",
      error: r.status === "rejected" ? r.reason?.message : null,
      seoTitle: r.status === "fulfilled" ? r.value.seoTitle : null,
      seoDescription: r.status === "fulfilled" ? r.value.seoDescription : null,
    }));
    return { success: true, intent, succeeded, failed, total: bulkArticles.length, results: itemResults };
  }

  return { success: false, error: "Unknown action." };
};

// ─── Options ─────────────────────────────────────────────────────────────────

const ARTICLE_TYPE_OPTIONS = [
  { label: "How-To Guide", value: "How-To Guide" },
  { label: "Product Review", value: "Product Review" },
  { label: "Lifestyle / Inspiration", value: "Lifestyle / Inspiration" },
  { label: "News / Announcement", value: "News / Announcement" },
  { label: "Tutorial", value: "Tutorial" },
  { label: "FAQ / Advice", value: "FAQ / Advice" },
  { label: "Comparison / Roundup", value: "Comparison / Roundup" },
  { label: "Behind the Scenes", value: "Behind the Scenes" },
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
  { label: "Short (~300 words)", value: "short (around 300 words)" },
  { label: "Medium (~600 words)", value: "medium (around 600 words)" },
  { label: "Long (~1000 words)", value: "long (around 1000 words)" },
  { label: "Very Long (~1500 words)", value: "very long (around 1500 words)" },
];

const FORMAT_OPTIONS = [
  { label: "Headings + Paragraphs", value: "headings and paragraphs" },
  { label: "Paragraphs only", value: "paragraphs" },
  { label: "Bullet points", value: "bullet points" },
  { label: "Step-by-step list", value: "numbered steps" },
  { label: "HTML with proper tags", value: "HTML with proper tags" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function BlogPage() {
  const { blogs, articles, defaultAiProvider } = useLoaderData();
  const navigate = useNavigate();
  const bulkFetcher = useFetcher();
  const isBulkGenerating = bulkFetcher.state !== "idle";

  const shopify = useAppBridge();
  const [templateLib, setTemplateLib] = useState({ open: false, tab: "description", target: "articleBodyPromptTemplate" });

  // ── Bulk state ──────────────────────────────────────────────────────────────
  const [bulkContentTypes, setBulkContentTypes] = useState(["body", "meta_description", "meta_title"]);
  const [bulkSettings, setBulkSettings] = useState({
    language: "en",
    tone: "professional",
    length: "medium (around 600 words)",
    format: "headings and paragraphs",
    articleType: "How-To Guide",
    aiProvider: defaultAiProvider || "auto",
  });
  const [useCustomBodyInstructions, setUseCustomBodyInstructions] = useState(false);
  const [useCustomMetaDescInstructions, setUseCustomMetaDescInstructions] = useState(false);
  const [useCustomMetaTitleInstructions, setUseCustomMetaTitleInstructions] = useState(false);
  const [bulkBodyPromptTemplate, setBulkBodyPromptTemplate] = useState("");
  const [bulkMetaDescPromptTemplate, setBulkMetaDescPromptTemplate] = useState("");
  const [bulkMetaTitlePromptTemplate, setBulkMetaTitlePromptTemplate] = useState("");
  const [bulkValidationMessage, setBulkValidationMessage] = useState(null);
  const [bulkResult, setBulkResult] = useState(null);
  const [showAdvancedBulk, setShowAdvancedBulk] = useState(false);

  const blogTemplatesByTab = {
    description: BLOG_BODY_TEMPLATES,
    "seo-description": BLOG_META_DESCRIPTION_TEMPLATES,
    "seo-title": BLOG_META_TITLE_TEMPLATES,
  };
  const blogTemplateTabs = [
    { id: "description", label: "Body" },
    { id: "seo-description", label: "Meta Description" },
    { id: "seo-title", label: "Meta Title" },
  ];
  function openBlogTemplateLib(tab, target) {
    setTemplateLib({ open: true, tab, target });
  }
  function handleBlogUseTemplate(templateText) {
    const target = templateLib.target;
    if (target === "bulk_body") {
      setBulkBodyPromptTemplate(templateText);
      setUseCustomBodyInstructions(true);
    } else if (target === "bulk_meta_desc") {
      setBulkMetaDescPromptTemplate(templateText);
      setUseCustomMetaDescInstructions(true);
    } else if (target === "bulk_meta_title") {
      setBulkMetaTitlePromptTemplate(templateText);
      setUseCustomMetaTitleInstructions(true);
    }
    setTemplateLib((s) => ({ ...s, open: false }));
  }

  const [filterBlogId, setFilterBlogId] = useState("all");

  const btnStyle = { padding: "5px 12px", borderRadius: "6px", border: "1px solid #1a1a1a", background: "#1a1a1a", color: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap" };
  const resetBtnStyle = { padding: "4px 10px", borderRadius: "5px", border: "1px solid #d1d5db", background: "#f9fafb", color: "#374151", cursor: "pointer", fontSize: "12px", fontWeight: 500 };

  const blogFilterOptions = [
    { label: "All Blogs", value: "all" },
    ...blogs.map((b) => ({ label: b.title, value: b.id })),
  ];

  const filteredArticles =
    filterBlogId === "all"
      ? articles
      : articles.filter((a) => a.blog?.id === filterBlogId);

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(filteredArticles);

  const selectedArticles = filteredArticles.filter((a) => selectedResources.includes(a.id));

  function handleBulkGenerate() {
    if (selectedArticles.length === 0) {
      setBulkValidationMessage("Select at least one article.");
      return;
    }
    if (selectedArticles.length > 50) {
      setBulkValidationMessage("You can bulk generate up to 50 articles at a time.");
      return;
    }
    setBulkValidationMessage(null);
    setBulkResult(null);
    const payload = new FormData();
    payload.append("intent", "bulk_generate_blog");
    payload.append("articles", JSON.stringify(
      selectedArticles.map((a) => ({
        id: a.id,
        blogId: a.blog?.id || "",
        title: a.title || "",
        body: a.body || "",
      }))
    ));
    payload.append("language", bulkSettings.language);
    payload.append("tone", bulkSettings.tone);
    payload.append("length", bulkSettings.length);
    payload.append("format", bulkSettings.format);
    payload.append("articleType", bulkSettings.articleType);
    payload.append("aiProvider", bulkSettings.aiProvider);
    payload.append("bodyPromptTemplate", bulkBodyPromptTemplate);
    payload.append("metaTitlePromptTemplate", bulkMetaTitlePromptTemplate);
    payload.append("metaDescriptionPromptTemplate", bulkMetaDescPromptTemplate);
    bulkFetcher.submit(payload, { method: "post" });
  }

  useEffect(() => {
    const data = bulkFetcher.data;
    if (!data || bulkFetcher.state !== "idle") return;
    if (data.success) {
      setBulkResult(data);
      shopify.toast.show(`Generated ${data.succeeded}/${data.total} articles successfully.`);
    } else {
      setBulkValidationMessage(data.error || "Bulk generation failed.");
    }
  }, [bulkFetcher.data, bulkFetcher.state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const templateSelection = readStoredBlogPromptTemplateSelection();
    if (templateSelection.bodyPromptTemplate) setBulkBodyPromptTemplate(templateSelection.bodyPromptTemplate);
    if (templateSelection.metaTitlePromptTemplate) setBulkMetaTitlePromptTemplate(templateSelection.metaTitlePromptTemplate);
    if (templateSelection.metaDescriptionPromptTemplate) setBulkMetaDescPromptTemplate(templateSelection.metaDescriptionPromptTemplate);
  }, []);

  const rowMarkup = filteredArticles.map((article, index) => (
    <IndexTable.Row
      id={article.id}
      key={article.id}
      selected={selectedResources.includes(article.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">{article.title}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {article.publishedAt
          ? <Badge tone="success">Published</Badge>
          : <Badge tone="attention">Draft</Badge>}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page fullWidth>
      {/* ── Hero Header ── */}
      <div style={{
        background: "linear-gradient(135deg, #1a001a 0%, #4a0e4e 50%, #1e0a3c 100%)",
        borderRadius: "6px",
        padding: "28px 32px",
        marginBottom: "24px",
        position: "relative",
      }}>
        <div style={{ position: "absolute", top: "-50px", right: "-50px", width: "220px", height: "220px", borderRadius: "50%", background: "radial-gradient(circle, rgba(236,72,153,0.28) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "-40px", left: "25%", width: "160px", height: "160px", borderRadius: "50%", background: "radial-gradient(circle, rgba(168,85,247,0.2) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 1, flexWrap: "wrap", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ width: "54px", height: "54px", borderRadius: "6px", background: "rgba(236,72,153,0.2)", border: "1px solid rgba(236,72,153,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", flexShrink: 0 }}>
              ✍️
            </div>
            <div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#ffffff", marginBottom: "3px", letterSpacing: "-0.3px" }}>Blog Posts</div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.55)", lineHeight: 1.4 }}>Generate and manage AI content for your Shopify blog articles</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => navigate("/app")}
              style={{ padding: "7px 16px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
            >← Dashboard</button>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>

        {/* ── LEFT: Article List ── */}
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          {articles.length === 0 && (
            <Banner tone="info">
              <p>
                No blog articles found. Create a blog in Shopify Admin first to get started.
              </p>
            </Banner>
          )}

          {blogs.length > 0 && (
            <div style={{ marginBottom: "12px" }}>
              <InlineStack gap="300" blockAlign="center">
                <Text variant="bodySm" as="span">Filter:</Text>
                <div style={{ minWidth: "220px" }}>
                  <Select
                    label="Filter by blog"
                    labelHidden
                    options={blogFilterOptions}
                    value={filterBlogId}
                    onChange={setFilterBlogId}
                  />
                </div>
              </InlineStack>
            </div>
          )}

          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "article", plural: "articles" }}
              itemCount={filteredArticles.length}
              selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Title" },
                { title: "Status" },
              ]}
            >
              {rowMarkup}
            </IndexTable>
            <div style={{ padding: "8px 16px", borderTop: "1px solid var(--p-color-border)" }}>
              <Text as="span" tone="subdued" variant="bodySm">
                {filteredArticles.length} article{filteredArticles.length !== 1 ? "s" : ""}
              </Text>
            </div>
          </Card>
        </div>

        {/* ── RIGHT: Bulk Settings Panel ── */}
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          <Card padding="0">
            {/* Header */}
            <div style={{ padding: "16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd" fontWeight="bold">Blog Bulk Settings</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {selectedArticles.length > 0
                    ? `Body, Meta Descriptions, Meta Titles will be generated for ${selectedArticles.length} article${selectedArticles.length !== 1 ? "s" : ""}`
                    : "Select articles from the list to bulk generate content"}
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
            {bulkContentTypes.includes("body") && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingSm" fontWeight="semibold">Body</Text>
                  {useCustomBodyInstructions && (
                    <button onClick={() => openBlogTemplateLib("description", "bulk_body")} style={btnStyle}>Browse Templates</button>
                  )}
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
                        value={bulkBodyPromptTemplate}
                        onChange={setBulkBodyPromptTemplate}
                        multiline={3} autoComplete="off"
                        placeholder="Enter custom instructions for body generation..."
                      />
                      {bulkBodyPromptTemplate && (
                        <div style={{ marginTop: "4px" }}>
                          <button onClick={() => setBulkBodyPromptTemplate("")} style={resetBtnStyle}>↺ Reset to Default</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Meta Description Template Section */}
            {bulkContentTypes.includes("meta_description") && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingSm" fontWeight="semibold">Meta Description</Text>
                  {useCustomMetaDescInstructions && (
                    <button onClick={() => openBlogTemplateLib("seo-description", "bulk_meta_desc")} style={btnStyle}>Browse Templates</button>
                  )}
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
                        value={bulkMetaDescPromptTemplate}
                        onChange={setBulkMetaDescPromptTemplate}
                        multiline={3} autoComplete="off"
                        placeholder="Enter custom instructions for meta description generation..."
                      />
                      {bulkMetaDescPromptTemplate && (
                        <div style={{ marginTop: "4px" }}>
                          <button onClick={() => setBulkMetaDescPromptTemplate("")} style={resetBtnStyle}>↺ Reset to Default</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Meta Title Template Section */}
            {bulkContentTypes.includes("meta_title") && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingSm" fontWeight="semibold">Meta Title</Text>
                  {useCustomMetaTitleInstructions && (
                    <button onClick={() => openBlogTemplateLib("seo-title", "bulk_meta_title")} style={btnStyle}>Browse Templates</button>
                  )}
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
                        value={bulkMetaTitlePromptTemplate}
                        onChange={setBulkMetaTitlePromptTemplate}
                        multiline={3} autoComplete="off"
                        placeholder="Enter custom instructions for meta title generation..."
                      />
                      {bulkMetaTitlePromptTemplate && (
                        <div style={{ marginTop: "4px" }}>
                          <button onClick={() => setBulkMetaTitlePromptTemplate("")} style={resetBtnStyle}>↺ Reset to Default</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Advanced Settings Toggle */}
            <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <button
                onClick={() => setShowAdvancedBulk((v) => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "13px", color: "#374151", display: "flex", alignItems: "center", gap: "6px", padding: "0", fontWeight: 500 }}
              >
                <span>{showAdvancedBulk ? "▲" : "▼"}</span>
                {showAdvancedBulk ? "Hide" : "Show"} Advanced Settings
              </button>
            </div>

            {showAdvancedBulk && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <BlockStack gap="300">
                  <Select
                    label="Article Type"
                    options={ARTICLE_TYPE_OPTIONS}
                    value={bulkSettings.articleType}
                    onChange={(v) => setBulkSettings((s) => ({ ...s, articleType: v }))}
                  />
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

            {/* Validation / Result */}
            {bulkValidationMessage && (
              <div style={{ padding: "8px 16px" }}>
                <Banner tone="warning"><p>{bulkValidationMessage}</p></Banner>
              </div>
            )}
            {bulkResult && (
              <div style={{ padding: "8px 16px" }}>
                <Banner tone={bulkResult.failed === 0 ? "success" : "warning"}>
                  <p>Generated {bulkResult.succeeded}/{bulkResult.total} articles{bulkResult.failed > 0 ? ` (${bulkResult.failed} failed)` : ""}.</p>
                </Banner>
              </div>
            )}

            {/* Generate Button */}
            <div style={{ padding: "12px 16px" }}>
              <Button
                variant="primary"
                fullWidth
                onClick={handleBulkGenerate}
                disabled={isBulkGenerating || selectedArticles.length === 0}
                loading={isBulkGenerating}
                tone="success"
              >
                {`Generate ${selectedArticles.length} item${selectedArticles.length !== 1 ? "s" : ""} (${selectedArticles.length} article${selectedArticles.length !== 1 ? "s" : ""} × ${bulkContentTypes.length} type${bulkContentTypes.length !== 1 ? "s" : ""})`}
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
                  {bulkResult.succeeded} article{bulkResult.succeeded !== 1 ? "s" : ""} updated · {bulkResult.failed > 0 ? `${bulkResult.failed} failed · ` : ""}{bulkResult.total} AI credits used
                </Text>
              </BlockStack>
            </div>
            <IndexTable
              resourceName={{ singular: "article", plural: "articles" }}
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
          </Card>
        </div>
      )}

      {/* Template Library Popup */}
      <TemplateLibraryModal
        key={templateLib.tab}
        open={templateLib.open}
        onClose={() => setTemplateLib((s) => ({ ...s, open: false }))}
        tabs={blogTemplateTabs}
        initialTab={templateLib.tab}
        templatesByTab={blogTemplatesByTab}
        onUseTemplate={handleBlogUseTemplate}
      />
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
