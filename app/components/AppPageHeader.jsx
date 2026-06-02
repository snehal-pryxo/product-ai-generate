import { useLocation, useNavigate, useRouteLoaderData } from "react-router";
import { BlockStack, Button, Card, InlineStack, Text } from "@shopify/polaris";
import { openAddCreditModal } from "./AddCreditModal";

export function AppPageHeader({ title, description }) {
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
            <Button onClick={openAddCreditModal}>
              Add Credit
            </Button>
            <button
              onClick={() => navigate({ pathname: "/app/pricing", search: location.search })}
              style={{
                background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "8px 18px",
                fontWeight: 700,
                fontSize: "13px",
                cursor: "pointer",
                letterSpacing: "0.3px",
                boxShadow: "0 2px 8px rgba(99,102,241,0.4)",
              }}
            >
              ⚡ Upgrade
            </button>
          </InlineStack>
        </InlineStack>
      </Card>
    </div>
  );
}
