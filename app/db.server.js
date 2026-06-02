import { PrismaClient } from "@prisma/client";

function buildDatasourceUrl() {
  const base = process.env.DATABASE_URL ?? "";
  if (!base) return base;
  try {
    const url = new URL(base);
    // Limit pool per serverless instance to avoid exhausting MySQL max_connections.
    // Each Lambda invocation gets its own process; without this cap, concurrent
    // invocations quickly hit the server-side connection limit (P2037 / error 1040).
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "3");
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "10");
    }
    return url.toString();
  } catch {
    return base;
  }
}

if (!globalThis.prismaGlobal) {
  globalThis.prismaGlobal = new PrismaClient({
    datasourceUrl: buildDatasourceUrl(),
  });
}

const prisma = globalThis.prismaGlobal;

export default prisma;
