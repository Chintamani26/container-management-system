import { Download } from 'lucide-react';
import { buildCargoBlocks, calculateGravity } from '../../engine/gravityEngine';
import { findSpecByType } from '../../engine/ruleResolver';
import { SvgContainer2D } from '../ui/SvgContainer2D';
import { usePlanStore } from '../../store/usePlanStore';
import { useMasterRulesStore } from '../../store/useMasterRulesStore';
import { exportDispatchManifest } from '../../utils/manifestExporter';

export interface Step7CgAndExportWorkspaceProps {
  planId: string | null;
}

/** Step 7: the confirmed plan's centre-of-gravity check and the dispatch manifest export — what
 * the Viewer role sees. */
export function Step7CgAndExportWorkspace({ planId }: Step7CgAndExportWorkspaceProps) {
  const plan = usePlanStore((s) => s.confirmedPlans.find((p) => p.planId === planId));
  const containerSpecs = useMasterRulesStore((s) => s.containerSpecs);

  if (!plan) {
    return <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">No confirmed plan selected.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Step 7 · Load Balance & Export</h2>
          <p className="text-sm text-slate-500">
            {plan.planId} · confirmed {new Date(plan.confirmedAt).toLocaleString()} by {plan.confirmedBy}
          </p>
        </div>
        <button
          type="button"
          onClick={() => exportDispatchManifest(plan, containerSpecs)}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export Dispatch Manifest
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {plan.allocations.map((a, i) => {
          const spec = findSpecByType(containerSpecs, a.containerType);
          if (!spec) {
            return (
              <div key={a.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                Container #{i + 1}: no matching container spec for type "{a.containerType}" — CG cannot be calculated.
              </div>
            );
          }
          const blocks = buildCargoBlocks(a, spec);
          const gravity = calculateGravity(blocks, spec);

          return (
            <div key={a.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">
                  Container #{i + 1} — {a.containerType}
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    gravity.verdict === 'OK' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {gravity.verdict}
                </span>
              </div>
              <SvgContainer2D blocks={blocks} gravity={gravity} internalLengthCm={spec.internalLengthCm} />
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-slate-400">Weight</dt>
                <dd className="text-right font-medium text-slate-700">
                  {a.totalWeightKg.toFixed(0)} kg ({a.weightUtilPercent.toFixed(1)}%)
                </dd>
                <dt className="text-slate-400">CBM</dt>
                <dd className="text-right font-medium text-slate-700">
                  {a.totalCbm.toFixed(1)} ({a.cbmUtilPercent.toFixed(1)}%)
                </dd>
                <dt className="text-slate-400">Xcg offset</dt>
                <dd className="text-right font-medium text-slate-700">{gravity.offsetXPercent.toFixed(1)}%</dd>
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Step7CgAndExportWorkspace;
