import { useState } from "react";
import { useLoaderData, useActionData, Form, useNavigation, useNavigate, useLocation } from "react-router";
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
  Divider,
  Box,
  Badge,
  Icon,
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
  ChatIcon,
  QuestionCircleIcon,
  AppsIcon,
} from "@shopify/polaris-icons";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { defaultAiModel: true },
  });
  return {
    defaultAiModel: shopData?.defaultAiModel || "gpt-4o-mini",
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_settings") {
    const defaultAiModel = formData.get("defaultAiModel")?.trim() || "gpt-4o-mini";
    await db.shop.upsert({
      where: { shop },
      update: { defaultAiModel },
      create: { shop, installed: true, defaultAiModel },
    });
    return { success: true, message: "Settings saved successfully!" };
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
    icon: "🛒",
    iconBg: "#22c55e",
    title: "CartLift: Cart Drawer & Upsell",
    badge: "Upsell",
    badgeColor: "#e0f2fe",
    badgeText: "#0369a1",
    desc: "Grow average order value with cart drawer upsells and smart cart offers.",
    url: "#",
  },
  {
    icon: "🔔",
    iconBg: "#a855f7",
    title: "Fomoify Sales Popup & Proof",
    badge: "Social Proof",
    badgeColor: "#f3e8ff",
    badgeText: "#7c3aed",
    desc: "Increase trust using real-time sales popups and conversion proof nudges.",
    url: "#",
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
  const { defaultAiModel } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const isSaving = navigation.state === "submitting";

  const [selectedModel, setSelectedModel] = useState(
    () => (typeof defaultAiModel === "string" && defaultAiModel.trim()) ? defaultAiModel.trim() : "gpt-4o-mini"
  );

  return (
    <Page fullWidth>
      <BlockStack gap="600">

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
          </div>
        </Card>

        {/* ── Generate Content Cards ── */}
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text variant="headingMd" as="h2">Generate Content</Text>
            <Text variant="bodySm" tone="subdued">Pick a content type to get started</Text>
          </BlockStack>
          <Grid columns={{ xs: 2, sm: 2, md: 4, lg: 4, xl: 4 }}>
            {CONTENT_FEATURES.map((card) => (
              <Grid.Cell key={card.title}>
                <FeatureCard {...card} />
              </Grid.Cell>
            ))}
          </Grid>
        </BlockStack>

        {/* ── Analytics + AI Model ── */}
        <Grid columns={{ xs: 1, sm: 1, md: 3, lg: 3, xl: 3 }}>
          <Grid.Cell columnSpan={{ xs: 1, sm: 1, md: 1, lg: 1, xl: 1 }}>
            <BlockStack gap="300">
              {/* Analytics card */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => navigate({ pathname: "/app/analytics", search: location.search })}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate({ pathname: "/app/analytics", search: location.search }); } }}
                style={{ cursor: "pointer" }}
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
              {/* Settings card */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => navigate({ pathname: "/app/settings", search: location.search })}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate({ pathname: "/app/settings", search: location.search }); } }}
                style={{ cursor: "pointer" }}
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
            </BlockStack>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2 }}>
            {actionData && (
              <Box paddingBlockEnd="300">
                <Banner
                  tone={actionData.success ? "success" : "critical"}
                  onDismiss={() => {}}
                >
                  <p>{actionData.message}</p>
                </Banner>
              </Box>
            )}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text variant="headingMd" as="h2">Default AI Model</Text>
                  <Text variant="bodySm" tone="subdued">
                    Choose the AI model used for all content generation across your store.
                  </Text>
                </BlockStack>
                <Form method="post">
                  <input type="hidden" name="intent" value="save_settings" />
                  <input type="hidden" name="defaultAiModel" value={selectedModel} />
                  <BlockStack gap="300">
                    <Select
                      label="AI Model"
                      labelHidden
                      options={AI_MODELS}
                      value={selectedModel}
                      onChange={setSelectedModel}
                    />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                      {AI_MODELS.slice(0, 3).map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => setSelectedModel(m.value)}
                          style={{
                            padding: "8px 10px",
                            borderRadius: "6px",
                            border: `1px solid ${selectedModel === m.value ? "#008060" : "#e4e5e7"}`,
                            background: selectedModel === m.value ? "rgba(0,128,96,0.06)" : "#fafafa",
                            color: selectedModel === m.value ? "#008060" : "#374151",
                            fontSize: "11px",
                            fontWeight: selectedModel === m.value ? 700 : 400,
                            cursor: "pointer",
                            textAlign: "center",
                          }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <InlineStack align="end">
                      <Button
                        submit
                        variant="primary"
                        tone="success"
                        loading={isSaving}
                        disabled={isSaving}
                      >
                        {isSaving ? "Saving…" : "Save Settings"}
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
            <Grid columns={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2 }}>
              {PARTNER_APPS.map((app) => (
                <Grid.Cell key={app.title}>
                  <div style={{ border: "1px solid #e4e5e7", borderRadius: "8px", padding: "16px" }}>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="start">
                        <InlineStack gap="300" blockAlign="center">
                          <div style={{ width: 44, height: 44, borderRadius: 10, background: app.iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", flexShrink: 0 }}>
                            {app.icon}
                          </div>
                          <BlockStack gap="050">
                            <Text variant="headingSm" as="h3" fontWeight="bold">{app.title}</Text>
                          </BlockStack>
                        </InlineStack>
                        <div style={{ background: app.badgeColor, color: app.badgeText, borderRadius: "12px", padding: "3px 10px", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap" }}>
                          {app.badge}
                        </div>
                      </InlineStack>
                      <Text variant="bodySm" tone="subdued">{app.desc}</Text>
                      <Button url="#" variant="primary" icon={ExternalIcon} size="slim">
                        + Add app
                      </Button>
                    </BlockStack>
                  </div>
                </Grid.Cell>
              ))}
            </Grid>
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

            <Grid columns={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2 }}>
              {/* Left: Setup Call + Support */}
              <Grid.Cell>
                <BlockStack gap="400">
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="300">
                      <Text variant="headingSm" as="h3" fontWeight="bold">Book a Free 30-Minute Setup Call</Text>
                      <Text variant="bodySm" tone="subdued">Get personalized guidance to accelerate your growth.</Text>
                      <InlineStack gap="200">
                        {["App configuration", "Best practices", "Growth strategy"].map((t) => (
                          <Text key={t} variant="bodySm" fontWeight="semibold" as="span">{t}</Text>
                        ))}
                      </InlineStack>
                      <InlineStack gap="300" blockAlign="center">
                        <Button url="#" variant="primary">Schedule Free Call</Button>
                        <Text variant="bodySm" tone="subdued" as="span">Free | 30 mins | No commitment</Text>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="300">
                      <Text variant="headingSm" as="h3" fontWeight="bold">Support</Text>
                      <Grid columns={{ xs: 2, sm: 2, md: 2, lg: 2, xl: 2 }}>
                        <Grid.Cell>
                          <div style={{ border: "1px solid #e4e5e7", borderRadius: 6, padding: "12px", textAlign: "center" }}>
                            <BlockStack gap="100" align="center">
                              <Icon source={EmailIcon} tone="interactive" />
                              <Text variant="bodySm" fontWeight="semibold" as="span">
                                <a href="#" style={{ color: "#2563eb", textDecoration: "none" }}>Support Ticket</a>
                              </Text>
                              <Text variant="bodySm" tone="subdued">Support, reply, and assist instantly in office hours.</Text>
                            </BlockStack>
                          </div>
                        </Grid.Cell>
                        <Grid.Cell>
                          <div style={{ border: "1px solid #e4e5e7", borderRadius: 6, padding: "12px", textAlign: "center" }}>
                            <BlockStack gap="100" align="center">
                              <Icon source={QuestionCircleIcon} tone="interactive" />
                              <Text variant="bodySm" fontWeight="semibold" as="span">
                                <a href="#" style={{ color: "#2563eb", textDecoration: "none" }}>Knowledge base</a>
                              </Text>
                              <Text variant="bodySm" tone="subdued">Find a solution to your problem with our documents.</Text>
                            </BlockStack>
                          </div>
                        </Grid.Cell>
                      </Grid>
                    </BlockStack>
                  </Card>
                </BlockStack>
              </Grid.Cell>

              {/* Right: Quick Help + Review */}
              <Grid.Cell>
                <BlockStack gap="400">
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="300">
                      <Text variant="headingSm" as="h3" fontWeight="bold">Need Quick Help?</Text>
                      <Text variant="bodySm" tone="subdued">Reach out anytime for support, feedback, or just to share your progress.</Text>
                      <ButtonGroup>
                        <Button url="#" icon={ChatIcon}>WhatsApp</Button>
                        <Button url="#" icon={ChatIcon}>Live Chat</Button>
                      </ButtonGroup>
                    </BlockStack>
                  </Card>

                  {/* Review Section */}
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="300" align="center">
                      <InlineStack align="center">
                        <div style={{ width: 52, height: 52, borderRadius: 12, background: "linear-gradient(135deg, #f43f5e 0%, #ec4899 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Icon source={StarFilledIcon} tone="base" />
                        </div>
                      </InlineStack>
                      <Text variant="headingSm" as="h3" fontWeight="bold" alignment="center">
                        Motivate our team for future app development
                      </Text>
                      <ButtonGroup>
                        <Button url="#" variant="primary">Write a review</Button>
                        <Button url="#">Report an issue</Button>
                      </ButtonGroup>
                    </BlockStack>
                  </Card>
                </BlockStack>
              </Grid.Cell>
            </Grid>
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
