/**
 * Automatically adds the faq-section app block inside a top-level Apps section
 * in templates/product.json so the FAQ accordion appears on product pages
 * without any merchant action in the theme editor.
 *
 * Non-blocking — errors are logged but never propagated.
 */
export async function autoAddFaqSectionToProductPage(shop, accessToken) {
  try {
    const appHandle = process.env.SHOPIFY_APP_HANDLE || "content-ai-seo-generator";
    const extensionUid =
      process.env.SHOPIFY_AI_VISIBILITY_EMBED_ID ||
      process.env.SHOPIFY_THEME_EXTENSION_ID ||
      process.env.SHOPIFY_EXTENSION_UID ||
      "5f1c6526-37cb-a9c5-8f62-3e56faaa857bf8e951ec";
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
    const FAQ_TYPE = `shopify://apps/${appHandle}/blocks/faq-section/${extensionUid}`;

    // 3. Already present? Return early.
    const alreadyAdded = Object.values(sections).some((section) => {
      if (String(section?.type || "").includes("faq-section")) return true;
      return Object.values(section?.blocks || {}).some((block) =>
        String(block?.type || "").includes("/blocks/faq-section/"),
      );
    });
    if (alreadyAdded) {
      return { ok: true, alreadyAdded: true };
    }

    // 4. Append the faq-section as a top-level app block wrapped by an Apps section.
    const now = Date.now();
    const sectionId = `cai-faq-apps-${now}`;
    const blockId = `cai-faq-${now}`;
    template.sections = {
      ...sections,
      [sectionId]: {
        type: "apps",
        blocks: {
          [blockId]: {
            type: FAQ_TYPE,
            settings: {},
          },
        },
        block_order: [blockId],
        settings: {},
      },
    };
    template.order = [...order, sectionId];

    // 5. Write back
    const writeResp = await fetch(`${apiBase}/themes/${themeId}/assets.json`, {
      method: "PUT",
      headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        asset: { key: "templates/product.json", value: JSON.stringify(template, null, 2) },
      }),
    });
    if (!writeResp.ok) {
      const errText = await writeResp.text().catch(() => "");
      let errBody = {};
      try {
        errBody = errText ? JSON.parse(errText) : {};
      } catch {
        errBody = errText ? { errors: errText } : {};
      }
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
