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
const BLOG_OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
const BLOG_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

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

function normalizeToneValue(value, fallback = "Casual") {
  const normalizedFallback = cleanText(fallback) || "Casual";
  const candidate = cleanText(value);
  if (!candidate) return normalizedFallback;
  const matched = POST_TONE_OPTIONS.find((option) => option.toLowerCase() === candidate.toLowerCase());
  return matched || candidate;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function getWordRange(lengthOption) {
  if (lengthOption === "long") return { min: 800, max: 1200 };
  if (lengthOption === "short") return { min: 500, max: 600 };
  return { min: 600, max: 800 };
}

function normalizePostLength(value, fallback = "medium") {
  const candidate = cleanText(value).toLowerCase();
  if (candidate === "long" || candidate === "medium" || candidate === "short") return candidate;
  return fallback;
}

function countWords(value) {
  const plain = stripHtml(value || "");
  if (!plain) return 0;
  return plain.split(" ").filter(Boolean).length;
}

function plainTextToHtml(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function normalizeBodyHtml(body) {
  const value = String(body || "").trim();
  if (!value) return "";
  if (/<\/?[a-z][\s\S]*>/i.test(value)) return value;
  return plainTextToHtml(value);
}

function parseAiJson(rawText) {
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch {
    const match = String(rawText).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function buildBlogHtml({ title, topic, tone, audience, promotion, holiday, tabType, language, postLength = "medium" }) {
  const primaryTopic = cleanText(topic) || cleanText(title) || "Shopify growth";
  const safeTitle = escapeHtml(cleanText(title) || primaryTopic);
  const safeTopic = escapeHtml(primaryTopic);
  const safeTone = escapeHtml(cleanText(tone) || "Casual");
  const safeAudience = escapeHtml(cleanText(audience) || "Everyone");
  const safeLanguage = escapeHtml(cleanText(language) || "English");
  const safePromotion = escapeHtml(cleanText(promotion));
  const safeHoliday = escapeHtml(cleanText(holiday));
  const wordRange = getWordRange(postLength);
  const sections = [
    `<h1>${safeTitle}</h1>`,
    `<p>This ${safeTone.toLowerCase()} article is written for ${safeAudience.toLowerCase()} readers in ${safeLanguage}. It focuses on practical ways to improve performance with ${safeTopic.toLowerCase()} and turn interest into real store results.</p>`,
    `<h2>What ${safeTopic} means for your store</h2>`,
    `<p>${safeTopic} can improve discoverability, trust, and conversion when your content is clear, structured, and aligned with customer intent. The goal is to make decision-making easy for shoppers while keeping your brand voice consistent.</p>`,
    `<h2>Step-by-step strategy you can apply today</h2>`,
    `<ol>
      <li>Define one measurable outcome such as higher click-through rate or better conversion.</li>
      <li>Map core customer questions and answer them with clear benefit-driven messaging.</li>
      <li>Use headings, short paragraphs, and comparison points so content is easy to scan.</li>
      <li>Finish with a direct call to action that tells readers what to do next.</li>
    </ol>`,
    `<h3>Common mistakes to avoid</h3>`,
    `<ul>
      <li>Writing generic content that does not match buyer intent.</li>
      <li>Overusing keywords and reducing readability.</li>
      <li>Skipping proof points such as outcomes, specifics, or examples.</li>
      <li>Ending without a clear next action.</li>
    </ul>`,
  ];

  if (tabType === TAB_KEYS.HOLIDAY && safeHoliday && safeHoliday !== "Choose a holiday to promote") {
    sections.push(
      `<h2>${safeHoliday} campaign angle</h2>`,
      `<p>For ${safeHoliday}, lead with urgency and relevance. Highlight what is limited, who the offer is for, and why acting now benefits the customer. Keep the message timely, specific, and easy to redeem.</p>`,
    );
  }

  if (safePromotion && safePromotion !== "No promotion") {
    sections.push(
      `<h2>Promotion messaging framework</h2>`,
      `<p>Position the offer as a clear value exchange: what the customer gets, how long it lasts, and what action unlocks the benefit. Repeat the core offer naturally in headings and supporting copy.</p>`,
      `<p><strong>Promotion in focus:</strong> ${safePromotion}</p>`,
    );
  }

  sections.push(
    `<h2>Conclusion</h2>`,
    `<p>Strong ${safeTopic.toLowerCase()} content is specific, actionable, and customer-focused. Keep refining structure, proof points, and calls to action to steadily improve your results.</p>`,
  );

  const expansionPool = [
    `<p>When writing for ${safeAudience.toLowerCase()} readers, prioritize clarity over complexity. Every paragraph should answer a real question and move the reader closer to action.</p>`,
    `<p>Add practical examples tied to ${safeTopic.toLowerCase()} so readers can immediately apply what they learn. Concrete examples outperform abstract advice in both engagement and conversion.</p>`,
    `<p>Use internal consistency across headings, body copy, and CTA language. A consistent message improves trust and makes the journey from discovery to purchase more predictable.</p>`,
    `<p>Review your draft for readability: short sentences, active voice, and clear transitions. This makes long-form content easier to scan on mobile devices.</p>`,
    `<p>Before publishing, validate that your primary keyword appears naturally in the title, opening paragraph, and at least one subheading without keyword stuffing.</p>`,
    `<p>After publishing, monitor performance and iterate. Improving one section at a time often yields better outcomes than rewriting everything at once.</p>`,
  ];

  const compactExpansionPool = [
    `<p>Keep each section focused on one actionable takeaway that readers can apply today.</p>`,
    `<p>Use customer-first language and remove vague claims that do not help a buying decision.</p>`,
    `<p>Close each key section with a small next step to keep momentum and improve engagement.</p>`,
  ];

  function buildPaddingParagraph(targetWords) {
    const safeTarget = Math.max(8, Number(targetWords) || 0);
    const baseTokens = [
      "Use",
      "clear",
      "examples",
      "and",
      "practical",
      "steps",
      "to",
      "make",
      cleanText(topic) || "content",
      "easy",
      "to",
      "apply",
      "for",
      cleanText(audience) || "readers",
      "today",
    ];
    const words = [];
    let idx = 0;
    while (words.length < safeTarget) {
      words.push(baseTokens[idx % baseTokens.length]);
      idx += 1;
    }
    return `<p>${escapeHtml(words.join(" "))}.</p>`;
  }

  let html = sections.join("");
  let totalWords = countWords(html);
  let poolIndex = 0;
  let compactIndex = 0;
  let guard = 0;

  while (totalWords < wordRange.min && guard < 240) {
    const nextLong = expansionPool[poolIndex % expansionPool.length];
    const nextLongWords = countWords(nextLong);

    if (totalWords + nextLongWords <= wordRange.max) {
      html = `${html}${nextLong}`;
      totalWords += nextLongWords;
      poolIndex += 1;
      guard += 1;
      continue;
    }

    const nextCompact = compactExpansionPool[compactIndex % compactExpansionPool.length];
    const nextCompactWords = countWords(nextCompact);
    if (totalWords + nextCompactWords <= wordRange.max) {
      html = `${html}${nextCompact}`;
      totalWords += nextCompactWords;
      compactIndex += 1;
      guard += 1;
      continue;
    }

    const remainingToMin = wordRange.min - totalWords;
    const remainingToMax = wordRange.max - totalWords;
    const fillWords = Math.min(remainingToMin, remainingToMax);
    if (fillWords >= 8) {
      const filler = buildPaddingParagraph(fillWords);
      const fillerWords = countWords(filler);
      if (totalWords + fillerWords <= wordRange.max) {
        html = `${html}${filler}`;
        totalWords += fillerWords;
      }
    }
    break;
  }

  return html;
}

function ensureBlogBodyWordRange({
  body,
  title,
  topic,
  tone,
  audience,
  promotion,
  holiday,
  tabType,
  language,
  postLength = "medium",
}) {
  const normalized = normalizeBodyHtml(body || "");
  const { min, max } = getWordRange(postLength);
  const words = countWords(normalized);
  if (normalized && words >= min && words <= max) return normalized;
  return buildBlogHtml({
    title,
    topic,
    tone,
    audience,
    promotion,
    holiday,
    tabType,
    language,
    postLength,
  });
}

function getGeneratedContentPreview(body, maxLength = 220) {
  const plain = stripHtml(body || "");
  if (!plain) return "-";
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength).trim()}...`;
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
        postLength,
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

async function generateSuggestionsWithOpenAI(prompt, apiKey) {
  if (!apiKey) throw new Error("OpenAI API key is not configured.");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: BLOG_OPENAI_MODEL,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an expert Shopify blog copywriter. Always return valid JSON only, with no markdown and no explanations.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI request failed with status ${response.status}.`);
  }
  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = parseAiJson(content);
  if (!parsed) throw new Error("OpenAI returned invalid JSON.");
  return parsed;
}

