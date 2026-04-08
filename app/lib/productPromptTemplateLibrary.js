export const PRODUCT_PROMPT_TEMPLATE_STORAGE_KEY = "product_prompt_template_selection_v1";

const EMPTY_TEMPLATE_SELECTION = {
  descriptionTemplateId: "",
  descriptionPromptTemplate: "",
  metaTitleTemplateId: "",
  metaTitlePromptTemplate: "",
  metaDescriptionTemplateId: "",
  metaDescriptionPromptTemplate: "",
};

function toStringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function normalizeTemplateSelection(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    descriptionTemplateId: toStringOrEmpty(input.descriptionTemplateId),
    descriptionPromptTemplate: toStringOrEmpty(input.descriptionPromptTemplate),
    metaTitleTemplateId: toStringOrEmpty(input.metaTitleTemplateId),
    metaTitlePromptTemplate: toStringOrEmpty(input.metaTitlePromptTemplate),
    metaDescriptionTemplateId: toStringOrEmpty(input.metaDescriptionTemplateId),
    metaDescriptionPromptTemplate: toStringOrEmpty(input.metaDescriptionPromptTemplate),
  };
}

export function getEmptyTemplateSelection() {
  return { ...EMPTY_TEMPLATE_SELECTION };
}

export function readStoredProductPromptTemplateSelection() {
  if (typeof window === "undefined") return getEmptyTemplateSelection();

  try {
    const raw = window.localStorage.getItem(PRODUCT_PROMPT_TEMPLATE_STORAGE_KEY);
    if (!raw) return getEmptyTemplateSelection();
    return normalizeTemplateSelection(JSON.parse(raw));
  } catch {
    return getEmptyTemplateSelection();
  }
}

export function writeStoredProductPromptTemplateSelection(selection) {
  const normalized = normalizeTemplateSelection(selection);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PRODUCT_PROMPT_TEMPLATE_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function clearStoredProductPromptTemplateSelection() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(PRODUCT_PROMPT_TEMPLATE_STORAGE_KEY);
  }
  return getEmptyTemplateSelection();
}

