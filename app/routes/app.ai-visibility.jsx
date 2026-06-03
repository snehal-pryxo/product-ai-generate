import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { AppPageHeader } from "../components/AppPageHeader";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Page, Layout, Card, Text, Badge, Button, DataTable, Tabs, Box, BlockStack,
  InlineStack, ProgressBar, Banner, Collapsible, Modal, Select, Checkbox,
} from "@shopify/polaris";
import {
  generateSchema,
  generateFaq,
  generateCombined,
  calculateScore,
  scoreBreakdown,
  calcLlmsTxtCredits,
} from "../lib/aiVisibility.server";
import { getOrCreateShopCredits } from "../lib/credits.server";
import { autoAddFaqSectionToProductPage } from "../lib/themeUtils.server";
import {
  generateAndStoreDynamicLlmsTxt,
  invalidateLlmsTxtCache,
  readLlmsTxtSettings,
  writeLlmsTxtSettings,
} from "../lib/llmsTxt.server";

// Credit costs — defined here (not imported from server module) so they are available client-side
const CREDITS_SCHEMA = 2;
const CREDITS_FAQ = 5;
const CREDITS_COMBINED = 5;
const PRICING_PATH = "/app/pricing";

function isInsufficientCreditsMessage(message) {
  return /^Insufficient credits\./.test(String(message || ""));
}

function creditsForIntent(intent) {
  if (intent === "generate_schema") return CREDITS_SCHEMA;
  if (intent === "generate_faq") return CREDITS_FAQ;
  if (intent === "generate_combined") return CREDITS_COMBINED;
  return 0;
}

// Automatically adds the faq-section block as a standalone section in
// templates/product.json so FAQ appears on the product page without the
function buildInsufficientCreditsBanner(requiredCredits, currentCredits) {
  return {
    tone: "critical",
    text: `Insufficient credits. You need ${requiredCredits} credits. Current balance: ${currentCredits}.`,
    actionLabel: "Buy credits",
    actionUrl: PRICING_PATH,
  };
}

function calculateClientScore({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt }) {
  let score = 0;
  if (hasSeoTitle) score += 15;
  if (hasSeoDescription) score += 15;
  if (hasContent) score += 15;
  if (hasSchema) score += 40;
  if (hasLlmsTxt) score += 15;
  return score;
}

function clientScoreBreakdown({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt }) {
  return [
    { signal: "Meta title", points: 15, achieved: hasSeoTitle },
    { signal: "Meta description", points: 15, achieved: hasSeoDescription },
    { signal: "Body / description content", points: 15, achieved: hasContent },
    { signal: "Schema markup generated", points: 40, achieved: hasSchema },
    { signal: "Included in llms.txt", points: 15, achieved: hasLlmsTxt },
  ];
}

function removeFaqBreakdown(breakdown) {
  return breakdown.filter((item) => item.signal !== "FAQ section generated");
}

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

const PRODUCTS_QUERY = `#graphql
  query GetProductsForVisibility($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id title handle description vendor productType status
          seo { title description }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          variants(first: 1) { edges { node { price } } }
        }
      }
    }
  }
`;

const COLLECTIONS_QUERY = `#graphql
  query GetCollectionsForVisibility($first: Int!) {
    collections(first: $first) {
      edges {
        node {
          id title handle description descriptionHtml
          seo { title description }
          image { url altText }
          products(first: 20) {
            edges {
              node {
                id title handle
                description
                featuredImage { url altText }
                priceRangeV2 { minVariantPrice { amount currencyCode } }
              }
            }
          }
        }
      }
    }
  }
`;

const ARTICLES_QUERY = `#graphql
  query GetArticlesForVisibility($first: Int!) {
    articles(first: $first) {
      edges {
        node {
          id title handle body summary publishedAt
          metafields(first: 10, namespace: "global") {
            nodes { key value }
          }
          author { name }
          blog { id title handle }
        }
      }
    }
  }
`;

const PAGES_QUERY = `#graphql
  query GetPagesForVisibility($first: Int!) {
    pages(first: $first) {
      edges {
        node {
          id title handle body bodySummary
          metafields(first: 10, namespace: "global") {
            nodes { key value }
          }
        }
      }
    }
  }
`;

const SHOP_QUERY = `#graphql
  query GetShopForVisibility {
    shop { name primaryDomain { host } }
  }
`;

function metafieldValue(resource, key) {
  return (resource?.metafields?.nodes || resource?.metafields?.edges?.map((edge) => edge.node) || [])
    .find((item) => item?.key === key)?.value || "";
}

