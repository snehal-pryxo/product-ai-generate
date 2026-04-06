const META_TITLE_MAX = 70;
const META_DESCRIPTION_MAX = 160;

function normalizeLanguage(language, fallback = "English") {
  if (!language || language === "en") return fallback;
  return language;
}

function normalizeText(value, fallback = "Not available") {
  const clean = String(value || "").trim();
  return clean || fallback;
}

function parseLengthRange(lengthOption) {
  const match = /(\d+)\s*-\s*(\d+)/.exec(lengthOption || "");
  if (!match) return { min: 50, max: 150 };

  return {
    min: Number(match[1]),
    max: Number(match[2]),
  };
}

function toFocusLabel(intent) {
  if (intent === "seo_title") return "Primary focus: generate only meta title with supporting improvements.";
  if (intent === "seo_description") {
    return "Primary focus: generate only meta description with supporting improvements.";
  }
  return "Primary focus: generate description/body content, meta title, and meta description together.";
}

export function buildProductContentPrompt({
  title,
  descriptionText,
  seoTitle,
  seoDescription,
  language,
  tone,
  lengthOption,
  format,
  contextKeywords,
  intent = "all",
}) {
  const { min, max } = parseLengthRange(lengthOption);

  return [
    "Role: You are a senior Shopify product copywriter and SEO specialist.",
    "Task: Create high-converting product content for one Shopify product.",
    "",
    toFocusLabel(intent),
    "",
    "Inputs:",
    `- Language: ${normalizeLanguage(language)}`,
    `- Tone: ${normalizeText(tone, "Neutral")}`,
    `- Description length target: ${min}-${max} words`,
    `- Description format: ${normalizeText(format, "Single paragraph")}`,
    `- Product title: ${normalizeText(title, "Untitled product")}`,
    `- Current product description: ${normalizeText(descriptionText)}`,
    `- Current meta title: ${normalizeText(seoTitle)}`,
    `- Current meta description: ${normalizeText(seoDescription)}`,
    `- Keywords and context: ${normalizeText(contextKeywords, "Not provided")}`,
    "",
    "Output (return valid JSON only, no markdown, no backticks):",
    '{ "productDescription": "...", "seoTitle": "...", "seoDescription": "..." }',
    "",
    "Rules:",
    `- "seoTitle" must be <= ${META_TITLE_MAX} characters.`,
    `- "seoDescription" must be <= ${META_DESCRIPTION_MAX} characters.`,
    "- Make productDescription persuasive, specific, and readable for storefront buyers.",
    "- Do not include unsupported claims, fake guarantees, or placeholder text.",
  ].join("\n");
}

export function buildCollectionContentPrompt({
  title,
  descriptionText,
  seoTitle,
  seoDescription,
  language,
  tone,
  lengthOption,
  format,
  contextKeywords,
  intent = "all",
}) {
  const { min, max } = parseLengthRange(lengthOption);

  return [
    "Role: You are a senior Shopify collection page copywriter and SEO specialist.",
    "Task: Create conversion-friendly collection content for one Shopify collection.",
    "",
    toFocusLabel(intent),
    "",
    "Inputs:",
    `- Language: ${normalizeLanguage(language)}`,
    `- Tone: ${normalizeText(tone, "Neutral")}`,
    `- Description length target: ${min}-${max} words`,
    `- Description format: ${normalizeText(format, "Single paragraph")}`,
    `- Collection title: ${normalizeText(title, "Untitled collection")}`,
    `- Current collection description: ${normalizeText(descriptionText)}`,
    `- Current meta title: ${normalizeText(seoTitle)}`,
    `- Current meta description: ${normalizeText(seoDescription)}`,
    `- Keywords and context: ${normalizeText(contextKeywords, "Not provided")}`,
    "",
    "Output (return valid JSON only, no markdown, no backticks):",
    '{ "collectionDescription": "...", "seoTitle": "...", "seoDescription": "..." }',
    "",
    "Rules:",
    `- "seoTitle" must be <= ${META_TITLE_MAX} characters.`,
    `- "seoDescription" must be <= ${META_DESCRIPTION_MAX} characters.`,
    "- Make collectionDescription clear, category-focused, and useful for product discovery.",
    "- Avoid keyword stuffing and generic filler copy.",
  ].join("\n");
}

export function buildPageContentPrompt({
  pageTitle,
  pageType,
  body,
  language,
  tone,
  length,
  format,
  contextKeywords,
}) {
  return [
    "Role: You are an expert Shopify storefront page copywriter and SEO specialist.",
    `Task: Generate content for a Shopify page of type "${normalizeText(pageType, "General")}".`,
    "",
    "Inputs:",
    `- Page title: ${normalizeText(pageTitle, "Untitled page")}`,
    `- Language: ${normalizeLanguage(language)}`,
    `- Tone: ${normalizeText(tone, "Neutral")}`,
    `- Length preference: ${normalizeText(length, "Medium")}`,
    `- Formatting preference: ${normalizeText(format, "Mixed headings and paragraphs")}`,
    `- Keywords and context: ${normalizeText(contextKeywords, "Not provided")}`,
    `- Existing page content snippet: ${normalizeText(body ? body.slice(0, 700) : "", "Not available")}`,
    "",
    "Output (return valid JSON only, no markdown, no backticks):",
    '{ "pageBody": "<HTML>", "seoTitle": "...", "seoDescription": "..." }',
    "",
    "Rules:",
    '- "pageBody" must be clean Shopify-safe HTML using headings, paragraphs, and lists where useful.',
    `- "seoTitle" must be <= ${META_TITLE_MAX} characters.`,
    `- "seoDescription" must be <= ${META_DESCRIPTION_MAX} characters.`,
    "- Keep language clear, trust-building, and aligned to the page type.",
  ].join("\n");
}

export function buildBlogContentPrompt({
  articleType,
  title,
  body,
  language,
  tone,
  length,
  format,
  contextKeywords,
}) {
  return [
    "Role: You are an expert Shopify blog writer and SEO content strategist.",
    `Task: Generate a complete blog article for article type "${normalizeText(articleType, "General")}".`,
    "",
    "Inputs:",
    `- Article topic/title: ${normalizeText(title, "Not provided")}`,
    `- Language: ${normalizeLanguage(language)}`,
    `- Tone: ${normalizeText(tone, "Neutral")}`,
    `- Length preference: ${normalizeText(length, "Medium")}`,
    `- Formatting preference: ${normalizeText(format, "Heading + paragraph format")}`,
    `- Keywords and context: ${normalizeText(contextKeywords, "Not provided")}`,
    `- Existing article content snippet: ${normalizeText(body ? body.slice(0, 700) : "", "Not available")}`,
    "",
    "Output (return valid JSON only, no markdown, no backticks):",
    '{ "articleTitle": "...", "articleBody": "<HTML>", "excerpt": "...", "seoTitle": "...", "seoDescription": "..." }',
    "",
    "Rules:",
    '- "articleBody" must be structured HTML with useful headings and scannable sections.',
    '- "excerpt" should be 1-2 concise sentences for listings and previews.',
    `- "seoTitle" must be <= ${META_TITLE_MAX} characters.`,
    `- "seoDescription" must be <= ${META_DESCRIPTION_MAX} characters.`,
    "- Keep claims realistic and useful for readers at each stage of intent.",
  ].join("\n");
}
