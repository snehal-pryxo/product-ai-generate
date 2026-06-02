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
  YEARLY_DISCOUNT_MONTHS,
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
  const allPlans = getSubscriptionPlans(process.env);
  const freePlan = allPlans.find((p) => p.price <= 0);
  const featuredPlan = allPlans.find((p) => p.popular) || allPlans.find((p) => p.price > 0) || allPlans[1];

  return {
    credits: shopData?.credits ?? 150,
    currentPlanKey: shopData?.billingPlanKey || "free",
    currentPlanName: shopData?.billingPlanName || "Free",
    billingSubscriptionStatus: shopData?.billingSubscriptionStatus || null,
    billingMessage: url.searchParams.get("message") || "",
    billingSuccess: url.searchParams.get("success") || "",
    freePlan,
    featuredPlan,
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
      const interval = String(formData.get("interval") || "monthly");
      const plan = getSubscriptionPlan(planKey, process.env);
      if (!plan || plan.price <= 0) {
        return { success: false, message: "Please select a paid subscription plan." };
      }
      const confirmationUrl = await createRecurringSubscription({
        admin, request, shop: session.shop, plan, interval,
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
        admin, request, shop: session.shop, creditPackage,
      });
      if (!confirmationUrl) {
        return { success: false, message: "Shopify did not return a credit approval URL." };
      }
      return { success: true, confirmationUrl };
    }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Billing request failed." };
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

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
      <circle cx="10" cy="10" r="10" fill="#008060" />
      <path d="M6 10.5l3 3 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function PricingPage() {
  const {
    currentPlanKey,
    currentPlanName,
    billingSubscriptionStatus,
    billingMessage,
    billingSuccess,
    freePlan,
    featuredPlan,
    extraCreditPackages,
    billingTestMode,
  } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const appData = useRouteLoaderData("routes/app");
  const isSubmitting = navigation.state === "submitting";
  const activeFormData = navigation.formData;
  const activePlanInterval = String(activeFormData?.get("interval") || "");
  const activePackageKey = String(activeFormData?.get("packageKey") || "");

  const bannerMessage = actionData?.message || billingMessage;
  const bannerSuccess =
    typeof actionData?.success === "boolean"
      ? actionData.success
      : billingSuccess === "true" ? true : billingSuccess === "false" ? false : null;

  const isMonthlyCurrentPlan = currentPlanKey === featuredPlan.key;
  const yearlyPrice = featuredPlan.yearlyPrice || featuredPlan.price * 10;
  const yearlyPerMonth = yearlyPrice / 12;
  const yearlySavings = featuredPlan.price * 12 - yearlyPrice;

  useEffect(() => {
    if (!actionData?.confirmationUrl) return;
    window.open(actionData.confirmationUrl, "_top");
  }, [actionData?.confirmationUrl]);

  return (
    <Page title="Pricing" fullWidth>
      <BlockStack gap="600">
        <AppPageHeader
          title="Pricing"
          description="Choose monthly or yearly billing. Credits renew every 30 days on paid plans."
        />

        {bannerMessage ? (
          <Banner tone={bannerSuccess ? "success" : "critical"}>
            <p>{bannerMessage}</p>
          </Banner>
        ) : null}

        {/* Current balance */}
        <Card>
          <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Current balance</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Credits reset every 30 days on paid plans. Manual edits never cost credits.
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

        {/* Free + Monthly + Yearly plan cards */}
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">Plans</Text>
            {billingTestMode ? <Badge tone="attention">Test mode</Badge> : null}
          </InlineStack>

          <Grid columns={{ xs: 1, sm: 1, md: 3, lg: 3, xl: 3 }}>

            {/* ── Free plan ── */}
            <Grid.Cell>
              <div className="pricing-plan-card">
                <Card>
                  <div className="pricing-plan-card__inner">
                    <BlockStack gap="300">

                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="050">
                          <Text as="h3" variant="headingLg">{freePlan?.name || "Free"}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">No credit card required</Text>
                        </BlockStack>
                        {currentPlanKey === "free" && <Badge tone="success">Current</Badge>}
                      </InlineStack>

                      <BlockStack gap="050">
                        <Text as="p" variant="heading2xl">Free</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Included after install · Always free</Text>
                      </BlockStack>

                      <Divider />

                      <BlockStack gap="200">
                        <InlineStack gap="150" blockAlign="start" wrap={false}>
                          <CheckIcon />
                          <Text as="p" variant="bodySm">
                            <strong>{formatCredits(freePlan?.credits || 150)} credits</strong> included
                          </Text>
                        </InlineStack>
                        {(freePlan?.features || []).slice(1).map((f) => (
                          <InlineStack key={f} gap="150" blockAlign="start" wrap={false}>
                            <CheckIcon />
                            <Text as="p" variant="bodySm">{f}</Text>
                          </InlineStack>
                        ))}
                      </BlockStack>

                    </BlockStack>

                    <div className="pricing-plan-card__action">
                      <Button fullWidth disabled={currentPlanKey === "free"}>
                        {currentPlanKey === "free" ? "Current plan" : "Get started free"}
                      </Button>
                    </div>
                  </div>
                </Card>
              </div>
            </Grid.Cell>

            {/* ── Monthly plan ── */}
            <Grid.Cell>
              <div className="pricing-plan-card">
                <Card>
                  <div className="pricing-plan-card__inner">
                    <BlockStack gap="300">

                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="050">
                          <Text as="h3" variant="headingLg">{featuredPlan.name}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">Monthly billing</Text>
                        </BlockStack>
                        <Badge tone="info">Monthly</Badge>
                      </InlineStack>

                      <BlockStack gap="050">
                        <InlineStack gap="100" blockAlign="end">
                          <Text as="p" variant="heading2xl">{formatPrice(featuredPlan.price)}</Text>
                          <Text as="span" variant="bodySm" tone="subdued">/month</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">Billed monthly · Cancel any time</Text>
                      </BlockStack>

                      <Divider />

                      <BlockStack gap="200">
                        <InlineStack gap="150" blockAlign="start" wrap={false}>
                          <CheckIcon />
                          <Text as="p" variant="bodySm">
                            <strong>{formatCredits(featuredPlan.credits)} credits</strong> every month
                          </Text>
                        </InlineStack>
                        {featuredPlan.features.slice(1).map((f) => (
                          <InlineStack key={f} gap="150" blockAlign="start" wrap={false}>
                            <CheckIcon />
                            <Text as="p" variant="bodySm">{f}</Text>
                          </InlineStack>
                        ))}
                      </BlockStack>

                    </BlockStack>

                    <div className="pricing-plan-card__action">
                      <Form method="post">
                        <input type="hidden" name="intent" value="subscribe" />
                        <input type="hidden" name="planKey" value={featuredPlan.key} />
                        <input type="hidden" name="interval" value="monthly" />
                        <Button
                          fullWidth submit variant="secondary"
                          loading={isSubmitting && activePlanInterval === "monthly"}
                          disabled={isSubmitting || isMonthlyCurrentPlan}
                        >
                          {isMonthlyCurrentPlan ? "Current plan" : "Choose Monthly"}
                        </Button>
                      </Form>
                    </div>
                  </div>
                </Card>
              </div>
            </Grid.Cell>

            {/* ── Yearly plan ── */}
            <Grid.Cell>
              <div className="pricing-plan-card pricing-plan-card--popular">
                <Card>
                  <div className="pricing-plan-card__inner">
                    <BlockStack gap="300">

                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="050">
                          <Text as="h3" variant="headingLg">{featuredPlan.name}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">Yearly billing</Text>
                        </BlockStack>
                        <Badge tone="success">Best value</Badge>
                      </InlineStack>

                      <BlockStack gap="100">
                        <InlineStack gap="100" blockAlign="end">
                          <Text as="p" variant="heading2xl">{formatPrice(yearlyPrice)}</Text>
                          <Text as="span" variant="bodySm" tone="subdued">/year</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Billed yearly - Equivalent to ${yearlyPerMonth.toFixed(2)}/month
                        </Text>
                        <div className="pricing-save-badge">
                          Save {formatPrice(Math.round(yearlySavings * 100) / 100)} — {YEARLY_DISCOUNT_MONTHS} months free
                        </div>
                      </BlockStack>

                      <Divider />

                      <BlockStack gap="200">
                        <InlineStack gap="150" blockAlign="start" wrap={false}>
                          <CheckIcon />
                          <Text as="p" variant="bodySm">
                            <strong>{formatCredits(featuredPlan.credits)} credits</strong> every month
                          </Text>
                        </InlineStack>
                        {featuredPlan.features.slice(1).map((f) => (
                          <InlineStack key={f} gap="150" blockAlign="start" wrap={false}>
                            <CheckIcon />
                            <Text as="p" variant="bodySm">{f}</Text>
                          </InlineStack>
                        ))}
                      </BlockStack>

                    </BlockStack>

                    <div className="pricing-plan-card__action">
                      <Form method="post">
                        <input type="hidden" name="intent" value="subscribe" />
                        <input type="hidden" name="planKey" value={featuredPlan.key} />
                        <input type="hidden" name="interval" value="yearly" />
                        <Button
                          fullWidth submit variant="primary"
                          loading={isSubmitting && activePlanInterval === "yearly"}
                          disabled={isSubmitting}
                        >
                          Choose Yearly
                        </Button>
                      </Form>
                    </div>
                  </div>
                </Card>
              </div>
            </Grid.Cell>

          </Grid>
        </BlockStack>

        {/* Extra credits */}
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="050">
              <Text as="h2" variant="headingMd">Extra Credits</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                One-time top-up. Credits never expire and stack on top of your plan.
              </Text>
            </BlockStack>
            {billingTestMode ? <Badge tone="attention">Test mode</Badge> : null}
          </InlineStack>

          <Grid columns={{ xs: 1, sm: 1, md: 3, lg: 3, xl: 3 }}>
            {extraCreditPackages.map((creditPackage) => {
              const loading = isSubmitting && activePackageKey === creditPackage.key;
              const costPerCredit = (creditPackage.price / creditPackage.credits * 100).toFixed(2);
              return (
                <Grid.Cell key={creditPackage.key}>
                  <Card>
                    <BlockStack gap="300">
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingMd">
                          {formatCredits(creditPackage.credits)} credits
                        </Text>
                        <Text as="p" variant="heading2xl">{formatPrice(creditPackage.price)}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {costPerCredit}¢ per credit · Never expire
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          ≈ {formatCredits(Math.floor(creditPackage.credits / 3))} product generations
                        </Text>
                      </BlockStack>
                      <Form method="post">
                        <input type="hidden" name="intent" value="buy_credits" />
                        <input type="hidden" name="packageKey" value={creditPackage.key} />
                        <Button fullWidth submit loading={loading} disabled={isSubmitting} variant="primary">
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
        .pricing-plan-card--popular > .Polaris-ShadowBevel,
        .pricing-plan-card--popular > div {
          outline: 2px solid #008060;
          border-radius: 13px;
        }
        .pricing-plan-card__inner {
          min-height: 340px;
          height: 100%;
          display: flex;
          flex-direction: column;
        }
        .pricing-plan-card__action {
          margin-top: auto;
          padding-top: 16px;
        }
        .pricing-plan-card__action form { margin: 0; }
        .pricing-save-badge {
          display: inline-block;
          background: #e3f5e1;
          color: #008060;
          font-size: 12px;
          font-weight: 600;
          padding: 3px 10px;
          border-radius: 20px;
          width: fit-content;
        }
      `}</style>
    </Page>
  );
}
