export const COLLECTION_PROMPT_TEMPLATE_STORAGE_KEY = "collection_prompt_template_selection_v1";

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

export function getEmptyCollectionTemplateSelection() {
  return { ...EMPTY_TEMPLATE_SELECTION };
}

export function readStoredCollectionPromptTemplateSelection() {
  if (typeof window === "undefined") return getEmptyCollectionTemplateSelection();

  try {
    const raw = window.localStorage.getItem(COLLECTION_PROMPT_TEMPLATE_STORAGE_KEY);
    if (!raw) return getEmptyCollectionTemplateSelection();
    return normalizeTemplateSelection(JSON.parse(raw));
  } catch {
    return getEmptyCollectionTemplateSelection();
  }
}

export function writeStoredCollectionPromptTemplateSelection(selection) {
  const normalized = normalizeTemplateSelection(selection);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(COLLECTION_PROMPT_TEMPLATE_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function clearStoredCollectionPromptTemplateSelection() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(COLLECTION_PROMPT_TEMPLATE_STORAGE_KEY);
  }
  return getEmptyCollectionTemplateSelection();
}

export const COLLECTION_DESCRIPTION_TEMPLATES = [
  {
    id: "col-problem-solution",
    name: "Problem-Solution",
    description: "Shows how collections solve specific customer problems.",
    template:
      "Write a collection description (100–180 words) using a problem-solution framework.\n- Open with the common frustration customers face when searching for products in this category.\n- Position this collection as the organised solution to that frustration.\n- Highlight 3 types of products or solution features within the collection.\n- Include a trust signal or proof point.\n- Close with a clear browsing call to action.\n- Tone: empathetic, direct, and solution-focused.",
  },
  {
    id: "col-technical-specifications",
    name: "Technical Specifications",
    description: "Emphasizes detailed specs for product groups.",
    template:
      "Write a technical collection description (100–180 words) for specification-conscious buyers.\n- Open with the collection's technical scope and primary purpose.\n- State the range of specifications covered across products in the collection.\n- List 3–5 key technical parameters that differentiate products in this range.\n- Include compatibility or integration details relevant to the category.\n- Use precise, accurate language appropriate for a technical audience.\n- Tone: factual, precise, and authoritative.",
  },
  {
    id: "col-lifestyle-integration",
    name: "Lifestyle Integration",
    description: "Illustrates how product groups enhance customer experiences.",
    template:
      "Write a lifestyle-driven collection description (100–170 words) connecting the collection to everyday life.\n- Open with an evocative scenario tied to the lifestyle this collection supports.\n- Highlight the emotional and practical benefits of the collection as a whole.\n- List 3 lifestyle moments or use cases this collection serves.\n- Emphasise how the collection fits different occasions or seasons.\n- Close with a browsing invitation.\n- Tone: aspirational, warm, and relatable.",
  },
  {
    id: "col-eco-friendly-product",
    name: "Eco-Friendly Product",
    description: "Highlights sustainability benefits across responsible collections.",
    template:
      "Write a sustainability-focused collection description (100–170 words) for eco-conscious shoppers.\n- Open with a bold sustainability statement for the collection.\n- Identify the environmental values this collection represents.\n- Highlight 3 sustainable materials, processes, or certifications across the products.\n- Include a measurable environmental impact or third-party certification.\n- Close with a values-aligned call to action.\n- Tone: responsible, transparent, and mission-driven.",
  },
  {
    id: "col-premium-luxury-product",
    name: "Premium/Luxury Product",
    description: "Showcases craftsmanship and exclusivity for luxury collections.",
    template:
      "Write a premium collection description (100–170 words) that communicates luxury and exclusivity.\n- Open with a statement of craftsmanship, provenance, or curation standards.\n- Reference premium materials, heritage, or exclusive sourcing.\n- Highlight 3 luxury attributes that define this collection.\n- Include a reference to exclusivity, rarity, or limited curation.\n- Close with a prestige-aligned browsing invitation.\n- Tone: elevated, authoritative, and brand-prestige-driven.",
  },
  {
    id: "col-budget-friendly-product",
    name: "Budget-Friendly Product",
    description: "Emphasizes quality and durability despite affordable pricing.",
    template:
      "Write a value-focused collection description (100–170 words) for price-conscious shoppers.\n- Open with a strong value proposition for the collection as a whole.\n- Reassure on quality despite accessible pricing.\n- List 3 essential product features or attributes that deliver real-world usefulness.\n- Include a cost-effectiveness or savings context.\n- Close with an encouraging browsing call to action.\n- Tone: honest, practical, and confidence-building.",
  },
  {
    id: "col-seasonal-limited-edition",
    name: "Seasonal/Limited Edition",
    description: "Creates urgency for time-limited or seasonal collections.",
    template:
      "Write a seasonal or limited-edition collection description (100–170 words) with urgency and occasion relevance.\n- Open with the seasonal or limited-edition framing.\n- Connect the collection to a specific season, trend, or occasion.\n- Highlight 3 products or features exclusive to this edition.\n- Include a scarcity or availability signal.\n- Close with an urgency-driven browsing call to action.\n- Tone: timely, exclusive, and action-oriented.",
  },
  {
    id: "col-collection-comparison",
    name: "Collection Comparison",
    description: "Contrasts collection advantages directly against market alternatives.",
    template:
      "Write a comparison-focused collection description (100–180 words) to help buyers choose between options.\n- Open by acknowledging the buyer's need to compare before deciding.\n- Describe the range of products and what differentiates them within this collection.\n- List 3–5 comparison dimensions: price, performance, materials, or use case.\n- Guide the buyer toward the right choice based on their primary need.\n- Close with a helpful recommendation and browsing call to action.\n- Tone: helpful, structured, and confidence-building.",
  },
  {
    id: "col-gift-guide",
    name: "Gift Guide",
    description: "Positions collection as the go-to destination for gifts and special occasions.",
    template:
      "Write a gift-guide collection description (100–170 words) for occasion-driven shoppers.\n- Open with the occasion or recipient profile this collection serves.\n- Explain why this collection makes memorable, well-received gifts.\n- List 3 gift categories or standout products within the collection.\n- Include packaging, delivery, or personalisation notes.\n- Close with an occasion-relevant call to action.\n- Tone: warm, celebratory, and gift-focused.",
  },
  {
    id: "col-new-arrivals",
    name: "New Arrivals / Trending",
    description: "Creates excitement and freshness for newly launched or trending collections.",
    template:
      "Write an engaging new-arrivals collection description (100–160 words) that creates excitement.\n- Open by announcing the arrival of new products in clear, energetic terms.\n- Highlight what makes this new selection worth exploring right now.\n- List 3 new products, categories, or innovation highlights.\n- Create light urgency around early availability or limited quantity.\n- Close with a discovery-driven browsing invitation.\n- Tone: fresh, energetic, and discovery-driven.",
  },
  {
    id: "col-bestsellers-curated",
    name: "Bestsellers / Editor's Picks",
    description: "Leverages social proof and editorial authority to guide shoppers.",
    template:
      "Write a bestseller-led collection description (100–160 words) built around popularity and proven value.\n- Open with a social proof statement: customer count, rating, or sales milestone.\n- Explain why this curated selection is trusted by customers.\n- Highlight 3 top-performing products or product types in the collection.\n- Include a trust-building signal: rating, returns policy, or satisfaction guarantee.\n- Close with a confident browsing call to action.\n- Tone: confident, community-validated, and reassuring.",
  },
];

