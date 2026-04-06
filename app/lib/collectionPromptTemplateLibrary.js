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
      "[Hook: 1-2 attention-grabbing sentences about problems solved or challenges addressed]\n[Description: 2-3 sentences explaining how this collection was developed to address common pain points]\n[Features/Benefits: 2-3 sentences showing how the collection solves problems through design or innovation]\n[Key solution feature 1]\n[Key solution feature 2]\n[Key solution feature 3]\n[Audience/Use Case: 1-2 sentences describing who benefits most]\n[Call to Action: 1 sentence encouraging action]",
  },
  {
    id: "col-technical-specifications",
    name: "Technical Specifications",
    description: "Emphasizes detailed specs for product groups.",
    template:
      "[Hook: 1-2 attention-grabbing sentences about innovation or performance]\n[Description: 2-3 sentences explaining what makes this technical collection unique]\n[Features/Benefits: 2-3 sentences highlighting technical specifications, materials, or performance metrics]\n[Key technical attribute 1]\n[Key technical attribute 2]\n[Key technical attribute 3]\n[Audience/Use Case: who needs these technical standards]\n[Call to Action]",
  },
  {
    id: "col-lifestyle-integration",
    name: "Lifestyle Integration",
    description: "Illustrates how product groups enhance customer experiences.",
    template:
      "[Hook: 1-2 evocative sentences about lifestyle this collection enhances]\n[Description: 2-3 sentences about aesthetic, inspiration, or daily integration]\n[Features/Benefits: 2-3 sentences on versatility, design, and quality]\n[Key lifestyle benefit 1]\n[Key lifestyle benefit 2]\n[Key lifestyle benefit 3]\n[Key lifestyle benefit 4]\n[Call to Action]",
  },
  {
    id: "col-eco-friendly-product",
    name: "Eco-Friendly Product",
    description: "Highlights sustainability benefits across responsible collections.",
    template:
      "[Hook: 1-2 impactful sentences about sustainability or environmental benefits]\n[Description: 2-3 sentences about the collection's eco-conscious approach]\n[Features/Benefits: 2-3 sentences highlighting sustainable materials, processes, or positive impact]\n[Key sustainability feature 1]\n[Key sustainability feature 2]\n[Key sustainability feature 3]\n[Audience/Use Case]\n[Call to Action]",
  },
  {
    id: "col-premium-luxury-product",
    name: "Premium/Luxury Product",
    description: "Showcases craftsmanship and exclusivity for luxury collections.",
    template:
      "[Hook: 1-2 sophisticated sentences about craftsmanship, heritage, or exclusivity]\n[Description: 2-3 sentences about artisanal quality, materials, or pedigree]\n[Features/Benefits: 2-3 sentences highlighting premium attributes]\n[Key premium feature 1]\n[Key premium feature 2]\n[Key premium feature 3]\n[Key premium feature 4]\n[Audience/Use Case]\n[Call to Action]",
  },
  {
    id: "col-budget-friendly-product",
    name: "Budget-Friendly Product",
    description: "Emphasizes quality and durability despite affordable pricing.",
    template:
      "[Hook: 1-2 practical sentences about value and affordability]\n[Description: 2-3 sentences showing how the collection balances quality and price]\n[Features/Benefits: 2-3 sentences on cost-effectiveness and practical benefits]\n[Key value feature 1]\n[Key value feature 2]\n[Key value feature 3]\n[Key value feature 4]\n[Audience/Use Case]\n[Call to Action]",
  },
  {
    id: "col-seasonal-limited-edition",
    name: "Seasonal/Limited Edition",
    description: "Creates urgency for time-limited or seasonal collections.",
    template:
      "[Hook: 1-2 festive or timely sentences about seasonal theme or limited availability]\n[Description: 2-3 sentences about what makes this collection special for this season]\n[Features/Benefits: 2-3 sentences highlighting seasonal design elements]\n[Key seasonal feature 1]\n[Key seasonal feature 2]\n[Key seasonal feature 3]\n[Key seasonal feature 4]\n[Urgency/Scarcity cue]\n[Call to Action]",
  },
  {
    id: "col-collection-comparison",
    name: "Collection Comparison",
    description: "Contrasts collection advantages directly against market alternatives.",
    template:
      "[Hook: 1-2 confident sentences about performance or competitive superiority]\n[Description: 2-3 sentences explaining how this collection outperforms alternatives]\n[Features/Benefits: 2-3 sentences highlighting verified advantages]\n[Key comparative advantage 1]\n[Key comparative advantage 2]\n[Key comparative advantage 3]\n[Audience/Use Case]\n[Call to Action]",
  },
];

