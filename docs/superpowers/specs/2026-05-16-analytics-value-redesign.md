# Analytics Value Redesign — Design Spec
**Date:** 2026-05-16  
**Status:** In Progress (partial design — to be continued)

---

## Goal

Transform the analytics experience from showing *activity* (how many times you used the app) to showing *value* (what those uses achieved for your store). Target outcomes:

1. **Merchant confidence** — opening analytics makes them feel "this app is paying for itself"
2. **Retention** — surfacing moments of success keeps merchants subscribed longer

---

## Approach: Value-First Restructure (Approach B + improvements)

Reorder the analytics page so it leads with the value story, and improve existing sections. The generation activity chart moves to the bottom as a "power user" section. A new home screen widget surfaces the headline value number without requiring navigation to analytics.

---

## Context: Existing Analytics State

**What's tracked well:**
- Every AI generation logged: intent, model, provider, tokens, generation time (ms), credits, whether content was saved (`appliedToProduct`)
- SEO coverage scores across all content types
- Daily generation activity chart with resource type + generation type filters
- Bulk job progress

**Core gap:** The page leads with a generation activity chart (activity metric), not value metrics. Merchants can't immediately answer "Was this app worth it?"

**Data available (no new tracking required for core features):**
- `GeneratedContentLog` — every generation with `intent`, `creditsUsed`, `generationMs`, `appliedToProduct`
- `Shop` — `credits`, `creditsUsedTotal`, `billingPlanCredits`
- Shopify API — live product/collection/page/article counts + SEO field coverage

---

## Time Saved Calculation

Estimated minutes saved per generation type (applied to all `appliedToProduct = true` generations):

| Intent | Estimated minutes saved |
|--------|------------------------|
| Product description | 15 min |
| SEO title | 5 min |
| SEO description | 5 min |
| Blog article | 60 min |
| Page content | 10 min |
| Collection description | 10 min |

Display formula: sum all saved minutes → convert to hours/minutes → show as "X hrs Y min saved"

---

## Merchant Personas (all must feel value)

- **SEO-focused** — wants better Google rankings
- **Time-focused** — wants to reclaim hours spent writing
- **Completeness-focused** — wants every product to have good copy

Since it varies, the page surfaces value signals for all three.

---

## Design: Home Screen Value Snapshot (new widget)

A card on the app home page, always visible without navigating to analytics.

**State A — Active merchant (has at least 1 generation):**
- Headline: "You saved [X hrs Y min] this month"
- Supporting stat 1: SEO coverage % (e.g., "73% SEO coverage")
- Supporting stat 2: Total content generated this month (e.g., "47 pieces generated")
- Link: "View full analytics →"

**State B — New merchant (0 generations):**
- Pull live product count from Shopify
- Display: "Your store has [N] products. Stores this size typically save [N × 15 min formatted as hours] per month."
- CTA: "Start generating to track your savings →"

---

## Design: Analytics Page Restructure

### New page order (value story top-down):

1. **Value Hero** (new) — Time saved headline + SEO coverage growth + content coverage
2. **Store Transformation** (new) — Before/after SEO coverage growth, coverage by type, "still missing" action items
3. **Generation Activity** (existing, improved) — Time-series chart with period comparison, credit burn rate
4. **Credits & Plan** (existing, improved) — Balance, burn rate, plan utilization

*Sections 2–4 are not yet fully designed — to be continued.*

---

## Open Questions / To Be Continued

- [ ] Design Section 2: Store Transformation — specifics of before/after visualization
- [ ] Design Section 3: Generation Activity improvements — period comparison overlay, burn rate forecast
- [ ] Design Section 4: Credits & Plan improvements — burn rate gauge, days remaining
- [ ] Check Shopify API scopes available — can we pull traffic/sales data to show "SEO content drove X visits"?
- [ ] Decide on export capability for the recent generations table
- [ ] Decide on filtering in the recent generations table (currently only 10 rows, no filters)

---

## Implementation Notes

- No new database tables required for core features
- Time saved calculation is pure client-side math on existing `GeneratedContentLog` data
- Home screen widget component is new; plugs into existing app home route
- Analytics page restructure is reordering + adding new top sections; existing charts remain
