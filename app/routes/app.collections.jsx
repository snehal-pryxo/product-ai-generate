import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
  useRevalidator,
} from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
/* global process */

const PAGE_SIZE = 8;
const EDIT_MODAL_ID = "collection-edit-modal";
const GENERATE_ALL_INTENT = "generate_all";
const GENERATE_META_TITLE_INTENT = "generate_meta_title";
const GENERATE_META_DESCRIPTION_INTENT = "generate_meta_description";
const UPDATE_COLLECTION_INTENT = "update_collection";
const DEFAULT_AI_MODEL = "gpt-4o-mini";
const DEFAULT_OLLAMA_MODEL = "llama3.2:1b";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const OPENAI_RATE_LIMIT_RETRY_DELAY_MS = 20000;
const OPENAI_MODEL_ACCESS_ERROR_PATTERN = /does not exist|do not have access|not found/i;
const OPENAI_QUOTA_ERROR_PATTERN = /quota|billing|insufficient_quota/i;
const OPENAI_RATE_LIMIT_ERROR_PATTERN = /rate limit|too many requests|429/i;
const OPENAI_OLLAMA_FALLBACK_ERROR_PATTERN =
  /quota|billing|insufficient_quota|OPENAI_API_KEY is missing|does not exist|do not have access|rate limit|too many requests|429/i;
