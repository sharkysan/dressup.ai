import { create } from 'zustand';
import type { Catalog } from '../catalog/catalog';
import type { AvatarMetrics } from '../scene/cameraPose';
import { defaultParams, type AvatarParams, type OutfitItem, type Slot } from '../catalog/params';
import type { Likeness } from '../likeness/types';

export type AvatarStatus = 'loading' | 'ready' | 'error';

export type AppState = {
  params: AvatarParams;
  avatarStatus: AvatarStatus;
  avatarError: string | null;
  catalog: Catalog | null;
  setCatalog: (catalog: Catalog) => void;
  avatarMetrics: AvatarMetrics | null;
  setAvatarMetrics: (metrics: AvatarMetrics | null) => void;
  /** 'none' when bald, else the hairstyle id once its meshes are attached. Set only by HairModel. */
  attachedHair: string;
  setAttachedHair: (id: string) => void;
  setParams: (patch: Partial<AvatarParams>) => void;
  /** The photo face on this device (spec §5), in memory only (§3); null shows the default face. */
  likeness: Likeness | null;
  /** Sets the likeness, and `params.face` to match: 'photo' with one, 'default' without. */
  setLikeness: (likeness: Likeness | null) => void;
  setOutfitItem: (slot: Slot, item: OutfitItem | null) => void;
  setAvatarStatus: (status: AvatarStatus, error?: string) => void;
  reset: () => void;
};

const initialState = {
  params: defaultParams,
  avatarStatus: 'loading' as AvatarStatus,
  avatarError: null,
  catalog: null as Catalog | null,
  avatarMetrics: null as AvatarMetrics | null,
  attachedHair: 'none',
  likeness: null as Likeness | null,
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

  setLikeness: (likeness) =>
    set((s) => ({ likeness, params: { ...s.params, face: likeness ? 'photo' : 'default' } })),

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

  setAvatarMetrics: (metrics) => set({ avatarMetrics: metrics }),

  setAttachedHair: (id) => set({ attachedHair: id }),

  reset: () => set(initialState),
}));
