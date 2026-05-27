import db from "../db.server";
import { refreshMonthlyPlanCredits } from "./billing.server";
import { getSubscriptionPlan } from "./billingPlans";

export function getDefaultFreeCredits() {
  return getSubscriptionPlan("free", process.env)?.credits ?? 150;
}

export const DEFAULT_FREE_CREDITS = getDefaultFreeCredits();
export const CREDITS_PER_CONTENT_FIELD = 1;
export const FULL_CONTENT_TYPES = ["description", "meta_title", "meta_description"];
const CONTENT_TYPE_CREDIT_COSTS = {
  description: CREDITS_PER_CONTENT_FIELD,
  meta_title: CREDITS_PER_CONTENT_FIELD,
  meta_description: CREDITS_PER_CONTENT_FIELD,
  faq: 5,
};

function unique(values) {
  return Array.from(new Set(values));
}

export function parseSelectedContentTypes(rawValue, allowedTypes, fallbackTypes) {
  let parsed = [];
  if (typeof rawValue === "string" && rawValue.trim()) {
    try {
      const input = JSON.parse(rawValue);
      if (Array.isArray(input)) {
        parsed = input;
      }
    } catch {
      parsed = [];
    }
  }

  const allowed = new Set(allowedTypes);
  const normalized = unique(
    parsed
      .map((value) => String(value || "").trim().toLowerCase())
      .filter((value) => allowed.has(value)),
  );

  if (normalized.length > 0) {
    return normalized;
  }
  return [...fallbackTypes];
}

export function creditsForContentTypes(contentTypes) {
  return (contentTypes || []).reduce(
    (sum, type) => sum + (CONTENT_TYPE_CREDIT_COSTS[type] ?? CREDITS_PER_CONTENT_FIELD),
    0,
  );
}

export function creditsForBatch(contentTypes, itemsCount) {
  if (!itemsCount || itemsCount < 1) return 0;
  return creditsForContentTypes(contentTypes) * itemsCount;
}

export async function getOrCreateShopCredits(shopDomain) {
  await refreshMonthlyPlanCredits(shopDomain);
  const freeCredits = getDefaultFreeCredits();

  const row = await db.shop.upsert({
    where: { shop: shopDomain },
    update: {},
    create: {
      shop: shopDomain,
      credits: freeCredits,
      creditsUsedTotal: 0,
      billingPlanKey: "free",
      billingPlanName: "Free",
      billingPlanCredits: freeCredits,
    },
    select: {
      credits: true,
      creditsUsedTotal: true,
    },
  });

  return {
    credits: row?.credits ?? freeCredits,
    creditsUsedTotal: row?.creditsUsedTotal ?? 0,
  };
}

export function buildInsufficientCreditsError(requiredCredits, currentCredits) {
  return `Insufficient credits. You need ${requiredCredits} credits. Current balance: ${currentCredits}.`;
}

export async function deductCredits({ shopDomain, creditsUsed }) {
  if (!creditsUsed || creditsUsed <= 0) {
    return getOrCreateShopCredits(shopDomain);
  }

  await getOrCreateShopCredits(shopDomain);

  const updated = await db.shop.updateMany({
    where: {
      shop: shopDomain,
      credits: { gte: creditsUsed },
    },
    data: {
      credits: { decrement: creditsUsed },
      creditsUsedTotal: { increment: creditsUsed },
    },
  });

  if (updated.count === 0) {
    const snapshot = await getOrCreateShopCredits(shopDomain);
    throw new Error(buildInsufficientCreditsError(creditsUsed, snapshot.credits));
  }

  const snapshot = await db.shop.findUnique({
    where: { shop: shopDomain },
    select: { credits: true, creditsUsedTotal: true },
  });

  return {
    credits: snapshot?.credits ?? 0,
    creditsUsedTotal: snapshot?.creditsUsedTotal ?? 0,
  };
}

export async function refundCredits({ shopDomain, creditsRefunded }) {
  if (!creditsRefunded || creditsRefunded <= 0) {
    return getOrCreateShopCredits(shopDomain);
  }

  await getOrCreateShopCredits(shopDomain);

  const current = await db.shop.findUnique({
    where: { shop: shopDomain },
    select: { creditsUsedTotal: true },
  });
  const safeDecrement = Math.min(creditsRefunded, current?.creditsUsedTotal ?? 0);

  const snapshot = await db.shop.update({
    where: { shop: shopDomain },
    data: {
      credits: { increment: creditsRefunded },
      creditsUsedTotal: { decrement: safeDecrement },
    },
    select: {
      credits: true,
      creditsUsedTotal: true,
    },
  });

  return {
    credits: snapshot?.credits ?? 0,
    creditsUsedTotal: snapshot?.creditsUsedTotal ?? 0,
  };
}
