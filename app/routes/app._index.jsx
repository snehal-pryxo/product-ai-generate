import { useEffect, useState } from "react";
import { useLoaderData, useActionData, Form, useFetcher, useNavigation, useNavigate, useLocation, useRouteLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Page,
  Banner,
  Card,
  Grid,
  BlockStack,
  InlineStack,
  Text,
  Button,
  ButtonGroup,
  Select,
  Box,
  Badge,
  Icon,
  Modal,
  TextField,
} from "@shopify/polaris";
import {
  ProductIcon,
  CollectionIcon,
  BlogIcon,
  PageIcon,
  ChartVerticalIcon,
  SettingsIcon,
  StarFilledIcon,
  ExternalIcon,
  EmailIcon,
  QuestionCircleIcon,
  AppsIcon,
} from "@shopify/polaris-icons";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const envDefaultAiModel =
    (process.env.AI_MODEL || "").trim() ||
    (process.env.OPENAI_MODEL || "").trim() ||
    "gpt-4o-mini";
  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: {
      defaultAiModel: true,
      createdAt: true,
      onboardedAt: true,
      reviewSubmittedAt: true,
      reviewPromptDismissedAt: true,
    },
  });

  const installDate = shopData?.onboardedAt || shopData?.createdAt;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const installAgeMs = installDate ? Date.now() - new Date(installDate).getTime() : 0;
  const shouldShowReviewPopup = Boolean(
    shopData &&
    installDate &&
    installAgeMs >= sevenDaysMs &&
    !shopData.reviewSubmittedAt &&
    !shopData.reviewPromptDismissedAt,
  );

  return {
    defaultAiModel: shopData?.defaultAiModel || envDefaultAiModel,
    envDefaultAiModel,
    shouldShowReviewPopup,
    hasSubmittedReview: Boolean(shopData?.reviewSubmittedAt),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_settings") {
    const envDefaultAiModel =
      (process.env.AI_MODEL || "").trim() ||
      (process.env.OPENAI_MODEL || "").trim() ||
      "gpt-4o-mini";
    const defaultAiModel = formData.get("defaultAiModel")?.trim() || envDefaultAiModel;
    await db.shop.upsert({
      where: { shop },
      update: { defaultAiModel },
      create: { shop, installed: true, defaultAiModel },
    });
    return { success: true, message: "Settings saved successfully!" };
  }

  if (intent === "submit_review") {
    const reviewRating = Number(formData.get("reviewRating"));
    const reviewFeedbackRaw = String(formData.get("reviewFeedback") || "");
    const reviewFeedback = reviewFeedbackRaw.trim();

    if (!Number.isInteger(reviewRating) || reviewRating < 1 || reviewRating > 5) {
      return { success: false, message: "Please select a rating between 1 and 5." };
    }

    const submittedAt = new Date();
    await db.shop.upsert({
      where: { shop },
      update: {
        reviewSubmittedAt: submittedAt,
        reviewRating,
        reviewFeedback: reviewFeedback || null,
        reviewPromptDismissedAt: null,
      },
      create: {
        shop,
        installed: true,
        reviewSubmittedAt: submittedAt,
        reviewRating,
        reviewFeedback: reviewFeedback || null,
      },
    });

    return { success: true, message: "Thank you for your review." };
  }

  if (intent === "dismiss_review") {
    const dismissedAt = new Date();
    await db.shop.upsert({
      where: { shop },
      update: { reviewPromptDismissedAt: dismissedAt },
      create: { shop, installed: true, reviewPromptDismissedAt: dismissedAt },
    });

    return { success: true, message: "Review popup dismissed." };
  }

  return { success: false, message: "Unknown action." };
};

const AI_MODELS = [
  { label: "Claude Haiku 4.5", value: "claude-haiku-4.5" },
  { label: "Claude Sonnet 4.6", value: "claude-sonnet-4.6" },
  { label: "GPT-4o mini", value: "gpt-4o-mini" },
  { label: "Gemini Flash-Lite", value: "gemini-flash-lite" },
  { label: "DeepSeek V3.2", value: "deepseek-v3.2" },
  { label: "Cohere Command R+", value: "cohere-command-r-plus" },
];

