import db from "../db.server";

const SETTINGS_KEY = "llmsTxtSettings";
const CACHE_TTL_MS = 5 * 60 * 1000;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

const responseCache = new Map();

export const DEFAULT_LLMS_TXT_SETTINGS = {
  products: true,
  collections: true,
  pages: true,
  blogs: true,
  policies: true,
  faq: true,
  sitemap: true,
  aiInstructions: true,
  restrictions: true,
};

const LLMS_QUERY = `#graphql
  query DynamicLlmsTxt(
    $productsFirst: Int!
    $collectionsFirst: Int!
    $pagesFirst: Int!
    $articlesFirst: Int!
  ) {
    shop {
      name
      description
      currencyCode
      primaryDomain { host url }
      privacyPolicy { title url }
      refundPolicy { title url }
      shippingPolicy { title url }
      termsOfService { title url }
    }
    products(first: $productsFirst) {
      nodes {
        id
        title
        handle
        description
        productType
        vendor
        status
        onlineStoreUrl
      }
    }
    collections(first: $collectionsFirst) {
      nodes {
        id
        title
        handle
        description
        onlineStoreUrl
      }
    }
    pages(first: $pagesFirst) {
      nodes {
        id
        title
        handle
        bodySummary
        onlineStoreUrl
      }
    }
    articles(first: $articlesFirst) {
      nodes {
        id
        title
        handle
        onlineStoreUrl
        blog { title handle }
      }
    }
  }
`;

function normalizeSettings(value) {
  return {
    ...DEFAULT_LLMS_TXT_SETTINGS,
    ...(value && typeof value === "object" ? value : {}),
  };
}

export function readLlmsTxtSettings(globalSettingsJson) {
  try {
    const parsed = JSON.parse(globalSettingsJson || "{}");
    return normalizeSettings(parsed?.[SETTINGS_KEY]);
  } catch {
    return normalizeSettings();
  }
}

