/**
 * The 9 built-in recipes from the 30-Day Outbound Calendar PDF, plus the
 * 22-working-day plan pattern that maps positions in the schedule to
 * (recipe, cap) tuples. The campaign generator walks 30 calendar days
 * from a chosen start date, skipping weekends, and applies this plan in
 * order.
 *
 * Filter values match what the corresponding search route expects.
 * Free-tier recipes (A*) work on Apollo's free plan today; paid recipes
 * (B*) require Apollo Basic for the funding / tech / hiring filters.
 */

export interface BuiltInRecipe {
  code: string;
  name: string;
  description: string;
  kind: 'companies' | 'people';
  filters: Record<string, unknown>;
  defaultDailyCap: number;
}

export const BUILT_IN_RECIPES: BuiltInRecipe[] = [
  {
    code: 'A1',
    name: 'People · Head of AI sweep',
    description:
      'FREE tier. Direct decision-maker search across US AI startups (11–200 headcount). Best free-tier recipe.',
    kind: 'people',
    defaultDailyCap: 20,
    filters: {
      titles: ['Head of AI', 'Director of AI', 'VP AI', 'Chief AI Officer'],
      seniorities: ['c_suite', 'vp', 'head', 'director'],
      organizationLocations: ['United States'],
      employeeCountMin: 11,
      employeeCountMax: 200,
      includeSimilarTitles: true,
      emailVerifiedOnly: true,
    },
  },
  {
    code: 'A2',
    name: 'People · CTO sweep',
    description:
      'FREE tier. Tighter than A1 — small-team CTOs are direct buyers. US + Canada, 11–80 headcount.',
    kind: 'people',
    defaultDailyCap: 20,
    filters: {
      titles: ['CTO', 'Chief Technology Officer'],
      seniorities: ['c_suite'],
      organizationLocations: ['United States', 'Canada'],
      employeeCountMin: 11,
      employeeCountMax: 80,
      includeSimilarTitles: true,
      emailVerifiedOnly: true,
    },
  },
  {
    code: 'A3',
    name: 'People · Founder / CEO at small AI shops',
    description:
      'FREE tier. Founders move fast on buying decisions but reject anything templated. US / UK / Germany, 11–50 headcount.',
    kind: 'people',
    defaultDailyCap: 20,
    filters: {
      titles: ['Founder', 'Co-Founder', 'CEO'],
      seniorities: ['founder', 'owner', 'c_suite'],
      organizationLocations: ['United States', 'United Kingdom', 'Germany'],
      employeeCountMin: 11,
      employeeCountMax: 50,
      keywords: ['artificial intelligence', 'generative ai'],
      emailVerifiedOnly: true,
    },
  },
  {
    code: 'A4',
    name: 'Companies · US AI SaaS small/mid-market',
    description:
      'FREE tier (NOISY). Top results include media sites and generic "AI Institute" entities. Manual quality-filter before importing.',
    kind: 'companies',
    defaultDailyCap: 15,
    filters: {
      locations: ['United States'],
      employeeCountMin: 30,
      employeeCountMax: 200,
      industries: ['SaaS'],
      keywords: ['artificial intelligence'],
    },
  },
  {
    code: 'B1',
    name: 'Companies · US Series A AI startups',
    description:
      'PAID. Canonical ICP from the 90-Day Plan. Funding + hiring together = highest-intent cohort.',
    kind: 'companies',
    defaultDailyCap: 25,
    filters: {
      locations: ['United States'],
      employeeCountMin: 11,
      employeeCountMax: 100,
      keywords: ['artificial intelligence', 'agents', 'RAG'],
      fundingDateMin: '2024-05-01',
      fundingAmountMin: 3000000,
      fundingAmountMax: 25000000,
      jobTitles: ['AI Engineer', 'ML Engineer', 'Head of AI'],
    },
  },
  {
    code: 'B2',
    name: 'Companies · Tech-stack fit',
    description:
      'PAID. Companies already paying for LLM APIs are committed buyers. Lower top-of-funnel volume, much higher reply rate.',
    kind: 'companies',
    defaultDailyCap: 25,
    filters: {
      locations: ['United States', 'Canada'],
      employeeCountMin: 30,
      employeeCountMax: 300,
      keywords: ['saas'],
      technologies: ['openai', 'anthropic', 'langchain', 'pinecone', 'weaviate'],
      industries: ['SaaS', 'Fintech', 'HealthTech'],
    },
  },
  {
    code: 'B3',
    name: 'Companies · Actively hiring AI roles',
    description:
      'PAID. Pure hiring signal = budget proxy. Mention the open role in the email opener.',
    kind: 'companies',
    defaultDailyCap: 25,
    filters: {
      locations: ['United States', 'United Kingdom'],
      employeeCountMin: 25,
      employeeCountMax: 400,
      jobTitles: [
        'AI Engineer',
        'ML Engineer',
        'Machine Learning Engineer',
        'Senior AI Engineer',
        'Head of AI',
      ],
    },
  },
  {
    code: 'B4',
    name: 'Companies · European AI startups',
    description:
      'PAID. Lower density than US but lower SDR-saturation. Reply rate often higher for the same prompt.',
    kind: 'companies',
    defaultDailyCap: 25,
    filters: {
      locations: ['United Kingdom', 'Germany', 'France', 'Netherlands', 'Spain'],
      employeeCountMin: 15,
      employeeCountMax: 200,
      keywords: ['artificial intelligence', 'agents'],
      fundingDateMin: '2024-11-01',
      fundingAmountMin: 2000000,
      fundingAmountMax: 40000000,
    },
  },
  {
    code: 'B5',
    name: 'People · Head of AI + funding gate',
    description:
      'PAID — highest leverage. Triggers the 2-step org-gate (companies first, then people scoped to those org IDs). Sharpest ICP fit available.',
    kind: 'people',
    defaultDailyCap: 25,
    filters: {
      titles: ['Head of AI', 'Director of AI', 'VP AI', 'Chief AI Officer'],
      seniorities: ['c_suite', 'vp', 'head', 'director'],
      organizationLocations: ['United States'],
      employeeCountMin: 11,
      employeeCountMax: 200,
      emailVerifiedOnly: true,
      fundingDateMin: '2024-05-01',
      fundingAmountMin: 3000000,
      fundingAmountMax: 60000000,
      technologies: ['openai', 'anthropic'],
    },
  },

  // ===== C-series: "AI for non-AI companies" outbound stream =====
  // Apollo's tech filter can't reliably detect server-side AI usage
  // (OpenAI / Anthropic API calls leave no crawler trace), so the filter
  // strategy here is: filter FOR legacy ops-traditional tech stack +
  // operations-heavy industries + mid-market headcount. The actual
  // "has AI" disqualification happens via the Gemini-grounded
  // AI-detection scan (urlContext + googleSearch) post-search.
  {
    code: 'C1',
    name: 'Companies · Legal mid-market (no AI yet)',
    description:
      'Law firms 50-200 attorneys. Run AI-detection scan after import — disqualify firms already using Harvey / Spellbook / Hebbia.',
    kind: 'companies',
    defaultDailyCap: 20,
    filters: {
      locations: ['United States'],
      employeeCountMin: 50,
      employeeCountMax: 350,
      industries: ['Law Practice', 'Legal Services'],
    },
  },
  {
    code: 'C2',
    name: 'Companies · Accounting + CPA firms',
    description:
      'Mid-market accounting / CPA. 20-200 staff. Karbon / Aiwyn pitches mostly enterprise — this cohort is underpitched.',
    kind: 'companies',
    defaultDailyCap: 20,
    filters: {
      locations: ['United States'],
      employeeCountMin: 20,
      employeeCountMax: 250,
      industries: ['Accounting'],
    },
  },
  {
    code: 'C3',
    name: 'Companies · Manufacturing mid-market',
    description:
      'Discrete and process manufacturing $10-200M revenue. Predictive maintenance + computer vision QC have the strongest ROI proof in 2026.',
    kind: 'companies',
    defaultDailyCap: 20,
    filters: {
      locations: ['United States'],
      employeeCountMin: 100,
      employeeCountMax: 500,
      industries: ['Manufacturing', 'Industrial Automation', 'Mechanical or Industrial Engineering'],
    },
  },
  {
    code: 'C4',
    name: 'Companies · Construction GCs',
    description:
      'General contractors $20-500M revenue. AEC sector at ~27% AI adoption; sub-$50M GCs at ~1.5% (ASCE 2025). Underpitched cohort.',
    kind: 'companies',
    defaultDailyCap: 20,
    filters: {
      locations: ['United States'],
      employeeCountMin: 50,
      employeeCountMax: 500,
      industries: ['Construction', 'Civil Engineering', 'Building Materials'],
    },
  },
  {
    code: 'C5',
    name: 'Companies · Healthcare admin + RCM',
    description:
      'Specialty practices, billing services, RCM vendors. 30-500 headcount. 92% rank AI top priority for 2026 (HFMA poll) but only ~15% report positive ROI yet.',
    kind: 'companies',
    defaultDailyCap: 20,
    filters: {
      locations: ['United States'],
      employeeCountMin: 30,
      employeeCountMax: 500,
      industries: ['Medical Practice', 'Hospital & Health Care', 'Health, Wellness and Fitness'],
    },
  },
  {
    code: 'C6',
    name: 'Companies · Logistics + 3PL mid-market',
    description:
      'Mid-market 3PL / freight $10-100M revenue. 28% AI adoption vs 73% at large enterprise (Ventus Q3 2025). Wide-open cohort.',
    kind: 'companies',
    defaultDailyCap: 20,
    filters: {
      locations: ['United States'],
      employeeCountMin: 50,
      employeeCountMax: 400,
      industries: [
        'Logistics and Supply Chain',
        'Transportation/Trucking/Railroad',
        'Warehousing',
      ],
    },
  },
  {
    code: 'C7',
    name: 'Companies · Professional services + consulting',
    description:
      'Consulting / agencies / professional-services firms 50-500 emp. 56% adoption but only 24% production deployment (Thinking 2026).',
    kind: 'companies',
    defaultDailyCap: 20,
    filters: {
      locations: ['United States'],
      employeeCountMin: 50,
      employeeCountMax: 500,
      industries: ['Management Consulting', 'Information Technology and Services'],
    },
  },
  {
    code: 'C8',
    name: 'Companies · Insurance brokers + MGA',
    description:
      'Mid-market insurance brokers / MGA. Carrier level is saturated; broker cohort wide open. 80% faster claims resolution proven at Allianz Nemo.',
    kind: 'companies',
    defaultDailyCap: 20,
    filters: {
      locations: ['United States'],
      employeeCountMin: 30,
      employeeCountMax: 400,
      industries: ['Insurance'],
    },
  },
];