function toModelLabel(model) {
  return String(model || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getAiModelOptions(envModel) {
  const value = String(envModel || "").trim();
  if (!value) return AI_MODELS;
  if (AI_MODELS.some((item) => item.value === value)) return AI_MODELS;
  return [{ label: `${toModelLabel(value)} (ENV)`, value }, ...AI_MODELS];
}

const CONTENT_FEATURES = [
  {
    icon: ProductIcon,
    color: "#008060",
    bg: "rgba(0,128,96,0.08)",
    border: "rgba(0,128,96,0.2)",
    title: "Products",
    desc: "SEO titles, meta descriptions & rich product copy — generated instantly.",
    url: "/app/products",
    badge: "Most Popular",
    badgeTone: "success",
  },
  {
    icon: CollectionIcon,
    color: "#2C6ECB",
    bg: "rgba(44,110,203,0.08)",
    border: "rgba(44,110,203,0.2)",
    title: "Collections",
    desc: "Auto-generate rich descriptions for every collection in your store.",
    url: "/app/collections",
    badge: null,
    badgeTone: null,
  },
  {
    icon: BlogIcon,
    color: "#E07D10",
    bg: "rgba(224,125,16,0.08)",
    border: "rgba(224,125,16,0.2)",
    title: "Blog Posts",
    desc: "Full articles in 180+ languages with one click — publish-ready.",
    url: "/app/blog",
    badge: "180+ Languages",
    badgeTone: "warning",
  },
  {
    icon: PageIcon,
    color: "#8456CD",
    bg: "rgba(132,86,205,0.08)",
    border: "rgba(132,86,205,0.2)",
    title: "Pages",
    desc: "About, FAQ, Contact and landing page content crafted by AI.",
    url: "/app/pages",
    badge: null,
    badgeTone: null,
  },
];

const PARTNER_APPS = [
  {
    logoSrc: "/images/fomoify-logo.png",
    title: "Fomoify Sales Popup & Proof",
    badge: "Social Proof",
    badgeColor: "#f3e8ff",
    badgeText: "#7c3aed",
    desc: "Increase trust using real-time sales popups and conversion proof nudges.",
    url: "https://apps.shopify.com/fomoify-sales-popup-proof",
  },
  {
    logoSrc: "/images/cartlift-logo.png",
    title: "FCartLift: Cart Drawer & Upsell",
    badge: "Upsell",
    badgeColor: "#e0f2fe",
    badgeText: "#0369a1",
    desc: "Grow average order value with cart drawer upsells and smart cart offers.",
    url: "https://apps.shopify.com/cartlift-cart-drawer-upsell",
  },
  {
    logoSrc: "/images/mixbox-logo.png",
    title: "MixBox – Box & Bundle Builder",
    badge: "Bundle",
    badgeColor: "#fee2e2",
    badgeText: "#dc2626",
    desc: "Create customizable product boxes and bundles to increase average order value.",
    url: "https://apps.shopify.com/mixbox-box-bundle-builder",
  },
];


function FeatureCard({ icon, color, bg, border, title, desc, url, badge, badgeTone }) {
  const [hovered, setHovered] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate({ pathname: url, search: location.search })}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate({ pathname: url, search: location.search }); } }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ cursor: "pointer", height: "100%" }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "8px",
          padding: "16px",
          border: `1px solid ${hovered ? color : "#e4e5e7"}`,
          boxShadow: hovered ? `0 4px 16px ${bg}` : "0 1px 3px rgba(0,0,0,0.04)",
          transition: "all 0.2s ease",
          transform: hovered ? "translateY(-2px)" : "none",
          height: "100%",
          boxSizing: "border-box",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* top accent */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: color, borderRadius: "8px 8px 0 0" }} />
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="start">
            <div style={{ width: 36, height: 36, borderRadius: 8, background: bg, border: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon source={icon} tone="base" />
            </div>
            {badge && <Badge tone={badgeTone}>{badge}</Badge>}
          </InlineStack>
          <BlockStack gap="100">
            <Text variant="headingSm" as="h3" fontWeight="bold">{title}</Text>
            <Text variant="bodySm" tone="subdued">{desc}</Text>
          </BlockStack>
          <Text variant="bodySm" fontWeight="semibold" as="span">
            <span style={{ color }}>Generate now →</span>
          </Text>
        </BlockStack>
      </div>
    </div>
  );
}

