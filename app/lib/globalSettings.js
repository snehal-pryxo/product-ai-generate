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
  blogContentWords: "600",
  blogMetaTitleWords: "60",
  blogMetaDescWords: "160",
  tone: "professional",
  length: "medium",
  aiProvider: "auto",
  contextKeywords: "",
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

export function readGlobalSettings() {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(GLOBAL_SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeGlobalSettings(settings) {
  const merged = { ...DEFAULTS, ...settings };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(merged));
  }
  return merged;
}

export function getDefaultGlobalSettings() {
  return { ...DEFAULTS };
}