const ENABLED_ENV_VALUE_PATTERN = /^(1|true|yes)$/i;
const COLLECTION_UPDATE_MUTATION_INPUT = `#graphql
  mutation CollectionUpdateInput($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        title
        descriptionHtml
        seo {
          title
          description
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_UPDATE_MUTATION_FALLBACK = `#graphql
  mutation CollectionUpdateFallback($collection: CollectionUpdateInput!) {
    collectionUpdate(collection: $collection) {
      collection {
        id
        title
        descriptionHtml
        seo {
          title
          description
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;
const LANGUAGE_OPTIONS = [
  "English",
  "English (British)",
  "English (US)",
  "Afrikaans",
  "Akan",
  "Albanian",
  "Amharic",
  "Arabic",
  "Armenian",
  "Assamese",
  "Aymara",
  "Azerbaijani",
  "Bambara",
  "Basque",
  "Belarusian",
  "Bengali",
  "Bhojpuri",
  "Bosnian",
  "Bulgarian",
  "Burmese",
  "Catalan",
  "Cebuano",
  "Chinese",
  "Chinese (Simplified)",
  "Chinese (Traditional)",
  "Corsican",
  "Croatian",
  "Czech",
  "Danish",
  "Dhivehi",
  "Dogri",
  "Dutch",
  "Esperanto",
  "Estonian",
  "Ewe",
  "Filipino",
  "Finnish",
  "French",
  "Frisian",
  "Galician",
  "Georgian",
  "German",
  "Greek",
  "Guarani",
  "Gujarati",
  "Haitian Creole",
  "Hausa",
  "Hawaiian",
  "Hebrew",
  "Hindi",
  "Hmong",
  "Hungarian",
  "Icelandic",
  "Igbo",
  "Ilocano",
  "Indonesian",
  "Irish",
  "Italian",
  "Japanese",
  "Javanese",
  "Kannada",
  "Kashmiri",
  "Kazakh",
  "Khmer",
  "Kinyarwanda",
  "Konkani",
  "Korean",
  "Krio",
  "Kurdish (Kurmanji)",
  "Kurdish (Sorani)",
  "Kyrgyz",
  "Lao",
  "Latin",
  "Latvian",
  "Lingala",
  "Lithuanian",
  "Luganda",
  "Luxembourgish",
  "Macedonian",
  "Maithili",
  "Malagasy",
  "Malay",
  "Malayalam",
  "Maltese",
  "Maori",
  "Marathi",
  "Meiteilon (Manipuri)",
  "Mizo",
  "Mongolian",
  "Nepali",
  "Norwegian",
  "Nyanja (Chichewa)",
  "Odia",
  "Oromo",
  "Pashto",
  "Persian",
  "Polish",
  "Portuguese",
  "Punjabi",
  "Quechua",
  "Romanian",
  "Russian",
  "Samoan",
  "Sanskrit",
  "Scots Gaelic",
  "Sepedi",
  "Serbian",
  "Sesotho",
  "Shona",
  "Sindhi",
  "Sinhala",
  "Slovak",
  "Slovenian",
  "Somali",
  "Spanish",
  "Sundanese",
  "Swahili",
  "Swedish",
  "Tajik",
  "Tamil",
  "Tatar",
  "Telugu",
  "Thai",
  "Tigrinya",
  "Tsonga",
  "Turkish",
  "Turkmen",
  "Twi",
  "Ukrainian",
  "Urdu",
  "Uyghur",
  "Uzbek",
  "Vietnamese",
  "Welsh",
  "Xhosa",
  "Yiddish",
  "Yoruba",
  "Zulu",
];
const TONE_OPTIONS = ["Professional", "Neutral", "Friendly", "Playful"];
const LENGTH_OPTIONS = ["50 - 150 words", "100 - 200 words", "200 - 300 words"];
const FORMAT_OPTIONS = [
  "Single paragraph",
  "1 Paragraph with Bullet List",
  "2 Paragraph",
  "3 Paragraph",
  "Custom Formatting",
];
const KEYWORD_CHIPS = ["[Description]"];
const DESCRIPTION_STYLE_OPTIONS = ["Normal", "Heading", "Subheading"];

const imageStyle = {
  width: "52px",
  height: "52px",
  objectFit: "cover",
  borderRadius: "6px",
  border: "1px solid #e1e6ed",
  background: "#fff",
};

const imageFallbackStyle = {
  width: "52px",
  height: "52px",
  borderRadius: "6px",
  border: "1px dashed #d0d8e2",
  display: "grid",
  placeItems: "center",
  color: "#738194",
  fontSize: "11px",
  background: "#f7f9fb",
};

const tablePanelStyle = {
  borderRadius: "10px",
};

const tableShellStyle = {
  fontSize: "13px",
  color: "#1f2937",
};

const tableViewportStyle = {
  overflowX: "auto",
  borderRadius: "10px",
  border: "1px solid #dbe0e7",
  background: "#ffffff",
};

const tableElementStyle = {
  minWidth: "980px",
};

const titleTextStyle = {
  color: "#1b2434",
  fontSize: "13px",
  fontWeight: 500,
  lineHeight: 1.25,
};

const checkboxStyle = {
  width: "20px",
  height: "20px",
};

const paginationWrapStyle = {
  marginTop: "12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
  flexWrap: "wrap",
};

const searchWrapStyle = {
  marginBottom: "4px",
};

const searchFieldStyle = {
  width: "100%",
};

const cellContentStyle = {
  display: "flex",
  alignItems: "center",
  minHeight: "52px",
};

const emptyStateStyle = {
  color: "#607080",
  fontSize: "13px",
};

const modalBodyStyle = {
  paddingTop: "4px",
  fontFamily: '"Segoe UI", Tahoma, Arial, sans-serif',
};

const modalShellStyle = {
  borderRadius: "14px",
  background: "#e9e9eb",
  border: "1px solid #cfcfd2",
  padding: "10px",
  fontSize: "13px",
  color: "#2f343c",
  boxShadow: "none",
};

const modalGridStyle = {
  display: "grid",
  gridTemplateColumns: "58% 42%",
  gridTemplateAreas: '"left right"',
  gap: "10px",
  alignItems: "flex-start",
  width: "100%",
};

const modalMainCardStyle = {
  gridArea: "left",
  borderRadius: "14px",
  border: "1px solid #c8c9cc",
  background: "#ececef",
  padding: "12px",
  boxShadow: "none",
};

const modalSideCardStyle = {
  gridArea: "right",
  borderRadius: "14px",
  border: "1px solid #c8c9cc",
  background: "#ececef",
  padding: "12px",
  boxShadow: "none",
};

const modalSectionSpacingStyle = {
  marginTop: "12px",
};

const descriptionToSeoSpacerStyle = {
  height: "120px",
};

const descriptionHeadingStyle = {
  marginBottom: "6px",
  color: "#1f252c",
  fontSize: "14px",
  fontWeight: 700,
};

const fieldLabelStyle = {
  display: "block",
  marginBottom: "6px",
  color: "#3d434b",
  fontSize: "14px",
  fontWeight: 600,
};

const collectionTitleInputStyle = {
  width: "100%",
  height: "40px",
  border: "1px solid #dadbdf",
  borderRadius: "10px",
  background: "#dedfe2",
  color: "#90959d",
  fontSize: "15px",
  fontWeight: 600,
  padding: "0 12px",
  boxSizing: "border-box",
};

const descriptionEditorStyle = {
  border: "1px solid #c5c6ca",
  borderRadius: "0px",
  overflow: "hidden",
  background: "#efeff1",
};

const descriptionToolbarStyle = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "7px 10px",
  borderBottom: "1px solid #c5c6ca",
  background: "#f0f0f2",
  flexWrap: "wrap",
};

const descriptionToneSelectStyle = {
  width: "124px",
};

const descriptionToolbarButtonsStyle = {
  display: "flex",
  alignItems: "center",
  gap: "5px",
  flexWrap: "wrap",
};

const toolbarIconButtonStyle = {
  width: "30px",
};

const descriptionBodyStyle = {
  position: "relative",
  background: "#efeff1",
};

const descriptionEditorContentStyle = {
  minHeight: "52px",
  padding: "9px 12px",
  fontSize: "14px",
  lineHeight: 1.55,
  color: "#3e444d",
  outline: "none",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const descriptionPlaceholderStyle = {
  position: "absolute",
  top: "12px",
  left: "16px",
  color: "#7b8087",
  fontSize: "14px",
  fontStyle: "italic",
  pointerEvents: "none",
};

const badgeRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "6px",
  fontSize: "14px",
  fontWeight: 600,
  color: "#2b3037",
};

const helperTextStyle = {
  marginTop: "6px",
  color: "#676c73",
  fontSize: "13px",
  lineHeight: 1.4,
};

const seoGenerateRowStyle = {
  marginTop: "10px",
  display: "flex",
  justifyContent: "flex-end",
};

const seoGenerateButtonStyle = {
  minWidth: "132px",
  height: "36px",
  borderRadius: "11px",
  border: "1px solid #4b4b4f",
  background: "linear-gradient(180deg, #3a3b3e 0%, #1f2022 100%)",
  color: "#f1f3f5",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
};

const chipWrapStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
  marginTop: "10px",
};

const modalRightActionsStyle = {
  marginTop: "12px",
  display: "grid",
  gap: "10px",
  borderTop: "none",
  paddingTop: "0",
};

const generateButtonStyle = {
  width: "100%",
  height: "36px",
  borderRadius: "11px",
  border: "1px solid #4b4b4f",
  background: "linear-gradient(180deg, #3a3b3e 0%, #1f2022 100%)",
  color: "#f1f3f5",
  fontSize: "15px",
  fontWeight: 700,
  cursor: "pointer",
};

const modalFooterRowStyle = {
  marginTop: "4px",
  display: "grid",
  gridTemplateColumns: "auto auto auto 1fr",
  gap: "6px",
  alignItems: "center",
};

const modalButtonIconStyle = {
  width: "34px",
  borderRadius: "10px",
  border: "1px solid #cfd0d4",
  background: "#f3f3f4",
};

const modalSideFieldStyle = {
  marginTop: "14px",
};

const modalMessageWrapStyle = {
  marginBottom: "10px",
};

const plainInputWrapStyle = {
  position: "relative",
};

const plainInputStyle = {
  width: "100%",
  height: "38px",
  border: "1px solid #a9adb3",
  borderRadius: "11px",
  background: "#f4f4f4",
  padding: "0 68px 0 12px",
  boxSizing: "border-box",
  color: "#3a3f45",
  fontSize: "14px",
  outline: "none",
};

const plainTextAreaWrapStyle = {
  position: "relative",
};

const plainTextAreaStyle = {
  width: "100%",
  minHeight: "112px",
  border: "1px solid #a9adb3",
  borderRadius: "11px",
  background: "#f4f4f4",
  padding: "8px 12px 30px",
  boxSizing: "border-box",
  color: "#3a3f45",
  fontSize: "14px",
  lineHeight: 1.5,
  resize: "vertical",
  outline: "none",
};

const inputCounterStyle = {
  position: "absolute",
  top: "50%",
  right: "12px",
  transform: "translateY(-50%)",
  color: "#626872",
  fontSize: "13px",
  fontWeight: 600,
  pointerEvents: "none",
};

const textAreaCounterStyle = {
  position: "absolute",
  right: "12px",
  bottom: "8px",
  color: "#626872",
  fontSize: "13px",
  fontWeight: 600,
  pointerEvents: "none",
};

const sideLabelStyle = {
  display: "block",
  marginBottom: "6px",
  color: "#3d434b",
  fontSize: "14px",
  fontWeight: 500,
};

const sideSelectStyle = {
  width: "100%",
  height: "40px",
  border: "1px solid #9fa2a8",
  borderRadius: "11px",
  background: "#ececef",
  color: "#343941",
  fontSize: "13px",
  padding: "0 12px",
  outline: "none",
};

const sideTextAreaStyle = {
  width: "100%",
  minHeight: "90px",
  border: "1px solid #9fa2a8",
  borderRadius: "11px",
  background: "#ececef",
  color: "#535961",
  fontSize: "14px",
  padding: "8px 12px",
  boxSizing: "border-box",
  resize: "vertical",
  outline: "none",
};

const keywordChipStyle = {
  border: "none",
  borderRadius: "6px",
  background: "#d8d8db",
  color: "#4d5259",
  fontSize: "13px",
  fontWeight: 600,
  padding: "5px 9px",
  cursor: "pointer",
};

const seoStatusPillStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  borderRadius: "999px",
  padding: "3px 11px",
  border: "1px solid",
  fontSize: "13px",
  fontWeight: 600,
};

const seoStatusDotStyle = {
  width: "9px",
  height: "9px",
  borderRadius: "999px",
  display: "inline-block",
};

const updateButtonStyle = {
  width: "100%",
  height: "36px",
  border: "1px solid #4b4b4f",
  borderRadius: "11px",
  background: "linear-gradient(180deg, #3a3b3e 0%, #1f2022 100%)",
  color: "#f1f3f5",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
};

const updateButtonDisabledStyle = {
  ...updateButtonStyle,
  border: "1px solid #c7c8cc",
  background: "#cdced2",
  color: "#f2f2f3",
  cursor: "not-allowed",
};

const editInitialState = {
  title: "",
  description: "",
  descriptionStyle: "Normal",
  seoTitle: "",
  seoDescription: "",
  language: "English",
  tone: "Neutral",
  length: "50 - 150 words",
  format: "Single paragraph",
  contextKeywords: "",
};

function escapeSearchValue(value) {
  return value.replace(/[\\"]/g, "\\$&");
}

function toSearchQuery(search) {
  if (!search) return "";
  const escapedSearch = escapeSearchValue(search);
  const titleQuery = escapedSearch.includes(" ") ? `"${escapedSearch}"` : escapedSearch;
  return `title:${titleQuery}`;
}

function evaluateDescription(description) {
  if (!description || !description.trim()) return { label: "Missing", tone: "critical" };
  const length = description.trim().length;
  if (length < 80) return { label: "Too short", tone: "warning" };
  return { label: "Good", tone: "success" };
}

function evaluateSeoTitle(title) {
  if (!title || !title.trim()) return { label: "Missing", tone: "critical" };
  const length = title.trim().length;
  if (length < 30) return { label: "Too short", tone: "warning" };
  if (length > 60) return { label: "Too long", tone: "warning" };
  return { label: "Good", tone: "success" };
}

function evaluateSeoDescription(description) {
  if (!description || !description.trim()) return { label: "Missing", tone: "critical" };
  const length = description.trim().length;
  if (length < 120) return { label: "Too short", tone: "warning" };
  if (length > 160) return { label: "Too long", tone: "warning" };
  return { label: "Good", tone: "success" };
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toCollectionTypeMeta(ruleSet) {
  if (ruleSet) return { label: "Smart", tone: "success" };
  return { label: "Manual", tone: "neutral" };
}

function toBadgeTone(tone) {
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "caution") return "caution";
  if (tone === "critical") return "critical";
  return "neutral";
}

function toSeoPalette(tone) {
  if (tone === "success") {
    return {
      background: "#d8f1df",
      border: "#b2e4be",
      text: "#1f7a39",
      dot: "#27a34a",
    };
  }

  if (tone === "warning" || tone === "caution") {
    return {
      background: "#f2cf92",
      border: "#e8bc74",
      text: "#7a4d10",
      dot: "#d48c1e",
    };
  }

  if (tone === "critical") {
    return {
      background: "#f4c8d2",
      border: "#eeb3c1",
      text: "#b13b53",
      dot: "#ef4f70",
    };
  }

  return {
    background: "#e5e7eb",
    border: "#cfd4db",
    text: "#48515f",
    dot: "#7b8494",
  };
}

function renderBadge({ label, tone }) {
  return <s-badge tone={toBadgeTone(tone)}>{label}</s-badge>;
}

function formatDate(dateValue) {
  if (!dateValue) return "-";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function readFormString(formData, key) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseLengthRange(lengthOption) {
  const match = /(\d+)\s*-\s*(\d+)/.exec(lengthOption || "");
  if (!match) return { min: 50, max: 150 };
  return {
    min: Number(match[1]),
    max: Number(match[2]),
  };
}

function cleanInlineText(value, maxLength) {
  return (value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value) {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toParagraphHtml(value) {
  const plainText = (value || "").trim();
  if (!plainText) return "";

  return plainText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function buildGenerationPrompt({
  title,
  descriptionText,
  seoTitle,
  seoDescription,
  language,
  tone,
  lengthOption,
  format,
  contextKeywords,
  intent,
}) {
  const { min, max } = parseLengthRange(lengthOption);
  const focus =
    intent === GENERATE_META_TITLE_INTENT
      ? "Primary focus: generate a strong meta title."
      : intent === GENERATE_META_DESCRIPTION_INTENT
        ? "Primary focus: generate a strong meta description."
        : "Primary focus: generate collection description, meta title, and meta description.";

  return [
    "Generate Shopify-ready content and return strict JSON only.",
    "",
    focus,
    `Language: ${language || "English"}`,
    `Tone: ${tone || "Neutral"}`,
    `Description word range: ${min}-${max}`,
    `Description format: ${format || "Single paragraph"}`,
    `Collection title: ${title || "Untitled collection"}`,
    `Current collection description: ${descriptionText || "Not available"}`,
    `Current meta title (SEO title): ${seoTitle || "Not available"}`,
    `Current meta description (SEO description): ${seoDescription || "Not available"}`,
    `Keywords/context: ${contextKeywords || "Not provided"}`,
    "",
    "Return only valid JSON with these keys:",
    '{ "collectionDescription": "...", "seoTitle": "...", "seoDescription": "..." }',
    "",
    "Rules:",
    "- No markdown, no code fences.",
    "- Meta title max 70 characters.",
    "- Meta description max 160 characters.",
    "- Collection description should be natural and conversion-focused.",
  ].join("\n");
}

async function generateContentWithOpenAI(input) {
  const apiKey = process.env.OPENAI_API_KEY;
  const configuredModel = process.env.OPENAI_MODEL || DEFAULT_AI_MODEL;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing. Please configure it in environment.");
  }

  const requestPayload = (model) => ({
    model,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an expert Shopify copywriter. Always return valid JSON with the requested keys.",
      },
      {
        role: "user",
        content: buildGenerationPrompt(input),
      },
    ],
  });

  async function sendChatRequest(model, attempt = 0) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestPayload(model)),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const result = {
      ok: response.ok,
      payload,
      model,
      status: response.status,
      retryAfterSeconds: Number.parseInt(response.headers.get("retry-after") || "", 10),
    };

    const details = getOpenAiErrorDetails(result);
    const shouldRetryRateLimit =
      !result.ok &&
      result.status === 429 &&
      attempt < 1 &&
      (OPENAI_RATE_LIMIT_ERROR_PATTERN.test(details.message) ||
        details.code === "rate_limit_exceeded");

    if (shouldRetryRateLimit) {
      const retryDelayMs =
        Number.isFinite(result.retryAfterSeconds) && result.retryAfterSeconds > 0
          ? result.retryAfterSeconds * 1000
          : OPENAI_RATE_LIMIT_RETRY_DELAY_MS;

      await new Promise((resolve) => setTimeout(resolve, Math.min(retryDelayMs, 30000)));
      return sendChatRequest(model, attempt + 1);
    }

    return result;
  }

  let result = await sendChatRequest(configuredModel);

  if (!result.ok) {
    const details = getOpenAiErrorDetails(result);
    const shouldFallback =
      configuredModel !== DEFAULT_AI_MODEL &&
      (OPENAI_MODEL_ACCESS_ERROR_PATTERN.test(details.message) ||
        OPENAI_QUOTA_ERROR_PATTERN.test(details.message) ||
        details.code === "insufficient_quota");

    if (shouldFallback) {
      result = await sendChatRequest(DEFAULT_AI_MODEL);
    }
  }

  if (!result.ok) {
    const details = getOpenAiErrorDetails(result);

    if (OPENAI_QUOTA_ERROR_PATTERN.test(details.message) || details.code === "insufficient_quota") {
      throw new Error(
        `${details.message} OpenAI project quota is exhausted. Add billing/credits in the same OpenAI project as this API key, or set AI_PROVIDER=ollama.`,
      );
    }

    if (
      OPENAI_RATE_LIMIT_ERROR_PATTERN.test(details.message) ||
      details.code === "rate_limit_exceeded"
    ) {
      throw new Error(
        `${details.message} OpenAI request limits are currently exhausted for this project. Wait and retry, or set AI_PROVIDER=ollama.`,
      );
    }

    throw new Error(details.message);
  }

  const rawContent = result.payload?.choices?.[0]?.message?.content;
  return parseGenerationContent(rawContent, result.payload?.model || result.model);
}

function getOpenAiErrorDetails(result) {
  const error = result?.payload?.error || {};
  const message =
    error?.message ||
    (result?.status ? `OpenAI request failed with status ${result.status}.` : "AI request failed.");

  return {
    message,
    code: String(error?.code || "").toLowerCase(),
  };
}

function shouldFallbackToOllamaFromOpenAiMessage(message) {
  return OPENAI_OLLAMA_FALLBACK_ERROR_PATTERN.test(message || "");
}

function canUseOllamaFallback() {
  const baseUrl = (process.env.OLLAMA_BASE_URL || "").trim();
  const enabledValue = (process.env.ENABLE_OLLAMA_FALLBACK || "").trim();

  return Boolean(baseUrl) && ENABLED_ENV_VALUE_PATTERN.test(enabledValue);
}

function parseGenerationContent(rawContent, modelName) {
  if (!rawContent || typeof rawContent !== "string") {
    throw new Error("AI response was empty.");
  }

  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("AI response format was invalid.");
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  return {
    collectionDescription: (
      parsed?.collectionDescription ||
      parsed?.productDescription ||
      parsed?.description ||
      ""
    ).trim(),
    seoTitle: cleanInlineText(parsed?.seoTitle || "", 70),
    seoDescription: cleanInlineText(parsed?.seoDescription || "", 160),
    aiModel: modelName || null,
  };
}

async function generateContentWithOllama(input) {
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;

  let response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0.7 },
        messages: [
          {
            role: "system",
            content:
              "You are an expert Shopify copywriter. Always return valid JSON with the requested keys.",
          },
          {
            role: "user",
            content: buildGenerationPrompt(input),
          },
        ],
      }),
    });
  } catch (error) {
    const causeCode = error?.cause?.code || "";
    const isConnectionRefused =
      causeCode === "ECONNREFUSED" || /ECONNREFUSED|fetch failed/i.test(error?.message || "");
    const isLocalhostBaseUrl = /127\.0\.0\.1|localhost/i.test(baseUrl);

    if (isConnectionRefused && isLocalhostBaseUrl) {
      throw new Error(
        `Cannot reach Ollama at ${baseUrl}. In deployed environments, localhost points to the server itself. Set AI_PROVIDER=openai, or set OLLAMA_BASE_URL to a reachable remote Ollama server.`,
      );
    }

    throw new Error(
      `Failed to connect to Ollama at ${baseUrl}. ${error?.message || "Unknown network error."}`,
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.error || `Ollama request failed with status ${response.status}.`,
    );
  }

  return parseGenerationContent(payload?.message?.content, payload?.model || model);
}

