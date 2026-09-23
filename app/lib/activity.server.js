import db from "../db.server";

// Merchant usage tracking for the internal apps dashboard.
// Writes one row per shop per UTC day into shop_daily_activity and keeps
// shop.lastActiveAt current. Tracking must never break the request, so every
// write swallows its own errors.

export const APP_OPEN_THROTTLE_MS = 10 * 60 * 1000;

export function shouldRecordAppOpen(lastActiveAt, now = Date.now()) {
  if (!lastActiveAt) return true;
  const last = new Date(lastActiveAt).getTime();
  if (!Number.isFinite(last)) return true;
  const isNewUtcDay = new Date(last).toISOString().slice(0, 10) !== new Date(now).toISOString().slice(0, 10);
  return isNewUtcDay || now - last >= APP_OPEN_THROTTLE_MS;
}

async function touchLastActive(shop) {
  await db.$executeRaw`
    UPDATE shop SET lastActiveAt = UTC_TIMESTAMP(3) WHERE shop = ${shop}
  `;
}

export async function recordAppOpen(shop) {
  if (!shop) return;
  try {
    await db.$executeRaw`
      INSERT INTO shop_daily_activity (shop, activityDate, appOpens, firstSeenAt, lastSeenAt)
      VALUES (${shop}, UTC_DATE(), 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE appOpens = appOpens + 1, lastSeenAt = UTC_TIMESTAMP(3)
    `;
    await touchLastActive(shop);
  } catch (err) {
    console.error("[activity] recordAppOpen failed", { shop, error: err?.message });
  }
}

export async function recordGeneration(shop, creditsUsed) {
  if (!shop) return;
  const credits = Math.max(0, Number.parseInt(String(creditsUsed), 10) || 0);
  try {
    await db.$executeRaw`
      INSERT INTO shop_daily_activity (shop, activityDate, generations, creditsUsed, firstSeenAt, lastSeenAt)
      VALUES (${shop}, UTC_DATE(), 1, ${credits}, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE
        generations = generations + 1,
        creditsUsed = creditsUsed + ${credits},
        lastSeenAt = UTC_TIMESTAMP(3)
    `;
    await touchLastActive(shop);
  } catch (err) {
    console.error("[activity] recordGeneration failed", { shop, error: err?.message });
  }
}

export async function recordCreditRefund(shop, creditsRefunded) {
  if (!shop) return;
  const credits = Math.max(0, Number.parseInt(String(creditsRefunded), 10) || 0);
  if (credits === 0) return;
  try {
    // Refunds (e.g. failed bulk items) only adjust today's row; they are not merchant activity.
    await db.$executeRaw`
      UPDATE shop_daily_activity
      SET creditsUsed = GREATEST(0, creditsUsed - ${credits})
      WHERE shop = ${shop} AND activityDate = UTC_DATE()
    `;
  } catch (err) {
    console.error("[activity] recordCreditRefund failed", { shop, error: err?.message });
  }
}
