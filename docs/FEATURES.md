# Product AI Generate — Feature Reference

> Shopify embedded app for AI-powered content and SEO generation across products, collections, pages, and blogs.

---

## Table of Contents

1. [Dashboard](#1-dashboard)
2. [Products](#2-products)
3. [Collections](#3-collections)
4. [Pages](#4-pages)
5. [Blog Posts](#5-blog-posts)
6. [Content Management](#6-content-management)
7. [SEO Improve](#7-seo-improve)
8. [Template Library](#8-template-library)
9. [Settings](#9-settings)
10. [Analytics](#10-analytics)
11. [Pricing & Billing](#11-pricing--billing)
12. [Credit System](#12-credit-system)
13. [AI Provider Support](#13-ai-provider-support)

---

## 1. Dashboard

**Route:** `/app` (`app._index.jsx`)

The main landing page after install. Provides a high-level summary of activity and quick access to all major areas.

### KPI bar
| Metric | Description |
|---|---|
| Generated Words | Total words produced across all content types |
| Time Saved | Estimated hours saved (based on 600 words/hour) |
| Available Credits | Remaining generation credits |
| Current Plan | Active billing plan and monthly price |

### Specific Generated Count
Per-resource breakdown of generated pieces:

| Resource | Fields tracked |
|---|---|
| Product | Descriptions, Meta Titles, Meta Descriptions |
| Collection | Descriptions, Meta Titles, Meta Descriptions |
| Collection Product | Descriptions, Meta Titles, Meta Descriptions |
| Pages | Body Content, Meta Titles, Meta Descriptions |
| Blog | Content Generated |

### Quick Access shortcuts
Cards linking to: Template, Settings, Content Management, Analytics.

### Default AI Model selector
Dropdown on the dashboard to set the store-wide default model saved to the `shop` record.

### Review popup
Appears automatically 7 days after install (once, unless dismissed or already submitted). Collects 1–5 star rating and optional text feedback.

### Partner apps section
Promotes Fomoify, CartLift, and MixBox Shopify apps.

### Support section
- Book a free 30-minute setup call (Outlook booking link)
- Email support (`support@m2webdesigning.com`)
- WhatsApp support

---

## 2. Products

**Route:** `/app/products` (`app.products.jsx`)

### Features
- **Product list** fetched from Shopify Admin GraphQL (up to 250 per page, paginated)
- **Status filter:** All / Active / Draft
- **Search:** Filter products by title in real-time
- **Per-product edit drawer:** Generate description, meta title, meta description individually or all at once
- **Bulk generate:** Select up to **1,000 products** at a time; choose which content types to regenerate
- **Content type selection:** Description, Meta Title, Meta Description (any combination)
- **Language selection:** 38 languages supported (English, Arabic, Bengali … Vietnamese)
- **Custom prompt support:** Override the default prompt per generation run
- **Template library picker:** Choose a named prompt template from the library for each field
- **Rich text editor:** Preview and edit generated description HTML before applying
- **Apply to Shopify:** Writes description and SEO fields back to the product via Shopify GraphQL mutation
- **Credit deduction:** 1 credit per content field per product; refund on failure
- **Status badges:** Shows whether a product already has generated content stored

### Supported AI providers
OpenAI (default), Ollama (fallback or primary), Anthropic Claude, Gemini, DeepSeek, Cohere — resolved from shop or ENV settings.

### Error handling
- Rate limit retry (20 s delay, one retry)
- Quota / access errors surface as inline banners
- Automatic Ollama fallback when `ENABLE_OLLAMA_FALLBACK=true`

---

## 3. Collections

**Route:** `/app/collections` (`app.collections.jsx`)

### Features
- **Collection list** from Shopify Admin GraphQL (up to 250)
- **Status filter, search** — same UX as Products
- **Two generation modes:**
  - **Collection content** — description + SEO for the collection itself
  - **Collection products mode** — generate content for all products inside a selected collection
- **Bulk generate:** Up to **500 collections** at a time
- **Content types:** Description, Meta Title, Meta Description
- **Language & template selection:** Same options as Products
- **Apply to Shopify:** Updates collection description and SEO via GraphQL mutation
- **Credit system:** 1 credit per field per item; full credit refund on batch errors

---

## 4. Pages

**Route:** `/app/pages` (`app.pages.jsx`)

### Features
- Lists all Shopify pages (About, FAQ, Contact, landing pages, etc.)
- **Generate:** Body content, Meta Title, Meta Description
- **Page type awareness:** prompts adapt based on page type
- **Configurable word targets** per field (from Settings)
- Template library support for all 3 field types
- **Apply to Shopify:** Writes `body_html` and SEO metafields back via GraphQL
- Credit cost: 1 credit per field per page

---

## 5. Blog Posts

**Route:** `/app/blog` (`app.blog.jsx`)

### Features
- **Blog list** — all Shopify blogs fetched via GraphQL (paginated)
- **Article list** — latest articles across all blogs, sortable by updated date
- **Tab-based generation types:**
  - Freeform blog content
  - Product-focused blog post (linked to a product by handle)
  - Promotional / offer content (`offerText` field)
  - Holiday / seasonal content
- **Rich text editor** for previewing and editing generated body HTML
- **Publish directly** to Shopify as a new article via `articleCreate` mutation
- **Language, tone, length, target audience** options
- **Credit cost:** 1 credit per blog body generation

### Stored fields (`BlogGeneratedContent`)
`title`, `summary`, `bodyHtml`, `status`, `language`, `tone`, `lengthOption`, `targetAudience`, `tabType`, `topic`, `promotion`, `offerText`, `holiday`, `productUrl`

---

## 6. Content Management

**Route:** `/app/content-management` (`app.content-management.jsx`)

Centralised review and apply interface for all stored generated content.

### Features
- **Tabbed view:** Products, Collections, Pages (Blog omitted from bulk apply)
- **Paginated index table** (10 items per page) showing stored generated content
- **Status indicators:** Applied / Not applied, content completeness
- **Inline preview:** Rich text editor showing stored description HTML
- **Per-item apply:** Push individual items to Shopify
- **Bulk apply:** Select multiple items and apply in one action
- **Re-generate:** Trigger a new generation for any stored item directly from this view
- **Template library picker** and language/tone/length overrides available per item
- Credit deduction on re-generation (3 credits per full content regeneration from this screen)

---

## 7. SEO Improve

**Route:** `/app/seo-improve` (`app.seo-improve.jsx`)

Dedicated SEO audit and configuration tool separate from AI generation.

### Sub-features

#### Performance
- **Instant Page** — enable/disable instant page load optimisation
- **Quick Link** — enable/disable quick link prefetch

#### Images
- **Image compression** toggle
- **Alt text generation** toggle
- **Alt generation mode:** Template-based (`{{productTitle}} by {{productVendor}}`) or AI-generated
- **Product status filter:** All / Active / Draft
- **Only missing alt** option

#### Schema markup
Enable/disable structured data types per resource:

| Schema type | Applies to |
|---|---|
| Breadcrumb | All pages |
| Product | Product pages |
| Sitelinks | Homepage |
| Organization | Store |
| Article | Blog posts |
| Local | Local business |

Additional product schema options: pricing type (single/range), sale price expiry, stock availability, return policy.

#### SEO Audit table
Fetches products, collections, pages, and articles from Shopify to surface missing or incomplete SEO fields. Supports inline editing and direct Shopify update.

---

## 8. Template Library

**Route:** `/app/template` (`app.template.jsx`)

### System templates
Pre-built prompt templates for all supported content fields:

| Resource | Fields |
|---|---|
| Product | Description, Meta Title, Meta Description |
| Collection | Description, Meta Title, Meta Description |
| Page | Body, Meta Title, Meta Description |
| Blog | Body, Meta Title, Meta Description |

Each template includes a preview rendered as formatted text. Templates are selected per field and stored in `shop.templateSelectionsJson`.

### Custom templates
Merchants can write their own prompt templates stored in `shop.customPromptTemplatesJson`. Custom templates appear alongside system templates in the picker modal.

### Two main tabs
- **System templates** — curated library
- **Custom templates** — merchant-authored templates

---

## 9. Settings

**Route:** `/app/settings` (`app.settings.jsx`)

Store-wide generation defaults persisted in `shop.globalSettingsJson`.

### Configurable defaults

| Setting | Default |
|---|---|
| Language | English |
| AI Provider | auto |
| Product description word target | 250 words |
| Product meta title word target | 60 words |
| Product meta description word target | 160 words |
| Collection description word target | 250 words |
| Collection meta title/description word targets | 60 / 160 words |
| Page content word target | 450 words |
| Page meta title/description word targets | 60 / 160 words |
| Product description keywords | "high quality, premium, durable, best value" |
| Product meta title keywords | "buy online, best price, shop now" |
| Collection keywords | (per field) |
| Page keywords | (per field) |
| Blog keywords | (per field) |

Template ID selections for all 12 content fields are also stored here as `*TemplateId` keys.

### API key management
Merchants can store their own OpenAI and Anthropic API keys (`shop.openaiApiKey`, `shop.anthropicApiKey`) to use personal quota instead of app-managed credits.

---

## 10. Analytics

**Route:** `/app/analytics` (`app.analytics.jsx`)

### Features
- **Date range selector:** Last 7 / 14 / 30 / 90 days, or custom start/end date
- **Daily generation activity chart** — line/bar chart from `GeneratedContentLog`
- **Resource type breakdown** — product, collection, page, blog proportions
- **SEO coverage audit** — checks products, collections, pages, and articles in Shopify for missing SEO title and description; displays coverage percentage
- **Credit usage summary** — credits used in period vs. total remaining
- **Generation count by resource type** tab

---

## 11. Pricing & Billing

**Routes:** `/app/pricing` (`app.pricing.jsx`), `/app/billing` (`app.billing.jsx`)

### Subscription plans

| Plan | Price | Credits/month | Key features |
|---|---|---|---|
| Free | $0 | 100 | Product descriptions, meta title & description, basic templates |
| Starter | $9.99 | 1,500 | All resource types, SEO generation, template library |
| Growth | $19.99 | 5,000 | Bulk generation, blog, multi-language, priority support |
| Pro | $39.99 | 15,000 | Large bulk, advanced blog & SEO, analytics |
| Agency / Enterprise | $99 | 60,000 | Highest volume, agency workflows, dedicated onboarding |

Plans renew every 30 days via Shopify recurring app charges (USD).

### Extra credit packages

| Package | Credits | Price |
|---|---|---|
| Small | 1,000 | $5 |
| Medium | 5,000 | $20 |
| Large | 15,000 | $50 |

One-time purchases added on top of subscription credits.

### ENV overrides
All plan prices and credit amounts can be overridden via environment variables (`BILLING_STARTER_PRICE`, `BILLING_GROWTH_CREDITS`, etc.) without code changes.

---

## 12. Credit System

Managed in `app/lib/credits.server.js` and `app/lib/billing.server.js`.

### Rules
- **1 credit** consumed per content field per item (description = 1, meta title = 1, meta description = 1)
- Credits checked **before** generation; job rejected if balance is insufficient
- Credits **refunded** automatically if a generation fails mid-batch
- Monthly plan credits renew automatically when the renewal date passes (`refreshMonthlyPlanCredits`)
- `creditsUsedTotal` tracks cumulative usage for analytics

### Credit deduction logic
```
creditsRequired = contentTypes.length × itemsCount
```
If `shop.credits < creditsRequired` → return "Insufficient credits" error with current balance.

---

## 13. AI Provider Support

### Supported providers & models

| Provider | Models |
|---|---|
| OpenAI | `gpt-4o-mini` (default), configurable via `OPENAI_MODEL` |
| Anthropic Claude | `claude-haiku-4.5`, `claude-sonnet-4.6`, `claude-haiku-4-5-20251001` |
| Google Gemini | `gemini-flash-lite` |
| DeepSeek | `deepseek-v3.2` |
| Cohere | `cohere-command-r-plus` |
| Ollama (local) | `llama3.2:1b` (default), fully configurable |

### Provider resolution order (`defaultAiProvider = "auto"`)
1. Use `shop.defaultAiProvider` or ENV `AI_PROVIDER`
2. Fall back to OpenAI if set; fall back to Ollama if `ENABLE_OLLAMA_FALLBACK=true`

### Per-shop API keys
Merchants can supply their own keys in Settings → `openaiApiKey` / `anthropicApiKey`, bypassing app-level quota.

### Environment variables

| Variable | Purpose |
|---|---|
| `AI_PROVIDER` | Primary provider (`openai`, `ollama`, `anthropic`, etc.) |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | Default OpenAI model |
| `OLLAMA_BASE_URL` | Ollama server URL |
| `OLLAMA_MODEL` | Ollama model name |
| `ENABLE_OLLAMA_FALLBACK` | Auto-fallback from OpenAI to Ollama on quota/rate errors |

---

## Webhooks

| Webhook | Handler |
|---|---|
| `app/uninstalled` | Marks shop as uninstalled in DB |
| `app/scopes_update` | Handles scope change events |
| `customers/data_request` | GDPR data request |
| `customers/redact` | GDPR customer redact |
| `shop/redact` | GDPR shop redact |

---

## Data Models Summary

| Model | Purpose |
|---|---|
| `Session` | Shopify OAuth session |
| `shop` | Per-store settings, credits, billing, API keys, review status |
| `BillingSubscription` | Recurring plan subscription records |
| `BillingCreditPurchase` | One-time credit package purchases |
| `GeneratedContentLog` | Audit log of every generation event |
| `ProductGeneratedContent` | Latest generated content per product |
| `CollectionGeneratedContent` | Latest generated content per collection |
| `CollectionProductGeneratedContent` | Product content generated via collection flow |
| `PageGeneratedContent` | Latest generated content per page |
| `BlogGeneratedContent` | Latest generated blog article content |
