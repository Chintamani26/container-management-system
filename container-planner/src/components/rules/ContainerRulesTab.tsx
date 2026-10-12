import { useState } from 'react';
import { Plus, Search, Trash2, TriangleAlert } from 'lucide-react';
import { useMasterRulesStore } from '../../store/useMasterRulesStore';
import { NumberField } from '../ui/NumberField';
import type { ContainerSpec, PhysicalContainerType } from '../../types';

const CONTAINER_TYPES: PhysicalContainerType[] = ['20', '40', '40 HC'];

/** S1 tab: physical container specs (internal dimensions, payload, CBM) the allocator and
 * gravity engine both read from. */
export function ContainerRulesTab() {
  const specs = useMasterRulesStore((s) => s.containerSpecs);
  const addSpec = useMasterRulesStore((s) => s.addContainerSpec);
  const updateSpec = useMasterRulesStore((s) => s.updateContainerSpec);
  const deleteSpec = useMasterRulesStore((s) => s.deleteContainerSpec);
  const [search, setSearch] = useState('');

  const query = search.trim().toLowerCase();
  const visibleSpecs = query === '' ? specs : specs.filter((s) => s.type.toLowerCase().includes(query));

  // Two specs sharing a type is ambiguous everywhere specs get looked up by type (allocation, CG,
  // export) — the code picks whichever is usable, but it's still worth flagging so it gets cleaned
  // up rather than silently relying on that tie-break.
  const typeCounts = new Map<string, number>();
  for (const s of specs) typeCounts.set(s.type, (typeCounts.get(s.type) ?? 0) + 1);
  const duplicateTypes = [...typeCounts.entries()].filter(([, count]) => count > 1).map(([type]) => type);

  const numberField = (spec: ContainerSpec, key: keyof ContainerSpec, width = 'w-24') => (
    <NumberField
      value={spec[key] as number}
      onChange={(v) => updateSpec(spec.id, { [key]: v } as Partial<ContainerSpec>)}
      className={`${width} rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none`}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      {duplicateTypes.length > 0 && (
        <p className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          More than one row uses type "{duplicateTypes.join(', ')}" — delete the extra one(s), or allocation/export may pick the wrong row.
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by container type..."
            className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-2.5 text-sm focus:border-indigo-400 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() =>
            addSpec({
              id: `cs-${Math.random().toString(36).slice(2, 9)}`,
              type: '20',
              internalLengthCm: 0,
              internalWidthCm: 0,
              internalHeightCm: 0,
              maxPayloadKg: 0,
              maxCbm: 0,
              tareWeightKg: 0,
              practicalCbmPercent: 85,
            })
          }
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Container Spec
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {['Type', 'Internal L (cm)', 'Internal W (cm)', 'Internal H (cm)', 'Max Payload (kg)', 'Max CBM', 'Practical Fill %', 'Tare (kg)', ''].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-600">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {visibleSpecs.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                  {specs.length === 0 ? 'No container specs yet.' : 'No matching container specs found.'}
                </td>
              </tr>
            )}
            {visibleSpecs.map((spec) => {
              const needsSetup = spec.maxPayloadKg <= 0 && spec.maxCbm <= 0;
              return (
              <tr key={spec.id} className={needsSetup ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-slate-50'}>
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-1.5">
                    <select
                      value={spec.type}
                      onChange={(e) => updateSpec(spec.id, { type: e.target.value })}
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
                    >
                      {CONTAINER_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {needsSetup && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Needs Setup</span>}
                  </span>
                </td>
                <td className="px-2 py-1.5">{numberField(spec, 'internalLengthCm')}</td>
                <td className="px-2 py-1.5">{numberField(spec, 'internalWidthCm')}</td>
                <td className="px-2 py-1.5">{numberField(spec, 'internalHeightCm')}</td>
                <td className="px-2 py-1.5">{numberField(spec, 'maxPayloadKg', 'w-28')}</td>
                <td className="px-2 py-1.5">{numberField(spec, 'maxCbm')}</td>
                <td className="px-2 py-1.5">
                  <NumberField
                    value={spec.practicalCbmPercent ?? 100}
                    onChange={(v) => updateSpec(spec.id, { practicalCbmPercent: v })}
                    className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
                  />
                </td>
                <td className="px-2 py-1.5">{numberField(spec, 'tareWeightKg')}</td>
                <td className="px-2 py-1.5 text-right">
                  <button type="button" onClick={() => deleteSpec(spec.id)} aria-label="Delete" className="rounded p-1.5 text-red-500 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ContainerRulesTab;
