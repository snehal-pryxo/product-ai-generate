import db from "../db.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return new Response("Missing shop parameter", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const record = await db.aiVisibilityLlmsTxt.findUnique({ where: { shop } });

  if (!record) {
    return new Response(
      `# ${shop}\n> llms.txt not yet generated. Install Content AI and generate your store's AI visibility file.\n`,
      { status: 200, headers: { "Content-Type": "text/plain" } }
    );
  }

  return new Response(record.content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
