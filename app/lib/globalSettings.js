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
  productDescKeywords: "",
  productMetaTitleKeywords: "",
  productMetaDescKeywords: "",
  collectionDescKeywords: "",
  collectionMetaTitleKeywords: "",
  collectionMetaDescKeywords: "",
  pageContentKeywords: "",
  pageMetaTitleKeywords: "",
  pageMetaDescKeywords: "",
  blogContentKeywords: "",
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

export function getWordTarget(settings, key, fallback = "150") {
  const normalized = normalizeStoredGlobalSettings(settings);
  const value = Number.parseInt(normalized[key], 10);
  const defaultValue = Number.parseInt(DEFAULTS[key], 10);
  const fallbackValue = Number.parseInt(fallback, 10);
  const safeValue = Number.isFinite(value) && value > 0
    ? value
    : Number.isFinite(defaultValue) && defaultValue > 0
      ? defaultValue
      : Number.isFinite(fallbackValue) && fallbackValue > 0
        ? fallbackValue
        : 150;
  return safeValue;
}

export function getExactWordLengthOption(settings, key, fallback = "150") {
  return `${getWordTarget(settings, key, fallback)} words`;
}
