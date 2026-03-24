import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Divider,
  Box,
  Grid,
  Button,
  Layout,
} from "@shopify/polaris";

// ─── GraphQL ─────────────────────────────────────────────────────────────────

const PRODUCTS_SEO_QUERY = `#graphql
  query ProductsSEO($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          seo { title description }
        }
      }
    }
  }
`;

const COLLECTIONS_SEO_QUERY = `#graphql
  query CollectionsSEO($first: Int!) {
    collections(first: $first) {
      edges {
        node {
          id
          title
          description
          seo { title description }
        }
      }
    }
  }
`;

const PAGES_SEO_QUERY = `#graphql
  query PagesSEO($first: Int!) {
    pages(first: $first) {
      edges {
        node {
          id
          title
          metafields(first: 2, namespace: "global") {
            edges { node { key value } }
          }
        }
      }
    }
  }
`;

const ARTICLES_SEO_QUERY = `#graphql
  query ArticlesSEO($first: Int!) {
    articles(first: $first) {
      edges {
        node {
          id
          title
          metafields(first: 2, namespace: "global") {
            edges { node { key value } }
          }
        }
      }
    }
  }
`;

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const [productsRes, collectionsRes, pagesRes, articlesRes] = await Promise.all([
    admin.graphql(PRODUCTS_SEO_QUERY, { variables: { first: 100 } }),
    admin.graphql(COLLECTIONS_SEO_QUERY, { variables: { first: 50 } }),
    admin.graphql(PAGES_SEO_QUERY, { variables: { first: 50 } }),
    admin.graphql(ARTICLES_SEO_QUERY, { variables: { first: 50 } }),
  ]);

  const [productsJson, collectionsJson, pagesJson, articlesJson] = await Promise.all([
    productsRes.json(),
    collectionsRes.json(),
    pagesRes.json(),
    articlesRes.json(),
  ]);

  // Products
  const products = (productsJson.data?.products?.edges || []).map((e) => e.node);
  const productsWithSeoTitle = products.filter((p) => !!p.seo?.title).length;
  const productsWithSeoDesc = products.filter((p) => !!p.seo?.description).length;

  // Collections
  const collections = (collectionsJson.data?.collections?.edges || []).map((e) => e.node);
  const collectionsWithSeoTitle = collections.filter((c) => !!c.seo?.title).length;
  const collectionsWithSeoDesc = collections.filter((c) => !!c.seo?.description).length;
  const collectionsWithDesc = collections.filter((c) => !!c.description).length;

  // Pages (SEO via metafields)
  const pages = (pagesJson.data?.pages?.edges || []).map((e) => {
    const mfs = (e.node.metafields?.edges || []).map((me) => me.node);
    return {
      id: e.node.id,
      title: e.node.title,
      hasSeoTitle: !!mfs.find((m) => m.key === "title_tag")?.value,
      hasSeoDesc: !!mfs.find((m) => m.key === "description_tag")?.value,
    };
  });
  const pagesWithSeoTitle = pages.filter((p) => p.hasSeoTitle).length;
  const pagesWithSeoDesc = pages.filter((p) => p.hasSeoDesc).length;

  // Articles (SEO via metafields)
  const articles = (articlesJson.data?.articles?.edges || []).map((e) => {
    const mfs = (e.node.metafields?.edges || []).map((me) => me.node);
    return {
      id: e.node.id,
      title: e.node.title,
      hasSeoTitle: !!mfs.find((m) => m.key === "title_tag")?.value,
      hasSeoDesc: !!mfs.find((m) => m.key === "description_tag")?.value,
    };
  });
  const articlesWithSeoTitle = articles.filter((a) => a.hasSeoTitle).length;
  const articlesWithSeoDesc = articles.filter((a) => a.hasSeoDesc).length;

  // Overall SEO score
  const totalItems = products.length + collections.length + pages.length + articles.length;
  const totalWithSeo =
    productsWithSeoTitle + productsWithSeoDesc +
    collectionsWithSeoTitle + collectionsWithSeoDesc +
    pagesWithSeoTitle + pagesWithSeoDesc +
    articlesWithSeoTitle + articlesWithSeoDesc;
  const seoScore = totalItems > 0 ? Math.round((totalWithSeo / (totalItems * 2)) * 100) : 0;

  // DB — generation logs
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const collectionLogCount = await db.collectionGeneratedContent
    .count({ where: { shop: session.shop } })
    .catch(() => 0);

  const [totalProductLogs, recentLogs, weekLogs] = await Promise.all([
    db.generatedContentLog.count({ where: { shop: session.shop } }),
    db.generatedContentLog.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        productTitle: true,
        intent: true,
        aiModel: true,
        createdAt: true,
        appliedToProduct: true,
        language: true,
      },
    }),
    db.generatedContentLog.findMany({
      where: { shop: session.shop, createdAt: { gte: sevenDaysAgo } },
      select: { createdAt: true },
    }),
  ]);

  // Build 7-day activity chart data
  const dailyCounts = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dailyCounts[d.toISOString().split("T")[0]] = 0;
  }
  for (const log of weekLogs) {
    const key = new Date(log.createdAt).toISOString().split("T")[0];
    if (key in dailyCounts) dailyCounts[key]++;
  }
  const dailyActivity = Object.entries(dailyCounts).map(([date, count]) => ({
    date,
    label: new Date(date + "T12:00:00").toLocaleDateString("en", { weekday: "short" }),
    count,
  }));

  return {
    products: { total: products.length, withSeoTitle: productsWithSeoTitle, withSeoDesc: productsWithSeoDesc },
    collections: { total: collections.length, withSeoTitle: collectionsWithSeoTitle, withSeoDesc: collectionsWithSeoDesc, withDesc: collectionsWithDesc },
    pages: { total: pages.length, withSeoTitle: pagesWithSeoTitle, withSeoDesc: pagesWithSeoDesc },
    articles: { total: articles.length, withSeoTitle: articlesWithSeoTitle, withSeoDesc: articlesWithSeoDesc },
    seoScore,
    totalGenerations: totalProductLogs + collectionLogCount,
    weekGenerations: weekLogs.length,
    recentLogs: recentLogs.map((l) => ({ ...l, id: l.id.toString(), createdAt: l.createdAt.toISOString() })),
    dailyActivity,
  };
};

