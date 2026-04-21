import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import { AppProvider, Page, Card, BlockStack, Text, TextField, Button } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
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
