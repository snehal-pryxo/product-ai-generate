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

// ============================================================================
// SHOPIFY FILES (CDN) — upload llms.txt so it is served from Shopify's CDN,
// then redirect /llms.txt → CDN URL.  This is more reliable than the app
// proxy approach because:
//   • File lives on Shopify's global CDN (fast, no app dependency)
//   • Redirect target is unique per shop — other apps cannot overwrite it
//   • AI bots follow 301 redirects and read plain-text from CDN correctly
// ============================================================================

const STAGED_UPLOADS_CREATE = `#graphql
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const FILE_CREATE = `#graphql
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        ... on GenericFile {
          id
          url
          fileStatus
        }
      }
      userErrors { field message }
    }
  }
`;

const FILE_DELETE = `#graphql
  mutation FileDelete($fileIds: [ID!]!) {
    fileDelete(fileIds: $fileIds) {
      deletedFileIds
      userErrors { field message }
    }
  }
`;

const FILES_QUERY = `#graphql
  query FilesQuery($query: String!) {
    files(first: 50, query: $query, sortKey: CREATED_AT) {
      nodes {
        ... on GenericFile {
          id
          url
          fileStatus
        }
      }
    }
  }
`;

const FILE_STATUS_QUERY = `#graphql
  query FileStatus($id: ID!) {
    node(id: $id) {
      ... on GenericFile {
        id
        url
        fileStatus
      }
    }
  }
