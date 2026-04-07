import { useEffect, useMemo, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import {
  ActionList,
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
  clearStoredCollectionPromptTemplateSelection,
  writeStoredCollectionPromptTemplateSelection,
} from "../lib/collectionPromptTemplateLibrary";
import {
  PRODUCT_DESCRIPTION_TEMPLATES,
  PRODUCT_META_DESCRIPTION_TEMPLATES,
  PRODUCT_META_TITLE_TEMPLATES,
  getEmptyTemplateSelection,
  clearStoredProductPromptTemplateSelection,
  writeStoredProductPromptTemplateSelection,
} from "../lib/productPromptTemplateLibrary";
import {
  BLOG_BODY_TEMPLATES,
  BLOG_META_DESCRIPTION_TEMPLATES,
  BLOG_META_TITLE_TEMPLATES,
  getEmptyBlogTemplateSelection,
  clearStoredBlogPromptTemplateSelection,
  writeStoredBlogPromptTemplateSelection,
} from "../lib/blogPromptTemplateLibrary";
import {
  PAGE_BODY_TEMPLATES,
  PAGE_META_DESCRIPTION_TEMPLATES,
  PAGE_META_TITLE_TEMPLATES,
  getEmptyPageTemplateSelection,
  clearStoredPagePromptTemplateSelection,
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

const EMPTY_CUSTOM_FORM = {
  name: "",
  description: "",
  resource: "product",
  type: "description",
  template: "",
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

function typeLabel(typeId) {
  return TYPE_OPTIONS.find((o) => o.value === typeId)?.label || typeId;
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
      <div style={{ display: "flex", flexDirection: "column", minHeight: 340 }}>
        {/* Preview area */}
        <div
          style={{
            height: 180,
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
            flex: 1,
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
              {showResource && <ResourceBadge resource={template.resource} />}
            </BlockStack>
            {active && <Badge tone="success">Active</Badge>}
          </InlineStack>

          <Text as="p" variant="bodySm" tone="subdued">
            {template.description}
          </Text>

          <InlineStack gap="150" align="start">
            <Button size="micro" onClick={onPreview} disabled={isLoading}>
              Preview
            </Button>
            {isCustom && (
              <>
                <Button size="micro" onClick={onEdit} disabled={isLoading}>
                  Edit
                </Button>
                <Button size="micro" tone="critical" onClick={onDelete} disabled={isLoading}>
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
                padding: "8px 16px",
                borderRadius: "6px",
                border: resourceFilter === f.id ? "2px solid #1a1a1a" : "1.5px solid #d1d5db",
                background: resourceFilter === f.id ? "#1a1a1a" : "#ffffff",
                color: resourceFilter === f.id ? "#ffffff" : "#374151",
                cursor: "pointer",
                fontSize: "14px",
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
  const navigate = useNavigate();

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
    () => getSystemTemplates(resourceFilter, typeFilter),
    [resourceFilter, typeFilter],
  );

  const filteredCustomTemplates = useMemo(() => {
    return customTemplates.filter((t) => {
      const resourceMatch = resourceFilter === "all" || t.resource === resourceFilter;
      const typeMatch = t.type === typeFilter;
      return resourceMatch && typeMatch;
    });
  }, [customTemplates, resourceFilter, typeFilter]);

  // ── Apply template ──────────────────────────────────────────────────────────

  async function applyTemplate(template, resourceId, typeId) {
    if (!template || !resourceId || !typeId) return;
    
    setIsLoading(true);
    try {
      if (resourceId === "product") {
        const next = { ...productSelection };
        if (typeId === "description") {
          next.descriptionTemplateId = template.id;
          next.descriptionPromptTemplate = template.template;
        } else if (typeId === "seo-title") {
          next.metaTitleTemplateId = template.id;
          next.metaTitlePromptTemplate = template.template;
        } else if (typeId === "seo-description") {
          next.metaDescriptionTemplateId = template.id;
          next.metaDescriptionPromptTemplate = template.template;
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
        shopify.toast.show(`${template.name} applied to products.`);
        return;
      }

      if (resourceId === "collection") {
        const next = { ...collectionSelection };
        if (typeId === "description") {
          next.descriptionTemplateId = template.id;
          next.descriptionPromptTemplate = template.template;
        } else if (typeId === "seo-title") {
          next.metaTitleTemplateId = template.id;
          next.metaTitlePromptTemplate = template.template;
        } else if (typeId === "seo-description") {
          next.metaDescriptionTemplateId = template.id;
          next.metaDescriptionPromptTemplate = template.template;
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
        shopify.toast.show(`${template.name} applied to collections.`);
        return;
      }

      if (resourceId === "page") {
        const next = { ...pageSelection };
        if (typeId === "description") {
          next.bodyTemplateId = template.id;
          next.bodyPromptTemplate = template.template;
        } else if (typeId === "seo-title") {
          next.metaTitleTemplateId = template.id;
          next.metaTitlePromptTemplate = template.template;
        } else if (typeId === "seo-description") {
          next.metaDescriptionTemplateId = template.id;
          next.metaDescriptionPromptTemplate = template.template;
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
        shopify.toast.show(`${template.name} applied to pages.`);
        return;
      }

      if (resourceId === "blog") {
        const next = { ...blogSelection };
        if (typeId === "description") {
          next.bodyTemplateId = template.id;
          next.bodyPromptTemplate = template.template;
        } else if (typeId === "seo-title") {
          next.metaTitleTemplateId = template.id;
          next.metaTitlePromptTemplate = template.template;
        } else if (typeId === "seo-description") {
          next.metaDescriptionTemplateId = template.id;
          next.metaDescriptionPromptTemplate = template.template;
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
        shopify.toast.show(`${template.name} applied to blog posts.`);
        return;
      }
    } catch (error) {
      shopify.toast.show(error?.message || "Failed to apply template.");
    } finally {
      setIsLoading(false);
    }
  }

  async function clearAllTemplateSelections() {
    setIsLoading(true);
    try {
      const clearedProduct = clearStoredProductPromptTemplateSelection();
      const clearedCollection = clearStoredCollectionPromptTemplateSelection();
      const clearedPage = clearStoredPagePromptTemplateSelection();
      const clearedBlog = clearStoredBlogPromptTemplateSelection();

      setProductSelection(clearedProduct);
      setCollectionSelection(clearedCollection);
      setPageSelection(clearedPage);
      setBlogSelection(clearedBlog);

      await persistTemplateConfiguration(
        {
          product: clearedProduct,
          collection: clearedCollection,
          page: clearedPage,
          blog: clearedBlog,
        },
        customTemplates,
      );
      shopify.toast.show("All template selections have been cleared.");
    } catch (error) {
      shopify.toast.show(error?.message || "Failed to clear template selections.");
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
        shopify.toast.show("Custom template created.");
      }
      setShowFormModal(false);
    } catch (error) {
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
      setDeleteTargetId(null);
      shopify.toast.show("Custom template deleted.");
    } catch (error) {
      shopify.toast.show(error?.message || "Failed to delete custom template.");
    } finally {
      setIsLoading(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const isSystemTab = mainTab === 0;
  const templates = isSystemTab ? systemTemplates : filteredCustomTemplates;
  const showResourceBadge = resourceFilter === "all";

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
      primaryAction={{
        content: "Clear All Selections",
        onAction: clearAllTemplateSelections,
        variant: "primary",
        disabled: isLoading,
      }}
      secondaryActions={[
        { content: "Products", onAction: () => navigate("/app/products"), variant: "secondary", disabled: isLoading },
        { content: "Collections", onAction: () => navigate("/app/collections"), variant: "secondary", disabled: isLoading },
        { content: "Pages", onAction: () => navigate("/app/pages"), variant: "secondary", disabled: isLoading },
        { content: "Blogs", onAction: () => navigate("/app/blog"), variant: "secondary", disabled: isLoading },
      ]}
    >
      <Layout>
        {/* Status badges */}
        <Layout.Section>
          <Card padding="400" tone="success">
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                Active selections
              </Text>
              <InlineStack gap="200" wrap>
                <Badge tone={productSelection.descriptionTemplateId ? "success" : "warning"}>
                  Product:{" "}
                  {productSelection.descriptionTemplateId ? "Configured" : "Not selected"}
                </Badge>
                <Badge tone={collectionSelection.descriptionTemplateId ? "success" : "warning"}>
                  Collection:{" "}
                  {collectionSelection.descriptionTemplateId ? "Configured" : "Not selected"}
                </Badge>
                <Badge tone={pageSelection.bodyTemplateId ? "success" : "warning"}>
                  Page: {pageSelection.bodyTemplateId ? "Configured" : "Not selected"}
                </Badge>
                <Badge tone={blogSelection.bodyTemplateId ? "success" : "warning"}>
                  Blog: {blogSelection.bodyTemplateId ? "Configured" : "Not selected"}
                </Badge>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

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
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 16,
              }}
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
        primaryAction={{
          content: "Use Template",
          onAction: () => {
            if (!previewData) return;
            applyTemplate(previewData, previewData.resourceId, previewData.filterId);
            setPreviewData(null);
          },
          disabled: isLoading,
        }}
        secondaryActions={[
          {
            content: "Copy",
            onAction: () =>
              copyText(previewData?.template || "", previewData?.name || "Template"),
            disabled: isLoading,
          },
          { content: "Close", onAction: () => setPreviewData(null), disabled: isLoading },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              {previewData?.resource && <ResourceBadge resource={previewData.resource} />}
              <Badge>{typeLabel(previewData?.filterId || "description")}</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {previewData?.description}
            </Text>
            <Card>
              <Box padding="300">
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.65,
                    fontSize: 13,
                    fontFamily: "var(--p-font-family-mono, monospace)",
                    color: "var(--p-color-text)",
                  }}
                >
                  {previewData?.template || ""}
                </div>
              </Box>
            </Card>
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
