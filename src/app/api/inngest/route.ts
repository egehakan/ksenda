import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/inngest/functions";

/**
 * Inngest webhook endpoint. Inngest's infrastructure calls this URL to
 * invoke functions; each step.run() inside a function is its own POST
 * to this handler. The handler is public (Inngest signs requests with
 * INNGEST_SIGNING_KEY in production — middleware allows this path).
 *
 * Local dev: `npx inngest-cli@latest dev` auto-discovers this endpoint
 * at http://localhost:3000/api/inngest.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});

// Allow long-running step invocations to use the full Vercel envelope.
// Each step is its own invocation; the SDK never holds a request open
// across step boundaries, so this is the per-step ceiling.
export const maxDuration = 300;
