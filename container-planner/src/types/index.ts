// ---------------------------------------------------------------------------
// Container Planner — shared types.
// ---------------------------------------------------------------------------

export type UserRole = 'ADMIN' | 'PLANNER' | 'VIEWER';

export type AllocationStatus = 'OK' | 'MICRO_OVERRUN' | 'OVER_LIMIT' | 'MISSING_RULE';

/** One row from an imported SAP order extract (after column mapping via dynamicSchema.ts). */
export interface SAPOrderRow {
  id: string;
  poNumber: string;
  customerId: string;
  customerName: string;
  plant?: string;
  shipWindow?: string;
  /** Destination country (e.g. "USA", "Canada") — what Country Rules match against. */
  country?: string;
  /** A specific delivery point/warehouse name (e.g. "DELTA DC 411") — distinct from `country`,
   * used only for display/filtering, never for rule resolution. */
  port?: string;
  materialCode: string;
  description?: string;
  cancelDate?: string;
  transportMode?: string;
  /** PO quantity — the ordered quantity on the PO line (pieces). */
  quantity: number;
  /** Carton quantity, when the file distinguishes it from PO quantity (pieces vs cartons). Falls
   * back to `quantity` when the file has no separate carton-count column. */
  cartonQty?: number;
  weightKg: number;
  /** Net weight, when the file provides it separately from gross weight. Falls back to `weightKg`
   * when absent. */
  netWeightKg?: number;
  volumeCbm: number;
  vsnNo?: string;
  customerProductCode?: string;
  packMaster?: string;
  packType?: string;
  /** Raw container type text straight from the file (e.g. "40HC", "LCL"), if the order extract
   * carries its own Container Type column — used only to auto-draft a matching Customer Rule /
   * Container Spec row on import, normalized against the same aliases as a dedicated rules sheet. */
  containerType?: string;
  /** Raw PO type text straight from the file (e.g. "Ocean", "OCEAN HEVY"), if present — same
   * auto-draft purpose as `containerType`, distinct from `transportMode`. */
  poType?: string;
  /** Data-quality flag computed at import time — every row is kept in state regardless of this
   * value (100% row preservation; nothing is silently dropped), but it drives what the Planning
   * stage and allocator do with the row. 'missing_data' means the row couldn't even be identified
   * (no PO Number and/or no Material Code); 'zero_qty' means quantity <= 0; 'missing_weight' means
   * quantity > 0 but weight is null/0. Checked in that priority order — a row gets one flag, not a
   * combination. Absent/undefined means the row is clean. */
  status?: 'missing_data' | 'zero_qty' | 'missing_weight';
}

/** Physical container types a ContainerSpec can describe. "LCL" is not physical — it's a
 * CustomerRule-only value meaning "this customer's cargo for this scope is always consolidated,
 * never booked a dedicated container". */
export type PhysicalContainerType = '20' | '40' | '40 HC';
export type ContainerType = PhysicalContainerType | 'LCL';

export type PoType = 'Ocean' | 'Ocean Heavy' | 'Any';

/** Which dimension drives how a customer's cargo is optimized into a container:
 *  - 'CBM': fit primarily by volume — the rule's own weight cap is relaxed to the container's
 *    physical payload, CBM is the binding constraint.
 *  - 'Weight': fit primarily by weight — the rule's own CBM cap is relaxed to the container's
 *    physical volume, weight is the binding constraint.
 *  - 'CartonWeight': both caps apply normally, but lines are always packed heaviest-carton-first
 *    (packed low/early) for this customer, regardless of the overall strategy's sort order. */
export type PriorityOption = 'CBM' | 'Weight' | 'CartonWeight';

/**
 * One row per customer + container type — this is the *only* rule tier (country/standard rules
 * were removed; a customer with no row here for a given type simply isn't allocatable into it, a
 * MISSING_RULE case). A row with containerType 'LCL' marks that customer as always-consolidate
 * for this scope, overriding the min-weight/min-cbm heuristic used when no such row exists.
 */
