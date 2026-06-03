import { generateDynamicAgentsMd, resolveShopFromRequest } from "../lib/llmsTxt.server";

const PLAIN_TEXT = { "Content-Type": "text/markdown; charset=utf-8" };
const CACHEABLE_PLAIN_TEXT = { ...PLAIN_TEXT, "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" };

export async function loader({ request }) {
  const shop = await resolveShopFromRequest(request);

  if (!shop) {
    return new Response("# Agent Instructions\n\nShop not found.", { status: 200, headers: PLAIN_TEXT });
  }

  try {
    const content = await generateDynamicAgentsMd(shop);
    return new Response(content, { status: 200, headers: CACHEABLE_PLAIN_TEXT });
  } catch {
    return new Response("# Agent Instructions\n\nContent not yet generated. Please open the app and click Generate.", { status: 200, headers: PLAIN_TEXT });
  }
}
