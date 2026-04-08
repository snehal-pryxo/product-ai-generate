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
      "[Intro hook about brand purpose]\n[Founding story and why brand exists]\n[Core mission and values]\n[What makes your brand different]\n[Proof: years, milestones, or customer trust]\n[Invite visitors to explore products or contact you]",
  },
  {
    id: "page-body-policy-clarity",
    name: "Policy Clarity",
    description: "For shipping, refund, privacy, and terms pages.",
    template:
      "[Policy summary in plain language]\n[Scope: what this policy applies to]\n[Key clauses in clear sections]\n[Exceptions and limitations]\n[Customer action steps]\n[Support contact and response timeline]",
  },
  {
    id: "page-body-faq-structured",
    name: "FAQ Structured",
    description: "Organized question-answer structure for common concerns.",
    template:
      "[Short intro for FAQ page]\n[Category heading 1]\n[Question + concise answer]\n[Question + concise answer]\n[Category heading 2]\n[Question + concise answer]\n[Question + concise answer]\n[Escalation to support or contact]",
  },
  {
    id: "page-body-contact-conversion",
    name: "Contact Conversion",
    description: "Contact page focused on clarity, confidence, and action.",
    template:
      "[Friendly opening statement]\n[Primary reasons to contact]\n[Expected response time]\n[Preferred contact channels]\n[Information users should include]\n[Reassurance and final CTA]",
  },
  {
    id: "page-body-landing-offer",
    name: "Landing Offer",
    description: "For campaign pages with clear offer and CTA blocks.",
    template:
      "[Headline with value proposition]\n[Offer summary]\n[Problem-solution section]\n[Key benefits list]\n[Social proof/testimonial section]\n[Urgency cue]\n[Primary CTA block]",
  },
  {
    id: "page-body-comparison",
    name: "Comparison",
    description: "Comparison or why-choose-us page template.",
    template:
      "[Intro to comparison intent]\n[Criteria used for comparison]\n[How your brand/page solution performs per criterion]\n[Evidence and proof points]\n[Best-fit customer profile]\n[Conclusion and CTA]",
  },
  {
    id: "page-body-team",
    name: "Team / People",
    description: "Introduces team members to build credibility and personality.",
    template:
      "[Opening statement about the people behind the brand]\n[Company culture and shared values]\n[Team member 1: name, role, short bio]\n[Team member 2: name, role, short bio]\n[Team member 3: name, role, short bio]\n[What drives the team collectively]\n[Invitation to connect or work together]",
  },
  {
    id: "page-body-testimonials",
    name: "Testimonials / Reviews",
    description: "Social proof page showcasing customer experiences.",
    template:
      "[Intro: why customer voices matter to your brand]\n[Featured testimonial 1 with name and context]\n[Featured testimonial 2 with name and context]\n[Featured testimonial 3 with name and context]\n[Overall rating or review count summary]\n[Common theme across reviews]\n[CTA: join the community or shop now]",
  },
  {
    id: "page-body-press-media",
    name: "Press / Media",
    description: "Highlights brand mentions, awards, and media coverage.",
    template:
      "[Brand introduction suitable for press]\n[Key media mentions or coverage]\n[Awards or certifications received]\n[Press quote 1 with source]\n[Press quote 2 with source]\n[Brand milestones or stats]\n[Press contact information and invitation]",
  },
  {
    id: "page-body-size-guide",
    name: "Size Guide",
    description: "Helps customers find the right fit with clear measurement guidance.",
    template:
      "[Intro: why sizing guidance matters for a good experience]\n[How to measure: step-by-step instructions]\n[Size chart with measurements]\n[Product-specific fit notes]\n[International size conversion if applicable]\n[Tips for between sizes]\n[Support CTA for additional help]",
  },
];

export const PAGE_META_DESCRIPTION_TEMPLATES = [
  {
    id: "page-md-benefit-first",
    name: "Benefit First",
    description: "Starts with the key user benefit then action.",
    template: "{primary_page_benefit}. {supporting_value}. {cta_phrase}.",
  },
  {
    id: "page-md-problem-solution",
    name: "Problem-Solution",
    description: "Frames the page as solution to user need.",
    template: "{user_need} solved with {page_topic}. {key_detail}. {cta_phrase}.",
  },
  {
    id: "page-md-trust-signal",
    name: "Trust Signal",
    description: "Uses authority, reliability, or transparency cues.",
    template: "{trust_statement} for {page_topic}. {proof_or_reassurance}. {action_phrase}.",
  },
  {
    id: "page-md-concise-seo",
    name: "Concise SEO",
    description: "Keyword-aligned but natural snippet style.",
    template: "{page_keyword} page with {value_statement}. {secondary_keyword}.",
  },
  {
    id: "page-md-action-oriented",
    name: "Action Oriented",
    description: "Encourages users to take the next step quickly.",
    template: "{action_lead} with {page_topic}. {benefit_statement}. {cta_phrase}.",
  },
  {
    id: "page-md-story-driven",
    name: "Story-Driven",
    description: "Uses narrative framing to create an emotional connection.",
    template: "{story_hook} behind {page_topic}. {narrative_detail}. {invitation_phrase}.",
  },
  {
    id: "page-md-curiosity-hook",
    name: "Curiosity Hook",
    description: "Creates intrigue to draw users into the page.",
    template: "{curiosity_statement} about {page_topic}? {teaser_detail}. {discovery_cta}.",
  },
  {
    id: "page-md-social-proof",
    name: "Social Proof",
    description: "Signals credibility through community trust or recognition.",
    template: "Trusted by {customer_count_or_segment} for {page_topic}. {proof_statement}. {action_phrase}.",
  },
];

export const PAGE_META_TITLE_TEMPLATES = [
  {
    id: "page-mt-intent-keyword",
    name: "Intent + Keyword",
    description: "Combines user intent keyword and page topic.",
    template: "{page_topic} | {intent_keyword}",
  },
  {
    id: "page-mt-brand-keyword",
    name: "Brand + Keyword",
    description: "Brand-safe title format with keyword targeting.",
    template: "{page_topic} | {brand_name}",
  },
  {
    id: "page-mt-action-benefit",
    name: "Action + Benefit",
    description: "Action-oriented title with clear value.",
    template: "{action_phrase}: {page_topic}",
  },
  {
    id: "page-mt-question-style",
    name: "Question Style",
    description: "Useful for FAQ/help style pages.",
    template: "{question_hook} | {page_topic}",
  },
  {
    id: "page-mt-trust",
    name: "Trust Focus",
    description: "Emphasizes reliability and clarity.",
    template: "{page_topic} - {trust_signal}",
  },
  {
    id: "page-mt-curiosity",
    name: "Curiosity Hook",
    description: "Uses an intrigue-building question or statement.",
    template: "{curiosity_hook} | {page_topic}",
  },
  {
    id: "page-mt-benefit-clarity",
    name: "Benefit Clarity",
    description: "Clearly states the direct benefit the page delivers.",
    template: "{page_topic}: {key_benefit} | {brand_name}",
  },
  {
    id: "page-mt-guide-style",
    name: "Guide Style",
    description: "Positions page as an authoritative resource or guide.",
    template: "Your {page_topic} Guide | {brand_name}",
  },
];
