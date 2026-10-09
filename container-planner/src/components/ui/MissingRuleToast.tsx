import { AlertOctagon } from 'lucide-react';
import type { SAPOrderRow } from '../../types';

export interface MissingRuleToastProps {
  orders: SAPOrderRow[];
  onEditRules?: () => void;
}

/** Orders whose customer has no matching customer/country/standard rule can't be allocated at
 * all — surfaced loudly rather than silently dropped. */
export function MissingRuleToast({ orders, onEditRules }: MissingRuleToastProps) {
  if (orders.length === 0) return null;

  const customers = [...new Set(orders.map((o) => o.customerId))];

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <div className="flex items-start gap-2">
        <AlertOctagon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium">{orders.length} order line(s) have no matching rule and could not be allocated.</p>
          <p className="text-xs">Customers: {customers.join(', ')}</p>
        </div>
      </div>
      {onEditRules && (
        <button
          type="button"
          onClick={onEditRules}
          className="flex-shrink-0 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
        >
          Edit Rules
        </button>
      )}
    </div>
  );
}

export default MissingRuleToast;
