import { APOLLO_API_BASE_URL } from '@/lib/constants';
import prisma from '@/lib/prisma';

export interface ApolloFilters {
  locations?: string[];
  employeeCountMin?: number;
  employeeCountMax?: number;
  industries?: string[];
  keywords?: string[];
  /**
   * Hiring signal — companies with at least one active job posting matching any
   * of these titles. Maps to Apollo's q_organization_job_titles[].
   */
  jobTitles?: string[];
  /**
   * Tech-stack fit signal — Apollo UIDs (lowercase, underscores, no spaces).
   * Maps to currently_using_any_of_technology_uids[]. Common AI UIDs:
   *   openai, anthropic, langchain, llama_index, pinecone, weaviate, qdrant,
   *   chroma, hugging_face, replicate, modal_com, ray, mlflow, vercel,
   *   aws_lambda, snowflake, databricks.
   */
  technologies?: string[];
  /** YYYY-MM-DD — earliest acceptable date of most-recent funding round. */
  fundingDateMin?: string;
  /** YYYY-MM-DD — latest acceptable date of most-recent funding round. */
  fundingDateMax?: string;
  /** USD, no commas — minimum size of most-recent funding round. */
  fundingAmountMin?: number;
  /** USD, no commas — maximum size of most-recent funding round. */
  fundingAmountMax?: number;
}

export interface ApolloPeopleFilters {
  /**
   * Restrict to people inside this set of Apollo organization IDs. Used by the
   * /api/people/search org-gate path so we can apply funding/hiring filters
   * up-front (Apollo's people endpoint doesn't take funding filters directly).
   */
  organizationIds?: string[];
  /** Job titles to match against (similar-title expansion is on by default). */
  titles?: string[];
  /**
   * Seniority buckets. Apollo accepts: owner, founder, c_suite, partner,
   * vp, head, director, manager, senior, entry, intern.
   */
  seniorities?: string[];
  /** Person current-employer HQ locations (cities/states/countries). */
  organizationLocations?: string[];
  /** Person's own location. */
  personLocations?: string[];
  /** Org headcount band — passed as "min,max". */
  employeeCountMin?: number;
  employeeCountMax?: number;
  /** Free-text keyword over results (matches title / org / domain). */
  keywords?: string[];
  /** Org-side keyword tags (industry/sector). */
  industries?: string[];
  /** Tech-stack UIDs the current employer uses. */
  technologies?: string[];
  /** If false, exact-match titles only. Defaults to true. */
  includeSimilarTitles?: boolean;
  /**
   * Email status filter: verified, unverified, likely to engage, unavailable.
   * Defaults to omitted (all statuses).
   */
  contactEmailStatus?: string[];
}

export interface ApolloCompany {
  id: string;
  organization_id?: string;
  name: string;
  domain?: string;
  primary_domain?: string;
  website_url?: string;
  industry?: string;
  city?: string;
  state?: string;
  country?: string;
  employee_count?: number;
}

export interface ApolloPerson {
  id: string;
  first_name?: string;
  last_name?: string;
  last_name_obfuscated?: string;
  email?: string;
  title?: string;
  organization_id?: string;
  has_email?: boolean;
  seniority?: string;
  linkedin_url?: string;
  organization?: {
    id?: string;
    name?: string;
    primary_domain?: string;
    domain?: string;
    website_url?: string;
    industry?: string;
    city?: string;
    state?: string;
    country?: string;
    employee_count?: number;
    organization_headcount?: number;
  };
}

interface ApolloSearchResponse {
  accounts?: ApolloCompany[];
  people?: ApolloPerson[];
  organizations?: ApolloCompany[];
  pagination?: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
  // The /mixed_people/api_search endpoint omits the pagination object and
  // puts total_entries at the response root instead. We synthesize a
  // pagination object from this so the frontend renders results.
  total_entries?: number;
}

interface ApolloMatchResponse {
  person?: ApolloPerson;
}

export class MissingApolloKeyError extends Error {
  constructor() {
    super('Apollo API key is not configured for this account');
    this.name = 'MissingApolloKeyError';
  }
}

