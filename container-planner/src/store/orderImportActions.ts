import { useRawOrdersStore } from './useRawOrdersStore';
import type { SAPOrderRow } from '../types';

/** Replaces the imported order set with `rows` — the single entry point both the Excel importer
 * and the first-launch sample-data seed go through, so there's one place that decides what
 * "importing orders" means. */
export function applyImportedOrders(rows: SAPOrderRow[]): void {
  useRawOrdersStore.getState().setRawImportedRows(rows);
}
