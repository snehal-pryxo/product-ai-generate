export const CREDIT_PURCHASE_TIERS = {
  100: 1,
  200: 2,
  300: 3,
  400: 4,
  500: 5,
  600: 6,
  700: 7,
  800: 8,
  900: 9,
  1000: 10,
  2000: 20,
  3000: 30,
  4000: 40,
  5000: 50,
  6000: 60,
  7000: 70,
  8000: 80,
  9000: 90,
  10000: 80,
};

const MIN_CREDIT_PURCHASE = 100;
const CREDIT_PURCHASE_STEP = 100;
const BULK_CREDIT_THRESHOLD = 10000;
const BASE_CREDIT_PRICE_PER_STEP = 1;
const BULK_CREDIT_PRICE_PER_CREDIT = CREDIT_PURCHASE_TIERS[BULK_CREDIT_THRESHOLD] / BULK_CREDIT_THRESHOLD;

export function normalizeCreditPurchaseAmount(value) {
  const numeric = Number(String(value || "").replace(/[^\d]/g, ""));
  if (!Number.isFinite(numeric)) return MIN_CREDIT_PURCHASE;
  return Math.max(MIN_CREDIT_PURCHASE, Math.round(numeric / CREDIT_PURCHASE_STEP) * CREDIT_PURCHASE_STEP);
}

export function getCreditPurchasePrice(credits) {
  const normalized = normalizeCreditPurchaseAmount(credits);
  if (normalized > BULK_CREDIT_THRESHOLD) {
    return Math.round(normalized * BULK_CREDIT_PRICE_PER_CREDIT * 100) / 100;
  }
  return CREDIT_PURCHASE_TIERS[normalized] || Math.ceil(normalized / CREDIT_PURCHASE_STEP) * BASE_CREDIT_PRICE_PER_STEP;
}

export function buildCustomCreditPackage(credits) {
  const normalizedCredits = normalizeCreditPurchaseAmount(credits);
  return {
    key: `custom_${normalizedCredits}`,
    name: `${normalizedCredits.toLocaleString("en-US")} extra credits`,
    credits: normalizedCredits,
    price: getCreditPurchasePrice(normalizedCredits),
  };
}
