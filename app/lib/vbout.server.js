// VBOUT marketing automation: merchants are synced into a VBOUT contact list
// and VBOUT automations (configured in the VBOUT dashboard) send the emails.
// Docs: https://developers.vbout.com/docs#emailmarketing_synccontact
const VBOUT_API_URL = "https://api.vbout.com/1";
const REQUEST_TIMEOUT_MS = 10000;

// App field name -> env var holding the VBOUT custom field ID for this list.
// Run `node --env-file=.env scripts/vbout-list-fields.mjs` to look the IDs up.
const FIELD_ENV_VARS = {
  firstName: "VBOUT_FIELD_FIRST_NAME",
  lastName: "VBOUT_FIELD_LAST_NAME",
  shopName: "VBOUT_FIELD_SHOP_NAME",
  shopDomain: "VBOUT_FIELD_SHOP_DOMAIN",
  phone: "VBOUT_FIELD_PHONE",
  country: "VBOUT_FIELD_COUNTRY",
  appStatus: "VBOUT_FIELD_APP_STATUS",
};

const vboutEnabled = () =>
  Boolean(process.env.VBOUT_API_KEY && process.env.VBOUT_LIST_ID);

const buildFieldParams = (fields) => {
  const params = {};
  for (const [name, value] of Object.entries(fields)) {
    const fieldId = process.env[FIELD_ENV_VARS[name]];
    if (fieldId && value != null && value !== "") {
      params[`fields[${fieldId}]`] = String(value);
    }
  }
  return params;
};

export const vboutRequest = async (path, { method = "GET", params = {} } = {}) => {
  const query = new URLSearchParams({ key: process.env.VBOUT_API_KEY || "", ...params });
  const res = await fetch(`${VBOUT_API_URL}/${path}.json?${query}`, {
    method,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => null);
  const status = body?.response?.header?.status;
  if (!res.ok || (status && String(status).toLowerCase() !== "ok")) {
    const error = new Error(`VBOUT ${path} failed: HTTP ${res.status}`);
    error.body = body;
    throw error;
  }
  return body?.response?.data ?? body;
};

// Contact tags shown in VBOUT; each status tag replaces the other.
const STATUS_TAGS = { installed: "installed", uninstalled: "uninstalled" };
const TAG_WAIT_ATTEMPTS = 10;
const TAG_WAIT_DELAY_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// synccontact is queued by VBOUT, and addtag on a contact that doesn't exist
// yet answers "Your Contact doesn't exist." with an ok status, so wait for it.
const waitForContact = async (email) => {
  for (let attempt = 0; attempt < TAG_WAIT_ATTEMPTS; attempt += 1) {
    const data = await vboutRequest("emailmarketing/getcontactbyemail", {
      params: { email },
    }).catch(() => null);
    if (Array.isArray(data?.contact) && data.contact.length > 0) return true;
    await sleep(TAG_WAIT_DELAY_MS);
  }
  return false;
};

const applyStatusTag = async (email, appStatus) => {
  const tag = STATUS_TAGS[appStatus];
  if (!tag) return;
  try {
    if (!(await waitForContact(email))) {
      console.error("[vbout] contact not found after sync; tag not applied", { email, tag });
      return;
    }
    const added = await vboutRequest("emailmarketing/addtag", {
      method: "POST",
      params: { email, "tagname[]": tag },
    });
    if (/doesn't exist/i.test(added?.item || "")) {
      console.error("[vbout] tag not applied: contact missing", { email, tag });
      return;
    }
    for (const other of Object.values(STATUS_TAGS)) {
      if (other === tag) continue;
      await vboutRequest("emailmarketing/removetag", {
        method: "POST",
        params: { email, "tagname[]": other },
      }).catch(() => null);
    }
    console.log("[vbout] status tag applied", { email, tag });
  } catch (error) {
    console.error("[vbout] tagging failed", { email, tag, error: error?.message });
  }
};

// Adds the merchant to the VBOUT list, or updates the contact if the email is
// already on it, then tags it with its app status in the background.
// Never throws: VBOUT problems must not break install/uninstall.
export const syncVboutContact = async ({ email, fields = {} }) => {
  if (!vboutEnabled()) {
    console.error("[vbout] VBOUT_API_KEY / VBOUT_LIST_ID not configured; skipping contact sync.");
    return { skipped: true };
  }
  if (!email) {
    console.warn("[vbout] Missing email; skipping contact sync.");
    return { skipped: true };
  }

  try {
    const data = await vboutRequest("emailmarketing/synccontact", {
      method: "POST",
      params: {
        email,
        listid: process.env.VBOUT_LIST_ID,
        status: "active",
        ...buildFieldParams(fields),
      },
    });
    console.log("[vbout] contact synced", { email, appStatus: fields.appStatus || null });
    // Not awaited: waiting for VBOUT's queue can take seconds and must not
    // hold up the OAuth redirect.
    applyStatusTag(email, fields.appStatus);
    return { data };
  } catch (error) {
    console.error("[vbout] contact sync failed", {
      email,
      error: error?.message,
      body: error?.body ? JSON.stringify(error.body) : undefined,
    });
    return { error: error?.message || String(error) };
  }
};
