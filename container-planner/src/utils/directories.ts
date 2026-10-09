import type { SAPOrderRow } from '../types';

/** Customer id -> name, derived straight from the imported order extract — this is what lets a
 * customer's name show up automatically everywhere (planning filters, rule dropdowns) the moment
 * a file is imported, without requiring an admin to type it into a rule first. */
export function buildCustomerDirectory(rows: SAPOrderRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.customerId && row.customerName && !map.has(row.customerId)) {
      map.set(row.customerId, row.customerName);
    }
  }
  return map;
}

/** Distinct destination/country values (the `port` field) seen in the imported extract, for the
 * Country Rule dropdown. */
export function buildCountryDirectory(rows: SAPOrderRow[]): string[] {
  return [...new Set(rows.map((r) => r.port).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b));
}
