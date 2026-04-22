export const PAGE_PROMPT_TEMPLATE_STORAGE_KEY = "page_prompt_template_selection_v1";

const EMPTY_TEMPLATE_SELECTION = {
  bodyTemplateId: "",
  bodyPromptTemplate: "",
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
    bodyTemplateId: toStringOrEmpty(input.bodyTemplateId),
    bodyPromptTemplate: toStringOrEmpty(input.bodyPromptTemplate),
    metaTitleTemplateId: toStringOrEmpty(input.metaTitleTemplateId),
    metaTitlePromptTemplate: toStringOrEmpty(input.metaTitlePromptTemplate),
    metaDescriptionTemplateId: toStringOrEmpty(input.metaDescriptionTemplateId),
    metaDescriptionPromptTemplate: toStringOrEmpty(input.metaDescriptionPromptTemplate),
  };
}

export function getEmptyPageTemplateSelection() {
  return { ...EMPTY_TEMPLATE_SELECTION };
}

export function readStoredPagePromptTemplateSelection() {
  if (typeof window === "undefined") return getEmptyPageTemplateSelection();

  try {
    const raw = window.localStorage.getItem(PAGE_PROMPT_TEMPLATE_STORAGE_KEY);
    if (!raw) return getEmptyPageTemplateSelection();
    return normalizeTemplateSelection(JSON.parse(raw));
  } catch {
    return getEmptyPageTemplateSelection();
  }
}

export function writeStoredPagePromptTemplateSelection(selection) {
  const normalized = normalizeTemplateSelection(selection);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PAGE_PROMPT_TEMPLATE_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function clearStoredPagePromptTemplateSelection() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(PAGE_PROMPT_TEMPLATE_STORAGE_KEY);
  }
  return getEmptyPageTemplateSelection();
}

