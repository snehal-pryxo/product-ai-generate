import { useMemo, useState } from "react";
import { useFetcher, useLoaderData, useLocation, useNavigate, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Grid,
  Icon,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import {
  AlertTriangleIcon,
  ClockIcon,
  CodeIcon,
  FileIcon,
  FolderIcon,
  ImageIcon,
  InfoIcon,
  LocationIcon,
  OrganizationIcon,
  ProductIcon,
  RefreshIcon,
  SearchIcon,
  SortIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { AppPageHeader } from "../components/AppPageHeader";

const SEO_SETTINGS_KEY = "seoImproveSettings";

const DEFAULT_SEO_SETTINGS = {
  performance: {
    instantPageEnabled: true,
    quickLinkEnabled: true,
  },
  images: {
    compressionEnabled: false,
    altEnabled: false,
    generationMode: "template",
    productStatus: "all",
    onlyMissingAlt: true,
    templatePattern: "{{productTitle}} by {{productVendor}}",
  },
  schema: {
    activeType: "product",
    enabledTypes: {
      breadcrumb: false,
      product: false,
      sitelinks: false,
      organization: false,
      article: false,
      local: false,
    },
    pricingType: "single",
    salePriceExpiry: false,
    stockAvailability: false,
    returnPolicy: false,
    excludeCollectionPages: false,
  },
};

const PRODUCTS_QUERY = `#graphql
  query SeoImproveProducts($first: Int!) {
    products(first: $first) {
      nodes {
        id
        title
        vendor
        status
        seo {
          title
          description
        }
        images(first: 100) {
          nodes {
            id
            url
            altText
          }
        }
      }
    }
  }
`;

const COLLECTIONS_QUERY = `#graphql
  query SeoImproveCollections($first: Int!) {
    collections(first: $first) {
      nodes {
        id
        title
        seo {
          title
          description
        }
      }
    }
  }
`;

const PAGES_QUERY = `#graphql
  query SeoImprovePages($first: Int!) {
    pages(first: $first) {
      nodes {
        id
        title
        metafields(first: 10, namespace: "global") {
          nodes {
            key
            value
          }
        }
      }
    }
  }
`;

const ARTICLES_QUERY = `#graphql
  query SeoImproveArticles($first: Int!) {
    articles(first: $first) {
      nodes {
        id
        title
        metafields(first: 10, namespace: "global") {
          nodes {
            key
            value
          }
        }
      }
    }
  }
`;

function deepMergeSettings(base, value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    performance: { ...base.performance, ...(input.performance || {}) },
    images: { ...base.images, ...(input.images || {}) },
    schema: {
      ...base.schema,
      ...(input.schema || {}),
      enabledTypes: {
        ...base.schema.enabledTypes,
        ...((input.schema && input.schema.enabledTypes) || {}),
      },
    },
  };
}

function readSeoSettingsFromShop(shopData) {
  try {
    const parsed = JSON.parse(shopData?.globalSettingsJson || "{}");
    return deepMergeSettings(DEFAULT_SEO_SETTINGS, parsed[SEO_SETTINGS_KEY]);
  } catch {
    return DEFAULT_SEO_SETTINGS;
  }
}

function textValue(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function metafieldValue(node, key) {
  return (node?.metafields?.nodes || []).find((item) => item.key === key)?.value || "";
}

function getSeoFields(type, node) {
  if (type === "collections" || type === "products") {
    return {
      seoTitle: node?.seo?.title || "",
      seoDescription: node?.seo?.description || "",
    };
  }
  return {
    seoTitle: metafieldValue(node, "title_tag"),
    seoDescription: metafieldValue(node, "description_tag"),
  };
}

function getIssues({ title, keyword, seoTitle, seoDescription }) {
  const issues = [];
  if (!textValue(seoTitle)) issues.push("Missing SEO title");
  if (textValue(seoTitle) && textValue(seoTitle).length < 30) issues.push("SEO title is shorter than 30 characters");
  if (!textValue(seoDescription)) issues.push("Missing SEO description");
  if (!textValue(keyword)) issues.push("Missing keyword");
  if (textValue(title) && textValue(seoTitle) && !textValue(seoTitle).toLowerCase().includes(textValue(title).toLowerCase().split(" ")[0])) {
    issues.push("SEO title may not match the resource topic");
  }
  return issues;
}

function normalizeContentItem(type, node) {
  const { seoTitle, seoDescription } = getSeoFields(type, node);
  const keyword = node?.title || "";
  const issues = getIssues({ title: node?.title, keyword, seoTitle, seoDescription });
  return {
    id: node?.id || "",
    title: node?.title || "Untitled",
    keyword,
    seoTitle,
    seoDescription,
    issues,
    issuesCount: issues.length,
  };
}

async function graphqlJson(admin, query, variables) {
  const response = await admin.graphql(query, { variables });
  return response.json();
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDataPromise = db.shop.findUnique({
    where: { shop: session.shop },
    select: { globalSettingsJson: true, billingPlanKey: true },
  });

  const [shopData, productsJson, collectionsJson, pagesJson, articlesJson] = await Promise.all([
    shopDataPromise,
    graphqlJson(admin, PRODUCTS_QUERY, { first: 100 }).catch(() => ({ data: { products: { nodes: [] } } })),
    graphqlJson(admin, COLLECTIONS_QUERY, { first: 100 }).catch(() => ({ data: { collections: { nodes: [] } } })),
    graphqlJson(admin, PAGES_QUERY, { first: 100 }).catch(() => ({ data: { pages: { nodes: [] } } })),
    graphqlJson(admin, ARTICLES_QUERY, { first: 100 }).catch(() => ({ data: { articles: { nodes: [] } } })),
  ]);

  const products = productsJson?.data?.products?.nodes || [];
  const collections = collectionsJson?.data?.collections?.nodes || [];
  const pages = pagesJson?.data?.pages?.nodes || [];
  const articles = articlesJson?.data?.articles?.nodes || [];

  const content = {
    products: products.map((node) => normalizeContentItem("products", node)),
    collections: collections.map((node) => normalizeContentItem("collections", node)),
    pages: pages.map((node) => normalizeContentItem("pages", node)),
    blogs: articles.map((node) => normalizeContentItem("blogs", node)),
  };

  const images = products.flatMap((product) =>
    (product.images?.nodes || []).map((image) => ({
      id: image.id,
      productId: product.id,
      productTitle: product.title || "Untitled product",
      productVendor: product.vendor || "",
      status: product.status || "",
      src: image.url || "",
      altText: image.altText || "",
      isAltGenerated: Boolean(textValue(image.altText)),
      isCompressed: false,
    })),
  );

  const allContentItems = [...content.products, ...content.collections, ...content.pages, ...content.blogs];
  const totalIssues = allContentItems.reduce((sum, item) => sum + item.issuesCount, 0);
  const cleanContent = allContentItems.filter((item) => item.issuesCount === 0).length;
  const totalImages = images.length;
  const altGenerated = images.filter((image) => textValue(image.altText)).length;
  const altMissing = Math.max(totalImages - altGenerated, 0);
  const settings = readSeoSettingsFromShop(shopData);
  const performanceEnabled = Number(settings.performance.instantPageEnabled) + Number(settings.performance.quickLinkEnabled);
  const schemaEnabled = Object.values(settings.schema.enabledTypes).filter(Boolean).length;

  const contentScore = allContentItems.length ? Math.round((cleanContent / allContentItems.length) * 100) : 0;
  const imageScore = totalImages ? Math.round((altGenerated / totalImages) * 100) : 0;
  const performanceScore = Math.round((performanceEnabled / 2) * 100);
  const schemaScore = Math.round((schemaEnabled / Object.keys(settings.schema.enabledTypes).length) * 100);
  const totalScore = Math.round(contentScore * 0.4 + imageScore * 0.2 + performanceScore * 0.2 + schemaScore * 0.2);

  return {
    content,
    images,
    settings,
    plan: shopData?.billingPlanKey || "free",
    summary: {
      totalScore,
      contentScore,
      imageScore,
      performanceScore,
      schemaScore,
      totalContent: allContentItems.length,
      cleanContent,
      totalIssues,
      totalImages,
      altGenerated,
      altMissing,
      performanceEnabled,
      schemaEnabled,
      spaceSaved: "0 Bytes",
    },
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent !== "save_seo_settings") {
    return { success: false, error: "Unknown SEO Improve action." };
  }

  let nextSettings;
  try {
    nextSettings = deepMergeSettings(DEFAULT_SEO_SETTINGS, JSON.parse(String(formData.get("settingsJson") || "{}")));
  } catch {
    return { success: false, error: "Invalid settings payload." };
  }

  const currentShop = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { globalSettingsJson: true },
  });

  let globalSettings = {};
  try {
    globalSettings = JSON.parse(currentShop?.globalSettingsJson || "{}");
  } catch {
    globalSettings = {};
  }
  globalSettings[SEO_SETTINGS_KEY] = nextSettings;

  await db.shop.upsert({
    where: { shop: session.shop },
    update: { globalSettingsJson: JSON.stringify(globalSettings) },
    create: {
      shop: session.shop,
      installed: true,
      globalSettingsJson: JSON.stringify(globalSettings),
    },
  });

  return { success: true, settings: nextSettings };
};

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "content", label: "Content Optimization" },
  { id: "performance", label: "Performance Optimization" },
  { id: "images", label: "Image Optimization" },
  { id: "assets", label: "Asset Compression" },
  { id: "schema", label: "JSON-LD Schema" },
];