export const COLLECTION_META_DESCRIPTION_TEMPLATES = [
  {
    id: "col-md-benefit-focused",
    name: "Benefit-Focused",
    description: "Highlights primary benefits and value proposition for customers.",
    template:
      "Write a collection meta description (130–155 characters) that leads with the primary benefit.\n- State the main benefit the collection delivers for the customer.\n- Add the unique value proposition in plain, direct language.\n- End with a browsing invitation or call to action.",
  },
  {
    id: "col-md-problem-solution",
    name: "Problem-Solution",
    description: "Positions collection as solution to customer pain points.",
    template:
      "Write a collection meta description (130–155 characters) using a problem-solution format.\n- Frame the customer problem in 5–8 words.\n- Position the collection as the direct solution.\n- Include a secondary benefit.\n- End with a availability or urgency note.",
  },
  {
    id: "col-md-quality-centric",
    name: "Quality-Centric",
    description: "Emphasizes high-quality materials and craftsmanship.",
    template:
      "Write a collection meta description (130–155 characters) that leads with quality.\n- Lead with a quality adjective and the collection name.\n- State what quality means for this collection: materials, process, or standard.\n- Add the primary use scenario.\n- Include a differentiator or trust signal.",
  },
  {
    id: "col-md-experience",
    name: "Experience",
    description: "Describes the experience customers gain from the collection.",
    template:
      "Write a collection meta description (130–155 characters) focused on customer experience.\n- Open with an experience verb: \"Experience\", \"Discover\", or \"Enjoy\".\n- Describe what that experience feels or looks like.\n- Reference the product attribute that delivers it.\n- End with a social proof or guarantee note.",
  },
  {
    id: "col-md-occasion-based",
    name: "Occasion-Based",
    description: "Highlights specific scenarios where collection excels.",
    template:
      "Write a collection meta description (130–155 characters) tied to a specific occasion or use case.\n- Open with \"Perfect for [occasion]\" framing.\n- Name the collection and its key attribute.\n- Add a special offer or availability note if relevant.",
  },
  {
    id: "col-md-discovery",
    name: "Discovery",
    description: "Creates excitement through collection exploration.",
    template:
      "Write a collection meta description (130–155 characters) that creates curiosity.\n- Open with a discovery invitation: \"Discover\" or \"Explore\".\n- Name the collection and its standout highlight.\n- Add what the customer gains by exploring it.\n- End with a curiosity-building statement.",
  },
  {
    id: "col-md-new-arrivals",
    name: "New Arrivals",
    description: "Drives clicks for freshly launched or trending collections.",
    template:
      "Write a collection meta description (130–155 characters) for new arrivals.\n- Signal freshness: \"Shop our latest\" or \"Just arrived\".\n- Name the collection and highlight the newest feature or style.\n- End with a call to action: \"Shop now!\" or \"Be first to explore.\"",
  },
  {
    id: "col-md-gift-guide",
    name: "Gift Guide",
    description: "Targets gift-intent searches for specific occasions or recipients.",
    template:
      "Write a collection meta description (130–155 characters) for gift-intent searches.\n- Open with \"Find the perfect gift\" and name the collection.\n- Describe the occasion or recipient this collection serves.\n- Note variety, price range, or delivery option.\n- End with a gifting call to action.",
  },
  {
    id: "col-md-bestsellers",
    name: "Bestsellers",
    description: "Leverages popularity and social proof to encourage clicks.",
    template:
      "Write a collection meta description (130–155 characters) led by social proof.\n- Open with \"Shop our top-selling\" and name the collection.\n- Reference the customer count or segment that trusts it.\n- State the key benefit.\n- Include a social proof signal: rating or review.",
  },
];

