import db from "../db.server";
import {
  BILLING_CURRENCY,
  BILLING_INTERVAL,
  BILLING_INTERVAL_ANNUAL,
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
  const requestUrl = new URL(request.url);
  const requestOrigin = requestUrl.origin.replace(/\/+$/, "");
  const envUrl = String(process.env.SHOPIFY_APP_URL || process.env.APP_URL || "").trim().replace(/\/+$/, "");

  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestOrigin)) {
    return requestOrigin;
  }

  if (envUrl) return envUrl;
  return requestUrl.origin;
}

export function buildAppReturnUrl(request, params = {}) {
  const requestUrl = new URL(request.url);
  const shop = params.shop || requestUrl.searchParams.get("shop");
  const returnUrl = new URL("/app/billing", getAppBaseUrl(request));

  if (shop) {
    returnUrl.searchParams.set("shop", String(shop));
  }
  ["host"].forEach((key) => {
    const value = requestUrl.searchParams.get(key);
    if (value) {
      returnUrl.searchParams.set(key, value);
    }
  });
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      returnUrl.searchParams.set(key, String(value));
    }
  });
  return returnUrl.toString();
}

async function readGraphqlPayload(response, fieldName) {
  const json = await response.json();
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    throw new Error(json.errors.map((error) => error.message).join(" "));
  }

  const payload = json?.data?.[fieldName];
  const errors = payload?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join(" "));
  }

  if (!payload) {
    throw new Error("Shopify did not return a billing response.");
  }

  return payload;
}

export async function createRecurringSubscription({ admin, request, shop, plan, interval }) {
  const billingInterval = interval === "yearly" ? BILLING_INTERVAL_ANNUAL : BILLING_INTERVAL;
  const chargePrice = interval === "yearly" ? (plan.yearlyPrice ?? plan.price * 10) : plan.price;
  const response = await admin.graphql(
    `#graphql
      mutation AppSubscriptionCreate(
        $name: String!
        $returnUrl: URL!
        $lineItems: [AppSubscriptionLineItemInput!]!
        $test: Boolean
        $replacementBehavior: AppSubscriptionReplacementBehavior
      ) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          lineItems: $lineItems
          test: $test
          replacementBehavior: $replacementBehavior
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
        returnUrl: buildAppReturnUrl(request, { type: "subscription", plan: plan.key, shop }),
        test: getBillingTestMode(),
        replacementBehavior: "APPLY_IMMEDIATELY",
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: {
                  amount: chargePrice,
                  currencyCode: BILLING_CURRENCY,
                },
                interval: billingInterval,
              },
            },
          },
        ],
      },
    },
  );

  const payload = await readGraphqlPayload(response, "appSubscriptionCreate");

  const subscriptionId = payload?.appSubscription?.id;
  await db.billingSubscription.updateMany({
    where: {
      shop,
      creditedAt: null,
      status: { in: ["PENDING", "UNKNOWN"] },
    },
    data: { status: "SUPERSEDED" },
  });
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
        returnUrl: buildAppReturnUrl(request, { type: "credits", package: creditPackage.key, shop }),
        test: getBillingTestMode(),
        price: {
          amount: creditPackage.price,
          currencyCode: BILLING_CURRENCY,
        },
      },
    },
  );

  const payload = await readGraphqlPayload(response, "appPurchaseOneTimeCreate");

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
      status: { not: "SUPERSEDED" },
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

export async function refreshMonthlyPlanCredits(shop, admin = null) {
  const row = await db.shop.findUnique({
    where: { shop },
    select: {
      billingPlanKey: true,
      billingPlanCredits: true,
      billingSubscriptionId: true,
      billingSubscriptionStatus: true,
      billingCreditsRenewedAt: true,
    },
  });

  if (!row || row.billingPlanKey === "free" || row.billingSubscriptionStatus !== "ACTIVE") {
    return null;
  }

  if (admin && row.billingSubscriptionId) {
    const subscription = await fetchSubscriptionStatus(admin, row.billingSubscriptionId);
    const liveStatus = subscription?.status || "UNKNOWN";
    if (liveStatus !== row.billingSubscriptionStatus) {
      await db.shop.update({
        where: { shop },
        data: { billingSubscriptionStatus: liveStatus },
      });
    }
    if (!ACTIVE_STATUSES.has(liveStatus)) {
      return null;
    }
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
