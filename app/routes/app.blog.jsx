import { useState, useEffect, useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
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

const ARTICLE_CREATE_MUTATION = `#graphql
  mutation ArticleCreate($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
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

const STAGED_UPLOADS_CREATE = `#graphql
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const FILE_CREATE = `#graphql
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        ... on MediaImage {
          id
          image {
            url
          }
        }
        ... on GenericFile {
          id
          url
        }
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

function buildGenerationPrompt({ articleType, title, body, language, tone, length, format, contextKeywords }) {
  const langStr = language && language !== "en" ? `Language: ${language}.` : "Language: English.";
  const toneStr = tone ? `Tone: ${tone}.` : "";
  const lengthStr = length ? `Length: ${length}.` : "";
  const formatStr = format ? `Format: ${format}.` : "";
  const kwStr = contextKeywords ? `Keywords to include: ${contextKeywords}.` : "";
  const titleStr = title ? `Article title / topic: "${title}".` : "";
  const bodySnippet = body ? `\nExisting content:\n${body.slice(0, 400)}` : "";

  const prompt = `You are an expert e-commerce blog writer for Shopify stores. Generate a blog article of type "${articleType}".
${titleStr}
${langStr} ${toneStr} ${lengthStr} ${formatStr} ${kwStr}
${bodySnippet}

Return ONLY a JSON object with these keys (no markdown, no extra text):
{
  "articleTitle": "<engaging blog post title>",
  "articleBody": "<full HTML blog post content with proper headings and paragraphs>",
  "excerpt": "<compelling 1-2 sentence summary for blog listings>",
  "seoTitle": "<SEO meta title, max 60 chars>",
  "seoDescription": "<SEO meta description, max 160 chars>"
}`;

  return { prompt };
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

  const articles = (articlesJson.data?.articles?.edges || []).map((e) => {
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

  if (intent === "generate_article_content") {
    const articleType = formData.get("articleType") || "How-To Guide";
    const title = formData.get("title") || "";
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
      const input = buildGenerationPrompt({ articleType, title, body, language, tone, length, format, contextKeywords });
      const raw = await generateContent(input, {
        aiProvider,
        shopOpenaiKey: shopData?.openaiApiKey,
        shopAnthropicKey: shopData?.anthropicApiKey,
      });

      let parsed = { articleTitle: "", articleBody: "", excerpt: "", seoTitle: "", seoDescription: "" };
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch {
        parsed.articleBody = raw;
      }

      return { success: true, intent, ...parsed };
    } catch (err) {
      return { success: false, intent, error: err.message };
    }
  }

  if (intent === "create_article") {
    const blogId = formData.get("blogId");
    const authorName = formData.get("authorName") || "Admin";
    const title = formData.get("title") || "";
    const body = formData.get("body") || "";
    const seoTitle = formData.get("seoTitle") || "";
    const seoDescription = formData.get("seoDescription") || "";
    const isPublished = formData.get("isPublished") === "true";

    try {
      const metafields = [];
      if (seoTitle) metafields.push({ namespace: "global", key: "title_tag", value: seoTitle, type: "single_line_text_field" });
      if (seoDescription) metafields.push({ namespace: "global", key: "description_tag", value: seoDescription, type: "single_line_text_field" });

      const response = await admin.graphql(ARTICLE_CREATE_MUTATION, {
        variables: {
          article: { blogId, author: { name: authorName }, title, body, isPublished, metafields },
        },
      });
      const json = await response.json();
      const userErrors = json.data?.articleCreate?.userErrors || [];
      if (userErrors.length > 0) {
        return { success: false, intent, error: userErrors.map((e) => e.message).join(", ") };
      }
      return { success: true, intent, message: "Article created successfully!" };
    } catch (err) {
      return { success: false, intent, error: err.message };
    }
  }

  if (intent === "update_article") {
    const articleId = formData.get("articleId");
    const title = formData.get("title") || "";
    const body = formData.get("body") || "";
    const seoTitle = formData.get("seoTitle") || "";
    const seoDescription = formData.get("seoDescription") || "";
    const isPublished = formData.get("isPublished") === "true";

    try {
      const response = await admin.graphql(ARTICLE_UPDATE_MUTATION, {
        variables: {
          id: articleId,
          article: {
            title,
            body,
            isPublished,
            metafields: [
              { namespace: "global", key: "title_tag", value: seoTitle, type: "single_line_text_field" },
              { namespace: "global", key: "description_tag", value: seoDescription, type: "single_line_text_field" },
            ],
          },
        },
      });
      const json = await response.json();
      const userErrors = json.data?.articleUpdate?.userErrors || [];
      if (userErrors.length > 0) {
        return { success: false, intent, error: userErrors.map((e) => e.message).join(", ") };
      }
      return { success: true, intent, message: "Article updated successfully!" };
    } catch (err) {
      return { success: false, intent, error: err.message };
    }
  }

  if (intent === "upload_blog_image") {
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return { success: false, intent, error: "No file received." };
    }
    const filename = file.name;
    const mimeType = file.type || "image/jpeg";
    const fileSize = file.size;

    try {
      // 1. Create staged upload target
      const stagedRes = await admin.graphql(STAGED_UPLOADS_CREATE, {
        variables: {
          input: [{
            resource: "IMAGE",
            filename,
            mimeType,
            fileSize: String(fileSize),
            httpMethod: "POST",
          }],
        },
      });
      const stagedJson = await stagedRes.json();
      const userErrors = stagedJson.data?.stagedUploadsCreate?.userErrors || [];
      if (userErrors.length > 0) {
        return { success: false, intent, error: userErrors.map((e) => e.message).join(", ") };
      }
      const target = stagedJson.data?.stagedUploadsCreate?.stagedTargets?.[0];
      if (!target) return { success: false, intent, error: "Failed to create staged upload." };

      // 2. Upload file to staged URL (multipart)
      const uploadForm = new FormData();
      for (const param of target.parameters) {
        uploadForm.append(param.name, param.value);
      }
      uploadForm.append("file", file);
      const uploadRes = await fetch(target.url, { method: "POST", body: uploadForm });
      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        return { success: false, intent, error: `Staging upload failed: ${errText.slice(0, 200)}` };
      }

      // 3. Create file in Shopify Files
      const fileRes = await admin.graphql(FILE_CREATE, {
        variables: {
          files: [{ alt: filename, contentType: "IMAGE", originalSource: target.resourceUrl }],
        },
      });
      const fileJson = await fileRes.json();
      const fileErrors = fileJson.data?.fileCreate?.userErrors || [];
      if (fileErrors.length > 0) {
        return { success: false, intent, error: fileErrors.map((e) => e.message).join(", ") };
      }
      const created = fileJson.data?.fileCreate?.files?.[0];
      const imageUrl = created?.image?.url || created?.url || target.resourceUrl;

      return { success: true, intent, imageUrl, filename };
    } catch (err) {
      return { success: false, intent, error: err.message };
    }
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

const PUBLISH_OPTIONS = [
  { label: "Save as Draft", value: "false" },
  { label: "Publish Immediately", value: "true" },
];

const KEYWORD_CHIPS = ["Brand Name", "Products", "Sale", "Location", "Free Shipping", "Discount", "New Arrival"];

// ─── Edit initial state ───────────────────────────────────────────────────────

const editInitialState = {
  articleId: "",
  blogId: "",
  authorName: "",
  title: "",
  body: "",
  seoTitle: "",
  seoDescription: "",
  isPublished: "false",
  aiProvider: "auto",
  articleType: "How-To Guide",
  language: "en",
  tone: "professional",
  length: "medium (around 600 words)",
  format: "headings and paragraphs",
  contextKeywords: "",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function BlogPage() {
  const { blogs, articles, defaultAiProvider } = useLoaderData();
  const navigate = useNavigate();
  const generateFetcher = useFetcher();
  const saveFetcher = useFetcher();
  const isGenerating = generateFetcher.state !== "idle";
  const isSaving = saveFetcher.state !== "idle";

  const shopify = useAppBridge();
  const [editModal, setEditModal] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [editState, setEditState] = useState(editInitialState);
  const [generationError, setGenerationError] = useState(null);
  const [filterBlogId, setFilterBlogId] = useState("all");
  const [uploadedImages, setUploadedImages] = useState([]);
  const imageFetcher = useFetcher();
  const fileInputRef = useRef(null);
  const isUploading = imageFetcher.state !== "idle";

  const blogFilterOptions = [
    { label: "All Blogs", value: "all" },
    ...blogs.map((b) => ({ label: b.title, value: b.id })),
  ];

  const blogSelectOptions = blogs.map((b) => ({ label: b.title, value: b.id }));

  const filteredArticles =
    filterBlogId === "all"
      ? articles
      : articles.filter((a) => a.blog?.id === filterBlogId);

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(filteredArticles);

  function openCreateModal() {
    setEditState({
      ...editInitialState,
      aiProvider: defaultAiProvider,
      blogId: blogs[0]?.id || "",
    });
    setIsCreateMode(true);
    setGenerationError(null);
    setUploadedImages([]);
    setEditModal(true);
  }

  function openEditModal(article) {
    setEditState({
      ...editInitialState,
      aiProvider: defaultAiProvider,
      articleId: article.id,
      blogId: article.blog?.id || "",
      title: article.title || "",
      body: article.body || "",
      seoTitle: article.seo?.title || "",
      seoDescription: article.seo?.description || "",
      isPublished: article.publishedAt ? "true" : "false",
    });
    setIsCreateMode(false);
    setGenerationError(null);
    setUploadedImages([]);
    setEditModal(true);
  }

  function closeModal() {
    setEditModal(false);
    setGenerationError(null);
  }

  function setField(field) {
    return (value) => setEditState((s) => ({ ...s, [field]: value }));
  }

  function handleImageFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("intent", "upload_blog_image");
    fd.append("file", file);
    imageFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
    e.target.value = "";
  }

  function insertImageToBody(url, alt) {
    const imgTag = `\n<img src="${url}" alt="${alt || ""}" style="max-width:100%;height:auto;" />\n`;
    setEditState((s) => ({ ...s, body: s.body + imgTag }));
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
    fd.append("intent", "generate_article_content");
    fd.append("articleType", editState.articleType);
    fd.append("title", editState.title);
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
    fd.append("intent", isCreateMode ? "create_article" : "update_article");
    if (!isCreateMode) fd.append("articleId", editState.articleId);
    fd.append("blogId", editState.blogId);
    if (isCreateMode) fd.append("authorName", editState.authorName || "Admin");
    fd.append("title", editState.title);
    fd.append("body", editState.body);
    fd.append("seoTitle", editState.seoTitle);
    fd.append("seoDescription", editState.seoDescription);
    fd.append("isPublished", editState.isPublished);
    saveFetcher.submit(fd, { method: "post" });
  }

  useEffect(() => {
    const data = generateFetcher.data;
    if (!data) return;
    if (data.success) {
      setEditState((s) => ({
        ...s,
        title: data.articleTitle || s.title,
        body: data.articleBody || s.body,
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
      const msg = data.intent === "create_article" ? "Article created successfully!" : "Article updated successfully!";
      shopify.toast.show(msg);
      closeModal();
    } else {
      setGenerationError(data.error || "Save failed.");
    }
  }, [saveFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const data = imageFetcher.data;
    if (!data || data.intent !== "upload_blog_image") return;
    if (data.success) {
      setUploadedImages((prev) => [...prev, { url: data.imageUrl, name: data.filename }]);
    } else {
      setGenerationError(data.error || "Image upload failed.");
    }
  }, [imageFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <Text variant="bodySm" as="span">{article.blog?.title || "—"}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {article.publishedAt
          ? <Badge tone="success">Published</Badge>
          : <Badge tone="attention">Draft</Badge>}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {article.seo?.title
          ? <Badge tone="success">Set</Badge>
          : <Badge tone="attention">Missing</Badge>}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button size="slim" onClick={() => openEditModal(article)}>Edit Content</Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page>
      {/* ── Hero Header ── */}
      <div style={{
        background: "linear-gradient(135deg, #1a001a 0%, #4a0e4e 50%, #1e0a3c 100%)",
        borderRadius: "6px",
        padding: "28px 32px",
        marginBottom: "24px",
        position: "relative",
        overflow: "hidden",
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
            {blogs.length > 0 && (
              <button
                onClick={openCreateModal}
                style={{ padding: "7px 16px", borderRadius: "6px", border: "none", background: "linear-gradient(135deg, #ec4899, #a855f7)", color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
              >+ New Article</button>
            )}
          </div>
        </div>
      </div>

      <BlockStack gap="400">
        {articles.length === 0 && (
          <Banner tone="info">
            <p>
              No blog articles found. Create a blog in Shopify Admin first, then click{" "}
              <strong>New Article</strong> to get started.
            </p>
          </Banner>
        )}

        {blogs.length > 0 && (
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
        )}

        <Card padding="0">
          <IndexTable
            resourceName={{ singular: "article", plural: "articles" }}
            itemCount={filteredArticles.length}
            selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
            onSelectionChange={handleSelectionChange}
            headings={[
              { title: "Title" },
              { title: "Blog" },
              { title: "Status" },
              { title: "SEO" },
              { title: "Action" },
            ]}
          >
            {rowMarkup}
          </IndexTable>
        </Card>
      </BlockStack>

      {/* Edit / Create Modal */}
      <style>{".Polaris-Modal-Dialog__Modal { max-width: 66rem !important; }"}</style>
      <Modal
        open={editModal}
        onClose={closeModal}
        title={isCreateMode ? "Create New Blog Article" : `Edit: ${editState.title || "Article"}`}
        primaryAction={{
          content: isCreateMode ? (isSaving ? "Creating…" : "Create Article") : (isSaving ? "Updating…" : "Update Article"),
          onAction: handleSave,
          loading: isSaving,
        }}
        secondaryActions={[{ content: "Cancel", onAction: closeModal }]}
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
            {/* Left 40% — content editor */}
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 8, lg: 8, xl: 8 }}>
              <BlockStack gap="400">
                {isCreateMode && blogSelectOptions.length > 0 && (
                  <Select
                    label="Post to Blog"
                    options={blogSelectOptions}
                    value={editState.blogId}
                    onChange={setField("blogId")}
                  />
                )}

                {isCreateMode && (
                  <TextField
                    label="Author Name"
                    value={editState.authorName}
                    onChange={setField("authorName")}
                    autoComplete="off"
                    placeholder="e.g. John Smith"
                    helpText="Required by Shopify for new articles."
                  />
                )}

                <TextField
                  label="Article Title"
                  value={editState.title}
                  onChange={setField("title")}
                  autoComplete="off"
                  placeholder="Enter article title…"
                />

                <TextField
                  label="Article Body (HTML)"
                  value={editState.body}
                  onChange={setField("body")}
                  multiline={10}
                  autoComplete="off"
                  helpText="HTML is supported. This is the full article content."
                />

                {/* ── Blog Images ── */}
                <BlockStack gap="300">
                  <Text variant="headingSm" as="h3">Blog Images</Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Upload images to your Shopify Files, then click <strong>Insert</strong> to add them to the article body.
                  </Text>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleImageFileChange}
                  />
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    loading={isUploading}
                    disabled={isUploading}
                  >
                    {isUploading ? "Uploading…" : "Upload Image"}
                  </Button>

                  {uploadedImages.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {uploadedImages.map((img, i) => (
                        <div
                          key={i}
                          style={{
                            position: "relative",
                            border: "1px solid #ddd",
                            borderRadius: "6px",
                            overflow: "hidden",
                            width: "90px",
                          }}
                        >
                          <img
                            src={img.url}
                            alt={img.name}
                            style={{ width: "90px", height: "90px", objectFit: "cover", display: "block" }}
                          />
                          <div style={{ padding: "4px", background: "#f6f6f7" }}>
                            <button
                              onClick={() => insertImageToBody(img.url, img.name)}
                              style={{
                                width: "100%",
                                background: "linear-gradient(135deg, #ec4899, #a855f7)",
                                color: "#fff",
                                border: "none",
                                borderRadius: "4px",
                                cursor: "pointer",
                                fontSize: "11px",
                                fontWeight: 600,
                                padding: "3px 0",
                              }}
                            >
                              Insert
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </BlockStack>

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

                <Select
                  label="Publish Status"
                  options={PUBLISH_OPTIONS}
                  value={editState.isPublished}
                  onChange={setField("isPublished")}
                />
              </BlockStack>
            </Grid.Cell>

            {/* Right 60% — AI settings */}
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
              <BlockStack gap="400">
                <Text variant="headingSm" as="h3">AI Content Generation</Text>


                <Select
                  label="Article Type"
                  options={ARTICLE_TYPE_OPTIONS}
                  value={editState.articleType}
                  onChange={setField("articleType")}
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
                    placeholder="e.g. summer sale, eco-friendly, UK delivery"
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

                <Button
                  variant="primary"
                  onClick={handleGenerate}
                  loading={isGenerating}
                  disabled={isGenerating}
                >
                  Generate Content
                </Button>
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
