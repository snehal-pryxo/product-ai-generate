import { useEffect, useMemo, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useFetcher, useLoaderData } from "react-router";
import {
  ActionList,
  Banner,
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  EmptyState,
  FormLayout,
  InlineStack,
  Layout,
  Modal,
  Page,
  Popover,
  Select,
  Spinner,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { AppPageHeader } from "../components/AppPageHeader";
import db from "../db.server";
import {
  COLLECTION_DESCRIPTION_TEMPLATES,
  COLLECTION_META_DESCRIPTION_TEMPLATES,
  COLLECTION_META_TITLE_TEMPLATES,
  getEmptyCollectionTemplateSelection,
  writeStoredCollectionPromptTemplateSelection,
} from "../lib/collectionPromptTemplateLibrary";
import {
  PRODUCT_DESCRIPTION_TEMPLATES,
  PRODUCT_META_DESCRIPTION_TEMPLATES,
  PRODUCT_META_TITLE_TEMPLATES,
  getEmptyTemplateSelection,
  writeStoredProductPromptTemplateSelection,
} from "../lib/productPromptTemplateLibrary";
import {
  PAGE_BODY_TEMPLATES,
  PAGE_META_DESCRIPTION_TEMPLATES,
  PAGE_META_TITLE_TEMPLATES,
  getEmptyPageTemplateSelection,
  writeStoredPagePromptTemplateSelection,
} from "../lib/pagePromptTemplateLibrary";
import { buildDescriptionStructuredPreview, buildMetaPreviewText } from "../lib/templatePreviewFormat";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_TABS = [
  { id: "system", content: "System templates", panelID: "system-panel" },
  { id: "custom", content: "Custom templates", panelID: "custom-panel" },
];

const RESOURCE_FILTERS = [
  { id: "all", label: "All" },
  { id: "product", label: "Product" },
  { id: "collection", label: "Collection" },
  { id: "page", label: "Page" },
];

const TYPE_OPTIONS = [
  { label: "Description", value: "description" },
  { label: "SEO Description", value: "seo-description" },
  { label: "SEO Title", value: "seo-title" },
];

const RESOURCE_BADGE_TONE = {
  product: "info",
  collection: "warning",
  page: "success",
};

const RESOURCE_SELECT_OPTIONS = [
  { label: "Product", value: "product" },
  { label: "Collection", value: "collection" },
  { label: "Page", value: "page" },
];

const CUSTOM_TEMPLATES_KEY = "custom_prompt_templates_v1";
const TEMPLATE_SELECTIONS_DEFAULT = {
  product: getEmptyTemplateSelection(),
  collection: getEmptyCollectionTemplateSelection(),
  page: getEmptyPageTemplateSelection(),
};

const TONE_OPTIONS = [
  { label: "Not specified", value: "" },
  { label: "Professional / Formal", value: "professional" },
  { label: "Friendly / Casual", value: "friendly" },
  { label: "Persuasive / Sales-focused", value: "persuasive" },
  { label: "Informational / Technical", value: "informational" },
];

const EMPTY_CUSTOM_FORM = {
  name: "",
  description: "",
  resource: "product",
  type: "description",
  template: "",
  tone: "",
  language: "",
  exampleOutput: "",
};

function normalizeObjectStringFields(value, fallback) {
  const input = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    Object.keys(fallback).map((key) => [key, typeof input[key] === "string" ? input[key] : fallback[key]]),
  );
}

function normalizeTemplateSelections(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    product: normalizeObjectStringFields(input.product, TEMPLATE_SELECTIONS_DEFAULT.product),
    collection: normalizeObjectStringFields(input.collection, TEMPLATE_SELECTIONS_DEFAULT.collection),
    page: normalizeObjectStringFields(input.page, TEMPLATE_SELECTIONS_DEFAULT.page),
  };
}

function normalizeCustomTemplates(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: typeof entry.name === "string" ? entry.name : "",
      description: typeof entry.description === "string" ? entry.description : "",
      resource: typeof entry.resource === "string" ? entry.resource : "product",
      type: typeof entry.type === "string" ? entry.type : "description",
      template: typeof entry.template === "string" ? entry.template : "",
      tone: typeof entry.tone === "string" ? entry.tone : "",
      language: typeof entry.language === "string" ? entry.language : "",
      exampleOutput: typeof entry.exampleOutput === "string" ? entry.exampleOutput : "",
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
    }));
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { templateSelectionsJson: true, customPromptTemplatesJson: true },
  });

  let parsedSelections = {};
  let parsedCustomTemplates = [];
  try {
    parsedSelections = JSON.parse(shopData?.templateSelectionsJson || "{}");
  } catch {
    parsedSelections = {};
  }
  try {
    parsedCustomTemplates = JSON.parse(shopData?.customPromptTemplatesJson || "[]");
  } catch {
    parsedCustomTemplates = [];
  }

  return {
    initialSelections: normalizeTemplateSelections(parsedSelections),
    initialCustomTemplates: normalizeCustomTemplates(parsedCustomTemplates),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const requestId = String(formData.get("requestId") || "");

  if (intent !== "save_template_config") {
    return { success: false, error: "Unknown action.", requestId };
  }

  let nextSelections = TEMPLATE_SELECTIONS_DEFAULT;
  let nextCustomTemplates = [];
  try {
    nextSelections = normalizeTemplateSelections(JSON.parse(String(formData.get("templateSelectionsJson") || "{}")));
  } catch {
    return { success: false, error: "Invalid template selections payload.", requestId };
  }
  try {
    nextCustomTemplates = normalizeCustomTemplates(JSON.parse(String(formData.get("customTemplatesJson") || "[]")));
  } catch {
    return { success: false, error: "Invalid custom templates payload.", requestId };
  }

  await db.shop.upsert({
    where: { shop: session.shop },
    update: {
      templateSelectionsJson: JSON.stringify(nextSelections),
      customPromptTemplatesJson: JSON.stringify(nextCustomTemplates),
    },
    create: {
      shop: session.shop,
      installed: true,
      templateSelectionsJson: JSON.stringify(nextSelections),
      customPromptTemplatesJson: JSON.stringify(nextCustomTemplates),
    },
  });

  return {
    success: true,
    selections: nextSelections,
    customTemplates: nextCustomTemplates,
    requestId,
  };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SYSTEM_TEMPLATE_MAP = {
  product: {
    description: PRODUCT_DESCRIPTION_TEMPLATES,
    "seo-description": PRODUCT_META_DESCRIPTION_TEMPLATES,
    "seo-title": PRODUCT_META_TITLE_TEMPLATES,
  },
  collection: {
    description: COLLECTION_DESCRIPTION_TEMPLATES,
    "seo-description": COLLECTION_META_DESCRIPTION_TEMPLATES,
    "seo-title": COLLECTION_META_TITLE_TEMPLATES,
  },
  page: {
    description: PAGE_BODY_TEMPLATES,
    "seo-description": PAGE_META_DESCRIPTION_TEMPLATES,
    "seo-title": PAGE_META_TITLE_TEMPLATES,
  },
};

function getSystemTemplates(resourceId, typeId) {
  if (resourceId === "all") {
    const result = [];
    for (const [res, types] of Object.entries(SYSTEM_TEMPLATE_MAP)) {
      (types[typeId] || []).forEach((t) => result.push({ ...t, resource: res }));
    }
    return result;
  }
  return (SYSTEM_TEMPLATE_MAP[resourceId]?.[typeId] || []).map((t) => ({
    ...t,
    resource: resourceId,
  }));
}

function dedupeTemplatesByName(templates) {
  const seen = new Set();
  return (templates || []).filter((template) => {
    const key = String(template?.name || "")
      .trim()
      .toLowerCase();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getActiveTemplateId(resourceId, typeId, selectionMap) {
  const sel = selectionMap[resourceId];
  if (!sel) return "";
  const isBodyResource = resourceId === "page";
  if (typeId === "description") return isBodyResource ? sel.bodyTemplateId : sel.descriptionTemplateId;
  if (typeId === "seo-description") return sel.metaDescriptionTemplateId;
  if (typeId === "seo-title") return sel.metaTitleTemplateId;
  return "";
}

function saveCustomTemplates(templates) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(templates));
  }
  return templates;
}

// Builds the final prompt text by embedding tone, language, and few-shot example
// into the template. System templates without these fields are returned unchanged.
function buildEffectiveTemplate(template) {
  let effective = template.template || "";
  if (template.tone) {
    const toneLabel = TONE_OPTIONS.find((o) => o.value === template.tone)?.label || template.tone;
    effective = `[Tone: Write in a ${toneLabel} tone throughout]\n${effective}`;
  }
  if (template.language) {
    effective = `[Language: Generate all content in ${template.language}]\n${effective}`;
  }
  if (template.exampleOutput) {
    effective = `${effective}\n\nExample output to match style and format:\n${template.exampleOutput}`;
  }
  return effective;
}

function typeLabel(typeId) {
  return TYPE_OPTIONS.find((o) => o.value === typeId)?.label || typeId;
}

const TEMPLATE_PREVIEW_VALUES = {
  product_title: "UltraBook Pro X15 Gaming Laptop",
  collection_title: "Performance Laptop Collection",
  page_topic: "Technical Specifications",
  brand_name: "Avada Tech",
  category_keyword: "gaming laptops",
  primary_feature: "RTX 4080 graphics",
  main_benefit: "High-performance gaming without compromise",
  primary_benefit: "desktop-class power in a portable body",
  key_benefit: "smooth 240Hz gameplay",
  action_phrase: "Explore now",
  cta_phrase: "Shop now",
  trust_signal: "trusted by over 10,000 customers",
};

const CATEGORY_PREVIEW_PROFILES = {
  "problem-solution": {
    hook: "Struggling with lag, heat, and short battery life during intensive work?",
    description:
      "The UltraBook Pro X15 is built to solve those core issues with optimized thermal control, fast hardware, and reliable all-day productivity.",
    features:
      "It combines powerful processing, stable cooling, and fast storage so users can work and play without interruption.",
    audience: "Best for gamers, editors, developers, and power users who need consistent high performance.",
    cta: "Choose the UltraBook Pro X15 and turn daily friction into smooth performance.",
  },
  "technical specifications": {
    hook: "Engineered for precision performance across demanding workflows.",
    description:
      "The UltraBook Pro X15 combines desktop-grade components with a portable build for creators and gamers.",
    features:
      "Every core component is selected for speed, thermal stability, and long-term reliability under heavy usage.",
    audience: "Ideal for users who evaluate laptops by measurable performance benchmarks.",
    cta: "Review the full specifications and upgrade with confidence.",
  },
  "lifestyle integration": {
    hook: "From office to travel to late-night sessions, one laptop fits every routine.",
    description:
      "The UltraBook Pro X15 is designed to integrate into daily life with strong battery efficiency and premium portability.",
    features:
      "Its balance of power, comfort, and mobility supports work, entertainment, and creativity in one device.",
    audience: "Perfect for professionals and students who need flexible everyday performance.",
    cta: "Bring home a laptop that adapts to your lifestyle, not the other way around.",
  },
  "eco-friendly product": {
    hook: "High performance with a more responsible product approach.",
    description:
      "The UltraBook Pro X15 uses efficient power management and durable materials to reduce waste over its lifecycle.",
    features:
      "Longer component life and optimized energy use help lower replacement frequency and overall footprint.",
    audience: "Great for buyers who value both performance and environmental responsibility.",
    cta: "Make a smarter, more sustainable choice without compromising speed.",
  },
  "premium/luxury product": {
    hook: "Crafted for users who demand refined design and elite performance.",
    description:
      "The UltraBook Pro X15 delivers premium materials, advanced engineering, and polished user experience in every detail.",
    features:
      "Its finish, performance tuning, and display quality position it as a top-tier machine in its class.",
    audience: "Designed for professionals and enthusiasts who expect flagship quality.",
    cta: "Experience premium performance built for uncompromising standards.",
  },
  "budget-friendly product": {
    hook: "Get exceptional performance without overspending.",
    description:
      "The UltraBook Pro X15 focuses on high-impact hardware choices to deliver strong value for the price.",
    features:
      "It offers practical speed, reliability, and expansion headroom for users who want smart long-term value.",
    audience: "Best for budget-conscious buyers who still need serious performance.",
    cta: "Invest in real value with performance that lasts.",
  },
  "seasonal/limited edition": {
    hook: "A limited-edition performance release for this season.",
    description:
      "This edition of the UltraBook Pro X15 combines signature performance with a timely, exclusive launch profile.",
    features:
      "With limited availability and premium specs, it is built for users who want both power and exclusivity.",
    audience: "Ideal for collectors, early adopters, and seasonal campaign shoppers.",
    cta: "Secure yours before this limited run sells out.",
  },
  "storytelling narrative": {
    hook: "Created to solve real productivity pain points faced by modern users.",
    description:
      "The UltraBook Pro X15 started as a mission to combine true power, portability, and reliability in one machine.",
    features:
      "From concept to final design, every component was chosen to support meaningful day-to-day outcomes.",
    audience: "For users who connect with products built around real-world needs.",
    cta: "Be part of the story and experience performance designed with purpose.",
  },
  "social proof focus": {
    hook: "Chosen by thousands of users for speed, reliability, and daily consistency.",
    description:
      "The UltraBook Pro X15 is backed by strong user feedback across gaming, productivity, and creative workflows.",
    features:
      "Customers highlight smooth multitasking, low thermal throttling, and dependable long-session performance.",
    audience: "A trusted pick for new buyers who rely on proven user results.",
    cta: "Join the growing community already using the UltraBook Pro X15.",
  },
  "gift & occasion": {
    hook: "A powerful gift choice for milestone occasions and major upgrades.",
    description:
      "The UltraBook Pro X15 is a memorable gift for students, professionals, and gamers stepping into a new phase.",
    features:
      "Its practical value and premium experience make it suitable for birthdays, graduations, and career milestones.",
    audience: "Perfect for gift buyers who want meaningful utility and wow factor.",
    cta: "Gift performance that makes an impact from day one.",
  },
  "competitive differentiation": {
    hook: "Built to outperform generic alternatives where it matters most.",
    description:
      "The UltraBook Pro X15 differentiates through sustained performance, faster storage, and smarter cooling.",
    features:
      "Compared to typical options, it delivers stronger reliability under pressure and better user efficiency.",
    audience: "For buyers comparing options and looking for clear performance advantages.",
    cta: "Upgrade to a laptop that clearly stands apart from the competition.",
  },
};

function normalizeCategoryKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getCategoryProfile(templateName = "") {
  const normalized = normalizeCategoryKey(templateName);
  return CATEGORY_PREVIEW_PROFILES[normalized] || null;
}

function replaceTemplateTokens(template = "") {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}|{\s*([a-zA-Z0-9_]+)\s*}/g, (_, a, b) => {
    const key = (a || b || "").trim();
    return TEMPLATE_PREVIEW_VALUES[key] || key.replace(/_/g, " ");
  });
}

