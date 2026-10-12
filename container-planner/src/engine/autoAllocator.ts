import type { AllocatedItem, AllocationStatus, ContainerAllocation, ContainerSpec, ContainerType, CustomerRule, LclAllocation, SAPOrderRow } from '../types';
import { dedupeValidSpecs, normalizeCustomerId, normalizeContainerType } from './ruleResolver';

export interface UnplacedOrder {
  order: SAPOrderRow;
  /** The quantity that didn't make it in — may be less than order.quantity if part of it was
   * placed before the rest stopped fitting anywhere. */
  quantity: number;
  reason: string;
}

export interface AllocationStrategy {
  name: string;
  description: string;
  allocations: ContainerAllocation[];
  lclAllocations: LclAllocation[];
  /** Had a resolvable rule and container type, but didn't physically fit any container (e.g. one
   * line's own weight/CBM exceeds a single container's capacity outright), or couldn't be split /
   * couldn't get a second container per that customer's own rule — never silently dropped, always
   * reported here instead. */
  unplacedOrders: UnplacedOrder[];
  totalContainers: number;
  avgUtilizationPercent: number;
  bottleneckWarnings: string[];
  /** Quantity-based post-allocation reconciliation — true unless input quantity and
   * placed+unplaced+missing-rule quantity disagree, which would mean something was silently
   * dropped. Checked by quantity rather than line count, since consolidateBin legitimately merges
   * same-PO/material lines into one row, which would make a raw line-count check false-positive. */
  reconciliationOk: boolean;
}

export interface AllocationRunResult {
  strategies: AllocationStrategy[];
  /** Only populated when containerSpecs itself has nothing usable to fall back to — a customer
   * with no Customer Rule row at all is no longer rejected outright; it's auto-allocated against
   * the best-fit Container Spec instead (see `softNotices`). This stays non-empty only when there
   * is truly no container spec to default to. */
  missingRuleOrders: SAPOrderRow[];
  /** Orders with a PO quantity of zero or less — can't be packed (there's nothing to place), kept
   * separate from missingRuleOrders since the cause is the data, not an absent rule. */
  invalidOrders: SAPOrderRow[];
  /** Informational, non-blocking notices — e.g. "no Customer Rule for X, defaulted to Container
   * Spec Y" or "rule's own Max Weight/CBM was 0/blank, fell back to the container's physical
   * limit". Surfaced so an admin can still go tighten the real rule, without it blocking the plan. */
  softNotices: string[];
}

type SortMode = 'WEIGHT_DESC' | 'CBM_DESC' | 'BALANCED';

const genId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
const FLOAT_EPSILON = 1e-6;

/** Orders a PO's own lines by the strategy's criterion — PO order itself is never disturbed by
 * this (see sequenceByPO below), only the lines within one PO. */
function sortOrders(orders: SAPOrderRow[], mode: SortMode): SAPOrderRow[] {
  const sorted = [...orders];
  if (mode === 'WEIGHT_DESC') sorted.sort((a, b) => b.weightKg - a.weightKg);
  else if (mode === 'CBM_DESC') sorted.sort((a, b) => b.volumeCbm - a.volumeCbm);
  else sorted.sort((a, b) => b.weightKg / Math.max(b.volumeCbm, FLOAT_EPSILON) - a.weightKg / Math.max(a.volumeCbm, FLOAT_EPSILON));
  return sorted;
}

/** PO-sequential ordering: every line of the first PO encountered, then every line of the next,
 * and so on — a PO is never interleaved with another, and the next PO's lines never appear before
 * the current PO's lines are exhausted. The strategy's sort mode only orders lines *within* a PO. */
function sequenceByPO(orders: SAPOrderRow[], mode: SortMode): SAPOrderRow[] {
  const poOrder: string[] = [];
  const byPO = new Map<string, SAPOrderRow[]>();
  for (const o of orders) {
    if (!byPO.has(o.poNumber)) {
      byPO.set(o.poNumber, []);
      poOrder.push(o.poNumber);
    }
    byPO.get(o.poNumber)!.push(o);
  }
  const sequence: SAPOrderRow[] = [];
  for (const po of poOrder) sequence.push(...sortOrders(byPO.get(po)!, mode));
  return sequence;
}

