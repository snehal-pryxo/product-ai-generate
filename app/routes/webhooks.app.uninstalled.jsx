import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sendUninstallEmails } from "../lib/email.server.js";
import {
  buildUninstallFeedbackUrl,
  createOrReuseUninstallFeedback,
} from "../lib/uninstallFeedback.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already
  // been uninstalled, so make these operations idempotent.
  try {
    // Read shop info before deleting sessions (for email)
    const shopRecord = await db.shop.findUnique({ where: { shop } });
    const uninstalledAt = new Date();

    let feedbackUrl = "";
    try {
      const feedbackRecord = await createOrReuseUninstallFeedback({
        shop,
        ownerName: shopRecord?.ownerName,
        email: shopRecord?.email,
        contactEmail: shopRecord?.contactEmail,
        uninstalledAt,
      });
      feedbackUrl = buildUninstallFeedbackUrl(feedbackRecord?.feedbackToken);
    } catch (error) {
      console.error(`Failed to create uninstall feedback row for shop ${shop}`, error);
    }

    await db.session.deleteMany({ where: { shop } });
    await db.shop.upsert({
      where: { shop },
      update: {
        installed: false,
        accessToken: null,
        uninstalledAt,
      },
      create: {
        shop,
        installed: false,
        uninstalledAt,
      },
    });

    // Send uninstall notification emails (non-blocking)
    sendUninstallEmails({
      shopDomain: shop,
      shopName: shopRecord?.name,
      ownerName: shopRecord?.ownerName,
      ownerEmail: shopRecord?.email,
      contactEmail: shopRecord?.contactEmail,
      feedbackUrl,
    }).catch((err) =>
      console.error(`[email] Uninstall email failed for ${shop}:`, err)
    );
  } catch (error) {
    console.error(`Failed to sync uninstall state for shop ${shop}`, error);
  }

  if (!session) {
    console.log(`No active session found for ${shop} during uninstall webhook`);
  }

  return new Response();
};