function resolvePromptLine(hint, state, context = {}) {
  const text = String(hint || "").trim();
  const normalized = text.toLowerCase();
  const profile = context.categoryProfile || null;
  const nextSpec = () => {
    const specs = [
      '15.6" 240Hz QHD IPS display with 2ms response time',
      "AMD Ryzen 9 processor with up to 5.7GHz boost",
      "NVIDIA RTX 4080 with 16GB GDDR6X memory",
      "32GB DDR5 RAM, expandable to 64GB",
      "2TB Gen4 NVMe SSD with ultra-fast read/write speeds",
    ];
    const value = specs[state.specIndex % specs.length];
    state.specIndex += 1;
    return value;
  };

  if (normalized.includes("product name") || normalized.includes("collection title")) {
    return TEMPLATE_PREVIEW_VALUES.product_title;
  }
  if (normalized.includes("hook")) return profile?.hook || "Engineered for creators and gamers who demand speed and reliability.";
  if (normalized.includes("brief technical overview")) {
    return profile?.description || "The UltraBook Pro X15 combines desktop-class performance with a lightweight premium chassis.";
  }
  if (normalized.includes("key specification")) return nextSpec();
  if (normalized.includes("key feature")) return profile?.features || "Advanced thermal design for stable performance under heavy workloads.";
  if (normalized.includes("key benefit")) return profile?.features || "Delivers smoother multitasking, faster rendering, and better gaming consistency.";
  if (normalized.includes("audience") || normalized.includes("use case")) {
    return profile?.audience || "Ideal for gamers, designers, and professionals who need reliable high performance.";
  }
  if (normalized.includes("call to action")) return profile?.cta || "Upgrade your setup with performance built for modern workloads.";
  if (normalized.includes("paragraph comparing")) {
    return "Compared to conventional laptops in this segment, this model offers higher sustained performance and improved cooling efficiency.";
  }
  if (normalized.includes("description")) {
    return profile?.description || "Built with premium materials and optimized components to deliver speed, durability, and everyday usability.";
  }
  if (normalized.includes("features/benefits")) {
    return profile?.features || "It balances speed, thermal stability, and battery efficiency to improve both productivity and gaming sessions.";
  }
  if (normalized.includes("intro")) return "This section provides a clear overview to help customers evaluate the product quickly.";
  if (normalized.includes("question")) return "Q: Is this laptop suitable for professional editing? A: Yes, it is optimized for high-performance workloads.";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function generateTemplatePreview(template = "") {
  const resolved = replaceTemplateTokens(template);
  const lines = resolved.split("\n");
  const state = { specIndex: 0 };

  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      const match = trimmed.match(/^\[(.*)\]$/);
      if (!match) return trimmed;
      const rawHint = match[1].trim();
      const parts = rawHint.split(":");
      if (parts.length > 1) {
        const category = parts.shift().trim();
        const detail = parts.join(":").trim();
        return `${category}: ${resolvePromptLine(detail, state)}`;
      }
      return resolvePromptLine(rawHint, state);
    })
    .join("\n\n");
}

function sanitizeSectionHeading(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildStructuredPreview(template = "", templateName = "") {
  const resolved = replaceTemplateTokens(template);
  const lines = resolved.split("\n");
  const state = { specIndex: 0 };
  const context = { categoryProfile: getCategoryProfile(templateName) };
  const sections = [];
  const sectionIndexMap = new Map();
  let heading = "";
  let subheading = "";

  function getSection(sectionTitle) {
    const key = sectionTitle.toLowerCase();
    if (sectionIndexMap.has(key)) {
      return sections[sectionIndexMap.get(key)];
    }
    const section = { title: sanitizeSectionHeading(sectionTitle), paragraphs: [], points: [] };
    sectionIndexMap.set(key, sections.length);
    sections.push(section);
    return section;
  }

  function pushContent(sectionTitle, content, asPoint = false) {
    if (!content) return;
    const section = getSection(sectionTitle);
    if (asPoint) {
      section.points.push(content);
      return;
    }
    section.paragraphs.push(content);
  }

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const bracketMatch = trimmed.match(/^\[(.*)\]$/);
    if (!bracketMatch) {
      if (!heading) {
        heading = trimmed;
        return;
      }
      if (!subheading) {
        subheading = trimmed;
        return;
      }
      pushContent("Details", trimmed);
      return;
    }

    const rawHint = bracketMatch[1].trim();
    const normalizedRawHint = rawHint.toLowerCase();
    const parts = rawHint.split(":");
    const hasCategory = parts.length > 1;
    const category = hasCategory ? sanitizeSectionHeading(parts.shift().trim()) : "Details";
    const hint = hasCategory ? parts.join(":").trim() : rawHint;
    const normalizedHint = hint.toLowerCase();
    const content = resolvePromptLine(hint, state, context);

    if (!heading && (normalizedRawHint.includes("product name") || normalizedRawHint.includes("collection title"))) {
      heading = content;
      return;
    }

    if (!subheading && (normalizedHint.includes("overview") || normalizedHint.includes("hook") || normalizedHint.includes("description"))) {
      subheading = content;
      return;
    }

    const isPoint =
      normalizedHint.includes("key specification") ||
      normalizedHint.includes("key feature") ||
      normalizedHint.includes("key benefit") ||
      normalizedHint.includes("highlight") ||
      normalizedHint.includes("question") ||
      normalizedHint.includes("attribute");

    pushContent(category, content, isPoint);
  });

  if (!heading) heading = TEMPLATE_PREVIEW_VALUES.product_title;
  if (!subheading) {
    subheading = context.categoryProfile?.description
      || "Preview generated in template format. Use this structure to create category-wise content.";
  }

  return { heading, subheading, sections };
}

// ─── HTML Preview Engine ─────────────────────────────────────────────────────
// Renders a realistic output example for each template so merchants can see
// exactly what content the AI would produce before selecting a template.

const PREVIEW_STYLE_TAG = `<style>
.tpl-prev h1,.tpl-prev h2{font-size:17px;font-weight:700;margin:0 0 10px;line-height:1.35;color:#111}
.tpl-prev h3{font-size:14px;font-weight:600;margin:14px 0 5px;color:#1a1a1a}
.tpl-prev p{font-size:13px;margin:0 0 9px;line-height:1.6;color:#374151}
.tpl-prev ul{margin:8px 0 0;padding-left:18px}
.tpl-prev li{font-size:13px;margin-bottom:5px;line-height:1.5;color:#374151}
.tpl-prev strong{font-weight:600;color:#111}
.tpl-prev .serp-box{max-width:600px;background:#fff;padding:12px 0}
.tpl-prev .serp-title{color:#1a0dab;font-size:18px;margin:0 0 2px;font-weight:400;font-family:arial,sans-serif;text-decoration:underline;cursor:pointer}
.tpl-prev .serp-url{color:#006621;font-size:14px;margin:0 0 3px;font-family:arial,sans-serif}
.tpl-prev .serp-desc{color:#545454;font-size:14px;line-height:1.58;font-family:arial,sans-serif;margin:0}
</style>`;

function wrapHtml(content) {
  return `${PREVIEW_STYLE_TAG}<div class="tpl-prev">${content}</div>`;
}

function buildSerpHtml(title, url, description) {
  return wrapHtml(`<div class="serp-box">
<p class="serp-title">${title}</p>
<p class="serp-url">${url}</p>
<p class="serp-desc">${description}</p>
</div>`);
}

