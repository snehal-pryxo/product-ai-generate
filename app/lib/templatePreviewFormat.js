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
