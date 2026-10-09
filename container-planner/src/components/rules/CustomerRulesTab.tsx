import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { NumberField } from '../ui/NumberField';
import { useMasterRulesStore } from '../../store/useMasterRulesStore';
import { useRawOrdersStore } from '../../store/useRawOrdersStore';
import { buildCustomerDirectory } from '../../utils/directories';
import type { ContainerType, CustomerRule, PoType, PriorityOption } from '../../types';

const CONTAINER_TYPES: ContainerType[] = ['20', '40', '40 HC', 'LCL'];
const PO_TYPES: PoType[] = ['Ocean', 'Ocean Heavy', 'Any'];
const PRIORITY_OPTIONS: PriorityOption[] = ['CBM', 'Weight', 'CartonWeight'];
const PRIORITY_OPTION_LABELS: Record<PriorityOption, string> = { CBM: 'CBM', Weight: 'Weight', CartonWeight: 'Carton Weight' };

const blankRule = (): CustomerRule => ({
  id: `cust-${Math.random().toString(36).slice(2, 9)}`,
  customerId: '',
  customerName: '',
  containerType: '20',
  poType: 'Ocean',
  maxWeightKg: 0,
  maxCbm: 0,
  minWeightKg: 0,
  minCbm: 0,
  tolerancePercent: 0.5,
  poSplitAllowed: true,
  priorityOption: 'CBM',
  partialShipmentAllowed: true,
});

export interface CustomerRulesTabProps {
  /** Set when arriving here via Step 3's "Add Rule Now" — opens the Add form pre-filled for this
   * customer id (and its name, if known from the imported file). */
  prefillCustomerId?: string | null;
  /** Called once the prefill has been applied, so the parent can clear it and this doesn't
   * re-trigger on every re-render. */
  onPrefillConsumed?: () => void;
}

/** The one rule tier: one row per customer + container type. No country/standard fallback — a
 * customer with no row for a given type simply isn't allocatable into it. A row with Container
 * Type = LCL marks that customer as always-consolidate for this scope. */
