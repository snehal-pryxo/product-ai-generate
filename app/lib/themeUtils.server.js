/**
 * Automatically adds the faq-section app block as a standalone section
 * in templates/product.json so the FAQ accordion appears on product pages
 * without any merchant action in the theme editor.
 *
 * Non-blocking — errors are logged but never propagated.
 */
export async function autoAddFaqSectionToProductPage(shop, accessToken) {
  try {
    const appHandle = process.env.SHOPIFY_APP_HANDLE || "content-ai-seo-generator";
    const apiBase  = `https://${shop}/admin/api/2025-10`;

    // 1. Active theme id
    const themesResp = await fetch(`${apiBase}/themes.json?role=main`, {
      headers: { "X-Shopify-Access-Token": accessToken },
    });
    if (!themesResp.ok) throw new Error(`themes.json failed (${themesResp.status})`);
    const themeId = (await themesResp.json())?.themes?.[0]?.id;
    if (!themeId) throw new Error("No active theme found.");

    // 2. Read templates/product.json
    const assetResp = await fetch(
      `${apiBase}/themes/${themeId}/assets.json?asset[key]=templates/product.json`,
      { headers: { "X-Shopify-Access-Token": accessToken } }
    );
    if (!assetResp.ok) throw new Error(`product.json read failed (${assetResp.status})`);
    const rawContent = (await assetResp.json())?.asset?.value || "{}";
    let template;
    try { template = JSON.parse(rawContent); } catch { throw new Error("Failed to parse templates/product.json"); }

    const sections = template?.sections || {};
    const order    = Array.isArray(template?.order) ? [...template.order] : [];
    const FAQ_TYPE = `shopify://apps/${appHandle}/blocks/faq-section`;

    // 3. Already present? Return early.
    const alreadyAdded = Object.values(sections).some(
      (s) => String(s?.type || "").includes("faq-section")
    );
    if (alreadyAdded) {
      return { ok: true, alreadyAdded: true };
    }

    // 4. Append the faq-section as a standalone section at the bottom
    const uid = `cai-faq-${Date.now()}`;
    template.sections = {
      ...sections,
      [uid]: { type: FAQ_TYPE, disabled: false, settings: {}, blocks: {}, block_order: [] },
    };
    template.order = [...order, uid];

    // 5. Write back
    const writeResp = await fetch(`${apiBase}/themes/${themeId}/assets.json`, {
      method: "PUT",
      headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        asset: { key: "templates/product.json", value: JSON.stringify(template, null, 2) },
      }),
    });
    if (!writeResp.ok) {
      const errBody = await writeResp.json().catch(() => ({}));
      if (writeResp.status === 403) {
        throw new Error("Permission denied. The app needs write_themes scope. Please reinstall the app.");
      }
      const msg = errBody?.errors ? JSON.stringify(errBody.errors) : `HTTP ${writeResp.status}`;
      throw new Error(`Failed to update product template: ${msg}`);
    }

    return { ok: true, alreadyAdded: false };
  } catch (err) {
    console.error("[autoAddFaqSection]", err);
    return { ok: false, error: err?.message || "Failed to add FAQ section." };
  }
}