const dashboardCards = [
  {
    id: "content",
    icon: FileIcon,
    title: "Content Optimization",
    description: "Optimize meta titles, descriptions & keywords for better rankings",
    action: "Optimize Content",
  },
  {
    id: "performance",
    icon: ClockIcon,
    title: "Performance Boost",
    description: "Speed up your store with instant page loading",
    action: "Configure",
  },
  {
    id: "images",
    icon: ImageIcon,
    title: "Image Optimization",
    description: "Generate AI alt text & compress images for better SEO",
    action: "Manage Images",
  },
  {
    id: "assets",
    icon: FileIcon,
    title: "Asset Compression",
    description: "Minify CSS & JavaScript files for faster page loads",
    action: "Compress Assets",
  },
  {
    id: "schema",
    icon: CodeIcon,
    title: "JSON-LD Schema",
    description: "Add structured data for rich search results",
    action: "Configure Schema",
  },
];

const schemaTypes = [
  { id: "breadcrumb", label: "Breadcrumb", desc: "Site hierarchy", icon: FolderIcon },
  { id: "product", label: "Product", desc: "Price, stock, & reviews", icon: ProductIcon },
  { id: "sitelinks", label: "Sitelinks Search Box", desc: "Search box in results", icon: SearchIcon },
  { id: "organization", label: "Organization", desc: "Brand identity", icon: OrganizationIcon },
  { id: "article", label: "Article", desc: "Headline, author, & date", icon: FileIcon },
  { id: "local", label: "Local Business", desc: "Location & hours", icon: LocationIcon },
];

function navigateWithCurrentSearch(navigate, location, pathname) {
  navigate({ pathname, search: location.search });
}

