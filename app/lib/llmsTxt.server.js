import db from "../db.server";
import { deductCredits, refundCredits } from "./credits.server";

const SETTINGS_KEY = "llmsTxtSettings";
const CACHE_TTL_MS = 5 * 60 * 1000;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const APP_NAME = "Product AI Generate";
const LLMS_GENERATION_CREDITS = 6;

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
      }
    }
    pages(first: $pagesFirst) {
      nodes {
        id
        title
        handle
        bodySummary
      }
    }
    articles(first: $articlesFirst) {
      nodes {
        id
        title
        handle
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

function formatGeneratedFile(parts) {
  return parts
    .filter((part) => String(part || "").trim() !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n(## )/g, "\n\n$1")
    .trim() + "\n";
}

function markdownLink(label, url) {
  return url ? `[${label}](${url})` : label;
}

function renderNamedItems(items, { emptyText, max = 100 } = {}) {
  const limited = items.slice(0, max);
  if (!limited.length) return [emptyText || "None listed."];
  return limited.flatMap((item) => [
    `- ${markdownLink(item.title, item.url)}`,
    item.description ? `  ${shortText(item.description, 180)}` : null,
  ]).filter(Boolean);
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

function isPrivacyPage(page) {
  return /privacy|privacy policy/i.test(`${page?.title || ""} ${page?.handle || ""}`);
}

function isRefundPage(page) {
  return /refund|return policy|returns/i.test(`${page?.title || ""} ${page?.handle || ""}`);
}

function isShippingPage(page) {
  return /shipping|shipping policy|delivery/i.test(`${page?.title || ""} ${page?.handle || ""}`);
}

function isTermsPage(page) {
  return /terms|terms of service|terms and conditions/i.test(`${page?.title || ""} ${page?.handle || ""}`);
}

function isPrivatePage(page) {
  return /password|private/i.test(`${page?.title || ""} ${page?.handle || ""}`);
}

function isPolicyOrHelpPage(page) {
  return [
    isPrivacyPage,
    isRefundPage,
    isShippingPage,
    isTermsPage,
    isContactPage,
    isAboutPage,
    isFaqPage,
  ].some((fn) => fn(page)) || /help|support|tracking|warranty|size|sizing|care|exchange|cancel/i.test(`${page?.title || ""} ${page?.handle || ""}`);
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

async function shopifyRest(shop, accessToken, path, options = {}) {
  const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { errors: text };
    }
  }
  if (!response.ok) {
    const message = json?.errors || json?.error || response.statusText;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return json;
}

const URL_REDIRECTS_BY_PATH_QUERY = `#graphql
  query UrlRedirectsByPath($query: String!) {
    urlRedirects(first: 50, query: $query) {
      nodes {
        id
        path
        target
      }
    }
  }
`;

const URL_REDIRECT_CREATE_MUTATION = `#graphql
  mutation UrlRedirectCreate($urlRedirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $urlRedirect) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const URL_REDIRECT_UPDATE_MUTATION = `#graphql
  mutation UrlRedirectUpdate($id: ID!, $urlRedirect: UrlRedirectInput!) {
    urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const URL_REDIRECT_DELETE_MUTATION = `#graphql
  mutation UrlRedirectDelete($id: ID!) {
    urlRedirectDelete(id: $id) {
      deletedUrlRedirectId
      userErrors {
        field
        message
      }
    }
  }
`;

function assertNoUserErrors(payload, fallbackMessage) {
  const userErrors = payload?.userErrors || [];
  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(", "));
  }
  return payload || (() => {
    throw new Error(fallbackMessage);
  })();
}

function redirectSearchQuery(path) {
  return `path:"${String(path).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function findStorefrontRedirectsByPath(shop, accessToken, path) {
  const data = await shopifyGraphql(shop, accessToken, URL_REDIRECTS_BY_PATH_QUERY, {
    query: redirectSearchQuery(path),
  });
  return (data?.urlRedirects?.nodes || []).filter((redirect) => redirect?.path === path);
}

async function createStorefrontRedirectWithGraphql(shop, accessToken, path, target) {
  const data = await shopifyGraphql(shop, accessToken, URL_REDIRECT_CREATE_MUTATION, {
    urlRedirect: { path, target },
  });
  const payload = assertNoUserErrors(data?.urlRedirectCreate, "Shopify did not return a URL redirect create response.");
  return payload.urlRedirect;
}

async function updateStorefrontRedirectWithGraphql(shop, accessToken, redirectId, path, target) {
  const data = await shopifyGraphql(shop, accessToken, URL_REDIRECT_UPDATE_MUTATION, {
    id: redirectId,
    urlRedirect: { path, target },
  });
  const payload = assertNoUserErrors(data?.urlRedirectUpdate, "Shopify did not return a URL redirect update response.");
  return payload.urlRedirect;
}

async function deleteStorefrontRedirectWithGraphql(shop, accessToken, redirectId) {
  const data = await shopifyGraphql(shop, accessToken, URL_REDIRECT_DELETE_MUTATION, {
    id: redirectId,
  });
  assertNoUserErrors(data?.urlRedirectDelete, "Shopify did not return a URL redirect delete response.");
}

// Force-override a storefront redirect using REST:
// 1. List ALL existing redirects for the path (finds redirects from any app).
// 2. Delete every one of them.
// 3. Create a fresh redirect pointing to our proxy.
// This guarantees our redirect wins over any other app's redirect.
async function forceOverrideRedirectWithRest(shop, accessToken, path, target) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const normalizedTarget = target.startsWith("/") ? target : `/${target}`;

  // Step 1: find all existing redirects for this path (from any app).
  let existingIds = [];
  try {
    const query = new URLSearchParams({ path: normalizedPath, limit: "250" }).toString();
    const json = await shopifyRest(shop, accessToken, `redirects.json?${query}`);
    existingIds = (json?.redirects || [])
      .filter((r) => r.path === normalizedPath)
      .map((r) => r.id);
  } catch (listErr) {
    console.warn(`[llms-txt] Could not list redirects for ${normalizedPath}:`, listErr?.message);
  }

  // Step 2: delete every existing redirect for this path.
  if (existingIds.length > 0) {
    await Promise.allSettled(
      existingIds.map((id) =>
        shopifyRest(shop, accessToken, `redirects/${id}.json`, { method: "DELETE" }).catch((e) =>
          console.warn(`[llms-txt] Failed to delete redirect ${id}:`, e?.message),
        ),
      ),
    );
  }

  // Step 3: create a fresh redirect to our proxy.
  try {
    const created = await shopifyRest(shop, accessToken, "redirects.json", {
      method: "POST",
      body: { redirect: { path: normalizedPath, target: normalizedTarget } },
    });
    return created?.redirect || { path: normalizedPath, target: normalizedTarget };
  } catch (createErr) {
    // Last resort: another redirect appeared between delete and create.
    // Find it and update in-place.
    const query2 = new URLSearchParams({ path: normalizedPath, limit: "250" }).toString();
    const json2 = await shopifyRest(shop, accessToken, `redirects.json?${query2}`);
    const fallback = (json2?.redirects || []).find((r) => r.path === normalizedPath);
    if (!fallback?.id) throw createErr;
    const updated = await shopifyRest(shop, accessToken, `redirects/${fallback.id}.json`, {
      method: "PUT",
      body: { redirect: { id: fallback.id, path: normalizedPath, target: normalizedTarget } },
    });
    return updated?.redirect || { id: fallback.id, path: normalizedPath, target: normalizedTarget };
  }
}

// Force-override via GraphQL as a secondary attempt (used after REST succeeds to keep
// GraphQL state consistent, or as a fallback when REST is unavailable).
async function upsertStorefrontRedirectWithGraphql(shop, accessToken, path, target) {
  const existingRedirects = await findStorefrontRedirectsByPath(shop, accessToken, path);
  const [primaryRedirect, ...duplicateRedirects] = existingRedirects;

  const redirect = primaryRedirect
    ? await updateStorefrontRedirectWithGraphql(shop, accessToken, primaryRedirect.id, path, target)
    : await createStorefrontRedirectWithGraphql(shop, accessToken, path, target);

  await Promise.allSettled(
    duplicateRedirects.map((d) => deleteStorefrontRedirectWithGraphql(shop, accessToken, d.id)),
  );

  return redirect;
}

// Primary override strategy: REST delete-then-create (finds redirects from ANY app).
// Falls back to GraphQL upsert if REST fails entirely.
async function forceOverrideRedirect(shop, accessToken, path, target) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const normalizedTarget = target.startsWith("/") ? target : `/${target}`;

  try {
    return await forceOverrideRedirectWithRest(shop, accessToken, normalizedPath, normalizedTarget);
  } catch (restErr) {
    console.warn(`[llms-txt] REST force-override failed for ${normalizedPath}, trying GraphQL:`, restErr?.message);
    try {
      return await upsertStorefrontRedirectWithGraphql(shop, accessToken, normalizedPath, normalizedTarget);
    } catch (graphqlErr) {
      throw new Error(
        `Unable to force-override ${normalizedPath}: REST failed (${restErr?.message || "unknown"}); GraphQL failed (${graphqlErr?.message || "unknown"}).`,
      );
    }
  }
}

// Re-assertion tracker: prevent hammering the Shopify API on every request.
const redirectAssertedAt = new Map();
const REASSERT_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours

// Call this from serving routes to non-blockingly re-assert our redirect in the
// background so it survives other apps overwriting it over time.
export function reAssertRedirectsInBackground(shop) {
  const last = redirectAssertedAt.get(shop);
  if (last && Date.now() - last < REASSERT_INTERVAL_MS) return;
  redirectAssertedAt.set(shop, Date.now());
  publishRootDiscoveryRedirects(shop).catch((err) => {
    console.warn(`[llms-txt] Background redirect re-assertion failed for ${shop}:`, err?.message);
    redirectAssertedAt.delete(shop); // allow sooner retry
  });
}

async function publishRootDiscoveryRedirects(shop) {
  const shopRow = await db.shop.findUnique({
    where: { shop },
    select: {
      installed: true,
      accessToken: true,
    },
  });
  if (!shopRow?.installed || !shopRow.accessToken) {
    throw new Error("Shop is not installed or is missing an access token.");
  }

  // Force-override each path independently so one failure does not block the rest.
  const results = await Promise.allSettled([
    forceOverrideRedirect(shop, shopRow.accessToken, "/llms.txt", "/apps/llms-txt/llms.txt"),
    forceOverrideRedirect(shop, shopRow.accessToken, "/agent.md", "/apps/llms-txt/agent.md"),
    forceOverrideRedirect(shop, shopRow.accessToken, "/agents.md", "/apps/llms-txt/agents.md"),
  ]);

  return results.map((result) =>
    result.status === "fulfilled"
      ? { id: result.value?.id, path: result.value?.path, target: result.value?.target }
      : { error: result.reason?.message || "redirect failed" },
  );
}

function buildDiscoveryContext({ shop, data, shopRow }) {
  const shopData = data.shop || {};
  const shopUrl = normalizeUrl(shopData.primaryDomain?.url) || `https://${shop}`;
  const primaryDomain = shopData.primaryDomain?.host || new URL(shopUrl).host;
  const appProxyBaseUrl = canonicalUrl(shopUrl, "/apps/llms-txt");
  const llmsTxtUrl = canonicalUrl(shopUrl, "/llms.txt");
  const llmsTxtProxyUrl = canonicalUrl(shopUrl, "/apps/llms-txt/llms.txt");
  const llmsTxtAltUrl = canonicalUrl(shopUrl, "/apps/llms-txt/llms.text");
  const agentMdUrl = canonicalUrl(shopUrl, "/apps/llms-txt/agent.md");
  const agentsMdUrl = canonicalUrl(shopUrl, "/apps/llms-txt/agents.md");
  const pages = uniqueByUrl((data.pages?.nodes || [])
    .filter((page) => page.handle && !isPrivatePage(page))
    .map((page) => ({
      title: page.title,
      url: canonicalUrl(shopUrl, `/pages/${page.handle}`),
      description: page.bodySummary,
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
    .filter((collection) => collection.handle)
    .map((collection) => ({
      title: collection.title,
      url: canonicalUrl(shopUrl, `/collections/${collection.handle}`),
      description: collection.description,
    })));

  const articles = uniqueByUrl((data.articles?.nodes || [])
    .filter((article) => article.handle && article.blog?.handle)
    .map((article) => ({
      title: article.title,
      url: canonicalUrl(shopUrl, `/blogs/${article.blog.handle}/${article.handle}`),
      blogTitle: article.blog?.title,
      description: article.blog?.title ? `From ${article.blog.title}` : "",
    })));

  const faqPages = pages.filter(isFaqPage);
  const policyItems = [];
  const privacyPage = pages.find(isPrivacyPage);
  const refundPage = pages.find(isRefundPage);
  const shippingPage = pages.find(isShippingPage);
  const termsPage = pages.find(isTermsPage);
  const contactPage = pages.find(isContactPage);
  const aboutPage = pages.find(isAboutPage);
  if (privacyPage) policyItems.push({ title: policyLabel("privacyPolicy"), url: privacyPage.url });
  if (refundPage) policyItems.push({ title: policyLabel("refundPolicy"), url: refundPage.url });
  if (shippingPage) policyItems.push({ title: policyLabel("shippingPolicy"), url: shippingPage.url });
  if (termsPage) policyItems.push({ title: policyLabel("termsOfService"), url: termsPage.url });
  if (contactPage) policyItems.push({ title: "Contact Page", url: contactPage.url });
  if (aboutPage) policyItems.push({ title: "About Us Page", url: aboutPage.url });
  const additionalPolicyPages = pages.filter(isPolicyOrHelpPage);

  return {
    shop,
    shopData,
    shopUrl,
    appProxyBaseUrl,
    llmsTxtUrl,
    llmsTxtProxyUrl,
    llmsTxtAltUrl,
    agentMdUrl,
    agentsMdUrl,
    primaryDomain,
    llmsTxtCanonicalUrl: `https://${primaryDomain}/llms.txt`,
    agentMdCanonicalUrl: `https://${primaryDomain}/agent.md`,
    storeName: shopData.name || shopRow?.name || shop,
    shortDescription: shortText(shopData.description, 180) || "products and services from this Shopify store",
    longDescription: shortText(shopData.description, 500) || "Not provided",
    currency: shopData.currencyCode || shopRow?.currency || "Not provided",
    supportEmail: shopRow?.email || "Not provided",
    supportPhone: shopRow?.phone || "Not provided",
    businessHours: "Not provided",
    primaryCategory: products[0]?.productType || collections[0]?.title || "Not provided",
    targetCustomers: "Online shoppers",
    shoppingIntent: "Discover products, compare options, and complete checkout through Shopify.",
    supportedCountries: "Verify during checkout",
    primaryLanguage: "Not provided",
    products,
    collections,
    articles,
    pages,
    faqPages,
    policyItems: uniqueByUrl(policyItems),
    additionalPolicyPages: uniqueByUrl(additionalPolicyPages),
    generatedAt: new Date().toISOString(),
    appName: APP_NAME,
  };
}

function renderLlmsTxt({ shop, data, settings, shopRow }) {
  const ctx = buildDiscoveryContext({ shop, data, shopRow });
  const {
    storeName,
    shortDescription,
    longDescription,
    shopUrl,
    llmsTxtUrl,
    llmsTxtProxyUrl,
    llmsTxtAltUrl,
    llmsTxtCanonicalUrl,
    agentMdCanonicalUrl,
    agentMdUrl,
    currency,
    primaryCategory,
    targetCustomers,
    shoppingIntent,
    supportedCountries,
    primaryLanguage,
    products,
    collections,
    articles,
    pages,
    policyItems,
    additionalPolicyPages,
    supportEmail,
    supportPhone,
    businessHours,
    generatedAt,
    appName,
  } = ctx;

  const parts = [
    `# ${storeName}`,
    "",
    shortDescription,
    "",
    `Generated by ${appName}.`,
    "",
    `${storeName} is an online Shopify store available at ${shopUrl}. This file helps AI assistants, search agents, shopping assistants, and language models understand the store's products, collections, content, policies, and important shopping pages.`,
    "",
    `LLMs.txt: ${llmsTxtCanonicalUrl}`,
    `Agent.md: ${agentMdCanonicalUrl}`,
    "",
    `For full agent behavior, cart actions, checkout rules, and purchase safety instructions, see: ${agentMdUrl}`,
    "",
    section("Store Overview", [
      `- Store name: ${storeName}`,
      `- Store URL: ${shopUrl}`,
      "- Platform: Shopify",
      `- Primary category: ${primaryCategory}`,
      `- Store description: ${longDescription}`,
      `- Target customers: ${targetCustomers}`,
      `- Main shopping intent: ${shoppingIntent}`,
      `- Default currency: ${currency}`,
      `- Supported countries/regions: ${supportedCountries}`,
      `- Primary language: ${primaryLanguage}`,
      "",
      "AI assistants should use this file to understand the store's catalog, collections, blog content, important pages, and shopping context.",
      "For current price, stock, product variants, discounts, taxes, shipping rates, and checkout availability, always verify live Shopify product, cart, or checkout data.",
    ]),
    "",
    section("Product Discovery", [
      "Agents and LLMs can discover products using the following store routes:",
      "- Browse all products: GET /collections/all",
      "- Product page: GET /products/{handle}",
      "- Product JSON: GET /products/{handle}.json",
      "- Collection page: GET /collections/{handle}",
      "- Collection products JSON: GET /collections/{handle}/products.json",
      "- Product search: GET /search?q={query}&type=product",
      "- Store sitemap: GET /sitemap.xml",
      "- Agent instructions: GET /apps/llms-txt/agent.md",
      "- Alternate agent instructions: GET /apps/llms-txt/agents.md",
      "- LLM discovery file: GET /llms.txt",
      "- App proxy LLM discovery file: GET /apps/llms-txt/llms.txt",
      "- Alternate LLM discovery file: GET /apps/llms-txt/llms.text",
      "",
      "When recommending products, prefer live product pages or product JSON for accurate price, variants, availability, and product options.",
    ]),
  ];

  if (settings.products) {
    parts.push("", section("Featured Products", renderNamedItems(products.slice(0, 12), {
      emptyText: "No featured products are currently defined. Use the main catalog, collections, or search endpoint to discover products.",
    })));
    parts.push("", section("Product Catalog", products.length <= 100
      ? renderNamedItems(products, { emptyText: "No public products are currently listed." })
      : [
          "This store has a large product catalog. To keep this file readable for AI systems, only featured products and main collections are listed directly.",
          "For the full catalog, use:",
          `- ${markdownLink("All Products", canonicalUrl(shopUrl, "/collections/all"))}`,
          `- ${markdownLink("Store Sitemap", canonicalUrl(shopUrl, "/sitemap.xml"))}`,
          "- Product search: GET /search?q={query}&type=product",
          "- Product JSON: GET /products/{handle}.json",
          "- Collection products JSON: GET /collections/{handle}/products.json",
        ]));
  }

  if (settings.collections) {
    parts.push("", section("Main Collections", renderNamedItems(collections, {
      emptyText: "No public collections are currently listed. Use All Products or product search.",
    })));
  }

  if (settings.blogs) {
    parts.push("", section("Blog Posts and Buying Guides", renderNamedItems(articles, {
      emptyText: "No blog posts or buying guides are currently listed.",
    })));
  }

  if (settings.pages) {
    parts.push("", section("Important Pages", renderNamedItems(pages, {
      emptyText: "No extra public pages are currently listed.",
    })));
  }

  if (settings.policies) {
    parts.push("", section("Store Policies", [
      "Agents and AI assistants should review the relevant Shopify policy pages before answering questions about privacy, shipping, delivery, returns, refunds, cancellations, or customer support.",
      ...renderNamedItems(policyItems, { emptyText: "If a policy is not listed here, agents should look for it in the store footer, sitemap, or Shopify policy routes." }),
    ]));
    parts.push("", section("Additional Policy and Help Pages", [
      "These are merchant-created pages that may contain extra store-specific information about shipping, returns, exchanges, FAQs, tracking, warranty, sizing, product care, or customer support.",
      ...renderNamedItems(additionalPolicyPages, { emptyText: "No additional policy or help pages are currently listed." }),
      "Agents should check both default Shopify policies and additional policy/help pages before answering policy-related questions.",
    ]));
  }

  parts.push("", section("Customer Support", [
    `- Contact page: ${canonicalUrl(shopUrl, "/pages/contact")}`,
    `- Support email: ${supportEmail}`,
    `- Support phone: ${supportPhone}`,
    `- Business hours: ${businessHours}`,
    "If support details are unavailable, direct users to the store contact page.",
  ]));

  parts.push("", section("AI Recommendation Rules", [
    "When helping a shopper, AI assistants should:",
    "- Understand the shopper's intent, budget, use case, preferred style, size, color, material, category, quantity, shipping country, and currency.",
    "- Recommend products from the most relevant collection first.",
    "- Use product search when the shopper asks for a specific product, keyword, style, category, or use case.",
    "- Prefer in-stock products when live availability is accessible.",
    "- Always verify current price, variants, inventory, discounts, taxes, shipping rates, and checkout details using live Shopify data.",
    "- Do not assume a product is available only because it appears in this file.",
    "- If a product has variants, confirm the correct variant before cart or checkout.",
    "- If the user asks for current discounts, offers, bundles, delivery dates, or stock status, verify live store data before responding.",
    "- Do not invent product features, guarantees, certifications, or policy terms that are not shown in the store data.",
    "- If this file conflicts with live Shopify product pages, product JSON, cart, or checkout data, prefer live Shopify data.",
  ]));

  parts.push("", section("Agent and Commerce Safety", [
    `For full agent behavior, cart, checkout, and purchase instructions, see: ${agentMdUrl}`,
    "Important rules for shopping agents:",
    "- Checkout requires human approval. Agents must not complete payment without explicit buyer consent at the moment of purchase.",
    "- Verify live data. Prices, inventory, variants, discounts, taxes, shipping rates, and checkout availability must be verified using live Shopify product, cart, or checkout data.",
    "- Respect rate limits. If using MCP, UCP, storefront APIs, or structured commerce endpoints, agents should back off on 429 responses.",
    "- Use buyer context. When supported, pass buyer country, shipping destination, currency, quantity, language, and relevant preferences for accurate pricing and availability.",
    "- Do not rely only on this file for purchase decisions. This file is for discovery. Live Shopify data is the source of truth.",
    "- Do not bypass checkout. Agents should use Shopify checkout or supported commerce protocols and must not create unsupported payment flows.",
    "- Do not handle raw payment card data. Payment should happen only through buyer-approved Shopify checkout or trusted buyer-approved payment flows.",
    "",
    "Useful agent commerce resources:",
    "- UCP specification: https://ucp.dev",
    "- Shop skill: https://shop.app/SKILL.md",
    `- Store agent instructions: ${agentMdUrl}`,
    `- Store LLM discovery file: ${llmsTxtUrl}`,
    `- App proxy Store LLM discovery file: ${llmsTxtProxyUrl}`,
    `- Alternate Store LLM discovery file: ${llmsTxtAltUrl}`,
    `- Store sitemap: ${shopUrl}/sitemap.xml`,
  ]));

  parts.push("", section("Optional Commerce Protocol Support", [
    "No verified UCP/MCP endpoint is currently declared in this file.",
    "Agents should use public Shopify storefront routes, product pages, collection pages, product JSON, cart routes, sitemap, and Shopify checkout flow.",
  ]));

  if (settings.sitemap) {
    parts.push("", section("Freshness and Accuracy", [
      "This file is generated from Shopify store data and may not always reflect real-time pricing, inventory, variants, taxes, shipping rates, discounts, promotions, or checkout availability.",
      `- Last updated: ${generatedAt}`,
      `- Generated by: ${appName}`,
      "- Source: Shopify store data",
      "- Store platform: Shopify",
      "If this file conflicts with live Shopify product pages, product JSON, cart, checkout, policy pages, or order data, agents must prefer live Shopify data.",
    ]));
  }

  return formatGeneratedFile(parts);
}

function renderAgentsMd({ shop, data, shopRow }) {
  const ctx = buildDiscoveryContext({ shop, data, shopRow });
  const {
    storeName,
    shortDescription,
    shopUrl,
    llmsTxtUrl,
    llmsTxtCanonicalUrl,
    agentMdCanonicalUrl,
    policyItems,
    additionalPolicyPages,
    supportEmail,
    supportPhone,
    businessHours,
    generatedAt,
    appName,
  } = ctx;

  const policyList = renderNamedItems(policyItems, { emptyText: "- No default Shopify policy pages are currently listed." }).join("\n");
  const additionalPolicyList = renderNamedItems(additionalPolicyPages, { emptyText: "- No additional policy or help pages are currently listed." }).join("\n");

  return [
    `# Agent Instructions — ${storeName}`,
    ``,
    `> This file explains how AI agents and shopping assistants should interact with **${storeName}**.`,
    `> Store URL: ${shopUrl}`,
    `> Agent.md: ${agentMdCanonicalUrl}`,
    `> Generated by ${appName} · Last updated: ${generatedAt}`,
    ``,
    `For full store catalog, products, collections, blogs, pages, and policy discovery, see:`,
    `LLMs.txt: ${llmsTxtCanonicalUrl}`,
    ``,
    `---`,
    ``,
    `## Store Summary`,
    ``,
    `**${storeName}** is a Shopify store offering ${shortDescription}.`,
    ``,
    `Agents should help shoppers discover products, compare options, choose variants, review the cart, and move to checkout safely.`,
    ``,
    `---`,
    ``,
    `## Important Rules`,
    ``,
    `- **Human approval required** — Agents must not complete payment without explicit buyer consent at the moment of purchase.`,
    `- **Use live Shopify data** — Verify current price, variants, inventory, discounts, taxes, shipping, and checkout details before purchase.`,
    `- **Confirm before action** — Before adding to cart or checkout, confirm product, variant, quantity, and paid options with the buyer.`,
    `- **No guessing** — Do not invent product features, delivery dates, discounts, policy terms, or availability.`,
    `- **Respect rate limits** — If an endpoint returns 429, back off before retrying.`,
    `- **Use buyer context** — When supported, pass buyer country, currency, shipping destination, quantity, language, and preferences.`,
    `- **Protect buyer privacy** — Do not expose private buyer data, address, payment details, or order information without authorization.`,
    `- **No raw payment data** — Payment must happen only through Shopify checkout or trusted buyer-approved payment flows.`,
    ``,
    `---`,
    ``,
    `## Recommended Agent Flow`,
    ``,
    `### 1. Discover`,
    ``,
    `- \`GET /llms.txt\``,
    `- \`GET /apps/llms-txt/llms.txt\``,
    `- \`GET /apps/llms-txt/llms.text\``,
    `- \`GET /apps/llms-txt/agent.md\``,
    `- \`GET /apps/llms-txt/agents.md\``,
    `- \`GET /sitemap.xml\``,
    `- If supported: \`GET /.well-known/ucp\`, \`POST /api/mcp\`, \`POST /api/ucp/mcp\``,
    `- Agents should not assume MCP tools are available. If MCP is available, call \`tools/list\` before using structured commerce tools.`,
    ``,
    `### 2. Understand Buyer Intent`,
    ``,
    `- Identify product type, category, budget, quantity, size, color, material, style, shipping country, preferred currency, use case, gift purpose, or urgency.`,
    `- Ask a short clarification if the buyer request is unclear.`,
    ``,
    `### 3. Search Products`,
    ``,
    `- Browse all products: \`GET /collections/all\``,
    `- Search products: \`GET /search?q={query}&type=product\``,
    `- Product page: \`GET /products/{handle}\``,
    `- Product JSON: \`GET /products/{handle}.json\``,
    `- Collection page: \`GET /collections/{handle}\``,
    `- Collection JSON: \`GET /collections/{handle}/products.json\``,
    `- Sitemap: \`GET /sitemap.xml\``,
    `- Prefer live product pages or product JSON for current price, variants, and availability.`,
    ``,
    `### 4. Recommend Products`,
    ``,
    `- Show the best matching products first.`,
    `- Include direct product links.`,
    `- Explain why each product fits the buyer's request.`,
    `- Mention required variant choices.`,
    `- Avoid unavailable products if availability is known.`,
    `- Do not claim discounts, delivery times, or policy terms unless verified.`,
    ``,
    `### 5. Add to Cart`,
    ``,
    `- Only add an item after the buyer confirms product, variant, quantity, price (if available), and custom or paid options.`,
    `- Add to cart: \`POST /cart/add.js\``,
    `- View cart: \`GET /cart\``,
    `- Cart JSON: \`GET /cart.js\``,
    `- Change cart item: \`POST /cart/change.js\``,
    `- Update cart: \`POST /cart/update.js\``,
    `- Clear cart only after confirmation: \`POST /cart/clear.js\``,
    `- If UCP/MCP tools are available, prefer structured commerce tools over visual scraping.`,
    ``,
    `### 6. Review Cart`,
    ``,
    `- Before checkout, show product names, variants, quantities, prices (if available), discounts (if applied), estimated subtotal (if available), and shipping country or address (if needed).`,
    `- Ask the buyer to confirm the cart before continuing.`,
    ``,
    `### 7. Checkout and Payment`,
    ``,
    `- Agents may help start checkout, but payment requires clear buyer approval.`,
    `- **Valid approval examples**: "Yes, place the order.", "I approve this payment.", "Complete checkout.", "Buy it now."`,
    `- **Invalid approval examples**: "Looks good.", "Maybe.", "Show me checkout.", or old approval from a previous session.`,
    `- Agents must not complete payment if approval is missing, unclear, old, or unavailable.`,
    ``,
    `---`,
    ``,
    `## UCP and MCP Support`,
    ``,
    `No verified UCP/MCP endpoint is currently declared.`,
    ``,
    `Agents should use public Shopify storefront routes, product JSON, collection JSON, cart routes, sitemap, and Shopify checkout.`,
    ``,
    `- UCP specification: https://ucp.dev`,
    `- Shop skill: https://shop.app/SKILL.md`,
    ``,
    `---`,
    ``,
    `## Store Policies and Help Pages`,
    ``,
    `Agents should review policy pages before answering questions about shipping, returns, refunds, privacy, terms, cancellations, warranty, sizing, tracking, or support.`,
    ``,
    policyList,
    ``,
    `### Additional Policy and Help Pages`,
    ``,
    additionalPolicyList,
    ``,
    `Do not guess policy details if they are not verified from live policy pages or additional help pages.`,
    ``,
    `---`,
    ``,
    `## Customer Support`,
    ``,
    `- Contact page: ${canonicalUrl(shopUrl, "/pages/contact")}`,
    `- Support email: ${supportEmail}`,
    `- Support phone: ${supportPhone}`,
    `- Business hours: ${businessHours}`,
    ``,
    `If support details are unavailable, direct the buyer to the contact page.`,
    ``,
    `---`,
    ``,
    `## Accuracy Rule`,
    ``,
    `If this file conflicts with live Shopify product pages, product JSON, cart, checkout, policy pages, or structured commerce tools, agents must **prefer live Shopify data**.`,
    ``,
    `---`,
    ``,
    `## Generated Metadata`,
    ``,
    `- Last updated: ${generatedAt}`,
    `- Generated by: ${appName}`,
    `- Store: ${storeName}`,
    `- Platform: Shopify`,
    ``,
  ].join("\n");
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
    select: {
      installed: true,
      accessToken: true,
      globalSettingsJson: true,
      name: true,
      currency: true,
      email: true,
      phone: true,
      primaryDomain: true,
    },
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
  const content = renderLlmsTxt({ shop, data, settings, shopRow });
  responseCache.set(cacheKey, { content, createdAt: Date.now() });
  return content;
}

export async function generateDynamicAgentsMd(shop, options = {}) {
  const cacheKey = `agents:${shop}`;
  const cached = responseCache.get(cacheKey);
  if (!options.force && cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.content;
  }

  const shopRow = await db.shop.findUnique({
    where: { shop },
    select: {
      installed: true,
      accessToken: true,
      name: true,
      currency: true,
      email: true,
      phone: true,
      primaryDomain: true,
    },
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
  const content = renderAgentsMd({ shop, data, shopRow });
  responseCache.set(cacheKey, { content, createdAt: Date.now() });
  return content;
}

export async function readStoredLlmsTxtContent(shop) {
  const stored = await db.aiVisibilityLlmsTxt.findUnique({
    where: { shop },
    select: { content: true },
  });
  return stored?.content || "";
}

export async function readStoredAgentMdContent(shop) {
  const stored = await db.aiVisibilityLlmsTxt.findUnique({
    where: { shop },
    select: { agentContent: true },
  });
  return stored?.agentContent || "";
}

export function invalidateLlmsTxtCache(shop) {
  responseCache.delete(`llms:${shop}`);
  responseCache.delete(`agents:${shop}`);
}

export async function generateAndStoreDynamicLlmsTxt(shop, options = {}) {
  const credits = LLMS_GENERATION_CREDITS;
  await deductCredits({ shopDomain: shop, creditsUsed: credits });

  try {
    // Regenerate both files in parallel, force-bypassing cache for both
    const [content, agentContent] = await Promise.all([
      generateDynamicLlmsTxt(shop, { ...options, force: true }),
      generateDynamicAgentsMd(shop, { force: true }),
    ]);
    const itemCount = (content.match(/^- /gm) || []).length;
    await db.aiVisibilityLlmsTxt.upsert({
      where: { shop },
      create: { shop, content, agentContent, itemCount, creditsUsed: credits },
      update: { content, agentContent, itemCount, creditsUsed: credits, updatedAt: new Date() },
    });
    const redirects = await publishRootDiscoveryRedirects(shop);
    return { content, creditsUsed: credits, redirects };
  } catch (error) {
    await refundCredits({ shopDomain: shop, creditsRefunded: credits });
    throw error;
  }
}

export function generateAiRobotsTxt() {
  return `${renderRobotsRules()}\n`;
}
