import { NextRequest, NextResponse } from 'next/server';
import { searchCompanies, type ApolloFilters, type ApolloCompany } from '@/lib/services/apollo';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { type AiFilter } from '@/lib/services/company-import';
import { createJob } from '@/lib/services/jobs';
import { blockIfJobActive } from '@/lib/active-job-guard';
import { inngest, EVENTS } from '@/lib/inngest/client';

export const maxDuration = 300;

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
    const { filters, page = 1, perPage = 25 } = body;
    const rawAiFilter: AiFilter =
      body.aiFilter === 'no_ai' || body.aiFilter === 'has_ai' ? body.aiFilter : 'any';

    const apolloFilters: ApolloFilters = {
      locations: filters?.locations && filters.locations.length > 0 ? filters.locations : undefined,
      employeeCountMin:
        filters?.employeeCountMin !== undefined && filters.employeeCountMin !== null
          ? Number(filters.employeeCountMin)
          : undefined,
      employeeCountMax:
        filters?.employeeCountMax !== undefined && filters.employeeCountMax !== null
          ? Number(filters.employeeCountMax)
          : undefined,
      industries: filters?.industries && filters.industries.length > 0 ? filters.industries : undefined,
      keywords: filters?.keywords && filters.keywords.length > 0 ? filters.keywords : undefined,
      jobTitles: filters?.jobTitles && filters.jobTitles.length > 0 ? filters.jobTitles : undefined,
      technologies: filters?.technologies && filters.technologies.length > 0 ? filters.technologies : undefined,
      fundingDateMin: filters?.fundingDateMin || undefined,
      fundingDateMax: filters?.fundingDateMax || undefined,
      fundingAmountMin:
        filters?.fundingAmountMin !== undefined && filters.fundingAmountMin !== null
          ? Number(filters.fundingAmountMin)
          : undefined,
      fundingAmountMax:
        filters?.fundingAmountMax !== undefined && filters.fundingAmountMax !== null
          ? Number(filters.fundingAmountMax)
          : undefined,
    };

    // -----------------------------------------------------------------
    // AI-gated search: dispatch a background Inngest job. Per-page +
    // per-detection step.run() so it can take 10+ minutes without hitting
    // Vercel's 300s ceiling. The route returns immediately with the
    // jobId — the frontend polls /api/jobs/[id] for live progress and
    // reads the final matches from the job's metadata when status flips
    // to 'completed'.
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
        kind: 'company_search',
        totalItems: target,
        currentLabel: `AI search: finding ${target} ${rawAiFilter === 'no_ai' ? 'no-AI' : 'has-AI'} companies…`,
      });
      if (!jobId) {
        return NextResponse.json(
          { error: 'Failed to create search job' },
          { status: 500 }
        );
      }

      await inngest.send({
        name: EVENTS.companiesAiSearch,
        data: {
          userId: user.id,
          jobId,
          filters: apolloFilters,
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

    // -----------------------------------------------------------------
    // Default search: existing one-page Apollo behavior.
    // -----------------------------------------------------------------
    const fetchedOrgs = await prisma.fetchedOrganization.findMany({
      where: { userId: user.id },
      select: { apolloId: true },
    });
    const fetchedIds = new Set(fetchedOrgs.map((org) => org.apolloId));

    let currentPage = page;
    let filteredCompanies: ApolloCompany[] = [];
    let pagination = null;
    const maxPagesToTry = 10;
    let pagesTriedCount = 0;

    while (pagesTriedCount < maxPagesToTry) {
      const result = await searchCompanies(user.apolloApiKey, apolloFilters, currentPage, perPage);
      pagination = result.pagination;

      filteredCompanies = result.companies.filter((company) => {
        const orgId = company.organization_id || company.id;
        return !fetchedIds.has(orgId);
      });

      if (
        filteredCompanies.length > 0 ||
        !pagination ||
        currentPage >= (pagination.total_pages || 1)
      ) {
        break;
      }

      currentPage++;
      pagesTriedCount++;
    }

    const adjustedPagination = pagination ? { ...pagination, page: currentPage } : null;

    return NextResponse.json({
      companies: filteredCompanies,
      pagination: adjustedPagination,
    });
  } catch (error) {
    console.error('Error searching companies:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to search companies' },
      { status: 500 }
    );
  }
}
