export const CREDIT_PURCHASE_TIERS = {
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

export function normalizeCreditPurchaseAmount(value) {
  const numeric = Number(String(value || "").replace(/[^\d]/g, ""));
  if (!Number.isFinite(numeric)) return 1000;
  return Math.min(10000, Math.max(1000, Math.round(numeric / 1000) * 1000));
}

export function getCreditPurchasePrice(credits) {
  const normalized = normalizeCreditPurchaseAmount(credits);
  return CREDIT_PURCHASE_TIERS[normalized] || Math.ceil(normalized / 1000) * 10;
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
