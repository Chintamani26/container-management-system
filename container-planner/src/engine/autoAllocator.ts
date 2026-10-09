import type { AllocatedItem, AllocationStatus, ContainerAllocation, ContainerSpec, CustomerRule, LclAllocation, SAPOrderRow } from '../types';
import { dedupeValidSpecs } from './ruleResolver';

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
}

export interface AllocationRunResult {
  strategies: AllocationStrategy[];
  missingRuleOrders: SAPOrderRow[];
  /** Orders with a PO quantity of zero or less — can't be packed (there's nothing to place), kept
   * separate from missingRuleOrders since the cause is the data, not an absent rule. */
  invalidOrders: SAPOrderRow[];
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

/**
 * Packs one customer's orders (for one container type) PO by PO (sequenceByPO) — the current PO's
 * lines are fully placed, splitting a line across containers as needed to fill each one as close
 * to its practical target as possible, before the next PO's lines are even considered. This is a
 * waterfall fill: a bin stays open and keeps absorbing cartons (from the same line, then the next
 * line, then the next PO) until it's full or nothing more fits, only then opening the next bin.
 *
 * `rule.poSplitAllowed` — when false, a line is never fragmented across two containers: if it
 * doesn't fully fit what's left of the current bin, a fresh bin is opened for it whole (or, if it
 * doesn't fit a fresh bin either, it's reported unplaced rather than split).
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
  const hardCbmCap = rule.priorityOption === 'Weight' ? spec.maxCbm : Math.min(rule.maxCbm, spec.maxCbm);
  const hardWeightCap = rule.priorityOption === 'CBM' ? spec.maxPayloadKg : Math.min(rule.maxWeightKg, spec.maxPayloadKg);

  const openNewBin = (): Bin | undefined => {
    if (!rule.partialShipmentAllowed && bins.length >= 1) return undefined; // only one container ever, for this customer+type
    const bin: Bin = { id: genId('CNT'), containerType: spec.type, items: [], weightKg: 0, cbm: 0, hardCbmCap, hardWeightCap, ruleSource: rule.customerId };
    bins.push(bin);
    current = bin;
    return bin;
  };

  // Fill target: weight aims for the tolerance ceiling above the hard cap (weight is rarely the
  // binding constraint for this kind of cargo, so there's little reason to hold it back). CBM
  // instead aims for a lower *practical* target — real stuffing never reaches the bare physical
  // volume once pallets, bracing and door clearance are accounted for; `practicalCbmPercent`
  // (default 85%) is what this company's own historical plans land on in practice.
  const effWeight = hardWeightCap * (1 + rule.tolerancePercent / 100);
  const effCbm = hardCbmCap * ((spec.practicalCbmPercent ?? 100) / 100) * (1 + rule.tolerancePercent / 100);

  for (const order of sequence) {
    let remainingQty = order.quantity;
    const uW = unitWeight(order);
    const uC = unitCbm(order);

    while (remainingQty > 0) {
      const bin = current ?? openNewBin();
      if (!bin) {
        unplaced.push({ order, quantity: remainingQty, reason: `Partial shipment isn't allowed for this customer/type — only one container is permitted and it's already full.` });
        break;
      }

      const weightBudget = effWeight - bin.weightKg;
      const cbmBudget = effCbm - bin.cbm;
      const maxByWeight = uW > FLOAT_EPSILON ? Math.floor(weightBudget / uW) : remainingQty;
      const maxByCbm = uC > FLOAT_EPSILON ? Math.floor(cbmBudget / uC) : remainingQty;
      let maxFit = Math.max(0, Math.min(maxByWeight, maxByCbm, remainingQty));

      // PO-split not allowed: a line only goes into this bin if it fits *whole*, otherwise it
      // waits for a fresh bin (or becomes unplaced if even a fresh bin can't take all of it).
      if (!rule.poSplitAllowed && maxFit < remainingQty) maxFit = 0;

      if (maxFit <= 0) {
        if (bin.items.length === 0) {
          const reason = !rule.poSplitAllowed && uW * remainingQty <= effWeight && uC * remainingQty <= effCbm
            ? 'Internal consistency check failed — should have fit a fresh container.'
            : `This line (${uW.toFixed(1)} kg / ${uC.toFixed(2)} CBM per unit${!rule.poSplitAllowed ? ', PO split not allowed for this customer' : ''}) doesn't fit a fresh ${spec.type} container under the ${rule.customerId} rule.`;
          unplaced.push({ order, quantity: remainingQty, reason });
          break;
        }
        const next = openNewBin();
        if (!next) {
          unplaced.push({ order, quantity: remainingQty, reason: `Partial shipment isn't allowed for this customer/type — only one container is permitted and it's already full.` });
          break;
        }
        continue;
      }

      addToBin(bin, order, maxFit, maxFit < order.quantity);
      remainingQty -= maxFit;
    }
  }

  return { allocations: bins.map(finalizeBin), unplaced };
}

/** F15-style chargeable weight/measure: max(CBM, kg/1000), in tons. */
function chargeableWM(totalCbm: number, totalWeightKg: number): number {
  return Math.max(totalCbm, totalWeightKg / 1000);
}

/**
 * Runs the auto-allocator and returns several alternative strategies — weight-optimized,
 * volume-optimized, and a density-balanced default. Each strategy:
 *   1. For every customer, finds the best-fit container type among that customer's own rule rows
 *      (one CustomerRule row per customer + container type — no country/standard fallback tier).
 *   2. Routes a customer whose total cargo is below that rule's own minWeightKg/minCbm to LCL
 *      instead of a dedicated container, with its chargeable weight/measure.
 *   3. Packs the rest PO-sequentially (packGroup), honouring that rule's poSplitAllowed and
 *      partialShipmentAllowed flags, filling each container as close to its practical target as
 *      the rule's tolerance allows.
 * Customers are processed in ascending `priority` order (lower number first), and the resulting
 * container/LCL lists are returned in that same order.
 */
export function runAutoAllocation(orders: SAPOrderRow[], customerRules: CustomerRule[], containerSpecs: ContainerSpec[]): AllocationRunResult {
  // A zero/negative PO quantity means there's nothing to place — without this guard such an order
  // silently vanished (the packing loop below is `while (remainingQty > 0)`, which simply never
  // runs for it), with no trace anywhere that it existed. Pulled out up front and reported
  // instead, same for every strategy since it doesn't depend on sort order.
  const invalidOrders = orders.filter((o) => o.quantity <= 0);
  const validOrders = orders.filter((o) => o.quantity > 0);

  const byCustomer = new Map<string, SAPOrderRow[]>();
  for (const order of validOrders) {
    const list = byCustomer.get(order.customerId) ?? [];
    list.push(order);
    byCustomer.set(order.customerId, list);
  }

  const missingRuleOrders: SAPOrderRow[] = [];
  const sortedSpecs = dedupeValidSpecs(containerSpecs).sort((a, b) => a.maxCbm - b.maxCbm);

  const groupPlan = new Map<string, { spec: ContainerSpec; rule: CustomerRule; lclRule?: CustomerRule }>();
  // A customer with only an explicit 'LCL' row and no physical container type configured —
  // always consolidated, regardless of volume.
  const lclOnlyCustomers = new Map<string, CustomerRule>();

  for (const [customerId, group] of byCustomer) {
    const rulesForCustomer = customerRules.filter((r) => r.customerId === customerId);
    // An explicit 'LCL' row is evaluated separately from the physical container types — it isn't
    // itself a container to fit into, it's the threshold for whether this customer's cargo should
    // be consolidated at all before falling through to a physical container.
    const lclRule = rulesForCustomer.find((r) => r.containerType === 'LCL');
    const allowedTypes = sortedSpecs
      .map((spec) => {
        const rule = rulesForCustomer.find((r) => r.containerType === spec.type);
        return rule ? { spec, rule } : undefined;
      })
      .filter((t): t is { spec: ContainerSpec; rule: CustomerRule } => t !== undefined);

    if (allowedTypes.length === 0) {
      if (lclRule) lclOnlyCustomers.set(customerId, lclRule);
      else missingRuleOrders.push(...group);
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
      pushLcl(lclAllocations, customerId, byCustomer.get(customerId)!, sortMode, `${customerId} (LCL)`);
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
      // to the chosen physical rule's own minWeightKg/minCbm as the "too small" heuristic.
      const isLcl = lclRule ? totalCbm <= lclRule.maxCbm && totalWeight <= lclRule.maxWeightKg : totalCbm < rule.minCbm || totalWeight < rule.minWeightKg;
      if (isLcl) {
        pushLcl(lclAllocations, customerId, group, sortMode, lclRule ? `${customerId} (LCL)` : customerId);
        continue;
      }

      const { allocations: groupAllocations, unplaced } = packGroup(group, spec, rule, sortMode);
      allocations.push(...groupAllocations);
      unplacedOrders.push(...unplaced);

      const density = totalWeight / Math.max(totalCbm, FLOAT_EPSILON);
      const limitDensity = rule.maxWeightKg / rule.maxCbm;
      if (Math.abs(density - limitDensity) / limitDensity < 0.1) {
        bottleneckWarnings.push(
          `${customerId} (${rule.containerType}): cargo density (${density.toFixed(0)} kg/CBM) is close to the rule's limit ratio (${limitDensity.toFixed(0)} kg/CBM) — both weight and CBM are binding, little slack either way.`
        );
      }
      if (groupAllocations.some((a) => a.status !== 'OK')) {
        bottleneckWarnings.push(`${customerId} (${rule.containerType}): one or more containers sit within tolerance but over the rule's hard cap — review before approving.`);
      }
    }

    const totalContainers = allocations.length;
    const avgUtilizationPercent =
      totalContainers === 0 ? 0 : allocations.reduce((s, a) => s + Math.max(a.weightUtilPercent, a.cbmUtilPercent), 0) / totalContainers;

    return { name, description, allocations, lclAllocations, unplacedOrders, totalContainers, avgUtilizationPercent, bottleneckWarnings };
  });

  return { strategies, missingRuleOrders: [...new Set(missingRuleOrders)], invalidOrders };
}
