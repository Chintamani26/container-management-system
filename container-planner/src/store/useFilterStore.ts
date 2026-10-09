import { create } from 'zustand';
import type { SAPOrderRow } from '../types';

export interface FilterSelections {
  selectedCustomerIds: string[];
  selectedPlants: string[];
  selectedShipWindows: string[];
  selectedPorts: string[];
  selectedPoNumbers: string[];
}

interface FilterState extends FilterSelections {
  setSelectedCustomerIds: (ids: string[]) => void;
  setSelectedPlants: (plants: string[]) => void;
  setSelectedShipWindows: (windows: string[]) => void;
  setSelectedPorts: (ports: string[]) => void;
  setSelectedPoNumbers: (pos: string[]) => void;
  reset: () => void;
}

/** Step 3's "which rows am I planning this round" filter — kept separate from the raw order
 * store so re-filtering never mutates the imported data itself. */
export const useFilterStore = create<FilterState>()((set) => ({
  selectedCustomerIds: [],
  selectedPlants: [],
  selectedShipWindows: [],
  selectedPorts: [],
  selectedPoNumbers: [],
  setSelectedCustomerIds: (ids) => set({ selectedCustomerIds: ids }),
  setSelectedPlants: (plants) => set({ selectedPlants: plants }),
  setSelectedShipWindows: (windows) => set({ selectedShipWindows: windows }),
  setSelectedPorts: (ports) => set({ selectedPorts: ports }),
  setSelectedPoNumbers: (pos) => set({ selectedPoNumbers: pos }),
  reset: () => set({ selectedCustomerIds: [], selectedPlants: [], selectedShipWindows: [], selectedPorts: [], selectedPoNumbers: [] }),
}));

/** Applies the current filter selections to the raw imported rows — empty selection means "no
 * filter on that dimension", not "nothing matches". Customer → Plant → Ship Window → Port is a
 * cascade (each level narrows what's available to the next); PO Number is an independent extra
 * filter on top of wherever the cascade lands.
 *
 * Plant/Ship Window/Port are frequently blank on a real SAP extract (not every row carries every
 * optional field) — a row with no value for one of those fields is never excluded by a filter on
 * that dimension, since the filter simply doesn't apply to it. The alternative (excluding it) is
 * what silently collapsed a seemingly-complete selection to zero rows: each of the three sparse
 * dimensions independently excludes whichever rows lack that one field, and with multiple sparse
 * dimensions filtered at once those exclusions compound until nothing survives all of them, even
 * though every individual level still looked fully selected. Customer and PO Number are required
 * fields on import, so they're excluded by a selection that doesn't match them, as before. */
export function applyFilters(rows: SAPOrderRow[], selections: FilterSelections): SAPOrderRow[] {
  const { selectedCustomerIds, selectedPlants, selectedShipWindows, selectedPorts, selectedPoNumbers } = selections;
  return rows.filter((row) => {
    if (selectedCustomerIds.length > 0 && !selectedCustomerIds.includes(row.customerId)) return false;
    if (selectedPlants.length > 0 && row.plant && !selectedPlants.includes(row.plant)) return false;
    if (selectedShipWindows.length > 0 && row.shipWindow && !selectedShipWindows.includes(row.shipWindow)) return false;
    if (selectedPorts.length > 0 && row.port && !selectedPorts.includes(row.port)) return false;
    if (selectedPoNumbers.length > 0 && !selectedPoNumbers.includes(row.poNumber)) return false;
    return true;
  });
}

/** Distinct, non-empty values of one field among `rows` — used to compute each cascade level's
 * available options from whatever the levels above it have already narrowed down to. */
export function distinctValues(rows: SAPOrderRow[], field: 'customerId' | 'plant' | 'shipWindow' | 'port' | 'poNumber'): string[] {
  return [...new Set(rows.map((r) => r[field]).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
