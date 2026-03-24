import { useState } from "react";
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Page,
  Button,
  TextField,
  Banner,
  Badge,
  Box,
} from "@shopify/polaris";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { openaiApiKey: true, anthropicApiKey: true, defaultAiProvider: true },
  });
  return {
    hasOpenaiKey: !!shopData?.openaiApiKey,
    hasAnthropicKey: !!shopData?.anthropicApiKey,
    defaultAiProvider: shopData?.defaultAiProvider || "openai",
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_api_keys") {
    const openaiApiKey = formData.get("openaiApiKey")?.trim();
    const anthropicApiKey = formData.get("anthropicApiKey")?.trim();
    const defaultAiProvider = formData.get("defaultAiProvider")?.trim() || "openai";
    const updateData = { defaultAiProvider };
    if (openaiApiKey) updateData.openaiApiKey = openaiApiKey;
    if (anthropicApiKey) updateData.anthropicApiKey = anthropicApiKey;
    await db.shop.upsert({
      where: { shop },
      update: updateData,
      create: { shop, installed: true, ...updateData },
    });
    return { success: true, message: "Settings saved successfully!" };
  }

  if (intent === "clear_openai_key") {
    await db.shop.upsert({
      where: { shop },
      update: { openaiApiKey: null },
      create: { shop, installed: true },
    });
    return { success: true, message: "OpenAI API key removed." };
  }

  if (intent === "clear_anthropic_key") {
    await db.shop.upsert({
      where: { shop },
      update: { anthropicApiKey: null },
      create: { shop, installed: true },
    });
    return { success: true, message: "Anthropic API key removed." };
  }

  return { success: false, message: "Unknown action." };
};

const FEATURE_CARDS = [
  {
    gradient: "linear-gradient(135deg, #00b374 0%, #007a50 100%)",
    glow: "rgba(0,179,116,0.25)",
    icon: "📦",
    title: "Products",
    desc: "SEO titles, meta descriptions & rich product copy — generated instantly.",
    url: "/app/products",
    tag: "Most Popular",
  },
  {
    gradient: "linear-gradient(135deg, #3d82f5 0%, #1a5fcc 100%)",
    glow: "rgba(61,130,245,0.25)",
    icon: "🗂️",
    title: "Collections",
    desc: "Auto-generate rich descriptions for every collection in your store.",
    url: "/app/collections",
    tag: null,
  },
  {
    gradient: "linear-gradient(135deg, #f5a623 0%, #d4840a 100%)",
    glow: "rgba(245,166,35,0.25)",
    icon: "✍️",
    title: "Blog Posts",
    desc: "Full articles in 180+ languages with one click — publish-ready.",
    url: "/app/blog",
    tag: "180+ Languages",
  },
  {
    gradient: "linear-gradient(135deg, #9b6bff 0%, #6b3fbf 100%)",
    glow: "rgba(155,107,255,0.25)",
    icon: "📄",
    title: "Pages",
    desc: "About, FAQ, Contact and landing page content crafted by AI.",
    url: "/app/pages",
    tag: null,
  },
  {
    gradient: "linear-gradient(135deg, #00c9d4 0%, #0096a0 100%)",
    glow: "rgba(0,201,212,0.25)",
    icon: "📊",
    title: "Analytics",
    desc: "SEO health scores, coverage charts and generation statistics.",
    url: "/app/analytics",
    tag: "Insights",
  },
];

const STATS = [
  { value: "5", label: "Content Types", icon: "✦" },
  { value: "180+", label: "Languages", icon: "🌍" },
  { value: "2", label: "AI Providers", icon: "⚡" },
  { value: "∞", label: "Generations", icon: "🔄" },
];

