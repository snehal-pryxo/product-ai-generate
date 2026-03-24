import { useState, useCallback } from "react";
import { useLoaderData, useSearchParams } from "react-router";
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
      edges { node { id title seo { title description } } }
    }
  }
`;

const COLLECTIONS_SEO_QUERY = `#graphql
  query CollectionsSEO($first: Int!) {
    collections(first: $first) {
      edges { node { id title description seo { title description } } }
    }
  }
`;

const PAGES_SEO_QUERY = `#graphql
  query PagesSEO($first: Int!) {
    pages(first: $first) {
      edges {
        node {
          id title
          metafields(first: 2, namespace: "global") { edges { node { key value } } }
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
          id title
          metafields(first: 2, namespace: "global") { edges { node { key value } } }
        }
      }
    }
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d) {
  return d.toISOString().split("T")[0];
}

function buildDailyMap(startDate, endDate) {
  const map = {};
  const cur = new Date(startDate + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");
  while (cur <= end) {
    map[toDateStr(cur)] = 0;
    cur.setDate(cur.getDate() + 1);
  }
  return map;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  // Parse date range from search params
  const rangeParam = url.searchParams.get("range") || "7";
  const customStart = url.searchParams.get("startDate");
  const customEnd = url.searchParams.get("endDate");

  let startDate, endDate, rangeLabel;
  const today = new Date();

  if (rangeParam === "custom" && customStart && customEnd) {
    startDate = customStart;
    endDate = customEnd;
    rangeLabel = "Custom Range";
  } else {
    const days = parseInt(rangeParam, 10) || 7;
    const start = new Date(today);
    start.setDate(today.getDate() - (days - 1));
    startDate = toDateStr(start);
    endDate = toDateStr(today);
    rangeLabel = `Last ${days} days`;
  }

  const startDateObj = new Date(startDate + "T00:00:00");
  const endDateObj = new Date(endDate + "T23:59:59");

  // Shopify GraphQL
  const [productsRes, collectionsRes, pagesRes, articlesRes] = await Promise.all([
    admin.graphql(PRODUCTS_SEO_QUERY, { variables: { first: 100 } }),
    admin.graphql(COLLECTIONS_SEO_QUERY, { variables: { first: 50 } }),
    admin.graphql(PAGES_SEO_QUERY, { variables: { first: 50 } }),
    admin.graphql(ARTICLES_SEO_QUERY, { variables: { first: 50 } }),
  ]);

  const [productsJson, collectionsJson, pagesJson, articlesJson] = await Promise.all([
    productsRes.json(), collectionsRes.json(), pagesRes.json(), articlesRes.json(),
  ]);

  const products = (productsJson.data?.products?.edges || []).map((e) => e.node);
  const productsWithSeoTitle = products.filter((p) => !!p.seo?.title).length;
  const productsWithSeoDesc = products.filter((p) => !!p.seo?.description).length;

  const collections = (collectionsJson.data?.collections?.edges || []).map((e) => e.node);
  const collectionsWithSeoTitle = collections.filter((c) => !!c.seo?.title).length;
  const collectionsWithSeoDesc = collections.filter((c) => !!c.seo?.description).length;
  const collectionsWithDesc = collections.filter((c) => !!c.description).length;

  const pages = (pagesJson.data?.pages?.edges || []).map((e) => {
    const mfs = (e.node.metafields?.edges || []).map((me) => me.node);
    return { id: e.node.id, title: e.node.title,
      hasSeoTitle: !!mfs.find((m) => m.key === "title_tag")?.value,
      hasSeoDesc: !!mfs.find((m) => m.key === "description_tag")?.value };
  });
  const pagesWithSeoTitle = pages.filter((p) => p.hasSeoTitle).length;
  const pagesWithSeoDesc = pages.filter((p) => p.hasSeoDesc).length;

  const articles = (articlesJson.data?.articles?.edges || []).map((e) => {
    const mfs = (e.node.metafields?.edges || []).map((me) => me.node);
    return { id: e.node.id, title: e.node.title,
      hasSeoTitle: !!mfs.find((m) => m.key === "title_tag")?.value,
      hasSeoDesc: !!mfs.find((m) => m.key === "description_tag")?.value };
  });
  const articlesWithSeoTitle = articles.filter((a) => a.hasSeoTitle).length;
  const articlesWithSeoDesc = articles.filter((a) => a.hasSeoDesc).length;

  const totalItems = products.length + collections.length + pages.length + articles.length;
  const totalWithSeo = productsWithSeoTitle + productsWithSeoDesc + collectionsWithSeoTitle +
    collectionsWithSeoDesc + pagesWithSeoTitle + pagesWithSeoDesc + articlesWithSeoTitle + articlesWithSeoDesc;
  const seoScore = totalItems > 0 ? Math.round((totalWithSeo / (totalItems * 2)) * 100) : 0;

  // DB logs
  const collectionLogCount = await db.collectionGeneratedContent
    .count({ where: { shop: session.shop } }).catch(() => 0);

  const [totalProductLogs, rangeLogs, recentLogs] = await Promise.all([
    db.generatedContentLog.count({ where: { shop: session.shop } }).catch(() => 0),
    db.generatedContentLog.findMany({
      where: { shop: session.shop, createdAt: { gte: startDateObj, lte: endDateObj } },
      select: { createdAt: true, intent: true, aiModel: true },
    }).catch(() => []),
    db.generatedContentLog.findMany({
      where: { shop: session.shop, createdAt: { gte: startDateObj, lte: endDateObj } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, productTitle: true, intent: true, aiModel: true, createdAt: true, appliedToProduct: true, language: true },
    }).catch(() => []),
  ]);

  // Build daily activity
  const dailyCounts = buildDailyMap(startDate, endDate);
  for (const log of rangeLogs) {
    const key = toDateStr(new Date(log.createdAt));
    if (key in dailyCounts) dailyCounts[key]++;
  }

  const dailyActivity = Object.entries(dailyCounts).map(([date, count]) => ({
    date,
    label: new Date(date + "T12:00:00").toLocaleDateString("en", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "/"),
    shortLabel: new Date(date + "T12:00:00").toLocaleDateString("en", { month: "short", day: "numeric" }),
    count,
  }));

  return {
    products: { total: products.length, withSeoTitle: productsWithSeoTitle, withSeoDesc: productsWithSeoDesc },
    collections: { total: collections.length, withSeoTitle: collectionsWithSeoTitle, withSeoDesc: collectionsWithSeoDesc, withDesc: collectionsWithDesc },
    pages: { total: pages.length, withSeoTitle: pagesWithSeoTitle, withSeoDesc: pagesWithSeoDesc },
    articles: { total: articles.length, withSeoTitle: articlesWithSeoTitle, withSeoDesc: articlesWithSeoDesc },
    seoScore,
    totalGenerations: totalProductLogs + collectionLogCount,
    rangeGenerations: rangeLogs.length,
    recentLogs: recentLogs.map((l) => ({ ...l, id: l.id.toString(), createdAt: l.createdAt.toISOString() })),
    dailyActivity,
    rangeParam,
    startDate,
    endDate,
    rangeLabel,
  };
};

// ─── SVG Area/Line Chart ──────────────────────────────────────────────────────

const CHART_H = 160;
const CHART_PAD_L = 44;
const CHART_PAD_R = 16;
const CHART_PAD_T = 28;
const CHART_PAD_B = 48;
const LINE_COLOR = "#2C6ECB";
const FILL_COLOR = "rgba(44,110,203,0.12)";

function AreaLineChart({ data, selectedDate, onDayClick }) {
  const n = data.length;
  if (n === 0) return null;

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  // Chart inner area width is dynamic; we compute per-point x based on index
  // We'll use viewBox 0 0 600 (CHART_PAD_T + CHART_H + CHART_PAD_B)
  const VW = 600;
  const VH = CHART_PAD_T + CHART_H + CHART_PAD_B;
  const plotW = VW - CHART_PAD_L - CHART_PAD_R;
  const plotH = CHART_H;

  const px = (i) => CHART_PAD_L + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const py = (count) => CHART_PAD_T + plotH - (maxCount > 0 ? (count / maxCount) * plotH : 0);

  // Build path strings
  const linePoints = data.map((d, i) => `${px(i)},${py(d.count)}`).join(" ");
  const areaPoints = [
    `${px(0)},${CHART_PAD_T + plotH}`,
    ...data.map((d, i) => `${px(i)},${py(d.count)}`),
    `${px(n - 1)},${CHART_PAD_T + plotH}`,
  ].join(" ");

  // Y-axis ticks
  const yTicks = [];
  const tickCount = Math.min(maxCount, 5);
  for (let t = 0; t <= tickCount; t++) {
    const val = Math.round((t / tickCount) * maxCount);
    const y = py(val);
    yTicks.push({ val, y });
  }

  // X-axis: show every Nth label so they don't overlap
  const maxLabels = Math.min(n, 8);
  const step = Math.max(1, Math.round(n / maxLabels));

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        style={{ width: "100%", minWidth: Math.max(VW, n * 48), height: VH }}
        preserveAspectRatio="none"
      >
        {/* Grid lines */}
        {yTicks.map(({ val, y }) => (
          <g key={val}>
            <line
              x1={CHART_PAD_L} y1={y}
              x2={VW - CHART_PAD_R} y2={y}
              stroke="#E4E5E7" strokeWidth="1" strokeDasharray={val === 0 ? "0" : "4 3"}
            />
            <text
              x={CHART_PAD_L - 6} y={y + 4}
              textAnchor="end" fontSize="10" fill="#6D7175"
            >{val}</text>
          </g>
        ))}

        {/* Area fill */}
        <polygon points={areaPoints} fill={FILL_COLOR} />

        {/* Line */}
        <polyline
          points={linePoints}
          fill="none"
          stroke={LINE_COLOR}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Data points + click targets */}
        {data.map((d, i) => {
          const x = px(i);
          const y = py(d.count);
          const isSelected = d.date === selectedDate;
          return (
            <g key={d.date} style={{ cursor: "pointer" }} onClick={() => onDayClick(d.date)}>
              {/* invisible wide click area */}
              <rect
                x={x - 18} y={CHART_PAD_T}
                width={36} height={plotH}
                fill={isSelected ? "rgba(44,110,203,0.08)" : "transparent"}
              />
              {/* dot */}
              <circle
                cx={x} cy={y} r={isSelected ? 6 : 4}
                fill={d.count > 0 ? LINE_COLOR : "#C4C4C4"}
                stroke="white" strokeWidth="2"
              />
              {/* count label above dot */}
              {d.count > 0 && (
                <text x={x} y={y - 10} textAnchor="middle" fontSize="10" fill={LINE_COLOR} fontWeight="600">
                  {d.count}
                </text>
              )}
            </g>
          );
        })}

        {/* X-axis labels */}
        {data.map((d, i) => {
          if (i % step !== 0 && i !== n - 1) return null;
          return (
            <text
              key={d.date}
              x={px(i)} y={CHART_PAD_T + plotH + 18}
              textAnchor="middle" fontSize="10" fill="#6D7175"
            >
              {d.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Date Range Picker ────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { label: "Last 7 days", value: "7" },
  { label: "Last 14 days", value: "14" },
  { label: "Last 30 days", value: "30" },
  { label: "Custom range", value: "custom" },
];

function DateRangePicker({ rangeParam, startDate, endDate }) {
  const [, setSearchParams] = useSearchParams();
  const [customStart, setCustomStart] = useState(startDate);
  const [customEnd, setCustomEnd] = useState(endDate);
  const [showCalendar, setShowCalendar] = useState(false);

  const currentLabel = RANGE_OPTIONS.find((o) => o.value === rangeParam)?.label || `Last ${rangeParam} days`;

  const applyRange = useCallback(
    (r, s, e) => {
      const params = new URLSearchParams();
      if (r === "custom") {
        params.set("range", "custom");
        params.set("startDate", s);
        params.set("endDate", e);
      } else {
        params.set("range", r);
      }
      setSearchParams(params);
      setShowCalendar(false);
    },
    [setSearchParams]
  );

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setShowCalendar((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          border: "1px solid #C9CCCF",
          borderRadius: 8,
          background: "white",
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 500,
          color: "#202223",
          whiteSpace: "nowrap",
        }}
      >
        <span>{currentLabel}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 4l4 4 4-4" stroke="#6D7175" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {showCalendar && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 999,
            background: "white",
            border: "1px solid #C9CCCF",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            minWidth: 300,
            padding: "12px 16px 16px",
          }}
        >
          {/* Preset list */}
          <BlockStack gap="100">
            {RANGE_OPTIONS.filter((o) => o.value !== "custom").map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => applyRange(opt.value, customStart, customEnd)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 6,
                  background: rangeParam === opt.value ? "#F2F7FE" : "transparent",
                  color: rangeParam === opt.value ? LINE_COLOR : "#202223",
                  fontWeight: rangeParam === opt.value ? 600 : 400,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}

            <div style={{ borderTop: "1px solid #E4E5E7", marginTop: 4, paddingTop: 10 }}>
              <Text variant="bodySm" tone="subdued" as="p">Custom range</Text>
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <input
                  type="date"
                  value={customStart}
                  max={customEnd}
                  onChange={(e) => setCustomStart(e.target.value)}
                  style={{
                    flex: 1, padding: "6px 8px", border: "1px solid #C9CCCF",
                    borderRadius: 6, fontSize: 13, color: "#202223", background: "white",
                  }}
                />
                <span style={{ color: "#6D7175" }}>→</span>
                <input
                  type="date"
                  value={customEnd}
                  min={customStart}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  style={{
                    flex: 1, padding: "6px 8px", border: "1px solid #C9CCCF",
                    borderRadius: 6, fontSize: 13, color: "#202223", background: "white",
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowCalendar(false)}
                  style={{
                    padding: "6px 14px", border: "1px solid #C9CCCF", borderRadius: 6,
                    background: "white", fontSize: 13, cursor: "pointer", color: "#202223",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => applyRange("custom", customStart, customEnd)}
                  disabled={!customStart || !customEnd}
                  style={{
                    padding: "6px 14px", border: "none", borderRadius: 6,
                    background: LINE_COLOR, color: "white", fontSize: 13,
                    cursor: !customStart || !customEnd ? "not-allowed" : "pointer",
                    fontWeight: 600, opacity: !customStart || !customEnd ? 0.5 : 1,
                  }}
                >
                  Apply
                </button>
              </div>
            </div>
          </BlockStack>
        </div>
      )}

      {/* Click-away overlay */}
      {showCalendar && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 998 }}
          onClick={() => setShowCalendar(false)}
        />
      )}
    </div>
  );
}

