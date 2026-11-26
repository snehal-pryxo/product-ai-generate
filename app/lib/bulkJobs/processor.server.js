// Processes one claimed bulk job, batch by batch, until it is finished,
// cancelled, fatally failed, or this worker is told to stop.
//
// Per item, in order:
//   1. generate — each step (standard content, schema, FAQ) is retried on its
//      own, and a step whose content was already saved during this job (a
//      resumed item) is skipped, so content is never regenerated or re-logged;
//   2. charge   — completeItem marks the item generated and charges it once;
//   3. save     — write the content back to Shopify with retries; the outcome is
//      recorded per item (applied / failed) and never re-runs generation.
//
// External effects come in through `deps` (see deps.server.js) so these rules
// can be tested against a real database with mocked Shopify and AI.

import {
  classifyError,
  FatalJobError,
  getErrorStatus,
  LeaseLostError,
  PermanentItemError,
  withRetry,
} from "./errors.server";
import {
  completeItem,
  failItem,
  finalizeJob,
  getItemsAwaitingWriteBack,
  getNextPendingItems,
  isCancelRequested,
  markItemsPickedUp,
  recordWriteBack,
  releaseLease,
  renewLease,
} from "./queue.server";
import { fetchResourcesByIds, toGenerationItem } from "./shopifyResources.server";

const STANDARD_CONTENT_TYPES = ["description", "meta_title", "meta_description"];
const PRODUCT_APPLYABLE_TYPES = ["description", "meta_title", "meta_description", "faq"];
const ADMIN_CONTEXT_ATTEMPTS = 5;

function contentTypesForJob(jobType, contentTypes) {
  const types = Array.isArray(contentTypes) ? contentTypes : [];
  if (jobType === "product") return types;
  return types.filter((type) => STANDARD_CONTENT_TYPES.includes(type));
}

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// The same generation calls as the Inngest function this replaces, split into
// independently retryable steps.
function generationSteps({ jobType, item, settings, apiKeys, accessToken, deps }) {
  const standardTypes = settings.contentTypes.filter((type) => STANDARD_CONTENT_TYPES.includes(type));
  const standardSettings = { ...settings, contentTypes: standardTypes };
  const aiOptions = {
    aiProvider: settings.aiProvider,
    openaiKey: apiKeys.openaiApiKey,
    anthropicKey: apiKeys.anthropicApiKey,
    geminiKey: apiKeys.geminiApiKey,
  };
  const steps = [];
  if (jobType === "collection") {
    if (standardTypes.length) steps.push({ key: "standard", run: () => deps.generateCollectionItem(item, standardSettings, apiKeys) });
    return steps;
  }
  if (jobType === "collection_product") {
    if (standardTypes.length) steps.push({ key: "standard", run: () => deps.generateCollectionProductItem(item, standardSettings, apiKeys) });
    return steps;
  }
  if (standardTypes.length) steps.push({ key: "standard", run: () => deps.generateProductItem(item, standardSettings, apiKeys) });
  if (settings.contentTypes.includes("schema")) {
    steps.push({ key: "schema", run: () => deps.generateProductSchemaForBulk(settings.shop, accessToken, item, aiOptions) });
  }
  if (settings.contentTypes.includes("faq")) {
    steps.push({
      key: "faq",
      run: () => deps.generateBulkFaq(settings.shop, accessToken, "product", item, aiOptions, { language: settings.language }),
    });
  }
  return steps;
}

/** What has to be written to Shopify for one item (same rules as before). */
function writeBackPlan(jobType, settings) {
  const types = settings.contentTypes.filter((type) =>
    (jobType === "product" ? PRODUCT_APPLYABLE_TYPES : STANDARD_CONTENT_TYPES).includes(type),
  );
  const addToCollection = jobType === "collection_product" || (jobType === "product" && Boolean(settings.collectionId));
  return { types, addToCollection, required: types.length > 0 || addToCollection };
}

async function writeBack({ jobType, row, settings, accessToken, deps, plan }) {
  const shop = settings.shop;
  if (jobType === "product") {
    if (plan.types.length) await deps.writeProductContentToShopify(shop, accessToken, row.resourceId, plan.types);
    if (plan.addToCollection) await deps.addProductsToCollection(shop, accessToken, settings.collectionId, [row.resourceId]);
  } else if (jobType === "collection") {
    if (plan.types.length) await deps.writeCollectionContentToShopify(shop, accessToken, row.resourceId, plan.types);
  } else {
    if (plan.types.length) {
      await deps.writeCollectionProductContentToShopify(shop, accessToken, row.collectionId, row.resourceId, plan.types);
    }
    await deps.addProductsToCollection(shop, accessToken, row.collectionId, [row.resourceId]);
  }
}

