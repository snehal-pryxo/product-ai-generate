import { useEffect, useState } from "react";
import {
  useLoaderData,
  useActionData,
  Form,
  useFetcher,
  useNavigate,
  useLocation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Page,
  Banner,
  Card,
  Divider,
  Grid,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Select,
  Badge,
  Icon,
  Modal,
  TextField,
  Box,
} from "@shopify/polaris";
import { AppPageHeader } from "../components/AppPageHeader";
import { autoAddFaqSectionToProductPage } from "../lib/themeUtils.server";
import {
  ProductIcon,
  CollectionIcon,
  BlogIcon,
  PageIcon,
  ChartVerticalIcon,
  StarFilledIcon,
  ExternalIcon,
  EmailIcon,
  QuestionCircleIcon,
  AppsIcon,
  LayoutSectionIcon,
  SettingsIcon,
  NoteIcon,
  ArrowRightIcon,
} from "@shopify/polaris-icons";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: {
      createdAt: true,
      reviewSubmittedAt: true,
      reviewPromptDismissedAt: true,
      ownerName: true,
      name: true,
      credits: true,
      creditsUsedTotal: true,
      billingPlanName: true,
      billingPlanPrice: true,
    },
  });

  const installDate = shopData?.createdAt;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const installAgeMs = installDate ? Date.now() - new Date(installDate).getTime() : 0;
  const shouldShowReviewPopup = Boolean(
    shopData &&
    installDate &&
    installAgeMs >= sevenDaysMs &&
    !shopData.reviewSubmittedAt &&
    !shopData.reviewPromptDismissedAt,
  );

  const shopDomain = String(session.shop || "").trim();
  const shopHandle = shopDomain.split(".")[0] || "Shop Owner";
  const fallbackOwnerName = shopHandle
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const shopOwnerName =
    (shopData?.ownerName || "").trim() ||
    (shopData?.name || "").trim() ||
    fallbackOwnerName ||
    "Shop Owner";

  const countWords = (value) => {
    const plain = String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!plain) return 0;
    return plain.split(" ").filter(Boolean).length;
  };

  const [appliedProducts, appliedCollections, appliedPages, productGeneratedRows, collectionGeneratedRows, collectionProductGeneratedRows, pageGeneratedRows] =
    await Promise.all([
      db.productGeneratedContent.findMany({
        where: { shop: session.shop, appliedToProduct: true },
        select: { seoTitle: true, seoDescription: true },
      }),
      db.collectionGeneratedContent.findMany({
        where: { shop: session.shop, appliedToCollection: true },
        select: { seoTitle: true, seoDescription: true },
      }),
      db.pageGeneratedContent.findMany({
        where: { shop: session.shop, appliedToPage: true },
        select: { seoTitle: true, seoDescription: true },
      }),
      db.productGeneratedContent.findMany({
        where: { shop: session.shop },
        select: { descriptionHtml: true, seoTitle: true, seoDescription: true },
      }),
      db.collectionGeneratedContent.findMany({
        where: { shop: session.shop },
        select: { descriptionHtml: true, seoTitle: true, seoDescription: true },
      }),
      db.collectionProductGeneratedContent.findMany({
        where: { shop: session.shop },
        select: { descriptionHtml: true, seoTitle: true, seoDescription: true },
      }),
      db.pageGeneratedContent.findMany({
        where: { shop: session.shop },
        select: { bodyHtml: true, seoTitle: true, seoDescription: true },
      }),
    ]);

  let blogGeneratedRows = [];
  try {
    blogGeneratedRows = await db.$queryRaw`
      SELECT bodyHtml
      FROM blog_generated_contents
      WHERE shop = ${session.shop}
    `;
  } catch {
    blogGeneratedRows = [];
  }

  const [productDescriptionCount, productMetaTitleCount, productMetaDescriptionCount] = await Promise.all([
    db.productGeneratedContent.count({
      where: {
        shop: session.shop,
        AND: [{ descriptionHtml: { not: null } }, { descriptionHtml: { not: "" } }],
      },
    }),
    db.productGeneratedContent.count({
      where: {
        shop: session.shop,
        AND: [{ seoTitle: { not: null } }, { seoTitle: { not: "" } }],
      },
    }),
    db.productGeneratedContent.count({
      where: {
        shop: session.shop,
        AND: [{ seoDescription: { not: null } }, { seoDescription: { not: "" } }],
      },
    }),
  ]);

  const [collectionDescriptionCount, collectionMetaTitleCount, collectionMetaDescriptionCount] = await Promise.all([
    db.collectionGeneratedContent.count({
      where: {
        shop: session.shop,
        AND: [{ descriptionHtml: { not: null } }, { descriptionHtml: { not: "" } }],
      },
    }),
    db.collectionGeneratedContent.count({
      where: {
        shop: session.shop,
        AND: [{ seoTitle: { not: null } }, { seoTitle: { not: "" } }],
      },
    }),
    db.collectionGeneratedContent.count({
      where: {
        shop: session.shop,
        AND: [{ seoDescription: { not: null } }, { seoDescription: { not: "" } }],
      },
    }),
  ]);

  const [
    collectionProductDescriptionCount,
    collectionProductMetaTitleCount,
    collectionProductMetaDescriptionCount,
  ] = await Promise.all([
    db.collectionProductGeneratedContent.count({
      where: {
        shop: session.shop,
        AND: [{ descriptionHtml: { not: null } }, { descriptionHtml: { not: "" } }],
      },
    }),
    db.collectionProductGeneratedContent.count({
      where: {
        shop: session.shop,
        AND: [{ seoTitle: { not: null } }, { seoTitle: { not: "" } }],
      },
    }),
    db.collectionProductGeneratedContent.count({
      where: {
        shop: session.shop,
        AND: [{ seoDescription: { not: null } }, { seoDescription: { not: "" } }],
      },
    }),
  ]);

  const [pageBodyCount, pageMetaTitleCount, pageMetaDescriptionCount] = await Promise.all([
    db.pageGeneratedContent.count({
      where: {
        shop: session.shop,
        AND: [{ bodyHtml: { not: null } }, { bodyHtml: { not: "" } }],
      },
    }),
    db.pageGeneratedContent.count({
      where: {
        shop: session.shop,
        AND: [{ seoTitle: { not: null } }, { seoTitle: { not: "" } }],
      },
    }),
    db.pageGeneratedContent.count({
      where: {
        shop: session.shop,
        AND: [{ seoDescription: { not: null } }, { seoDescription: { not: "" } }],
      },
    }),
  ]);

  const blogContentCount = blogGeneratedRows.filter((row) => String(row?.bodyHtml || "").trim()).length;

  const generatedWords =
    productGeneratedRows.reduce(
      (sum, row) =>
        sum +
        countWords(row.descriptionHtml) +
        countWords(row.seoTitle) +
        countWords(row.seoDescription),
      0,
    ) +
    collectionGeneratedRows.reduce(
      (sum, row) =>
        sum +
        countWords(row.descriptionHtml) +
        countWords(row.seoTitle) +
        countWords(row.seoDescription),
      0,
    ) +
    collectionProductGeneratedRows.reduce(
      (sum, row) =>
        sum +
        countWords(row.descriptionHtml) +
        countWords(row.seoTitle) +
        countWords(row.seoDescription),
      0,
    ) +
    pageGeneratedRows.reduce(
      (sum, row) =>
        sum + countWords(row.bodyHtml) + countWords(row.seoTitle) + countWords(row.seoDescription),
      0,
    ) +
    blogGeneratedRows.reduce((sum, row) => sum + countWords(row?.bodyHtml), 0);

  const generationStats = {
    product: {
      description: productDescriptionCount,
      metaTitle: productMetaTitleCount,
      metaDescription: productMetaDescriptionCount,
    },
    collection: {
      description: collectionDescriptionCount,
      metaTitle: collectionMetaTitleCount,
      metaDescription: collectionMetaDescriptionCount,
    },
    collectionProduct: {
      description: collectionProductDescriptionCount,
      metaTitle: collectionProductMetaTitleCount,
      metaDescription: collectionProductMetaDescriptionCount,
    },
    page: {
      body: pageBodyCount,
      metaTitle: pageMetaTitleCount,
      metaDescription: pageMetaDescriptionCount,
    },
    blog: {
      content: blogContentCount,
    },
  };

  const totalGeneratedPieces =
    productDescriptionCount +
    productMetaTitleCount +
    productMetaDescriptionCount +
    collectionDescriptionCount +
    collectionMetaTitleCount +
    collectionMetaDescriptionCount +
    collectionProductDescriptionCount +
    collectionProductMetaTitleCount +
    collectionProductMetaDescriptionCount +
    pageBodyCount +
    pageMetaTitleCount +
    pageMetaDescriptionCount +
    blogContentCount;

  const seoStats = {
    products: {
      total: appliedProducts.length,
      withTitle: appliedProducts.filter((p) => p.seoTitle).length,
      withDesc: appliedProducts.filter((p) => p.seoDescription).length,
    },
    collections: {
      total: appliedCollections.length,
      withTitle: appliedCollections.filter((c) => c.seoTitle).length,
      withDesc: appliedCollections.filter((c) => c.seoDescription).length,
    },
    pages: {
      total: appliedPages.length,
      withTitle: appliedPages.filter((p) => p.seoTitle).length,
      withDesc: appliedPages.filter((p) => p.seoDescription).length,
    },
  };
  const seoTotalItems = seoStats.products.total + seoStats.collections.total + seoStats.pages.total;
  const seoTotalCovered =
    seoStats.products.withTitle + seoStats.products.withDesc +
    seoStats.collections.withTitle + seoStats.collections.withDesc +
    seoStats.pages.withTitle + seoStats.pages.withDesc;
  const seoScore = seoTotalItems > 0 ? Math.round((seoTotalCovered / (seoTotalItems * 2)) * 100) : null;

  const timeSavedHours = Number((generatedWords / 600).toFixed(1));
  const creditsLeft = Number(shopData?.credits ?? 0);
  const creditsUsedTotal = Number(shopData?.creditsUsedTotal ?? 0);
  const totalCredits = creditsLeft + creditsUsedTotal;
  const currentPlan = String(shopData?.billingPlanName || "Free").toUpperCase();
  const currentPlanPrice = Number(shopData?.billingPlanPrice ?? 0);

  return {
    shouldShowReviewPopup,
    hasSubmittedReview: Boolean(shopData?.reviewSubmittedAt),
    shopOwnerName,
    generationStats,
    seoStats,
    seoScore,
    timeSavedHours,
    generatedWords,
    totalCredits,
    creditsLeft,
    creditsUsedTotal,
    currentPlan,
    currentPlanPrice,
    shop: session.shop,
    appApiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "submit_review") {
    const reviewRating = Number(formData.get("reviewRating"));
    const reviewFeedbackRaw = String(formData.get("reviewFeedback") || "");
    const reviewFeedback = reviewFeedbackRaw.trim();

    if (!Number.isInteger(reviewRating) || reviewRating < 1 || reviewRating > 5) {
      return { success: false, message: "Please select a rating between 1 and 5." };
    }

    const submittedAt = new Date();
    await db.shop.upsert({
      where: { shop },
      update: {
        reviewSubmittedAt: submittedAt,
        reviewRating,
        reviewFeedback: reviewFeedback || null,
        reviewPromptDismissedAt: null,
      },
      create: {
        shop,
        installed: true,
        reviewSubmittedAt: submittedAt,
        reviewRating,
        reviewFeedback: reviewFeedback || null,
      },
    });

    return { success: true, message: "Thank you for your review." };
  }

  if (intent === "dismiss_review") {
    const dismissedAt = new Date();
    await db.shop.upsert({
      where: { shop },
      update: { reviewPromptDismissedAt: dismissedAt },
      create: { shop, installed: true, reviewPromptDismissedAt: dismissedAt },
    });

    return { success: true, message: "Review popup dismissed." };
  }

  if (intent === "auto_add_faq_section") {
    const { session } = await authenticate.admin(request);
    const result = await autoAddFaqSectionToProductPage(session.shop, session.accessToken);
    if (!result.ok) {
      return { success: false, intent, message: result.error || "Failed to add FAQ section." };
    }
    return {
      success: true,
      intent,
      message: result.alreadyAdded
        ? "FAQ section is already on your product page."
        : "FAQ section successfully added to your product page!",
    };
  }

  return { success: false, message: "Unknown action." };
};


