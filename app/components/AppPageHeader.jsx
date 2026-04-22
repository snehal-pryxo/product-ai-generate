import { useNavigate, useRouteLoaderData } from "react-router";
import { BlockStack, Button, Card, InlineStack, Text } from "@shopify/polaris";

export function AppPageHeader({ title, description }) {
  const navigate = useNavigate();
  const appLoaderData = useRouteLoaderData("routes/app");
  const credits = Number(appLoaderData?.credits ?? 100);

  return (
    <div style={{ marginBottom: "20px" }}>
      <Card>
        <InlineStack align="space-between" blockAlign="center" wrap>
          <BlockStack gap="100">
            <Text as="h2" variant="headingLg">
              {title}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              {description}
            </Text>
          </BlockStack>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="headingSm" tone="subdued">
              {credits} credits.
            </Text>
            <Button onClick={() => navigate("/app/analytics")} variant="secondary">
              Upgrade
            </Button>
          </InlineStack>
        </InlineStack>
      </Card>
    </div>
  );
}

