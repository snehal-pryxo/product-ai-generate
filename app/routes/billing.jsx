import { redirect } from "react-router";
import { unauthenticated } from "../shopify.server";
import {
  activateExtraCreditPurchase,
  activateSubscription,
} from "../lib/billing.server";

const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "content-ai-seo-generator";

function buildBillingRedirect(sourceUrl, result) {
  const shop = sourceUrl.searchParams.get("shop") || "";
  const host = sourceUrl.searchParams.get("host") || "";

  let adminBase = "";
  if (host) {
    try {
      adminBase = `https://${Buffer.from(host, "base64").toString("utf8")}`;
    } catch {
      // fall through to subdomain fallback
    }
  }
  if (!adminBase && shop) {
    const subdomain = shop.replace(/\.myshopify\.com$/, "");
    adminBase = `https://admin.shopify.com/store/${subdomain}`;
  }

  // On success → app home (dashboard); on failure → app pricing page
  const appPath = result.success ? "/" : "/pricing";
  const redirectUrl = new URL(`${adminBase}/apps/${APP_HANDLE}${appPath}`);
  redirectUrl.searchParams.set("success", String(Boolean(result.success)));
  redirectUrl.searchParams.set("message", result.message || "");

  return redirectUrl.toString();
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shopParam = String(url.searchParams.get("shop") || "").trim();
  const isValidShopDomain = /^[a-z0-9-]+\.myshopify\.com$/.test(shopParam);

  if (!shopParam || !isValidShopDomain) {
    throw redirect("/app/pricing");
  }

  const { admin, session } = await unauthenticated.admin(shopParam);

  const type =
    String(url.searchParams.get("type") || "") ||
    (url.searchParams.get("plan") ? "subscription" : "") ||
    (url.searchParams.get("package") ? "credits" : "");

  let result = { success: false, message: "Unknown billing return type." };
  try {
    if (type === "subscription") {
      result = await activateSubscription({
        admin,
        shop: session.shop,
        planKey: String(url.searchParams.get("plan") || ""),
      });
    } else if (type === "credits") {
      result = await activateExtraCreditPurchase({
        admin,
        shop: session.shop,
        packageKey: String(url.searchParams.get("package") || ""),
      });
    }
  } catch (err) {
    console.error("[billing] Billing activation error:", err);
    result = {
      success: false,
      message: err?.message || "Billing activation failed. Please contact support.",
    };
  }

  throw redirect(buildBillingRedirect(url, result));
};

export default function BillingReturnPage() {
  // The loader always redirects; this component is only shown in edge-case errors.
  return null;
}