// ─── Chart components ─────────────────────────────────────────────────────────

function DonutScore({ score }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 70 ? "#008060" : score >= 40 ? "#B98900" : "#C9201F";
  const label = score >= 70 ? "Good" : score >= 40 ? "Fair" : "Needs Work";
  const tone = score >= 70 ? "success" : score >= 40 ? "warning" : "critical";

  return (
    <BlockStack gap="300">
      <InlineStack align="center">
        <div style={{ position: "relative", width: 140, height: 140 }}>
          <svg viewBox="0 0 140 140" width="140" height="140">
            <circle cx="70" cy="70" r={r} fill="none" stroke="#E4E5E7" strokeWidth="14" />
            <circle
              cx="70" cy="70" r={r}
              fill="none" stroke={color} strokeWidth="14"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform="rotate(-90 70 70)"
            />
          </svg>
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
            <div style={{ fontSize: 30, fontWeight: 700, color, lineHeight: 1 }}>{score}</div>
            <div style={{ fontSize: 11, color: "#6D7175", marginTop: 2 }}>/ 100</div>
          </div>
        </div>
      </InlineStack>
      <InlineStack align="center">
        <Badge tone={tone}>{label}</Badge>
      </InlineStack>
    </BlockStack>
  );
}

function HBar({ label, value, total, color = "#008060" }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <BlockStack gap="100">
      <InlineStack align="space-between">
        <Text variant="bodySm" as="span">{label}</Text>
        <Text variant="bodySm" tone="subdued" as="span">{value} / {total} — {pct}%</Text>
      </InlineStack>
      <div style={{ height: 8, background: "#F1F1F1", borderRadius: 99, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%", background: color,
          borderRadius: 99, minWidth: pct > 0 ? 4 : 0,
          transition: "width 0.4s ease",
        }} />
      </div>
    </BlockStack>
  );
}

