import { TriangleAlert } from 'lucide-react';
import type { ContainerAllocation } from '../../types';

export interface MicroOverrunToastProps {
  allocations: ContainerAllocation[];
}

/** Flags containers sitting in the soft-tolerance band above their rule's hard cap — allowed, but
 * worth a planner's eyes before submission. */
export function MicroOverrunToast({ allocations }: MicroOverrunToastProps) {
  const flagged = allocations.filter((a) => a.status === 'MICRO_OVERRUN');
  if (flagged.length === 0) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <div>
        <p className="font-medium">{flagged.length} container(s) are within soft tolerance but over the rule's hard cap.</p>
        <ul className="mt-1 list-inside list-disc text-xs">
          {flagged.map((a) => (
            <li key={a.id}>
              {a.containerType} ({a.ruleSource}): {a.weightUtilPercent.toFixed(1)}% weight, {a.cbmUtilPercent.toFixed(1)}% CBM
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default MicroOverrunToast;