async function apolloRequest<T>(
  apiKey: string,
  endpoint: string,
  body: Record<string, unknown>,
  queryParams?: Record<string, string | string[]>
): Promise<T> {
  if (!apiKey) {
    throw new MissingApolloKeyError();
  }

  let url = `${APOLLO_API_BASE_URL}${endpoint}`;
  if (queryParams) {
    const urlParams = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      if (Array.isArray(value)) {
        value.forEach((v) => urlParams.append(key, String(v)));
      } else {
        urlParams.append(key, String(value));
      }
    }
    const queryString = urlParams.toString();
    if (queryString) url += `?${queryString}`;
  }

  console.log(`[Apollo] Request to ${endpoint}:`, {
    url,
    queryParams: queryParams || {},
    body: {
      ...body,
      person_titles:
        body.person_titles && Array.isArray(body.person_titles)
          ? `${body.person_titles.length} titles (${body.person_titles.slice(0, 3).join(', ')}...)`
          : body.person_titles,
    },
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      'Cache-Control': 'no-cache',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Apollo] API error ${response.status}:`, errorText);
    throw new Error(`Apollo API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  // Verbose dump of the full Apollo response only when debugging — it's
  // megabytes per page and floods logs / test output otherwise.
  if (process.env.APOLLO_DEBUG === '1') {
    console.log(`[Apollo] Response from ${endpoint}:`, JSON.stringify(data, null, 2));
  } else {
    const counts: Record<string, number> = {};
    for (const key of ['accounts', 'organizations', 'people']) {
      const arr = (data as Record<string, unknown>)[key];
      if (Array.isArray(arr)) counts[key] = arr.length;
    }
    console.log(
      `[Apollo] ${endpoint} → ${JSON.stringify(counts)}${
        (data as Record<string, unknown>).pagination
          ? ` page=${(data as any).pagination.page}/${(data as any).pagination.total_pages}`
          : ''
      }`
    );
  }
  return data;
}

export async function searchCompanies(
  apiKey: string,
  filters: ApolloFilters,
  page: number = 1,
  perPage: number = 50
): Promise<{ companies: ApolloCompany[]; pagination: ApolloSearchResponse['pagination'] }> {
  const body: Record<string, unknown> = {};
  const queryParams: Record<string, string | string[]> = {
    page: String(page),
    per_page: String(perPage),
  };

  if (filters.locations?.length) {
    queryParams['organization_locations[]'] = filters.locations;
  }

  if (filters.employeeCountMin !== undefined || filters.employeeCountMax !== undefined) {
    const min = filters.employeeCountMin || 0;
    const max = filters.employeeCountMax || 10000;
    queryParams['organization_num_employees_ranges[]'] = `${min},${max}`;
  }

  if (filters.keywords?.length) {
    queryParams['q_organization_keyword_tags[]'] = filters.keywords;
  }

  if (filters.industries?.length) {
    if (!filters.keywords?.length) {
      queryParams['q_organization_keyword_tags[]'] = filters.industries;
    } else {
      queryParams['q_organization_keyword_tags[]'] = [
        ...(filters.keywords || []),
        ...filters.industries,
      ];
    }
  }

  // Hiring signal — companies actively posting these roles. The plan calls
  // this out as a budget proxy: "hiring posts (signals budget)".
  if (filters.jobTitles?.length) {
    queryParams['q_organization_job_titles[]'] = filters.jobTitles;
  }

  // Tech-stack fit. Apollo expects UIDs (lowercase, underscores).
  if (filters.technologies?.length) {
    queryParams['currently_using_any_of_technology_uids[]'] = filters.technologies;
  }

  // Funding-stage proxies. Series A/B is best captured by combining a recent
  // funding date with an amount range; both halves are optional.
  if (filters.fundingDateMin) {
    queryParams['latest_funding_date_range[min]'] = filters.fundingDateMin;
  }
  if (filters.fundingDateMax) {
    queryParams['latest_funding_date_range[max]'] = filters.fundingDateMax;
  }
  if (filters.fundingAmountMin !== undefined) {
    queryParams['latest_funding_amount_range[min]'] = String(filters.fundingAmountMin);
  }
  if (filters.fundingAmountMax !== undefined) {
    queryParams['latest_funding_amount_range[max]'] = String(filters.fundingAmountMax);
  }

  const response = await apolloRequest<ApolloSearchResponse>(
    apiKey,
    '/mixed_companies/search',
    body,
    Object.keys(queryParams).length > 0 ? queryParams : undefined
  );

  const accounts = response.accounts || [];
  const organizations = response.organizations || [];
  const allCompanies = [...accounts, ...organizations] as any[];

  const mappedCompanies: ApolloCompany[] = allCompanies.map((c: any) => ({
    id: c.id,
    organization_id: c.organization_id || c.id,
    name: c.name,
    domain: c.primary_domain || c.domain || undefined,
    primary_domain: c.primary_domain || undefined,
    website_url: c.website_url || undefined,
    industry: c.industry || undefined,
    city: c.city || undefined,
    state: c.state || undefined,
    country: c.country || undefined,
    employee_count: c.employee_count || c.organization_headcount || undefined,
  }));

  const uniqueCompanies = Array.from(
    new Map(mappedCompanies.map((c) => [c.id, c])).values()
  );

  return { companies: uniqueCompanies, pagination: response.pagination };
}

