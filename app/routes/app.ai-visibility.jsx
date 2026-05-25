import { useState, useCallback, useEffect, useMemo } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Page, Layout, Card, Text, Badge, Button, DataTable, Tabs, Box, BlockStack,
  InlineStack, ProgressBar, Banner, Collapsible, Modal, Select,
} from "@shopify/polaris";
import {
  generateSchema,
  generateFaq,
  generateCombined,
  generateLlmsTxt,
  calculateScore,
  scoreBreakdown,
  calcLlmsTxtCredits,
} from "../lib/aiVisibility.server";
import { getOrCreateShopCredits } from "../lib/credits.server";

// Credit costs — defined here (not imported from server module) so they are available client-side
const CREDITS_SCHEMA = 2;
const CREDITS_FAQ = 5;
const CREDITS_COMBINED = 5;

function isInsufficientCreditsMessage(message) {
  return /^Insufficient credits\./.test(String(message || ""));
}

function creditsForIntent(intent) {
  if (intent === "generate_schema") return CREDITS_SCHEMA;
  if (intent === "generate_faq") return CREDITS_FAQ;
  if (intent === "generate_combined") return CREDITS_COMBINED;
  return 0;
}

function calculateClientScore({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt }) {
  let score = 0;
  if (hasSeoTitle) score += 10;
  if (hasSeoDescription) score += 10;
  if (hasContent) score += 10;
  if (hasSchema) score += 30;
  if (hasFaq) score += 30;
  if (hasLlmsTxt) score += 10;
  return score;
}