const CONTENT_FEATURES = [
  {
    icon: ProductIcon,
    title: "Products",
    desc: "Generate SEO titles, meta descriptions, and conversion-focused product copy.",
    url: "/app/products",
    badge: "Most popular",
    badgeTone: "success",
  },
  {
    icon: CollectionIcon,
    title: "Collections",
    desc: "Create rich collection descriptions aligned with your store keywords.",
    url: "/app/collections",
    badge: null,
    badgeTone: null,
  },
  {
    icon: BlogIcon,
    title: "Blog Posts",
    desc: "View and manage your existing Shopify blogs in one place.",
    url: "/app/blog",
    badge: "Blogs",
    badgeTone: "attention",
  },
  {
    icon: PageIcon,
    title: "Pages",
    desc: "Generate About, FAQ, Contact, and landing page copy in one flow.",
    url: "/app/pages",
    badge: null,
    badgeTone: null,
  },
];

const PARTNER_APPS = [
  {
    logoSrc: "/images/fomoify-logo.png",
    title: "Fomoify Sales Popup & Proof",
    desc: "Increase trust with real-time sales notifications and proof widgets.",
    url: "https://apps.shopify.com/fomoify-sales-popup-proof",
  },
  {
    logoSrc: "/images/cartlift-logo.png",
    title: "CartLift: Cart Drawer & Upsell",
    desc: "Boost AOV with targeted upsells and conversion-friendly cart flows.",
    url: "https://apps.shopify.com/cartlift-cart-drawer-upsell",
  },
  {
    logoSrc: "/images/mixbox-logo.png",
    title: "MixBox: Box & Bundle Builder",
    desc: "Build custom product bundles and increase average order value.",
    url: "https://apps.shopify.com/mixbox-box-bundle-builder",
  },
];

