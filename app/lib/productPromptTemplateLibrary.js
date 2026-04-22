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
    description: "Shows how the product solves a specific customer pain point with clear before-and-after framing.",
    template:
      "Write a compelling product description (120–200 words) using a problem-solution framework.\n- Open with the customer's key pain point to create immediate relevance.\n- Describe the daily frustration or impact of living with the problem unsolved.\n- Introduce the product as the clear, effective solution.\n- Highlight 3 specific features that directly address the problem.\n- Include a social proof signal or testimonial reference.\n- Close with a benefit-reinforced call to action.\n- Tone: empathetic, direct, and results-focused.",
  },
  {
    id: "technical-specifications",
    name: "Technical Specifications",
    description: "Lists key specs and performance metrics with precision, ideal for tech-savvy shoppers.",
    template:
      "Write a precise technical product description (150–250 words) for detail-oriented buyers.\n- Open with the product name and its primary technical category.\n- Provide a 1–2 sentence technical overview of core capabilities.\n- List 5 key specifications with measurements, ratings, or performance data.\n- Compare performance to industry standards or common alternatives.\n- Use accurate, jargon-appropriate language suited to the technical audience.\n- Tone: factual, precise, and authoritative.",
  },
  {
    id: "lifestyle-integration",
    name: "Lifestyle Integration",
    description: "Connects the product to the customer's everyday lifestyle with emotional and practical benefits.",
    template:
      "Write an evocative product description (130–200 words) that connects the product to everyday life.\n- Open with a vivid scenario where the product fits naturally into the customer's lifestyle.\n- Highlight the emotional benefit the product brings to daily routines.\n- Describe a practical, everyday advantage the customer gains.\n- List 3 lifestyle enhancements or use-case moments.\n- Emphasise versatility — how it fits different contexts or occasions.\n- Include an aspirational or social proof element.\n- Tone: warm, aspirational, and relatable.",
  },
  {
    id: "eco-friendly-product",
    name: "Eco-Friendly Product",
    description: "Highlights sustainability, eco-certifications, and ethical sourcing for conscious consumers.",
    template:
      "Write a sustainability-focused product description (130–200 words) for eco-conscious consumers.\n- Open with a clear sustainability statement about the product.\n- Identify the environmental problem the product helps address.\n- Explain how the product is made sustainably or ethically.\n- List 3 eco-friendly materials, processes, or certifications.\n- Include end-of-life or recyclability considerations.\n- Close with a measurable environmental impact or certification.\n- Tone: responsible, transparent, and values-driven.",
  },
  {
    id: "premium-luxury-product",
    name: "Premium/Luxury Product",
    description: "Emphasises exclusivity, craftsmanship, and prestige for high-end product positioning.",
    template:
      "Write a sophisticated product description (120–200 words) that signals luxury and brand prestige.\n- Emphasise craftsmanship, provenance, and premium materials throughout.\n- Convey timeless value and collector or connoisseur appeal.\n- Highlight 3 luxury details that justify the premium positioning.\n- Reference exclusivity, limited availability, or heritage where relevant.\n- Keep claims credible; avoid hyperbole or hollow superlatives.\n- Structure: 2 short paragraphs followed by 4–6 bullet points of refined features.\n- Tone: elevated, restrained, and brand-consistent.",
  },
  {
    id: "budget-friendly-product",
    name: "Budget-Friendly Product",
    description: "Focuses on value, affordability, and cost savings without compromising on quality signals.",
    template:
      "Write a value-focused product description (120–180 words) that reassures the price-conscious buyer.\n- Open with a compelling value proposition statement.\n- Highlight cost-effectiveness without undermining quality perception.\n- Include 1–2 quality assurances that justify the purchase decision.\n- List 3 essential features that deliver real-world usefulness.\n- Provide a cost comparison or savings context.\n- Close with a long-term value explanation.\n- Tone: honest, practical, and confidence-building.",
  },
  {
    id: "seasonal-limited-edition",
    name: "Seasonal/Limited Edition",
    description: "Creates urgency around seasonal relevance or limited availability to drive immediate action.",
    template:
      "Write an urgent, occasion-driven product description (120–180 words) for a seasonal or limited edition.\n- Open with the seasonal relevance or limited-time framing.\n- Highlight what makes this edition unique or special.\n- Connect to a trend, holiday, or specific occasion.\n- List 3 features exclusive to this edition.\n- Include a collectibility or exclusivity element.\n- Close with a clear scarcity or urgency signal.\n- Tone: exciting, timely, and action-oriented.",
  },
  {
    id: "storytelling-narrative",
    name: "Storytelling Narrative",
    description: "Builds brand connection through the product's origin story and craftsmanship journey.",
    template:
      "Write a brand-storytelling product description (140–220 words) that creates emotional connection.\n- Open with the origin story: why this product was created.\n- Describe the problem or inspiration behind its development.\n- Walk through the journey from concept to finished product.\n- Highlight a unique craftsmanship or design detail.\n- Include how it has helped real customers or changed outcomes.\n- Ground 2 key features in the product's story.\n- Close with an invitation to become part of the story.\n- Tone: authentic, narrative-driven, and brand-connected.",
  },
  {
    id: "social-proof-focus",
    name: "Social Proof Focus",
    description: "Leads with customer trust, reviews, and popularity signals to boost buyer confidence.",
    template:
      "Write a trust-led product description (120–190 words) that leads with social proof and popularity.\n- Open with a customer praise signal, review milestone, or usage statistic.\n- State the primary reason customers love this product.\n- Highlight the 3 most-reviewed or praised features.\n- Identify the audience segment that trusts or recommends it most.\n- Include a rating, award, or editorial mention if available.\n- Close with a call to action that reinforces its popularity.\n- Tone: confident, community-driven, and trustworthy.",
  },
  {
    id: "gift-occasion",
    name: "Gift & Occasion",
    description: "Positions the product as a memorable gift for special occasions with recipient-focused language.",
    template:
      "Write a gift-focused product description (120–180 words) for occasion-driven shoppers.\n- Open by naming the occasion: birthday, anniversary, holiday, or milestone.\n- Explain why this product makes a truly memorable and thoughtful gift.\n- Describe who it is perfect for with vivid recipient detail.\n- List 2 standout giftable features or moments.\n- Describe packaging, presentation, or unboxing experience.\n- Mention any personalisation or customisation option if available.\n- Close with a light urgency cue tied to the occasion.\n- Tone: warm, celebratory, and gift-centric.",
  },
  {
    id: "competitive-differentiation",
    name: "Competitive Differentiation",
    description: "Highlights what sets this product apart from alternatives with direct comparison language.",
    template:
      "Write a differentiation-led product description (130–200 words) that highlights what sets this product apart.\n- Open with a common frustration shoppers have with ordinary alternatives.\n- Explain how this product is fundamentally different or superior.\n- List 3 clear advantages over the standard or competing option.\n- Include a proof point: test result, certification, or performance data.\n- Describe who makes the switch and why they don't go back.\n- Close with a direct call to action to upgrade.\n- Tone: confident, comparative, and evidence-driven.",
  },
  {
    id: "tone-professional",
    name: "Professional Tone",
    description: "Formal, professional tone for B2B, enterprise, or premium product audiences.",
    template:
      "Write a formal, professional product description (130–200 words) for B2B or enterprise buyers.\n- Maintain a formal, precise tone throughout — no colloquialisms or casual language.\n- Open with the product name and its primary professional purpose.\n- State a key technical capability or quality specification.\n- Describe 3 features with precision, clarity, and measurable context.\n- Include a compliance, certification, or reliability assurance.\n- Close with a professional-grade use case or industry application.\n- Tone: authoritative, measured, and credibility-focused.",
  },
  {
    id: "tone-friendly",
    name: "Friendly & Casual Tone",
    description: "Warm, conversational tone that speaks directly to everyday consumer shoppers.",
    template:
      "Write a warm, conversational product description (120–180 words) that speaks directly to everyday shoppers.\n- Maintain a friendly, casual, and approachable tone throughout.\n- Open with a relatable line that speaks directly to the reader.\n- Explain why customers genuinely love using this product.\n- Describe 2 ways it makes everyday life a little better.\n- State an easy-to-understand benefit or outcome.\n- Describe who it's perfect for in simple, inclusive language.\n- Close with a light, inviting call to action.\n- Tone: conversational, upbeat, and human.",
  },
  {
    id: "tone-persuasive",
    name: "Persuasive & Sales-Focused",
    description: "Bold, sales-driven tone with urgency and social proof to maximise conversions.",
    template:
      "Write a bold, high-converting product description (120–190 words) designed to drive immediate action.\n- Maintain a persuasive, sales-driven, energetic tone throughout.\n- Open with a powerful claim that grabs attention immediately.\n- Frame the key problem this product solves with urgency.\n- Present 2 strongest differentiators with direct, immediate benefits.\n- Include a social proof element: reviews, customer count, or milestone.\n- Add a risk-reversal signal: money-back guarantee, warranty, or satisfaction promise.\n- Close with a strong, urgent call to action.\n- Tone: bold, direct, and conversion-focused.",
  },
  {
    id: "tone-informational",
    name: "Informational / Technical",
    description: "Clear, factual tone for technical or data-focused products requiring specification accuracy.",
    template:
      "Write a clear, factual product description (130–200 words) for information-seeking, technical buyers.\n- Maintain a factual, informational tone — avoid marketing language or hype.\n- Open with the product category and its primary functional purpose.\n- State 3 key technical specifications with units of measurement.\n- Include compatibility, integration, or certification detail.\n- Reference a performance benchmark or validated test result.\n- Close with the recommended professional use case or application context.\n- Tone: objective, structured, and specification-driven.",
  },
];

