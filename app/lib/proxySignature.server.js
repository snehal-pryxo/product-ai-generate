import crypto from "crypto";

/**
 * Verifies the HMAC-SHA256 signature Shopify adds to every App Proxy request.
 *
 * Shopify signs proxy requests by:
 *   1. Taking all query params except `signature`
 *   2. Sorting them alphabetically by key
 *   3. Joining as "key1=value1key2=value2..." (no separator between pairs)
 *   4. HMAC-SHA256 with the app secret → hex digest
 *
 * Returns:
 *   "valid"   — signature present and correct
 *   "absent"  — no signature param (direct access, not via proxy)
 *   "invalid" — signature present but wrong (reject these)
 */
export function verifyShopifyProxySignature(request) {
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  if (!apiSecret) {
    console.warn("[proxy-verify] SHOPIFY_API_SECRET not set — skipping signature check");
    return "absent";
  }

  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const { signature, ...rest } = params;

  if (!signature) return "absent";

  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join("");

  const digest = crypto
    .createHmac("sha256", apiSecret)
    .update(message)
    .digest("hex");

  try {
    const valid = crypto.timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(signature, "hex"));
    return valid ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}
