import { Link, redirect, useLoaderData, useLocation } from "react-router";
import { Banner, BlockStack, Box, Button, Card, InlineStack, Page, Text } from "@shopify/polaris";
import { authenticate, unauthenticated } from "../shopify.server";
import {
  activateExtraCreditPurchase,
  activateSubscription,
} from "../lib/billing.server";

function buildEmbeddedHost(shop) {
  if (!shop) return "";
  return Buffer.from(`${shop}/admin`).toString("base64");
}

function buildPricingRedirect(sourceUrl, result) {
  const pricingUrl = new URL("/app/pricing", sourceUrl.origin);
  pricingUrl.searchParams.set("success", String(Boolean(result.success)));
  pricingUrl.searchParams.set("message", result.message || "");

  const shop = sourceUrl.searchParams.get("shop");
  const host = sourceUrl.searchParams.get("host") || buildEmbeddedHost(shop);
  if (shop) pricingUrl.searchParams.set("shop", shop);
  if (host) pricingUrl.searchParams.set("host", host);
  pricingUrl.searchParams.set("embedded", sourceUrl.searchParams.get("embedded") || "1");

  return pricingUrl.pathname + pricingUrl.search;
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

  throw redirect(buildPricingRedirect(url, result));
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