export const PAGE_BODY_TEMPLATES = [
  {
    id: "page-body-brand-story",
    name: "Brand Story",
    description: "Great for About Us pages with trust and mission narrative.",
    template:
      "Write an engaging About Us or Brand Story page (400–600 words) that builds trust and emotional connection.\n- Open with a compelling founding story: the why behind the brand.\n- Describe the problem or gap in the market that inspired the business.\n- Walk through key milestones in the brand's journey.\n- Introduce the team, values, or culture that drives the brand.\n- Highlight what makes the brand different from the competition.\n- Close with a forward-looking vision statement and invitation to explore.\n- Tone: authentic, human, and brand-aligned.",
  },
  {
    id: "page-body-policy-clarity",
    name: "Policy Clarity",
    description: "For shipping, refund, privacy, and terms pages.",
    template:
      "Write a clear, customer-friendly policy page (300–500 words) that builds trust and reduces purchase hesitation.\n- Open with a reassuring policy summary statement.\n- Present the return policy in clear, plain language — no legalese.\n- Explain the refund process step by step.\n- Describe the shipping and delivery policy.\n- Address common exceptions or edge cases clearly.\n- Close with contact information and support availability.\n- Tone: clear, transparent, and customer-first.",
  },
  {
    id: "page-body-faq-structured",
    name: "FAQ Structured",
    description: "Organized question-answer structure for common concerns.",
    template:
      "Write a structured FAQ page (400–600 words) that answers the most common customer questions.\n- Open with a brief intro that frames what the FAQ covers.\n- Structure 6–8 common questions with clear, concise answers.\n- Address questions around product use, returns, shipping, and support.\n- Keep each answer to 2–4 sentences — direct and scannable.\n- Close with a prompt to contact support for any unanswered questions.\n- Tone: helpful, accessible, and efficient.",
  },
  {
    id: "page-body-contact-conversion",
    name: "Contact Conversion",
    description: "Contact page focused on clarity, confidence, and action.",
    template:
      "Write a conversion-optimised Contact Us page (200–350 words) that encourages customer engagement.\n- Open with a warm, welcoming statement that makes contact feel easy.\n- State clearly how customers can reach the team: email, phone, chat, or form.\n- Set clear response time expectations.\n- Address the most common reasons customers reach out.\n- Include a brief reassurance about customer service quality.\n- Tone: approachable, responsive, and professional.",
  },
  {
    id: "page-body-landing-offer",
    name: "Landing Offer",
    description: "For campaign pages with clear offer and CTA blocks.",
    template:
      "Write a conversion-focused landing page body (300–500 words) for a promotional offer or campaign.\n- Open with a bold, benefit-first headline statement.\n- Describe the offer clearly: what it is, who it's for, and what they get.\n- List 4–5 key benefits or product highlights.\n- Include a social proof element: testimonials, ratings, or customer count.\n- Add a risk-reversal signal: guarantee, no-obligation, or free returns.\n- Close with a strong, urgent call to action.\n- Tone: persuasive, energetic, and conversion-focused.",
  },
  {
    id: "page-body-comparison",
    name: "Comparison",
    description: "Comparison or why-choose-us page template.",
    template:
      "Write a structured comparison page body (350–550 words) that helps buyers choose between options.\n- Open by acknowledging the buying dilemma or decision the customer faces.\n- Present 2–4 options with clear, comparable attributes.\n- Use a structured format for comparison: price, performance, best for.\n- Guide the reader to the right choice based on their primary need.\n- Include a FAQ or objection-handling section.\n- Close with a recommendation and clear next step.\n- Tone: helpful, structured, and decision-supportive.",
  },
  {
    id: "page-body-team",
    name: "Team / People",
    description: "Introduces team members to build credibility and personality.",
    template:
      "Write an engaging Team or People page (300–500 words) that humanises the brand.\n- Open with a statement about the team's shared mission or values.\n- Introduce key team members with their role and a brief, human detail.\n- Highlight the collective expertise or background of the team.\n- Show culture: how the team works, what they care about, or unique attributes.\n- Close with a message that makes the team feel approachable and trustworthy.\n- Tone: authentic, warm, and professional.",
  },
  {
    id: "page-body-testimonials",
    name: "Testimonials / Reviews",
    description: "Social proof page showcasing customer experiences.",
    template:
      "Write a testimonials or social proof page body (300–500 words) that builds buyer confidence.\n- Open with a credibility statement: customer count, rating average, or milestone.\n- Include 3–5 testimonials with specific, verifiable outcomes or experiences.\n- Highlight the types of customers who benefit most.\n- Add context around any awards, press mentions, or third-party recognition.\n- Close with a clear call to action for first-time buyers.\n- Tone: trustworthy, community-driven, and evidence-based.",
  },
  {
    id: "page-body-press-media",
    name: "Press / Media",
    description: "Highlights brand mentions, awards, and media coverage.",
    template:
      "Write a Press and Media page body (200–400 words) that builds brand credibility.\n- Open with a press invitation or media contact statement.\n- List notable press mentions, publications, or awards with brief context.\n- Provide brand facts: founding year, mission, key milestones, reach.\n- Include downloadable assets available: logos, product images, or brand guidelines.\n- Close with press contact details: name, email, and response timeframe.\n- Tone: professional, fact-forward, and media-ready.",
  },
  {
    id: "page-body-size-guide",
    name: "Size Guide",
    description: "Helps customers find the right fit with clear measurement guidance.",
    template:
      "Write a clear, helpful size guide page (300–500 words) that reduces returns and builds purchase confidence.\n- Open with a reassuring statement about finding the right fit.\n- Provide a size chart with measurement ranges for each size option.\n- Explain how to take accurate measurements at home.\n- Advise on what to do when between sizes.\n- Address common fit questions specific to this product category.\n- Close with a contact prompt for personalised fit assistance.\n- Tone: helpful, precise, and shopper-friendly.",
  },
];

