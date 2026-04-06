import { useMemo, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useNavigate } from "react-router";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  InlineStack,
  Layout,
  Modal,
  Page,
  Tabs,
  Text,
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

// Main resource tabs
const RESOURCE_TABS = [
  { id: "product", content: "Product", panelID: "product-panel" },
  { id: "collection", content: "Collection", panelID: "collection-panel" },
  { id: "page", content: "Page", panelID: "page-panel" },
  { id: "blog", content: "Blog", panelID: "blog-panel" },
];

// Sub-filters per resource
const RESOURCE_FILTERS = {
  product: [
    { id: "description", label: "Description" },
    { id: "meta-description", label: "Meta Description" },
    { id: "meta-title", label: "Meta Title" },
  ],
  collection: [
    { id: "description", label: "Description" },
    { id: "meta-description", label: "Meta Description" },
    { id: "meta-title", label: "Meta Title" },
  ],
  page: [
    { id: "body", label: "Body" },
    { id: "meta-description", label: "Meta Description" },
    { id: "meta-title", label: "Meta Title" },
  ],
  blog: [
    { id: "body", label: "Body" },
    { id: "meta-description", label: "Meta Description" },
    { id: "meta-title", label: "Meta Title" },
  ],
};

// Default filter per resource
const DEFAULT_FILTER = {
  product: "description",
  collection: "description",
  page: "body",
  blog: "body",
};

function getTemplates(resourceId, filterId) {
  if (resourceId === "product") {
    if (filterId === "description") return PRODUCT_DESCRIPTION_TEMPLATES;
    if (filterId === "meta-description") return PRODUCT_META_DESCRIPTION_TEMPLATES;
    if (filterId === "meta-title") return PRODUCT_META_TITLE_TEMPLATES;
  }
  if (resourceId === "collection") {
    if (filterId === "description") return COLLECTION_DESCRIPTION_TEMPLATES;
    if (filterId === "meta-description") return COLLECTION_META_DESCRIPTION_TEMPLATES;
    if (filterId === "meta-title") return COLLECTION_META_TITLE_TEMPLATES;
  }
  if (resourceId === "page") {
    if (filterId === "body") return PAGE_BODY_TEMPLATES;
    if (filterId === "meta-description") return PAGE_META_DESCRIPTION_TEMPLATES;
    if (filterId === "meta-title") return PAGE_META_TITLE_TEMPLATES;
  }
  if (resourceId === "blog") {
    if (filterId === "body") return BLOG_BODY_TEMPLATES;
    if (filterId === "meta-description") return BLOG_META_DESCRIPTION_TEMPLATES;
    if (filterId === "meta-title") return BLOG_META_TITLE_TEMPLATES;
  }
  return [];
}

function getActiveTemplateId(resourceId, filterId, selectionMap) {
  const sel = selectionMap[resourceId];
  if (!sel) return "";
  if (resourceId === "product" || resourceId === "collection") {
    if (filterId === "description") return sel.descriptionTemplateId;
    if (filterId === "meta-description") return sel.metaDescriptionTemplateId;
    if (filterId === "meta-title") return sel.metaTitleTemplateId;
  }
  if (resourceId === "page" || resourceId === "blog") {
    if (filterId === "body") return sel.bodyTemplateId;
    if (filterId === "meta-description") return sel.metaDescriptionTemplateId;
    if (filterId === "meta-title") return sel.metaTitleTemplateId;
  }
  return "";
}

function PromptGalleryCard({ template, active, onPreview }) {
  return (
    <Card padding="0">
      <div
        style={{
          minHeight: 380,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            minHeight: 210,
            maxHeight: 210,
            overflowY: "auto",
            padding: 16,
            borderBottom: "1px solid var(--p-color-border)",
            whiteSpace: "pre-wrap",
            lineHeight: 1.5,
            fontSize: 16,
          }}
        >
          {template.template}
        </div>

        <div
          style={{
            padding: 16,
            background: "var(--p-color-bg-surface-secondary)",
            flex: 1,
          }}
        >
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h3" variant="headingMd">
                {template.name}
              </Text>
              {active ? <Badge tone="success">Active</Badge> : null}
            </InlineStack>
            <Text as="p" tone="subdued">
              {template.description}
            </Text>
            <InlineStack>
              <Button size="slim" onClick={onPreview}>
                Preview
              </Button>
            </InlineStack>
          </BlockStack>
        </div>
      </div>
    </Card>
  );
}

