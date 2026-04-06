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
import {
  PRODUCT_DESCRIPTION_TEMPLATES,
  PRODUCT_META_TITLE_TEMPLATES,
  PRODUCT_META_DESCRIPTION_TEMPLATES,
} from "../lib/productPromptTemplateLibrary";
import {
  COLLECTION_DESCRIPTION_TEMPLATES,
  COLLECTION_META_TITLE_TEMPLATES,
  COLLECTION_META_DESCRIPTION_TEMPLATES,
} from "../lib/collectionPromptTemplateLibrary";
import {
  PAGE_BODY_TEMPLATES,
  PAGE_META_TITLE_TEMPLATES,
  PAGE_META_DESCRIPTION_TEMPLATES,
} from "../lib/pagePromptTemplateLibrary";
import {
  BLOG_BODY_TEMPLATES,
  BLOG_META_TITLE_TEMPLATES,
  BLOG_META_DESCRIPTION_TEMPLATES,
} from "../lib/blogPromptTemplateLibrary";

const LANGUAGE_OPTIONS = [
  "English", "English (British)", "English (US)", "Arabic", "Bengali", "Bulgarian",
  "Chinese", "Chinese (Simplified)", "Chinese (Traditional)", "Croatian", "Czech",
  "Danish", "Dutch", "Finnish", "French", "German", "Greek", "Hebrew", "Hindi",
  "Hungarian", "Indonesian", "Italian", "Japanese", "Korean", "Malay", "Norwegian",
  "Polish", "Portuguese", "Romanian", "Russian", "Spanish", "Swedish", "Tamil",
  "Telugu", "Thai", "Turkish", "Ukrainian", "Urdu", "Vietnamese",
].map((l) => ({ label: l, value: l }));

function templateOptions(templates) {
  return [
    { label: "— Default (no template) —", value: "" },
    ...templates.map((t) => ({ label: t.name, value: t.id })),
  ];
}

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

        {/* Template Selections */}
        <Card>
          <BlockStack gap="500">
            <SectionLabel>Default Templates</SectionLabel>
            <Text as="p" variant="bodySm" tone="subdued">
              Select a default prompt template for each content type. These are used when "Use custom instructions" is unchecked on each page.
            </Text>

            {/* Product Templates */}
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" fontWeight="semibold">Product</Text>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <Select label="Description template" options={templateOptions(PRODUCT_DESCRIPTION_TEMPLATES)} value={settings.productDescTemplateId} onChange={update("productDescTemplateId")} />
                <Select label="Meta Title template" options={templateOptions(PRODUCT_META_TITLE_TEMPLATES)} value={settings.productMetaTitleTemplateId} onChange={update("productMetaTitleTemplateId")} />
                <Select label="Meta Description template" options={templateOptions(PRODUCT_META_DESCRIPTION_TEMPLATES)} value={settings.productMetaDescTemplateId} onChange={update("productMetaDescTemplateId")} />
              </div>
            </BlockStack>

            <Divider />

            {/* Collection Templates */}
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" fontWeight="semibold">Collections</Text>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <Select label="Description template" options={templateOptions(COLLECTION_DESCRIPTION_TEMPLATES)} value={settings.collectionDescTemplateId} onChange={update("collectionDescTemplateId")} />
                <Select label="Meta Title template" options={templateOptions(COLLECTION_META_TITLE_TEMPLATES)} value={settings.collectionMetaTitleTemplateId} onChange={update("collectionMetaTitleTemplateId")} />
                <Select label="Meta Description template" options={templateOptions(COLLECTION_META_DESCRIPTION_TEMPLATES)} value={settings.collectionMetaDescTemplateId} onChange={update("collectionMetaDescTemplateId")} />
              </div>
            </BlockStack>

            <Divider />

            {/* Pages Templates */}
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" fontWeight="semibold">Pages</Text>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <Select label="Body template" options={templateOptions(PAGE_BODY_TEMPLATES)} value={settings.pageBodyTemplateId} onChange={update("pageBodyTemplateId")} />
                <Select label="Meta Title template" options={templateOptions(PAGE_META_TITLE_TEMPLATES)} value={settings.pageMetaTitleTemplateId} onChange={update("pageMetaTitleTemplateId")} />
                <Select label="Meta Description template" options={templateOptions(PAGE_META_DESCRIPTION_TEMPLATES)} value={settings.pageMetaDescTemplateId} onChange={update("pageMetaDescTemplateId")} />
              </div>
            </BlockStack>

            <Divider />

            {/* Blog Templates */}
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" fontWeight="semibold">Blog</Text>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <Select label="Body template" options={templateOptions(BLOG_BODY_TEMPLATES)} value={settings.blogBodyTemplateId} onChange={update("blogBodyTemplateId")} />
                <Select label="Meta Title template" options={templateOptions(BLOG_META_TITLE_TEMPLATES)} value={settings.blogMetaTitleTemplateId} onChange={update("blogMetaTitleTemplateId")} />
                <Select label="Meta Description template" options={templateOptions(BLOG_META_DESCRIPTION_TEMPLATES)} value={settings.blogMetaDescTemplateId} onChange={update("blogMetaDescTemplateId")} />
              </div>
            </BlockStack>
          </BlockStack>
        </Card>

        <Box paddingBlockEnd="800" />
      </BlockStack>
    </Page>
  );
}
