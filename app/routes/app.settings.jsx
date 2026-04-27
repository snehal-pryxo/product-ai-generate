import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useLocation, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Banner,
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
import {
  normalizeStoredGlobalSettings,
  writeGlobalSettings,
} from "../lib/globalSettings";
import { AppPageHeader } from "../components/AppPageHeader";

function normalizeGlobalSettings(value) {
  const merged = normalizeStoredGlobalSettings(value);

  return Object.fromEntries(
    Object.entries(merged).map(([key, v]) => [key, typeof v === "string" ? v : String(v ?? "")]),
  );
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { globalSettingsJson: true },
  });

  let parsedSettings = {};
  try {
    parsedSettings = JSON.parse(shopData?.globalSettingsJson || "{}");
  } catch {
    parsedSettings = {};
  }

  return {
    initialSettings: normalizeGlobalSettings(parsedSettings),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent !== "save_global_settings") {
    return { success: false, error: "Unknown action." };
  }

  let nextSettings = {};
  try {
    nextSettings = normalizeGlobalSettings(JSON.parse(String(formData.get("settingsJson") || "{}")));
  } catch {
    return { success: false, error: "Invalid settings payload." };
  }

  await db.shop.upsert({
    where: { shop: session.shop },
    update: { globalSettingsJson: JSON.stringify(nextSettings) },
    create: {
      shop: session.shop,
      installed: true,
      globalSettingsJson: JSON.stringify(nextSettings),
    },
  });

  return { success: true, settings: nextSettings };
};

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
  const { initialSettings } = useLoaderData();
  const saveFetcher = useFetcher();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const location = useLocation();
  const [settings, setSettings] = useState(() => normalizeGlobalSettings(initialSettings));
  const [saved, setSaved] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const isSaving = saveFetcher.state !== "idle";

  useEffect(() => {
    // Mirror DB-backed settings to localStorage for existing pages that still read from client storage.
    writeGlobalSettings(settings);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const data = saveFetcher.data;
    if (!data || saveFetcher.state !== "idle") return;

    if (data.success) {
      const normalized = normalizeGlobalSettings(data.settings || settings);
      setSettings(normalized);
      writeGlobalSettings(normalized);
      setSaved(true);
      setSaveMessage({ tone: "success", text: "Configuration saved successfully." });
      shopify.toast.show("Settings saved successfully.");
      setTimeout(() => setSaved(false), 3000);
      setTimeout(() => setSaveMessage(null), 3000);
      return;
    }

    setSaveMessage({ tone: "critical", text: data.error || "Failed to save configuration." });
    shopify.toast.show(data.error || "Failed to save settings.");
  }, [saveFetcher.data, saveFetcher.state, settings, shopify]);

  function update(key) {
    return (value) => setSettings((s) => ({ ...s, [key]: value }));
  }

  function handleSave() {
    const payload = new FormData();
    payload.append("intent", "save_global_settings");
    payload.append("settingsJson", JSON.stringify(settings));
    saveFetcher.submit(payload, { method: "post" });
  }
  function navigateInApp(pathname) {
    navigate({ pathname, search: location.search });
  }

  return (
    <Page
      title="Settings"
      subtitle="Configure global defaults for AI content generation."
      primaryAction={{
        content: isSaving ? "Saving..." : saved ? "Saved!" : "Save Settings",
        onAction: handleSave,
        disabled: isSaving,
      }}
      secondaryActions={[{ content: "Back", onAction: () => navigateInApp("/app") }]}
    >
      <BlockStack gap="600">
        <AppPageHeader
          title="Settings"
          description="Configure global defaults for AI content generation."
        />
        {saveMessage && (
          <Banner tone={saveMessage.tone}>
            <Text as="p">{saveMessage.text}</Text>
          </Banner>
        )}

        {/* Generation Settings */}
        <Card>
          <BlockStack gap="400">
            <SectionLabel>Generation Settings</SectionLabel>
            <Text as="p" variant="bodySm" tone="subdued">
              These defaults are applied across all pages. Individual pages use these values automatically.
            </Text>
            <Box
              background="bg-surface-secondary"
              borderColor="border"
              borderWidth="025"
              borderRadius="300"
              padding="300"
            >
              <div className="app-form-grid-3" style={{ gap: "16px" }}>
                <Select
                  label="Output Language"
                  options={LANGUAGE_OPTIONS}
                  value={settings.language}
                  onChange={update("language")}
                  helpText="Default language for all AI-generated content."
                />
              </div>
            </Box>
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
              <Box
                background="bg-surface-secondary"
                borderColor="border"
                borderWidth="025"
                borderRadius="300"
                padding="300"
              >
                <div className="app-form-grid-3" style={{ gap: "12px" }}>
                  <TextField label="Description words" type="number" value={settings.productDescWords} onChange={update("productDescWords")} autoComplete="off" />
                  <TextField label="Meta Title words" type="number" value={settings.productMetaTitleWords} onChange={update("productMetaTitleWords")} autoComplete="off" />
                  <TextField label="Meta Description words" type="number" value={settings.productMetaDescWords} onChange={update("productMetaDescWords")} autoComplete="off" />
                </div>
              </Box>
            </BlockStack>

            <Divider />

            {/* Collections */}
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" fontWeight="semibold">Collections</Text>
              <Box
                background="bg-surface-secondary"
                borderColor="border"
                borderWidth="025"
                borderRadius="300"
                padding="300"
              >
                <div className="app-form-grid-3" style={{ gap: "12px" }}>
                  <TextField label="Description words" type="number" value={settings.collectionDescWords} onChange={update("collectionDescWords")} autoComplete="off" />
                  <TextField label="Meta Title words" type="number" value={settings.collectionMetaTitleWords} onChange={update("collectionMetaTitleWords")} autoComplete="off" />
                  <TextField label="Meta Description words" type="number" value={settings.collectionMetaDescWords} onChange={update("collectionMetaDescWords")} autoComplete="off" />
                </div>
              </Box>
            </BlockStack>

            <Divider />

            {/* Pages */}
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" fontWeight="semibold">Pages</Text>
              <Box
                background="bg-surface-secondary"
                borderColor="border"
                borderWidth="025"
                borderRadius="300"
                padding="300"
              >
                <div className="app-form-grid-3" style={{ gap: "12px" }}>
                  <TextField label="Content words" type="number" value={settings.pageContentWords} onChange={update("pageContentWords")} autoComplete="off" />
                  <TextField label="Meta Title words" type="number" value={settings.pageMetaTitleWords} onChange={update("pageMetaTitleWords")} autoComplete="off" />
                  <TextField label="Meta Description words" type="number" value={settings.pageMetaDescWords} onChange={update("pageMetaDescWords")} autoComplete="off" />
                </div>
              </Box>
            </BlockStack>
          </BlockStack>
        </Card>

        <Box paddingBlockEnd="800" />
      </BlockStack>
      <style>{`
        .app-form-grid-3 {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        @media (max-width: 760px) {
          .app-form-grid-3 {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </Page>
  );
}
