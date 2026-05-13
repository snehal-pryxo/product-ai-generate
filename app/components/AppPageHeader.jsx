import { useLocation, useNavigate, useRouteLoaderData } from "react-router";
import { BlockStack, Button, Card, InlineStack, Text } from "@shopify/polaris";

export function AppPageHeader({ title, description, ownerName, ownerLabel = "Owner" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const appLoaderData = useRouteLoaderData("routes/app");
  const credits = Number(appLoaderData?.credits ?? 150);
  const formattedCredits = credits.toLocaleString("en-US");

  return (
    <div style={{ marginBottom: "20px" }}>
      <Card>
        <InlineStack align="space-between" blockAlign="center" wrap>
          <BlockStack gap="100">
            {ownerName ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {ownerLabel}: {ownerName}
              </Text>
            ) : null}
            {title ? (
              <Text as="h2" variant="headingLg">
                {title}
              </Text>
            ) : null}
            <Text as="p" variant="bodyMd" tone="subdued">
              {description}
            </Text>
          </BlockStack>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="headingSm" tone="subdued">
              Available credits: {formattedCredits}
            </Text>
            <Button
              onClick={() => navigate({ pathname: "/app/pricing", search: location.search })}
              variant="secondary"
            >
              Upgrade
            </Button>
          </InlineStack>
        </InlineStack>
      </Card>
    </div>
  );
}
