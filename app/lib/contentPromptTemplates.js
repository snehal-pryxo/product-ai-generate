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
  const raw = String(lengthOption || "");
  const rangeMatch = /(\d+)\s*-\s*(\d+)/.exec(raw);
  if (rangeMatch) {
    return {
      min: Number(rangeMatch[1]),
      max: Number(rangeMatch[2]),
      exact: null,
    };
  }

  const exactMatch = /(\d+)\s*words?/i.exec(raw);
  if (exactMatch) {
    const exact = Number(exactMatch[1]);
    return { min: exact, max: exact, exact };
  }

  return { min: 50, max: 150, exact: null };
}

function parseMinimumWordTarget(lengthOption) {
  const raw = String(lengthOption || "");

  const plusMatch = /(\d+)\s*\+\s*words?/i.exec(raw);
  if (plusMatch) return Number(plusMatch[1]);

  const aroundMatch = /around\s*(\d+)/i.exec(raw);
  if (aroundMatch) return Number(aroundMatch[1]);

  const rangeMatch = /(\d+)\s*-\s*(\d+)/.exec(raw);
  if (rangeMatch) return Number(rangeMatch[2]);

  const exactMatch = /(\d+)\s*words?/i.exec(raw);
  if (exactMatch) return Number(exactMatch[1]);

  return null;
}

function getLengthTargetLabel(lengthOption) {
  const { min, max, exact } = parseLengthRange(lengthOption);
  return exact ? `${exact} words` : `${min}-${max} words`;
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
  const lengthTargetLabel = getLengthTargetLabel(lengthOption);
  const descriptionTemplate = normalizeText(descriptionPromptTemplate, "");
  const seoTitleTemplate = normalizeText(metaTitlePromptTemplate, "");
  const seoDescriptionTemplate = normalizeText(metaDescriptionPromptTemplate, "");
  const hasDescriptionTemplate = Boolean(descriptionTemplate);
  const hasSeoTitleTemplate = Boolean(seoTitleTemplate);
  const hasSeoDescriptionTemplate = Boolean(seoDescriptionTemplate);
  const hasAnyTemplate = hasDescriptionTemplate || hasSeoTitleTemplate || hasSeoDescriptionTemplate;

  const keywordInstruction = contextKeywords && contextKeywords.trim()
    ? `IMPORTANT: You MUST use each of these keywords verbatim (exact wording) at least once in the output: "${contextKeywords.trim()}". Spread them across the description, seoTitle, and seoDescription. Do NOT paraphrase or skip any keyword.`
    : null;

  return [
    "Role: You are a senior Shopify product copywriter and SEO specialist.",
    "Task: Create high-converting product content for one Shopify product.",
    ...(keywordInstruction ? [keywordInstruction, ""] : []),
    "",
    toFocusLabel(intent),
    "",
    "Inputs:",
    `- Language: ${normalizeLanguage(language)}`,
    `- Tone: ${normalizeText(tone, "Neutral")}`,
    `- Description length target: ${lengthTargetLabel}`,
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
    '- "productDescription" must be well-structured Shopify-safe HTML.',
    `- "productDescription" must be approximately ${lengthTargetLabel}; do not ignore this target.`,
    '- Use a compelling <h2> as the main heading, followed by a short introductory <p>.',
    '- Then 2–3 <h3> subheadings each followed by a <p> explaining a key benefit or feature.',
    '- End with a <ul>/<li> list of 3–5 key highlights or specifications.',
    '- Each <p> should be 2–4 sentences. Do NOT use a single wall of text.',
    `- "seoTitle" must be <= ${META_TITLE_MAX} characters, include the product name and a key benefit.`,
    `- "seoDescription" must be <= ${META_DESCRIPTION_MAX} characters, compelling and keyword-rich.`,
    "- Do not return markdown. Return HTML only for the description.",
    "- Do not include unsupported claims, fake guarantees, or placeholder text.",
    '- REQUIRED: If "Keywords and context" is provided, you MUST use each keyword or phrase verbatim (exact wording) at least once in the output. Spread them across productDescription, seoTitle, and seoDescription. Do NOT paraphrase or omit any keyword.',
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
  const lengthTargetLabel = getLengthTargetLabel(lengthOption);
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
    `- Description length target: ${lengthTargetLabel}`,
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
    '- "collectionDescription" must be well-structured Shopify-safe HTML.',
    `- "collectionDescription" must be approximately ${lengthTargetLabel}; do not ignore this target.`,
    '- Start with a prominent <h2> heading for the collection, then a 2–3 sentence introductory <p>.',
    '- Add 2 <h3> subheadings (e.g., "Why Shop This Collection", "What\'s Inside") each with a descriptive <p>.',
    '- Close with a <ul>/<li> listing 4–5 product categories or collection highlights.',
    `- "seoTitle" must be <= ${META_TITLE_MAX} characters, include the collection name.`,
    `- "seoDescription" must be <= ${META_DESCRIPTION_MAX} characters, enticing and searchable.`,
    "- Do not return markdown. Return HTML only for the description.",
    "- Avoid keyword stuffing and generic filler copy.",
    '- REQUIRED: If "Keywords and context" is provided, you MUST use each keyword or phrase verbatim (exact wording) at least once in the output. Spread them across productDescription, seoTitle, and seoDescription. Do NOT paraphrase or omit any keyword.',
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
    '- "pageBody" must be well-structured, clean Shopify-safe HTML.',
    '- Begin with a bold <h1> or <h2> page title heading.',
    '- Divide content into clearly labelled sections each with an <h2> or <h3> heading followed by 1–3 <p> paragraphs.',
    '- Use <ul>/<li> for any lists, features, or FAQs. Keep each <p> to 3–5 readable sentences.',
    ...(minimumWords ? [`- "pageBody" should be approximately ${minimumWords} words unless input constraints make that impossible.`] : []),
    `- "seoTitle" must be <= ${META_TITLE_MAX} characters, include the page name and primary keyword.`,
    `- "seoDescription" must be <= ${META_DESCRIPTION_MAX} characters, concise and action-oriented.`,
    "- Do not return markdown. Return HTML only for pageBody.",
    "- Keep language clear, trust-building, and aligned to the page type.",
    '- If "Keywords and context" is provided, naturally incorporate ALL of those keywords into the pageBody, seoTitle, and seoDescription. Do not skip any keyword.',
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
    '- "articleBody" must be rich, well-structured Shopify-safe HTML.',
    '- Start with an engaging <h1> article title, then a compelling 2–3 sentence introductory <p>.',
    '- Use 3–5 <h2> section headings throughout the article, each followed by 2–4 <p> paragraphs.',
    '- Include at least one <h3> sub-section under a relevant <h2> for depth.',
    '- Use <ul>/<li> or <ol>/<li> for any lists, steps, or bullet points.',
    '- End with a concluding <h2> (e.g., "Final Thoughts" or "Conclusion") and a summary <p>.',
    ...(minimumWords ? [`- "articleBody" should be at least ${minimumWords} words unless input constraints make that impossible.`] : []),
    '- "excerpt" should be 1–2 concise sentences for listings and previews.',
    `- "seoTitle" must be <= ${META_TITLE_MAX} characters, include the main topic keyword.`,
    `- "seoDescription" must be <= ${META_DESCRIPTION_MAX} characters, informative and click-worthy.`,
    "- Do not return markdown. Return HTML only for articleBody.",
    "- Keep claims realistic and useful for readers at each stage of intent.",
    '- If "Keywords and context" is provided, naturally incorporate ALL of those keywords into the articleBody, seoTitle, and seoDescription. Do not skip any keyword.',
  ].join("\n");
}
