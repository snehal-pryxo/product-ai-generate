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
  { label: "Auto (use first available key)", value: "auto" },
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

export default function Index() {
  const { hasOpenaiKey, hasAnthropicKey, defaultAiProvider } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(defaultAiProvider);

  return (
    <Page
      title="Proxy AI Content Generator"
      subtitle="Generate high-quality, SEO-optimized content for your Shopify store in seconds"
    >
      <BlockStack gap="600">
        {/* Feature Cards */}
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Features</Text>
              <Grid>
                {[
                  {
                    title: "Product Descriptions",
                    description: "Generate SEO-optimized product descriptions and meta tags powered by AI.",
                    url: "/app/products",
                  },
                  {
                    title: "Blog Posts",
                    description: "Create engaging blog content and articles for your store in 180+ languages.",
                    url: "/app/blog",
                  },
                  {
                    title: "Collection Descriptions",
                    description: "Auto-generate descriptions for your product collections with AI.",
                    url: "/app/collections",
                  },
                  {
                    title: "Page Content",
                    description: "Generate and optimize storefront page content for About, FAQ, and more.",
                    url: "/app/pages",
                  },
                ].map(({ title, description, url }) => (
                  <Grid.Cell key={title} columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}>
                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingSm" as="h3">{title}</Text>
                        <Text variant="bodyMd" tone="subdued">{description}</Text>
                        <InlineStack align="start">
                          <Button url={url} variant="secondary" size="slim">Generate</Button>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  </Grid.Cell>
                ))}
              </Grid>
            </BlockStack>
          </Layout.Section>
        </Layout>

        <Divider />

        {/* AI Provider & API Keys Settings */}
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

                    {/* OpenAI key — only when ChatGPT / OpenAI is selected */}
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

                    {/* Anthropic key — only when Claude AI / Anthropic is selected */}
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