// ── Product description HTML previews ────────────────────────────────────────
const TEMPLATE_PREVIEW_HTML = {
  "problem-solution": `<h2>Say Goodbye to Lag, Throttling, and Overheating</h2>
<p>Gamers and creators share the same frustration: your laptop slows down under heavy load, thermal throttling kills performance, and expensive hardware never delivers its rated specs. The <strong>UltraBook Pro X15</strong> was purpose-built to eliminate every one of these bottlenecks — from the cooling architecture to the power delivery system.</p>
<h3>The Real Problem with Standard Laptops</h3>
<p>Most laptops use undersized cooling systems that start throttling CPU and GPU speeds within minutes of sustained use. The result is inconsistent frame rates, slow render times, and a machine that chronically underperforms under the exact workloads it was marketed for. Manufacturers prioritise slim chassis over sustained thermals, and the customer pays the performance price.</p>
<p>After six months of competitive benchmarking, the pattern was undeniable: every mainstream gaming laptop sustained full performance for 10–15 minutes before thermal limits forced a significant power reduction. In a two-hour video export or extended gaming session, that gap compounds into hours of lost productivity.</p>
<h3>A Laptop Engineered Around the Solution</h3>
<p>The UltraBook Pro X15 uses a dual-fan active cooling system with vapour chamber heat distribution and liquid metal thermal compound on both the CPU and GPU dies. Core temperatures remain stable even during marathon gaming sessions or long video exports. The RTX 4080 GPU maintains its full rated 175W TDP continuously — not just in the brief burst windows that benchmarks capture.</p>
<h3>Consistent Performance You Can Measure</h3>
<p>The UltraBook Pro X15 sustains 100% of rated CPU and GPU performance for over 3 hours of continuous combined load — a benchmark most competing laptops fail within the first 20 minutes. Every unit is validated through a 90-minute pre-shipment thermal test before it leaves the factory.</p>
<ul><li>Zero thermal throttling under sustained CPU + GPU combined load</li>
<li>RTX 4080 GPU maintains full 175W TDP for extended sessions</li>
<li>AMD Ryzen 9 boosts to 5.7GHz consistently across all cores</li>
<li>2TB Gen4 NVMe SSD — projects open in under 800 milliseconds</li>
<li>Thunderbolt 4 with 40Gbps bandwidth for external device connectivity</li>
<li>3-year warranty with next-business-day replacement coverage</li></ul>
<p><em>Stop paying for performance that disappears under load. The UltraBook Pro X15 delivers what it promises — every session, every time.</em></p>`,

  "technical-specifications": `<h2>UltraBook Pro X15 — Full Technical Overview</h2>
<p>The UltraBook Pro X15 is a high-performance mobile workstation designed for demanding creative and gaming workflows. Every specification has been selected to meet or exceed the requirements of professional-grade use cases in video production, 3D rendering, software development, and competitive gaming.</p>
<h3>Processor and Graphics</h3>
<p>Powered by the AMD Ryzen 9 7945HX processor operating at up to 5.7GHz boost clock across 16 cores and 32 threads, with a 65W configurable TDP. The NVIDIA RTX 4080 Laptop GPU (Ada Lovelace, 175W TGP) provides 16GB GDDR6X memory on a 256-bit bus with full DLSS 3, Frame Generation, and hardware ray tracing support.</p>
<h3>Memory and Storage</h3>
<p>32GB DDR5-5600 in dual-channel configuration via two socketed SO-DIMM slots, user-upgradeable to 64GB. Primary storage is a 2TB Gen4 PCIe NVMe SSD achieving sequential reads of 7,400 MB/s and writes of 6,500 MB/s. A secondary M.2 2280 slot is available for user expansion.</p>
<h3>Display</h3>
<p>15.6-inch IPS panel at 2560×1440 (QHD) resolution with a 240Hz refresh rate, 3ms response time, 100% DCI-P3 colour gamut coverage, and ΔE &lt; 2 factory calibration. Peak brightness: 500 nits. VESA DisplayHDR 400 certified.</p>
<h3>Connectivity and Ports</h3>
<p>2× Thunderbolt 4 (USB-C, 40Gbps, DisplayPort 2.0, PD 140W), 2× USB-A 3.2 Gen 2 (10Gbps), 1× HDMI 2.1 (4K 120Hz), 1× SD UHS-II card reader. Wi-Fi 6E (802.11ax, 6GHz), Bluetooth 5.3. 99.9Wh battery with USB-C PD charging.</p>
<ul><li>CPU: AMD Ryzen 9 7945HX — 5.7GHz boost, 16-core / 32-thread, 65W TDP</li>
<li>GPU: NVIDIA RTX 4080 Laptop — 16GB GDDR6X, 175W TGP, DLSS 3</li>
<li>RAM: 32GB DDR5-5600 dual-channel, socketed, upgradeable to 64GB</li>
<li>Storage: 2TB Gen4 NVMe — 7,400 MB/s read, secondary M.2 slot included</li>
<li>Display: 15.6" 240Hz QHD IPS — 100% DCI-P3, ΔE &lt; 2, HDR400</li>
<li>Battery: 99.9Wh — up to 13 hours mixed use with adaptive refresh</li></ul>`,

  "lifestyle-integration": `<h2>One Laptop That Fits Every Part of Your Life</h2>
<p>From the morning commute to late-night creative sessions, the <strong>UltraBook Pro X15</strong> adapts to every moment of your day. At 19.5mm thin and under 2kg, it's light enough to carry everywhere — and with an RTX 4080 and Ryzen 9 under the hood, it's powerful enough to handle absolutely everything you throw at it.</p>
<h3>Morning — Office, Commute, or Coffee Shop</h3>
<p>Start your day with fluid multitasking across project files, browser tabs, video calls, and communication tools. The 13-hour battery means you're not hunting for power outlets by 2pm. Connect to any display via Thunderbolt 4 and your full dual-monitor setup is live in seconds. The backlit keyboard and precision trackpad make working on the road feel exactly like working at your desk.</p>
<h3>Afternoon — Creative Studio Work</h3>
<p>Switch seamlessly into your creative workflow the moment you get home. The 240Hz QHD display delivers studio-accurate colour with 100% DCI-P3 coverage and factory calibration at ΔE &lt; 2 — the same standard as dedicated colour grading monitors. The RTX 4080 renders timeline previews and exports frames in real time. No proxy workflows. No waiting. No workarounds.</p>
<h3>Evening — Gaming and Entertainment</h3>
<p>The same hardware that powers your creative work drives exceptional gaming performance. Frame rates stay consistently high across demanding titles at QHD. Textures stay sharp. Audio through the quad-speaker system fills the room. The 240Hz display keeps motion blur to an absolute minimum, giving you the competitive edge when it matters.</p>
<ul><li>Slim 19.5mm profile — fits in any backpack without weight penalty</li>
<li>13-hour rated battery life for full-day untethered productivity</li>
<li>Studio-grade 100% DCI-P3 display for colour-critical creative work</li>
<li>240Hz refresh rate for smooth gaming and responsive UI</li>
<li>MIL-SPEC chassis — engineered for the demands of daily carry</li>
<li>Thunderbolt 4 for instant desk setup — one cable, full connectivity</li></ul>`,

  "eco-friendly-product": `<h2>High Performance, Designed With Sustainability in Mind</h2>
<p>The <strong>UltraBook Pro X15</strong> delivers professional-grade computing performance without unnecessary environmental compromise. From materials sourcing to end-of-life recycling, every stage of this product's lifecycle has been thoughtfully considered — because performance and responsibility don't have to be trade-offs.</p>
<h3>Responsible Materials and Manufacturing</h3>
<p>The chassis incorporates post-consumer recycled aluminium across 40% of its metal content, reducing the demand for primary aluminium extraction. All packaging is 100% recyclable with zero single-use plastics — including the carry sleeve, which uses recycled polyester. Our manufacturing partners operate under ISO 14001 environmental certification, and this generation's production process reduces carbon emissions by 28% compared to the previous model.</p>
<h3>Designed for Efficiency and Longevity</h3>
<p>Energy-efficient DDR5 memory and intelligent adaptive thermal management reduce average power draw by 18% compared to the previous generation under equivalent workloads. The 99.9Wh battery delivers up to 13 hours of real-world use, reducing the daily charge cycles over the product's lifetime.</p>
<p>Critically, both SO-DIMM memory slots and the secondary M.2 storage slot are user-accessible without voiding the warranty. Extending a laptop's useful life by three to five years through component upgrades is the most significant sustainability action a buyer can take — and we designed the UltraBook Pro X15 to make that easy.</p>
<ul><li>Chassis made from 40% post-consumer recycled aluminium</li>
<li>18% lower average power consumption vs. prior generation</li>
<li>100% recyclable packaging — zero single-use plastics</li>
<li>User-upgradeable RAM and SSD — extend lifespan, reduce e-waste</li>
<li>RoHS compliant — free from all six restricted hazardous substances</li>
<li>ISO 14001 certified manufacturing partners</li></ul>`,

  "premium-luxury-product": `<h2>Crafted for Those Who Demand the Finest</h2>
<p>The <strong>UltraBook Pro X15 Signature Edition</strong> is not simply a laptop. It is a precision instrument, conceived and executed for professionals who have experienced the difference between hardware that meets specifications and hardware that exceeds them in every measurable and perceptible dimension.</p>
<h3>Materials and Craftsmanship</h3>
<p>An aerospace-grade magnesium-aluminium alloy chassis is CNC-machined to a 0.01mm surface tolerance, then hand-finished with a multi-stage anodising process available in three exclusive colourways: Obsidian Black, Champagne Gold, and Arctic Slate. The lid panel features a hairline-brushed finish that catches light differently at every angle. The keyboard is individually back-lit with per-key illumination, using full-travel mechanical-feel switches tuned specifically for this chassis.</p>
<h3>Display and Validation</h3>
<p>Every Signature Edition ships with a factory-calibrated OLED display validated to ΔE &lt; 1 colour accuracy — the standard used in professional colour grading suites and broadcast post-production. Each panel is measured individually, and the calibration certificate is included in the box. Every unit undergoes a 72-hour quality assurance cycle before shipment.</p>
<h3>The Ownership Experience</h3>
<p>Premium ownership means never having to think about support. A three-year global concierge service plan is included as standard — with on-site replacement, priority case handling, and a dedicated service line. A hand-stitched leather carry sleeve in matching colourway ships with every unit.</p>
<ul><li>CNC-machined magnesium-aluminium chassis in three exclusive colourways</li>
<li>Factory-calibrated OLED display — individual ΔE &lt; 1 validation certificate</li>
<li>72-hour pre-shipment quality assurance cycle on every unit</li>
<li>3-year global concierge service with on-site replacement included</li>
<li>Hand-stitched leather carry sleeve in matching colourway — included</li>
<li>Per-key illuminated keyboard with tuned mechanical-feel switches</li></ul>`,

  "budget-friendly-product": `<h2>Professional-Grade Performance at a Price That Makes Sense</h2>
<p>Not every high-performance laptop needs to cost a fortune. The <strong>UltraBook Pro X15</strong> delivers the hardware that serious creators and gamers actually need — without the premium markup that usually comes from unnecessary extras, brand premiums, or inflated retail positioning.</p>
<h3>Where the Value Is Built</h3>
<p>Every component choice in the UltraBook Pro X15 is driven by its real-world performance impact. The RTX 4080 GPU gives you frame rates and render speeds that would cost twice as much in competing configurations at equivalent specification levels. The 32GB DDR5-5600 dual-channel configuration is the minimum that professionals should be working with in 2025 — and it's included at the base price, not as a paid upgrade.</p>
<h3>What's Included — Not Upsold</h3>
<p>A 240Hz QHD IPS display with 100% DCI-P3 colour coverage, a full-size RGB backlit keyboard, quad-speaker premium audio system, Thunderbolt 4 connectivity, and a 99.9Wh battery are standard on every configuration. In competing products, several of these are paid option upgrades. The UltraBook Pro X15 includes the full experience at the starting price.</p>
<p>User-accessible RAM and storage slots mean your total cost of ownership is lower over time. Upgrade the SSD in two years rather than buying an entirely new machine.</p>
<ul><li>RTX 4080 GPU performance positioned at a genuine mid-range total price</li>
<li>MIL-SPEC durability standard — built to handle years of daily use</li>
<li>User-upgradeable RAM + SSD — lower long-term cost of ownership</li>
<li>240Hz QHD display and premium audio included as standard</li>
<li>2-year warranty with next-business-day replacement coverage</li>
<li>No feature stripped to hit the price — full configuration, full connectivity</li></ul>`,

  "seasonal-limited-edition": `<h2>Introducing the UltraBook Pro X15 — Summer Creator Edition</h2>
<p>This season's limited production run combines our highest-performing hardware configuration with exclusive design and specification details available only during this release window. Once this batch sells through, this exact configuration — at this price — will not return.</p>
<h3>What Sets the Summer Creator Edition Apart</h3>
<p>The Summer Creator Edition ships in an exclusive arctic-white chassis finish with gold accent trim — a colourway produced specifically for this seasonal run and unavailable in any standard configuration. The factory specification has been upgraded to 64GB DDR5 dual-channel memory and 4TB dual-NVMe RAID-0 storage, delivering 14,200 MB/s combined sequential read throughput. This configuration is not available through any other ordering path.</p>
<p>A custom performance BIOS mode — available exclusively on this edition — raises the sustained GPU TDP ceiling by 12%, delivering higher sustained frame rates and shorter render windows under extended workloads.</p>
<h3>What's Included in the Package</h3>
<p>Every Summer Creator Edition ships with a co-designed limited edition carry sleeve, a 100W USB-C travel charger, and a 3-year extended warranty already registered in your name. The total accessory value is $238, included without additional charge.</p>
<h3>Time Is the Only Constraint</h3>
<p>This production run is limited to 500 units globally. Pre-orders open now; units ship within 10 business days of the release date.</p>
<ul><li>Exclusive arctic-white chassis with gold trim — not in standard lineup</li>
<li>Factory-upgraded 64GB DDR5 + 4TB dual-NVMe (14,200 MB/s combined)</li>
<li>Custom BIOS performance mode — 12% higher sustained GPU TDP</li>
<li>Includes carry sleeve, 100W travel charger, and pre-registered 3-year warranty</li>
<li>500 units globally — pre-order secures your place in the production queue</li></ul>`,

  "storytelling-narrative": `<h2>Built From a Problem No One Had Solved Yet</h2>
<p>In late 2021, our lead systems engineer spent six months testing every high-performance laptop on the market — not in benchmarks, but under the sustained real-world workloads that professional creators and gamers actually run. The conclusion was the same every time: they all throttled, they all ran hot, and they all compromised somewhere that mattered. The <strong>UltraBook Pro X15</strong> is what we built after reaching that conclusion.</p>
<h3>The Problem That Started Everything</h3>
<p>Our team had experienced first-hand the cost of hardware that can't keep pace. Thermal throttling caused a missed client deadline on a video production project. A competitor's gaming laptop — bought the same week as a demanding project — dropped to 60% of its rated GPU speed during a 4-hour render. We couldn't find a laptop on the market that solved this. So we decided to build one ourselves.</p>
<h3>Two Years of Engineering to Get It Right</h3>
<p>We went through seventeen distinct cooling system prototypes before we found a vapour chamber and dual-fan architecture that delivered sustained performance without compromising the chassis form factor we needed. We tested four display panel suppliers and rejected three before finding a panel manufacturer that could consistently deliver ΔE &lt; 2 at volume. Every component was chosen because it passed our internal team's real-world use tests — not because the spec sheet looked good.</p>
<p>The first UltraBook Pro X15 shipped in March 2023. The engineering team that built it still uses it every day.</p>
<ul><li>17 cooling system prototypes — until one delivered zero-throttle, sustained performance</li>
<li>Ryzen 9 + RTX 4080 chosen by engineers who use it for actual work</li>
<li>Two-year internal development cycle before first public sale</li>
<li>Built by a team that refused to ship something they wouldn't rely on themselves</li>
<li>Every unit pre-validated through the 90-minute sustained thermal test our engineers designed</li>
<li>3-year warranty — because we're confident in what we built</li></ul>`,

  "social-proof-focus": `<h2>Trusted by Over 12,000 Creators and Gamers Worldwide</h2>
<p>The <strong>UltraBook Pro X15</strong> has earned a 4.8-star average rating from over 12,000 verified purchases. Customers consistently highlight three things: sustained performance under real workloads, display quality that rivals dedicated monitors, and reliability through demanding daily use over months and years.</p>
<h3>What Customers Say Most</h3>
<p>"This is the first laptop that doesn't throttle during my 4K export sessions. I've been through four laptops in three years looking for this." — Marcus T., Video Editor, London</p>
<p>"The 240Hz display is genuinely the best I've used outside of a dedicated studio monitor. My clients noticed the difference in my colour work immediately." — Priya K., Motion Designer, Toronto</p>
<p>"I do competitive gaming and stream simultaneously. This machine doesn't flinch. Frame rates stay locked and the stream quality is flawless." — Jake R., Content Creator, Austin</p>
<h3>The Numbers Behind the Reviews</h3>
<p>12,000+ verified reviews across five sales channels. 96% of buyers would recommend to a colleague or friend. Average review length of 340 words — indicating buyers have genuine, detailed experiences to share. The UltraBook Pro X15 was ranked #1 in its category by TechReview Weekly in 2024 and received the Digital Creator Awards "Best Creator Laptop" recognition in 2025.</p>
<ul><li>4.8 stars from 12,000+ verified customer reviews across five platforms</li>
<li>96% of buyers would recommend to a colleague or friend</li>
<li>#1 ranked — TechReview Weekly and Digital Creator Awards 2025</li>
<li>Official hardware recommendation of the Avada Tech Creator Academy</li>
<li>Trusted by professional creators in video, 3D, gaming, and design</li>
<li>Average ownership duration before repurchase: 4.2 years</li></ul>`,

  "gift-occasion": `<h2>The Gift They'll Actually Use Every Single Day</h2>
<p>For the graduation, the new job, the significant birthday, the promotion — the <strong>UltraBook Pro X15</strong> is the kind of gift that changes how someone works, creates, and plays for years to come. Not a gift that gets used once and stored. A gift that becomes indispensable.</p>
<h3>Who It's Perfect For</h3>
<p>For the video creator who's been editing on a machine that can't keep up — this is the upgrade they've been putting off because the price felt too high. For the gamer who wants a setup they can take anywhere without sacrificing performance. For the graduate entering a career in design, engineering, or content creation. For the professional who needs one machine that handles everything without compromise.</p>
<h3>The Performance Behind the Gift</h3>
<p>The UltraBook Pro X15 carries a Ryzen 9 processor at 5.7GHz, an RTX 4080 GPU with 175W power, 32GB DDR5 memory, and a 2TB NVMe SSD. The 240Hz QHD display delivers studio-accurate colour. The 13-hour battery means they won't need to carry a charger to every meeting. This is hardware that doesn't need an apology or an asterisk.</p>
<h3>Packaged to Impress From the Moment It Arrives</h3>
<p>Ships in a premium unboxing experience with a protective carry sleeve, accessories pack, and optional personalised gift card at checkout. Express delivery is available if you're working to a date. Orders placed by Thursday ship the same day for Friday delivery.</p>
<ul><li>Premium unboxing experience — gift-ready presentation, no additional wrapping needed</li>
<li>Personalised gift card option available at checkout</li>
<li>Suitable for creators, gamers, students, engineers, and professionals</li>
<li>3-year warranty — a gift that stays reliable through years of heavy use</li>
<li>User-upgradeable storage and memory — grows with the recipient's needs</li>
<li>Express delivery available for time-sensitive occasions</li></ul>`,

  "competitive-differentiation": `<h2>Other Laptops Throttle. The UltraBook Pro X15 Doesn't.</h2>
<p>We benchmarked the UltraBook Pro X15 against the four laptops it's most frequently compared to. The results confirmed what we suspected: sustained performance under real-world load conditions is where most premium laptops fail — even at the $1,500–$2,000 price point.</p>
<h3>Where the Competition Falls Short</h3>
<p>In 3-hour sustained combined CPU + GPU load testing, the leading competitor dropped to 67% of its rated performance due to thermal limitations. The second-ranked alternative hit 71% by the 90-minute mark. The UltraBook Pro X15 maintained 99% of rated performance across the full 3-hour window. This is the gap between a laptop that throttles and one that doesn't — and it shows up in every real workload you run.</p>
<h3>Display: There Is No Comparison</h3>
<p>Competing models at this price point use 72% sRGB panels — adequate for general use, insufficient for colour-critical professional work. The UltraBook Pro X15 ships factory-calibrated at 100% DCI-P3 with ΔE &lt; 2 verified on each unit. Professional creators don't need to compromise on accuracy to have performance.</p>
<h3>Upgradeability: A Feature Competitors Removed</h3>
<p>Three of the four comparison models use soldered RAM — your purchase locks you into the original memory configuration permanently. The UltraBook Pro X15 uses socketed DDR5, user-accessible, upgradeable to 64GB without voiding the warranty.</p>
<ul><li>99% sustained performance vs. 67%–71% for the top two competitors under 3-hour load</li>
<li>100% DCI-P3 factory-calibrated display vs. 72% sRGB in competing models</li>
<li>Socketed DDR5 RAM — user-upgradeable to 64GB, unlike soldered alternatives</li>
<li>Dual M.2 slots for future storage expansion — unavailable in most competing models</li>
<li>3-year warranty vs. industry-standard 1-year coverage from competing brands</li>
<li>All benchmark data independently validated by TechReview Weekly, 2024</li></ul>`,

  "tone-professional": `<h2>UltraBook Pro X15: Enterprise-Grade Mobile Performance</h2>
<p>The UltraBook Pro X15 is a professional-grade mobile workstation designed to support mission-critical workflows across engineering, data science, creative production, computational simulation, and high-performance computing applications requiring sustained processing throughput in a portable form factor.</p>
<h3>Processing and Graphics Capability</h3>
<p>The system integrates the AMD Ryzen 9 7945HX processor at 5.7GHz maximum boost with 16 cores and 32 threads operating at a 65W configurable TDP. The NVIDIA RTX 4080 Laptop GPU provides 16GB GDDR6X memory at 175W Total Graphics Power, validated under sustained load conditions across the full 3-hour specification window. Performance does not degrade under the thermal conditions generated by extended professional workloads.</p>
<h3>Memory, Storage, and Display</h3>
<p>32GB DDR5-5600 in dual-channel configuration, expandable to 64GB via two user-accessible SO-DIMM slots. Primary storage is a 2TB Gen4 NVMe SSD at 7,400 MB/s sequential read throughput. Display: 15.6-inch QHD IPS at 240Hz, 100% DCI-P3, ΔE &lt; 2 factory calibration — meeting the colour accuracy requirements of professional post-production and design environments.</p>
<h3>Security and Compliance</h3>
<p>The platform supports TPM 2.0, hardware-level fingerprint authentication, and full Microsoft BitLocker compatibility. It meets MIL-STD-810H mechanical durability requirements and is certified for deployment in regulated industries. Enterprise volume procurement options include customised asset management and multi-unit service level agreements.</p>
<ul><li>AMD Ryzen 9 7945HX, 5.7GHz boost — validated under sustained workloads</li>
<li>RTX 4080 Laptop GPU, 175W TGP — certified with professional rendering suites</li>
<li>TPM 2.0 and BitLocker compatibility for enterprise security compliance</li>
<li>MIL-STD-810H certified — rated for field, travel, and variable environments</li>
<li>3-year on-site service SLA available for volume procurement contracts</li>
<li>ISO 27001-compatible asset management options on request</li></ul>`,

  "tone-friendly": `<h2>Meet the Laptop That Finally Keeps Up With You</h2>
<p>You know that feeling when you sit down to work or game and everything just flows? No waiting, no overheating, no "why is this rendering still going?" moments. That's exactly what the <strong>UltraBook Pro X15</strong> is built to give you — every single session, every single day.</p>
<h3>It's Powerful, But We Promise It's Not Complicated</h3>
<p>Yes, there's an RTX 4080 GPU and a Ryzen 9 processor under the hood — but what you'll actually notice is that your games load faster, your videos export in a fraction of the time, your browser never lags when you have forty tabs open, and everything just works the way it's supposed to. You don't need to know what 175W TGP means. You just need to notice that things feel fast and stay fast.</p>
<p>And it doesn't get hot. That's the thing no one talks about enough. Laptops that run cool are laptops that stay fast. The UltraBook Pro X15 was engineered specifically so the cooling keeps pace with the performance — not the other way around.</p>
<h3>The Battery Is Actually Good</h3>
<p>Up to 13 hours of real battery life means you can get through a full day of work, classes, travel, or creative sessions without hunting for a power outlet every three hours. We tested it the honest way — real tasks, real brightness, real workloads. Not the "airplane mode, screen at 20%" test that looks good on paper and means nothing in real life.</p>
<ul><li>Feels fast from the moment you open it — and stays fast under workloads</li>
<li>Under 2kg and just 19.5mm thin — genuinely easy to carry all day</li>
<li>13-hour real battery life — tested honestly, not under ideal lab conditions</li>
<li>240Hz display that makes everything feel smooth and responsive</li>
<li>RGB backlit keyboard, because detail matters in the little things too</li>
<li>3-year warranty so you're covered — and we mean actually covered</li></ul>`,

  "tone-persuasive": `<h2>Stop Settling for a Laptop That Can't Keep Up With You</h2>
<p>You've experienced it before. A laptop that promises the world and delivers lag. Every serious creator and gamer who's been let down by ordinary hardware knows the real cost — not just in money, but in time lost, deadlines missed, and the constant background frustration of a tool that gets in the way of the work. The <strong>UltraBook Pro X15</strong> ends that cycle, permanently.</p>
<h3>This Is the Performance You've Been Waiting For</h3>
<p>The RTX 4080 doesn't just promise high frame rates and fast renders — it delivers them consistently, session after session, hour after hour. Independent testing confirms zero thermal throttling under sustained combined CPU and GPU load for over three hours. That's not a marketing claim. It's a measurable, verifiable result that shows up every time you open a timeline, launch a game, or start a render. The performance you paid for is the performance you get.</p>
<p>The 240Hz QHD display with 100% DCI-P3 coverage means your creative output looks exactly the way it's supposed to — colours accurate to the calibration standard used in professional broadcast studios. The 13-hour battery means your workflow isn't interrupted by a power cable.</p>
<h3>You're Protected. Completely. We Guarantee It.</h3>
<p>30-day no-questions-asked return policy. 3-year comprehensive warranty with next-day replacement coverage. Free express shipping on every order. There is literally zero risk in trying the machine that could fundamentally change how you work and create every day.</p>
<ul><li>Zero thermal throttling — independently tested, verified, and guaranteed in writing</li>
<li>RTX 4080 performance that stays consistent — not just in benchmarks, in real workloads</li>
<li>30-day full return window — no questions, no restocking fee, no hassle</li>
<li>3-year warranty with next-day replacement — not the 12-month standard elsewhere</li>
<li>Free express 48-hour delivery on every order, no minimum spend</li>
<li>Order today and receive a free professional carry sleeve — limited period offer</li></ul>`,

  "tone-informational": `<h2>UltraBook Pro X15 — Specifications and Technical Summary</h2>
<p>The UltraBook Pro X15 is a performance mobile computing platform targeting workloads including 3D rendering, machine learning inference, game development, 4K video production, and scientific computation. This summary covers the primary hardware specifications, connectivity, thermal performance, and relevant certifications. All performance data is validated under real-world sustained load conditions, not short-burst benchmarks.</p>
<h3>Processor Specifications</h3>
<p>Processor: AMD Ryzen 9 7945HX, Zen 4 architecture, 16 cores / 32 threads, base clock 2.5GHz, boost to 5.7GHz, configurable TDP 35W–65W, L3 cache 64MB. Under sustained 65W TDP configuration, all-core sustained boost observed at 4.4GHz in thermal testing over 3-hour windows.</p>
<h3>Graphics Specifications</h3>
<p>GPU: NVIDIA RTX 4080 Laptop, Ada Lovelace (AD104), 175W Maximum Total Graphics Power, 9728 CUDA cores, 16GB GDDR6X on 256-bit memory bus at 18Gbps, DLSS 3 with Frame Generation, hardware ray tracing (3rd generation), AV1 hardware encode/decode support.</p>
<h3>Memory, Storage, Display, and Connectivity</h3>
<p>RAM: 32GB DDR5-5600, dual-channel, 2× SO-DIMM slots (user-accessible, 64GB max). Storage: 2TB Gen4 PCIe NVMe (7,400/6,500 MB/s R/W), 1× secondary M.2 2280 slot. Display: 15.6" IPS, 2560×1440, 240Hz, 3ms GTG, 100% DCI-P3, ΔE &lt; 2 factory calibrated, 500 nits peak, VESA DisplayHDR 400. Ports: 2× TB4 (USB-C, 40Gbps, DP 2.0, PD 140W), 2× USB-A 3.2 Gen2 (10Gbps), HDMI 2.1 (4K/120Hz), SD UHS-II, 3.5mm combo. Network: Wi-Fi 6E (802.11ax, tri-band), Bluetooth 5.3. Battery: 99.9Wh, tested to 13 hours mixed productivity workload.</p>
<ul><li>CPU: AMD Ryzen 9 7945HX — 5.7GHz boost, 16-core, 64MB L3, 65W max TDP</li>
<li>GPU: RTX 4080 Laptop — 175W TGP, 16GB GDDR6X, 9728 CUDA, DLSS 3</li>
<li>RAM: 32GB DDR5-5600, dual-channel, 2× SO-DIMM, 64GB maximum</li>
<li>Storage: 2TB Gen4 NVMe — 7,400 MB/s read, secondary M.2 slot available</li>
<li>Display: 240Hz QHD IPS — 100% DCI-P3, ΔE &lt; 2, HDR400, 500 nits</li>
<li>Battery: 99.9Wh — 13 hours validated under mixed workload (not idle)</li></ul>`,

  // ── Collection description HTML previews ─────────────────────────────────────
  "col-problem-solution": `<h2>A Gaming Laptop Collection That Solves Real Performance Problems</h2>
<p>Every laptop in our <strong>Performance Gaming Laptops</strong> collection was selected to address the issues that frustrate gamers and creators most: thermal throttling, inconsistent sustained performance, and hardware that chronically underdelivers on its marketed specifications once you move past short-burst benchmarks.</p>
<h3>The Problems We Built This Collection Around</h3>
<p>After analysing thousands of customer support tickets and product return reasons across the past two years, three issues appeared in over 80% of complaints: overheating under extended load, frame rate inconsistency during long sessions, and inadequate storage capacity for modern game libraries and creative project files.</p>
<p>Every product in this collection demonstrably addresses all three. Each model has been validated under 2-hour sustained CPU and GPU combined load testing. None throttle below 90% of rated performance within that window. This is the minimum performance bar for inclusion.</p>
<h3>Solutions at Every Price Point</h3>
<p>The collection spans four categories — Flagship Gaming (RTX 4080–4090), Creator Notebooks (calibrated displays, RTX 4070–4080), Business Ultrabooks (sub-1.5kg, 14hr battery), and Budget Gaming (RTX 4060 from under $900) — so you can find the right solution whether your budget is $800 or $2,500.</p>
<ul><li>Flagship Gaming — zero-throttle RTX 4080–4090 for the most demanding titles</li>
<li>Creator Notebooks — factory-calibrated DCI-P3 displays for professional colour work</li>
<li>Business Ultrabooks — sub-1.5kg, 14+ hour battery, full connectivity</li>
<li>Budget Gaming — verified RTX 4060 performance under $900</li>
<li>All models validated at 90%+ sustained performance over 2-hour load tests</li></ul>`,

  "col-technical-specifications": `<h2>Performance Gaming Laptops — Hardware Overview</h2>
<p>The <strong>Performance Gaming Laptops</strong> collection covers the full range of validated high-performance mobile platforms, from AMD Ryzen 7 / RTX 4060 entry configurations through to Ryzen 9 / RTX 4090 flagship builds. All models are independently validated to meet their published thermal and performance specifications under sustained real-world load conditions.</p>
<h3>Processor Coverage</h3>
<p>This collection includes both AMD (Ryzen 7000 and 8000 Series) and Intel (13th–14th Gen Core HX) platform options, allowing buyers to choose their preferred architecture without compromising on GPU tier. TDP configurations range from 45W to 65W on CPU, adjusted per chassis thermal design.</p>
<h3>Graphics and TGP Ratings</h3>
<p>All NVIDIA Ada Lovelace GPU tiers are represented: RTX 4060 (80W TGP), RTX 4070 (125W TGP), RTX 4080 (175W TGP), and RTX 4090 (175W TGP). TGP rating is explicitly listed for every model — because TGP directly determines real-world performance in sustained workloads, and we don't hide it.</p>
<h3>Display and Connectivity Standards</h3>
<p>All included laptops feature IPS or OLED panels at 1080p or higher resolution, with refresh rates from 144Hz to 360Hz. Minimum connectivity for inclusion: one Thunderbolt 4 or USB4 port, Wi-Fi 6E, and a minimum 80Wh battery. Every model lists the full port specification in the product detail page.</p>
<ul><li>GPU range: RTX 4060 (80W) through RTX 4090 (175W TGP) — TGP listed on all models</li>
<li>Displays: 144Hz–360Hz, 1080p to QHD/4K, IPS and OLED options available</li>
<li>All models include Wi-Fi 6E and a minimum 80Wh battery</li>
<li>Thunderbolt 4 or USB4 required on all models in this collection</li>
<li>Sustained performance validated — not just peak benchmark data</li></ul>`,

  "col-lifestyle-integration": `<h2>Gaming Laptops for Every Part of Your Life</h2>
<p>The <strong>Performance Gaming Laptops</strong> collection was curated for people who don't want to carry separate machines for work, creative projects, and play. Every laptop here is powerful enough for serious gaming, refined enough for professional use, and portable enough to go wherever you go without becoming a burden.</p>
<h3>Work and Creative Use — Full Professional Capability</h3>
<p>When connected to your desk setup via Thunderbolt 4, these machines drive dual external monitors, handle demanding professional creative software — Premiere Pro, DaVinci Resolve, Blender, AutoCAD — and run cool enough for a full day of office work without fan noise becoming a distraction. The same machine that runs your gaming is the one you take to client meetings.</p>
<h3>On the Road — Built to Travel</h3>
<p>Thin-and-light configurations in this collection weigh under 2kg with chassis profiles under 20mm. Battery life reaches 13–14 hours on the ultrabook-class models in the range. Whether you're working from a coffee shop, a long flight, or a hotel room, your full capability travels with you — no compromises, no remote desktop workarounds.</p>
<h3>Gaming and Entertainment — No Compromise Required</h3>
<p>240Hz and higher displays mean your gaming sessions look as good as the dedicated monitor setups they replace. The RTX 4080 and RTX 4090 configurations in this range sustain their rated performance for multi-hour sessions — the core requirement for any serious gaming use case.</p>
<ul><li>Gaming configurations — sustained frame rates over multi-hour sessions</li>
<li>Creator notebooks — studio-accurate colour and GPU rendering power</li>
<li>Ultrabooks — sub-1.5kg, 14hr battery, Thunderbolt 4 connectivity</li>
<li>Budget gaming — capable RTX 4060 performance for realistic price points</li>
<li>All models validated for both sustained workloads and gaming sessions</li></ul>`,

  "col-eco-friendly-product": `<h2>Performance Laptops Built With Sustainability in Mind</h2>
<p>Every product in our <strong>Performance Gaming Laptops</strong> collection has been evaluated for its environmental credentials alongside technical performance. We prioritise manufacturers and configurations that use recycled materials, energy-efficient power architectures, and responsible manufacturing practices — without compromising the performance that justifies the purchase.</p>
<h3>Certification Standards Across the Range</h3>
<p>All laptops in this collection are EPEAT Gold or Silver certified, RoHS compliant, and meet or exceed current Energy Star efficiency standards under both idle and active workload conditions. Every manufacturer represented in this collection operates under ISO 14001 environmental management certification. Packaging across the range uses 100% recyclable materials with a commitment to zero single-use plastics.</p>
<h3>Longevity as Sustainability</h3>
<p>The most environmentally significant choice a hardware buyer can make is extending the life of their device. We specifically include laptops with user-accessible, upgradeable memory and storage slots — so a machine bought today can be relevantly capable five years from now, without purchasing a replacement. Every manufacturer represented here offers at least a 2-year warranty, and most offer 3-year coverage.</p>
<ul><li>All models EPEAT Gold or Silver certified — environmental lifecycle verified</li>
<li>RoHS compliant across the full range — no restricted hazardous substances</li>
<li>100% recyclable packaging from all manufacturers in this collection</li>
<li>User-upgradeable RAM and SSD configurations available at every price tier</li>
<li>ISO 14001 manufacturing certification required for inclusion in this collection</li>
<li>Minimum 2-year warranty across all included models — longevity by design</li></ul>`,

  "col-premium-luxury-product": `<h2>The Finest Gaming and Creator Laptops, Curated</h2>
<p>The <strong>Premium Performance Gaming Laptops</strong> collection brings together the highest-tier mobile platforms currently available — each selected for exceptional build quality, validated and consistent performance under sustained real-world load conditions, and an ownership experience that reflects genuine craftsmanship rather than premium pricing applied to ordinary hardware.</p>
<h3>Build Quality and Materials</h3>
<p>Every laptop in this collection features a full-metal chassis — CNC-machined aluminium, aerospace magnesium alloy, or carbon fibre composite — with premium surface finishes and precision tolerance assembly. Lid panels are uniformly metal. Hinge mechanisms are rated for 30,000+ open/close cycles. No plastic panels, no chassis flex, no compromise on physical quality.</p>
<h3>Display Standards</h3>
<p>Inclusion in this collection requires factory-calibrated displays at minimum 100% sRGB coverage. The majority of models achieve 100% DCI-P3 — the professional colour standard for film and broadcast. All displays are validated at minimum 400 nits brightness with VESA DisplayHDR certification where applicable. OLED options are available for buyers prioritising contrast and colour depth above all else.</p>
<h3>Warranty and Service</h3>
<p>All models in this collection carry minimum 3-year warranty coverage. Several manufacturers offer extended concierge-tier service plans with on-site support. This is a collection where the ownership experience after purchase matches the quality of the purchase itself.</p>
<ul><li>All-metal chassis — aluminium, magnesium alloy, or carbon fibre across every model</li>
<li>Factory-calibrated displays — minimum 100% sRGB, most achieving 100% DCI-P3</li>
<li>Premium keyboards with per-key RGB and high-quality switch mechanisms</li>
<li>3-year warranty as standard — with concierge service options available</li>
<li>All models validated under sustained load — not just peak-burst benchmarks</li></ul>`,

  "col-budget-friendly-product": `<h2>Real Gaming Performance. Honest Prices.</h2>
<p>The <strong>Performance Gaming Laptops</strong> collection proves you don't need to spend $2,000 to get a laptop that handles modern titles and creative workflows at a level that satisfies. Every model in this collection was selected based on verified price-to-performance ratios — measured under real workloads, not the marketing-optimised benchmark scenarios that make any hardware look good for 30 seconds.</p>
<h3>What the Entry Tier Actually Gets You</h3>
<p>RTX 4060 configurations with 144Hz full HD displays, 16GB DDR5 dual-channel RAM, and 512GB–1TB NVMe SSD storage are available from under $900 in this collection. These aren't budget compromises — they're configurations that run virtually every current game at high or ultra settings at 1080p with frame rates consistently above 60fps. The RTX 4060 is a capable GPU, not a consolation prize.</p>
<h3>Mid-Range Value</h3>
<p>The mid-range tier steps to RTX 4070 configurations with QHD display options and 1TB NVMe storage, priced under $1,200. This tier covers virtually all gaming and professional creative workflows that don't require extreme resolution rendering. These configurations consistently outperform alternatives at equivalent or higher prices in independent benchmark comparisons.</p>
<h3>What We Don't Compromise</h3>
<p>Every model in this collection ships with a full-size backlit keyboard, a 15.6" or larger display, at least two high-speed USB ports, and Wi-Fi 6 or better. No features are stripped to hit a price number. The connectivity and build quality are honest at every tier.</p>
<ul><li>Entry gaming: RTX 4060 configurations with 144Hz displays — from under $900</li>
<li>Mid-range: RTX 4070 + QHD display options — under $1,200</li>
<li>All models include full-size backlit keyboard and 15.6"+ display</li>
<li>Minimum Wi-Fi 6 and USB 3.2 connectivity across the range</li>
<li>Verified price-to-performance benchmarking — no marketing-inflated picks</li>
<li>User-upgradeable storage on most configurations — lower long-term cost</li></ul>`,

  "col-seasonal-limited-edition": `<h2>Limited Summer Release — Performance Gaming Laptops 2025</h2>
<p>For this season only, we've assembled the <strong>Summer Performance Gaming Collection</strong> — a carefully curated selection of the highest-demand configurations paired with exclusive bundle offers, pricing available only during this window, and expedited delivery options that aren't part of our standard fulfilment programme.</p>
<h3>What's Exclusive to This Release</h3>
<p>Every order placed during the Summer Collection window includes a free gaming peripheral bundle valued at $149 — comprising a full-size mechanical gaming keyboard, a gaming mouse, and a precision mousepad. This bundle is not available for separate purchase and is added automatically to qualifying orders with no promo code required.</p>
<p>Four configurations in this collection are genuinely not available in our standard catalogue: two exclusive chassis colourway options available only from this seasonal run, and two factory-tuned build specifications with upgraded RAM and storage configurations that won't be offered once this seasonal window closes.</p>
<h3>Delivery for This Window</h3>
<p>Standard delivery on Summer Collection orders is expedited to 2–3 business days. The express option guarantees next-business-day delivery on in-stock configurations. Orders placed before 2pm local time ship the same day during the collection period.</p>
<ul><li>Free $149 peripheral bundle (keyboard + mouse + pad) on every Summer Collection order</li>
<li>Four configurations exclusive to this seasonal window — unavailable after it closes</li>
<li>Expedited 2–3 day standard delivery; next-day express available</li>
<li>Summer Gaming League entry code — valued at $79, added automatically</li>
<li>Collection window closes when seasonal stock is exhausted — not on a fixed date</li></ul>`,

  "col-collection-comparison": `<h2>Find the Right Laptop for Your Specific Needs</h2>
<p>The <strong>Performance Gaming Laptops</strong> collection covers four distinct use-case categories at different price tiers. This guide is designed to help you identify which range matches your actual workload, realistic budget, and performance expectations — so you invest in the configuration that's right for you rather than the one with the biggest GPU number.</p>
<h3>Flagship Gaming — For Maximum Sustained Frame Rates</h3>
<p>RTX 4080 and RTX 4090 configurations at 175W TGP. Best for competitive gaming at 240Hz+, 4K titles at maximum settings, live streaming at high quality simultaneously with gameplay, and 3D rendering workloads where GPU VRAM matters. Price range: $1,400–$2,500. If your primary use case is competitive multiplayer at high refresh rates, this is your tier.</p>
<h3>Creator Notebooks — For Colour-Critical Work</h3>
<p>Factory-calibrated QHD and OLED displays, RTX 4070 to RTX 4080. Best for video editing at 4K, colour grading, 3D modelling, motion graphics, and photography at volume. The defining feature of this tier is the display — every model here is colour-accurate out of the box to professional standards. Price range: $1,200–$1,800.</p>
<h3>Business Ultrabooks and Budget Gaming</h3>
<p>Sub-1.5kg form factors with 14+ hour battery life for professionals who prioritise portability and productivity. Or RTX 4060 configurations from under $900 for capable gaming performance at a realistic price. Both tiers are honest value — no inflated claims.</p>
<ul><li>Flagship Gaming: RTX 4080–4090, 175W TGP, 240Hz+ display | $1,400–$2,500</li>
<li>Creator Notebooks: Calibrated displays, RTX 4070–4080 | $1,200–$1,800</li>
<li>Business Ultrabooks: Sub-1.5kg, 14hr+ battery, Thunderbolt 4 | from $899</li>
<li>Budget Gaming: RTX 4060, 144Hz, verified performance | from $799</li>
<li>All tiers: Wi-Fi 6E minimum, full-size keyboard, 15"+ display</li></ul>`,

  // ── Page body HTML previews ────────────────────────────────────────────────────
  "page-body-brand-story": `<h1>About Avada Tech</h1>
<p>Avada Tech was founded in San Francisco in 2018 by a team of engineers, industrial designers, and professional creators who shared one conviction: the gap between professional-grade computing hardware and pricing that working creators could actually justify had gone on long enough.</p>
<h2>Where It Started</h2>
<p>Our founding team of eleven came from backgrounds in semiconductor engineering, industrial product design, and professional content creation across video, 3D, and software development. Every one of us had experienced the same frustration — paying premium prices for laptops that throttled under sustained load, shipped with budget-grade displays, and used cooling architectures that the spec sheets never honestly described.</p>
<p>We'd all made the same decision independently: to look for a better option, find that it didn't exist at a reasonable price, and accept the compromise. We started Avada Tech to end that cycle — to build the machines we wished we could have bought, and to price them for the professionals who needed them.</p>
<h2>How We Build Differently</h2>
<p>Every Avada Tech product begins with a performance specification built around real professional workloads — 4K timeline exports, 3D rendering sessions, extended competitive gaming, software compilation. We engineer backwards from those requirements rather than starting with a target price and seeing how much performance we can fit inside it.</p>
<p>Our 85-person team keeps design, engineering, QA, and customer support under one roof in San Francisco. Every product that ships has been used, stress-tested, and approved by the people who built it. We do not outsource validation to third-party test labs and call that quality assurance.</p>
<h2>Our Commitment to You</h2>
<p>We stand behind every product we ship with a 3-year warranty, a 30-day no-questions-asked return policy, and a customer support team staffed by qualified engineers who have actually used the products they support. 50,000+ customers since 2018. If something isn't right, we make it right — no escalation loops, no automated responses.</p>`,

  "page-body-policy-clarity": `<h1>Returns and Refund Policy</h1>
<p>We want every Avada Tech purchase to be the right decision for you. If it isn't — for any reason — our returns policy is designed to make the process simple, transparent, and stress-free. No hidden conditions. No restocking fees. No customer service maze.</p>
<h2>30-Day Return Window</h2>
<p>All products purchased directly from Avada Tech can be returned within 30 days of the confirmed delivery date for a full refund to your original payment method, provided the product is unused and returned in its original packaging with all included accessories. No restocking fees apply to standard returns under these conditions.</p>
<p>To initiate a return, contact our team at returns@avadatech.com, use the self-service returns portal in your account dashboard, or call +1 (415) 800-4200 during business hours. We'll generate a prepaid return label within one business hour.</p>
<h2>Opened or Partially Used Products</h2>
<p>Products that have been opened but used fewer than five times and show no signs of physical damage may be eligible for return within 14 days of delivery. Please contact our support team to discuss your specific situation — we aim to resolve these cases individually and fairly.</p>
<h2>Faulty or Damaged Items</h2>
<p>If your product arrives damaged in transit, or develops a hardware fault during the warranty period, we will repair, replace, or refund — whichever resolves the issue most quickly for you. We do not require you to prove the fault was pre-existing. If the fault is reasonable and consistent with normal use, we resolve it.</p>
<h2>Refund Processing Timeline</h2>
<p>Once your return is received and inspected (typically within one business day of receipt), refunds are processed within 2 business days. Funds appear in your account within 3–5 business days depending on your card provider or payment method.</p>
<ul><li>Return window: 30 days from confirmed delivery date</li>
<li>Condition required: unused, in original packaging, with all accessories</li>
<li>Restocking fee: none</li>
<li>Refund processing: within 2 business days of return receipt</li>
<li>Faulty items: repair, replace, or refund — your choice</li>
<li>Prepaid return labels provided — no shipping cost on your side</li></ul>`,

  "page-body-faq-structured": `<h1>Frequently Asked Questions</h1>
<p>Answers to the questions we hear most often about Avada Tech products, orders, delivery, warranty, and support. If your question isn't answered here, contact our team at support@avadatech.com — we respond within 4 business hours.</p>
<h2>Orders and Shipping</h2>
<h3>How long does delivery take?</h3>
<p>Standard delivery: 3–5 business days. Express delivery (1–2 business days) is available at checkout for an additional fee. Overnight delivery is available for orders placed before 2pm local time. All orders include free standard shipping — no minimum spend.</p>
<h3>Can I modify or cancel my order after placing it?</h3>
<p>Orders can be modified or cancelled within 2 hours of placement before they enter our fulfilment pipeline. After that point, orders cannot be modified, but you can return the product within 30 days of delivery for a full refund. Contact support@avadatech.com immediately if you need to make a change.</p>
<h3>Do you ship internationally?</h3>
<p>Yes. We ship to 47 countries. International delivery typically takes 5–10 business days depending on destination. Import duties and taxes are the responsibility of the buyer and are not included in the product price.</p>
<h2>Products and Compatibility</h2>
<h3>Can I upgrade the RAM and storage on the UltraBook Pro X15?</h3>
<p>Yes. All UltraBook Pro models use socketed DDR5 SO-DIMM slots (not soldered) and include one or two accessible M.2 NVMe slots for storage expansion. Upgrade procedures do not void the warranty. Detailed step-by-step upgrade guides are available in our support documentation at avadatech.com/support.</p>
<h2>Warranty and Support</h2>
<h3>What exactly does the 3-year warranty cover?</h3>
<p>The warranty covers all hardware defects and component failures arising under normal use conditions. It does not cover physical damage from drops, liquid exposure, or modifications carried out by unauthorised service centres. Optional accidental damage protection plans are available at checkout and extend coverage to accidental damage scenarios for an additional 2 years.</p>`,

  "page-body-contact-conversion": `<h1>Get in Touch With Avada Tech</h1>
<p>Whether you have a question before purchasing, need technical support for an existing product, want enterprise or volume pricing, or have feedback about your experience — our team is here and responds within 4 business hours on every channel.</p>
<h2>Talk to a Specialist Before You Buy</h2>
<p>If you're not sure which configuration is right for your workflow, our product specialists are available for free 15-minute pre-sales consultations. We'll walk you through the options based on the applications you actually use, the specific workloads you run, and the budget you have available. No pressure. No upsell script. Just honest advice from people who use this hardware themselves.</p>
<p>Book a free consultation at <strong>avadatech.com/call</strong> — slots are available same-day or next-day in most time zones.</p>
<h2>Technical Support</h2>
<p>Existing customers can reach our technical support team through live chat in the account dashboard, by email at support@avadatech.com, or by phone at +1 (415) 800-4201. Our support team is staffed entirely by engineers who have used and tested the products they support — you won't be redirected to a script-reader.</p>
<p>Average first-response time: under 3 hours during business hours. Critical hardware issues are escalated to priority handling within 1 hour.</p>
<h2>Business and Enterprise Enquiries</h2>
<p>For volume orders of 5 or more units, fleet service management, custom configuration requests, or multi-site deployment support, contact our business team directly.</p>
<ul><li>Pre-sales consultation: avadatech.com/call — free, 15 minutes, no commitment</li>
<li>Technical support: support@avadatech.com | &lt;3hr response during business hours</li>
<li>Business and enterprise: business@avadatech.com | +1 (415) 800-4200</li>
<li>Live chat: available in your account dashboard, 9am–8pm PST</li>
<li>Phone support: +1 (415) 800-4201 | Mon–Fri, 9am–6pm PST</li></ul>`,

  "page-body-landing-offer": `<h1>Save 20% on the UltraBook Pro X15 — This Weekend Only</h1>
<p>For 72 hours starting Friday at 9am PST, every UltraBook Pro X15 configuration is discounted 20% from its standard listed price. No promo code required — the discount applies automatically at checkout to all configurations including the Signature and Creator Editions. This offer ends Sunday at midnight PST and will not be extended or replicated in this form.</p>
<h2>Everything That Comes With Every Weekend Order</h2>
<p>Every UltraBook Pro X15 ordered during this promotional window ships with three additions not included in standard orders: a free premium carry sleeve valued at $89, next-day express delivery at no additional cost (normally $49), and an extended 90-day return window on top of our standard 30-day policy. All three are added automatically at checkout for qualifying orders — no opt-in, no code, no minimum spend.</p>
<h2>Which Configuration Should You Choose?</h2>
<p>The <strong>Standard Edition</strong> (32GB DDR5 / 2TB NVMe) is offered at $1,199 this weekend, down from $1,499. This is the recommended configuration for most gaming, creative, and professional use cases.</p>
<p>The <strong>Creator Edition</strong> adds a factory-calibrated OLED display and steps to 64GB DDR5 — $1,439 this weekend, down from $1,799. Recommended for colour-critical professional creative workflows.</p>
<p>The <strong>Signature Edition</strong> (64GB / 4TB, exclusive chassis finish) is $1,759 this weekend, down from $2,199. For buyers who want the absolute best configuration available.</p>
<ul><li>20% off all configurations — applied automatically at checkout, no code needed</li>
<li>Free premium carry sleeve ($89 value) on every weekend order</li>
<li>Free next-day express delivery — normally $49, included automatically</li>
<li>Extended 90-day return window on all weekend orders</li>
<li>Standard Edition: $1,199 (save $300) | Creator Edition: $1,439 (save $360)</li>
<li>Offer ends Sunday midnight PST — no extensions, no rain checks</li></ul>`,

  "page-body-comparison": `<h1>UltraBook Pro X15 vs. the Competition</h1>
<p>Choosing a high-performance laptop is easier with a direct, specification-level comparison rather than isolated marketing claims. This page compares the UltraBook Pro X15 against the three laptops it is most frequently evaluated against by our customers — using independent benchmark data and real-world sustained load testing, not manufacturer-provided figures.</p>
<h2>UltraBook Pro X15 vs. Competitor A ($1,599)</h2>
<p>Competitor A ships with the same RTX 4080 GPU branding, but applies a 140W TGP configuration compared to the UltraBook Pro X15's 175W. In independent sustained load testing (TechReview Weekly, Q3 2024), this translates to a 22% performance gap after 30 minutes of continuous combined CPU and GPU rendering. By the 90-minute mark, the gap widens to 31% as Competitor A's thermal management enforces more aggressive throttling.</p>
<p>Competitor A also includes a 1-year standard warranty. The UltraBook Pro X15 includes 3 years as standard — a $180 value compared to third-party extended warranty pricing for Competitor A.</p>
<h2>UltraBook Pro X15 vs. Competitor B ($1,799)</h2>
<p>Competitor B is priced $300 higher and ships with 72% sRGB display calibration (no DCI-P3 coverage). For creative professionals, this means the purchase does not support colour-accurate workflows without an additional external monitor. The UltraBook Pro X15 ships factory-calibrated to 100% DCI-P3 at ΔE &lt; 2 at a lower total price.</p>
<p>Competitor B uses soldered RAM — permanently fixed at 32GB with no upgrade path. The UltraBook Pro X15 uses socketed DDR5, upgradeable to 64GB by the owner without voiding the warranty.</p>
<ul><li>vs. Competitor A: 22–31% higher sustained GPU output, 175W vs. 140W TGP, +2 warranty years</li>
<li>vs. Competitor B: 100% DCI-P3 vs. 72% sRGB; $300 lower price; upgradeable RAM</li>
<li>vs. Competitor C: 31% higher creative workload GPU performance (independent data)</li>
<li>Display: factory-calibrated DCI-P3 vs. uncalibrated sRGB panels in competing models</li>
<li>All performance comparisons sourced from TechReview Weekly independent benchmarks, Q3 2024</li></ul>`,

  // ── Collection description HTML previews (additional categories) ─────────────
  "col-gift-guide": `<h2>The Ultimate Gift Guide for Gamers and Creators</h2>
<p>Finding the perfect gift for the gamer, creator, or tech enthusiast in your life doesn't have to be stressful. The <strong>Performance Gaming Laptops</strong> collection includes options at every price point — from compact productivity machines to full-power creator workstations — so you can match the right hardware to the right person, every time.</p>
<h3>Gifts for the Serious Gamer</h3>
<p>For the gamer who needs performance and portability, our RTX 4080 flagship configurations deliver zero-throttle sustained frame rates in a chassis light enough for daily carry. The 240Hz QHD display, quad-speaker audio, and per-key RGB keyboard make this a gift that gets used every single day.</p>
<h3>Gifts for the Creative Professional</h3>
<p>For the video editor, photographer, or designer, our Creator Notebook tier offers factory-calibrated 100% DCI-P3 displays and RTX 4070–4080 GPU configurations that handle 4K timelines without proxy workflows. It's a gift that removes the friction from their most important work.</p>
<h3>Gifts for the Student or First-Timer</h3>
<p>The Budget Gaming tier, starting under $900, gives students and newcomers genuine RTX 4060 gaming performance, a 144Hz display, and reliable build quality — without requiring a premium-tier budget. A machine they'll use every day for years, without regrets.</p>
<ul><li>Gift price ranges: $799–$2,500 — options at every budget level</li>
<li>Every order ships in premium packaging — gift-ready presentation</li>
<li>Personalised gift card option available at checkout</li>
<li>Express delivery available for time-sensitive occasions</li>
<li>3-year warranty included — a gift that stays reliable for years</li>
<li>Free 30-day returns if the fit isn't right</li></ul>`,

  "col-new-arrivals": `<h2>Just Landed — New Performance Gaming Laptops</h2>
<p>The latest additions to the <strong>Performance Gaming Laptops</strong> collection are now live — setting a new standard for what a modern gaming and creator laptop can deliver. New hardware, refined thermals, updated display technology, and smarter connectivity, built from what our most demanding customers asked for.</p>
<h3>What's New This Season</h3>
<p>This collection introduces next-generation AMD Ryzen AI 9 and NVIDIA RTX 4080 Super configurations — delivering higher sustained all-core performance and improved AI-accelerated workflows at the same price points as last season's hardware. Three new chassis colourways and a redesigned keyboard layout debut across four of the new arrivals.</p>
<h3>New Display Technology</h3>
<p>Two models in this launch introduce OLED display panels with 2880×1800 resolution, 1ms pixel response, and individual per-unit ΔE &lt; 1 factory calibration. For creators who need colour accuracy and gamers who want perfect contrast, these are the most advanced display options we've offered at this price tier.</p>
<h3>Trending This Week</h3>
<p>The new Ryzen AI 9 / RTX 4080 Super configuration has become our fastest-moving new arrival in three years. Demand at launch week exceeded our stock forecast. If you want this configuration, ordering early is strongly advised — restock lead times are running six to eight weeks from our manufacturer.</p>
<ul><li>New Ryzen AI 9 and RTX 4080 Super configurations — available now</li>
<li>Three new chassis colourways exclusive to this launch window</li>
<li>OLED panel models: 2880×1800, 1ms, ΔE &lt; 1 factory calibrated</li>
<li>New arrivals ship within 3–5 business days from in-stock date</li>
<li>Notify me feature available for pre-order and restock alerts</li>
<li>All new models carry the full 3-year standard warranty</li></ul>`,

  "col-bestsellers-curated": `<h2>Our Best-Selling Gaming Laptops — Chosen by 50,000+ Customers</h2>
<p>The models in this collection aren't selected by our marketing team — they're determined by purchase volume, review scores, return rates, and repeat buyer data across more than 50,000 orders. If a laptop appears here, it's because our customers consistently chose it, kept it, and recommended it.</p>
<h3>Why These Are the Best-Sellers</h3>
<p>The top-selling UltraBook Pro X15 has held its #1 position for 14 consecutive months. The reason is consistent: it delivers its rated performance under sustained real-world workloads. Customers who bought it for gaming still use it for work. Customers who bought it for creative production use it for gaming. It doesn't compromise — and the reviews reflect that every week.</p>
<h3>The Editor's Picks</h3>
<p>Our product team maintains a curated list of models that deserve more attention than their sales rank alone suggests — configurations that receive the highest "would recommend to a friend" scores, machines that reviewers called out for outstanding specific capabilities that elevate them above the category average.</p>
<p>The current Editor's Pick for creator workflows is the Creator Notebook X15 OLED — for the display calibration alone. The pick for competitive gaming is the UltraBook Pro X15 240Hz configuration. Both carry 4.9-star ratings from over 800 verified reviews each.</p>
<ul><li>#1 best-seller: UltraBook Pro X15 — 14 consecutive months at top position</li>
<li>4.8-star average across all models in this collection</li>
<li>96% of buyers would recommend to a colleague or friend</li>
<li>Lowest return rate in category — below 2% across all models</li>
<li>Editor's Pick: Creator Notebook X15 OLED for colour-accurate workflows</li>
<li>All bestsellers carry 3-year warranty and 30-day returns as standard</li></ul>`,

  // ── Page body HTML previews (additional categories) ───────────────────────────
  "page-body-team": `<h1>Meet the Team Behind Avada Tech</h1>
<p>Avada Tech was built by engineers and creators who were, first and foremost, frustrated customers. Every person on our team has used the products they build in a professional context — which is why the products are built the way they are. We don't design hardware from a distance. We design it from personal experience.</p>
<h2>The Founding Team</h2>
<p>Our eleven-person founding team came from semiconductor engineering, industrial design, professional video production, competitive software development, and enterprise IT. The shared experience — hardware that didn't deliver on sustained professional workloads — drove us into the same room in San Francisco in 2018. Three years later, the UltraBook Pro X15 shipped.</p>
<h2>Engineering</h2>
<p><strong>Sarah Chen — Lead Systems Engineer.</strong> Sarah has spent 14 years in mobile computing hardware, previously at two major OEM manufacturers. She runs our thermal validation programme, which is why our laptops don't throttle. Before Avada Tech, she spent six months running sustained load tests on every competitor's flagship laptop and found the same failure in every one. That research became the foundation for our cooling architecture.</p>
<p><strong>Raj Patel — Senior Hardware Engineer.</strong> Raj focuses on display quality and colour validation. He worked in broadcast post-production equipment for eight years before joining Avada Tech, where he brought professional colour standards into laptop display production for the first time at this price point.</p>
<h2>Design and Customer Experience</h2>
<p><strong>Emma Larsson — Head of Product Design.</strong> Emma leads industrial design and the physical ownership experience — chassis, keyboard, haptics, packaging. She holds 12 patents in portable computing form factor design and has spoken at CES and Design Week on the intersection of durability engineering and premium aesthetics.</p>
<p>Our 85-person team is based in San Francisco. We're always looking for engineers and creators who want to build hardware they'll actually use themselves — see our open roles at avadatech.com/careers.</p>`,

  "page-body-testimonials": `<h1>What Our Customers Are Saying</h1>
<p>We don't curate our reviews to remove criticism. Every testimonial here reflects a real purchase, a real workload, and a real verdict. The pattern in these reviews isn't coincidental — it reflects what we set out to build.</p>
<h2>From Our Creative Community</h2>
<p><em>"I edit 4K documentary footage for a living. I've been through four laptops in the past three years — all throttled, all ran hot, all made me wait. The UltraBook Pro X15 is the first laptop where I finished a 6-hour export session and the fan speed at the end was the same as the beginning. I don't notice my laptop anymore. That's exactly what I needed."</em><br><strong>— Marcus T., Documentary Filmmaker, London. Verified purchase, 14 months of use.</strong></p>
<p><em>"The display calibration is what sold me. I do colour grading work and I've been working off an external monitor for years because no laptop display was accurate enough. The DCI-P3 calibration on the Creator Edition is genuinely good enough for professional delivery work. I haven't connected my external monitor in six months."</em><br><strong>— Priya K., Colourist and Motion Designer, Toronto. Verified purchase, 9 months of use.</strong></p>
<h2>From Gamers and Streamers</h2>
<p><em>"I stream at 1080p60 while playing competitively at the same time. The only laptop I found that can do both without a frame drop is the UltraBook Pro X15. The 240Hz display means I'm not compromising on competitive response time to create content. I genuinely couldn't have built my streaming channel without this machine."</em><br><strong>— Jake R., Gaming Content Creator, Austin. Verified purchase, 11 months of use.</strong></p>
<h2>Overall Ratings</h2>
<p>4.8 stars from 12,000+ verified reviews across five platforms. 96% of buyers would recommend to a colleague. Average review length: 340 words — indicating buyers have detailed, genuine experiences to share. Our highest-rated category, by significant margin, is sustained performance under real workloads.</p>
<ul><li>4.8★ average — 12,000+ verified reviews across five platforms</li>
<li>96% would recommend to a colleague or friend</li>
<li>Top reviewed attribute: sustained performance under real workloads</li>
<li>Lowest return rate in category — under 2% across all models</li>
<li>#1 TechReview Weekly, Digital Creator Awards Best Laptop 2025</li>
<li>Verified purchases only — no incentivised or unverified reviews shown</li></ul>`,

  "page-body-press-media": `<h1>Avada Tech in the Press</h1>
<p>Since 2023, Avada Tech has been covered by independent reviewers, technology publications, and industry organisations who tested our hardware against competing products under real-world conditions. We don't provide review units with special configurations. The laptops sent for review are identical to the ones you receive when you order.</p>
<h2>Recent Coverage</h2>
<p><em>"The UltraBook Pro X15 is the first gaming laptop we've tested that delivers zero thermal throttling under sustained combined CPU and GPU load. Every competitor we've tested in this class throttled within 20 minutes. The X15 ran our full 3-hour test at 99% of rated performance. That's not a minor difference — it's a fundamental engineering achievement at this price point."</em><br><strong>— TechReview Weekly, November 2024.</strong></p>
<p><em>"Avada Tech has done something the established players haven't: prioritised the performance outcome over the spec sheet. The X15's display calibration meets professional broadcast standards. The thermal management is genuinely class-leading. And the pricing makes it accessible to working creators, not just enterprises."</em><br><strong>— Digital Creator Awards, Best Creator Laptop 2025.</strong></p>
<h2>Awards and Recognition</h2>
<ul><li>#1 Best Gaming Laptop — TechReview Weekly, 2024</li>
<li>Best Creator Laptop — Digital Creator Awards, 2025</li>
<li>Editors' Choice — Hardware Performance Review, Q3 2024</li>
<li>Innovation Award — Portable Computing Summit, 2024</li></ul>
<h2>Press Contact</h2>
<p>For review unit requests, interview enquiries, press accreditation, or press kit access, contact our communications team. We respond to all verified press enquiries within one business day.</p>
<p><strong>Press contact:</strong> press@avadatech.com<br><strong>Press kit and brand assets:</strong> avadatech.com/press<br><strong>Review unit requests:</strong> press@avadatech.com — include your publication name and circulation.</p>`,

  "page-body-size-guide": `<h1>Laptop Size and Specification Guide</h1>
<p>Choosing the right laptop size and specification for your actual use case is more important than choosing the biggest numbers available. This guide helps you match the right configuration to your real workflow, portability requirements, and budget — so you don't pay for hardware you don't need or settle for hardware that can't keep up.</p>
<h2>Display Size: What to Choose</h2>
<p><strong>13–14 inch:</strong> Maximum portability, battery life typically 12–15 hours, lightest chassis (under 1.4kg). Best for: travel professionals, students, office productivity. Compromises: smaller display and reduced GPU tier. Not ideal for long gaming sessions or colour-critical creative work on the built-in display.</p>
<p><strong>15–16 inch:</strong> The sweet spot for most users. Balances portability with a larger display, better speakers, and higher GPU tiers. The UltraBook Pro X15 fits this category. Weight: 1.8–2.2kg. Best for: gaming, video editing, daily professional use with occasional travel.</p>
<p><strong>17–18 inch:</strong> Maximum display size and highest sustained GPU performance. Less portable. Weight: 2.5–3.2kg. Best for: desktop replacement, stationary workstation-grade use, users who prioritise raw performance over carry weight.</p>
<h2>Specification by Use Case</h2>
<ul><li><strong>Gaming at 1080p / 144fps:</strong> RTX 4060, 16GB DDR5, 512GB NVMe minimum</li>
<li><strong>Gaming at QHD / 240fps:</strong> RTX 4070–4080, 32GB DDR5, 1TB NVMe</li>
<li><strong>4K Video Editing:</strong> RTX 4080, 32GB+ DDR5, 2TB NVMe, calibrated display</li>
<li><strong>3D Rendering / ML workloads:</strong> RTX 4080–4090, 64GB DDR5, 2TB+ NVMe</li>
<li><strong>Office and productivity:</strong> Integrated or RTX 4060, 16GB DDR5, 256GB+ SSD</li>
<li><strong>Not sure? Book a free 15-min consultation:</strong> avadatech.com/call</li></ul>
<h2>Measurement Notes</h2>
<p>All display sizes are measured diagonally across the screen surface. Chassis dimensions and weights listed on each product page are measured without the power adapter. If you're replacing an existing laptop, compare chassis dimensions directly — a 15.6" panel does not guarantee the same footprint across manufacturers. Contact our team if you need side-by-side dimension comparisons before purchasing.</p>`,
};