`;

// Upload a text file to Shopify Content → Files and return the CDN URL.
// Flow: stagedUploadsCreate → PUT to presigned URL → fileCreate → poll for URL.
async function uploadToShopifyFiles(adminGraphQL, filename, content, mimeType = "text/plain") {
  const byteLen = Buffer.byteLength(content, "utf-8");
  console.log(`[llms-cdn] Uploading ${filename} (${byteLen} bytes) to Shopify Files...`);

  // Step 1 — delete any existing files with the same name to avoid accumulation.
  try {
    const listRes = await adminGraphQL(FILES_QUERY, { variables: { query: `filename:${filename}` } });
    const listJson = await listRes.json();
    // Match by URL path since GenericFile has no filename field in GQL schema.
    const existing = (listJson?.data?.files?.nodes || []).filter(
      (f) => String(f.url || "").includes(`/${filename}`),
    );
    if (existing.length > 0) {
      const ids = existing.map((f) => f.id);
      console.log(`[llms-cdn] Deleting ${ids.length} existing ${filename} file(s): ${ids.join(", ")}`);
      await adminGraphQL(FILE_DELETE, { variables: { fileIds: ids } });
    }
  } catch (delErr) {
    console.warn(`[llms-cdn] Could not delete old ${filename}: ${delErr?.message}`);
  }

  // Step 2 — create staged upload (presigned URL).
  const stageRes = await adminGraphQL(STAGED_UPLOADS_CREATE, {
    variables: {
      input: [{
        filename,
        mimeType,
        httpMethod: "POST",
        resource: "FILE",
        fileSize: String(byteLen),
      }],
    },
  });
  const stageJson = await stageRes.json();
  const stageErrs = stageJson?.data?.stagedUploadsCreate?.userErrors || [];
  if (stageErrs.length) throw new Error(`stagedUploadsCreate: ${stageErrs.map((e) => e.message).join(", ")}`);
  const target = stageJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url) throw new Error(`No staged upload target returned for ${filename}`);

  // Step 3 — upload file content to presigned URL.
  const form = new FormData();
  for (const { name, value } of (target.parameters || [])) {
    form.append(name, value);
  }
  form.append("file", new Blob([content], { type: mimeType }), filename);
  const uploadRes = await fetch(target.url, { method: "POST", body: form });
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => "");
    throw new Error(`Presigned upload HTTP ${uploadRes.status}: ${body.substring(0, 200)}`);
  }
  console.log(`[llms-cdn] Presigned upload for ${filename} succeeded`);

  // Step 4 — register file in Shopify Files.
  const fileRes = await adminGraphQL(FILE_CREATE, {
    variables: {
      files: [{
        alt: `${filename} — AI discovery`,
        contentType: "FILE",
        originalSource: target.resourceUrl,
      }],
    },
  });
  const fileJson = await fileRes.json();
  const fileErrs = fileJson?.data?.fileCreate?.userErrors || [];
  if (fileErrs.length) throw new Error(`fileCreate: ${fileErrs.map((e) => e.message).join(", ")}`);

  const file = fileJson?.data?.fileCreate?.files?.[0];
  if (file?.url) {
    console.log(`[llms-cdn] ${filename} → ${file.url} (immediate)`);
    return file.url;
  }

  // Step 5 — poll until file status = READY (Shopify processes asynchronously).
  const fileId = file?.id;
  if (fileId) {
    for (let attempt = 1; attempt <= 6; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      const pollRes = await adminGraphQL(FILE_STATUS_QUERY, { variables: { id: fileId } });
      const pollJson = await pollRes.json();
      const ready = pollJson?.data?.node;
      if (ready?.url) {
        console.log(`[llms-cdn] ${filename} READY → ${ready.url} (poll attempt ${attempt})`);
        return ready.url;
      }
      console.log(`[llms-cdn] ${filename} status=${ready?.fileStatus || "PENDING"} (attempt ${attempt}/6)`);
    }
  }

  throw new Error(`${filename} upload timed out — CDN URL not available after 12 s`);
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

// ============================================================================
// LLMS.TXT REDIRECT MANAGER
// Ensures /llms.txt, /agents.md, /agent.md always point to our app proxy,
// regardless of what other apps have configured.
// ============================================================================

const OUR_PROXY_PREFIX = "/apps/llms-txt/";

// The redirect map — path on storefront → our app proxy target.
const LLMS_REDIRECTS = [
  { path: "/llms.txt",  target: "/apps/llms-txt/llms.txt"  },
  { path: "/agents.md", target: "/apps/llms-txt/agents.md" },
  { path: "/agent.md",  target: "/apps/llms-txt/agent.md"  },
];

function isOurRedirect(target) {
  return String(target || "").startsWith(OUR_PROXY_PREFIX);
}

// ─── Session-client redirect manager ─────────────────────────────────────────
// Strategy: UPDATE (atomic, works even if another app owns the redirect).
// Falls back to DELETE+CREATE only when UPDATE itself reports userErrors.
// Always verifies the redirect after the operation.

async function resolveOneRedirectWithSession(adminGraphQL, path, target) {
  const LOG = `[llms-redirect]`;

  // Step 1 — query current state of this path.
  const findRes = await adminGraphQL(URL_REDIRECTS_BY_PATH_QUERY, {
    variables: { query: redirectSearchQuery(path) },
  });
  const findJson = await findRes.json();
  const existing = (findJson?.data?.urlRedirects?.nodes || []).filter((r) => r.path === path);
  const [primary, ...duplicates] = existing;

  console.log(
    `${LOG} ${path}: ${existing.length} redirect(s) found` +
    (primary ? ` — current target: "${primary.target}"` : " — none"),
  );

  // Step 2 — remove any duplicates silently.
  if (duplicates.length > 0) {
    console.warn(`${LOG} ${path}: removing ${duplicates.length} duplicate(s)`);
    await Promise.allSettled(
      duplicates.map((d) =>
        adminGraphQL(URL_REDIRECT_DELETE_MUTATION, { variables: { id: d.id } }).catch(() => {}),
      ),
    );
  }

  // Step 3 — no redirect exists → CREATE.
  if (!primary) {
    console.log(`${LOG} CREATE ${path} → ${target}`);
    const createRes = await adminGraphQL(URL_REDIRECT_CREATE_MUTATION, {
      variables: { urlRedirect: { path, target } },
    });
    const createJson = await createRes.json();
    const errs = createJson?.data?.urlRedirectCreate?.userErrors || [];
    if (errs.length) throw new Error(`CREATE ${path}: ${errs.map((e) => e.message).join(", ")}`);
    const created = createJson?.data?.urlRedirectCreate?.urlRedirect;
    console.log(`${LOG} ✓ CREATED ${path} → "${created?.target || target}"`);
    return { action: "created", path, target: created?.target || target };
  }

  // Step 4 — redirect already points to correct target → done.
  if (primary.target === target) {
    console.log(`${LOG} ✓ OK (unchanged) ${path} → "${primary.target}"`);
    return { action: "unchanged", path, target };
  }

  // Step 4b — CRITICAL: if the existing redirect already points to a Shopify CDN file
  // and the new target is just an app proxy path, PRESERVE the CDN redirect.
  // This prevents the 10-min background re-assertion from reverting CDN redirects back
  // to the app proxy every time the AI Visibility page is loaded.
  const existingIsCdnFile = String(primary.target).includes("cdn.shopify.com");
  const newTargetIsProxy  = String(target).startsWith("/apps/");
  if (existingIsCdnFile && newTargetIsProxy) {
    console.log(
      `${LOG} PRESERVE CDN: ${path} → "${primary.target}" ` +
      `(keeping CDN URL, not reverting to app proxy)`,
    );
    return { action: "unchanged_cdn", path, target: primary.target };
  }

  // Step 5 — wrong target: use UPDATE (atomic — works even if another app owns it).
  const wasConflict = !isOurRedirect(primary.target);
  console.warn(
    `${LOG} ${wasConflict ? "CONFLICT" : "STALE"}: ${path} → "${primary.target}" ` +
    `→ updating to "${target}"`,
  );

  const updateRes = await adminGraphQL(URL_REDIRECT_UPDATE_MUTATION, {
    variables: { id: primary.id, urlRedirect: { path, target } },
  });
  const updateJson = await updateRes.json();
  const updateErrs = updateJson?.data?.urlRedirectUpdate?.userErrors || [];

  if (!updateErrs.length) {
    const updated = updateJson?.data?.urlRedirectUpdate?.urlRedirect;
    console.log(`${LOG} ✓ UPDATED ${path} → "${updated?.target || target}"`);
    return { action: wasConflict ? "conflict_resolved" : "updated", path, target: updated?.target || target };
  }

  // Step 6 — UPDATE failed: fall back to DELETE + CREATE.
  console.warn(`${LOG} UPDATE failed (${updateErrs.map((e) => e.message).join(", ")}) — trying DELETE+CREATE`);

  const delRes = await adminGraphQL(URL_REDIRECT_DELETE_MUTATION, { variables: { id: primary.id } });
  const delJson = await delRes.json();
  const delErrs = delJson?.data?.urlRedirectDelete?.userErrors || [];
  if (delErrs.length) {
    console.warn(`${LOG} DELETE also failed: ${delErrs.map((e) => e.message).join(", ")}`);
  } else {
    console.log(`${LOG} DELETED ${primary.id} (was "${primary.target}")`);
  }

  const createRes2 = await adminGraphQL(URL_REDIRECT_CREATE_MUTATION, {
    variables: { urlRedirect: { path, target } },
  });
  const createJson2 = await createRes2.json();
  const createErrs2 = createJson2?.data?.urlRedirectCreate?.userErrors || [];
  if (createErrs2.length) throw new Error(`CREATE (fallback) ${path}: ${createErrs2.map((e) => e.message).join(", ")}`);
  const created2 = createJson2?.data?.urlRedirectCreate?.urlRedirect;
  console.log(`${LOG} ✓ CREATED (fallback) ${path} → "${created2?.target || target}"`);
  return { action: wasConflict ? "conflict_resolved" : "recreated", path, target: created2?.target || target };
}

// ─── Post-operation redirect verification ────────────────────────────────────
async function verifyRedirects(adminGraphQL, redirectMap) {
  const results = [];
  for (const { path, expectedTarget } of redirectMap) {
    try {
      const res = await adminGraphQL(URL_REDIRECTS_BY_PATH_QUERY, {
        variables: { query: redirectSearchQuery(path) },
      });
      const json = await res.json();
      const found = (json?.data?.urlRedirects?.nodes || []).find((r) => r.path === path);
      const ok = found?.target === expectedTarget;
      if (ok) {
        console.log(`[llms-verify] ✓ ${path} → "${found.target}"`);
      } else {
        console.warn(
          `[llms-verify] ✗ ${path}: expected "${expectedTarget}" ` +
          `but Shopify has "${found?.target || "NOT FOUND"}"`,
        );
      }
      results.push({ path, expectedTarget, actualTarget: found?.target, verified: ok });
    } catch (err) {
      console.warn(`[llms-verify] Error verifying ${path}: ${err?.message}`);
      results.push({ path, expectedTarget, verified: false, error: err?.message });
    }
  }
  return results;
}

// ─── REST fallback (stored access token) ─────────────────────────────────────
// DELETE-then-CREATE guarantees we win even if another app owns the redirect.

async function resolveOneRedirectWithRest(shop, accessToken, path, target) {
  const normPath   = path.startsWith("/")   ? path   : `/${path}`;
  const normTarget = target.startsWith("/") ? target : `/${target}`;

  // Find all existing redirects for this path.
  let existingList = [];
  try {
    const q = new URLSearchParams({ path: normPath, limit: "250" }).toString();
    const json = await shopifyRest(shop, accessToken, `redirects.json?${q}`);
    existingList = (json?.redirects || []).filter((r) => r.path === normPath);
  } catch (listErr) {
    console.warn(`[llms-redirect] REST list failed for ${normPath}:`, listErr?.message);
  }

  // Log conflicts.
  const conflicting = existingList.filter((r) => !isOurRedirect(r.target));
  if (conflicting.length > 0) {
    console.warn(
      `[llms-redirect] REST CONFLICT: ${normPath} owned by another app: ` +
      conflicting.map((r) => r.target).join(", ") + " — overriding.",
    );
  }

  // Delete all existing (including other apps').
  await Promise.allSettled(
    existingList.map((r) =>
      shopifyRest(shop, accessToken, `redirects/${r.id}.json`, { method: "DELETE" }).catch((e) =>
        console.warn(`[llms-redirect] REST delete ${r.id} failed:`, e?.message),
      ),
    ),
  );

  // Create ours fresh.
  try {
    const created = await shopifyRest(shop, accessToken, "redirects.json", {
      method: "POST",
      body: { redirect: { path: normPath, target: normTarget } },
    });
    console.log(`[llms-redirect] REST created ${normPath} → ${normTarget}`);
    return { action: "rest_created", path: normPath, target: normTarget, id: created?.redirect?.id };
  } catch (createErr) {
    // Race condition: re-find and update.
    const q2 = new URLSearchParams({ path: normPath, limit: "250" }).toString();
    const json2 = await shopifyRest(shop, accessToken, `redirects.json?${q2}`);
    const race = (json2?.redirects || []).find((r) => r.path === normPath);
    if (!race?.id) throw createErr;
    await shopifyRest(shop, accessToken, `redirects/${race.id}.json`, {
      method: "PUT",
      body: { redirect: { id: race.id, path: normPath, target: normTarget } },
    });
    console.log(`[llms-redirect] REST race-updated ${normPath} → ${normTarget}`);
    return { action: "rest_race_updated", path: normPath, target: normTarget };
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────
// Resolves all three paths. Uses session client (primary) then REST (fallback).

async function publishRootDiscoveryRedirects(shop, adminGraphQL) {
  const shopRow = await db.shop.findUnique({
    where: { shop },
    select: { installed: true, accessToken: true },
  });
  if (!shopRow?.installed || !shopRow.accessToken) {
    throw new Error(`[llms-redirect] Shop ${shop} not installed or missing access token.`);
  }

  const results = await Promise.allSettled(
    LLMS_REDIRECTS.map(async ({ path, target }) => {
      // Primary: session-based admin.graphql (has all session scopes).
      if (adminGraphQL) {
        try {
          return await resolveOneRedirectWithSession(adminGraphQL, path, target);
        } catch (sessionErr) {
          console.warn(`[llms-redirect] Session client failed for ${path}:`, sessionErr?.message);
        }
      }
      // Fallback: REST with stored access token.
      return resolveOneRedirectWithRest(shop, shopRow.accessToken, path, target);
    }),
  );

  const output = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { path: LLMS_REDIRECTS[i].path, error: r.reason?.message || "failed" },
  );
  console.log("[llms-redirect] Results:", JSON.stringify(output));
  return output;
}

// ─── Exported helper: call from loader to keep redirect current ───────────────
// Throttle: 10 min with session client, 3 hrs for public proxy routes.
const redirectAssertedAt = new Map();

export function reAssertRedirectsInBackground(shop, adminGraphQL) {
  const INTERVAL = adminGraphQL ? 10 * 60 * 1000 : 3 * 60 * 60 * 1000;
  const last = redirectAssertedAt.get(shop);
  if (last && Date.now() - last < INTERVAL) return;
  redirectAssertedAt.set(shop, Date.now());
  publishRootDiscoveryRedirects(shop, adminGraphQL).catch((err) => {
    console.warn(`[llms-redirect] Background re-assertion failed for ${shop}:`, err?.message);
    redirectAssertedAt.delete(shop); // allow sooner retry on error
  });
}

// Exported for direct call (no throttle) — used on generate/regenerate.
export async function ensureLlmsTxtRedirects(shop, adminGraphQL) {
  return publishRootDiscoveryRedirects(shop, adminGraphQL);
}

// ─── CDN-aware redirect sync ──────────────────────────────────────────────────
// Queries Shopify Files for the uploaded llms.txt / agents.md and sets redirects
// to the actual CDN URLs (https://cdn.shopify.com/...).
// This is the CORRECT fix — CDN URL is unique per upload, other apps cannot
// serve content at that URL, so the redirect is stable.

async function getCdnUrlsFromShopifyFiles(adminGraphQL) {
  // Use broad search — Shopify Files query is fuzzy on filename.
  // We fetch up to 50 files per type and filter/pick the most recent READY one.
  const [llmsRes, agentsRes] = await Promise.all([
    adminGraphQL(FILES_QUERY, { variables: { query: "llms" } }),
    adminGraphQL(FILES_QUERY, { variables: { query: "agents" } }),
  ]);
  const llmsJson   = await llmsRes.json();
  const agentsJson = await agentsRes.json();

  // Pick the LAST matching READY file — sortKey: CREATED_AT returns oldest-first,
  // so the last item in the list is the most recently uploaded file.
  const pickLatestUrl = (nodes, keyword) => {
    const matches = (nodes || [])
      .filter((f) => f.fileStatus === "READY" && String(f.url || "").includes(keyword));
    return matches.length > 0 ? matches[matches.length - 1].url : null;
  };

  const llmsTxtCdnUrl  = pickLatestUrl(llmsJson?.data?.files?.nodes,   "llms.txt");
  const agentsMdCdnUrl = pickLatestUrl(agentsJson?.data?.files?.nodes, "agents.md");

  console.log(`[llms-cdn] Files query — llms.txt:  ${llmsTxtCdnUrl  || "NOT FOUND (not yet uploaded)"}`);
  console.log(`[llms-cdn] Files query — agents.md: ${agentsMdCdnUrl || "NOT FOUND (not yet uploaded)"}`);
  return { llmsTxtCdnUrl, agentsMdCdnUrl };
}

const cdnSyncThrottle = new Map();
const CDN_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export async function syncCdnRedirects(shop, adminGraphQL) {
  if (!adminGraphQL) {
    console.warn("[llms-cdn] syncCdnRedirects requires adminGraphQL — skipping");
    return { skipped: true };
  }

  // Throttle: run at most once every 5 min per shop (avoids slow page loads on every visit).
  const last = cdnSyncThrottle.get(shop);
  if (last && Date.now() - last < CDN_SYNC_INTERVAL_MS) {
    return { skipped: true, reason: "throttled" };
  }
  cdnSyncThrottle.set(shop, Date.now());

  console.log(`[llms-cdn] [${shop}] Querying Shopify Files for CDN URLs...`);
  const { llmsTxtCdnUrl, agentsMdCdnUrl } = await getCdnUrlsFromShopifyFiles(adminGraphQL);

  if (!llmsTxtCdnUrl && !agentsMdCdnUrl) {
    console.warn(`[llms-cdn] [${shop}] No READY CDN files found — redirects unchanged`);
    return { skipped: true, reason: "no CDN files found in Shopify Files" };
  }

  const REDIRECT_MAP = [
    llmsTxtCdnUrl  && { path: "/llms.txt",  target: llmsTxtCdnUrl  },
    agentsMdCdnUrl && { path: "/agents.md", target: agentsMdCdnUrl },
    agentsMdCdnUrl && { path: "/agent.md",  target: agentsMdCdnUrl },
  ].filter(Boolean);

  console.log(
    `[llms-cdn] [${shop}] Setting CDN redirects:\n` +
    REDIRECT_MAP.map((m) => `  ${m.path} → ${m.target}`).join("\n"),
  );

  const results = await Promise.allSettled(
    REDIRECT_MAP.map(({ path, target }) =>
      resolveOneRedirectWithSession(adminGraphQL, path, target),
    ),
  );

  const output = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { path: REDIRECT_MAP[i].path, error: r.reason?.message || "failed" },
  );

  const verified = await verifyRedirects(
    adminGraphQL,
    REDIRECT_MAP.map(({ path, target }) => ({ path, expectedTarget: target })),
  );

  const success = verified.every((v) => v.verified);
  console.log(`[llms-cdn] [${shop}] syncCdnRedirects: ${success ? "✓ all redirects verified" : "✗ some failed"}`);
  return { output, verified, success };
}

// Called from afterAuth (app install / re-authentication).
// Builds a GraphQL client from the raw access token so the full admin
// session client is not required.
export async function ensureRedirectsOnInstall(shop, accessToken) {
  if (!shop || !accessToken) return;
  const API_VER = process.env.SHOPIFY_API_VERSION || "2026-04";

  // Build a lightweight admin.graphql-compatible client from the access token.
  const adminGraphQL = async (query, options = {}) => {
    const res = await fetch(`https://${shop}/admin/api/${API_VER}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables: options.variables || {} }),
    });
    return res; // matches Remix admin.graphql return type (Response object)
  };

  console.log(`[llms-redirect] afterAuth: setting up redirects for ${shop}`);
  try {
    const results = await publishRootDiscoveryRedirects(shop, adminGraphQL);
    console.log(`[llms-redirect] afterAuth results:`, JSON.stringify(results));
  } catch (err) {
    console.error(`[llms-redirect] afterAuth: failed for ${shop}:`, err?.message);
  }
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
    agentMdCanonicalUrl: `https://${primaryDomain}/agents.md`,
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
    llmsTxtCanonicalUrl,
    agentMdCanonicalUrl,
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
    `${storeName} is an online Shopify store available at ${shopUrl}. This file helps AI assistants, search agents, shopping assistants, and language models understand the store's products, collections, content, policies, and important shopping pages.`,
    "",
    `> llms: ${llmsTxtCanonicalUrl}`,
    `> agents: ${agentMdCanonicalUrl}`,
    "",
    `For full agent behavior, cart actions, checkout rules, and purchase safety instructions, see: ${agentMdCanonicalUrl}`,
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
      `- Agent instructions: GET ${agentMdCanonicalUrl}`,
      `- LLM discovery file: GET ${llmsTxtCanonicalUrl}`,
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
    `For full agent behavior, cart, checkout, and purchase instructions, see: ${agentMdCanonicalUrl}`,
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
    `- Store agent instructions: ${agentMdCanonicalUrl}`,
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
    `> Agents.md: ${agentMdCanonicalUrl}`,
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
    `- \`GET ${llmsTxtCanonicalUrl}\``,
    `- \`GET ${agentMdCanonicalUrl}\``,
    `- \`GET /apps/llms-txt/llms.txt\``,
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

