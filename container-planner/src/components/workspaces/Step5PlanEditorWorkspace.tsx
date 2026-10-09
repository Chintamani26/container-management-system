import { useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import { ContainerDropZone } from '../allocation/ContainerDropZone';
import { MicroOverrunToast } from '../ui/MicroOverrunToast';
import { usePlanStore } from '../../store/usePlanStore';
import { useAuthStore } from '../../store/useAuthStore';
import type { AllocationStatus, ContainerAllocation } from '../../types';

export interface Step5PlanEditorWorkspaceProps {
  allocations: ContainerAllocation[];
  strategyName: string;
  onSubmitted: (draftId: string) => void;
}

interface Limits {
  maxGrossWeightKg: number;
  maxCbmCap: number;
}

/** Derives each container's own limit from its initial utilisation % — the allocator already
 * resolved the real rule when it built this allocation; this recovers it without re-resolving, so
 * edits here stay consistent with whichever rule actually produced the plan. */
function deriveLimits(allocations: ContainerAllocation[]): Map<string, Limits> {
  const map = new Map<string, Limits>();
  for (const a of allocations) {
    map.set(a.id, {
      maxGrossWeightKg: a.weightUtilPercent > 0 ? a.totalWeightKg / (a.weightUtilPercent / 100) : a.totalWeightKg || 1,
      maxCbmCap: a.cbmUtilPercent > 0 ? a.totalCbm / (a.cbmUtilPercent / 100) : a.totalCbm || 1,
    });
  }
  return map;
}

function recompute(a: ContainerAllocation, limits: Limits): ContainerAllocation {
  const totalWeightKg = a.items.reduce((s, i) => s + i.weightKg, 0);
  const totalNetWeightKg = a.items.reduce((s, i) => s + (i.netWeightKg ?? i.weightKg), 0);
  const totalCbm = a.items.reduce((s, i) => s + i.volumeCbm, 0);
  const weightUtilPercent = (totalWeightKg / limits.maxGrossWeightKg) * 100;
  const cbmUtilPercent = (totalCbm / limits.maxCbmCap) * 100;
  const status: AllocationStatus = totalWeightKg > limits.maxGrossWeightKg || totalCbm > limits.maxCbmCap ? 'MICRO_OVERRUN' : 'OK';
  return { ...a, totalWeightKg, totalNetWeightKg, totalCbm, weightUtilPercent, cbmUtilPercent, status };
}

/** Step 5: fine-tune the chosen auto-allocation strategy by dragging items between containers
 * before submitting it for admin review. */
export function Step5PlanEditorWorkspace({ allocations: initialAllocations, strategyName, onSubmitted }: Step5PlanEditorWorkspaceProps) {
  const [allocations, setAllocations] = useState(initialAllocations);
  const limitsById = useMemo(() => deriveLimits(initialAllocations), [initialAllocations]);
  const submitDraft = usePlanStore((s) => s.submitDraft);
  const role = useAuthStore((s) => s.role);

  const moveItem = (fromId: string, toId: string, orderId: string) => {
    if (fromId === toId) return;
    setAllocations((prev) => {
      const from = prev.find((a) => a.id === fromId);
      const item = from?.items.find((i) => i.orderId === orderId);
      if (!from || !item) return prev;

      return prev.map((a) => {
        if (a.id === fromId) {
          const updated = { ...a, items: a.items.filter((i) => i.orderId !== orderId) };
          return recompute(updated, limitsById.get(a.id) ?? { maxGrossWeightKg: 1, maxCbmCap: 1 });
        }
        if (a.id === toId) {
          const updated = { ...a, items: [...a.items, item] };
          return recompute(updated, limitsById.get(a.id) ?? { maxGrossWeightKg: 1, maxCbmCap: 1 });
        }
        return a;
      });
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Step 5 · Plan Editor</h2>
        <p className="text-sm text-slate-500">Strategy: {strategyName}. Drag items between containers, then submit for review.</p>
      </div>

      <MicroOverrunToast allocations={allocations} />

      <ContainerDropZone allocations={allocations} onMoveItem={moveItem} />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSubmitted(submitDraft(allocations, role, strategyName))}
          disabled={allocations.every((a) => a.items.length === 0)}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Submit for Review
        </button>
      </div>
    </div>
  );
}

export default Step5PlanEditorWorkspace;
