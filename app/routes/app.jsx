import { useEffect } from "react";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisProvider } from "@shopify/polaris";
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
  };
};

export default function App() {
  const { apiKey, globalSettings, templateSelections, customTemplates } = useLoaderData();

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
          <s-link href="/app/content-management">Content Management</s-link>
          <s-link href="/app/template">Template</s-link>
           <s-link href="/app/analytics">Analytics</s-link>
          <s-link href="/app/settings">Settings</s-link>
        </s-app-nav>
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