/**
 * Get target titles for a specific user. Throws if the user has none configured.
 */
async function getTargetTitlesForUser(userId: string): Promise<string[]> {
  const titles = await prisma.targetTitle.findMany({
    where: { userId, isActive: true },
    orderBy: { priority: 'asc' },
  });

  if (!titles || titles.length === 0) {
    throw new Error('No active target titles found for this account. Please add titles in Settings.');
  }

  return titles.map((t) => t.title);
}

export async function findPeopleByTitle(
  apiKey: string,
  organizationId: string,
  userId: string,
  titles?: string[]
): Promise<ApolloPerson[]> {
  if (!organizationId) {
    throw new Error('organizationId is required for finding people by title');
  }

  const targetTitles = titles || (await getTargetTitlesForUser(userId));

  const body: Record<string, unknown> = {};
  const queryParams: Record<string, string | string[]> = {
    'organization_ids[]': [organizationId],
    page: '1',
    per_page: '100',
    include_similar_titles: 'true',
  };

  if (targetTitles.length > 0) {
    queryParams['person_titles[]'] = [...targetTitles];
  }

  console.log('[Apollo] Query params:', queryParams);

  const response = await apolloRequest<ApolloSearchResponse>(
    apiKey,
    '/mixed_people/api_search',
    body,
    queryParams
  );
  const people = response.people || [];

  return people.map((p: any) => ({
    id: p.id,
    first_name: p.first_name || undefined,
    last_name: p.last_name || undefined,
    last_name_obfuscated: p.last_name_obfuscated || undefined,
    email: p.email || undefined,
    title: p.title || undefined,
    organization_id: p.organization?.id || p.organization_id || undefined,
    has_email: p.has_email || false,
    // Preserved so the LinkedIn-channel import path can route on it.
    // Apollo's masked search-stub returns linkedin_url inconsistently across
    // tiers; when it's missing here, findBestContact backfills it via
    // /people/match (enrichPerson), which always returns the full profile.
    linkedin_url: p.linkedin_url || undefined,
    seniority: p.seniority || undefined,
    organization: p.organization || undefined,
  }));
}

/**
 * Direct person search. Hits Apollo's /mixed_people/api_search endpoint with
 * person-side AND org-side filters. Use this when you want to find a
 * decision-maker first and the company second — the inverse of the
 * company-first flow used by searchCompanies + findBestContact.
 */