/**
 * @param {object} job       row returned by claimNextJob
 * @param {object} ctx
 * @param {string} ctx.workerId
 * @param {object} ctx.config  getWorkerConfig() values
 * @param {object} ctx.deps    see deps.server.js
 * @param {() => boolean} [ctx.shouldStop]  graceful shutdown signal
 * @param {object} [ctx.logger]
 * @returns {Promise<{outcome: string, status?: string}>}
 */
export async function processJob(job, { workerId, config, deps, shouldStop = () => false, logger = console }) {
  const jobType = job.jobType;
  const rawSettings = parseJson(job.settings, {});
  const contentTypes = contentTypesForJob(jobType, rawSettings.contentTypes ?? parseJson(job.contentTypes, []));
  const creditsPerItem = jobType === "product"
    ? rawSettings.creditsPerItem ?? (contentTypes.length || 0)
    : contentTypes.length;
  const settings = { ...rawSettings, shop: job.shop, contentTypes, creditsPerItem };
  const plan = writeBackPlan(jobType, settings);
  const retryOptions = {
    maxAttempts: config.maxRetries,
    baseDelayMs: config.retryBaseDelayMs,
    sleep: deps.sleep,
    onRetry: ({ error, attempt, delay }) =>
      logger.warn?.(`[bulk-worker] job ${job.id}: retry ${attempt} in ${delay}ms — ${error?.message}`),
  };

  // Keep the lease alive while long AI calls run; detect loss promptly.
  let leaseLost = false;
  const heartbeat = setInterval(async () => {
    try {
      if (!(await renewLease(job.id, workerId, { leaseMs: config.leaseMs }))) leaseLost = true;
    } catch (error) {
      logger.warn?.(`[bulk-worker] job ${job.id}: lease renewal failed — ${error?.message}`);
    }
  }, Math.max(1000, Math.floor(config.leaseMs / 3)));
  heartbeat.unref?.();

  const finalize = async (outcome, error) => {
    const result = await finalizeJob({ jobId: job.id, workerId, outcome, error });
    logger.info?.(`[bulk-worker] job ${job.id} finalized: ${result.status ?? "already settled"}, refunded ${result.refunded ?? 0}`);
    return { outcome, status: result.status };
  };

  // Fresh session per batch: the library refreshes an expiring offline token
  // near expiry. A store we can't get a working token for stops the job.
  const getContext = async () => {
    try {
      const { admin, session } = await withRetry(
        () => deps.getAdminContext(job.shop),
        { ...retryOptions, maxAttempts: Math.max(retryOptions.maxAttempts, ADMIN_CONTEXT_ATTEMPTS) },
      );
      return { admin, accessToken: session?.accessToken };
    } catch (error) {
      throw new FatalJobError(
        `Could not access the Shopify store (${error?.message || error?.statusText || "no valid session"}). `
          + "Reopen the app in Shopify admin, then run the job again.",
        { cause: error },
      );
    }
  };

  // Shopify retires an offline access token once a newer one is issued (e.g. the
  // embedded app ran a token exchange mid-batch). On a 401, load the current
  // session once and retry before treating the rejection as fatal.
  const withCurrentToken = async (ctx, fn) => {
    try {
      return await fn(ctx.current);
    } catch (error) {
      if (getErrorStatus(error) !== 401 || error?.source !== "shopify") throw error;
      ctx.current = await getContext();
      return fn(ctx.current);
    }
  };

  // Save one item's content to Shopify and record the outcome. Returns a fatal
  // error (stop the job) or null.
  const saveToShopify = async (row, ctx) => {
    try {
      await withRetry(
        () => withCurrentToken(ctx, ({ accessToken }) => writeBack({ jobType, row, settings, accessToken, deps, plan })),
        retryOptions,
      );
      await recordWriteBack({ jobId: job.id, workerId, item: row });
      return null;
    } catch (error) {
      if (error instanceof LeaseLostError) throw error;
      await recordWriteBack({ jobId: job.id, workerId, item: row, error });
      return classifyError(error) === "fatal" ? error : null;
    }
  };

  const settle = (results) => {
    const lost = results.find((r) => r.status === "rejected" && r.reason instanceof LeaseLostError);
    if (lost) throw lost.reason;
    const unexpected = results.find((r) => r.status === "rejected");
    if (unexpected) throw unexpected.reason;
  };

  try {
    let apiKeys = null;
    for (;;) {
      if (leaseLost) throw new LeaseLostError(job.id);
      if (shouldStop()) {
        await releaseLease(job.id, workerId);
        logger.info?.(`[bulk-worker] job ${job.id}: released for another worker (shutting down)`);
        return { outcome: "released" };
      }

      // 1. Charged items whose Shopify save didn't happen (worker died between
      //    charging and saving). Finish these before honouring a cancel: the
      //    merchant has already paid for them.
      const unsaved = await getItemsAwaitingWriteBack(job.id, config.batchSize);
      if (unsaved.length > 0) {
        const ctx = { current: await getContext() };
        let fatal = null;
        const results = await Promise.allSettled(unsaved.map(async (row) => {
          const error = await saveToShopify(row, ctx);
          fatal = fatal || error;
        }));
        settle(results);
        if (fatal) return await finalize("fatal", fatal);
        continue;
      }

      if (await isCancelRequested(job.id)) return await finalize("cancelled");

      const batch = await getNextPendingItems(job.id, config.batchSize);
      if (batch.length === 0) return await finalize("done");

      const previousAttempts = new Map(batch.map((row) => [row.id, row.attempts]));
      const pickedUp = await markItemsPickedUp(batch.map((row) => row.id));
      const runnable = [];
      for (const row of pickedUp) {
        if (row.status !== "pending") continue;
        if (row.attempts > config.maxItemAttempts) {
          await failItem({
            jobId: job.id, workerId, item: row,
            error: new PermanentItemError("Processing was interrupted repeatedly; this item was skipped."),
          });
        } else {
          runnable.push(row);
        }
      }
      if (runnable.length === 0) continue;

      if (!apiKeys) apiKeys = await deps.getApiKeys(job.shop);
      const ctx = { current: await getContext() };

      let nodes;
      try {
        nodes = await withRetry(
          () => withCurrentToken(ctx, ({ admin }) =>
            fetchResourcesByIds(admin, runnable.map((row) => row.resourceId), jobType === "collection" ? "collection" : "product")),
          retryOptions,
        );
      } catch (error) {
        if (classifyError(error) === "fatal") return await finalize("fatal", error);
        throw error; // transient exhausted: lease expires, the job resumes later
      }

      let fatalError = null;
      const results = await Promise.allSettled(runnable.map(async (row) => {
        const node = nodes.get(row.resourceId);
        if (!node) {
          await failItem({
            jobId: job.id, workerId, item: row,
            error: new PermanentItemError("Product no longer exists or is no longer accessible in Shopify."),
          });
          return;
        }
        const item = toGenerationItem(jobType, node, row);
        // Don't start an expensive AI call for a job the merchant just cancelled.
        if (fatalError || await isCancelRequested(job.id)) return;

        try {
          // A resumed item skips steps whose content was saved during this job.
          const saved = previousAttempts.get(row.id) > 0 && row.firstPickedUpAt
            ? await deps.getSavedContentTimestamps({ jobType, shop: job.shop, item })
            : {};
          const pickedUpAt = row.firstPickedUpAt ? new Date(row.firstPickedUpAt).getTime() : Infinity;
          for (const step of generationSteps({ jobType, item, settings, apiKeys, accessToken: ctx.current.accessToken, deps })) {
            const savedAt = saved[step.key] ? new Date(saved[step.key]).getTime() : null;
            if (savedAt !== null && savedAt >= pickedUpAt) continue;
            await withRetry(step.run, retryOptions);
          }
        } catch (error) {
          if (classifyError(error) === "fatal") {
            fatalError = fatalError || error;
            return; // left pending; closed out by the fatal finalize below
          }
          await failItem({ jobId: job.id, workerId, item: row, title: node.title, error });
          return;
        }

        const charged = await completeItem({
          jobId: job.id, workerId, item: row, title: node.title, creditsPerItem, writeBackRequired: plan.required,
        });
        // If not charged here, the item was already settled (e.g. a retried
        // commit); any pending save is picked up by the unsaved-items pass.
        if (charged && plan.required) {
          const error = await saveToShopify(row, ctx);
          fatalError = fatalError || error;
        }
      }));
      settle(results);

      if (fatalError) return await finalize("fatal", fatalError);
      if (!(await renewLease(job.id, workerId, { leaseMs: config.leaseMs }))) throw new LeaseLostError(job.id);
    }
  } catch (error) {
    if (error instanceof LeaseLostError) {
      logger.warn?.(`[bulk-worker] job ${job.id}: lease lost — another worker owns it now`);
      return { outcome: "lease_lost" };
    }
    if (error instanceof FatalJobError) {
      try {
        return await finalize("fatal", error);
      } catch (finalizeError) {
        if (finalizeError instanceof LeaseLostError) return { outcome: "lease_lost" };
        throw finalizeError;
      }
    }
    // Unexpected/infrastructure error: keep the lease until it expires so the
    // job is retried later (by this or another worker), not dropped.
    logger.error?.(`[bulk-worker] job ${job.id}: batch aborted — ${error?.stack || error}`);
    return { outcome: "aborted", error };
  } finally {
    clearInterval(heartbeat);
  }
}
