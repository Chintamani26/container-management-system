import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Package, TriangleAlert } from 'lucide-react';
import { runAutoAllocation, type AllocationStrategy } from '../../engine/autoAllocator';
import { useRawOrdersStore, usableRows } from '../../store/useRawOrdersStore';
import { useFilterStore, applyFilters } from '../../store/useFilterStore';
import { useMasterRulesStore } from '../../store/useMasterRulesStore';
import { MissingRuleToast } from '../ui/MissingRuleToast';
import type { ContainerAllocation } from '../../types';

export interface Step4AutoAllocationWorkspaceProps {
  onNext: (allocations: ContainerAllocation[], strategyName: string) => void;
  onEditRules?: () => void;
}

const ITEM_COLUMNS = [
  'PO Number',
  'Material',
  'Material Description',
  'PO Qty',
  'Carton Qty',
  'Weight (kg)',
  'Net Weight (kg)',
  'VSN No',
  'Customer Product Code',
  'Pack Master',
  'Pack Type',
] as const;

/** One container's full item-level breakdown — every field the warehouse/export team needs, not
 * just a summary row. Expanded by default when there's only one container in the plan. */
function ContainerDetailCard({ allocation, index, defaultOpen }: { allocation: ContainerAllocation; index: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />}
          <Package className="h-4 w-4 text-indigo-500" aria-hidden="true" />
          <span className="text-sm font-semibold text-slate-900">
            Container #{index + 1} — {allocation.containerType}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${allocation.status === 'OK' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
          >
            {allocation.status}
          </span>
        </div>
        <span className="text-xs text-slate-400">
          {allocation.items.length} item(s) · {allocation.totalWeightKg.toFixed(0)} kg ({allocation.weightUtilPercent.toFixed(1)}%) ·{' '}
          {allocation.totalCbm.toFixed(1)} CBM ({allocation.cbmUtilPercent.toFixed(1)}%)
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <dt className="text-slate-400">Total CBM</dt>
            <dd className="font-medium text-slate-700">{allocation.totalCbm.toFixed(2)}</dd>
            <dt className="text-slate-400">Total Gross Weight</dt>
            <dd className="font-medium text-slate-700">{allocation.totalWeightKg.toFixed(1)} kg</dd>
            <dt className="text-slate-400">Total Net Weight</dt>
            <dd className="font-medium text-slate-700">{allocation.totalNetWeightKg.toFixed(1)} kg</dd>
            <dt className="text-slate-400">Rule Source</dt>
            <dd className="font-medium text-slate-700">{allocation.ruleSource}</dd>
          </dl>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {ITEM_COLUMNS.map((h) => (
                    <th key={h} className="whitespace-nowrap px-2.5 py-1.5 text-left font-semibold text-slate-600">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {allocation.items.map((item) => (
                  <tr key={`${item.poNumber}-${item.materialCode}`}>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{item.poNumber}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{item.materialCode}</td>
                    <td className="max-w-[16rem] truncate px-2.5 py-1.5" title={item.description}>
                      {item.description || '—'}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">
                      {item.quantity}
                      {item.isSplit && (
                        <span className="ml-1 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-semibold text-amber-700" title={`Full PO quantity is ${item.poQty}; split across containers`}>
                          split of {item.poQty}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{item.cartonQty?.toFixed(0) ?? '—'}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{item.weightKg.toFixed(1)}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{(item.netWeightKg ?? item.weightKg).toFixed(1)}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{item.vsnNo || '—'}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{item.customerProductCode || '—'}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{item.packMaster || '—'}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{item.packType || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Step 4: runs the multi-strategy auto-allocator and lets the planner compare trade-offs — one
 * fixed answer would hide that, e.g., a weight-optimized plan uses fewer containers than a
 * volume-optimized one for the same orders. Shows the full per-container, per-item breakdown the
 * warehouse/export team needs, and routes genuinely small customer groups to LCL instead of
 * forcing them into an under-filled container. */
export function Step4AutoAllocationWorkspace({ onNext, onEditRules }: Step4AutoAllocationWorkspaceProps) {
  const allRows = useRawOrdersStore((s) => s.rawImportedRows);
  const rows = useMemo(() => usableRows(allRows), [allRows]);
  const { selectedCustomerIds, selectedPlants, selectedShipWindows, selectedPorts, selectedPoNumbers } = useFilterStore();
  const { customerRules, containerSpecs } = useMasterRulesStore();
  const [selectedStrategy, setSelectedStrategy] = useState(0);

  const filtered = useMemo(
    () => applyFilters(rows, { selectedCustomerIds, selectedPlants, selectedShipWindows, selectedPorts, selectedPoNumbers }),
    [rows, selectedCustomerIds, selectedPlants, selectedShipWindows, selectedPorts, selectedPoNumbers]
  );

  const result = useMemo(() => runAutoAllocation(filtered, customerRules, containerSpecs), [filtered, customerRules, containerSpecs]);

  const strategy: AllocationStrategy | undefined = result.strategies[selectedStrategy];

  // A quantity reconciliation: the total PO quantity across every input line must equal the total
  // across every bucket below (allocated + LCL + unplaced + no-rule + invalid) — quantity survives
  // consolidation (merged lines sum their quantities) even though line *counts* don't. If these
  // two numbers don't match, something is being silently dropped somewhere in the pipeline.
  const inputQty = filtered.reduce((s, o) => s + o.quantity, 0);
  const accountedQty = strategy
    ? strategy.allocations.reduce((s, a) => s + a.items.reduce((s2, i) => s2 + i.quantity, 0), 0) +
      strategy.lclAllocations.reduce((s, l) => s + l.items.reduce((s2, i) => s2 + i.quantity, 0), 0) +
      strategy.unplacedOrders.reduce((s, u) => s + u.quantity, 0) +
      result.missingRuleOrders.reduce((s, o) => s + o.quantity, 0) +
      result.invalidOrders.reduce((s, o) => s + Math.max(0, o.quantity), 0)
    : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Step 4 · Auto-Allocation</h2>
        <p className="text-sm text-slate-500">Compare strategies, then pick one to fine-tune.</p>
      </div>

      <MissingRuleToast orders={result.missingRuleOrders} onEditRules={onEditRules} />

      {result.softNotices.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="flex items-center gap-1.5 font-medium">
            <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            Allocated using a fallback default — go tighten the real rule in Master Data when convenient:
          </p>
          <ul className="list-inside list-disc">
            {result.softNotices.map((notice, i) => (
              <li key={i}>{notice}</li>
            ))}
          </ul>
        </div>
      )}

      {strategy && Math.abs(inputQty - accountedQty) > 1e-6 && (
        <p className="flex items-center gap-1.5 rounded-md border border-red-300 bg-red-100 px-3 py-2 text-sm font-medium text-red-900">
          <TriangleAlert className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          Internal check failed: {inputQty} pcs went in, only {accountedQty} are accounted for across containers/LCL/warnings — this is a
          bug, please report it.
        </p>
      )}

      {result.invalidOrders.length > 0 && (
        <p className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <TriangleAlert className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          {result.invalidOrders.length} line(s) have a PO quantity of zero (or blank) and were skipped — check the Quantity column
          detected on import for: {[...new Set(result.invalidOrders.map((o) => o.materialCode))].slice(0, 5).join(', ')}
          {result.invalidOrders.length > 5 ? ', …' : ''}
        </p>
      )}

      {strategy && strategy.unplacedOrders.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="flex items-center gap-1.5 font-medium">
            <TriangleAlert className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            {strategy.unplacedOrders.length} line(s) couldn't be placed in any container under "{strategy.name}"
          </p>
          <ul className="list-inside list-disc text-xs">
            {strategy.unplacedOrders.map((u, i) => (
              <li key={i}>
                {u.order.poNumber} / {u.order.materialCode} — {u.quantity} pcs: {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {result.strategies.map((s, i) => (
          <button
            key={s.name}
            type="button"
            onClick={() => setSelectedStrategy(i)}
            className={`flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors ${
              selectedStrategy === i ? 'border-indigo-400 bg-indigo-50/60 ring-1 ring-indigo-300' : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">{s.name}</p>
              {selectedStrategy === i && <CheckCircle2 className="h-4 w-4 text-indigo-600" aria-hidden="true" />}
            </div>
            <p className="text-xs text-slate-500">{s.description}</p>
            <dl className="mt-1 grid grid-cols-2 gap-1 text-xs">
              <dt className="text-slate-400">Containers</dt>
              <dd className="text-right font-medium text-slate-700">{s.totalContainers}</dd>
              <dt className="text-slate-400">Avg Utilisation</dt>
              <dd className="text-right font-medium text-slate-700">{s.avgUtilizationPercent.toFixed(1)}%</dd>
              <dt className="text-slate-400">LCL Groups</dt>
              <dd className="text-right font-medium text-slate-700">{s.lclAllocations.length}</dd>
            </dl>
            {s.bottleneckWarnings.length > 0 && (
              <p className="flex items-center gap-1 text-[11px] text-amber-600">
                <TriangleAlert className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                {s.bottleneckWarnings.length} bottleneck warning(s)
              </p>
            )}
          </button>
        ))}
      </div>

      {strategy && strategy.bottleneckWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="mb-1 flex items-center gap-1.5 font-medium">
            <TriangleAlert className="h-4 w-4" aria-hidden="true" />
            Rule bottleneck warnings for "{strategy.name}"
          </p>
          <ul className="list-inside list-disc text-xs">
            {strategy.bottleneckWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {strategy && strategy.allocations.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-700">Container Details — "{strategy.name}"</h3>
          {strategy.allocations.map((a, i) => (
            <ContainerDetailCard key={a.id} allocation={a} index={i} defaultOpen={strategy.allocations.length === 1} />
          ))}
        </div>
      )}

      {strategy && strategy.lclAllocations.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-700">LCL Cargo (below each customer's own Minimum Allowed Weight/CBM)</h3>
          {strategy.lclAllocations.map((l) => (
            <div key={l.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">
                  {l.customerId} — {l.customerName}
                </p>
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">LCL</span>
              </div>
              <dl className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <dt className="text-slate-400">Total Weight</dt>
                <dd className="font-medium text-slate-700">{l.totalWeightKg.toFixed(0)} kg</dd>
                <dt className="text-slate-400">Total CBM</dt>
                <dd className="font-medium text-slate-700">{l.totalCbm.toFixed(2)}</dd>
                <dt className="text-slate-400">Chargeable W/M</dt>
                <dd className="font-medium text-slate-700">{l.chargeableWM.toFixed(2)}</dd>
                <dt className="text-slate-400">Rule Source</dt>
                <dd className="font-medium text-slate-700">{l.ruleSource}</dd>
              </dl>
              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      {['PO Number', 'Material', 'Description', 'PO Qty', 'Weight (kg)', 'CBM'].map((h) => (
                        <th key={h} className="whitespace-nowrap px-2.5 py-1.5 text-left font-semibold text-slate-600">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {l.items.map((item) => (
                      <tr key={`${item.poNumber}-${item.materialCode}`}>
                        <td className="whitespace-nowrap px-2.5 py-1.5">{item.poNumber}</td>
                        <td className="whitespace-nowrap px-2.5 py-1.5">{item.materialCode}</td>
                        <td className="max-w-[16rem] truncate px-2.5 py-1.5">{item.description || '—'}</td>
                        <td className="whitespace-nowrap px-2.5 py-1.5">{item.quantity}</td>
                        <td className="whitespace-nowrap px-2.5 py-1.5">{item.weightKg.toFixed(1)}</td>
                        <td className="whitespace-nowrap px-2.5 py-1.5">{item.volumeCbm.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => strategy && onNext(strategy.allocations, strategy.name)}
          disabled={!strategy || strategy.allocations.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Use This Strategy
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default Step4AutoAllocationWorkspace;
