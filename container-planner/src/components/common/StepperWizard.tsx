import { Check } from 'lucide-react';
import type { UserRole } from '../../types';

const STEP_LABELS = ['Start', 'Import', 'Master Data', 'Planning', 'Auto-Allocate', 'Plan Editor', 'Admin Review', 'CG & Export'];

/** Step access by role: Viewer only ever sees the welcome screen and confirmed plans (step 7);
 * Planner goes straight into the planning flow (3-5, 7) — Master Data (2) is an admin-only
 * configuration screen, hidden from Planner Mode; Admin sees everything. */
export function isStepAllowedForRole(role: UserRole, step: number): boolean {
  if (role === 'VIEWER') return step === 0 || step === 7;
  if (role === 'PLANNER') return step !== 2 && step !== 6;
  return true; // ADMIN
}

/** Where a role's workflow starts — Planner lands directly on the Planning stage (Step 3),
 * bypassing import/master-data setup entirely, rather than the generic welcome screen. */
export function defaultStepForRole(role: UserRole): number {
  if (role === 'PLANNER') return 3;
  return 0;
}

export interface StepperWizardProps {
  currentStep: number;
  maxCompletedStep: number;
  role: UserRole;
  onStepSelect: (step: number) => void;
}

export function StepperWizard({ currentStep, maxCompletedStep, role, onStepSelect }: StepperWizardProps) {
  // A step off-limits for this role (e.g. Master Data for Planner) is left out of the nav
  // entirely, rather than shown disabled — it isn't part of that role's workflow at all.
  const visibleSteps = STEP_LABELS.map((label, step) => ({ label, step })).filter(({ step }) => isStepAllowedForRole(role, step));

  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {visibleSteps.map(({ label, step }, i) => {
        const isDone = step < maxCompletedStep;
        const isActive = step === currentStep;
        const isReachable = step <= maxCompletedStep;
        return (
          <li key={step} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => isReachable && onStepSelect(step)}
              disabled={!isReachable}
              aria-current={isActive ? 'step' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : isDone
                    ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {isDone && !isActive ? <Check className="h-3 w-3" aria-hidden="true" /> : <span>{step}</span>}
              {label}
            </button>
            {i < visibleSteps.length - 1 && <span className="h-px w-3 bg-slate-200" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

export default StepperWizard;