/**
 * The 22 working days of the 30-day plan, in order. Each entry pins a
 * recipe code and the daily cap for that position. Weekends are inserted
 * automatically by the schedule generator (they fall between these
 * positions depending on the chosen start weekday). A position of
 * `AUDIT` means a skip day at end-of-plan (Day 30 retrospective).
 */
export interface PlanPosition {
  code: string; // recipe code OR "AUDIT" for the retrospective day
  cap: number;
  focusNote: string;
}

export const PLAN_22: PlanPosition[] = [
  // Week 1 — warmup (caps 5/5/5/10/10)
  { code: 'A1', cap: 5,  focusNote: 'Cold start. Verify deliverability before scaling.' },
  { code: 'A1', cap: 5,  focusNote: 'Same recipe, page 2. Get a feel for filter quality.' },
  { code: 'A2', cap: 5,  focusNote: 'Pivot to CTO sweep. Friday review at EOD.' },
  { code: 'A3', cap: 10, focusNote: 'Founder / CEO sweep at small AI shops.' },
  { code: 'A1', cap: 10, focusNote: 'Re-run Head-of-AI with deeper pagination.' },

  // Week 2 — Apollo upgrade kicks in (10/10/10/20/20)
  { code: 'B1', cap: 10, focusNote: 'UPGRADE APOLLO TODAY. First paid recipe — funding-date filter live.' },
  { code: 'B1', cap: 10, focusNote: 'Same recipe, page 2.' },
  { code: 'B2', cap: 10, focusNote: 'Tech-stack fit. Friday review.' },
  { code: 'B3', cap: 20, focusNote: 'Hiring-signal companies. Steady-state cap.' },
  { code: 'B3', cap: 20, focusNote: 'Same, page 2.' },

  // Week 3 — mixed (20 across)
  { code: 'B1', cap: 20, focusNote: 'Re-run B1 with fresh pages.' },
  { code: 'A2', cap: 20, focusNote: 'CTO sweep, paid tier (funding gate active).' },
  { code: 'B2', cap: 20, focusNote: 'Friday review.' },
  { code: 'A3', cap: 20, focusNote: 'Founder / CEO sweep, paid tier.' },
  { code: 'B4', cap: 20, focusNote: 'European AI sweep.' },

  // Week 4 — peak (25 across)
  { code: 'B1', cap: 25, focusNote: 'Hit peak cap.' },
  { code: 'A1', cap: 25, focusNote: 'Head of AI peak.' },
  { code: 'B3', cap: 25, focusNote: 'Friday + monthly review.' },
  { code: 'A2', cap: 25, focusNote: 'CTO peak.' },
  { code: 'B2', cap: 25, focusNote: 'Tech-fit peak.' },

  // Week 5 — cool-down + retrospective
  { code: 'B1',   cap: 25, focusNote: 'Last full day before retrospective.' },
  { code: 'AUDIT', cap: 0,  focusNote: 'Day 30 audit. No new outbound. Tally totals.' },
];

