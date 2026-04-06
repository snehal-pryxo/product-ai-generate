import { useState } from "react";
import { useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  Select,
  TextField,
  Divider,
  Box,
} from "@shopify/polaris";
import { readGlobalSettings, writeGlobalSettings } from "../lib/globalSettings";

const LANGUAGE_OPTIONS = [
  "English", "English (British)", "English (US)", "Arabic", "Bengali", "Bulgarian",
  "Chinese", "Chinese (Simplified)", "Chinese (Traditional)", "Croatian", "Czech",
  "Danish", "Dutch", "Finnish", "French", "German", "Greek", "Hebrew", "Hindi",
  "Hungarian", "Indonesian", "Italian", "Japanese", "Korean", "Malay", "Norwegian",
  "Polish", "Portuguese", "Romanian", "Russian", "Spanish", "Swedish", "Tamil",
  "Telugu", "Thai", "Turkish", "Ukrainian", "Urdu", "Vietnamese",
].map((l) => ({ label: l, value: l }));


function SectionLabel({ children }) {
  return (
    <Text as="h3" variant="headingSm" fontWeight="semibold">
      {children}
    </Text>
  );
}

export default function SettingsPage() {
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [settings, setSettings] = useState(() => readGlobalSettings());
  const [saved, setSaved] = useState(false);

  function update(key) {
    return (value) => setSettings((s) => ({ ...s, [key]: value }));
  }

  function handleSave() {
    writeGlobalSettings(settings);
    setSaved(true);
    shopify.toast.show("Settings saved successfully.");
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <Page
      fullWidth
      title="Settings"
      subtitle="Configure global defaults for AI content generation."
      primaryAction={{ content: saved ? "Saved!" : "Save Settings", onAction: handleSave }}
      secondaryActions={[{ content: "Back", onAction: () => navigate("/app") }]}
    >
      <BlockStack gap="600">

        {/* General */}
        <Card>
          <BlockStack gap="400">
            <SectionLabel>General</SectionLabel>
            <Select
              label="Output Language"
              options={LANGUAGE_OPTIONS}
              value={settings.language}
              onChange={update("language")}
              helpText="Default language used for all AI-generated content."
            />
          </BlockStack>
        </Card>

        {/* Generation Settings */}
        <Card>
          <BlockStack gap="400">
            <SectionLabel>Generation Settings</SectionLabel>
            <Text as="p" variant="bodySm" tone="subdued">
              These defaults are applied across all pages. Individual pages use these values automatically.
            </Text>
            <Select
              label="Tone"
              options={[
                { label: "Professional", value: "professional" },
                { label: "Casual", value: "casual" },
                { label: "Friendly", value: "friendly" },
                { label: "Persuasive", value: "persuasive" },
                { label: "Informative", value: "informative" },
                { label: "Luxury", value: "luxury" },
                { label: "Playful", value: "playful" },
                { label: "Urgent", value: "urgent" },
              ]}
              value={settings.tone}
              onChange={update("tone")}
            />
            <Select
              label="Length"
              options={[
                { label: "Short (50 - 100 words)", value: "short (50 - 100 words)" },
                { label: "Medium (100 - 200 words)", value: "medium (100 - 200 words)" },
                { label: "Long (200 - 300 words)", value: "long (200 - 300 words)" },
                { label: "Extra Long (300 - 500 words)", value: "extra long (300 - 500 words)" },
              ]}
              value={settings.length}
              onChange={update("length")}
            />
            <Select
              label="AI Provider"
              options={[
                { label: "Auto (recommended)", value: "auto" },
                { label: "OpenAI", value: "openai" },
                { label: "Anthropic", value: "anthropic" },
                { label: "Ollama", value: "ollama" },
              ]}
              value={settings.aiProvider}
              onChange={update("aiProvider")}
            />
            <TextField
              label="Context Keywords"
              value={settings.contextKeywords}
              onChange={update("contextKeywords")}
              placeholder="e.g. eco-friendly, premium, handmade (comma separated)"
              helpText="Keywords sent to the AI as context for all content generation."
              autoComplete="off"
            />
          </BlockStack>
        </Card>

        {/* Word Count Limits */}
        <Card>
          <BlockStack gap="500">
            <SectionLabel>Word Count Limits</SectionLabel>
            <Text as="p" variant="bodySm" tone="subdued">
              Set approximate word targets for each content type. These guide the AI output length.
            </Text>

            {/* Product */}
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" fontWeight="semibold">Product</Text>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <TextField label="Description words" type="number" value={settings.productDescWords} onChange={update("productDescWords")} autoComplete="off" />
                <TextField label="Meta Title words" type="number" value={settings.productMetaTitleWords} onChange={update("productMetaTitleWords")} autoComplete="off" />
                <TextField label="Meta Description words" type="number" value={settings.productMetaDescWords} onChange={update("productMetaDescWords")} autoComplete="off" />
              </div>
            </BlockStack>

            <Divider />

            {/* Collections */}
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" fontWeight="semibold">Collections</Text>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <TextField label="Description words" type="number" value={settings.collectionDescWords} onChange={update("collectionDescWords")} autoComplete="off" />
                <TextField label="Meta Title words" type="number" value={settings.collectionMetaTitleWords} onChange={update("collectionMetaTitleWords")} autoComplete="off" />
                <TextField label="Meta Description words" type="number" value={settings.collectionMetaDescWords} onChange={update("collectionMetaDescWords")} autoComplete="off" />
              </div>
            </BlockStack>

            <Divider />

            {/* Pages */}
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" fontWeight="semibold">Pages</Text>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <TextField label="Content words" type="number" value={settings.pageContentWords} onChange={update("pageContentWords")} autoComplete="off" />
                <TextField label="Meta Title words" type="number" value={settings.pageMetaTitleWords} onChange={update("pageMetaTitleWords")} autoComplete="off" />
                <TextField label="Meta Description words" type="number" value={settings.pageMetaDescWords} onChange={update("pageMetaDescWords")} autoComplete="off" />
              </div>
            </BlockStack>

            <Divider />

            {/* Blog */}
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" fontWeight="semibold">Blog</Text>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <TextField label="Content words" type="number" value={settings.blogContentWords} onChange={update("blogContentWords")} autoComplete="off" />
                <TextField label="Meta Title words" type="number" value={settings.blogMetaTitleWords} onChange={update("blogMetaTitleWords")} autoComplete="off" />
                <TextField label="Meta Description words" type="number" value={settings.blogMetaDescWords} onChange={update("blogMetaDescWords")} autoComplete="off" />
              </div>
            </BlockStack>
          </BlockStack>
        </Card>

        <Box paddingBlockEnd="800" />
      </BlockStack>
    </Page>
  );
}