export async function searchPeople(
  apiKey: string,
  filters: ApolloPeopleFilters,
  page: number = 1,
  perPage: number = 50
): Promise<{ people: ApolloPerson[]; pagination: ApolloSearchResponse['pagination'] }> {
  const body: Record<string, unknown> = {};
  const queryParams: Record<string, string | string[]> = {
    page: String(page),
    per_page: String(perPage),
    include_similar_titles: String(filters.includeSimilarTitles ?? true),
  };

  if (filters.organizationIds?.length) {
    queryParams['organization_ids[]'] = filters.organizationIds;
  }
  if (filters.titles?.length) {
    queryParams['person_titles[]'] = filters.titles;
  }
  if (filters.seniorities?.length) {
    queryParams['person_seniorities[]'] = filters.seniorities;
  }
  if (filters.organizationLocations?.length) {
    queryParams['organization_locations[]'] = filters.organizationLocations;
  }
  if (filters.personLocations?.length) {
    queryParams['person_locations[]'] = filters.personLocations;
  }
  if (filters.employeeCountMin !== undefined || filters.employeeCountMax !== undefined) {
    const min = filters.employeeCountMin || 0;
    const max = filters.employeeCountMax || 10000;
    queryParams['organization_num_employees_ranges[]'] = `${min},${max}`;
  }
  if (filters.keywords?.length) {
    queryParams['q_keywords'] = filters.keywords.join(' ');
  }
  if (filters.industries?.length) {
    queryParams['q_organization_keyword_tags[]'] = filters.industries;
  }
  if (filters.technologies?.length) {
    queryParams['currently_using_any_of_technology_uids[]'] = filters.technologies;
  }
  if (filters.contactEmailStatus?.length) {
    queryParams['contact_email_status[]'] = filters.contactEmailStatus;
  }

  const response = await apolloRequest<ApolloSearchResponse>(
    apiKey,
    '/mixed_people/api_search',
    body,
    queryParams
  );

  const people = response.people || [];
  // Apollo's people search is masked by design across all plans —
  // `last_name_obfuscated` and missing `email` / `organization.domain` are
  // the documented preview shape. Real data comes from the enrichment
  // endpoint (/people/match, /people/bulk_match). See the bulkMatchPeople
  // helper below.

  // Apollo's /mixed_people/api_search response doesn't include a pagination
  // object — only total_entries at the root. Synthesize one from total_entries
  // + the page/per_page we requested, so consumers can treat companies-search
  // and people-search responses uniformly.
  const totalEntries =
    response.pagination?.total_entries ??
    response.total_entries ??
    people.length;
  const synthesizedPagination = response.pagination ?? {
    page,
    per_page: perPage,
    total_entries: totalEntries,
    total_pages: Math.max(1, Math.ceil(totalEntries / Math.max(1, perPage))),
  };

  return {
    people: people.map((p: any) => ({
      id: p.id,
      first_name: p.first_name || undefined,
      last_name: p.last_name || undefined,
      last_name_obfuscated: p.last_name_obfuscated || undefined,
      email: p.email || undefined,
      title: p.title || undefined,
      organization_id: p.organization?.id || p.organization_id || undefined,
      has_email: p.has_email || false,
      seniority: p.seniority || undefined,
      linkedin_url: p.linkedin_url || undefined,
      organization: p.organization || undefined,
    })),
    pagination: synthesizedPagination,
  };
}

export async function enrichPerson(apiKey: string, personId: string): Promise<ApolloPerson | null> {
  if (!personId) {
    throw new Error('personId is required for enriching person');
  }

  const body: Record<string, unknown> = {
    person_id: personId,
    reveal_personal_emails: false,
    reveal_phone_number: false,
  };

  const response = await apolloRequest<ApolloMatchResponse>(apiKey, '/people/match', body);
  return response.person || null;
}

/**
 * Apollo bulk people enrichment — POST /people/bulk_match.
 *
 *   - Up to 10 IDs per call (Apollo's hard limit).
 *   - Returns full data for each: real `last_name`, `email`,
 *     `organization.primary_domain`, etc. Costs 1 credit per match.
 *   - We chunk + parallel up to 5 concurrent batches to keep latency
 *     down without hammering Apollo's rate limit.
 *   - `reveal_personal_emails: false` keeps the call to work emails only
 *     (free of Apollo's personal-email credit pool). Flip to true if you
 *     also want personal emails — that consumes more credits.
 *
 * Returns an array aligned by input order. Failed/unmatched IDs come
 * back as null at their slot so the caller can keep position.
 */