async function generateContent(input) {
  const provider = (process.env.AI_PROVIDER || "").trim().toLowerCase();

  if (provider === "ollama") {
    try {
      return await generateContentWithOllama(input);
    } catch (ollamaError) {
      if (!process.env.OPENAI_API_KEY) {
        throw ollamaError;
      }

      try {
        return await generateContentWithOpenAI(input);
      } catch (openAiError) {
        throw new Error(
          `${ollamaError?.message || "Ollama request failed."} OpenAI fallback failed: ${openAiError?.message || "Unknown error."}`,
        );
      }
    }
  }

  if (provider === "openai") {
    try {
      return await generateContentWithOpenAI(input);
    } catch (openAiError) {
      const message = openAiError?.message || "";
      const shouldFallback = shouldFallbackToOllamaFromOpenAiMessage(message);
      const shouldTryOllama = shouldFallback && canUseOllamaFallback();

      if (!shouldTryOllama) {
        throw openAiError;
      }

      try {
        return await generateContentWithOllama(input);
      } catch (ollamaError) {
        throw new Error(
          `${message} Local Ollama fallback failed: ${ollamaError?.message || "Unknown error."}`,
        );
      }
    }
  }

  try {
    return await generateContentWithOpenAI(input);
  } catch (openAiError) {
    const message = openAiError?.message || "";
    const shouldFallback = shouldFallbackToOllamaFromOpenAiMessage(message);
    const shouldTryOllama = shouldFallback && canUseOllamaFallback();

    if (!shouldTryOllama) {
      throw openAiError;
    }

    try {
      return await generateContentWithOllama(input);
    } catch (ollamaError) {
      throw new Error(
        `${message} Local Ollama fallback failed: ${ollamaError?.message || "Unknown error."}`,
      );
    }
  }
}

