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

function parseMinimumWordTarget(lengthOption) {
  const raw = String(lengthOption || "");

  const plusMatch = /(\d+)\s*\+\s*words?/i.exec(raw);
  if (plusMatch) return Number(plusMatch[1]);

  const aroundMatch = /around\s*(\d+)/i.exec(raw);
  if (aroundMatch) return Number(aroundMatch[1]);

  const rangeMatch = /(\d+)\s*-\s*(\d+)/.exec(raw);
  if (rangeMatch) return Number(rangeMatch[1]);

  return null;
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
  descriptionPromptTemplate,
  metaTitlePromptTemplate,
  metaDescriptionPromptTemplate,
  intent = "all",
}) {
  const { min, max } = parseLengthRange(lengthOption);
  const descriptionTemplate = normalizeText(descriptionPromptTemplate, "");
  const seoTitleTemplate = normalizeText(metaTitlePromptTemplate, "");
  const seoDescriptionTemplate = normalizeText(metaDescriptionPromptTemplate, "");
  const hasDescriptionTemplate = Boolean(descriptionTemplate);
  const hasSeoTitleTemplate = Boolean(seoTitleTemplate);
  const hasSeoDescriptionTemplate = Boolean(seoDescriptionTemplate);
  const hasAnyTemplate = hasDescriptionTemplate || hasSeoTitleTemplate || hasSeoDescriptionTemplate;

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
    ...(hasAnyTemplate
      ? [
          "",
          "Template instructions:",
          hasDescriptionTemplate
            ? `- Product description template (follow structure): ${descriptionTemplate}`
            : "- Product description template: Not provided",
          hasSeoTitleTemplate
            ? `- Meta title template (adapt placeholders): ${seoTitleTemplate}`
            : "- Meta title template: Not provided",
          hasSeoDescriptionTemplate
            ? `- Meta description template (adapt placeholders): ${seoDescriptionTemplate}`
            : "- Meta description template: Not provided",
        ]
      : []),
    "",
    "Output (return valid JSON only, no markdown, no backticks):",
    '{ "productDescription": "<HTML>", "seoTitle": "...", "seoDescription": "..." }',
    "",
    "Rules:",
    '- "productDescription" must be valid Shopify-safe HTML (use <h2>, <p>, and <ul>/<li> where helpful).',
    `- "seoTitle" must be <= ${META_TITLE_MAX} characters.`,
    `- "seoDescription" must be <= ${META_DESCRIPTION_MAX} characters.`,
    "- Make productDescription persuasive, specific, and readable for storefront buyers.",
    "- Do not return markdown. Return HTML only for the description.",
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
  descriptionPromptTemplate,
  metaTitlePromptTemplate,
  metaDescriptionPromptTemplate,
  intent = "all",
}) {
  const { min, max } = parseLengthRange(lengthOption);
  const descriptionTemplate = normalizeText(descriptionPromptTemplate, "");
  const seoTitleTemplate = normalizeText(metaTitlePromptTemplate, "");
  const seoDescriptionTemplate = normalizeText(metaDescriptionPromptTemplate, "");
  const hasDescriptionTemplate = Boolean(descriptionTemplate);
  const hasSeoTitleTemplate = Boolean(seoTitleTemplate);
  const hasSeoDescriptionTemplate = Boolean(seoDescriptionTemplate);
  const hasAnyTemplate = hasDescriptionTemplate || hasSeoTitleTemplate || hasSeoDescriptionTemplate;

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
    ...(hasAnyTemplate
      ? [
          "",
          "Template instructions:",
          hasDescriptionTemplate
            ? `- Collection description template (follow structure): ${descriptionTemplate}`
            : "- Collection description template: Not provided",
          hasSeoTitleTemplate
            ? `- Meta title template (adapt placeholders): ${seoTitleTemplate}`
            : "- Meta title template: Not provided",
          hasSeoDescriptionTemplate
            ? `- Meta description template (adapt placeholders): ${seoDescriptionTemplate}`
            : "- Meta description template: Not provided",
        ]
      : []),
    "",
    "Output (return valid JSON only, no markdown, no backticks):",
    '{ "collectionDescription": "<HTML>", "seoTitle": "...", "seoDescription": "..." }',
    "",
    "Rules:",
    '- "collectionDescription" must be valid Shopify-safe HTML (use <h2>, <p>, and <ul>/<li> where helpful).',
    `- "seoTitle" must be <= ${META_TITLE_MAX} characters.`,
    `- "seoDescription" must be <= ${META_DESCRIPTION_MAX} characters.`,
    "- Make collectionDescription clear, category-focused, and useful for product discovery.",
    "- Do not return markdown. Return HTML only for the description.",
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
  bodyPromptTemplate,
  metaTitlePromptTemplate,
  metaDescriptionPromptTemplate,
}) {
  const minimumWords = parseMinimumWordTarget(length);
  const pageBodyTemplate = normalizeText(bodyPromptTemplate, "");
  const seoTitleTemplate = normalizeText(metaTitlePromptTemplate, "");
  const seoDescriptionTemplate = normalizeText(metaDescriptionPromptTemplate, "");
  const hasBodyTemplate = Boolean(pageBodyTemplate);
  const hasSeoTitleTemplate = Boolean(seoTitleTemplate);
  const hasSeoDescriptionTemplate = Boolean(seoDescriptionTemplate);
  const hasAnyTemplate = hasBodyTemplate || hasSeoTitleTemplate || hasSeoDescriptionTemplate;

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
    ...(hasAnyTemplate
      ? [
          "",
          "Template instructions:",
          hasBodyTemplate
            ? `- Page body template (follow structure): ${pageBodyTemplate}`
            : "- Page body template: Not provided",
          hasSeoTitleTemplate
            ? `- Meta title template (adapt placeholders): ${seoTitleTemplate}`
            : "- Meta title template: Not provided",
          hasSeoDescriptionTemplate
            ? `- Meta description template (adapt placeholders): ${seoDescriptionTemplate}`
            : "- Meta description template: Not provided",
        ]
      : []),
    "",
    "Output (return valid JSON only, no markdown, no backticks):",
    '{ "pageBody": "<HTML>", "seoTitle": "...", "seoDescription": "..." }',
    "",
    "Rules:",
    '- "pageBody" must be clean Shopify-safe HTML using headings, paragraphs, and lists where useful.',
    ...(minimumWords ? [`- "pageBody" should be at least ${minimumWords} words unless input constraints make that impossible.`] : []),
    `- "seoTitle" must be <= ${META_TITLE_MAX} characters.`,
    `- "seoDescription" must be <= ${META_DESCRIPTION_MAX} characters.`,
    "- Do not return markdown. Return HTML only for pageBody.",
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
  bodyPromptTemplate,
  metaTitlePromptTemplate,
  metaDescriptionPromptTemplate,
}) {
  const minimumWords = parseMinimumWordTarget(length);
  const articleBodyTemplate = normalizeText(bodyPromptTemplate, "");
  const seoTitleTemplate = normalizeText(metaTitlePromptTemplate, "");
  const seoDescriptionTemplate = normalizeText(metaDescriptionPromptTemplate, "");
  const hasBodyTemplate = Boolean(articleBodyTemplate);
  const hasSeoTitleTemplate = Boolean(seoTitleTemplate);
  const hasSeoDescriptionTemplate = Boolean(seoDescriptionTemplate);
  const hasAnyTemplate = hasBodyTemplate || hasSeoTitleTemplate || hasSeoDescriptionTemplate;

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
    ...(hasAnyTemplate
      ? [
          "",
          "Template instructions:",
          hasBodyTemplate
            ? `- Article body template (follow structure): ${articleBodyTemplate}`
            : "- Article body template: Not provided",
          hasSeoTitleTemplate
            ? `- Meta title template (adapt placeholders): ${seoTitleTemplate}`
            : "- Meta title template: Not provided",
          hasSeoDescriptionTemplate
            ? `- Meta description template (adapt placeholders): ${seoDescriptionTemplate}`
            : "- Meta description template: Not provided",
        ]
      : []),
    "",
    "Output (return valid JSON only, no markdown, no backticks):",
    '{ "articleTitle": "...", "articleBody": "<HTML>", "excerpt": "...", "seoTitle": "...", "seoDescription": "..." }',
    "",
    "Rules:",
    '- "articleBody" must be structured Shopify-safe HTML with useful headings and scannable sections.',
    ...(minimumWords ? [`- "articleBody" should be at least ${minimumWords} words unless input constraints make that impossible.`] : []),
    '- "excerpt" should be 1-2 concise sentences for listings and previews.',
    `- "seoTitle" must be <= ${META_TITLE_MAX} characters.`,
    `- "seoDescription" must be <= ${META_DESCRIPTION_MAX} characters.`,
    "- Do not return markdown. Return HTML only for articleBody.",
    "- Keep claims realistic and useful for readers at each stage of intent.",
  ].join("\n");
}
