import { useState } from 'react';
import { Eye, PackagePlus } from 'lucide-react';
import { Header } from './components/common/Header';
import { StepperWizard, isStepAllowedForRole, defaultStepForRole } from './components/common/StepperWizard';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { Step1ImportWorkspace } from './components/workspaces/Step1ImportWorkspace';
import { Step2MasterDataWorkspace } from './components/workspaces/Step2MasterDataWorkspace';
import { Step3PlanningWorkspace } from './components/workspaces/Step3PlanningWorkspace';
import { Step4AutoAllocationWorkspace } from './components/workspaces/Step4AutoAllocationWorkspace';
import { Step5PlanEditorWorkspace } from './components/workspaces/Step5PlanEditorWorkspace';
import { Step6AdminReviewWorkspace } from './components/workspaces/Step6AdminReviewWorkspace';
import { Step7CgAndExportWorkspace } from './components/workspaces/Step7CgAndExportWorkspace';
import { usePlanStore } from './store/usePlanStore';
import { useAuthStore } from './store/useAuthStore';
import type { ContainerAllocation } from './types';

function App() {
  // Planner Mode lands directly on the Planning stage (Step 3), skipping import/master-data
  // setup — Admin/Viewer still start at the welcome screen (step 0).
  const [currentStep, setCurrentStep] = useState(() => defaultStepForRole(useAuthStore.getState().role));
  const [maxCompletedStep, setMaxCompletedStep] = useState(() => defaultStepForRole(useAuthStore.getState().role));
  // The strategy chosen in Step 4, carried into Step 5 for editing and submission.
  const [workingAllocations, setWorkingAllocations] = useState<ContainerAllocation[]>([]);
  const [strategyName, setStrategyName] = useState('');
  // Set by Step 3's "Add Rule Now" — jumps to Step 2 with the Add Customer Rule form pre-filled.
  const [prefillCustomerId, setPrefillCustomerId] = useState<string | null>(null);
  // Default to the most recent draft/confirmed plan already in the (persisted) store, so Step 6/7
  // have something to show right after a reload instead of only during the session that made them.
  const [activeDraftId, setActiveDraftId] = useState<string | null>(() => {
    const pending = usePlanStore.getState().draftPlans.filter((d) => d.status === 'PENDING_REVIEW');
    return pending.length > 0 ? pending[pending.length - 1].draftId : null;
  });
  const [activePlanId, setActivePlanId] = useState<string | null>(() => {
    const plans = usePlanStore.getState().confirmedPlans;
    return plans.length > 0 ? plans[plans.length - 1].planId : null;
  });

  const role = useAuthStore((s) => s.role);

  const goTo = (step: number) => {
    if (!isStepAllowedForRole(role, step)) return;
    setCurrentStep(step);
    setMaxCompletedStep((prev) => Math.max(prev, step));
  };

  // Role can change mid-session via the header's RoleSwitcher. If that leaves the current step
  // off-limits (e.g. an Admin on step 2 switches to Planner), bounce to that role's own default
  // starting step rather than leaving a now-unauthorized workspace on screen. Done during render
  // (React's documented pattern for adjusting state from a changed condition) rather than in an
  // effect: the check is self-terminating, since every role's default step is always allowed for
  // it, so it can't loop.
  if (!isStepAllowedForRole(role, currentStep)) {
    setCurrentStep(defaultStepForRole(role));
  }

  return (
    <ErrorBoundary>
      <div className="flex min-h-screen flex-col bg-slate-50">
        <Header activePlanId={activePlanId ?? activeDraftId} />

        <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <StepperWizard currentStep={currentStep} maxCompletedStep={maxCompletedStep} role={role} onStepSelect={goTo} />
        </div>

        <main className="flex-1 px-4 py-6 sm:px-6">
          {currentStep === 0 && (
            <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-slate-200 bg-white p-8 text-center">
              {role === 'VIEWER' ? (
                <>
                  <Eye className="h-10 w-10 text-indigo-500" aria-hidden="true" />
                  <h2 className="text-lg font-semibold text-slate-900">Welcome to Container Planner</h2>
                  <p className="text-sm text-slate-500">
                    The Viewer role only has access to confirmed plans — load factors, the 2D balance diagram, and the
                    dispatch manifest export.
                  </p>
                  <button
                    type="button"
                    onClick={() => goTo(7)}
                    className="mt-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                  >
                    View Confirmed Plans
                  </button>
                </>
              ) : (
                <>
                  <PackagePlus className="h-10 w-10 text-indigo-500" aria-hidden="true" />
                  <h2 className="text-lg font-semibold text-slate-900">Welcome to Container Planner</h2>
                  <p className="text-sm text-slate-500">
                    Import a SAP order extract, set up master data, filter down to what you're planning, auto-allocate
                    containers, fine-tune the plan, get it approved, then export the dispatch manifest.
                  </p>
                  <button
                    type="button"
                    onClick={() => goTo(1)}
                    className="mt-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                  >
                    Get Started
                  </button>
                </>
              )}
            </div>
          )}

          {currentStep === 1 && <Step1ImportWorkspace onNext={() => goTo(2)} />}

          {currentStep === 2 && (
            <div className="flex flex-col gap-4">
              <Step2MasterDataWorkspace prefillCustomerId={prefillCustomerId} onPrefillConsumed={() => setPrefillCustomerId(null)} />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => goTo(3)}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  Continue to Planning
                </button>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <Step3PlanningWorkspace
              onNext={() => goTo(4)}
              onAddRuleForCustomer={
                role === 'ADMIN'
                  ? (customerId) => {
                      setPrefillCustomerId(customerId);
                      goTo(2);
                    }
                  : undefined
              }
            />
          )}
          {currentStep === 4 && (
            <Step4AutoAllocationWorkspace
              onNext={(allocations, name) => {
                setWorkingAllocations(allocations);
                setStrategyName(name);
                goTo(5);
              }}
              onEditRules={role === 'ADMIN' ? () => goTo(2) : undefined}
            />
          )}
          {currentStep === 5 && (
            <Step5PlanEditorWorkspace
              allocations={workingAllocations}
              strategyName={strategyName}
              onSubmitted={(draftId) => {
                setActiveDraftId(draftId);
                goTo(6);
              }}
            />
          )}
          {currentStep === 6 && (
            <Step6AdminReviewWorkspace
              draftId={activeDraftId}
              onApproved={(planId) => {
                setActivePlanId(planId);
                goTo(7);
              }}
              onRejected={() => goTo(5)}
            />
          )}
          {currentStep === 7 && <Step7CgAndExportWorkspace planId={activePlanId} />}
        </main>
      </div>
    </ErrorBoundary>
  );
}

export default App;
