// Coordinates expiring offline access tokens between processes (web app,
// webhooks, bulk worker) that share one session table.
//
// Shopify guidance for expiring offline tokens: serialize refreshes per shop,
// persist each returned token pair atomically, and always keep the newest pair.
// The app template does none of that across processes:
//   * the embedded app gets new pairs by token exchange,
//   * the worker and webhooks get them with the stored refresh token,
// and every path saves through `storeSession` with no ordering. A slow writer
// could therefore overwrite a newer pair with an older one that Shopify has
// already retired.
//
// Two safeguards, both using MariaDB named locks (GET_LOCK), which every process
// sharing the database sees:
//   1. OrderedPrismaSessionStorage — an offline session write is serialized per
//      session id and never replaces a pair that expires later (newest wins).
//   2. withShopTokenLock — the worker loads/refreshes a shop's token under a
//      per-shop lock, so its own concurrent jobs refresh one at a time.
// Concurrent refreshes that do race are still safe: Shopify returns the same
// rotated credentials when the same refresh token is presented again.

import { createHash } from "node:crypto";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";

const LOCK_WAIT_SECONDS = 30;

function lockName(prefix, key) {
  // MariaDB lock names are limited to 64 characters.
  return `${prefix}:${createHash("sha1").update(String(key)).digest("hex")}`;
}

/**
 * Run `fn(tx)` while holding a MariaDB named lock. The lock lives on the
 * connection pinned by the interactive transaction `tx`; do database work
 * through `tx` so the caller holds a single pooled connection.
 */
export async function withNamedLock(prisma, name, fn, { waitSeconds = LOCK_WAIT_SECONDS } = {}) {
  return prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw`SELECT GET_LOCK(${name}, ${waitSeconds}) AS acquired`;
    if (Number(row?.acquired) !== 1) {
      const error = new Error(`Timed out waiting for lock ${name}`);
      error.code = "LOCK_TIMEOUT";
      throw error;
    }
    try {
      return await fn(tx);
    } finally {
      await tx.$queryRaw`SELECT RELEASE_LOCK(${name}) AS released`;
    }
  }, { maxWait: (waitSeconds + 5) * 1000, timeout: (waitSeconds + 60) * 1000 });
}

/** Serialize token load/refresh for one shop across workers and processes. */
export function withShopTokenLock(prisma, shop, fn) {
  return withNamedLock(prisma, lockName("shop-token", shop), fn);
}

function expiresAt(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * True when `incoming` must not replace `stored`: both are expiring offline
 * tokens, they differ, and the stored one expires later (it was issued later).
 */
export function isStaleTokenWrite(incoming, stored) {
  if (!stored || incoming.isOnline) return false;
  const incomingExpires = expiresAt(incoming.expires);
  const storedExpires = expiresAt(stored.expires);
  if (incomingExpires === null || storedExpires === null) return false;
  if (incoming.accessToken === stored.accessToken) return false;
  return storedExpires > incomingExpires;
}

export class OrderedPrismaSessionStorage extends PrismaSessionStorage {
  constructor(prisma, options) {
    super(prisma, options);
    this.client = prisma;
  }

  async storeSession(session) {
    // Online sessions and non-expiring tokens keep the library's behaviour.
    if (session.isOnline || !session.expires) return super.storeSession(session);

    await this.ensureReady();
    const data = this.sessionToRow(session);
    // Read, compare and write on the lock's own connection: one pooled
    // connection per save, which matters with the web app's small pool.
    return withNamedLock(this.client, lockName("session-store", session.id), async (tx) => {
      const stored = await tx.session.findUnique({
        where: { id: session.id },
        select: { accessToken: true, expires: true },
      });
      if (isStaleTokenWrite(session, stored)) {
        console.warn(`[session] kept newer offline token for ${session.shop}; ignored an older token pair`);
        return true;
      }
      await tx.session.upsert({ where: { id: session.id }, update: data, create: data });
      return true;
    });
  }
}