function FeatureCard({ gradient, glow, icon, title, desc, url, tag }) {
  const [hovered, setHovered] = useState(false);
  return (
    <a
      href={url}
      style={{ textDecoration: "none" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "16px",
          padding: "24px",
          border: `1px solid ${hovered ? "transparent" : "#e8eaed"}`,
          boxShadow: hovered
            ? `0 8px 32px ${glow}, 0 2px 8px rgba(0,0,0,0.08)`
            : "0 1px 4px rgba(0,0,0,0.04)",
          transition: "all 0.25s cubic-bezier(0.4,0,0.2,1)",
          transform: hovered ? "translateY(-4px)" : "translateY(0)",
          cursor: "pointer",
          height: "100%",
          boxSizing: "border-box",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Top accent bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "3px",
            background: gradient,
            borderRadius: "16px 16px 0 0",
          }}
        />

        {/* Tag */}
        {tag && (
          <div
            style={{
              position: "absolute",
              top: "16px",
              right: "16px",
              background: gradient,
              color: "#fff",
              fontSize: "10px",
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: "20px",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
            }}
          >
            {tag}
          </div>
        )}

        {/* Icon */}
        <div
          style={{
            width: "52px",
            height: "52px",
            borderRadius: "14px",
            background: gradient,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
            marginBottom: "16px",
            boxShadow: `0 4px 12px ${glow}`,
          }}
        >
          {icon}
        </div>

        <div
          style={{
            fontSize: "16px",
            fontWeight: 700,
            color: "#0d1117",
            marginBottom: "8px",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: "13px",
            color: "#6b7280",
            lineHeight: "1.5",
            marginBottom: "20px",
          }}
        >
          {desc}
        </div>

        {/* Arrow CTA */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "13px",
            fontWeight: 600,
            background: gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          Generate now
          <span style={{ WebkitTextFillColor: "initial", color: "inherit" }}>→</span>
        </div>
      </div>
    </a>
  );
}

function StatCard({ value, label, icon }) {
  return (
    <div
      style={{
        flex: 1,
        background: "rgba(255,255,255,0.1)",
        backdropFilter: "blur(10px)",
        borderRadius: "12px",
        padding: "18px 20px",
        border: "1px solid rgba(255,255,255,0.2)",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "22px", marginBottom: "4px" }}>{icon}</div>
      <div
        style={{
          fontSize: "28px",
          fontWeight: 800,
          color: "#ffffff",
          lineHeight: 1,
          marginBottom: "4px",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>
        {label}
      </div>
    </div>
  );
}

function ProviderCard({ label, logo, desc, selected, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        padding: "18px",
        borderRadius: "12px",
        border: selected ? "2px solid #008060" : "2px solid #e8eaed",
        background: selected ? "rgba(0,128,96,0.04)" : "#fff",
        cursor: "pointer",
        transition: "all 0.2s ease",
        position: "relative",
      }}
    >
      {selected && (
        <div
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            width: "20px",
            height: "20px",
            borderRadius: "50%",
            background: "#008060",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: "12px",
            fontWeight: 700,
          }}
        >
          ✓
        </div>
      )}
      <div style={{ fontSize: "28px", marginBottom: "8px" }}>{logo}</div>
      <div
        style={{
          fontSize: "14px",
          fontWeight: 700,
          color: "#0d1117",
          marginBottom: "4px",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "12px", color: "#6b7280" }}>{desc}</div>
    </div>
  );
}

