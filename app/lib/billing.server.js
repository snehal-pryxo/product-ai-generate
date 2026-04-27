import db from "../db.server";
import {
  BILLING_CURRENCY,
  BILLING_INTERVAL,
  BILLING_RENEWAL_DAYS,
} from "./billingPlans";

const ACTIVE_STATUSES = new Set(["ACTIVE"]);
const THIRTY_DAYS_MS = BILLING_RENEWAL_DAYS * 24 * 60 * 60 * 1000;

export function getBillingTestMode() {
  const raw = String(process.env.SHOPIFY_BILLING_TEST || "").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return process.env.NODE_ENV !== "production";
}

export function getAppBaseUrl(request) {
  const appUrl = String(process.env.SHOPIFY_APP_URL || process.env.APP_URL || "").trim();
  if (appUrl) return appUrl.replace(/\/+$/, "");
  const requestUrl = new URL(request.url);
  return requestUrl.origin;
}

export function buildAppReturnUrl(request, params = {}) {
  const returnUrl = new URL("/app/billing", getAppBaseUrl(request));
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      returnUrl.searchParams.set(key, String(value));
    }
  });
  return returnUrl.toString();
}

export async function createRecurringSubscription({ admin, request, shop, plan }) {
  const response = await admin.graphql(
    `#graphql
      mutation AppSubscriptionCreate(
        $name: String!
        $returnUrl: URL!
        $lineItems: [AppSubscriptionLineItemInput!]!
        $test: Boolean
      ) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          lineItems: $lineItems
          test: $test
        ) {
          userErrors {
            field
            message
          }
          confirmationUrl
          appSubscription {
            id
            status
          }
        }
      }
    `,
    {
      variables: {
        name: `Content AI - ${plan.name}`,
        returnUrl: buildAppReturnUrl(request, { type: "subscription", plan: plan.key }),
        test: getBillingTestMode(),
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: {
                  amount: plan.price,
                  currencyCode: BILLING_CURRENCY,
                },
                interval: BILLING_INTERVAL,
              },
            },
          },
        ],
      },
    },
  );

  const json = await response.json();
  const payload = json?.data?.appSubscriptionCreate;
  const errors = payload?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join(" "));
  }

  const subscriptionId = payload?.appSubscription?.id;
  await db.billingSubscription.create({
    data: {
      shop,
      planKey: plan.key,
      planName: plan.name,
      credits: plan.credits,
      price: plan.price,
      subscriptionId,
      status: payload?.appSubscription?.status || "PENDING",
    },
  });

  return payload?.confirmationUrl;
}

export async function createExtraCreditPurchase({ admin, request, shop, creditPackage }) {
  const response = await admin.graphql(
    `#graphql
      mutation AppPurchaseOneTimeCreate(
        $name: String!
        $returnUrl: URL!
        $price: MoneyInput!
        $test: Boolean
      ) {
        appPurchaseOneTimeCreate(
          name: $name
          returnUrl: $returnUrl
          price: $price
          test: $test
        ) {
          userErrors {
            field
            message
          }
          confirmationUrl
          appPurchaseOneTime {
            id
            status
          }
        }
      }
    `,
    {
      variables: {
        name: `Content AI - ${creditPackage.name}`,
        returnUrl: buildAppReturnUrl(request, { type: "credits", package: creditPackage.key }),
        test: getBillingTestMode(),
        price: {
          amount: creditPackage.price,
          currencyCode: BILLING_CURRENCY,
        },
      },
    },
  );

  const json = await response.json();
  const payload = json?.data?.appPurchaseOneTimeCreate;
  const errors = payload?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join(" "));
  }

  const purchaseId = payload?.appPurchaseOneTime?.id;
  await db.billingCreditPurchase.create({
    data: {
      shop,
      packageKey: creditPackage.key,
      name: creditPackage.name,
      credits: creditPackage.credits,
      price: creditPackage.price,
      purchaseId,
      status: payload?.appPurchaseOneTime?.status || "PENDING",
    },
  });

  return payload?.confirmationUrl;
}

export async function fetchSubscriptionStatus(admin, subscriptionId) {
  if (!subscriptionId) return null;
  const response = await admin.graphql(
    `#graphql
      query BillingSubscriptionStatus($id: ID!) {
        node(id: $id) {
          ... on AppSubscription {
            id
            name
            status
            test
          }
        }
      }
    `,
    { variables: { id: subscriptionId } },
  );
  const json = await response.json();
  return json?.data?.node || null;
}

