export const GLOBAL_SETTINGS_KEY = "ai_generate_global_settings_v1";

const DEFAULTS = {
  language: "English",
  productDescWords: "150",
  productMetaTitleWords: "60",
  productMetaDescWords: "160",
  collectionDescWords: "150",
  collectionMetaTitleWords: "60",
  collectionMetaDescWords: "160",
  pageContentWords: "300",
  pageMetaTitleWords: "60",
  pageMetaDescWords: "160",
  blogContentWords: "600",
  blogMetaTitleWords: "60",
  blogMetaDescWords: "160",
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
