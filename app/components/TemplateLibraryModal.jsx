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
  "col-mt-occasion": "Lifestyle & Emotion",
  "col-mt-problem-solution": "Marketing & Sales",
  "col-mt-seasonal": "Seasonal & Events",
  "col-mt-featured": "Marketing & Sales",
  "col-mt-new-arrivals": "Seasonal & Events",
  "col-mt-gift-guide": "Seasonal & Events",
  "col-mt-bestsellers": "Marketing & Sales",
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
  "page-body-brand-story": "Brands & Luxury",
  "page-body-policy-clarity": "Compliance & Accuracy",
  "page-body-faq-structured": "Compliance & Accuracy",
  "page-body-contact-conversion": "Marketing & Sales",
  "page-body-landing-offer": "Marketing & Sales",
  "page-body-comparison": "SEO Optimized",
  "page-body-team": "Brands & Luxury",
  "page-body-testimonials": "Marketing & Sales",
  "page-body-press-media": "Brands & Luxury",
  "page-body-size-guide": "Product Categories",
  // Page Meta Description
  "page-md-benefit-first": "SEO Optimized",
  "page-md-problem-solution": "Marketing & Sales",
  "page-md-trust-signal": "Compliance & Accuracy",
  "page-md-concise-seo": "SEO Optimized",
  "page-md-action-oriented": "Marketing & Sales",
  // Page Meta Title
  "page-mt-intent-keyword": "SEO Optimized",
  "page-mt-brand-keyword": "Brands & Luxury",
  "page-mt-action-benefit": "Marketing & Sales",
  "page-mt-question-style": "Compliance & Accuracy",
  "page-mt-trust": "Compliance & Accuracy",
  "page-md-story-driven": "Lifestyle & Emotion",
  "page-md-curiosity-hook": "Marketing & Sales",
  "page-md-social-proof": "Social & UGC",
  "page-mt-curiosity": "Marketing & Sales",
  "page-mt-benefit-clarity": "Marketing & Sales",
  "page-mt-guide-style": "SEO Optimized",
};

function getCategory(templateOrId) {
  if (templateOrId && typeof templateOrId === "object" && templateOrId.category) {
    return templateOrId.category;
  }
  const templateId = typeof templateOrId === "string" ? templateOrId : templateOrId?.id;
  return TEMPLATE_CATEGORIES[templateId] || "General";
}

// ─── Length badge helper ──────────────────────────────────────────────────────
function getLengthLabel(templateText) {
  const len = (templateText || "").length;
  if (len < 150) return { label: "short", color: "#10b981", bg: "#d1fae5" };
  if (len < 400) return { label: "medium", color: "#f59e0b", bg: "#fef3c7" };
  return { label: "long", color: "#6366f1", bg: "#ede9fe" };
}

function stripPreviewText(value = "") {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;|&ndash;/g, "-")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(value = "") {
  const text = stripPreviewText(value);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function flattenDescriptionPreview(preview) {
  if (!preview) return "";
  const parts = [preview.heading, preview.subheading];
  (preview.sections || []).forEach((section) => {
    parts.push(section.title);
    (section.paragraphs || []).forEach((paragraph) => parts.push(paragraph));
    (section.points || []).forEach((point) => parts.push(point));
  });
  return parts.filter(Boolean).join(" ");
}

function fitTextToWordRange(value = "", minWords = 160, maxWords = 220) {
  let words = stripPreviewText(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length < minWords) {
    const sourceWords = [...words];
    let index = 0;
    while (words.length < minWords && sourceWords.length > 0) {
      words.push(sourceWords[index % sourceWords.length]);
      index += 1;
    }
  }
  if (words.length > maxWords) {
    words = words.slice(0, maxWords);
  }
  return words.join(" ");
}

function takeWords(value = "", limit = 0) {
  const words = stripPreviewText(value).split(/\s+/).filter(Boolean);
  if (limit <= 0 || words.length === 0) return "";
  return words.slice(0, limit).join(" ");
}

function extractStructuredPreviewFromHtml(html = "", fallbackPreview = null) {
  const source = String(html || "");
  const elements = [];
  const elementPattern = /<(h1|h2|h3|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = elementPattern.exec(source))) {
    const text = stripPreviewText(match[2]);
    if (text) elements.push({ tag: match[1].toLowerCase(), text });
  }

  if (!elements.length && fallbackPreview) return fallbackPreview;

  let heading = "";
  let subheading = "";
  const sections = [];
  let currentSection = null;

  elements.forEach((element) => {
    if ((element.tag === "h1" || element.tag === "h2") && !heading) {
      heading = element.text;
      return;
    }

    if (element.tag === "h3") {
      currentSection = { title: element.text, paragraphs: [], points: [] };
      sections.push(currentSection);
      return;
    }

    if (element.tag === "p") {
      if (!subheading) {
        subheading = element.text;
        return;
      }
      if (!currentSection) {
        currentSection = { title: "Overview", paragraphs: [], points: [] };
        sections.push(currentSection);
      }
      currentSection.paragraphs.push(element.text);
      return;
    }

    if (element.tag === "li") {
      if (!currentSection) {
        currentSection = { title: "Key Points", paragraphs: [], points: [] };
        sections.push(currentSection);
      }
      currentSection.points.push(element.text);
    }
  });

  return {
    heading: heading || fallbackPreview?.heading || "Description Preview",
    subheading,
    sections: sections.length ? sections : fallbackPreview?.sections || [],
  };
}

