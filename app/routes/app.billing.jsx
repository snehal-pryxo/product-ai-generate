import { Link, redirect, useLoaderData, useLocation } from "react-router";
import { Banner, BlockStack, Box, Button, Card, InlineStack, Page, Text } from "@shopify/polaris";
import { authenticate, unauthenticated } from "../shopify.server";
import {
  activateExtraCreditPurchase,
  activateSubscription,
} from "../lib/billing.server";

const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "content-ai-seo-generator";

function buildBillingRedirect(sourceUrl, result) {
  const shop = sourceUrl.searchParams.get("shop") || "";
  const host = sourceUrl.searchParams.get("host") || "";

  // Decode the base64 `host` param to get the Shopify admin base URL
  // host = base64("admin.shopify.com/store/{subdomain}")
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

  // On success → app home; on failure → app pricing page
  const appPath = result.success ? "" : "/pricing";
  const redirectUrl = new URL(`${adminBase}/apps/${APP_HANDLE}${appPath}`);
  redirectUrl.searchParams.set("success", String(Boolean(result.success)));
  redirectUrl.searchParams.set("message", result.message || "");

  return redirectUrl.toString();
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shopParam = String(url.searchParams.get("shop") || "").trim();
  const isValidShopDomain = /^[a-z0-9-]+\.myshopify\.com$/.test(shopParam);
  const authContext =
    shopParam && isValidShopDomain
      ? await unauthenticated.admin(shopParam)
      : await authenticate.admin(request);
  const { admin, session } = authContext;
  const type =
    String(url.searchParams.get("type") || "") ||
    (url.searchParams.get("plan") ? "subscription" : "") ||
    (url.searchParams.get("package") ? "credits" : "");

  let result = { success: false, message: "Unknown billing return type." };
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

  throw redirect(buildBillingRedirect(url, result));
};

export default function BillingReturnPage() {
  const data = useLoaderData();
  const location = useLocation();

  return (
    <Page title="Billing">
      <BlockStack gap="400">
        <Banner tone={data?.success ? "success" : "critical"}>
          <p>{data?.message || "Billing return processed."}</p>
        </Banner>
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Billing status
              </Text>
              <Text as="p" tone="subdued">
                Return to pricing to review your plan and credit balance.
              </Text>
            </BlockStack>
            <Link to={{ pathname: "/app/pricing", search: location.search }}>
              <Button variant="primary">Back to pricing</Button>
            </Link>
          </InlineStack>
        </Card>
        <Box paddingBlockEnd="800" />
      </BlockStack>
    </Page>
  );
}
