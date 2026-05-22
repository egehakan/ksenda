import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  GEMINI_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_LINKEDIN_INITIAL_PROMPT,
} from '@/lib/constants';
import { getGroundingTools, extractGroundingTrace } from './gemini-tools';

interface EmailGenerationResult {
  success: boolean;
  subject?: string;
  body?: string;
  error?: string;
  rawResponse?: string;
}

interface LinkedInGenerationResult {
  success: boolean;
  body?: string;
  error?: string;
  rawResponse?: string;
}

interface GeneratedEmail {
  subject: string;
  email_body: string;
}

interface GeneratedLinkedInMessage {
  message: string;
}

export class MissingGeminiKeyError extends Error {
  constructor() {
    super('Gemini API key is not configured for this account');
    this.name = 'MissingGeminiKeyError';
  }
}

function parseEmailResponse(text: string): GeneratedEmail | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*"subject"[\s\S]*"email_body"[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as GeneratedEmail;

    if (!parsed.subject || !parsed.email_body) return null;
    if (typeof parsed.subject !== 'string' || typeof parsed.email_body !== 'string') return null;
    if (parsed.subject.trim() === '' || parsed.email_body.trim() === '') return null;

    return parsed;
  } catch {
    return null;
  }
}

function parseLinkedInResponse(text: string): GeneratedLinkedInMessage | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*"message"[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as GeneratedLinkedInMessage;

    if (!parsed.message) return null;
    if (typeof parsed.message !== 'string') return null;
    if (parsed.message.trim() === '') return null;

    return parsed;
  } catch {
    return null;
  }
}

interface ContactInfo {
  firstName: string;
  lastName?: string;
  title?: string;
}

export interface SenderProfile {
  companyName?: string | null;
  companyWebsite?: string | null;
  senderName?: string | null;
}

export interface GenerateEmailOptions {
  apiKey: string;
  companyName: string;
  companyDomain: string;
  customPrompt?: string;
  companyWebsite?: string;
  contact?: ContactInfo;
  sender?: SenderProfile;
  /**
   * Optional pre-computed AI-presence detection summary for the recipient.
   * When present, gets injected into the prompt context block so the model
   * can confirm "no AI yet" and pick the right operational angle (or, for
   * the AI-native stream, confirm "has AI" and use the appropriate pitch).
   * Substituted into the {{AI_DETECTION_SUMMARY}} placeholder in the prompt.
   */
  aiDetectionSummary?: string;
}

function applySenderPlaceholders(prompt: string, sender?: SenderProfile): string {
  const senderCompany = sender?.companyName?.trim() || 'our company';
  const senderWebsite = sender?.companyWebsite?.trim() || '';
  return prompt
    .replace(/\{\{SENDER_COMPANY_NAME\}\}/g, senderCompany)
    .replace(/\{\{SENDER_COMPANY_WEBSITE\}\}/g, senderWebsite || senderCompany);
}

