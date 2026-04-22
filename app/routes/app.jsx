import { useEffect } from "react";
import { Outlet, useFetchers, useLoaderData, useLocation, useNavigate, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisProvider, Icon, Spinner, Text } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { StarFilledIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getDefaultGlobalSettings, writeGlobalSettings } from "../lib/globalSettings";
import {
  getEmptyTemplateSelection,
  writeStoredProductPromptTemplateSelection,
} from "../lib/productPromptTemplateLibrary";
import {
  getEmptyCollectionTemplateSelection,
  writeStoredCollectionPromptTemplateSelection,
} from "../lib/collectionPromptTemplateLibrary";
import {
  getEmptyPageTemplateSelection,
  writeStoredPagePromptTemplateSelection,
} from "../lib/pagePromptTemplateLibrary";

const CUSTOM_TEMPLATES_KEY = "custom_prompt_templates_v1";
const PAGE_HEADER_CONTENT = {
  "/app": {
    title: "Dashboard",
    description: "Manage your apps and generate high-converting AI content for your store.",
  },
  "/app/products": {
    title: "Products Generator",
    description: "Create optimized product titles, descriptions, and SEO fields in one flow.",
  },
  "/app/collections": {
    title: "Collections Generator",
    description: "Generate keyword-focused collection copy for better discoverability.",
  },
  "/app/pages": {
    title: "Pages Generator",
    description: "Build clear, conversion-friendly page content for your storefront.",
  },
  "/app/blog": {
    title: "Blogs Generator",
    description: "Draft and improve blog content to support SEO and customer education.",
  },
  "/app/content-management": {
    title: "Content Management",
    description: "Review, edit, and manage generated content across all resources.",
  },
  "/app/template": {
    title: "Template",
    description: "Set and manage reusable prompt templates for consistent output quality.",
  },
  "/app/analytics": {
    title: "Analytics",
    description: "Track content generation usage, credits, and performance trends.",
  },
  "/app/settings": {
    title: "Settings",
    description: "Configure default models, preferences, and app behavior.",
  },
};

function normalizeGlobalSettings(value) {
  const defaults = getDefaultGlobalSettings();
  const input = value && typeof value === "object" ? value : {};
  return { ...defaults, ...input };
}

function normalizeTemplateSelections(value) {
  const input = value && typeof value === "object" ? value : {};
  const product = input.product && typeof input.product === "object" ? input.product : {};
  const collection = input.collection && typeof input.collection === "object" ? input.collection : {};
  const page = input.page && typeof input.page === "object" ? input.page : {};
  return {
    product: { ...getEmptyTemplateSelection(), ...product },
    collection: { ...getEmptyCollectionTemplateSelection(), ...collection },
    page: { ...getEmptyPageTemplateSelection(), ...page },
  };
}

function normalizeCustomTemplates(value) {
  return Array.isArray(value) ? value : [];
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: {
      globalSettingsJson: true,
      templateSelectionsJson: true,
      customPromptTemplatesJson: true,
      credits: true,
      creditsUsedTotal: true,
      ownerName: true,
      name: true,
    },
  });

  let parsedGlobalSettings = {};
  let parsedTemplateSelections = {};
  let parsedCustomTemplates = [];
  try {
    parsedGlobalSettings = JSON.parse(shopData?.globalSettingsJson || "{}");
  } catch {
    parsedGlobalSettings = {};
  }
  try {
    parsedTemplateSelections = JSON.parse(shopData?.templateSelectionsJson || "{}");
  } catch {
    parsedTemplateSelections = {};
  }
  try {
    parsedCustomTemplates = JSON.parse(shopData?.customPromptTemplatesJson || "[]");
  } catch {
    parsedCustomTemplates = [];
  }

  const shopDomain = String(session.shop || "").trim();
  const shopHandle = shopDomain.split(".")[0] || "Shop Owner";
  const fallbackOwnerName = shopHandle
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const shopOwnerName =
    (shopData?.ownerName || "").trim() ||
    (shopData?.name || "").trim() ||
    fallbackOwnerName ||
    "Shop Owner";

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    globalSettings: normalizeGlobalSettings(parsedGlobalSettings),
    templateSelections: normalizeTemplateSelections(parsedTemplateSelections),
    customTemplates: normalizeCustomTemplates(parsedCustomTemplates),
    credits: shopData?.credits ?? 100,
    creditsUsedTotal: shopData?.creditsUsedTotal ?? 0,
    shopOwnerName,
  };
};

export default function App() {
  const { apiKey, globalSettings, templateSelections, customTemplates, credits, shopOwnerName } = useLoaderData();
  const navigation = useNavigation();
  const location = useLocation();
  const navigate = useNavigate();
  const fetchers = useFetchers();
  const isBusy = navigation.state !== "idle" || fetchers.some((fetcher) => fetcher.state !== "idle");
  const pageMeta = PAGE_HEADER_CONTENT[location.pathname] || {
    title: "Page",
    description: "Manage your store content and settings from this section.",
  };

  useEffect(() => {
    // Keep localStorage mirrored with DB values for client-side pages using local settings utilities.
    writeGlobalSettings(globalSettings);
    writeStoredProductPromptTemplateSelection(templateSelections.product);
    writeStoredCollectionPromptTemplateSelection(templateSelections.collection);
    writeStoredPagePromptTemplateSelection(templateSelections.page);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(customTemplates));
    }
  }, [globalSettings, templateSelections, customTemplates]);

  return (
    <PolarisProvider i18n={enTranslations}>
      <ShopifyAppProvider embedded apiKey={apiKey}>
        <s-app-nav>
          <s-link href="/app/products">Products Generator</s-link>
          <s-link href="/app/pages">Pages Generator</s-link>
          <s-link href="/app/blog">Blogs Generator</s-link>
          <s-link href="/app/content-management">Content Management</s-link>
          <s-link href="/app/template">Template</s-link>
          <s-link href="/app/analytics">Analytics</s-link>
          <s-link href="/app/settings">Settings</s-link>
        </s-app-nav>
        <div style={{ padding: "16px 16px 0" }}>
          <div className="dashboard-welcome-card">
            <div className="dashboard-hero-layout">
              <div>
                <Text as="h3" variant="headingLg">
                  Hi {shopOwnerName} !
                </Text>
                <Text as="h2" variant="headingSm">
                  {pageMeta.title}
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {pageMeta.description}
                </Text>
              </div>

              <div className="dashboard-hero-actions-col">
                <div className="dashboard-credit-pill">
                  <Icon source={StarFilledIcon} tone="subdued" />
                  <Text as="span" variant="bodyMd" tone="subdued">
                    {credits} credits.
                  </Text>
                  <button
                    type="button"
                    className="dashboard-upgrade-link"
                    onClick={() => navigate({ pathname: "/app/analytics", search: location.search })}
                  >
                    Upgrade
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        {isBusy && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.28)",
              zIndex: 99999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "all",
            }}
          >
            <div
              style={{
                background: "#ffffff",
                border: "1px solid var(--p-color-border)",
                borderRadius: 8,
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <Spinner accessibilityLabel="Loading" size="small" />
              <Text as="span" variant="bodySm">Processing...</Text>
            </div>
          </div>
        )}
        <Outlet />
      </ShopifyAppProvider>
    </PolarisProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
