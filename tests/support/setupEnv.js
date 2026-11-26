// Runs in every test worker before any test module (and therefore before
// db.server.js creates the Prisma client) is imported.
import { resolveTestDatabaseUrl } from "./testDatabase.js";

const url = new URL(resolveTestDatabaseUrl());
// Docker Desktop's port forwarding can be slow to accept a burst of new
// connections (10 items settle in parallel); give connects more headroom than
// Prisma's 5s default so tests don't flake on the local proxy.
if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "30");
if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "30");

process.env.DATABASE_URL = url.toString();
process.env.DB_CONNECTION_LIMIT = "20";
process.env.NODE_ENV = "test";
