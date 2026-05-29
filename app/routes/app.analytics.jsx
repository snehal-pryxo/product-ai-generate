import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLoaderData, useSearchParams, useNavigate, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Divider, Box, Grid, Button, Layout, Icon, Select, Tabs,
} from "@shopify/polaris";
import { AppPageHeader } from "../components/AppPageHeader";
import {
  FolderIcon, TargetIcon, AutomationIcon, CalendarIcon,
  ProductIcon, CollectionIcon, PageIcon, BlogIcon,
} from "@shopify/polaris-icons";

// ─── GraphQL ──────────────────────────────────────────────────────────────────

const PRODUCTS_SEO_QUERY = `#graphql
  query ProductsSEO($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges { node { id title seo { title description } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const COLLECTIONS_SEO_QUERY = `#graphql
  query CollectionsSEO($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      edges { node { id title description seo { title description } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const PAGES_SEO_QUERY = `#graphql
  query PagesSEO($first: Int!, $after: String) {
    pages(first: $first, after: $after) {
      edges { node { id title metafields(first: 2, namespace: "global") { edges { node { key value } } } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const ARTICLES_SEO_QUERY = `#graphql
  query ArticlesSEO($first: Int!, $after: String) {
    articles(first: $first, after: $after) {
      edges { node { id title metafields(first: 2, namespace: "global") { edges { node { key value } } } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d) { return d.toISOString().split("T")[0]; }

function buildDailyMap(startDate, endDate) {
  const map = {};
  const cur = new Date(startDate + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");
  while (cur <= end) { map[toDateStr(cur)] = 0; cur.setDate(cur.getDate() + 1); }
  return map;
}

function normalizeResourceType(log) {
  const resourceType = String(log?.resourceType || "").toLowerCase();
  if (
    resourceType === "product" ||
    resourceType === "collection" ||
    resourceType === "collection_product" ||
    resourceType === "page" ||
    resourceType === "blog"
  ) {
    return resourceType;
  }

  const intent = String(log?.intent || "").toLowerCase();
  if (intent.includes("collection_product")) return "collection_product";
  if (intent.includes("collection")) return "collection";
  if (intent.includes("page")) return "page";
  if (intent.includes("blog") || intent.includes("article")) return "blog";
  return "product";
}

async function fetchAllConnectionNodes(admin, query, connectionName, pageSize = 250) {
  const nodes = [];
  let after = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(query, {
      variables: { first: pageSize, after },
    });
    const json = await response.json();
    const connection = json.data?.[connectionName];
    nodes.push(...(connection?.edges || []).map((edge) => edge.node));
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
  }

  return nodes;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const rangeParam = url.searchParams.get("range") || "7";
  const customStart = url.searchParams.get("startDate");
  const customEnd = url.searchParams.get("endDate");

  let startDate, endDate, rangeLabel;
  if (rangeParam === "custom" && customStart && customEnd) {
    startDate = customStart; endDate = customEnd; rangeLabel = "Custom Range";
  } else {
    const days = parseInt(rangeParam, 10) || 7;
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - (days - 1));
    startDate = toDateStr(start); endDate = toDateStr(today);
    rangeLabel = `Last ${days} days`;
  }

  const startDateObj = new Date(startDate + "T00:00:00");
  const endDateObj   = new Date(endDate   + "T23:59:59");

  const [products, collections, pageNodes, articleNodes] = await Promise.all([
    fetchAllConnectionNodes(admin, PRODUCTS_SEO_QUERY, "products"),
    fetchAllConnectionNodes(admin, COLLECTIONS_SEO_QUERY, "collections"),
    fetchAllConnectionNodes(admin, PAGES_SEO_QUERY, "pages"),
    fetchAllConnectionNodes(admin, ARTICLES_SEO_QUERY, "articles"),
  ]);

  const pages = pageNodes.map(node => {
    const mfs = (node.metafields?.edges || []).map(me => me.node);
    return { id: node.id, title: node.title,
      hasSeoTitle: !!mfs.find(m => m.key === "title_tag")?.value,
      hasSeoDesc:  !!mfs.find(m => m.key === "description_tag")?.value };
  });
  const articles = articleNodes.map(node => {
    const mfs = (node.metafields?.edges || []).map(me => me.node);
    return { id: node.id, title: node.title,
      hasSeoTitle: !!mfs.find(m => m.key === "title_tag")?.value,
      hasSeoDesc:  !!mfs.find(m => m.key === "description_tag")?.value };
  });

  const pw  = products.filter(p => !!p.seo?.title).length;
  const pwd = products.filter(p => !!p.seo?.description).length;
  const cw  = collections.filter(c => !!c.seo?.title).length;
  const cwd = collections.filter(c => !!c.seo?.description).length;
  const pgw = pages.filter(p => p.hasSeoTitle).length;
  const pgwd= pages.filter(p => p.hasSeoDesc).length;
  const aw  = articles.filter(a => a.hasSeoTitle).length;
  const awd = articles.filter(a => a.hasSeoDesc).length;

  const totalItems = products.length + collections.length + pages.length + articles.length;
  const totalWithSeo = pw + pwd + cw + cwd + pgw + pgwd + aw + awd;
  const seoScore = totalItems > 0 ? Math.round((totalWithSeo / (totalItems * 2)) * 100) : 0;

  const [shopCredits, totalLogs, allLogsAggregate, rangeLogsRaw, recentLogsRaw] = await Promise.all([
    db.shop.findUnique({
      where: { shop: session.shop },
      select: { credits: true, creditsUsedTotal: true },
    }).catch(() => null),
    db.generatedContentLog.count({ where: { shop: session.shop } }).catch(() => 0),
    db.generatedContentLog.aggregate({
      where: { shop: session.shop },
      _sum: { creditsUsed: true },
    }).catch(() => ({ _sum: { creditsUsed: 0 } })),
    db.generatedContentLog.findMany({
      where: { shop: session.shop, createdAt: { gte: startDateObj, lte: endDateObj } },
      select: {
        id: true,
        productTitle: true,
        intent: true,
        aiModel: true,
        createdAt: true,
        appliedToProduct: true,
        language: true,
        resourceType: true,
        creditsUsed: true,
      },
    }).catch(() => []),
    db.generatedContentLog.findMany({
      where: { shop: session.shop, createdAt: { gte: startDateObj, lte: endDateObj } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        productTitle: true,
        intent: true,
        aiModel: true,
        createdAt: true,
        appliedToProduct: true,
        language: true,
        resourceType: true,
        creditsUsed: true,
      },
    }).catch(() => []),
  ]);

  const rangeLogs = rangeLogsRaw.map((log) => ({
    ...log,
    resourceType: normalizeResourceType(log),
    creditsUsed: Number(log.creditsUsed || 0),
  }));
  const recentLogs = recentLogsRaw.map((log) => ({
    ...log,
    resourceType: normalizeResourceType(log),
    creditsUsed: Number(log.creditsUsed || 0),
  }));

  const dailyCounts  = buildDailyMap(startDate, endDate);
  const dailyApplied = buildDailyMap(startDate, endDate);
  const dailyCredits = buildDailyMap(startDate, endDate);
  const generationByResource = { product: 0, collection: 0, collection_product: 0, page: 0, blog: 0 };
  for (const log of rangeLogs) {
    const key = toDateStr(new Date(log.createdAt));
    if (key in dailyCounts) {
      dailyCounts[key]++;
      dailyCredits[key] = (dailyCredits[key] || 0) + Number(log.creditsUsed || 0);
      if (log.appliedToProduct) dailyApplied[key]++;
    }
    generationByResource[log.resourceType] = (generationByResource[log.resourceType] || 0) + 1;
  }

  const dailyActivity = Object.entries(dailyCounts).map(([date, count]) => ({
    date,
    count,
    applied: dailyApplied[date] || 0,
    creditsUsed: dailyCredits[date] || 0,
    label: new Date(date + "T12:00:00").toLocaleDateString("en-GB"),
  }));

  const creditsUsedInRange = rangeLogs.reduce((sum, log) => sum + Number(log.creditsUsed || 0), 0);
  const creditsUsedAllTime = Number(shopCredits?.creditsUsedTotal ?? allLogsAggregate?._sum?.creditsUsed ?? 0);
  const creditsBalance = Number(shopCredits?.credits ?? 150);

  return {
    products:    { total: products.length,    withSeoTitle: pw,  withSeoDesc: pwd },
    collections: { total: collections.length, withSeoTitle: cw,  withSeoDesc: cwd },
    pages:       { total: pages.length,       withSeoTitle: pgw, withSeoDesc: pgwd },
    articles:    { total: articles.length,    withSeoTitle: aw,  withSeoDesc: awd },
    seoScore,
    totalGenerations: totalLogs,
    rangeGenerations: rangeLogs.length,
    creditsBalance,
    creditsUsedAllTime,
    creditsUsedInRange,
    generationByResource,
    recentLogs: recentLogs.map(l => ({ ...l, id: l.id.toString(), createdAt: l.createdAt.toISOString() })),
    rangeLogs: rangeLogs.map(l => ({ ...l, id: l.id.toString(), createdAt: l.createdAt.toISOString() })),
    dailyActivity,
    rangeParam, startDate, endDate, rangeLabel,
  };
};

// ─── Constants ────────────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { label: "Last 7 days",  value: "7"      },
  { label: "Last 14 days", value: "14"     },
  { label: "Last 30 days", value: "30"     },
  { label: "Custom range", value: "custom" },
];

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES   = ["Su","Mo","Tu","We","Th","Fr","Sa"];
const RANGE_BG    = "#EEF2F8";

const S1_COLOR = "#2C6ECB";
const S1_FILL  = "rgba(44,110,203,0.13)";
const S2_COLOR = "#5C37A8";

// ─── CalendarMonth ────────────────────────────────────────────────────────────

const arrowBtn = {
  width: 28, height: 28, border: "1px solid #C9CCCF", borderRadius: 6,
  background: "white", cursor: "pointer", fontSize: 17, color: "#202223",
  display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0,
};

function CalendarMonth({ year, month, rangeStart, rangeEnd, hoverEnd, onDayClick, onDayHover, showLeft, onLeft, showRight, onRight }) {
  const firstDow = new Date(year, month, 1).getDay();
  const dim      = new Date(year, month + 1, 0).getDate();
  const cells    = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const pad = n => String(n).padStart(2, "0");
  const mkDs = d => !d ? null : `${year}-${pad(month + 1)}-${pad(d)}`;

  const effEnd = rangeEnd || hoverEnd;
  const lo = rangeStart && effEnd ? (rangeStart <= effEnd ? rangeStart : effEnd) : rangeStart;
  const hi = rangeStart && effEnd ? (rangeStart <= effEnd ? effEnd   : rangeStart) : null;

  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        {showLeft  ? <button onClick={onLeft}  style={arrowBtn}>‹</button> : <div style={{ width: 28 }} />}
        <span style={{ fontSize: 14, fontWeight: 700, color: "#202223" }}>{MONTH_NAMES[month]} {year}</span>
        {showRight ? <button onClick={onRight} style={arrowBtn}>›</button> : <div style={{ width: 28 }} />}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
        {DAY_NAMES.map(d => (
          <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "#8C9196", padding: "3px 0" }}>{d}</div>
        ))}
        {cells.map((day, idx) => {
          const ds      = mkDs(day);
          const isStart = !!(ds && ds === rangeStart);
          const isEnd   = !!(ds && ds === rangeEnd);
          const inRange = !!(ds && lo && hi && ds > lo && ds < hi);
          const isToday = ds === toDateStr(new Date());

          let cellBg = "transparent";
          if (day) {
            if      (isStart && rangeEnd)   cellBg = `linear-gradient(to right, transparent 50%, ${RANGE_BG} 50%)`;
            else if (isEnd   && rangeStart) cellBg = `linear-gradient(to left,  transparent 50%, ${RANGE_BG} 50%)`;
            else if (inRange)               cellBg = RANGE_BG;
          }
          const showCircle = isStart || isEnd;
          return (
            <div
              key={idx}
              style={{ background: cellBg, position: "relative", height: 34 }}
              onMouseEnter={() => day && onDayHover(ds)}
            >
              {day && (
                <button
                  type="button"
                  onClick={() => onDayClick(ds)}
                  style={{
                    position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                    width: 28, height: 28, borderRadius: "50%",
                    border: isToday && !showCircle ? "1px solid #C9CCCF" : "1px solid transparent",
                    background: showCircle ? "#1A1A1A" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: showCircle ? 700 : 400,
                    color: showCircle ? "white" : "#202223",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  {day}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DateRangePicker ──────────────────────────────────────────────────────────
// containerRef  — ref to the outer position:relative div (outside the Card)
// dropdown is portaled into that div so Card overflow:hidden doesn't clip it

function DateRangePicker({ rangeParam, startDate, endDate, containerRef }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState({ top: 0, right: 0 });
  const btnRef  = useRef(null);
  const dropRef = useRef(null);

  // Calculate button position relative to the container div (not viewport)
  useEffect(() => {
    if (!open || !btnRef.current || !containerRef?.current) return;
    const btn  = btnRef.current.getBoundingClientRect();
    const cont = containerRef.current.getBoundingClientRect();
    setOffset({
      top:   btn.bottom - cont.top + 6,
      right: cont.right - btn.right,
    });
  }, [open, containerRef]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        btnRef.current  && !btnRef.current.contains(e.target) &&
        dropRef.current && !dropRef.current.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const [calYear,  setCalYear]  = useState(() => new Date(startDate + "T12:00:00").getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date(startDate + "T12:00:00").getMonth());
  const [pickerStart, setPickerStart] = useState(startDate);
  const [pickerEnd,   setPickerEnd]   = useState(endDate);
  const [selecting,   setSelecting]   = useState(false);
  const [hoverDate,   setHoverDate]   = useState(null);
  const [preset, setPreset] = useState(rangeParam);

  const rightMonth = calMonth === 11 ? 0 : calMonth + 1;
  const rightYear  = calMonth === 11 ? calYear + 1 : calYear;

  const goPrev = () => { if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); } else setCalMonth(m => m - 1); };
  const goNext = () => { if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0);  } else setCalMonth(m => m + 1); };

  const handlePreset = (e) => {
    const val = e.target.value;
    setPreset(val);
    if (val !== "custom") {
      const days = parseInt(val);
      const en = new Date(); const st = new Date();
      st.setDate(en.getDate() - (days - 1));
      setPickerStart(toDateStr(st)); setPickerEnd(toDateStr(en));
      setCalYear(st.getFullYear()); setCalMonth(st.getMonth());
      setSelecting(false);
    }
  };

  const handleDayClick = (ds) => {
    if (!selecting || !pickerStart) {
      setPickerStart(ds); setPickerEnd(null); setSelecting(true); setPreset("custom");
    } else {
      if (ds < pickerStart) { setPickerEnd(pickerStart); setPickerStart(ds); }
      else                  { setPickerEnd(ds); }
      setSelecting(false);
    }
  };

  const handleApply = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("startDate");
    nextParams.delete("endDate");

    if (preset !== "custom") {
      nextParams.set("range", preset);
    } else {
      nextParams.set("range", "custom");
      nextParams.set("startDate", pickerStart);
      nextParams.set("endDate", pickerEnd || pickerStart);
    }
    setSearchParams(nextParams);
    setOpen(false);
  };

  const label = RANGE_OPTIONS.find(o => o.value === rangeParam)?.label || `Last ${rangeParam} days`;

  const dropdown = open ? (
    <div
      ref={dropRef}
      className="app-modal-dropdown"
      style={{
        position: "absolute",
        top: offset.top,
        right: offset.right,
        zIndex: 100,
        background: "white",
        border: "1px solid #C9CCCF",
        borderRadius: 6,
        boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
        padding: 16,
        width: "min(94vw, 580px)",
      }}
      onMouseLeave={() => setHoverDate(null)}
    >
      {/* Preset select */}
      <select
        value={preset}
        onChange={handlePreset}
        style={{
          width: "100%", padding: "9px 12px", marginBottom: 10,
          border: "1px solid #C9CCCF", borderRadius: 6, fontSize: 14,
          color: "#202223", background: "white",
        }}
      >
        {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {/* Date inputs */}
      <div className="app-modal-date-range-inputs" style={{ marginBottom: 14 }}>
        <input
          type="date" value={pickerStart}
          onChange={e => { setPickerStart(e.target.value); setPreset("custom"); }}
          style={{ flex: 1, padding: "8px 10px", border: "1px solid #C9CCCF", borderRadius: 6, fontSize: 13, color: "#202223", background: "white" }}
        />
        <span style={{ color: "#6D7175", fontSize: 18, flexShrink: 0 }}>→</span>
        <input
          type="date" value={pickerEnd || ""}
          onChange={e => { setPickerEnd(e.target.value); setPreset("custom"); }}
          style={{ flex: 1, padding: "8px 10px", border: "1px solid #C9CCCF", borderRadius: 6, fontSize: 13, color: "#202223", background: "white" }}
        />
      </div>

      {/* Two-month calendars */}
      <div className="app-modal-date-range-calendars" style={{ borderTop: "1px solid #E4E5E7", paddingTop: 14 }}>
        <CalendarMonth
          year={calYear} month={calMonth}
          rangeStart={pickerStart} rangeEnd={pickerEnd}
          hoverEnd={selecting ? hoverDate : null}
          onDayClick={handleDayClick} onDayHover={setHoverDate}
          showLeft onLeft={goPrev} showRight={false}
        />
        <div className="app-modal-calendar-divider" style={{ width: 1, background: "#E4E5E7", margin: "0 16px", flexShrink: 0 }} />
        <CalendarMonth
          year={rightYear} month={rightMonth}
          rangeStart={pickerStart} rangeEnd={pickerEnd}
          hoverEnd={selecting ? hoverDate : null}
          onDayClick={handleDayClick} onDayHover={setHoverDate}
          showLeft={false} showRight onRight={goNext}
        />
      </div>

      {/* Cancel / Apply */}
      <div className="app-modal-date-range-actions" style={{ gap: 8, marginTop: 14, borderTop: "1px solid #E4E5E7", paddingTop: 12 }}>
        <button
          type="button" onClick={() => setOpen(false)}
          style={{ padding: "7px 20px", border: "1px solid #C9CCCF", borderRadius: 6, background: "white", fontSize: 14, cursor: "pointer", color: "#202223", fontWeight: 500 }}
        >Cancel</button>
        <button
          type="button" onClick={handleApply} disabled={!pickerStart}
          style={{ padding: "7px 20px", border: "none", borderRadius: 6, background: "#1A1A1A", color: "white", fontSize: 14, cursor: "pointer", fontWeight: 700, opacity: !pickerStart ? 0.5 : 1 }}
        >Apply</button>
      </div>
    </div>
  ) : null;

  return (
    <>
      {/* Trigger button */}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "7px 14px", border: "1px solid #C9CCCF", borderRadius: 6,
          background: "white", cursor: "pointer", fontSize: 14, fontWeight: 500, color: "#202223",
          whiteSpace: "nowrap",
        }}
      >
        {label}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d={open ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} stroke="#6D7175" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Portal into outer wrapper — escapes Card overflow:hidden, scrolls with page */}
      {containerRef?.current && dropdown
        ? createPortal(dropdown, containerRef.current)
        : null}
    </>
  );
}

// ─── Area / Line Chart ────────────────────────────────────────────────────────

const CH = { vw: 800, vh: 220, pL: 44, pR: 18, pT: 18, pB: 36 };
const Y_TICKS = 2;

function AreaLineChart({ data, selectedDate, onDayClick }) {
  const n = data.length;
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const svgRef = useRef(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0, flipLeft: false, flipUp: false });

  if (!n) return null;

  const maxY  = Math.max(...data.map(d => d.count), 1);
  const plotW = CH.vw - CH.pL - CH.pR;
  const plotH = CH.vh - CH.pT - CH.pB;
  const baseY = CH.pT + plotH;

  const px = i => CH.pL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const py = v => CH.pT + plotH - (maxY > 0 ? (v / maxY) * plotH : 0);

  // 5 evenly-spaced grid lines (matches reference design)
  const yTicks = Array.from({ length: Y_TICKS }, (_, k) =>
    Math.round((k / (Y_TICKS - 1)) * maxY)
  );

  // X-axis — show up to 8 labels
  const xStep = Math.max(1, Math.ceil(n / 7));

  const pts1 = data.map((d, i) => `${px(i).toFixed(1)},${py(d.count).toFixed(1)}`).join(" ");
  const pts2 = data.map((d, i) => `${px(i).toFixed(1)},${py(d.applied).toFixed(1)}`).join(" ");
  const area = [
    `${px(0).toFixed(1)},${baseY}`,
    ...data.map((d, i) => `${px(i).toFixed(1)},${py(d.count).toFixed(1)}`),
    `${px(n - 1).toFixed(1)},${baseY}`,
  ].join(" ");

  const handleMouseEnter = (i) => {
    setHoveredIdx(i);
    if (svgRef.current) {
      const rect   = svgRef.current.getBoundingClientRect();
      const scaleX = rect.width  / CH.vw;
      const scaleY = rect.height / CH.vh;
      const dotX   = px(i) * scaleX;
      const dotY   = py(data[i].count) * scaleY;
      // flip tooltip upward when dot is in lower 40% of chart
      const flipUp   = dotY > rect.height * 0.6;
      const flipLeft = dotX > rect.width  * 0.62;
      setTooltipPos({ x: dotX, y: dotY, flipLeft, flipUp });
    }
  };

  const hoveredDay = hoveredIdx !== null ? data[hoveredIdx] : null;

  return (
    <div style={{ position: "relative" }}>
      {/* Chart wrapper — light background like reference */}
      <div className="analytics-chart-shell">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${CH.vw} ${CH.vh}`}
          style={{ width: "100%", height: "auto", display: "block" }}
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {/* Plot area background */}
          <rect
            x={CH.pL} y={CH.pT}
            width={CH.vw - CH.pL - CH.pR}
            height={CH.vh - CH.pT - CH.pB}
            fill="#ffffff"
            rx="4"
          />

          {/* Y-axis grid lines + labels */}
          {yTicks.map((v, ki) => {
            const y = py(v);
            return (
              <g key={ki}>
                <line x1={CH.pL} y1={y} x2={CH.vw - CH.pR} y2={y}
                  stroke={ki === 0 ? "var(--p-color-border-secondary)" : "var(--p-color-border)"} strokeWidth="1" />
                <text x={CH.pL - 8} y={y + 5} textAnchor="end" fontSize="7" fontWeight="600" fill="var(--p-color-text-secondary)">
                  {v}
                </text>
              </g>
            );
          })}

          {/* Area fill (series 1 — blue) */}
          <polygon points={area} fill={S1_FILL} />

          {/* Line series 1 — blue */}
          <polyline points={pts1} fill="none" stroke={S1_COLOR} strokeWidth="2.5"
            strokeLinejoin="round" strokeLinecap="round" />

          {/* Line series 2 — purple (flat at 0 when no applied data) */}
          <polyline points={pts2} fill="none" stroke={S2_COLOR} strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" />

          {/* Interactive hit areas + dots (dots only on hover/select) */}
          {data.map((d, i) => {
            const x     = px(i);
            const y1    = py(d.count);
            const y2    = py(d.applied);
            const isSel = d.date === selectedDate;
            const isHov = i === hoveredIdx;
            const active = isSel || isHov;
            return (
              <g
                key={d.date}
                style={{ cursor: "pointer" }}
                onClick={() => onDayClick(d.date)}
                onMouseEnter={() => handleMouseEnter(i)}
              >
                {/* Vertical dashed guideline */}
                {active && (
                  <line x1={x} y1={CH.pT} x2={x} y2={baseY}
                    stroke="var(--p-color-border-secondary)" strokeWidth="1" strokeDasharray="4 4" />
                )}
                {/* Wide invisible hover/click target */}
                <rect x={x - 22} y={CH.pT} width={44} height={plotH} fill="transparent" />
                {/* Series 1 dot — only when active or has data */}
                {(active || d.count > 0) && (
                  <circle cx={x} cy={y1} r={active ? 6 : 4}
                    fill={S1_COLOR} stroke="white" strokeWidth="2" />
                )}
                {/* Series 2 dot — only when active or has applied data */}
                {(active || d.applied > 0) && (
                  <circle cx={x} cy={y2} r={active ? 5 : 3.5}
                    fill={S2_COLOR} stroke="white" strokeWidth="2" />
                )}
              </g>
            );
          })}

          {/* X-axis baseline */}
          <line x1={CH.pL} y1={baseY} x2={CH.vw - CH.pR} y2={baseY}
            stroke="var(--p-color-border-secondary)" strokeWidth="1" />

          {/* X-axis date labels */}
          {data.map((d, i) => {
            if (i % xStep !== 0 && i !== n - 1) return null;
            return (
              <text key={d.date} x={px(i)} y={baseY + 16}
                textAnchor="middle" fontSize="7" fontWeight="500" fill="var(--p-color-text-secondary)">
                {d.label}
              </text>
            );
          })}
        </svg>

        {/* Hover tooltip — styled exactly like reference */}
        {hoveredDay && (
          <div
            className="analytics-chart-tooltip"
            style={{
              position: "absolute",
              ...(tooltipPos.flipUp
                ? { bottom: `calc(100% - ${tooltipPos.y}px + 10px)` }
                : { top: tooltipPos.y + 10 }),
              ...(tooltipPos.flipLeft
                ? { right: `calc(100% - ${tooltipPos.x}px + 16px)` }
                : { left: tooltipPos.x + 16 }),
              pointerEvents: "none",
              zIndex: 20,
              minWidth: 220,
            }}
          >
            {/* Date header */}
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--p-color-text)", marginBottom: 4 }}>
              {new Date(hoveredDay.date + "T12:00:00").toLocaleDateString("en-GB", {
                day: "2-digit", month: "2-digit", year: "numeric",
              })}
            </div>
            {/* Divider */}
            <div style={{ height: 1, background: "var(--p-color-border)", margin: "8px 0" }} />
            {/* Series rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 20, height: 2.5, background: S1_COLOR, borderRadius: 6, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "var(--p-color-text-secondary)" }}>AI Generations</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--p-color-text)" }}>{hoveredDay.count}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 20, height: 2.5, background: S2_COLOR, borderRadius: 6, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "var(--p-color-text-secondary)" }}>Applied to Product</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--p-color-text)" }}>{hoveredDay.applied}</span>
              </div>
            </div>
            {/* Click hint */}
            <div style={{ fontSize: 11, color: "var(--p-color-text-tertiary)", marginTop: 10 }}>
              Click to see day details
            </div>
          </div>
        )}
      </div>

      {/* Legend — bottom-right, bordered pill style matching reference */}
      <div className="analytics-chart-legend">
        {[
          { color: S1_COLOR, label: "AI Generations" },
          { color: S2_COLOR, label: "Applied to Product" },
        ].map(({ color, label }) => (
          <div key={label} className="analytics-chart-legend-item">
            <div style={{ width: 20, height: 2.5, background: color, borderRadius: 6, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "var(--p-color-text-secondary)", whiteSpace: "nowrap" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── DonutScore ───────────────────────────────────────────────────────────────

function DonutScore({ score }) {
  const r = 65; const circ = 2 * Math.PI * r;
  const color = score >= 70 ? "#008060" : score >= 40 ? "#B98900" : "#C9201F";
  const label = score >= 70 ? "Good" : score >= 40 ? "Fair" : "Needs Work";
  const tone  = score >= 70 ? "success" : score >= 40 ? "warning" : "critical";
  return (
    <BlockStack gap="300">
      <InlineStack align="center">
        <div style={{ position: "relative", width: 160, height: 160 }}>
          <svg viewBox="0 0 160 160" width="160" height="160">
            <circle cx="80" cy="80" r={r} fill="none" stroke="#E4E5E7" strokeWidth="16" />
            <circle cx="80" cy="80" r={r} fill="none" stroke={color} strokeWidth="16"
              strokeDasharray={circ} strokeDashoffset={circ - (score / 100) * circ}
              strokeLinecap="round" transform="rotate(-90 80 80)" />
          </svg>
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
            <div style={{ fontSize: 34, fontWeight: 700, color, lineHeight: 1 }}>{score}</div>
            <div style={{ fontSize: 12, color: "#6D7175", marginTop: 3 }}>/100</div>
          </div>
        </div>
      </InlineStack>
      <InlineStack align="center"><Badge tone={tone}>{label}</Badge></InlineStack>
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
      <div style={{ height: 8, background: "#F1F1F1", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 6, minWidth: pct > 0 ? 4 : 0, transition: "width 0.4s ease" }} />
      </div>
    </BlockStack>
  );
}

function StatTile({ title, total, withSeoTitle, withSeoDesc, onManage, color, icon }) {
  const pct  = total > 0 ? Math.round(((withSeoTitle + withSeoDesc) / (total * 2)) * 100) : 0;
  const tone = pct >= 70 ? "success" : pct >= 40 ? "warning" : total === 0 ? "info" : "critical";
  return (
    <Card>
      <div style={{ borderTop: `3px solid ${color}`, marginTop: "-16px", marginLeft: "-16px", marginRight: "-16px", paddingTop: "16px", paddingLeft: "16px", paddingRight: "16px" }}>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={icon} tone="subdued" />
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
            <HBar label="SEO Title"       value={withSeoTitle} total={total} color={color} />
            <HBar label="SEO Description" value={withSeoDesc}  total={total} color={color} />
          </BlockStack>
          <Button onClick={onManage} size="slim" variant="secondary">Manage</Button>
        </BlockStack>
      </div>
    </Card>
  );
}

function DayDetailPanel({ date, recentLogs }) {
  const logsForDay = recentLogs.filter(l => new Date(l.createdAt).toISOString().split("T")[0] === date);
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
              <div key={log.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: i % 2 === 0 ? "#FAFAFA" : "white", gap: 10, flexWrap: "wrap" }}>
                <Text variant="bodySm" fontWeight="semibold" as="span">{log.productTitle || "Untitled"}</Text>
                <InlineStack gap="100" blockAlign="center">
                  <Badge tone="info">{log.resourceType}</Badge>
                  <Badge>{log.intent?.replace(/_/g, " ")}</Badge>
                  <Badge tone="attention">{Number(log.creditsUsed || 0)} credits</Badge>
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

// ─── Page ─────────────────────────────────────────────────────────────────────

const INTENT_LABEL = {
  generate_description: "Product Description",
  generate_seo_title: "SEO Title",
  generate_seo_description: "SEO Description",
  generate_all: "Full Content",
  product_bulk_generate: "Product Bulk Generate",
  collection_bulk_generate: "Collection Bulk Generate",
  collection_product_bulk_generate: "Collection Product Bulk Generate",
  page_bulk_generate: "Page Bulk Generate",
  blog_bulk_generate: "Blog Bulk Generate",
  blog_create_article: "Create Blog Article",
  content_management_products: "Product Content",
  content_management_collections: "Collection Content",
  content_management_collection_products: "Collection Product Content",
  content_management_pages: "Page Content",
};

const RESOURCE_TABS = [
  { id: "all", content: "All" },
  { id: "product", content: "Product" },
  { id: "collection", content: "Collection" },
  { id: "collection_product", content: "Collection Product" },
  { id: "page", content: "Pages" },
  { id: "blog", content: "Blogs" },
];

const GENERATE_TYPE_OPTIONS_BY_RESOURCE = {
  all: [
    { label: "All Generate", value: "all" },
    { label: "Description", value: "description" },
    { label: "Content", value: "content" },
    { label: "Meta Title", value: "meta_title" },
    { label: "Meta Description", value: "meta_description" },
    { label: "FAQ", value: "faq" },
  ],
  product: [
    { label: "All Generate", value: "all" },
    { label: "Description", value: "description" },
    { label: "Meta Title", value: "meta_title" },
    { label: "Meta Description", value: "meta_description" },
    { label: "FAQ", value: "faq" },
  ],
  collection: [
    { label: "All Generate", value: "all" },
    { label: "Description", value: "description" },
    { label: "Meta Title", value: "meta_title" },
    { label: "Meta Description", value: "meta_description" },
  ],
  collection_product: [
    { label: "All Generate", value: "all" },
    { label: "Description", value: "description" },
    { label: "Meta Title", value: "meta_title" },
    { label: "Meta Description", value: "meta_description" },
    { label: "FAQ", value: "faq" },
  ],
  page: [
    { label: "All Generate", value: "all" },
    { label: "Content", value: "content" },
    { label: "Meta Title", value: "meta_title" },
    { label: "Meta Description", value: "meta_description" },
  ],
  blog: [
    { label: "All Generate", value: "all" },
    { label: "Content", value: "content" },
    { label: "Meta Title", value: "meta_title" },
    { label: "Meta Description", value: "meta_description" },
  ],
};

function matchesGenerateType(intentValue, generateType) {
  if (generateType === "all") return true;
  const intent = String(intentValue || "").toLowerCase();

  if (generateType === "meta_title") {
    return intent.includes("seo_title") || intent.includes("meta_title");
  }
  if (generateType === "meta_description") {
    return intent.includes("seo_description") || intent.includes("meta_description");
  }
  if (generateType === "description") {
    return intent.includes("generate_description");
  }
  if (generateType === "faq") {
    return intent.includes("faq");
  }
  if (generateType === "content") {
    return (
      intent.includes("generate_all") ||
      intent.includes("bulk_generate") ||
      intent.includes("create_article") ||
      intent.includes("content_management")
    );
  }
  return true;
}

export default function AnalyticsPage() {
  const {
    products, collections, pages, articles,
    seoScore, totalGenerations, rangeGenerations,
    creditsBalance, creditsUsedAllTime, creditsUsedInRange, generationByResource,
    recentLogs, rangeLogs, dailyActivity,
    rangeParam, startDate, endDate, rangeLabel,
  } = useLoaderData();

  const navigate = useNavigate();
  const location = useLocation();
  const [selectedDate, setSelectedDate] = useState(null);
  const [resourceFilter, setResourceFilter] = useState("all");
  const [generateTypeFilter, setGenerateTypeFilter] = useState("all");
  const handleDayClick = useCallback(date => setSelectedDate(p => p === date ? null : date), []);
  const activityRef = useRef(null);
  const generateTypeOptions = useMemo(
    () => GENERATE_TYPE_OPTIONS_BY_RESOURCE[resourceFilter] || GENERATE_TYPE_OPTIONS_BY_RESOURCE.all,
    [resourceFilter],
  );

  useEffect(() => {
    if (generateTypeOptions.some((option) => option.value === generateTypeFilter)) return;
    setGenerateTypeFilter("all");
  }, [generateTypeFilter, generateTypeOptions]);

  const filteredRangeLogs = useMemo(() => {
    return rangeLogs.filter((log) => {
      const resourceOk = resourceFilter === "all" ? true : log.resourceType === resourceFilter;
      const typeOk = matchesGenerateType(log.intent, generateTypeFilter);
      return resourceOk && typeOk;
    });
  }, [generateTypeFilter, rangeLogs, resourceFilter]);

  const filteredDailyActivity = useMemo(() => {
    const counts = buildDailyMap(startDate, endDate);
    const applied = buildDailyMap(startDate, endDate);
    const credits = buildDailyMap(startDate, endDate);
    for (const log of filteredRangeLogs) {
      const key = toDateStr(new Date(log.createdAt));
      if (!(key in counts)) continue;
      counts[key] += 1;
      credits[key] = (credits[key] || 0) + Number(log.creditsUsed || 0);
      if (log.appliedToProduct) applied[key] += 1;
    }
    return Object.entries(counts).map(([date, count]) => ({
      date,
      count,
      applied: applied[date] || 0,
      creditsUsed: credits[date] || 0,
      label: new Date(date + "T12:00:00").toLocaleDateString("en-GB"),
    }));
  }, [endDate, filteredRangeLogs, startDate]);

  const filteredGenerationByResource = useMemo(() => {
    const resourceMap = { product: 0, collection: 0, collection_product: 0, page: 0, blog: 0 };
    for (const log of filteredRangeLogs) {
      resourceMap[log.resourceType] = (resourceMap[log.resourceType] || 0) + 1;
    }
    return resourceMap;
  }, [filteredRangeLogs]);

  const filteredCreditsUsedInRange = useMemo(
    () => filteredRangeLogs.reduce((sum, log) => sum + Number(log.creditsUsed || 0), 0),
    [filteredRangeLogs],
  );

  const filteredRecentLogs = useMemo(
    () => [...filteredRangeLogs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10),
    [filteredRangeLogs],
  );

  const actions = [
    products.total    - products.withSeoTitle    > 0 && { label: `${products.total    - products.withSeoTitle} products missing SEO title`,    url: "/app/products"    },
    products.total    - products.withSeoDesc     > 0 && { label: `${products.total    - products.withSeoDesc} products missing SEO description`, url: "/app/products"    },
    collections.total - collections.withSeoTitle > 0 && { label: `${collections.total - collections.withSeoTitle} collections missing SEO title`, url: "/app/collections" },
    pages.total       - pages.withSeoTitle       > 0 && { label: `${pages.total       - pages.withSeoTitle} pages missing SEO title`,            url: "/app/pages"       },
    articles.total    - articles.withSeoTitle    > 0 && { label: `${articles.total    - articles.withSeoTitle} articles missing SEO title`,       url: "/app/blog"        },
  ].filter(Boolean);

  const storeTotal   = products.total + collections.total + pages.total + articles.total;
  const coverageColor = seoScore >= 70 ? "#008060" : seoScore >= 40 ? "#B98900" : "#C9201F";
  const bestDay      = Math.max(...filteredDailyActivity.map(d => d.count), 0);
  const activeDays   = filteredDailyActivity.filter(d => d.count > 0).length;
  const navigateInApp = useCallback((pathname) => {
    navigate({ pathname, search: location.search });
  }, [location.search, navigate]);
  const selectedResourceTabIndex = Math.max(
    RESOURCE_TABS.findIndex((tab) => tab.id === resourceFilter),
    0,
  );
  const handleResourceTabChange = useCallback((selectedTabIndex) => {
    const nextTab = RESOURCE_TABS[selectedTabIndex];
    if (!nextTab) return;
    setResourceFilter(nextTab.id);
    setSelectedDate(null);
  }, []);

  return (
    <Page
      fullWidth
      title="SEO Analytics"
      subtitle="Track SEO health and AI content generation across your store"
      backAction={{ content: "Dashboard", onAction: () => navigateInApp("/app") }}
    >
      <BlockStack gap="600">
        <AppPageHeader
          title="SEO Analytics"
          description="Track SEO health and AI content generation across your store."
        />

        {/* KPI Summary Strip */}
        <Grid>
          {[
            { icon: FolderIcon,   label: "Total Content",  val: storeTotal,     sub: "Items across store",  color: null },
            { icon: TargetIcon,   label: "SEO Coverage",   val: seoScore + "%", sub: "Average coverage",    color: coverageColor },
            { icon: AutomationIcon, label: "AI Generations", val: totalGenerations, sub: "All-time total",  color: null },
            { icon: CalendarIcon, label: "Credits Left",   val: creditsBalance, sub: rangeLabel,            color: null },
          ].map(({ icon, label, val, sub, color }) => (
            <Grid.Cell key={label} columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="start">
                    <Text variant="bodySm" tone="subdued">{sub}</Text>
                    <Icon source={icon} tone="subdued" />
                  </InlineStack>
                  <Text variant="heading2xl" as="p">
                    {color ? <span style={{ color }}>{val}</span> : val}
                  </Text>
                  <Text variant="bodySm" as="p">{label}</Text>
                </BlockStack>
              </Card>
            </Grid.Cell>
          ))}
        </Grid>

        {/* Generation Activity Chart */}
        <div ref={activityRef} style={{ position: "relative" }}>
        <Card>
          <BlockStack gap="400">
            {/* Header */}
            <InlineStack align="space-between" blockAlign="center" wrap={false} gap="300">
              <BlockStack gap="100">
                <Text variant="headingMd" as="h2">Generation Activity</Text>
                <Text variant="bodySm" tone="subdued">Click a data point to see day details</Text>
              </BlockStack>
            </InlineStack>

            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div className="analytics-resource-tabs" aria-label="Generation resource filter">
                <Tabs
                  tabs={RESOURCE_TABS}
                  selected={selectedResourceTabIndex}
                  onSelect={handleResourceTabChange}
                />
              </div>

              <div style={{ minWidth: 220, flex: "1 1 260px", maxWidth: 320 }}>
                <Select
                  label="Specific generate filter"
                  options={generateTypeOptions}
                  value={generateTypeFilter}
                  onChange={(value) => {
                    setGenerateTypeFilter(value);
                    setSelectedDate(null);
                  }}
                />
              </div>

              <DateRangePicker rangeParam={rangeParam} startDate={startDate} endDate={endDate} containerRef={activityRef} />
            </div>

            {/* Chart — always shown with dates, flat line when no activity */}
            <AreaLineChart data={filteredDailyActivity} selectedDate={selectedDate} onDayClick={handleDayClick} />

            {/* Day detail */}
            {selectedDate && <DayDetailPanel date={selectedDate} recentLogs={filteredRangeLogs} />}
          </BlockStack>
        </Card>
        </div>

        {/* SEO Score + Coverage */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Overall SEO Score</Text>
                <Text variant="bodySm" tone="subdued">Based on SEO title &amp; description coverage across all content types.</Text>
                <InlineStack align="center"><DonutScore score={seoScore} /></InlineStack>
                <Divider />
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h3">Fix Missing SEO</Text>
                  {actions.length === 0 ? (
                    <Text variant="bodySm" tone="success">All content has SEO data!</Text>
                  ) : actions.slice(0, 4).map((item, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px", borderRadius: "6px", border: "1px solid #e4e5e7", background: "#ffffff", cursor: "pointer" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#C9201F", flexShrink: 0 }} />
                      <a
                        href={`${item.url}${location.search}`}
                        onClick={(event) => {
                          event.preventDefault();
                          navigateInApp(item.url);
                        }}
                        style={{ fontSize: "14px", fontWeight: 500, color: "#1a1a1a", textDecoration: "none", flex: 1 }}
                      >
                        {item.label}
                      </a>
                    </div>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <Text variant="headingMd" as="h2">SEO Coverage by Content Type</Text>
                {[
                  { label: "Products",      total: products.total,    st: products.withSeoTitle,    sd: products.withSeoDesc,    c1: "#008060", c2: "#006E52" },
                  { label: "Collections",   total: collections.total, st: collections.withSeoTitle, sd: collections.withSeoDesc, c1: "#2C6ECB", c2: "#1A4FA0" },
                  { label: "Pages",         total: pages.total,       st: pages.withSeoTitle,       sd: pages.withSeoDesc,       c1: "#8456CD", c2: "#6E42B8" },
                  { label: "Blog Articles", total: articles.total,    st: articles.withSeoTitle,    sd: articles.withSeoDesc,    c1: "#E07D10", c2: "#B06200" },
                ].map(({ label, total, st, sd, c1, c2 }, i) => (
                  <div key={label}>
                    {i > 0 && <Divider />}
                    <BlockStack gap="300">
                      <InlineStack gap="200" blockAlign="center">
                        <div style={{ width: 12, height: 12, borderRadius: 6, background: c1 }} />
                        <Text variant="headingSm" as="h3">{label} ({total})</Text>
                      </InlineStack>
                      <HBar label="SEO Title"       value={st} total={total} color={c1} />
                      <HBar label="SEO Description" value={sd} total={total} color={c2} />
                    </BlockStack>
                  </div>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Per-type StatTiles */}
        <Grid>
          {[
            { title: "Products",      total: products.total,    wt: products.withSeoTitle,    wd: products.withSeoDesc,    url: "/app/products",    color: "#008060", icon: ProductIcon    },
            { title: "Collections",   total: collections.total, wt: collections.withSeoTitle, wd: collections.withSeoDesc, url: "/app/collections", color: "#2C6ECB", icon: CollectionIcon },
            { title: "Pages",         total: pages.total,       wt: pages.withSeoTitle,       wd: pages.withSeoDesc,       url: "/app/pages",       color: "#8456CD", icon: PageIcon       },
            { title: "Blog Articles", total: articles.total,    wt: articles.withSeoTitle,    wd: articles.withSeoDesc,    url: "/app/blog",        color: "#E07D10", icon: BlogIcon       },
          ].map(({ title, total, wt, wd, url, color, icon }) => (
            <Grid.Cell key={title} columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
              <StatTile title={title} total={total} withSeoTitle={wt} withSeoDesc={wd} onManage={() => navigateInApp(url)} color={color} icon={icon} />
            </Grid.Cell>
          ))}
        </Grid>

        {/* AI Generation Stats + Recent */}
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
                  {[
                    { label: rangeLabel,         val: filteredRangeLogs.length },
                    { label: `${rangeLabel} credits`, val: filteredCreditsUsedInRange },
                    { label: "All-time credits", val: creditsUsedAllTime },
                    { label: "Credits left",     val: creditsBalance },
                    { label: "Best single day",  val: bestDay },
                    { label: "Active days",      val: `${activeDays} / ${filteredDailyActivity.length}` },
                  ].map(({ label, val }) => (
                    <InlineStack key={label} align="space-between">
                      <Text variant="bodySm" as="span">{label}</Text>
                      <Text variant="bodyMd" fontWeight="semibold" as="span">{val}</Text>
                    </InlineStack>
                  ))}
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  {[
                    { label: "Products", val: filteredGenerationByResource.product || 0 },
                    { label: "Collections", val: filteredGenerationByResource.collection || 0 },
                    { label: "Collection Products", val: filteredGenerationByResource.collection_product || 0 },
                    { label: "Pages", val: filteredGenerationByResource.page || 0 },
                    { label: "Blogs", val: filteredGenerationByResource.blog || 0 },
                  ].map(({ label, val }) => (
                    <InlineStack key={label} align="space-between">
                      <Text variant="bodySm" tone="subdued" as="span">{label}</Text>
                      <Text variant="bodySm" fontWeight="semibold" as="span">{val}</Text>
                    </InlineStack>
                  ))}
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  <Button onClick={() => navigateInApp("/app/products")} size="slim" variant="secondary">Generate Products</Button>
                  <Button onClick={() => navigateInApp("/app/blog")}     size="slim" variant="secondary">Generate Blog</Button>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            {filteredRecentLogs.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Recent AI Generations</Text>
                  <div style={{ borderRadius: 6, overflow: "hidden", border: "1px solid #E4E5E7" }}>
                    {filteredRecentLogs.map((log, i) => (
                      <div key={log.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: i % 2 === 0 ? "#FAFAFA" : "white", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                          <Text variant="bodyMd" fontWeight="semibold" as="span">{log.productTitle || "Untitled"}</Text>
                          <Badge tone="info">{log.resourceType}</Badge>
                          <Badge>{INTENT_LABEL[log.intent] || log.intent}</Badge>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          <Badge tone="attention">{Number(log.creditsUsed || 0)} credits</Badge>
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
      <style>{`
        .analytics-resource-tabs {
          max-width: 100%;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .analytics-resource-tabs::-webkit-scrollbar {
          display: none;
        }
        .analytics-resource-tabs .Polaris-Tabs {
          display: inline-flex;
          width: auto;
          min-width: max-content;
          border: 1px solid #d1d5db;
          border-radius: 12px;
          background: #f3f4f6;
          padding: 3px;
        }
        .analytics-resource-tabs .Polaris-Tabs__Wrapper {
          padding: 0 !important;
        }
        .analytics-resource-tabs .Polaris-Tabs__Outer,
        .analytics-resource-tabs .Polaris-Tabs__Wrapper,
        .analytics-resource-tabs .Polaris-Tabs__TabContainer {
          margin: 0;
        }
        .analytics-resource-tabs .Polaris-Tabs__Tab {
          min-height: 34px;
          border-radius: 9px;
          padding: 0 12px;
        }
        .analytics-resource-tabs .Polaris-Tabs__Title {
          font-size: 13px;
          font-weight: 600;
          color: #4b5563;
        }
        .analytics-resource-tabs .Polaris-Tabs__Tab--active,
        .analytics-resource-tabs .Polaris-Tabs__Tab--active:hover,
        .analytics-resource-tabs .Polaris-Tabs__Tab--active:focus {
          background: #ffffff;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
        }
        .analytics-resource-tabs .Polaris-Tabs__Tab--active .Polaris-Tabs__Title {
          color: #111827;
        }
        @media (max-width: 640px) {
          .analytics-resource-tabs {
            width: 100%;
          }
          .analytics-resource-tabs .Polaris-Tabs {
            width: 100%;
            min-width: 0;
          }
          .analytics-resource-tabs .Polaris-Tabs__Wrapper {
            width: 100%;
          }
          .analytics-resource-tabs .Polaris-Tabs__Tab {
            padding: 0 10px;
          }
        }
      `}</style>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

