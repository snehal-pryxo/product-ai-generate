import { serve } from "inngest/remix";
import { inngest } from "../inngest/client";
import { bulkGenerateFunction } from "../inngest/bulkGenerate";

const handler = serve({
  client: inngest,
  functions: [bulkGenerateFunction],
});

export async function loader({ request }) {
  return handler(request);
}

export async function action({ request }) {
  return handler(request);
}
