import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ConfirmedPlan, ContainerAllocation, DraftPlan } from '../types';

interface PlanState {
  draftPlans: DraftPlan[];
  confirmedPlans: ConfirmedPlan[];

  submitDraft: (allocations: ContainerAllocation[], createdBy: string, strategyName?: string) => string;
  updateDraft: (draftId: string, allocations: ContainerAllocation[]) => void;
  approveDraft: (draftId: string, confirmedBy: string) => string;
  rejectDraft: (draftId: string) => void;
}

const genId = (prefix: string) => `${prefix}-${Date.now()}`;

/** Draft plans wait for Admin review (Step 6); an approved draft becomes a ConfirmedPlan, visible
 * to the Viewer role and exportable (Step 7). */
export const usePlanStore = create<PlanState>()(
  persist(
    (set, get) => ({
      draftPlans: [],
      confirmedPlans: [],

      submitDraft: (allocations, createdBy, strategyName) => {
        const draftId = genId('DRAFT');
        const draft: DraftPlan = {
          draftId,
          createdAt: new Date().toISOString(),
          createdBy,
          allocations,
          status: 'PENDING_REVIEW',
          strategyName,
        };
        set((state) => ({ draftPlans: [...state.draftPlans, draft] }));
        return draftId;
      },

      updateDraft: (draftId, allocations) =>
        set((state) => ({
          draftPlans: state.draftPlans.map((d) => (d.draftId === draftId ? { ...d, allocations } : d)),
        })),

      approveDraft: (draftId, confirmedBy) => {
        const draft = get().draftPlans.find((d) => d.draftId === draftId);
        const planId = genId('PLN');
        if (draft) {
          const plan: ConfirmedPlan = {
            planId,
            draftId,
            confirmedAt: new Date().toISOString(),
            confirmedBy,
            allocations: draft.allocations,
          };
          set((state) => ({
            draftPlans: state.draftPlans.map((d) => (d.draftId === draftId ? { ...d, status: 'APPROVED' } : d)),
            confirmedPlans: [...state.confirmedPlans, plan],
          }));
        }
        return planId;
      },

      rejectDraft: (draftId) =>
        set((state) => ({
          draftPlans: state.draftPlans.map((d) => (d.draftId === draftId ? { ...d, status: 'REJECTED' } : d)),
        })),
    }),
    // v2: bumped alongside the master-rules store so stale draft/confirmed plans from an earlier
    // schema can't resurface with a shape this code doesn't expect.
    { name: 'plan-storage-v2' }
  )
);
