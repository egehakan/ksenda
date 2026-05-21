import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * People search lives alongside the company-first flow. Where Company Search
 * answers "which orgs match my ICP," People Search answers "which specific
 * decision-makers should I drop into the pipeline." Both eventually feed the
 * same Company → Email pipeline; people-search just picks the contact up-front
 * instead of letting findBestContact pick it.
 */
export interface ApolloPersonRow {
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

export type AiFilter = 'any' | 'no_ai' | 'has_ai';

interface PeopleSearchFilters {
  titles: string;
  seniorities: string;
  organizationLocations: string;
  personLocations: string;
  employeeCountMin: string;
  employeeCountMax: string;
  industries: string;
  technologies: string;
  keywords: string;
  jobTitles: string;
  fundingDateMin: string;
  fundingDateMax: string;
  fundingAmountMin: string;
  fundingAmountMax: string;
  emailVerifiedOnly: boolean;
  includeSimilarTitles: boolean;
  /** Pre-import AI gate — runs detection on the person's org domain. */
  aiFilter: AiFilter;
}

interface PaginationState {
  total_entries?: number;
  total_pages?: number;
  page?: number;
  per_page?: number;
}

export interface PeopleAiDetectionForRow {
  hasAi: boolean;
  confidence: 'confirmed_has_ai' | 'probably_no_ai' | 'definitely_no_ai' | 'unknown';
  summary: string;
}

interface PeopleSearchState {
  filters: PeopleSearchFilters;
  channel: 'email' | 'linkedin';
  people: ApolloPersonRow[];
  currentPage: number;
  pagination: PaginationState | null;
  // Track which org IDs the user has already imported a contact from, so the
  // list visually fades them. Persisted across page reloads.
  importedOrganizationIds: string[];

  // Transient
  selectedPeople: Set<string>;
  isSearching: boolean;
  error: string | null;
  isHydrated: boolean;
  isDetectingAi: boolean;
  // Persisted (see partialize) — keyed by normalized domain.
  aiDetection: Record<string, PeopleAiDetectionForRow>;
}

interface PeopleSearchActions {
  setFilters: (filters: Partial<PeopleSearchFilters>) => void;
  resetFilters: () => void;
  setChannel: (channel: 'email' | 'linkedin') => void;
  setSearchResults: (people: ApolloPersonRow[], pagination: PaginationState | null) => void;
  setCurrentPage: (page: number) => void;
  setIsSearching: (v: boolean) => void;
  setError: (e: string | null) => void;
  togglePerson: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  markPeopleAsImported: (organizationIds: string[]) => void;
  getDisplayablePeople: () => ApolloPersonRow[];
  setIsDetectingAi: (v: boolean) => void;
  setAiDetectionBatch: (entries: Record<string, PeopleAiDetectionForRow>) => void;
  clearAiDetection: () => void;
  setHydrated: () => void;
  clearSearchState: () => void;
}

type PeopleSearchStore = PeopleSearchState & PeopleSearchActions;

const initialFilters: PeopleSearchFilters = {
  titles: '',
  seniorities: '',
  organizationLocations: '',
  personLocations: '',
  employeeCountMin: '',
  employeeCountMax: '',
  industries: '',
  technologies: '',
  keywords: '',
  jobTitles: '',
  fundingDateMin: '',
  fundingDateMax: '',
  fundingAmountMin: '',
  fundingAmountMax: '',
  emailVerifiedOnly: false,
  includeSimilarTitles: true,
  aiFilter: 'any',
};

const initialState: Omit<PeopleSearchState, 'selectedPeople' | 'isHydrated'> = {
  filters: initialFilters,
  channel: 'email',
  people: [],
  currentPage: 1,
  pagination: null,
  importedOrganizationIds: [],
  isSearching: false,
  error: null,
  isDetectingAi: false,
  aiDetection: {},
};

export const usePeopleSearchStore = create<PeopleSearchStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      selectedPeople: new Set(),
      isHydrated: false,
      isDetectingAi: false,
      aiDetection: {},

      setFilters: (newFilters) =>
        set((s) => ({ filters: { ...s.filters, ...newFilters } })),
      resetFilters: () => set({ filters: initialFilters }),
      setChannel: (channel) => set({ channel }),

      setSearchResults: (people, pagination) =>
        set({ people, pagination, error: null }),
      setCurrentPage: (page) => set({ currentPage: page }),
      setIsSearching: (isSearching) => set({ isSearching }),
      setError: (error) => set({ error }),

      togglePerson: (id) =>
        set((s) => {
          const next = new Set(s.selectedPeople);
          next.has(id) ? next.delete(id) : next.add(id);
          return { selectedPeople: next };
        }),
      selectAll: (ids) => set({ selectedPeople: new Set(ids) }),
      clearSelection: () => set({ selectedPeople: new Set() }),

      markPeopleAsImported: (orgIds) =>
        set((s) => {
          const next = new Set(s.importedOrganizationIds);
          orgIds.forEach((id) => next.add(id));
          return {
            importedOrganizationIds: Array.from(next),
            selectedPeople: new Set(),
          };
        }),

      // Filter out already-imported orgs so duplicates don't clutter the list.
      // Match the company-search-store behavior exactly.
      getDisplayablePeople: () => {
        const { people, importedOrganizationIds } = get();
        const set = new Set(importedOrganizationIds);
        return people.filter((p) => {
          const orgId = p.organization?.id || p.organization_id;
          return !orgId || !set.has(orgId);
        });
      },

      setIsDetectingAi: (v) => set({ isDetectingAi: v }),
      setAiDetectionBatch: (entries) =>
        set((s) => ({ aiDetection: { ...s.aiDetection, ...entries } })),
      clearAiDetection: () => set({ aiDetection: {} }),

      setHydrated: () => set({ isHydrated: true }),

      clearSearchState: () =>
        set((s) => ({
          ...initialState,
          importedOrganizationIds: s.importedOrganizationIds,
          selectedPeople: new Set(),
        })),
    }),
    {
      name: 'people-search-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        filters: s.filters,
        channel: s.channel,
        people: s.people,
        currentPage: s.currentPage,
        pagination: s.pagination,
        importedOrganizationIds: s.importedOrganizationIds,
        // Persisted alongside `people` so AI badges + the Has/No/Unknown
        // results filter survive a page refresh (they annotate the rows).
        aiDetection: s.aiDetection,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    }
  )
);