export async function fetchOneTimePurchaseStatus(admin, purchaseId) {
  if (!purchaseId) return null;
  const response = await admin.graphql(
    `#graphql
      query BillingOneTimePurchaseStatus($id: ID!) {
        node(id: $id) {
          ... on AppPurchaseOneTime {
            id
            name
            status
            test
          }
        }
      }
    `,
    { variables: { id: purchaseId } },
  );
  const json = await response.json();
  return json?.data?.node || null;
}

export async function activateSubscription({ admin, shop, planKey }) {
  const pending = await db.billingSubscription.findFirst({
    where: {
      shop,
      planKey,
      creditedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!pending?.subscriptionId) {
    return { success: false, message: "No pending subscription found." };
  }

  const subscription = await fetchSubscriptionStatus(admin, pending.subscriptionId);
  const status = subscription?.status || "UNKNOWN";

  await db.billingSubscription.update({
    where: { id: pending.id },
    data: { status },
  });

  if (!ACTIVE_STATUSES.has(status)) {
    return { success: false, message: `Subscription was not activated. Current status: ${status}.` };
  }

  const now = new Date();
  await db.$transaction([
    db.shop.upsert({
      where: { shop },
      update: {
        credits: { increment: pending.credits },
        billingPlanKey: pending.planKey,
        billingPlanName: pending.planName,
        billingPlanCredits: pending.credits,
        billingPlanPrice: pending.price,
        billingSubscriptionId: pending.subscriptionId,
        billingSubscriptionStatus: status,
        billingPlanActivatedAt: now,
        billingCreditsRenewedAt: now,
      },
      create: {
        shop,
        installed: true,
        credits: pending.credits,
        billingPlanKey: pending.planKey,
        billingPlanName: pending.planName,
        billingPlanCredits: pending.credits,
        billingPlanPrice: pending.price,
        billingSubscriptionId: pending.subscriptionId,
        billingSubscriptionStatus: status,
        billingPlanActivatedAt: now,
        billingCreditsRenewedAt: now,
      },
    }),
    db.billingSubscription.update({
      where: { id: pending.id },
      data: { status, creditedAt: now },
    }),
  ]);

  return {
    success: true,
    message: `${pending.planName} activated. ${pending.credits.toLocaleString("en-US")} monthly credits were added.`,
  };
}

export async function activateExtraCreditPurchase({ admin, shop, packageKey }) {
  const pending = await db.billingCreditPurchase.findFirst({
    where: {
      shop,
      packageKey,
      creditedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!pending?.purchaseId) {
    return { success: false, message: "No pending credit purchase found." };
  }

  const purchase = await fetchOneTimePurchaseStatus(admin, pending.purchaseId);
  const status = purchase?.status || "UNKNOWN";

  await db.billingCreditPurchase.update({
    where: { id: pending.id },
    data: { status },
  });

  if (!ACTIVE_STATUSES.has(status)) {
    return { success: false, message: `Credit purchase was not activated. Current status: ${status}.` };
  }

  const now = new Date();
  await db.$transaction([
    db.shop.upsert({
      where: { shop },
      update: {
        credits: { increment: pending.credits },
      },
      create: {
        shop,
        installed: true,
        credits: pending.credits,
      },
    }),
    db.billingCreditPurchase.update({
      where: { id: pending.id },
      data: { status, creditedAt: now },
    }),
  ]);

  return {
    success: true,
    message: `${pending.credits.toLocaleString("en-US")} extra credits were added to your account.`,
  };
}

export async function refreshMonthlyPlanCredits(shop) {
  const row = await db.shop.findUnique({
    where: { shop },
    select: {
      billingPlanKey: true,
      billingPlanCredits: true,
      billingSubscriptionStatus: true,
      billingCreditsRenewedAt: true,
    },
  });

  if (!row || row.billingPlanKey === "free" || row.billingSubscriptionStatus !== "ACTIVE") {
    return null;
  }

  const lastRenewedAt = row.billingCreditsRenewedAt ? new Date(row.billingCreditsRenewedAt) : null;
  if (lastRenewedAt && Date.now() - lastRenewedAt.getTime() < THIRTY_DAYS_MS) {
    return null;
  }

  const credits = Number(row.billingPlanCredits || 0);
  if (credits <= 0) return null;

  const now = new Date();
  return db.shop.update({
    where: { shop },
    data: {
      credits: { increment: credits },
      billingCreditsRenewedAt: now,
    },
    select: {
      credits: true,
      creditsUsedTotal: true,
      billingCreditsRenewedAt: true,
    },
  });
}