// ── SERP preview examples for SEO title templates ────────────────────────────
const SERP_TITLE_EXAMPLES = {
  // Product SEO titles
  "mt-benefit-first": "Zero Throttling, All-Day Performance | UltraBook Pro X15 Laptop",
  "mt-product-feature": "UltraBook Pro X15 Laptop – NVIDIA RTX 4080 | 240Hz QHD Display",
  "mt-intent-buy-now": "Buy UltraBook Pro X15 | Sustained RTX 4080 Performance",
  "mt-category-seo": "UltraBook Pro X15 Gaming Laptops | Avada Tech",
  "mt-problem-solution": "Stop Thermal Throttling with the UltraBook Pro X15",
  "mt-quality-value": "UltraBook Pro X15 – Premium Quality at Great Value",
  "mt-usage-occasion": "UltraBook Pro X15 for 4K Video Editing and Competitive Gaming",
  "mt-promo": "UltraBook Pro X15 | Free Carry Sleeve This Weekend Only",
  "mt-review-signal": "UltraBook Pro X15 – 4.8★ (12,000+ Reviews) | Top Performance",
  "mt-best-for-audience": "Best Gaming Laptop for Creators — UltraBook Pro X15",
  "mt-gift-intent": "UltraBook Pro X15 – Perfect Gift for the Creator in Your Life",
  // Collection SEO titles
  "col-mt-benefit-first": "Laptops That Never Throttle Under Load | Avada Tech Gaming",
  "col-mt-category-seo": "Performance Gaming Laptops | Shop at Avada Tech",
  "col-mt-shop-intent": "Shop Gaming Laptops | Avada Tech — 45+ Models In Stock",
  "col-mt-quality-focus": "Premium Gaming Laptops — Built to Professional Standards | Avada Tech",
  "col-mt-occasion-match": "Gaming Laptops for Creators, Students, and Professionals",
  "col-mt-problem-solution": "Fix Thermal Throttling — Shop Performance Gaming Laptops",
  "col-mt-seasonal": "Summer Gaming Laptop Sale 2025 | Avada Tech Collection",
  "col-mt-featured-angle": "RTX 4080 Gaming Laptops — Featured Collection | Avada Tech",
  // Page SEO titles
  "page-mt-intent-keyword": "Buy High-Performance Gaming Laptops | Avada Tech Official",
  "page-mt-brand-keyword": "About Avada Tech — Premium Laptop Manufacturer Since 2018",
  "page-mt-action-benefit": "Get Your Gaming Laptop — Upgrade to Real Performance Today",
  "page-mt-question-style": "Which Gaming Laptop Is Best for Creators? | Avada Tech",
  "page-mt-trust": "Trusted by 50,000+ Customers | Avada Tech Gaming Laptops",
};

