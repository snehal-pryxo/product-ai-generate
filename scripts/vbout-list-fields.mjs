// Usage: node --env-file=.env scripts/vbout-list-fields.mjs
import { vboutRequest } from "../app/lib/vbout.server.js";

const listId = process.env.VBOUT_LIST_ID;
if (!process.env.VBOUT_API_KEY || !listId) {
  console.error("Set VBOUT_API_KEY and VBOUT_LIST_ID first.");
  process.exit(1);
}
try {
  const data = await vboutRequest("emailmarketing/getlist", { params: { id: listId } });
  const list = data?.list ?? data;
  console.log(`List: ${list?.name ?? "?"} (${listId})`);
  const fields = list?.fields;
  if (fields && typeof fields === "object") {
    console.log("\nCustom fields (ID -> name):");
    for (const [id, name] of Object.entries(fields)) {
      console.log(`  ${id}\t${typeof name === "object" ? JSON.stringify(name) : name}`);
    }
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
} catch (error) {
  console.error(error.message);
  if (error.body) console.error(JSON.stringify(error.body, null, 2));
  process.exitCode = 1;
}
