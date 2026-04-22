import { useEffect, useState } from "react";
import {
  useLoaderData,
  useActionData,
  Form,
  useFetcher,
  useNavigation,
  useNavigate,
  useLocation,
  useRouteLoaderData,
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
import {
  ProductIcon,
  CollectionIcon,
  BlogIcon,
  PageIcon,
  ChartVerticalIcon,
  SettingsIcon,
  StarFilledIcon,
  ExternalIcon,
  EmailIcon,
  QuestionCircleIcon,
  AppsIcon,
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

  return {
    defaultAiModel: shopData?.defaultAiModel || envDefaultAiModel,
    envDefaultAiModel,
    shouldShowReviewPopup,
    hasSubmittedReview: Boolean(shopData?.reviewSubmittedAt),
    shopOwnerName,
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

function DashboardFeatureCard({ icon, title, desc, url, badge, badgeTone }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start">
          <InlineStack align="start" gap="200" blockAlign="center">
            <Icon source={icon} tone="base" />
            <Text as="h3" variant="headingSm">
              {title}
            </Text>
          </InlineStack>
          {badge ? <Badge tone={badgeTone}>{badge}</Badge> : null}
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {desc}
        </Text>
        <InlineStack align="start">
          <Button size="slim" onClick={() => navigate({ pathname: url, search: location.search })}>
            Open
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function QuickActionCard({ icon, title, description, ctaLabel, onClick }) {
  return (
    <Card>
      <div style={{ minHeight: 150, display: "flex", flexDirection: "column" }}>
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="center">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "#f6f6f7",
                border: "1px solid #e1e3e5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon source={icon} tone="subdued" />
            </div>
            <Text as="h3" variant="headingMd">
              {title}
            </Text>
          </InlineStack>
          <Text as="p" variant="bodyMd" tone="subdued">
            {description}
          </Text>
        </BlockStack>
        <div style={{ marginTop: "auto", paddingTop: 14 }}>
          <Button size="slim" onClick={onClick}>
            {ctaLabel}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function Index() {
  const { defaultAiModel, envDefaultAiModel, shouldShowReviewPopup, hasSubmittedReview, shopOwnerName } = useLoaderData();
  const layoutData = useRouteLoaderData("routes/app");
  const actionData = useActionData();
  const reviewFetcher = useFetcher();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();

  const credits = layoutData?.credits ?? 0;
  const isSaving = navigation.state === "submitting";

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

  return (
    <Page title="Dashboard" fullWidth>
      <div className="dashboard-uniform-buttons">
      <BlockStack gap="500">
        <Modal
          open={isReviewModalOpen}
          onClose={handleDismissReviewPopup}
          title="How is your experience with Product AI?"
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

        <Card>
          <div className="dashboard-welcome-card">
            <div className="dashboard-hero-layout">
              <BlockStack gap="100">
                <Text as="h3" variant="headingLg">
                  Hi {shopOwnerName} !
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Manage your apps and generate high-converting AI content for your store.
                </Text>
              </BlockStack>

              <div className="dashboard-hero-actions-col">
                <div className="dashboard-credit-pill">
                  <Icon source={StarFilledIcon} tone="subdued" />
                  <Text as="span" variant="bodyMd" tone="subdued">
                    {credits} credits.
                  </Text>
                  <button
                    type="button"
                    className="dashboard-upgrade-link"
                    onClick={() => navigate({ pathname: "/app/analytics", search: location.search })}
                  >
                    Upgrade
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {actionData ? (
          <Banner tone={actionData.success ? "success" : "critical"}>
            <p>{actionData.message}</p>
          </Banner>
        ) : null}

        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text variant="headingMd" as="h2">
                Generate Content
              </Text>
              <Text variant="bodySm" tone="subdued">
                Choose a content type to start generating.
              </Text>
            </BlockStack>
          </InlineStack>
          <Grid columns={{ xs: 1, sm: 2, md: 2, lg: 4, xl: 4 }}>
            {CONTENT_FEATURES.map((item) => (
              <Grid.Cell key={item.title}>
                <DashboardFeatureCard {...item} />
              </Grid.Cell>
            ))}
          </Grid>
        </BlockStack>

        <Grid columns={{ xs: 1, sm: 1, md: 3, lg: 3, xl: 3 }}>
          <Grid.Cell>
            <div style={{ height: "100%" }}>
              <QuickActionCard
                icon={ChartVerticalIcon}
                title="Analytics"
                description="Track usage, SEO performance, and generation trends."
                ctaLabel="Open analytics"
                onClick={() => navigate({ pathname: "/app/analytics", search: location.search })}
              />
            </div>
          </Grid.Cell>

          <Grid.Cell>
            <div style={{ height: "100%" }}>
              <QuickActionCard
                icon={SettingsIcon}
                title="Settings"
                description="Configure defaults for templates, language, and generation behavior."
                ctaLabel="Open settings"
                onClick={() => navigate({ pathname: "/app/settings", search: location.search })}
              />
            </div>
          </Grid.Cell>

          <Grid.Cell>
            <div style={{ height: "100%" }}>
              <Card>
                <div style={{ minHeight: 150, display: "flex", flexDirection: "column" }}>
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text variant="headingMd" as="h2">
                        Default AI Model
                      </Text>
                      <Text variant="bodySm" tone="subdued">
                        This model will be used for all generation tasks.
                      </Text>
                    </BlockStack>
                    <Form method="post">
                      <input type="hidden" name="intent" value="save_settings" />
                      <input type="hidden" name="defaultAiModel" value={selectedModel} />
                      <BlockStack gap="200">
                        <Select label="AI model" options={aiModelOptions} value={selectedModel} onChange={setSelectedModel} />
                      </BlockStack>
                      <div style={{ marginTop: 14, display: "flex", justifyContent: "start" }}>
                        <Button size="slim" submit variant="primary" loading={isSaving} disabled={isSaving}>
                          {isSaving ? "Saving..." : "Save model"}
                        </Button>
                      </div>
                    </Form>
                  </BlockStack>
                </div>
              </Card>
            </div>
          </Grid.Cell>
        </Grid>

        <Card>
          <BlockStack gap="400">
            <div className="dashboard-inline-title">
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
                    <div className="dashboard-inline-title">
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
                    <div className="dashboard-inline-title">
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
      </div>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