export async function generateEmail(opts: GenerateEmailOptions): Promise<EmailGenerationResult> {
  const {
    apiKey,
    companyName,
    companyDomain,
    customPrompt,
    companyWebsite,
    contact,
    sender,
    aiDetectionSummary,
  } = opts;

  if (!apiKey) {
    return { success: false, error: 'Gemini API key is not configured for this account' };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      // Grounding: urlContext lets the model fetch URLs we hand it,
      // googleSearch lets it find fresh signals (recent funding, hiring,
      // product launches). Both are wired so Series-A startups the model
      // has never seen still get real-world context, not hallucination.
      tools: getGroundingTools(),
    });

    const basePrompt = customPrompt || DEFAULT_SYSTEM_PROMPT;
    // Substitute the optional AI-detection summary placeholder. Empty string
    // when no detection has run, which the prompts already handle ("can be
    // empty").
    const promptWithAi = basePrompt.replace(
      /\{\{AI_DETECTION_SUMMARY\}\}/g,
      aiDetectionSummary?.trim() || '(AI-presence detection has not been run for this company.)'
    );
    const prompt = applySenderPlaceholders(promptWithAi, sender);

    const websiteUrl = companyWebsite || `https://${companyDomain}`;

    const contactInfo = contact
      ? `CONTACT_FIRST_NAME: ${contact.firstName}
CONTACT_LAST_NAME: ${contact.lastName || ''}
CONTACT_TITLE: ${contact.title || ''}`
      : '';

    const senderBlock = sender
      ? `\nSENDER_COMPANY_NAME: ${sender.companyName || ''}\nSENDER_COMPANY_WEBSITE: ${sender.companyWebsite || ''}\nSENDER_NAME: ${sender.senderName || ''}\n`
      : '';

    const fullPrompt = `${prompt}

---

Input you will receive:
COMPANY_WEBSITE_URL: ${websiteUrl}
COMPANY_NAME: ${companyName}
${contactInfo}${senderBlock}

TOOLS AVAILABLE
You have two live tools: url-context (fetch the URLs above) and google-search
(query the web). You MUST use them before writing. Do not rely on training
data alone, especially for Series-A and growth-stage companies the training
data does not cover.

REQUIRED RESEARCH BEFORE WRITING, use the tools generously and with NO artificial cap
You may call url-context and google-search as many times as the research needs.
More grounding beats less. Do NOT stop after a single search.
1. Fetch COMPANY_WEBSITE_URL with url-context, and follow through to the pages
   that matter: homepage, product / features / services page, "About",
   "Customers" or case studies, and the careers page if linked. Fetch as many
   of their pages as you need (url-context allows up to 20 URLs per run).
   Capture what they build, who their users are, named features, and any
   observable signal (repetitive hiring, expansion, a process bottleneck).
2. Fetch SENDER_COMPANY_WEBSITE with url-context so you accurately
   represent the sender, pull one real case study or proof point.
3. Run MULTIPLE google-search queries, not just one:
   (a) "${companyName}" recent news, press, funding, or launches (2025..2026);
   (b) "${companyName}" hiring or open roles;
   (c) one or more searches for the competitor or same-industry AI numbers your
       prompt asks you to cite, e.g. "[their industry] firms AI results 2025 2026"
       or "[a named competitor] AI [workflow]". Keep searching until you have a
       real, citable figure or have confirmed none exists.
4. Fetch any promising URL a search surfaces (a vendor case study, an analyst
   page, a competitor announcement) with url-context to confirm a number before
   you cite it.
5. Only after the research actually returns something you can cite, write the
   email per the structure above.

HONESTY RULE
Do not invent product names, features, customer logos, or metrics. If a
fact would be specific enough that being wrong would embarrass the
sender, leave it out unless the tool confirmed it.

${contact ? `IMPORTANT: Replace {{CONTACT_FIRST_NAME}} with the actual first name: "${contact.firstName}". Do NOT leave {{CONTACT_FIRST_NAME}} as a placeholder in the email body.` : ''}`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    // Log grounding trace so the user can see (in dev) which URLs were
    // actually fetched and what was searched. Surfaces hallucinations
    // immediately when no tools were used.
    const trace = extractGroundingTrace(response);
    if (trace.fetchedUrls.length || trace.searchQueries.length) {
      console.log(
        `[Gemini] Grounding · fetched ${trace.fetchedUrls.length} URL(s), ` +
          `ran ${trace.searchQueries.length} search(es). ` +
          `Fetched: ${trace.fetchedUrls.join(', ') || '(none)'}. ` +
          `Searches: ${trace.searchQueries.join(' | ') || '(none)'}`
      );
    } else {
      console.warn(
        '[Gemini] No grounding metadata returned. Model may not have invoked tools.'
      );
    }

    const parsed = parseEmailResponse(text);

    if (!parsed) {
      return {
        success: false,
        error: 'Failed to parse email from AI response',
        rawResponse: text,
      };
    }

    let finalBody = parsed.email_body;
    if (contact?.firstName) {
      finalBody = finalBody.replace(/\{\{CONTACT_FIRST_NAME\}\}/g, contact.firstName);
      finalBody = finalBody.replace(/\{\{CONTACT_LAST_NAME\}\}/g, contact.lastName || '');
    }
    if (sender?.senderName) {
      finalBody = finalBody.replace(/\{\{SENDER_NAME\}\}/g, sender.senderName);
    }

    return {
      success: true,
      subject: parsed.subject,
      body: finalBody,
      rawResponse: text,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: errorMessage };
  }
}

export async function generateEmailWithRetry(
  opts: GenerateEmailOptions,
  maxRetries: number = 2
): Promise<EmailGenerationResult> {
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await generateEmail(opts);
    if (result.success) return result;

    lastError = result.error;

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }

  return {
    success: false,
    error: `Failed after ${maxRetries + 1} attempts. Last error: ${lastError}`,
  };
}

// =============================================================================
// LinkedIn channel: generate a short DM-style message (no subject).
// Mirrors generateEmail() in structure but with a `message`-only output shape.
// =============================================================================

