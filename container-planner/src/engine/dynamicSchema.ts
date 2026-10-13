export type CanonicalField =
  | 'poNumber'
  | 'customerId'
  | 'customerName'
  | 'plant'
  | 'shipWindow'
  | 'country'
  | 'port'
  | 'weightKg'
  | 'netWeightKg'
  | 'volumeCbm'
  | 'materialCode'
  | 'description'
  | 'quantity'
  | 'cartonQty'
  | 'vsnNo'
  | 'customerProductCode'
  | 'packMaster'
  | 'packType'
  | 'packType2'
  | 'cancelDate'
  | 'transportMode'
  | 'containerType'
  | 'poType';

export const CANONICAL_FIELD_LABELS: Record<CanonicalField, string> = {
  poNumber: 'PO Number',
  customerId: 'Customer',
  customerName: 'Customer Name',
  plant: 'Plant',
  shipWindow: 'Ship Window',
  country: 'Country',
  port: 'Destination Port / Ship-To Point',
  weightKg: 'Gross Weight',
  netWeightKg: 'Net Weight',
  volumeCbm: 'Volume',
  materialCode: 'Material Code',
  description: 'Description',
  quantity: 'PO Quantity',
  cartonQty: 'Carton Quantity',
  vsnNo: 'VSN No',
  customerProductCode: 'Customer Product Code',
  packMaster: 'Pack Master',
  packType: 'Pack Type',
  packType2: 'Pack Type 2',
  cancelDate: 'Cancel Date',
  transportMode: 'Transport Mode',
  containerType: 'Container Type',
  poType: 'PO Type',
};

// Aliases are compared as whole tokens (see mapCanonicalFields below), so 'Gross Weight (kg)',
// 'gross_weight' and 'GrossWeight' all resolve the same way, and a short alias like "cbm" can't
// match mid-word inside an unrelated header. Covers both friendly headers (a hand-built extract)
// and common SAP/ERP field names (e.g. "Sold-to Party", "Werks") since real exports rarely match
// a template exactly.
const CANONICAL_ALIASES: Record<CanonicalField, readonly string[]> = {
  poNumber: ['ponumber', 'po', 'purchaseorder', 'pono', 'ordernumber', 'salesorder', 'salesdocument', 'docno', 'document'],
  customerId: ['customerid', 'custid', 'customercode', 'customer', 'soldto', 'soldtoparty', 'soldtocode', 'accountnumber', 'buyercode', 'partyid'],
  customerName: ['customername', 'customerdescription', 'custname', 'soldtoname', 'accountname'],
  plant: ['plant', 'plantcode', 'werks', 'site', 'plantname', 'facility', 'distributioncenter', 'shippingpoint'],
  // "Delivery Date" is deliberately excluded: it's when the order is expected to arrive, a
  // different thing from "Ship Window" (when it ships), and real exports have both.
  shipWindow: ['shipwindow', 'shipweek', 'shipdate', 'window', 'week', 'loadingdate', 'etd'],
  // A plain "Country" / destination-country column — distinct from `port`, which is a specific
  // delivery point/warehouse name (e.g. "DELTA DC 411"), not a country. Country Rules match
  // against this field; conflating the two means a country rule like "USA" would never match a
  // row whose "port" field actually holds a specific ship-to location name.
  country: ['country', 'destinationcountry', 'shiptocountry', 'shiptopartycountry', 'countryname', 'shipcountry'],
  // Bare "destination" is deliberately excluded: too generic, it over-matches headers like
  // "Destination Code" or "Destination Region" that aren't the shipping port.
  port: ['destinationport', 'port', 'portname', 'portofdischarge', 'pod', 'dischargeport', 'podname', 'destport', 'shiptopartyname', 'shiptoparty'],
  weightKg: ['grossweightkg', 'grossweight', 'weightkg', 'weight', 'wt', 'grosswt', 'kg', 'totalweight', 'totalgrossweight'],
  netWeightKg: ['netweightkg', 'netweight', 'netwt', 'nwt', 'totalnetweight'],
  volumeCbm: ['volumecbm', 'volume', 'cbm', 'vol', 'volumem3', 'cbmvolume', 'totalvolume', 'totalcbm', 'cubicmeters'],
  materialCode: ['materialcode', 'material', 'matnr', 'sku', 'itemcode', 'productcode'],
  description: ['description', 'materialdescription', 'desc', 'itemdescription'],
  quantity: ['quantity', 'qty', 'orderqty', 'poqty', 'poquantity', 'pieces'],
  cartonQty: ['cartonqty', 'cartonquantity', 'cartons', 'noofcartons', 'nooofcartons', 'ctnqty', 'totalcartons', 'cartoncount'],
  vsnNo: ['vsnno', 'vsn', 'vsnnumber'],
  customerProductCode: ['customerproductcode', 'custproductcode', 'customeritemcode', 'custitemcode', 'buyerproductcode', 'customermaterialcode'],
  packMaster: ['packmaster', 'packingmaster', 'packmasterno', 'packmastercode'],
  packType: ['packtype', 'packagingtype', 'packingtype'],
  packType2: ['packtype2', 'packagingtype2', 'packingtype2'],
  cancelDate: ['canceldate', 'plantcanceldate', 'cancellationdate'],
  transportMode: ['transportmode', 'modeoftransport', 'shipmentmode', 'shipby'],
  // Raw text only — used to auto-draft a matching Customer Rule/Container Spec row on import, not
  // for allocation itself (the allocator only ever reads containerType/poType off a CustomerRule).
  containerType: ['containertype', 'equipmenttype', 'containersize'],
  poType: ['potype'],
};

