import { useState } from "react";

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
  // Blog Body
  "blog-body-how-to": "How-To & Guides",
  "blog-body-listicle": "Listicle",
  "blog-body-problem-solution": "Problem-Solution",
  "blog-body-beginner-guide": "Beginner Content",
  "blog-body-comparison": "Comparison",
  "blog-body-case-study": "Case Study",
  // Blog Meta Description
  "blog-md-learn-outcome": "How-To & Guides",
  "blog-md-problem-solution": "Problem-Solution",
  "blog-md-listicle": "Listicle",
  "blog-md-expert-tips": "How-To & Guides",
  "blog-md-action-cta": "Marketing",
  // Blog Meta Title
  "blog-mt-how-to": "How-To & Guides",
  "blog-mt-complete-guide": "How-To & Guides",
  "blog-mt-tips": "Listicle",
  "blog-mt-comparison": "Comparison",
  "blog-mt-best-for": "Marketing",
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

// ─── Preview Modal ────────────────────────────────────────────────────────────
function PreviewPanel({ template, onClose, onUse }) {
  return (
    <div className="template-library-modal__preview" style={{
      position: "absolute", inset: 0, zIndex: 20,
      background: "rgba(255,255,255,0.98)",
      display: "flex", flexDirection: "column",
      borderRadius: "12px", overflow: "hidden",
    }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "15px", color: "#111" }}>{template.name}</div>
          <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>{template.description}</div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px", color: "#6b7280", lineHeight: 1, padding: "4px 8px" }}
        >✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px", fontFamily: "monospace", fontSize: "13px", lineHeight: "1.7", whiteSpace: "pre-wrap", color: "#374151" }}>
          {template.template}
        </div>
      </div>
      <div className="template-library-modal__footer-actions" style={{ padding: "12px 20px", borderTop: "1px solid #e5e7eb", display: "flex", gap: "10px", justifyContent: "flex-end", flexShrink: 0 }}>
        <button onClick={onClose} style={{ padding: "8px 18px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}>Back</button>
        <button onClick={onUse} style={{ padding: "8px 18px", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>Use Template</button>
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
