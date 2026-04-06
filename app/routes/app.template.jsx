import { useMemo, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useNavigate } from "react-router";
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
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import {
  COLLECTION_DESCRIPTION_TEMPLATES,
  COLLECTION_META_DESCRIPTION_TEMPLATES,
  COLLECTION_META_TITLE_TEMPLATES,
  clearStoredCollectionPromptTemplateSelection,
  readStoredCollectionPromptTemplateSelection,
  writeStoredCollectionPromptTemplateSelection,
} from "../lib/collectionPromptTemplateLibrary";
import {
  PRODUCT_DESCRIPTION_TEMPLATES,
  PRODUCT_META_DESCRIPTION_TEMPLATES,
  PRODUCT_META_TITLE_TEMPLATES,
  clearStoredProductPromptTemplateSelection,
  readStoredProductPromptTemplateSelection,
  writeStoredProductPromptTemplateSelection,
} from "../lib/productPromptTemplateLibrary";
import {
  BLOG_BODY_TEMPLATES,
  BLOG_META_DESCRIPTION_TEMPLATES,
  BLOG_META_TITLE_TEMPLATES,
  clearStoredBlogPromptTemplateSelection,
  readStoredBlogPromptTemplateSelection,
  writeStoredBlogPromptTemplateSelection,
} from "../lib/blogPromptTemplateLibrary";
import {
  PAGE_BODY_TEMPLATES,
  PAGE_META_DESCRIPTION_TEMPLATES,
  PAGE_META_TITLE_TEMPLATES,
  clearStoredPagePromptTemplateSelection,
  readStoredPagePromptTemplateSelection,
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

const EMPTY_CUSTOM_FORM = {
  name: "",
  description: "",
  resource: "product",
  type: "description",
  template: "",
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

function readCustomTemplates() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    return Array.isArray(JSON.parse(raw || "null")) ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
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

function TemplateCard({ template, active, showResource, isCustom, onPreview, onEdit, onDelete }) {
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
            <Button size="micro" onClick={onPreview}>
              Preview
            </Button>
            {isCustom && (
              <>
                <Button size="micro" onClick={onEdit}>
                  Edit
                </Button>
                <Button size="micro" tone="critical" onClick={onDelete}>
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
                padding: "5px 14px",
                borderRadius: "6px",
                border: resourceFilter === f.id ? "1.5px solid #1a1a1a" : "1px solid #d1d5db",
                background: resourceFilter === f.id ? "#1a1a1a" : "#f9fafb",
                color: resourceFilter === f.id ? "#ffffff" : "#374151",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: resourceFilter === f.id ? 600 : 400,
                transition: "all 0.15s ease",
                lineHeight: "1.4",
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
  const shopify = useAppBridge();
  const navigate = useNavigate();

  // Main tab: 0 = system, 1 = custom
  const [mainTab, setMainTab] = useState(0);

  // Shared filters
  const [resourceFilter, setResourceFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("description");

  // Selection state (localStorage)
  const [productSelection, setProductSelection] = useState(() =>
    readStoredProductPromptTemplateSelection(),
  );
  const [collectionSelection, setCollectionSelection] = useState(() =>
    readStoredCollectionPromptTemplateSelection(),
  );
  const [pageSelection, setPageSelection] = useState(() => readStoredPagePromptTemplateSelection());
  const [blogSelection, setBlogSelection] = useState(() => readStoredBlogPromptTemplateSelection());

  // Preview modal
  const [previewData, setPreviewData] = useState(null);

  // Custom templates
  const [customTemplates, setCustomTemplates] = useState(readCustomTemplates);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(EMPTY_CUSTOM_FORM);
  const [formErrors, setFormErrors] = useState({});

  // Delete confirm
  const [deleteTargetId, setDeleteTargetId] = useState(null);

  const selectionMap = useMemo(
    () => ({
      product: productSelection,
      collection: collectionSelection,
      page: pageSelection,
      blog: blogSelection,
    }),
    [productSelection, collectionSelection, pageSelection, blogSelection],
  );

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

  function applyTemplate(template, resourceId, typeId) {
    if (!template || !resourceId || !typeId) return;

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
      setProductSelection(writeStoredProductPromptTemplateSelection(next));
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
      setCollectionSelection(writeStoredCollectionPromptTemplateSelection(next));
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
      setPageSelection(writeStoredPagePromptTemplateSelection(next));
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
      setBlogSelection(writeStoredBlogPromptTemplateSelection(next));
      shopify.toast.show(`${template.name} applied to blogs.`);
    }
  }

  function clearAllTemplateSelections() {
    setProductSelection(clearStoredProductPromptTemplateSelection());
    setCollectionSelection(clearStoredCollectionPromptTemplateSelection());
    setPageSelection(clearStoredPagePromptTemplateSelection());
    setBlogSelection(clearStoredBlogPromptTemplateSelection());
    shopify.toast.show("All template selections cleared.");
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

  function handleFormSave() {
    const errors = validateForm();
    if (Object.keys(errors).length) {
      setFormErrors(errors);
      return;
    }

    if (editingId) {
      const updated = customTemplates.map((t) =>
        t.id === editingId ? { ...t, ...formData } : t,
      );
      setCustomTemplates(saveCustomTemplates(updated));
      shopify.toast.show("Custom template updated.");
    } else {
      const newEntry = {
        id: `custom-${Date.now()}`,
        ...formData,
        createdAt: Date.now(),
      };
      const updated = [...customTemplates, newEntry];
      setCustomTemplates(saveCustomTemplates(updated));
      shopify.toast.show("Custom template created.");
    }
    setShowFormModal(false);
  }

  function handleDelete(templateId) {
    const updated = customTemplates.filter((t) => t.id !== templateId);
    setCustomTemplates(saveCustomTemplates(updated));
    setDeleteTargetId(null);
    shopify.toast.show("Custom template deleted.");
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const isSystemTab = mainTab === 0;
  const templates = isSystemTab ? systemTemplates : filteredCustomTemplates;
  const showResourceBadge = resourceFilter === "all";

  return (
    <Page
      fullWidth
      title="Templates"
      subtitle="Manage prompt templates for AI content generation."
      primaryAction={{
        content: "Clear All Selections",
        onAction: clearAllTemplateSelections,
      }}
      secondaryActions={[
        { content: "Products", onAction: () => navigate("/app/products") },
        { content: "Collections", onAction: () => navigate("/app/collections") },
        { content: "Pages", onAction: () => navigate("/app/pages") },
        { content: "Blogs", onAction: () => navigate("/app/blog") },
      ]}
    >
      <Layout>
        {/* Status badges */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                Active selections
              </Text>
              <InlineStack gap="200" wrap>
                <Badge tone={productSelection.descriptionTemplateId ? "success" : "attention"}>
                  Product:{" "}
                  {productSelection.descriptionTemplateId ? "Configured" : "Not selected"}
                </Badge>
                <Badge tone={collectionSelection.descriptionTemplateId ? "success" : "attention"}>
                  Collection:{" "}
                  {collectionSelection.descriptionTemplateId ? "Configured" : "Not selected"}
                </Badge>
                <Badge tone={pageSelection.bodyTemplateId ? "success" : "attention"}>
                  Page: {pageSelection.bodyTemplateId ? "Configured" : "Not selected"}
                </Badge>
                <Badge tone={blogSelection.bodyTemplateId ? "success" : "attention"}>
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
                  <Button variant="primary" size="slim" onClick={openCreateModal}>
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
                  !isSystemTab
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
        }}
        secondaryActions={[
          {
            content: "Copy",
            onAction: () =>
              copyText(previewData?.template || "", previewData?.name || "Template"),
          },
          { content: "Close", onAction: () => setPreviewData(null) },
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
        primaryAction={{ content: "Save", onAction: handleFormSave }}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowFormModal(false) }]}
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
              />
              <Select
                label="Content type"
                options={TYPE_OPTIONS}
                value={formData.type}
                onChange={(v) => setFormData((p) => ({ ...p, type: v }))}
              />
            </FormLayout.Group>
            <TextField
              label="Template name"
              value={formData.name}
              onChange={(v) => setFormData((p) => ({ ...p, name: v }))}
              error={formErrors.name}
              autoComplete="off"
            />
            <TextField
              label="Description"
              value={formData.description}
              onChange={(v) => setFormData((p) => ({ ...p, description: v }))}
              autoComplete="off"
              helpText="Short description of what this template is for."
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
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteTargetId(null) }]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            This action cannot be undone. The template will be permanently removed.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
