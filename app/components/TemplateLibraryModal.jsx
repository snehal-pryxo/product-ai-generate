import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  Icon,
  InlineStack,
  Modal,
  Tabs,
  Text,
} from "@shopify/polaris";
import { ArrowLeftIcon, ViewIcon } from "@shopify/polaris-icons";
import { buildDescriptionStructuredPreview, buildMetaPreviewText } from "../lib/templatePreviewFormat";
import { getPreviewHtml, wrapHtml } from "../lib/templatePreviewLibrary";

// ─── Category mapping by template ID ────────────────────────────────────────
const TEMPLATE_CATEGORIES = {
  // Product Description
  "problem-solution": "Marketing & Sales",
  "technical-specifications": "Technical & Specs",
  "lifestyle-integration": "Lifestyle & Emotion",
  "eco-friendly-product": "Product Categories",
  "premium-luxury-product": "Brands & Luxury",
  "budget-friendly-product": "Product Categories",
  "seasonal-limited-edition": "Seasonal & Events",
  "storytelling-narrative": "Marketing & Sales",
  "social-proof-focus": "Marketing & Sales",
  "gift-occasion": "Seasonal & Events",
  "competitive-differentiation": "Marketing & Sales",
  // Product Meta Description
  "md-basic-benefit": "Marketing & Sales",
  "md-problem-solution": "Marketing & Sales",
  "md-feature-promo": "Marketing & Sales",
  "md-premium-quality": "Brands & Luxury",
  "md-target-audience": "Product Categories",
  "md-value-proposition": "Marketing & Sales",
  "md-experience-based": "Lifestyle & Emotion",
  "md-feature-to-benefit": "Technical & Specs",
  "md-usage-occasion": "Lifestyle & Emotion",
  "md-elevation": "SEO Optimized",
  "md-discovery": "Marketing & Sales",
  "md-variety-options": "Product Categories",
  "md-guarantee-assurance": "Marketing & Sales",
  "md-gift-occasion": "Seasonal & Events",
  "md-social-proof": "Marketing & Sales",
  // Product Meta Title
  "mt-benefit-first": "SEO Optimized",
  "mt-product-feature": "Technical & Specs",
  "mt-intent-buy-now": "Marketing & Sales",
  "mt-category-seo": "SEO Optimized",
  "mt-problem-solution": "Marketing & Sales",
  "mt-quality-value": "Product Categories",
  "mt-usage-occasion": "Lifestyle & Emotion",
  "mt-promo": "Seasonal & Events",
  "mt-review-signal": "Marketing & Sales",
  "mt-best-for-audience": "Product Categories",
  "mt-gift-intent": "Seasonal & Events",
  // Collection Description
  "col-problem-solution": "Marketing & Sales",
  "col-technical-specifications": "Technical & Specs",
  "col-lifestyle-integration": "Lifestyle & Emotion",
  "col-eco-friendly-product": "Product Categories",
  "col-premium-luxury-product": "Brands & Luxury",
  "col-budget-friendly-product": "Product Categories",
  "col-seasonal-limited-edition": "Seasonal & Events",
  "col-collection-comparison": "Product Categories",
  "col-gift-guide": "Seasonal & Events",
  "col-new-arrivals": "Marketing & Sales",
  "col-bestsellers-curated": "Marketing & Sales",
  // Collection Meta Title
  "col-mt-benefit-first": "SEO Optimized",
  "col-mt-category-seo": "SEO Optimized",
  "col-mt-shop-intent": "Marketing & Sales",
  "col-mt-quality-focus": "Brands & Luxury",
  "col-mt-occasion-match": "Lifestyle & Emotion",
  "col-mt-problem-solution": "Marketing & Sales",
  "col-mt-seasonal": "Seasonal & Events",
  "col-mt-featured-angle": "Marketing & Sales",
  // Collection Meta Description
  "col-md-benefit-focused": "Marketing & Sales",
  "col-md-problem-solution": "Marketing & Sales",
  "col-md-quality-centric": "Brands & Luxury",
  "col-md-experience": "Lifestyle & Emotion",
  "col-md-occasion-based": "Lifestyle & Emotion",
  "col-md-discovery": "Marketing & Sales",
  "col-md-new-arrivals": "Marketing & Sales",
  "col-md-gift-guide": "Seasonal & Events",
  "col-md-bestsellers": "Marketing & Sales",
  // Tone & Style templates
  "tone-professional": "Tone & Style",
  "tone-friendly": "Tone & Style",
  "tone-persuasive": "Tone & Style",
  "tone-informational": "Tone & Style",
  // Blog Body
  "blog-body-500-plus": "Long Form",
  "blog-body-how-to": "How-To & Guides",
  "blog-body-listicle": "Listicle",
  "blog-body-problem-solution": "Problem-Solution",
  "blog-body-beginner-guide": "Beginner Content",
  "blog-body-comparison": "Comparison",
  "blog-body-case-study": "Case Study",
  "blog-body-expert-interview": "Interview",
  "blog-body-product-review": "Product Review",
  "blog-body-trend-roundup": "News & Trends",
  "blog-body-ultimate-checklist": "Checklist",
  // Blog Meta Description
  "blog-md-learn-outcome": "How-To & Guides",
  "blog-md-problem-solution": "Problem-Solution",
  "blog-md-listicle": "Listicle",
  "blog-md-expert-tips": "How-To & Guides",
  "blog-md-action-cta": "Marketing",
  "blog-md-story-hook": "Storytelling",
  "blog-md-curiosity-gap": "Marketing",
  "blog-md-quick-wins": "How-To & Guides",
  // Blog Meta Title
  "blog-mt-how-to": "How-To & Guides",
  "blog-mt-complete-guide": "How-To & Guides",
  "blog-mt-tips": "Listicle",
  "blog-mt-comparison": "Comparison",
  "blog-mt-best-for": "Marketing",
  "blog-mt-question-style": "How-To & Guides",
  "blog-mt-beginner-friendly": "Beginner Content",
  "blog-mt-year-edition": "SEO Optimized",
  "blog-mt-case-study": "Case Study",
  // Page Body
  "page-body-brand-story": "Brand & About",
  "page-body-policy-clarity": "Policy & Legal",
  "page-body-faq-structured": "FAQ & Support",
  "page-body-contact-conversion": "Contact",
  "page-body-landing-offer": "Marketing",
  "page-body-comparison": "Comparison",
  "page-body-team": "Brand & About",
  "page-body-testimonials": "Marketing & Sales",
  "page-body-press-media": "Brand & About",
  "page-body-size-guide": "FAQ & Support",
  // Page Meta Description
  "page-md-benefit-first": "SEO Optimized",
  "page-md-problem-solution": "Marketing",
  "page-md-trust-signal": "Brand & About",
  "page-md-concise-seo": "SEO Optimized",
  "page-md-action-oriented": "Marketing",
  // Page Meta Title
  "page-mt-intent-keyword": "SEO Optimized",
  "page-mt-brand-keyword": "Brand & About",
  "page-mt-action-benefit": "Marketing",
  "page-mt-question-style": "FAQ & Support",
  "page-mt-trust": "Brand & About",
};