export default function Index() {
  const { hasOpenaiKey, hasAnthropicKey, defaultAiProvider } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(defaultAiProvider);

  return (
    <Page>
      <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>

        {/* ── Hero ── */}
        <div
          style={{
            background: "linear-gradient(135deg, #0a1628 0%, #0d2a4a 40%, #0a3d2e 100%)",
            borderRadius: "20px",
            padding: "48px 40px 36px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Decorative circles */}
          <div
            style={{
              position: "absolute",
              top: "-60px",
              right: "-60px",
              width: "240px",
              height: "240px",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(0,179,116,0.18) 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "-40px",
              left: "30%",
              width: "180px",
              height: "180px",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(61,130,245,0.15) 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />

          {/* Badge */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(0,179,116,0.15)",
              border: "1px solid rgba(0,179,116,0.3)",
              color: "#4ade80",
              borderRadius: "20px",
              padding: "5px 14px",
              fontSize: "12px",
              fontWeight: 600,
              marginBottom: "20px",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "#4ade80",
                display: "inline-block",
                animation: "pulse 2s infinite",
              }}
            />
            AI-Powered · Shopify Native
          </div>

          <div
            style={{
              fontSize: "clamp(28px, 4vw, 42px)",
              fontWeight: 800,
              color: "#ffffff",
              lineHeight: 1.15,
              marginBottom: "14px",
              maxWidth: "560px",
            }}
          >
            Generate SEO Content<br />
            <span
              style={{
                background: "linear-gradient(90deg, #4ade80, #34d399, #06b6d4)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Powered by AI
            </span>
          </div>

          <div
            style={{
              fontSize: "15px",
              color: "rgba(255,255,255,0.65)",
              marginBottom: "36px",
              maxWidth: "480px",
              lineHeight: "1.6",
            }}
          >
            Create product descriptions, blog posts, collection pages and more — optimized for SEO and ready to publish.
          </div>

          {/* Stats row */}
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            {STATS.map((s) => (
              <StatCard key={s.label} {...s} />
            ))}
          </div>
        </div>

        {/* ── Feature Cards ── */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "20px",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "20px",
                  fontWeight: 700,
                  color: "#0d1117",
                  marginBottom: "4px",
                }}
              >
                Generate Content
              </div>
              <div style={{ fontSize: "13px", color: "#6b7280" }}>
                Pick a content type to get started
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "16px",
            }}
          >
            {FEATURE_CARDS.map((card) => (
              <FeatureCard key={card.title} {...card} />
            ))}
          </div>
        </div>

        {/* ── Divider ── */}
        <div
          style={{
            height: "1px",
            background: "linear-gradient(90deg, transparent, #e8eaed 20%, #e8eaed 80%, transparent)",
          }}
        />

        {/* ── AI Provider Settings ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "280px 1fr",
            gap: "40px",
            alignItems: "start",
          }}
        >
          {/* Left label */}
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                background: "linear-gradient(135deg, #f0fdf4, #ecfdf5)",
                border: "1px solid #bbf7d0",
                borderRadius: "8px",
                padding: "6px 12px",
                marginBottom: "12px",
              }}
            >
              <span style={{ fontSize: "14px" }}>⚙️</span>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#065f46", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Settings
              </span>
            </div>
            <div
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "#0d1117",
                marginBottom: "8px",
              }}
            >
              AI Provider
            </div>
            <div style={{ fontSize: "13px", color: "#6b7280", lineHeight: "1.6" }}>
              Configure your API keys and choose which AI model powers your content generation.
            </div>
          </div>

          {/* Right form */}
          <div>
            {actionData && (
              <div style={{ marginBottom: "16px" }}>
                <Banner
                  tone={actionData.success ? "success" : "critical"}
                  onDismiss={() => {}}
                >
                  <p>{actionData.message}</p>
                </Banner>
              </div>
            )}

            <Form method="post">
              <input type="hidden" name="intent" value="save_api_keys" />
              <input type="hidden" name="defaultAiProvider" value={selectedProvider} />

              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "16px",
                  border: "1px solid #e8eaed",
                  overflow: "hidden",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                }}
              >
                {/* Provider Picker */}
                <div style={{ padding: "24px", borderBottom: "1px solid #f3f4f6" }}>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "#374151",
                      marginBottom: "12px",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    Choose Default Provider
                  </div>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <ProviderCard
                      value="openai"
                      label="ChatGPT / OpenAI"
                      logo="🤖"
                      desc="GPT-4o-mini model"
                      selected={selectedProvider === "openai"}
                      onClick={() => setSelectedProvider("openai")}
                    />
                    <ProviderCard
                      value="anthropic"
                      label="Claude / Anthropic"
                      logo="🧠"
                      desc="Claude Haiku model"
                      selected={selectedProvider === "anthropic"}
                      onClick={() => setSelectedProvider("anthropic")}
                    />
                  </div>
                </div>

                {/* API Key Section */}
                <div style={{ padding: "24px" }}>
                  {selectedProvider === "openai" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "14px", fontWeight: 700, color: "#0d1117" }}>
                            OpenAI API Key
                          </span>
                          {hasOpenaiKey && <Badge tone="success">Configured</Badge>}
                        </div>
                        {hasOpenaiKey && (
                          <Form method="post">
                            <input type="hidden" name="intent" value="clear_openai_key" />
                            <Button variant="plain" tone="critical" submit size="slim">
                              Remove key
                            </Button>
                          </Form>
                        )}
                      </div>
                      <div style={{ fontSize: "12px", color: "#6b7280" }}>
                        Get your key at{" "}
                        <a
                          href="https://platform.openai.com/api-keys"
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#008060", fontWeight: 600 }}
                        >
                          platform.openai.com
                        </a>
                      </div>
                      <TextField
                        label="OpenAI API Key"
                        labelHidden
                        type="password"
                        name="openaiApiKey"
                        value={openaiKey}
                        onChange={setOpenaiKey}
                        placeholder={hasOpenaiKey ? "•••••••••••• (saved)" : "sk-proj-..."}
                        autoComplete="off"
                      />
                    </div>
                  )}

                  {selectedProvider === "anthropic" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "14px", fontWeight: 700, color: "#0d1117" }}>
                            Anthropic API Key
                          </span>
                          {hasAnthropicKey && <Badge tone="success">Configured</Badge>}
                        </div>
                        {hasAnthropicKey && (
                          <Form method="post">
                            <input type="hidden" name="intent" value="clear_anthropic_key" />
                            <Button variant="plain" tone="critical" submit size="slim">
                              Remove key
                            </Button>
                          </Form>
                        )}
                      </div>
                      <div style={{ fontSize: "12px", color: "#6b7280" }}>
                        Get your key at{" "}
                        <a
                          href="https://console.anthropic.com/settings/keys"
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#008060", fontWeight: 600 }}
                        >
                          console.anthropic.com
                        </a>
                      </div>
                      <TextField
                        label="Anthropic API Key"
                        labelHidden
                        type="password"
                        name="anthropicApiKey"
                        value={anthropicKey}
                        onChange={setAnthropicKey}
                        placeholder={hasAnthropicKey ? "•••••••••••• (saved)" : "sk-ant-..."}
                        autoComplete="off"
                      />
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px" }}>
                    <button
                      type="submit"
                      disabled={isSaving}
                      style={{
                        background: isSaving
                          ? "#ccc"
                          : "linear-gradient(135deg, #00b374 0%, #007a50 100%)",
                        color: "#fff",
                        border: "none",
                        borderRadius: "8px",
                        padding: "10px 24px",
                        fontSize: "14px",
                        fontWeight: 700,
                        cursor: isSaving ? "not-allowed" : "pointer",
                        boxShadow: isSaving ? "none" : "0 4px 14px rgba(0,128,96,0.35)",
                        transition: "all 0.2s ease",
                      }}
                    >
                      {isSaving ? "Saving…" : "Save Settings"}
                    </button>
                  </div>
                </div>
              </div>
            </Form>
          </div>
        </div>

        <Box paddingBlockEnd="800" />
      </div>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
