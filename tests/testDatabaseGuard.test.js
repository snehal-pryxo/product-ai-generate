import { afterEach, describe, expect, it } from "vitest";
import { resolveTestDatabaseUrl } from "./support/testDatabase";

const original = { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL, APP_DATABASE_URL: process.env.APP_DATABASE_URL };

afterEach(() => {
  process.env.TEST_DATABASE_URL = original.TEST_DATABASE_URL;
  if (original.APP_DATABASE_URL === undefined) delete process.env.APP_DATABASE_URL;
  else process.env.APP_DATABASE_URL = original.APP_DATABASE_URL;
});

describe("test database guard", () => {
  it("accepts a local database whose name contains 'test'", () => {
    process.env.TEST_DATABASE_URL = "mysql://root:test@127.0.0.1:3317/nexai_test";
    expect(resolveTestDatabaseUrl()).toBe("mysql://root:test@127.0.0.1:3317/nexai_test");
  });

  it("refuses a remote host (e.g. the production server)", () => {
    process.env.TEST_DATABASE_URL = "mysql://user:pw@192.0.2.10:3306/app_test";
    expect(() => resolveTestDatabaseUrl()).toThrow(/non-local database host/);
  });

  it("refuses a database whose name does not contain 'test'", () => {
    process.env.TEST_DATABASE_URL = "mysql://root:pw@127.0.0.1:3306/m2websol_ai_generate";
    expect(() => resolveTestDatabaseUrl()).toThrow(/must contain "test"/);
  });

  it("refuses the database the app itself is configured to use", () => {
    process.env.TEST_DATABASE_URL = "mysql://root:pw@localhost:3306/shop_test";
    process.env.APP_DATABASE_URL = "mysql://other:pw@localhost:3306/shop_test";
    expect(() => resolveTestDatabaseUrl()).toThrow(/app's configured database/);
  });

  it("refuses to run when no test database is configured", () => {
    delete process.env.TEST_DATABASE_URL;
    expect(() => resolveTestDatabaseUrl()).toThrow(/TEST_DATABASE_URL is not set/);
  });
});
