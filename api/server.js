import { createRequestListener } from "@react-router/node";
import { createRequestHandler } from "react-router";
import * as serverBuild from "../build/server/index.js";

const requestListener = createRequestListener({
  build: serverBuild,
  mode: process.env.NODE_ENV || "production",
});

const fetchRequestHandler = createRequestHandler(
  serverBuild,
  process.env.NODE_ENV || "production",
);

function resolveUrl(inputUrl, headersLike) {
  let url;
  try {
    url = new URL(inputUrl);
  } catch {
    const forwardedProto = headersLike?.["x-forwarded-proto"] || headersLike?.get?.("x-forwarded-proto");
    const forwardedHost = headersLike?.["x-forwarded-host"] || headersLike?.get?.("x-forwarded-host");
    const host = headersLike?.host || headersLike?.get?.("host");
    const base = `${forwardedProto || "https"}://${forwardedHost || host || "localhost"}`;
    url = new URL(inputUrl, base);
  }
  return url;
}

export default async function handler(req, res) {
  // Vercel may invoke API handlers either as Node (req/res) or Web (Request).
  // Support both to avoid runtime crashes when adapter detection changes.
  if (!res && req instanceof Request) {
    const url = resolveUrl(req.url, req.headers);
    if (url.pathname.startsWith("/assets/")) {
      return new Response("Not Found", {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=60",
        },
      });
    }
    return fetchRequestHandler(req);
  }

  const url = resolveUrl(req.url, req.headers);

  // Avoid routing /assets/* through React Router when a stale hashed asset is requested.
  // This prevents noisy "No route matches URL /assets/..." server errors.
  if (url.pathname.startsWith("/assets/")) {
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=60");
    res.end("Not Found");
    return;
  }

  return requestListener(req, res);
}