export const COLLECTION_META_DESCRIPTION_TEMPLATES = [
  {
    id: "col-md-benefit-focused",
    name: "Benefit-Focused",
    description: "Highlights primary benefits and value proposition for customers.",
    template:
      "{benefit_statement} for {customer_need}. {unique_value_proposition}. {action_invitation}.",
  },
  {
    id: "col-md-problem-solution",
    name: "Problem-Solution",
    description: "Positions collection as solution to customer pain points.",
    template:
      "{problem_statement} with {{collection_title}}. {solution_description} while {secondary_benefit}. {urgency_or_availability}.",
  },
  {
    id: "col-md-quality-centric",
    name: "Quality-Centric",
    description: "Emphasizes high-quality materials and craftsmanship.",
    template:
      "{quality_adjective} {{collection_title}} {quality_statement}. {product_highlight} for {usage_scenario}. {differentiator_statement}.",
  },
  {
    id: "col-md-experience",
    name: "Experience",
    description: "Describes the experience customers gain from the collection.",
    template:
      "{experience_verb} {experience_descriptor} with our {{collection_title}}. {experience_benefit} through {product_attribute}. {social_proof_or_guarantee}.",
  },
  {
    id: "col-md-occasion-based",
    name: "Occasion-Based",
    description: "Highlights specific scenarios where collection excels.",
    template:
      "{perfect_for_statement} with our {{collection_title}}. {occasion_relevance} featuring {key_product_attribute}, {special_offer_or_limitations}.",
  },
  {
    id: "col-md-discovery",
    name: "Discovery",
    description: "Creates excitement through collection exploration.",
    template:
      "{discovery_invitation} our {{collection_title}}. {collection_highlight} designed to {customer_outcome}, {curiosity_statement}.",
  },
];

export const COLLECTION_META_TITLE_TEMPLATES = [
  {
    id: "col-mt-benefit-first",
    name: "Benefit First",
    description: "Leads with customer outcome then collection title.",
    template: "{main_benefit} | {collection_title}",
  },
  {
    id: "col-mt-category-seo",
    name: "Category SEO",
    description: "Targets category keyword relevance for search.",
    template: "{collection_title} {category_keyword} Collection",
  },
  {
    id: "col-mt-shop-intent",
    name: "Shop Intent",
    description: "Adds shopping intent phrasing with concise value.",
    template: "Shop {collection_title} | {value_phrase}",
  },
  {
    id: "col-mt-quality-focus",
    name: "Quality Focus",
    description: "Highlights quality positioning and trust.",
    template: "{quality_adjective} {collection_title} | {brand_name}",
  },
  {
    id: "col-mt-occasion",
    name: "Occasion Match",
    description: "Optimized for use-case and occasion-based searches.",
    template: "{collection_title} for {occasion_keyword}",
  },
  {
    id: "col-mt-problem-solution",
    name: "Problem-Solution",
    description: "Frames collection as direct solution-oriented choice.",
    template: "{solve_problem_keyword} with {collection_title}",
  },
  {
    id: "col-mt-seasonal",
    name: "Seasonal",
    description: "Highlights seasonal or campaign relevance.",
    template: "{seasonal_phrase} | {collection_title}",
  },
  {
    id: "col-mt-featured",
    name: "Featured Angle",
    description: "Uses top feature keyword and brand confidence.",
    template: "{collection_title} - {top_feature_keyword} | {brand_name}",
  },
];
