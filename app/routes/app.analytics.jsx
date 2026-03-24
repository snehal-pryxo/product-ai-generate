import { useState, useCallback, useRef, useEffect } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Divider, Box, Grid, Button, Layout, Icon,
} from "@shopify/polaris";
import {
  FolderIcon, TargetIcon, AutomationIcon, CalendarIcon,
  ProductIcon, CollectionIcon, PageIcon, BlogIcon,
  ChartLineIcon,
} from "@shopify/polaris-icons";

// ─── GraphQL ──────────────────────────────────────────────────────────────────

const PRODUCTS_SEO_QUERY = `#graphql
  query ProductsSEO($first: Int!) {
    products(first: $first) { edges { node { id title seo { title description } } } }
  }`;

const COLLECTIONS_SEO_QUERY = `#graphql
  query CollectionsSEO($first: Int!) {
    collections(first: $first) { edges { node { id title description seo { title description } } } }
  }`;

const PAGES_SEO_QUERY = `#graphql
  query PagesSEO($first: Int!) {
    pages(first: $first) {
      edges { node { id title metafields(first: 2, namespace: "global") { edges { node { key value } } } } }
    }
  }`;

const ARTICLES_SEO_QUERY = `#graphql
  query ArticlesSEO($first: Int!) {
    articles(first: $first) {
      edges { node { id title metafields(first: 2, namespace: "global") { edges { node { key value } } } } }
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

  const [productsRes, collectionsRes, pagesRes, articlesRes] = await Promise.all([
    admin.graphql(PRODUCTS_SEO_QUERY,    { variables: { first: 100 } }),
    admin.graphql(COLLECTIONS_SEO_QUERY, { variables: { first: 50  } }),
    admin.graphql(PAGES_SEO_QUERY,       { variables: { first: 50  } }),
    admin.graphql(ARTICLES_SEO_QUERY,    { variables: { first: 50  } }),
  ]);
  const [pj, cj, pgj, aj] = await Promise.all([
    productsRes.json(), collectionsRes.json(), pagesRes.json(), articlesRes.json(),
  ]);

  const products    = (pj.data?.products?.edges    || []).map(e => e.node);
  const collections = (cj.data?.collections?.edges || []).map(e => e.node);
  const pages = (pgj.data?.pages?.edges || []).map(e => {
    const mfs = (e.node.metafields?.edges || []).map(me => me.node);
    return { id: e.node.id, title: e.node.title,
      hasSeoTitle: !!mfs.find(m => m.key === "title_tag")?.value,
      hasSeoDesc:  !!mfs.find(m => m.key === "description_tag")?.value };
  });
  const articles = (aj.data?.articles?.edges || []).map(e => {
    const mfs = (e.node.metafields?.edges || []).map(me => me.node);
    return { id: e.node.id, title: e.node.title,
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

  const collectionLogCount = await db.collectionGeneratedContent
    .count({ where: { shop: session.shop } }).catch(() => 0);

  const [totalProductLogs, rangeLogs, recentLogs] = await Promise.all([
    db.generatedContentLog.count({ where: { shop: session.shop } }).catch(() => 0),
    db.generatedContentLog.findMany({
      where: { shop: session.shop, createdAt: { gte: startDateObj, lte: endDateObj } },
      select: { createdAt: true, appliedToProduct: true },
    }).catch(() => []),
    db.generatedContentLog.findMany({
      where: { shop: session.shop, createdAt: { gte: startDateObj, lte: endDateObj } },
      orderBy: { createdAt: "desc" }, take: 10,
      select: { id: true, productTitle: true, intent: true, aiModel: true, createdAt: true, appliedToProduct: true, language: true },
    }).catch(() => []),
  ]);

  const dailyCounts  = buildDailyMap(startDate, endDate);
  const dailyApplied = buildDailyMap(startDate, endDate);
  for (const log of rangeLogs) {
    const key = toDateStr(new Date(log.createdAt));
    if (key in dailyCounts) {
      dailyCounts[key]++;
      if (log.appliedToProduct) dailyApplied[key]++;
    }
  }

  const dailyActivity = Object.entries(dailyCounts).map(([date, count]) => ({
    date, count, applied: dailyApplied[date] || 0,
    label: new Date(date + "T12:00:00").toLocaleDateString("en-GB"),
  }));

  return {
    products:    { total: products.length,    withSeoTitle: pw,  withSeoDesc: pwd },
    collections: { total: collections.length, withSeoTitle: cw,  withSeoDesc: cwd },
    pages:       { total: pages.length,       withSeoTitle: pgw, withSeoDesc: pgwd },
    articles:    { total: articles.length,    withSeoTitle: aw,  withSeoDesc: awd },
    seoScore,
    totalGenerations: totalProductLogs + collectionLogCount,
    rangeGenerations: rangeLogs.length,
    recentLogs: recentLogs.map(l => ({ ...l, id: l.id.toString(), createdAt: l.createdAt.toISOString() })),
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
              style={{ background: cellBg, position: "relative", height: 34, cursor: day ? "pointer" : "default" }}
              onClick={() => day && onDayClick(ds)}
              onMouseEnter={() => day && onDayHover(ds)}
            >
              {day && (
                <div style={{
                  position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                  width: 28, height: 28, borderRadius: "50%",
                  background: showCircle ? "#1A1A1A" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: showCircle ? 700 : 400,
                  color: showCircle ? "white" : "#202223",
                  ...(isToday && !showCircle ? { border: "1px solid #C9CCCF" } : {}),
                }}>{day}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DateRangePicker ──────────────────────────────────────────────────────────

function DateRangePicker({ rangeParam, startDate, endDate }) {
  const [, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Close on outside click — no fixed overlay needed
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
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
    if (preset !== "custom") {
      setSearchParams({ range: preset });
    } else {
      const p = new URLSearchParams();
      p.set("range", "custom");
      p.set("startDate", pickerStart);
      p.set("endDate", pickerEnd || pickerStart);
      setSearchParams(p);
    }
    setOpen(false);
  };

  const label = RANGE_OPTIONS.find(o => o.value === rangeParam)?.label || `Last ${rangeParam} days`;

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "7px 14px", border: "1px solid #C9CCCF", borderRadius: 8,
          background: "white", cursor: "pointer", fontSize: 14, fontWeight: 500, color: "#202223",
          whiteSpace: "nowrap",
        }}
      >
        {label}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d={open ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} stroke="#6D7175" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown — position: absolute, no fixed overlay */}
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0,
            zIndex: 400,
            background: "white",
            border: "1px solid #C9CCCF",
            borderRadius: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
            padding: 16,
            minWidth: 580,
          }}
          onMouseLeave={() => setHoverDate(null)}
        >
          {/* Preset select */}
          <select
            value={preset}
            onChange={handlePreset}
            style={{
              width: "100%", padding: "9px 12px", marginBottom: 10,
              border: "1px solid #C9CCCF", borderRadius: 8, fontSize: 14,
              color: "#202223", background: "white",
            }}
          >
            {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          {/* Date inputs */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <input
              type="date" value={pickerStart}
              onChange={e => { setPickerStart(e.target.value); setPreset("custom"); }}
              style={{ flex: 1, padding: "8px 10px", border: "1px solid #C9CCCF", borderRadius: 8, fontSize: 13, color: "#202223", background: "white" }}
            />
            <span style={{ color: "#6D7175", fontSize: 18, flexShrink: 0 }}>→</span>
            <input
              type="date" value={pickerEnd || ""}
              onChange={e => { setPickerEnd(e.target.value); setPreset("custom"); }}
              style={{ flex: 1, padding: "8px 10px", border: "1px solid #C9CCCF", borderRadius: 8, fontSize: 13, color: "#202223", background: "white" }}
            />
          </div>

          {/* Two-month calendars */}
          <div style={{ display: "flex", borderTop: "1px solid #E4E5E7", paddingTop: 14 }}>
            <CalendarMonth
              year={calYear} month={calMonth}
              rangeStart={pickerStart} rangeEnd={pickerEnd}
              hoverEnd={selecting ? hoverDate : null}
              onDayClick={handleDayClick} onDayHover={setHoverDate}
              showLeft onLeft={goPrev} showRight={false}
            />
            <div style={{ width: 1, background: "#E4E5E7", margin: "0 16px", flexShrink: 0 }} />
            <CalendarMonth
              year={rightYear} month={rightMonth}
              rangeStart={pickerStart} rangeEnd={pickerEnd}
              hoverEnd={selecting ? hoverDate : null}
              onDayClick={handleDayClick} onDayHover={setHoverDate}
              showLeft={false} showRight onRight={goNext}
            />
          </div>

          {/* Cancel / Apply */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, borderTop: "1px solid #E4E5E7", paddingTop: 12 }}>
            <button
              type="button" onClick={() => setOpen(false)}
              style={{ padding: "7px 20px", border: "1px solid #C9CCCF", borderRadius: 8, background: "white", fontSize: 14, cursor: "pointer", color: "#202223", fontWeight: 500 }}
            >Cancel</button>
            <button
              type="button" onClick={handleApply} disabled={!pickerStart}
              style={{ padding: "7px 20px", border: "none", borderRadius: 8, background: "#1A1A1A", color: "white", fontSize: 14, cursor: "pointer", fontWeight: 700, opacity: !pickerStart ? 0.5 : 1 }}
            >Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Area / Line Chart ────────────────────────────────────────────────────────

const CH = { vw: 800, vh: 220, pL: 44, pR: 20, pT: 20, pB: 50 };

function AreaLineChart({ data, selectedDate, onDayClick }) {
  const n = data.length;
  if (!n) return null;

  const maxY   = Math.max(...data.map(d => d.count), 1);
  const plotW  = CH.vw - CH.pL - CH.pR;
  const plotH  = CH.vh - CH.pT - CH.pB;
  const baseY  = CH.pT + plotH;

  const px = i => CH.pL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const py = v => CH.pT + plotH - (maxY > 0 ? (v / maxY) * plotH : 0);

  // Y-axis ticks — deduplicated integers
  const rawStep = Math.max(1, Math.ceil(maxY / 4));
  const yTickSet = new Set();
  for (let v = 0; v <= maxY; v += rawStep) yTickSet.add(v);
  yTickSet.add(maxY);
  const yTicks = [...yTickSet].sort((a, b) => a - b);

  // X-axis — show up to 8 labels
  const xStep = Math.max(1, Math.ceil(n / 8));

  const pts1 = data.map((d, i) => `${px(i).toFixed(1)},${py(d.count).toFixed(1)}`).join(" ");
  const pts2 = data.map((d, i) => `${px(i).toFixed(1)},${py(d.applied).toFixed(1)}`).join(" ");
  const area = [
    `${px(0).toFixed(1)},${baseY}`,
    ...data.map((d, i) => `${px(i).toFixed(1)},${py(d.count).toFixed(1)}`),
    `${px(n - 1).toFixed(1)},${baseY}`,
  ].join(" ");

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${CH.vw} ${CH.vh}`}
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          {/* Y-axis grid + labels */}
          {yTicks.map(v => {
            const y = py(v);
            return (
              <g key={v}>
                <line x1={CH.pL} y1={y} x2={CH.vw - CH.pR} y2={y} stroke="#E9EBEC" strokeWidth="1" />
                <text x={CH.pL - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#8C9196">{v}</text>
              </g>
            );
          })}

          {/* Area fill (series 1) */}
          <polygon points={area} fill={S1_FILL} />

          {/* Line series 1 — blue */}
          <polyline points={pts1} fill="none" stroke={S1_COLOR} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

          {/* Line series 2 — purple */}
          <polyline points={pts2} fill="none" stroke={S2_COLOR} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {/* Interactive day overlays + dots */}
          {data.map((d, i) => {
            const x  = px(i);
            const y1 = py(d.count);
            const y2 = py(d.applied);
            const isSel = d.date === selectedDate;
            return (
              <g key={d.date} style={{ cursor: "pointer" }} onClick={() => onDayClick(d.date)}>
                {/* Vertical hover line */}
                {isSel && (
                  <line x1={x} y1={CH.pT} x2={x} y2={baseY} stroke="#C9CCCF" strokeWidth="1" strokeDasharray="4 3" />
                )}
                {/* Invisible wide click area */}
                <rect x={x - 22} y={CH.pT} width={44} height={plotH} fill="transparent" />
                {/* Series 1 dot */}
                <circle cx={x} cy={y1} r={isSel ? 5.5 : 4} fill={S1_COLOR} stroke="white" strokeWidth="2" />
                {/* Series 2 dot (only if > 0) */}
                {d.applied > 0 && (
                  <circle cx={x} cy={y2} r={isSel ? 4.5 : 3} fill={S2_COLOR} stroke="white" strokeWidth="2" />
                )}
                {/* Count label above dot on hover/select */}
                {(isSel || d.count > 0) && (
                  <text x={x} y={y1 - 10} textAnchor="middle" fontSize="11" fill={S1_COLOR} fontWeight="600">{d.count}</text>
                )}
              </g>
            );
          })}

          {/* Baseline */}
          <line x1={CH.pL} y1={baseY} x2={CH.vw - CH.pR} y2={baseY} stroke="#E4E5E7" strokeWidth="1" />

          {/* X-axis labels */}
          {data.map((d, i) => {
            if (i % xStep !== 0 && i !== n - 1) return null;
            return (
              <text key={d.date} x={px(i)} y={baseY + 18} textAnchor="middle" fontSize="10.5" fill="#8C9196">
                {d.label}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 20, marginTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 26, height: 2, background: S1_COLOR, borderRadius: 2 }} />
          <span style={{ fontSize: 12, color: "#6D7175" }}>AI Generations</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 26, height: 2, background: S2_COLOR, borderRadius: 2 }} />
          <span style={{ fontSize: 12, color: "#6D7175" }}>Applied to Product</span>
        </div>
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
      <div style={{ height: 8, background: "#F1F1F1", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, minWidth: pct > 0 ? 4 : 0, transition: "width 0.4s ease" }} />
      </div>
    </BlockStack>
  );
}

