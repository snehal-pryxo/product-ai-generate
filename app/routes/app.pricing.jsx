import { Form, redirect, useActionData, useLoaderData, useNavigation, useRouteLoaderData } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { AppPageHeader } from "../components/AppPageHeader";
import {
  BILLING_CURRENCY,
  getExtraCreditPackages,
  getExtraCreditPackage,
  getSubscriptionPlans,
  getSubscriptionPlan,
} from "../lib/billingPlans";
import {
  createExtraCreditPurchase,
  createRecurringSubscription,
} from "../lib/billing.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: {
      credits: true,
      billingPlanKey: true,
      billingPlanName: true,
      billingSubscriptionStatus: true,
    },
  });

  const url = new URL(request.url);
  return {
    credits: shopData?.credits ?? 100,
    currentPlanKey: shopData?.billingPlanKey || "free",
    currentPlanName: shopData?.billingPlanName || "Free",
    billingSubscriptionStatus: shopData?.billingSubscriptionStatus || null,
    billingMessage: url.searchParams.get("message") || "",
    billingSuccess: url.searchParams.get("success") || "",
    subscriptionPlans: getSubscriptionPlans(process.env),
    extraCreditPackages: getExtraCreditPackages(process.env),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (intent === "subscribe") {
      const planKey = String(formData.get("planKey") || "");
      const plan = getSubscriptionPlan(planKey, process.env);
      if (!plan || plan.price <= 0) {
        return { success: false, message: "Please select a paid subscription plan." };
      }

      const confirmationUrl = await createRecurringSubscription({
        admin,
        request,
        shop: session.shop,
        plan,
      });

      if (!confirmationUrl) {
        return { success: false, message: "Shopify did not return a billing approval URL." };
      }
      return redirect(confirmationUrl);
    }

    if (intent === "buy_credits") {
      const packageKey = String(formData.get("packageKey") || "");
      const creditPackage = getExtraCreditPackage(packageKey, process.env);
      if (!creditPackage) {
        return { success: false, message: "Please select a valid extra credit package." };
      }

      const confirmationUrl = await createExtraCreditPurchase({
        admin,
        request,
        shop: session.shop,
        creditPackage,
      });

      if (!confirmationUrl) {
        return { success: false, message: "Shopify did not return a credit approval URL." };
      }
      return redirect(confirmationUrl);
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Billing request failed.",
    };
  }

  return { success: false, message: "Unknown billing action." };
};

