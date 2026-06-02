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

    const FAQ_TYPE = `shopify://apps/${appHandle}/blocks/faq-section/${extensionUid}`;

    // 2. Try product.json, then product.default.json as fallback (some themes use the latter)
    const TEMPLATE_KEYS = ["templates/product.json", "templates/product.default.json"];
    let assetKey = null;
    let template = null;

    for (const key of TEMPLATE_KEYS) {
      const assetResp = await fetch(
        `${apiBase}/themes/${themeId}/assets.json?asset[key]=${key}`,
        { headers: { "X-Shopify-Access-Token": accessToken } }
      );
      if (!assetResp.ok) continue;
      const rawContent = (await assetResp.json())?.asset?.value;
      if (!rawContent) continue;
      try {
        template = JSON.parse(rawContent);
        assetKey = key;
        break;
      } catch {
        continue;
      }
    }

    if (!template || !assetKey) {
      return { ok: false, needsManualAdd: true, error: "Could not read product template. The theme may use an unsupported format." };
    }

    const sections = template?.sections || {};
    const order    = Array.isArray(template?.order) ? [...template.order] : [];

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
        asset: { key: assetKey, value: JSON.stringify(template, null, 2) },
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
        return { ok: false, needsManualAdd: true, error: "Permission denied updating the theme. Please reinstall the app with theme permissions, or add the block manually via the theme editor." };
      }
      const msg = errBody?.errors ? JSON.stringify(errBody.errors) : `HTTP ${writeResp.status}`;
      return { ok: false, needsManualAdd: true};
    }

    return { ok: true, alreadyAdded: false };
  } catch (err) {
    console.error("[autoAddFaqSection]", err);
    return { ok: false, needsManualAdd: true, error: err?.message || "Failed to add FAQ section." };
  }
}
