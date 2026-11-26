// Shared fixtures: a fake Shopify admin client, fake AI generators, and
// database helpers. Nothing here makes a network call.
import db from "../../app/db.server";

export const TEST_CONFIG = Object.freeze({
  batchSize: 10,
  concurrency: 3,
  pollIntervalMs: 10,
  leaseMs: 60000,
  maxRetries: 3,
  retryBaseDelayMs: 0,
  maxItemAttempts: 5,
});

export const silentLogger = { info() {}, warn() {}, error() {} };

export function productGid(n) {
  return `gid://shopify/Product/${n}`;
}

export async function resetDatabase() {
  await db.bulkJobItem.deleteMany({});
  await db.bulkJob.deleteMany({});
  await db.$executeRaw`DELETE FROM shop_daily_activity`;
  await db.shop.deleteMany({ where: { shop: { endsWith: ".test-shop.myshopify.com" } } });
}

export function shopDomain(name) {
  return `${name}.test-shop.myshopify.com`;
}

export async function createShop(shop, credits) {
  await db.shop.create({
    data: { shop, credits, creditsUsedTotal: 0, billingPlanKey: "free", billingPlanName: "Free", billingPlanCredits: 150 },
  });
}

export async function shopCredits(shop) {
  return db.shop.findUnique({ where: { shop }, select: { credits: true, creditsUsedTotal: true } });
}

export function productSettings(overrides = {}) {
  return {
    language: "English",
    tone: "Neutral",
    lengthOption: "100 words",
    format: "Single paragraph",
    contextKeywords: "",
    descriptionPromptTemplate: "Write a description.",
    metaTitlePromptTemplate: "Write a title.",
    metaDescriptionPromptTemplate: "Write a meta description.",
    contentTypes: ["description", "meta_title"],
    creditsPerItem: 2,
    aiProvider: "openai",
    collectionId: "",
    ...overrides,
  };
}

/**
 * Fake Shopify: `nodes(ids:)` returns a product per id unless the id is in
 * `missing`. `throttleFirst` makes the first N calls throw a Shopify
 * throttling error; `authError` makes getAdminContext fail like an
 * uninstalled store.
 */
export function createFakeShopify({ missing = new Set(), throttleFirst = 0, authError = null } = {}) {
  const calls = { getAdminContext: 0, graphql: 0, batchSizes: [], throttled: 0 };
  let toThrottle = throttleFirst;
  const admin = {
    async graphql(_query, { variables }) {
      calls.graphql += 1;
      if (toThrottle > 0) {
        toThrottle -= 1;
        calls.throttled += 1;
        const error = new Error("Shopify is throttling requests");
        error.name = "HttpThrottlingError";
        error.response = { code: 429 };
        error.retryAfter = 0;
        throw error;
      }
      calls.batchSizes.push(variables.ids.length);
      const nodes = variables.ids.map((id) => (missing.has(id) ? null : {
        id,
        title: `Product ${id.split("/").pop()}`,
        handle: `product-${id.split("/").pop()}`,
        vendor: "Acme",
        productType: "Thing",
        status: "ACTIVE",
        descriptionHtml: "<p>Old description</p>",
        seo: { title: "", description: "" },
        priceRangeV2: { minVariantPrice: { amount: "10.00", currencyCode: "USD" } },
        variants: { edges: [{ node: { price: "10.00" } }] },
        featuredImage: null,
      }));
      return { json: async () => ({ data: { nodes } }) };
    },
  };
  return {
    calls,
    async getAdminContext() {
      calls.getAdminContext += 1;
      if (authError) throw authError;
      return { admin, session: { accessToken: "test-offline-token" } };
    },
  };
}

/**
 * Fake generation layer that behaves like the real one: each step calls the
 * "AI", then saves content (recording when) and writes a generation log.
 *
 * `behaviour(id, attempt, step)` runs before the save and may throw to
 * simulate AI failures; `afterSave(id, attempt, step)` runs after the save and
 * may hang to simulate a crash between saving and completing the item.
 * `attempt` counts calls of the standard step for that id (other steps are
 * counted per step in `stepAttempts`).
 */
export function createFakeGenerators(behaviour = () => {}, { afterSave = () => {} } = {}) {
  const attemptsById = new Map(); // standard-step calls per id (back-compat)
  const stepAttempts = new Map(); // `${step}:${id}` -> calls
  const savedAt = new Map(); // `${step}:${id}` -> Date
  const logs = []; // { id, step }
  const calls = { generate: 0, steps: { standard: 0, schema: 0, faq: 0 } };

  const step = (name) => async (itemOrShop, ...rest) => {
    // generateBulkFaq / generateProductSchemaForBulk take (shop, token, item, ...)
    const item = typeof itemOrShop === "string" ? (name === "faq" ? rest[2] : rest[1]) : itemOrShop;
    const id = item.id || item.productId;
    const key = `${name}:${id}`;
    const attempt = (stepAttempts.get(key) || 0) + 1;
    stepAttempts.set(key, attempt);
    calls.steps[name] += 1;
    if (name === "standard") {
      attemptsById.set(id, attempt);
      calls.generate += 1;
    }
    await behaviour(id, attempt, name);
    savedAt.set(key, new Date());
    logs.push({ id, step: name });
    await afterSave(id, attempt, name);
  };

  return {
    calls,
    attemptsById,
    stepAttempts,
    logs,
    logCount: (id, name = "standard") => logs.filter((l) => l.id === id && l.step === name).length,
    deps: {
      getApiKeys: async () => ({ openaiApiKey: "sk-test", anthropicApiKey: null, geminiApiKey: null }),
      getSavedContentTimestamps: async ({ item }) => {
        const id = item.id || item.productId;
        return {
          standard: savedAt.get(`standard:${id}`) ?? null,
          schema: savedAt.get(`schema:${id}`) ?? null,
          faq: savedAt.get(`faq:${id}`) ?? null,
        };
      },
      generateProductItem: step("standard"),
      generateCollectionItem: step("standard"),
      generateCollectionProductItem: step("standard"),
      generateProductSchemaForBulk: step("schema"),
      generateBulkFaq: step("faq"),
      sleep: async () => {},
    },
  };
}

/**
 * Fake Shopify write-back. `behaviour(id, attempt)` may throw (e.g. a 429 or
 * userErrors) or hang (crash between charging and saving).
 */
export function createFakeWriteBack(behaviour = () => {}) {
  const attemptsById = new Map();
  const applied = new Set();
  const calls = { write: 0, addToCollection: 0 };
  const write = async (id) => {
    const attempt = (attemptsById.get(id) || 0) + 1;
    attemptsById.set(id, attempt);
    calls.write += 1;
    await behaviour(id, attempt);
    applied.add(id);
  };
  return {
    calls,
    attemptsById,
    applied,
    deps: {
      writeProductContentToShopify: (_shop, _token, productId) => write(productId),
      writeCollectionContentToShopify: (_shop, _token, collectionId) => write(collectionId),
      writeCollectionProductContentToShopify: (_shop, _token, _collectionId, productId) => write(productId),
      addProductsToCollection: async () => { calls.addToCollection += 1; },
    },
  };
}

export function buildDeps({
  shopify = createFakeShopify(),
  generators = createFakeGenerators(),
  writeBack = createFakeWriteBack(),
} = {}) {
  return { ...generators.deps, ...writeBack.deps, getAdminContext: shopify.getAdminContext };
}

export function shopifyError(message, status, extra = {}) {
  return Object.assign(new Error(message), { source: "shopify", status, ...extra });
}

export function aiError(message, status) {
  const error = new Error(message);
  error.source = "ai";
  error.status = status;
  return error;
}
