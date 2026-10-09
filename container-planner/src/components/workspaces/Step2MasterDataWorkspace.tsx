import { useEffect, useState } from 'react';
import { ContainerRulesTab } from '../rules/ContainerRulesTab';
import { CustomerRulesTab } from '../rules/CustomerRulesTab';

type Tab = 'container' | 'customer';

const TABS: { key: Tab; label: string }[] = [
  { key: 'container', label: 'Container Specs' },
  { key: 'customer', label: 'Customer Rules' },
];

export interface Step2MasterDataWorkspaceProps {
  /** Set when arriving here via Step 3's "Add Rule Now" — jumps straight to the Customer Rules
   * tab with the Add form pre-filled for this customer. */
  prefillCustomerId?: string | null;
  onPrefillConsumed?: () => void;
}

/** Step 2: the physical container specs, and the one rule tier — Customer Rules, one row per
 * customer + container type. */
export function Step2MasterDataWorkspace({ prefillCustomerId, onPrefillConsumed }: Step2MasterDataWorkspaceProps = {}) {
  const [tab, setTab] = useState<Tab>('customer');

  useEffect(() => {
    if (prefillCustomerId) setTab('customer');
  }, [prefillCustomerId]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Step 2 · Master Data</h2>
        <p className="text-sm text-slate-500">Container specs, and customer rules per container type.</p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-slate-200" aria-label="Master data tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'true' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.key ? 'border-indigo-500 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'container' && <ContainerRulesTab />}
      {tab === 'customer' && <CustomerRulesTab prefillCustomerId={prefillCustomerId} onPrefillConsumed={onPrefillConsumed} />}
    </div>
  );
}

export default Step2MasterDataWorkspace;