const APOLLO_BULK_MATCH_BATCH = 10;
const APOLLO_BULK_MATCH_CONCURRENCY = 5;

export async function bulkMatchPeople(
  apiKey: string,
  personIds: string[],
  opts: { revealPersonalEmails?: boolean } = {}
): Promise<(ApolloPerson | null)[]> {
  if (personIds.length === 0) return [];

  const batches: string[][] = [];
  for (let i = 0; i < personIds.length; i += APOLLO_BULK_MATCH_BATCH) {
    batches.push(personIds.slice(i, i + APOLLO_BULK_MATCH_BATCH));
  }

  const out: (ApolloPerson | null)[] = new Array(personIds.length).fill(null);

  async function runBatch(batchIndex: number) {
    const batch = batches[batchIndex];
    const baseOffset = batchIndex * APOLLO_BULK_MATCH_BATCH;
    const body: Record<string, unknown> = {
      details: batch.map((id) => ({ id })),
      reveal_personal_emails: opts.revealPersonalEmails ?? false,
      reveal_phone_number: false,
    };
    let response: { matches?: Array<ApolloPerson | null> };
    try {
      response = await apolloRequest<{ matches?: Array<ApolloPerson | null> }>(
        apiKey,
        '/people/bulk_match',
        body
      );
    } catch (e) {
      console.warn(
        `[apollo:bulk_match] batch ${batchIndex} failed:`,
        e instanceof Error ? e.message : e
      );
      return;
    }
    const matches = response.matches || [];
    for (let i = 0; i < batch.length; i++) {
      out[baseOffset + i] = matches[i] || null;
    }
  }

  // Run batches with bounded concurrency.
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(APOLLO_BULK_MATCH_CONCURRENCY, batches.length) },
      async () => {
        while (true) {
          const idx = next++;
          if (idx >= batches.length) return;
          await runBatch(idx);
        }
      }
    )
  );

  return out;
}

export async function findBestContact(
  apiKey: string,
  organizationName: string,
  organizationId: string,
  userId: string,
  /**
   * When 'linkedin', accept candidates that have a LinkedIn URL even if no
   * email is on file (LinkedIn flow needs the URL, not the email). When
   * 'email' (default) keep the original behavior: must have an email.
   */
  channel: 'email' | 'linkedin' = 'email'
): Promise<{
  person: ApolloPerson | null;
  enrichedEmail: string | null;
  title: string | null;
}> {
  const people = await findPeopleByTitle(apiKey, organizationId, userId);

  if (people.length === 0) {
    return { person: null, enrichedEmail: null, title: null };
  }

  for (const candidate of people.slice(0, 10)) {
    if (!candidate.first_name) continue;

    if (channel === 'linkedin') {
      // Happy path: search-stub already includes linkedin_url.
      if (candidate.linkedin_url) {
        return {
          person: candidate,
          enrichedEmail: candidate.email || null,
          title: candidate.title || null,
        };
      }
      // Fallback: Apollo's masked search frequently omits linkedin_url on
      // the free/basic tier. /people/match returns the full profile, which
      // reliably includes it. Worth 1 credit per candidate — we cap at 10.
      if (candidate.id) {
        const enriched = await enrichPerson(apiKey, candidate.id);
        if (enriched?.linkedin_url) {
          return {
            person: {
              ...candidate,
              linkedin_url: enriched.linkedin_url,
              email: candidate.email || enriched.email,
            },
            enrichedEmail: candidate.email || enriched.email || null,
            title: candidate.title || null,
          };
        }
      }
      continue;
    }

    // channel === 'email' (default)
    if (candidate.email) {
      return {
        person: candidate,
        enrichedEmail: candidate.email,
        title: candidate.title || null,
      };
    }

    if (candidate.has_email && candidate.id) {
      const enriched = await enrichPerson(apiKey, candidate.id);
      if (enriched?.email) {
        return {
          person: {
            ...candidate,
            email: enriched.email,
            linkedin_url: candidate.linkedin_url || enriched.linkedin_url,
          },
          enrichedEmail: enriched.email,
          title: candidate.title || null,
        };
      }
    }
  }

  return { person: null, enrichedEmail: null, title: null };
}
