export function buildMetaPreviewText(template) {
  const fallback =
    "Organic Bamboo Bed Sheets - Queen Size - Softer than cotton for ultimate luxury. Temperature regulating for year-round comfort. Shop now!";
  const text = String(template?.template || "").trim();
  if (!text) return fallback;

  const withoutBracketHints = text.replace(/\[[^\]]+\]/g, "").trim();
  if (!withoutBracketHints) return fallback;

  return withoutBracketHints
    .replace(/\s+/g, " ")
    .replace(/\{[^}]+\}/g, "Organic Bamboo Bed Sheets")
    .slice(0, 220);
}

export function buildDescriptionPreviewText(template) {
  const raw = String(template?.template || "").trim();
  if (!raw) return "";

  const cleanedLines = raw
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*[-*]\s*/, "")
        .replace(/\[([^\]]+)\]/g, "$1")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => !/^key features and benefits\s*:/i.test(line));

  if (!cleanedLines.length) return "";

  const introLines = cleanedLines.slice(0, 2);
  const featureLines = cleanedLines.slice(2, 8);
  const closingLines = cleanedLines.slice(8);

  const introText = introLines.join(" ").replace(/\s+/g, " ").trim();
  const featureText = featureLines.map((line) => `- ${line}`).join("\n");
  const closingText = closingLines.join(" ").replace(/\s+/g, " ").trim();

  return [
    introText,
    featureText ? `\n\nRefined Details:\n${featureText}` : "",
    closingText ? `\n\n${closingText}` : "",
  ]
    .join("")
    .trim();
}

function countWords(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function ensureTrailingPeriod(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/[.!?]$/.test(text)) return text;
  return `${text}.`;
}

function getTargetWordCount(resourceId, templateId) {
  const id = String(templateId || "").toLowerCase();
  if (resourceId === "page" || id.startsWith("page-")) return 500;
  return 400;
}

function buildFillerParagraph(heading, index) {
  const variants = [
    `This preview is generated from your selected template and is intentionally expanded for realistic long-form output. It keeps the structure clear, improves scanning with logical progression, and balances descriptive clarity with SEO-friendly language. The content style remains commercial but trustworthy, so shoppers can quickly understand fit, value, and practical outcomes before they decide to purchase.`,
    `In real storefront use, this section would dynamically adapt to the product context, category intent, and audience expectations. The writing remains focused on concrete attributes, useful differentiators, and consistent brand tone, so the description reads naturally while still covering key details that influence conversion quality, search visibility, and buyer confidence across devices.`,
    `This expanded preview also demonstrates how longer descriptions can preserve readability without sounding repetitive. Information is grouped by purpose, moving from high-level understanding to specific evidence and practical relevance. That approach helps merchants communicate value more effectively, especially for products that require richer context, comparison clarity, or decision-support information.`,
    `For performance-driven ecommerce pages, long-form copy should still feel concise at a section level. This model uses short blocks, straightforward wording, and selective emphasis, making the narrative easier to consume. It also supports better indexing by including semantically meaningful phrases tied to usage scenarios, quality signals, and expected customer outcomes in a natural way.`,
  ];
  const chosen = variants[index % variants.length];
  return `${chosen} ${heading} content is generated dynamically for preview consistency across template screens.`;
}

function expandSectionsToTargetWords(sections, heading, targetWordCount) {
  let runningWords = sections.reduce((total, section) => {
    return (
      total +
      countWords(section.title) +
      section.paragraphs.reduce((sum, paragraph) => sum + countWords(paragraph), 0) +
      section.points.reduce((sum, point) => sum + countWords(point), 0)
    );
  }, 0);

  let index = 0;
  while (runningWords < targetWordCount) {
    const filler = buildFillerParagraph(heading, index);
    const benefitsSection = sections.find((section) => section.title === "Benefits");
    if (benefitsSection) {
      benefitsSection.paragraphs.push(filler);
    } else {
      sections.push({
        title: "Benefits",
        paragraphs: [filler],
        points: [],
      });
    }
    runningWords += countWords(filler);
    index += 1;
    if (index > 20) break;
  }
}

export function buildDescriptionStructuredPreview(template, templateName = "", options = {}) {
  const raw = String(template?.template || "").trim();
  if (!raw) return null;

  const lines = raw
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*[-*]\s*/, "")
        .replace(/\[([^\]]+)\]/g, "$1")
        .replace(/\{[^}]+\}/g, "Product detail")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => !/^key features and benefits\s*:/i.test(line));

  if (!lines.length) return null;

  const heading = String(templateName || lines[0] || "Description Preview").trim();
  const intro = ensureTrailingPeriod(lines.slice(0, 2).join(" ").trim());
  const points = lines.slice(2, 8).map((line) => line.replace(/:$/, "").trim()).filter(Boolean);
  const benefit = ensureTrailingPeriod(lines.slice(8).join(" ").trim());

  const sections = [];

  if (intro) {
    sections.push({
      title: "Overview",
      paragraphs: [intro],
      points: [],
    });
  }

  if (points.length) {
    sections.push({
      title: "Key Features",
      paragraphs: [],
      points,
    });
  }

  if (benefit) {
    sections.push({
      title: "Benefits",
      paragraphs: [benefit],
      points: [],
    });
  }

  const targetWordCount = getTargetWordCount(options.resourceId, template?.id);
  expandSectionsToTargetWords(sections, heading, targetWordCount);

  return {
    heading,
    subheading: `Generated dynamically from the selected template structure (${targetWordCount}+ words preview).`,
    sections,
  };
}
