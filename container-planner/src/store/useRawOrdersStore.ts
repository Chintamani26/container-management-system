import { create } from 'zustand';
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

/** Rows usable for planning/allocation — excludes only rows flagged 'missing_data' (no PO Number
 * and/or no Material Code), since those can't be grouped/identified at all. Every row is still kept
 * in `rawImportedRows` itself (100% row preservation); this filter is applied only at the point
 * planning/allocation consume the data, never to what's stored. */
export const usableRows = (rows: SAPOrderRow[]): SAPOrderRow[] => rows.filter((r) => r.status !== 'missing_data');

/** Holds the imported SAP order extract — deliberately NOT persisted (no localStorage/IndexedDB
 * backing). Session-only: it lives only in memory for the lifetime of the current browser tab, so
 * Step 1 always starts empty on a fresh load/reload, and a file only ever reaches this store when
 * the user actively uploads it in the current session. */
export const useRawOrdersStore = create<RawOrdersState>()((set) => ({
  rawImportedRows: [],
  setRawImportedRows: (rows) => set({ rawImportedRows: rows }),
  removeRows: (ids) => {
    const idSet = new Set(ids);
    set((state) => ({ rawImportedRows: state.rawImportedRows.filter((r) => !idSet.has(r.id)) }));
  },
  clear: () => set({ rawImportedRows: [] }),
}));
