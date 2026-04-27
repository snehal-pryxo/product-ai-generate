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

const ADDITIONAL_PRODUCT_DESCRIPTION_TEMPLATES = [
  {
    id: "artisan-heritage-description",
    name: "Artisan Heritage Description",
    category: "Brands & Luxury",
    description: "Celebrates master craftsmanship, workshop heritage, and the individual character of each piece.",
    template: `Write an artisan-focused luxury description (150-280 words) that celebrates master craftsmanship:
- Begin with the artisan's story or workshop heritage
- Detail specific hand-crafted techniques and time investment
- Emphasize uniqueness and individual character of each piece
- Include materials sourcing and quality standards
- Structure: Artisan story + craftsmanship details + unique qualities
- Use reverent, respectful tone toward the craft`,
  },
  {
    id: "limited-edition-collectible-description",
    name: "Limited Edition Collectible Description",
    category: "Brands & Luxury",
    description: "Frames a product as exclusive, collectible, authenticated, and investment-worthy.",
    template: `Write a limited edition luxury description (180-260 words):
- Open with the exclusivity and limited numbers
- Explain the inspiration or occasion for this edition
- Detail what makes this version unique or special
- Include authentication and collectibility elements
- Structure: Exclusivity + inspiration story + unique features + collectible value
- Use collector-focused, investment-minded language`,
  },
  {
    id: "exclusive-materials-description",
    name: "Exclusive Materials Description",
    category: "Brands & Luxury",
    description: "Highlights rare materials, sourcing origins, and superior material qualities.",
    template: `Create a materials-focused luxury description (120-200 words):
- Lead with the rarity or exclusivity of primary materials
- Detail the sourcing story and geographic origins
- Explain what makes these materials superior
- Include sustainability or ethical sourcing when applicable
- Structure: Material rarity + sourcing story + superior qualities
- Maintain sophisticated, knowledgeable tone`,
  },
  {
    id: "investment-heirloom-description",
    name: "Investment Heirloom Description",
    category: "Brands & Luxury",
    description: "Positions the product as a long-term heirloom with lasting value and legacy appeal.",
    template: `Create an investment-focused luxury description (140-220 words):
- Position the item as a long-term investment, not a purchase
- Emphasize appreciation in value and character over time
- Include generational appeal and heirloom quality
- Mention care, maintenance, and longevity
- Structure: Investment value + aging benefits + generational legacy
- Use wealth-building, legacy-focused language`,
  },
  {
    id: "bespoke-customization-description",
    name: "Bespoke Customization Description",
    category: "Brands & Luxury",
    description: "Explains a personal consultation and one-of-a-kind bespoke creation process.",
    template: `Write a bespoke luxury description (160-240 words):
- Emphasize the personal consultation and design process
- Detail customization options and personal touches
- Include timeline and craftsmanship journey
- Mention exclusivity of one-of-a-kind creation
- Structure: Personal consultation + customization options + creation journey
- Use intimate, personal service language`,
  },
  {
    id: "shopify-pdp-description",
    name: "Shopify PDP Description",
    category: "Marketplace & Channel",
    description: "Creates a practical Shopify product detail page structure with benefits, bullets, and reassurance.",
    template: `Write a PDP description (120-180 words) with:
- Short intro benefit line
- 4-5 bullets for features
- Care/fit or sizing note
- Shipping/returns reassurance line`,
  },
  {
    id: "amazon-a-plus-description",
    name: "Amazon A+ Description",
    category: "Marketplace & Channel",
    description: "Creates an Amazon-ready headline and benefit bullets that handle common objections.",
    template: `Write an Amazon-optimized description:
- 1-sentence headline + 5-7 benefit bullets
- Include material, sizing/capacity, warranty if relevant
- Address common objections such as fit, durability, and compatibility`,
  },
  {
    id: "etsy-handmade-marketplace-description",
    name: "Etsy Handmade Marketplace Description",
    category: "Marketplace & Channel",
    description: "Uses a warm maker-to-buyer style for handmade marketplace listings.",
    template: `Write an Etsy-optimized description (180-250 words) that tells your maker story:
- Open with personal connection or inspiration behind the item
- Detail handmade process and materials sourcing
- Include customization options and personal touches
- Add care instructions and shipping details
- Structure: Personal story + handmade process + customization + practical details
- Use warm, authentic, maker-to-buyer language`,
  },
  {
    id: "ebay-auction-detailed-description",
    name: "eBay Auction Detailed Description",
    category: "Marketplace & Channel",
    description: "Builds a transparent eBay auction listing with condition, specs, flaws, and policies.",
    template: `Write an eBay auction description (200-280 words) with complete transparency:
- Start with item condition and authenticity verification
- Include detailed specifications and measurements
- List any flaws, wear, or imperfections honestly
- Add provenance, purchase history, or storage details
- Include shipping, returns, and payment policies
- Structure: Condition/authenticity + specs + flaws + policies
- Use honest, detailed, seller-credibility language`,
  },
  {
    id: "editorial-professional-standards-description",
    name: "Editorial & Professional Standards Description",
    category: "Compliance & Accuracy",
    description: "Follows Google Merchant Center-style editorial standards with professional wording.",
    template: `Write a professional product description (100-200 words) that meets Google Merchant Center editorial standards:
- Use proper grammar, spelling, and punctuation
- Avoid excessive capitalization, symbols, or promotional language
- Focus on product features, specifications, and benefits
- Include relevant details like size, material, color, and compatibility
- Maintain professional tone without being overly promotional
- Ensure accuracy and relevance to the actual product`,
  },
  {
    id: "accurate-product-information-description",
    name: "Accurate Product Information Description",
    category: "Compliance & Accuracy",
    description: "Prioritizes verified specs, exact contents, compatibility, and factual claims.",
    template: `Write an accurate, detailed product description (180-280 words) with verified specifications:
- Include precise measurements and technical specifications
- Provide accurate compatibility information
- List exact contents and included accessories
- Specify materials and manufacturing details
- Include proper certifications and standards
- Ensure all claims are verifiable and factual
- Avoid approximations or vague descriptions`,
  },
  {
    id: "non-promotional-product-description",
    name: "Non-Promotional Product Description",
    category: "Compliance & Accuracy",
    description: "Keeps product copy factual, neutral, and free from promotional claims.",
    template: `Write a factual product description (100-180 words) without promotional language:
- Focus on product specifications and features
- Avoid sales language like "best," "amazing," or "incredible"
- Include technical details and dimensions
- Describe functionality and compatibility
- Use neutral, informative tone
- Stick to verifiable product characteristics`,
  },
  {
    id: "return-policy-compliant-description",
    name: "Return Policy Compliant Description",
    category: "Compliance & Accuracy",
    description: "Clarifies expectations around size, package contents, usage, and care to reduce returns.",
    template: `Write a detailed product description (150-250 words) that supports clear customer expectations and return policies:
- Provide accurate size, fit, and compatibility information
- Include detailed specifications to prevent misunderstandings
- Clearly describe what's included in the package
- Avoid ambiguous language about product features
- Help customers make informed purchasing decisions
- Include care and usage instructions when relevant`,
  },
  {
    id: "safety-compliance-description",
    name: "Safety & Compliance Description",
    category: "Compliance & Accuracy",
    description: "Highlights safety standards, certifications, warnings, and proper product usage.",
    template: `Create a safety-focused product description (120-200 words):
- Highlight relevant safety certifications and standards
- Include age recommendations or restrictions where applicable
- Mention compliance with relevant regulations
- Describe safety features and proper usage
- Include warnings or precautions when necessary
- Avoid making unsubstantiated safety claims`,
  },
  {
    id: "clear-pricing-availability-description",
    name: "Clear Pricing & Availability Description",
    category: "Compliance & Accuracy",
    description: "Avoids misleading urgency, price, or availability language while communicating product value.",
    template: `Create a transparent product description (120-180 words) that clearly communicates product details without misleading pricing or availability claims:
- Avoid "limited time" or urgency language
- Do not mention specific prices, discounts, or promotional offers
- Focus on product value and genuine benefits
- Include clear specifications and compatibility
- Ensure all claims are accurate and verifiable
- Avoid superlatives unless factually accurate`,
  },
  {
    id: "lifestyle-emotion-description",
    name: "Lifestyle & Emotion Description",
    category: "Lifestyle & Emotion",
    description: "Paints a sensory, emotion-forward scene of use.",
    template: `Write an emotion-forward description (100-160 words) that paints a scene of use and how it feels.
- Use one short paragraph
- Add 3 sensory bullets
- Focus on lived experience, mood, and emotional payoff`,
  },
  {
    id: "family-bonding-memories-description",
    name: "Family Bonding & Memories Description",
    category: "Lifestyle & Emotion",
    description: "Connects the product to family traditions, shared experiences, and lasting memories.",
    template: `Write a family-focused description (170-240 words) that celebrates family bonds and memories:
- Open with a warm family scene or tradition
- Emphasize multi-generational appeal and shared experiences
- Include specific family activities and bonding moments
- Connect to lasting memories and family traditions
- End with legacy and family values
- Use warm, inclusive, family-oriented language`,
  },
  {
    id: "romance-relationship-description",
    name: "Romance & Relationship Description",
    category: "Lifestyle & Emotion",
    description: "Frames the product around intimacy, romance, gifting, and emotional connection.",
    template: `Create a romance-focused description (130-190 words) that celebrates love and connection:
- Set an intimate, romantic scene
- Focus on shared moments and emotional connection
- Include sensory details that enhance romance
- Suggest romantic occasions and gift-giving
- End with emotional payoff about lasting love
- Use warm, intimate, relationship-focused language`,
  },
  {
    id: "wellness-self-care-description",
    name: "Wellness & Self-Care Description",
    category: "Lifestyle & Emotion",
    description: "Speaks to self-care rituals, stress relief, and emotional transformation.",
    template: `Create a wellness-focused description (140-200 words) that speaks to emotional transformation:
- Open with a relatable stress or challenge
- Paint a picture of the desired emotional state
- Include sensory experiences and ritual elements
- Connect to daily self-care routines
- End with emotional outcome and empowerment
- Use nurturing, supportive, transformative language`,
  },
  {
    id: "adventure-outdoor-lifestyle-description",
    name: "Adventure & Outdoor Lifestyle Description",
    category: "Lifestyle & Emotion",
    description: "Captures outdoor exploration, freedom, reliability, and adventure scenarios.",
    template: `Write an adventure-focused description (180-250 words) that captures the spirit of exploration:
- Set the scene with an inspiring outdoor moment
- Connect to the feeling of freedom and discovery
- Include specific adventure scenarios and environments
- Emphasize reliability and performance in nature
- End with aspirational call to adventure
- Use inspiring, energetic, freedom-focused language`,
  },
  {
    id: "bundle-upsell-description",
    name: "Bundle/Upsell Description",
    category: "Marketing & Sales",
    description: "Frames a bundle offer with included items, savings, audience fit, and a simple CTA.",
    template: `Write a bundle description with value framing:
- What is included as a bullet list
- Cost comparison or saving
- Who it is perfect for
- Simple CTA`,
  },
  {
    id: "abandoned-cart-recovery-description",
    name: "Abandoned Cart Recovery Description",
    category: "Marketing & Sales",
    description: "Gently persuades customers to return to their cart without sounding aggressive.",
    template: `Write an abandoned cart recovery description (130-190 words) that gently persuades:
- Reference specific items left behind
- Create gentle urgency without being pushy
- Include incentive or limited-time offer
- Address common objections such as price and shipping
- End with easy one-click return to cart
- Use friendly, helpful, non-aggressive language`,
  },
  {
    id: "flash-sale-urgency-description",
    name: "Flash Sale Urgency Description",
    category: "Marketing & Sales",
    description: "Creates high-urgency sale copy with time sensitivity, scarcity, and deal value.",
    template: `Create a flash sale description (120-180 words) with maximum urgency:
- Lead with time-sensitive alert and countdown language
- Include specific discount percentage and savings amount
- Add scarcity elements such as limited stock and limited time
- List what is included in the deal with value emphasis
- End with compelling call-to-action
- Use urgent, energetic, action-driving language`,
  },
  {
    id: "customer-loyalty-program-description",
    name: "Customer Loyalty Program Description",
    category: "Marketing & Sales",
    description: "Explains loyalty tiers, exclusive perks, member benefits, and signup motivation.",
    template: `Write a loyalty program description (180-250 words) that showcases exclusive benefits:
- Open with VIP treatment and exclusivity
- Detail tier system and earning structure
- Include specific perks and member-only benefits
- Add social proof and member testimonials
- End with easy signup process
- Use aspirational, exclusive, reward-focused language`,
  },
  {
    id: "referral-program-description",
    name: "Referral Program Description",
    category: "Marketing & Sales",
    description: "Motivates customers to share using dual rewards and community language.",
    template: `Create a referral program description (140-200 words) that motivates sharing:
- Explain dual reward system for referrer and referee benefits
- Make sharing process sound effortless
- Include specific dollar amounts or percentages
- Add social proof and success stories
- End with clear next steps
- Use friendly, sharing-focused, community language`,
  },
  {
    id: "fashion-apparel-description",
    name: "Fashion - Apparel Description",
    category: "Product Categories",
    description: "Covers styling context, fabric, fit, care, and key apparel details.",
    template: `Write an apparel description with:
- Style context for where and how to wear it
- Fabric and stretch details
- Fit guidance such as height or size note
- Care instructions
- 3-4 bullets for key details`,
  },
  {
    id: "electronics-tech-description",
    name: "Electronics & Tech Description",
    category: "Product Categories",
    description: "Provides accessible technical details, compatibility, setup, warranty, and support.",
    template: `Write an electronics description (180-250 words) with comprehensive technical details:
- Lead with primary use case and target user
- Include detailed technical specifications
- Cover compatibility and system requirements
- Add setup/installation information
- Include warranty and support details
- Use technical but accessible language`,
  },
  {
    id: "beauty-skincare-description",
    name: "Beauty & Skincare Description",
    category: "Product Categories",
    description: "Focuses on skin concerns, active ingredients, usage, and expected results.",
    template: `Write a beauty/skincare description (130-190 words) focusing on benefits and results:
- Open with the skin concern or beauty goal
- Highlight key active ingredients and their benefits
- Include skin type suitability and usage instructions
- Add clinical results or dermatologist testing if applicable
- End with expected timeline for results
- Use beauty-focused, benefit-driven language`,
  },
  {
    id: "sports-fitness-description",
    name: "Sports & Fitness Description",
    category: "Product Categories",
    description: "Emphasizes athletic goals, performance features, durability, comfort, and versatility.",
    template: `Create a sports/fitness description (190-260 words) emphasizing performance benefits:
- Start with the athletic goal or training benefit
- Include specific performance features and technology
- Cover durability and weather resistance
- Add comfort and fit details
- Include professional or athlete endorsements if applicable
- End with training versatility
- Use motivational, performance-focused language`,
  },
  {
    id: "home-kitchen-description",
    name: "Home & Kitchen Description",
    category: "Product Categories",
    description: "Explains home/kitchen practical benefits, capacity, safety, care, and value.",
    template: `Create a home/kitchen description (140-200 words) focusing on practical benefits:
- Start with the problem it solves or lifestyle improvement
- Include capacity, dimensions, and material details
- Cover ease of use and maintenance
- Add safety features and certifications
- End with versatility and value proposition
- Use practical, family-friendly language`,
  },
  {
    id: "seo-optimized-description",
    name: "SEO-Optimized Description",
    category: "SEO Optimized",
    description: "Uses primary and secondary keywords naturally with scannable benefits.",
    template: `Write an SEO-optimized description (150-250 words).
- Use the primary keyword in the first 1-2 sentences
- Blend 3-5 secondary keywords naturally
- Include scannable bullets for features
- End with a soft CTA`,
  },
  {
    id: "long-tail-keyword-description",
    name: "Long-tail Keyword Description",
    category: "SEO Optimized",
    description: "Targets specific search phrases, question keywords, and semantic user intent.",
    template: `Write a long-tail keyword optimized description (180-250 words):
- Target specific search phrases naturally, such as "best X for Y" and "how to choose Z"
- Include question-based keywords that match user intent
- Address the complete user journey and pain points
- Use semantic keywords and related terms throughout
- Structure with H2-style subheadings in mind
- End with clear next step or benefit summary`,
  },
  {
    id: "local-seo-description",
    name: "Local SEO Description",
    category: "SEO Optimized",
    description: "Adds location-specific phrasing, areas served, and community signals.",
    template: `Create a local SEO description (140-200 words):
- Include specific city, region, or service area in opening
- Target "near me" equivalent phrasing naturally
- Mention local landmarks, neighborhoods, or areas served
- Include local business elements such as hours and delivery zones
- Add community connection or local reputation
- Use location-specific, community-focused language`,
  },
  {
    id: "featured-snippet-optimized-description",
    name: "Featured Snippet Optimized Description",
    category: "SEO Optimized",
    description: "Answers a question directly and structures information for snippet-style scanning.",
    template: `Create a featured snippet optimized description (150-220 words):
- Start by directly answering a specific question
- Use numbered lists, bullet points, or step formats
- Include "how to", "what is", and "best way" structures
- Provide immediate value in the first 2-3 sentences
- Use clear, scannable formatting
- End with additional context or next steps`,
  },
  {
    id: "comparison-alternative-description",
    name: "Comparison & Alternative Description",
    category: "SEO Optimized",
    description: "Targets comparison searches with clear alternatives and differentiators.",
    template: `Write a comparison-focused description (200-280 words):
- Address "vs" and "alternative to" search queries
- Compare features with leading competitors directly
- Use "better than", "compared to", and "unlike" phrases
- Include specific differentiators and advantages
- Add comparison table or side-by-side elements
- End with clear value proposition over alternatives`,
  },
  {
    id: "back-to-school-preparation-description",
    name: "Back-to-School Preparation Description",
    category: "Seasonal & Events",
    description: "Connects products to new school year preparation, confidence, and achievement.",
    template: `Write a back-to-school description (150-220 words):
- Capture new school year excitement and fresh starts
- Include preparation, organization, and success themes
- Add parent and student perspectives
- Include academic achievement and confidence building
- Reference grade levels or age-appropriate elements
- End with success and achievement motivation`,
  },
  {
    id: "holiday-gift-guide-description",
    name: "Holiday Gift Guide Description",
    category: "Seasonal & Events",
    description: "Frames products as thoughtful holiday gifts for multiple recipients.",
    template: `Create a holiday gift description (200-280 words):
- Open with holiday magic or tradition
- Connect to gift-giving emotions and thoughtfulness
- Include multiple recipient suggestions
- Add presentation and packaging details
- Mention holiday shipping deadlines
- End with festive sentiment and gift-giving joy`,
  },
  {
    id: "fathers-day-appreciation-description",
    name: "Father's Day Appreciation Description",
    category: "Seasonal & Events",
    description: "Celebrates fathers and father figures with appreciation-focused gift language.",
    template: `Write a Father's Day description (140-210 words):
- Celebrate paternal love, guidance, and support
- Include appreciation for dad's unique qualities
- Reference father-child bonding and memories
- Add gift-giving significance and thoughtfulness
- Include different types of father figures
- End with gratitude and recognition sentiment`,
  },
  {
    id: "graduation-achievement-description",
    name: "Graduation Achievement Description",
    category: "Seasonal & Events",
    description: "Honors graduation milestones, hard work, pride, and future potential.",
    template: `Create a graduation celebration description (160-230 words):
- Honor the achievement and hard work
- Include pride, accomplishment, and future potential
- Add gift-giving significance for milestone moments
- Reference different graduation levels such as high school and college
- Include family pride and support themes
- End with future success and inspiration`,
  },
  {
    id: "mothers-day-description",
    name: "Mother's Day Description",
    category: "Seasonal & Events",
    description: "Creates warm Mother's Day copy around gratitude, love, and thoughtful gifting.",
    template: `Write a Mother's Day description (150-220 words):
- Celebrate maternal love and sacrifice
- Include appreciation and gratitude themes
- Reference daily acts of love and care
- Add gift-giving emotion and thoughtfulness
- End with honoring and cherishing sentiment`,
  },
  {
    id: "summer-seasonal-description",
    name: "Summer Seasonal Description",
    category: "Seasonal & Events",
    description: "Uses summer energy, outdoor lifestyle, portability, and seasonal benefits.",
    template: `Write a summer-themed description (140-200 words):
- Capture summer energy and outdoor lifestyle
- Include vacation, beach, or outdoor activity references
- Add seasonal benefits such as cooling, UV protection, or portability
- Reference summer traditions and activities
- End with summer adventure or relaxation appeal`,
  },
  {
    id: "valentines-day-romance-description",
    name: "Valentine's Day Romance Description",
    category: "Seasonal & Events",
    description: "Creates Valentine's Day copy centered on romance, connection, and gifting emotion.",
    template: `Create a Valentine's Day description (180-250 words):
- Set a romantic, intimate scene
- Focus on love, connection, and relationship celebration
- Include gift-giving emotions and thoughtfulness
- Add sensory details that enhance romance
- Reference Valentine's traditions and romantic gestures
- End with love and connection sentiment`,
  },
  {
    id: "social-ready-description",
    name: "Social-Ready Description",
    category: "Social & UGC",
    description: "Creates a short social caption with a hook, benefits, and share/save nudge.",
    template: `Create a punchy social caption (60-120 words) with:
- A strong hook
- 3-4 benefit lines as short bullets
- A nudge to share or save
- Use emojis lightly`,
  },
  {
    id: "tiktok-viral-description",
    name: "TikTok Viral Description",
    category: "Social & UGC",
    description: "Uses TikTok-native hooks, trends, and highly shareable phrasing.",
    template: `Write a TikTok-optimized description (30-70 words) for viral potential:
- Use trending phrases, sounds, or formats such as POV or "that girl who"
- Include hook that stops the scroll
- Reference popular TikTok trends or challenges
- Add relatable, shareable elements
- Use TikTok-native language and energy`,
  },
  {
    id: "instagram-stories-description",
    name: "Instagram Stories Description",
    category: "Social & UGC",
    description: "Creates concise story copy with hooks, interactive CTAs, and mobile-first phrasing.",
    template: `Create an Instagram Stories description (40-80 words) with interactive elements:
- Start with attention-grabbing hook or question
- Include story-specific calls-to-action such as swipe up, DM, or poll
- Use story-friendly language and urgency
- Add interactive stickers references such as polls, questions, and quizzes
- Keep punchy and scannable for mobile viewing`,
  },
  {
    id: "behind-the-scenes-description",
    name: "Behind-the-Scenes Description",
    category: "Social & UGC",
    description: "Shows brand authenticity through process, people, and values.",
    template: `Create a behind-the-scenes description (120-180 words) showing brand authenticity:
- Share the creation process or brand story
- Include team members or founder insights
- Show challenges, failures, and successes
- Add personal touches and vulnerability
- End with community connection or values alignment`,
  },
  {
    id: "influencer-collaboration-description",
    name: "Influencer Collaboration Description",
    category: "Social & UGC",
    description: "Highlights influencer partnerships, testimonials, social proof, and credibility.",
    template: `Write an influencer collaboration description (100-160 words):
- Feature specific influencer partnerships and follower counts
- Include authentic testimonials and quotes
- Reference their content such as posts, reels, or stories
- Add credibility through social proof
- Include call-to-action to follow or check their content`,
  },
  {
    id: "user-generated-content-description",
    name: "User-Generated Content Description",
    category: "Social & UGC",
    description: "Encourages customers to share photos, videos, reviews, and campaign hashtags.",
    template: `Create a UGC-focused description (80-140 words) that builds community:
- Encourage customers to share their photos/videos
- Include specific hashtag for campaign
- Feature customer testimonials or reviews
- Add incentive for sharing such as chance to be featured or discount
- Use community-building, inclusive language`,
  },
  {
    id: "industrial-equipment-description",
    name: "Industrial Equipment Description",
    category: "Technical & Specs",
    description: "Provides precise industrial applications, specifications, safety, and maintenance details.",
    template: `Create an industrial equipment description (220-300 words):
- Lead with equipment type and primary applications
- Include detailed performance specifications
- Cover safety features and certifications
- Add installation and maintenance requirements
- Include warranty and service information
- Use precise, professional technical language`,
  },
  {
    id: "medical-device-description",
    name: "Medical Device Description",
    category: "Technical & Specs",
    description: "Uses professional medical-device language with classifications, safety, and compliance.",
    template: `Write a medical device description (180-240 words):
- Include FDA approval status and classifications
- Detail clinical accuracy and precision specifications
- Cover safety features and contraindications
- Add healthcare professional endorsements
- Include compliance certifications
- Use medically compliant, professional language`,
  },
  {
    id: "networking-equipment-description",
    name: "Networking Equipment Description",
    category: "Technical & Specs",
    description: "Covers network performance, ports, protocols, security, and compatibility.",
    template: `Create a networking equipment description (200-280 words):
- Start with network performance capabilities
- Include detailed port specifications and throughput
- Cover advanced networking features and protocols
- Add security features and management options
- Include compatibility and standards compliance
- End with enterprise or SMB suitability`,
  },
  {
    id: "scientific-instrument-description",
    name: "Scientific Instrument Description",
    category: "Technical & Specs",
    description: "Details precision, calibration, operating conditions, data, and compliance.",
    template: `Write a scientific instrument description (170-230 words):
- Include measurement range and precision specifications
- Detail calibration standards and traceability
- Cover environmental operating conditions
- Add data logging and connectivity features
- Include compliance certifications
- Use precise, scientific terminology`,
  },
  {
    id: "software-technical-description",
    name: "Software Technical Description",
    category: "Technical & Specs",
    description: "Creates a detailed software product description with systems, APIs, security, and support.",
    template: `Write a software technical description (250-350 words):
- Start with primary use case and target users
- Include system requirements and compatibility
- List key features with technical details
- Cover integration capabilities and APIs
- Add security and compliance information
- Include support, documentation, and SLA details`,
  },
  {
    id: "casual-friendly-description",
    name: "Casual & Friendly Description",
    category: "Tone & Style",
    description: "Uses simple, everyday language and a helpful, low-pressure tone.",
    template: `Write a casual, friendly description (100-180 words).
- Use contractions and simple language
- Focus on everyday benefits and ease of use
- Add 3-5 bullets with clear wins
- End with helpful nudge, not a hard sell`,
  },
  {
    id: "clean-minimalist-description",
    name: "Clean Minimalist Description",
    category: "Tone & Style",
    description: "Uses concise, stripped-back language focused on essential product value.",
    template: `Write a clean minimalist description (80-120 words):
- Use simple, direct language without unnecessary words
- Focus on core functionality and essential benefits
- Avoid adjectives and marketing superlatives
- Structure with clear, concise statements
- Include only the most important features
- End with straightforward value proposition`,
  },
  {
    id: "narrative-storytelling-description",
    name: "Narrative Storytelling Description",
    category: "Tone & Style",
    description: "Builds a relatable story with tension, product solution, and emotional payoff.",
    template: `Create a narrative storytelling description (220-300 words):
- Start with a relatable scene or moment
- Build tension or introduce a challenge
- Introduce the product as the solution within the story
- Include sensory details and emotional elements
- Structure with beginning, middle, and resolution
- End with transformation and emotional payoff`,
  },
  {
    id: "witty-humorous-description",
    name: "Witty & Humorous Description",
    category: "Tone & Style",
    description: "Balances light humor with practical product benefits and memorable phrasing.",
    template: `Create a witty, humorous description (120-180 words):
- Use clever wordplay, puns, or unexpected comparisons
- Include relatable, funny situations or observations
- Balance humor with actual product benefits
- Keep tone light and entertaining without being silly
- Structure with setup, punchline, and practical payoff
- End with memorable, shareable closing line`,
  },
  {
    id: "millennial-focused-description",
    name: "Millennial-Focused Description",
    category: "Tone & Style",
    description: "Uses authentic modern language around lifestyle, value, sustainability, and wellness.",
    template: `Create a millennial-focused description (130-190 words):
- Address real-life situations and modern pain points
- Use authentic language without corporate speak
- Include sustainability, value, or wellness mentions
- Reference work-life balance and self-care themes
- Structure with relatable problem + solution + lifestyle fit
- End with community or values alignment`,
  },
  {
    id: "sophisticated-luxury-description",
    name: "Sophisticated Luxury Description",
    category: "Tone & Style",
    description: "Uses refined language to communicate exclusivity, craftsmanship, and timeless appeal.",
    template: `Write a sophisticated luxury description (200-280 words):
- Use elevated vocabulary and refined language
- Emphasize exclusivity, craftsmanship, and heritage
- Include subtle sophistication without being pretentious
- Structure with elegant flow and sophisticated phrasing
- Reference discerning taste and connoisseurship
- End with understated elegance and timeless appeal`,
  },
  {
    id: "corporate-professional-description",
    name: "Corporate Professional Description",
    category: "Tone & Style",
    description: "Uses formal business language focused on outcomes, ROI, compliance, and credibility.",
    template: `Write a professional corporate description (180-250 words):
- Use formal, authoritative language and industry terminology
- Focus on business outcomes, ROI, and efficiency gains
- Include specific metrics, certifications, and compliance
- Structure with clear sections and professional formatting
- End with implementation ease and support assurance
- Maintain credible, trustworthy tone throughout`,
  },
];

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
  ...ADDITIONAL_PRODUCT_DESCRIPTION_TEMPLATES,
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
