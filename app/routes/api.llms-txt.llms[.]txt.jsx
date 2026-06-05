import {
  generateDynamicLlmsTxt,
  readStoredLlmsTxtContent,
  reAssertRedirectsInBackground,
  resolveShopFromRequest,
} from "../lib/llmsTxt.server";
import { verifyShopifyProxySignature } from "../lib/proxySignature.server";

const PLAIN_TEXT = { "Content-Type": "text/plain; charset=utf-8" };

// No-store headers:
// Previous "max-age=300, stale-while-revalidate=3600" caused Shopify CDN to serve
// the OTHER app's stale content for up to 1 hour after a redirect change.
// Setting no-store forces every request to hit this server fresh.
const NO_CACHE_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "-1",
  "X-Content-Source": "gen-ai-seo-product-description",
  "X-Powered-By": "Gen AI SEO Product Description",
  "X-Override": "true",
};

export async function loader({ request }) {
  const sigResult = verifyShopifyProxySignature(request);
  if (sigResult === "invalid") {
    console.warn("[llms-proxy] Rejected: invalid Shopify proxy signature");
    return new Response("Forbidden", { status: 403, headers: PLAIN_TEXT });
  }

  const shop = await resolveShopFromRequest(request);

  console.log(`[llms-proxy] /apps/llms-txt/llms.txt — shop=${shop || "unknown"} sig=${sigResult}`);

  if (!shop) {
    console.warn("[llms-proxy] shop not resolved for /apps/llms-txt/llms.txt");
    return new Response("# LLMs.txt\n\nShop not found.", { status: 200, headers: PLAIN_TEXT });
  }

  try {
    const storedContent = await readStoredLlmsTxtContent(shop);
    if (storedContent) {
      console.log(`[llms-proxy] ${shop} — serving stored content (${storedContent.length} bytes, source=db)`);
      reAssertRedirectsInBackground(shop);
      return new Response(storedContent, { status: 200, headers: NO_CACHE_HEADERS });
    }
  } catch (dbErr) {
    console.warn(`[llms-proxy] ${shop} — DB error: ${dbErr?.message}, falling back to dynamic`);
  }

  try {
    const content = await generateDynamicLlmsTxt(shop);
    console.log(`[llms-proxy] ${shop} — serving dynamic content (${content.length} bytes, source=dynamic)`);
    return new Response(content, { status: 200, headers: NO_CACHE_HEADERS });
  } catch (genErr) {
    // No stored content and dynamic generation failed (shop not installed or no access token).
    // Return 404 so other apps/themes can serve /llms.txt until the merchant generates.
    console.warn(`[llms-proxy] ${shop} — no content available, returning 404: ${genErr?.message}`);
    return new Response(
      "Not Found — open the app and click Generate to activate /llms.txt.",
      { status: 404, headers: PLAIN_TEXT },
    );
  }
}