function SectionTabs({ active, onChange }) {
  return (
    <div className="seo-tabs" role="tablist" aria-label="SEO Improve sections">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          className={`seo-tab ${active === item.id ? "seo-tab--active" : ""}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function ScoreRing({ value, tone = "red", label = "" }) {
  return (
    <div className={`score-ring score-ring--${tone}`} style={{ "--score": `${value * 3.6}deg` }}>
      <div className="score-ring__inner">
        <Text as="span" variant="headingLg">
          {value}%
        </Text>
        {label ? (
          <Text as="span" variant="bodySm" tone="subdued">
            {label}
          </Text>
        ) : null}
      </div>
    </div>
  );
}

function getHealthTone(score) {
  if (score >= 80) return "success";
  if (score >= 50) return "attention";
  return "critical";
}

function getHealthLabel(score) {
  if (score >= 80) return "OPTIMIZED";
  if (score >= 50) return "IMPROVING";
  return "GETTING STARTED";
}

function DashboardView({ summary, onOpen, onSync }) {
  const cardMetrics = {
    content: {
      label: "Items synced",
      value: `${summary.cleanContent}/${summary.totalContent}`,
      showProgress: summary.totalContent > 0,
    },
    performance: {
      label: "Features enabled",
      value: `${summary.performanceEnabled}/2`,
      showProgress: true,
    },
    images: {
      label: summary.totalImages > 0 ? "Alt text generated" : "Sync images to get started",
      value: summary.totalImages > 0 ? `${summary.altGenerated}/${summary.totalImages}` : "",
      showProgress: summary.totalImages > 0,
    },
    assets: {
      label: "Optimize store assets",
      value: summary.spaceSaved,
      showProgress: false,
    },
    schema: {
      label: "Schema types enabled",
      value: `${summary.schemaEnabled}/${schemaTypes.length}`,
      showProgress: true,
    },
  };

  return (
    <BlockStack gap="500">
      <Card>
        <BlockStack gap="500">
          <InlineStack gap="500" blockAlign="center" wrap={false}>
            <ScoreRing value={summary.totalScore} tone={summary.totalScore >= 80 ? "green" : "red"} />
            <BlockStack gap="250">
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="h2" variant="headingLg">
                  SEO Health Score
                </Text>
                <Badge tone={getHealthTone(summary.totalScore)}>{getHealthLabel(summary.totalScore)}</Badge>
              </InlineStack>
              <Text as="p" tone="subdued">
                {summary.totalScore >= 80 ? "Your store SEO setup is in strong shape." : "Let's boost your SEO score!"}
              </Text>
              <InlineStack gap="500" blockAlign="center" wrap>
                <Text as="span" tone="subdued">
                  {summary.performanceEnabled + summary.schemaEnabled}/{schemaTypes.length + 2} features enabled
                </Text>
                <Button variant="plain" onClick={onSync}>Sync</Button>
                <Button variant="plain">View Details</Button>
              </InlineStack>
            </BlockStack>
          </InlineStack>
          <Divider />
          <Grid columns={{ xs: 2, sm: 2, md: 4, lg: 4, xl: 4 }}>
            {[
              ["Content Synced", String(summary.totalContent)],
              ["Alt Texts Generated", String(summary.altGenerated)],
              ["Performance", `${summary.performanceEnabled}/2`],
              ["Space Saved", summary.spaceSaved],
            ].map(([label, value]) => (
              <Grid.Cell key={label}>
                <BlockStack gap="100" align="center">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {label}
                  </Text>
                  <Text as="span" variant="headingMd">
                    {value}
                  </Text>
                </BlockStack>
              </Grid.Cell>
            ))}
          </Grid>
        </BlockStack>
      </Card>

      <Grid columns={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2 }}>
        {dashboardCards.map((item) => (
          <Grid.Cell key={item.id}>
            <Card>
              <BlockStack gap="350">
                <InlineStack gap="300" blockAlign="start" wrap={false}>
                  <Box background="bg-surface-secondary" borderRadius="200" padding="250">
                    <Icon source={item.icon} tone="subdued" />
                  </Box>
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">
                      {item.title}
                    </Text>
                    <Text as="p" tone="subdued">
                      {item.description}
                    </Text>
                  </BlockStack>
                </InlineStack>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" tone="subdued">
                    {cardMetrics[item.id].label}
                  </Text>
                  {cardMetrics[item.id].value ? (
                    <Text as="span" tone="success" fontWeight="semibold">
                      {cardMetrics[item.id].value}
                    </Text>
                  ) : null}
                </InlineStack>
                {cardMetrics[item.id].showProgress ? <div className="seo-progress" /> : null}
                <InlineStack align="start">
                  <Button onClick={() => onOpen(item.id)}>{item.action} &rarr;</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Grid.Cell>
        ))}
      </Grid>
    </BlockStack>
  );
}

function IssueDot({ count }) {
  return <span className={`issue-dot ${count >= 3 ? "issue-dot--critical" : "issue-dot--warning"}`} />;
}

function truncateText(value, max = 42) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function ContentView({ content }) {
  const [contentTab, setContentTab] = useState("collections");
  const [query, setQuery] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const rows = useMemo(() => {
    const source = content[contentTab] || [];
    const filtered = source.filter((item) => {
      const haystack = `${item.title} ${item.keyword} ${item.seoTitle} ${item.seoDescription}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    });
    return filtered.sort((a, b) => sortDesc ? b.issuesCount - a.issuesCount : a.issuesCount - b.issuesCount);
  }, [content, contentTab, query, sortDesc]);
  const label = contentTab === "collections" ? "collections" : contentTab;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="250" blockAlign="center">
            <Icon source={FileIcon} tone="base" />
            <Text as="h2" variant="headingMd">
              Content Optimization
            </Text>
          </InlineStack>
          <Text as="span" variant="headingSm">
            {rows.length} {label}
          </Text>
        </InlineStack>

        <InlineStack align="space-between" blockAlign="center" wrap>
          <div className="segmented-control" role="tablist" aria-label="Content type">
            {[
              ["collections", "Collections"],
              ["pages", "Pages"],
              ["blogs", "Blogs"],
            ].map(([id, text]) => (
              <button
                key={id}
                type="button"
                className={`segment ${contentTab === id ? "segment--active" : ""}`}
                onClick={() => setContentTab(id)}
              >
                {contentTab === id ? "Selected " : ""}
                {text}
              </button>
            ))}
          </div>
          <InlineStack gap="200">
            <div className="compact-search-shell">
              <Icon source={SearchIcon} tone="subdued" />
              <TextField label="Search content" labelHidden value={query} onChange={setQuery} autoComplete="off" placeholder="Search..." />
            </div>
            <Button icon={SortIcon} accessibilityLabel="Sort content" onClick={() => setSortDesc((value) => !value)} />
          </InlineStack>
        </InlineStack>

        <div className="seo-table">
          <div className="seo-table__head">
            <Text as="span" fontWeight="semibold">Title</Text>
            <Text as="span" fontWeight="semibold">Keyword</Text>
            <Text as="span" fontWeight="semibold">SEO Issues</Text>
            <Text as="span" fontWeight="semibold">Actions</Text>
          </div>
          {rows.map((item) => (
            <div className="seo-table__row" key={`${contentTab}-${item.id}`}>
              <Text as="span" fontWeight="semibold">{truncateText(item.title)}</Text>
              <Text as="span">{truncateText(item.keyword)}</Text>
              <InlineStack gap="150" blockAlign="center" wrap={false}>
                <IssueDot count={item.issuesCount} />
                <Text as="span" fontWeight="semibold">
                  {item.issuesCount} {item.issuesCount === 1 ? "suggestion" : "suggestions"}
                </Text>
              </InlineStack>
              <Button accessibilityLabel={item.issues.length ? item.issues.join(". ") : "No SEO issues found"}>
                View Details
              </Button>
            </div>
          ))}
          {rows.length === 0 ? (
            <Box padding="500">
              <Text as="p" alignment="center" tone="subdued">No {label} found for this search.</Text>
            </Box>
          ) : null}
        </div>

        {contentTab === "pages" ? (
          <InlineStack align="center" gap="300">
            <Button disabled>Previous</Button>
            <Button variant="primary">1</Button>
            <Button disabled>Next</Button>
          </InlineStack>
        ) : null}
      </BlockStack>
    </Card>
  );
}

