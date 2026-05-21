/**
 * Shared Gemini tool config for outbound-email generation.
 *
 * - urlContext: lets the model actually fetch the URLs in the prompt (e.g.
 *   the recipient's website and the sender's site). Without this, "study
 *   the company's website" in the prompt is just a hallucination invitation.
 * - googleSearch: lets the model search the public web for fresh context
 *   (recent funding, hiring posts, product launches, news).
 *
 * The Gemini API accepts both together on `gemini-3-pro-preview`; the SDK's
 * TypeScript surface predates these tools, so we cast through `unknown`.
 */
import type { Tool } from '@google/generative-ai';

export function getGroundingTools(): Tool[] {
  return [
    { urlContext: {} } as unknown as Tool,
    { googleSearch: {} } as unknown as Tool,
  ];
}

/**
 * Returned by `GenerateContentResponse.candidates[0].groundingMetadata`.
 * Used for logging which URLs the model actually fetched / which searches it
 * ran — useful when debugging "why did the AI hallucinate this fact".
 */
export interface GroundingTrace {
  fetchedUrls: string[];
  searchQueries: string[];
}

export function extractGroundingTrace(response: any): GroundingTrace {
  const meta =
    response?.candidates?.[0]?.groundingMetadata ||
    response?.candidates?.[0]?.urlContextMetadata ||
    {};
  const fetchedUrls: string[] = [];
  const searchQueries: string[] = [];

  // urlContext metadata
  if (Array.isArray(meta?.urlMetadata)) {
    for (const u of meta.urlMetadata) {
      if (u?.retrievedUrl) fetchedUrls.push(u.retrievedUrl);
      else if (u?.url) fetchedUrls.push(u.url);
    }
  }
  if (Array.isArray(response?.candidates?.[0]?.urlContextMetadata?.urlMetadata)) {
    for (const u of response.candidates[0].urlContextMetadata.urlMetadata) {
      if (u?.retrievedUrl) fetchedUrls.push(u.retrievedUrl);
      else if (u?.url) fetchedUrls.push(u.url);
    }
  }

  // googleSearch metadata
  if (Array.isArray(meta?.webSearchQueries)) {
    searchQueries.push(...meta.webSearchQueries);
  }

  return {
    fetchedUrls: Array.from(new Set(fetchedUrls)),
    searchQueries: Array.from(new Set(searchQueries)),
  };
}