async function writeGenerationLog(data) {
  try {
    await db.generatedContentLog.create({ data });
  } catch (error) {
    console.error("Failed to store generated content log", error);
  }
}

async function upsertCollectionGeneratedContent({
  shop,
  collectionId,
  collectionTitle,
  language,
  tone,
  lengthOption,
  formatOption,
  contextKeywords,
  aiModel,
  descriptionHtml,
  seoTitle,
  seoDescription,
  appliedToCollection,
}) {
  try {
    await db.collectionGeneratedContent.upsert({
      where: {
        shop_collectionId: {
          shop,
          collectionId,
        },
      },
      create: {
        shop,
        collectionId,
        collectionTitle,
        language,
        tone,
        lengthOption,
        formatOption,
        contextKeywords,
        aiModel,
        descriptionHtml,
        seoTitle,
        seoDescription,
        appliedToCollection,
      },
      update: {
        collectionTitle,
        language,
        tone,
        lengthOption,
        formatOption,
        contextKeywords,
        aiModel,
        descriptionHtml,
        seoTitle,
        seoDescription,
        appliedToCollection,
      },
    });
  } catch (error) {
    console.error("Failed to upsert collection generated content", error);
  }
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = readFormString(formData, "intent");
  const collectionId = readFormString(formData, "collectionId");

  if (!collectionId) {
    return { ok: false, intent, error: "Collection id is required." };
  }

  const title = readFormString(formData, "title");
  const descriptionHtml = readFormString(formData, "description");
  const seoTitle = readFormString(formData, "seoTitle");
  const seoDescription = readFormString(formData, "seoDescription");
  const language = readFormString(formData, "language");
  const tone = readFormString(formData, "tone");
  const lengthOption = readFormString(formData, "length");
  const formatOption = readFormString(formData, "format");
  const contextKeywords = readFormString(formData, "contextKeywords");

  try {
    if (
      intent === GENERATE_ALL_INTENT ||
      intent === GENERATE_META_TITLE_INTENT ||
      intent === GENERATE_META_DESCRIPTION_INTENT
    ) {
      const generated = await generateContent({
        title,
        descriptionText: stripHtml(descriptionHtml),
        seoTitle,
        seoDescription,
        language,
        tone,
        lengthOption,
        format: formatOption,
        contextKeywords,
        intent,
      });

      let nextDescription = descriptionHtml;
      let nextSeoTitle = seoTitle;
      let nextSeoDescription = seoDescription;

      if (intent === GENERATE_ALL_INTENT && generated.collectionDescription) {
        nextDescription = toParagraphHtml(generated.collectionDescription);
      }
      if (
        (intent === GENERATE_ALL_INTENT || intent === GENERATE_META_TITLE_INTENT) &&
        generated.seoTitle
      ) {
        nextSeoTitle = generated.seoTitle;
      }
      if (
        (intent === GENERATE_ALL_INTENT || intent === GENERATE_META_DESCRIPTION_INTENT) &&
        generated.seoDescription
      ) {
        nextSeoDescription = generated.seoDescription;
      }

      await writeGenerationLog({
        shop: session.shop,
        productId: collectionId,
        productTitle: title || null,
        intent,
        language: language || null,
        tone: tone || null,
        lengthOption: lengthOption || null,
        formatOption: formatOption || null,
        contextKeywords: contextKeywords || null,
        aiModel: generated.aiModel || null,
        generatedDescription: nextDescription || null,
        generatedSeoTitle: nextSeoTitle || null,
        generatedSeoDescription: nextSeoDescription || null,
        appliedToProduct: false,
      });

      await upsertCollectionGeneratedContent({
        shop: session.shop,
        collectionId,
        collectionTitle: title || null,
        language: language || null,
        tone: tone || null,
        lengthOption: lengthOption || null,
        formatOption: formatOption || null,
        contextKeywords: contextKeywords || null,
        aiModel: generated.aiModel || null,
        descriptionHtml: nextDescription || null,
        seoTitle: nextSeoTitle || null,
        seoDescription: nextSeoDescription || null,
        appliedToCollection: false,
      });

      return {
        ok: true,
        intent,
        collectionId,
        message: "AI content generated successfully.",
        content: {
          description: nextDescription,
          seoTitle: nextSeoTitle,
          seoDescription: nextSeoDescription,
        },
      };
    }

    if (intent === UPDATE_COLLECTION_INTENT) {
      const updateInputPayload = {
        id: collectionId,
        descriptionHtml,
        seo: {
          title: seoTitle,
          description: seoDescription,
        },
      };

      const mutationAttempts = [
        {
          mutation: COLLECTION_UPDATE_MUTATION_INPUT,
          variables: { input: updateInputPayload },
        },
        {
          mutation: COLLECTION_UPDATE_MUTATION_FALLBACK,
          variables: { collection: updateInputPayload },
        },
      ];

      let updateJson = null;
      let lastGraphqlErrors = [];

      for (let attemptIndex = 0; attemptIndex < mutationAttempts.length; attemptIndex += 1) {
        const attempt = mutationAttempts[attemptIndex];
        const updateResponse = await admin.graphql(attempt.mutation, {
          variables: attempt.variables,
        });
        const candidate = await updateResponse.json();
        const graphqlErrors = candidate?.errors?.map((item) => item?.message).filter(Boolean) || [];

        if (graphqlErrors.length > 0) {
          lastGraphqlErrors = graphqlErrors;
          const schemaMismatch =
            /unknown type|unknown argument|cannot query field|is not defined|expected type/i.test(
              graphqlErrors.join(" "),
            );
          const isLastAttempt = attemptIndex === mutationAttempts.length - 1;
          if (!isLastAttempt && schemaMismatch) {
            continue;
          }

          return {
            ok: false,
            intent,
            collectionId,
            error: graphqlErrors.join(" "),
          };
        }

        updateJson = candidate;
        break;
      }

      if (!updateJson) {
        return {
          ok: false,
          intent,
          collectionId,
          error:
            lastGraphqlErrors.join(" ") ||
            "Unable to update collection due to GraphQL schema mismatch.",
        };
      }

      const userErrors = updateJson?.data?.collectionUpdate?.userErrors || [];
      if (userErrors.length > 0) {
        return {
          ok: false,
          intent,
          collectionId,
          error: userErrors.map((item) => item?.message).filter(Boolean).join(" "),
        };
      }

      const updatedCollection = updateJson?.data?.collectionUpdate?.collection;

      await writeGenerationLog({
        shop: session.shop,
        productId: collectionId,
        productTitle: title || null,
        intent,
        language: language || null,
        tone: tone || null,
        lengthOption: lengthOption || null,
        formatOption: formatOption || null,
        contextKeywords: contextKeywords || null,
        aiModel: null,
        generatedDescription: descriptionHtml || null,
        generatedSeoTitle: seoTitle || null,
        generatedSeoDescription: seoDescription || null,
        appliedToProduct: true,
      });

      await upsertCollectionGeneratedContent({
        shop: session.shop,
        collectionId,
        collectionTitle: title || null,
        language: language || null,
        tone: tone || null,
        lengthOption: lengthOption || null,
        formatOption: formatOption || null,
        contextKeywords: contextKeywords || null,
        aiModel: null,
        descriptionHtml: descriptionHtml || null,
        seoTitle: seoTitle || null,
        seoDescription: seoDescription || null,
        appliedToCollection: true,
      });

      return {
        ok: true,
        intent,
        collectionId,
        message: "Collection updated successfully in Shopify.",
        content: {
          description: updatedCollection?.descriptionHtml || descriptionHtml,
          seoTitle: updatedCollection?.seo?.title || seoTitle,
          seoDescription: updatedCollection?.seo?.description || seoDescription,
        },
      };
    }

    return { ok: false, intent, collectionId, error: "Unsupported action." };
  } catch (error) {
    console.error("Collection content action failed", error);
    return {
      ok: false,
      intent,
      collectionId,
      error: error?.message || "Failed to process request.",
    };
  }
};

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  const search = (url.searchParams.get("q") || "").trim();
  const searchForQuery = search.length >= 2 ? search : "";
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const isPreviousPage = Boolean(before && !after);

  const query = toSearchQuery(searchForQuery);

  const response = await admin.graphql(
    `#graphql
      query CollectionList(
        $first: Int
        $last: Int
        $after: String
        $before: String
        $query: String
      ) {
        collections(
          first: $first
          last: $last
          after: $after
          before: $before
          query: $query
          sortKey: TITLE
        ) {
          edges {
            node {
              id
              title
              handle
              descriptionHtml
              updatedAt
              seo {
                title
                description
              }
              image {
                url
                altText
              }
              productsCount {
                count
              }
              ruleSet {
                appliedDisjunctively
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
        }
      }
    `,
    {
      variables: {
        first: isPreviousPage ? undefined : PAGE_SIZE,
        last: isPreviousPage ? PAGE_SIZE : undefined,
        after: isPreviousPage ? undefined : after || undefined,
        before: isPreviousPage ? before : undefined,
        query: query || undefined,
      },
    },
  );

  const responseJson = await response.json();
  const collectionConnection = responseJson?.data?.collections;

  if (!collectionConnection) {
    console.error("Failed to fetch collections", responseJson?.errors);
    return {
      filters: { search },
      collections: [],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
    };
  }

  const collections = collectionConnection.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    descriptionHtml: node.descriptionHtml || "",
    descriptionText: stripHtml(node.descriptionHtml),
    descriptionStatus: evaluateDescription(stripHtml(node.descriptionHtml)),
    seoTitle: evaluateSeoTitle(node.seo?.title || node.title),
    seoDescription: evaluateSeoDescription(node.seo?.description),
    seoTitleValue: node.seo?.title || "",
    seoDescriptionValue: node.seo?.description || "",
    imageUrl: node.image?.url || null,
    imageAlt: node.image?.altText || node.title,
    collectionType: toCollectionTypeMeta(node.ruleSet),
    productsCount: node.productsCount?.count || 0,
    updatedAt: formatDate(node.updatedAt),
  }));

  return {
    filters: { search },
    collections,
    pageInfo: collectionConnection.pageInfo,
  };
};