function renderAgentsMdFromDoc({ shop, data, shopRow }) {
  const ctx = buildDiscoveryContext({ shop, data, shopRow });
  const {
    storeName,
    shortDescription,
    shopUrl,
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

  const policyList = renderNamedItems(policyItems, {
    emptyText: "- No default Shopify policy pages are currently listed.",
  }).join("\n");
  const additionalPolicyList = renderNamedItems(additionalPolicyPages, {
    emptyText: "- No additional policy or help pages are currently listed.",
  }).join("\n");

  return [
    `# Agent Instructions - ${storeName}`,
    "",
    `This file explains how AI agents and shopping assistants should interact with ${storeName} at ${shopUrl}.`,
    "",
    `> llms: ${llmsTxtCanonicalUrl}`,
    `> agents: ${agentMdCanonicalUrl}`,
    "",
    `For store catalog, products, collections, blogs, pages, and policy discovery, read: ${llmsTxtCanonicalUrl}`,
    "",
    "## Store Summary",
    "",
    `${storeName} is a Shopify store offering ${shortDescription}.`,
    "",
    "Agents should help shoppers discover products, compare options, choose variants, review the cart, and move to checkout safely.",
    "",
    "## Important Rules",
    "",
    "- Human approval is required for checkout. Agents must not complete payment without explicit buyer consent at the moment of purchase.",
    "- Use live Shopify data. Verify current price, variants, inventory, discounts, taxes, shipping, and checkout details before purchase.",
    "- Confirm before action. Before adding to cart or checkout, confirm product, variant, quantity, and paid options with the buyer.",
    "- Do not guess. Do not invent product features, delivery dates, discounts, policy terms, or availability.",
    "- Respect rate limits. If an endpoint returns 429, back off before retrying.",
    "- Use buyer context. When supported, pass buyer country, currency, shipping destination, quantity, language, and preferences.",
    "- Protect buyer privacy. Do not expose private buyer data, address, payment details, or order information without authorization.",
    "- Do not handle raw payment card data. Payment must happen only through Shopify checkout or trusted buyer-approved payment flows.",
    "",
    "## Recommended Agent Flow",
    "",
    "### 1. Discover",
    "",
    `- \`GET ${llmsTxtCanonicalUrl}\``,
    `- \`GET ${agentMdCanonicalUrl}\``,
    "- `GET /sitemap.xml`",
    "",
    "If supported, also use:",
    "",
    "- `GET /.well-known/ucp`",
    "- `POST /api/mcp`",
    "- `POST /api/ucp/mcp`",
    "",
    "Agents should not assume MCP tools are available. If MCP is available, call `tools/list` before using structured commerce tools.",
    "",
    "### 2. Understand Buyer Intent",
    "",
    "Before recommending products, identify:",
    "",
    "- Product type or category",
    "- Budget",
    "- Quantity",
    "- Size, color, material, or style",
    "- Shipping country",
    "- Preferred currency",
    "- Use case, gift purpose, or urgency",
    "",
    "Ask a short clarification if the buyer request is unclear.",
    "",
    "### 3. Search Products",
    "",
    "Use these Shopify routes:",
    "",
    "- Browse all products: `GET /collections/all`",
    "- Search products: `GET /search?q={query}&type=product`",
    "- Product page: `GET /products/{handle}`",
    "- Product JSON: `GET /products/{handle}.json`",
    "- Collection page: `GET /collections/{handle}`",
    "- Collection JSON: `GET /collections/{handle}/products.json`",
    "- Sitemap: `GET /sitemap.xml`",
    "- Prefer live product pages or product JSON for current price, variants, and availability.",
    "",
    "### 4. Recommend Products",
    "",
    "- Show the best matching products first.",
    "- Include direct product links.",
    "- Explain why each product fits the buyer's request.",
    "- Mention required variant choices.",
    "- Avoid unavailable products if availability is known.",
    "- Do not claim discounts, delivery times, or policy terms unless verified.",
    "",
    "### 5. Add to Cart",
    "",
    "Only add an item to cart after the buyer confirms:",
    "",
    "- Product",
    "- Variant",
    "- Quantity",
    "- Price, if available",
    "- Custom options, bundle options, subscription options, or paid add-ons",
    "",
    "Shopify cart routes:",
    "",
    "- Add to cart: `POST /cart/add.js`",
    "- View cart: `GET /cart`",
    "- Cart JSON: `GET /cart.js`",
    "- Change cart item: `POST /cart/change.js`",
    "- Update cart: `POST /cart/update.js`",
    "- Clear cart only after confirmation: `POST /cart/clear.js`",
    "- If UCP/MCP tools are available, prefer structured commerce tools over visual scraping.",
    "",
    "### 6. Review Cart",
    "",
    "Before checkout, show the buyer:",
    "",
    "- Product names",
    "- Variants",
    "- Quantities",
    "- Prices, if available",
    "- Discounts, if applied",
    "- Estimated subtotal, if available",
    "- Shipping country or address, if needed",
    "",
    "Ask the buyer to confirm the cart before continuing.",
    "",
    "### 7. Checkout and Payment",
    "",
    "Agents may help start checkout, but payment requires clear buyer approval.",
    "",
    "Valid payment approval examples:",
    "",
    '- "Yes, place the order."',
    '- "I approve this payment."',
    '- "Complete checkout."',
    '- "Buy it now."',
    "",
    "Invalid approval examples:",
    "",
    '- "Looks good."',
    '- "Maybe."',
    '- "Show me checkout."',
    "- Old approval from a previous session.",
    "",
    "Agents must not complete payment if approval is missing, unclear, old, or unavailable.",
    "",
    "## UCP and MCP Support",
    "",
    "No verified UCP/MCP endpoint is currently declared.",
    "",
    "Agents should use public Shopify storefront routes, product JSON, collection JSON, cart routes, sitemap, and Shopify checkout.",
    "",
    "- UCP specification: https://ucp.dev",
    "- Shop skill: https://shop.app/SKILL.md",
    "",
    "## Store Policies and Help Pages",
    "",
    "Agents should review policy pages before answering questions about shipping, returns, refunds, privacy, terms, cancellations, warranty, sizing, tracking, or support.",
    "",
    "### Default Shopify Policies",
    "",
    policyList,
    "",
    "### Additional Policy and Help Pages",
    "",
    additionalPolicyList,
    "",
    "Do not guess policy details if they are not verified from live policy pages or additional help pages.",
    "",
    "## Customer Support",
    "",
    `- Contact page: ${canonicalUrl(shopUrl, "/pages/contact")}`,
    `- Support email: ${supportEmail}`,
    `- Support phone: ${supportPhone}`,
    `- Business hours: ${businessHours}`,
    "",
    "If support details are unavailable, direct the buyer to the contact page.",
    "",
    "## Accuracy Rule",
    "",
    "If this file conflicts with live Shopify product pages, product JSON, cart, checkout, policy pages, or structured commerce tools, agents must prefer live Shopify data.",
    "",
    "## Generated Metadata",
    "",
    `- Last updated: ${generatedAt}`,
    `- Generated by: ${appName}`,
    `- Store: ${storeName}`,
    "- Platform: Shopify",
    "",
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
  const content = renderAgentsMdFromDoc({ shop, data, shopRow });
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

// ─── Server-side verification ─────────────────────────────────────────────────
// After generation, make real HTTP requests from the server to confirm:
//   1. /llms.txt resolves to our proxy (X-Content-Source header check)
//   2. The content at /llms.txt matches our newly generated content
// This catches browser-cached 301 redirects, CDN conflicts, and proxy conflicts.

async function verifyLlmsTxtContent(shop, expectedContent) {
  const shopDomain = shop.includes(".myshopify.com") ? shop : `${shop}.myshopify.com`;
  const proxyUrl    = `https://${shopDomain}/apps/llms-txt/llms.txt`;
  const redirectUrl = `https://${shopDomain}/llms.txt`;

  const result = {
    proxyUrl,
    redirectUrl,
    match: false,
    redirectSource: null,  // X-Content-Source from /llms.txt response
    proxySource: null,     // X-Content-Source from proxy response
    redirectFinalUrl: null,
    cacheControl: null,
    error: null,
  };

  try {
    // Verify proxy URL directly (/apps/llms-txt/llms.txt)
    const proxyRes = await fetch(proxyUrl, {
      headers: { "User-Agent": "ShopifyApp-LLMSVerifier/1.0", "Cache-Control": "no-cache" },
      redirect: "follow",
    });
    const proxyText = await proxyRes.text();
    result.proxySource = proxyRes.headers.get("x-content-source");
    console.log(`[llms-verify] proxy ${proxyUrl} → status=${proxyRes.status} source=${result.proxySource || "none"}`);

    // Verify redirect URL (/llms.txt)
    const redirectRes = await fetch(redirectUrl, {
      headers: { "User-Agent": "ShopifyApp-LLMSVerifier/1.0", "Cache-Control": "no-cache" },
      redirect: "follow",
    });
    const redirectText = await redirectRes.text();
    result.redirectSource = redirectRes.headers.get("x-content-source");
    result.redirectFinalUrl = redirectRes.url;
    result.cacheControl = redirectRes.headers.get("cache-control");
    console.log(
      `[llms-verify] redirect ${redirectUrl} → ${result.redirectFinalUrl} ` +
      `status=${redirectRes.status} source=${result.redirectSource || "none"} cache=${result.cacheControl || "none"}`,
    );

    // Compare source identity (most reliable check — doesn't depend on content trimming)
    if (result.redirectSource === "gen-ai-seo-product-description") {
      result.match = true;
      console.log(`[llms-verify] ✓ X-Content-Source header confirms our app is serving /llms.txt`);
    } else if (result.redirectSource) {
      console.warn(`[llms-verify] ✗ /llms.txt is served by "${result.redirectSource}" (not our app)`);
    } else {
      // Fallback: compare first 300 chars of content
      const trim = (s) => String(s || "").trim().substring(0, 300);
      result.match = trim(redirectText) === trim(expectedContent);
      if (!result.match) {
        console.warn(
          `[llms-verify] ✗ Content mismatch — /llms.txt does NOT match our generated content.\n` +
          `  /llms.txt begins:   "${trim(redirectText).substring(0, 80)}..."\n` +
          `  Expected begins:    "${trim(expectedContent).substring(0, 80)}..."\n` +
          `  Likely cause: browser or CDN has cached an old 301 redirect from a previous app.\n` +
          `  Resolution: open /llms.txt in an incognito window (bypasses browser 301 cache).`,
        );
      }
    }
  } catch (err) {
    result.error = err?.message;
    console.warn(`[llms-verify] HTTP verification request failed: ${err?.message}`);
  }

  return result;
}

export async function generateAndStoreDynamicLlmsTxt(shop, options = {}, adminGraphQL) {
  const credits = LLMS_GENERATION_CREDITS;

  // ── Pre-generation: check current redirect state ──────────────────────────
  console.log(`[llms-redirect] [${shop}] PRE-GENERATE: checking /llms.txt redirect status`);

  // Deduct credits ONLY for content generation — redirect repair never costs credits.
  await deductCredits({ shopDomain: shop, creditsUsed: credits });

  try {
    // ── Generate content ───────────────────────────────────────────────────
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

    // ── Upload to Shopify Files (CDN) → redirect to CDN URL ──────────────
    // Strategy: upload llms.txt and agents.md to Content → Files so they are
    // served from Shopify's own CDN, then point /llms.txt to the CDN URL.
    // This is more reliable than the app proxy approach because the CDN URL
    // is unique per shop and cannot be overwritten by another app's redirect.
    // Falls back to app proxy redirect if CDN upload fails.
    let cdnTargets = {};

    // ── Upload to Shopify Files (CDN) ─────────────────────────────────────
    if (adminGraphQL) {
      try {
        console.log(`[llms-cdn] [${shop}] Uploading llms.txt → Shopify Files...`);
        const [llmsCdnUrl, agentsCdnUrl] = await Promise.all([
          uploadToShopifyFiles(adminGraphQL, "llms.txt", content),
          uploadToShopifyFiles(adminGraphQL, "agents.md", agentContent, "text/markdown"),
        ]);
        if (llmsCdnUrl)   cdnTargets.llmsTxt  = llmsCdnUrl;
        if (agentsCdnUrl) cdnTargets.agentsMd = agentsCdnUrl;
        console.log(`[llms-cdn] [${shop}] ✓ CDN upload complete — llms.txt: ${llmsCdnUrl}`);
        console.log(`[llms-cdn] [${shop}]                        agents.md: ${agentsCdnUrl}`);
      } catch (cdnErr) {
        console.warn(`[llms-cdn] [${shop}] CDN upload failed — falling back to app proxy: ${cdnErr?.message}`);
      }
    }

    // ── Set redirects: CDN URL (preferred) or app proxy (fallback) ────────
    const redirectTargets = {
      llmsTxt:  cdnTargets.llmsTxt  || "/apps/llms-txt/llms.txt",
      agentsMd: cdnTargets.agentsMd || "/apps/llms-txt/agents.md",
    };
    const usedCdn = Boolean(cdnTargets.llmsTxt);

    const REDIRECT_MAP = [
      { path: "/llms.txt",  target: redirectTargets.llmsTxt  },
      { path: "/agents.md", target: redirectTargets.agentsMd },
      { path: "/agent.md",  target: redirectTargets.agentsMd },
    ];

    console.log(
      `[llms-redirect] [${shop}] Setting redirects (${usedCdn ? "CDN" : "app proxy"} targets):\n` +
      REDIRECT_MAP.map((m) => `  ${m.path} → ${m.target}`).join("\n"),
    );

    // Fetch access token once (only needed for the REST fallback path).
    const fallbackAccessToken = adminGraphQL
      ? ""
      : ((await db.shop.findUnique({ where: { shop }, select: { accessToken: true } }))?.accessToken || "");

    const redirectResults = await Promise.allSettled(
      REDIRECT_MAP.map(({ path, target }) =>
        adminGraphQL
          ? resolveOneRedirectWithSession(adminGraphQL, path, target)
          : resolveOneRedirectWithRest(shop, fallbackAccessToken, path, target),
      ),
    );

    const redirects = redirectResults.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { path: REDIRECT_MAP[i].path, target: REDIRECT_MAP[i].target, error: r.reason?.message || "redirect failed" },
    );

    // ── Verify redirects after creation ───────────────────────────────────
    const verification = adminGraphQL
      ? await verifyRedirects(adminGraphQL, REDIRECT_MAP.map(({ path, target }) => ({ path, expectedTarget: target })))
      : [];

    // ── Final log ─────────────────────────────────────────────────────────
    const llmsTxtResult = redirects.find((r) => r.path === "/llms.txt");
    const llmsTxtVerified = verification.find((v) => v.path === "/llms.txt");
    if (llmsTxtResult?.error) {
      console.error(`[llms-redirect] [${shop}] ✗ /llms.txt redirect FAILED: ${llmsTxtResult.error}`);
    } else {
      console.log(
        `[llms-redirect] [${shop}] /llms.txt redirect: action=${llmsTxtResult?.action || "?"}` +
        ` | target=${llmsTxtResult?.target || redirectTargets.llmsTxt}` +
        ` | verified=${llmsTxtVerified?.verified ?? "n/a"}`,
      );
    }
    console.log(`[llms-redirect] [${shop}] Redirect summary:`, JSON.stringify(redirects));

    const redirectFixed = redirects.some((r) =>
      ["conflict_resolved", "recreated", "created", "updated", "rest_created", "rest_race_updated"].includes(r.action),
    );

    return {
      content,
      creditsUsed: credits,
      redirects,
      redirectFixed,
      usedCdn,
      cdnTargets,
      verification,
    };
  } catch (error) {
    await refundCredits({ shopDomain: shop, creditsRefunded: credits });
    throw error;
  }
}

export function generateAiRobotsTxt() {
  return `${renderRobotsRules()}\n`;
}
