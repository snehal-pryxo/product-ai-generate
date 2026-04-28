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

const PRODUCT_BY_HANDLE_QUERY = `#graphql
  query ProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      title
      handle
      description
      descriptionHtml
      productType
      vendor
    }
  }
`;

const ARTICLE_CREATE_MUTATION = `#graphql
  mutation ArticleCreate($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
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

function getDefaultAuthorName(shopDomain) {
  const raw = cleanText(shopDomain).split(".myshopify.com")[0] || "";
  const words = raw
    .split(/[-_\s]+/)
    .map((part) => cleanText(part))
    .filter(Boolean);
  if (!words.length) return "Shop Now";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
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

function normalizeProductUrl(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function titleCaseFromSlug(value) {
  return cleanText(value)
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[-_+/%\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (["ai", "seo", "url", "api", "sms", "faq"].includes(lower)) return lower.toUpperCase();
      if (lower === "chatgpt") return "ChatGPT";
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function extractProductHandleFromUrl(productUrl) {
  const normalizedUrl = normalizeProductUrl(productUrl);
  if (!normalizedUrl) return "";
  try {
    const parsed = new URL(normalizedUrl);
    const parts = parsed.pathname.split("/").map((part) => part.trim()).filter(Boolean);
    const productIndex = parts.findIndex((part) => part.toLowerCase() === "products");
    if (productIndex >= 0 && parts[productIndex + 1]) return decodeURIComponent(parts[productIndex + 1]);
    return parts.length ? decodeURIComponent(parts[parts.length - 1]) : "";
  } catch {
    return "";
  }
}

function inferProductContextFromUrl(productUrl) {
  const handle = extractProductHandleFromUrl(productUrl);
  return {
    handle,
    title: titleCaseFromSlug(handle),
    description: "",
    productType: "",
    vendor: "",
  };
}

async function resolveProductContext(admin, productUrl) {
  const fallback = inferProductContextFromUrl(productUrl);
  if (!fallback.handle) return fallback;

  try {
    const response = await admin.graphql(PRODUCT_BY_HANDLE_QUERY, {
      variables: { handle: fallback.handle },
    });
    const json = await response.json();
    const product = json?.data?.productByHandle;
    if (!product) return fallback;
    return {
      handle: cleanText(product.handle) || fallback.handle,
      title: cleanText(product.title) || fallback.title,
      description: stripHtml(product.descriptionHtml || product.description || ""),
      productType: cleanText(product.productType),
      vendor: cleanText(product.vendor),
    };
  } catch (error) {
    console.error("Failed to resolve blog product context", error);
    return fallback;
  }
}

function appendProductCtaAndLink(bodyHtml, productUrl) {
  const normalizedBody = normalizeBodyHtml(bodyHtml || "");
  const normalizedUrl = normalizeProductUrl(productUrl);
  if (!normalizedUrl) return normalizedBody;

  if (/>\s*Shop\s*Now\s*<\/a>/i.test(normalizedBody)) {
    return normalizedBody;
  }

  const escapedUrl = escapeHtml(normalizedUrl);
  const ctaHtml = `<p><a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">Shop Now</a></p>`;
  return `${normalizedBody}${ctaHtml}`;
}

function formatPromotionOffer(promotion, offerText) {
  const cleanPromotion = cleanText(promotion);
  const cleanOffer = cleanText(offerText);
  if (!cleanOffer || !cleanPromotion || cleanPromotion === "No promotion") return cleanPromotion;
  return `${cleanPromotion} - ${cleanOffer}`;
}

function isDiscountPromotion(promotion) {
  const value = cleanText(promotion).toLowerCase();
  if (!value || value === "no promotion") return false;
  if (
    value === "buy one get one free (bogo)" ||
    value === "free shipping" ||
    value === "gift with purchase" ||
    value === "mystery discount" ||
    value === "free trial"
  ) {
    return false;
  }
  return /(discount|off|sale|offer|bundle|quantity)/i.test(value);
}

function getDefaultOfferText(promotion) {
  const value = cleanText(promotion);
  const exampleMatch = value.match(/\bi\.e\.\s*(.+)$/i);
  if (exampleMatch?.[1]) return cleanText(exampleMatch[1]);
  if (/percentage discount/i.test(value)) return "20% off";
  if (/dollar discount/i.test(value)) return "$10 off";
  if (/flash sale/i.test(value)) return "30% off";
  if (/clearance sale/i.test(value)) return "50% off";
  if (/bundle discount/i.test(value)) return "3+1";
  if (/quantity discount/i.test(value)) return "buy 3 get 20% off";
  if (/limited-time offer/i.test(value)) return "25% off";
  if (/seasonal sale/i.test(value)) return "25% off";
  if (/holiday sale/i.test(value)) return "35% off";
  if (/vip-only offer/i.test(value)) return "40% off";
  return "";
}