function getCategory(templateId) {
  return TEMPLATE_CATEGORIES[templateId] || "General";
}

// ─── Length badge helper ──────────────────────────────────────────────────────
function getLengthLabel(templateText) {
  const len = (templateText || "").length;
  if (len < 150) return { label: "short", color: "#10b981", bg: "#d1fae5" };
  if (len < 400) return { label: "medium", color: "#f59e0b", bg: "#fef3c7" };
  return { label: "long", color: "#6366f1", bg: "#ede9fe" };
}

// ─── Preview Panel ────────────────────────────────────────────────────────────
function PreviewPanel({
  tabs,
  initialTabId,
  templatesByTab,
  previewTemplateByTab,
  onBack,
  onUse,
}) {
  const [previewTabId, setPreviewTabId] = useState(initialTabId);

  useEffect(() => {
    setPreviewTabId(initialTabId);
  }, [initialTabId]);

  const previewTabs = useMemo(
    () => tabs.map((tab) => ({ id: tab.id, content: tab.label })),
    [tabs],
  );
  const selectedTabIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === previewTabId),
  );

  const currentTemplate = useMemo(() => {
    const directMatch = previewTemplateByTab?.[previewTabId];
    if (directMatch) return directMatch;

    const currentTabTemplates = templatesByTab?.[previewTabId] || [];
    return currentTabTemplates[0] || null;
  }, [previewTabId, previewTemplateByTab, templatesByTab]);

  const category = currentTemplate ? getCategory(currentTemplate.id) : "General";
  const length = getLengthLabel(currentTemplate?.template || "");
  const isDescriptionPreview = previewTabId === "description";
  const isMetaPreview = previewTabId === "meta_description" || previewTabId === "meta_title";
  const contentTypeLabel = tabs.find((tab) => tab.id === previewTabId)?.label || previewTabId;

  const metaPreviewText = useMemo(
    () => buildMetaPreviewText(currentTemplate),
    [currentTemplate],
  );
  const descriptionPreview = useMemo(
    () => buildDescriptionStructuredPreview(currentTemplate, currentTemplate?.name || ""),
    [currentTemplate],
  );
  const htmlPreview = useMemo(() => {
    if (!currentTemplate) return "";
    const resourceId = currentTemplate.id.startsWith("col-")
      ? "collection"
      : currentTemplate.id.startsWith("page-")
        ? "page"
        : "product";
    const typeId = previewTabId === "meta_title"
      ? "seo-title"
      : previewTabId === "meta_description"
        ? "seo-description"
        : previewTabId;
    return getPreviewHtml(currentTemplate.id, resourceId, typeId);
  }, [currentTemplate, previewTabId]);

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center" wrap>
        <InlineStack gap="200">
          <Button icon={ArrowLeftIcon} onClick={onBack}>Back</Button>
          <Text as="h3" variant="headingMd">{currentTemplate?.name || "Template Preview"}</Text>
        </InlineStack>
        <Button
          variant="primary"
          onClick={() => currentTemplate && onUse(currentTemplate)}
          disabled={!currentTemplate}
        >
          Use Template
        </Button>
      </InlineStack>

      <Tabs
        tabs={previewTabs}
        selected={selectedTabIndex}
        onSelect={(index) => setPreviewTabId(tabs[index]?.id || previewTabId)}
      />

      {!currentTemplate ? (
        <Card>
          <Box padding="400">
            <Text as="p" tone="subdued">No template available for this content type.</Text>
          </Box>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: "12px", minHeight: "62vh" }}>
          <Card>
            <Box padding="300">
              <BlockStack gap="300">
                <BlockStack gap="100">
                  <Text as="h4" variant="headingSm">About this template</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {currentTemplate.description || "Use this template to generate AI content tailored for your store."}
                  </Text>
                </BlockStack>

                <Divider />

                <BlockStack gap="100">
                  <Text as="h4" variant="headingSm">Template Prompt</Text>
                  <div
                    style={{
                      background: "#f6f6f7",
                      border: "1px solid #e1e3e5",
                      borderRadius: "8px",
                      padding: "12px",
                      fontFamily: "monospace",
                      fontSize: "12px",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {currentTemplate.template}
                  </div>
                </BlockStack>

                <Divider />

                <BlockStack gap="100">
                  <Text as="h4" variant="headingSm">
                    {previewTabId === "meta_title"
                      ? "Meta Title Preview"
                      : previewTabId === "meta_description"
                        ? "Meta Description Preview"
                        : "Description Preview"}
                  </Text>
                  {htmlPreview ? (
                    <div
                      style={{ border: "1px solid #e1e3e5", borderRadius: "8px", padding: "12px" }}
                      // Safe: preview html comes from static template preview library.
                      dangerouslySetInnerHTML={{ __html: wrapHtml(htmlPreview) }}
                    />
                  ) : isDescriptionPreview && descriptionPreview ? (
                    <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", padding: "12px" }}>
                      <BlockStack gap="200">
                        <Text as="h5" variant="headingSm">{descriptionPreview.heading}</Text>
                        {descriptionPreview.sections.map((section) => (
                          <BlockStack key={section.title} gap="100">
                            <Text as="h6" variant="bodyMd" fontWeight="semibold">{section.title}</Text>
                            {section.paragraphs.map((paragraph, index) => (
                              <Text key={`${section.title}-p-${index}`} as="p" variant="bodySm">{paragraph}</Text>
                            ))}
                            {section.points.length > 0 && (
                              <ul style={{ margin: 0, paddingLeft: "18px" }}>
                                {section.points.map((point, index) => (
                                  <li key={`${section.title}-pt-${index}`}>
                                    <Text as="span" variant="bodySm">{point}</Text>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </BlockStack>
                        ))}
                      </BlockStack>
                    </div>
                  ) : isMetaPreview ? (
                    <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", padding: "12px" }}>
                      <Text as="p" variant="bodySm">{metaPreviewText}</Text>
                    </div>
                  ) : null}
                </BlockStack>
              </BlockStack>
            </Box>
          </Card>

          <Card>
            <Box padding="300">
              <BlockStack gap="200">
                <Text as="h4" variant="headingSm">Template Details</Text>
                <InlineStack gap="150">
                  <Badge>{contentTypeLabel}</Badge>
                  <Badge tone="info">{category}</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Length:{" "}
                  <span style={{ color: length.color, fontWeight: 600, textTransform: "capitalize" }}>
                    {length.label}
                  </span>
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Characters: {currentTemplate.template.length}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">Language: English</Text>
              </BlockStack>
            </Box>
          </Card>
        </div>
      )}
    </BlockStack>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {{ id: string, label: string }[]} props.tabs  - e.g. [{id:'description',label:'Description'},...]
 * @param {string} props.initialTab - which tab to open on
 * @param {Record<string, Array>} props.templatesByTab - templates keyed by tab id
 * @param {(templateText: string) => void} props.onUseTemplate
 */
export function TemplateLibraryModal({ open, onClose, tabs, initialTab, templatesByTab, onUseTemplate }) {
  const [activeTab, setActiveTab] = useState(initialTab || (tabs?.[0]?.id ?? "description"));
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewTabId, setPreviewTabId] = useState(initialTab || (tabs?.[0]?.id ?? "description"));
  const [previewTemplateByTab, setPreviewTemplateByTab] = useState({});

  useEffect(() => {
    if (!open) return;
    const initial = initialTab || (tabs?.[0]?.id ?? "description");
    setActiveTab(initial);
    setPreviewTabId(initial);
    setSelectedCategory("All");
    setIsPreviewOpen(false);
  }, [open, initialTab, tabs]);

  if (!open) return null;

  const currentTemplates = templatesByTab[activeTab] || [];

  // Derive categories
  const categoriesSet = new Set(currentTemplates.map((t) => getCategory(t.id)));
  const categories = ["All", ...[...categoriesSet].sort()];

  const filtered =
    selectedCategory === "All"
      ? currentTemplates
      : currentTemplates.filter((t) => getCategory(t.id) === selectedCategory);

  function handleTabChange(tabId) {
    setActiveTab(tabId);
    setSelectedCategory("All");
    setIsPreviewOpen(false);
  }

  function handleUse(template) {
    onUseTemplate(template.template);
    onClose();
  }

  const modalTabs = tabs.map((tab) => ({ id: tab.id, content: tab.label }));
  const selectedModalTabIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTab));

  return (
    <>
      <style>{`
      @media (max-width: 1440px) {
          .template-library-modal--wide .Polaris-Modal-Dialog__Modal {
            width: 60vw !important;
          }
      }
        .template-library-modal--wide .Polaris-Modal-Dialog__Modal {
          width: min(96vw, 1440px) !important;
          max-width: calc(100vw - 24px) !important;
        }
      `}</style>
      <Modal
        className="template-library-modal--wide"
        open={open}
        onClose={onClose}
        title="Template Library"
        size="large"
        limitHeight={false}
      >
        <Modal.Section>
          {isPreviewOpen ? (
            <PreviewPanel
              tabs={tabs}
              initialTabId={previewTabId}
              templatesByTab={templatesByTab}
              previewTemplateByTab={previewTemplateByTab}
              onBack={() => setIsPreviewOpen(false)}
              onUse={handleUse}
            />
          ) : (
            <BlockStack gap="300">
              {tabs.length > 1 && (
                <Tabs
                  tabs={modalTabs}
                  selected={selectedModalTabIndex}
                  onSelect={(index) => handleTabChange(tabs[index]?.id || activeTab)}
                />
              )}

              <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: "12px", minHeight: "62vh" }}>
                <Card>
                  <Box padding="300">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued" fontWeight="semibold">Categories</Text>
                      {categories.map((cat) => (
                        <Button
                          key={cat}
                          fullWidth
                          textAlign="left"
                          variant={selectedCategory === cat ? "primary" : "secondary"}
                          onClick={() => setSelectedCategory(cat)}
                        >
                          {cat}
                        </Button>
                      ))}
                    </BlockStack>
                  </Box>
                </Card>

                <div style={{ overflowY: "auto", maxHeight: "70vh", paddingRight: "2px" }}>
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h3" variant="headingSm">Templates</Text>
                      <Badge tone="info">{filtered.length} templates</Badge>
                    </InlineStack>

                    {filtered.length === 0 ? (
                      <Card>
                        <Box padding="400">
                          <Text as="p" tone="subdued">No templates found in this category.</Text>
                        </Box>
                      </Card>
                    ) : (
                      <div
                        className="app-card-grid"
                        style={{
                          gap: "14px",
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        }}
                      >
                        {filtered.map((template) => (
                          <Card key={template.id}>
                            <Box padding="300">
                              <BlockStack gap="200">
                                <InlineStack align="space-between" blockAlign="start" gap="200">
                                  <Text as="h4" variant="headingSm">{template.name}</Text>
                                  <Badge>{template.template.length}</Badge>
                                </InlineStack>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {template.description || "Template ready for use."}
                                </Text>
                                <InlineStack gap="200">
                                  <Button variant="primary" onClick={() => handleUse(template)}>
                                    Use Template
                                  </Button>
                                  <Button
                                    icon={ViewIcon}
                                    onClick={() => {
                                      setPreviewTemplateByTab((current) => ({
                                        ...current,
                                        [activeTab]: template,
                                      }));
                                      setPreviewTabId(activeTab);
                                      setIsPreviewOpen(true);
                                    }}
                                  >
                                    Preview
                                  </Button>
                                </InlineStack>
                              </BlockStack>
                            </Box>
                          </Card>
                        ))}
                      </div>
                    )}
                  </BlockStack>
                </div>
              </div>
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </>
  );
}
