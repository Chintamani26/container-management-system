import { CheckCircle2, XCircle } from 'lucide-react';
import { usePlanStore } from '../../store/usePlanStore';
import { useAuthStore } from '../../store/useAuthStore';

export interface Step6AdminReviewWorkspaceProps {
  draftId: string | null;
  onApproved: (planId: string) => void;
  onRejected: () => void;
}

/** Step 6: an admin-only approval gate — a draft plan sits here until approved (becoming a
 * ConfirmedPlan, exportable in Step 7) or rejected (sent back to Step 5 for more editing). */
export function Step6AdminReviewWorkspace({ draftId, onApproved, onRejected }: Step6AdminReviewWorkspaceProps) {
  const draft = usePlanStore((s) => s.draftPlans.find((d) => d.draftId === draftId));
  const approveDraft = usePlanStore((s) => s.approveDraft);
  const rejectDraft = usePlanStore((s) => s.rejectDraft);
  const role = useAuthStore((s) => s.role);

  if (!draft) {
    return <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">No draft plan selected.</p>;
  }

  const totalWeight = draft.allocations.reduce((s, a) => s + a.totalWeightKg, 0);
  const totalCbm = draft.allocations.reduce((s, a) => s + a.totalCbm, 0);
  const anyOverrun = draft.allocations.some((a) => a.status !== 'OK');

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Step 6 · Admin Review</h2>
        <p className="text-sm text-slate-500">
          {draft.draftId} · submitted by {draft.createdBy} · strategy: {draft.strategyName ?? 'n/a'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-slate-400">Containers</p>
          <p className="text-lg font-semibold text-slate-900">{draft.allocations.length}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Total Weight</p>
          <p className="text-lg font-semibold text-slate-900">{totalWeight.toFixed(0)} kg</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Total CBM</p>
          <p className="text-lg font-semibold text-slate-900">{totalCbm.toFixed(1)}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {['Container', 'Type', 'Items', 'Weight (kg)', 'Weight %', 'CBM', 'CBM %', 'Status'].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-600">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {draft.allocations.map((a, i) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap px-3 py-1.5">#{i + 1}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{a.containerType}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{a.items.length}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{a.totalWeightKg.toFixed(0)}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{a.weightUtilPercent.toFixed(1)}%</td>
                <td className="whitespace-nowrap px-3 py-1.5">{a.totalCbm.toFixed(1)}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{a.cbmUtilPercent.toFixed(1)}%</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${a.status === 'OK' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {a.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {anyOverrun && (
        <p className="text-sm text-amber-700">Some containers are in soft-tolerance overrun — review before approving.</p>
      )}

      {role !== 'ADMIN' ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">Only an Admin can approve or reject a draft.</p>
      ) : (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              rejectDraft(draft.draftId);
              onRejected();
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
            Reject
          </button>
          <button
            type="button"
            onClick={() => onApproved(approveDraft(draft.draftId, 'Admin'))}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Approve
          </button>
        </div>
      )}
    </div>
  );
}

export default Step6AdminReviewWorkspace;