function includeCampaignDetails(bodyHtml, { promotion, offerText, holiday, tabType }) {
  const normalizedBody = normalizeBodyHtml(bodyHtml || "");
  const promotionOffer = formatPromotionOffer(promotion, offerText);
  const cleanHoliday = cleanText(holiday);
  const cleanOfferText = cleanText(offerText);
  const shouldMentionHoliday =
    tabType === TAB_KEYS.HOLIDAY && cleanHoliday && cleanHoliday !== "Choose a holiday to promote";
  const shouldMentionPromotion = promotionOffer && promotionOffer !== "No promotion";
  if (!shouldMentionHoliday && !shouldMentionPromotion) return normalizedBody;

  const bodyText = stripHtml(normalizedBody).toLowerCase();
  const holidayMissing = shouldMentionHoliday && !bodyText.includes(cleanHoliday.toLowerCase());
  const promotionMissing = shouldMentionPromotion && !bodyText.includes(promotionOffer.toLowerCase());
  const offerMissing = cleanOfferText && !bodyText.includes(cleanOfferText.toLowerCase());
  if (!holidayMissing && !promotionMissing && !offerMissing) return normalizedBody;

  const parts = [];
  if (shouldMentionHoliday && holidayMissing) {
    parts.push(
      `<h2>${escapeHtml(cleanHoliday)} Special</h2>`,
      `<p>This ${escapeHtml(cleanHoliday)} we have something extra to celebrate. Whether you are shopping for yourself or finding the perfect gift, our ${escapeHtml(cleanHoliday)} collection is curated to bring joy to everyone on your list.</p>`,
    );
  }
  if (shouldMentionPromotion && (promotionMissing || offerMissing)) {
    const offerLine = cleanOfferText
      ? `Our current offer is <strong>${escapeHtml(cleanOfferText)}</strong> — `
      : "";
    parts.push(
      `<h2>Exclusive Offer${cleanOfferText ? `: ${escapeHtml(cleanOfferText)}` : ""}</h2>`,
      `<p>${offerLine}take advantage of our <strong>${escapeHtml(promotionOffer)}</strong> promotion. This is a limited-time deal, so act now before it expires.</p>`,
    );
  }
  if (!parts.length) return normalizedBody;

  return `${normalizedBody}${parts.join("")}`;
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

function buildBlogHtml({
  title,
  topic,
  tone,
  audience,
  promotion,
  offerText,
  holiday,
  tabType,
  postLength = "medium",
  productUrl = "",
  productContext = null,
}) {
  const primaryTopic = cleanText(topic) || cleanText(title) || "our store";
  const productName = cleanText(productContext?.title) || primaryTopic;
  const productDescription = cleanText(productContext?.description);
  const safeTitle = escapeHtml(cleanText(title) || primaryTopic);
  const safeProductName = escapeHtml(productName);
  const safeProductDescription = escapeHtml(productDescription);
  const safeTone = escapeHtml(cleanText(tone) || "Casual");
  const safeAudience = escapeHtml(cleanText(audience) || "Everyone");
  const safeOfferText = escapeHtml(cleanText(offerText));
  const safePromotionOffer = escapeHtml(formatPromotionOffer(promotion, offerText));
  const safeHoliday = escapeHtml(cleanText(holiday));
  const hasHolidaySection =
    tabType === TAB_KEYS.HOLIDAY && safeHoliday && safeHoliday !== "Choose a holiday to promote";
  const hasPromotionSection = safePromotionOffer && safePromotionOffer !== "No promotion";
  const wordRange = getWordRange(postLength);

  // Opening paragraph — holiday/offer hook + product name + description + audience
  let introHtml;
  if (hasHolidaySection && hasPromotionSection) {
    introHtml = `<p>${safeOfferText ? `Unwrap the joy of savings this ${safeHoliday} with ${safeOfferText} at ${safeProductName}!` : `Celebrate ${safeHoliday} with exclusive savings at ${safeProductName}!`} ${safeProductDescription ? `${safeProductDescription}` : `Our curated collection is perfect for ${safeAudience.toLowerCase()} who want the best this season.`} Discover our ${safeHoliday} collection — thoughtfully designed to help ${safeAudience.toLowerCase()} customers celebrate, gift, and shop with confidence.</p>`;
  } else if (hasPromotionSection) {
    introHtml = `<p>${safeOfferText ? `Save ${safeOfferText} at ${safeProductName} — a ${safeTone.toLowerCase()} deal crafted for ${safeAudience.toLowerCase()} shoppers like you.` : `${safeProductName} is running an exclusive promotion designed to give ${safeAudience.toLowerCase()} customers more value.`} ${safeProductDescription ? safeProductDescription : `Browse our collection and discover products tailored to your needs.`} Take advantage of our <strong>${safePromotionOffer}</strong> and explore everything ${safeProductName} has to offer.</p>`;
  } else {
    introHtml = safeProductDescription
      ? `<p>${safeProductDescription} At ${safeProductName}, every product is curated with ${safeAudience.toLowerCase()} customers in mind — so you always find what you are looking for. Read on to discover our collection and why ${safeProductName} is the right choice for you.</p>`
      : `<p>Welcome to ${safeProductName} — a store built for ${safeAudience.toLowerCase()} customers who expect quality, value, and a ${safeTone.toLowerCase()} shopping experience. Explore our collection and find out why thousands of shoppers choose ${safeProductName} every day.</p>`;
  }

  const sections = [`<h1>${safeTitle}</h1>`, introHtml];

  // "Why Choose [Product]?" — universal section
  sections.push(
    `<h2>Why Choose ${safeProductName}?</h2>`,
    `<p>${safeProductName} is designed to enhance your shopping experience. ${safeProductDescription ? safeProductDescription : `With a carefully curated product range, ${safeProductName} delivers on quality, reliability, and style — exactly what ${safeAudience.toLowerCase()} shoppers deserve.`}</p>`,
    `<p>Whether you are shopping for yourself or finding a gift for someone special, ${safeProductName} makes the process straightforward, enjoyable, and rewarding. Our products are selected to meet real needs and exceed expectations.</p>`,
  );

  // Feature/benefit section — varies by tab
  if (hasHolidaySection) {
    sections.push(
      `<h2>${safeHoliday} Shopping Made Easy</h2>`,
      `<p>This ${safeHoliday} season, make shopping a breeze for yourself and your loved ones. At ${safeProductName}, we have brought together the best of our collection so that ${safeAudience.toLowerCase()} customers can find exactly what they need — without the last-minute rush.</p>`,
      `<p>From thoughtful gifts to everyday essentials, every item in our ${safeHoliday} selection has been chosen to bring joy. Shop early, shop smart, and let ${safeProductName} handle the rest.</p>`,
    );
  } else if (hasPromotionSection) {
    sections.push(
      `<h2>Save More with ${safeProductName}</h2>`,
      `<p>One of the best reasons to shop at ${safeProductName} right now is our current promotion. We believe ${safeAudience.toLowerCase()} customers should always get the best value — and our <strong>${safePromotionOffer}</strong> is our way of making that happen.</p>`,
      `<p>When you take advantage of this deal, you are not just saving money — you are getting access to the same quality products that ${safeProductName} is known for, at a price that works for you.</p>`,
    );
  } else if (tabType === TAB_KEYS.CUSTOM) {
    sections.push(
      `<h2>${safeTitle} — Everything You Need to Know</h2>`,
      `<p>At ${safeProductName}, we believe in giving ${safeAudience.toLowerCase()} customers the full picture. This guide explores ${escapeHtml(primaryTopic)} in depth so you can make confident, informed decisions about the products you choose.</p>`,
      `<p>Every recommendation and insight in this post is grounded in what we have learned from our community of ${safeAudience.toLowerCase()} shoppers — real people with real needs, just like you.</p>`,
    );
  } else {
    sections.push(
      `<h2>Products Built for ${safeAudience}</h2>`,
      `<p>At ${safeProductName}, our product range is not chosen at random. Every item is evaluated for quality, usefulness, and value — so that when ${safeAudience.toLowerCase()} customers add something to their cart, they can feel completely confident.</p>`,
      `<p>From everyday essentials to standout picks, ${safeProductName} has something for every ${safeAudience.toLowerCase()} shopper. Explore the collection and see what fits your lifestyle.</p>`,
    );
  }

  // Tips section — bold sub-item style matching the reference
  const tip3 = hasPromotionSection
    ? `<p><strong>Use the ${hasHolidaySection ? safeHoliday + " " : ""}${safePromotionOffer !== "No promotion" ? "Promotion" : "Offer"}:</strong> ${safeOfferText ? `Our current <strong>${safeOfferText}</strong> deal is the perfect time to try something new or stock up on favourites. Act before it expires.` : `Take advantage of our current promotion to get more value from your purchase at ${safeProductName}.`}</p>`
    : `<p><strong>Explore the Full Collection:</strong> Browse all categories at ${safeProductName} to find products that match your lifestyle. The more you explore, the more you discover.</p>`;

  sections.push(
    `<h2>Tips for Getting the Most from ${safeProductName}</h2>`,
    `<p>Here are a few ways to make your ${safeProductName} experience even better:</p>`,
    `<p><strong>Browse with Intent:</strong> Use our product categories to navigate directly to what ${safeAudience.toLowerCase()} customers care about most. A focused browse leads to better picks and a more satisfying purchase.</p>`,
    `<p><strong>Read Product Details:</strong> We write every product description with clarity in mind. Take a moment to read the full details — it helps you choose with confidence and reduces the chance of returns.</p>`,
    tip3,
  );

  // Explore Our Collection section
  sections.push(
    `<h2>Explore Our Collection</h2>`,
    `<p>Do not miss out on our latest products${hasHolidaySection ? ` and ${safeHoliday} specials` : ""}! From ${safeAudience.toLowerCase()} favourites to new arrivals, ${safeProductName} has something for everyone. Check out our featured items and see how they can complement your lifestyle.</p>`,
    `<p>${hasPromotionSection ? `With our <strong>${safePromotionOffer}</strong>${safeOfferText ? ` (${safeOfferText})` : ""} promotion, there has never been a better time to explore what ${safeProductName} has in store.` : `Browse the full range at ${safeProductName} and discover products curated specifically for ${safeAudience.toLowerCase()} shoppers.`}</p>`,
  );

  // Final Thoughts
  const ctaLine = hasHolidaySection
    ? `Shop Now and ${safeOfferText ? `unwrap your ${safeOfferText} savings` : `celebrate ${safeHoliday}`} with ${safeProductName}!`
    : hasPromotionSection
      ? `Shop Now and ${safeOfferText ? `unlock your ${safeOfferText} deal` : "take advantage of this exclusive offer"} at ${safeProductName}!`
      : `Shop Now and discover what ${safeProductName} can do for you!`;

  sections.push(
    `<h2>Final Thoughts</h2>`,
    `<p>${safeProductName} is more than just a store — it is a destination for ${safeAudience.toLowerCase()} customers who want quality, value, and a ${safeTone.toLowerCase()} shopping experience. With${hasPromotionSection ? ` our <strong>${safePromotionOffer}</strong>${safeOfferText ? ` (${safeOfferText})` : ""},` : ""} a curated collection${hasHolidaySection ? `, and a special ${safeHoliday} lineup,` : ","} ${safeProductName} has everything you need to shop with confidence. So why wait? Start exploring today!</p>`,
    `<p>${ctaLine}</p>`,
  );

  const expansionPool = [
    `<p>At ${safeProductName}, every product is selected with ${safeAudience.toLowerCase()} customers in mind. We take the guesswork out of shopping so you always feel confident in what you choose.</p>`,
    `<p>Quality matters to us. ${safeProductName} is committed to delivering value — not just a transaction — for every ${safeAudience.toLowerCase()} shopper who visits our store.</p>`,
    `<p>Shopping at ${safeProductName} means joining a community of ${safeAudience.toLowerCase()} customers who value great products and honest service. We are here to help you find exactly what you need, every time.</p>`,
    `<p>Whether you are a first-time visitor or a loyal customer, ${safeProductName} always has something new to discover. We refresh our collection regularly so there is always a reason to come back.</p>`,
    `<p>We believe ${safeAudience.toLowerCase()} customers deserve a straightforward, enjoyable shopping experience — and that is exactly what ${safeProductName} delivers from first click to final purchase.</p>`,
  ];

  const compactExpansionPool = [
    `<p>${safeProductName} is built for ${safeAudience.toLowerCase()} customers who value quality, trust, and great deals.</p>`,
    `<p>Every product at ${safeProductName} is chosen to meet the real needs of ${safeAudience.toLowerCase()} shoppers.</p>`,
    `<p>Explore ${safeProductName} today and experience the difference that thoughtful curation makes.</p>`,
  ];

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

    break;
  }

  return appendProductCtaAndLink(html, productUrl);
}