export const PAGE_META_DESCRIPTION_TEMPLATES = [
  {
    id: "page-md-benefit-first",
    name: "Benefit First",
    description: "Starts with the key user benefit then action.",
    template:
      "Write a page meta description (130–155 characters) that leads with the primary user benefit.\n- State the main benefit the page delivers.\n- Add a supporting value or secondary detail.\n- End with a clear call to action phrase.",
  },
  {
    id: "page-md-problem-solution",
    name: "Problem-Solution",
    description: "Frames the page as solution to user need.",
    template:
      "Write a page meta description (130–155 characters) using a problem-solution format.\n- Frame the user need or problem in 5–8 words.\n- Position the page topic as the direct solution.\n- Include a key detail or differentiator.\n- End with a call to action phrase.",
  },
  {
    id: "page-md-trust-signal",
    name: "Trust Signal",
    description: "Uses authority, reliability, or transparency cues.",
    template:
      "Write a page meta description (130–155 characters) built around trust and authority.\n- Open with a trust statement relevant to the page topic.\n- Add a proof or reassurance element.\n- End with an action phrase.",
  },
  {
    id: "page-md-concise-seo",
    name: "Concise SEO",
    description: "Keyword-aligned but natural snippet style.",
    template:
      "Write a page meta description (130–155 characters) that is keyword-focused and natural.\n- Lead with the primary page keyword.\n- State the value or purpose of the page.\n- Add a secondary keyword naturally.\n- Keep it concise and scannable.",
  },
  {
    id: "page-md-action-oriented",
    name: "Action Oriented",
    description: "Encourages users to take the next step quickly.",
    template:
      "Write a page meta description (130–155 characters) that drives immediate action.\n- Open with an action verb lead.\n- State the page topic and key benefit.\n- End with a direct, encouraging call to action.",
  },
  {
    id: "page-md-story-driven",
    name: "Story-Driven",
    description: "Uses narrative framing to create an emotional connection.",
    template:
      "Write a page meta description (130–155 characters) using narrative framing.\n- Open with a story hook tied to the page topic.\n- Add a narrative detail that builds curiosity.\n- End with an invitation phrase.",
  },
  {
    id: "page-md-curiosity-hook",
    name: "Curiosity Hook",
    description: "Creates intrigue to draw users into the page.",
    template:
      "Write a page meta description (130–155 characters) that creates curiosity.\n- Open with a curiosity statement or question about the page topic.\n- Add a teaser detail that hints at the answer.\n- End with a discovery call to action.",
  },
  {
    id: "page-md-social-proof",
    name: "Social Proof",
    description: "Signals credibility through community trust or recognition.",
    template:
      "Write a page meta description (130–155 characters) led by social proof.\n- Open with \"Trusted by [customer count or segment]\".\n- State the page topic and proof statement.\n- End with an action phrase.",
  },
];

export const PAGE_META_TITLE_TEMPLATES = [
  {
    id: "page-mt-intent-keyword",
    name: "Intent + Keyword",
    description: "Combines user intent keyword and page topic.",
    template:
      "Write a page meta title (50–65 characters) combining intent and keyword.\n- Lead with the page topic.\n- Add a pipe separator and the intent keyword.\n- Format: \"Page Topic | Intent Keyword\"",
  },
  {
    id: "page-mt-brand-keyword",
    name: "Brand + Keyword",
    description: "Brand-safe title format with keyword targeting.",
    template:
      "Write a page meta title (50–65 characters) in brand-safe keyword format.\n- Lead with the page topic.\n- Add a pipe separator and the brand name.\n- Format: \"Page Topic | Brand Name\"",
  },
  {
    id: "page-mt-action-benefit",
    name: "Action + Benefit",
    description: "Action-oriented title with clear value.",
    template:
      "Write a page meta title (50–65 characters) with an action and benefit.\n- Lead with an action phrase.\n- Add a colon and the page topic.\n- Format: \"Action Phrase: Page Topic\"",
  },
  {
    id: "page-mt-question-style",
    name: "Question Style",
    description: "Useful for FAQ/help style pages.",
    template:
      "Write a page meta title (50–65 characters) in question format.\n- Open with a question hook relevant to the page.\n- Add a pipe separator and the page topic.\n- Format: \"Question Hook | Page Topic\"",
  },
  {
    id: "page-mt-trust",
    name: "Trust Focus",
    description: "Emphasizes reliability and clarity.",
    template:
      "Write a page meta title (50–65 characters) that emphasises trust.\n- Lead with the page topic.\n- Add a dash and a trust signal or reliability statement.\n- Format: \"Page Topic - Trust Signal\"",
  },
  {
    id: "page-mt-curiosity",
    name: "Curiosity Hook",
    description: "Uses an intrigue-building question or statement.",
    template:
      "Write a page meta title (50–65 characters) using a curiosity hook.\n- Open with a curiosity-building hook or question.\n- Add a pipe separator and the page topic.\n- Format: \"Curiosity Hook | Page Topic\"",
  },
  {
    id: "page-mt-benefit-clarity",
    name: "Benefit Clarity",
    description: "Clearly states the direct benefit the page delivers.",
    template:
      "Write a page meta title (50–65 characters) that states the direct benefit clearly.\n- Lead with the page topic.\n- Add a colon and the key benefit.\n- Separate with a pipe and the brand name.\n- Format: \"Page Topic: Key Benefit | Brand\"",
  },
  {
    id: "page-mt-guide-style",
    name: "Guide Style",
    description: "Positions page as an authoritative resource or guide.",
    template:
      "Write a page meta title (50–65 characters) that positions the page as an authoritative guide.\n- Open with \"Your\" followed by the page topic.\n- Add \"Guide\" and separate with a pipe and the brand name.\n- Format: \"Your Page Topic Guide | Brand\"",
  },
];
