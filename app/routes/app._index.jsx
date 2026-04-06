import { useState } from "react";
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Page,
  Banner,
  Box,
  Select,
} from "@shopify/polaris";

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
];

const ANALYTICS_CARD = {
  gradient: "linear-gradient(135deg, #00c9d4 0%, #0096a0 100%)",
  glow: "rgba(0,201,212,0.25)",
  icon: "📊",
  title: "Analytics",
  desc: "SEO health scores, coverage charts and generation statistics.",
  url: "/app/analytics",
  tag: "Insights",
};

const SETTINGS_CARD = {
  gradient: "linear-gradient(135deg, #6b7280 0%, #374151 100%)",
  glow: "rgba(107,114,128,0.25)",
  icon: "⚙️",
  title: "Settings",
  desc: "Configure language, word counts and default templates for all content types.",
  url: "/app/settings",
  tag: null,
};

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
          borderRadius: "6px",
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
              borderRadius: "6px",
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
            borderRadius: "6px",
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
        borderRadius: "6px",
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


const AI_MODELS = [
  { label: "Claude Haiku 4.5", value: "claude-haiku-4.5" },
  { label: "Claude Sonnet 4.6", value: "claude-sonnet-4.6" },
  { label: "GPT-4o mini", value: "gpt-4o-mini" },
  { label: "Gemini Flash-Lite", value: "gemini-flash-lite" },
  { label: "DeepSeek V3.2", value: "deepseek-v3.2" },
  { label: "Cohere Command R+", value: "cohere-command-r-plus" },
];

export default function Index() {
  const { defaultAiModel } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [selectedModel, setSelectedModel] = useState(
    () => (typeof defaultAiModel === "string" && defaultAiModel.trim()) ? defaultAiModel.trim() : "gpt-4o-mini"
  );

  return (
    <Page fullWidth>
      <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>

        {/* ── Hero ── */}
        <div
          style={{
            background: "linear-gradient(135deg, #0a1628 0%, #0d2a4a 40%, #0a3d2e 100%)",
            borderRadius: "6px",
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
              borderRadius: "6px",
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
              fontSize: "clamp(20px, 2.5vw, 28px)",
              fontWeight: 800,
              color: "#ffffff",
              lineHeight: 1.15,
              marginBottom: "14px",
              maxWidth: "100%",
            }}
          >
            Generate SEO Content{" "}
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
              fontSize: "13px",
              color: "rgba(255,255,255,0.65)",
              marginBottom: "36px",
              maxWidth: "100%",
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

        {/* ── Feature Cards (4 cards, fixed 4-col grid) ── */}
        <div>
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#0d1117", marginBottom: "4px" }}>
              Generate Content
            </div>
            <div style={{ fontSize: "13px", color: "#6b7280" }}>
              Pick a content type to get started
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "16px",
            }}
          >
            {FEATURE_CARDS.map((card) => (
              <FeatureCard key={card.title} {...card} />
            ))}
          </div>
        </div>

        {/* ── Analytics + AI Provider side by side ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 2fr",
            gap: "16px",
            alignItems: "start",
          }}
        >
          {/* Analytics + Settings cards stack in the left slot */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <FeatureCard {...ANALYTICS_CARD} />
            <FeatureCard {...SETTINGS_CARD} />
          </div>

          {/* AI Model Settings fills the right slot */}
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
              <input type="hidden" name="intent" value="save_settings" />
              <input type="hidden" name="defaultAiModel" value={selectedModel} />

              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "6px",
                  border: "1px solid #e8eaed",
                  overflow: "hidden",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                }}
              >
                {/* AI Model Selector */}
                <div style={{ padding: "24px" }}>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "#374151",
                      marginBottom: "4px",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    Default AI Model
                  </div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "14px" }}>
                    Choose the AI model used for all content generation across your store.
                  </div>
                  <Select
                    label="AI Model"
                    labelHidden
                    options={AI_MODELS}
                    value={selectedModel}
                    onChange={setSelectedModel}
                  />
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
                        borderRadius: "6px",
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