function formatPrice(price) {
  if (Number(price) === 0) return "Free";
  return `$${Number(price).toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(Number(price)) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCredits(credits) {
  return Number(credits || 0).toLocaleString("en-US");
}

export default function PricingPage() {
  const {
    currentPlanKey,
    currentPlanName,
    billingSubscriptionStatus,
    billingMessage,
    billingSuccess,
    subscriptionPlans,
    extraCreditPackages,
  } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const appData = useRouteLoaderData("routes/app");
  const isSubmitting = navigation.state === "submitting";
  const activeFormData = navigation.formData;
  const activePlanKey = String(activeFormData?.get("planKey") || "");
  const activePackageKey = String(activeFormData?.get("packageKey") || "");
  const bannerMessage = actionData?.message || billingMessage;
  const bannerSuccess =
    typeof actionData?.success === "boolean"
      ? actionData.success
      : billingSuccess === "true"
        ? true
        : billingSuccess === "false"
          ? false
          : null;

  return (
    <Page title="Pricing" fullWidth>
      <BlockStack gap="500">
        <AppPageHeader
          title="Pricing"
          description="Choose a monthly plan or add one-time credits to your existing balance."
        />

        {bannerMessage ? (
          <Banner tone={bannerSuccess ? "success" : "critical"}>
            <p>{bannerMessage}</p>
          </Banner>
        ) : null}

        <Card>
          <InlineStack align="space-between" blockAlign="center" gap="300">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Current balance
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Credits are consumed when AI content is generated. Manual edits and saves are free.
              </Text>
            </BlockStack>
            <InlineStack gap="200" blockAlign="center">
              <Badge tone="info">{currentPlanName}</Badge>
              {billingSubscriptionStatus ? <Badge>{billingSubscriptionStatus}</Badge> : null}
              <Text as="span" variant="headingLg">
                {formatCredits(appData?.credits)} credits
              </Text>
            </InlineStack>
          </InlineStack>
        </Card>

        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="end">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Monthly plans
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Recurring billing is processed by Shopify every 30 days in {BILLING_CURRENCY}.
              </Text>
            </BlockStack>
          </InlineStack>

          <Grid columns={{ xs: 1, sm: 1, md: 2, lg: 3, xl: 5 }}>
            {subscriptionPlans.map((plan) => {
              const isCurrent = plan.key === currentPlanKey;
              const isFree = plan.price <= 0;
              const loading = isSubmitting && activePlanKey === plan.key;
              return (
                <Grid.Cell key={plan.key}>
                  <Card>
                    <BlockStack gap="350">
                      <InlineStack align="space-between" blockAlign="start" gap="200">
                        <BlockStack gap="100">
                          <Text as="h3" variant="headingMd">
                            {plan.name}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {plan.description}
                          </Text>
                        </BlockStack>
                        {plan.popular ? <Badge tone="success">Popular</Badge> : null}
                      </InlineStack>

                      <BlockStack gap="100">
                        <Text as="p" variant="heading2xl">
                          {formatPrice(plan.price)}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {isFree ? "Included after install" : "per month"}
                        </Text>
                      </BlockStack>

                      <Divider />

                      <BlockStack gap="150">
                        <Text as="p" variant="headingSm">
                          {formatCredits(plan.credits)} credits
                        </Text>
                        {plan.features.map((feature) => (
                          <Text key={feature} as="p" variant="bodySm">
                            {feature}
                          </Text>
                        ))}
                      </BlockStack>

                      <Box paddingBlockStart="200">
                        {isFree ? (
                          <Button fullWidth disabled={isCurrent}>
                            {isCurrent ? "Current plan" : "Free plan"}
                          </Button>
                        ) : (
                          <Form method="post">
                            <input type="hidden" name="intent" value="subscribe" />
                            <input type="hidden" name="planKey" value={plan.key} />
                            <Button
                              fullWidth
                              submit
                              variant={plan.popular ? "primary" : "secondary"}
                              loading={loading}
                              disabled={isSubmitting || isCurrent}
                            >
                              {isCurrent ? "Current plan" : `Choose ${plan.name}`}
                            </Button>
                          </Form>
                        )}
                      </Box>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              );
            })}
          </Grid>
        </BlockStack>

        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Extra credits
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              One-time credit packs are added to your balance after Shopify approves the purchase.
            </Text>
          </BlockStack>

          <Grid columns={{ xs: 1, sm: 1, md: 3, lg: 3, xl: 3 }}>
            {extraCreditPackages.map((creditPackage) => {
              const loading = isSubmitting && activePackageKey === creditPackage.key;
              return (
                <Grid.Cell key={creditPackage.key}>
                  <Card>
                    <BlockStack gap="300">
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingMd">
                          {formatCredits(creditPackage.credits)} credits
                        </Text>
                        <Text as="p" variant="headingLg">
                          {formatPrice(creditPackage.price)}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          One-time purchase
                        </Text>
                      </BlockStack>
                      <Form method="post">
                        <input type="hidden" name="intent" value="buy_credits" />
                        <input type="hidden" name="packageKey" value={creditPackage.key} />
                        <Button fullWidth submit loading={loading} disabled={isSubmitting}>
                          Buy credits
                        </Button>
                      </Form>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              );
            })}
          </Grid>
        </BlockStack>

        <Box paddingBlockEnd="800" />
      </BlockStack>
    </Page>
  );
}
