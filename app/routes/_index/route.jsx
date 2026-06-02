import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import { AppProvider, Page, Card, BlockStack, Text, TextField, Button } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

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
  if (shopContext?.shop) {
    const appUrl = new URL("/app", url.origin);
    url.searchParams.forEach((value, key) => {
      appUrl.searchParams.set(key, value);
    });
    appUrl.searchParams.set("shop", shopContext.shop);
    appUrl.searchParams.set("host", shopContext.host);
    appUrl.searchParams.set("embedded", url.searchParams.get("embedded") || "1");
    throw redirect(`${appUrl.pathname}?${appUrl.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <AppProvider i18n={enTranslations}>
      <Page>
        <div style={{ maxWidth: 720, margin: "48px auto" }}>
          <Card>
            <BlockStack gap="500">
              <BlockStack gap="200">
                <Text as="h1" variant="headingLg">
                  Product AI Generate
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Create SEO-friendly product, collection, and page content for your Shopify store using AI.
                </Text>
              </BlockStack>

              {showForm && (
                <Form method="post" action="/auth/login">
                  <BlockStack gap="300">
                    <TextField
                      label="Shop domain"
                      name="shop"
                      autoComplete="off"
                      placeholder="my-shop-domain.myshopify.com"
                      helpText="Enter your Shopify store domain to continue."
                    />
                    <Button submit variant="primary">
                      Log in
                    </Button>
                  </BlockStack>
                </Form>
              )}

              <BlockStack gap="200">
                <Text as="h2" variant="headingSm">
                  What you can do
                </Text>
                <Text as="p" variant="bodyMd">
                  Generate high-quality product descriptions, optimize collection pages, and produce page content that matches your brand voice.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </div>
      </Page>
    </AppProvider>
  );
}
