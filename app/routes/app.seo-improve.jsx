import { useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  Icon,
  InlineStack,
  Layout,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import {
  ChartVerticalIcon,
  ClockIcon,
  CodeIcon,
  DatabaseIcon,
  SearchIcon,
  ShieldCheckMarkIcon,
  ThemeIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { AppPageHeader } from "../components/AppPageHeader";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

const scoreCards = [
  { label: "Content", weight: "40%", value: 86, tone: "success" },
  { label: "Images", weight: "20%", value: 72, tone: "attention" },
  { label: "Performance", weight: "20%", value: 90, tone: "success" },
  { label: "Schema", weight: "20%", value: 78, tone: "info" },
];

const schemaTables = [
  {
    name: "shops",
    description: "Stores authenticated shop identity, token, plan, and timestamps.",
    fields: ["id PK", "shop_domain unique", "access_token", "plan", "created_at", "updated_at"],
  },
  {
    name: "seo_scores",
    description: "Stores score snapshots by SEO area and total weighted result.",
    fields: ["id PK", "shop_id FK", "content_score", "image_score", "performance_score", "schema_score", "total_score", "updated_at"],
  },
  {
    name: "content_items",
    description: "Stores synced Shopify resources and SEO metadata fields.",
    fields: ["id PK", "shop_id FK", "resource_type", "resource_id", "title", "keyword", "seo_title", "seo_description", "issues_count", "last_synced_at"],
  },
  {
    name: "content_issues",
    description: "Stores detected SEO issues for each content item.",
    fields: ["id PK", "content_item_id FK", "issue_type", "issue_message"],
  },
  {
    name: "images",
    description: "Stores synced product image data and optimization status.",
    fields: ["id PK", "shop_id FK", "product_id", "image_id", "src", "alt_text", "is_alt_generated", "is_compressed", "created_at"],
  },
  {
    name: "performance_settings",
    description: "Stores performance feature toggles for storefront optimization.",
    fields: ["id PK", "shop_id FK", "instant_page_enabled", "quick_link_enabled"],
  },
  {
    name: "schema_settings",
    description: "Stores JSON-LD structured data configuration by shop.",
    fields: ["id PK", "shop_id FK", "product_schema", "breadcrumb", "organization", "article", "local_business", "pricing_type", "stock_availability", "return_policy"],
  },
];

const apiEndpoints = [
  {
    method: "POST",
    path: "/api/content/sync",
    title: "Sync Content",
    details: ["Fetch products, collections, pages, and blogs from Shopify.", "Store normalized resources in content_items."],
  },
  {
    method: "POST",
    path: "/api/content/analyze",
    title: "Analyze SEO Issues",
    details: ["Loop all content_items.", "Detect missing title, short title, missing description, and missing keyword.", "Store content_issues and update issues_count."],
  },
  {
    method: "POST",
    path: "/api/content/update",
    title: "Update SEO",
    details: ["Accept resource_id, seo_title, and seo_description.", "Call Shopify GraphQL mutation to update SEO metadata."],
  },
  {
    method: "GET",
    path: "/api/content?type=product",
    title: "Get Content List",
    details: ["Return filtered content_items by resource type.", "Include issue counts for review workflows."],
  },
  {
    method: "POST",
    path: "/api/images/sync",
    title: "Image Sync",
    details: ["Fetch Shopify product images.", "Store image source, alt text, and optimization flags."],
  },
  {
    method: "POST",
    path: "/api/images/generate-alt",
    title: "Generate Alt Text",
    details: ["Generate alt text with `${productTitle} by ${vendor}`.", "Update Shopify images through the Admin API."],
  },
  {
    method: "GET / POST",
    path: "/api/performance",
    title: "Performance Settings",
    details: ["Read and update instant page and quick link settings.", "Persist settings per shop."],
  },
  {
    method: "GET / POST",
    path: "/api/schema",
    title: "Schema Settings",
    details: ["Read and update structured data toggles.", "Control product, breadcrumb, organization, article, and local business schema."],
  },
  {
    method: "GET",
    path: "/api/seo-score",
    title: "Calculate SEO Score",
    details: ["Calculate total score from weighted content, image, performance, and schema scores.", "Save the latest result to seo_scores."],
  },
];

const processingLogic = [
  "Sync Shopify resources into content_items and images.",
  "Analyze content_items for missing title, title length under 30, missing description, and missing keyword.",
  "Create or replace content_issues for every scan.",
  "Update issues_count on each content item after analysis.",
  "Generate product image alt text from product title and vendor.",
  "Calculate score = content_score * 0.4 + image_score * 0.2 + performance_score * 0.2 + schema_score * 0.2.",
];

const backgroundJobs = [
  "Daily SEO scan",
  "Auto-generate alt text",
  "Recalculate SEO score",
];

const themeExtensionItems = [
  "Inject hover prefetch JavaScript.",
  "Preload important links for faster navigation.",
  "Inject Product JSON-LD schema.",
  "Inject Breadcrumb JSON-LD schema.",
];

const securityItems = [
  "Validate Shopify HMAC on all API requests.",
  "Store access tokens securely on the server.",
  "Rate limit Shopify API calls and background jobs.",
  "Use authenticated Admin API sessions for merchant actions.",
];

function SectionHeading({ icon, title, description }) {
  return (
    <InlineStack gap="300" blockAlign="center" wrap={false}>
      <Box background="bg-surface-secondary" borderRadius="200" padding="200">
        <Icon source={icon} tone="base" />
      </Box>
      <BlockStack gap="050">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>
        <Text as="p" tone="subdued">
          {description}
        </Text>
      </BlockStack>
    </InlineStack>
  );
}

function navigateWithCurrentSearch(navigate, location, pathname) {
  navigate({ pathname, search: location.search });
}

export default function SeoImprovePage() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Page
      title="SEO Improve"
      subtitle="Backend architecture for Shopify SEO optimization."
      backAction={{ content: "Dashboard", onAction: () => navigateWithCurrentSearch(navigate, location, "/app") }}
      primaryAction={{ content: "Open Analytics", onAction: () => navigateWithCurrentSearch(navigate, location, "/app/analytics") }}
    >
      <BlockStack gap="600">
        <AppPageHeader
          title="SEO Improve"
          description="Architecture blueprint for optimizing Shopify content, images, performance, schema, and SEO scoring."
        />

        <Card>
          <BlockStack gap="500">
            <InlineStack align="space-between" gap="300" blockAlign="start">
              <BlockStack gap="200">
                <Text as="h2" variant="headingLg">
                  Shopify SEO Optimization App
                </Text>
                <Text as="p" tone="subdued">
                  A scalable architecture that syncs Shopify data, detects SEO issues, improves image SEO, injects structured data, and calculates real-time SEO scores.
                </Text>
              </BlockStack>
              <Badge tone="success">Architecture ready</Badge>
            </InlineStack>

            <Grid columns={{ xs: 1, sm: 2, md: 4, lg: 4, xl: 4 }}>
              {scoreCards.map((item) => (
                <Grid.Cell key={item.label}>
                  <Box background="bg-surface-secondary" borderRadius="300" padding="400">
                    <BlockStack gap="150">
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          {item.label}
                        </Text>
                        <Badge tone={item.tone}>{item.weight}</Badge>
                      </InlineStack>
                      <Text as="p" variant="headingXl">
                        {item.value}
                      </Text>
                    </BlockStack>
                  </Box>
                </Grid.Cell>
              ))}
            </Grid>
          </BlockStack>
        </Card>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <SectionHeading
                  icon={DatabaseIcon}
                  title="Database Schema"
                  description="MySQL tables for shops, scores, content, issues, images, performance, and schema settings."
                />
                <Divider />
                <Grid columns={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2 }}>
                  {schemaTables.map((table) => (
                    <Grid.Cell key={table.name}>
                      <Card>
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h3" variant="headingSm">
                              {table.name}
                            </Text>
                            <Badge>MySQL</Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {table.description}
                          </Text>
                          <List>
                            {table.fields.map((field) => (
                              <List.Item key={field}>{field}</List.Item>
                            ))}
                          </List>
                        </BlockStack>
                      </Card>
                    </Grid.Cell>
                  ))}
                </Grid>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="500">
            <SectionHeading
              icon={CodeIcon}
              title="API Endpoints"
              description="Authenticated endpoints for sync, analysis, updates, settings, images, and scoring."
            />
            <Divider />
            <Grid columns={{ xs: 1, sm: 1, md: 2, lg: 3, xl: 3 }}>
              {apiEndpoints.map((endpoint) => (
                <Grid.Cell key={`${endpoint.method}-${endpoint.path}`}>
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack gap="200" blockAlign="center" wrap>
                        <Badge tone={endpoint.method.includes("POST") ? "info" : "success"}>{endpoint.method}</Badge>
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {endpoint.path}
                        </Text>
                      </InlineStack>
                      <Text as="h3" variant="headingSm">
                        {endpoint.title}
                      </Text>
                      <List>
                        {endpoint.details.map((detail) => (
                          <List.Item key={detail}>{detail}</List.Item>
                        ))}
                      </List>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              ))}
            </Grid>
          </BlockStack>
        </Card>

        <Grid columns={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2 }}>
          <Grid.Cell>
            <Card>
              <BlockStack gap="400">
                <SectionHeading
                  icon={SearchIcon}
                  title="Processing Logic"
                  description="Core backend workflow for content and score processing."
                />
                <List>
                  {processingLogic.map((item) => (
                    <List.Item key={item}>{item}</List.Item>
                  ))}
                </List>
              </BlockStack>
            </Card>
          </Grid.Cell>

          <Grid.Cell>
            <Card>
              <BlockStack gap="400">
                <SectionHeading
                  icon={ClockIcon}
                  title="Background Jobs"
                  description="Scheduled work for recurring SEO improvements."
                />
                <List>
                  {backgroundJobs.map((item) => (
                    <List.Item key={item}>{item}</List.Item>
                  ))}
                </List>
              </BlockStack>
            </Card>
          </Grid.Cell>

          <Grid.Cell>
            <Card>
              <BlockStack gap="400">
                <SectionHeading
                  icon={ThemeIcon}
                  title="Theme App Extension"
                  description="Storefront injection for speed and structured data."
                />
                <List>
                  {themeExtensionItems.map((item) => (
                    <List.Item key={item}>{item}</List.Item>
                  ))}
                </List>
              </BlockStack>
            </Card>
          </Grid.Cell>

          <Grid.Cell>
            <Card>
              <BlockStack gap="400">
                <SectionHeading
                  icon={ShieldCheckMarkIcon}
                  title="Security"
                  description="Controls for authentication, token safety, and API limits."
                />
                <List>
                  {securityItems.map((item) => (
                    <List.Item key={item}>{item}</List.Item>
                  ))}
                </List>
              </BlockStack>
            </Card>
          </Grid.Cell>
        </Grid>

        <Card>
          <BlockStack gap="400">
            <SectionHeading
              icon={ChartVerticalIcon}
              title="Goal"
              description="The app improves SEO through content quality, image metadata, performance enhancements, structured data, and real-time scoring."
            />
            <InlineStack gap="200" wrap>
              {["Optimizes content", "Improves performance", "Enhances image SEO", "Adds structured data", "Provides real-time SEO scoring"].map((goal) => (
                <Badge key={goal} tone="info">
                  {goal}
                </Badge>
              ))}
            </InlineStack>
          </BlockStack>
        </Card>

        <Box paddingBlockEnd="800" />
      </BlockStack>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
