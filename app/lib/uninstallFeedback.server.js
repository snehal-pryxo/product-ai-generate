import { randomBytes } from "node:crypto";
import db from "../db.server";

const TOKEN_BYTES = 32;
const REUSE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_FEEDBACK_LENGTH = 5000;

function generateFeedbackToken() {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

function getAppBaseUrl() {
  return String(process.env.SHOPIFY_APP_URL || process.env.APP_URL || "").trim().replace(/\/+$/, "");
}

export function buildUninstallFeedbackUrl(token) {
  const appBaseUrl = getAppBaseUrl();
  if (!appBaseUrl || !token) return "";
  return `${appBaseUrl}/uninstall-feedback/${encodeURIComponent(token)}`;
}

export async function createOrReuseUninstallFeedback({
  shop,
  ownerName,
  email,
  contactEmail,
  uninstalledAt = new Date(),
}) {
  const latest = await db.uninstallfeedback.findFirst({
    where: {
      shop,
      feedbackSubmittedAt: null,
    },
    orderBy: { uninstalledAt: "desc" },
  });

  if (
    latest?.feedbackToken &&
    latest.uninstalledAt &&
    uninstalledAt.getTime() - new Date(latest.uninstalledAt).getTime() < REUSE_WINDOW_MS
  ) {
    return latest;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.uninstallfeedback.create({
        data: {
          shop,
          ownerName: ownerName || null,
          email: email || null,
          contactEmail: contactEmail || null,
          feedbackToken: generateFeedbackToken(),
          uninstalledAt,
        },
      });
    } catch (error) {
      if (!/Unique constraint failed|duplicate/i.test(String(error?.message || "")) || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Failed to create uninstall feedback token.");
}

export async function getUninstallFeedbackByToken(token) {
  const feedbackToken = String(token || "").trim();
  if (!feedbackToken) return null;

  return db.uninstallfeedback.findUnique({
    where: { feedbackToken },
    select: {
      id: true,
      shop: true,
      ownerName: true,
      feedbackText: true,
      feedbackSubmittedAt: true,
      uninstalledAt: true,
    },
  });
}

export async function submitUninstallFeedback({ token, feedbackText }) {
  const feedbackToken = String(token || "").trim();
  const trimmedText = String(feedbackText || "").trim();

  if (!feedbackToken) {
    return { success: false, error: "Invalid feedback link." };
  }

  if (!trimmedText) {
    return { success: false, error: "Please enter your feedback before submitting." };
  }

  if (trimmedText.length > MAX_FEEDBACK_LENGTH) {
    return {
      success: false,
      error: `Feedback is too long. Please keep it under ${MAX_FEEDBACK_LENGTH.toLocaleString("en-US")} characters.`,
    };
  }

  const record = await db.uninstallfeedback.findUnique({
    where: { feedbackToken },
    select: { id: true },
  });

  if (!record) {
    return { success: false, error: "This feedback link is invalid or expired." };
  }

  await db.uninstallfeedback.update({
    where: { feedbackToken },
    data: {
      feedbackText: trimmedText,
      feedbackSubmittedAt: new Date(),
    },
  });

  return { success: true };
}
