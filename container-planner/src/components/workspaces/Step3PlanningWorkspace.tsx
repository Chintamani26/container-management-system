import { useEffect, useMemo } from 'react';
import { ArrowRight, Plus, TriangleAlert } from 'lucide-react';
import { CheckboxDropdown } from '../ui/CheckboxDropdown';
import { useRawOrdersStore } from '../../store/useRawOrdersStore';
import { useFilterStore, applyFilters, distinctValues } from '../../store/useFilterStore';
import { useMasterRulesStore } from '../../store/useMasterRulesStore';
import { resolveRule } from '../../engine/ruleResolver';
import { buildCustomerDirectory } from '../../utils/directories';
import type { ContainerType, SAPOrderRow } from '../../types';

export interface Step3PlanningWorkspaceProps {
  onNext: () => void;
  /** Jumps to Step 2's Customer Rules tab with the Add Rule form pre-filled for this customer. */
  onAddRuleForCustomer?: (customerId: string) => void;
}

interface CascadeLevelProps {
  step: number;
  label: string;
  enabled: boolean;
  disabledReason?: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  labelFor?: (option: string) => string;
}

function CascadeLevel({ step, label, enabled, disabledReason, options, selected, onChange, labelFor }: CascadeLevelProps) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          enabled ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'
        }`}
      >
        {step}
      </span>
      <div className="flex-1">
        <p className={`mb-1 text-sm font-semibold ${enabled ? 'text-slate-800' : 'text-slate-400'}`}>{label}</p>
        {!enabled ? (
          <p className="text-sm text-slate-400">{disabledReason}</p>
        ) : options.length === 0 ? (
          <p className="text-sm text-slate-400">No values found in this column.</p>
        ) : (
          <CheckboxDropdown label={label} options={options} selected={selected} onChange={onChange} labelFor={labelFor} />
        )}
      </div>
    </div>
  );
}

/** Step 3: a cascading scope filter — Customer narrows Plant, Plant narrows Ship Window, Ship
 * Window narrows Port, each level only usable once the one before it has a selection — plus an
 * independent PO Number filter on top. Customer names come straight from the imported file, not
 * from a rule having been set up for them. */
export function Step3PlanningWorkspace({ onNext, onAddRuleForCustomer }: Step3PlanningWorkspaceProps) {
  const rows = useRawOrdersStore((s) => s.rawImportedRows);
  const removeRows = useRawOrdersStore((s) => s.removeRows);
  const {
    selectedCustomerIds,
    selectedPlants,
    selectedShipWindows,
    selectedPorts,
    selectedPoNumbers,
    setSelectedCustomerIds,
    setSelectedPlants,
    setSelectedShipWindows,
    setSelectedPorts,
    setSelectedPoNumbers,
  } = useFilterStore();
  const { customerRules, containerSpecs } = useMasterRulesStore();

  const customerDirectory = useMemo(() => buildCustomerDirectory(rows), [rows]);
  const nameFor = (customerId: string) => customerDirectory.get(customerId) ?? customerRules.find((r) => r.customerId === customerId)?.customerName ?? '';
  const labelFor = (customerId: string) => {
    const name = nameFor(customerId);
    return name ? `${customerId} — ${name}` : customerId;
  };

  // Each level's options are computed from rows already narrowed by every level above it — a true
  // cascade, not four independent filters over the same full dataset.
  const afterCustomer = applyFilters(rows, { selectedCustomerIds, selectedPlants: [], selectedShipWindows: [], selectedPorts: [], selectedPoNumbers: [] });
  const afterPlant = applyFilters(rows, { selectedCustomerIds, selectedPlants, selectedShipWindows: [], selectedPorts: [], selectedPoNumbers: [] });
  const afterShipWindow = applyFilters(rows, { selectedCustomerIds, selectedPlants, selectedShipWindows, selectedPorts: [], selectedPoNumbers: [] });

  const customerIds = distinctValues(rows, 'customerId');
  const plants = distinctValues(afterCustomer, 'plant');
  const shipWindows = distinctValues(afterPlant, 'shipWindow');
  const ports = distinctValues(afterShipWindow, 'port');
  const poNumbers = distinctValues(rows, 'poNumber');

  const filtered = applyFilters(rows, { selectedCustomerIds, selectedPlants, selectedShipWindows, selectedPorts, selectedPoNumbers });

  // A prior selection can reference a value that doesn't exist in the current import (a newer
  // file was imported, or the upstream cascade level changed) — drop anything no longer valid
  // rather than silently producing an empty result with no indication why.
  useEffect(() => {
    const prune = (selected: string[], valid: string[], setter: (v: string[]) => void) => {
      const next = selected.filter((v) => valid.includes(v));
      if (next.length !== selected.length) setter(next);
    };
    prune(selectedCustomerIds, customerIds, setSelectedCustomerIds);
    prune(selectedPlants, plants, setSelectedPlants);
    prune(selectedShipWindows, shipWindows, setSelectedShipWindows);
    prune(selectedPorts, ports, setSelectedPorts);
    prune(selectedPoNumbers, poNumbers, setSelectedPoNumbers);
    // Re-run whenever the underlying data or the upstream cascade selections change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedCustomerIds, selectedPlants, selectedShipWindows]);

  // A customer with no matching rule at all can't be allocated — flagged here, before the planner
  // even runs auto-allocation, rather than only surfacing as an opaque "missing rule" list after.
  const customersWithoutRule = useMemo(() => {
    const checked = new Set<string>();
    const missing: SAPOrderRow['customerId'][] = [];
    for (const row of filtered) {
      if (checked.has(row.customerId)) continue;
      checked.add(row.customerId);
      const hasAnyRule = containerSpecs.some((spec) => resolveRule(row, spec.type as ContainerType, customerRules));
      if (!hasAnyRule) missing.push(row.customerId);
    }
    return missing;
  }, [filtered, customerRules, containerSpecs]);

  // Missing weight silently makes the generated plan wrong (the line "weighs nothing"), so it's
  // surfaced as a warning the planner must either resolve by skipping the PO, or go fix at the
  // source (re-upload a corrected file). No inline edit/create here — that's deliberately not
  // offered on this stage. Gated on an explicit PO Number selection: a PO's missing weight is only
  // flagged once the planner has actually picked that PO, not for every PO anywhere in the broader
  // customer/plant/ship-window/port scope — otherwise the cascade can never be completed smoothly
  // whenever *any* PO in that scope happens to have a data problem, including ones not in play.
  const missingWeightRows = useMemo(
    () => (selectedPoNumbers.length === 0 ? [] : filtered.filter((r) => r.quantity > 0 && (!r.weightKg || r.weightKg <= 0))),
    [filtered, selectedPoNumbers]
  );
  const activeMissingWeightRow = missingWeightRows[0];

  const totalWeight = filtered.reduce((s, r) => s + r.weightKg, 0);
  const totalCbm = filtered.reduce((s, r) => s + r.volumeCbm, 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Step 3 · Planning & Cascading Filter</h2>
        <p className="text-sm text-slate-500">Narrow the imported orders down one level at a time before allocating.</p>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4">
        <CascadeLevel step={1} label="Customer" enabled options={customerIds} selected={selectedCustomerIds} onChange={setSelectedCustomerIds} labelFor={labelFor} />
        <CascadeLevel
          step={2}
          label="Plant"
          enabled={selectedCustomerIds.length > 0}
          disabledReason="Select a customer first"
          options={plants}
          selected={selectedPlants}
          onChange={setSelectedPlants}
        />
        <CascadeLevel
          step={3}
          label="Ship Window"
          enabled={selectedPlants.length > 0}
          disabledReason="Select a plant first"
          options={shipWindows}
          selected={selectedShipWindows}
          onChange={setSelectedShipWindows}
        />
        <CascadeLevel
          step={4}
          label="Port"
          enabled={selectedShipWindows.length > 0}
          disabledReason="Select ship window first"
          options={ports}
          selected={selectedPorts}
          onChange={setSelectedPorts}
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="mb-1 text-sm font-medium text-slate-700">PO Numbers (optional, independent of the cascade above)</p>
        <CheckboxDropdown label="All POs" options={poNumbers} selected={selectedPoNumbers} onChange={setSelectedPoNumbers} />
      </div>

      {selectedCustomerIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedCustomerIds.map((id) => (
            <span key={id} className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
              {labelFor(id)}
            </span>
          ))}
        </div>
      )}

      {customersWithoutRule.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          {customersWithoutRule.map((id) => (
            <div key={id} className="flex flex-col gap-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                <TriangleAlert className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                No Master Rule found for Customer ID: {id}
              </p>
              <p className="text-sm text-amber-700">Add a rule before this customer's orders can be allocated.</p>
              {onAddRuleForCustomer && (
                <button
                  type="button"
                  onClick={() => onAddRuleForCustomer(id)}
                  className="inline-flex w-fit items-center gap-1.5 rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Rule Now
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {missingWeightRows.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
            <TriangleAlert className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            {missingWeightRows.length} line(s) in the current selection have missing weight
          </p>
          <ul className="flex flex-col gap-1">
            {missingWeightRows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 rounded-md bg-white px-3 py-1.5 text-sm text-amber-800">
                <span>
                  PO {row.poNumber} (Item: {row.materialCode})
                </span>
                <button
                  type="button"
                  onClick={() => removeRows([row.id])}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Skip PO
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">
          <strong>{filtered.length}</strong> order line(s) selected — {totalWeight.toFixed(0)} kg, {totalCbm.toFixed(1)} CBM total.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={filtered.length === 0 || missingWeightRows.length > 0}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Run Auto-Allocation
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {activeMissingWeightRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="flex w-full max-w-md flex-col gap-3 rounded-lg bg-white p-5 shadow-xl">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
              <TriangleAlert className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              Missing Weight
            </p>
            <p className="text-sm text-slate-700">
              There is no weight present for PO {activeMissingWeightRow.poNumber} (Item: {activeMissingWeightRow.materialCode}). Do you want to skip this
              PO and move forward with the remaining POs?
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => removeRows([activeMissingWeightRow.id])}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Skip & Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Step3PlanningWorkspace;
