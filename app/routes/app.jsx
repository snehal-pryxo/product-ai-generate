import { useEffect } from "react";
import { Outlet, useFetchers, useLoaderData, useNavigate, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisProvider, Spinner, Text } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
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
import {
  getEmptyBlogTemplateSelection,
  writeStoredBlogPromptTemplateSelection,
} from "../lib/blogPromptTemplateLibrary";

const CUSTOM_TEMPLATES_KEY = "custom_prompt_templates_v1";

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
  const blog = input.blog && typeof input.blog === "object" ? input.blog : {};
  return {
    product: { ...getEmptyTemplateSelection(), ...product },
    collection: { ...getEmptyCollectionTemplateSelection(), ...collection },
    page: { ...getEmptyPageTemplateSelection(), ...page },
    blog: { ...getEmptyBlogTemplateSelection(), ...blog },
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

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    globalSettings: normalizeGlobalSettings(parsedGlobalSettings),
    templateSelections: normalizeTemplateSelections(parsedTemplateSelections),
    customTemplates: normalizeCustomTemplates(parsedCustomTemplates),
    credits: shopData?.credits ?? 100,
    creditsUsedTotal: shopData?.creditsUsedTotal ?? 0,
  };
};

export default function App() {
  const { apiKey, globalSettings, templateSelections, customTemplates, credits, creditsUsedTotal } = useLoaderData();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const fetchers = useFetchers();
  const isBusy = navigation.state !== "idle" || fetchers.some((fetcher) => fetcher.state !== "idle");

  const handleOpenCredits = () => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    navigate({ pathname: "/app/analytics", search });
  };

  useEffect(() => {
    // Keep localStorage mirrored with DB values for client-side pages using local settings utilities.
    writeGlobalSettings(globalSettings);
    writeStoredProductPromptTemplateSelection(templateSelections.product);
    writeStoredCollectionPromptTemplateSelection(templateSelections.collection);
    writeStoredPagePromptTemplateSelection(templateSelections.page);
    writeStoredBlogPromptTemplateSelection(templateSelections.blog);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(customTemplates));
    }
  }, [globalSettings, templateSelections, customTemplates]);

  return (
    <PolarisProvider i18n={enTranslations}>
      <ShopifyAppProvider embedded apiKey={apiKey}>
        <s-app-nav>
          <s-link href="/app/products">Products</s-link>
          <s-link href="/app/pages">Pages</s-link>
          <s-link href="/app/blog">Blog</s-link>
          <s-link href="/app/template">Template</s-link>
           <s-link href="/app/analytics">Analytics</s-link>
          <s-link href="/app/settings">Settings</s-link>
        </s-app-nav>
        <div
          style={{
            position: "fixed",
            top: 10,
            right: 14,
            zIndex: 1000,
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          {/* Credits badge */}
          <button
            type="button"
            onClick={handleOpenCredits}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              border: "1px solid #d1d5db",
              background: "#ffffff",
              borderRadius: 20,
              padding: "4px 10px",
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              fontSize: 12,
              fontWeight: 600,
              color: "#111827",
              lineHeight: 1,
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 20 20" fill="#f59e0b">
              <path d="M10 1L12.39 7.26L19 8.27L14.5 12.64L15.78 19.02L10 15.77L4.22 19.02L5.5 12.64L1 8.27L7.61 7.26L10 1Z"/>
            </svg>
            <span>{credits} credits.</span>
            <span style={{ color: "#2563eb" }}>Upgrade</span>
          </button>
          {/* Add Credits button */}
          <button
            type="button"
            onClick={handleOpenCredits}
            style={{
              display: "inline-flex",
              alignItems: "center",
              border: "1px solid #d1d5db",
              background: "#ffffff",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 600,
              color: "#374151",
              cursor: "pointer",
              whiteSpace: "nowrap",
              lineHeight: 1,
            }}
          >
            Add Credits
          </button>
          {/* Upgrade button */}
          <button
            type="button"
            onClick={handleOpenCredits}
            style={{
              display: "inline-flex",
              alignItems: "center",
              border: "none",
              background: "#111827",
              borderRadius: 6,
              padding: "5px 10px",
              fontSize: 11,
              fontWeight: 700,
              color: "#ffffff",
              cursor: "pointer",
              whiteSpace: "nowrap",
              lineHeight: 1,
            }}
          >
            Upgrade
          </button>
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
