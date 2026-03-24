import { useState } from "react";
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  Select,
  Banner,
  Badge,
  Divider,
  Box,
  Grid,
} from "@shopify/polaris";

const AI_PROVIDER_OPTIONS = [
  { label: "ChatGPT / OpenAI", value: "openai" },
  { label: "Claude AI / Anthropic", value: "anthropic" },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { openaiApiKey: true, anthropicApiKey: true, defaultAiProvider: true },
  });
  return {
    hasOpenaiKey: !!shopData?.openaiApiKey,
    hasAnthropicKey: !!shopData?.anthropicApiKey,
    defaultAiProvider: shopData?.defaultAiProvider || "auto",
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
    const defaultAiProvider = formData.get("defaultAiProvider")?.trim() || "auto";
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
    color: "#008060",
    emoji: "📦",
    title: "Product Descriptions",
    desc: "AI-generated SEO titles, meta descriptions & product copy.",
    url: "/app/products",
    btnText: "Generate",
  },
  {
    color: "#2C6ECB",
    emoji: "🗂️",
    title: "Collection Descriptions",
    desc: "Auto-generate rich descriptions for all your collections.",
    url: "/app/collections",
    btnText: "Generate",
  },
  {
    color: "#E07D10",
    emoji: "✍️",
    title: "Blog Posts",
    desc: "Create full blog articles in 180+ languages with one click.",
    url: "/app/blog",
    btnText: "Generate",
  },
  {
    color: "#8456CD",
    emoji: "📄",
    title: "Page Content",
    desc: "Generate About, FAQ, Contact and landing page content.",
    url: "/app/pages",
    btnText: "Generate",
  },
  {
    color: "#00848E",
    emoji: "📊",
    title: "SEO Analytics",
    desc: "View SEO health scores, coverage charts & generation stats.",
    url: "/app/analytics",
    btnText: "View Dashboard",
  },
];

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function FeatureCard({ color, emoji, title, desc, url, btnText }) {
  return (
    <Card>
      <div style={{ borderLeft: `4px solid ${color}`, paddingLeft: "12px" }}>
        <BlockStack gap="300">
          <InlineStack gap="300" blockAlign="center">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: hexToRgba(color, 0.12),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                flexShrink: 0,
              }}
            >
              {emoji}
            </div>
            <Text variant="headingSm" as="h3">{title}</Text>
          </InlineStack>
          <Text variant="bodySm" tone="subdued">{desc}</Text>
          <Button url={url} size="slim" variant="primary">{btnText}</Button>
        </BlockStack>
      </div>
    </Card>
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
      <BlockStack gap="600">

        {/* Hero Banner */}
        <div
          style={{
            background: "linear-gradient(135deg, #f0faf5 0%, #e8f5f0 100%)",
            borderRadius: "12px",
            padding: "32px 28px",
          }}
        >
          <InlineStack align="space-between" blockAlign="center" wrap={false} gap="400">
            <BlockStack gap="200">
              <Text variant="headingXl" as="h1">Proxy AI Content Generator</Text>
              <Text variant="bodyMd" tone="subdued">
                Generate SEO-optimized content for every part of your Shopify store — powered by AI.
              </Text>
            </BlockStack>
            <div
              style={{
                display: "inline-flex",
                flexDirection: "column",
                gap: "8px",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  padding: "6px 14px",
                  background: "rgba(0,128,96,0.12)",
                  color: "#005c3e",
                  borderRadius: "20px",
                  fontSize: "13px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                5 Content Types
              </span>
              <span
                style={{
                  display: "inline-block",
                  padding: "6px 14px",
                  background: "rgba(0,128,96,0.12)",
                  color: "#005c3e",
                  borderRadius: "20px",
                  fontSize: "13px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                180+ Languages
              </span>
            </div>
          </InlineStack>
        </div>

        {/* Generate Content Section */}
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Generate Content</Text>
          <Grid>
            {FEATURE_CARDS.map((card) => (
              <Grid.Cell
                key={card.title}
                columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}
              >
                <FeatureCard {...card} />
              </Grid.Cell>
            ))}
          </Grid>
        </BlockStack>

        <Divider />

        {/* AI Provider Settings */}
        <Layout>
          <Layout.Section variant="oneThird">
            <BlockStack gap="200">
              <Text variant="headingMd" as="h2">AI Provider Settings</Text>
              <Text variant="bodyMd" tone="subdued">
                Choose your default AI provider and configure API keys. Keys are stored securely per shop.
              </Text>
            </BlockStack>
          </Layout.Section>

          <Layout.Section>
            <BlockStack gap="400">
              {actionData && (
                <Banner
                  tone={actionData.success ? "success" : "critical"}
                  onDismiss={() => {}}
                >
                  <p>{actionData.message}</p>
                </Banner>
              )}

              <Form method="post">
                <input type="hidden" name="intent" value="save_api_keys" />
                <Card>
                  <BlockStack gap="500">

                    {/* Default AI Provider selector */}
                    <BlockStack gap="300">
                      <Text variant="headingSm" as="h3">Default AI Provider</Text>
                      <Text variant="bodySm" tone="subdued">
                        Select which AI will be used by default when generating content. You can override this per generation.
                      </Text>
                      <Select
                        label="Default AI Provider"
                        labelHidden
                        name="defaultAiProvider"
                        options={AI_PROVIDER_OPTIONS}
                        value={selectedProvider}
                        onChange={setSelectedProvider}
                      />
                    </BlockStack>

                    <Divider />

                    {/* OpenAI key — when ChatGPT / OpenAI is selected */}
                    {selectedProvider === "openai" && (
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="200" blockAlign="center">
                            <Text variant="headingSm" as="h3">ChatGPT / OpenAI</Text>
                            {hasOpenaiKey && <Badge tone="success">Configured</Badge>}
                          </InlineStack>
                          {hasOpenaiKey && (
                            <Form method="post">
                              <input type="hidden" name="intent" value="clear_openai_key" />
                              <Button variant="plain" tone="critical" submit size="slim">
                                Remove key
                              </Button>
                            </Form>
                          )}
                        </InlineStack>
                        <Text variant="bodySm" tone="subdued">
                          Used for GPT-4o-mini. Get your key from{" "}
                          <a
                            href="https://platform.openai.com/api-keys"
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "var(--p-color-text-emphasis)" }}
                          >
                            platform.openai.com
                          </a>
                        </Text>
                        <TextField
                          label="OpenAI API Key"
                          labelHidden
                          type="password"
                          name="openaiApiKey"
                          value={openaiKey}
                          onChange={setOpenaiKey}
                          placeholder={hasOpenaiKey ? "••••••••••••  (saved)" : "sk-proj-..."}
                          autoComplete="off"
                          prefix="sk-"
                        />
                      </BlockStack>
                    )}

                    {/* Anthropic key — when Claude AI / Anthropic is selected */}
                    {selectedProvider === "anthropic" && (
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="200" blockAlign="center">
                            <Text variant="headingSm" as="h3">Claude AI / Anthropic</Text>
                            {hasAnthropicKey && <Badge tone="success">Configured</Badge>}
                          </InlineStack>
                          {hasAnthropicKey && (
                            <Form method="post">
                              <input type="hidden" name="intent" value="clear_anthropic_key" />
                              <Button variant="plain" tone="critical" submit size="slim">
                                Remove key
                              </Button>
                            </Form>
                          )}
                        </InlineStack>
                        <Text variant="bodySm" tone="subdued">
                          Used for Claude Haiku and newer models. Get your key from{" "}
                          <a
                            href="https://console.anthropic.com/settings/keys"
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "var(--p-color-text-emphasis)" }}
                          >
                            console.anthropic.com
                          </a>
                        </Text>
                        <TextField
                          label="Anthropic API Key"
                          labelHidden
                          type="password"
                          name="anthropicApiKey"
                          value={anthropicKey}
                          onChange={setAnthropicKey}
                          placeholder={hasAnthropicKey ? "••••••••••••  (saved)" : "sk-ant-..."}
                          autoComplete="off"
                          prefix="sk-ant-"
                        />
                      </BlockStack>
                    )}

                    <InlineStack align="end">
                      <Button
                        variant="primary"
                        submit
                        loading={isSaving}
                        disabled={isSaving}
                      >
                        Save Settings
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Form>
            </BlockStack>
          </Layout.Section>
        </Layout>

      </BlockStack>

      <Box paddingBlockEnd="800" />
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