export const PRODUCT_DESCRIPTION_TEMPLATES = [
  {
    id: "problem-solution",
    name: "Problem-Solution",
    description: "Focuses on pain points, solution framing, and action-driven outcomes.",
    template:
      "[Identify common customer pain point]\n[Explain daily impact of that problem]\n[Introduce product as the solution]\n[Solution feature 1]\n[Solution feature 2]\n[Solution feature 3]\n[Testimonial or proof point]\n[Call to action with benefit reinforcement]\nKey features and benefits: Solutions and Results",
  },
  {
    id: "technical-specifications",
    name: "Technical Specifications",
    description: "Emphasizes detailed specs for tech and equipment products.",
    template:
      "[Product name and category]\n[Brief technical overview in 1-2 sentences]\n[Key specification 1 with measurement or rating]\n[Key specification 2 with measurement or rating]\n[Key specification 3 with measurement or rating]\n[Key specification 4 with measurement or rating]\n[Key specification 5 with measurement or rating]\n[Paragraph comparing to industry standards or alternatives]\nKey features and benefits: Precision and Performance",
  },
  {
    id: "lifestyle-integration",
    name: "Lifestyle Integration",
    description: "Illustrates how product enhances customer lifestyle and routines.",
    template:
      "[Evocative scenario where product fits customer lifestyle]\n[Emotional benefit]\n[Practical benefit]\n[Lifestyle enhancement 1]\n[Lifestyle enhancement 2]\n[Lifestyle enhancement 3]\n[Versatility highlight]\n[Social proof element]\nKey features and benefits: Lifestyle and Versatility",
  },
  {
    id: "eco-friendly-product",
    name: "Eco-Friendly Product",
    description: "Highlights sustainability benefits and environmental responsibility features.",
    template:
      "[Sustainability statement about product]\n[Environmental problem the product helps address]\n[How product is made sustainably]\n[Eco-friendly material/process 1]\n[Eco-friendly material/process 2]\n[Eco-friendly material/process 3]\n[End-of-life considerations]\n[Certification or measurable environmental impact]\nKey features and benefits: Sustainability and Responsibility",
  },
  {
    id: "premium-luxury-product",
    name: "Premium/Luxury Product",
    description: "Showcases craftsmanship, exclusivity, and high-end product value.",
    template:
      "[Exclusivity statement]\n[Heritage or craftsmanship highlight]\n[Premium materials description]\n[Luxury feature/detail 1]\n[Luxury feature/detail 2]\n[Luxury feature/detail 3]\n[Status or prestige element]\n[Limited availability or special edition information]\nKey features and benefits: Exclusivity and Prestige",
  },
  {
    id: "budget-friendly-product",
    name: "Budget-Friendly Product",
    description: "Emphasizes value and quality despite affordable pricing.",
    template:
      "[Value proposition statement]\n[Cost-effectiveness highlight]\n[Quality assurance despite lower price]\n[Essential feature 1]\n[Essential feature 2]\n[Essential feature 3]\n[Cost comparison or savings highlight]\n[Long-term value explanation]\nKey features and benefits: Value and Affordability",
  },
  {
    id: "seasonal-limited-edition",
    name: "Seasonal/Limited Edition",
    description: "Creates urgency for time-limited or special release products.",
    template:
      "[Seasonal relevance or limited-time offer]\n[Unique aspects for this edition]\n[Connection to trend, holiday, or occasion]\n[Special feature 1 for this edition]\n[Special feature 2 for this edition]\n[Special feature 3 for this edition]\n[Collectibility or exclusivity factor]\n[Urgency creator: limited availability]\nKey features and benefits: Uniqueness and Timeliness",
  },
  {
    id: "storytelling-narrative",
    name: "Storytelling Narrative",
    description: "Builds emotional connection through product origin and purpose story.",
    template:
      "[Origin story: why this product was created]\n[Problem or inspiration behind it]\n[Journey from concept to finished product]\n[Unique craftsmanship or design detail]\n[How it has helped real customers]\n[Key feature 1 rooted in story]\n[Key feature 2 rooted in story]\n[Invitation to become part of the story]\nKey features and benefits: Story and Connection",
  },
  {
    id: "social-proof-focus",
    name: "Social Proof Focus",
    description: "Leads with customer validation, reviews, and community trust signals.",
    template:
      "[Opening with customer praise or usage milestone]\n[Key reason customers love this product]\n[Top reviewed feature 1]\n[Top reviewed feature 2]\n[Top reviewed feature 3]\n[Who it is trusted by: audience segment]\n[Rating or award highlight if available]\n[Call to action reinforcing popularity]\nKey features and benefits: Trust and Popularity",
  },
  {
    id: "gift-occasion",
    name: "Gift & Occasion",
    description: "Frames product as an ideal gift for specific events and recipients.",
    template:
      "[Occasion statement: birthday, anniversary, holiday, etc.]\n[Why this product makes a memorable gift]\n[Who it is perfect for: recipient profile]\n[Giftable feature 1]\n[Giftable feature 2]\n[Packaging or presentation detail]\n[Personalisation or customisation option if available]\n[Urgency: order in time for occasion]\nKey features and benefits: Gifting and Occasion",
  },
  {
    id: "competitive-differentiation",
    name: "Competitive Differentiation",
    description: "Clearly positions product advantages over generic alternatives.",
    template:
      "[Common frustration with ordinary alternatives]\n[How this product is fundamentally different]\n[Advantage 1 vs. the standard option]\n[Advantage 2 vs. the standard option]\n[Advantage 3 vs. the standard option]\n[Verified proof point or test result]\n[Who makes the switch and why]\n[Call to action: upgrade today]\nKey features and benefits: Differentiation and Value",
  },
];

