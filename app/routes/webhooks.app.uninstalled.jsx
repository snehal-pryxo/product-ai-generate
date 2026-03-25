import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sendUninstallEmails } from "../lib/email.server.js";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already
  // been uninstalled, so make these operations idempotent.
  try {
    // Read shop info before deleting sessions (for email)
    const shopRecord = await db.shop.findUnique({ where: { shop } });

    await db.session.deleteMany({ where: { shop } });
    await db.shop.upsert({
      where: { shop },
      update: {
        installed: false,
        accessToken: null,
        uninstalledAt: new Date(),
      },
      create: {
        shop,
        installed: false,
        uninstalledAt: new Date(),
      },
    });

    // Send uninstall notification emails (non-blocking)
    sendUninstallEmails({
      shopDomain: shop,
      shopName: shopRecord?.name,
      ownerName: shopRecord?.ownerName,
      ownerEmail: shopRecord?.email,
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
