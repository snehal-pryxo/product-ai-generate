import { createRequestListener } from "@react-router/node";
import * as serverBuild from "../build/server/index.js";

const requestListener = createRequestListener({
  build: serverBuild,
  mode: process.env.NODE_ENV || "production",
});

export default async function handler(request) {
  const getHeader = (name) => {
    const headers = request?.headers;
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(name);

    const lowerName = String(name || "").toLowerCase();
    const directValue = headers[lowerName] ?? headers[name];
    if (Array.isArray(directValue)) return directValue[0] || null;
    if (typeof directValue === "string") return directValue;
    return null;
  };

  let url;
  try {
    url = new URL(request.url);
  } catch {
    const forwardedProto = getHeader("x-forwarded-proto");
    const forwardedHost = getHeader("x-forwarded-host");
    const host = getHeader("host");
    const base = `${forwardedProto || "https"}://${forwardedHost || host || "localhost"}`;
    url = new URL(request.url, base);
  }

  // Avoid routing /assets/* through React Router when a stale hashed asset is requested.
  // This prevents noisy "No route matches URL /assets/..." server errors.
  if (url.pathname.startsWith("/assets/")) {
    return new Response("Not Found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=60",
      },
    });
  }

  return requestListener(request);
}
