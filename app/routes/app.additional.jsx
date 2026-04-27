import { useNavigate, useLocation } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Box,
  Grid,
  Badge,
  Icon,
  Divider,
} from "@shopify/polaris";
import {
  ProductIcon,
  CollectionIcon,
  BlogIcon,
  PageIcon,
  ChartVerticalIcon,
  SettingsIcon,
  FolderIcon,
  ExternalIcon,
} from "@shopify/polaris-icons";
import { AppPageHeader } from "../components/AppPageHeader";

const PAGES = [
  {
    icon: ProductIcon,
    title: "Products Generator",
    description: "Bulk-generate SEO-optimized product descriptions, meta titles, and meta descriptions.",
    url: "/app/products",
    badge: "Most popular",
    badgeTone: "success",
  },
  {
    icon: CollectionIcon,
    title: "Collections Generator",
    description: "Create rich collection descriptions and SEO metadata aligned with your store.",
    url: "/app/collections",
    badge: null,
    badgeTone: null,
  },
  {
    icon: BlogIcon,
    title: "Blogs Generator",
    description: "View, create, and manage Shopify blog articles with AI-generated content.",
    url: "/app/blog",
    badge: null,
    badgeTone: null,
  },
  {
    icon: PageIcon,
    title: "Pages Generator",
    description: "Generate About, FAQ, Contact, and landing page copy in one flow.",
    url: "/app/pages",
    badge: null,
    badgeTone: null,
  },
  {
    icon: FolderIcon,
    title: "Content Management",
    description: "Review, edit, and apply AI-generated content across all resource types.",
    url: "/app/content-management",
    badge: null,
    badgeTone: null,
  },
  {
    icon: ChartVerticalIcon,
    title: "Analytics",
    description: "Track SEO coverage, generation history, and credit usage.",
    url: "/app/analytics",
    badge: null,
    badgeTone: null,
  },
  {
    icon: SettingsIcon,
    title: "Settings",
    description: "Configure language and word count defaults.",
    url: "/app/settings",
    badge: null,
    badgeTone: null,
  },
];

const RESOURCES = [
  {
    title: "App nav best practices",
    description: "Learn Shopify navigation patterns for embedded apps.",
    url: "https://shopify.dev/docs/apps/design-guidelines/navigation#app-nav",
  },
  {
    title: "App Bridge docs",
    description: "Learn how to use App Bridge for seamless Shopify integration.",
    url: "https://shopify.dev/docs/apps/tools/app-bridge",
  },
  {
    title: "Polaris component library",
    description: "Browse Shopify Polaris UI components used in this app.",
    url: "https://polaris.shopify.com/components",
  },
];

export default function AdditionalPage() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Page
      title="App Overview"
      subtitle="All pages and resources available in this app."
      fullWidth
    >
      <BlockStack gap="600">
        <AppPageHeader
          title="App Overview"
          description="All pages and resources available in this app."
        />
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Available Pages
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Use the navigation menu on the left or click below to jump to any page.
              </Text>
            </BlockStack>
            <Grid columns={{ xs: 1, sm: 2, md: 2, lg: 3, xl: 3 }}>
              {PAGES.map((item) => (
                <Grid.Cell key={item.title}>
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="start">
                        <InlineStack gap="200" blockAlign="center">
                          <Icon source={item.icon} tone="base" />
                          <Text as="h3" variant="headingSm">
                            {item.title}
                          </Text>
                        </InlineStack>
                        {item.badge ? (
                          <Badge tone={item.badgeTone}>{item.badge}</Badge>
                        ) : null}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {item.description}
                      </Text>
                      <InlineStack align="end">
                        <Button
                          size="slim"
                          onClick={() =>
                            navigate({ pathname: item.url, search: location.search })
                          }
                        >
                          Open
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              ))}
            </Grid>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Developer Resources
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Useful links for extending and customizing this app.
              </Text>
            </BlockStack>
            <Divider />
            <Grid columns={{ xs: 1, sm: 1, md: 3, lg: 3, xl: 3 }}>
              {RESOURCES.map((res) => (
                <Grid.Cell key={res.title}>
                  <BlockStack gap="150">
                    <Text as="h3" variant="headingSm">
                      {res.title}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {res.description}
                    </Text>
                    <Button
                      size="slim"
                      url={res.url}
                      external
                      icon={ExternalIcon}
                    >
                      View
                    </Button>
                  </BlockStack>
                </Grid.Cell>
              ))}
            </Grid>
          </BlockStack>
        </Card>

        <Box paddingBlockEnd="800" />
      </BlockStack>
    </Page>
  );
}