interface Bin {
  id: string;
  containerType: string;
  items: AllocatedItem[];
  weightKg: number;
  cbm: number;
  /** The true physical+rule limits (the tighter of the two), used for utilisation % and
   * over-limit status — distinct from the lower practical fill *target* the packer aims for. */
  hardCbmCap: number;
  hardWeightCap: number;
  /** The practical fill targets the packer actually packs toward (tolerance-adjusted, and CBM
   * additionally scaled by practicalCbmPercent) — what maxFitInBin budgets against. */
  effWeight: number;
  effCbm: number;
  ruleSource: string;
}

const unitWeight = (o: SAPOrderRow) => (o.quantity > 0 ? o.weightKg / o.quantity : 0);
const unitCbm = (o: SAPOrderRow) => (o.quantity > 0 ? o.volumeCbm / o.quantity : 0);
const unitNetWeight = (o: SAPOrderRow) => (o.quantity > 0 ? (o.netWeightKg ?? o.weightKg) / o.quantity : 0);
const unitCartons = (o: SAPOrderRow) => (o.quantity > 0 ? (o.cartonQty ?? o.quantity) / o.quantity : 0);

function toAllocatedItem(order: SAPOrderRow, placedQty: number, isSplit: boolean): AllocatedItem {
  return {
    orderId: order.id,
    poNumber: order.poNumber,
    customerId: order.customerId,
    customerName: order.customerName,
    plant: order.plant,
    port: order.port,
    materialCode: order.materialCode,
    description: order.description,
    shipDate: order.shipWindow,
    cancelDate: order.cancelDate,
    transportMode: order.transportMode,
    quantity: placedQty,
    poQty: order.quantity,
    cartonQty: Math.round(unitCartons(order) * placedQty * 100) / 100,
    weightKg: unitWeight(order) * placedQty,
    netWeightKg: unitNetWeight(order) * placedQty,
    volumeCbm: unitCbm(order) * placedQty,
    vsnNo: order.vsnNo,
    customerProductCode: order.customerProductCode,
    packMaster: order.packMaster,
    packType: order.packType,
    isSplit,
  };
}

function addToBin(bin: Bin, order: SAPOrderRow, placedQty: number, isSplit: boolean) {
  const item = toAllocatedItem(order, placedQty, isSplit);
  bin.items.push(item);
  bin.weightKg += item.weightKg;
  bin.cbm += item.volumeCbm;
}

/** Consolidates any lines in one bin that share the same PO + material into a single row — this
 * is what a planner expects to see ("one material, one line per container"), and guards against
 * the source extract itself carrying more than one raw row for the same PO/material from looking
 * like the item was arbitrarily fragmented inside one container. */