function normalizeSeoFromMetafields(resource) {
  return {
    ...resource,
    seo: {
      title: metafieldValue(resource, "title_tag"),
      description: metafieldValue(resource, "description_tag"),
    },
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [productsRes, collectionsRes, articlesRes, pagesRes, shopRes] = await Promise.all([
    admin.graphql(PRODUCTS_QUERY, { variables: { first: 100 } }),
    admin.graphql(COLLECTIONS_QUERY, { variables: { first: 100 } }),
    admin.graphql(ARTICLES_QUERY, { variables: { first: 100 } }),
    admin.graphql(PAGES_QUERY, { variables: { first: 50 } }),
    admin.graphql(SHOP_QUERY),
  ]);

  const [productsJson, collectionsJson, articlesJson, pagesJson, shopJson] = await Promise.all([
    productsRes.json(),
    collectionsRes.json(),
    articlesRes.json(),
    pagesRes.json(),
    shopRes.json(),
  ]);

  const products = (productsJson?.data?.products?.edges || []).map((e) => e.node);
  const collections = (collectionsJson?.data?.collections?.edges || []).map((e) => e.node);
  const articles = (articlesJson?.data?.articles?.edges || []).map((e) => normalizeSeoFromMetafields(e.node));
  const pages = (pagesJson?.data?.pages?.edges || []).map((e) => normalizeSeoFromMetafields(e.node));
  const shopName = shopJson?.data?.shop?.name || shop;
  const shopDomain = shopJson?.data?.shop?.primaryDomain?.host || shop;

  const allResourceIds = [
    ...products.map((p) => p.id),
    ...collections.map((c) => c.id),
    ...articles.map((a) => a.id),
    ...pages.map((p) => p.id),
  ];

  const [schemas, faqs, llmsTxt, shopData, creditSnapshot] = await Promise.all([
    db.aiVisibilitySchema.findMany({ where: { shop, resourceId: { in: allResourceIds } } }),
    db.aiVisibilityFaq.findMany({ where: { shop, resourceId: { in: allResourceIds } } }),
    db.aiVisibilityLlmsTxt.findUnique({ where: { shop } }),
    db.shop.findUnique({ where: { shop }, select: { themeEmbedEnabled: true, billingPlanKey: true, globalSettingsJson: true } }),
    getOrCreateShopCredits(shop),
  ]);

  const schemaMap = Object.fromEntries(schemas.map((s) => [s.resourceId, s]));
  const faqMap = Object.fromEntries(faqs.map((f) => [f.resourceId, f]));
  const hasLlmsTxt = Boolean(llmsTxt);

  function buildItem(resource, resourceType) {
    const supportsFaq = resourceType !== "page";
    const hasSchema = Boolean(schemaMap[resource.id]);
    const hasFaq = supportsFaq && Boolean(faqMap[resource.id]);
    const hasSeoTitle = Boolean(resource.seo?.title);
    const hasSeoDescription = Boolean(resource.seo?.description);
    const hasContent = Boolean(resource.description || resource.body || resource.bodySummary);
    const breakdown = scoreBreakdown({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt });
    return {
      ...resource,
      resourceType,
      score: calculateScore({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt }),
      hasSchema,
      hasFaq,
      hasLlmsTxt,
      schemaJson: schemaMap[resource.id]?.schemaJson || null,
      faqJson: supportsFaq ? faqMap[resource.id]?.faqJson || null : null,
      breakdown: supportsFaq ? breakdown : removeFaqBreakdown(breakdown),
    };
  }

  return {
    products: products.map((p) => buildItem(p, "product")),
    collections: collections.map((c) => buildItem(c, "collection")),
    articles: articles.map((a) => buildItem(a, "article")),
    pages: pages.map((p) => buildItem(p, "page")),
    llmsTxt: llmsTxt
      ? { updatedAt: llmsTxt.updatedAt?.toISOString?.() || String(llmsTxt.updatedAt) }
      : null,
    shopName,
    shopDomain,
    shop,
    appApiKey: process.env.SHOPIFY_API_KEY || "",
    credits: creditSnapshot.credits,
    isFreePlan: (shopData?.billingPlanKey || "free") === "free",
    themeEmbedEnabled: shopData?.themeEmbedEnabled ?? false,
    llmsTxtSettings: readLlmsTxtSettings(shopData?.globalSettingsJson),
    llmsTxtCredits: calcLlmsTxtCredits(products.length + collections.length + articles.length + pages.length),
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "save_llms_settings") {
    let settings = {};
    try {
      settings = JSON.parse(String(formData.get("settingsJson") || "{}"));
    } catch {
      return { ok: false, intent, error: "Invalid LLMs.txt settings." };
    }
    const current = await db.shop.findUnique({
      where: { shop },
      select: { globalSettingsJson: true },
    });
    const nextGlobalSettingsJson = writeLlmsTxtSettings(current?.globalSettingsJson, settings);
    await db.shop.update({
      where: { shop },
      data: { globalSettingsJson: nextGlobalSettingsJson },
    });
    invalidateLlmsTxtCache(shop);
    return { ok: true, intent, settings: readLlmsTxtSettings(nextGlobalSettingsJson) };
  }

  const schemaAndFaqIntents = new Set([
    "generate_schema",
    "generate_faq",
    "generate_combined",
    "generate_bulk_schema",
  ]);

  if (schemaAndFaqIntents.has(String(intent || ""))) {
    const shopData = await db.shop.findUnique({
      where: { shop },
      select: { billingPlanKey: true },
    });
    if ((shopData?.billingPlanKey || "free") === "free") {
      return {
        ok: false,
        intent,
        error: "JSON schema and FAQ generation are not available on the free plan.",
      };
    }
  }

  try {
    if (intent === "generate_schema") {
      const resourceType = formData.get("resourceType");
      let resource;
      try {
        resource = JSON.parse(formData.get("resourceJson"));
      } catch {
        return { ok: false, intent, error: "Invalid resource data." };
      }
      if (!resource || typeof resource !== "object" || !resource.id) {
        return { ok: false, intent, error: "Invalid resource: missing id." };
      }
      const result = await generateSchema(
        shop,
        { adminGraphQL: admin.graphql, accessToken: session.accessToken },
        resourceType,
        resource,
      );
      return { ok: true, intent, resourceType, resourceId: resource.id, ...result };
    }

    if (intent === "generate_faq") {
      const resourceType = formData.get("resourceType");
      let resource;
      try {
        resource = JSON.parse(formData.get("resourceJson"));
      } catch {
        return { ok: false, intent, error: "Invalid resource data." };
      }
      if (!resource || typeof resource !== "object" || !resource.id) {
        return { ok: false, intent, error: "Invalid resource: missing id." };
      }
      const result = await generateFaq(
        shop,
        { adminGraphQL: admin.graphql, accessToken: session.accessToken },
        resourceType,
        resource,
      );
      // Auto-add the faq-section block to the product page template (non-blocking)
      if (resourceType === "product") {
        autoAddFaqSectionToProductPage(shop, session.accessToken);
      }
      return { ok: true, intent, resourceType, resourceId: resource.id, ...result };
    }

    if (intent === "generate_combined") {
      let resource;
      try {
        resource = JSON.parse(formData.get("resourceJson"));
      } catch {
        return { ok: false, intent, error: "Invalid resource data." };
      }
      if (!resource || typeof resource !== "object" || !resource.id) {
        return { ok: false, intent, error: "Invalid resource: missing id." };
      }
      const result = await generateCombined(
        shop,
        { adminGraphQL: admin.graphql, accessToken: session.accessToken },
        resource,
      );
      // Auto-add the faq-section block to the product page template (non-blocking)
      autoAddFaqSectionToProductPage(shop, session.accessToken);
      return { ok: true, intent, resourceType: "product", resourceId: resource.id, ...result };
    }

    if (intent === "generate_bulk_schema") {
      const resourceType = formData.get("resourceType");
      let resources;
      try {
        resources = JSON.parse(formData.get("resourcesJson") || "[]");
      } catch {
        return { ok: false, intent, error: "Invalid resource data." };
      }
      if (!Array.isArray(resources) || resources.length === 0) {
        return { ok: false, intent, error: "Select at least one item for bulk schema generation." };
      }

      const results = [];
      let creditsUsed = 0;
      for (const resource of resources) {
        const result = await generateSchema(
          shop,
          { adminGraphQL: admin.graphql, accessToken: session.accessToken },
          resourceType,
          resource,
        );
        creditsUsed += result.creditsUsed || 0;
        results.push({ resourceId: resource.id, schemaJson: result.schemaJson });
      }

      return { ok: true, intent, resourceType, results, creditsUsed };
    }

    if (intent === "generate_llmstxt") {
      const result = await generateAndStoreDynamicLlmsTxt(shop);
      return { ok: true, intent, ...result };
    }

    if (intent === "toggle_theme_embed") {
      const enabled = formData.get("enabled") === "true";
      await db.shop.update({ where: { shop }, data: { themeEmbedEnabled: enabled } });
      return { ok: true, intent, themeEmbedEnabled: enabled };
    }

    if (intent === "verify_theme_embed") {
      try {
        const accessToken = session.accessToken;
        // Use the same stable API version the rest of the app uses (October 2025).
        const apiBase = `https://${shop}/admin/api/2025-10`;

        // 1. Get the active (main) theme id.
        const themesResp = await fetch(`${apiBase}/themes.json?role=main`, {
          headers: { "X-Shopify-Access-Token": accessToken },
        });
        if (!themesResp.ok) {
          throw new Error(`Shopify returned ${themesResp.status} when fetching themes. Check that the app has the read_themes scope.`);
        }
        const themesData = await themesResp.json();
        const themeId = themesData?.themes?.[0]?.id;
        if (!themeId) throw new Error("No active (main) theme found on this store.");

        // 2. Read config/settings_data.json from the active theme.
        const assetResp = await fetch(
          `${apiBase}/themes/${themeId}/assets.json?asset[key]=config/settings_data.json`,
          { headers: { "X-Shopify-Access-Token": accessToken } }
        );
        if (!assetResp.ok) {
          throw new Error(`Shopify returned ${assetResp.status} when reading theme settings_data.json.`);
        }
        const assetData = await assetResp.json();
        const rawContent = assetData?.asset?.value || "{}";

        let settings = {};
        try {
          settings = JSON.parse(rawContent);
        } catch {
          throw new Error("Could not parse settings_data.json. The active theme may be corrupted.");
        }

        // 3. Detect the app embed block.
        //
        // Shopify stores app embed blocks in settings_data.json under
        //   settings.current.blocks
        // keyed as:
        //   "shopify://apps/<app-id>/blocks/<extension-handle>/<uuid>"
        // The block type mirrors the key prefix (without the uuid).
        //
        // The extension handles to look for:
        //   - "ai-visibility-embed"  (extension handle from shopify.extension.toml)
        //   - "app-embed"            (block filename: blocks/app-embed.liquid)
        //   - "content-ai-seo-generator" (app handle from shopify.app.toml)
        //
        // Fallback: scan the raw JSON string – catches any format variation.
        const EMBED_HANDLES = [
          "ai-visibility-embed",
          "app-embed",
          process.env.SHOPIFY_APP_HANDLE || "content-ai-seo-generator",
        ];

        function blockMatchesEmbed(key, val) {
          const candidates = [key, val?.type, val?.name].filter(Boolean).map(String);
          return candidates.some((s) =>
            EMBED_HANDLES.some((h) => s.toLowerCase().includes(h))
          );
        }

        function isBlockEnabled(val) {
          return val?.disabled !== true;
        }

        // Primary: walk settings.current.blocks
        const topBlocks = settings?.current?.blocks || {};
        let embedEnabled = Object.entries(topBlocks).some(
          ([k, v]) => blockMatchesEmbed(k, v) && isBlockEnabled(v)
        );

        // Secondary fallback: raw string search (catches exotic theme formats
        // where the block lives at a different nesting level).
        if (!embedEnabled) {
          const lower = rawContent.toLowerCase();
          embedEnabled = EMBED_HANDLES.some((h) => {
            const idx = lower.indexOf(h);
            if (idx === -1) return false;
            // Make sure the nearest "disabled" flag within ~150 chars is not true.
            const nearby = lower.slice(idx, idx + 150);
            return !nearby.includes('"disabled":true') && !nearby.includes('"disabled": true');
          });
        }

        await db.shop.update({ where: { shop }, data: { themeEmbedEnabled: embedEnabled } });
        return { ok: true, intent, themeEmbedEnabled: embedEnabled };
      } catch (err) {
        console.error("[verify_theme_embed]", err);
        return {
          ok: false,
          intent,
          error: err?.message || "Could not read theme settings. Make sure the app has the read_themes scope.",
        };
      }
    }

    if (intent === "auto_enable_embed") {
      try {
        const accessToken = session.accessToken;
        const apiBase = `https://${shop}/admin/api/2025-10`;
        // settings_data.json uses the APP HANDLE (from shopify.app.toml), not the API key.
        const appHandle = process.env.SHOPIFY_APP_HANDLE || "content-ai-seo-generator";

        // 1. Get the active theme id
        const themesResp = await fetch(`${apiBase}/themes.json?role=main`, {
          headers: { "X-Shopify-Access-Token": accessToken },
        });
        if (!themesResp.ok) {
          if (themesResp.status === 403) {
            throw new Error("Permission denied. The app needs the write_themes scope. Please reinstall the app to grant this permission.");
          }
          throw new Error(`Failed to fetch themes (${themesResp.status}).`);
        }
        const themesData = await themesResp.json();
        const themeId = themesData?.themes?.[0]?.id;
        if (!themeId) throw new Error("No active theme found.");

        // 2. Read current settings_data.json
        const assetResp = await fetch(
          `${apiBase}/themes/${themeId}/assets.json?asset[key]=config/settings_data.json`,
          { headers: { "X-Shopify-Access-Token": accessToken } }
        );
        if (!assetResp.ok) throw new Error(`Failed to read theme settings (${assetResp.status}).`);
        const assetData = await assetResp.json();
        const rawContent = assetData?.asset?.value || "{}";
        let settings;
        try { settings = JSON.parse(rawContent); } catch { settings = { current: {} }; }

        // 3. If already enabled — just sync DB and return
        const EMBED_HANDLES = ["app-embed", "ai-visibility-embed"];
        const currentBlocks = settings?.current?.blocks || {};
        const alreadyEnabled = Object.entries(currentBlocks).some(([k, v]) =>
          [k, v?.type].filter(Boolean).map(String)
            .some((s) => EMBED_HANDLES.some((h) => s.toLowerCase().includes(h))) &&
          v?.disabled !== true
        );
        if (alreadyEnabled) {
          await db.shop.update({ where: { shop }, data: { themeEmbedEnabled: true } });
          return { ok: true, intent, themeEmbedEnabled: true };
        }

        // 4. Insert the app embed block into settings_data.json.
        // Block key format Shopify uses: shopify://apps/{appHandle}/blocks/{blockHandle}/{uuid}
        const uid = `cai-${Date.now()}`;
        const blockHandle = "app-embed"; // blocks/app-embed.liquid
        const blockKey  = `shopify://apps/${appHandle}/blocks/${blockHandle}/${uid}`;
        const blockType = `shopify://apps/${appHandle}/blocks/${blockHandle}`;
        if (!settings.current) settings.current = {};
        if (!settings.current.blocks) settings.current.blocks = {};
        settings.current.blocks[blockKey] = { type: blockType, disabled: false, settings: {} };

        // 5. Write the updated settings_data.json back to the theme
        const writeResp = await fetch(`${apiBase}/themes/${themeId}/assets.json`, {
          method: "PUT",
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            asset: { key: "config/settings_data.json", value: JSON.stringify(settings) },
          }),
        });
        if (!writeResp.ok) {
          const errBody = await writeResp.json().catch(() => ({}));
          if (writeResp.status === 403) {
            throw new Error("Permission denied (write_themes scope missing). Please reinstall the app or manually enable Schema Injection via the Open Theme Editor button.");
          }
          const msg = typeof errBody?.errors === "string"
            ? errBody.errors
            : errBody?.errors ? JSON.stringify(errBody.errors) : `HTTP ${writeResp.status}`;
          throw new Error(`Failed to update theme: ${msg}`);
        }

        await db.shop.update({ where: { shop }, data: { themeEmbedEnabled: true } });
        return { ok: true, intent, themeEmbedEnabled: true };
      } catch (err) {
        console.error("[auto_enable_embed]", err);
        return { ok: false, intent, error: err?.message || "Failed to auto-enable schema injection." };
      }
    }

    return { ok: false, error: "Unknown intent." };
  } catch (err) {
    if (isInsufficientCreditsMessage(err?.message)) {
      console.warn("[AI Visibility action]", err.message);
    } else {
      console.error("[AI Visibility action]", err);
    }
    return { ok: false, intent, error: err?.message || "Generation failed." };
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ScoreBadge({ score }) {
  if (score >= 80) return <Badge tone="success">{score}/100</Badge>;
  if (score >= 50) return <Badge tone="warning">{score}/100</Badge>;
  return <Badge tone="critical">{score}/100</Badge>;
}

// ---------------------------------------------------------------------------
// Item Drawer
// ---------------------------------------------------------------------------

function ItemModal({ item, onClose, onGenerate, generatingKey, credits, hasUnlimitedVisibility, isFreePlan }) {
  const [expandedFaqIndex, setExpandedFaqIndex] = useState(null);
  if (!item) return null;
  // FAQ generation via AI Visibility is not yet released; kept false until the feature ships.
  const canFaq = false;
  const schemaKey = `schema_${item.id}`;
  const minimumRequiredCredits = hasUnlimitedVisibility ? 0 : CREDITS_SCHEMA;
  const hasAffordableAction = !isFreePlan && (hasUnlimitedVisibility || credits >= CREDITS_SCHEMA);
  const showCombinedAction = false;
  const showSchemaAction = true;
  const faqKey = "";
  const combinedKey = "";

  return (
    <Modal
      open
      onClose={onClose}
      title={item.title}
      size="large"
    >
      <Modal.Section>
        <BlockStack gap="400">
          <InlineStack gap="200">
            <ScoreBadge score={item.score} />
            {item.hasSchema && <Badge tone="success">Schema</Badge>}
            {canFaq && item.hasFaq && <Badge tone="success">FAQ</Badge>}
          </InlineStack>

          <Box>
            <Text variant="headingSm">Score Breakdown</Text>
            <BlockStack gap="100">
              {item.breakdown.map((b) => (
                <InlineStack key={b.signal} gap="200" blockAlign="center">
                  <Text tone={b.achieved ? "success" : "critical"}>{b.achieved ? "+" : "-"}</Text>
                  <Text>{b.signal}</Text>
                  <Text tone="subdued">+{b.points} pts</Text>
                </InlineStack>
              ))}
            </BlockStack>
          </Box>

          <InlineStack gap="200" wrap>
            {showCombinedAction && (
              <Button
                variant="primary"
                loading={generatingKey === combinedKey}
                disabled={!hasUnlimitedVisibility && credits < CREDITS_COMBINED}
                onClick={() => onGenerate("generate_combined", item)}
              >
                {hasUnlimitedVisibility ? "Generate Schema + FAQ" : `Generate Schema + FAQ (${CREDITS_COMBINED} credits)`}
              </Button>
            )}
            {showSchemaAction && (
              <Button
                loading={generatingKey === schemaKey}
                disabled={isFreePlan || (!hasUnlimitedVisibility && credits < CREDITS_SCHEMA)}
                onClick={() => onGenerate("generate_schema", item)}
              >
                {item.hasSchema
                  ? hasUnlimitedVisibility ? "Regenerate Schema" : `Regenerate Schema (${CREDITS_SCHEMA} credits)`
                  : hasUnlimitedVisibility ? "Generate Schema" : `Generate Schema (${CREDITS_SCHEMA} credits)`}
              </Button>
            )}
            {canFaq && (
              <Button
                loading={generatingKey === faqKey}
                disabled={isFreePlan || (!hasUnlimitedVisibility && credits < CREDITS_FAQ)}
                onClick={() => onGenerate("generate_faq", item)}
              >
                {item.hasFaq
                  ? hasUnlimitedVisibility ? "Regenerate FAQ" : `Regenerate FAQ (${CREDITS_FAQ} credits)`
                  : hasUnlimitedVisibility ? "Generate FAQ" : `Generate FAQ (${CREDITS_FAQ} credits)`}
              </Button>
            )}
          </InlineStack>

          {isFreePlan && (
            <Banner tone="info">
              <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                <Text as="p">JSON schema and FAQ generation are not available on the free plan.</Text>
                <Button size="slim" url={PRICING_PATH}>
                  Upgrade plan
                </Button>
              </InlineStack>
            </Banner>
          )}

          {!isFreePlan && !hasAffordableAction && Number.isFinite(minimumRequiredCredits) && (
            <Banner tone="warning">
              <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                <Text as="p">
                  You have {credits} credits. This action needs at least {minimumRequiredCredits} credits.
                </Text>
                <Button size="slim" url={PRICING_PATH}>
                  Buy credits
                </Button>
              </InlineStack>
            </Banner>
          )}

          {item.schemaJson && (
            <Box>
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingSm">Schema JSON-LD</Text>
                <Button
                  variant="plain"
                  onClick={() => {
                    if (typeof navigator !== "undefined") navigator.clipboard.writeText(item.schemaJson);
                  }}
                >
                  Copy
                </Button>
              </InlineStack>
              <Box paddingBlockStart="200">
                <div
                  style={{
                    background: "#1e1e1e",
                    color: "#d4d4d4",
                    padding: "12px",
                    borderRadius: "6px",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    overflow: "auto",
                    maxHeight: "220px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {JSON.stringify(JSON.parse(item.schemaJson), null, 2)}
                </div>
              </Box>
            </Box>
          )}

          {canFaq && item.faqJson && (() => {
            try {
              const faqPage = JSON.parse(item.faqJson);
              const entities = faqPage.mainEntity || [];
              return (
                <Box>
                  <Text variant="headingSm">FAQ Content</Text>
                  <BlockStack gap="100">
                    {entities.map((qa, i) => (
                      <Box
                        key={i}
                        background="bg-surface-secondary"
                        borderRadius="200"
                        padding="300"
                      >
                        <Button
                          variant="plain"
                          textAlign="left"
                          fullWidth
                          onClick={() => setExpandedFaqIndex(expandedFaqIndex === i ? null : i)}
                        >
                          <Text fontWeight="semibold">{qa.name}</Text>
                        </Button>
                        <Collapsible open={expandedFaqIndex === i} id={`faq-${item.id}-${i}`} transition={{ duration: "150ms", timingFunction: "ease" }}>
                          <Box paddingBlockStart="200">
                            <Text tone="subdued">{qa.acceptedAnswer?.text}</Text>
                          </Box>
                        </Collapsible>
                      </Box>
                    ))}
                  </BlockStack>
                </Box>
              );
            } catch {
              return null;
            }
          })()}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Resource Tab
// ---------------------------------------------------------------------------

const PAGE_SIZE_OPTIONS = [
  { label: "10 per page", value: "10" },
  { label: "20 per page", value: "20" },
  { label: "50 per page", value: "50" },
  { label: "100 per page", value: "100" },
];

function ResourceTab({ items, resourceType, onSelectItem, selectedIds, onToggleItem, onTogglePage }) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState("20");

  const size = Number(pageSize);

  if (items.length === 0) {
    return (
      <Box padding="600">
        <Text tone="subdued" alignment="center">No {resourceType}s found in this store.</Text>
      </Box>
    );
  }

  const totalPages = Math.ceil(items.length / size);
  const pageItems = items.slice(page * size, (page + 1) * size);
  const showFaqColumn = resourceType !== "page";
  const pageSelectedCount = pageItems.filter((item) => selectedIds.includes(item.id)).length;
  const pageSelectionChecked = pageItems.length > 0 && pageSelectedCount === pageItems.length;
  const pageSelectionIndeterminate = pageSelectedCount > 0 && pageSelectedCount < pageItems.length;

  const rows = pageItems.map((item) => {
    const baseRow = [
      <Checkbox
        key="select"
        label={`Select ${item.title}`}
        labelHidden
        checked={selectedIds.includes(item.id)}
        onChange={(checked) => onToggleItem(item.id, checked)}
      />,
      <Button key="title" variant="plain" textAlign="left" onClick={() => onSelectItem(item)}>
        {item.title}
      </Button>,
      <ScoreBadge key="score" score={item.score} />,
      item.hasSchema
        ? <Badge key="schema" tone="success">Yes</Badge>
        : <Badge key="schema">No</Badge>,
    ];

    baseRow.push(<Button key="action" size="slim" onClick={() => onSelectItem(item)}>View</Button>);
    return baseRow;
  });

  return (
    <BlockStack gap="0">
      <DataTable
        columnContentTypes={["text", "text", "text", "text", "text"]}
        headings={[
          <Checkbox
            key="select-page"
            label="Select visible items"
            labelHidden
            checked={pageSelectionChecked}
            indeterminate={pageSelectionIndeterminate}
            onChange={(checked) => onTogglePage(pageItems.map((item) => item.id), checked)}
          />,
          "Title", "AI Score", "Schema", "",
        ]}
        rows={rows}
      />
      <Box
        padding="300"
        borderColor="border"
        borderBlockStartWidth="025"
        background="bg-surface-secondary"
      >
        <InlineStack align="space-between" blockAlign="center">
          <Text tone="subdued" variant="bodySm">
            Showing {page * size + 1}–{Math.min((page + 1) * size, items.length)} of {items.length}
          </Text>
          <InlineStack gap="300" blockAlign="center">
            <div style={{ width: 140 }}>
              <Select
                label="Per page"
                labelHidden
                options={PAGE_SIZE_OPTIONS}
                value={pageSize}
                onChange={(v) => { setPageSize(v); setPage(0); }}
              />
            </div>
            <InlineStack gap="100">
              <Button
                size="slim"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                ‹ Prev
              </Button>
              <Button
                size="slim"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next ›
              </Button>
            </InlineStack>
          </InlineStack>
        </InlineStack>
      </Box>
    </BlockStack>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AiVisibilityPage() {
  const {
    products: initialProducts,
    collections: initialCollections,
    articles: initialArticles,
    pages: initialPages,
    llmsTxt: initialLlmsTxt,
    shop,
    appApiKey,
    themeEmbedEnabled: initialEmbedEnabled,
    llmsTxtCredits,
    credits: initialCredits,
    isFreePlan,
    llmsTxtSettings: initialLlmsTxtSettings,
  } = useLoaderData();
  const hasUnlimitedVisibility = !isFreePlan;
  const fetcher = useFetcher();
  const embedFetcher = useFetcher();
  const autoEnableFetcher = useFetcher();
  const llmsSettingsFetcher = useFetcher();
  const [products, setProducts] = useState(initialProducts);
  const [collections, setCollections] = useState(initialCollections);
  const [articles, setArticles] = useState(initialArticles);
  const [pages, setPages] = useState(initialPages);
  const [llmsTxt, setLlmsTxt] = useState(initialLlmsTxt);
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedItemKey, setSelectedItemKey] = useState(null); // { id, resourceType }
  const [generatingKey, setGeneratingKey] = useState(null);
  const [banner, setBanner] = useState(null);
  const [embedEnabled, setEmbedEnabled] = useState(initialEmbedEnabled);
  const [verifyResult, setVerifyResult] = useState(null); // { ok, enabled, error } after Verify click
  const [credits, setCredits] = useState(initialCredits);
  const [selectedIdsByType, setSelectedIdsByType] = useState({ product: [], collection: [], article: [], page: [] });
  const [llmsTxtSettings, setLlmsTxtSettings] = useState(initialLlmsTxtSettings);

  // Derive selectedItem from live list state so modal updates instantly after generation
  const selectedItem = useMemo(() => {
    if (!selectedItemKey) return null;
    const { id, resourceType } = selectedItemKey;
    const list = resourceType === "product" ? products : resourceType === "collection" ? collections : resourceType === "article" ? articles : pages;
    return list.find((item) => item.id === id) || null;
  }, [selectedItemKey, products, collections, articles, pages]);

  const isSubmitting = fetcher.state !== "idle";

  const rebuildItemScore = useCallback((item) => {
    const supportsFaq = item.resourceType !== "page";
    const hasSeoTitle = Boolean(item.seo?.title);
    const hasSeoDescription = Boolean(item.seo?.description);
    const hasContent = Boolean(item.description || item.body || item.bodySummary);
    const hasSchema = Boolean(item.hasSchema);
    const hasFaq = supportsFaq && Boolean(item.hasFaq);
    const hasLlmsTxt = Boolean(item.hasLlmsTxt);
    const breakdown = clientScoreBreakdown({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt });
    return {
      ...item,
      hasFaq,
      faqJson: supportsFaq ? item.faqJson : null,
      score: calculateClientScore({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt }),
      breakdown: supportsFaq ? breakdown : removeFaqBreakdown(breakdown),
    };
  }, []);

  const updateResourceItem = useCallback((resourceType, resourceId, patch) => {
    const updateItems = (items) =>
      items.map((item) => (item.id === resourceId ? rebuildItemScore({ ...item, ...patch }) : item));

    if (resourceType === "product") setProducts(updateItems);
    if (resourceType === "collection") setCollections(updateItems);
    if (resourceType === "article") setArticles(updateItems);
    if (resourceType === "page") setPages(updateItems);
  }, [rebuildItemScore]);

  const markAllItemsInLlmsTxt = useCallback(() => {
    const updateItems = (items) => items.map((item) => rebuildItemScore({ ...item, hasLlmsTxt: true }));
    setProducts(updateItems);
    setCollections(updateItems);
    setArticles(updateItems);
    setPages(updateItems);
  }, [rebuildItemScore]);

  useEffect(() => {
    if (fetcher.state === "idle" && generatingKey !== null && fetcher.data) {
      const data = fetcher.data;
      setGeneratingKey(null);
      if (data.ok) {
        if (data.intent === "generate_schema") {
          updateResourceItem(data.resourceType, data.resourceId, {
            hasSchema: true,
            schemaJson: data.schemaJson,
          });
        }

        if (data.intent === "generate_bulk_schema") {
          (data.results || []).forEach((result) => {
            updateResourceItem(data.resourceType, result.resourceId, {
              hasSchema: true,
              schemaJson: result.schemaJson,
            });
          });
          setSelectedIdsByType((current) => ({ ...current, [data.resourceType]: [] }));
        }

        if (data.intent === "generate_faq") {
          updateResourceItem(data.resourceType, data.resourceId, {
            hasFaq: true,
            faqJson: data.faqJson,
          });
        }

        if (data.intent === "generate_combined") {
          updateResourceItem(data.resourceType, data.resourceId, {
            hasSchema: true,
            hasFaq: true,
            schemaJson: data.schemaJson,
            faqJson: data.faqJson,
          });
        }

        if (data.intent === "generate_llmstxt") {
          setLlmsTxt({ updatedAt: new Date().toISOString() });
          markAllItemsInLlmsTxt();
        }

        if (data.creditsUsed) setCredits((c) => Math.max(0, c - data.creditsUsed));
        setBanner({ tone: "success", text: `Generated successfully (${data.creditsUsed} credits used).` });
      } else {
        setBanner(
          isInsufficientCreditsMessage(data.error)
            ? { tone: "critical", text: data.error, actionLabel: "Buy credits", actionUrl: PRICING_PATH }
            : { tone: "critical", text: data.error || "Generation failed." },
        );
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (embedFetcher.state === "idle" && embedFetcher.data) {
      const d = embedFetcher.data;
      if (d.intent === "toggle_theme_embed" || d.intent === "verify_theme_embed") {
        if (d.ok) {
          setEmbedEnabled(d.themeEmbedEnabled);
          if (d.intent === "verify_theme_embed") {
            setVerifyResult({ ok: true, enabled: d.themeEmbedEnabled });
          }
        } else if (d.intent === "verify_theme_embed") {
          setVerifyResult({ ok: false, error: d.error || "Verification failed." });
        }
      }
    }
  }, [embedFetcher.state, embedFetcher.data]);

  const handleVerifyEmbed = useCallback(() => {
    const fd = new FormData();
    fd.append("intent", "verify_theme_embed");
    embedFetcher.submit(fd, { method: "post" });
  }, [embedFetcher]);

  useEffect(() => {
    if (autoEnableFetcher.state === "idle" && autoEnableFetcher.data) {
      const d = autoEnableFetcher.data;
      if (d.intent === "auto_enable_embed") {
        if (d.ok) {
          setEmbedEnabled(d.themeEmbedEnabled);
          setVerifyResult({ ok: true, enabled: true, auto: true });
        } else {
          setVerifyResult({ ok: false, error: d.error || "Auto-enable failed." });
        }
      }
    }
  }, [autoEnableFetcher.state, autoEnableFetcher.data]);

  const handleAutoEnable = useCallback(() => {
    setVerifyResult(null);
    const fd = new FormData();
    fd.append("intent", "auto_enable_embed");
    autoEnableFetcher.submit(fd, { method: "post" });
  }, [autoEnableFetcher]);

  // Auto-enable schema injection on first load if not already enabled.
  const autoEnableCalledRef = useRef(false);
  useEffect(() => {
    if (!embedEnabled && !autoEnableCalledRef.current) {
      autoEnableCalledRef.current = true;
      handleAutoEnable();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allItems = [...products, ...collections, ...articles, ...pages];
  const totalScore =
    allItems.length > 0
      ? Math.round(allItems.reduce((sum, i) => sum + i.score, 0) / allItems.length)
      : 0;

  const handleGenerate = useCallback(
    (intent, item) => {
      if (isFreePlan && ["generate_schema", "generate_faq", "generate_combined"].includes(intent)) {
        setBanner({
          tone: "info",
          text: "JSON schema and FAQ generation are not available on the free plan.",
          actionLabel: "Upgrade plan",
          actionUrl: PRICING_PATH,
        });
        return;
      }
      const requiredCredits = creditsForIntent(intent);
      if (!hasUnlimitedVisibility && requiredCredits > credits) {
        setBanner(buildInsufficientCreditsBanner(requiredCredits, credits));
        return;
      }

      const key =
        intent === "generate_combined"
          ? `combined_${item.id}`
          : intent === "generate_schema"
          ? `schema_${item.id}`
          : `faq_${item.id}`;
      setGeneratingKey(key);
      const fd = new FormData();
      fd.append("intent", intent);
      if (intent !== "generate_llmstxt") {
        fd.append("resourceType", item.resourceType);
        fd.append("resourceJson", JSON.stringify(item));
      }
      fetcher.submit(fd, { method: "post" });
    },
    [credits, fetcher, hasUnlimitedVisibility, isFreePlan],
  );

  const handleGenerateLlmsTxt = useCallback(() => {
    if (!isFreePlan && llmsTxtCredits > credits) {
      setBanner(buildInsufficientCreditsBanner(llmsTxtCredits, credits));
      return;
    }

    setGeneratingKey("llmstxt");
    const fd = new FormData();
    fd.append("intent", "generate_llmstxt");
    fetcher.submit(fd, { method: "post" });
  }, [credits, fetcher, isFreePlan, llmsTxtCredits]);

  const handleLlmsSettingChange = useCallback((key, value) => {
    const nextSettings = { ...llmsTxtSettings, [key]: value };
    setLlmsTxtSettings(nextSettings);
    const fd = new FormData();
    fd.append("intent", "save_llms_settings");
    fd.append("settingsJson", JSON.stringify(nextSettings));
    llmsSettingsFetcher.submit(fd, { method: "post" });
  }, [llmsSettingsFetcher, llmsTxtSettings]);

  const tabs = [
    { id: "products", content: `Products (${products.length})` },
    { id: "collections", content: `Collections (${collections.length})` },
    { id: "blogs", content: `Blogs (${articles.length})` },
    { id: "pages", content: `Pages (${pages.length})` },
  ];
  const tabItems = [products, collections, articles, pages];
  const tabTypes = ["product", "collection", "article", "page"];
  const activeResourceType = tabTypes[selectedTab];
  const activeItems = tabItems[selectedTab];
  const selectedIds = selectedIdsByType[activeResourceType] || [];
  const selectedItems = activeItems.filter((item) => selectedIds.includes(item.id));
  const bulkSchemaCredits = hasUnlimitedVisibility ? 0 : selectedItems.length * CREDITS_SCHEMA;

  const llmsTxtUrl = `https://${shop}/apps/llms-txt`;
  // activateAppId uses the block *filename* (without .liquid), not the extension handle.
  // blocks/app-embed.liquid → handle = "app-embed"
  const appEmbedActivation = appApiKey
    ? `&activateAppId=${encodeURIComponent(appApiKey)}/app-embed`
    : "";
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?context=apps${appEmbedActivation}`;

  // Deep-link to the product page template in the theme editor with the FAQ Section block activated.
  // blocks/faq-section.liquid → handle = "faq-section"
  const faqProductPageUrl = appApiKey
    ? `https://${shop}/admin/themes/current/editor?template=product&addAppBlockId=${encodeURIComponent(appApiKey)}/faq-section&target=newAppsSection`
    : `https://${shop}/admin/themes/current/editor?template=product`;

  const progressTone = totalScore >= 80 ? "success" : "highlight";
  const llmsSettingOptions = [
    ["products", "Enable Products"],
    ["collections", "Enable Collections"],
    ["pages", "Enable Pages"],
    ["blogs", "Enable Blogs"],
    ["policies", "Enable Policies"],
    ["faq", "Enable FAQ"],
    ["sitemap", "Enable Sitemap"],
    ["aiInstructions", "Enable AI Instructions"],
    ["restrictions", "Enable AI Restrictions"],
  ];

  const handleToggleBulkItem = useCallback((resourceType, itemId, checked) => {
    setSelectedIdsByType((current) => {
      const existing = current[resourceType] || [];
      const next = checked
        ? Array.from(new Set([...existing, itemId]))
        : existing.filter((id) => id !== itemId);
      return { ...current, [resourceType]: next };
    });
  }, []);

  const handleToggleBulkPage = useCallback((resourceType, itemIds, checked) => {
    setSelectedIdsByType((current) => {
      const existing = current[resourceType] || [];
      const next = checked
        ? Array.from(new Set([...existing, ...itemIds]))
        : existing.filter((id) => !itemIds.includes(id));
      return { ...current, [resourceType]: next };
    });
  }, []);

  const handleGenerateBulkSchema = useCallback(() => {
    if (selectedItems.length === 0) {
      setBanner({ tone: "warning", text: "Select at least one item for bulk schema generation." });
      return;
    }
    if (isFreePlan) {
      setBanner({
        tone: "info",
        text: "JSON schema and FAQ generation are not available on the free plan.",
        actionLabel: "Upgrade plan",
        actionUrl: PRICING_PATH,
      });
      return;
    }
    if (!hasUnlimitedVisibility && bulkSchemaCredits > credits) {
      setBanner(buildInsufficientCreditsBanner(bulkSchemaCredits, credits));
      return;
    }

    setGeneratingKey("bulk_schema");
    const fd = new FormData();
    fd.append("intent", "generate_bulk_schema");
    fd.append("resourceType", activeResourceType);
    fd.append("resourcesJson", JSON.stringify(selectedItems));
    fetcher.submit(fd, { method: "post" });
  }, [activeResourceType, bulkSchemaCredits, credits, fetcher, hasUnlimitedVisibility, isFreePlan, selectedItems]);

  return (
    <Page fullWidth>
      <BlockStack gap="400">
      <AppPageHeader title="AI Visibility" description="Optimize your store for AI-powered search engines" />
      {banner && (
        <Box paddingBlockEnd="400">
          <Banner tone={banner.tone} onDismiss={() => setBanner(null)}>
            <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
              <Text as="p">{banner.text}</Text>
              {banner.actionLabel && banner.actionUrl && (
                <Button size="slim" url={banner.actionUrl}>
                  {banner.actionLabel}
                </Button>
              )}
            </InlineStack>
          </Banner>
        </Box>
      )}

      <Layout>
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", alignItems: "stretch" }}>
            {/* Score card */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm" tone="subdued">Store AI Readiness Score</Text>
                <InlineStack gap="300" blockAlign="center">
                  <Text variant="heading3xl" fontWeight="bold">{totalScore}</Text>
                  <Text variant="bodyLg" tone="subdued">/100</Text>
                </InlineStack>
                <ProgressBar progress={totalScore} size="small" tone={progressTone} />
                <InlineStack align="space-between">
                  <Text tone="subdued" variant="bodySm">{allItems.length} items analysed</Text>
                  <Text tone="subdued" variant="bodySm">{credits} credits remaining</Text>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* AI Content Index card */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingSm" tone="subdued">AI Content Index</Text>
                  {llmsTxt ? <Badge tone="success">Generated</Badge> : <Badge tone="attention">Not generated</Badge>}
                </InlineStack>
                <Text tone="subdued" variant="bodySm">
                  A single file that tells ChatGPT, Perplexity, and Google AI exactly what your store sells — so your products get recommended when shoppers ask AI assistants for suggestions.
                </Text>
                <InlineStack gap="200" wrap>
                  {llmsTxt ? (
                    <>
                      <Button
                        size="slim"
                        onClick={() => {
                          if (typeof navigator !== "undefined") navigator.clipboard.writeText(llmsTxtUrl);
                        }}
                      >
                        Copy URL
                      </Button>
                      <Button
                        size="slim"
                        variant="plain"
                        loading={isSubmitting && generatingKey === "llmstxt"}
                        disabled={!isFreePlan && credits < llmsTxtCredits}
                        onClick={handleGenerateLlmsTxt}
                      >
                        {isFreePlan ? "Regenerate" : `Regenerate (${llmsTxtCredits} cr)`}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="slim"
                      variant="primary"
                      loading={isSubmitting && generatingKey === "llmstxt"}
                      disabled={!isFreePlan && credits < llmsTxtCredits}
                      onClick={handleGenerateLlmsTxt}
                    >
                      {isFreePlan ? "Generate" : `Generate (${llmsTxtCredits} credits)`}
                    </Button>
                  )}
                </InlineStack>
                <Box borderColor="border" borderBlockStartWidth="025" paddingBlockStart="300">
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingSm" as="h3">LLMs.txt Settings</Text>
                      {llmsSettingsFetcher.state !== "idle" ? <Badge tone="info">Saving</Badge> : null}
                    </InlineStack>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px 14px" }}>
                      {llmsSettingOptions.map(([key, label]) => (
                        <Checkbox
                          key={key}
                          label={label}
                          checked={Boolean(llmsTxtSettings?.[key])}
                          onChange={(value) => handleLlmsSettingChange(key, value)}
                        />
                      ))}
                    </div>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>

            {/* Schema Injection card */}
            <Card>
              <BlockStack gap="400">

                {/* Header row */}
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingSm" as="h3">Schema Injection</Text>
                  {embedEnabled
                    ? <Badge tone="success">Active</Badge>
                    : <Badge tone="info">Automatic</Badge>}
                </InlineStack>

                {/* Active status description — only when confirmed enabled */}
                {embedEnabled && (
                  <Box background="bg-surface-success" borderRadius="200" padding="300">
                    <InlineStack gap="200" blockAlign="start" wrap={false}>
                      <span style={{ color: "#008060", flexShrink: 0, marginTop: 1 }}>
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                        </svg>
                      </span>
                      <Text variant="bodySm" as="p">
                        <strong>Schema &amp; FAQ are live.</strong> Structured data is automatically injected into your product, article, and page templates — visible to Google and AI crawlers.
                      </Text>
                    </InlineStack>
                  </Box>
                )}

                {/* Only show error results — suppress "not active" warnings since auto-enable handles it */}
                {verifyResult && !verifyResult.ok && (
                  <Box background="bg-surface-caution" borderRadius="200" padding="300">
                    <BlockStack gap="200">
                      <InlineStack gap="150" blockAlign="start">
                        <span style={{ color: "#b98900", flexShrink: 0, marginTop: 1 }}>
                          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                          </svg>
                        </span>
                        <Text variant="bodySm" as="span">{verifyResult.error}</Text>
                      </InlineStack>
                      <Button
                        url={themeEditorUrl}
                        external
                        size="slim"
                        variant="primary"
                        onClick={() => setVerifyResult(null)}
                      >
                        Enable manually in Theme Editor
                      </Button>
                    </BlockStack>
                  </Box>
                )}

                {/* Action buttons */}
                <InlineStack gap="200" blockAlign="center" wrap>
                  {!embedEnabled && (
                    <Button
                      variant="primary"
                      size="slim"
                      loading={autoEnableFetcher.state !== "idle"}
                      disabled={autoEnableFetcher.state !== "idle"}
                      onClick={handleAutoEnable}
                    >
                      Auto-enable
                    </Button>
                  )}
                  <Button
                    size="slim"
                    loading={embedFetcher.state !== "idle"}
                    onClick={() => { setVerifyResult(null); handleVerifyEmbed(); }}
                  >
                    Verify
                  </Button>
                  {!embedEnabled && (
                    <Button
                      url={themeEditorUrl}
                      external
                      size="slim"
                      variant="plain"
                      onClick={() => setVerifyResult(null)}
                    >
                      Open Theme Editor
                    </Button>
                  )}
                </InlineStack>

              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <Box padding="400" borderColor="border" borderBlockEndWidth="025">
              <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone={isFreePlan || (!hasUnlimitedVisibility && bulkSchemaCredits > credits) ? "critical" : "subdued"}>
                    {isFreePlan
                      ? "JSON schema and FAQ generation are not available on the free plan."
                      : `Credits used: ${bulkSchemaCredits}${hasUnlimitedVisibility ? "" : ` (${selectedItems.length} items x ${CREDITS_SCHEMA} credits)`}${!hasUnlimitedVisibility && bulkSchemaCredits > credits ? ` - not enough credits (${credits} available)` : ""}`}
                  </Text>
                </BlockStack>
                <Button
                  variant="primary"
                  disabled={isFreePlan || selectedItems.length === 0 || (!hasUnlimitedVisibility && bulkSchemaCredits > credits)}
                  loading={isSubmitting && generatingKey === "bulk_schema"}
                  onClick={handleGenerateBulkSchema}
                >
                  {isFreePlan ? "Upgrade to generate schema" : hasUnlimitedVisibility ? "Generate Schema" : `Generate Schema (${bulkSchemaCredits} credits)`}
                </Button>
              </InlineStack>
            </Box>
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              <Box padding="0">
                <ResourceTab
                  key={selectedTab}
                  items={tabItems[selectedTab]}
                  resourceType={tabTypes[selectedTab]}
                  onSelectItem={(item) => setSelectedItemKey({ id: item.id, resourceType: item.resourceType })}
                  selectedIds={selectedIds}
                  onToggleItem={(itemId, checked) => handleToggleBulkItem(activeResourceType, itemId, checked)}
                  onTogglePage={(itemIds, checked) => handleToggleBulkPage(activeResourceType, itemIds, checked)}
                />
              </Box>
            </Tabs>
          </Card>
        </Layout.Section>

      </Layout>

      {selectedItem && (
        <ItemModal
          item={selectedItem}
          onClose={() => setSelectedItemKey(null)}
          onGenerate={handleGenerate}
          generatingKey={generatingKey}
          credits={credits}
          hasUnlimitedVisibility={hasUnlimitedVisibility}
          isFreePlan={isFreePlan}
        />
      )}
      </BlockStack>
    </Page>
  );
}
