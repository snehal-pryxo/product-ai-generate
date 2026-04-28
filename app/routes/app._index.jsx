import { useEffect, useState } from "react";
import {
  useLoaderData,
  useActionData,
  Form,
  useFetcher,
  useNavigation,
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
  const envDefaultAiModel =
    (process.env.AI_MODEL || "").trim() ||
    (process.env.OPENAI_MODEL || "").trim() ||
    "gpt-4o-mini";

  const shopData = await db.shop.findUnique({
    where: { shop: session.shop },
    select: {
      defaultAiModel: true,
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

  const [productGeneratedRows, collectionGeneratedRows, collectionProductGeneratedRows, pageGeneratedRows] =
    await Promise.all([
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

  const timeSavedHours = Number((generatedWords / 600).toFixed(1));
  const creditsLeft = Number(shopData?.credits ?? 0);
  const creditsUsedTotal = Number(shopData?.creditsUsedTotal ?? 0);
  const totalCredits = creditsLeft + creditsUsedTotal;
  const currentPlan = String(shopData?.billingPlanName || "Free").toUpperCase();
  const currentPlanPrice = Number(shopData?.billingPlanPrice ?? 0);

  return {
    defaultAiModel: shopData?.defaultAiModel || envDefaultAiModel,
    envDefaultAiModel,
    shouldShowReviewPopup,
    hasSubmittedReview: Boolean(shopData?.reviewSubmittedAt),
    shopOwnerName,
    generationStats,
    timeSavedHours,
    generatedWords,
    totalCredits,
    creditsLeft,
    creditsUsedTotal,
    currentPlan,
    currentPlanPrice,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_settings") {
    const envDefaultAiModel =
      (process.env.AI_MODEL || "").trim() ||
      (process.env.OPENAI_MODEL || "").trim() ||
      "gpt-4o-mini";
    const defaultAiModel = formData.get("defaultAiModel")?.trim() || envDefaultAiModel;

    await db.shop.upsert({
      where: { shop },
      update: { defaultAiModel },
      create: { shop, installed: true, defaultAiModel },
    });

    return { success: true, message: "Settings saved successfully!" };
  }

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

  return { success: false, message: "Unknown action." };
};

const AI_MODELS = [
  { label: "Claude Haiku 4.5", value: "claude-haiku-4.5" },
  { label: "Claude Sonnet 4.6", value: "claude-sonnet-4.6" },
  { label: "GPT-4o mini", value: "gpt-4o-mini" },
  { label: "Gemini Flash-Lite", value: "gemini-flash-lite" },
  { label: "DeepSeek V3.2", value: "deepseek-v3.2" },
  { label: "Cohere Command R+", value: "cohere-command-r-plus" },
];

function toModelLabel(model) {
  return String(model || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getAiModelOptions(envModel) {
  const value = String(envModel || "").trim();
  if (!value) return AI_MODELS;
  if (AI_MODELS.some((item) => item.value === value)) return AI_MODELS;
  return [{ label: `${toModelLabel(value)} (ENV)`, value }, ...AI_MODELS];
}

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

export default function Index() {
  const {
    defaultAiModel,
    envDefaultAiModel,
    shouldShowReviewPopup,
    hasSubmittedReview,
    shopOwnerName,
    generationStats,
    timeSavedHours,
    generatedWords,
    totalCredits,
    creditsLeft,
    creditsUsedTotal,
    currentPlan,
    currentPlanPrice,
  } = useLoaderData();
  const actionData = useActionData();
  const reviewFetcher = useFetcher();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const isSaving = navigation.state === "submitting";
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

  const [selectedModel, setSelectedModel] = useState(() =>
    typeof defaultAiModel === "string" && defaultAiModel.trim() ? defaultAiModel.trim() : "gpt-4o-mini",
  );
  const aiModelOptions = getAiModelOptions(envDefaultAiModel || defaultAiModel);

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

        {actionData ? (
          <Banner tone={actionData.success ? "success" : "critical"}>
            <p>{actionData.message}</p>
          </Banner>
        ) : null}

        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">Specific Generated Count</Text>
          <Grid columns={{ xs: 1, sm: 1, md: 2, lg: 3, xl: 3 }}>
            {specificCountBoxes.map((box) => (
              <Grid.Cell key={box.id}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">{box.title}</Text>
                    <BlockStack gap="100">
                      {box.rows.map((row) => (
                        <InlineStack key={row.label} align="space-between" blockAlign="center" wrap={false}>
                          <Text as="span" variant="bodySm" tone="subdued">{row.label}</Text>
                          <div
                            style={{
                              minWidth: "30px",
                              height: "28px",
                              padding: "0 10px",
                              borderRadius: "10px",
                              background: "#dbeafe",
                              color: "#1e3a8a",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 700,
                              fontSize: "12px",
                              lineHeight: 1,
                              flexShrink: 0,
                            }}
                          >
                            {row.value}
                          </div>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            ))}
            <Grid.Cell key="ai-model-box">
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">AI Model</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Select the default model used for content generation.
                  </Text>
                  <Form method="post">
                    <input type="hidden" name="intent" value="save_settings" />
                    <input type="hidden" name="defaultAiModel" value={selectedModel} />
                    <BlockStack gap="200">
                      <Select
                        label="AI model"
                        labelHidden
                        options={aiModelOptions}
                        value={selectedModel}
                        onChange={setSelectedModel}
                      />
                      <InlineStack align="start">
                        <Button size="slim" submit variant="primary" loading={isSaving} disabled={isSaving}>
                          {isSaving ? "Saving..." : "Save model"}
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Form>
                </BlockStack>
              </Card>
            </Grid.Cell>
          </Grid>
        </BlockStack>

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
      `}</style>
      </div>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