export default function TemplatePage() {
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const [selectedTab, setSelectedTab] = useState(0);
  const [activeFilter, setActiveFilter] = useState({ ...DEFAULT_FILTER });

  const [productSelection, setProductSelection] = useState(() =>
    readStoredProductPromptTemplateSelection(),
  );
  const [collectionSelection, setCollectionSelection] = useState(() =>
    readStoredCollectionPromptTemplateSelection(),
  );
  const [pageSelection, setPageSelection] = useState(() => readStoredPagePromptTemplateSelection());
  const [blogSelection, setBlogSelection] = useState(() => readStoredBlogPromptTemplateSelection());
  const [previewData, setPreviewData] = useState(null);

  const currentResourceId = RESOURCE_TABS[selectedTab]?.id || "product";
  const currentFilterId = activeFilter[currentResourceId] || DEFAULT_FILTER[currentResourceId];
  const currentTemplates = getTemplates(currentResourceId, currentFilterId);

  const selectionMap = useMemo(
    () => ({
      product: productSelection,
      collection: collectionSelection,
      page: pageSelection,
      blog: blogSelection,
    }),
    [productSelection, collectionSelection, pageSelection, blogSelection],
  );

  function handleTabSelect(index) {
    setSelectedTab(index);
  }

  function handleFilterSelect(resourceId, filterId) {
    setActiveFilter((prev) => ({ ...prev, [resourceId]: filterId }));
  }

  async function copyText(value, label) {
    if (!value) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      }
      shopify.toast.show(`${label} copied.`);
    } catch {
      shopify.toast.show(`Failed to copy ${label.toLowerCase()}.`);
    }
  }

  function applyTemplate(template, resourceId, filterId) {
    if (!template || !resourceId) return;

    if (resourceId === "product") {
      const next = { ...productSelection };
      if (filterId === "description") {
        next.descriptionTemplateId = template.id;
        next.descriptionPromptTemplate = template.template;
      } else if (filterId === "meta-title") {
        next.metaTitleTemplateId = template.id;
        next.metaTitlePromptTemplate = template.template;
      } else if (filterId === "meta-description") {
        next.metaDescriptionTemplateId = template.id;
        next.metaDescriptionPromptTemplate = template.template;
      }
      setProductSelection(writeStoredProductPromptTemplateSelection(next));
      shopify.toast.show(`${template.name} product template applied.`);
      return;
    }

    if (resourceId === "collection") {
      const next = { ...collectionSelection };
      if (filterId === "description") {
        next.descriptionTemplateId = template.id;
        next.descriptionPromptTemplate = template.template;
      } else if (filterId === "meta-title") {
        next.metaTitleTemplateId = template.id;
        next.metaTitlePromptTemplate = template.template;
      } else if (filterId === "meta-description") {
        next.metaDescriptionTemplateId = template.id;
        next.metaDescriptionPromptTemplate = template.template;
      }
      setCollectionSelection(writeStoredCollectionPromptTemplateSelection(next));
      shopify.toast.show(`${template.name} collection template applied.`);
      return;
    }

    if (resourceId === "page") {
      const next = { ...pageSelection };
      if (filterId === "body") {
        next.bodyTemplateId = template.id;
        next.bodyPromptTemplate = template.template;
      } else if (filterId === "meta-title") {
        next.metaTitleTemplateId = template.id;
        next.metaTitlePromptTemplate = template.template;
      } else if (filterId === "meta-description") {
        next.metaDescriptionTemplateId = template.id;
        next.metaDescriptionPromptTemplate = template.template;
      }
      setPageSelection(writeStoredPagePromptTemplateSelection(next));
      shopify.toast.show(`${template.name} page template applied.`);
      return;
    }

    if (resourceId === "blog") {
      const next = { ...blogSelection };
      if (filterId === "body") {
        next.bodyTemplateId = template.id;
        next.bodyPromptTemplate = template.template;
      } else if (filterId === "meta-title") {
        next.metaTitleTemplateId = template.id;
        next.metaTitlePromptTemplate = template.template;
      } else if (filterId === "meta-description") {
        next.metaDescriptionTemplateId = template.id;
        next.metaDescriptionPromptTemplate = template.template;
      }
      setBlogSelection(writeStoredBlogPromptTemplateSelection(next));
      shopify.toast.show(`${template.name} blog template applied.`);
    }
  }

  function clearAllTemplateSelections() {
    setProductSelection(clearStoredProductPromptTemplateSelection());
    setCollectionSelection(clearStoredCollectionPromptTemplateSelection());
    setPageSelection(clearStoredPagePromptTemplateSelection());
    setBlogSelection(clearStoredBlogPromptTemplateSelection());
    shopify.toast.show("All template selections cleared.");
  }

  const filters = RESOURCE_FILTERS[currentResourceId] || [];

  return (
    <Page
      title="Template"
      subtitle="Multiple prompt templates for Products, Collections, Pages, and Blogs."
      primaryAction={{
        content: "Open Pages",
        onAction: () => navigate("/app/pages"),
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h1" variant="headingLg">
                Prompt Template Library
              </Text>
              <Text as="p" tone="subdued">
                Preview and apply templates. Selected templates are used directly in AI generation on
                Products, Collections, Pages, and Blogs.
              </Text>
              <InlineStack gap="200" wrap>
                <Badge tone={productSelection.descriptionTemplateId ? "success" : "attention"}>
                  Product: {productSelection.descriptionTemplateId ? "Configured" : "Not selected"}
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
              <InlineStack gap="200" wrap>
                <Button onClick={clearAllTemplateSelections}>Clear All Templates</Button>
                <Button onClick={() => navigate("/app/products")} variant="primary">
                  Go To Products
                </Button>
                <Button onClick={() => navigate("/app/collections")} variant="primary">
                  Go To Collections
                </Button>
                <Button onClick={() => navigate("/app/pages")} variant="primary">
                  Go To Pages
                </Button>
                <Button onClick={() => navigate("/app/blog")} variant="primary">
                  Go To Blogs
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={RESOURCE_TABS} selected={selectedTab} onSelect={handleTabSelect} />
            <Box padding="400" paddingBlockStart="300" paddingBlockEnd="300">
              <InlineStack gap="200" wrap>
                {filters.map((filter) => (
                  <Button
                    key={filter.id}
                    size="slim"
                    pressed={currentFilterId === filter.id}
                    onClick={() => handleFilterSelect(currentResourceId, filter.id)}
                  >
                    {filter.label}
                  </Button>
                ))}
              </InlineStack>
            </Box>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: 16,
            }}
          >
            {currentTemplates.map((template) => (
              <PromptGalleryCard
                key={template.id}
                template={template}
                active={
                  getActiveTemplateId(currentResourceId, currentFilterId, selectionMap) ===
                  template.id
                }
                onPreview={() =>
                  setPreviewData({
                    ...template,
                    resourceId: currentResourceId,
                    filterId: currentFilterId,
                  })
                }
              />
            ))}
          </div>
        </Layout.Section>
      </Layout>

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
            onAction: () => copyText(previewData?.template || "", previewData?.name || "Template"),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" tone="subdued">
              {previewData?.description}
            </Text>
            <Card>
              <Box padding="300">
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.6,
                    fontSize: 15,
                  }}
                >
                  {previewData?.template || ""}
                </div>
              </Box>
            </Card>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