const DASHBOARD_SHORTCUTS = [
  {
    icon: LayoutSectionIcon,
    title: "Template",
    description: "Manage prompt templates for product, collection, page, and blog content.",
    url: "/app/template",
    tone: "blue",
  },
  {
    icon: SettingsIcon,
    title: "Settings",
    description: "Set store-wide AI preferences, language, keywords, and output defaults.",
    url: "/app/settings",
    tone: "green",
  },
  {
    icon: NoteIcon,
    title: "Content Management",
    description: "Review generated content and apply approved updates across your store.",
    url: "/app/content-management",
    tone: "purple",
  },
  {
    icon: ChartVerticalIcon,
    title: "Analytics",
    description: "Track SEO coverage, generation activity, and credit usage insights.",
    url: "/app/analytics",
    tone: "orange",
  },
];

function formatPrice(price) {
  const amount = Number(price || 0);
  if (amount <= 0) return "Free";
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}/month`;
}

function SeoDonut({ score }) {
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? "#008060" : score >= 40 ? "#B98900" : "#C9201F";
  const label = score >= 70 ? "Good" : score >= 40 ? "Fair" : "Needs work";
  return (
    <div style={{ position: "relative", width: 120, height: 120 }}>
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#f0f0f0" strokeWidth="11" />
        <circle
          cx="60" cy="60" r={radius} fill="none"
          stroke={color} strokeWidth="11"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 60 60)"
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1 }}>
        <span style={{ fontSize: "20px", fontWeight: 800, color, lineHeight: 1 }}>{score}%</span>
        <span style={{ fontSize: "10px", color: "#6b7280", fontWeight: 500 }}>{label}</span>
      </div>
    </div>
  );
}

export default function Index() {
  const {
    shouldShowReviewPopup,
    hasSubmittedReview,
    shopOwnerName,
    generationStats,
    seoStats,
    seoScore,
    timeSavedHours,
    generatedWords,
    totalCredits,
    creditsLeft,
    creditsUsedTotal,
    currentPlan,
    currentPlanPrice,
    shop,
    appApiKey,
  } = useLoaderData();
  const actionData = useActionData();
  const reviewFetcher = useFetcher();
  const faqFetcher = useFetcher();
  const navigate = useNavigate();
  const location = useLocation();
  const formattedGeneratedWords = Number(generatedWords || 0).toLocaleString("en-US");
  const formattedTimeSaved = Number(timeSavedHours || 0).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const formattedTotalCredits = Number(totalCredits || 0).toLocaleString("en-US");
  const formattedCreditsLeft = Number(creditsLeft || 0).toLocaleString("en-US");
  const formattedCreditsUsed = Number(creditsUsedTotal || 0).toLocaleString("en-US");
  const currentPlanWithPrice = `${currentPlan || "FREE"} - ${formatPrice(currentPlanPrice)}`;
  const kpiItems = [
    { id: "generated", label: "Generated", value: `${formattedGeneratedWords} words`, icon: ProductIcon },
    { id: "timeSaved", label: "Time Saved", value: `${formattedTimeSaved} hours`, icon: ChartVerticalIcon },
    { id: "credits", label: "Available Credits", value: formattedCreditsLeft, icon: CollectionIcon },
    { id: "plan", label: "Current Plan", value: currentPlanWithPrice, icon: PageIcon },
  ];
  const specificCountBoxes = [
    {
      id: "product",
      title: "Product",
      rows: [
        { label: "Descriptions", value: generationStats.product.description },
        { label: "Meta Titles", value: generationStats.product.metaTitle },
        { label: "Meta Descriptions", value: generationStats.product.metaDescription },
      ],
    },
    {
      id: "collection",
      title: "Collection",
      rows: [
        { label: "Descriptions", value: generationStats.collection.description },
        { label: "Meta Titles", value: generationStats.collection.metaTitle },
        { label: "Meta Descriptions", value: generationStats.collection.metaDescription },
      ],
    },
    {
      id: "collectionProduct",
      title: "Collection Product",
      rows: [
        { label: "Descriptions", value: generationStats.collectionProduct.description },
        { label: "Meta Titles", value: generationStats.collectionProduct.metaTitle },
        { label: "Meta Descriptions", value: generationStats.collectionProduct.metaDescription },
      ],
    },
    {
      id: "pages",
      title: "Pages",
      rows: [
        { label: "Body Content", value: generationStats.page.body },
        { label: "Meta Titles", value: generationStats.page.metaTitle },
        { label: "Meta Descriptions", value: generationStats.page.metaDescription },
      ],
    },
    {
      id: "blog",
      title: "Blog",
      rows: [{ label: "Content Generated", value: generationStats.blog.content }],
    },
  ];

  const [isReviewModalOpen, setIsReviewModalOpen] = useState(
    () => Boolean(shouldShowReviewPopup) && !Boolean(hasSubmittedReview),
  );
  const [reviewAlreadySubmitted, setReviewAlreadySubmitted] = useState(() => Boolean(hasSubmittedReview));
  const [reviewRating, setReviewRating] = useState("5");
  const [reviewFeedback, setReviewFeedback] = useState("");

  const reviewIntent = String(reviewFetcher.formData?.get("intent") || "");
  const isSubmittingReview = reviewFetcher.state !== "idle" && reviewIntent === "submit_review";
  const isDismissingReview = reviewFetcher.state !== "idle" && reviewIntent === "dismiss_review";

  useEffect(() => {
    setReviewAlreadySubmitted(Boolean(hasSubmittedReview));
    setIsReviewModalOpen(Boolean(shouldShowReviewPopup) && !Boolean(hasSubmittedReview));
  }, [shouldShowReviewPopup, hasSubmittedReview]);

  useEffect(() => {
    if (!reviewFetcher.data?.success) return;
    if (reviewIntent !== "submit_review" && reviewIntent !== "dismiss_review") return;
    if (reviewIntent === "submit_review") {
      setReviewAlreadySubmitted(true);
    }
    setIsReviewModalOpen(false);
  }, [reviewFetcher.data, reviewIntent]);

  function handleDismissReviewPopup() {
    if (isSubmittingReview || isDismissingReview) return;
    const payload = new FormData();
    payload.append("intent", "dismiss_review");
    reviewFetcher.submit(payload, { method: "post" });
  }

  function getAppContextSearch() {
    const current = new URLSearchParams(location.search);
    const next = new URLSearchParams();
    ["shop", "host", "embedded"].forEach((key) => {
      const value = current.get(key);
      if (value) next.set(key, value);
    });
    const query = next.toString();
    return query ? `?${query}` : "";
  }

  function openDashboardShortcut(url) {
    navigate({ pathname: url, search: getAppContextSearch() });
  }

  return (
    <Page title="Dashboard" fullWidth>
      <div className="dashboard-uniform-buttons">
        <BlockStack gap="500">
          <Modal
            open={isReviewModalOpen}
            onClose={handleDismissReviewPopup}
            title="How is your experience with Product AI?"
            large
          >
            <Modal.Section>
              <reviewFetcher.Form method="post">
                <input type="hidden" name="intent" value="submit_review" />
                <input type="hidden" name="reviewRating" value={reviewRating} />
                <input type="hidden" name="reviewFeedback" value={reviewFeedback} />
                <BlockStack gap="300">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    You have used the app for 7 days. Please share a quick review to help us improve.
                  </Text>
                  <Select
                    label="Rating"
                    options={[
                      { label: "5 - Excellent", value: "5" },
                      { label: "4 - Good", value: "4" },
                      { label: "3 - Average", value: "3" },
                      { label: "2 - Poor", value: "2" },
                      { label: "1 - Very poor", value: "1" },
                    ]}
                    value={reviewRating}
                    onChange={setReviewRating}
                  />
                  <TextField
                    label="Feedback (optional)"
                    value={reviewFeedback}
                    onChange={setReviewFeedback}
                    multiline={4}
                    autoComplete="off"
                    placeholder="Tell us what worked well and what we can improve."
                  />
                  <InlineStack align="start" gap="200">
                    <Button size="slim" onClick={handleDismissReviewPopup} disabled={isSubmittingReview || isDismissingReview}>
                      Not now
                    </Button>
                    <Button
                      size="slim"
                      submit
                      variant="primary"
                      loading={isSubmittingReview}
                      disabled={isSubmittingReview || isDismissingReview}
                    >
                      Submit review
                    </Button>
                  </InlineStack>
                </BlockStack>
              </reviewFetcher.Form>
            </Modal.Section>
          </Modal>

          <AppPageHeader
            ownerName={shopOwnerName}
            ownerLabel="Owner"
            title={`Hi ${shopOwnerName}!`}
            description="Manage your apps and generate high-converting AI content for your store."
          />



          <Card padding="0">
            <div className="dashboard-kpi-grid">
              {kpiItems.map((item, index) => (
                <div key={item.id} className="dashboard-kpi-cell" style={{ borderRight: index < kpiItems.length - 1 ? "1px solid #e5e7eb" : "none" }}>
                  <BlockStack gap="100" align="start">
                    <div className="dashboard-kpi-heading-row">
                      <Icon source={item.icon} tone="subdued" />
                      <Text as="p" variant="headingSm">{item.label}</Text>
                    </div>
                    <Text as="p" variant="headingMd">{item.value}</Text>
                  </BlockStack>
                </div>
              ))}
            </div>
          </Card>

          <Card padding="0">
            <div className="dashboard-shortcuts">
              <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Quick access
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Open the main app areas without leaving your embedded Shopify session.
                  </Text>
                </BlockStack>
              </InlineStack>

              <Grid columns={{ xs: 1, sm: 2, md: 2, lg: 4, xl: 4 }}>
                {DASHBOARD_SHORTCUTS.map((item) => (
                  <Grid.Cell key={item.url}>
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="start" wrap={false}>
                          <span className={`dashboard-shortcut-icon dashboard-shortcut-icon--${item.tone}`}>
                            <Icon source={item.icon} tone="base" />
                          </span>
                          <Button
                            accessibilityLabel={`Open ${item.title}`}
                            icon={ArrowRightIcon}
                            onClick={() => openDashboardShortcut(item.url)}
                          />
                        </InlineStack>
                        <BlockStack gap="100">
                          <Text as="h3" variant="headingSm">
                            {item.title}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {item.description}
                          </Text>
                        </BlockStack>
                        <InlineStack align="start">
                          <Button
                            size="slim"
                            variant="primary"
                            onClick={() => openDashboardShortcut(item.url)}
                          >
                            Open
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  </Grid.Cell>
                ))}
              </Grid>
            </div>
          </Card>

          {actionData ? (
            <Banner tone={actionData.success ? "success" : "critical"}>
              <p>{actionData.message}</p>
            </Banner>
          ) : null}

          <div className="dashboard-seo-grid">
            {/* SEO Score */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">SEO Score</Text>
                  <Button size="slim" variant="plain" onClick={() => openDashboardShortcut("/app/analytics")}>
                    Details →
                  </Button>
                </InlineStack>

                {seoScore === null ? (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Apply generated content to your store to see your SEO coverage score.
                    </Text>
                    <Button size="slim" onClick={() => openDashboardShortcut("/app/content-management")}>
                      Apply content
                    </Button>
                  </BlockStack>
                ) : (
                  <>
                    <InlineStack align="center">
                      <SeoDonut score={seoScore} />
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Based on applied content across products, collections and pages.
                    </Text>
                    <Divider />
                    <BlockStack gap="200">
                      {[
                        { label: "Products", ...seoStats.products, color: "#008060", url: "/app/products" },
                        { label: "Collections", ...seoStats.collections, color: "#2C6ECB", url: "/app/collections" },
                        { label: "Pages", ...seoStats.pages, color: "#8456CD", url: "/app/pages" },
                      ].map(({ label, total, withTitle, withDesc, color, url }) => {
                        const pct = total > 0 ? Math.round(((withTitle + withDesc) / (total * 2)) * 100) : 0;
                        const missing = (total - withTitle) + (total - withDesc);
                        return (
                          <BlockStack key={label} gap="100">
                            <InlineStack align="space-between" blockAlign="center">
                              <button
                                onClick={() => openDashboardShortcut(url)}
                                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "12px", fontWeight: 500, color: "#374151" }}
                              >
                                {label}
                              </button>
                              <Text as="span" variant="bodySm" tone="subdued">{pct}%</Text>
                            </InlineStack>
                            <div style={{ background: "#f0f0f0", borderRadius: 4, height: 6, overflow: "hidden" }}>
                              <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: 4 }} />
                            </div>
                            {missing > 0 && total > 0 && (
                              <Text as="p" variant="bodySm" tone="subdued">{missing} fields missing</Text>
                            )}
                          </BlockStack>
                        );
                      })}
                    </BlockStack>
                    <Button size="slim" fullWidth onClick={() => openDashboardShortcut("/app/analytics")}>
                      Fix missing SEO
                    </Button>
                  </>
                )}
              </BlockStack>
            </Card>

            {/* Content Generated */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Content Generated</Text>
                  <Button size="slim" variant="plain" onClick={() => openDashboardShortcut("/app/content-management")}>
                    View all →
                  </Button>
                </InlineStack>
                <div className="dashboard-count-grid">
                  {specificCountBoxes.map((box) => {
                    const typeColors = { product: "#008060", collection: "#2C6ECB", collectionProduct: "#8456CD", pages: "#E07D10", blog: "#B98900" };
                    const color = typeColors[box.id] || "#6b7280";
                    const total = box.rows.reduce((s, r) => s + r.value, 0);
                    return (
                      <div key={box.id} style={{ background: "#f9fafb", borderRadius: 10, padding: "14px 16px", borderLeft: `3px solid ${color}` }}>
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h3" variant="headingSm" fontWeight="semibold">{box.title}</Text>
                            <span style={{ fontSize: "20px", fontWeight: 800, color }}>{total}</span>
                          </InlineStack>
                          <BlockStack gap="050">
                            {box.rows.map((row) => (
                              <InlineStack key={row.label} align="space-between" blockAlign="center">
                                <Text as="span" variant="bodySm" tone="subdued">{row.label}</Text>
                                <Text as="span" variant="bodySm" fontWeight="semibold">{row.value}</Text>
                              </InlineStack>
                            ))}
                          </BlockStack>
                        </BlockStack>
                      </div>
                    );
                  })}
                </div>
              </BlockStack>
            </Card>
          </div>

          {/* FAQ Section on Product Page */}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" gap="400" wrap>
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm" fontWeight="semibold">
                    FAQ Section on Product Page
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Automatically adds the FAQ block to your product page template — no theme editor steps needed.
                  </Text>
                </BlockStack>
                <faqFetcher.Form method="post">
                  <input type="hidden" name="intent" value="auto_add_faq_section" />
                  <Button
                    size="slim"
                    variant="primary"
                    submit
                    loading={faqFetcher.state !== "idle"}
                    disabled={faqFetcher.state !== "idle"}
                  >
                    Add to Product Page
                  </Button>
                </faqFetcher.Form>
              </InlineStack>

              {faqFetcher.data && (
                <Banner
                  tone={faqFetcher.data.success ? "success" : "critical"}
                  onDismiss={() => {}}
                >
                  <p>{faqFetcher.data.message}</p>
                </Banner>
              )}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <div
                className="dashboard-inline-title"
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-start", gap: "8px", width: "fit-content" }}
              >
                <Icon source={AppsIcon} tone="base" />
                <Text as="h2" variant="headingMd">
                  Boost store performance with our apps
                </Text>
              </div>
              <Grid columns={{ xs: 1, sm: 1, md: 3, lg: 3, xl: 3 }}>
                {PARTNER_APPS.map((app) => (
                  <Grid.Cell key={app.title}>
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack align="start" gap="200" blockAlign="center" wrap={false}>
                          <img
                            src={app.logoSrc}
                            alt={`${app.title} logo`}
                            style={{ width: 28, height: 28, objectFit: "contain" }}
                          />
                          <Text as="h3" variant="headingSm">
                            {app.title}
                          </Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {app.desc}
                        </Text>
                        <InlineStack align="start">
                          <Button size="slim" url={app.url} external icon={ExternalIcon}>
                            Add app
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
              <Text as="h2" variant="headingMd">
                Support
              </Text>
              <Grid columns={{ xs: 1, sm: 1, md: 3, lg: 3, xl: 3 }}>
                <Grid.Cell>
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        Book a free 30-minute setup call
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Get help with app setup, best practices, and growth recommendations.
                      </Text>
                      <InlineStack align="start">
                        <Button
                          size="slim"
                          url="https://outlook.office.com/book/ShopifyGrowthConsultationCall@m2webdesigning.com/?ismsaljsauthenabled=true"
                          external
                          variant="primary"
                        >
                          Schedule call
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>

                <Grid.Cell>
                  <Card>
                    <BlockStack gap="200">
                      <div
                        className="dashboard-inline-title"
                        style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "8px", width: "fit-content" }}
                      >
                        <Icon source={EmailIcon} tone="base" />
                        <Text as="h3" variant="headingSm">
                          Support ticket
                        </Text>
                      </div>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Reach our team during office hours for issue resolution and guidance.
                      </Text>
                      <InlineStack gap="200">
                        <Button size="slim" url="mailto:support@m2webdesigning.com">
                          Email support
                        </Button>
                        <Button size="slim" url="https://wa.me/918320023122" external>
                          WhatsApp
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>

                <Grid.Cell>
                  <Card>
                    <BlockStack gap="200">
                      <div
                        className="dashboard-inline-title"
                        style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "8px", width: "fit-content" }}
                      >
                        <Icon source={QuestionCircleIcon} tone="base" />
                        <Text as="h3" variant="headingSm">
                          Knowledge base
                        </Text>
                      </div>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Browse setup guides and troubleshooting docs.
                      </Text>
                      <InlineStack gap="200">
                        <Button size="slim">View docs</Button>
                        <Button
                          size="slim"
                          onClick={() => {
                            if (!reviewAlreadySubmitted) setIsReviewModalOpen(true);
                          }}
                          disabled={reviewAlreadySubmitted}
                          icon={StarFilledIcon}
                        >
                          {reviewAlreadySubmitted ? "Review submitted" : "Write a review"}
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              </Grid>
            </BlockStack>
          </Card>

          <Box paddingBlockEnd="800" />
        </BlockStack>
        <style>{`
        .dashboard-kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }
        .dashboard-kpi-cell {
          padding: 20px 24px;
          text-align: left;
        }
        .dashboard-kpi-heading-row {
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          gap: 8px;
          width: fit-content;
          white-space: nowrap;
        }
        .dashboard-shortcuts {
          padding: 22px;
          background: linear-gradient(135deg, #ffffff 0%, #f7f9fb 100%);
        }
        .dashboard-shortcuts .Polaris-Grid {
          margin-top: 18px;
        }
        .dashboard-shortcut-icon {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .dashboard-shortcut-icon--blue {
          background: #eaf3ff;
        }
        .dashboard-shortcut-icon--green {
          background: #e8f5ee;
        }
        .dashboard-shortcut-icon--purple {
          background: #f2edff;
        }
        .dashboard-shortcut-icon--orange {
          background: #fff1e5;
        }
        @media (max-width: 640px) {
          .dashboard-shortcuts {
            padding: 16px;
          }
        }
        .dashboard-seo-grid {
          display: grid;
          grid-template-columns: 280px 1fr;
          gap: 16px;
          align-items: start;
        }
        .dashboard-count-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        @media (max-width: 900px) {
          .dashboard-seo-grid {
            grid-template-columns: 1fr;
          }
          .dashboard-count-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 480px) {
          .dashboard-count-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
      </div>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