// ── SERP preview examples for SEO description templates ──────────────────────
const SERP_DESCRIPTION_EXAMPLES = {
  // Product SEO descriptions
  "md-basic-benefit": "UltraBook Pro X15 — zero thermal throttling under sustained load, 240Hz QHD display, RTX 4080 GPU. Trusted by 12,000+ creators. Free shipping. Shop now!",
  "md-problem-solution": "Solve lag and overheating with the UltraBook Pro X15. RTX 4080 GPU sustains full performance for hours with zero throttling. Free shipping. Shop now!",
  "md-feature-promo": "UltraBook Pro X15: NVIDIA RTX 4080 GPU &amp; 240Hz QHD Display. Free carry sleeve with every order this week. Buy today!",
  "md-premium-quality": "Premium UltraBook Pro X15 made with aerospace-grade aluminium and factory-calibrated DCI-P3 display. Sustained RTX 4080 performance. Order now!",
  "md-target-audience": "Perfect for video editors, gamers, and developers: UltraBook Pro X15 delivers zero-throttle performance for sustained professional workloads. Shop today!",
  "md-value-proposition": "UltraBook Pro X15: RTX 4080 performance at a mid-range total price. Zero thermal throttling guaranteed. Free shipping included. Get yours now!",
  "md-experience-based": "Experience sustained 4K rendering and smooth 240fps gaming with the UltraBook Pro X15. Zero throttling under all-day workloads. Shop now!",
  "md-feature-to-benefit": "UltraBook Pro X15 with 175W RTX 4080 TGP for faster renders and smoother frame rates than any similarly-priced alternative. Try it today!",
  "md-usage-occasion": "UltraBook Pro X15: perfect for 4K video editing, live streaming, and competitive gaming. RTX 4080 GPU, 240Hz QHD display. Shop now!",
  "md-elevation": "Elevate your creative workflow with the UltraBook Pro X15. Zero thermal throttling, studio-calibrated display, and all-day battery. Order today!",
  "md-discovery": "Discover zero-throttle sustained performance in the UltraBook Pro X15. RTX 4080 GPU maintains full output for hours. Limited stock — shop now!",
  "md-variety-options": "UltraBook Pro X15 in 32GB and 64GB configurations for gaming, creation, and professional work. Factory-calibrated display on every model. Order today!",
  "md-guarantee-assurance": "UltraBook Pro X15: zero-throttle RTX 4080 performance. 30-day returns, 3-year warranty. Risk-free — trusted by 12,000+ customers. Shop today!",
  "md-gift-occasion": "The perfect graduation gift: UltraBook Pro X15. RTX 4080 gaming laptop with 240Hz QHD display. Free gift wrapping and express delivery available.",
  "md-social-proof": "Loved by 12,000+ creators: UltraBook Pro X15 delivers zero-throttle performance and studio-accurate colour. 4.8★ average rating. Shop now!",
  // Collection SEO descriptions
  "col-md-benefit-focused": "Shop our Performance Gaming Laptops collection — RTX 4060 to RTX 4090 configurations with zero-throttle performance. Free shipping on all orders. Find yours today!",
  "col-md-problem-solution": "Solve thermal throttling with our curated Performance Gaming Laptops. Every model validated under sustained load testing. Free shipping. Shop now!",
  "col-md-quality-centric": "Premium gaming laptops with factory-calibrated displays, all-metal chassis, and 3-year warranties. Browse our Performance Gaming collection today!",
  "col-md-experience": "Experience the difference between gaming laptops that throttle and ones that don't. Explore our Performance Gaming Laptops collection. Free shipping.",
  "col-md-occasion-based": "Find the perfect gaming laptop for graduation, work, or your next creative project. 45+ models in our Performance Gaming collection. Shop now!",
  "col-md-discovery": "Discover the gaming laptops that actually maintain their rated performance. Our curated collection starts from $799. Limited stock — shop now!",
  // Page SEO descriptions
  "page-md-benefit-first": "Shop high-performance gaming laptops from Avada Tech. Zero thermal throttling, factory-calibrated displays, 3-year warranties. Free shipping on all orders.",
  "page-md-problem-solution": "Struggling with a laptop that throttles under load? Avada Tech laptops sustain full performance. Learn more or contact our specialist team today.",
  "page-md-trust-signal": "Avada Tech — trusted by 50,000+ creators since 2018. See our story, our team, and why professionals choose our laptops for demanding work.",
  "page-md-concise-seo": "Avada Tech gaming laptops: RTX 4080 performance, DCI-P3 displays, 3-year warranties. Founded 2018. San Francisco. Free shipping worldwide.",
  "page-md-action-oriented": "Ready to upgrade? Browse Avada Tech's full gaming laptop lineup. Filter by GPU, display, and budget. Free shipping and 30-day returns on all orders.",
};

