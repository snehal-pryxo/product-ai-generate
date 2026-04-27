export const GLOBAL_SETTINGS_KEY = "ai_generate_global_settings_v1";

const DEFAULTS = {
  language: "English",
  productDescWords: "250",
  productMetaTitleWords: "60",
  productMetaDescWords: "160",
  collectionDescWords: "250",
  collectionMetaTitleWords: "60",
  collectionMetaDescWords: "160",
  pageContentWords: "450",
  pageMetaTitleWords: "60",
  pageMetaDescWords: "160",
  length: "medium",
  aiProvider: "auto",
  productDescKeywords: "high quality, premium, durable, best value",
  productMetaTitleKeywords: "buy online, best price, shop now",
  productMetaDescKeywords: "free shipping, secure checkout, top quality",
  collectionDescKeywords: "wide selection, quality products, great deals",
  collectionMetaTitleKeywords: "shop, browse, buy",
  collectionMetaDescKeywords: "explore our collection, quality guaranteed",
  pageContentKeywords: "trusted, professional, expert service",
  pageMetaTitleKeywords: "",
  pageMetaDescKeywords: "",
  blogContentKeywords: "tips, guide, expert advice, best practices",
  blogMetaTitleKeywords: "",
  blogMetaDescKeywords: "",
  // Template IDs
  productDescTemplateId: "",
  productMetaTitleTemplateId: "",
  productMetaDescTemplateId: "",
  collectionDescTemplateId: "",
  collectionMetaTitleTemplateId: "",
  collectionMetaDescTemplateId: "",
  pageBodyTemplateId: "",
  pageMetaTitleTemplateId: "",
  pageMetaDescTemplateId: "",
  blogBodyTemplateId: "",
  blogMetaTitleTemplateId: "",
  blogMetaDescTemplateId: "",
};

export function normalizeStoredGlobalSettings(settings) {
  const input = settings && typeof settings === "object" ? settings : {};
  return Object.fromEntries(
    Object.entries(DEFAULTS).map(([key, defaultValue]) => [key, input[key] ?? defaultValue]),
  );
}

export function readGlobalSettings() {
  if (typeof window === "undefined") return normalizeStoredGlobalSettings();
  try {
    const raw = window.localStorage.getItem(GLOBAL_SETTINGS_KEY);
    if (!raw) return normalizeStoredGlobalSettings();
    const parsed = JSON.parse(raw);
    return normalizeStoredGlobalSettings(parsed);
  } catch {
    return normalizeStoredGlobalSettings();
  }
}

export function writeGlobalSettings(settings) {
  const merged = normalizeStoredGlobalSettings(settings);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(merged));
  }
  return merged;
}

export function getDefaultGlobalSettings() {
  return normalizeStoredGlobalSettings();
}
