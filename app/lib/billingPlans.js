export const BILLING_CURRENCY = "USD";
export const BILLING_INTERVAL = "EVERY_30_DAYS";
export const BILLING_INTERVAL_ANNUAL = "ANNUAL";
export const BILLING_RENEWAL_DAYS = 30;
export const YEARLY_DISCOUNT_MONTHS = 2; // "2 months free" = pay 10, get 12

const DEFAULT_SUBSCRIPTION_PLANS = [
  {
    key: "free",
    name: "Free",
    price: 0,
    credits: 150,
    description: "Get started with AI content generation at no cost.",
    features: [
      "150 credits included",
      "Product descriptions",
      "Meta title and meta description",
      "Basic prompt templates",
    ],
  },
  {
    key: "starter",
    name: "Starter",
    price: 9.99,
    credits: 1500,
    description: "For small stores keeping product SEO updated.",
    features: [
      "1,500 credits every month",
      "Unlimited product content generation",
      "Unlimited collection content generation",
      "Unlimited collection product content generation",
      "Unlimited page content generation",
      "Unlimited blog content generation",
      "Custom template creation",
      "Unlimited product JSON schema and FAQ generation",
      "Unlimited collection, page, and blog JSON schema",
    ],
  },
  {
    key: "growth",
    name: "Growth",
    price: 14.99,
    credits: 5000,
    description: "For active stores using bulk generation regularly.",
    popular: true,
    features: [
      "5,000 credits every month",
      "Unlimited product content generation",
      "Unlimited collection content generation",
      "Unlimited collection product content generation",
      "Unlimited page content generation",
      "Unlimited blog content generation",
      "Custom template creation",
      "Unlimited product JSON schema and FAQ generation",
      "Unlimited collection, page, and blog JSON schema",
    ],
  },
];

const DEFAULT_EXTRA_CREDIT_PACKAGES = [
  { key: "credits_1000", name: "1,000 extra credits", credits: 1000, price: 5 },
  { key: "credits_5000", name: "5,000 extra credits", credits: 5000, price: 20 },
  { key: "credits_15000", name: "15,000 extra credits", credits: 15000, price: 50 },
];

const PLAN_ENV_KEYS = {
  free: {
    price: "BILLING_FREE_PRICE",
    credits: "BILLING_FREE_CREDITS",
  },
  starter: {
    price: "BILLING_STARTER_PRICE",
    credits: "BILLING_STARTER_CREDITS",
  },
  growth: {
    price: "BILLING_GROWTH_PRICE",
    credits: "BILLING_GROWTH_CREDITS",
  },
};

const EXTRA_CREDIT_ENV_KEYS = {
  credits_1000: {
    price: "EXTRA_CREDITS_SMALL_PRICE",
    credits: "EXTRA_CREDITS_SMALL_CREDITS",
  },
  credits_5000: {
    price: "EXTRA_CREDITS_MEDIUM_PRICE",
    credits: "EXTRA_CREDITS_MEDIUM_CREDITS",
  },
  credits_15000: {
    price: "EXTRA_CREDITS_LARGE_PRICE",
    credits: "EXTRA_CREDITS_LARGE_CREDITS",
  },
};

function parseNumberEnv(env, key, fallback) {
  const raw = env?.[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }

  const value = Number(String(raw).replace(/,/g, "").trim());
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return value;
}

function formatCreditCount(credits) {
  return Number(credits || 0).toLocaleString("en-US");
}

function applyPlanEnv(plan, env) {
  const keys = PLAN_ENV_KEYS[plan.key] || {};
  const credits = Math.trunc(parseNumberEnv(env, keys.credits, plan.credits));
  const price = parseNumberEnv(env, keys.price, plan.price);

  return {
    ...plan,
    price,
    credits,
    features: plan.features.map((feature) => {
      if (!/credits/i.test(feature)) return feature;
      return feature.replace(/[\d,]+ credits/i, `${formatCreditCount(credits)} credits`);
    }),
  };
}

function applyExtraCreditEnv(creditPackage, env) {
  const keys = EXTRA_CREDIT_ENV_KEYS[creditPackage.key] || {};
  const credits = Math.trunc(parseNumberEnv(env, keys.credits, creditPackage.credits));
  const price = parseNumberEnv(env, keys.price, creditPackage.price);

  return {
    ...creditPackage,
    name: `${formatCreditCount(credits)} extra credits`,
    price,
    credits,
  };
}

// Yearly price = 10 monthly payments (2 months free)
function computeYearlyPrice(monthlyPrice) {
  if (monthlyPrice <= 0) return 0;
  return Math.round(monthlyPrice * (12 - YEARLY_DISCOUNT_MONTHS) * 100) / 100;
}

export function getSubscriptionPlans(env = {}) {
  return DEFAULT_SUBSCRIPTION_PLANS.map((plan) => {
    const monthly = applyPlanEnv(plan, env);
    return {
      ...monthly,
      yearlyPrice: computeYearlyPrice(monthly.price),
      yearlyCredits: monthly.credits * (12 - YEARLY_DISCOUNT_MONTHS),
      yearlyCreditsPerMonth: monthly.credits,
    };
  });
}

export function getExtraCreditPackages(env = {}) {
  return DEFAULT_EXTRA_CREDIT_PACKAGES.map((creditPackage) => applyExtraCreditEnv(creditPackage, env));
}

export function getSubscriptionPlan(planKey, env = {}) {
  return getSubscriptionPlans(env).find((plan) => plan.key === planKey) || null;
}

export function getExtraCreditPackage(packageKey, env = {}) {
  return getExtraCreditPackages(env).find((pack) => pack.key === packageKey) || null;
}
