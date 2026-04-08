export const BLOG_PROMPT_TEMPLATE_STORAGE_KEY = "blog_prompt_template_selection_v1";

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

export function getEmptyBlogTemplateSelection() {
  return { ...EMPTY_TEMPLATE_SELECTION };
}

export function readStoredBlogPromptTemplateSelection() {
  if (typeof window === "undefined") return getEmptyBlogTemplateSelection();

  try {
    const raw = window.localStorage.getItem(BLOG_PROMPT_TEMPLATE_STORAGE_KEY);
    if (!raw) return getEmptyBlogTemplateSelection();
    return normalizeTemplateSelection(JSON.parse(raw));
  } catch {
    return getEmptyBlogTemplateSelection();
  }
}

export function writeStoredBlogPromptTemplateSelection(selection) {
  const normalized = normalizeTemplateSelection(selection);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(BLOG_PROMPT_TEMPLATE_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function clearStoredBlogPromptTemplateSelection() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(BLOG_PROMPT_TEMPLATE_STORAGE_KEY);
  }
  return getEmptyBlogTemplateSelection();
}

export const BLOG_BODY_TEMPLATES = [
  {
    id: "blog-body-500-plus",
    name: "Long Form 500+ Words",
    description: "Structured long-form template targeting at least 500 words.",
    template:
      "[Compelling intro with reader pain-point and promise]\n[Section 1: core concept explained clearly]\n[Section 2: practical framework or method]\n[Section 3: actionable tips with examples]\n[Section 4: mistakes to avoid and fixes]\n[Section 5: checklist or implementation steps]\n[Conclusion with summary and CTA]\n[Ensure total article length is 500+ words]",
  },
  {
    id: "blog-body-how-to",
    name: "How-To Guide",
    description: "Step-based instructional article format.",
    template:
      "[Clear problem/intention intro]\n[Who this guide is for]\n[Required context/tools]\n[Step 1 with practical detail]\n[Step 2 with practical detail]\n[Step 3 with practical detail]\n[Common mistakes and fixes]\n[Conclusion + CTA]",
  },
  {
    id: "blog-body-listicle",
    name: "Listicle",
    description: "Scannable numbered tips or ideas.",
    template:
      "[Hook with promise of list value]\n[Quick context paragraph]\n[Item 1 with explanation]\n[Item 2 with explanation]\n[Item 3 with explanation]\n[Item 4 with explanation]\n[Optional bonus item]\n[Summary + next-step CTA]",
  },
  {
    id: "blog-body-problem-solution",
    name: "Problem-Solution",
    description: "Deep dive into challenge, causes, and practical solutions.",
    template:
      "[Problem framing and stakes]\n[Why this problem happens]\n[Impact on audience]\n[Solution strategy 1]\n[Solution strategy 2]\n[Solution strategy 3]\n[Real-world implementation example]\n[Conclusion + CTA]",
  },
  {
    id: "blog-body-beginner-guide",
    name: "Beginner Guide",
    description: "Explains fundamentals in plain language.",
    template:
      "[Beginner-friendly intro]\n[Core concept definition]\n[Key term explanation]\n[Simple framework]\n[Practical starter checklist]\n[Next steps]\n[Resources and CTA]",
  },
  {
    id: "blog-body-comparison",
    name: "Comparison Review",
    description: "Compares options with clear criteria and recommendation.",
    template:
      "[Comparison goal]\n[Criteria used]\n[Option A strengths/limits]\n[Option B strengths/limits]\n[Option C strengths/limits]\n[Best use case by audience]\n[Recommendation + CTA]",
  },
  {
    id: "blog-body-case-study",
    name: "Case Study",
    description: "Narrative format with context, actions, and results.",
    template:
      "[Context and challenge]\n[Initial baseline state]\n[Actions taken]\n[Execution details]\n[Measured results]\n[Key lessons]\n[How readers can apply this]\n[CTA]",
  },
  {
    id: "blog-body-expert-interview",
    name: "Expert Interview",
    description: "Q&A format featuring insights from an industry expert or brand voice.",
    template:
      "[Intro: who the expert is and why their perspective matters]\n[Context setting: the topic being explored]\n[Question 1 + expert answer]\n[Question 2 + expert answer]\n[Question 3 + expert answer]\n[Question 4 + expert answer]\n[Key takeaways from the interview]\n[Conclusion + CTA]",
  },
  {
    id: "blog-body-product-review",
    name: "Product Review",
    description: "In-depth review article covering pros, cons, and verdict.",
    template:
      "[Intro: product overview and context for review]\n[Who this product is made for]\n[First impressions and packaging]\n[Feature/quality assessment 1]\n[Feature/quality assessment 2]\n[Feature/quality assessment 3]\n[Pros and cons summary]\n[Verdict and recommendation]\n[CTA]",
  },
  {
    id: "blog-body-trend-roundup",
    name: "Trend / News Roundup",
    description: "Curates recent developments or trends relevant to the audience.",
    template:
      "[Intro: why these trends matter right now]\n[Trend or news item 1 with context]\n[Trend or news item 2 with context]\n[Trend or news item 3 with context]\n[Trend or news item 4 with context]\n[What these trends mean for the reader]\n[How to act on these insights]\n[Conclusion + CTA]",
  },
  {
    id: "blog-body-ultimate-checklist",
    name: "Ultimate Checklist",
    description: "Comprehensive checklist format for planning or preparation topics.",
    template:
      "[Intro: why this checklist is valuable]\n[Phase 1 heading]\n[Checklist item 1]\n[Checklist item 2]\n[Checklist item 3]\n[Phase 2 heading]\n[Checklist item 4]\n[Checklist item 5]\n[Checklist item 6]\n[Final review section]\n[Download or save CTA]",
  },
];

