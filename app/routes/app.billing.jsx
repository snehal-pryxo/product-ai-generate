import { Link, redirect, useLoaderData } from "react-router";
import { Banner, BlockStack, Box, Button, Card, InlineStack, Page, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import {
  activateExtraCreditPurchase,
  activateSubscription,
} from "../lib/billing.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const type = String(url.searchParams.get("type") || "");

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

  const pricingUrl = new URL("/app/pricing", url.origin);
  pricingUrl.searchParams.set("success", String(Boolean(result.success)));
  pricingUrl.searchParams.set("message", result.message || "");
  throw redirect(pricingUrl.pathname + pricingUrl.search);
};

export default function BillingReturnPage() {
  const data = useLoaderData();

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
            <Link to="/app/pricing">
              <Button variant="primary">Back to pricing</Button>
            </Link>
          </InlineStack>
        </Card>
        <Box paddingBlockEnd="800" />
      </BlockStack>
    </Page>
  );
}
