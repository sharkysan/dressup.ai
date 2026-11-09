import type { useAppStore } from '../src/store/useAppStore';

declare global {
  interface Window {
    __kiss?: { store: typeof useAppStore };
  }
}
export {};