function consolidateBin(items: AllocatedItem[]): AllocatedItem[] {
  const byKey = new Map<string, AllocatedItem>();
  const order: string[] = [];
  for (const item of items) {
    const key = `${item.poNumber}::${item.materialCode}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      existing.poQty = Math.max(existing.poQty, item.poQty);
      existing.cartonQty = (existing.cartonQty ?? 0) + (item.cartonQty ?? 0);
      existing.weightKg += item.weightKg;
      existing.netWeightKg = (existing.netWeightKg ?? 0) + (item.netWeightKg ?? 0);
      existing.volumeCbm += item.volumeCbm;
      existing.isSplit = existing.isSplit || item.isSplit || existing.quantity < existing.poQty;
    } else {
      byKey.set(key, { ...item });
      order.push(key);
    }
  }
  return order.map((k) => byKey.get(k)!);
}

function finalizeBin(bin: Bin): ContainerAllocation {
  const items = consolidateBin(bin.items);
  const totalWeightKg = items.reduce((s, i) => s + i.weightKg, 0);
  const totalNetWeightKg = items.reduce((s, i) => s + (i.netWeightKg ?? i.weightKg), 0);
  const totalCbm = items.reduce((s, i) => s + i.volumeCbm, 0);
  const weightUtilPercent = (totalWeightKg / bin.hardWeightCap) * 100;
  const cbmUtilPercent = (totalCbm / bin.hardCbmCap) * 100;
  const status: AllocationStatus =
    totalWeightKg > bin.hardWeightCap + FLOAT_EPSILON || totalCbm > bin.hardCbmCap + FLOAT_EPSILON ? 'MICRO_OVERRUN' : 'OK';
  return {
    id: bin.id,
    containerType: bin.containerType,
    items,
    totalWeightKg,
    totalNetWeightKg,
    totalCbm,
    weightUtilPercent,
    cbmUtilPercent,
    status,
    ruleSource: bin.ruleSource,
  };
}

/** How much of `qty` units of `order` can still fit in `bin`'s remaining weight/CBM budget.
 * When `poSplitAllowed` is false, the result is all-or-nothing (either the whole `qty` fits, or 0). */
function maxFitInBin(bin: Bin, order: SAPOrderRow, qty: number, poSplitAllowed: boolean): number {
  const uW = unitWeight(order);
  const uC = unitCbm(order);
  const weightBudget = bin.effWeight - bin.weightKg;
  const cbmBudget = bin.effCbm - bin.cbm;
  const maxByWeight = uW > FLOAT_EPSILON ? Math.floor(weightBudget / uW) : qty;
  const maxByCbm = uC > FLOAT_EPSILON ? Math.floor(cbmBudget / uC) : qty;
  let maxFit = Math.max(0, Math.min(maxByWeight, maxByCbm, qty));
  if (!poSplitAllowed && maxFit < qty) maxFit = 0;
  return maxFit;
}

/**
 * Packs one customer's orders (for one container type) PO by PO (sequenceByPO) as the primary
 * order — a bin stays open and keeps absorbing cartons (from the same line, then the next line,
 * then the next PO) until nothing more in sequence fits, same as before. What's new: before a bin
 * is closed in favour of a fresh one, a gap-fill sweep scans the *rest* of the queue (any PO, not
 * just the next one in sequence) for the best-fitting remaining line and tops the bin off with it —
 * this is what pushes utilisation toward the practical ceiling instead of leaving a container
 * under-filled just because the next line in strict PO order happened not to fit the remaining gap.
 * PO order still governs which line is placed *first* into each bin; the sweep only ever adds lines
 * that would otherwise have waited for a later, possibly-also-partial bin.
 *
 * `rule.poSplitAllowed` — when false, a line (whether placed in sequence or picked up by the sweep)
 * is never fragmented across two containers: it either fits whole, or it waits for a fresh bin (or
 * is reported unplaced if even a fresh bin can't take all of it).
 * `rule.partialShipmentAllowed` — when false, only one container is ever opened for this
 * customer+type; anything beyond that container's capacity is reported unplaced rather than
 * opening a second one.
 */
function packGroup(
  orders: SAPOrderRow[],
  spec: ContainerSpec,
  rule: CustomerRule,
  sortMode: SortMode
): { allocations: ContainerAllocation[]; unplaced: UnplacedOrder[] } {
  // Priority Option drives which dimension the fit is actually optimized against:
  //  - 'Weight': weight is the strict/primary constraint; the rule's own CBM cap is relaxed to the
  //    container's full physical volume (can't relax past physics, but the business cap is ignored).
  //  - 'CBM': the reverse — CBM is strict/primary, the rule's own weight cap is relaxed to the
  //    container's full physical payload.
  //  - 'CartonWeight': both caps apply normally, but lines are forced heaviest-first regardless of
  //    the overall strategy's sort order, so heavy cartons are always packed low/early.
  const effectiveSortMode: SortMode = rule.priorityOption === 'CartonWeight' ? 'WEIGHT_DESC' : sortMode;
  const sequence = sequenceByPO(orders, effectiveSortMode);
  const bins: Bin[] = [];
  const unplaced: UnplacedOrder[] = [];
  let current: Bin | null = null;

  // The true physical+rule limits — a rule's own cap can be configured looser than the container
  // it's actually assigned to, which must never translate into trying to physically overfill that
  // container, so each is still clamped to the container's own physical max even when "relaxed".
  // `rule` here always has 0/blank Max Weight/CBM already backfilled from the container spec by the
  // caller (see withEffectiveLimits in runAutoAllocation) — a 0 cap can never reach this function.
  const hardCbmCap = rule.priorityOption === 'Weight' ? spec.maxCbm : Math.min(rule.maxCbm, spec.maxCbm);
  const hardWeightCap = rule.priorityOption === 'CBM' ? spec.maxPayloadKg : Math.min(rule.maxWeightKg, spec.maxPayloadKg);

  // Fill target: weight aims for the tolerance ceiling above the hard cap (weight is rarely the
  // binding constraint for this kind of cargo, so there's little reason to hold it back). CBM
  // instead aims for a lower *practical* target — real stuffing never reaches the bare physical
  // volume once pallets, bracing and door clearance are accounted for; `practicalCbmPercent`
  // (default 85%) is what this company's own historical plans land on in practice.
  const effWeight = hardWeightCap * (1 + rule.tolerancePercent / 100);
  const effCbm = hardCbmCap * ((spec.practicalCbmPercent ?? 100) / 100) * (1 + rule.tolerancePercent / 100);

  const openNewBin = (): Bin | undefined => {
    if (!rule.partialShipmentAllowed && bins.length >= 1) return undefined; // only one container ever, for this customer+type
    const bin: Bin = { id: genId('CNT'), containerType: spec.type, items: [], weightKg: 0, cbm: 0, hardCbmCap, hardWeightCap, effWeight, effCbm, ruleSource: rule.customerId };
    bins.push(bin);
    current = bin;
    return bin;
  };

  // The whole remaining queue, as mutable {order, qty} slots — the gap-fill sweep needs random
  // access to "everything not yet placed", not just the next line in sequence.
  const remaining = sequence.map((order) => ({ order, qty: order.quantity }));
  const firstPendingIndex = () => remaining.findIndex((e) => e.qty > 0);

  // Scans every slot except `excludeIndex` for whichever remaining line fits the most into `bin`'s
  // current leftover budget, places it, and repeats until nothing more fits. This is the gap-fill
  // pass: it runs right before a bin would otherwise close, so a line further down the queue (a
  // later PO, a smaller carton) can still top off the space a strict PO-sequential fill would have
  // left empty.
  const sweepGapFill = (bin: Bin, excludeIndex: number) => {
    while (true) {
      let bestIndex = -1;
      let bestFit = 0;
      for (let i = 0; i < remaining.length; i++) {
        if (i === excludeIndex || remaining[i].qty <= 0) continue;
        const fit = maxFitInBin(bin, remaining[i].order, remaining[i].qty, rule.poSplitAllowed);
        if (fit > bestFit) {
          bestFit = fit;
          bestIndex = i;
        }
      }
      if (bestIndex === -1) return;
      const slot = remaining[bestIndex];
      addToBin(bin, slot.order, bestFit, bestFit < slot.qty);
      slot.qty -= bestFit;
    }
  };

  while (true) {
    const idx = firstPendingIndex();
    if (idx === -1) break; // everything placed or explicitly marked unplaced
    const slot = remaining[idx];

    const bin = current ?? openNewBin();
    if (!bin) {
      // No more containers allowed for this customer/type (partial shipment off, one already
      // used) — everything still pending is unplaced, not just this one line.
      for (const entry of remaining) {
        if (entry.qty > 0) {
          unplaced.push({ order: entry.order, quantity: entry.qty, reason: `Partial shipment isn't allowed for this customer/type — only one container is permitted and it's already full.` });
          entry.qty = 0;
        }
      }
      break;
    }

    const fit = maxFitInBin(bin, slot.order, slot.qty, rule.poSplitAllowed);
    if (fit > 0) {
      addToBin(bin, slot.order, fit, fit < slot.qty);
      slot.qty -= fit;
      continue;
    }

    // This line doesn't fit what's left of the current bin — before giving up on the bin, sweep
    // the rest of the queue for anything smaller that still fits the remaining gap.
    sweepGapFill(bin, idx);

    if (bin.items.length === 0) {
      // Not even a sweep candidate fit, and the bin never received anything at all — this line (at
      // its current per-unit size) can never fit this container type under this rule, full stop.
      const uW = unitWeight(slot.order);
      const uC = unitCbm(slot.order);
      const reason = `This line (${uW.toFixed(1)} kg / ${uC.toFixed(2)} CBM per unit${!rule.poSplitAllowed ? ', PO split not allowed for this customer' : ''}) doesn't fit a fresh ${spec.type} container under the ${rule.customerId} rule.`;
      unplaced.push({ order: slot.order, quantity: slot.qty, reason });
      slot.qty = 0;
      continue;
    }

    // The bin has something in it and the sweep couldn't add more — close it out and retry this
    // line against a fresh one.
    current = null;
  }

  return { allocations: bins.map(finalizeBin), unplaced };
}