export const PRODUCT_META_DESCRIPTION_TEMPLATES = [
  {
    id: "md-basic-benefit",
    name: "Basic Benefit",
    description: "Simple benefit-led meta description under 155 characters for broad appeal.",
    template:
      "Write a meta description (120–155 characters) that leads with the product's primary benefit.\n- Open with {product_title} and its main benefit.\n- Add a secondary feature for relevance.\n- End with a clear call to action: \"Shop now!\"\n- Stay within 155 characters; every word must earn its place.",
  },
  {
    id: "md-problem-solution",
    name: "Problem-Solution",
    description: "Addresses a customer problem and positions the product as the solution.",
    template:
      "Write a meta description (130–155 characters) using a problem-solution format.\n- Frame the customer's core problem in 5–7 words.\n- Position {product_title} as the direct solution.\n- Reference one key feature that solves the problem.\n- End with \"Shop now!\" or a clear action phrase.",
  },
  {
    id: "md-feature-promo",
    name: "Feature-Promo",
    description: "Combines two key product features with a promotional call-to-action.",
    template:
      "Write a meta description (130–155 characters) combining features with a promotional hook.\n- Name {product_title} followed by its two strongest features.\n- Include a promotional element (offer, bonus, or deal) if one exists.\n- End with a buying call to action: \"Buy today!\"",
  },
  {
    id: "md-premium-quality",
    name: "Premium Quality",
    description: "Highlights premium materials and quality craftsmanship for luxury positioning.",
    template:
      "Write a meta description (130–155 characters) that communicates premium quality.\n- Open with \"Premium\" and {product_title}.\n- Reference materials, craftsmanship, or quality indicators.\n- State the primary benefit in concrete terms.\n- End with \"Order now!\" or a similar action phrase.",
  },
  {
    id: "md-target-audience",
    name: "Target Audience",
    description: "Speaks directly to the ideal customer segment to improve click-through rate.",
    template:
      "Write a meta description (130–155 characters) that addresses the ideal customer segment.\n- Open with \"Perfect for [target audience]:\".\n- Name {product_title} and its primary benefit for that audience.\n- End with \"Shop today!\" to encourage the click.",
  },
  {
    id: "md-value-proposition",
    name: "Value Proposition",
    description: "Emphasises affordability and value for money with a clear offer statement.",
    template:
      "Write a meta description (130–155 characters) centred on value and affordability.\n- Name {product_title} and its main benefit.\n- Reference affordability or value without cheapening the product.\n- Include a promotional element if applicable.\n- End with \"Get yours now!\" or \"Shop today!\"",
  },
  {
    id: "md-experience-based",
    name: "Experience-Based",
    description: "Focuses on the experience the product delivers using aspirational language.",
    template:
      "Write a meta description (130–155 characters) focused on the customer experience.\n- Open with \"Experience [main benefit]\" to lead with aspiration.\n- Name {product_title} and a secondary benefit.\n- End with \"Shop now!\" for a clear click prompt.",
  },
  {
    id: "md-feature-to-benefit",
    name: "Feature-to-Benefit",
    description: "Converts a product feature into a clear, tangible customer benefit.",
    template:
      "Write a meta description (130–155 characters) that converts a feature into a clear benefit.\n- Name {product_title} with its key feature.\n- Translate that feature into a tangible customer benefit.\n- End with \"Try it today!\" or \"Shop now!\"",
  },
  {
    id: "md-usage-occasion",
    name: "Usage Occasion",
    description: "Links the product to a specific use case or moment to improve relevance.",
    template:
      "Write a meta description (130–155 characters) linking the product to a specific use occasion.\n- Name {product_title} followed by a colon.\n- Describe the perfect use case or moment.\n- Add the key feature for credibility.\n- End with \"Shop now!\"",
  },
  {
    id: "md-elevation",
    name: "Elevation",
    description: "Elevates the product's perceived value with aspirational, upgrade-focused language.",
    template:
      "Write a meta description (130–155 characters) using aspirational, elevating language.\n- Open with \"Elevate [use case]\" to signal upgrade.\n- Name {product_title} and its key benefit.\n- End with \"Order today!\" for a decisive click prompt.",
  },
  {
    id: "md-discovery",
    name: "Discovery",
    description: "Creates curiosity and urgency with scarcity language to drive immediate clicks.",
    template:
      "Write a meta description (130–155 characters) that creates curiosity and urgency.\n- Open with \"Discover [unique advantage]\" to spark interest.\n- Name {product_title} with a secondary benefit.\n- Include a scarcity signal: \"Limited stock!\"",
  },
  {
    id: "md-variety-options",
    name: "Variety Options",
    description: "Highlights the range of options or variants available to match different needs.",
    template:
      "Write a meta description (130–155 characters) that highlights product variety or range.\n- Name {product_title} and the variety or options available.\n- State the main purpose or use these options serve.\n- Include a quality differentiator.\n- End with \"Order today!\"",
  },
  {
    id: "md-guarantee-assurance",
    name: "Guarantee & Assurance",
    description: "Builds trust with guarantees and risk-reversal signals to reduce purchase hesitation.",
    template:
      "Write a meta description (130–155 characters) built around trust and risk reversal.\n- Name {product_title} and its primary benefit.\n- Reference a guarantee, warranty, or return policy.\n- Add a trust signal: rating, years in business, or customer count.\n- End with \"Shop today!\"",
  },
  {
    id: "md-gift-occasion",
    name: "Gift Occasion",
    description: "Frames the product as a perfect gift for specific occasions to capture gift shoppers.",
    template:
      "Write a meta description (130–155 characters) framing the product as the ideal gift.\n- Open with \"The perfect [occasion] gift:\".\n- Name {product_title} and its top benefit.\n- Include a delivery or packaging assurance.",
  },
  {
    id: "md-social-proof",
    name: "Social Proof",
    description: "Leverages customer trust signals, ratings, and reviews to boost CTR.",
    template:
      "Write a meta description (130–155 characters) led by social proof signals.\n- Open with \"Loved by [count or segment]:\".\n- Name {product_title} and its primary benefit.\n- Include a rating or review signal.\n- End with \"Shop now!\"",
  },
];