/**
 * Columns that make a weight/volume/etc. header a worse pick even when it matches an alias — a
 * per-handling-unit or actual/booked figure (e.g. "Pallet GrossWt(Kg)", "ACT Gr Wt") is usually
 * the wrong number for a PO line's total, compared to a plainly-named or "Total ..." column.
 * Only used to break ties when more than one column matches the same field.
 */
const DISFAVORED_TOKENS: Partial<Record<CanonicalField, readonly string[]>> = {
  weightKg: ['pallet', 'carton', 'unit', 'act', 'actual'],
  netWeightKg: ['pallet', 'carton', 'unit', 'act', 'actual'],
  volumeCbm: ['pallet', 'carton', 'unit', 'act', 'actual'],
  // "port" alone is common in date/status phrases like "Cargo Recv. Dt. At Port" or "ETA At Port" —
  // disfavor those so an actual port-name/code column (e.g. "Port Name") wins instead.
  port: ['dt', 'date', 'recv', 'eta', 'etd', 'received'],
};

const FIELDS = Object.keys(CANONICAL_ALIASES) as CanonicalField[];

const normalise = (header: string): string => header.toLowerCase().replace(/[^a-z0-9]/g, '');

const tokensOf = (header: string): string[] =>
  header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/** Every contiguous run of a header's words, concatenated — e.g. "Total Gross Weight" gives
 * {total, totalgross, totalgrossweight, gross, grossweight, weight}. A short alias like "cbm" can
 * only match a run that is exactly "cbm" as whole words, never a fragment of a longer word. */
function candidatesOf(header: string): Set<string> {
  const tokens = tokensOf(header);
  const candidates = new Set<string>();
  for (let start = 0; start < tokens.length; start++) {
    let acc = '';
    for (let end = start; end < tokens.length; end++) {
      acc += tokens[end];
      candidates.add(acc);
    }
  }
  return candidates;
}

/** Returns every distinct key across all rows, in order of first appearance. */
export function detectColumns(jsonRows: Record<string, any>[]): string[] {
  const seen = new Set<string>();
  for (const row of jsonRows) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return [...seen];
}

/**
 * Maps raw column headers to canonical fields. Unmatched headers are left out — this never throws,
 * so a real export with headers we don't recognise degrades to "that field isn't available" rather
 * than blocking the import.
 *
 * For each field, in column order:
 * 1. A header whose ENTIRE normalised text equals an alias wins immediately (least ambiguous).
 * 2. Otherwise, the first header where an alias matches a whole word/phrase within it (never a
 *    mid-word fragment — "Export ID" can't match the "port" alias just because it contains "port"
 *    as letters) — preferring one that avoids `DISFAVORED_TOKENS` for that field, if any such
 *    header exists.
 * If two headers would otherwise match the same field, the one that comes first wins.
 */
export function mapCanonicalFields(columns: string[]): Partial<Record<CanonicalField, string>> {
  const mapping: Partial<Record<CanonicalField, string>> = {};
  const parsed = columns.map((column) => ({
    column,
    full: normalise(column),
    candidates: candidatesOf(column),
    tokens: tokensOf(column),
  }));

  for (const field of FIELDS) {
    const aliases = CANONICAL_ALIASES[field];
    const disfavored = DISFAVORED_TOKENS[field];

    const exact = parsed.find((c) => aliases.includes(c.full));
    if (exact) {
      mapping[field] = exact.column;
      continue;
    }

    const isPartialMatch = (c: (typeof parsed)[number]) => aliases.some((alias) => c.candidates.has(alias));
    const isDisfavored = (c: (typeof parsed)[number]) => disfavored?.some((token) => c.tokens.includes(token)) ?? false;

    const preferred = parsed.find((c) => isPartialMatch(c) && !isDisfavored(c));
    const fallback = preferred ?? parsed.find((c) => isPartialMatch(c));
    if (fallback) mapping[field] = fallback.column;
  }

  return mapping;
}

/**
 * Renders any cell value as stable display/matching text — used consistently everywhere a cell
 * becomes a filter option or gets compared against one, so a value is never shown one way and
 * matched another. Handles the cell types SheetJS can hand back beyond plain strings/numbers:
 * a `Date` (a date-formatted Excel cell parsed with `cellDates`), a boolean, or (rarely) something
 * exotic that still has a sensible `toString()`.
 */
export function cellToText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/**
 * Parses a numeric cell that may carry thousands separators, units, or surrounding whitespace —
 * e.g. "17,536", "12 kg", "500 mm", " 0 " — all of which `Number(...)` alone turns into `NaN`
 * (silently becoming 0 downstream). Strips everything except digits, a single leading minus and
 * one decimal point before parsing. Returns 0 for empty/unparseable input, same as the old
 * `Number(x) || 0` callers relied on, but now actually parsing the number first.
 */
export function parseNumericCell(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = cellToText(value);
  if (text === '') return 0;
  const isNegative = /^-/.test(text.trim());
  const cleaned = text.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  const normalised = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  const n = parseFloat(normalised);
  if (!Number.isFinite(n)) return 0;
  return isNegative ? -n : n;
}

/** Returns the distinct, non-empty values of one column, sorted for display. */
export function extractFilterOptions(rows: Record<string, any>[], columnKey: string): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    const text = cellToText(row[columnKey]);
    if (text !== '') values.add(text);
  }
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
