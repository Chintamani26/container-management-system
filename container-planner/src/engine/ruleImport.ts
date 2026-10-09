import { cellToText, parseNumericCell } from './dynamicSchema';
import type { ContainerSpec, ContainerType, CustomerRule, PoType, PriorityOption } from '../types';

// Exported — also used by Step1ImportWorkspace to normalize the raw Container Type/PO Type text
// an order extract's own rows may carry, when auto-drafting Customer Rule/Container Spec rows.
export const PHYSICAL_TYPE_ALIASES: Record<string, ContainerType> = {
  '20': '20', '20GP': '20', '20FT': '20', '20FEET': '20',
  '40': '40', '40GP': '40', '40FT': '40', '40FEET': '40',
  '40HC': '40 HC', '40 HC': '40 HC', '40HQ': '40 HC',
  LCL: 'LCL',
};

export const PO_TYPE_ALIASES: Record<string, PoType> = {
  OCEAN: 'Ocean',
  'OCEAN HEAVY': 'Ocean Heavy',
  'OCEAN HEVY': 'Ocean Heavy', // matches the real export's own typo
  ANY: 'Any',
};

const PRIORITY_OPTION_ALIASES: Record<string, PriorityOption> = {
  CBM: 'CBM',
  WEIGHT: 'Weight',
  'CARTON WEIGHT': 'CartonWeight',
  CARTONWEIGHT: 'CartonWeight',
};

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Column header aliases for a Customer Rules sheet, keyed by the same normalised-token matching
 * approach as dynamicSchema.ts. Deliberately a separate, small matcher: a rules sheet is a very
 * different shape from an order extract and only needs a handful of fields recognised. */
const RULE_COLUMN_ALIASES: Record<keyof Omit<CustomerRule, 'id' | 'customerName'>, string[]> = {
  customerId: ['customerno', 'customerid', 'custno', 'custid', 'customercode'],
  containerType: ['containertype', 'equipmenttype', 'container'],
  poType: ['potype'],
  maxWeightKg: ['maximumallowedweight', 'maxallowedweight', 'maxweight', 'maximumweight'],
  maxCbm: ['maximumallowedcbm', 'maxallowedcbm', 'maxcbm', 'maximumcbm'],
  minWeightKg: ['minimumallowedweight', 'minallowedweight', 'minweight', 'minimumweight'],
  minCbm: ['minimumallowedcbm', 'minallowedcbm', 'mincbm', 'minimumcbm'],
  tolerancePercent: ['tolerance', 'tolerancepercent'],
  poSplitAllowed: ['posplit', 'posplitallowed'],
  priorityOption: ['priority', 'priorityoption'],
  partialShipmentAllowed: ['partialshipment', 'partialshipmentallowed'],
};

const BOOLEAN_TRUE = new Set(['y', 'yes', 'true', '1', 'allowed']);

function parseBoolean(value: unknown, fallback: boolean): boolean {
  const text = cellToText(value).toLowerCase();
  if (text === '') return fallback;
  return BOOLEAN_TRUE.has(text);
}

/**
 * Recognises a Customer Rules sheet by header shape (needs at least Customer No + Container Type
 * + a max weight/CBM column to count as one — otherwise an unrelated sheet could false-match) and
 * parses it straight into CustomerRule rows. Returns null if the sheet doesn't look like one.
 */
export function tryParseCustomerRulesSheet(columns: string[], rows: Record<string, any>[]): CustomerRule[] | null {
  const colByNorm = new Map(columns.map((c) => [normalise(c), c]));
  const findColumn = (aliases: string[]): string | undefined => {
    for (const alias of aliases) {
      const hit = colByNorm.get(alias);
      if (hit) return hit;
    }
    return undefined;
  };

  const mapping: Partial<Record<keyof typeof RULE_COLUMN_ALIASES, string>> = {};
  for (const [field, aliases] of Object.entries(RULE_COLUMN_ALIASES)) {
    const col = findColumn(aliases);
    if (col) mapping[field as keyof typeof RULE_COLUMN_ALIASES] = col;
  }

  const hasMinimumSignal = mapping.customerId && mapping.containerType && (mapping.maxWeightKg || mapping.maxCbm);
  if (!hasMinimumSignal) return null;

  const rules: CustomerRule[] = [];
  for (const row of rows) {
    const customerId = cellToText(row[mapping.customerId!]);
    const containerTypeRaw = cellToText(row[mapping.containerType!]).toUpperCase().trim();
    if (!customerId || !containerTypeRaw) continue;
    const containerType = PHYSICAL_TYPE_ALIASES[containerTypeRaw] ?? (containerTypeRaw as ContainerType);

    const poTypeRaw = mapping.poType ? cellToText(row[mapping.poType]).toUpperCase().trim() : '';
    const poType: PoType = PO_TYPE_ALIASES[poTypeRaw] ?? 'Any';

    const priorityRaw = mapping.priorityOption ? cellToText(row[mapping.priorityOption]).toUpperCase().trim() : '';
    const priorityOption: PriorityOption = PRIORITY_OPTION_ALIASES[priorityRaw] ?? 'CBM';

    rules.push({
      id: `cust-import-${customerId}-${containerType}-${Math.random().toString(36).slice(2, 7)}`,
      customerId,
      customerName: '', // filled in by the caller from the order sheet's customer directory, if known
      containerType,
      poType,
      maxWeightKg: mapping.maxWeightKg ? parseNumericCell(row[mapping.maxWeightKg]) : 0,
      maxCbm: mapping.maxCbm ? parseNumericCell(row[mapping.maxCbm]) : 0,
      minWeightKg: mapping.minWeightKg ? parseNumericCell(row[mapping.minWeightKg]) : 0,
      minCbm: mapping.minCbm ? parseNumericCell(row[mapping.minCbm]) : 0,
      tolerancePercent: mapping.tolerancePercent ? parseNumericCell(row[mapping.tolerancePercent]) : 0.5,
      poSplitAllowed: mapping.poSplitAllowed ? parseBoolean(row[mapping.poSplitAllowed], true) : true,
      priorityOption,
      partialShipmentAllowed: mapping.partialShipmentAllowed ? parseBoolean(row[mapping.partialShipmentAllowed], true) : true,
    });
  }

  return rules.length > 0 ? rules : null;
}

