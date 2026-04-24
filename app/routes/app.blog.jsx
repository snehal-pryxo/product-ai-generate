import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  IndexTable,
  InlineStack,
  Modal,
  Page,
  Select,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import { AppPageHeader } from "../components/AppPageHeader";
import { RichTextEditor } from "../components/RichTextEditor";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getDefaultGlobalSettings } from "../lib/globalSettings";
import {
  buildInsufficientCreditsError,
  deductCredits,
  getOrCreateShopCredits,
} from "../lib/credits.server";

const BLOG_BODY_CREDIT_COST = 1;

const BLOGS_QUERY = `#graphql
  query BlogList($first: Int!, $after: String) {
    blogs(first: $first, after: $after, sortKey: TITLE) {
      edges {
        node {
          id
          title
          handle
          updatedAt
          commentPolicy
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const ARTICLES_QUERY = `#graphql
  query ArticleList($first: Int!, $after: String) {
    articles(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          title
          body
          handle
          updatedAt
          publishedAt
          blog {
            id
            title
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

const ARTICLE_CREATE_MUTATION = `#graphql
  mutation ArticleCreate($blogId: ID!, $article: ArticleCreateInput!) {
    articleCreate(blogId: $blogId, article: $article) {
      article {
        id
        title
        body
        handle
        updatedAt
        publishedAt
        blog {
          id
          title
        }
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
        body
        handle
        updatedAt
        publishedAt
        blog {
          id
          title
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const POST_TONE_OPTIONS = [
  "Funny",
  "Friendly",
  "Professional",
  "Casual",
  "Bold",
  "Witty",
  "Inspirational",
  "Urgent",
  "Romantic",
  "Playful",
  "Luxury",
  "Empathetic",
  "Edgy",
  "Minimalist",
  "Confident",
];

const POST_LENGTH_OPTIONS = [
  { label: "Long (800-1200 words)", value: "long" },
  { label: "Medium (600-800 words)", value: "medium" },
  { label: "Short (500-600 words)", value: "short" },
];

const TARGET_AUDIENCE_OPTIONS = ["Everyone", "Women", "Men", "Kids", "Teens"];

const PROMOTION_OPTIONS = [
  "Buy One Get One Free (BOGO)",
  "Free Shipping",
  "Percentage Discount - i.e. 20% off",
  "Dollar Discount - i.e. $10 off",
  "Flash Sale - i.e. 30% off",
  "Clearance Sale - i.e. 50% off",
  "Bundle Discount - i.e. 3+1",
  "Quantity Discount - i.e. buy 3 get 20% off",
  "Limited-Time Offer- i.e. 25% off",
  "Seasonal Sale - i.e. 25% off",
  "Holiday Sale - i.e. 35% off",
  "Gift with Purchase",
  "Mystery Discount",
  "Free Trial",
  "VIP-Only Offer - i.e. 40% off",
  "No promotion",
];

const HOLIDAY_OPTIONS = [
  "Choose a holiday to promote",
  "New Year",
  "Valentine's Day",
  "Women's Day",
  "Easter",
  "Mother's Day",
  "Father's Day",
  "Back to School",
  "Halloween",
  "Black Friday",
  "Cyber Monday",
  "Christmas",
  "Diwali",
  "Ramadan",
];

const TAB_KEYS = {
  BUSINESS: "business",
  HOLIDAY: "holiday",
  PROMOTION: "promotion",
  CUSTOM: "custom",
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "-";
  }
}

function getWordTarget(lengthOption) {
  if (lengthOption === "long") return "800-1200";
  if (lengthOption === "short") return "500-600";
  return "600-800";
}

function buildBlogHtml({ title, topic, tone, audience, promotion, holiday, tabType, language }) {
  const primaryTopic = cleanText(topic) || cleanText(title);
  const contextLine = [
    promotion && promotion !== "No promotion" ? `Promotion: ${promotion}.` : "",
    holiday && holiday !== "Choose a holiday to promote" ? `Holiday context: ${holiday}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return [
    `<h1>${title}</h1>`,
    `<p>This ${tone.toLowerCase()} blog post is tailored for ${audience.toLowerCase()} in ${language} and focuses on ${primaryTopic.toLowerCase()}.</p>`,
    `<h2>Why ${primaryTopic} matters now</h2>`,
    `<p>${primaryTopic} helps merchants improve discoverability, conversion intent, and customer trust when the message is specific and actionable.</p>`,
    tabType === TAB_KEYS.HOLIDAY ? "<h2>Holiday activation strategy</h2>" : "<h2>Execution strategy</h2>",
    "<p>Start with a clear value proposition, support it with practical examples, and close with a direct call to action your audience can act on today.</p>",
    "<h3>Quick checklist</h3>",
    "<ul><li>Define one measurable goal</li><li>Align copy with real buyer intent</li><li>Use clear, benefit-led structure</li></ul>",
    contextLine ? `<p>${contextLine}</p>` : "",
  ]
    .filter(Boolean)
    .join("");
}

function createSuggestionSet({ tabType, topic, tone, postLength, targetAudience, promotion, holiday, language }) {
  const baseTopic = cleanText(topic) || "Shopify growth";
  const words = getWordTarget(postLength);
  const labels = [
    "Beginner Guide",
    "Practical Playbook",
    "Expert Breakdown",
    "Conversion Blueprint",
    "Action Plan",
    "Seasonal Strategy",
  ];

  return labels.map((suffix, index) => {
    const title = `${baseTopic} ${suffix}`;
    const summary = `${tone} ${words} words blog for ${targetAudience.toLowerCase()} about ${baseTopic.toLowerCase()}${
      promotion && promotion !== "No promotion" ? ` with ${promotion.toLowerCase()}` : ""
    }${holiday && holiday !== "Choose a holiday to promote" ? ` for ${holiday}` : ""}.`;

    return {
      id: `${Date.now()}-${index}`,
      tabType,
      title,
      summary,
      body: buildBlogHtml({
        title,
        topic: baseTopic,
        tone,
        audience: targetAudience,
        promotion,
        holiday,
        tabType,
        language,
      }),
      tone,
      postLength,
      targetAudience,
      promotion,
      holiday,
      topic: baseTopic,
      status: "draft",
    };
  });
}

function normalizeArticle(node) {
  return {
    id: node.id,
    title: cleanText(node.title) || "Untitled",
    body: node.body || "",
    handle: cleanText(node.handle) || "-",
    updatedAt: node.updatedAt || null,
    publishedAt: node.publishedAt || null,
    blogId: node.blog?.id || "",
  };
}

function getSummaryFromBody(body) {
  const plain = stripHtml(body || "");
  if (!plain) return "-";
  if (plain.length <= 180) return plain;
  return `${plain.slice(0, 180).trim()}...`;
}

function statusBadge(publishedAt) {
  return publishedAt ? <Badge tone="success">Published</Badge> : <Badge tone="attention">Draft</Badge>;
}

async function upsertBlogGeneratedRecord({
  shop,
  blogId,
  articleId,
  title,
  summary,
  bodyHtml,
  status,
  language,
  tone,
  lengthOption,
  targetAudience,
  tabType,
  topic,
  promotion,
  holiday,
  productUrl,
}) {
  await db.$executeRaw`
    INSERT INTO blog_generated_contents
      (shop, blogId, articleId, title, summary, bodyHtml, status, language, tone, lengthOption, targetAudience, tabType, topic, promotion, holiday, productUrl)
    VALUES
      (${shop}, ${blogId}, ${articleId}, ${title}, ${summary}, ${bodyHtml}, ${status}, ${language}, ${tone}, ${lengthOption}, ${targetAudience}, ${tabType}, ${topic}, ${promotion}, ${holiday}, ${productUrl})
    ON DUPLICATE KEY UPDATE
      blogId = VALUES(blogId),
      title = VALUES(title),
      summary = VALUES(summary),
      bodyHtml = VALUES(bodyHtml),
      status = VALUES(status),
      language = VALUES(language),
      tone = VALUES(tone),
      lengthOption = VALUES(lengthOption),
      targetAudience = VALUES(targetAudience),
      tabType = VALUES(tabType),
      topic = VALUES(topic),
      promotion = VALUES(promotion),
      holiday = VALUES(holiday),
      productUrl = VALUES(productUrl),
      updatedAt = CURRENT_TIMESTAMP(3)
  `;
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const shopRecord = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { globalSettingsJson: true },
  });

  let parsedSettings = {};
  try {
    parsedSettings = JSON.parse(shopRecord?.globalSettingsJson || "{}");
  } catch {
    parsedSettings = {};
  }

  const defaults = getDefaultGlobalSettings();
  const settingsLanguage = cleanText(parsedSettings?.language || defaults.language || "English") || "English";

  const blogs = [];
  let after = null;
  while (true) {
    const response = await admin.graphql(BLOGS_QUERY, { variables: { first: 100, after } });
    const json = await response.json();
    const connection = json?.data?.blogs;
    const edges = connection?.edges || [];

    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;
      blogs.push({
        id: node.id,
        title: cleanText(node.title) || "Untitled",
        handle: cleanText(node.handle) || "-",
        updatedAt: node.updatedAt || null,
        commentPolicy: node.commentPolicy || "-",
      });
    }

    if (!connection?.pageInfo?.hasNextPage || !connection?.pageInfo?.endCursor) break;
    after = connection.pageInfo.endCursor;
  }

  const articles = [];
  after = null;
  while (true) {
    const response = await admin.graphql(ARTICLES_QUERY, { variables: { first: 100, after } });
    const json = await response.json();
    const connection = json?.data?.articles;
    const edges = connection?.edges || [];

    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;
      articles.push(normalizeArticle(node));
    }

    if (!connection?.pageInfo?.hasNextPage || !connection?.pageInfo?.endCursor) break;
    after = connection.pageInfo.endCursor;
  }

  return { blogs, articles, settingsLanguage };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  const shopRecord = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { globalSettingsJson: true },
  });
  let parsedSettings = {};
  try {
    parsedSettings = JSON.parse(shopRecord?.globalSettingsJson || "{}");
  } catch {
    parsedSettings = {};
  }
  const defaults = getDefaultGlobalSettings();
  const language = cleanText(parsedSettings?.language || defaults.language || "English") || "English";

  if (intent === "generate_suggestions") {
    const tabType = cleanText(formData.get("tabType")) || TAB_KEYS.BUSINESS;
    const topic = cleanText(formData.get("topic"));
    const postLength = cleanText(formData.get("postLength")) || "medium";
    const tone = cleanText(formData.get("tone")) || "Casual";
    const targetAudience = cleanText(formData.get("targetAudience")) || "Everyone";
    const promotion = cleanText(formData.get("promotion")) || "No promotion";
    const holiday = cleanText(formData.get("holiday")) || "Choose a holiday to promote";

    if (tabType === TAB_KEYS.CUSTOM && !topic) {
      return { ok: false, intent, error: "Post topic is required for custom post." };
    }

    const seedTopic =
      topic ||
      (tabType === TAB_KEYS.HOLIDAY
        ? `${holiday} campaign ideas`
        : tabType === TAB_KEYS.PROMOTION
          ? `${promotion} promotion blog ideas`
          : "Business growth ideas");

    const suggestions = createSuggestionSet({
      tabType,
      topic: seedTopic,
      tone,
      postLength,
      targetAudience,
      promotion,
      holiday,
      language,
    });

    return { ok: true, intent, suggestions };
  }

  if (intent === "save_generated_blog") {
    const blogId = cleanText(formData.get("blogId"));
    const title = cleanText(formData.get("title"));
    const body = String(formData.get("body") || "").trim();
    const status = cleanText(formData.get("status")) || "draft";

    if (!blogId) return { ok: false, intent, error: "Please select a blog." };
    if (!title) return { ok: false, intent, error: "Title is required." };
    if (!body) return { ok: false, intent, error: "Content is required." };

    const creditBalance = await getOrCreateShopCredits(session.shop);
    if ((creditBalance?.credits ?? 0) < BLOG_BODY_CREDIT_COST) {
      return {
        ok: false,
        intent,
        error: buildInsufficientCreditsError(BLOG_BODY_CREDIT_COST, creditBalance?.credits ?? 0),
      };
    }

    const response = await admin.graphql(ARTICLE_CREATE_MUTATION, {
      variables: {
        blogId,
        article: {
          title,
          body,
          isPublished: status === "published",
        },
      },
    });

    const json = await response.json();
    const payload = json?.data?.articleCreate;
    const errors = payload?.userErrors || [];
    if (errors.length) {
      return { ok: false, intent, error: errors.map((e) => e.message).join(", ") };
    }

    const article = normalizeArticle(payload.article);
    await upsertBlogGeneratedRecord({
      shop: session.shop,
      blogId,
      articleId: article.id,
      title: article.title,
      summary: getSummaryFromBody(body),
      bodyHtml: body,
      status,
      language,
      tone: cleanText(formData.get("tone")) || "Casual",
      lengthOption: cleanText(formData.get("postLength")) || "medium",
      targetAudience: cleanText(formData.get("targetAudience")) || "Everyone",
      tabType: cleanText(formData.get("tabType")) || TAB_KEYS.BUSINESS,
      topic: cleanText(formData.get("topic")),
      promotion: cleanText(formData.get("promotion")),
      holiday: cleanText(formData.get("holiday")),
      productUrl: cleanText(formData.get("productUrl")),
    });

    const creditSnapshot = await deductCredits({
      shopDomain: session.shop,
      creditsUsed: BLOG_BODY_CREDIT_COST,
    });

    try {
      await db.generatedContentLog.create({
        data: {
          shop: session.shop,
          productId: article.id,
          productTitle: article.title,
          intent: "blog_generate",
          resourceType: "blog",
          language,
          tone: cleanText(formData.get("tone")) || "Casual",
          generatedDescription: body,
          creditsUsed: BLOG_BODY_CREDIT_COST,
          appliedToProduct: true,
        },
      });
    } catch (_) {
      // Non-critical logging failure should not block response.
    }

    return {
      ok: true,
      intent,
      article,
      creditsUsed: BLOG_BODY_CREDIT_COST,
      newCredits: creditSnapshot.credits,
      creditsUsedTotal: creditSnapshot.creditsUsedTotal,
    };
  }

  if (intent === "regenerate_blog") {
    const articleId = cleanText(formData.get("articleId"));
    const seed = cleanText(formData.get("seed"));
    if (!articleId) return { ok: false, intent, error: "Missing article id." };

    const creditBalance = await getOrCreateShopCredits(session.shop);
    if ((creditBalance?.credits ?? 0) < BLOG_BODY_CREDIT_COST) {
      return {
        ok: false,
        intent,
        error: buildInsufficientCreditsError(BLOG_BODY_CREDIT_COST, creditBalance?.credits ?? 0),
      };
    }

    const title = seed || "Updated Shopify article";
    const body = buildBlogHtml({
      title,
      topic: seed || "Shopify growth",
      tone: "Casual",
      audience: "Everyone",
      promotion: "No promotion",
      holiday: "",
      tabType: TAB_KEYS.BUSINESS,
      language,
    });

    const response = await admin.graphql(ARTICLE_UPDATE_MUTATION, {
      variables: {
        id: articleId,
        article: {
          title,
          body,
        },
      },
    });
    const json = await response.json();
    const payload = json?.data?.articleUpdate;
    const errors = payload?.userErrors || [];
    if (errors.length) {
      return { ok: false, intent, error: errors.map((e) => e.message).join(", ") };
    }

    const article = normalizeArticle(payload.article);
    const creditSnapshot = await deductCredits({
      shopDomain: session.shop,
      creditsUsed: BLOG_BODY_CREDIT_COST,
    });

    try {
      await db.generatedContentLog.create({
        data: {
          shop: session.shop,
          productId: article.id,
          productTitle: article.title,
          intent: "blog_regenerate",
          resourceType: "blog",
          language,
          tone: "Casual",
          generatedDescription: body,
          creditsUsed: BLOG_BODY_CREDIT_COST,
          appliedToProduct: true,
        },
      });
    } catch (_) {
      // Non-critical logging failure should not block response.
    }

    return {
      ok: true,
      intent,
      article,
      creditsUsed: BLOG_BODY_CREDIT_COST,
      newCredits: creditSnapshot.credits,
      creditsUsedTotal: creditSnapshot.creditsUsedTotal,
    };
  }

  if (intent === "save_blog_content") {
    const articleId = cleanText(formData.get("articleId"));
    const blogId = cleanText(formData.get("blogId"));
    const title = cleanText(formData.get("title"));
    const body = String(formData.get("body") || "").trim();
    const status = cleanText(formData.get("status")) || "draft";

    if (!articleId) return { ok: false, intent, error: "Missing article id." };
    if (!title) return { ok: false, intent, error: "Title is required." };

    const response = await admin.graphql(ARTICLE_UPDATE_MUTATION, {
      variables: {
        id: articleId,
        article: {
          title,
          body,
          isPublished: status === "published",
        },
      },
    });
    const json = await response.json();
    const payload = json?.data?.articleUpdate;
    const errors = payload?.userErrors || [];
    if (errors.length) {
      return { ok: false, intent, error: errors.map((e) => e.message).join(", ") };
    }

    const article = normalizeArticle(payload.article);
    await upsertBlogGeneratedRecord({
      shop: session.shop,
      blogId: blogId || article.blogId,
      articleId: article.id,
      title: article.title,
      summary: getSummaryFromBody(body),
      bodyHtml: body,
      status,
      language,
      tone: cleanText(formData.get("tone")) || "",
      lengthOption: cleanText(formData.get("postLength")) || "",
      targetAudience: cleanText(formData.get("targetAudience")) || "",
      tabType: cleanText(formData.get("tabType")) || "",
      topic: cleanText(formData.get("topic")),
      promotion: cleanText(formData.get("promotion")),
      holiday: cleanText(formData.get("holiday")),
      productUrl: cleanText(formData.get("productUrl")),
    });

    return { ok: true, intent, article };
  }

  return { ok: false, intent, error: "Unknown action." };
};