export const COLLECTION_META_TITLE_TEMPLATES = [
  {
    id: "col-mt-benefit-first",
    name: "Benefit First",
    description: "Leads with customer outcome then collection title.",
    template:
      "Write a collection meta title (50–65 characters) that leads with the primary benefit.\n- Put the main customer benefit or outcome first.\n- Separate from the collection name with a pipe character.\n- Format: \"Main Benefit | Collection Name\"\n- Stay within 65 characters.",
  },
  {
    id: "col-mt-category-seo",
    name: "Category SEO",
    description: "Targets category keyword relevance for search.",
    template:
      "Write a collection meta title (50–65 characters) optimised for category search.\n- Include the collection name and the primary category keyword.\n- Add \"Collection\" to reinforce the browse intent.\n- Format: \"Collection Name Category Keyword Collection\"",
  },
  {
    id: "col-mt-shop-intent",
    name: "Shop Intent",
    description: "Adds shopping intent phrasing with concise value.",
    template:
      "Write a collection meta title (50–65 characters) targeting shopping intent.\n- Open with \"Shop\" followed by the collection name.\n- Add a pipe and a concise value phrase.\n- Format: \"Shop Collection Name | Value Phrase\"",
  },
  {
    id: "col-mt-quality-focus",
    name: "Quality Focus",
    description: "Highlights quality positioning and trust.",
    template:
      "Write a collection meta title (50–65 characters) that signals premium quality.\n- Add a quality adjective before the collection name.\n- Separate with a pipe and the brand name.\n- Format: \"Quality Adjective Collection Name | Brand\"",
  },
  {
    id: "col-mt-occasion",
    name: "Occasion Match",
    description: "Optimized for use-case and occasion-based searches.",
    template:
      "Write a collection meta title (50–65 characters) tied to a use-case or occasion.\n- Lead with the collection name.\n- Follow with \"for [occasion keyword]\".\n- Format: \"Collection Name for Occasion Keyword\"",
  },
  {
    id: "col-mt-problem-solution",
    name: "Problem-Solution",
    description: "Frames collection as direct solution-oriented choice.",
    template:
      "Write a collection meta title (50–65 characters) targeting problem-based search.\n- Frame the solution keyword in verb form.\n- Use \"with [collection name]\" to connect solution to collection.\n- Format: \"Solve [Problem] with Collection Name\"",
  },
  {
    id: "col-mt-seasonal",
    name: "Seasonal",
    description: "Highlights seasonal or campaign relevance.",
    template:
      "Write a collection meta title (50–65 characters) for seasonal or campaign relevance.\n- Lead with the seasonal or campaign phrase.\n- Separate with a pipe and the collection name.\n- Format: \"Seasonal Phrase | Collection Name\"",
  },
  {
    id: "col-mt-featured",
    name: "Featured Angle",
    description: "Uses top feature keyword and brand confidence.",
    template:
      "Write a collection meta title (50–65 characters) featuring the top product attribute.\n- Lead with the collection name.\n- Add a dash and the top feature keyword.\n- Separate with a pipe and the brand name.\n- Format: \"Collection Name – Top Feature | Brand\"",
  },
  {
    id: "col-mt-new-arrivals",
    name: "New Arrivals",
    description: "Signals freshness and new product availability.",
    template:
      "Write a collection meta title (50–65 characters) for new arrivals.\n- Open with \"New\" before the collection name.\n- Separate with a pipe and the brand name.\n- Format: \"New Collection Name | Brand\"",
  },
  {
    id: "col-mt-gift-guide",
    name: "Gift Guide",
    description: "Targets gift-intent keyword searches.",
    template:
      "Write a collection meta title (50–65 characters) for gift-intent searches.\n- Lead with the collection name.\n- Add \"Gift Guide\" and an occasion keyword.\n- Format: \"Collection Name Gift Guide | Occasion\"",
  },
  {
    id: "col-mt-bestsellers",
    name: "Bestsellers",
    description: "Uses popularity signal to build click trust.",
    template:
      "Write a collection meta title (50–65 characters) using a bestseller signal.\n- Open with \"Best-Selling\" followed by the collection name.\n- Separate with a pipe and the brand name.\n- Format: \"Best-Selling Collection Name | Brand\"",
  },
];
