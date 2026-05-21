import { NextRequest, NextResponse } from 'next/server';
import {
  searchPeople,
  type ApolloPeopleFilters,
  searchCompanies,
} from '@/lib/services/apollo';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { type AiFilter } from '@/lib/services/company-import';
import { createJob } from '@/lib/services/jobs';
import { blockIfJobActive } from '@/lib/active-job-guard';
import { inngest, EVENTS } from '@/lib/inngest/client';

export const maxDuration = 300;

/**
 * POST /api/people/search — direct decision-maker search.
 *
 * Companion to /api/companies/search. Use when you want to start from "find me
 * VPs of Engineering at Series-A AI startups" rather than "find me Series-A AI
 * startups, then look up VPs of Engineering inside each."
 *
 * If the caller also passes company-side funding / hiring / tech filters, we
 * first hit /mixed_companies/search to enumerate matching orgs (max 500), then
 * scope the people search to those organization_ids. Apollo's people search
 * endpoint does not accept funding-stage filters directly, so this two-step
 * keeps the org gate.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.apolloApiKey) {
      return NextResponse.json(
        { error: 'Apollo API key is not configured. Please add it in Settings.' },
        { status: 400 }
      );
    }

    // App-wide single-flight — blocks any new search (sync or AI-gated)
    // while a search / import / generation / automation / follow-up job
    // is running.
    const blocked = await blockIfJobActive(user.id);
    if (blocked) return blocked;

    const body = await request.json();
    const { filters: f, page = 1, perPage = 50 } = body || {};
    const rawAiFilter: AiFilter =
      body.aiFilter === 'no_ai' || body.aiFilter === 'has_ai' ? body.aiFilter : 'any';

    const peopleFilters: ApolloPeopleFilters = {
      titles: f?.titles && f.titles.length > 0 ? f.titles : undefined,
      seniorities: f?.seniorities && f.seniorities.length > 0 ? f.seniorities : undefined,
      organizationLocations:
        f?.organizationLocations && f.organizationLocations.length > 0
          ? f.organizationLocations
          : undefined,
      personLocations:
        f?.personLocations && f.personLocations.length > 0 ? f.personLocations : undefined,
      employeeCountMin:
        f?.employeeCountMin !== undefined && f.employeeCountMin !== null
          ? Number(f.employeeCountMin)
          : undefined,
      employeeCountMax:
        f?.employeeCountMax !== undefined && f.employeeCountMax !== null
          ? Number(f.employeeCountMax)
          : undefined,
      keywords: f?.keywords && f.keywords.length > 0 ? f.keywords : undefined,
      industries: f?.industries && f.industries.length > 0 ? f.industries : undefined,
      technologies: f?.technologies && f.technologies.length > 0 ? f.technologies : undefined,
      includeSimilarTitles: f?.includeSimilarTitles !== false,
      contactEmailStatus: f?.emailVerifiedOnly ? ['verified'] : undefined,
    };

    // -----------------------------------------------------------------
    // AI-gated search: dispatch a background Inngest job (per-page +
    // per-detection steps). Returns immediately with the jobId; the
    // frontend polls /api/jobs/[id] for progress and reads matches from
    // the job's metadata on completion.
    // -----------------------------------------------------------------
    if (rawAiFilter !== 'any') {
      if (!user.geminiApiKey) {
        return NextResponse.json(
          { error: 'Gemini API key is required for AI-filtered search.' },
          { status: 400 }
        );
      }
      const target = typeof body.target === 'number' && body.target > 0 ? Math.min(body.target, 100) : 50;
      const jobId = await createJob({
        userId: user.id,
        kind: 'people_search',
        totalItems: target,
        currentLabel: `AI search: finding ${target} ${rawAiFilter === 'no_ai' ? 'no-AI' : 'has-AI'} orgs…`,
      });
      if (!jobId) {
        return NextResponse.json(
          { error: 'Failed to create search job' },
          { status: 500 }
        );
      }

      await inngest.send({
        name: EVENTS.peopleAiSearch,
        data: {
          userId: user.id,
          jobId,
          filters: peopleFilters,
          target,
          aiFilter: rawAiFilter,
        },
      });

      return NextResponse.json({
        mode: 'ai_gated_queued',
        queued: true,
        jobId,
        target,
      });
    }

    // If a funding-stage / hiring filter was provided, do a two-step:
    // first enumerate matching orgs, then scope people search to those ids.
    // Apollo's people-search endpoint does not natively support funding range.
    const hasOrgGate =
      f?.fundingDateMin ||
      f?.fundingDateMax ||
      f?.fundingAmountMin ||
      f?.fundingAmountMax ||
      (f?.jobTitles && f.jobTitles.length > 0);

    if (hasOrgGate) {
      const orgResult = await searchCompanies(
        user.apolloApiKey,
        {
          locations: peopleFilters.organizationLocations,
          employeeCountMin: peopleFilters.employeeCountMin,
          employeeCountMax: peopleFilters.employeeCountMax,
          industries: peopleFilters.industries,
          technologies: peopleFilters.technologies,
          jobTitles: f.jobTitles,
          fundingDateMin: f.fundingDateMin || undefined,
          fundingDateMax: f.fundingDateMax || undefined,
          fundingAmountMin:
            f.fundingAmountMin !== undefined && f.fundingAmountMin !== null && f.fundingAmountMin !== ''
              ? Number(f.fundingAmountMin)
              : undefined,
          fundingAmountMax:
            f.fundingAmountMax !== undefined && f.fundingAmountMax !== null && f.fundingAmountMax !== ''
              ? Number(f.fundingAmountMax)
              : undefined,
        },
        1,
        100
      );

      const orgIds = orgResult.companies
        .map((c) => c.organization_id || c.id)
        .filter(Boolean);

      if (orgIds.length === 0) {
        return NextResponse.json({ people: [], pagination: null });
      }

      // Cap to 100 orgs per request — Apollo URL-length limits start to bite
      // beyond that. The caller can paginate the people endpoint within this
      // org set.
      const cappedOrgIds = orgIds.slice(0, 100);
      const result = await searchPeople(
        user.apolloApiKey,
        {
          ...peopleFilters,
          industries: undefined,
          organizationIds: cappedOrgIds,
        },
        page,
        perPage
      );

      return NextResponse.json({ people: result.people, pagination: result.pagination });
    }

    const result = await searchPeople(user.apolloApiKey, peopleFilters, page, perPage);

    // Optional: hide people whose org has already been imported.
    const fetchedOrgs = await prisma.fetchedOrganization.findMany({
      where: { userId: user.id },
      select: { apolloId: true },
    });
    const fetchedSet = new Set(fetchedOrgs.map((o) => o.apolloId));
    const filtered = result.people.filter((p) => {
      const id = p.organization?.id || p.organization_id;
      return !id || !fetchedSet.has(id);
    });

    return NextResponse.json({ people: filtered, pagination: result.pagination });
  } catch (error) {
    console.error('Error searching people:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to search people' },
      { status: 500 }
    );
  }
}
