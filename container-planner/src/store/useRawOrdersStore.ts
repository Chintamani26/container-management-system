import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { indexedDbStorage } from './indexedDbStorage';
import type { SAPOrderRow } from '../types';

interface RawOrdersState {
  rawImportedRows: SAPOrderRow[];
  setRawImportedRows: (rows: SAPOrderRow[]) => void;
  /** Drops specific rows (by id) from the imported set — used by the Planning stage's "Skip &
   * Continue" action on a missing-weight warning, so a skipped PO is actually excluded from
   * everything downstream (filtering, allocation), not just hidden in one screen. */
  removeRows: (ids: string[]) => void;
  clear: () => void;
}

/** Holds the full imported SAP order extract. Persisted to IndexedDB rather than localStorage —
 * a real export can be thousands of rows, well past localStorage's ~5MB per-origin quota. */
export const useRawOrdersStore = create<RawOrdersState>()(
  persist(
    (set) => ({
      rawImportedRows: [],
      setRawImportedRows: (rows) => set({ rawImportedRows: rows }),
      removeRows: (ids) => {
        const idSet = new Set(ids);
        set((state) => ({ rawImportedRows: state.rawImportedRows.filter((r) => !idSet.has(r.id)) }));
      },
      clear: () => set({ rawImportedRows: [] }),
    }),
    {
      // v2: bumped alongside the other stores so a stale imported dataset from an earlier schema
      // can't resurface with fields this code doesn't expect.
      name: 'raw-orders-storage-v2',
      storage: createJSONStorage(() => indexedDbStorage),
    }
  )
);