/** F15-style chargeable weight/measure: max(CBM, kg/1000), in tons. */
function chargeableWM(totalCbm: number, totalWeightKg: number): number {
  return Math.max(totalCbm, totalWeightKg / 1000);
}

/** Backfills a rule's Maximum Allowed Weight/CBM from the container spec's own physical limit
 * whenever the rule's own value is 0/null/blank — a rule with an incomplete max is supposed to
 * mean "no tighter business limit than the container itself", never "nothing fits" (which is what
 * happened before: `Math.min(rule.maxWeightKg, spec.maxPayloadKg)` with a 0 rule value collapses
 * the whole container's capacity to 0, silently rejecting every line as "doesn't fit"). Logs a
 * soft, non-blocking notice so the admin still knows to go set the real business limit. */
function withEffectiveLimits(rule: CustomerRule, spec: ContainerSpec, softNotices: string[]): CustomerRule {
  const needsWeightFallback = !(rule.maxWeightKg > 0);
  const needsCbmFallback = !(rule.maxCbm > 0);
  if (!needsWeightFallback && !needsCbmFallback) return rule;
  if (needsWeightFallback) {
    softNotices.push(`${rule.customerId} (${rule.containerType}): Maximum Allowed Weight is 0/blank — defaulted to the ${spec.type} container's physical payload limit (${spec.maxPayloadKg} kg).`);
  }
  if (needsCbmFallback) {
    softNotices.push(`${rule.customerId} (${rule.containerType}): Maximum Allowed CBM is 0/blank — defaulted to the ${spec.type} container's physical CBM limit (${spec.maxCbm}).`);
  }
  return {
    ...rule,
    maxWeightKg: needsWeightFallback ? spec.maxPayloadKg : rule.maxWeightKg,
    maxCbm: needsCbmFallback ? spec.maxCbm : rule.maxCbm,
  };
}