export interface CustomerRule {
  id: string;
  /** "Customer No" */
  customerId: string;
  /** Auto-filled from the imported file's customer directory — not a hand-typed field. */
  customerName: string;
  containerType: ContainerType;
  poType: PoType;
  maxWeightKg: number;
  maxCbm: number;
  /** Below this, a customer's cargo for this container type doesn't justify a dedicated container
   * and is routed to LCL instead (used when this customer has no explicit 'LCL' rule row). */
  minWeightKg: number;
  minCbm: number;
  /** Allowed overrun above maxWeightKg/maxCbm before a container is flagged MICRO_OVERRUN. */
  tolerancePercent: number;
  /** When false, a PO line must be kept whole in one container — it's never split across two to
   * fill each as full as possible, even if that leaves more empty space. */
  poSplitAllowed: boolean;
  priorityOption: PriorityOption;
  /** When false, this customer's entire cargo for this type must fit in a single container — any
   * excess is reported as unplaced rather than opening a second container. */
  partialShipmentAllowed: boolean;
}

export type HandlingUnitType = 'pallet' | 'slip_sheet' | 'carton';

export interface HandlingUnitRule {
  id: string;
  appliesToCustomerId: string;
  shipToLocation?: string;
  basedOnTemplateId?: string;
  code: string;
  type: HandlingUnitType;
  name: string;
  dimensions: { lengthCm: number; widthCm: number; heightCm: number };
  weights: { tareKg: number; maxGrossKg: number; maxLoadedHeightCm: number };
  constraints: { stackLevels: number; overhangCm: number };
  caps: { practical20ft: number; practical40ft: number; practical40hc: number };
}

export interface ContainerSpec {
  id: string;
  type: string;
  internalLengthCm: number;
  internalWidthCm: number;
  internalHeightCm: number;
  maxPayloadKg: number;
  maxCbm: number;
  tareWeightKg: number;
  /** Realistic loading target as a % of maxCbm — real stuffing never reaches the bare physical
   * volume (pallets, bracing, door clearance all eat into it). Defaults to 85% when unset, which
   * matches what this company's own historical container plans land on in practice. Weight has no
   * equivalent field: the rule's own maxWeightKg already reflects the real-world limit, and
   * for this kind of light/bulky cargo weight is rarely the binding constraint anyway. */
  practicalCbmPercent?: number;
}

export interface AllocatedItem {
  orderId: string;
  poNumber: string;
  customerId: string;
  customerName: string;
  plant?: string;
  port?: string;
  materialCode: string;
  description?: string;
  shipDate?: string;
  cancelDate?: string;
  transportMode?: string;
  /** PO quantity placed in this container (may be less than the order's full PO quantity if the
   * order had to be split across containers to fill each one as close to capacity as possible). */
  quantity: number;
  /** The order's full original PO quantity, for display, regardless of how it was split. */
  poQty: number;
  cartonQty?: number;
  weightKg: number;
  netWeightKg?: number;
  volumeCbm: number;
  vsnNo?: string;
  customerProductCode?: string;
  packMaster?: string;
  packType?: string;
  /** True when this line is part of an order that was split across more than one container to
   * keep each container as full as possible. */
  isSplit: boolean;
}

export interface ContainerAllocation {
  id: string;
  containerType: string;
  items: AllocatedItem[];
  totalWeightKg: number;
  totalNetWeightKg: number;
  totalCbm: number;
  weightUtilPercent: number;
  cbmUtilPercent: number;
  status: AllocationStatus;
  /** Which rule set was applied: the customer id, country, or 'STANDARD'. */
  ruleSource: string;
}

/** A customer/country group whose total cargo falls below the LCL threshold — too small to
 * justify booking a dedicated container, consolidated instead with chargeable weight/measure. */
export interface LclAllocation {
  id: string;
  customerId: string;
  customerName: string;
  items: AllocatedItem[];
  totalWeightKg: number;
  totalCbm: number;
  /** F15-style chargeable weight/measure in tons: max(CBM, kg/1000). */
  chargeableWM: number;
  ruleSource: string;
}

export interface DraftPlan {
  draftId: string;
  createdAt: string;
  createdBy: string;
  allocations: ContainerAllocation[];
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  strategyName?: string;
}

export interface ConfirmedPlan {
  planId: string;
  draftId: string;
  confirmedAt: string;
  confirmedBy: string;
  allocations: ContainerAllocation[];
}

export interface CargoBlock {
  id: string;
  label: string;
  xCm: number;
  yCm: number;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  weightKg: number;
}

export interface GravityResult {
  xCgCm: number;
  yCgCm: number;
  zCgCm: number;
  offsetXPercent: number;
  offsetYPercent: number;
  verdict: 'OK' | 'WARNING';
}
