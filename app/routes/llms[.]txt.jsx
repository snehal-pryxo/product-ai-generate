import { generateDynamicLlmsTxt, resolveShopFromRequest } from "../lib/llmsTxt.server";

const PLAIN_TEXT = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
};

export async function loader({ request }) {
  const shop = await resolveShopFromRequest(request);
  if (!shop) {
    return new Response("Missing shop parameter", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const content = await generateDynamicLlmsTxt(shop);
    return new Response(content, { status: 200, headers: PLAIN_TEXT });
  } catch {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
