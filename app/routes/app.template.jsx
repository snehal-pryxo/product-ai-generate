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
  BLOG_BODY_TEMPLATES,
  BLOG_META_DESCRIPTION_TEMPLATES,
  BLOG_META_TITLE_TEMPLATES,
  getEmptyBlogTemplateSelection,
  writeStoredBlogPromptTemplateSelection,
} from "../lib/blogPromptTemplateLibrary";
import {
  PAGE_BODY_TEMPLATES,
  PAGE_META_DESCRIPTION_TEMPLATES,
  PAGE_META_TITLE_TEMPLATES,
  getEmptyPageTemplateSelection,
  writeStoredPagePromptTemplateSelection,
} from "../lib/pagePromptTemplateLibrary";

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
  { id: "blog", label: "Blog" },
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
  blog: "attention",
};

const RESOURCE_SELECT_OPTIONS = [
  { label: "Product", value: "product" },
  { label: "Collection", value: "collection" },
  { label: "Page", value: "page" },
  { label: "Blog", value: "blog" },
];

const CUSTOM_TEMPLATES_KEY = "custom_prompt_templates_v1";
const TEMPLATE_SELECTIONS_DEFAULT = {
  product: getEmptyTemplateSelection(),
  collection: getEmptyCollectionTemplateSelection(),
  page: getEmptyPageTemplateSelection(),
  blog: getEmptyBlogTemplateSelection(),
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
    blog: normalizeObjectStringFields(input.blog, TEMPLATE_SELECTIONS_DEFAULT.blog),
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
  blog: {
    description: BLOG_BODY_TEMPLATES,
    "seo-description": BLOG_META_DESCRIPTION_TEMPLATES,
    "seo-title": BLOG_META_TITLE_TEMPLATES,
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
  const isBodyResource = resourceId === "page" || resourceId === "blog";
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
  const [blogSelection, setBlogSelection] = useState(() => initialSelections.blog);

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
    writeStoredBlogPromptTemplateSelection(initialSelections.blog);
    saveCustomTemplates(initialCustomTemplates);
  }, [initialSelections, initialCustomTemplates]);

  const selectionMap = useMemo(
    () => ({
      product: productSelection,
      collection: collectionSelection,
      page: pageSelection,
      blog: blogSelection,
    }),
    [productSelection, collectionSelection, pageSelection, blogSelection],
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
            blog: blogSelection,
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
            blog: blogSelection,
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
            blog: blogSelection,
          },
          customTemplates,
        );
        showConfigSavedMessage();
        shopify.toast.show(`${template.name} applied to pages.`);
        return;
      }

      if (resourceId === "blog") {
        const next = { ...blogSelection };
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
        const normalized = writeStoredBlogPromptTemplateSelection(next);
        setBlogSelection(normalized);
        await persistTemplateConfiguration(
          {
            product: productSelection,
            collection: collectionSelection,
            page: pageSelection,
            blog: normalized,
          },
          customTemplates,
        );
        showConfigSavedMessage();
        shopify.toast.show(`${template.name} applied to blog posts.`);
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
            blog: blogSelection,
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
            blog: blogSelection,
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
          blog: blogSelection,
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
  const generatedPreview = useMemo(
    () => buildStructuredPreview(previewData?.template || "", previewData?.name || ""),
    [previewData],
  );

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
            <div className="app-card-grid" style={{ gap: 16 }}>
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
      >
        <Modal.Section>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              {previewData?.resource && <ResourceBadge resource={previewData.resource} />}
              <Badge>{typeLabel(previewData?.filterId || "description")}</Badge>
            </InlineStack>
            <Text as="p" variant="bodyMd" tone="subdued">
              {previewData?.description}
            </Text>
            <Card>
              <Box padding="300">
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
                      <Text as="h4" variant="headingSm">
                        {section.title}
                      </Text>

                      {section.paragraphs.map((paragraph, idx) => (
                        <Text key={`${section.title}-p-${idx}`} as="p" variant="bodyMd">
                          {paragraph}
                        </Text>
                      ))}

                      {section.points.length > 0 ? (
                        <ul style={{ margin: "0", paddingLeft: "20px" }}>
                          {section.points.map((point, idx) => (
                            <li key={`${section.title}-point-${idx}`} style={{ marginBottom: "6px" }}>
                              <Text as="span" variant="bodyMd">
                                {point}
                              </Text>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </BlockStack>
                  ))}
                </BlockStack>
              </Box>
            </Card>
            <InlineStack align="end" gap="200">
              <Button size="slim" onClick={() => setPreviewData(null)} disabled={isLoading}>
                Close
              </Button>
              <Button
                size="slim"
                onClick={() => copyText(previewData?.template || "", previewData?.name || "Template")}
                disabled={isLoading}
              >
                Copy
              </Button>
              <Button
                size="slim"
                variant="primary"
                onClick={() => {
                  if (!previewData) return;
                  applyTemplate(previewData, previewData.resourceId, previewData.filterId);
                  setPreviewData(null);
                }}
                disabled={isLoading}
              >
                Use Template
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