// ─── Other chart components ───────────────────────────────────────────────────

function DonutScore({ score }) {
  const r = 65;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 70 ? "#008060" : score >= 40 ? "#B98900" : "#C9201F";
  const label = score >= 70 ? "Good" : score >= 40 ? "Fair" : "Needs Work";
  const tone = score >= 70 ? "success" : score >= 40 ? "warning" : "critical";

  return (
    <BlockStack gap="300">
      <InlineStack align="center">
        <div style={{ position: "relative", width: 160, height: 160 }}>
          <svg viewBox="0 0 160 160" width="160" height="160">
            <circle cx="80" cy="80" r={r} fill="none" stroke="#E4E5E7" strokeWidth="16" />
            <circle
              cx="80" cy="80" r={r} fill="none" stroke={color} strokeWidth="16"
              strokeDasharray={circ} strokeDashoffset={offset}
              strokeLinecap="round" transform="rotate(-90 80 80)"
            />
          </svg>
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
            <div style={{ fontSize: 34, fontWeight: 700, color, lineHeight: 1 }}>{score}</div>
            <div style={{ fontSize: 12, color: "#6D7175", marginTop: 3 }}>/100</div>
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
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, minWidth: pct > 0 ? 4 : 0, transition: "width 0.4s ease" }} />
      </div>
    </BlockStack>
  );
}

