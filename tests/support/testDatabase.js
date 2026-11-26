// Resolves the database URL for automated tests and refuses anything that could
// be a real database. Tests run only against a throwaway local MariaDB, e.g.:
//
//   npm run test:db:up
//   TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/nexai_test npm test

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function readDotEnvDatabaseUrl() {
  const file = resolve(process.cwd(), ".env");
  if (!existsSync(file)) return null;
  const match = readFileSync(file, "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  return match ? match[1].trim() : null;
}

function target(url) {
  const u = new URL(url);
  return { host: u.hostname.toLowerCase(), port: u.port || "3306", db: u.pathname.replace(/^\//, "") };
}

export function resolveTestDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start a throwaway database with `npm run test:db:up` and run\n" +
      "  TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/nexai_test npm test",
    );
  }

  let test;
  try {
    test = target(url);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL.");
  }
  if (!LOCAL_HOSTS.has(test.host)) {
    throw new Error(`Refusing to run tests against non-local database host "${test.host}". Tests only run on a local throwaway database.`);
  }
  if (!/test/i.test(test.db)) {
    throw new Error(`Refusing to run tests against database "${test.db}": the database name must contain "test".`);
  }

  // Never the database the app itself is configured for (.env or environment).
  for (const configured of [readDotEnvDatabaseUrl(), process.env.APP_DATABASE_URL]) {
    if (!configured) continue;
    let app;
    try {
      app = target(configured);
    } catch {
      continue;
    }
    if (app.host === test.host && app.port === test.port && app.db === test.db) {
      throw new Error("Refusing to run tests: TEST_DATABASE_URL points at the app's configured database.");
    }
  }
  return url;
}