function clientScoreBreakdown({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt }) {
  return [
    { signal: "Meta title", points: 10, achieved: hasSeoTitle },
    { signal: "Meta description", points: 10, achieved: hasSeoDescription },
    { signal: "Body / description content", points: 10, achieved: hasContent },
    { signal: "Schema markup generated", points: 30, achieved: hasSchema },
    { signal: "FAQ section generated", points: 30, achieved: hasFaq },
    { signal: "Included in llms.txt", points: 10, achieved: hasLlmsTxt },
  ];
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

const ARTICLES_QUERY = `#graphql
  query GetArticlesForVisibility($first: Int!) {
    articles(first: $first) {
      edges {
        node {
          id title handle body summary publishedAt
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

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [productsRes, articlesRes, pagesRes, shopRes] = await Promise.all([
    admin.graphql(PRODUCTS_QUERY, { variables: { first: 100 } }),
    admin.graphql(ARTICLES_QUERY, { variables: { first: 100 } }),
    admin.graphql(PAGES_QUERY, { variables: { first: 50 } }),
    admin.graphql(SHOP_QUERY),
  ]);

  const [productsJson, articlesJson, pagesJson, shopJson] = await Promise.all([
    productsRes.json(),
    articlesRes.json(),
    pagesRes.json(),
    shopRes.json(),
  ]);

  const products = (productsJson?.data?.products?.edges || []).map((e) => e.node);
  const articles = (articlesJson?.data?.articles?.edges || []).map((e) => e.node);
  const pages = (pagesJson?.data?.pages?.edges || []).map((e) => e.node);
  const shopName = shopJson?.data?.shop?.name || shop;
  const shopDomain = shopJson?.data?.shop?.primaryDomain?.host || shop;

  const allResourceIds = [
    ...products.map((p) => p.id),
    ...articles.map((a) => a.id),
    ...pages.map((p) => p.id),
  ];

  const [schemas, faqs, llmsTxt, shopData, creditSnapshot] = await Promise.all([
    db.aiVisibilitySchema.findMany({ where: { shop, resourceId: { in: allResourceIds } } }),
    db.aiVisibilityFaq.findMany({ where: { shop, resourceId: { in: allResourceIds } } }),
    db.aiVisibilityLlmsTxt.findUnique({ where: { shop } }),
    db.shop.findUnique({ where: { shop }, select: { themeEmbedEnabled: true } }),
    getOrCreateShopCredits(shop),
  ]);

  const schemaMap = Object.fromEntries(schemas.map((s) => [s.resourceId, s]));
  const faqMap = Object.fromEntries(faqs.map((f) => [f.resourceId, f]));
  const hasLlmsTxt = Boolean(llmsTxt);

  function buildItem(resource, resourceType) {
    const hasSchema = Boolean(schemaMap[resource.id]);
    const hasFaq = Boolean(faqMap[resource.id]);
    const hasSeoTitle = Boolean(resource.seo?.title);
    const hasSeoDescription = Boolean(resource.seo?.description);
    const hasContent = Boolean(resource.description || resource.body || resource.bodySummary);
    const score = calculateScore({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt });
    return {
      ...resource,
      resourceType,
      score,
      hasSchema,
      hasFaq,
      hasLlmsTxt,
      schemaJson: schemaMap[resource.id]?.schemaJson || null,
      faqJson: faqMap[resource.id]?.faqJson || null,
      breakdown: scoreBreakdown({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt }),
    };
  }

  return {
    products: products.map((p) => buildItem(p, "product")),
    articles: articles.map((a) => buildItem(a, "article")),
    pages: pages.map((p) => buildItem(p, "page")),
    llmsTxt: llmsTxt
      ? { updatedAt: llmsTxt.updatedAt?.toISOString?.() || String(llmsTxt.updatedAt) }
      : null,
    shopName,
    shopDomain,
    shop,
    credits: creditSnapshot.credits,
    themeEmbedEnabled: shopData?.themeEmbedEnabled ?? false,
    llmsTxtCredits: calcLlmsTxtCredits(products.length + articles.length + pages.length),
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

  try {
    if (intent === "generate_schema") {
      const resourceType = formData.get("resourceType");
      const resource = JSON.parse(formData.get("resourceJson"));
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
      const resource = JSON.parse(formData.get("resourceJson"));
      const result = await generateFaq(
        shop,
        { adminGraphQL: admin.graphql, accessToken: session.accessToken },
        resourceType,
        resource,
      );
      return { ok: true, intent, resourceType, resourceId: resource.id, ...result };
    }

    if (intent === "generate_combined") {
      const resource = JSON.parse(formData.get("resourceJson"));
      const result = await generateCombined(
        shop,
        { adminGraphQL: admin.graphql, accessToken: session.accessToken },
        resource,
      );
      return { ok: true, intent, resourceType: "product", resourceId: resource.id, ...result };
    }

    if (intent === "generate_llmstxt") {
      const shopDataRes = await admin.graphql(SHOP_QUERY);
      const shopDataJson = await shopDataRes.json();
      const shopName = shopDataJson?.data?.shop?.name || shop;
      const shopDomain = shopDataJson?.data?.shop?.primaryDomain?.host || shop;

      const [pRes, aRes, pgRes] = await Promise.all([
        admin.graphql(PRODUCTS_QUERY, { variables: { first: 200 } }),
        admin.graphql(ARTICLES_QUERY, { variables: { first: 100 } }),
        admin.graphql(PAGES_QUERY, { variables: { first: 50 } }),
      ]);
      const [pj, aj, pgj] = await Promise.all([pRes.json(), aRes.json(), pgRes.json()]);
      const llmsProducts = (pj?.data?.products?.edges || []).map((e) => e.node).slice(0, 150);
      const llmsArticles = (aj?.data?.articles?.edges || []).map((e) => e.node).slice(0, 30);
      const llmsPages = (pgj?.data?.pages?.edges || []).map((e) => e.node).slice(0, 20);

      const result = await generateLlmsTxt(shop, {
        products: llmsProducts,
        articles: llmsArticles,
        pages: llmsPages,
        shopName,
        shopDomain,
      });
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
        const apiBase = `https://${shop}/admin/api/2026-04`;

        // 1. Get the main (active) theme via REST
        const themesResp = await fetch(`${apiBase}/themes.json?role=main`, {
          headers: { "X-Shopify-Access-Token": accessToken },
        });
        const themesData = await themesResp.json();
        const themeId = themesData?.themes?.[0]?.id;
        if (!themeId) throw new Error("No main theme found");

        // 2. Read config/settings_data.json asset
        const assetResp = await fetch(
          `${apiBase}/themes/${themeId}/assets.json?asset[key]=config/settings_data.json`,
          { headers: { "X-Shopify-Access-Token": accessToken } }
        );
        const assetData = await assetResp.json();
        const content = assetData?.asset?.value || "{}";
        const settings = JSON.parse(content);
        const blocks = settings?.current?.blocks || {};

        // Check if any block key contains our extension handle and is not explicitly disabled
        const embedEnabled = Object.entries(blocks).some(
          ([key, val]) => key.includes("ai-visibility-embed") && val?.disabled !== true
        );
        await db.shop.update({ where: { shop }, data: { themeEmbedEnabled: embedEnabled } });
        return { ok: true, intent, themeEmbedEnabled: embedEnabled };
      } catch (err) {
        console.error("[verify_theme_embed]", err);
        return { ok: false, intent, error: "Could not read theme settings. Make sure the app has theme access." };
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

function ItemModal({ item, onClose, onGenerate, generatingKey, credits }) {
  const [expandedFaqIndex, setExpandedFaqIndex] = useState(null);
  if (!item) return null;
  const canFaq = item.resourceType !== "page";
  const schemaKey = `schema_${item.id}`;
  const faqKey = `faq_${item.id}`;
  const combinedKey = `combined_${item.id}`;

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
            {item.hasFaq && <Badge tone="success">FAQ</Badge>}
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
            {item.resourceType === "product" && !item.hasSchema && !item.hasFaq && (
              <Button
                variant="primary"
                loading={generatingKey === combinedKey}
                onClick={() => onGenerate("generate_combined", item)}
              >
                Generate Schema + FAQ ({CREDITS_COMBINED} credits — saves 2)
              </Button>
            )}
            {(item.hasSchema || item.resourceType !== "product" || item.hasFaq) && (
              <Button
                loading={generatingKey === schemaKey}
                onClick={() => onGenerate("generate_schema", item)}
              >
                {item.hasSchema ? `Regenerate Schema (${CREDITS_SCHEMA} credits)` : `Generate Schema (${CREDITS_SCHEMA} credits)`}
              </Button>
            )}
            {canFaq && (
              <Button
                loading={generatingKey === faqKey}
                onClick={() => onGenerate("generate_faq", item)}
              >
                {item.hasFaq ? `Regenerate FAQ (${CREDITS_FAQ} credits)` : `Generate FAQ (${CREDITS_FAQ} credits)`}
              </Button>
            )}
          </InlineStack>

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

          {item.faqJson && (() => {
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

function ResourceTab({ items, resourceType, onSelectItem }) {
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

  const rows = pageItems.map((item) => [
    <Button key="title" variant="plain" textAlign="left" onClick={() => onSelectItem(item)}>
      {item.title}
    </Button>,
    <ScoreBadge key="score" score={item.score} />,
    item.hasSchema
      ? <Badge key="schema" tone="success">Yes</Badge>
      : <Badge key="schema">No</Badge>,
    resourceType !== "page"
      ? (item.hasFaq ? <Badge key="faq" tone="success">Yes</Badge> : <Badge key="faq">No</Badge>)
      : <Text key="faq" tone="subdued">—</Text>,
    <Button key="action" size="slim" onClick={() => onSelectItem(item)}>View</Button>,
  ]);

  return (
    <BlockStack gap="0">
      <DataTable
        columnContentTypes={["text", "text", "text", "text", "text"]}
        headings={["Title", "AI Score", "Schema", "FAQ", ""]}
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
    articles: initialArticles,
    pages: initialPages,
    llmsTxt: initialLlmsTxt,
    shop,
    themeEmbedEnabled: initialEmbedEnabled,
    llmsTxtCredits,
    credits: initialCredits,
  } = useLoaderData();
  const fetcher = useFetcher();
  const embedFetcher = useFetcher();
  const [products, setProducts] = useState(initialProducts);
  const [articles, setArticles] = useState(initialArticles);
  const [pages, setPages] = useState(initialPages);
  const [llmsTxt, setLlmsTxt] = useState(initialLlmsTxt);
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedItemKey, setSelectedItemKey] = useState(null); // { id, resourceType }
  const [generatingKey, setGeneratingKey] = useState(null);
  const [banner, setBanner] = useState(null);
  const [embedEnabled, setEmbedEnabled] = useState(initialEmbedEnabled);
  const [credits, setCredits] = useState(initialCredits);

  // Derive selectedItem from live list state so modal updates instantly after generation
  const selectedItem = useMemo(() => {
    if (!selectedItemKey) return null;
    const { id, resourceType } = selectedItemKey;
    const list = resourceType === "product" ? products : resourceType === "article" ? articles : pages;
    return list.find((item) => item.id === id) || null;
  }, [selectedItemKey, products, articles, pages]);

  const isSubmitting = fetcher.state !== "idle";

  const rebuildItemScore = useCallback((item) => {
    const hasSeoTitle = Boolean(item.seo?.title);
    const hasSeoDescription = Boolean(item.seo?.description);
    const hasContent = Boolean(item.description || item.body || item.bodySummary);
    const hasSchema = Boolean(item.hasSchema);
    const hasFaq = Boolean(item.hasFaq);
    const hasLlmsTxt = Boolean(item.hasLlmsTxt);
    return {
      ...item,
      score: calculateClientScore({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt }),
      breakdown: clientScoreBreakdown({ hasSeoTitle, hasSeoDescription, hasContent, hasSchema, hasFaq, hasLlmsTxt }),
    };
  }, []);

  const updateResourceItem = useCallback((resourceType, resourceId, patch) => {
    const updateItems = (items) =>
      items.map((item) => (item.id === resourceId ? rebuildItemScore({ ...item, ...patch }) : item));

    if (resourceType === "product") setProducts(updateItems);
    if (resourceType === "article") setArticles(updateItems);
    if (resourceType === "page") setPages(updateItems);
  }, [rebuildItemScore]);

  const markAllItemsInLlmsTxt = useCallback(() => {
    const updateItems = (items) => items.map((item) => rebuildItemScore({ ...item, hasLlmsTxt: true }));
    setProducts(updateItems);
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
        setBanner({ tone: "critical", text: data.error || "Generation failed." });
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
            setBanner(
              d.themeEmbedEnabled
                ? { tone: "success", text: "App Embed is active — schema markup will be injected automatically." }
                : { tone: "warning", text: "App Embed not found in your active theme. Open the Theme Editor and enable the 'AI Visibility' embed under App Embeds." }
            );
          }
        } else if (d.intent === "verify_theme_embed") {
          setBanner({ tone: "critical", text: d.error || "Verification failed." });
        }
      }
    }
  }, [embedFetcher.state, embedFetcher.data]);

  const handleVerifyEmbed = useCallback(() => {
    const fd = new FormData();
    fd.append("intent", "verify_theme_embed");
    embedFetcher.submit(fd, { method: "post" });
  }, [embedFetcher]);

  const allItems = [...products, ...articles, ...pages];
  const totalScore =
    allItems.length > 0
      ? Math.round(allItems.reduce((sum, i) => sum + i.score, 0) / allItems.length)
      : 0;

  const handleGenerate = useCallback(
    (intent, item) => {
      const requiredCredits = creditsForIntent(intent);
      if (requiredCredits > credits) {
        setBanner({
          tone: "critical",
          text: `Insufficient credits. You need ${requiredCredits} credits. Current balance: ${credits}.`,
        });
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
    [credits, fetcher],
  );

  const handleGenerateLlmsTxt = useCallback(() => {
    if (llmsTxtCredits > credits) {
      setBanner({
        tone: "critical",
        text: `Insufficient credits. You need ${llmsTxtCredits} credits. Current balance: ${credits}.`,
      });
      return;
    }

    setGeneratingKey("llmstxt");
    const fd = new FormData();
    fd.append("intent", "generate_llmstxt");
    fetcher.submit(fd, { method: "post" });
  }, [credits, fetcher, llmsTxtCredits]);

  const tabs = [
    { id: "products", content: `Products (${products.length})` },
    { id: "blogs", content: `Blogs (${articles.length})` },
    { id: "pages", content: `Pages (${pages.length})` },
  ];
  const tabItems = [products, articles, pages];
  const tabTypes = ["product", "article", "page"];

  const llmsTxtUrl = `https://${shop}/apps/llms-txt`;

  const progressTone = totalScore >= 80 ? "success" : "highlight";

  return (
    <Page title="AI Visibility" subtitle="Optimize your store for AI-powered search engines">
      {banner && (
        <Box paddingBlockEnd="400">
          <Banner tone={banner.tone} onDismiss={() => setBanner(null)}>
            {banner.text}
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
                        onClick={handleGenerateLlmsTxt}
                      >
                        Regenerate ({llmsTxtCredits} cr)
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="slim"
                      variant="primary"
                      loading={isSubmitting && generatingKey === "llmstxt"}
                      onClick={handleGenerateLlmsTxt}
                    >
                      Generate ({llmsTxtCredits} credits)
                    </Button>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Schema Injection card */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingSm" tone="subdued">Schema Injection</Text>
                  {embedEnabled
                    ? <Badge tone="success">Active</Badge>
                    : <Badge tone="warning">Not enabled</Badge>}
                </InlineStack>
                <Text tone="subdued" variant="bodySm">
                  {embedEnabled
                    ? "Schema markup is auto-injected into product, blog, and page templates. Google and AI crawlers can read your structured data."
                    : "Enable the App Embed in your theme to auto-inject schema markup — required for schema to appear on your storefront."}
                </Text>
                <InlineStack gap="200" wrap>
                  {!embedEnabled && (
                    <Button
                      url={`https://${shop}/admin/themes/current/editor?context=apps`}
                      external
                      size="slim"
                      variant="primary"
                    >
                      Enable in Theme Editor
                    </Button>
                  )}
                  <Button
                    size="slim"
                    loading={embedFetcher.state !== "idle"}
                    onClick={handleVerifyEmbed}
                  >
                    Verify
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              <Box padding="0">
                <ResourceTab
                  key={selectedTab}
                  items={tabItems[selectedTab]}
                  resourceType={tabTypes[selectedTab]}
                  onSelectItem={(item) => setSelectedItemKey({ id: item.id, resourceType: item.resourceType })}
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
        />
      )}
    </Page>
  );
}