export const PRODUCT_META_TITLE_TEMPLATES = [
  {
    id: "mt-benefit-first",
    name: "Benefit First",
    description: "Leads with the main benefit before the product name to capture benefit-driven searches.",
    template:
      "Write a meta title (50–65 characters) that leads with the primary benefit.\n- Put the main customer benefit first for immediate impact.\n- Separate from {product_title} with a pipe character.\n- Format: \"Primary Benefit | Product Name\"\n- Stay within 65 characters to prevent search truncation.",
  },
  {
    id: "mt-product-feature",
    name: "Product + Feature",
    description: "Pairs the product name with its primary feature for feature-driven search queries.",
    template:
      "Write a meta title (50–65 characters) pairing the product name with its key feature.\n- Open with {product_title}.\n- Add a dash followed by the defining feature.\n- Format: \"Product Name – Key Feature\"\n- Keep it factual and search-relevant.",
  },
  {
    id: "mt-intent-buy-now",
    name: "Buy Intent",
    description: "Targets high-purchase-intent search queries with 'Buy' action words.",
    template:
      "Write a meta title (50–65 characters) targeting high purchase intent.\n- Open with \"Buy\" followed by {product_title}.\n- Add a pipe separator and the primary benefit.\n- Format: \"Buy Product Name | Primary Benefit\"\n- Match high-intent buyer language.",
  },
  {
    id: "mt-category-seo",
    name: "Category SEO",
    description: "Optimised for category-based search terms with brand name inclusion.",
    template:
      "Write a meta title (50–65 characters) optimised for category-based search.\n- Include {product_title} and the product category keyword.\n- Add the brand name after a pipe.\n- Format: \"Product Name Category Keyword | Brand\"\n- Prioritise the most-searched category term.",
  },
  {
    id: "mt-problem-solution",
    name: "Problem-Solution",
    description: "Targets problem-based search queries to capture customers seeking solutions.",
    template:
      "Write a meta title (50–65 characters) targeting problem-based search queries.\n- Frame the solution the product provides in active verb form.\n- Use \"with {product_title}\" to connect solution to product.\n- Format: \"Solve [Problem] with Product Name\"\n- Match the language of the customer's search query.",
  },
  {
    id: "mt-quality-value",
    name: "Quality + Value",
    description: "Signals both quality and great value to attract price-conscious shoppers.",
    template:
      "Write a meta title (50–65 characters) signalling both quality and value.\n- Lead with {product_title}.\n- Add \"– Quality at Great Value\" as the qualifier.\n- Keep it factual, concise, and credible.",
  },
  {
    id: "mt-usage-occasion",
    name: "Usage Occasion",
    description: "Matches the product to a specific use occasion for contextual search targeting.",
    template:
      "Write a meta title (50–65 characters) matched to a specific usage occasion.\n- Lead with {product_title}.\n- Follow with \"for [usage occasion]\".\n- The occasion should match real buyer search intent.\n- Format: \"Product Name for Use Occasion\"",
  },
  {
    id: "mt-promo",
    name: "Promo Ready",
    description: "Includes a promotional phrase to drive higher click-through rates.",
    template:
      "Write a meta title (50–65 characters) with a promotional phrase.\n- Lead with {product_title}.\n- Add a pipe separator and a short promotional phrase.\n- Format: \"Product Name | Promo Phrase\"\n- Make the promo feel timely and genuine.",
  },
  {
    id: "mt-review-signal",
    name: "Review Signal",
    description: "Adds social proof signals like ratings to boost CTR from search results.",
    template:
      "Write a meta title (50–65 characters) incorporating a review or rating signal.\n- Lead with {product_title}.\n- Add a dash, the rating or review count, then a pipe and primary benefit.\n- Format: \"Product Name – Rating | Primary Benefit\"\n- Use a real or representative rating figure.",
  },
  {
    id: "mt-best-for-audience",
    name: "Best For Audience",
    description: "Targets a specific audience segment to improve relevance for niche searches.",
    template:
      "Write a meta title (50–65 characters) targeting a specific audience segment.\n- Open with \"Best {product_title}\".\n- Follow with \"for [target audience]\".\n- Format: \"Best Product Name for Target Audience\"\n- Be specific — niche audiences click more.",
  },
  {
    id: "mt-gift-intent",
    name: "Gift Intent",
    description: "Targets gift-shopping search queries for occasion-based purchases.",
    template:
      "Write a meta title (50–65 characters) targeting gift-shopping search queries.\n- Lead with {product_title}.\n- Add \"– Perfect Gift for [occasion or recipient]\".\n- Format: \"Product Name – Perfect Gift for Occasion\"\n- Match seasonal or occasion-based search language.",
  },
];
