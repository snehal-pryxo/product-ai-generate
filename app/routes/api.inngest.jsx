import { serve } from "inngest/remix";
import { inngest } from "../inngest/client";
import { bulkGenerateFunction } from "../inngest/bulkGenerate";

const handler = serve({
  client: inngest,
  functions: [bulkGenerateFunction],
});

export const { loader, action } = handler;
