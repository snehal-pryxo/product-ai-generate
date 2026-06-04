import { generateDynamicLlmsTxt, readStoredLlmsTxtContent, resolveShopFromRequest } from "../lib/llmsTxt.server";

const PLAIN_TEXT = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
};

export async function loader({ request }) {
  const shop = await resolveShopFromRequest(request);
  if (!shop) {
    return new Response("# LLMs.txt\n\nShop not found.", { status: 200, headers: PLAIN_TEXT });
  }

  try {
    const storedContent = await readStoredLlmsTxtContent(shop);
    if (storedContent) {
      return new Response(storedContent, { status: 200, headers: PLAIN_TEXT });
    }
  } catch {
    // DB unavailable - fall through to dynamic generation.
  }

  try {
    const content = await generateDynamicLlmsTxt(shop);
    return new Response(content, { status: 200, headers: PLAIN_TEXT });
  } catch {
    return new Response("# LLMs.txt\n\nContent not yet generated. Please open the app and click Generate.", { status: 200, headers: PLAIN_TEXT });
  }
}
