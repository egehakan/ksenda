import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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

/**
 * Pre-import AI-presence gate. When set to anything other than 'any', the
 * import flow walks Apollo pages, runs batched AI detection on each result
 * page, and keeps only matching companies until the daily cap is hit (or the
 * page-walk budget is exhausted).
 *   any    → no detection, import all matches
 *   no_ai  → import only companies without observable AI deployment
 *   has_ai → import only companies that already deploy AI
 */
export type AiFilter = 'any' | 'no_ai' | 'has_ai';

interface SearchFilters {
  locations: string;
  employeeCountMin: string;
  employeeCountMax: string;
  industries: string;
  keywords: string;
  /** Hiring signal — comma-separated job titles to look for in active postings. */
  jobTitles: string;
  /** Tech-stack fit — comma-separated Apollo technology UIDs (lowercase, underscores). */
  technologies: string;
  /** YYYY-MM-DD — earliest acceptable date of most-recent funding round. */
  fundingDateMin: string;
  /** YYYY-MM-DD — latest acceptable date of most-recent funding round. */
  fundingDateMax: string;
  /** USD — minimum size of most-recent funding round (no commas). */
  fundingAmountMin: string;
  /** USD — maximum size of most-recent funding round (no commas). */
  fundingAmountMax: string;
  /** Pre-import AI gate. */
  aiFilter: AiFilter;
}

interface PaginationState {
  total_entries?: number;
  total_pages?: number;
  page?: number;
  per_page?: number;
}

/**
 * Per-domain AI-presence detection result, surfaced as a row badge after
 * the user clicks "Check AI status". Stored transient — not worth
 * persisting because each new search resets the row context.
 */
export interface AiDetectionForRow {
  hasAi: boolean;
  confidence: 'confirmed_has_ai' | 'probably_no_ai' | 'definitely_no_ai' | 'unknown';
  summary: string;
}

interface CompanySearchState {
  // Persisted state
  filters: SearchFilters;
  channel: 'email' | 'linkedin';
  companies: ApolloCompany[];
  currentPage: number;
  pagination: PaginationState | null;
  generatedCompanyIds: string[];

  // Transient state (not persisted)
  selectedCompanies: Set<string>;
  isSearching: boolean;
  error: string | null;
  isHydrated: boolean;
  isDetectingAi: boolean;
  // Persisted (see partialize) — keyed by normalized domain.
  aiDetection: Record<string, AiDetectionForRow>;
}

interface CompanySearchActions {
  // Filter actions
  setFilters: (filters: Partial<SearchFilters>) => void;
  resetFilters: () => void;
  setChannel: (channel: 'email' | 'linkedin') => void;

  // Search actions
  setSearchResults: (companies: ApolloCompany[], pagination: PaginationState | null) => void;
  setCurrentPage: (page: number) => void;
  setIsSearching: (isSearching: boolean) => void;
  setError: (error: string | null) => void;

  // Selection actions (transient)
  toggleCompany: (id: string) => void;
  selectAll: (companyIds: string[]) => void;
  clearSelection: () => void;

  // Generated companies tracking
  markCompaniesAsGenerated: (organizationIds: string[]) => void;

  // Computed
  getDisplayableCompanies: () => ApolloCompany[];

  // AI detection
  setIsDetectingAi: (v: boolean) => void;
  setAiDetectionForDomain: (domain: string, value: AiDetectionForRow) => void;
  setAiDetectionBatch: (entries: Record<string, AiDetectionForRow>) => void;
  clearAiDetection: () => void;

  // Hydration
  setHydrated: () => void;

  // Reset
  clearSearchState: () => void;
}

type CompanySearchStore = CompanySearchState & CompanySearchActions;

const initialFilters: SearchFilters = {
  locations: '',
  employeeCountMin: '',
  employeeCountMax: '',
  industries: '',
  keywords: '',
  jobTitles: '',
  technologies: '',
  fundingDateMin: '',
  fundingDateMax: '',
  fundingAmountMin: '',
  fundingAmountMax: '',
  aiFilter: 'any',
};

const initialState: Omit<CompanySearchState, 'selectedCompanies' | 'isHydrated'> = {
  filters: initialFilters,
  channel: 'email',
  companies: [],
  currentPage: 1,
  pagination: null,
  generatedCompanyIds: [],
  isSearching: false,
  error: null,
  isDetectingAi: false,
  aiDetection: {},
};

export const useCompanySearchStore = create<CompanySearchStore>()(
  persist(
    (set, get) => ({
      // Initial state
      ...initialState,
      selectedCompanies: new Set(),
      isHydrated: false,
      isDetectingAi: false,
      aiDetection: {},

      // Filter actions
      setFilters: (newFilters) => set((state) => ({
        filters: { ...state.filters, ...newFilters }
      })),

      resetFilters: () => set({
        filters: initialFilters
      }),

      setChannel: (channel) => set({ channel }),

      // Search actions
      setSearchResults: (companies, pagination) => set({
        companies,
        pagination,
        error: null,
      }),

      setCurrentPage: (page) => set({ currentPage: page }),
      setIsSearching: (isSearching) => set({ isSearching }),
      setError: (error) => set({ error }),

      // Selection (transient)
      toggleCompany: (id) => set((state) => {
        const newSelected = new Set(state.selectedCompanies);
        if (newSelected.has(id)) {
          newSelected.delete(id);
        } else {
          newSelected.add(id);
        }
        return { selectedCompanies: newSelected };
      }),

      selectAll: (companyIds) => set({
        selectedCompanies: new Set(companyIds)
      }),

      clearSelection: () => set({ selectedCompanies: new Set() }),

      // Generated tracking
      markCompaniesAsGenerated: (orgIds) => set((state) => {
        const newGenerated = new Set(state.generatedCompanyIds);
        orgIds.forEach(id => newGenerated.add(id));
        return {
          generatedCompanyIds: Array.from(newGenerated),
          selectedCompanies: new Set(),
        };
      }),

      // Computed - filter out generated companies
      getDisplayableCompanies: () => {
        const { companies, generatedCompanyIds } = get();
        const generatedSet = new Set(generatedCompanyIds);
        return companies.filter(company => {
          const orgId = company.organization_id || company.id;
          return !generatedSet.has(orgId);
        });
      },

      // AI detection
      setIsDetectingAi: (v) => set({ isDetectingAi: v }),
      setAiDetectionForDomain: (domain, value) => set((state) => ({
        aiDetection: { ...state.aiDetection, [domain.toLowerCase()]: value },
      })),
      setAiDetectionBatch: (entries) => set((state) => ({
        aiDetection: { ...state.aiDetection, ...entries },
      })),
      clearAiDetection: () => set({ aiDetection: {} }),

      // Hydration
      setHydrated: () => set({ isHydrated: true }),

      // Reset (preserves generated IDs)
      clearSearchState: () => set((state) => ({
        ...initialState,
        generatedCompanyIds: state.generatedCompanyIds,
        selectedCompanies: new Set(),
      })),
    }),
    {
      name: 'company-search-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist these fields
        filters: state.filters,
        channel: state.channel,
        companies: state.companies,
        currentPage: state.currentPage,
        pagination: state.pagination,
        generatedCompanyIds: state.generatedCompanyIds,
        // Persisted alongside `companies` so AI badges + the Has/No/Unknown
        // results filter survive a page refresh (they annotate the rows).
        aiDetection: state.aiDetection,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    }
  )
);
