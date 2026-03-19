import { create } from 'zustand';

// --- Types ---

export interface Source {
  id: string;
  url: string;
  title: string;
  snippet: string;
  domain: string;
  toolUseId: string;
  round: number;
}

export interface TeamResearchRound {
  round: number;
  query: string;
  status: 'searching' | 'completed' | 'error';
  sources: Source[];
  startTime: number;
  endTime?: number;
}

interface TeamCacheEntry {
  sources: Source[];
  rounds: TeamResearchRound[];
}

interface TeamState {
  sources: Source[];
  rounds: TeamResearchRound[];
  maxRounds: number;
  selectedSourceId: string | null;
  teamCache: Map<string, TeamCacheEntry>;

  addSources: (sources: Source[]) => void;
  addRound: (round: TeamResearchRound) => void;
  updateRound: (roundNum: number, updates: Partial<TeamResearchRound>) => void;
  selectSource: (id: string | null) => void;
  clearTeamState: () => void;
  setMaxRounds: (n: number) => void;

  saveToCache: (tabId: string) => void;
  restoreFromCache: (tabId: string) => boolean;

  // Background cache mutations
  addSourcesInCache: (tabId: string, sources: Source[]) => void;
  addRoundInCache: (tabId: string, round: TeamResearchRound) => void;
  updateRoundInCache: (tabId: string, roundNum: number, updates: Partial<TeamResearchRound>) => void;
}

// --- Store ---

export const useTeamStore = create<TeamState>()((set, get) => ({
  sources: [],
  rounds: [],
  maxRounds: 5,
  selectedSourceId: null,
  teamCache: new Map(),

  addSources: (newSources) =>
    set((state) => ({
      sources: [...state.sources, ...newSources],
    })),

  addRound: (round) =>
    set((state) => ({
      rounds: [...state.rounds, round],
    })),

  updateRound: (roundNum, updates) =>
    set((state) => ({
      rounds: state.rounds.map((r) =>
        r.round === roundNum ? { ...r, ...updates } : r,
      ),
    })),

  selectSource: (id) => set({ selectedSourceId: id }),

  clearTeamState: () =>
    set({ sources: [], rounds: [], selectedSourceId: null }),

  setMaxRounds: (n) => set({ maxRounds: n }),

  saveToCache: (tabId) => {
    const { sources, rounds, teamCache } = get();
    const next = new Map(teamCache);
    next.set(tabId, { sources: [...sources], rounds: [...rounds] });
    set({ teamCache: next });
  },

  restoreFromCache: (tabId) => {
    const cached = get().teamCache.get(tabId);
    if (!cached) {
      set({ sources: [], rounds: [], selectedSourceId: null });
      return false;
    }
    set({
      sources: [...cached.sources],
      rounds: [...cached.rounds],
      selectedSourceId: null,
    });
    return true;
  },

  // --- Background cache mutations ---

  addSourcesInCache: (tabId, newSources) => {
    const cache = get().teamCache;
    const entry = cache.get(tabId);
    if (!entry) return;
    const next = new Map(cache);
    next.set(tabId, {
      ...entry,
      sources: [...entry.sources, ...newSources],
    });
    set({ teamCache: next });
  },

  addRoundInCache: (tabId, round) => {
    const cache = get().teamCache;
    const entry = cache.get(tabId);
    if (!entry) {
      const next = new Map(cache);
      next.set(tabId, { sources: [], rounds: [round] });
      set({ teamCache: next });
      return;
    }
    const next = new Map(cache);
    next.set(tabId, { ...entry, rounds: [...entry.rounds, round] });
    set({ teamCache: next });
  },

  updateRoundInCache: (tabId, roundNum, updates) => {
    const cache = get().teamCache;
    const entry = cache.get(tabId);
    if (!entry) return;
    const next = new Map(cache);
    next.set(tabId, {
      ...entry,
      rounds: entry.rounds.map((r) =>
        r.round === roundNum ? { ...r, ...updates } : r,
      ),
    });
    set({ teamCache: next });
  },
}));
