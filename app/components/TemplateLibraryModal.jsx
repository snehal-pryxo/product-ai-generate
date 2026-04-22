import { useMemo, useState } from "react";
import { buildDescriptionStructuredPreview, buildMetaPreviewText } from "../lib/templatePreviewFormat";

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
  // Product Meta Title
  "mt-benefit-first": "SEO Optimized",
  "mt-product-feature": "Technical & Specs",
  "mt-intent-buy-now": "Marketing & Sales",
  "mt-category-seo": "SEO Optimized",
  "mt-problem-solution": "Marketing & Sales",
  "mt-quality-value": "Product Categories",
  "mt-usage-occasion": "Lifestyle & Emotion",
  "mt-promo": "Seasonal & Events",
  // Collection Description
  "col-problem-solution": "Marketing & Sales",
  "col-technical-specifications": "Technical & Specs",
  "col-lifestyle-integration": "Lifestyle & Emotion",
  "col-eco-friendly-product": "Product Categories",
  "col-premium-luxury-product": "Brands & Luxury",
  "col-budget-friendly-product": "Product Categories",
  "col-seasonal-limited-edition": "Seasonal & Events",
  "col-collection-comparison": "Product Categories",
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
function PreviewPanel({ template, category, contentTypeLabel, contentTypeId, onClose, onUse }) {
  const length = getLengthLabel(template.template);
  const isDescriptionPreview = contentTypeId === "description";
  const isMetaPreview = contentTypeId === "meta_description" || contentTypeId === "meta_title";
  const metaPreviewText = useMemo(() => buildMetaPreviewText(template), [template]);
  const descriptionPreview = useMemo(
    () => buildDescriptionStructuredPreview(template, template?.name || ""),
    [template],
  );
  return (
    <div className="template-library-modal__preview" style={{
      position: "absolute", inset: 0, zIndex: 20,
      background: "#fff",
      display: "flex", flexDirection: "column",
      borderRadius: "12px", overflow: "hidden",
    }}>
      {/* Preview header */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
        <button
          onClick={onClose}
          style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: "6px", cursor: "pointer", fontSize: "13px", padding: "6px 12px", fontWeight: 500, color: "#374151", display: "flex", alignItems: "center", gap: "4px" }}
        >
          ← Back
        </button>
        <span style={{ flex: 1, fontWeight: 700, fontSize: "15px", color: "#111", textAlign: "center" }}>{template.name}</span>
        <button onClick={onUse} style={{ padding: "7px 18px", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap" }}>
          Use template
        </button>
      </div>

      {/* Preview body — two columns */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left: main content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontWeight: 700, fontSize: "13px", color: "#111", marginBottom: "6px" }}>About this template</div>
            <p style={{ fontSize: "13px", color: "#6b7280", margin: 0, lineHeight: "1.6" }}>
              {template.description || "Use this template to generate AI content tailored for your product."}
            </p>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: "13px", color: "#111", marginBottom: "8px" }}>Template Prompt:</div>
            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "14px 16px", fontFamily: "monospace", fontSize: "12px", lineHeight: "1.8", whiteSpace: "pre-wrap", color: "#374151" }}>
              {template.template}
            </div>
          </div>

          {isDescriptionPreview && descriptionPreview && (
            <div style={{ marginTop: "16px" }}>
              <div style={{ fontWeight: 700, fontSize: "13px", color: "#111", marginBottom: "8px" }}>
                Descriptions will look like this:
              </div>
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
                <div style={{ fontSize: "18px", fontWeight: 700, color: "#111", marginBottom: "8px", lineHeight: "1.35" }}>
                  {descriptionPreview.heading}
                </div>
                <div style={{ fontSize: "14px", color: "#6b7280", marginBottom: "14px", lineHeight: "1.5" }}>
                  {descriptionPreview.subheading}
                </div>
                {descriptionPreview.sections.map((section) => (
                  <div key={section.title} style={{ marginBottom: "12px" }}>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#111", marginBottom: "6px" }}>
                      {section.title}
                    </div>
                    {section.paragraphs.map((paragraph, idx) => (
                      <p key={`${section.title}-p-${idx}`} style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#374151", lineHeight: "1.6" }}>
                        {paragraph}
                      </p>
                    ))}
                    {section.points.length > 0 && (
                      <ul style={{ margin: "0", paddingLeft: "18px" }}>
                        {section.points.map((point, idx) => (
                          <li key={`${section.title}-pt-${idx}`} style={{ marginBottom: "6px", fontSize: "14px", color: "#374151", lineHeight: "1.6" }}>
                            {point}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isMetaPreview && (
            <div style={{ marginTop: "16px" }}>
              <div style={{ fontWeight: 700, fontSize: "13px", color: "#111", marginBottom: "8px" }}>
                {contentTypeId === "meta_title" ? "Meta Title Preview:" : "Meta Description Preview:"}
              </div>
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "14px 16px", fontSize: "14px", lineHeight: "1.6", color: "#374151" }}>
                {metaPreviewText}
              </div>
            </div>
          )}
        </div>

        {/* Right: sidebar details */}
        <div style={{ width: "200px", borderLeft: "1px solid #e5e7eb", padding: "20px 16px", flexShrink: 0, overflowY: "auto" }}>
          <div style={{ fontWeight: 700, fontSize: "13px", color: "#111", marginBottom: "14px" }}>Template Details</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <div style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "3px" }}>Category</div>
              <div style={{ fontSize: "13px", color: "#374151" }}>{category}</div>
            </div>
            {contentTypeLabel && (
              <div>
                <div style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "3px" }}>Content Type</div>
                <div style={{ fontSize: "13px", color: "#374151" }}>{contentTypeLabel}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px" }}>Length</div>
              <span style={{ background: length.bg, color: length.color, borderRadius: "10px", padding: "2px 10px", fontSize: "12px", fontWeight: 600 }}>
                {length.label}
              </span>
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "3px" }}>Language</div>
              <div style={{ fontSize: "13px", color: "#374151" }}>English</div>
            </div>
          </div>
        </div>
      </div>
    </div>
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
  const [previewTemplate, setPreviewTemplate] = useState(null);

  if (!open) return null;

  const activeTabLabel = tabs.find((t) => t.id === activeTab)?.label || activeTab;
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
    setPreviewTemplate(null);
  }

  function handleUse(template) {
    onUseTemplate(template.template);
    onClose();
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="template-library-modal__dialog" style={{
        background: "#fff",
        borderRadius: "12px",
        width: "min(94vw, 920px)",
        maxHeight: "88vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0,0,0,0.28)",
        position: "relative",
      }}>
        {/* Preview overlay */}
        {previewTemplate && (
          <PreviewPanel
            template={previewTemplate}
            category={getCategory(previewTemplate.id)}
            contentTypeLabel={activeTabLabel}
            contentTypeId={activeTab}
            onClose={() => setPreviewTemplate(null)}
            onUse={() => { handleUse(previewTemplate); }}
          />
        )}

        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 700, fontSize: "16px", color: "#111" }}>Template Library</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px", color: "#6b7280", lineHeight: 1, padding: "4px 8px", borderRadius: "4px" }}
          >✕</button>
        </div>

        {/* Tabs */}
        {tabs.length > 1 && (
          <div style={{ display: "flex", gap: "0", borderBottom: "1px solid #e5e7eb", padding: "0 20px", flexShrink: 0, overflowX: "auto" }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                style={{
                  padding: "10px 18px",
                  border: "none",
                  background: activeTab === tab.id ? "#000" : "none",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  color: activeTab === tab.id ? "#fff" : "#6b7280",
                  borderRadius: "6px 6px 0 0",
                  borderBottom: activeTab === tab.id ? "2px solid #1a1a1a" : "2px solid transparent",
                  whiteSpace: "nowrap",
                  transition: "color 0.15s, background 0.15s",
                }}
              >
                {activeTab === tab.id && <span style={{ marginRight: "6px" }}>✓</span>}
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="template-library-modal__body" style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Categories sidebar */}
          <div className="template-library-modal__sidebar" style={{ width: "180px", borderRight: "1px solid #e5e7eb", overflowY: "auto", padding: "8px 0", flexShrink: 0 }}>
            <div style={{ padding: "8px 16px 4px", fontSize: "11px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Categories
            </div>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 16px",
                  border: "none",
                  background: selectedCategory === cat ? "#f3f4f6" : "none",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: selectedCategory === cat ? 600 : 400,
                  color: selectedCategory === cat ? "#111" : "#374151",
                  borderLeft: selectedCategory === cat ? "3px solid #1a1a1a" : "3px solid transparent",
                  transition: "all 0.1s",
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Templates grid */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
            <div style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>Templates</span>
              <span style={{ background: "#e0f2fe", color: "#0369a1", borderRadius: "10px", padding: "2px 8px", fontSize: "11px", fontWeight: 600 }}>
                {filtered.length} templates
              </span>
            </div>

            {filtered.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: "14px" }}>
                No templates in this category.
              </div>
            ) : (
              <div className="app-card-grid" style={{ gap: "14px" }}>
                {filtered.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      padding: "14px",
                      background: "#fff",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      transition: "box-shadow 0.15s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
                      <span style={{ fontWeight: 600, fontSize: "13px", color: "#111", lineHeight: "1.4" }}>{t.name}</span>
                      <span style={{
                        background: "#f3f4f6", color: "#6b7280",
                        borderRadius: "4px", padding: "2px 6px",
                        fontSize: "11px", fontWeight: 500, flexShrink: 0,
                      }}>
                        {t.template.length}
                      </span>
                    </div>
                    <p style={{ fontSize: "12px", color: "#6b7280", margin: 0, lineHeight: "1.45" }}>
                      {t.description}
                    </p>
                    <div style={{ display: "flex", gap: "8px", marginTop: "auto" }}>
                      <button
                        onClick={() => handleUse(t)}
                        style={{
                          flex: 1, padding: "7px 10px",
                          background: "#1a1a1a", color: "#fff",
                          border: "none", borderRadius: "6px",
                          cursor: "pointer", fontSize: "12px", fontWeight: 600,
                        }}
                      >
                        Use Template
                      </button>
                      <button
                        onClick={() => setPreviewTemplate(t)}
                        style={{
                          padding: "7px 10px",
                          background: "#fff", color: "#374151",
                          border: "1px solid #d1d5db", borderRadius: "6px",
                          cursor: "pointer", fontSize: "12px",
                          display: "flex", alignItems: "center", gap: "4px",
                        }}
                      >
                        <span>👁</span> Preview
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="template-library-modal__footer-actions" style={{ padding: "10px 20px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{ padding: "8px 20px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
