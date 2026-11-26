import { Session } from "@shopify/shopify-api";
import { beforeEach, describe, expect, it } from "vitest";
import db from "../app/db.server";
import {
  isStaleTokenWrite,
  OrderedPrismaSessionStorage,
  withShopTokenLock,
} from "../app/lib/shopifySessionCoordination.server";

const SHOP = "tokens.test-shop.myshopify.com";
const ID = `offline_${SHOP}`;
const MINUTE = 60 * 1000;

function offlineSession(accessToken, expiresInMs, refreshToken = `r-${accessToken}`) {
  return new Session({
    id: ID,
    shop: SHOP,
    state: "",
    isOnline: false,
    scope: "read_products",
    accessToken,
    expires: new Date(Date.now() + expiresInMs),
    refreshToken,
    refreshTokenExpires: new Date(Date.now() + 90 * 24 * 60 * MINUTE),
  });
}

const storage = new OrderedPrismaSessionStorage(db);
const storedToken = async () => (await db.session.findUnique({ where: { id: ID } }))?.accessToken;

beforeEach(async () => {
  await db.session.deleteMany({ where: { shop: SHOP } });
});

describe("isStaleTokenWrite", () => {
  it("only blocks an older, different expiring offline token", () => {
    const now = Date.now();
    const stored = { accessToken: "new", expires: new Date(now + 60 * MINUTE) };
    expect(isStaleTokenWrite({ isOnline: false, accessToken: "old", expires: new Date(now + 30 * MINUTE) }, stored)).toBe(true);
    expect(isStaleTokenWrite({ isOnline: false, accessToken: "newer", expires: new Date(now + 61 * MINUTE) }, stored)).toBe(false);
    expect(isStaleTokenWrite({ isOnline: false, accessToken: "new", expires: new Date(now + 30 * MINUTE) }, stored)).toBe(false);
    expect(isStaleTokenWrite({ isOnline: true, accessToken: "x", expires: new Date(now) }, stored)).toBe(false);
    expect(isStaleTokenWrite({ isOnline: false, accessToken: "x", expires: undefined }, stored)).toBe(false);
    expect(isStaleTokenWrite({ isOnline: false, accessToken: "x", expires: new Date(now) }, null)).toBe(false);
  });
});

describe("OrderedPrismaSessionStorage", () => {
  it("never lets an older token pair overwrite a newer one", async () => {
    await storage.storeSession(offlineSession("token-new", 60 * MINUTE));
    await storage.storeSession(offlineSession("token-old", 30 * MINUTE)); // a slow writer finishing late

    expect(await storedToken()).toBe("token-new");
    const loaded = await storage.loadSession(ID);
    expect(loaded.refreshToken).toBe("r-token-new");
  });

  it("keeps the newest pair when several processes save at the same moment", async () => {
    const pairs = Array.from({ length: 8 }, (_, i) => offlineSession(`token-${i}`, (30 + i) * MINUTE));
    const shuffled = [...pairs].sort(() => Math.random() - 0.5);

    await Promise.all(shuffled.map((s) => storage.storeSession(s)));

    expect(await storedToken()).toBe("token-7");
  });

  it("stores a newer pair and still behaves like the library for online sessions", async () => {
    await storage.storeSession(offlineSession("token-a", 30 * MINUTE));
    await storage.storeSession(offlineSession("token-b", 60 * MINUTE));
    expect(await storedToken()).toBe("token-b");

    const online = new Session({ id: `${SHOP}_42`, shop: SHOP, state: "", isOnline: true, accessToken: "online", expires: new Date() });
    await storage.storeSession(online);
    expect((await storage.loadSession(`${SHOP}_42`)).accessToken).toBe("online");
    await db.session.deleteMany({ where: { id: `${SHOP}_42` } });
  });
});

describe("concurrent token refresh", () => {
  // A stand-in for Shopify's token endpoint with its documented semantics:
  // presenting the same refresh token again returns the same rotated pair.
  function fakeShopifyTokenEndpoint() {
    let issued = 0;
    const byRefreshToken = new Map();
    return {
      get calls() { return issued; },
      async refresh(refreshToken) {
        if (!byRefreshToken.has(refreshToken)) {
          issued += 1;
          await new Promise((r) => setTimeout(r, 30));
          byRefreshToken.set(refreshToken, offlineSession(`token-refreshed-${issued}`, 60 * MINUTE));
        }
        return byRefreshToken.get(refreshToken);
      },
    };
  }

  // What each process does when it needs the shop's token (the library's
  // load → refresh-if-near-expiry → store), wrapped in the per-shop lock.
  async function getToken(endpoint) {
    return withShopTokenLock(db, SHOP, async () => {
      const session = await storage.loadSession(ID);
      if (session.isExpired(5 * MINUTE)) {
        const fresh = await endpoint.refresh(session.refreshToken);
        await storage.storeSession(fresh);
        return fresh.accessToken;
      }
      return session.accessToken;
    });
  }

  it("refreshes once when several workers need the same shop's token at the same time", async () => {
    await storage.storeSession(offlineSession("token-expiring", 2 * MINUTE)); // inside the 5-minute window
    const endpoint = fakeShopifyTokenEndpoint();

    const tokens = await Promise.all(Array.from({ length: 6 }, () => getToken(endpoint)));

    expect(endpoint.calls).toBe(1);
    expect(new Set(tokens)).toEqual(new Set(["token-refreshed-1"]));
    expect(await storedToken()).toBe("token-refreshed-1");
  });

  it("serializes holders of the same shop's lock but not different shops", async () => {
    const spans = [];
    const hold = (shop, label) => withShopTokenLock(db, shop, async () => {
      const start = Date.now();
      await new Promise((r) => setTimeout(r, 150));
      spans.push({ shop, label, start, end: Date.now() });
    });

    const t0 = Date.now();
    await Promise.all([hold(SHOP, "a"), hold(SHOP, "b"), hold("other.test-shop.myshopify.com", "c")]);

    const same = spans.filter((s) => s.shop === SHOP).sort((x, y) => x.start - y.start);
    expect(same[1].start).toBeGreaterThanOrEqual(same[0].end);
    const other = spans.find((s) => s.label === "c");
    expect(other.start - t0).toBeLessThan(140); // not queued behind the other shop
  });
});