function StatTile({ title, total, withSeoTitle, withSeoDesc, url, color, icon }) {
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
          <Button url={url} size="slim" variant="secondary">Manage</Button>
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

// ─── Page ─────────────────────────────────────────────────────────────────────

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
  const handleDayClick = useCallback(date => setSelectedDate(p => p === date ? null : date), []);

  const actions = [
    products.total    - products.withSeoTitle    > 0 && { label: `${products.total    - products.withSeoTitle} products missing SEO title`,    url: "/app/products"    },
    products.total    - products.withSeoDesc     > 0 && { label: `${products.total    - products.withSeoDesc} products missing SEO description`, url: "/app/products"    },
    collections.total - collections.withSeoTitle > 0 && { label: `${collections.total - collections.withSeoTitle} collections missing SEO title`, url: "/app/collections" },
    pages.total       - pages.withSeoTitle       > 0 && { label: `${pages.total       - pages.withSeoTitle} pages missing SEO title`,            url: "/app/pages"       },
    articles.total    - articles.withSeoTitle    > 0 && { label: `${articles.total    - articles.withSeoTitle} articles missing SEO title`,       url: "/app/blog"        },
  ].filter(Boolean);

  const storeTotal   = products.total + collections.total + pages.total + articles.total;
  const coverageColor = seoScore >= 70 ? "#008060" : seoScore >= 40 ? "#B98900" : "#C9201F";
  const bestDay      = Math.max(...dailyActivity.map(d => d.count), 0);
  const activeDays   = dailyActivity.filter(d => d.count > 0).length;

  return (
    <Page
      title="SEO Analytics"
      subtitle="Track SEO health and AI content generation across your store"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="600">

        {/* KPI Row */}
        <Grid>
          {[
            { icon: FolderIcon,      sub: "Items across store",  val: storeTotal,       label: "Total Content"  },
            { icon: TargetIcon,      sub: "Average coverage",    val: seoScore + "%",   label: "SEO Coverage", color: coverageColor },
            { icon: AutomationIcon,  sub: "All-time total",      val: totalGenerations, label: "AI Generations" },
            { icon: CalendarIcon,    sub: rangeLabel,            val: rangeGenerations, label: "In Range"       },
          ].map(({ icon, sub, val, label, color }) => (
            <Grid.Cell key={label} columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
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
        <div style={{ position: "relative", zIndex: 10 }}>
        <Card>
          <BlockStack gap="400">
            {/* Header */}
            <InlineStack align="space-between" blockAlign="center" wrap={false} gap="300">
              <BlockStack gap="100">
                <Text variant="headingMd" as="h2">Generation Activity</Text>
                <Text variant="bodySm" tone="subdued">Click a data point to see day details</Text>
              </BlockStack>
              <DateRangePicker rangeParam={rangeParam} startDate={startDate} endDate={endDate} />
            </InlineStack>

            {/* Quick day buttons */}
            <InlineStack gap="200" wrap>
              {["7", "14", "30"].map(days => (
                <a
                  key={days}
                  href={`?range=${days}`}
                  style={{
                    display: "inline-block", padding: "4px 14px",
                    borderRadius: 20, textDecoration: "none",
                    border: `1px solid ${rangeParam === days ? S1_COLOR : "#C9CCCF"}`,
                    background: rangeParam === days ? S1_COLOR : "white",
                    color: rangeParam === days ? "white" : "#202223",
                    fontSize: 13, fontWeight: rangeParam === days ? 600 : 400,
                  }}
                >
                  {days}d
                </a>
              ))}
            </InlineStack>

            {/* Chart area */}
            {rangeGenerations === 0 ? (
              <Box paddingBlockStart="600" paddingBlockEnd="600">
                <InlineStack align="center">
                  <BlockStack gap="200">
                    <InlineStack align="center">
                      <Icon source={ChartLineIcon} tone="subdued" />
                    </InlineStack>
                    <Text variant="bodyMd" tone="subdued">No generation activity in this date range.</Text>
                  </BlockStack>
                </InlineStack>
              </Box>
            ) : (
              <AreaLineChart data={dailyActivity} selectedDate={selectedDate} onDayClick={handleDayClick} />
            )}

            {/* Day detail */}
            {selectedDate && <DayDetailPanel date={selectedDate} recentLogs={recentLogs} />}
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
                        <div style={{ width: 12, height: 12, borderRadius: 3, background: c1 }} />
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
              <StatTile title={title} total={total} withSeoTitle={wt} withSeoDesc={wd} url={url} color={color} icon={icon} />
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
                    { label: rangeLabel,         val: rangeGenerations },
                    { label: "Best single day",  val: bestDay },
                    { label: "Active days",      val: `${activeDays} / ${dailyActivity.length}` },
                  ].map(({ label, val }) => (
                    <InlineStack key={label} align="space-between">
                      <Text variant="bodySm" as="span">{label}</Text>
                      <Text variant="bodyMd" fontWeight="semibold" as="span">{val}</Text>
                    </InlineStack>
                  ))}
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  <Button url="/app/products" size="slim" variant="secondary">Generate Products</Button>
                  <Button url="/app/blog"     size="slim" variant="secondary">Generate Blog</Button>
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
                      <div key={log.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: i % 2 === 0 ? "#FAFAFA" : "white", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                          <Text variant="bodyMd" fontWeight="semibold" as="span">{log.productTitle || "Untitled"}</Text>
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

export const headers = (headersArgs) => boundary.headers(headersArgs);