/** Column header aliases for a Container Specs sheet — the physical dimensions/payload/CBM of
 * each container type, kept separate from Customer Rules since it's a different shape entirely. */
const SPEC_COLUMN_ALIASES: Record<keyof Omit<ContainerSpec, 'id'>, string[]> = {
  type: ['containertype', 'type', 'equipmenttype'],
  internalLengthCm: ['internallengthcm', 'internallength', 'lengthcm', 'length'],
  internalWidthCm: ['internalwidthcm', 'internalwidth', 'widthcm', 'width'],
  internalHeightCm: ['internalheightcm', 'internalheight', 'heightcm', 'height'],
  maxPayloadKg: ['maxpayloadkg', 'maxpayload', 'maximumpayload', 'maxweightkg', 'maxweight'],
  maxCbm: ['maxcbm', 'maximumcbm'],
  tareWeightKg: ['tareweightkg', 'tareweight', 'tare'],
  practicalCbmPercent: ['practicalcbmpercent', 'practicalfillpercent', 'practicalfill', 'fillpercent'],
};

/**
 * Recognises a Container Specs sheet by header shape (needs at least Type + a dimension/payload/
 * CBM column to count as one) and parses it straight into ContainerSpec rows. Returns null if the
 * sheet doesn't look like one.
 */
export function tryParseContainerSpecsSheet(columns: string[], rows: Record<string, any>[]): ContainerSpec[] | null {
  const colByNorm = new Map(columns.map((c) => [normalise(c), c]));
  const findColumn = (aliases: string[]): string | undefined => {
    for (const alias of aliases) {
      const hit = colByNorm.get(alias);
      if (hit) return hit;
    }
    return undefined;
  };

  const mapping: Partial<Record<keyof typeof SPEC_COLUMN_ALIASES, string>> = {};
  for (const [field, aliases] of Object.entries(SPEC_COLUMN_ALIASES)) {
    const col = findColumn(aliases);
    if (col) mapping[field as keyof typeof SPEC_COLUMN_ALIASES] = col;
  }

  const hasMinimumSignal = mapping.type && (mapping.maxPayloadKg || mapping.maxCbm || mapping.internalLengthCm);
  if (!hasMinimumSignal) return null;

  const specs: ContainerSpec[] = [];
  for (const row of rows) {
    const typeRaw = cellToText(row[mapping.type!]).toUpperCase().trim();
    if (!typeRaw) continue;
    const type = PHYSICAL_TYPE_ALIASES[typeRaw] ?? typeRaw;

    specs.push({
      id: `cs-import-${type}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      internalLengthCm: mapping.internalLengthCm ? parseNumericCell(row[mapping.internalLengthCm]) : 0,
      internalWidthCm: mapping.internalWidthCm ? parseNumericCell(row[mapping.internalWidthCm]) : 0,
      internalHeightCm: mapping.internalHeightCm ? parseNumericCell(row[mapping.internalHeightCm]) : 0,
      maxPayloadKg: mapping.maxPayloadKg ? parseNumericCell(row[mapping.maxPayloadKg]) : 0,
      maxCbm: mapping.maxCbm ? parseNumericCell(row[mapping.maxCbm]) : 0,
      tareWeightKg: mapping.tareWeightKg ? parseNumericCell(row[mapping.tareWeightKg]) : 0,
      practicalCbmPercent: mapping.practicalCbmPercent ? parseNumericCell(row[mapping.practicalCbmPercent]) : 85,
    });
  }

  return specs.length > 0 ? specs : null;
}