function ToggleSwitch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      className={`seo-switch ${checked ? "seo-switch--checked" : ""}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      aria-label={label}
    >
      <span />
    </button>
  );
}

function PerformanceView({ settings, onSettingsChange }) {
  const instantPage = Boolean(settings.performance.instantPageEnabled);
  const quickLink = Boolean(settings.performance.quickLinkEnabled);
  const activeCount = Number(instantPage) + Number(quickLink);

  return (
    <BlockStack gap="500">
      <Card>
        <InlineStack gap="600" blockAlign="center" wrap={false}>
          <ScoreRing value={activeCount === 2 ? 100 : 50} tone="green" label="Speed" />
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Performance Overview</Text>
              <Text as="p">
                {activeCount === 2 ? "Fully Optimized" : "Partially Optimized"} - {activeCount}/2 features active
              </Text>
            </BlockStack>
            <Grid columns={{ xs: 1, sm: 3, md: 3, lg: 3, xl: 3 }}>
              {[
                ["Instant Page", instantPage ? "On" : "Off"],
                ["Quick Link", quickLink ? "On" : "Off"],
                ["Theme Access", "Yes"],
              ].map(([label, value]) => (
                <Grid.Cell key={label}>
                  <Box background="bg-surface-success" borderRadius="300" padding="400">
                    <BlockStack gap="100" align="center">
                      <Text as="span" variant="headingMd" tone="success">{value}</Text>
                      <Text as="span" tone="subdued">{label}</Text>
                    </BlockStack>
                  </Box>
                </Grid.Cell>
              ))}
            </Grid>
          </BlockStack>
        </InlineStack>
      </Card>

      {[
        ["Instant Page", "Preload pages when users hover over links", "Saves 300ms+ per page load", instantPage, "instantPageEnabled"],
        ["Quick Link", "Preload all visible links on the page", "Instant navigation for browsers", quickLink, "quickLinkEnabled"],
      ].map(([title, desc, note, checked, key]) => (
        <Card key={title}>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingMd">{title}</Text>
                <Badge tone={checked ? "success" : "attention"}>{checked ? "Active" : "Inactive"}</Badge>
              </InlineStack>
              <ToggleSwitch checked={checked} onChange={(value) => onSettingsChange("performance", key, value)} label={`Toggle ${title}`} />
            </InlineStack>
            <Text as="p">{desc}</Text>
            <Box background="bg-surface-secondary" borderRadius="200" padding="300">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={AlertTriangleIcon} tone="warning" />
                <Text as="span" tone="subdued">{note}</Text>
              </InlineStack>
            </Box>
          </BlockStack>
        </Card>
      ))}
    </BlockStack>
  );
}

function ImagesView({ images, settings, onSettingsChange, plan }) {
  const imageSettings = settings.images;
  const altEnabled = Boolean(imageSettings.altEnabled);
  const compressionEnabled = Boolean(imageSettings.compressionEnabled);
  const canCompress = plan === "standard" || plan === "pro";
  const totalImages = images.length;
  const altGenerated = images.filter((image) => textValue(image.altText)).length;
  const altMissing = Math.max(totalImages - altGenerated, 0);
  const filteredImages = images.filter((image) => {
    if (imageSettings.productStatus !== "all" && String(image.status).toLowerCase() !== imageSettings.productStatus) return false;
    if (imageSettings.onlyMissingAlt && textValue(image.altText)) return false;
    return true;
  });

  return (
    <BlockStack gap="500">
      <Card>
        <Grid columns={{ xs: 1, sm: 2, md: 5, lg: 5, xl: 5 }}>
          {[
            ["Total Images", String(totalImages)],
            ["Compressed", "0"],
            ["Space Saved", "0 Bytes"],
            ["Alt Text Generated", String(altGenerated)],
            ["Alt Text Missing", String(altMissing)],
          ].map(([label, value]) => (
            <Grid.Cell key={label}>
              <BlockStack gap="100">
                <Text as="span" tone={label.includes("Missing") ? "critical" : label.includes("Saved") ? "success" : undefined}>
                  {label}
                </Text>
                <Text as="span" variant="headingMd">
                  {value}
                </Text>
              </BlockStack>
            </Grid.Cell>
          ))}
        </Grid>
      </Card>

      <Card padding="0">
        <BlockStack gap="0">
          <div className="seo-card-header">
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Image Compression</Text>
              <Text as="p">Automatically compress your images to reduce file size and improve load speed.</Text>
            </BlockStack>
            <ToggleSwitch
              checked={compressionEnabled}
              onChange={(value) => canCompress && onSettingsChange("images", "compressionEnabled", value)}
              label="Toggle image compression"
            />
          </div>
          <Divider />
          <div className="seo-card-body">
            <div className="warning-strip">
              <InlineStack gap="200" blockAlign="center" wrap={false}>
                <Icon source={AlertTriangleIcon} tone="base" />
                <Text as="span" fontWeight="semibold">Upgrade to Standard or PRO Plan</Text>
              </InlineStack>
            </div>
            {!canCompress ? (
              <Box paddingBlockStart="400">
                <Text as="p" tone="subdued">
                  Image Size Optimization is only available on Standard and PRO plans. Please upgrade to use this feature.
                </Text>
              </Box>
            ) : null}
            <Box paddingBlockStart="500">
              <Select
                label="Optimization Level"
                disabled={!canCompress}
                options={[{ label: "Balanced (Recommended)", value: "balanced" }]}
                value="balanced"
                onChange={() => {}}
              />
            </Box>
          </div>
        </BlockStack>
      </Card>

      <Card padding="0">
        <div className="seo-card-header">
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Alt Text Generation</Text>
            <Text as="p">Generate alt text for your product images automatically based on your settings below.</Text>
          </BlockStack>
          <ToggleSwitch checked={altEnabled} onChange={(value) => onSettingsChange("images", "altEnabled", value)} label="Toggle alt text generation" />
        </div>
        <Divider />
        <div className="seo-card-body">
          {!altEnabled ? (
            <div className="warning-strip">
              <InlineStack gap="200" blockAlign="center" wrap={false}>
                <Icon source={AlertTriangleIcon} tone="base" />
                <Text as="span" fontWeight="semibold">Disabled! Turn on to automatically generate alt text for all your product images.</Text>
              </InlineStack>
            </div>
          ) : null}
          <BlockStack gap="400">
            <Text as="h3" variant="headingSm">Configuration</Text>
            <Grid columns={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2 }}>
              <Grid.Cell>
                <Select
                  label="Generation Mode"
                  options={[{ label: "Template", value: "template" }, { label: "AI generated", value: "ai" }]}
                  value={imageSettings.generationMode}
                  onChange={(value) => onSettingsChange("images", "generationMode", value)}
                />
              </Grid.Cell>
              <Grid.Cell>
                <Select
                  label="Product Status"
                  options={[{ label: "ALL", value: "all" }, { label: "ACTIVE", value: "active" }, { label: "DRAFT", value: "draft" }]}
                  value={imageSettings.productStatus}
                  onChange={(value) => onSettingsChange("images", "productStatus", value)}
                />
              </Grid.Cell>
            </Grid>
            <Checkbox
              label="Only process images without existing alt text"
              checked={Boolean(imageSettings.onlyMissingAlt)}
              onChange={(value) => onSettingsChange("images", "onlyMissingAlt", value)}
            />
            <Box background="bg-surface-secondary" borderRadius="300" padding="400">
              <BlockStack gap="300">
                <TextField
                  label="Template Pattern"
                  value={imageSettings.templatePattern}
                  onChange={(value) => onSettingsChange("images", "templatePattern", value)}
                  autoComplete="off"
                  helpText="Use variables to dynamically generate alt text."
                />
                <InlineStack gap="300">
                  <Button>+ Add Variable</Button>
                  <Button variant="plain">Browse Templates</Button>
                </InlineStack>
              </BlockStack>
            </Box>
          </BlockStack>
        </div>
      </Card>

      <ImageLibrary images={filteredImages} totalImages={totalImages} />
    </BlockStack>
  );
}

function ImageLibrary({ images, totalImages }) {
  const [query, setQuery] = useState("");
  const visibleImages = images.filter((image) =>
    `${image.productTitle} ${image.src} ${image.altText}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start">
          <BlockStack gap="150">
            <Text as="h2" variant="headingMd">Image Library</Text>
            <Text as="p">Manage alt text and compression for your product images</Text>
          </BlockStack>
          <Button icon={RefreshIcon}>Refresh</Button>
        </InlineStack>
        <InlineStack gap="200" wrap={false}>
          <div className="search-shell">
            <Icon source={SearchIcon} tone="subdued" />
            <TextField
              label="Search images"
              labelHidden
              value={query}
              onChange={setQuery}
              placeholder="Search by product title or filename..."
              autoComplete="off"
            />
          </div>
          <Button icon={SortIcon}>Sort</Button>
        </InlineStack>
        <InlineStack gap="200" blockAlign="center" wrap>
          <Text as="span">Filters:</Text>
          <Button>Alt Text</Button>
          <Button>Saved</Button>
          <Button>Compression</Button>
        </InlineStack>
        <InlineStack align="space-between">
          <Text as="span">Showing {visibleImages.length ? `1-${visibleImages.length}` : "0"} of {totalImages} images</Text>
          <Text as="span">Page 1 of 1</Text>
        </InlineStack>
        {visibleImages.length ? (
          <div className="image-library-list">
            {visibleImages.slice(0, 20).map((image) => (
              <div className="image-library-row" key={image.id}>
                <img src={image.src} alt={image.altText || image.productTitle} />
                <BlockStack gap="050">
                  <Text as="span" fontWeight="semibold">{truncateText(image.productTitle, 54)}</Text>
                  <Text as="span" tone={image.altText ? "success" : "critical"}>
                    {image.altText ? truncateText(image.altText, 70) : "Alt text missing"}
                  </Text>
                </BlockStack>
                <Badge tone={image.altText ? "success" : "critical"}>{image.altText ? "Alt ready" : "Missing"}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-image-state" aria-hidden="true">
            <span className="sparkle sparkle--small" />
            <span className="sparkle sparkle--large" />
            <span className="sparkle sparkle--medium" />
          </div>
        )}
      </BlockStack>
    </Card>
  );
}

function AssetsView() {
  return (
    <BlockStack gap="500">
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Asset Compression</Text>
              <Text as="p" tone="subdued">Minify CSS and JavaScript files to improve storefront load speed.</Text>
            </BlockStack>
            <Badge tone="attention">Standard plan required</Badge>
          </InlineStack>
          <div className="warning-strip">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={AlertTriangleIcon} tone="base" />
              <Text as="span" fontWeight="semibold">Upgrade to enable automatic asset compression.</Text>
            </InlineStack>
          </div>
          <Grid columns={{ xs: 1, sm: 3, md: 3, lg: 3, xl: 3 }}>
            {["CSS minification", "JavaScript minification", "Unused asset report"].map((item) => (
              <Grid.Cell key={item}>
                <Box background="bg-surface-secondary" borderRadius="300" padding="400">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm">{item}</Text>
                    <Text as="p" tone="subdued">Ready to configure after upgrade.</Text>
                  </BlockStack>
                </Box>
              </Grid.Cell>
            ))}
          </Grid>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

function SchemaView({ settings, onSettingsChange }) {
  const schemaSettings = settings.schema;
  const activeSchema = schemaSettings.activeType || "product";

  const selected = useMemo(() => schemaTypes.find((item) => item.id === activeSchema) || schemaTypes[1], [activeSchema]);
  const updateSchema = (key, value) => onSettingsChange("schema", key, value);
  const updateSchemaType = (schemaId, value) => {
    onSettingsChange("schema", "enabledTypes", {
      ...schemaSettings.enabledTypes,
      [schemaId]: value,
    });
  };

  return (
    <BlockStack gap="500">
      <Text as="p" tone="subdued">Optimize how your store appears in AI search results.</Text>
      <Card padding="0">
        <div className="warning-strip">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={AlertTriangleIcon} tone="base" />
            <Text as="span" fontWeight="semibold">Activate JSON-LD Schema in your theme</Text>
          </InlineStack>
        </div>
        <Box padding="500">
          <BlockStack gap="400">
            <Text as="p">
              Your settings are saved, but the JSON-LD block needs to be enabled in your theme for structured data to appear on your storefront.
            </Text>
            <InlineStack gap="400">
              <Button>Activate in Theme Editor</Button>
              <Button variant="plain">Re-check Status</Button>
            </InlineStack>
          </BlockStack>
        </Box>
      </Card>

      <Grid columns={{ xs: 1, sm: 1, md: 3, lg: 3, xl: 3 }}>
        <Grid.Cell>
          <Card>
            <BlockStack gap="200">
              {schemaTypes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`schema-type ${activeSchema === item.id ? "schema-type--active" : ""}`}
                  onClick={() => updateSchema("activeType", item.id)}
                >
                  <InlineStack align="space-between" blockAlign="center" wrap={false}>
                    <InlineStack gap="250" blockAlign="center" wrap={false}>
                      <Icon source={item.icon} tone="base" />
                      <BlockStack gap="050">
                        <Text as="span" fontWeight="semibold">{item.label}</Text>
                        <Text as="span" tone="subdued">{item.desc}</Text>
                      </BlockStack>
                    </InlineStack>
                    <ToggleSwitch
                      checked={Boolean(schemaSettings.enabledTypes[item.id])}
                      onChange={(value) => updateSchemaType(item.id, value)}
                      label={`Toggle ${item.label}`}
                    />
                  </InlineStack>
                </button>
              ))}
            </BlockStack>
          </Card>
        </Grid.Cell>

        <Grid.Cell>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="250" blockAlign="center">
                    <Icon source={selected.icon} tone="base" />
                    <Text as="h2" variant="headingMd">{selected.label}</Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <ToggleSwitch
                      checked={Boolean(schemaSettings.enabledTypes[selected.id])}
                      onChange={(value) => updateSchemaType(selected.id, value)}
                      label={`Toggle ${selected.label}`}
                    />
                    <Text as="span" tone="subdued">{schemaSettings.enabledTypes[selected.id] ? "Active" : "Inactive"}</Text>
                  </InlineStack>
                </InlineStack>
                <Divider />
                <Text as="p">
                  Add product markup (price, stock, reviews) to product pages to improve visibility in AI results and enhance CTR.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">Pricing</Text>
                <Select
                  label="Pricing type"
                  options={[{ label: "Single price", value: "single" }, { label: "Price range", value: "range" }]}
                  value={schemaSettings.pricingType}
                  onChange={(value) => updateSchema("pricingType", value)}
                />
                <Text as="p" tone="subdued">
                  "Single price" shows one price. "Price range" shows the lowest and highest variant prices.
                </Text>
                <Divider />
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="span">Sale price expiry</Text>
                    <Text as="span" tone="subdued">Set an end date for the current sale price. Useful for limited-time promotions.</Text>
                  </BlockStack>
                  <ToggleSwitch
                    checked={Boolean(schemaSettings.salePriceExpiry)}
                    onChange={(value) => updateSchema("salePriceExpiry", value)}
                    label="Toggle sale price expiry"
                  />
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">Additional Schema Properties</Text>
                {[
                  ["Stock availability", "Show whether the product is in stock, out of stock, or available for backorder in search results.", "stockAvailability"],
                  ["Return policy", "Show your return and refund policy in search results.", "returnPolicy"],
                ].map(([title, desc, key]) => (
                  <BlockStack gap="250" key={title}>
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span">{title}</Text>
                      <ToggleSwitch checked={Boolean(schemaSettings[key])} onChange={(value) => updateSchema(key, value)} label={`Toggle ${title}`} />
                    </InlineStack>
                    <Text as="p" tone="subdued">{desc}</Text>
                    <Divider />
                  </BlockStack>
                ))}
                <BlockStack gap="250">
                  <Text as="span">Product reviews</Text>
                  <Text as="p" tone="subdued">Star ratings and review counts are automatically pulled from your review app and included in the schema.</Text>
                  {["Shopify Product Reviews", "Judge.me", "Loox"].map((app) => (
                    <InlineStack key={app} gap="200">
                      <Badge tone="info">Supported</Badge>
                      <Text as="span">{app}</Text>
                    </InlineStack>
                  ))}
                </BlockStack>
                <Divider />
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="span">Exclude on collection pages</Text>
                    <Text as="span" tone="subdued">Prevent product schema from appearing on collection pages to avoid duplicate structured data.</Text>
                  </BlockStack>
                  <ToggleSwitch
                    checked={Boolean(schemaSettings.excludeCollectionPages)}
                    onChange={(value) => updateSchema("excludeCollectionPages", value)}
                    label="Toggle exclude on collection pages"
                  />
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Grid.Cell>

        <Grid.Cell>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">Google Search Preview</Text>
                <Box background="bg-surface-secondary" borderRadius="300" padding="400">
                  <BlockStack gap="200">
                    <Text as="span" tone="subdued">yourstore.com &gt; products</Text>
                    <Text as="p" fontWeight="semibold">Premium Wireless Headphones - Your Store</Text>
                    <Text as="span">$49.99</Text>
                    <Text as="span">4.5 rating (128 reviews)</Text>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">Why is Product Schema important?</Text>
                <Text as="p">
                  Product schema tells search engines key details about your products - price, availability, reviews - so they can display rich results that attract more clicks.
                </Text>
                <Text as="h4" variant="headingSm">Core Benefits</Text>
                {[
                  ["Rich Snippets", "Show price, availability, and ratings directly in search results to stand out."],
                  ["Higher CTR", "Products with rich results get up to 30% more clicks than plain listings."],
                  ["Merchant Listings", "Eligible for Google's free product listings and Shopping tab visibility."],
                ].map(([title, desc]) => (
                  <Card key={title}>
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingSm">{title}</Text>
                      <Text as="p" tone="subdued">{desc}</Text>
                    </BlockStack>
                  </Card>
                ))}
                <Box background="bg-surface-info" borderRadius="300" padding="300">
                  <InlineStack gap="200" blockAlign="start" wrap={false}>
                    <Icon source={InfoIcon} tone="info" />
                    <Text as="p">Pro Tip: Enable stock availability and return policy to maximize your rich snippet real estate in search results.</Text>
                  </InlineStack>
                </Box>
              </BlockStack>
            </Card>
          </BlockStack>
        </Grid.Cell>
      </Grid>
    </BlockStack>
  );
}

export default function SeoImprovePage() {
  const { content, images, settings: initialSettings, summary, plan } = useLoaderData();
  const navigate = useNavigate();
  const location = useLocation();
  const settingsFetcher = useFetcher();
  const revalidator = useRevalidator();
  const [activeSection, setActiveSection] = useState("dashboard");
  const [settings, setSettings] = useState(() => deepMergeSettings(DEFAULT_SEO_SETTINGS, initialSettings));
  const liveSummary = useMemo(() => {
    const performanceEnabled = Number(settings.performance.instantPageEnabled) + Number(settings.performance.quickLinkEnabled);
    const schemaEnabled = Object.values(settings.schema.enabledTypes).filter(Boolean).length;
    const performanceScore = Math.round((performanceEnabled / 2) * 100);
    const schemaScore = Math.round((schemaEnabled / schemaTypes.length) * 100);
    return {
      ...summary,
      performanceEnabled,
      schemaEnabled,
      performanceScore,
      schemaScore,
      totalScore: Math.round(summary.contentScore * 0.4 + summary.imageScore * 0.2 + performanceScore * 0.2 + schemaScore * 0.2),
    };
  }, [settings, summary]);

  function persistSettings(nextSettings) {
    const payload = new FormData();
    payload.append("intent", "save_seo_settings");
    payload.append("settingsJson", JSON.stringify(nextSettings));
    settingsFetcher.submit(payload, { method: "post" });
  }

  function handleSettingsChange(section, key, value) {
    setSettings((current) => {
      const next = {
        ...current,
        [section]: {
          ...current[section],
          [key]: value,
        },
      };
      persistSettings(next);
      return next;
    });
  }

  function renderSection() {
    if (activeSection === "content") return <ContentView content={content} />;
    if (activeSection === "performance") return <PerformanceView settings={settings} onSettingsChange={handleSettingsChange} />;
    if (activeSection === "images") return <ImagesView images={images} settings={settings} onSettingsChange={handleSettingsChange} plan={plan} />;
    if (activeSection === "assets") return <AssetsView />;
    if (activeSection === "schema") return <SchemaView settings={settings} onSettingsChange={handleSettingsChange} />;
    return <DashboardView summary={liveSummary} onOpen={setActiveSection} onSync={() => revalidator.revalidate()} />;
  }

  return (
    <Page
      title="SEO Improve"
      subtitle="Optimize content, performance, images, assets, and structured data."
      backAction={{ content: "Dashboard", onAction: () => navigateWithCurrentSearch(navigate, location, "/app") }}
    >
      <BlockStack gap="500">
        <AppPageHeader
          title="SEO Improve"
          description="Improve Shopify SEO health with content checks, speed tools, image alt text, compression, and JSON-LD schema."
        />
        <SectionTabs active={activeSection} onChange={setActiveSection} />
        {renderSection()}
        <Box paddingBlockEnd="800" />
      </BlockStack>
      <style>{`
        .seo-tabs {
          display: flex;
          gap: 16px;
          border-bottom: 1px solid #dfe3e8;
          overflow-x: auto;
          padding: 0 4px 12px;
        }
        .seo-tab {
          appearance: none;
          border: 0;
          background: transparent;
          color: #3f3f46;
          border-radius: 8px;
          padding: 8px 14px;
          font-weight: 650;
          white-space: nowrap;
          cursor: pointer;
        }
        .seo-tab--active {
          color: #ffffff;
          background: #303030;
          box-shadow: inset 0 0 0 2px #1f1f1f;
        }
        .score-ring {
          width: 124px;
          height: 124px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          background: conic-gradient(#d92d20 var(--score), #f4f4f5 0);
        }
        .score-ring--green {
          background: conic-gradient(#008060 var(--score), #f4f4f5 0);
        }
        .score-ring__inner {
          width: 96px;
          height: 96px;
          border-radius: 50%;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #d92d20;
        }
        .score-ring--green .score-ring__inner {
          color: #008060;
        }
        .seo-progress {
          height: 5px;
          border-radius: 999px;
          background: #008060;
        }
        .segmented-control {
          display: inline-flex;
          overflow: hidden;
          border: 1px solid #c9cccf;
          border-radius: 8px;
        }
        .segment {
          appearance: none;
          border: 0;
          border-right: 1px solid #dfe3e8;
          background: #ffffff;
          min-width: 92px;
          padding: 8px 14px;
          font-weight: 600;
          cursor: pointer;
        }
        .segment:last-child {
          border-right: 0;
        }
        .segment--active {
          background: #f7f7f7;
        }
        .seo-table {
          border: 1px solid #dfe3e8;
          border-radius: 12px;
          overflow: hidden;
        }
        .seo-table__head,
        .seo-table__row {
          display: grid;
          grid-template-columns: minmax(180px, 2fr) minmax(160px, 1.5fr) minmax(140px, 1fr) minmax(120px, auto);
          gap: 16px;
          align-items: center;
          padding: 12px 16px;
        }
        .seo-table__head {
          background: #f6f6f7;
        }
        .seo-table__row {
          border-top: 1px solid #e5e7eb;
        }
        .issue-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          display: inline-block;
        }
        .issue-dot--warning {
          background: #e5a000;
        }
        .issue-dot--critical {
          background: #d72c0d;
        }
        .seo-switch {
          appearance: none;
          width: 40px;
          height: 22px;
          border: 1px solid #8c9196;
          border-radius: 999px;
          background: #f1f2f4;
          padding: 2px;
          display: inline-flex;
          justify-content: flex-start;
          cursor: pointer;
        }
        .seo-switch span {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #8c9196;
          transition: transform 120ms ease;
        }
        .seo-switch--checked {
          justify-content: flex-end;
          background: #303030;
          border-color: #303030;
        }
        .seo-switch--checked span {
          background: #ffffff;
        }
        .seo-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          padding: 20px;
        }
        .seo-card-body {
          padding: 20px;
        }
        .warning-strip {
          background: #ffb800;
          border-radius: 10px 10px 0 0;
          padding: 16px 20px;
        }
        .search-shell {
          flex: 1 1 auto;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          gap: 8px;
          border: 1px solid #aeb4b9;
          border-radius: 8px;
          padding: 0 12px;
        }
        .search-shell .Polaris-Labelled__LabelWrapper {
          display: none;
        }
        .search-shell .Polaris-TextField,
        .search-shell .Polaris-TextField__Input {
          border: 0;
          box-shadow: none;
        }
        .compact-search-shell {
          width: 220px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          gap: 6px;
          border: 1px solid #aeb4b9;
          border-radius: 8px;
          padding: 0 10px;
        }
        .compact-search-shell .Polaris-Labelled__LabelWrapper {
          display: none;
        }
        .compact-search-shell .Polaris-TextField,
        .compact-search-shell .Polaris-TextField__Input {
          border: 0;
          box-shadow: none;
        }
        .image-library-list {
          display: grid;
          gap: 10px;
        }
        .image-library-row {
          display: grid;
          grid-template-columns: 56px minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 10px;
        }
        .image-library-row img {
          width: 56px;
          height: 56px;
          border-radius: 6px;
          object-fit: cover;
          background: #f6f6f7;
        }
        .empty-image-state {
          min-height: 360px;
          position: relative;
          display: grid;
          place-items: center;
        }
        .sparkle {
          position: absolute;
          background: #ffd937;
          clip-path: polygon(50% 0%, 64% 36%, 100% 50%, 64% 64%, 50% 100%, 36% 64%, 0% 50%, 36% 36%);
        }
        .sparkle--large {
          width: 230px;
          height: 230px;
          left: 50%;
          top: 44%;
          transform: translate(-20%, -50%);
          filter: drop-shadow(26px 0 0 #f3b000);
        }
        .sparkle--medium {
          width: 120px;
          height: 120px;
          left: 40%;
          top: 62%;
          filter: drop-shadow(14px 0 0 #f3b000);
        }
        .sparkle--small {
          width: 90px;
          height: 90px;
          left: 45%;
          top: 28%;
          filter: drop-shadow(10px 0 0 #f3b000);
        }
        .schema-type {
          appearance: none;
          width: 100%;
          border: 0;
          border-radius: 8px;
          background: #ffffff;
          padding: 12px;
          text-align: left;
          cursor: pointer;
        }
        .schema-type--active {
          background: #f4f4f5;
        }
        @media (max-width: 860px) {
          .seo-table__head,
          .seo-table__row {
            grid-template-columns: 1fr;
          }
          .score-ring {
            width: 104px;
            height: 104px;
          }
          .score-ring__inner {
            width: 80px;
            height: 80px;
          }
        }
      `}</style>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
