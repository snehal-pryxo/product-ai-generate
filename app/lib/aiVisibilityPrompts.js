export function buildProductSchemaPrompt({ title, description, vendor, productType, price, currencyCode, available, url }) {
  return {
    systemPrompt: "You generate valid Schema.org JSON-LD for Shopify products. Return ONLY raw JSON — no markdown fences, no explanation.",
    prompt: `Generate a complete Schema.org Product JSON-LD object for this product:
- Title: ${title}
- Description: ${description || "N/A"}
- Vendor: ${vendor || "N/A"}
- Product Type: ${productType || "N/A"}
- Price: ${price || "N/A"} ${currencyCode || "USD"}
- Availability: ${available ? "InStock" : "OutOfStock"}
- URL: ${url}

Return a single JSON object with @context ("https://schema.org"), @type ("Product"), name, description, brand (Organization with name = vendor), offers (Offer with @type, price, priceCurrency, availability as full schema.org URL, url). Include all provided fields.`,
  };
}

export function buildArticleSchemaPrompt({ title, summary, body, authorName, publishedAt, url, blogTitle }) {
  const excerpt = (summary || body || "").substring(0, 300);
  return {
    systemPrompt: "You generate valid Schema.org JSON-LD for blog articles. Return ONLY raw JSON — no markdown fences, no explanation.",
    prompt: `Generate a complete Schema.org BlogPosting JSON-LD object for this article:
- Headline: ${title}
- Blog: ${blogTitle || "Blog"}
- Author: ${authorName || "Unknown"}
- Published: ${publishedAt || "Unknown"}
- Summary: ${excerpt}
- URL: ${url}

Return a single JSON object with @context ("https://schema.org"), @type ("BlogPosting"), headline, author (@type Person, name), datePublished, description, url. Include all provided fields.`,
  };
}

export function buildPageSchemaPrompt({ title, body, url }) {
  const excerpt = (body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 300);
  return {
    systemPrompt: "You generate valid Schema.org JSON-LD for web pages. Return ONLY raw JSON — no markdown fences, no explanation.",
    prompt: `Generate a complete Schema.org WebPage JSON-LD object for this page:
- Name: ${title}
- Content: ${excerpt || "N/A"}
- URL: ${url}

Return a single JSON object with @context ("https://schema.org"), @type ("WebPage"), name, description (one concise sentence from content), url.`,
  };
}

export function buildCollectionSchemaPrompt({ title, description, url }) {
  const excerpt = (description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 500);
  return {
    systemPrompt: "You generate valid Schema.org JSON-LD for Shopify collections. Return ONLY raw JSON - no markdown fences, no explanation.",
    prompt: `Generate a complete Schema.org CollectionPage JSON-LD object for this Shopify collection:
- Name: ${title}
- Description: ${excerpt || "N/A"}
- URL: ${url}

Return a single JSON object with @context ("https://schema.org"), @type ("CollectionPage"), name, description, url, and mainEntity as an ItemList when appropriate.`,
  };
}

export function buildProductFaqPrompt({ title, description, language = "English" }) {
  return {
    systemPrompt: "You generate FAQ pairs for Shopify products. Return ONLY a raw JSON array — no markdown fences, no explanation.",
    prompt: `Generate 4 to 6 FAQ question-and-answer pairs for this product.
Focus on: purchase intent, sizing or compatibility, usage instructions, materials or ingredients, shipping, and common concerns.
Write every question and answer in ${language}.

Product: ${title}
Description: ${description || "N/A"}

Return a JSON array in this exact format:
[{"question": "...", "answer": "..."}, ...]`,
  };
}

export function buildArticleFaqPrompt({ title, body }) {
  const excerpt = (body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 800);
  return {
    systemPrompt: "You generate FAQ pairs from blog articles. Return ONLY a raw JSON array — no markdown fences, no explanation.",
    prompt: `Generate 4 to 6 FAQ question-and-answer pairs from this article.
Extract the most important questions a reader would have after reading.

Article: ${title}
Content: ${excerpt}

Return a JSON array in this exact format:
[{"question": "...", "answer": "..."}, ...]`,
  };
}

export function buildCombinedProductPrompt({ title, description, vendor, productType, price, currencyCode, available, url }) {
  return {
    systemPrompt: "You generate Schema.org JSON-LD and FAQ pairs for Shopify products. Return ONLY raw JSON in the exact structure specified — no markdown fences, no explanation.",
    prompt: `For this Shopify product, generate both:
1. A Schema.org Product JSON-LD object
2. 4 to 6 FAQ question-answer pairs

Product:
- Title: ${title}
- Description: ${description || "N/A"}
- Vendor: ${vendor || "N/A"}
- Product Type: ${productType || "N/A"}
- Price: ${price || "N/A"} ${currencyCode || "USD"}
- Availability: ${available ? "InStock" : "OutOfStock"}
- URL: ${url}

Return ONLY this exact JSON structure (no other text):
{
  "schema": {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "...",
    "description": "...",
    "brand": {"@type": "Organization", "name": "..."},
    "offers": {"@type": "Offer", "price": "...", "priceCurrency": "...", "availability": "https://schema.org/InStock", "url": "..."}
  },
  "faqs": [{"question": "...", "answer": "..."}, ...]
}`,
  };
}

export function buildLlmsTxtPrompt({ shopName, shopDomain, products, articles, pages, collections = [] }) {
  const productLines = products
    .map((p) => `- [${p.title}](https://${shopDomain}/products/${p.handle}): ${(p.description || p.title).substring(0, 100)}`)
    .join("\n");
  const articleLines = articles
    .map((a) => `- [${a.title}](https://${shopDomain}/blogs/${a.blog?.handle || "news"}/${a.handle}): ${(a.summary || a.title).substring(0, 100)}`)
    .join("\n");
  const pageLines = pages
    .map((p) => `- [${p.title}](https://${shopDomain}/pages/${p.handle}): ${(p.bodySummary || p.title).substring(0, 100)}`)
    .join("\n");
  const collectionLines = collections
    .map((c) => `- [${c.title}](https://${shopDomain}/collections/${c.handle}): ${(c.description || c.descriptionHtml || c.title).replace(/<[^>]+>/g, " ").substring(0, 100)}`)
    .join("\n");

  return {
    systemPrompt: "You generate llms.txt files for Shopify stores. Return ONLY the formatted text content — no JSON, no markdown code fences.",
    prompt: `Generate an llms.txt file for this Shopify store following the llms.txt standard.

Store: ${shopName}
Domain: ${shopDomain}

Products (${products.length}):
${productLines || "None"}

Collections (${collections.length}):
${collectionLines || "None"}

Blog Posts (${articles.length}):
${articleLines || "None"}

Pages (${pages.length}):
${pageLines || "None"}

Required format — return ONLY this structure with real content:
# ${shopName}
> [one-sentence description of what this store sells]

## Products
[list of product links with one-sentence descriptions]

## Collections
[list of collection links with one-sentence descriptions]

## Blog Posts
[list of article links with one-sentence summaries]

## Pages
[list of page links describing what each page covers]

Keep each description to one concise sentence. Do not include any preamble or explanation.`,
  };
}