function ensureBlogBodyWordRange({
  body,
  title,
  topic,
  tone,
  audience,
  promotion,
  offerText,
  holiday,
  tabType,
  language,
  postLength = "medium",
  productUrl = "",
  productContext = null,
}) {
  const normalized = appendProductCtaAndLink(
    includeCampaignDetails(body || "", { promotion, offerText, holiday, tabType }),
    productUrl,
  );
  const { min, max } = getWordRange(postLength);
  const words = countWords(normalized);
  if (normalized && words >= min && words <= max) return normalized;
  return buildBlogHtml({
    title,
    topic,
    tone,
    audience,
    promotion,
    offerText,
    holiday,
    tabType,
    language,
    postLength,
    productUrl,
    productContext,
  });
}

function getGeneratedContentPreview(body, maxLength = 220) {
  const plain = stripHtml(body || "");
  if (!plain) return "-";
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength).trim()}...`;
}

function createSuggestionSet({
  tabType,
  topic,
  tone,
  postLength,
  targetAudience,
  promotion,
  offerText,
  holiday,
  language,
  productUrl,
  productContext = null,
}) {
  const baseTopic = cleanText(topic) || "Shopify growth";
  const productName = cleanText(productContext?.title) || baseTopic;
  const promotionOffer = formatPromotionOffer(promotion, offerText);
  const words = getWordTarget(postLength);
  const labels =
    tabType === TAB_KEYS.BUSINESS
      ? [
          `How ${productName} Helps Shopify Stores Grow`,
          `Why Merchants Choose ${productName}`,
          `${productName} Use Cases for Better Store Content`,
          `A Practical Guide to ${productName}`,
          `How to Improve SEO Workflow with ${productName}`,
          `${productName} Benefits for Busy Store Owners`,
        ]
      : [
          `${productName} Campaign Guide`,
          `${productName} Promotion Playbook`,
          `${productName} Conversion Ideas`,
          `${productName} Seasonal Strategy`,
          `${productName} Customer Engagement Plan`,
          `${productName} Sales Growth Guide`,
        ];

  return labels.map((label, index) => {
    const title = label;
    const summary = `${tone} ${words} words blog for ${targetAudience.toLowerCase()} about ${baseTopic.toLowerCase()}${
      promotionOffer && promotionOffer !== "No promotion" ? ` with ${promotionOffer.toLowerCase()}` : ""
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
        offerText,
        holiday,
        tabType,
        language,
        postLength,
        productUrl,
        productContext,
      }),
      tone,
      postLength,
      targetAudience,
      promotion,
      offerText,
      holiday,
      topic: baseTopic,
      productUrl: normalizeProductUrl(productUrl),
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
  offerText,
  holiday,
  language,
  productUrl,
  productContext = null,
  aiProvider = "auto",
  openaiApiKey,
  anthropicApiKey,
  count = 6,
}) {
  const baseTopic = cleanText(topic) || "Shopify growth";
  const productName = cleanText(productContext?.title);
  const productDescription = cleanText(productContext?.description);
  const productType = cleanText(productContext?.productType);
  const vendor = cleanText(productContext?.vendor);
  const { min, max } = getWordRange(postLength);
  const safeCount = Math.max(1, Math.min(count || 6, 6));
  const isHolidayTab = tabType === TAB_KEYS.HOLIDAY;
  const isPromotionTab = tabType === TAB_KEYS.PROMOTION;
  const hasHoliday = isHolidayTab && holiday && holiday !== "None" && holiday !== "Choose a holiday to promote";
  const hasPromotion = (isHolidayTab || isPromotionTab) && promotion && promotion !== "None" && promotion !== "No promotion";
  const hasOffer = hasPromotion && offerText;

  const tabInstruction =
    tabType === TAB_KEYS.HOLIDAY
      ? `This is a HOLIDAY blog post. The entire blog must revolve around the ${holiday} celebration. Reference "${holiday}" in the H1 title, in the opening paragraph, in at least one H2 section heading, in the body paragraphs, and in the call-to-action.${hasPromotion ? ` Also prominently feature the "${promotion}"${hasOffer ? ` (offer: ${offerText})` : ""} in a dedicated "Special Offer" H2 section and in the CTA.` : ""}`
      : tabType === TAB_KEYS.PROMOTION
        ? `This is a PROMOTION blog post. The blog must prominently feature the "${promotion}"${hasOffer ? ` (offer: ${offerText})` : ""} promotion. Mention the offer in the H1 title or subtitle, in the opening paragraph, in a dedicated "Exclusive Offer" H2 section, and in the call-to-action.`
        : tabType === TAB_KEYS.CUSTOM
          ? `This is a CUSTOM blog post on the topic "${baseTopic}". The blog must explore this topic in depth as it relates to the store "${productName || baseTopic}" and its products/services.`
          : `This is a BUSINESS blog post for the store "${productName || baseTopic}". The blog must describe the store, its products, and the value it provides to ${targetAudience.toLowerCase()} customers.`;

  const prompt = `
You are writing ${safeCount} unique, complete, ready-to-publish Shopify blog posts for a store called "${productName || baseTopic}".

Store & Product Details:
- Store/Product name: ${productName || baseTopic}
- Product type: ${productType || "Not specified"}
- Brand/Vendor: ${vendor || "Not specified"}
- Product description: ${productDescription || "Not provided — infer from the store name and context"}
- Product URL: ${productUrl || "Not provided"}

Blog Settings:
- Tab type: ${tabType}
${hasHoliday ? `- Holiday: ${holiday}` : ""}
${hasPromotion ? `- Promotion type: ${promotion}` : ""}
${hasOffer ? `- Offer detail: ${offerText}` : ""}
- Writing tone: ${tone}
- Target audience: ${targetAudience}
- Language: ${language}
- Word count per blog: ${min}–${max} words

Tab-specific instruction:
${tabInstruction}

REQUIRED BLOG STRUCTURE — follow this exact section order for EVERY blog:

<h1>[Catchy title that includes: ${hasHoliday ? `"${holiday}" + ` : ""}${hasOffer ? `the offer "${offerText}" + ` : ""}the store/product name "${productName || baseTopic}"]</h1>

<p>[Opening paragraph — pack it with: ${hasHoliday ? `a ${holiday} seasonal hook + ` : ""}${hasOffer ? `the offer "${offerText}" + ` : ""}the product name "${productName || baseTopic}" + its key features or benefits + a specific product from the collection + the target audience "${targetAudience}". This should feel like an exciting invitation to shop.]</p>

<h2>Why Choose ${productName || baseTopic}?</h2>
<p>[Explain what ${productName || baseTopic} is, what it does, and why ${targetAudience.toLowerCase()} shoppers will love it. Be specific about features and real benefits — not vague marketing language.]</p>
<p>[A second paragraph expanding on the product value — highlight how it solves a problem or improves the ${targetAudience.toLowerCase()} experience.]</p>

<h2>[Name of a key feature or benefit of ${productName || baseTopic}]</h2>
<p>[Deep-dive into this feature. Explain concretely how it works and what outcome the ${targetAudience.toLowerCase()} customer gets.]</p>
<p>[A supporting paragraph with a real-world use case or example that ${targetAudience.toLowerCase()} will relate to.]</p>

${hasHoliday ? `<h2>${holiday} Shopping Made Easy</h2>
<p>[Explain how ${productName || baseTopic} makes ${holiday} shopping easier, more joyful, or more meaningful for ${targetAudience.toLowerCase()} customers.]</p>
<p>[Second paragraph — paint a picture of the ${holiday} experience with the product, mentioning the offer if applicable.]</p>` : `<h2>[Topic-specific section heading, e.g. "${baseTopic} Made Simple" or "How It Works"]</h2>
<p>[Contextual paragraph about how ${productName || baseTopic} fits the theme "${baseTopic}" for ${targetAudience.toLowerCase()} shoppers.]</p>`}

<h2>Tips for Getting the Most from ${productName || baseTopic}</h2>
<p>[Intro sentence for the tips section]</p>
<p><strong>[Tip 1 title]:</strong> [One or two sentences of actionable advice tied to a real product feature or use case.]</p>
<p><strong>[Tip 2 title]:</strong> [One or two sentences of actionable advice, different angle from tip 1.]</p>
<p><strong>[Tip 3 title]:</strong> [One or two sentences — perhaps about the promotion or seasonal opportunity${hasOffer ? ` like "${offerText}"` : ""}.]</p>

<h2>Explore Our Collection</h2>
<p>[Invite readers to explore the product range. Name at least one specific product or collection item from ${productName || baseTopic}. Describe what makes it special for ${targetAudience.toLowerCase()} customers.]</p>
<p>[Second paragraph — encourage browsing and mention the promotion or seasonal angle if relevant.]</p>

<h2>Final Thoughts</h2>
<p>[Summarise why ${productName || baseTopic} is the right choice for ${targetAudience.toLowerCase()} customers. Re-state the key value${hasOffer ? ` and the offer "${offerText}"` : ""}${hasHoliday ? ` and the ${holiday} opportunity` : ""}. End with strong encouragement to take action.]</p>

<p>[LAST LINE — a standalone CTA line, e.g.: "Shop Now and ${hasHoliday ? `celebrate ${holiday} with savings!` : hasOffer ? `unlock your ${offerText} deal today!` : `discover what ${productName || baseTopic} can do for you!`}"]</p>

Additional rules:
- Write in a ${tone.toLowerCase()} tone throughout — match every sentence to that voice.
- Target audience is ${targetAudience} — every section should feel written FOR them.
- Do NOT use vague filler phrases like "In today's fast-paced world" or "In conclusion, it is clear that".
- Each of the ${safeCount} suggestions must be clearly different from the others (different angles, titles, feature focus, or tone nuance).
- Titles, summaries, and bodyHtml must include "${productName || baseTopic}" by name.
${hasOffer ? `- The offer "${offerText}" must appear in: the H1 title OR opening paragraph, the Tips section, and the Final Thoughts.` : ""}
${hasHoliday ? `- "${holiday}" must appear in: the H1 title, the opening paragraph, the "${holiday} Shopping Made Easy" H2, and the Final Thoughts CTA line.` : ""}

Return ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "suggestions": [
    {
      "title": "Blog title here",
      "summary": "1–2 sentence description mentioning the product name and the blog theme.",
      "bodyHtml": "<h1>...</h1><p>...</p><h2>...</h2><p>...</p>..."
    }
  ]
}
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
      offerText,
      holiday,
      tabType,
      language,
      postLength,
      productUrl,
      productContext,
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
      offerText,
      holiday,
      topic: baseTopic,
      productUrl: normalizeProductUrl(productUrl),
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
  offerText,
  holiday,
  productUrl,
}) {
  await db.blogGeneratedContent.upsert({
    where: {
      shop_articleId: {
        shop,
        articleId,
      },
    },
    create: {
      shop,
      blogId: blogId || null,
      articleId,
      title,
      summary: summary || null,
      bodyHtml: bodyHtml || null,
      status: status || null,
      language: language || null,
      tone: tone || null,
      lengthOption: lengthOption || null,
      targetAudience: targetAudience || null,
      tabType: tabType || null,
      topic: topic || null,
      promotion: promotion || null,
      offerText: offerText || null,
      holiday: holiday || null,
      productUrl: productUrl || null,
    },
    update: {
      blogId: blogId || null,
      title,
      summary: summary || null,
      bodyHtml: bodyHtml || null,
      status: status || null,
      language: language || null,
      tone: tone || null,
      lengthOption: lengthOption || null,
      targetAudience: targetAudience || null,
      tabType: tabType || null,
      topic: topic || null,
      promotion: promotion || null,
      offerText: offerText || null,
      holiday: holiday || null,
      productUrl: productUrl || null,
    },
  });
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
    let connection = null;
    try {
      const response = await admin.graphql(BLOGS_QUERY, { variables: { first: 100, after } });
      const json = await response.json();
      connection = json?.data?.blogs || null;
    } catch (error) {
      console.error("Failed to load blogs", error);
      break;
    }
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
    let connection = null;
    try {
      const response = await admin.graphql(ARTICLES_QUERY, { variables: { first: 100, after } });
      const json = await response.json();
      connection = json?.data?.articles || null;
    } catch (error) {
      console.error("Failed to load articles", error);
      break;
    }
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
    select: {
      globalSettingsJson: true,
      defaultAiProvider: true,
      openaiApiKey: true,
      anthropicApiKey: true,
    },
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
    const offerText = cleanText(formData.get("offerText"));
    const holiday = cleanText(formData.get("holiday")) || "Choose a holiday to promote";
    const productUrl = normalizeProductUrl(formData.get("productUrl"));
    const productContext = await resolveProductContext(admin, productUrl);
    const promotionOffer = formatPromotionOffer(promotion, offerText);
    const businessTopic = cleanText(productContext.title) || "Business growth ideas";

    if (tabType === TAB_KEYS.CUSTOM && !topic) {
      return { ok: false, intent, error: "Post topic is required for custom post." };
    }

    const seedTopic =
      topic ||
      (tabType === TAB_KEYS.HOLIDAY
        ? `${holiday} campaign ideas`
        : tabType === TAB_KEYS.PROMOTION
          ? `${promotionOffer || promotion} promotion blog ideas`
          : businessTopic);

    let suggestions = [];
    try {
      suggestions = await generateBlogSuggestionsWithAI({
        tabType,
        topic: seedTopic,
        tone,
        postLength,
        targetAudience,
        promotion,
        offerText,
        holiday,
        language,
        productUrl,
        productContext,
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
        offerText,
        holiday,
        language,
        productUrl,
        productContext,
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

    let article;
    try {
      const response = await admin.graphql(ARTICLE_CREATE_MUTATION, {
        variables: {
          article: {
            blogId,
            title,
            body,
            author: {
              name: getDefaultAuthorName(session.shop),
            },
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
      if (!payload?.article) {
        return { ok: false, intent, error: "Shopify did not return a created article." };
      }
      article = normalizeArticle(payload.article);
    } catch (error) {
      return { ok: false, intent, error: error?.message || "Failed to create article." };
    }
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
      offerText: cleanText(formData.get("offerText")),
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
    const blogId = cleanText(formData.get("blogId"));
    const status = cleanText(formData.get("status")) || "draft";
    const seed = cleanText(formData.get("seed"));
    const tabType = cleanText(formData.get("tabType")) || TAB_KEYS.BUSINESS;
    const topic = cleanText(formData.get("topic"));
    const tone = normalizeToneValue(formData.get("tone"), defaultTone);
    const postLength = normalizePostLength(formData.get("postLength"), "medium");
    const targetAudience = cleanText(formData.get("targetAudience")) || "Everyone";
    const promotion = cleanText(formData.get("promotion")) || "No promotion";
    const offerText = cleanText(formData.get("offerText"));
    const holiday = cleanText(formData.get("holiday")) || "Choose a holiday to promote";
    const productUrl = normalizeProductUrl(formData.get("productUrl"));
    const productContext = await resolveProductContext(admin, productUrl);
    const promotionOffer = formatPromotionOffer(promotion, offerText);
    const businessTopic = cleanText(productContext.title) || seed || "Shopify growth";
    if (!articleId) return { ok: false, intent, error: "Missing article id." };

    let title = seed || "Updated Shopify article";
    let body = "";
    const seedTopic =
      topic ||
      (tabType === TAB_KEYS.HOLIDAY
        ? `${holiday} campaign ideas`
        : tabType === TAB_KEYS.PROMOTION
          ? `${promotionOffer || promotion} promotion blog ideas`
          : businessTopic);
    try {
      const [generated] = await generateBlogSuggestionsWithAI({
        tabType,
        topic: seedTopic,
        tone,
        postLength,
        targetAudience,
        promotion,
        offerText,
        holiday,
        language,
        productUrl,
        productContext,
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
        topic: seedTopic,
        tone,
        audience: targetAudience,
        promotion,
        offerText,
        holiday,
        tabType,
        language,
        postLength,
        productUrl,
        productContext,
      });
    }
    return {
      ok: true,
      intent,
      generated: {
        articleId,
        blogId,
        title,
        body,
        status,
      },
      creditsUsed: 0,
    };
  }

  if (intent === "save_blog_content") {
    const articleId = cleanText(formData.get("articleId"));
    const blogId = cleanText(formData.get("blogId"));
    const title = cleanText(formData.get("title"));
    const body = String(formData.get("body") || "").trim();
    const status = cleanText(formData.get("status")) || "draft";
    const consumeCreditOnSave = String(formData.get("consumeCreditOnSave") || "") === "1";

    if (!articleId) return { ok: false, intent, error: "Missing article id." };
    if (!title) return { ok: false, intent, error: "Title is required." };

    if (consumeCreditOnSave) {
      const creditBalance = await getOrCreateShopCredits(session.shop);
      if ((creditBalance?.credits ?? 0) < BLOG_BODY_CREDIT_COST) {
        return {
          ok: false,
          intent,
          error: buildInsufficientCreditsError(BLOG_BODY_CREDIT_COST, creditBalance?.credits ?? 0),
        };
      }
    }

    let article;
    try {
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
      if (!payload?.article) {
        return { ok: false, intent, error: "Shopify did not return an updated article." };
      }
      article = normalizeArticle(payload.article);
    } catch (error) {
      return { ok: false, intent, error: error?.message || "Failed to update article." };
    }
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
      offerText: cleanText(formData.get("offerText")),
      holiday: cleanText(formData.get("holiday")),
      productUrl: cleanText(formData.get("productUrl")),
    });

    let creditSnapshot = null;
    if (consumeCreditOnSave) {
      creditSnapshot = await deductCredits({
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
            tone: cleanText(formData.get("tone")) || null,
            generatedDescription: body,
            creditsUsed: BLOG_BODY_CREDIT_COST,
            appliedToProduct: true,
          },
        });
      } catch (_) {
        // Non-critical logging failure should not block response.
      }
    }

    return {
      ok: true,
      intent,
      article,
      creditsUsed: consumeCreditOnSave ? BLOG_BODY_CREDIT_COST : 0,
      newCredits: creditSnapshot?.credits,
      creditsUsedTotal: creditSnapshot?.creditsUsedTotal,
    };
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
  const [offerText, setOfferText] = useState("40% off");
  const [holiday, setHoliday] = useState("Choose a holiday to promote");
  const [productUrl, setProductUrl] = useState("");

  const [suggestions, setSuggestions] = useState([]);
  const [visibleSuggestionCount, setVisibleSuggestionCount] = useState(3);
  const [regenerateTarget, setRegenerateTarget] = useState(null);
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false);
  const [regenerateTitle, setRegenerateTitle] = useState("");
  const [regenerateStatus, setRegenerateStatus] = useState("draft");
  const [regenerateBody, setRegenerateBody] = useState("");

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
  const showOfferTextField = isDiscountPromotion(promotion);
  const effectiveOfferText = showOfferTextField ? offerText : "";
  const selectedBlogTitle = useMemo(
    () => blogs.find((blog) => blog.id === selectedBlogId)?.title || "",
    [blogs, selectedBlogId],
  );

  function handlePromotionChange(nextPromotion) {
    setPromotion(nextPromotion);
    setOfferText(isDiscountPromotion(nextPromotion) ? getDefaultOfferText(nextPromotion) : "");
  }

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

    if (fetcher.data.intent === "regenerate_blog") {
      if (fetcher.data.generated) {
        setRegenerateTitle(fetcher.data.generated.title || regenerateTitle);
        setRegenerateBody(fetcher.data.generated.body || "");
        setRegenerateStatus(fetcher.data.generated.status || "draft");
      }
      setMessage(
        `Blog regenerated successfully.${typeof fetcher.data.creditsUsed === "number" ? ` ${fetcher.data.creditsUsed} credit used${typeof fetcher.data.newCredits === "number" ? `. Remaining: ${fetcher.data.newCredits}` : ""}.` : ""}`,
      );
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

    if (fetcher.data.intent === "save_blog_content") {
      setEditingBlog(null);
      setIsRegenerateModalOpen(false);
      setRegenerateTarget(null);
      setRegenerateTitle("");
      setRegenerateStatus("draft");
      setRegenerateBody("");
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
    payload.append("offerText", effectiveOfferText);
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
      offerText: suggestion.offerText,
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
    payload.append("offerText", suggestion.offerText || effectiveOfferText);
    payload.append("holiday", suggestion.holiday || holiday);
    payload.append("productUrl", suggestion.productUrl || productUrl);
    fetcher.submit(payload, { method: "post" });
  }

  function openRegenerateModal(article) {
    setRegenerateTarget({
      articleId: article.id,
      seed: article.title,
      blogId: article.blogId,
    });
    setRegenerateTitle(article.title || "");
    setRegenerateStatus(article.publishedAt ? "published" : "draft");
    setRegenerateBody(article.body || "");
    setIsRegenerateModalOpen(true);
  }

  function submitRegenerateFromModal() {
    if (!regenerateTarget?.articleId) return;
    const payload = new FormData();
    payload.append("intent", "regenerate_blog");
    payload.append("articleId", regenerateTarget.articleId);
    payload.append("blogId", regenerateTarget.blogId || "");
    payload.append("seed", regenerateTarget.seed || "");
    payload.append("status", regenerateStatus);
    payload.append("tabType", activeTabKey);
    payload.append("topic", topic);
    payload.append("tone", tone);
    payload.append("postLength", postLength);
    payload.append("targetAudience", targetAudience);
    payload.append("promotion", promotion);
    payload.append("offerText", effectiveOfferText);
    payload.append("holiday", holiday);
    payload.append("productUrl", productUrl);
    payload.append("currentBody", regenerateBody || "");
    fetcher.submit(payload, { method: "post" });
  }

  function saveRegeneratedBlogFromModal() {
    if (!regenerateTarget?.articleId) return;
    const payload = new FormData();
    payload.append("intent", "save_blog_content");
    payload.append("articleId", regenerateTarget.articleId);
    payload.append("blogId", regenerateTarget.blogId || "");
    payload.append("title", regenerateTitle || regenerateTarget.seed || "");
    payload.append("body", regenerateBody || "");
    payload.append("status", regenerateStatus);
    payload.append("tabType", activeTabKey);
    payload.append("tone", tone);
    payload.append("postLength", postLength);
    payload.append("targetAudience", targetAudience);
    payload.append("promotion", promotion);
    payload.append("offerText", effectiveOfferText);
    payload.append("holiday", holiday);
    payload.append("productUrl", productUrl);
    payload.append("consumeCreditOnSave", "1");
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
              onClick={() => openRegenerateModal(article)}
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
                      <Select label="Promotion" options={promotionOptions} value={promotion} onChange={handlePromotionChange} />
                      {showOfferTextField ? (
                        <TextField label="Add your offer here" value={offerText} onChange={setOfferText} autoComplete="off" placeholder="40% off" />
                      ) : null}
                      <Select label="Post length" options={POST_LENGTH_OPTIONS} value={postLength} onChange={setPostLength} />
                      <Select label="Post tone" options={toneOptions} value={tone} onChange={setTone} />
                      <Select label="Target audience" options={audienceOptions} value={targetAudience} onChange={setTargetAudience} />
                      <TextField label="Product URL" value={productUrl} onChange={setProductUrl} autoComplete="off" placeholder="https://yourstore.com/products/..." />
                    </div>
                  ) : null}

                  {activeTabKey === TAB_KEYS.PROMOTION ? (
                    <div className="blog-generator-fields">
                      <Select label="Promotion" options={promotionOptions} value={promotion} onChange={handlePromotionChange} />
                      {showOfferTextField ? (
                        <TextField label="Add your offer here" value={offerText} onChange={setOfferText} autoComplete="off" placeholder="40% off" />
                      ) : null}
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
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => openSuggestionEditor(suggestion)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openSuggestionEditor(suggestion);
                            }
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          <BlockStack gap="300">
                            <Text as="h4" variant="headingMd">{suggestion.title}</Text>
                            <Text as="p" variant="bodyMd" tone="subdued">{suggestion.summary}</Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {getGeneratedContentPreview(suggestion.body)}
                            </Text>
                          </BlockStack>
                        </div>
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
                    payload.append("offerText", editingBlog.offerText || effectiveOfferText);
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

      <Modal
        open={isRegenerateModalOpen}
        onClose={() => {
          setIsRegenerateModalOpen(false);
          setRegenerateTarget(null);
          setRegenerateTitle("");
          setRegenerateStatus("draft");
          setRegenerateBody("");
        }}
        title="Regenerate Blog"
        size="large"
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd" tone="subdued">
              Apply the same settings used in Create Blog, then regenerate this post.
            </Text>

            <Tabs tabs={tabItems} selected={activeTab} onSelect={setActiveTab} />

            {activeTabKey === TAB_KEYS.HOLIDAY ? (
              <div className="blog-generator-fields">
                <Select label="Holiday" options={holidayOptions} value={holiday} onChange={setHoliday} />
                <Select label="Promotion" options={promotionOptions} value={promotion} onChange={handlePromotionChange} />
                {showOfferTextField ? (
                  <TextField label="Add your offer here" value={offerText} onChange={setOfferText} autoComplete="off" placeholder="40% off" />
                ) : null}
                <Select label="Post length" options={POST_LENGTH_OPTIONS} value={postLength} onChange={setPostLength} />
                <Select label="Post tone" options={toneOptions} value={tone} onChange={setTone} />
                <Select label="Target audience" options={audienceOptions} value={targetAudience} onChange={setTargetAudience} />
                <TextField label="Product URL" value={productUrl} onChange={setProductUrl} autoComplete="off" placeholder="https://yourstore.com/products/..." />
              </div>
            ) : null}

            {activeTabKey === TAB_KEYS.PROMOTION ? (
              <div className="blog-generator-fields">
                <Select label="Promotion" options={promotionOptions} value={promotion} onChange={handlePromotionChange} />
                {showOfferTextField ? (
                  <TextField label="Add your offer here" value={offerText} onChange={setOfferText} autoComplete="off" placeholder="40% off" />
                ) : null}
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

            <BlockStack gap="200">
              <Text as="h4" variant="headingSm">Current blog description</Text>
              <TextField label="Title" value={regenerateTitle} onChange={setRegenerateTitle} autoComplete="off" />
              <Select
                label="Status"
                options={[
                  { label: "Draft", value: "draft" },
                  { label: "Published", value: "published" },
                ]}
                value={regenerateStatus}
                onChange={setRegenerateStatus}
              />
              <RichTextEditor
                value={regenerateBody}
                onChange={setRegenerateBody}
                minHeight={220}
                maxHeight={320}
                showSourceToggle
              />
            </BlockStack>

            <InlineStack align="end" gap="200">
              <Button
                onClick={() => {
                  setIsRegenerateModalOpen(false);
                  setRegenerateTarget(null);
                  setRegenerateTitle("");
                  setRegenerateStatus("draft");
                  setRegenerateBody("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={submitRegenerateFromModal}
                disabled={!regenerateTarget?.articleId}
                loading={fetcher.state !== "idle" && String(fetcher.formData?.get("intent")) === "regenerate_blog"}
              >
                Regenerate
              </Button>
              <Button
                variant="primary"
                onClick={saveRegeneratedBlogFromModal}
                disabled={!regenerateTarget?.articleId}
                loading={fetcher.state !== "idle" && String(fetcher.formData?.get("intent")) === "save_blog_content"}
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
