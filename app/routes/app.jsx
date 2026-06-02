import { useEffect } from "react";
import { Outlet, useFetchers, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisProvider, Spinner, Text } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { AddCreditModal, openAddCreditModal } from "../components/AddCreditModal";
import { refreshMonthlyPlanCredits } from "../lib/billing.server";
import { normalizeStoredGlobalSettings, writeGlobalSettings } from "../lib/globalSettings";
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

function normalizeGlobalSettings(value) {
  return normalizeStoredGlobalSettings(value);
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
  const { admin, session } = await authenticate.admin(request);
  await refreshMonthlyPlanCredits(session.shop, admin);
  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: {
      globalSettingsJson: true,
      templateSelectionsJson: true,
      customPromptTemplatesJson: true,
      credits: true,
      creditsUsedTotal: true,
      billingPlanKey: true,
      billingPlanName: true,
      billingPlanCredits: true,
      billingSubscriptionStatus: true,
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
    credits: shopData?.credits ?? 150,
    creditsUsedTotal: shopData?.creditsUsedTotal ?? 0,
    billingPlanKey: shopData?.billingPlanKey || "free",
    billingPlanName: shopData?.billingPlanName || "Free",
    billingPlanCredits: shopData?.billingPlanCredits ?? 150,
    billingSubscriptionStatus: shopData?.billingSubscriptionStatus || null,
  };
};

export default function App() {
  const { apiKey, globalSettings, templateSelections, customTemplates } = useLoaderData();
  const navigation = useNavigation();
  const fetchers = useFetchers();
  const isBusy = navigation.state !== "idle" || fetchers.some((fetcher) => fetcher.state !== "idle");

  useEffect(() => {
    const hasInsufficientCredits = fetchers.some((fetcher) => {
      const data = fetcher.data;
      const message = String(data?.error || data?.message || "");
      return /insufficient credits/i.test(message);
    });
    if (hasInsufficientCredits) {
      openAddCreditModal();
    }
  }, [fetchers]);

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
          <s-link href="/app/products">Bulk Generator</s-link>
          <s-link href="/app/ai-visibility">AI Visibility</s-link>
          <s-link href="/app/pages">Pages Generator</s-link>
          <s-link href="/app/blog">Blogs Generator</s-link>
          {/* <s-link href="/app/seo-improve">SEO Improve</s-link> */}
          <s-link href="/app/content-management">Content Management</s-link>
          <s-link href="/app/template">Template</s-link>
          <s-link href="/app/analytics">Analytics</s-link>
          <s-link href="/app/jobs">Jobs</s-link>
          <s-link href="/app/pricing">Pricing</s-link>
          <s-link href="/app/settings">Settings</s-link>
        </s-app-nav>
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
        <AddCreditModal />
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