async function generateSuggestionsWithAnthropic(prompt, apiKey) {
  if (!apiKey) throw new Error("Anthropic API key is not configured.");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: BLOG_ANTHROPIC_MODEL,
      max_tokens: 4096,
      system:
        "You are an expert Shopify blog copywriter. Always return valid JSON only, with no markdown and no explanations.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Anthropic request failed with status ${response.status}.`);
  }
  const content = data?.content?.[0]?.text || "";
  const parsed = parseAiJson(content);
  if (!parsed) throw new Error("Anthropic returned invalid JSON.");
  return parsed;
}

async function generateBlogSuggestionsWithAI({
  tabType,
  topic,
  tone,
  postLength,
  targetAudience,
  promotion,
  holiday,
  language,
  aiProvider = "auto",
  openaiApiKey,
  anthropicApiKey,
  count = 6,
}) {
  const baseTopic = cleanText(topic) || "Shopify growth";
  const { min, max } = getWordRange(postLength);
  const safeCount = Math.max(1, Math.min(count || 6, 6));
  const prompt = `
Generate ${safeCount} unique Shopify blog suggestions.

Context:
- Topic: ${baseTopic}
- Tone: ${tone}
- Audience: ${targetAudience}
- Language: ${language}
- Length target per blog: ${min}-${max} words
- Tab type: ${tabType}
- Promotion: ${promotion || "None"}
- Holiday: ${holiday || "None"}

Requirements:
- Return valid JSON only in this format:
{
  "suggestions": [
    {
      "title": "...",
      "summary": "...",
      "bodyHtml": "<h1>...</h1><p>...</p>..."
    }
  ]
}
- bodyHtml must include semantic HTML with headings, paragraphs, and at least one list.
- Keep content natural, specific, and useful (not repetitive filler).
- Ensure each suggestion is clearly different from the others.
`;

  const providerOrder =
    aiProvider === "openai"
      ? ["openai"]
      : aiProvider === "anthropic"
        ? ["anthropic"]
        : ["openai", "anthropic"];

  let parsed = null;
  let lastError = null;

  for (const provider of providerOrder) {
    try {
      if (provider === "openai") {
        parsed = await generateSuggestionsWithOpenAI(prompt, openaiApiKey);
      } else if (provider === "anthropic") {
        parsed = await generateSuggestionsWithAnthropic(prompt, anthropicApiKey);
      }
      if (parsed) break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!parsed) {
    throw lastError || new Error("No AI provider available for blog suggestions.");
  }

  const items = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  if (!items.length) throw new Error("AI did not return suggestions.");

  return items.slice(0, safeCount).map((item, index) => {
    const title = cleanText(item?.title) || `${baseTopic} Guide ${index + 1}`;
    const summary =
      cleanText(item?.summary) ||
      `${tone} ${getWordTarget(postLength)} words blog for ${targetAudience.toLowerCase()} about ${baseTopic.toLowerCase()}.`;
    const bodyHtml = ensureBlogBodyWordRange({
      body: item?.bodyHtml || item?.body || item?.content || "",
      title,
      topic: baseTopic,
      tone,
      audience: targetAudience,
      promotion,
      holiday,
      tabType,
      language,
      postLength,
    });
    return {
      id: `${Date.now()}-${index}`,
      tabType,
      title,
      summary,
      body: bodyHtml,
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
    select: { globalSettingsJson: true, defaultAiProvider: true, openaiApiKey: true, anthropicApiKey: true },
  });

  let parsedSettings = {};
  try {
    parsedSettings = JSON.parse(shopRecord?.globalSettingsJson || "{}");
  } catch {
    parsedSettings = {};
  }

  const defaults = getDefaultGlobalSettings();
  const settingsLanguage = cleanText(parsedSettings?.language || defaults.language || "English") || "English";
  const settingsTone = normalizeToneValue(parsedSettings?.tone || defaults.tone || "Casual");

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

  return { blogs, articles, settingsLanguage, settingsTone };
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
  const defaultTone = normalizeToneValue(parsedSettings?.tone || defaults.tone || "Casual");

  if (intent === "generate_suggestions") {
    const tabType = cleanText(formData.get("tabType")) || TAB_KEYS.BUSINESS;
    const topic = cleanText(formData.get("topic"));
    const postLength = normalizePostLength(formData.get("postLength"), "medium");
    const tone = normalizeToneValue(formData.get("tone"), defaultTone);
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

    let suggestions = [];
    try {
      suggestions = await generateBlogSuggestionsWithAI({
        tabType,
        topic: seedTopic,
        tone,
        postLength,
        targetAudience,
        promotion,
        holiday,
        language,
        aiProvider: cleanText(shopRecord?.defaultAiProvider) || "auto",
        openaiApiKey: cleanText(shopRecord?.openaiApiKey) || process.env.OPENAI_API_KEY,
        anthropicApiKey: cleanText(shopRecord?.anthropicApiKey) || process.env.ANTHROPIC_API_KEY,
        count: 6,
      });
    } catch (_) {
      suggestions = createSuggestionSet({
        tabType,
        topic: seedTopic,
        tone,
        postLength,
        targetAudience,
        promotion,
        holiday,
        language,
      });
    }

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
      tone: normalizeToneValue(formData.get("tone"), defaultTone),
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
          tone: normalizeToneValue(formData.get("tone"), defaultTone),
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
    const tone = normalizeToneValue(formData.get("tone"), defaultTone);
    const postLength = normalizePostLength(formData.get("postLength"), "medium");
    if (!articleId) return { ok: false, intent, error: "Missing article id." };

    const creditBalance = await getOrCreateShopCredits(session.shop);
    if ((creditBalance?.credits ?? 0) < BLOG_BODY_CREDIT_COST) {
      return {
        ok: false,
        intent,
        error: buildInsufficientCreditsError(BLOG_BODY_CREDIT_COST, creditBalance?.credits ?? 0),
      };
    }

    let title = seed || "Updated Shopify article";
    let body = "";
    try {
      const [generated] = await generateBlogSuggestionsWithAI({
        tabType: TAB_KEYS.BUSINESS,
        topic: seed || "Shopify growth",
        tone,
        postLength,
        targetAudience: "Everyone",
        promotion: "No promotion",
        holiday: "",
        language,
        aiProvider: cleanText(shopRecord?.defaultAiProvider) || "auto",
        openaiApiKey: cleanText(shopRecord?.openaiApiKey) || process.env.OPENAI_API_KEY,
        anthropicApiKey: cleanText(shopRecord?.anthropicApiKey) || process.env.ANTHROPIC_API_KEY,
        count: 1,
      });
      if (generated) {
        title = generated.title || title;
        body = generated.body || "";
      }
    } catch (_) {
      // fall back below
    }
    if (!body) {
      body = buildBlogHtml({
        title,
        topic: seed || "Shopify growth",
        tone,
        audience: "Everyone",
        promotion: "No promotion",
        holiday: "",
        tabType: TAB_KEYS.BUSINESS,
        language,
        postLength,
      });
    }

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
          tone,
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
  const { blogs, articles, settingsLanguage, settingsTone } = useLoaderData();
  const fetcher = useFetcher();

  const [rows, setRows] = useState(() => articles);
  const [showGenerator, setShowGenerator] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [selectedBlogId, setSelectedBlogId] = useState(() => blogs?.[0]?.id || "");
  const [message, setMessage] = useState("");

  const [topic, setTopic] = useState("");
  const [postLength, setPostLength] = useState("medium");
  const [tone, setTone] = useState(() => normalizeToneValue(settingsTone, "Casual"));
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
                payload.append("tone", tone);
                payload.append("postLength", postLength);
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
    <Page fullWidth>
      <BlockStack gap="400">
        <AppPageHeader
          title="Blogs Generator"
          description="Create, regenerate, edit, and publish SEO-friendly blog content for your Shopify store."
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
                  Create Blog
                </Text>
                <Button onClick={() => setShowGenerator(false)}>Back to list</Button>
              </InlineStack>
              <Box padding="400" background="bg-surface-secondary" borderRadius="300" borderWidth="025" borderColor="border">
                <BlockStack gap="300">
                  <BlockStack gap="150">
                    <Text as="h3" variant="headingMd">
                      AI-powered blog generation
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Choose a generation type, fill in fields, and create ready-to-publish blog drafts for Shopify.
                    </Text>
                  </BlockStack>

                  <div className="blog-generator-tabs-wrap">
                    <Tabs tabs={tabItems} selected={activeTab} onSelect={setActiveTab} />
                  </div>
                </BlockStack>
              </Box>

              <Box padding="300" borderWidth="025" borderColor="border" borderRadius="300">
                <BlockStack gap="300">
                  {activeTabKey === TAB_KEYS.HOLIDAY ? (
                    <div className="blog-generator-fields">
                      <Select label="Holiday" options={holidayOptions} value={holiday} onChange={setHoliday} />
                      <Select label="Promotion" options={promotionOptions} value={promotion} onChange={setPromotion} />
                      <Select label="Post length" options={POST_LENGTH_OPTIONS} value={postLength} onChange={setPostLength} />
                      <Select label="Post tone" options={toneOptions} value={tone} onChange={setTone} />
                      <Select label="Target audience" options={audienceOptions} value={targetAudience} onChange={setTargetAudience} />
                      <TextField label="Product URL" value={productUrl} onChange={setProductUrl} autoComplete="off" placeholder="https://yourstore.com/products/..." />
                    </div>
                  ) : null}

                  {activeTabKey === TAB_KEYS.PROMOTION ? (
                    <div className="blog-generator-fields">
                      <Select label="Promotion" options={promotionOptions} value={promotion} onChange={setPromotion} />
                      <Select label="Post length" options={POST_LENGTH_OPTIONS} value={postLength} onChange={setPostLength} />
                      <Select label="Post tone" options={toneOptions} value={tone} onChange={setTone} />
                      <Select label="Target audience" options={audienceOptions} value={targetAudience} onChange={setTargetAudience} />
                      <TextField label="Product URL" value={productUrl} onChange={setProductUrl} autoComplete="off" placeholder="https://yourstore.com/products/..." />
                    </div>
                  ) : null}

                  {activeTabKey === TAB_KEYS.CUSTOM ? (
                    <div className="blog-generator-fields">
                      <TextField label="Post topic" value={topic} onChange={setTopic} autoComplete="off" placeholder="Write a specific topic for your post" />
                      <Select label="Post length" options={POST_LENGTH_OPTIONS} value={postLength} onChange={setPostLength} />
                      <Select label="Post tone" options={toneOptions} value={tone} onChange={setTone} />
                      <Select label="Target audience" options={audienceOptions} value={targetAudience} onChange={setTargetAudience} />
                      <TextField label="Product URL" value={productUrl} onChange={setProductUrl} autoComplete="off" placeholder="https://yourstore.com/products/..." />
                    </div>
                  ) : null}

                  {activeTabKey === TAB_KEYS.BUSINESS ? (
                    <div className="blog-generator-fields">
                      <Select label="Post length" options={POST_LENGTH_OPTIONS} value={postLength} onChange={setPostLength} />
                      <Select label="Post tone" options={toneOptions} value={tone} onChange={setTone} />
                      <Select label="Target audience" options={audienceOptions} value={targetAudience} onChange={setTargetAudience} />
                      <TextField label="Product URL (optional)" value={productUrl} onChange={setProductUrl} autoComplete="off" placeholder="https://yourstore.com/products/..." />
                    </div>
                  ) : null}

                  <InlineStack align="start">
                    <Button
                      variant="primary"
                      onClick={submitGenerateSuggestions}
                      loading={fetcher.state !== "idle" && String(fetcher.formData?.get("intent")) === "generate_suggestions"}
                      disabled={blogs.length === 0}
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

                  <div className="blog-generated-grid">
                    {suggestions.slice(0, visibleSuggestionCount).map((suggestion) => (
                      <Card key={suggestion.id}>
                        <BlockStack gap="300">
                          <Text as="h4" variant="headingMd">{suggestion.title}</Text>
                          <Text as="p" variant="bodyMd" tone="subdued">{suggestion.summary}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {getGeneratedContentPreview(suggestion.body)}
                          </Text>
                          <InlineStack gap="200" wrap>
                            <Badge>{suggestion.tone}</Badge>
                            <Badge>{suggestion.targetAudience}</Badge>
                            <Badge>{suggestion.postLength}</Badge>
                            <Badge tone="info">{getWordTarget(suggestion.postLength)} words</Badge>
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
                  </div>

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

      <Modal open={Boolean(editingBlog)} onClose={() => setEditingBlog(null)} title="Blog Text Editor" size="large">
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

      <style>{`
        .blog-generator-fields {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }
        .blog-generated-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        @media (max-width: 900px) {
          .blog-generator-fields {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .blog-generated-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 640px) {
          .blog-generator-fields {
            grid-template-columns: 1fr;
          }
          .blog-generated-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