function fitStructuredPreviewToWordRange(preview, minWords = 160, maxWords = 220) {
  if (!preview) return null;

  const sourceText = flattenDescriptionPreview(preview);
  const output = {
    heading: preview.heading || "Description Preview",
    subheading: "",
    sections: [],
  };
  let remaining = Math.max(0, maxWords - countWords(output.heading));

  if (preview.subheading && remaining > 0) {
    output.subheading = takeWords(preview.subheading, remaining);
    remaining -= countWords(output.subheading);
  }

  for (const section of preview.sections || []) {
    if (remaining <= 0) break;

    const nextSection = {
      title: takeWords(section.title || "Details", remaining),
      paragraphs: [],
      points: [],
    };
    remaining -= countWords(nextSection.title);

    for (const paragraph of section.paragraphs || []) {
      if (remaining <= 0) break;
      const nextParagraph = takeWords(paragraph, remaining);
      if (nextParagraph) {
        nextSection.paragraphs.push(nextParagraph);
        remaining -= countWords(nextParagraph);
      }
    }

    for (const point of section.points || []) {
      if (remaining <= 0) break;
      const nextPoint = takeWords(point, remaining);
      if (nextPoint) {
        nextSection.points.push(nextPoint);
        remaining -= countWords(nextPoint);
      }
    }

    if (nextSection.title || nextSection.paragraphs.length || nextSection.points.length) {
      output.sections.push(nextSection);
    }
  }

  const currentWords = countWords(flattenDescriptionPreview(output));
  if (currentWords < minWords) {
    const filler = takeWords(sourceText, Math.min(maxWords - currentWords, minWords - currentWords));
    if (filler) {
      const lastSection = output.sections[output.sections.length - 1] || {
        title: "Details",
        paragraphs: [],
        points: [],
      };
      lastSection.paragraphs.push(filler);
      if (!output.sections.length) output.sections.push(lastSection);
    }
  }

  return output;
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

  const category = currentTemplate ? getCategory(currentTemplate) : "General";
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
  const resourceId = useMemo(() => {
    if (!currentTemplate) return "";
    return currentTemplate.id.startsWith("col-")
      ? "collection"
      : currentTemplate.id.startsWith("page-")
        ? "page"
        : "product";
  }, [currentTemplate]);
  const htmlPreview = useMemo(() => {
    if (!currentTemplate) return "";
    const typeId = previewTabId === "meta_title"
      ? "seo-title"
      : previewTabId === "meta_description"
        ? "seo-description"
        : previewTabId;
    return getPreviewHtml(currentTemplate.id, resourceId, typeId);
  }, [currentTemplate, previewTabId, resourceId]);
  const rangeDescriptionPreview = useMemo(() => {
    if (!isDescriptionPreview || (resourceId !== "product" && resourceId !== "collection")) return null;
    const structuredPreview = extractStructuredPreviewFromHtml(htmlPreview, descriptionPreview);
    return fitStructuredPreviewToWordRange(structuredPreview, 180, 180);
  }, [descriptionPreview, htmlPreview, isDescriptionPreview, resourceId]);
  const rangeDescriptionWordCount = countWords(flattenDescriptionPreview(rangeDescriptionPreview));

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
                  {rangeDescriptionPreview ? (
                    <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", padding: "16px" }}>
                      <BlockStack gap="250">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Preview length: {rangeDescriptionWordCount} words
                        </Text>
                        <BlockStack gap="150">
                          <Text as="h5" variant="headingMd">
                            {rangeDescriptionPreview.heading}
                          </Text>
                          {rangeDescriptionPreview.subheading ? (
                            <Text as="p" variant="bodyMd" tone="subdued">
                              {rangeDescriptionPreview.subheading}
                            </Text>
                          ) : null}
                        </BlockStack>
                        {rangeDescriptionPreview.sections.map((section, sectionIndex) => (
                          <BlockStack key={`${section.title}-${sectionIndex}`} gap="100">
                            {section.title ? (
                              <Text as="h6" variant="headingSm">
                                {section.title}
                              </Text>
                            ) : null}
                            {section.paragraphs.map((paragraph, paragraphIndex) => (
                              <Text
                                key={`${section.title}-paragraph-${paragraphIndex}`}
                                as="p"
                                variant="bodySm"
                                tone="subdued"
                              >
                                {paragraph}
                              </Text>
                            ))}
                            {section.points.length > 0 ? (
                              <ul style={{ margin: "4px 0 0", paddingLeft: "20px" }}>
                                {section.points.map((point, pointIndex) => (
                                  <li key={`${section.title}-point-${pointIndex}`} style={{ marginBottom: "6px" }}>
                                    <Text as="span" variant="bodySm" tone="subdued">
                                      {point}
                                    </Text>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </BlockStack>
                        ))}
                      </BlockStack>
                    </div>
                  ) : htmlPreview ? (
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
  const categoriesSet = new Set(currentTemplates.map((t) => getCategory(t)));
  const categories = [ ...[...categoriesSet].sort()];
  const categoryCounts = currentTemplates.reduce((counts, template) => {
    const category = getCategory(template);
    counts.set(category, (counts.get(category) || 0) + 1);
    return counts;
  }, new Map());

  const filtered =
    selectedCategory === "All"
      ? currentTemplates
      : currentTemplates.filter((t) => getCategory(t) === selectedCategory);

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
                          {cat} ({categoryCounts.get(cat) || 0})
                        </Button>
                      ))}
                    </BlockStack>
                  </Box>
                </Card>

                <div>
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