/** Synthesizes a default rule straight from a container spec's own physical limits, for a customer
 * with no Customer Rule row at all (any type). Previously such a customer was rejected outright
 * (`missingRuleOrders`) — now they're allocated against the best-fit container's own physical
 * capacity instead, with a soft notice, so a plan is never blocked purely by missing master data. */
function defaultRuleFromSpec(customerId: string, customerName: string, spec: ContainerSpec): CustomerRule {
  return {
    id: `auto-default-${customerId}-${spec.type}`,
    customerId,
    customerName,
    containerType: spec.type as ContainerType,
    poType: 'Any',
    maxWeightKg: spec.maxPayloadKg,
    maxCbm: spec.maxCbm,
    minWeightKg: 0,
    minCbm: 0,
    tolerancePercent: 0,
    poSplitAllowed: true,
    priorityOption: 'CBM',
    partialShipmentAllowed: true,
  };
}

/**
 * Runs the auto-allocator and returns several alternative strategies — weight-optimized,
 * volume-optimized, and a density-balanced default. Each strategy:
 *   1. For every customer, finds the best-fit container type among that customer's own rule rows
 *      (one CustomerRule row per customer + container type — no country/standard fallback tier),
 *      matching Customer No/Container Type case/whitespace/leading-zero-insensitively, and backfilling
 *      a 0/blank Max Weight/CBM from the container spec's own physical limit. A customer with no rule
 *      row at all gets a default rule synthesized from the best-fit spec instead of being rejected.
 *   2. Routes a customer whose total cargo is below that rule's own minWeightKg/minCbm to LCL
 *      instead of a dedicated container, with its chargeable weight/measure — or, if the customer
 *      has an explicit 'LCL' rule row, uses that row's own thresholds instead.
 *   3. Packs the rest PO-sequentially with a gap-fill sweep (packGroup), honouring that rule's
 *      poSplitAllowed and partialShipmentAllowed flags, filling each container as close to its
 *      practical target as the rule's tolerance allows.
 * Customers are processed in the order their orders first appear in the input, and the resulting
 * container/LCL lists are returned in that same order.
 */
