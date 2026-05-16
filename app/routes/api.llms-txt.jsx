import db from "../db.server";

const PLAIN_TEXT = { "Content-Type": "text/plain; charset=utf-8" };
const CACHEABLE_PLAIN_TEXT = { ...PLAIN_TEXT, "Cache-Control": "public, max-age=3600" };

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return new Response("Missing shop parameter", { status: 400, headers: PLAIN_TEXT });
  }

  const [shopRow, record] = await Promise.all([
    db.shop.findUnique({ where: { shop }, select: { installed: true } }),
    db.aiVisibilityLlmsTxt.findUnique({ where: { shop } }),
  ]);

  if (!shopRow?.installed) {
    return new Response("Not found", { status: 404, headers: PLAIN_TEXT });
  }

  if (!record) {
    return new Response(
      `# ${shop}\n> llms.txt not yet generated. Visit the AI Visibility dashboard to generate your store's AI visibility file.\n`,
      { status: 200, headers: CACHEABLE_PLAIN_TEXT }
    );
  }

  return new Response(record.content, { status: 200, headers: CACHEABLE_PLAIN_TEXT });
}