export default function Index() {
  const { defaultAiModel, envDefaultAiModel, shouldShowReviewPopup, hasSubmittedReview } = useLoaderData();
  const layoutData = useRouteLoaderData("routes/app");
  const credits = layoutData?.credits ?? 0;
  const actionData = useActionData();
  const reviewFetcher = useFetcher();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const isSaving = navigation.state === "submitting";

  const [selectedModel, setSelectedModel] = useState(
    () => (typeof defaultAiModel === "string" && defaultAiModel.trim()) ? defaultAiModel.trim() : "gpt-4o-mini"
  );
  const aiModelOptions = getAiModelOptions(envDefaultAiModel || defaultAiModel);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(() => Boolean(shouldShowReviewPopup));
  const [reviewAlreadySubmitted, setReviewAlreadySubmitted] = useState(() => Boolean(hasSubmittedReview));
  const [reviewRating, setReviewRating] = useState("5");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const reviewIntent = String(reviewFetcher.formData?.get("intent") || "");
  const isSubmittingReview = reviewFetcher.state !== "idle" && reviewIntent === "submit_review";
  const isDismissingReview = reviewFetcher.state !== "idle" && reviewIntent === "dismiss_review";

  useEffect(() => {
    setReviewAlreadySubmitted(Boolean(hasSubmittedReview));
    setIsReviewModalOpen(Boolean(shouldShowReviewPopup) && !Boolean(hasSubmittedReview));
  }, [shouldShowReviewPopup, hasSubmittedReview]);

  useEffect(() => {
    if (!reviewFetcher.data?.success) return;
    if (reviewIntent !== "submit_review" && reviewIntent !== "dismiss_review") return;
    if (reviewIntent === "submit_review") {
      setReviewAlreadySubmitted(true);
    }
    setIsReviewModalOpen(false);
  }, [reviewFetcher.data, reviewIntent]);

  function handleDismissReviewPopup() {
    if (isSubmittingReview || isDismissingReview) return;
    const payload = new FormData();
    payload.append("intent", "dismiss_review");
    reviewFetcher.submit(payload, { method: "post" });
  }

  return (
    <Page fullWidth>
      <BlockStack gap="600">
        <Modal
          open={isReviewModalOpen}
          onClose={handleDismissReviewPopup}
          title="How is your experience with Product AI?"
        >
          <Modal.Section>
            <reviewFetcher.Form method="post">
              <input type="hidden" name="intent" value="submit_review" />
              <input type="hidden" name="reviewRating" value={reviewRating} />
              <input type="hidden" name="reviewFeedback" value={reviewFeedback} />
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd" tone="subdued">
                  You have used the app for 7 days. Please share a quick review to help us improve.
                </Text>
                <Select
                  label="Rating"
                  options={[
                    { label: "5 - Excellent", value: "5" },
                    { label: "4 - Good", value: "4" },
                    { label: "3 - Average", value: "3" },
                    { label: "2 - Poor", value: "2" },
                    { label: "1 - Very poor", value: "1" },
                  ]}
                  value={reviewRating}
                  onChange={setReviewRating}
                />
                <TextField
                  label="Feedback (optional)"
                  value={reviewFeedback}
                  onChange={setReviewFeedback}
                  multiline={4}
                  autoComplete="off"
                  placeholder="Tell us what worked well and what we can improve."
                />
                <InlineStack align="end" gap="200">
                  <Button onClick={handleDismissReviewPopup} disabled={isSubmittingReview || isDismissingReview}>
                    Not now
                  </Button>
                  <Button submit variant="primary" loading={isSubmittingReview} disabled={isSubmittingReview || isDismissingReview}>
                    Submit review
                  </Button>
                </InlineStack>
              </BlockStack>
            </reviewFetcher.Form>
          </Modal.Section>
        </Modal>

        {/* ── Hero ── */}
        <Card>
          <div
            style={{
              background: "linear-gradient(135deg, #0a1628 0%, #0d2a4a 40%, #0a3d2e 100%)",
              borderRadius: "8px",
              padding: "24px 28px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "180px", height: "180px", borderRadius: "50%", background: "radial-gradient(circle, rgba(0,179,116,0.2) 0%, transparent 70%)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", bottom: "-30px", left: "30%", width: "140px", height: "140px", borderRadius: "50%", background: "radial-gradient(circle, rgba(61,130,245,0.15) 0%, transparent 70%)", pointerEvents: "none" }} />

            <div className="app-hero-content">
              <BlockStack gap="400">
                {/* Badge */}
                <div style={{ display: "inline-flex" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(0,179,116,0.15)", border: "1px solid rgba(0,179,116,0.3)", color: "#4ade80", borderRadius: "20px", padding: "4px 12px", fontSize: "11px", fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
                    AI-Powered · Shopify Native
                  </div>
                </div>

                <Text variant="heading2xl" as="h1">
                  <span style={{ background: "linear-gradient(90deg, #ffffff, #94d2bd)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                    Generate SEO Content Powered by AI
                  </span>
                </Text>

                <Text variant="bodyMd" tone="subdued" as="p">
                  <span style={{ color: "rgba(255,255,255,0.6)" }}>
                    Create product descriptions, blog posts, collection pages and more — optimized for SEO and ready to publish.
                  </span>
                </Text>

                {/* Stats strip */}
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {[
                    { value: "5", label: "Content Types" },
                    { value: "180+", label: "Languages" },
                    { value: "2", label: "AI Providers" },
                    { value: "∞", label: "Generations" },
                  ].map((s) => (
                    <div key={s.label} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", padding: "8px 14px", textAlign: "center", minWidth: "70px" }}>
                      <div style={{ fontSize: "18px", fontWeight: 800, color: "#fff", lineHeight: 1 }}>{s.value}</div>
                      <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.6)", marginTop: "2px", fontWeight: 500 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </BlockStack>

              {/* Right side: Credits & Upgrade */}
              <div className="app-hero-actions" style={{ display: "flex", flexDirection: "column", gap: "8px", flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => navigate({ pathname: "/app/analytics", search: location.search })}
                  style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "#fff", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="#f59e0b">
                    <path d="M10 1L12.39 7.26L19 8.27L14.5 12.64L15.78 19.02L10 15.77L4.22 19.02L5.5 12.64L1 8.27L7.61 7.26L10 1Z"/>
                  </svg>
                  <span>{credits} Credits</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate({ pathname: "/app/analytics", search: location.search })}
                  style={{ display: "inline-flex", alignItems: "center", background: "#111827", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  Upgrade
                </button>
              </div>
            </div>
          </div>
        </Card>

        {/* ── Generate Content Cards ── */}
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text variant="headingMd" as="h2">Generate Content</Text>
              <Text variant="bodySm" tone="subdued">Pick a content type to get started</Text>
            </BlockStack>
          </InlineStack>
          {/* Content type tabs */}
          <Grid columns={{ xs: 2, sm: 2, md: 4, lg: 4, xl: 4 }}>
            {CONTENT_FEATURES.map((card) => (
              <Grid.Cell key={card.title}>
                <FeatureCard {...card} />
              </Grid.Cell>
            ))}
          </Grid>
        </BlockStack>

        {/* ── Analytics + Settings + AI Model (one line) ── */}
        {actionData && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            <p>{actionData.message}</p>
          </Banner>
        )}
        <Grid columns={{ xs: 1, sm: 1, md: 3, lg: 3, xl: 3 }}>
          {/* Analytics */}
          <Grid.Cell>
            <div
              role="button"
              tabIndex={0}
              onClick={() => navigate({ pathname: "/app/analytics", search: location.search })}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate({ pathname: "/app/analytics", search: location.search }); } }}
              style={{ cursor: "pointer", height: "100%" }}
            >
              <Card>
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(0,201,212,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon source={ChartVerticalIcon} tone="base" />
                    </div>
                    <Badge tone="info">Insights</Badge>
                  </InlineStack>
                  <Text variant="headingSm" as="h3">Analytics</Text>
                  <Text variant="bodySm" tone="subdued">SEO health scores, coverage charts and generation statistics.</Text>
                  <Text variant="bodySm" fontWeight="semibold" as="span"><span style={{ color: "#2C6ECB" }}>View analytics →</span></Text>
                </BlockStack>
              </Card>
            </div>
          </Grid.Cell>

          {/* Settings */}
          <Grid.Cell>
            <div
              role="button"
              tabIndex={0}
              onClick={() => navigate({ pathname: "/app/settings", search: location.search })}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate({ pathname: "/app/settings", search: location.search }); } }}
              style={{ cursor: "pointer", height: "100%" }}
            >
              <Card>
                <BlockStack gap="200">
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(107,114,128,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon source={SettingsIcon} tone="base" />
                  </div>
                  <Text variant="headingSm" as="h3">Settings</Text>
                  <Text variant="bodySm" tone="subdued">Configure language, word counts and default templates.</Text>
                  <Text variant="bodySm" fontWeight="semibold" as="span"><span style={{ color: "#374151" }}>Open settings →</span></Text>
                </BlockStack>
              </Card>
            </div>
          </Grid.Cell>

          {/* AI Model */}
          <Grid.Cell>
            <Card>
              <BlockStack gap="300">
                <BlockStack gap="100">
                  <Text variant="headingMd" as="h2">Default AI Model</Text>
                  <Text variant="bodySm" tone="subdued">
                    Choose the AI model for all content generation.
                  </Text>
                </BlockStack>
                <Form method="post">
                  <input type="hidden" name="intent" value="save_settings" />
                  <input type="hidden" name="defaultAiModel" value={selectedModel} />
                  <BlockStack gap="200">
                    <Select
                      label="AI Model"
                      labelHidden
                      options={aiModelOptions}
                      value={selectedModel}
                      onChange={setSelectedModel}
                    />
                    <InlineStack align="end">
                      <Button submit variant="primary" tone="success" loading={isSaving} disabled={isSaving}>
                        {isSaving ? "Saving…" : "Save"}
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Form>
              </BlockStack>
            </Card>
          </Grid.Cell>
        </Grid>

        {/* ── App Promotion Section ── */}
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <div style={{ width: 32, height: 32, borderRadius: 6, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon source={AppsIcon} tone="subdued" />
              </div>
              <Text variant="headingMd" as="h2">Boost your store performance with our apps</Text>
            </InlineStack>
            <div className="app-card-grid" style={{ gap: "12px" }}>
              {PARTNER_APPS.map((app) => (
                <div key={app.title} style={{ border: "1px solid #e4e5e7", borderRadius: "8px", padding: "16px", flex: "1 1 0", minWidth: "220px" }}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start">
                      <InlineStack gap="300" blockAlign="center">
                        <div style={{ width: 44, height: 44, borderRadius: 10, background: app.title.includes("MixBox"), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {app.logoSrc ? (
                            <img
                              src={app.logoSrc}
                              alt={`${app.title} logo`}
                              style={{ maxWidth: "32px", maxHeight: "32px", objectFit: "contain" }}
                            />
                          ) : null}
                        </div>
                        <Text variant="headingSm" as="h3" fontWeight="bold">{app.title}</Text>
                      </InlineStack>
                      <div style={{ background: app.badgeColor, color: app.badgeText, borderRadius: "12px", padding: "3px 10px", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {app.badge}
                      </div>
                    </InlineStack>
                    <Text variant="bodySm" tone="subdued">{app.desc}</Text>
                    <Button url={app.url} variant="primary" icon={ExternalIcon} size="slim" external>
                      + Add app
                    </Button>
                  </BlockStack>
                </div>
              ))}
            </div>
          </BlockStack>
        </Card>

        {/* ── Support & Help Section ── */}
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <div style={{ width: 32, height: 32, borderRadius: 6, background: "#eff6ff", border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#2563eb" }}>+</span>
              </div>
              <Text variant="headingMd" as="h2">We're Here to Help You Succeed</Text>
            </InlineStack>

            <div className="support-help-layout" style={{ display: "grid", gap: "16px" }}>
              {/* Box 1: Setup Call (small) */}
              <div className="support-help-box support-help-box--small" style={{ border: "1px solid #e4e5e7", borderRadius: "8px", padding: "16px", background: "#ffffff" }}>
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h3" fontWeight="bold">Book a Free 30-Minute Setup Call</Text>
                  <Text variant="bodySm" tone="subdued">Get personalized guidance to accelerate your growth.</Text>
                  <BlockStack gap="100">
                    {["App configuration", "Best practices", "Growth strategy"].map((t) => (
                      <Text key={t} variant="bodySm" fontWeight="semibold" as="span">{t}</Text>
                    ))}
                  </BlockStack>
                  <Button url="https://outlook.office.com/book/ShopifyGrowthConsultationCall@m2webdesigning.com/?ismsaljsauthenabled=true" variant="primary" fullWidth external>Schedule Free Call</Button>
                  <Text variant="bodySm" tone="subdued" as="span" alignment="center">Free | 30 mins | No commitment</Text>
                </BlockStack>
              </div>

              {/* Box 2: One big support row */}
              <div className="support-help-box support-help-box--large support-contact-card">
                <BlockStack gap="400">
                  <Text variant="headingSm" as="h3" fontWeight="bold">Support</Text>
                  <Grid columns={{ xs: 1, sm: 1, md: 3, lg: 3, xl: 3 }} gap="200">
                    <Grid.Cell>
                      <div className="support-contact-item">
                        <BlockStack gap="100" align="center">
                          <Icon source={EmailIcon} tone="interactive" />
                          <Text variant="headingSm" as="span" fontWeight="semibold" tone="interactive">
                            Support Ticket
                          </Text>
                          <Text variant="bodyMd" tone="subdued">Support, reply, and assist instantly in office hours.</Text>
                        </BlockStack>
                      </div>
                    </Grid.Cell>
                    <Grid.Cell>
                      <div className="support-contact-item">
                        <BlockStack gap="100" align="center">
                          <Icon source={QuestionCircleIcon} tone="interactive" />
                          <Text variant="headingSm" as="span" fontWeight="semibold" tone="interactive">
                            Knowledge base
                          </Text>
                          <Text variant="bodyMd" tone="subdued">Find a solution to your problem with our documents.</Text>
                        </BlockStack>
                      </div>
                    </Grid.Cell>
                    <Grid.Cell>
                      <div className="support-contact-item">
                        <BlockStack gap="100" align="center">
                          <Text variant="headingSm" fontWeight="semibold" as="span">Need Quick Help?</Text>
                          <InlineStack gap="200" distribute="center" style={{ justifyContent: "center" }}>
                            <Button
                              variant="primary"
                              size="slim"
                              url="https://wa.me/918320023122"
                              external
                            >
                              WhatsApp
                            </Button>
                          </InlineStack>
                          <Text variant="bodyMd" tone="subdued">Quick connect with our support team.</Text>
                        </BlockStack>
                      </div>
                    </Grid.Cell>
                  </Grid>
                </BlockStack>
              </div>

              {/* Box 3: Review (small) */}
              <div className="support-help-box support-help-box--small" style={{ borderRadius: "8px", padding: "40px", textAlign: "center",border: "1px solid #e4e5e7", background: "#ffffff"  }}>
                <BlockStack gap="200" align="center">
                  <div style={{ width: 52, height: 52, borderRadius: 10, background: "linear-gradient(135deg, #f43f5e 0%, #ec4899 100%)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
                    <Icon source={StarFilledIcon} tone="base" />
                  </div>
                  <Text variant="headingSm" as="h3" fontWeight="bold" alignment="center">
                    Motivate our team for future app development
                  </Text>
                  <InlineStack gap="200" distribute="center" justifyContent="center">
                  <Button
                    variant="primary"
                    size="slim"
                    onClick={() => {
                      if (!reviewAlreadySubmitted) setIsReviewModalOpen(true);
                    }}
                    disabled={reviewAlreadySubmitted}
                  >
                    {reviewAlreadySubmitted ? "Review submitted" : "Write a review"}
                  </Button>
                    <Button size="slim" onClick={() => {}}>Report an issue</Button>
                  </InlineStack>
                </BlockStack>
              </div>
            </div>
          </BlockStack>
        </Card>

        <Box paddingBlockEnd="800" />
      </BlockStack>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