export const BLOG_META_DESCRIPTION_TEMPLATES = [
  {
    id: "blog-md-learn-outcome",
    name: "Learn Outcome",
    description: "Promotes what readers will learn.",
    template: "Learn {reader_outcome} in this {article_topic} guide. {secondary_benefit}.",
  },
  {
    id: "blog-md-problem-solution",
    name: "Problem-Solution",
    description: "Frames post as answer to a specific problem.",
    template: "Struggling with {problem_statement}? This article explains {solution_summary}.",
  },
  {
    id: "blog-md-listicle",
    name: "Listicle Summary",
    description: "Meta description for tip/list style articles.",
    template: "Discover {number_of_points} key tips on {article_topic} and start improving results today.",
  },
  {
    id: "blog-md-expert-tips",
    name: "Expert Tips",
    description: "Highlights practical and credible advice.",
    template: "Get expert-backed insights on {article_topic}, including {highlight_topic} and practical next steps.",
  },
  {
    id: "blog-md-action-cta",
    name: "Action CTA",
    description: "Ends with stronger click invitation.",
    template: "{article_topic} made simple: {core_value}. Read now and apply these ideas immediately.",
  },
  {
    id: "blog-md-story-hook",
    name: "Story Hook",
    description: "Opens with a narrative element to spark curiosity.",
    template: "{story_opening} about {article_topic}. {narrative_detail} that could change how you {reader_action}.",
  },
  {
    id: "blog-md-curiosity-gap",
    name: "Curiosity Gap",
    description: "Withholds key information to drive click-through.",
    template: "Most people get {article_topic} wrong. Discover {surprising_insight} and what to do instead.",
  },
  {
    id: "blog-md-quick-wins",
    name: "Quick Wins",
    description: "Promises immediate, actionable results.",
    template: "Quick wins for {article_topic}: {core_value}. Apply in minutes and see results today.",
  },
];

export const BLOG_META_TITLE_TEMPLATES = [
  {
    id: "blog-mt-how-to",
    name: "How To",
    description: "Classic how-to search intent title.",
    template: "How to {achieve_outcome} | {article_topic}",
  },
  {
    id: "blog-mt-complete-guide",
    name: "Complete Guide",
    description: "Authority style title for deep-dive posts.",
    template: "{article_topic}: Complete Guide ({year_or_update})",
  },
  {
    id: "blog-mt-tips",
    name: "Tips Format",
    description: "Numbered tips style title.",
    template: "{number_of_tips} Tips for {article_topic}",
  },
  {
    id: "blog-mt-comparison",
    name: "Comparison",
    description: "Comparison title format for decision intent.",
    template: "{option_a} vs {option_b}: Best for {use_case}",
  },
  {
    id: "blog-mt-best-for",
    name: "Best For",
    description: "Commercial intent style title.",
    template: "Best {article_topic} for {target_audience}",
  },
  {
    id: "blog-mt-question-style",
    name: "Question Style",
    description: "Directly asks the reader's search question.",
    template: "{reader_question} | {article_topic}",
  },
  {
    id: "blog-mt-beginner-friendly",
    name: "Beginner Friendly",
    description: "Signals accessible, jargon-free content.",
    template: "{article_topic} for Beginners: {core_promise}",
  },
  {
    id: "blog-mt-year-edition",
    name: "Year Edition",
    description: "Adds year for freshness and evergreen SEO updates.",
    template: "{article_topic} in {year}: {core_promise}",
  },
  {
    id: "blog-mt-case-study",
    name: "Case Study",
    description: "Results-driven title for social proof articles.",
    template: "How {subject} Achieved {result} with {article_topic}",
  },
];