export async function generateLinkedInMessage(
  opts: GenerateEmailOptions
): Promise<LinkedInGenerationResult> {
  const {
    apiKey,
    companyName,
    companyDomain,
    customPrompt,
    companyWebsite,
    contact,
    sender,
    aiDetectionSummary,
  } = opts;

  if (!apiKey) {
    return { success: false, error: 'Gemini API key is not configured for this account' };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      tools: getGroundingTools(),
    });

    const basePrompt = customPrompt || DEFAULT_LINKEDIN_INITIAL_PROMPT;
    const promptWithAi = basePrompt.replace(
      /\{\{AI_DETECTION_SUMMARY\}\}/g,
      aiDetectionSummary?.trim() || '(AI-presence detection has not been run for this company.)'
    );
    const prompt = applySenderPlaceholders(promptWithAi, sender);

    const websiteUrl = companyWebsite || `https://${companyDomain}`;

    const contactInfo = contact
      ? `CONTACT_FIRST_NAME: ${contact.firstName}
CONTACT_LAST_NAME: ${contact.lastName || ''}
CONTACT_TITLE: ${contact.title || ''}`
      : '';

    const senderBlock = sender
      ? `\nSENDER_COMPANY_NAME: ${sender.companyName || ''}\nSENDER_COMPANY_WEBSITE: ${sender.companyWebsite || ''}\nSENDER_NAME: ${sender.senderName || ''}\n`
      : '';

    const fullPrompt = `${prompt}

---

Input you will receive:
COMPANY_WEBSITE_URL: ${websiteUrl}
COMPANY_NAME: ${companyName}
${contactInfo}${senderBlock}

CHANNEL REMINDER
You are writing a LinkedIn DM, not an email. The output JSON must contain ONLY a "message" field; there is no separate subject field, so format the message exactly as your prompt specifies (including any subject line, greeting, and sign-off it asks for). Do not include any links in the first message.

REQUIRED RESEARCH BEFORE WRITING, use the tools generously and with NO artificial cap
You may call url-context and google-search as many times as the research needs. Do NOT stop after a single search.
1. Fetch COMPANY_WEBSITE_URL with url-context, plus their product / services and careers pages if linked. Capture named features and one observable signal. Fetch as many of their pages as you need (up to 20 URLs per run).
2. Fetch SENDER_COMPANY_WEBSITE with url-context so you represent the sender accurately.
3. Run MULTIPLE google-search queries, not just one: (a) "${companyName}" recent news, press, funding, or launches (2025..2026); (b) "${companyName}" hiring; (c) one or more searches for the competitor or same-industry AI numbers your prompt asks you to cite. Keep searching until you have a real, citable figure or have confirmed none exists.
4. Fetch any promising URL a search surfaces with url-context to confirm a number before citing it.

HONESTY RULE
Do not invent product names, features, customer logos, or metrics. If a fact would embarrass the sender if wrong, leave it out unless the tool confirmed it.

${contact ? `IMPORTANT: Replace {{CONTACT_FIRST_NAME}} with the actual first name: "${contact.firstName}". Do NOT leave {{CONTACT_FIRST_NAME}} as a placeholder.` : ''}`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    const trace = extractGroundingTrace(response);
    if (trace.fetchedUrls.length || trace.searchQueries.length) {
      console.log(
        `[Gemini · LinkedIn] Grounding · fetched ${trace.fetchedUrls.length} URL(s), ` +
          `ran ${trace.searchQueries.length} search(es). ` +
          `Fetched: ${trace.fetchedUrls.join(', ') || '(none)'}. ` +
          `Searches: ${trace.searchQueries.join(' | ') || '(none)'}`
      );
    } else {
      console.warn(
        '[Gemini · LinkedIn] No grounding metadata returned. Model may not have invoked tools.'
      );
    }

    const parsed = parseLinkedInResponse(text);

    if (!parsed) {
      return {
        success: false,
        error: 'Failed to parse LinkedIn message from AI response',
        rawResponse: text,
      };
    }

    let finalBody = parsed.message;
    if (contact?.firstName) {
      finalBody = finalBody.replace(/\{\{CONTACT_FIRST_NAME\}\}/g, contact.firstName);
      finalBody = finalBody.replace(/\{\{CONTACT_LAST_NAME\}\}/g, contact.lastName || '');
    }
    if (sender?.senderName) {
      finalBody = finalBody.replace(/\{\{SENDER_NAME\}\}/g, sender.senderName);
    }

    return {
      success: true,
      body: finalBody,
      rawResponse: text,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, error: errorMessage };
  }
}

export async function generateLinkedInMessageWithRetry(
  opts: GenerateEmailOptions,
  maxRetries: number = 2
): Promise<LinkedInGenerationResult> {
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await generateLinkedInMessage(opts);
    if (result.success) return result;

    lastError = result.error;

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }

  return {
    success: false,
    error: `Failed after ${maxRetries + 1} attempts. Last error: ${lastError}`,
  };
}

export function validateEmailContent(subject: string, body: string): {
  isValid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (subject.length < 10) issues.push('Subject is too short (minimum 10 characters)');
  if (subject.length > 100) issues.push('Subject is too long (maximum 100 characters)');

  if (body.length < 100) issues.push('Email body is too short (minimum 100 characters)');
  if (body.length > 2000) issues.push('Email body is too long (maximum 2000 characters)');

  const spamTriggers = [
    'click here',
    'act now',
    'limited time',
    'free offer',
    'guaranteed',
    '100%',
    'urgent',
    '!!!',
  ];

  const lowerBody = body.toLowerCase();
  for (const trigger of spamTriggers) {
    if (lowerBody.includes(trigger)) {
      issues.push(`Contains potential spam trigger: "${trigger}"`);
    }
  }

  return { isValid: issues.length === 0, issues };
}