function getPreviewHtml(templateId, resourceId, typeId) {
  // SEO title → plain content preview
  if (typeId === "seo-title") {
    const title = SERP_TITLE_EXAMPLES[templateId];
    const defaultTitle = resourceId === "collection"
      ? "Performance Gaming Laptops | Avada Tech"
      : resourceId === "page"
        ? "About Avada Tech | Premium Gaming Laptops Since 2018"
        : "UltraBook Pro X15 Gaming Laptop | Avada Tech";
    return `<p>${title || defaultTitle}</p>`;
  }

  // SEO description → plain content preview
  if (typeId === "seo-description") {
    const desc = SERP_DESCRIPTION_EXAMPLES[templateId];
    const defaultDesc = resourceId === "collection"
      ? "Shop our curated Performance Gaming Laptops collection. RTX 4060–4090 configurations with validated sustained performance. Free shipping."
      : resourceId === "page"
        ? "Learn about Avada Tech — premium gaming and creator laptops since 2018. 3-year warranties, 30-day returns, and engineer-staffed support."
        : "UltraBook Pro X15 gaming laptop — RTX 4080, 240Hz QHD display, zero thermal throttling. Shop now with free shipping and 3-year warranty.";
    return `<p>${desc || defaultDesc}</p>`;
  }

  // Description / body → rendered HTML
  return TEMPLATE_PREVIEW_HTML[templateId] || null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ResourceBadge({ resource }) {
  return (
    <Badge tone={RESOURCE_BADGE_TONE[resource] || "new"}>
      {resource.charAt(0).toUpperCase() + resource.slice(1)}
    </Badge>
  );
}

function TemplateCard({ template, active, showResource, isCustom, isLoading, onPreview, onEdit, onDelete }) {
  return (
    <Card padding="0">
      <div style={{ display: "flex", flexDirection: "column" }}>
        {/* Preview area */}
        <div
          style={{
            maxHeight: 180,
            overflowY: "auto",
            padding: "12px 14px",
            borderBottom: "1px solid var(--p-color-border)",
            lineHeight: 1.55,
          }}
        >
          {template.template}
        </div>

        {/* Meta area */}
        <div
          style={{
            padding: "12px 14px",
            background: "var(--p-color-bg-surface-secondary)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <InlineStack align="space-between" blockAlign="start" wrap={false}>
            <BlockStack gap="100">
              <Text as="h3" variant="bodyMd" fontWeight="semibold">
                {template.name}
              </Text>
              <InlineStack gap="100" wrap>
                {showResource && <ResourceBadge resource={template.resource} />}
                {template.tone && (
                  <Badge tone="magic">{template.tone}</Badge>
                )}
                {template.language && (
                  <Badge tone="info">{template.language}</Badge>
                )}
                {template.exampleOutput && (
                  <Badge tone="warning">Few-shot</Badge>
                )}
              </InlineStack>
            </BlockStack>
            {active && <Badge tone="success">Active</Badge>}
          </InlineStack>

          <Text as="p" variant="bodySm" tone="subdued">
            {template.description}
          </Text>

          <InlineStack gap="150" align="start">
            <Button size="slim" onClick={onPreview} disabled={isLoading}>
              Preview
            </Button>
            {isCustom && (
              <>
                <Button size="slim" onClick={onEdit} disabled={isLoading}>
                  Edit
                </Button>
                <Button size="slim" tone="critical" onClick={onDelete} disabled={isLoading}>
                  Delete
                </Button>
              </>
            )}
          </InlineStack>
        </div>
      </div>
    </Card>
  );
}

function FilterBar({ resourceFilter, typeFilter, onResourceChange, onTypeChange }) {
  const [popoverActive, setPopoverActive] = useState(false);
  const selectedTypeLabel = TYPE_OPTIONS.find((o) => o.value === typeFilter)?.label || "Description";

  return (
    <Box padding="400" paddingBlockStart="300" paddingBlockEnd="300">
      <InlineStack align="space-between" blockAlign="center" wrap={false}>
        {/* Resource pills */}
        <InlineStack gap="150" wrap>
          {RESOURCE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => onResourceChange(f.id)}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                border: resourceFilter === f.id ? "2px solid #1a1a1a" : "1.5px solid #d1d5db",
                background: resourceFilter === f.id ? "#1a1a1a" : "#ffffff",
                color: resourceFilter === f.id ? "#ffffff" : "#374151",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: resourceFilter === f.id ? 600 : 500,
                transition: "all 0.2s ease",
                lineHeight: "1.5",
                boxShadow: resourceFilter === f.id ? "0 1px 3px rgba(0,0,0,0.12)" : "0 1px 2px rgba(0,0,0,0.05)",
              }}
            >
              {f.label}
            </button>
          ))}
        </InlineStack>

        {/* Type dropdown */}
        <Popover
          active={popoverActive}
          activator={
            <Button
              size="slim"
              disclosure
              variant="secondary"
              onClick={() => setPopoverActive((v) => !v)}
            >
              {selectedTypeLabel}
            </Button>
          }
          onClose={() => setPopoverActive(false)}
        >
          <ActionList
            items={TYPE_OPTIONS.map((opt) => ({
              content: opt.label,
              active: opt.value === typeFilter,
              onAction: () => {
                onTypeChange(opt.value);
                setPopoverActive(false);
              },
            }))}
          />
        </Popover>
      </InlineStack>
    </Box>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TemplatePage() {
  const { initialSelections, initialCustomTemplates } = useLoaderData();
  const persistFetcher = useFetcher();
  const persistPromiseRef = useRef(null);
  const shopify = useAppBridge();

  // Main tab: 0 = system, 1 = custom
  const [mainTab, setMainTab] = useState(0);

  // Shared filters
  const [resourceFilter, setResourceFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("description");

  // Selection state (DB-backed, mirrored to localStorage for compatibility)
  const [productSelection, setProductSelection] = useState(() => initialSelections.product);
  const [collectionSelection, setCollectionSelection] = useState(() => initialSelections.collection);
  const [pageSelection, setPageSelection] = useState(() => initialSelections.page);

  // Preview modal
  const [previewData, setPreviewData] = useState(null);

  // Custom templates
  const [customTemplates, setCustomTemplates] = useState(() => initialCustomTemplates);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(EMPTY_CUSTOM_FORM);
  const [formErrors, setFormErrors] = useState({});

  // Delete confirm
  const [deleteTargetId, setDeleteTargetId] = useState(null);

  // Loading state
  const [isLoading, setIsLoading] = useState(false);
  const [configMessage, setConfigMessage] = useState(null);

  function showConfigSavedMessage(text = "Configuration saved successfully.") {
    setConfigMessage({ tone: "success", text });
    setTimeout(() => setConfigMessage(null), 3000);
  }

  function showConfigErrorMessage(text = "Failed to save configuration.") {
    setConfigMessage({ tone: "critical", text });
    setTimeout(() => setConfigMessage(null), 4000);
  }

  useEffect(() => {
    // Keep localStorage in sync so generation pages that still read localStorage continue to work.
    writeStoredProductPromptTemplateSelection(initialSelections.product);
    writeStoredCollectionPromptTemplateSelection(initialSelections.collection);
    writeStoredPagePromptTemplateSelection(initialSelections.page);
    saveCustomTemplates(initialCustomTemplates);
  }, [initialSelections, initialCustomTemplates]);

  const selectionMap = useMemo(
    () => ({
      product: productSelection,
      collection: collectionSelection,
      page: pageSelection,
    }),
    [productSelection, collectionSelection, pageSelection],
  );

  useEffect(() => {
    const pending = persistPromiseRef.current;
    if (!pending) return;
    if (persistFetcher.state !== "idle") return;
    if (!persistFetcher.data || persistFetcher.data.requestId !== pending.requestId) return;

    persistPromiseRef.current = null;
    if (persistFetcher.data?.success) {
      pending.resolve(persistFetcher.data);
      return;
    }

    pending.reject(new Error(persistFetcher.data?.error || "Failed to persist template configuration."));
  }, [persistFetcher.state, persistFetcher.data]);

  async function persistTemplateConfiguration(nextSelections, nextCustomTemplates) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      persistPromiseRef.current = { resolve, reject, requestId };
      const payload = new FormData();
      payload.append("intent", "save_template_config");
      payload.append("requestId", requestId);
      payload.append("templateSelectionsJson", JSON.stringify(nextSelections));
      payload.append("customTemplatesJson", JSON.stringify(nextCustomTemplates));
      persistFetcher.submit(payload, { method: "post" });
    });
  }

  // ── Derived data ────────────────────────────────────────────────────────────

  const systemTemplates = useMemo(
    () => dedupeTemplatesByName(getSystemTemplates(resourceFilter, typeFilter)),
    [resourceFilter, typeFilter],
  );

  const filteredCustomTemplates = useMemo(() => {
    return dedupeTemplatesByName(customTemplates.filter((t) => {
      const resourceMatch = resourceFilter === "all" || t.resource === resourceFilter;
      const typeMatch = t.type === typeFilter;
      return resourceMatch && typeMatch;
    }));
  }, [customTemplates, resourceFilter, typeFilter]);

  // ── Apply template ──────────────────────────────────────────────────────────

  async function applyTemplate(template, resourceId, typeId) {
    if (!template || !resourceId || !typeId) return;

    // Builds the effective prompt by prepending tone/language overrides and
    // appending the few-shot example when they are set on a custom template.
    const effectivePrompt = buildEffectiveTemplate(template);

    setIsLoading(true);
    try {
      if (resourceId === "product") {
        const next = { ...productSelection };
        if (typeId === "description") {
          next.descriptionTemplateId = template.id;
          next.descriptionPromptTemplate = effectivePrompt;
        } else if (typeId === "seo-title") {
          next.metaTitleTemplateId = template.id;
          next.metaTitlePromptTemplate = effectivePrompt;
        } else if (typeId === "seo-description") {
          next.metaDescriptionTemplateId = template.id;
          next.metaDescriptionPromptTemplate = effectivePrompt;
        }
        const normalized = writeStoredProductPromptTemplateSelection(next);
        setProductSelection(normalized);
        await persistTemplateConfiguration(
          {
            product: normalized,
            collection: collectionSelection,
            page: pageSelection,
          },
          customTemplates,
        );
        showConfigSavedMessage();
        shopify.toast.show(`${template.name} applied to products.`);
        return;
      }

      if (resourceId === "collection") {
        const next = { ...collectionSelection };
        if (typeId === "description") {
          next.descriptionTemplateId = template.id;
          next.descriptionPromptTemplate = effectivePrompt;
        } else if (typeId === "seo-title") {
          next.metaTitleTemplateId = template.id;
          next.metaTitlePromptTemplate = effectivePrompt;
        } else if (typeId === "seo-description") {
          next.metaDescriptionTemplateId = template.id;
          next.metaDescriptionPromptTemplate = effectivePrompt;
        }
        const normalized = writeStoredCollectionPromptTemplateSelection(next);
        setCollectionSelection(normalized);
        await persistTemplateConfiguration(
          {
            product: productSelection,
            collection: normalized,
            page: pageSelection,
          },
          customTemplates,
        );
        showConfigSavedMessage();
        shopify.toast.show(`${template.name} applied to collections.`);
        return;
      }

      if (resourceId === "page") {
        const next = { ...pageSelection };
        if (typeId === "description") {
          next.bodyTemplateId = template.id;
          next.bodyPromptTemplate = effectivePrompt;
        } else if (typeId === "seo-title") {
          next.metaTitleTemplateId = template.id;
          next.metaTitlePromptTemplate = effectivePrompt;
        } else if (typeId === "seo-description") {
          next.metaDescriptionTemplateId = template.id;
          next.metaDescriptionPromptTemplate = effectivePrompt;
        }
        const normalized = writeStoredPagePromptTemplateSelection(next);
        setPageSelection(normalized);
        await persistTemplateConfiguration(
          {
            product: productSelection,
            collection: collectionSelection,
            page: normalized,
          },
          customTemplates,
        );
        showConfigSavedMessage();
        shopify.toast.show(`${template.name} applied to pages.`);
        return;
      }
    } catch (error) {
      showConfigErrorMessage(error?.message || "Failed to save configuration.");
      shopify.toast.show(error?.message || "Failed to apply template.");
    } finally {
      setIsLoading(false);
    }
  }

  async function copyText(value, label) {
    if (!value) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      }
      shopify.toast.show(`${label} copied.`);
    } catch {
      shopify.toast.show(`Failed to copy.`);
    }
  }

  // ── Custom template form ────────────────────────────────────────────────────

  function openCreateModal() {
    setEditingId(null);
    setFormData(EMPTY_CUSTOM_FORM);
    setFormErrors({});
    setShowFormModal(true);
  }

  function openEditModal(template) {
    setEditingId(template.id);
    setFormData({
      name: template.name,
      description: template.description || "",
      resource: template.resource,
      type: template.type,
      template: template.template,
      tone: template.tone || "",
      language: template.language || "",
      exampleOutput: template.exampleOutput || "",
    });
    setFormErrors({});
    setShowFormModal(true);
  }

  function validateForm() {
    const errors = {};
    if (!formData.name.trim()) errors.name = "Template name is required.";
    if (!formData.template.trim()) errors.template = "Template content is required.";
    return errors;
  }

  async function handleFormSave() {
    const errors = validateForm();
    if (Object.keys(errors).length) {
      setFormErrors(errors);
      return;
    }

    setIsLoading(true);
    try {
      if (editingId) {
        const updated = customTemplates.map((t) =>
          t.id === editingId ? { ...t, ...formData } : t,
        );
        const normalized = saveCustomTemplates(updated);
        setCustomTemplates(normalized);
        await persistTemplateConfiguration(
          {
            product: productSelection,
            collection: collectionSelection,
            page: pageSelection,
          },
          normalized,
        );
        showConfigSavedMessage();
        shopify.toast.show("Custom template updated.");
      } else {
        const newEntry = {
          id: `custom-${Date.now()}`,
          ...formData,
          createdAt: Date.now(),
        };
        const updated = [...customTemplates, newEntry];
        const normalized = saveCustomTemplates(updated);
        setCustomTemplates(normalized);
        await persistTemplateConfiguration(
          {
            product: productSelection,
            collection: collectionSelection,
            page: pageSelection,
          },
          normalized,
        );
        showConfigSavedMessage();
        shopify.toast.show("Custom template created.");
      }
      setShowFormModal(false);
    } catch (error) {
      showConfigErrorMessage(error?.message || "Failed to save configuration.");
      shopify.toast.show(error?.message || "Failed to save custom template.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(templateId) {
    setIsLoading(true);
    try {
      const updated = customTemplates.filter((t) => t.id !== templateId);
      const normalized = saveCustomTemplates(updated);
      setCustomTemplates(normalized);
      await persistTemplateConfiguration(
        {
          product: productSelection,
          collection: collectionSelection,
          page: pageSelection,
        },
        normalized,
      );
      showConfigSavedMessage();
      setDeleteTargetId(null);
      shopify.toast.show("Custom template deleted.");
    } catch (error) {
      showConfigErrorMessage(error?.message || "Failed to save configuration.");
      shopify.toast.show(error?.message || "Failed to delete custom template.");
    } finally {
      setIsLoading(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const isSystemTab = mainTab === 0;
  const templates = isSystemTab ? systemTemplates : filteredCustomTemplates;
  const showResourceBadge = resourceFilter === "all";

  // HTML preview for the modal — rendered output example per template
  const htmlPreview = useMemo(
    () => previewData
      ? getPreviewHtml(previewData.id, previewData.resourceId, previewData.filterId)
      : null,
    [previewData],
  );

  // Fallback structured preview when no HTML preview is available
  const generatedPreview = useMemo(
    () => (!htmlPreview && previewData)
      ? buildStructuredPreview(previewData.template || "", previewData.name || "")
      : null,
    [htmlPreview, previewData],
  );

  const descriptionPreview = useMemo(() => {
    if (!previewData || previewData.filterId !== "description") return "";
    return buildDescriptionStructuredPreview(previewData, previewData?.name || "", {
      resourceId: previewData?.resourceId || "",
    });
  }, [previewData]);

  const metaPreviewText = useMemo(() => {
    if (!previewData) return "";
    if (previewData.filterId !== "seo-title" && previewData.filterId !== "seo-description") return "";
    return buildMetaPreviewText(previewData);
  }, [previewData]);

  return (
    <>
      {isLoading && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <Spinner accessibilityLabel="Loading" size="large" />
            <Text as="p" variant="bodySm" tone="subdued">
              Processing...
            </Text>
          </div>
        </div>
      )}
      <Page
      fullWidth
      title="Templates"
      subtitle="Manage prompt templates for AI content generation."
    >
      <AppPageHeader
        title="Templates"
        description="Manage prompt templates for AI content generation."
      />
      {configMessage && (
        <div style={{ marginBottom: "16px" }}>
          <Banner tone={configMessage.tone}>
            <Text as="p">{configMessage.text}</Text>
          </Banner>
        </div>
      )}
      <Layout>
        {/* Main tabs */}
        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={MAIN_TABS} selected={mainTab} onSelect={setMainTab} />
            <Divider />

            {/* Tab header */}
            <Box padding="400" paddingBlockEnd="0">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    {isSystemTab ? "System templates" : "Custom templates"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {isSystemTab
                      ? "Customize and organize your content generation templates"
                      : "Create and manage your own prompt templates"}
                  </Text>
                </BlockStack>
                {!isSystemTab && (
                  <Button variant="primary" size="slim" onClick={openCreateModal} disabled={isLoading}>
                    Create template
                  </Button>
                )}
              </InlineStack>
            </Box>

            {/* Filter bar */}
            <FilterBar
              resourceFilter={resourceFilter}
              typeFilter={typeFilter}
              onResourceChange={setResourceFilter}
              onTypeChange={setTypeFilter}
            />
          </Card>
        </Layout.Section>

        {/* Template grid */}
        <Layout.Section>
          {templates.length === 0 ? (
            <Card>
              <EmptyState
                heading={
                  isSystemTab
                    ? "No templates for this filter"
                    : "No custom templates yet"
                }
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={
                  !isSystemTab && !isLoading
                    ? { content: "Create template", onAction: openCreateModal }
                    : undefined
                }
              >
                <Text as="p" variant="bodySm" tone="subdued">
                  {isSystemTab
                    ? "Try selecting a different resource or content type."
                    : "Create your first custom prompt template to use in AI generation."}
                </Text>
              </EmptyState>
            </Card>
          ) : (
            <div
              className="app-card-grid"
              style={{ gap: 16, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
            >
              {templates.map((template) => {
                const res = template.resource;
                const activeId = getActiveTemplateId(res, typeFilter, selectionMap);
                return (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    active={activeId === template.id}
                    showResource={showResourceBadge}
                    isCustom={!isSystemTab}
                    isLoading={isLoading}
                    onPreview={() =>
                      setPreviewData({
                        ...template,
                        resourceId: res,
                        filterId: typeFilter,
                      })
                    }
                    onEdit={() => openEditModal(template)}
                    onDelete={() => setDeleteTargetId(template.id)}
                  />
                );
              })}
            </div>
          )}
        </Layout.Section>
      </Layout>

      {/* ── Preview Modal ──────────────────────────────────────────────────── */}
      <Modal
        open={Boolean(previewData)}
        onClose={() => setPreviewData(null)}
        title={previewData?.name || "Template Preview"}
        large
      >
        <Modal.Section>
          <BlockStack gap="400">
            {/* Badges + description */}
            <BlockStack gap="150">
              <InlineStack gap="200" blockAlign="center">
                {previewData?.resource && <ResourceBadge resource={previewData.resource} />}
                <Badge>{typeLabel(previewData?.filterId || "description")}</Badge>
              </InlineStack>
              {previewData?.description && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {previewData.description}
                </Text>
              )}
            </BlockStack>

            {/* ── Example output ───────────────────────────────────────────── */}
            <BlockStack gap="150">
              {metaPreviewText ? (
                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "20px 24px",
                    background: "#fafafa",
                  }}
                >
                  <BlockStack gap="150">
                    <Text as="h3" variant="headingSm" fontWeight="bold">
                      {previewData?.filterId === "seo-title" ? "Meta Title Preview:" : "Meta Description Preview:"}
                    </Text>
                    <div
                      style={{
                        background: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                        padding: "14px 16px",
                        fontSize: "14px",
                        lineHeight: "1.6",
                        color: "#374151",
                      }}
                    >
                      {metaPreviewText}
                    </div>
                  </BlockStack>
                </div>
              ) : htmlPreview ? (
                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "20px 24px",
                    background: "#fafafa",
                    lineHeight: "1.6",
                  }}
                  // Safe: content is authored statically in this file, never user input
                  dangerouslySetInnerHTML={{ __html: wrapHtml(htmlPreview) }}
                />
              ) : previewData?.filterId === "description" && descriptionPreview ? (
                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "20px 24px",
                    background: "#fafafa",
                  }}
                >
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm" fontWeight="bold">
                      Descriptions will look like this:
                    </Text>
                    <div
                      style={{
                        background: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                        padding: "14px 16px",
                      }}
                    >
                      <BlockStack gap="200">
                        <BlockStack gap="050">
                          <Text as="h3" variant="headingMd" fontWeight="bold">
                            {descriptionPreview.heading}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {descriptionPreview.subheading}
                          </Text>
                        </BlockStack>
                        {descriptionPreview.sections.map((section) => (
                          <BlockStack key={section.title} gap="100">
                            <Text as="h4" variant="headingSm" fontWeight="semibold">
                              {section.title}
                            </Text>
                            {section.paragraphs.map((paragraph, idx) => (
                              <Text key={`${section.title}-p-${idx}`} as="p" variant="bodyMd">
                                {paragraph}
                              </Text>
                            ))}
                            {section.points.length > 0 && (
                              <ul style={{ margin: 0, paddingLeft: "20px" }}>
                                {section.points.map((point, idx) => (
                                  <li key={`${section.title}-pt-${idx}`} style={{ marginBottom: "6px" }}>
                                    <Text as="span" variant="bodyMd">{point}</Text>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </BlockStack>
                        ))}
                      </BlockStack>
                    </div>
                  </BlockStack>
                </div>
              ) : generatedPreview ? (
                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "20px 24px",
                    background: "#fafafa",
                  }}
                >
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingMd" fontWeight="bold">
                        {generatedPreview.heading}
                      </Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        {generatedPreview.subheading}
                      </Text>
                    </BlockStack>
                    {generatedPreview.sections.map((section) => (
                      <BlockStack key={section.title} gap="150">
                        <Text as="h4" variant="headingSm">{section.title}</Text>
                        {section.paragraphs.map((paragraph, idx) => (
                          <Text key={`${section.title}-p-${idx}`} as="p" variant="bodyMd">
                            {paragraph}
                          </Text>
                        ))}
                        {section.points.length > 0 && (
                          <ul style={{ margin: "0", paddingLeft: "20px" }}>
                            {section.points.map((point, idx) => (
                              <li key={`${section.title}-pt-${idx}`} style={{ marginBottom: "6px" }}>
                                <Text as="span" variant="bodyMd">{point}</Text>
                              </li>
                            ))}
                          </ul>
                        )}
                      </BlockStack>
                    ))}
                  </BlockStack>
                </div>
              ) : null}
            </BlockStack>

            {/* Actions */}
            <InlineStack align="end" gap="200">
              <Button size="slim" onClick={() => setPreviewData(null)} disabled={isLoading}>
                Close
              </Button>
            </InlineStack>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* ── Create / Edit Custom Template Modal ───────────────────────────── */}
      <Modal
        open={showFormModal}
        onClose={() => setShowFormModal(false)}
        title={editingId ? "Edit custom template" : "Create custom template"}
        primaryAction={{ content: "Save", onAction: handleFormSave, disabled: isLoading }}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowFormModal(false), disabled: isLoading }]}
        large
      >
        <Modal.Section>
          <FormLayout>
            <FormLayout.Group>
              <Select
                label="Resource"
                options={RESOURCE_SELECT_OPTIONS}
                value={formData.resource}
                onChange={(v) => setFormData((p) => ({ ...p, resource: v }))}
                disabled={isLoading}
              />
              <Select
                label="Content type"
                options={TYPE_OPTIONS}
                value={formData.type}
                onChange={(v) => setFormData((p) => ({ ...p, type: v }))}
                disabled={isLoading}
              />
            </FormLayout.Group>
            <TextField
              label="Template name"
              value={formData.name}
              onChange={(v) => setFormData((p) => ({ ...p, name: v }))}
              error={formErrors.name}
              autoComplete="off"
              disabled={isLoading}
            />
            <TextField
              label="Description"
              value={formData.description}
              onChange={(v) => setFormData((p) => ({ ...p, description: v }))}
              autoComplete="off"
              helpText="Short description of what this template is for."
              disabled={isLoading}
            />
            <FormLayout.Group>
              <Select
                label="Tone preference (optional)"
                options={TONE_OPTIONS}
                value={formData.tone}
                onChange={(v) => setFormData((p) => ({ ...p, tone: v }))}
                helpText="Override the default tone for AI generation when this template is used."
                disabled={isLoading}
              />
              <TextField
                label="Language (optional)"
                value={formData.language}
                onChange={(v) => setFormData((p) => ({ ...p, language: v }))}
                placeholder="e.g. French, Spanish, German"
                helpText="Generate content in a specific language when this template is applied."
                autoComplete="off"
                disabled={isLoading}
              />
            </FormLayout.Group>
            <TextField
              label="Template content"
              value={formData.template}
              onChange={(v) => setFormData((p) => ({ ...p, template: v }))}
              error={formErrors.template}
              multiline={10}
              autoComplete="off"
              helpText="Use [brackets] for structure placeholders and {curly_braces} for dynamic values."
              monospaced
              disabled={isLoading}
            />
            <TextField
              label="Example output (optional — few-shot prompting)"
              value={formData.exampleOutput}
              onChange={(v) => setFormData((p) => ({ ...p, exampleOutput: v }))}
              multiline={6}
              autoComplete="off"
              helpText="Provide a reference example of ideal output. The AI will match this style and format (few-shot prompting)."
              disabled={isLoading}
            />
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* ── Delete Confirm Modal ───────────────────────────────────────────── */}
      <Modal
        open={Boolean(deleteTargetId)}
        onClose={() => setDeleteTargetId(null)}
        title="Delete custom template?"
        primaryAction={{
          content: "Delete",
          tone: "critical",
          onAction: () => handleDelete(deleteTargetId),
          disabled: isLoading,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteTargetId(null), disabled: isLoading }]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            This action cannot be undone. The template will be permanently removed.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
    </>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
