import { generateDynamicLlmsTxt, resolveShopFromRequest } from "../lib/llmsTxt.server";
import db from "../db.server";

const PLAIN_TEXT = { "Content-Type": "text/plain; charset=utf-8" };
const CACHEABLE_PLAIN_TEXT = { ...PLAIN_TEXT, "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" };

export async function loader({ request }) {
  const shop = await resolveShopFromRequest(request);

  if (!shop) {
    return new Response("# LLMs.txt\n\nShop not found.", { status: 200, headers: PLAIN_TEXT });
  }

  // Serve stored/generated content first so Generate overrides this URL
  try {
    const stored = await db.aiVisibilityLlmsTxt.findUnique({
      where: { shop },
      select: { content: true },
    });
    if (stored?.content) {
      return new Response(stored.content, { status: 200, headers: CACHEABLE_PLAIN_TEXT });
    }
  } catch {
    // DB unavailable — fall through to dynamic generation
  }

  try {
    const content = await generateDynamicLlmsTxt(shop);
    return new Response(content, { status: 200, headers: CACHEABLE_PLAIN_TEXT });
  } catch {
    return new Response("# LLMs.txt\n\nContent not yet generated. Please open the app and click Generate.", { status: 200, headers: PLAIN_TEXT });
  }
}