function StatTile({ title, total, withSeoTitle, withSeoDesc, url, color, icon }) {
  const pct = total > 0 ? Math.round(((withSeoTitle + withSeoDesc) / (total * 2)) * 100) : 0;
  const tone = pct >= 70 ? "success" : pct >= 40 ? "warning" : total === 0 ? "info" : "critical";
  return (
    <Card>
      <div style={{ borderTop: `3px solid ${color}`, marginTop: "-16px", marginLeft: "-16px", marginRight: "-16px", paddingTop: "16px", paddingLeft: "16px", paddingRight: "16px" }}>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <span style={{ fontSize: 16 }}>{icon}</span>
              <Text variant="headingSm" as="h3">{title}</Text>
            </InlineStack>
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
          <Button url={url} size="slim" variant="secondary">Manage</Button>
        </BlockStack>
      </div>
    </Card>
  );
}

// ─── Day Detail Panel ─────────────────────────────────────────────────────────

function DayDetailPanel({ date, recentLogs }) {
  const logsForDay = recentLogs.filter(
    (l) => new Date(l.createdAt).toISOString().split("T")[0] === date
  );
  const displayDate = new Date(date + "T12:00:00").toLocaleDateString("en", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingSm" as="h3">{displayDate}</Text>
          <Badge tone={logsForDay.length > 0 ? "success" : "info"}>
            {logsForDay.length} generation{logsForDay.length !== 1 ? "s" : ""}
          </Badge>
        </InlineStack>
        {logsForDay.length === 0 ? (
          <Text variant="bodySm" tone="subdued">No AI generation activity on this day.</Text>
        ) : (
          <div style={{ borderRadius: 6, overflow: "hidden", border: "1px solid #E4E5E7" }}>
            {logsForDay.map((log, i) => (
              <div
                key={log.id}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 12px", background: i % 2 === 0 ? "#FAFAFA" : "white",
                  gap: 10, flexWrap: "wrap",
                }}
              >
                <Text variant="bodySm" fontWeight="semibold" as="span">
                  {log.productTitle || "Untitled"}
                </Text>
                <InlineStack gap="100" blockAlign="center">
                  <Badge>{log.intent?.replace(/_/g, " ")}</Badge>
                  {log.appliedToProduct && <Badge tone="success">Applied</Badge>}
                  <Text variant="bodySm" tone="subdued" as="span">
                    {new Date(log.createdAt).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </InlineStack>
              </div>
            ))}
          </div>
        )}
      </BlockStack>
    </Card>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

const INTENT_LABEL = {
  generate_description: "Product Description",
  generate_seo_title: "SEO Title",
  generate_seo_description: "SEO Description",
  generate_all: "Full Content",
};

export default function AnalyticsPage() {
  const {
    products, collections, pages, articles,
    seoScore, totalGenerations, rangeGenerations,
    recentLogs, dailyActivity,
    rangeParam, startDate, endDate, rangeLabel,
  } = useLoaderData();

  const [selectedDate, setSelectedDate] = useState(null);

  const handleDayClick = useCallback((date) => {
    setSelectedDate((prev) => (prev === date ? null : date));
  }, []);

  const actions = [
    products.total - products.withSeoTitle > 0 && { label: `${products.total - products.withSeoTitle} products missing SEO title`, url: "/app/products" },
    products.total - products.withSeoDesc > 0 && { label: `${products.total - products.withSeoDesc} products missing SEO description`, url: "/app/products" },
    collections.total - collections.withSeoTitle > 0 && { label: `${collections.total - collections.withSeoTitle} collections missing SEO title`, url: "/app/collections" },
    pages.total - pages.withSeoTitle > 0 && { label: `${pages.total - pages.withSeoTitle} pages missing SEO title`, url: "/app/pages" },
    articles.total - articles.withSeoTitle > 0 && { label: `${articles.total - articles.withSeoTitle} articles missing SEO title`, url: "/app/blog" },
  ].filter(Boolean);

  const storeTotal = products.total + collections.total + pages.total + articles.total;
  const coverageColor = seoScore >= 70 ? "#008060" : seoScore >= 40 ? "#B98900" : "#C9201F";
  const bestDay = Math.max(...dailyActivity.map((d) => d.count), 0);
  const activeDays = dailyActivity.filter((d) => d.count > 0).length;

  return (
    <Page
      title="SEO Analytics"
      subtitle="Track SEO health and AI content generation across your store"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="600">

        {/* Section 1 — KPI Summary Row */}
        <Grid>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="start">
                  <Text variant="bodySm" tone="subdued">Items across store</Text>
                  <div style={{ fontSize: 20 }}>📁</div>
                </InlineStack>
                <Text variant="heading2xl" as="p">{storeTotal}</Text>
                <Text variant="bodySm" as="p">Total Content</Text>
              </BlockStack>
            </Card>
          </Grid.Cell>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="start">
                  <Text variant="bodySm" tone="subdued">Average coverage</Text>
                  <div style={{ fontSize: 20 }}>🎯</div>
                </InlineStack>
                <Text variant="heading2xl" as="p">
                  <span style={{ color: coverageColor }}>{seoScore}%</span>
                </Text>
                <Text variant="bodySm" as="p">SEO Coverage</Text>
              </BlockStack>
            </Card>
          </Grid.Cell>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="start">
                  <Text variant="bodySm" tone="subdued">All-time total</Text>
                  <div style={{ fontSize: 20 }}>⚡</div>
                </InlineStack>
                <Text variant="heading2xl" as="p">{totalGenerations}</Text>
                <Text variant="bodySm" as="p">AI Generations</Text>
              </BlockStack>
            </Card>
          </Grid.Cell>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="start">
                  <Text variant="bodySm" tone="subdued">{rangeLabel}</Text>
                  <div style={{ fontSize: 20 }}>📅</div>
                </InlineStack>
                <Text variant="heading2xl" as="p">{rangeGenerations}</Text>
                <Text variant="bodySm" as="p">In Range</Text>
              </BlockStack>
            </Card>
          </Grid.Cell>
        </Grid>

        {/* Section 2 — Generation Activity Chart */}
        <Card>
          <BlockStack gap="400">
            {/* Header row */}
            <InlineStack align="space-between" blockAlign="center" wrap={false} gap="300">
              <BlockStack gap="100">
                <Text variant="headingMd" as="h2">Generation Activity</Text>
                <Text variant="bodySm" tone="subdued">
                  Click on any point to see day details
                </Text>
              </BlockStack>
              <DateRangePicker rangeParam={rangeParam} startDate={startDate} endDate={endDate} />
            </InlineStack>

            {/* Quick day-range buttons */}
            <InlineStack gap="200" wrap>
              {["7", "14", "30"].map((days) => {
                const isActive = rangeParam === days;
                return (
                  <a
                    key={days}
                    href={`?range=${days}`}
                    style={{
                      display: "inline-block",
                      padding: "4px 12px",
                      borderRadius: 20,
                      border: `1px solid ${isActive ? LINE_COLOR : "#C9CCCF"}`,
                      background: isActive ? LINE_COLOR : "white",
                      color: isActive ? "white" : "#202223",
                      fontSize: 13,
                      fontWeight: isActive ? 600 : 400,
                      textDecoration: "none",
                      cursor: "pointer",
                    }}
                  >
                    {days}d
                  </a>
                );
              })}
            </InlineStack>

            {/* Chart */}
            {rangeGenerations === 0 ? (
              <Box paddingBlockStart="600" paddingBlockEnd="600">
                <InlineStack align="center">
                  <BlockStack gap="200">
                    <InlineStack align="center">
                      <div style={{ fontSize: 36 }}>📭</div>
                    </InlineStack>
                    <Text variant="bodyMd" tone="subdued">No generation activity in this date range.</Text>
                  </BlockStack>
                </InlineStack>
              </Box>
            ) : (
              <BlockStack gap="300">
                <AreaLineChart
                  data={dailyActivity}
                  selectedDate={selectedDate}
                  onDayClick={handleDayClick}
                />
                {/* Legend */}
                <InlineStack gap="400" blockAlign="center">
                  <InlineStack gap="100" blockAlign="center">
                    <div style={{ width: 28, height: 3, background: LINE_COLOR, borderRadius: 2 }} />
                    <Text variant="bodySm" tone="subdued">AI Generations</Text>
                  </InlineStack>
                  <InlineStack gap="100" blockAlign="center">
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: LINE_COLOR, border: "2px solid white", boxShadow: "0 0 0 1px " + LINE_COLOR }} />
                    <Text variant="bodySm" tone="subdued">Click a point for details</Text>
                  </InlineStack>
                </InlineStack>
              </BlockStack>
            )}

            {/* Day detail panel */}
            {selectedDate && (
              <DayDetailPanel date={selectedDate} recentLogs={recentLogs} />
            )}
          </BlockStack>
        </Card>

        {/* Section 3 — SEO Score + Coverage */}
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
                  {actions.length === 0 ? (
                    <Text variant="bodySm" tone="success">All content has SEO data!</Text>
                  ) : (
                    actions.slice(0, 4).map((item, i) => (
                      <InlineStack key={i} gap="200" blockAlign="center" wrap={false}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#C9201F", flexShrink: 0 }} />
                        <Button variant="plain" url={item.url} size="slim">{item.label}</Button>
                      </InlineStack>
                    ))
                  )}
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

        {/* Section 4 — Per-type StatTiles */}
        <Grid>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <StatTile title="Products" total={products.total} withSeoTitle={products.withSeoTitle} withSeoDesc={products.withSeoDesc} url="/app/products" color="#008060" icon="📦" />
          </Grid.Cell>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <StatTile title="Collections" total={collections.total} withSeoTitle={collections.withSeoTitle} withSeoDesc={collections.withSeoDesc} url="/app/collections" color="#2C6ECB" icon="🗂️" />
          </Grid.Cell>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <StatTile title="Pages" total={pages.total} withSeoTitle={pages.withSeoTitle} withSeoDesc={pages.withSeoDesc} url="/app/pages" color="#8456CD" icon="📄" />
          </Grid.Cell>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
            <StatTile title="Blog Articles" total={articles.total} withSeoTitle={articles.withSeoTitle} withSeoDesc={articles.withSeoDesc} url="/app/blog" color="#E07D10" icon="✍️" />
          </Grid.Cell>
        </Grid>

        {/* Section 5 — AI Generation Stats */}
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
                    <Text variant="bodySm" as="span">{rangeLabel}</Text>
                    <Text variant="bodyMd" fontWeight="semibold" as="span">{rangeGenerations}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodySm" as="span">Best single day</Text>
                    <Text variant="bodyMd" fontWeight="semibold" as="span">{bestDay}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodySm" as="span">Active days</Text>
                    <Text variant="bodyMd" fontWeight="semibold" as="span">{activeDays} / {dailyActivity.length}</Text>
                  </InlineStack>
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  <Button url="/app/products" size="slim" variant="secondary">Generate Products</Button>
                  <Button url="/app/blog" size="slim" variant="secondary">Generate Blog</Button>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            {recentLogs.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Recent AI Generations</Text>
                  <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #E4E5E7" }}>
                    {recentLogs.map((log, i) => (
                      <div
                        key={log.id}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "10px 14px", background: i % 2 === 0 ? "#FAFAFA" : "white",
                          gap: 12, flexWrap: "wrap",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                          <Text variant="bodyMd" fontWeight="semibold" as="span">
                            {log.productTitle || "Untitled"}
                          </Text>
                          <Badge>{INTENT_LABEL[log.intent] || log.intent}</Badge>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          <Text variant="bodySm" tone="subdued" as="span">
                            {new Date(log.createdAt).toLocaleDateString("en", { month: "short", day: "numeric" })}
                          </Text>
                          {log.appliedToProduct && <Badge tone="success">Applied</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                </BlockStack>
              </Card>
            )}
          </Layout.Section>
        </Layout>

      </BlockStack>
      <Box paddingBlockEnd="800" />
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