function ActivityChart({ data }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const bw = 30, gap = 8, ch = 100;
  const tw = data.length * (bw + gap);

  return (
    <svg viewBox={`0 0 ${tw} ${ch + 28}`} style={{ width: "100%", height: ch + 28 }}>
      {data.map((item, i) => {
        const bh = max > 0 ? Math.max((item.count / max) * ch, item.count > 0 ? 4 : 0) : 0;
        const x = i * (bw + gap);
        const y = ch - bh;
        return (
          <g key={item.date}>
            <rect x={x} y={y} width={bw} height={bh || 2} fill={item.count > 0 ? "#008060" : "#E4E5E7"} rx="4" />
            {item.count > 0 && (
              <text x={x + bw / 2} y={y - 4} textAnchor="middle" fontSize="10" fill="#202223" fontWeight="600">{item.count}</text>
            )}
            <text x={x + bw / 2} y={ch + 18} textAnchor="middle" fontSize="10" fill="#6D7175">{item.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function StatTile({ title, total, withSeoTitle, withSeoDesc, url, color }) {
  const pct = total > 0 ? Math.round(((withSeoTitle + withSeoDesc) / (total * 2)) * 100) : 0;
  const tone = pct >= 70 ? "success" : pct >= 40 ? "warning" : total === 0 ? "info" : "critical";

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingSm" as="h3">{title}</Text>
          <Badge tone={tone}>{total === 0 ? "Empty" : `${pct}%`}</Badge>
        </InlineStack>
        <InlineStack gap="200" blockAlign="end">
          <Text variant="heading2xl" as="p">{total}</Text>
          <Text variant="bodySm" tone="subdued" as="p">items</Text>
        </InlineStack>
        <Divider />
        <BlockStack gap="300">
          <HBar label="SEO Title" value={withSeoTitle} total={total} color={color} />
          <HBar label="SEO Description" value={withSeoDesc} total={total} color={color} />
        </BlockStack>
        <Button url={url} size="slim" variant="secondary">Manage →</Button>
      </BlockStack>
    </Card>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const INTENT_LABEL = {
  generate_description: "Product Description",
  generate_seo_title: "SEO Title",
  generate_seo_description: "SEO Description",
  generate_all: "Full Content",
};

export default function AnalyticsPage() {
  const {
    products, collections, pages, articles,
    seoScore, totalGenerations, weekGenerations,
    recentLogs, dailyActivity,
  } = useLoaderData();

  // Build action items for missing SEO
  const actions = [
    products.total - products.withSeoTitle > 0 && { label: `${products.total - products.withSeoTitle} products missing SEO title`, url: "/app/products" },
    products.total - products.withSeoDesc > 0 && { label: `${products.total - products.withSeoDesc} products missing SEO description`, url: "/app/products" },
    collections.total - collections.withSeoTitle > 0 && { label: `${collections.total - collections.withSeoTitle} collections missing SEO title`, url: "/app/collections" },
    pages.total - pages.withSeoTitle > 0 && { label: `${pages.total - pages.withSeoTitle} pages missing SEO title`, url: "/app/pages" },
    articles.total - articles.withSeoTitle > 0 && { label: `${articles.total - articles.withSeoTitle} articles missing SEO title`, url: "/app/blog" },
  ].filter(Boolean);

  return (
    <Page
      title="SEO Analytics"
      subtitle="Track SEO health and AI content generation across your store"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="600">

        {/* Row 1: Score + Coverage */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Overall SEO Score</Text>
                <Text variant="bodySm" tone="subdued">
                  Based on SEO title &amp; description coverage across all content types.
                </Text>
                <InlineStack align="center">
                  <DonutScore score={seoScore} />
                </InlineStack>
                <Divider />
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h3">Fix Missing SEO</Text>
                  {actions.length === 0 && (
                    <Text variant="bodySm" tone="success">All content has SEO data!</Text>
                  )}
                  {actions.slice(0, 4).map((item, i) => (
                    <InlineStack key={i} gap="200" blockAlign="center" wrap={false}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#C9201F", flexShrink: 0 }} />
                      <Button variant="plain" url={item.url} size="slim">{item.label}</Button>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <Text variant="headingMd" as="h2">SEO Coverage by Content Type</Text>

                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: "#008060" }} />
                    <Text variant="headingSm" as="h3">Products ({products.total})</Text>
                  </InlineStack>
                  <HBar label="SEO Title" value={products.withSeoTitle} total={products.total} color="#008060" />
                  <HBar label="SEO Description" value={products.withSeoDesc} total={products.total} color="#006E52" />
                </BlockStack>

                <Divider />

                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: "#2C6ECB" }} />
                    <Text variant="headingSm" as="h3">Collections ({collections.total})</Text>
                  </InlineStack>
                  <HBar label="SEO Title" value={collections.withSeoTitle} total={collections.total} color="#2C6ECB" />
                  <HBar label="SEO Description" value={collections.withSeoDesc} total={collections.total} color="#1A4FA0" />
                </BlockStack>

                <Divider />

                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: "#8456CD" }} />
                    <Text variant="headingSm" as="h3">Pages ({pages.total})</Text>
                  </InlineStack>
                  <HBar label="SEO Title" value={pages.withSeoTitle} total={pages.total} color="#8456CD" />
                  <HBar label="SEO Description" value={pages.withSeoDesc} total={pages.total} color="#6E42B8" />
                </BlockStack>

                <Divider />

                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: "#E07D10" }} />
                    <Text variant="headingSm" as="h3">Blog Articles ({articles.total})</Text>
                  </InlineStack>
                  <HBar label="SEO Title" value={articles.withSeoTitle} total={articles.total} color="#E07D10" />
                  <HBar label="SEO Description" value={articles.withSeoDesc} total={articles.total} color="#B06200" />
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Row 2: Per-type detail cards */}
        <Grid>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <StatTile title="Products" total={products.total} withSeoTitle={products.withSeoTitle} withSeoDesc={products.withSeoDesc} url="/app/products" color="#008060" />
          </Grid.Cell>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <StatTile title="Collections" total={collections.total} withSeoTitle={collections.withSeoTitle} withSeoDesc={collections.withSeoDesc} url="/app/collections" color="#2C6ECB" />
          </Grid.Cell>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <StatTile title="Pages" total={pages.total} withSeoTitle={pages.withSeoTitle} withSeoDesc={pages.withSeoDesc} url="/app/pages" color="#8456CD" />
          </Grid.Cell>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <StatTile title="Blog Articles" total={articles.total} withSeoTitle={articles.withSeoTitle} withSeoDesc={articles.withSeoDesc} url="/app/blog" color="#E07D10" />
          </Grid.Cell>
        </Grid>

        {/* Row 3: AI Generation stats + chart */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">AI Generations</Text>
                <BlockStack gap="100">
                  <Text variant="heading2xl" as="p">{totalGenerations}</Text>
                  <Text variant="bodySm" tone="subdued">Total all-time</Text>
                </BlockStack>
                <Divider />
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text variant="bodySm" as="span">This week</Text>
                    <Text variant="bodyMd" fontWeight="semibold" as="span">{weekGenerations}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodySm" as="span">Best single day</Text>
                    <Text variant="bodyMd" fontWeight="semibold" as="span">
                      {Math.max(...dailyActivity.map((d) => d.count), 0)}
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodySm" as="span">Active days (7d)</Text>
                    <Text variant="bodyMd" fontWeight="semibold" as="span">
                      {dailyActivity.filter((d) => d.count > 0).length} / 7
                    </Text>
                  </InlineStack>
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  <Button url="/app/products" size="slim" variant="secondary">Generate Products →</Button>
                  <Button url="/app/blog" size="slim" variant="secondary">Generate Blog →</Button>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">Generation Activity</Text>
                  <Text variant="bodySm" tone="subdued" as="span">Last 7 days</Text>
                </InlineStack>
                {weekGenerations === 0 ? (
                  <Box paddingBlockStart="400" paddingBlockEnd="400">
                    <InlineStack align="center">
                      <Text variant="bodyMd" tone="subdued">No generation activity this week.</Text>
                    </InlineStack>
                  </Box>
                ) : (
                  <ActivityChart data={dailyActivity} />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Row 4: Recent generations */}
        {recentLogs.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Recent AI Generations</Text>
              {recentLogs.map((log, i) => (
                <div key={log.id}>
                  {i > 0 && <Divider />}
                  <Box paddingBlockStart={i > 0 ? "300" : "0"}>
                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold" as="span">
                          {log.productTitle || "Untitled"}
                        </Text>
                        <Text variant="bodySm" tone="subdued" as="span">
                          {INTENT_LABEL[log.intent] || log.intent}
                          {log.language && log.language !== "en" ? ` · ${log.language.toUpperCase()}` : ""}
                          {log.aiModel ? ` · ${log.aiModel}` : ""}
                        </Text>
                      </BlockStack>
                      <InlineStack gap="200" blockAlign="center">
                        {log.appliedToProduct && <Badge tone="success">Applied</Badge>}
                        <Text variant="bodySm" tone="subdued" as="span">
                          {new Date(log.createdAt).toLocaleDateString("en", { month: "short", day: "numeric" })}
                        </Text>
                      </InlineStack>
                    </InlineStack>
                  </Box>
                </div>
              ))}
            </BlockStack>
          </Card>
        )}

      </BlockStack>
      <Box paddingBlockEnd="800" />
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
