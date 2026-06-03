import { generateAiRobotsTxt } from "../lib/llmsTxt.server";

export async function loader() {
  return new Response(generateAiRobotsTxt(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
