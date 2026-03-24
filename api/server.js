import pkg from "@react-router/node";
const { createRequestHandler } = pkg;
import * as serverBuild from "../build/server/index.js";

const handler = createRequestHandler({
  build: serverBuild,
  mode: process.env.NODE_ENV || "production",
});

/**
 * Vercel Node.js serverless function — catch-all handler for React Router SSR.
 * Converts Vercel's (req, res) interface to Web API Request/Response.
 */
export default async function vercelHandler(req, res) {
  try {
    // Build the full URL from Vercel's request headers
    const protocol =
      req.headers["x-forwarded-proto"]?.split(",")[0] ?? "https";
    const host = req.headers["x-forwarded-host"] ?? req.headers.host;
    const url = new URL(req.url, `${protocol}://${host}`);

    // Collect raw body (skip for GET/HEAD)
    let body = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      if (chunks.length > 0) {
        body = Buffer.concat(chunks);
      }
    }

    // Build Web API Headers from Node.js headers
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        value.forEach((v) => headers.append(key, v));
      } else {
        headers.set(key, value);
      }
    }

    // Create a Web API Request and hand it to React Router
    const request = new Request(url.toString(), {
      method: req.method,
      headers,
      body,
    });

    const response = await handler(request);

    // Write status + headers
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Stream the response body
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }

    res.end();
  } catch (error) {
    console.error("[vercel-handler] Unhandled error:", error);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
}