export const PRODUCT_META_DESCRIPTION_TEMPLATES = [
  {
    id: "md-basic-benefit",
    name: "Basic Benefit",
    description: "Highlights main product benefits with straightforward sales approach.",
    template:
      "{product_title} - {extract_main_benefit_from_description}. {extract_secondary_feature_from_description}. Shop now!",
  },
  {
    id: "md-problem-solution",
    name: "Problem-Solution",
    description: "Positions product as the solution to customer pain points.",
    template:
      "Solve {extract_problem_from_description} with {product_title}. {extract_key_feature_from_description}. Shop now!",
  },
  {
    id: "md-feature-promo",
    name: "Feature-Promo",
    description: "Combines key product features with promotional intent.",
    template:
      "{product_title}: {extract_primary_feature_from_description} & {extract_secondary_feature_from_description}. {detect_promotional_element_if_exists}. Buy today!",
  },
  {
    id: "md-premium-quality",
    name: "Premium Quality",
    description: "Emphasizes premium materials, quality, and construction.",
    template:
      "Premium {product_title} made with {extract_material_or_quality_indicators}. {extract_main_benefit_from_description}. Order now!",
  },
  {
    id: "md-target-audience",
    name: "Target Audience",
    description: "Addresses specific customer segments and use intent.",
    template:
      "Perfect for {extract_target_audience_from_description}: {product_title} delivers {extract_main_benefit_from_description}. Shop today!",
  },
  {
    id: "md-value-proposition",
    name: "Value Proposition",
    description: "Focuses on value-for-money and practical benefits.",
    template:
      "{product_title}: {extract_main_benefit_from_description} at an affordable price. {detect_promotional_element_if_exists}. Get yours now!",
  },
  {
    id: "md-experience-based",
    name: "Experience-Based",
    description: "Describes the customer experience and end benefit.",
    template:
      "Experience {extract_main_benefit_from_description} with {product_title}. {extract_secondary_benefit_from_description}. Shop now!",
  },
  {
    id: "md-feature-to-benefit",
    name: "Feature-to-Benefit",
    description: "Translates technical features into customer outcomes.",
    template:
      "{product_title} with {extract_key_feature_from_description} for {convert_feature_to_benefit}. Try it today!",
  },
  {
    id: "md-usage-occasion",
    name: "Usage Occasion",
    description: "Highlights where and when product is best used.",
    template:
      "{product_title}: Perfect for {extract_usage_occasion_from_description}. {extract_key_feature_from_description}. Shop now!",
  },
  {
    id: "md-elevation",
    name: "Elevation",
    description: "Positions product as an upgrade to current experience.",
    template:
      "Elevate {extract_use_case_from_description} with {product_title}. {extract_key_benefit_from_description}. Order today!",
  },
  {
    id: "md-discovery",
    name: "Discovery",
    description: "Creates excitement through novelty and differentiation.",
    template:
      "Discover {extract_unique_advantage_from_description} in {product_title}. {extract_secondary_benefit}. Limited stock!",
  },
  {
    id: "md-variety-options",
    name: "Variety Options",
    description: "Highlights multiple choices, versions, or configurations.",
    template:
      "{product_title} in {extract_varieties_or_options} for {extract_main_purpose_from_description}. {extract_unique_quality}. Order today!",
  },
  {
    id: "md-guarantee-assurance",
    name: "Guarantee & Assurance",
    description: "Reduces purchase hesitation with guarantees or risk-free messaging.",
    template:
      "{product_title}: {extract_main_benefit_from_description}. {guarantee_or_return_policy}. Risk-free — {trust_signal}. Shop today!",
  },
  {
    id: "md-gift-occasion",
    name: "Gift Occasion",
    description: "Targets gifting intent searches for specific events.",
    template:
      "The perfect {occasion_keyword} gift: {product_title}. {extract_main_benefit_from_description}. {delivery_or_packaging_note}.",
  },
  {
    id: "md-social-proof",
    name: "Social Proof",
    description: "Uses community trust and customer popularity to drive clicks.",
    template:
      "Loved by {customer_count_or_segment}: {product_title} delivers {extract_main_benefit_from_description}. {rating_or_review_signal}. Shop now!",
  },
];

export const PRODUCT_META_TITLE_TEMPLATES = [
  {
    id: "mt-benefit-first",
    name: "Benefit First",
    description: "Starts with customer benefit then product title.",
    template: "{main_benefit} | {product_title}",
  },
  {
    id: "mt-product-feature",
    name: "Product + Feature",
    description: "Combines product title with primary feature keyword.",
    template: "{product_title} - {primary_feature}",
  },
  {
    id: "mt-intent-buy-now",
    name: "Buy Intent",
    description: "Adds shopping intent keyword while staying concise.",
    template: "Buy {product_title} | {primary_benefit}",
  },
  {
    id: "mt-category-seo",
    name: "Category SEO",
    description: "Uses product title with category and core term.",
    template: "{product_title} {category_keyword} | {brand_name}",
  },
  {
    id: "mt-problem-solution",
    name: "Problem-Solution",
    description: "Frames product as fast solution in search snippets.",
    template: "{solve_problem_keyword} with {product_title}",
  },
  {
    id: "mt-quality-value",
    name: "Quality + Value",
    description: "Signals quality and price-value positioning.",
    template: "{product_title} - Quality at Great Value",
  },
  {
    id: "mt-usage-occasion",
    name: "Usage Occasion",
    description: "Targets use-case-based search behavior.",
    template: "{product_title} for {usage_occasion}",
  },
  {
    id: "mt-promo",
    name: "Promo Ready",
    description: "Includes time-sensitive offer language when needed.",
    template: "{product_title} | {promo_phrase}",
  },
  {
    id: "mt-review-signal",
    name: "Review Signal",
    description: "Incorporates rating or review trust marker.",
    template: "{product_title} - {rating_or_review_count} | {primary_benefit}",
  },
  {
    id: "mt-best-for-audience",
    name: "Best For Audience",
    description: "Targets specific buyer profiles in the title.",
    template: "Best {product_title} for {target_audience}",
  },
  {
    id: "mt-gift-intent",
    name: "Gift Intent",
    description: "Targets gift-search queries for specific occasions.",
    template: "{product_title} - Perfect Gift for {occasion_or_recipient}",
  },
];
