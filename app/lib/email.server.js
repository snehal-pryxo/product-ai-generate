import nodemailer from "nodemailer";
import {
  installOwnerTemplate,
  installWelcomeTemplate,
  uninstallOwnerTemplate,
  uninstallFarewellTemplate,
} from "./emailTemplates.js";

const APP_NAME = "Product AI Generate";
const PLACEHOLDER_VALUES = new Set([
  "your-email@gmail.com",
  "your-app-password",
]);

function isPlaceholder(value) {
  return PLACEHOLDER_VALUES.has(String(value || "").trim().toLowerCase());
}

function getEmailConfigError() {
  const requiredValues = [
    process.env.SMTP_HOST,
    process.env.SMTP_USER,
    process.env.SMTP_PASS,
  ];

  if (requiredValues.some((value) => !String(value || "").trim())) {
    return "SMTP not configured";
  }

  if (
    isPlaceholder(process.env.SMTP_USER) ||
    isPlaceholder(process.env.SMTP_PASS) ||
    isPlaceholder(process.env.APP_OWNER_EMAIL)
  ) {
    return "SMTP placeholder credentials are still configured";
  }

  return null;
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true", // true for port 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendMail({ to, subject, html }) {
  const configError = getEmailConfigError();
  if (configError) {
    console.warn(`[email] ${configError} - skipping email to:`, to);
    return;
  }

  try {
    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: `"${APP_NAME}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`[email] Sent "${subject}" to ${to} — ${info.messageId}`);
  } catch (err) {
    console.error(`[email] Failed to send "${subject}" to ${to}:`, err.message);
  }
}

/**
 * Fetch shop info (name, owner name, email) from Shopify REST API.
 * Returns null on failure — callers should handle gracefully.
 */
export async function fetchShopInfo(shopDomain, accessToken) {
  try {
    const res = await fetch(
      `https://${shopDomain}/admin/api/2026-04/shop.json`,
      { headers: { "X-Shopify-Access-Token": accessToken } }
    );
    if (!res.ok) return null;
    const { shop } = await res.json();
    return {
      name: shop.name,
      ownerName: shop.shop_owner,
      email: shop.email,          // store owner email
      contactEmail: shop.customer_email,
    };
  } catch {
    return null;
  }
}

// ─── Install emails ────────────────────────────────────────────────────────

export async function sendInstallEmails({ shopDomain, shopName, ownerName, ownerEmail }) {
  const now = new Date().toLocaleString("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "UTC",
  }) + " UTC";

  const ownerNotifyEmail = process.env.APP_OWNER_EMAIL;

  await Promise.all([
    // 1. Notify app owner
    ownerNotifyEmail &&
      sendMail({
        to: ownerNotifyEmail,
        subject: `🎉 New Install — ${shopDomain}`,
        html: installOwnerTemplate({ shopDomain, shopName, ownerEmail, installedAt: now }),
      }),

    // 2. Welcome store owner
    ownerEmail &&
      sendMail({
        to: ownerEmail,
        subject: `Welcome to ${APP_NAME}! Your store is ready 🚀`,
        html: installWelcomeTemplate({ shopName, ownerName }),
      }),
  ]);
}

// ─── Uninstall emails ──────────────────────────────────────────────────────

export async function sendUninstallEmails({ shopDomain, shopName, ownerName, ownerEmail }) {
  const now = new Date().toLocaleString("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "UTC",
  }) + " UTC";

  const ownerNotifyEmail = process.env.APP_OWNER_EMAIL;

  await Promise.all([
    // 1. Notify app owner
    ownerNotifyEmail &&
      sendMail({
        to: ownerNotifyEmail,
        subject: `App Uninstalled — ${shopDomain}`,
        html: uninstallOwnerTemplate({ shopDomain, shopName, ownerEmail, uninstalledAt: now }),
      }),

    // 2. Farewell to store owner
    ownerEmail &&
      sendMail({
        to: ownerEmail,
        subject: `Sorry to see you go — ${APP_NAME}`,
        html: uninstallFarewellTemplate({ shopName, ownerName }),
      }),
  ]);
}