export function runAutoAllocation(orders: SAPOrderRow[], customerRules: CustomerRule[], containerSpecs: ContainerSpec[]): AllocationRunResult {
  // A zero/negative PO quantity means there's nothing to place — without this guard such an order
  // silently vanished (the packing loop below is `while (remainingQty > 0)`, which simply never
  // runs for it), with no trace anywhere that it existed. Pulled out up front and reported
  // instead, same for every strategy since it doesn't depend on sort order.
  const invalidOrders = orders.filter((o) => o.quantity <= 0);
  const validOrders = orders.filter((o) => o.quantity > 0);
  const softNotices: string[] = [];

  // Grouped by normalized Customer No (case/whitespace/leading-zero-insensitive) so an Excel
  // import's own zero-padding inconsistency never splits one customer into two groups, or causes a
  // real rule to be missed. `customerDisplayId` remembers the first-seen raw spelling so warnings
  // and LCL/ruleSource labels still show what the source data actually says, not the normalized key.
  const byCustomer = new Map<string, SAPOrderRow[]>();
  const customerDisplayId = new Map<string, string>();
  for (const order of validOrders) {
    const key = normalizeCustomerId(order.customerId);
    if (!customerDisplayId.has(key)) customerDisplayId.set(key, order.customerId);
    const list = byCustomer.get(key) ?? [];
    list.push(order);
    byCustomer.set(key, list);
  }
  const displayId = (key: string) => customerDisplayId.get(key) ?? key;

  const missingRuleOrders: SAPOrderRow[] = [];
  const sortedSpecs = dedupeValidSpecs(containerSpecs).sort((a, b) => a.maxCbm - b.maxCbm);

  const groupPlan = new Map<string, { spec: ContainerSpec; rule: CustomerRule; lclRule?: CustomerRule }>();
  // A customer with only an explicit 'LCL' row and no physical container type configured —
  // always consolidated, regardless of volume.
  const lclOnlyCustomers = new Map<string, CustomerRule>();

  for (const [customerId, group] of byCustomer) {
    const rulesForCustomer = customerRules.filter((r) => normalizeCustomerId(r.customerId) === customerId);
    // An explicit 'LCL' row is evaluated separately from the physical container types — it isn't
    // itself a container to fit into, it's the threshold for whether this customer's cargo should
    // be consolidated at all before falling through to a physical container.
    const lclRule = rulesForCustomer.find((r) => normalizeContainerType(r.containerType) === 'LCL');
    const allowedTypes = sortedSpecs
      .map((spec) => {
        const rule = rulesForCustomer.find((r) => normalizeContainerType(r.containerType) === normalizeContainerType(spec.type));
        return rule ? { spec, rule: withEffectiveLimits(rule, spec, softNotices) } : undefined;
      })
      .filter((t): t is { spec: ContainerSpec; rule: CustomerRule } => t !== undefined);

    if (allowedTypes.length === 0) {
      if (lclRule) {
        lclOnlyCustomers.set(customerId, lclRule);
        continue;
      }
      if (sortedSpecs.length === 0) {
        // Truly nothing to fall back to — no Customer Rule AND no Container Spec configured at
        // all. This is the only case still reported as missingRuleOrders.
        missingRuleOrders.push(...group);
        continue;
      }
      // No Customer Rule row for this customer at all — default to the best-fit container spec's
      // own physical limits rather than rejecting the whole customer outright.
      const totalWeight0 = group.reduce((s, o) => s + o.weightKg, 0);
      const totalCbm0 = group.reduce((s, o) => s + o.volumeCbm, 0);
      const wholeFitSpec = sortedSpecs.find((s) => totalWeight0 <= s.maxPayloadKg && totalCbm0 <= s.maxCbm) ?? sortedSpecs[sortedSpecs.length - 1];
      softNotices.push(`${displayId(customerId)}: no Customer Rule found for any container type — defaulted to ${wholeFitSpec.type} using that container's own physical limits (${wholeFitSpec.maxPayloadKg} kg / ${wholeFitSpec.maxCbm} CBM).`);
      groupPlan.set(customerId, { spec: wholeFitSpec, rule: defaultRuleFromSpec(displayId(customerId), group[0]?.customerName ?? displayId(customerId), wholeFitSpec) });
      continue;
    }

    const totalWeight = group.reduce((s, o) => s + o.weightKg, 0);
    const totalCbm = group.reduce((s, o) => s + o.volumeCbm, 0);

    // Best fit: the smallest allowed type whose own single-unit capacity (capped by the rule's
    // own limits) can hold the whole group — so a shipment too big for 20 gets routed to 40
    // instead of opening several 20' containers. Falls back to the largest allowed type when
    // nothing fits in one unit, so a multi-container plan uses as few of the biggest as possible.
    const wholeFit = allowedTypes.find(
      (t) => totalWeight <= Math.min(t.spec.maxPayloadKg, t.rule.maxWeightKg) && totalCbm <= Math.min(t.spec.maxCbm, t.rule.maxCbm)
    );
    const chosen = wholeFit ?? allowedTypes[allowedTypes.length - 1];

    groupPlan.set(customerId, { spec: chosen.spec, rule: chosen.rule, lclRule });
  }

  // Customers are processed in the order their orders first appear in the input.
  const orderedCustomers = [...groupPlan.keys()];

  const strategyModes: { name: string; description: string; sortMode: SortMode }[] = [
    { name: 'Balanced Fill', description: 'Packs by weight-to-volume density — a good default for mixed cargo.', sortMode: 'BALANCED' },
    { name: 'Weight-Optimized', description: 'Loads heaviest lines first within each PO, to minimise containers for dense cargo.', sortMode: 'WEIGHT_DESC' },
    { name: 'Volume-Optimized', description: 'Loads bulkiest lines first within each PO, to minimise containers for light/bulky cargo.', sortMode: 'CBM_DESC' },
  ];

  const pushLcl = (lclAllocations: LclAllocation[], customerId: string, group: SAPOrderRow[], sortMode: SortMode, ruleSource: string) => {
    const totalWeight = group.reduce((s, o) => s + o.weightKg, 0);
    const totalCbm = group.reduce((s, o) => s + o.volumeCbm, 0);
    const sequence = sequenceByPO(group, sortMode);
    const items = sequence.map((o) => toAllocatedItem(o, o.quantity, false));
    lclAllocations.push({
      id: genId('LCL'),
      customerId,
      customerName: group[0]?.customerName ?? customerId,
      items,
      totalWeightKg: totalWeight,
      totalCbm,
      chargeableWM: chargeableWM(totalCbm, totalWeight),
      ruleSource,
    });
  };

  const strategies: AllocationStrategy[] = strategyModes.map(({ name, description, sortMode }) => {
    const allocations: ContainerAllocation[] = [];
    const lclAllocations: LclAllocation[] = [];
    const unplacedOrders: UnplacedOrder[] = [];
    const bottleneckWarnings: string[] = [];

    for (const [customerId, lclRule] of lclOnlyCustomers) {
      pushLcl(lclAllocations, displayId(customerId), byCustomer.get(customerId)!, sortMode, `${displayId(customerId)} (LCL)`);
      void lclRule; // no physical fallback to consider — always consolidated
    }

    for (const customerId of orderedCustomers) {
      const plan = groupPlan.get(customerId)!;
      const group = byCustomer.get(customerId)!;
      const { spec, rule, lclRule } = plan;

      const totalWeight = group.reduce((s, o) => s + o.weightKg, 0);
      const totalCbm = group.reduce((s, o) => s + o.volumeCbm, 0);

      // An explicit LCL rule row (if this customer has one) defines its own consolidation
      // threshold via maxWeightKg/maxCbm — cargo at or under it goes LCL. Without one, fall back
      // to the chosen physical rule's own minWeightKg/minCbm as the "too small" heuristic (both
      // default to 0, so this branch never fires unless an admin explicitly set a minimum — a
      // customer is never dumped to LCL just because their rule's max fields were blank).
      const isLcl = lclRule ? totalCbm <= lclRule.maxCbm && totalWeight <= lclRule.maxWeightKg : totalCbm < rule.minCbm || totalWeight < rule.minWeightKg;
      if (isLcl) {
        pushLcl(lclAllocations, displayId(customerId), group, sortMode, lclRule ? `${displayId(customerId)} (LCL)` : displayId(customerId));
        continue;
      }

      const { allocations: groupAllocations, unplaced } = packGroup(group, spec, rule, sortMode);
      allocations.push(...groupAllocations);
      unplacedOrders.push(...unplaced);

      const density = totalWeight / Math.max(totalCbm, FLOAT_EPSILON);
      const limitDensity = rule.maxWeightKg / rule.maxCbm;
      if (Math.abs(density - limitDensity) / limitDensity < 0.1) {
        bottleneckWarnings.push(
          `${displayId(customerId)} (${rule.containerType}): cargo density (${density.toFixed(0)} kg/CBM) is close to the rule's limit ratio (${limitDensity.toFixed(0)} kg/CBM) — both weight and CBM are binding, little slack either way.`
        );
      }
      if (groupAllocations.some((a) => a.status !== 'OK')) {
        bottleneckWarnings.push(`${displayId(customerId)} (${rule.containerType}): one or more containers sit within tolerance but over the rule's hard cap — review before approving.`);
      }
    }

    const totalContainers = allocations.length;
    const avgUtilizationPercent =
      totalContainers === 0 ? 0 : allocations.reduce((s, a) => s + Math.max(a.weightUtilPercent, a.cbmUtilPercent), 0) / totalContainers;

    // Mandatory post-allocation reconciliation — every unit of quantity fed into this strategy
    // must end up either placed (in a container or an LCL group), reported unplaced, or reported
    // missing-rule; if the numbers don't add up, something was silently dropped, which is exactly
    // the class of bug this check exists to catch. Checked by quantity, not line count, since
    // consolidateBin legitimately merges same-PO/material lines into one row.
    const totalInputQty = validOrders.reduce((s, o) => s + o.quantity, 0);
    const placedQty =
      allocations.reduce((s, c) => s + c.items.reduce((s2, i) => s2 + i.quantity, 0), 0) +
      lclAllocations.reduce((s, l) => s + l.items.reduce((s2, i) => s2 + i.quantity, 0), 0);
    const unplacedQty = unplacedOrders.reduce((s, u) => s + u.quantity, 0);
    const missingRuleQty = missingRuleOrders.reduce((s, o) => s + o.quantity, 0);
    const reconciliationOk = totalInputQty === placedQty + unplacedQty + missingRuleQty;
    if (!reconciliationOk) {
      console.error(
        `🚨 Order Reconciliation Mismatch! Strategy: ${name}. Input qty: ${totalInputQty}, Accounted: ${placedQty + unplacedQty + missingRuleQty} (placed ${placedQty}, unplaced ${unplacedQty}, missing-rule ${missingRuleQty}).`
      );
    }

    return { name, description, allocations, lclAllocations, unplacedOrders, totalContainers, avgUtilizationPercent, bottleneckWarnings, reconciliationOk };
  });

  return { strategies, missingRuleOrders: [...new Set(missingRuleOrders)], invalidOrders, softNotices: [...new Set(softNotices)] };
}
