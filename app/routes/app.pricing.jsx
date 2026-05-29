import { useEffect } from "react";
import { Form, useActionData, useLoaderData, useNavigation, useRouteLoaderData } from "react-router";
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
  getBillingTestMode,
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
    credits: shopData?.credits ?? 150,
    currentPlanKey: shopData?.billingPlanKey || "free",
    currentPlanName: shopData?.billingPlanName || "Free",
    billingSubscriptionStatus: shopData?.billingSubscriptionStatus || null,
    billingMessage: url.searchParams.get("message") || "",
    billingSuccess: url.searchParams.get("success") || "",
    subscriptionPlans: getSubscriptionPlans(process.env),
    extraCreditPackages: getExtraCreditPackages(process.env),
    billingTestMode: getBillingTestMode(),
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
      return { success: true, confirmationUrl };
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
      return { success: true, confirmationUrl };
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
    billingTestMode,
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

  useEffect(() => {
    if (!actionData?.confirmationUrl) return;
    window.open(actionData.confirmationUrl, "_top");
  }, [actionData?.confirmationUrl]);

  return (
    <Page title="Pricing" fullWidth>
      <BlockStack gap="500">
        <AppPageHeader
          title="Pricing"
          description="Choose a monthly plan or top up with one-time credits. Credits renew every 30 days on paid plans."
        />

        {bannerMessage ? (
          <Banner tone={bannerSuccess ? "success" : "critical"}>
            <p>{bannerMessage}</p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" gap="300">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Current balance
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Credits reset every 30 days on paid plans. Manual edits and saves never cost credits.
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
          </BlockStack>
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
            {billingTestMode ? <Badge tone="attention">Test mode</Badge> : null}
          </InlineStack>

          <Grid columns={{ xs: 1, sm: 1, md: 2, lg: 3, xl: 5 }}>
            {subscriptionPlans.map((plan) => {
              const isCurrent = plan.key === currentPlanKey;
              const isFree = plan.price <= 0;
              const loading = isSubmitting && activePlanKey === plan.key;
              return (
                <Grid.Cell key={plan.key}>
                  <div className="pricing-plan-card">
                    <Card>
                      <div className="pricing-plan-card__inner">
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
                        <InlineStack gap="100">
                          {billingTestMode && !isFree ? <Badge tone="attention">Test</Badge> : null}
                          {plan.popular ? <Badge tone="success">Popular</Badge> : null}
                        </InlineStack>
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
                        <BlockStack gap="0">
                          <Text as="p" variant="headingSm">
                            {formatCredits(plan.credits)} credits{!isFree ? " / month" : ""}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            ≈ {formatCredits(Math.floor(plan.credits / 3))} full product generations
                          </Text>
                        </BlockStack>
                        {plan.features.slice(1).map((feature) => (
                          <Text key={feature} as="p" variant="bodySm">
                            • {feature}
                          </Text>
                        ))}
                      </BlockStack>

                        </BlockStack>

                        <div className="pricing-plan-card__action">
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
                        </div>
                      </div>
                    </Card>
                  </div>
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
            {billingTestMode ? (
              <InlineStack>
                <Badge tone="attention">Test mode</Badge>
              </InlineStack>
            ) : null}
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
                          ≈ {formatCredits(Math.floor(creditPackage.credits / 3))} product generations · One-time
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
      <style>{`
        .pricing-plan-card,
        .pricing-plan-card > .Polaris-ShadowBevel {
          height: 100%;
        }

        .pricing-plan-card__inner {
          min-height: 330px;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .pricing-plan-card__action {
          margin-top: auto;
          padding-top: 16px;
        }

        .pricing-plan-card__action form {
          margin: 0;
        }
      `}</style>
    </Page>
  );
}
