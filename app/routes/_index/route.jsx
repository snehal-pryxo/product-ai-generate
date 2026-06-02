import { redirect } from "react-router";

function buildEmbeddedHost(storeHandle, shop) {
  const hostSource = storeHandle ? `admin.shopify.com/store/${storeHandle}` : `${shop}/admin`;
  return Buffer.from(hostSource).toString("base64");
}

function getStoreHandleFromAdminUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.hostname !== "admin.shopify.com") return "";
    const [, storeKeyword, storeHandle] = url.pathname.split("/");
    return storeKeyword === "store" ? String(storeHandle || "").trim() : "";
  } catch {
    return "";
  }
}

function inferShopContext(request, url) {
  const explicitShop = String(url.searchParams.get("shop") || "").trim();
  if (explicitShop) {
    return {
      shop: explicitShop,
      host: url.searchParams.get("host") || buildEmbeddedHost("", explicitShop),
    };
  }

  const storeHandle =
    getStoreHandleFromAdminUrl(request.headers.get("referer")) ||
    getStoreHandleFromAdminUrl(request.headers.get("origin"));
  if (!storeHandle) return null;

  const shop = `${storeHandle}.myshopify.com`;
  return {
    shop,
    host: url.searchParams.get("host") || buildEmbeddedHost(storeHandle, shop),
  };
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shopContext = inferShopContext(request, url);
  const appUrl = new URL("/app", url.origin);

  url.searchParams.forEach((value, key) => {
    appUrl.searchParams.set(key, value);
  });

  if (shopContext?.shop) {
    appUrl.searchParams.set("shop", shopContext.shop);
    appUrl.searchParams.set("host", shopContext.host);
    appUrl.searchParams.set("embedded", url.searchParams.get("embedded") || "1");
  }

  throw redirect(`${appUrl.pathname}${appUrl.search}`);
};

export default function IndexRedirect() {
  return null;
}