export default function BlogPage() {
  const { blogs, articles, settingsLanguage } = useLoaderData();
  const fetcher = useFetcher();

  const [rows, setRows] = useState(() => articles);
  const [showGenerator, setShowGenerator] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [selectedBlogId, setSelectedBlogId] = useState(() => blogs?.[0]?.id || "");
  const [message, setMessage] = useState("");

  const [topic, setTopic] = useState("");
  const [postLength, setPostLength] = useState("medium");
  const [tone, setTone] = useState("Casual");
  const [targetAudience, setTargetAudience] = useState("Everyone");
  const [promotion, setPromotion] = useState("Buy One Get One Free (BOGO)");
  const [holiday, setHoliday] = useState("Choose a holiday to promote");
  const [productUrl, setProductUrl] = useState("");

  const [suggestions, setSuggestions] = useState([]);
  const [visibleSuggestionCount, setVisibleSuggestionCount] = useState(3);

  const [editingBlog, setEditingBlog] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editStatus, setEditStatus] = useState("draft");
  const [editBody, setEditBody] = useState("");

  const tabItems = [
    { id: TAB_KEYS.BUSINESS, content: "Generate post ideas for my business" },
    { id: TAB_KEYS.HOLIDAY, content: "Generate holiday posts" },
    { id: TAB_KEYS.PROMOTION, content: "Generate Promotion posts" },
    { id: TAB_KEYS.CUSTOM, content: "Generate a custom post" },
  ];

  const activeTabKey = tabItems[activeTab]?.id || TAB_KEYS.BUSINESS;
  const toneOptions = useMemo(() => POST_TONE_OPTIONS.map((value) => ({ label: value, value })), []);
  const audienceOptions = useMemo(
    () => TARGET_AUDIENCE_OPTIONS.map((value) => ({ label: value, value })),
    [],
  );
  const promotionOptions = useMemo(
    () => PROMOTION_OPTIONS.map((value) => ({ label: value, value })),
    [],
  );
  const holidayOptions = useMemo(() => HOLIDAY_OPTIONS.map((value) => ({ label: value, value })), []);
  const selectedBlogTitle = useMemo(
    () => blogs.find((blog) => blog.id === selectedBlogId)?.title || "",
    [blogs, selectedBlogId],
  );

  useEffect(() => {
    if (!selectedBlogId && blogs?.[0]?.id) {
      setSelectedBlogId(blogs[0].id);
    }
  }, [blogs, selectedBlogId]);

  useEffect(() => {
    if (!editingBlog) return;
    setEditBody(editingBlog.body || "");
  }, [editingBlog]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    if (!fetcher.data.ok) {
      setMessage(fetcher.data.error || "Operation failed.");
      return;
    }

    if (fetcher.data.intent === "generate_suggestions") {
      setSuggestions(fetcher.data.suggestions || []);
      setVisibleSuggestionCount(3);
      setMessage("6 blog suggestions generated.");
      return;
    }

    const nextArticle = fetcher.data.article;
    if (!nextArticle) return;

    setRows((prev) => {
      const exists = prev.some((item) => item.id === nextArticle.id);
      if (!exists) return [nextArticle, ...prev];
      return prev.map((item) => (item.id === nextArticle.id ? nextArticle : item));
    });

    if (fetcher.data.intent === "save_generated_blog") {
      setMessage(
        `Blog saved to Shopify and database.${typeof fetcher.data.creditsUsed === "number" ? ` ${fetcher.data.creditsUsed} credit used${typeof fetcher.data.newCredits === "number" ? `. Remaining: ${fetcher.data.newCredits}` : ""}.` : ""}`,
      );
      setShowGenerator(false);
      setEditingBlog(null);
    }

    if (fetcher.data.intent === "regenerate_blog") {
      setMessage(
        `Blog regenerated successfully.${typeof fetcher.data.creditsUsed === "number" ? ` ${fetcher.data.creditsUsed} credit used${typeof fetcher.data.newCredits === "number" ? `. Remaining: ${fetcher.data.newCredits}` : ""}.` : ""}`,
      );
    }

    if (fetcher.data.intent === "save_blog_content") {
      setEditingBlog(null);
      setMessage("Blog content saved.");
    }
  }, [fetcher.state, fetcher.data]);

  function submitGenerateSuggestions() {
    const payload = new FormData();
    payload.append("intent", "generate_suggestions");
    payload.append("tabType", activeTabKey);
    payload.append("topic", topic);
    payload.append("postLength", postLength);
    payload.append("tone", tone);
    payload.append("targetAudience", targetAudience);
    payload.append("promotion", promotion);
    payload.append("holiday", holiday);
    payload.append("productUrl", productUrl);
    fetcher.submit(payload, { method: "post" });
  }

  function openSuggestionEditor(suggestion) {
    setEditingBlog({
      mode: "create",
      id: suggestion.id,
      blogId: selectedBlogId,
      title: suggestion.title,
      body: suggestion.body,
      status: suggestion.status || "draft",
      topic: suggestion.topic,
      tabType: suggestion.tabType,
      tone: suggestion.tone,
      postLength: suggestion.postLength,
      targetAudience: suggestion.targetAudience,
      promotion: suggestion.promotion,
      holiday: suggestion.holiday,
      productUrl,
    });
    setEditTitle(suggestion.title);
    setEditStatus(suggestion.status || "draft");
  }

  function saveSuggestionDirectly(suggestion) {
    const payload = new FormData();
    payload.append("intent", "save_generated_blog");
    payload.append("blogId", selectedBlogId);
    payload.append("title", suggestion.title);
    payload.append("body", suggestion.body);
    payload.append("status", suggestion.status || "draft");
    payload.append("topic", suggestion.topic || "");
    payload.append("tabType", suggestion.tabType || activeTabKey);
    payload.append("tone", suggestion.tone || tone);
    payload.append("postLength", suggestion.postLength || postLength);
    payload.append("targetAudience", suggestion.targetAudience || targetAudience);
    payload.append("promotion", suggestion.promotion || promotion);
    payload.append("holiday", suggestion.holiday || holiday);
    payload.append("productUrl", productUrl);
    fetcher.submit(payload, { method: "post" });
  }

  const rowsMarkup = useMemo(
    () =>
      rows.map((article, index) => (
        <IndexTable.Row id={article.id} key={article.id} position={index}>
          <IndexTable.Cell>
            <div style={{ maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={article.title}>
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {article.title}
              </Text>
            </div>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <button
              onClick={() => {
                setEditingBlog({
                  mode: "update",
                  id: article.id,
                  blogId: article.blogId,
                  title: article.title,
                  body: article.body,
                  status: article.publishedAt ? "published" : "draft",
                });
                setEditTitle(article.title);
                setEditStatus(article.publishedAt ? "published" : "draft");
              }}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                margin: 0,
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
              }}
            >
              <div
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  lineHeight: "1.45",
                  maxWidth: 500,
                }}
                title={stripHtml(article.body || "")}
              >
                <Text as="span" variant="bodySm" tone="subdued">
                  {getSummaryFromBody(article.body)}
                </Text>
              </div>
            </button>
          </IndexTable.Cell>
          <IndexTable.Cell>{statusBadge(article.publishedAt)}</IndexTable.Cell>
          <IndexTable.Cell>{formatDate(article.updatedAt)}</IndexTable.Cell>
          <IndexTable.Cell>
            <Button
              size="slim"
              onClick={() => {
                const payload = new FormData();
                payload.append("intent", "regenerate_blog");
                payload.append("articleId", article.id);
                payload.append("seed", article.title);
                fetcher.submit(payload, { method: "post" });
              }}
              disabled={fetcher.state !== "idle"}
            >
              Regenerate
            </Button>
          </IndexTable.Cell>
        </IndexTable.Row>
      )),
    [rows, fetcher],
  );

  return (
    <Page title="Blogs" subtitle="Generate, review, edit, and save blog posts with Shopify + database sync.">
      <BlockStack gap="400">
        <AppPageHeader
          title="Blogs"
          description="Generate, review, edit, and save blog posts with Shopify + database sync."
        />
        {message ? (
          <Banner tone="success" onDismiss={() => setMessage("")}>
            <Text as="p">{message}</Text>
          </Banner>
        ) : null}

        {showGenerator ? (
          <Card>
            <BlockStack gap="500">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingLg">
                  Blog post generation
                </Text>
                <Button onClick={() => setShowGenerator(false)}>Back to list</Button>
              </InlineStack>
              <Box padding="400" background="bg-surface-secondary" borderRadius="300" borderWidth="025" borderColor="border">
                <div className="blog-generator-hero">
                  <div className="blog-generator-hero-icon">AI</div>
                  <BlockStack gap="150">
                    <Text as="h3" variant="headingMd">
                      Generate high-quality blog ideas
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Use AI to generate suggestions, review content, edit format, and save directly to Shopify.
                    </Text>
                  </BlockStack>
                </div>
              </Box>

              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  Language from global settings: {settingsLanguage}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Blog destination: {selectedBlogTitle || "No blog available"}
                </Text>
              </BlockStack>

              <div className="blog-generator-tabs-wrap">
                <Tabs tabs={tabItems} selected={activeTab} onSelect={setActiveTab} fitted />
              </div>

              <Box padding="300" borderWidth="025" borderColor="border" borderRadius="300">
                <BlockStack gap="300">
                  {activeTabKey === TAB_KEYS.HOLIDAY ? (
                    <div className="blog-generator-fields">
                      <Select label="Select holiday" options={holidayOptions} value={holiday} onChange={setHoliday} />
                      <Select label="Post length" options={POST_LENGTH_OPTIONS} value={postLength} onChange={setPostLength} />
                      <Select label="Post tone" options={toneOptions} value={tone} onChange={setTone} />
                      <Select label="Target audience" options={audienceOptions} value={targetAudience} onChange={setTargetAudience} />
                      <Select label="Select promotion" options={promotionOptions} value={promotion} onChange={setPromotion} />
                      <TextField label="Select product to promote" value={productUrl} onChange={setProductUrl} autoComplete="off" placeholder="Add a product or category URL" />
                    </div>
                  ) : null}

                  {activeTabKey === TAB_KEYS.PROMOTION ? (
                    <div className="blog-generator-fields">
                      <Select label="Select promotion" options={promotionOptions} value={promotion} onChange={setPromotion} />
                      <TextField label="Select product to promote" value={productUrl} onChange={setProductUrl} autoComplete="off" placeholder="Add a product or category URL" />
                      <Select label="Post length" options={POST_LENGTH_OPTIONS} value={postLength} onChange={setPostLength} />
                      <Select label="Post tone" options={toneOptions} value={tone} onChange={setTone} />
                    </div>
                  ) : null}

                  {activeTabKey === TAB_KEYS.CUSTOM ? (
                    <div className="blog-generator-fields">
                      <TextField label="Post topic" value={topic} onChange={setTopic} autoComplete="off" placeholder="Write a topic for your post" />
                      <Select label="Post length" options={POST_LENGTH_OPTIONS} value={postLength} onChange={setPostLength} />
                      <Select label="Post tone" options={toneOptions} value={tone} onChange={setTone} />
                      <Select label="Target audience" options={audienceOptions} value={targetAudience} onChange={setTargetAudience} />
                      <TextField label="Select product to promote" value={productUrl} onChange={setProductUrl} autoComplete="off" placeholder="Add a product or category URL" />
                    </div>
                  ) : null}

                  {activeTabKey === TAB_KEYS.BUSINESS ? (
                    <div className="blog-generator-fields">
                      <Select label="Post length" options={POST_LENGTH_OPTIONS} value={postLength} onChange={setPostLength} />
                      <Select label="Post tone" options={toneOptions} value={tone} onChange={setTone} />
                      <Select label="Target audience" options={audienceOptions} value={targetAudience} onChange={setTargetAudience} />
                      <TextField label="Select product to promote (optional)" value={productUrl} onChange={setProductUrl} autoComplete="off" placeholder="Add a product or category URL" />
                    </div>
                  ) : null}

                  <InlineStack>
                    <Button
                      variant="primary"
                      onClick={submitGenerateSuggestions}
                      loading={fetcher.state !== "idle" && String(fetcher.formData?.get("intent")) === "generate_suggestions"}
                    >
                      Generate suggestions
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Box>

              {suggestions.length ? (
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">
                      Generated blogs ({suggestions.length})
                    </Text>
                  </InlineStack>

                  {suggestions.slice(0, visibleSuggestionCount).map((suggestion) => (
                    <Card key={suggestion.id}>
                      <BlockStack gap="300">
                        <Text as="h4" variant="headingMd">{suggestion.title}</Text>
                        <Text as="p" variant="bodyMd" tone="subdued">{suggestion.summary}</Text>
                        <InlineStack gap="200" wrap>
                          <Badge>{suggestion.tone}</Badge>
                          <Badge>{suggestion.targetAudience}</Badge>
                          <Badge>{suggestion.postLength}</Badge>
                        </InlineStack>
                        <div className="blog-generator-card-actions">
                          <div className="blog-generator-card-status">
                            <Select
                              label="Status"
                              options={[
                                { label: "Draft", value: "draft" },
                                { label: "Published", value: "published" },
                              ]}
                              value={suggestion.status || "draft"}
                              onChange={(nextStatus) =>
                                setSuggestions((prev) => prev.map((item) => (item.id === suggestion.id ? { ...item, status: nextStatus } : item)))
                              }
                            />
                          </div>
                          <InlineStack gap="200" wrap>
                            <Button onClick={() => openSuggestionEditor(suggestion)}>Open in editor</Button>
                            <Button
                              variant="primary"
                              onClick={() => saveSuggestionDirectly(suggestion)}
                              disabled={!selectedBlogId || fetcher.state !== "idle" || blogs.length === 0}
                              loading={
                                fetcher.state !== "idle" &&
                                String(fetcher.formData?.get("intent")) === "save_generated_blog" &&
                                String(fetcher.formData?.get("title")) === suggestion.title
                              }
                            >
                              Save blog
                            </Button>
                          </InlineStack>
                        </div>
                      </BlockStack>
                    </Card>
                  ))}

                  {visibleSuggestionCount < suggestions.length ? (
                    <InlineStack align="center">
                      <Button onClick={() => setVisibleSuggestionCount(suggestions.length)}>Show more</Button>
                    </InlineStack>
                  ) : null}
                </BlockStack>
              ) : null}
            </BlockStack>
          </Card>
        ) : (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="p" variant="bodySm" tone="subdued">
                  Total articles: {rows.length}
                </Text>
                <Button variant="primary" onClick={() => setShowGenerator(true)}>
                  Create Blog
                </Button>
              </InlineStack>

              {rows.length === 0 ? (
                <EmptyState
                  heading="No blog articles found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Click Create Blog to generate your first article.</p>
                </EmptyState>
              ) : (
                <IndexTable
                  resourceName={{ singular: "article", plural: "articles" }}
                  itemCount={rows.length}
                  selectable={false}
                  headings={[
                    { title: "Title" },
                    { title: "Summary" },
                    { title: "Status" },
                    { title: "Updated" },
                    { title: "Regenerate" },
                  ]}
                >
                  {rowsMarkup}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        )}
      </BlockStack>

      <Modal open={Boolean(editingBlog)} onClose={() => setEditingBlog(null)} title="Blog Text Editor" large>
        <Modal.Section>
          <BlockStack gap="300">
            <TextField label="Title" value={editTitle} onChange={setEditTitle} autoComplete="off" />
            <Select
              label="Status"
              options={[
                { label: "Draft", value: "draft" },
                { label: "Published", value: "published" },
              ]}
              value={editStatus}
              onChange={setEditStatus}
            />

            <RichTextEditor
              value={editBody}
              onChange={setEditBody}
              minHeight={380}
              maxHeight={430}
              showSourceToggle
            />

            <InlineStack align="end" gap="200">
              <Button onClick={() => setEditingBlog(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (!editingBlog) return;
                  const payload = new FormData();

                  if (editingBlog.mode === "create") {
                    payload.append("intent", "save_generated_blog");
                    payload.append("blogId", editingBlog.blogId || selectedBlogId);
                    payload.append("title", editTitle);
                    payload.append("body", editBody || "");
                    payload.append("status", editStatus);
                    payload.append("topic", editingBlog.topic || "");
                    payload.append("tabType", editingBlog.tabType || activeTabKey);
                    payload.append("tone", editingBlog.tone || tone);
                    payload.append("postLength", editingBlog.postLength || postLength);
                    payload.append("targetAudience", editingBlog.targetAudience || targetAudience);
                    payload.append("promotion", editingBlog.promotion || promotion);
                    payload.append("holiday", editingBlog.holiday || holiday);
                    payload.append("productUrl", editingBlog.productUrl || productUrl);
                  } else {
                    payload.append("intent", "save_blog_content");
                    payload.append("articleId", editingBlog.id);
                    payload.append("blogId", editingBlog.blogId || "");
                    payload.append("title", editTitle);
                    payload.append("body", editBody || "");
                    payload.append("status", editStatus);
                  }

                  fetcher.submit(payload, { method: "post" });
                }}
                loading={
                  fetcher.state !== "idle" &&
                  ["save_generated_blog", "save_blog_content"].includes(String(fetcher.formData?.get("intent")))
                }
              >
                Save
              </Button>
            </InlineStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