/**
 * 22-working-day plan for the "AI for non-AI companies" outbound stream.
 * Lower caps than the AI-native PLAN_22 because every imported company
 * needs an AI-detection scan before generation (Gemini grounding latency
 * is the bottleneck, not Apollo). Rotates across C1-C8 so each industry
 * gets exposure without saturating any single one in the first month.
 */
export const NON_AI_PLAN_22: PlanPosition[] = [
  // Week 1 — warmup. Focus on professional services + legal first; their
  // peer-case proof points are sharpest, fastest reply-rate signal.
  { code: 'C1', cap: 5,  focusNote: 'Cold start — legal mid-market. Run AI-detection scan post-import; disqualify Harvey/Spellbook users.' },
  { code: 'C7', cap: 5,  focusNote: 'Professional services / consulting. Same scan rule.' },
  { code: 'C2', cap: 5,  focusNote: 'Accounting + CPA. Friday review at EOD.' },
  { code: 'C1', cap: 10, focusNote: 'Legal, page 2. Reply-rate read-out at end of day.' },
  { code: 'C7', cap: 10, focusNote: 'Professional services, page 2.' },

  // Week 2 — add manufacturing + construction. Higher absolute volume.
  { code: 'C3', cap: 10, focusNote: 'Manufacturing first wave. Predictive maintenance ROI angle has the highest reply rate.' },
  { code: 'C4', cap: 10, focusNote: 'Construction GCs. Cite Bluebeam 2025 numbers in opener.' },
  { code: 'C2', cap: 10, focusNote: 'Accounting page 2. Karbon hours/week stat works for sub-50-staff firms.' },
  { code: 'C5', cap: 20, focusNote: 'Healthcare admin + RCM. Prior-auth automation hook.' },
  { code: 'C5', cap: 20, focusNote: 'Healthcare admin + RCM page 2.' },

  // Week 3 — full mix. Highest volume, broadest industry coverage.
  { code: 'C1', cap: 20, focusNote: 'Legal, third page.' },
  { code: 'C6', cap: 20, focusNote: 'Logistics + 3PL. Convoy 10-20% deadhead reduction stat.' },
  { code: 'C3', cap: 20, focusNote: 'Manufacturing page 2. Friday review.' },
  { code: 'C8', cap: 20, focusNote: 'Insurance brokers + MGA. Sixfold + Allianz Nemo numbers.' },
  { code: 'C7', cap: 20, focusNote: 'Professional services page 3.' },

  // Week 4 — peak volume.
  { code: 'C5', cap: 25, focusNote: 'Healthcare peak. Aspirion / Waystar numbers.' },
  { code: 'C4', cap: 25, focusNote: 'Construction peak.' },
  { code: 'C3', cap: 25, focusNote: 'Manufacturing peak. Friday + monthly review.' },
  { code: 'C2', cap: 25, focusNote: 'Accounting peak.' },
  { code: 'C6', cap: 25, focusNote: 'Logistics peak.' },

  // Week 5 — cool-down + retrospective.
  { code: 'C7', cap: 25, focusNote: 'Last full day before retrospective.' },
  { code: 'AUDIT', cap: 0, focusNote: 'Day 30 audit. Tally reply-rate by industry; pick top 2 verticals for Month 2.' },
];
