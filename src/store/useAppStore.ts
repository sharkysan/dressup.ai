import { create } from 'zustand';
import type { Catalog } from '../catalog/catalog';
import { defaultParams, type AvatarParams, type OutfitItem, type Slot } from '../catalog/params';

export type AvatarStatus = 'loading' | 'ready' | 'error';

export type AppState = {
  params: AvatarParams;
  avatarStatus: AvatarStatus;
  avatarError: string | null;
  catalog: Catalog | null;
  setCatalog: (catalog: Catalog) => void;
  setParams: (patch: Partial<AvatarParams>) => void;
  setOutfitItem: (slot: Slot, item: OutfitItem | null) => void;
  setAvatarStatus: (status: AvatarStatus, error?: string) => void;
  reset: () => void;
};

const initialState = {
  params: defaultParams,
  avatarStatus: 'loading' as AvatarStatus,
  avatarError: null,
  catalog: null as Catalog | null,
};

/** `full` (dress/jumpsuit) occupies top+bottom, so the three can never coexist (spec §5). */
function withOutfitRules(outfit: AvatarParams['outfit'], slot: Slot): AvatarParams['outfit'] {
  const next = { ...outfit };
  if (slot === 'full') {
    delete next.top;
    delete next.bottom;
  } else if (slot === 'top' || slot === 'bottom') {
    delete next.full;
  }
  return next;
}

export const useAppStore = create<AppState>()((set) => ({
  ...initialState,

  setParams: (patch) => set((s) => ({ params: { ...s.params, ...patch } })),

  setOutfitItem: (slot, item) =>
    set((s) => {
      // Exclusivity applies when *setting* a slot (spec §5); clearing one never evicts another.
      const outfit = item ? withOutfitRules(s.params.outfit, slot) : { ...s.params.outfit };
      if (item) outfit[slot] = item;
      else delete outfit[slot];
      return { params: { ...s.params, outfit } };
    }),

  setAvatarStatus: (status, error) =>
    set({
      avatarStatus: status,
      avatarError: status === 'error' ? (error ?? 'Unknown error') : null,
    }),

  setCatalog: (catalog) => set({ catalog }),

  reset: () => set(initialState),
}));