export default function CollectionsPage() {
  const { filters, collections, pageInfo } = useLoaderData();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const generateFetcher = useFetcher();
  const updateFetcher = useFetcher();
  const editModalRef = useRef(null);
  const descriptionEditorRef = useRef(null);
  const [searchValue, setSearchValue] = useState(filters.search);
  const [fallbackCollections, setFallbackCollections] = useState(collections);
  const [editingCollection, setEditingCollection] = useState(null);
  const [editForm, setEditForm] = useState(editInitialState);
  const [modalMessage, setModalMessage] = useState(null);

  useEffect(() => {
    setSearchValue(filters.search);
  }, [filters.search]);

  useEffect(() => {
    if (!filters.search || collections.length > 0) {
      setFallbackCollections(collections);
    }
  }, [filters.search, collections]);

  const isLoading = navigation.state !== "idle";
  const isSearchLoading =
    isLoading &&
    searchValue.trim().toLowerCase() !== (filters.search || "").trim().toLowerCase();
  const normalizedSearch = searchValue.trim().toLowerCase();
  const sourceCollections = collections.length > 0 ? collections : fallbackCollections;

  const filteredCollections = useMemo(() => {
    if (!normalizedSearch) return collections;
    return sourceCollections.filter((collection) =>
      collection.title.toLowerCase().includes(normalizedSearch),
    );
  }, [normalizedSearch, collections, sourceCollections]);

  const makeUrl = useCallback(
    ({ search = searchValue.trim(), before, after } = {}) => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (before) params.set("before", before);
      if (after) params.set("after", after);
      const query = params.toString();
      return query ? `?${query}` : "";
    },
    [searchValue],
  );

  useEffect(() => {
    const nextSearch = searchValue.trim();
    if (nextSearch === filters.search) return;

    const timeoutId = setTimeout(() => {
      navigate(makeUrl({ search: nextSearch }), { replace: true });
    }, 180);

    return () => clearTimeout(timeoutId);
  }, [filters.search, makeUrl, navigate, searchValue]);

  const handleSearchInput = useCallback((event) => {
    setSearchValue(event.currentTarget.value || "");
  }, []);

  const resetEditModalState = useCallback(() => {
    setEditingCollection(null);
    setEditForm(editInitialState);
    setModalMessage(null);
  }, []);

  const openEditModal = useCallback((collection) => {
    setEditingCollection(collection);
    setModalMessage(null);
    setEditForm({
      ...editInitialState,
      title: collection.title || "",
      description: collection.descriptionHtml || collection.descriptionText || "",
      seoTitle: collection.seoTitleValue || "",
      seoDescription: collection.seoDescriptionValue || "",
    });
    requestAnimationFrame(() => {
      editModalRef.current?.showOverlay?.();
    });
  }, []);

  const updateEditField = useCallback((field, value) => {
    setEditForm((current) => ({ ...current, [field]: value }));
  }, []);

  const appendKeywordChip = useCallback((chip) => {
    setEditForm((current) => {
      const currentValue = current.contextKeywords.trim();
      const nextValue = currentValue ? `${currentValue} ${chip}` : chip;
      return { ...current, contextKeywords: nextValue };
    });
  }, []);

  const applyDescriptionCommand = useCallback(
    (command, value) => {
      const editor = descriptionEditorRef.current;
      if (!editor || typeof document === "undefined") return;

      editor.focus();
      document.execCommand(command, false, value);
      updateEditField("description", editor.innerHTML || "");
    },
    [updateEditField],
  );

  const handleDescriptionStyleChange = useCallback(
    (event) => {
      const styleValue = event.currentTarget.value || "Normal";
      updateEditField("descriptionStyle", styleValue);

      if (styleValue === "Heading") {
        applyDescriptionCommand("formatBlock", "H2");
        return;
      }

      if (styleValue === "Subheading") {
        applyDescriptionCommand("formatBlock", "H3");
        return;
      }

      applyDescriptionCommand("formatBlock", "P");
    },
    [applyDescriptionCommand, updateEditField],
  );

  const handleDescriptionLink = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = window.prompt("Enter link URL");
    if (!url) return;
    applyDescriptionCommand("createLink", url);
  }, [applyDescriptionCommand]);

  const submitEditAction = useCallback(
    (intent) => {
      if (!editingCollection?.id) return;

      setModalMessage(null);
      const payload = {
        intent,
        collectionId: editingCollection.id,
        title: editForm.title,
        description: editForm.description,
        seoTitle: editForm.seoTitle,
        seoDescription: editForm.seoDescription,
        language: editForm.language,
        tone: editForm.tone,
        length: editForm.length,
        format: editForm.format,
        contextKeywords: editForm.contextKeywords,
      };

      if (intent === UPDATE_COLLECTION_INTENT) {
        updateFetcher.submit(payload, { method: "post" });
        return;
      }

      generateFetcher.submit(payload, { method: "post" });
    },
    [editForm, editingCollection, generateFetcher, updateFetcher],
  );

  const handleGenerateMetaTitle = useCallback(
    () => submitEditAction(GENERATE_META_TITLE_INTENT),
    [submitEditAction],
  );

  const handleGenerateMetaDescription = useCallback(
    () => submitEditAction(GENERATE_META_DESCRIPTION_INTENT),
    [submitEditAction],
  );

  const handleGenerate = useCallback(
    () => submitEditAction(GENERATE_ALL_INTENT),
    [submitEditAction],
  );

  const handleUpdateCollection = useCallback(
    () => submitEditAction(UPDATE_COLLECTION_INTENT),
    [submitEditAction],
  );

  const isGenerating = generateFetcher.state !== "idle";
  const isUpdating = updateFetcher.state !== "idle";
  const canUpdateCollection = Boolean(editingCollection?.id) && !isGenerating && !isUpdating;

  useEffect(() => {
    const response = generateFetcher.data;
    if (!response || response.collectionId !== editingCollection?.id) return;

    if (!response.ok) {
      setModalMessage({
        tone: "critical",
        text: response.error || "AI generation failed.",
      });
      return;
    }

    setEditForm((current) => ({
      ...current,
      description: response.content?.description ?? current.description,
      seoTitle: response.content?.seoTitle ?? current.seoTitle,
      seoDescription: response.content?.seoDescription ?? current.seoDescription,
    }));

    setModalMessage({
      tone: "success",
      text: response.message || "AI content generated successfully.",
    });
  }, [editingCollection?.id, generateFetcher.data]);

  useEffect(() => {
    const response = updateFetcher.data;
    if (!response || response.collectionId !== editingCollection?.id) return;

    if (!response.ok) {
      setModalMessage({
        tone: "critical",
        text: response.error || "Collection update failed.",
      });
      return;
    }

    setEditForm((current) => ({
      ...current,
      description: response.content?.description ?? current.description,
      seoTitle: response.content?.seoTitle ?? current.seoTitle,
      seoDescription: response.content?.seoDescription ?? current.seoDescription,
    }));

    setModalMessage({
      tone: "success",
      text: response.message || "Collection updated successfully.",
    });
    revalidator.revalidate();
  }, [editingCollection?.id, revalidator, updateFetcher.data]);

  const metaTitleStatus = evaluateSeoTitle(editForm.seoTitle);
  const metaDescriptionStatus = evaluateSeoDescription(editForm.seoDescription);
  const isDescriptionEmpty = !stripHtml(editForm.description).trim();
  const metaTitlePalette = toSeoPalette(metaTitleStatus.tone);
  const metaDescriptionPalette = toSeoPalette(metaDescriptionStatus.tone);
  const metaTitleLength = editForm.seoTitle.length;
  const metaDescriptionLength = editForm.seoDescription.length;

  useEffect(() => {
    const editor = descriptionEditorRef.current;
    if (!editor) return;

    const nextHtml = editForm.description || "";
    if (editor.innerHTML !== nextHtml) {
      editor.innerHTML = nextHtml;
    }
  }, [editForm.description]);

  const previousUrl =
    pageInfo.hasPreviousPage && pageInfo.startCursor
      ? makeUrl({ search: filters.search, before: pageInfo.startCursor })
      : null;
  const nextUrl =
    pageInfo.hasNextPage && pageInfo.endCursor
      ? makeUrl({ search: filters.search, after: pageInfo.endCursor })
      : null;

  return (
    <s-page heading="Collections">
      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-link href="/app">&larr; Back</s-link>
          <s-button onClick={() => navigate(makeUrl({}))}>Refresh</s-button>
          <s-button disabled>Upgrade for Bulk Generation</s-button>
        </s-stack>
      </s-section>

      <s-section>
        <div style={searchWrapStyle}>
          <div style={searchFieldStyle}>
            <s-text-field
              name="q"
              label="Search by collection title..."
              value={searchValue}
              onInput={handleSearchInput}
              onChange={handleSearchInput}
            />
          </div>
        </div>
      </s-section>

      <s-section>
        <s-box>
          <div style={tablePanelStyle}>
            <div style={tableShellStyle}>
              <div style={tableViewportStyle}>
                <s-table variant="auto" loading={isSearchLoading} style={tableElementStyle}>
                  <s-table-header-row>
                    <s-table-header>
                      <input type="checkbox" style={checkboxStyle} />
                    </s-table-header>
                    <s-table-header>Image</s-table-header>
                    <s-table-header>Title</s-table-header>
                    <s-table-header>SEO Title</s-table-header>
                    <s-table-header>SEO Description</s-table-header>
                    <s-table-header>Actions</s-table-header>
                  </s-table-header-row>

                  <s-table-body>
                    {filteredCollections.length === 0 ? (
                      <s-table-row>
                        <s-table-cell>
                          <div style={cellContentStyle} />
                        </s-table-cell>
                        <s-table-cell>
                          <div style={cellContentStyle} />
                        </s-table-cell>
                        <s-table-cell>
                          <div style={cellContentStyle}>
                            <span style={emptyStateStyle}>No collections found.</span>
                          </div>
                        </s-table-cell>
                        <s-table-cell>
                          <div style={cellContentStyle} />
                        </s-table-cell>
                        <s-table-cell>
                          <div style={cellContentStyle} />
                        </s-table-cell>
                        <s-table-cell>
                          <div style={cellContentStyle} />
                        </s-table-cell>
                      </s-table-row>
                    ) : (
                      filteredCollections.map((collection) => (
                        <s-table-row key={collection.id}>
                          <s-table-cell>
                            <div style={cellContentStyle}>
                              <input type="checkbox" style={checkboxStyle} />
                            </div>
                          </s-table-cell>

                          <s-table-cell>
                            <div style={cellContentStyle}>
                              {collection.imageUrl ? (
                                <img
                                  src={collection.imageUrl}
                                  alt={collection.imageAlt}
                                  width={52}
                                  height={52}
                                  style={imageStyle}
                                />
                              ) : (
                                <div style={imageFallbackStyle}>No image</div>
                              )}
                            </div>
                          </s-table-cell>

                          <s-table-cell>
                            <div style={cellContentStyle}>
                              <span style={titleTextStyle}>{collection.title}</span>
                            </div>
                          </s-table-cell>

                          <s-table-cell>
                            <div style={cellContentStyle}>{renderBadge(collection.seoTitle)}</div>
                          </s-table-cell>

                          <s-table-cell>
                            <div style={cellContentStyle}>{renderBadge(collection.seoDescription)}</div>
                          </s-table-cell>

                          <s-table-cell>
                            <div style={cellContentStyle}>
                              <s-button onClick={() => openEditModal(collection)}>Edit Content</s-button>
                            </div>
                          </s-table-cell>
                        </s-table-row>
                      ))
                    )}
                  </s-table-body>
                </s-table>
              </div>
            </div>
          </div>

          <div style={paginationWrapStyle}>
            <s-text>
              {filteredCollections.length} results{" "}
              {isSearchLoading ? "(Searching...)" : isLoading ? "(Loading...)" : ""}
            </s-text>
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button
                disabled={!previousUrl}
                onClick={() => previousUrl && navigate(previousUrl)}
              >
                Previous
              </s-button>
              <s-button disabled={!nextUrl} onClick={() => nextUrl && navigate(nextUrl)}>
                Next
              </s-button>
            </s-stack>
          </div>
        </s-box>
      </s-section>

      <s-modal
        id={EDIT_MODAL_ID}
        ref={editModalRef}
        size="large"
        heading="Edit Collection Content"
        onHide={resetEditModalState}
        onAfterHide={resetEditModalState}
      >
        <div style={modalBodyStyle}>
          {!editingCollection ? (
            <s-banner tone="info">
              Select a collection and click <strong>Edit Content</strong> to open editor.
            </s-banner>
          ) : (
            <s-box style={modalShellStyle}>
              {modalMessage ? (
                <div style={modalMessageWrapStyle}>
                  <s-banner tone={modalMessage.tone}>{modalMessage.text}</s-banner>
                </div>
              ) : null}

              <div style={modalGridStyle}>
                <s-box style={modalMainCardStyle}>
                  <label htmlFor="edit-collection-title" style={fieldLabelStyle}>
                    Collection Title
                  </label>
                  <input
                    id="edit-collection-title"
                    type="text"
                    value={editForm.title}
                    readOnly
                    style={collectionTitleInputStyle}
                    onInput={(event) => updateEditField("title", event.currentTarget.value || "")}
                  />

                  <div style={modalSectionSpacingStyle}>
                    <div style={descriptionHeadingStyle}>Description</div>
                    <div style={descriptionEditorStyle}>
                      <div style={descriptionToolbarStyle}>
                        <div style={descriptionToneSelectStyle}>
                          <s-select
                            label="Description style"
                            labelAccessibilityVisibility="exclusive"
                            value={editForm.descriptionStyle}
                            onInput={handleDescriptionStyleChange}
                          >
                            {DESCRIPTION_STYLE_OPTIONS.map((styleOption) => (
                              <s-option key={styleOption} value={styleOption}>
                                {styleOption}
                              </s-option>
                            ))}
                          </s-select>
                        </div>

                        <div style={descriptionToolbarButtonsStyle}>
                          <s-button
                            icon="text-bold"
                            accessibilityLabel="Bold"
                            style={toolbarIconButtonStyle}
                            onClick={() => applyDescriptionCommand("bold")}
                          />
                          <s-button
                            icon="text-italic"
                            accessibilityLabel="Italic"
                            style={toolbarIconButtonStyle}
                            onClick={() => applyDescriptionCommand("italic")}
                          />
                          <s-button
                            icon="text-underline"
                            accessibilityLabel="Underline"
                            style={toolbarIconButtonStyle}
                            onClick={() => applyDescriptionCommand("underline")}
                          />
                          <s-button
                            icon="text-grammar"
                            accessibilityLabel="Strikethrough"
                            style={toolbarIconButtonStyle}
                            onClick={() => applyDescriptionCommand("strikeThrough")}
                          />
                          <s-button
                            icon="link"
                            accessibilityLabel="Link"
                            style={toolbarIconButtonStyle}
                            onClick={handleDescriptionLink}
                          />
                          <s-button
                            icon="list-bulleted"
                            accessibilityLabel="Bullet list"
                            style={toolbarIconButtonStyle}
                            onClick={() => applyDescriptionCommand("insertUnorderedList")}
                          />
                          <s-button
                            icon="list-numbered"
                            accessibilityLabel="Numbered list"
                            style={toolbarIconButtonStyle}
                            onClick={() => applyDescriptionCommand("insertOrderedList")}
                          />
                          <s-button
                            icon="text-font"
                            accessibilityLabel="Clear formatting"
                            style={toolbarIconButtonStyle}
                            onClick={() => applyDescriptionCommand("removeFormat")}
                          />
                        </div>
                      </div>

                      <div style={descriptionBodyStyle}>
                        {isDescriptionEmpty ? (
                          <span style={descriptionPlaceholderStyle}>
                            Enter collection description...
                          </span>
                        ) : null}
                        <div
                          ref={descriptionEditorRef}
                          contentEditable
                          suppressContentEditableWarning
                          style={descriptionEditorContentStyle}
                          role="textbox"
                          aria-label="Description body"
                          onInput={(event) =>
                            updateEditField("description", event.currentTarget.innerHTML || "")
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div style={descriptionToSeoSpacerStyle} />

                  <div style={modalSectionSpacingStyle}>
                    <div style={badgeRowStyle}>
                      <span>SEO Title</span>
                      <span
                        style={{
                          ...seoStatusPillStyle,
                          background: metaTitlePalette.background,
                          borderColor: metaTitlePalette.border,
                          color: metaTitlePalette.text,
                        }}
                      >
                        <span
                          style={{
                            ...seoStatusDotStyle,
                            background: metaTitlePalette.dot,
                          }}
                        />
                        {metaTitleStatus.label}
                      </span>
                    </div>
                    <div style={plainInputWrapStyle}>
                      <input
                        type="text"
                        value={editForm.seoTitle}
                        maxLength={70}
                        placeholder="Enter SEO title..."
                        style={plainInputStyle}
                        onInput={(event) =>
                          updateEditField("seoTitle", event.currentTarget.value || "")
                        }
                      />
                      <span style={inputCounterStyle}>{metaTitleLength}/70</span>
                    </div>
                    <div style={helperTextStyle}>
                      Optimal SEO Title length: 40 to 70 characters. (Too short: less than
                      40, Too long: more than 70)
                    </div>
                    <div style={seoGenerateRowStyle}>
                      <button
                        type="button"
                        style={seoGenerateButtonStyle}
                        disabled={isGenerating || isUpdating}
                        onClick={handleGenerateMetaTitle}
                      >
                        {isGenerating ? "Generating..." : "Generate"}
                      </button>
                    </div>
                  </div>

                  <div style={modalSectionSpacingStyle}>
                    <s-divider />
                  </div>

                  <div style={modalSectionSpacingStyle}>
                    <div style={badgeRowStyle}>
                      <span>SEO Description</span>
                      <span
                        style={{
                          ...seoStatusPillStyle,
                          background: metaDescriptionPalette.background,
                          borderColor: metaDescriptionPalette.border,
                          color: metaDescriptionPalette.text,
                        }}
                      >
                        <span
                          style={{
                            ...seoStatusDotStyle,
                            background: metaDescriptionPalette.dot,
                          }}
                        />
                        {metaDescriptionStatus.label}
                      </span>
                    </div>
                    <div style={plainTextAreaWrapStyle}>
                      <textarea
                        rows={4}
                        maxLength={160}
                        value={editForm.seoDescription}
                        placeholder="Enter SEO description..."
                        style={plainTextAreaStyle}
                        onInput={(event) =>
                          updateEditField("seoDescription", event.currentTarget.value || "")
                        }
                      />
                      <span style={textAreaCounterStyle}>{metaDescriptionLength}/160</span>
                    </div>
                    <div style={helperTextStyle}>
                      Optimal SEO Description length: 140 to 160 characters. (Too short: less
                      than 140, Too long: more than 160)
                    </div>
                    <div style={seoGenerateRowStyle}>
                      <button
                        type="button"
                        style={seoGenerateButtonStyle}
                        disabled={isGenerating || isUpdating}
                        onClick={handleGenerateMetaDescription}
                      >
                        {isGenerating ? "Generating..." : "Generate"}
                      </button>
                    </div>
                  </div>
                </s-box>

                <s-box style={modalSideCardStyle}>
                  <label htmlFor="edit-language" style={sideLabelStyle}>
                    Language
                  </label>
                  <select
                    id="edit-language"
                    value={editForm.language}
                    style={sideSelectStyle}
                    onChange={(event) => updateEditField("language", event.currentTarget.value || "")}
                  >
                    {LANGUAGE_OPTIONS.map((language) => (
                      <option key={language} value={language}>
                        {language}
                      </option>
                    ))}
                  </select>

                  <div style={modalSideFieldStyle}>
                    <label htmlFor="edit-tone" style={sideLabelStyle}>
                      Tone
                    </label>
                    <select
                      id="edit-tone"
                      value={editForm.tone}
                      style={sideSelectStyle}
                      onChange={(event) => updateEditField("tone", event.currentTarget.value || "")}
                    >
                      {TONE_OPTIONS.map((toneOption) => (
                        <option key={toneOption} value={toneOption}>
                          {toneOption}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={modalSideFieldStyle}>
                    <label htmlFor="edit-length" style={sideLabelStyle}>
                      Length (Words)
                    </label>
                    <select
                      id="edit-length"
                      value={editForm.length}
                      style={sideSelectStyle}
                      onChange={(event) => updateEditField("length", event.currentTarget.value || "")}
                    >
                      {LENGTH_OPTIONS.map((lengthOption) => (
                        <option key={lengthOption} value={lengthOption}>
                          {lengthOption}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={modalSideFieldStyle}>
                    <label htmlFor="edit-format" style={sideLabelStyle}>
                      Description Format
                    </label>
                    <select
                      id="edit-format"
                      value={editForm.format}
                      style={sideSelectStyle}
                      onChange={(event) => updateEditField("format", event.currentTarget.value || "")}
                    >
                      {FORMAT_OPTIONS.map((formatOption) => (
                        <option key={formatOption} value={formatOption}>
                          {formatOption}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={modalSideFieldStyle}>
                    <label htmlFor="edit-context-keywords" style={sideLabelStyle}>
                      AI Context & Keywords
                    </label>
                    <textarea
                      id="edit-context-keywords"
                      rows={5}
                      value={editForm.contextKeywords}
                      placeholder="List collection features or keywords"
                      style={sideTextAreaStyle}
                      onInput={(event) =>
                        updateEditField("contextKeywords", event.currentTarget.value || "")
                      }
                    />

                    <div style={chipWrapStyle}>
                      {KEYWORD_CHIPS.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          style={keywordChipStyle}
                          onClick={() => appendKeywordChip(chip)}
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={modalRightActionsStyle}>
                    <button
                      type="button"
                      style={generateButtonStyle}
                      disabled={isGenerating || isUpdating}
                      onClick={handleGenerate}
                    >
                      {isGenerating ? "Generating..." : "Generate"}
                    </button>

                    <div style={modalFooterRowStyle}>
                      <s-button
                        icon="view"
                        accessibilityLabel="Preview"
                        style={modalButtonIconStyle}
                      />
                      <s-button
                        icon="undo"
                        accessibilityLabel="Undo"
                        style={modalButtonIconStyle}
                      />
                      <s-button
                        icon="x-circle"
                        accessibilityLabel="Close modal"
                        command="--hide"
                        commandFor={EDIT_MODAL_ID}
                        style={modalButtonIconStyle}
                        onClick={resetEditModalState}
                      />
                      <button
                        type="button"
                        disabled={!canUpdateCollection}
                        style={canUpdateCollection ? updateButtonStyle : updateButtonDisabledStyle}
                        onClick={handleUpdateCollection}
                      >
                        {isUpdating ? "Updating..." : "Update Collection"}
                      </button>
                    </div>
                  </div>
                </s-box>
              </div>
            </s-box>
          )}
        </div>
      </s-modal>
    </s-page>
  );
}
