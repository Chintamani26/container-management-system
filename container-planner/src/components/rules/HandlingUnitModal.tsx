import { useState } from 'react';
import { X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useMasterRulesStore } from '../../store/useMasterRulesStore';
import type { HandlingUnitRule, HandlingUnitType } from '../../types';

const TYPE_OPTIONS: HandlingUnitType[] = ['pallet', 'slip_sheet', 'carton'];

export interface HandlingUnitModalProps {
  rule: HandlingUnitRule;
  onClose: () => void;
}

/** Add/edit form for one handling-unit template (pallet/slip-sheet/carton), scoped to a customer
 * and optionally a specific ship-to location. */
export function HandlingUnitModal({ rule, onClose }: HandlingUnitModalProps) {
  const [draft, setDraft] = useState<HandlingUnitRule>(rule);
  const rules = useMasterRulesStore((s) => s.handlingUnitRules);
  const addRule = useMasterRulesStore((s) => s.addHandlingUnitRule);
  const updateRule = useMasterRulesStore((s) => s.updateHandlingUnitRule);

  const save = () => {
    if (rules.some((r) => r.id === draft.id)) updateRule(draft.id, draft);
    else addRule(draft);
    onClose();
  };

  return (
    <Modal title={rules.some((r) => r.id === draft.id) ? 'Edit Handling Unit' : 'Add Handling Unit'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Applies to Customer ID
          <input
            value={draft.appliesToCustomerId}
            onChange={(e) => setDraft({ ...draft, appliesToCustomerId: e.target.value })}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 focus:border-indigo-400 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Ship-To Location (optional override)
          <input
            value={draft.shipToLocation ?? ''}
            onChange={(e) => setDraft({ ...draft, shipToLocation: e.target.value || undefined })}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 focus:border-indigo-400 focus:outline-none"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Code
            <input
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 focus:border-indigo-400 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Type
            <select
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value as HandlingUnitType })}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 focus:border-indigo-400 focus:outline-none"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 focus:border-indigo-400 focus:outline-none"
          />
        </label>

        <fieldset className="rounded-md border border-slate-200 p-2.5">
          <legend className="px-1 text-xs font-semibold text-slate-500">Dimensions (cm)</legend>
          <div className="grid grid-cols-3 gap-2">
            {(['lengthCm', 'widthCm', 'heightCm'] as const).map((k) => (
              <label key={k} className="flex flex-col gap-1 text-xs">
                {k.replace('Cm', '')}
                <input
                  type="number"
                  value={draft.dimensions[k]}
                  onChange={(e) => setDraft({ ...draft, dimensions: { ...draft.dimensions, [k]: Number(e.target.value) } })}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
                />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="rounded-md border border-slate-200 p-2.5">
          <legend className="px-1 text-xs font-semibold text-slate-500">Weights</legend>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-xs">
              Tare (kg)
              <input
                type="number"
                value={draft.weights.tareKg}
                onChange={(e) => setDraft({ ...draft, weights: { ...draft.weights, tareKg: Number(e.target.value) } })}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Max Gross (kg)
              <input
                type="number"
                value={draft.weights.maxGrossKg}
                onChange={(e) => setDraft({ ...draft, weights: { ...draft.weights, maxGrossKg: Number(e.target.value) } })}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Max Loaded H (cm)
              <input
                type="number"
                value={draft.weights.maxLoadedHeightCm}
                onChange={(e) => setDraft({ ...draft, weights: { ...draft.weights, maxLoadedHeightCm: Number(e.target.value) } })}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="rounded-md border border-slate-200 p-2.5">
          <legend className="px-1 text-xs font-semibold text-slate-500">Constraints & Practical Caps</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs">
              Stack Levels
              <input
                type="number"
                value={draft.constraints.stackLevels}
                onChange={(e) => setDraft({ ...draft, constraints: { ...draft.constraints, stackLevels: Number(e.target.value) } })}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Overhang (cm)
              <input
                type="number"
                value={draft.constraints.overhangCm}
                onChange={(e) => setDraft({ ...draft, constraints: { ...draft.constraints, overhangCm: Number(e.target.value) } })}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </label>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-xs">
              Per 20ft
              <input
                type="number"
                value={draft.caps.practical20ft}
                onChange={(e) => setDraft({ ...draft, caps: { ...draft.caps, practical20ft: Number(e.target.value) } })}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Per 40ft
              <input
                type="number"
                value={draft.caps.practical40ft}
                onChange={(e) => setDraft({ ...draft, caps: { ...draft.caps, practical40ft: Number(e.target.value) } })}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Per 40HC
              <input
                type="number"
                value={draft.caps.practical40hc}
                onChange={(e) => setDraft({ ...draft, caps: { ...draft.caps, practical40hc: Number(e.target.value) } })}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </label>
          </div>
        </fieldset>

        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            <X className="h-4 w-4" aria-hidden="true" />
            Cancel
          </button>
          <button type="button" onClick={save} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700">
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default HandlingUnitModal;