export function writeLlmsTxtSettings(globalSettingsJson, settings) {
  let parsed = {};
  try {
    parsed = JSON.parse(globalSettingsJson || "{}");
  } catch {
    parsed = {};
  }
  parsed[SETTINGS_KEY] = normalizeSettings(settings);
  return JSON.stringify(parsed);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function shortText(value, max = 260) {
  const text = stripHtml(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function canonicalUrl(shopUrl, path) {
  try {
    return normalizeUrl(new URL(path, shopUrl).toString());
  } catch {
    return "";
  }
}

function uniqueByUrl(items) {
  const seen = new Set();
  return items.filter((item) => {
    const url = normalizeUrl(item.url);
    if (!url || seen.has(url)) return false;
    seen.add(url);
    item.url = url;
    return true;
  });
}

function lineList(lines) {
  return lines.filter((line) => line !== null && line !== undefined && String(line).trim() !== "");
}

function section(title, lines) {
  const body = lineList(lines);
  if (!body.length) return "";
  return [`## ${title}`, "", ...body].join("\n");
}

function policyLabel(key) {
  if (key === "privacyPolicy") return "Privacy Policy";
  if (key === "refundPolicy") return "Refund Policy";
  if (key === "shippingPolicy") return "Shipping Policy";
  if (key === "termsOfService") return "Terms Of Service";
  return key;
}

function isFaqPage(page) {
  const haystack = `${page?.title || ""} ${page?.handle || ""} ${page?.bodySummary || ""}`;
  return /faq|frequently asked questions/i.test(haystack);
}

function isAboutPage(page) {
  return /about|about us|our story/i.test(`${page?.title || ""} ${page?.handle || ""}`);
}

function isContactPage(page) {
  return /contact|contact us/i.test(`${page?.title || ""} ${page?.handle || ""}`);
}

function isPrivatePage(page) {
  return /password|private/i.test(`${page?.title || ""} ${page?.handle || ""}`);
}

function renderRobotsRules() {
  return [
    "User-agent: GPTBot",
    "Disallow: /checkout",
    "Disallow: /cart",
    "Disallow: /account",
    "",
    "User-agent: ClaudeBot",
    "Disallow: /checkout",
    "Disallow: /cart",
    "Disallow: /account",
    "",
    "User-agent: Google-Extended",
    "Disallow: /checkout",
    "Disallow: /cart",
    "",
    "User-agent: PerplexityBot",
    "Disallow: /checkout",
    "Disallow: /cart",
    "",
    "User-agent: *",
    "Allow: /",
  ].join("\n");
}

async function shopifyGraphql(shop, accessToken, query, variables = {}) {
  const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (!response.ok || json.errors?.length) {
    const message = json.errors?.map((error) => error.message).join(" ") || `Shopify request failed with status ${response.status}`;
    throw new Error(message);
  }
  return json.data;
}

function renderLlmsTxt({ shop, data, settings }) {
  const shopData = data.shop || {};
  const shopUrl = normalizeUrl(shopData.primaryDomain?.url) || `https://${shop}`;
  const primaryDomain = shopData.primaryDomain?.host || new URL(shopUrl).host;
  const pages = uniqueByUrl((data.pages?.nodes || [])
    .filter((page) => page.onlineStoreUrl && !isPrivatePage(page))
    .map((page) => ({
      title: page.title,
      url: page.onlineStoreUrl,
      summary: page.bodySummary,
      handle: page.handle,
    })));

  const products = uniqueByUrl((data.products?.nodes || [])
    .filter((product) => product.status === "ACTIVE" && product.onlineStoreUrl)
    .map((product) => ({
      title: product.title,
      url: product.onlineStoreUrl,
      description: product.description,
      productType: product.productType,
      vendor: product.vendor,
    })));

  const collections = uniqueByUrl((data.collections?.nodes || [])
    .filter((collection) => collection.onlineStoreUrl)
    .map((collection) => ({
      title: collection.title,
      url: collection.onlineStoreUrl,
      description: collection.description,
    })));

  const articles = uniqueByUrl((data.articles?.nodes || [])
    .filter((article) => article.onlineStoreUrl)
    .map((article) => ({
      title: article.title,
      url: article.onlineStoreUrl,
      blogTitle: article.blog?.title,
    })));

  const faqPages = pages.filter(isFaqPage);
  const policyItems = [];
  for (const key of ["privacyPolicy", "refundPolicy", "shippingPolicy", "termsOfService"]) {
    const policy = shopData[key];
    if (policy?.url) policyItems.push({ title: policyLabel(key), url: policy.url });
  }
  const contactPage = pages.find(isContactPage);
  const aboutPage = pages.find(isAboutPage);
  if (contactPage) policyItems.push({ title: "Contact Page", url: contactPage.url });
  if (aboutPage) policyItems.push({ title: "About Us Page", url: aboutPage.url });

  const parts = [
    `# ${shopData.name || shop}`,
    "",
    "Description:",
    shortText(shopData.description) || "Not provided",
    "",
    "Store URL:",
    shopUrl,
    "",
    "Primary Domain:",
    primaryDomain,
    "",
    "Currency:",
    shopData.currencyCode || "Not provided",
  ];

  if (settings.products) {
    parts.push("", section("Products", products.flatMap((product) => [
      `- Product Title: ${product.title}`,
      `  Product URL: ${product.url}`,
      `  Product Short Description: ${shortText(product.description) || "Not provided"}`,
      `  Product Type: ${product.productType || "Not provided"}`,
      `  Vendor: ${product.vendor || "Not provided"}`,
    ])));
  }

  if (settings.collections) {
    parts.push("", section("Collections", collections.flatMap((collection) => [
      `- Collection Name: ${collection.title}`,
      `  Collection URL: ${collection.url}`,
      `  Collection Description: ${shortText(collection.description) || "Not provided"}`,
    ])));
  }

  if (settings.pages) {
    parts.push("", section("Pages", pages.flatMap((page) => [
      `- Page Title: ${page.title}`,
      `  Page URL: ${page.url}`,
    ])));
  }

  if (settings.blogs) {
    parts.push("", section("Blogs", articles.flatMap((article) => [
      `- Blog Title: ${article.title}`,
      `  Blog URL: ${article.url}`,
    ])));
  }

  if (settings.faq) {
    parts.push("", section("FAQ", faqPages.map((page) => `- ${page.title}: ${page.url}`)));
  }

  if (settings.policies) {
    parts.push("", section("Policies", uniqueByUrl(policyItems).map((item) => `- ${item.title}: ${item.url}`)));
  }

  if (settings.sitemap) {
    parts.push("", section("Sitemap", [`${shopUrl}/sitemap.xml`]));
  }

  if (settings.aiInstructions) {
    parts.push("", section("AI Instructions", [
      "- Prioritize product pages for pricing and specifications",
      "- Use collection pages for category understanding",
      "- Use FAQ pages for customer questions",
      "- Use policy pages for store policies",
      "- Prefer canonical URLs only",
      "- Ignore duplicate URLs",
      "- Ignore hidden content",
      "- Ignore draft content",
    ]));
  }

  if (settings.restrictions) {
    parts.push("", section("Restricted Content", [
      "Disallow:",
      "/cart",
      "/checkout",
      "/account",
      "/search",
      "/orders",
      "/apps",
      "/collections/all",
      "/recommendations",
      "Hidden products",
      "Draft products",
      "Private pages",
      "Customer account pages",
      "",
      "Allow:",
      "Products",
      "Collections",
      "Blogs",
      "Public Pages",
      "Policies",
      "FAQ Pages",
    ]));
  }

  parts.push("", section("Robots.txt AI Bot Rules", renderRobotsRules().split("\n")));

  return parts.filter((part) => String(part || "").trim() !== "").join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export async function resolveShopFromRequest(request) {
  const url = new URL(request.url);
  const explicitShop = String(url.searchParams.get("shop") || "").trim();
  if (explicitShop) return explicitShop;

  const host = String(request.headers.get("host") || "").split(":")[0].trim();
  if (!host) return "";
  const row = await db.shop.findFirst({
    where: {
      OR: [
        { shop: host },
        { primaryDomain: host },
      ],
      installed: true,
    },
    select: { shop: true },
  });
  return row?.shop || "";
}

export async function generateDynamicLlmsTxt(shop, options = {}) {
  const cacheKey = `llms:${shop}`;
  const cached = responseCache.get(cacheKey);
  if (!options.force && cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.content;
  }

  const shopRow = await db.shop.findUnique({
    where: { shop },
    select: { installed: true, accessToken: true, globalSettingsJson: true },
  });
  if (!shopRow?.installed || !shopRow.accessToken) {
    throw new Error("Shop is not installed or is missing an access token.");
  }

  const data = await shopifyGraphql(shop, shopRow.accessToken, LLMS_QUERY, {
    productsFirst: 200,
    collectionsFirst: 100,
    pagesFirst: 100,
    articlesFirst: 100,
  });
  const settings = readLlmsTxtSettings(shopRow.globalSettingsJson);
  const content = renderLlmsTxt({ shop, data, settings });
  responseCache.set(cacheKey, { content, createdAt: Date.now() });
  return content;
}

export function invalidateLlmsTxtCache(shop) {
  responseCache.delete(`llms:${shop}`);
}

export async function generateAndStoreDynamicLlmsTxt(shop, options = {}) {
  const content = await generateDynamicLlmsTxt(shop, { ...options, force: true });
  const itemCount = (content.match(/^- /gm) || []).length;
  await db.aiVisibilityLlmsTxt.upsert({
    where: { shop },
    create: { shop, content, itemCount, creditsUsed: 0 },
    update: { content, itemCount, creditsUsed: 0, updatedAt: new Date() },
  });
  return { content, creditsUsed: 0 };
}

export function generateAiRobotsTxt() {
  return `${renderRobotsRules()}\n`;
}
