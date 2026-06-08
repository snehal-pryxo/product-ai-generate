import { generateDynamicAgentsMd, readStoredAgentMdContent, resolveShopFromRequest } from "../lib/llmsTxt.server";

const PLAIN_TEXT = { "Content-Type": "text/markdown; charset=utf-8" };
const NO_CACHE_HEADERS = { ...PLAIN_TEXT, "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "-1", "X-Content-Source": "nex-ai-seo-product-description" };

export async function loader({ request }) {
  const shop = await resolveShopFromRequest(request);

  if (!shop) {
    return new Response("# Agent Instructions\n\nShop not found.", { status: 200, headers: PLAIN_TEXT });
  }

  try {
    const storedContent = await readStoredAgentMdContent(shop);
    if (storedContent) {
      return new Response(storedContent, { status: 200, headers: NO_CACHE_HEADERS });
    }
  } catch {
    // DB unavailable - fall through to dynamic generation.
  }

  try {
    const content = await generateDynamicAgentsMd(shop);
    return new Response(content, { status: 200, headers: NO_CACHE_HEADERS });
  } catch {
    return new Response("# Agent Instructions\n\nContent not yet generated. Please open the app and click Generate.", { status: 200, headers: PLAIN_TEXT });
  }
}
