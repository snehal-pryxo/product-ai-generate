/**
 * Email HTML Templates for Product AI Generate
 * Uses inline CSS for maximum email client compatibility.
 */

const BASE_COLOR = "#4F46E5"; // indigo-600
const LIGHT_BG = "#F5F5FF";
const DARK_TEXT = "#1e1b4b";
const MUTED_TEXT = "#6b7280";
const APP_NAME = "Product AI Generate";
const APP_URL = process.env.SHOPIFY_APP_URL || "https://product-ai-generate.vercel.app";

function baseLayout({ title, previewText, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif;">
  <!-- preheader -->
  <span style="display:none;max-height:0;overflow:hidden;">${previewText}</span>

  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:${BASE_COLOR};padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">${APP_NAME}</h1>
              <p style="margin:6px 0 0;color:#c7d2fe;font-size:13px;">AI-Powered Product Content Generator</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${LIGHT_BG};padding:24px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:${MUTED_TEXT};font-size:12px;">
                &copy; ${new Date().getFullYear()} ${APP_NAME} &bull;
                <a href="${APP_URL}" style="color:${BASE_COLOR};text-decoration:none;">Visit App</a>
              </p>
              <p style="margin:6px 0 0;color:#9ca3af;font-size:11px;">
                This is an automated notification. Please do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Install: to app owner ─────────────────────────────────────────────────

export function installOwnerTemplate({ shopDomain, shopName, ownerEmail, installedAt }) {
  const body = `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <h2 style="margin:0 0 8px;color:${DARK_TEXT};font-size:20px;">🎉 New Installation</h2>
          <p style="margin:0 0 24px;color:${MUTED_TEXT};font-size:14px;">A new store just installed <strong>${APP_NAME}</strong>.</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${LIGHT_BG};border-radius:8px;padding:20px;margin-bottom:24px;">
            <tr>
              <td style="padding:8px 0;">
                <span style="color:${MUTED_TEXT};font-size:13px;display:block;">Store Domain</span>
                <strong style="color:${DARK_TEXT};font-size:15px;">${shopDomain}</strong>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-top:1px solid #e5e7eb;">
                <span style="color:${MUTED_TEXT};font-size:13px;display:block;">Store Name</span>
                <strong style="color:${DARK_TEXT};font-size:15px;">${shopName || "—"}</strong>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-top:1px solid #e5e7eb;">
                <span style="color:${MUTED_TEXT};font-size:13px;display:block;">Owner Email</span>
                <strong style="color:${DARK_TEXT};font-size:15px;">${ownerEmail || "—"}</strong>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-top:1px solid #e5e7eb;">
                <span style="color:${MUTED_TEXT};font-size:13px;display:block;">Installed At</span>
                <strong style="color:${DARK_TEXT};font-size:15px;">${installedAt}</strong>
              </td>
            </tr>
          </table>

          <p style="margin:0;color:${MUTED_TEXT};font-size:13px;">You can track all installations in your app dashboard.</p>
        </td>
      </tr>
    </table>`;

  return baseLayout({
    title: `New Installation — ${shopDomain}`,
    previewText: `${shopDomain} just installed ${APP_NAME}`,
    body,
  });
}

// ─── Install: to store owner (welcome) ────────────────────────────────────

export function installWelcomeTemplate({ shopName, ownerName }) {
  const body = `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <h2 style="margin:0 0 8px;color:${DARK_TEXT};font-size:20px;">Welcome${ownerName ? ", " + ownerName : ""}! 👋</h2>
          <p style="margin:0 0 24px;color:${MUTED_TEXT};font-size:14px;">
            Thanks for installing <strong>${APP_NAME}</strong> on <strong>${shopName || "your store"}</strong>.
            You're all set to generate AI-powered product content in seconds.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr>
              <td style="padding:12px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0 8px 8px 0;margin-bottom:12px;">
                <strong style="color:#15803d;font-size:14px;">✓ AI Product Descriptions</strong>
                <p style="margin:4px 0 0;color:#166534;font-size:13px;">Generate compelling descriptions for any product instantly.</p>
              </td>
            </tr>
            <tr><td style="height:10px;"></td></tr>
            <tr>
              <td style="padding:12px;background:#eff6ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;">
                <strong style="color:#1d4ed8;font-size:14px;">✓ SEO Titles &amp; Meta Descriptions</strong>
                <p style="margin:4px 0 0;color:#1e40af;font-size:13px;">Optimize your store's search ranking automatically.</p>
              </td>
            </tr>
            <tr><td style="height:10px;"></td></tr>
            <tr>
              <td style="padding:12px;background:#fdf4ff;border-left:4px solid #a855f7;border-radius:0 8px 8px 0;">
                <strong style="color:#7e22ce;font-size:14px;">✓ Collections, Pages &amp; Blog</strong>
                <p style="margin:4px 0 0;color:#6b21a8;font-size:13px;">Generate content for your entire store, not just products.</p>
              </td>
            </tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center">
                <a href="${APP_URL}" style="display:inline-block;background:${BASE_COLOR};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;">
                  Open the App →
                </a>
              </td>
            </tr>
          </table>

          <p style="margin:28px 0 0;color:${MUTED_TEXT};font-size:13px;text-align:center;">
            Need help? Reply to this email or visit our support page.
          </p>
        </td>
      </tr>
    </table>`;

  return baseLayout({
    title: `Welcome to ${APP_NAME}`,
    previewText: `You're all set! Start generating AI content for your store.`,
    body,
  });
}

// ─── Uninstall: to app owner ───────────────────────────────────────────────

export function uninstallOwnerTemplate({ shopDomain, shopName, ownerEmail, uninstalledAt }) {
  const body = `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <h2 style="margin:0 0 8px;color:${DARK_TEXT};font-size:20px;">App Uninstalled</h2>
          <p style="margin:0 0 24px;color:${MUTED_TEXT};font-size:14px;">A store has uninstalled <strong>${APP_NAME}</strong>.</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border-radius:8px;padding:20px;margin-bottom:24px;border:1px solid #fecaca;">
            <tr>
              <td style="padding:8px 0;">
                <span style="color:${MUTED_TEXT};font-size:13px;display:block;">Store Domain</span>
                <strong style="color:${DARK_TEXT};font-size:15px;">${shopDomain}</strong>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-top:1px solid #fecaca;">
                <span style="color:${MUTED_TEXT};font-size:13px;display:block;">Store Name</span>
                <strong style="color:${DARK_TEXT};font-size:15px;">${shopName || "—"}</strong>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-top:1px solid #fecaca;">
                <span style="color:${MUTED_TEXT};font-size:13px;display:block;">Owner Email</span>
                <strong style="color:${DARK_TEXT};font-size:15px;">${ownerEmail || "—"}</strong>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-top:1px solid #fecaca;">
                <span style="color:${MUTED_TEXT};font-size:13px;display:block;">Uninstalled At</span>
                <strong style="color:${DARK_TEXT};font-size:15px;">${uninstalledAt}</strong>
              </td>
            </tr>
          </table>

          <p style="margin:0;color:${MUTED_TEXT};font-size:13px;">Consider reaching out to understand why they left and whether you can win them back.</p>
        </td>
      </tr>
    </table>`;

  return baseLayout({
    title: `App Uninstalled — ${shopDomain}`,
    previewText: `${shopDomain} uninstalled ${APP_NAME}`,
    body,
  });
}

// ─── Uninstall: to store owner (farewell) ─────────────────────────────────

export function uninstallFarewellTemplate({ shopName, ownerName, feedbackUrl }) {
  const feedbackButton = feedbackUrl
    ? `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td align="center">
                <a href="${feedbackUrl}" style="display:inline-block;background:#111827;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:8px;">
                  Share Feedback
                </a>
              </td>
            </tr>
          </table>`
    : "";

  const body = `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <h2 style="margin:0 0 8px;color:${DARK_TEXT};font-size:20px;">Sorry to see you go 👋</h2>
          <p style="margin:0 0 20px;color:${MUTED_TEXT};font-size:14px;">
            Hi${ownerName ? " " + ownerName : ""},<br/><br/>
            We noticed that <strong>${APP_NAME}</strong> has been removed from
            <strong>${shopName || "your store"}</strong>.
            We're sorry to see you go!
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${LIGHT_BG};border-radius:8px;padding:20px;margin-bottom:24px;">
            <tr>
              <td>
                <p style="margin:0 0 8px;color:${DARK_TEXT};font-size:14px;font-weight:600;">We'd love to hear your feedback</p>
                <p style="margin:0;color:${MUTED_TEXT};font-size:13px;">
                  Was there something that didn't work for you? A missing feature? We read every reply and use your feedback to improve.
                </p>
              </td>
            </tr>
          </table>

          ${feedbackButton}

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td align="center">
                <a href="${APP_URL}" style="display:inline-block;background:${BASE_COLOR};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:8px;">
                  Reinstall the App
                </a>
              </td>
            </tr>
          </table>

          <p style="margin:0;color:${MUTED_TEXT};font-size:13px;text-align:center;">
            Your store data will be kept for 48 hours. After that it will be permanently deleted per our privacy policy.
          </p>
        </td>
      </tr>
    </table>`;

  return baseLayout({
    title: `Sorry to see you go — ${APP_NAME}`,
    previewText: `We noticed you uninstalled ${APP_NAME}. We'd love your feedback.`,
    body,
  });
}
