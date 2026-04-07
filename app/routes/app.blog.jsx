import { useState, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { buildBlogContentPrompt } from "../lib/contentPromptTemplates";
import { readGlobalSettings } from "../lib/globalSettings";
import {
  readStoredBlogPromptTemplateSelection,
  BLOG_BODY_TEMPLATES,
  BLOG_META_DESCRIPTION_TEMPLATES,
  BLOG_META_TITLE_TEMPLATES,
} from "../lib/blogPromptTemplateLibrary";
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
  InlineStack,
  Text,
  Button,
  Select,
  TextField,
  Checkbox,
  Banner,
  Badge,
  IndexTable,
  useIndexResourceState,
} from "@shopify/polaris";
import { BlogIcon } from "@shopify/polaris-icons";

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

const ARTICLE_CREATE_MUTATION = `#graphql
  mutation ArticleCreate($blogId: ID!, $article: ArticleCreateInput!) {
    articleCreate(blogId: $blogId, article: $article) {
      article {
        id
        title
        publishedAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const MAX_INLINE_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
const BLOG_CONTENT_TYPES = ["body", "meta_title", "meta_description"];
const DEFAULT_BLOG_CONTENT_TYPES = ["body", "meta_title", "meta_description"];
const BLOG_CREATE_CREDITS = 3;

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

function cleanInlineText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value || "");
}

function toParagraphHtml(value) {
  const plainText = String(value || "").trim();
  if (!plainText) return "";

  return plainText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function normalizeGeneratedHtml(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (looksLikeHtml(text)) return text;
  return toParagraphHtml(text);
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function evaluateContentShortStatus(content) {
  if (!content || !content.trim()) return { label: "Missing", tone: "critical" };
  if (content.trim().length < 80) return { label: "Short", tone: "warning" };
  return { label: "Good", tone: "success" };
}

function parseGeneratedBlogJson(raw) {
  let parsed = { articleTitle: "", articleBody: "", excerpt: "", seoTitle: "", seoDescription: "" };
  try {
    const match = raw?.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else parsed.articleBody = raw || "";
  } catch {
    parsed.articleBody = raw || "";
  }
  return parsed;
}

function toLocalDateTimeInput(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function getDefaultScheduleRangeInputs() {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    start: toLocalDateTimeInput(start),
    end: toLocalDateTimeInput(end),
  };
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

async function writeGenerationLog(data) {
  try {
    await db.generatedContentLog.create({ data });
  } catch (error) {
    console.error("Failed to store blog generation log", error);
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
    select: { openaiApiKey: true, anthropicApiKey: true, defaultAiProvider: true, credits: true, creditsUsedTotal: true },
  });

  return {
    blogs,
    articles,
    hasOpenaiKey: !!shopData?.openaiApiKey,
    hasAnthropicKey: !!shopData?.anthropicApiKey,
    defaultAiProvider: shopData?.defaultAiProvider || "auto",
    credits: shopData?.credits ?? 100,
    creditsUsedTotal: shopData?.creditsUsedTotal ?? 0,
  };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create_blog_article") {
    const blogId = String(formData.get("blogId") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const articleType = String(formData.get("articleType") || "How-To Guide").trim();
    const language = String(formData.get("language") || "English").trim();
    const tone = String(formData.get("tone") || "professional").trim();
    const length = String(formData.get("length") || "500+ words").trim();
    const format = String(formData.get("format") || "headings and paragraphs").trim();
    const contextKeywords = String(formData.get("contextKeywords") || "").trim();
    const bodyPromptTemplate = String(formData.get("bodyPromptTemplate") || "").trim();
    const metaTitlePromptTemplate = String(formData.get("metaTitlePromptTemplate") || "").trim();
    const metaDescriptionPromptTemplate = String(formData.get("metaDescriptionPromptTemplate") || "").trim();
    const aiProvider = String(formData.get("aiProvider") || "auto").trim();
    const autoScheduleLive = String(formData.get("autoScheduleLive") || "false") === "true";
    const scheduleStartAtIso = String(formData.get("scheduleStartAtIso") || formData.get("scheduledAtIso") || "").trim();
    const scheduleEndAtIso = String(formData.get("scheduleEndAtIso") || "").trim();
    const imageAlt = String(formData.get("imageAlt") || "").trim();

    if (!blogId) return { success: false, intent, error: "Select a target blog first." };
    if (!title) return { success: false, intent, error: "Article title is required." };

    let scheduledAt = null;
    let scheduleStartAt = null;
    let scheduleEndAt = null;
    if (autoScheduleLive) {
      if (!scheduleStartAtIso) return { success: false, intent, error: "Select a start date and time." };
      if (!scheduleEndAtIso) return { success: false, intent, error: "Select an end date and time." };

      const parsedStartDate = new Date(scheduleStartAtIso);
      if (Number.isNaN(parsedStartDate.getTime())) {
        return { success: false, intent, error: "Invalid start date/time." };
      }

      const parsedEndDate = new Date(scheduleEndAtIso);
      if (Number.isNaN(parsedEndDate.getTime())) {
        return { success: false, intent, error: "Invalid end date/time." };
      }

      if (parsedStartDate.getTime() <= Date.now()) {
        return { success: false, intent, error: "Start date/time must be in the future." };
      }

      if (parsedEndDate.getTime() <= parsedStartDate.getTime()) {
        return { success: false, intent, error: "End date/time must be after start date/time." };
      }

      scheduleStartAt = parsedStartDate.toISOString();
      scheduleEndAt = parsedEndDate.toISOString();
      scheduledAt = scheduleStartAt;
    }

    const imageFile = formData.get("imageFile");
    let inlineImageMarkup = "";
    if (imageFile && typeof imageFile !== "string" && imageFile.size > 0) {
      if (!String(imageFile.type || "").startsWith("image/")) {
        return { success: false, intent, error: "Only image files are allowed." };
      }
      if (imageFile.size > MAX_INLINE_IMAGE_SIZE_BYTES) {
        return {
          success: false,
          intent,
          error: "Image is too large. Maximum allowed size is 2MB.",
        };
      }

      const bufferApi = globalThis.Buffer;
      if (!bufferApi) {
        return { success: false, intent, error: "Image processing is unavailable in this runtime." };
      }
      const buffer = bufferApi.from(await imageFile.arrayBuffer());
      const base64 = buffer.toString("base64");
      const resolvedAlt = cleanInlineText(imageAlt || title, 120);
      inlineImageMarkup =
        `<figure><img src="data:${imageFile.type};base64,${base64}" alt="${escapeHtml(resolvedAlt)}" loading="lazy" /></figure>`;
    }

    const shopData = await db.shop.findUnique({
      where: { shop: session.shop },
      select: { openaiApiKey: true, anthropicApiKey: true, credits: true, creditsUsedTotal: true },
    });
    const availableCredits = shopData?.credits ?? 100;
    if (availableCredits < BLOG_CREATE_CREDITS) {
      return {
        success: false,
        intent,
        error: buildInsufficientCreditsError(BLOG_CREATE_CREDITS, availableCredits),
      };
    }

    const input = buildGenerationPrompt({
      articleType,
      title,
      body: "",
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

    const parsed = parseGeneratedBlogJson(raw);
    const nextTitle = cleanInlineText(parsed.articleTitle || title, 255);
    const nextBody = normalizeGeneratedHtml(parsed.articleBody || "");
    const mergedBody = [inlineImageMarkup, nextBody].filter(Boolean).join("");
    if (!mergedBody) {
      return { success: false, intent, error: "Generated body was empty. Please try again." };
    }

    const nextExcerpt = cleanInlineText(parsed.excerpt || "", 255);
    const nextSeoTitle = cleanInlineText(parsed.seoTitle || "", 70);
    const nextSeoDescription = cleanInlineText(parsed.seoDescription || "", 160);

    const createArticleInput = {
      title: nextTitle,
      body: mergedBody,
      excerpt: nextExcerpt || undefined,
    };

    const createResponse = await admin.graphql(ARTICLE_CREATE_MUTATION, {
      variables: {
        blogId,
        article: createArticleInput,
      },
    });
    const createJson = await createResponse.json();
    const createGraphQLErrors = createJson?.errors || [];
    if (createGraphQLErrors.length > 0) {
      return {
        success: false,
        intent,
        error: createGraphQLErrors.map((err) => err.message).join(", "),
      };
    }
    const createErrors = createJson?.data?.articleCreate?.userErrors || [];
    if (createErrors.length > 0) {
      return {
        success: false,
        intent,
        error: createErrors.map((err) => err.message).join(", "),
      };
    }

    const createdArticle = createJson?.data?.articleCreate?.article;
    if (!createdArticle?.id) {
      return { success: false, intent, error: "Article was not created. Please try again." };
    }

    let scheduleApplied = false;
    let scheduleError = null;
    if (autoScheduleLive && scheduledAt) {
      const scheduleResponse = await admin.graphql(ARTICLE_UPDATE_MUTATION, {
        variables: {
          id: createdArticle.id,
          article: {
            isPublished: true,
            publishedAt: scheduledAt,
          },
        },
      });
      const scheduleJson = await scheduleResponse.json();
      const scheduleGraphQLErrors = scheduleJson?.errors || [];
      const scheduleUserErrors = scheduleJson?.data?.articleUpdate?.userErrors || [];

      if (scheduleGraphQLErrors.length > 0) {
        scheduleError = scheduleGraphQLErrors.map((err) => err.message).join(", ");
      } else if (scheduleUserErrors.length > 0) {
        scheduleError = scheduleUserErrors.map((err) => err.message).join(", ");
      } else {
        scheduleApplied = true;
      }
    }

    if (nextSeoTitle || nextSeoDescription) {
      const metafields = [];
      if (nextSeoTitle) {
        metafields.push({
          namespace: "global",
          key: "title_tag",
          value: nextSeoTitle,
          type: "single_line_text_field",
        });
      }
      if (nextSeoDescription) {
        metafields.push({
          namespace: "global",
          key: "description_tag",
          value: nextSeoDescription,
          type: "single_line_text_field",
        });
      }

      if (metafields.length > 0) {
        const updateResponse = await admin.graphql(ARTICLE_UPDATE_MUTATION, {
          variables: {
            id: createdArticle.id,
            article: { metafields },
          },
        });
        const updateJson = await updateResponse.json();
        const updateGraphQLErrors = updateJson?.errors || [];
        if (updateGraphQLErrors.length > 0) {
          return {
            success: false,
            intent,
            error: updateGraphQLErrors.map((err) => err.message).join(", "),
          };
        }
        const updateErrors = updateJson?.data?.articleUpdate?.userErrors || [];
        if (updateErrors.length > 0) {
          return {
            success: false,
            intent,
            error: updateErrors.map((err) => err.message).join(", "),
          };
        }
      }
    }

    await upsertBlogArticleContent({
      shop: session.shop,
      articleId: createdArticle.id,
      blogId,
      articleTitle: nextTitle || null,
      articleType: articleType || null,
      language: language || null,
      tone: tone || null,
      lengthOption: length || null,
      formatOption: format || null,
      contextKeywords: contextKeywords || null,
      bodyPromptTemplate: bodyPromptTemplate || null,
      metaTitlePromptTemplate: metaTitlePromptTemplate || null,
      metaDescriptionPromptTemplate: metaDescriptionPromptTemplate || null,
      scheduleRequested: Boolean(autoScheduleLive),
      scheduledFor: autoScheduleLive && scheduledAt ? new Date(scheduledAt) : null,
      scheduleStartAt: autoScheduleLive && scheduleStartAt ? new Date(scheduleStartAt) : null,
      scheduleEndAt: autoScheduleLive && scheduleEndAt ? new Date(scheduleEndAt) : null,
      scheduleStatus: autoScheduleLive ? (scheduleApplied ? "scheduled" : scheduleError ? "failed" : "requested") : "draft",
      imageAltText: imageAlt ? cleanInlineText(imageAlt, 255) : null,
      hasInlineImage: Boolean(inlineImageMarkup),
      aiModel: aiProvider || null,
      bodyHtml: mergedBody || null,
      seoTitle: nextSeoTitle || null,
      seoDescription: nextSeoDescription || null,
      creditsUsed: BLOG_CREATE_CREDITS,
      isPublished: Boolean(scheduleApplied || createdArticle?.publishedAt),
      appliedToShopify: true,
    });

    await writeGenerationLog({
      shop: session.shop,
      productId: createdArticle.id,
      productTitle: nextTitle || null,
      intent: "blog_create_article",
      resourceType: "blog",
      language: language || null,
      tone: tone || null,
      lengthOption: length || null,
      formatOption: format || null,
      contextKeywords: contextKeywords || null,
      aiModel: aiProvider || null,
      generatedDescription: mergedBody || null,
      generatedSeoTitle: nextSeoTitle || null,
      generatedSeoDescription: nextSeoDescription || null,
      creditsUsed: BLOG_CREATE_CREDITS,
      appliedToProduct: true,
    });

    let newCredits = availableCredits;
    let creditsUsedTotal = shopData?.creditsUsedTotal ?? 0;
    let creditWarning = null;
    try {
      const creditSnapshot = await deductCredits({
        shopDomain: session.shop,
        creditsUsed: BLOG_CREATE_CREDITS,
      });
      newCredits = creditSnapshot.credits;
      creditsUsedTotal = creditSnapshot.creditsUsedTotal;
    } catch (creditError) {
      creditWarning = creditError?.message || "Credits could not be updated automatically.";
    }

    return {
      success: true,
      intent,
      articleId: createdArticle.id,
      title: createdArticle.title || nextTitle,
      publishedAt: scheduleApplied ? scheduledAt : createdArticle.publishedAt || null,
      scheduleApplied,
      scheduleError,
      creditsUsed: BLOG_CREATE_CREDITS,
      newCredits,
      creditsUsedTotal,
      creditWarning,
    };
  }

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
    const contextKeywords = formData.get("contextKeywords") || "";
    const aiProvider = formData.get("aiProvider") || "auto";
    const selectedContentTypes = parseSelectedContentTypes(
      formData.get("contentTypes"),
      BLOG_CONTENT_TYPES,
      DEFAULT_BLOG_CONTENT_TYPES,
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
    const requiredCredits = creditsForBatch(selectedContentTypes, bulkArticles.length);
    if (availableCredits < requiredCredits) {
      return {
        success: false,
        intent,
        error: buildInsufficientCreditsError(requiredCredits, availableCredits),
      };
    }

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
        const parsed = parseGeneratedBlogJson(raw);
        const nextBody = shouldUpdateBody
          ? normalizeGeneratedHtml(parsed.articleBody || a.body || "")
          : a.body || "";
        const nextSeoTitle = shouldUpdateMetaTitle
          ? cleanInlineText(parsed.seoTitle || "", 70)
          : cleanInlineText(a.seoTitleValue || "", 70);
        const nextSeoDescription = shouldUpdateMetaDescription
          ? cleanInlineText(parsed.seoDescription || "", 160)
          : cleanInlineText(a.seoDescriptionValue || "", 160);

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
            contextKeywords: contextKeywords || null,
            bodyPromptTemplate: bodyPromptTemplate || null,
            metaTitlePromptTemplate: metaTitlePromptTemplate || null,
            metaDescriptionPromptTemplate: metaDescriptionPromptTemplate || null,
            aiModel: aiProvider || null,
            bodyHtml: nextBody || null,
            seoTitle: nextSeoTitle || null,
            seoDescription: nextSeoDescription || null,
            creditsUsed: creditsPerItem,
            isPublished: false,
            appliedToShopify: true,
          });

          await writeGenerationLog({
            shop: session.shop,
            productId: a.id,
            productTitle: a.title || null,
            intent: "blog_bulk_generate",
            resourceType: "blog",
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
        }
        return { id: a.id, title: a.title, seoTitle: nextSeoTitle, seoDescription: nextSeoDescription };
      }),
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
      id: bulkArticles[i].id,
      title: bulkArticles[i].title,
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
      total: bulkArticles.length,
      results: itemResults,
      contentTypes: selectedContentTypes,
      creditsPerItem,
      creditsUsed,
      newCredits,
      creditsUsedTotal,
      creditWarning,
    };
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


const TONE_OPTIONS = [
  { label: "Professional", value: "professional" },
  { label: "Friendly", value: "friendly" },
  { label: "Casual", value: "casual" },
  { label: "Formal", value: "formal" },
  { label: "Enthusiastic", value: "enthusiastic" },
  { label: "Informative", value: "informative" },
];

const LENGTH_OPTIONS = [
  { label: "500+ words", value: "500+ words" },
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
  const createFetcher = useFetcher();
  const bulkFetcher = useFetcher();
  const isCreatingArticle = createFetcher.state !== "idle";
  const isBulkGenerating = bulkFetcher.state !== "idle";

  const shopify = useAppBridge();

  const preferredCreateTemplateId = "blog-body-500-plus";
  const preferredCreateTemplate =
    BLOG_BODY_TEMPLATES.find((template) => template.id === preferredCreateTemplateId)?.template ||
    BLOG_BODY_TEMPLATES[0]?.template ||
    "";

  // —— Create article state ——————————————————————————————————————————————
  const [createBlogId, setCreateBlogId] = useState(blogs?.[0]?.id || "");
  const [createTitle, setCreateTitle] = useState("");
  const [createArticleType, setCreateArticleType] = useState("How-To Guide");
  const [createTone, setCreateTone] = useState(readGlobalSettings().tone || "professional");
  const [createLength, setCreateLength] = useState("500+ words");
  const [createFormat, setCreateFormat] = useState("headings and paragraphs");
  const [createKeywords, setCreateKeywords] = useState("");
  const [createBodyTemplateId, setCreateBodyTemplateId] = useState(preferredCreateTemplateId);
  const [createBodyPromptTemplate, setCreateBodyPromptTemplate] = useState(preferredCreateTemplate);
  const [createMetaTitleTemplateId, setCreateMetaTitleTemplateId] = useState("");
  const [createMetaTitlePromptTemplate, setCreateMetaTitlePromptTemplate] = useState("");
  const [createMetaDescTemplateId, setCreateMetaDescTemplateId] = useState("");
  const [createMetaDescPromptTemplate, setCreateMetaDescPromptTemplate] = useState("");
  const [createImageFile, setCreateImageFile] = useState(null);
  const [createImageAlt, setCreateImageAlt] = useState("");
  const [autoScheduleLive, setAutoScheduleLive] = useState(false);
  const [scheduleStartAtLocal, setScheduleStartAtLocal] = useState(() => getDefaultScheduleRangeInputs().start);
  const [scheduleEndAtLocal, setScheduleEndAtLocal] = useState(() => getDefaultScheduleRangeInputs().end);
  const [createMessage, setCreateMessage] = useState(null);
  const [isCreateAccordionOpen, setIsCreateAccordionOpen] = useState(false);

  // ── Bulk state ──────────────────────────────────────────────────────────────
  const [bulkContentTypes, setBulkContentTypes] = useState(["body"]);
  const [bulkSettings, setBulkSettings] = useState(() => {
    const gs = readGlobalSettings();
    return {
      tone: gs.tone || "professional",
      length: gs.length || "medium",
      format: "headings and paragraphs",
      articleType: "How-To Guide",
      aiProvider: gs.aiProvider || defaultAiProvider || "auto",
    };
  });
  const [selectedBodyTemplateId, setSelectedBodyTemplateId] = useState("");
  const [selectedMetaDescTemplateId, setSelectedMetaDescTemplateId] = useState("");
  const [selectedMetaTitleTemplateId, setSelectedMetaTitleTemplateId] = useState("");
  const [bulkBodyPromptTemplate, setBulkBodyPromptTemplate] = useState("");
  const [bulkMetaDescPromptTemplate, setBulkMetaDescPromptTemplate] = useState("");
  const [bulkMetaTitlePromptTemplate, setBulkMetaTitlePromptTemplate] = useState("");
  const [bulkValidationMessage, setBulkValidationMessage] = useState(null);
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkBodyKeywords, setBulkBodyKeywords] = useState(() => readGlobalSettings().blogContentKeywords || "");
  const [bulkMetaTitleKeywords, setBulkMetaTitleKeywords] = useState(() => readGlobalSettings().blogMetaTitleKeywords || "");
  const [bulkMetaDescKeywords, setBulkMetaDescKeywords] = useState(() => readGlobalSettings().blogMetaDescKeywords || "");

  const [filterBlogId, setFilterBlogId] = useState("all");

  const blogFilterOptions = [
    { label: "All Blogs", value: "all" },
    ...blogs.map((b) => ({ label: b.title, value: b.id })),
  ];
  const createBlogOptions = blogs.length > 0
    ? blogs.map((b) => ({ label: b.title, value: b.id }))
    : [{ label: "No blogs found", value: "" }];

  const filteredArticles =
    filterBlogId === "all"
      ? articles
      : articles.filter((a) => a.blog?.id === filterBlogId);

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(filteredArticles);

  const selectedArticles = filteredArticles.filter((a) => selectedResources.includes(a.id));

  function handleCreateArticle() {
    if (!createBlogId) {
      setCreateMessage({ tone: "critical", text: "Please select a blog." });
      return;
    }
    if (!createTitle.trim()) {
      setCreateMessage({ tone: "critical", text: "Please enter a blog title." });
      return;
    }

    const payload = new FormData();
    payload.append("intent", "create_blog_article");
    payload.append("blogId", createBlogId);
    payload.append("title", createTitle.trim());
    payload.append("articleType", createArticleType);
    payload.append("language", readGlobalSettings().language || "English");
    payload.append("tone", createTone);
    payload.append("length", createLength);
    payload.append("format", createFormat);
    payload.append("contextKeywords", createKeywords || "");
    payload.append("bodyPromptTemplate", createBodyPromptTemplate || "");
    payload.append("metaTitlePromptTemplate", createMetaTitlePromptTemplate || "");
    payload.append("metaDescriptionPromptTemplate", createMetaDescPromptTemplate || "");
    payload.append("aiProvider", defaultAiProvider || "auto");
    payload.append("imageAlt", createImageAlt || "");
    payload.append("autoScheduleLive", String(autoScheduleLive));

    if (autoScheduleLive) {
      if (!scheduleStartAtLocal) {
        setCreateMessage({ tone: "critical", text: "Please set a start date/time." });
        return;
      }
      if (!scheduleEndAtLocal) {
        setCreateMessage({ tone: "critical", text: "Please set an end date/time." });
        return;
      }
      const scheduleStartDate = new Date(scheduleStartAtLocal);
      if (Number.isNaN(scheduleStartDate.getTime())) {
        setCreateMessage({ tone: "critical", text: "Invalid start date/time." });
        return;
      }
      const scheduleEndDate = new Date(scheduleEndAtLocal);
      if (Number.isNaN(scheduleEndDate.getTime())) {
        setCreateMessage({ tone: "critical", text: "Invalid end date/time." });
        return;
      }
      if (scheduleStartDate.getTime() <= Date.now()) {
        setCreateMessage({ tone: "critical", text: "Start date/time must be in the future." });
        return;
      }
      if (scheduleEndDate.getTime() <= scheduleStartDate.getTime()) {
        setCreateMessage({ tone: "critical", text: "End date/time must be after start date/time." });
        return;
      }
      payload.append("scheduleStartAtIso", scheduleStartDate.toISOString());
      payload.append("scheduleEndAtIso", scheduleEndDate.toISOString());
      payload.append("scheduledAtIso", scheduleStartDate.toISOString());
    }

    if (createImageFile) {
      payload.append("imageFile", createImageFile);
    }

    setCreateMessage(null);
    createFetcher.submit(payload, { method: "post", encType: "multipart/form-data" });
  }

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
        seoTitleValue: a.seo?.title || "",
        seoDescriptionValue: a.seo?.description || "",
      }))
    ));
    payload.append("language", readGlobalSettings().language || "English");
    payload.append("tone", bulkSettings.tone);
    payload.append("length", bulkSettings.length);
    payload.append("format", bulkSettings.format);
    payload.append("articleType", bulkSettings.articleType);
    payload.append("bodyKeywords", bulkBodyKeywords || "");
    payload.append("metaTitleKeywords", bulkMetaTitleKeywords || "");
    payload.append("metaDescKeywords", bulkMetaDescKeywords || "");
    payload.append("contextKeywords", [bulkBodyKeywords, bulkMetaTitleKeywords, bulkMetaDescKeywords].filter(Boolean).join(", "));
    payload.append("bodyPromptTemplate", bulkBodyPromptTemplate);
    payload.append("metaTitlePromptTemplate", bulkMetaTitlePromptTemplate);
    payload.append("metaDescriptionPromptTemplate", bulkMetaDescPromptTemplate);
    payload.append("contentTypes", JSON.stringify(bulkContentTypes));
    payload.append("aiProvider", bulkSettings.aiProvider || defaultAiProvider || "auto");
    bulkFetcher.submit(payload, { method: "post" });
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
      shopify.toast.show(`Generated ${data.succeeded}/${data.total} articles successfully.${creditsMessage}`);
    } else {
      setBulkValidationMessage(data.error || "Bulk generation failed.");
    }
  }, [bulkFetcher.data, bulkFetcher.state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!createBlogId && blogs.length > 0) {
      setCreateBlogId(blogs[0].id);
    }
  }, [blogs, createBlogId]);

  useEffect(() => {
    const data = createFetcher.data;
    if (!data || createFetcher.state !== "idle") return;
    if (data.intent !== "create_blog_article") return;

    if (data.success) {
      const scheduleLabel = data.publishedAt ? ` Scheduled/published at ${new Date(data.publishedAt).toLocaleString()}.` : "";
      const warningMessages = [
        data.scheduleError ? `Scheduling was not applied: ${data.scheduleError}` : null,
        data.creditWarning ? `Credit update warning: ${data.creditWarning}` : null,
      ].filter(Boolean);
      const creditLabel =
        typeof data.creditsUsed === "number"
          ? ` ${data.creditsUsed} credits used${typeof data.newCredits === "number" ? `. Remaining: ${data.newCredits}` : ""}.`
          : "";
      setCreateMessage({
        tone: warningMessages.length > 0 ? "warning" : "success",
        text: warningMessages.length > 0
          ? `Blog article "${data.title}" created. ${warningMessages.join(" ")}${creditLabel}`
          : `Blog article "${data.title}" created successfully.${scheduleLabel}${creditLabel}`,
      });
      setCreateTitle("");
      setCreateKeywords("");
      setCreateImageAlt("");
      setCreateImageFile(null);
      setAutoScheduleLive(false);
      const defaults = getDefaultScheduleRangeInputs();
      setScheduleStartAtLocal(defaults.start);
      setScheduleEndAtLocal(defaults.end);
      shopify.toast.show(`Blog article created.${creditLabel}`);
    } else {
      setCreateMessage({
        tone: "critical",
        text: data.error || "Failed to create blog article.",
      });
    }
  }, [createFetcher.data, createFetcher.state, shopify]);

  useEffect(() => {
    const templateSelection = readStoredBlogPromptTemplateSelection();
    if (templateSelection.bodyPromptTemplate) setBulkBodyPromptTemplate(templateSelection.bodyPromptTemplate);
    if (templateSelection.metaTitlePromptTemplate) setBulkMetaTitlePromptTemplate(templateSelection.metaTitlePromptTemplate);
    if (templateSelection.metaDescriptionPromptTemplate) setBulkMetaDescPromptTemplate(templateSelection.metaDescriptionPromptTemplate);
  }, []);

  const rowMarkup = filteredArticles.map((article, index) => {
    const shortStatus = evaluateContentShortStatus(stripHtml(article.body || ""));

    return (
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
          <Badge tone={shortStatus.tone}>{shortStatus.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {article.publishedAt
            ? <Badge tone="success">Published</Badge>
            : <Badge tone="attention">Draft</Badge>}
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

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
            <div style={{ width: "46px", height: "46px", borderRadius: "6px", background: "rgba(236,72,153,0.2)", border: "1px solid rgba(236,72,153,0.4)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon source={BlogIcon} tone="base" />
            </div>
            <div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#ffffff", marginBottom: "3px", letterSpacing: "-0.3px" }}>Blog Posts</div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.55)", lineHeight: 1.4 }}>Generate and manage AI content for your Shopify blog articles</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", "--p-color-text": "#fff", "--p-color-bg-fill": "rgba(255,255,255,0.08)", "--p-color-border": "rgba(255,255,255,0.25)" }}>
            <Button onClick={() => navigate("/app/content-management?tab=blog&filter=all")} variant="secondary" size="slim">Open Text Editor</Button>
            <Button onClick={() => navigate("/app")} variant="secondary" size="slim">Back Dashboard</Button>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: "16px" }}>
        <Card>
          <BlockStack gap="300">
            <button
              type="button"
              onClick={() => setIsCreateAccordionOpen((prev) => !prev)}
              aria-expanded={isCreateAccordionOpen}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd" fontWeight="bold">New Create Blog</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Generate a new blog article using the 500+ words template, optionally attach an image, and auto schedule it live.
                  </Text>
                </BlockStack>
                <Text as="span" variant="headingMd" fontWeight="bold">
                  {isCreateAccordionOpen ? "-" : "+"}
                </Text>
              </InlineStack>
            </button>

            {isCreateAccordionOpen && (
              <>
            {createMessage && (
              <Banner tone={createMessage.tone}>
                <p>{createMessage.text}</p>
              </Banner>
            )}

            <div
              style={{
                display: "grid",
                gap: "12px",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              }}
            >
              <TextField
                label="Blog Title"
                value={createTitle}
                onChange={setCreateTitle}
                placeholder="e.g. 10 Ways to Improve Product Descriptions"
                autoComplete="off"
              />
              <Select
                label="Target Blog"
                options={createBlogOptions}
                value={createBlogId}
                onChange={setCreateBlogId}
              />
              <Select
                label="Article Type"
                options={ARTICLE_TYPE_OPTIONS}
                value={createArticleType}
                onChange={setCreateArticleType}
              />
              <Select
                label="Tone"
                options={TONE_OPTIONS}
                value={createTone}
                onChange={setCreateTone}
              />
              <Select
                label="Length"
                options={LENGTH_OPTIONS}
                value={createLength}
                onChange={setCreateLength}
              />
              <Select
                label="Format"
                options={FORMAT_OPTIONS}
                value={createFormat}
                onChange={setCreateFormat}
              />
              <Select
                label="Body Prompt Template"
                options={BLOG_BODY_TEMPLATES.map((template) => ({ label: template.name, value: template.id }))}
                value={createBodyTemplateId}
                onChange={(id) => {
                  setCreateBodyTemplateId(id);
                  setCreateBodyPromptTemplate(BLOG_BODY_TEMPLATES.find((template) => template.id === id)?.template || "");
                }}
              />
              <Select
                label="Meta Title Template"
                options={[{ label: "— Default (no template) —", value: "" }, ...BLOG_META_TITLE_TEMPLATES.map((template) => ({ label: template.name, value: template.id }))]}
                value={createMetaTitleTemplateId}
                onChange={(id) => {
                  setCreateMetaTitleTemplateId(id);
                  setCreateMetaTitlePromptTemplate(BLOG_META_TITLE_TEMPLATES.find((template) => template.id === id)?.template || "");
                }}
              />
              <Select
                label="Meta Description Template"
                options={[{ label: "— Default (no template) —", value: "" }, ...BLOG_META_DESCRIPTION_TEMPLATES.map((template) => ({ label: template.name, value: template.id }))]}
                value={createMetaDescTemplateId}
                onChange={(id) => {
                  setCreateMetaDescTemplateId(id);
                  setCreateMetaDescPromptTemplate(BLOG_META_DESCRIPTION_TEMPLATES.find((template) => template.id === id)?.template || "");
                }}
              />
              <TextField
                label="Context Keywords"
                value={createKeywords}
                onChange={setCreateKeywords}
                placeholder="e.g. ecommerce SEO, product storytelling, conversions"
                autoComplete="off"
              />
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "grid",
                  gap: "12px",
                  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                  alignItems: "end",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", minHeight: "56px" }}>
                  <Checkbox
                    label="Auto Schedule Live"
                    checked={autoScheduleLive}
                    onChange={setAutoScheduleLive}
                  />
                </div>
                <TextField
                  label="Start Date"
                  type="datetime-local"
                  value={scheduleStartAtLocal}
                  onChange={setScheduleStartAtLocal}
                  autoComplete="off"
                  disabled={!autoScheduleLive}
                  helpText={autoScheduleLive ? "Article will go live automatically at this date/time." : "Enable Auto Schedule Live to set start date/time."}
                />
                <TextField
                  label="End Date"
                  type="datetime-local"
                  value={scheduleEndAtLocal}
                  onChange={setScheduleEndAtLocal}
                  autoComplete="off"
                  disabled={!autoScheduleLive}
                  helpText={autoScheduleLive ? "Scheduling range end for this generated article." : "Enable Auto Schedule Live to set end date/time."}
                />
                <TextField
                  label="Image Alt Text"
                  value={createImageAlt}
                  onChange={setCreateImageAlt}
                  placeholder="Describe uploaded image"
                  autoComplete="off"
                />
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", justifyContent: "center" }}>
                  <Text as="span" variant="bodySm" fontWeight="medium">Image Upload</Text>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => setCreateImageFile(event.target.files?.[0] || null)}
                  />
                  <Text as="span" variant="bodySm" tone="subdued">
                    {createImageFile ? `${createImageFile.name} (${Math.round(createImageFile.size / 1024)} KB)` : "Optional. Max 2MB."}
                  </Text>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button
                variant="primary"
                tone="success"
                loading={isCreatingArticle}
                disabled={isCreatingArticle || blogs.length === 0}
                onClick={handleCreateArticle}
              >
                Create Blog
              </Button>
            </div>
              </>
            )}
          </BlockStack>
        </Card>
      </div>

      <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>

        {/* ── LEFT: Article List ── */}
        <div style={{ flex: 7, minWidth: 0 }}>
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
                { title: "Short" },
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
        <div style={{ flex: 3, minWidth: 0 }}>
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

            {/* Body Template Section */}
            {bulkContentTypes.includes("body") && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
                <Text as="h3" variant="headingSm" fontWeight="semibold">Body</Text>
                <div style={{ marginTop: "8px" }}>
                  <Select
                    label="Template" labelHidden
                    options={[{ label: "— Default (no template) —", value: "" }, ...BLOG_BODY_TEMPLATES.map((t) => ({ label: t.name, value: t.id }))]}
                    value={selectedBodyTemplateId}
                    onChange={(id) => { setSelectedBodyTemplateId(id); setBulkBodyPromptTemplate(BLOG_BODY_TEMPLATES.find((t) => t.id === id)?.template || ""); }}
                  />
                </div>
                <div style={{ marginTop: "8px" }}>
                  <TextField
                    label="Body Keywords"
                    value={bulkBodyKeywords}
                    onChange={setBulkBodyKeywords}
                    placeholder="e.g. tips, guide, how-to"
                    helpText="Keywords specific to article body content"
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
                    options={[{ label: "— Default (no template) —", value: "" }, ...BLOG_META_DESCRIPTION_TEMPLATES.map((t) => ({ label: t.name, value: t.id }))]}
                    value={selectedMetaDescTemplateId}
                    onChange={(id) => { setSelectedMetaDescTemplateId(id); setBulkMetaDescPromptTemplate(BLOG_META_DESCRIPTION_TEMPLATES.find((t) => t.id === id)?.template || ""); }}
                  />
                </div>
                <div style={{ marginTop: "8px" }}>
                  <TextField
                    label="Meta Desc Keywords"
                    value={bulkMetaDescKeywords}
                    onChange={setBulkMetaDescKeywords}
                    placeholder="e.g. read more, in-depth"
                    helpText="Keywords specific to meta descriptions"
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
                    options={[{ label: "— Default (no template) —", value: "" }, ...BLOG_META_TITLE_TEMPLATES.map((t) => ({ label: t.name, value: t.id }))]}
                    value={selectedMetaTitleTemplateId}
                    onChange={(id) => { setSelectedMetaTitleTemplateId(id); setBulkMetaTitlePromptTemplate(BLOG_META_TITLE_TEMPLATES.find((t) => t.id === id)?.template || ""); }}
                  />
                </div>
                <div style={{ marginTop: "8px" }}>
                  <TextField
                    label="Meta Title Keywords"
                    value={bulkMetaTitleKeywords}
                    onChange={setBulkMetaTitleKeywords}
                    placeholder="e.g. best, top, ultimate"
                    helpText="Keywords specific to meta titles"
                    autoComplete="off"
                  />
                </div>
              </div>
            )}

            {/* Article Type */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border)" }}>
              <Select
                label="Article Type"
                options={ARTICLE_TYPE_OPTIONS}
                value={bulkSettings.articleType}
                onChange={(v) => setBulkSettings((s) => ({ ...s, articleType: v }))}
              />
            </div>

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
                  {bulkResult.succeeded} article{bulkResult.succeeded !== 1 ? "s" : ""} updated · {bulkResult.failed > 0 ? `${bulkResult.failed} failed · ` : ""}{bulkResult.creditsUsed ?? 0} AI credits used
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

    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