export function CustomerRulesTab({ prefillCustomerId, onPrefillConsumed }: CustomerRulesTabProps = {}) {
  const rules = useMasterRulesStore((s) => s.customerRules);
  const addRule = useMasterRulesStore((s) => s.addCustomerRule);
  const updateRule = useMasterRulesStore((s) => s.updateCustomerRule);
  const deleteRule = useMasterRulesStore((s) => s.deleteCustomerRule);
  const rawRows = useRawOrdersStore((s) => s.rawImportedRows);

  const [editing, setEditing] = useState<CustomerRule | null>(null);
  const [search, setSearch] = useState('');

  const customerDirectory = useMemo(() => buildCustomerDirectory(rawRows), [rawRows]);
  const knownCustomerIds = useMemo(() => [...customerDirectory.keys()], [customerDirectory]);

  useEffect(() => {
    if (!prefillCustomerId) return;
    setEditing({ ...blankRule(), customerId: prefillCustomerId, customerName: customerDirectory.get(prefillCustomerId) ?? '' });
    onPrefillConsumed?.();
    // Only re-run when a new prefill request actually arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillCustomerId]);

  const query = search.trim().toLowerCase();
  const visibleRules =
    query === '' ? rules : rules.filter((r) => r.customerId.toLowerCase().includes(query) || r.customerName.toLowerCase().includes(query));

  const save = () => {
    if (!editing) return;
    if (rules.some((r) => r.id === editing.id)) updateRule(editing.id, editing);
    else addRule(editing);
    setEditing(null);
  };

  const field = (label: string, value: number, onChange: (v: number) => void, step?: string) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <NumberField step={step} value={value} onChange={onChange} className="rounded-md border border-slate-300 px-2.5 py-1.5 focus:border-indigo-400 focus:outline-none" />
    </label>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer name or ID..."
            className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-2.5 text-sm focus:border-indigo-400 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setEditing(blankRule())}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Customer Rule
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {[
                'Customer No',
                'Customer Name',
                'Container Type',
                'PO Type',
                'Maximum Allowed Weight',
                'Maximum Allowed CBM',
                'Minimum Allowed Weight',
                'Minimum Allowed CBM',
                'Tolerance',
                'Po Split',
                'Priority Option',
                'Partial Shipment',
                '',
              ].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-600">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {visibleRules.length === 0 && (
              <tr>
                <td colSpan={13} className="px-3 py-6 text-center text-slate-400">
                  {rules.length === 0 ? 'No customer rules yet.' : 'No rules match that search.'}
                </td>
              </tr>
            )}
            {visibleRules.map((r) => (
              <tr key={r.id} className={r.maxWeightKg <= 0 && r.maxCbm <= 0 ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-slate-50'}>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <span className="flex items-center gap-1.5">
                    {r.customerId}
                    {r.maxWeightKg <= 0 && r.maxCbm <= 0 && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Needs Setup</span>
                    )}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.customerName}</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  {r.containerType === 'LCL' ? (
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">LCL</span>
                  ) : (
                    r.containerType
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.poType}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.maxWeightKg.toLocaleString()}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.maxCbm}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.minWeightKg.toLocaleString()}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.minCbm}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.tolerancePercent}%</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.poSplitAllowed ? 'Allowed' : 'Not Allowed'}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{PRIORITY_OPTION_LABELS[r.priorityOption]}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.partialShipmentAllowed ? 'Allowed' : 'Not Allowed'}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">
                  <button type="button" onClick={() => setEditing(r)} aria-label="Edit" className="rounded p-1.5 text-slate-500 hover:bg-slate-100">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => deleteRule(r.id)} aria-label="Delete" className="rounded p-1.5 text-red-500 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={rules.some((r) => r.id === editing.id) ? 'Edit Customer Rule' : 'Add Customer Rule'} onClose={() => setEditing(null)}>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Customer No
              <input
                list="customer-id-options"
                value={editing.customerId}
                onChange={(e) => {
                  const customerId = e.target.value;
                  const knownName = customerDirectory.get(customerId);
                  setEditing({
                    ...editing,
                    customerId,
                    // Auto-fills the name the moment a known customer id is picked/typed, without
                    // clobbering a name the admin already typed in by hand for an unknown id.
                    customerName: knownName && !editing.customerName ? knownName : editing.customerName,
                  });
                }}
                placeholder="Pick from the imported file, or type a new one"
                className="rounded-md border border-slate-300 px-2.5 py-1.5 focus:border-indigo-400 focus:outline-none"
              />
              <datalist id="customer-id-options">
                {knownCustomerIds.map((id) => (
                  <option key={id} value={id}>
                    {customerDirectory.get(id)}
                  </option>
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Customer Name
              <input
                value={editing.customerName}
                onChange={(e) => setEditing({ ...editing, customerName: e.target.value })}
                className="rounded-md border border-slate-300 px-2.5 py-1.5 focus:border-indigo-400 focus:outline-none"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Container Type
                <select
                  value={editing.containerType}
                  onChange={(e) => setEditing({ ...editing, containerType: e.target.value as ContainerType })}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 focus:border-indigo-400 focus:outline-none"
                >
                  {CONTAINER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                PO Type
                <select
                  value={editing.poType}
                  onChange={(e) => setEditing({ ...editing, poType: e.target.value as PoType })}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 focus:border-indigo-400 focus:outline-none"
                >
                  {PO_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {field('Maximum Allowed Weight (kg)', editing.maxWeightKg, (v) => setEditing({ ...editing, maxWeightKg: v }))}
              {field('Maximum Allowed CBM', editing.maxCbm, (v) => setEditing({ ...editing, maxCbm: v }))}
              {field('Minimum Allowed Weight (kg)', editing.minWeightKg, (v) => setEditing({ ...editing, minWeightKg: v }))}
              {field('Minimum Allowed CBM', editing.minCbm, (v) => setEditing({ ...editing, minCbm: v }))}
              {field('Tolerance %', editing.tolerancePercent, (v) => setEditing({ ...editing, tolerancePercent: v }), '0.1')}
              <label className="flex flex-col gap-1 text-sm">
                Priority Option
                <select
                  value={editing.priorityOption}
                  onChange={(e) => setEditing({ ...editing, priorityOption: e.target.value as PriorityOption })}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 focus:border-indigo-400 focus:outline-none"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_OPTION_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                PO Split
                <select
                  value={editing.poSplitAllowed ? 'Allowed' : 'Not Allowed'}
                  onChange={(e) => setEditing({ ...editing, poSplitAllowed: e.target.value === 'Allowed' })}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 focus:border-indigo-400 focus:outline-none"
                >
                  <option value="Allowed">Allowed</option>
                  <option value="Not Allowed">Not Allowed</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Partial Shipment
                <select
                  value={editing.partialShipmentAllowed ? 'Allowed' : 'Not Allowed'}
                  onChange={(e) => setEditing({ ...editing, partialShipmentAllowed: e.target.value === 'Allowed' })}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 focus:border-indigo-400 focus:outline-none"
                >
                  <option value="Allowed">Allowed</option>
                  <option value="Not Allowed">Not Allowed</option>
                </select>
              </label>
            </div>

            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                <X className="h-4 w-4" aria-hidden="true" />
                Cancel
              </button>
              <button type="button" onClick={save} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700">
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default CustomerRulesTab;
