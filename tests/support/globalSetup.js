// Prepares the throwaway test database once per run: applies every Prisma
// migration (which exercises the new worker migration on a clean database), then
// `db push` to cover pre-existing columns that live in schema.prisma but were
// never captured in a migration file.
import { execSync } from "node:child_process";
import { resolveTestDatabaseUrl } from "./testDatabase.js";

export default function setup() {
  const url = resolveTestDatabaseUrl();
  const env = { ...process.env, DATABASE_URL: url };
  const run = (cmd) => execSync(cmd, { env, stdio: "pipe" }).toString();
  run("npx prisma migrate deploy");
  run("npx prisma db push --skip-generate --accept-data-loss");
}
