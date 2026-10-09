import { useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Package } from 'lucide-react';
import type { AllocationStatus, ContainerAllocation } from '../../types';

export interface ContainerDropZoneProps {
  allocations: ContainerAllocation[];
  onMoveItem: (fromContainerId: string, toContainerId: string, orderId: string) => void;
}

const STATUS_STYLES: Record<AllocationStatus, string> = {
  OK: 'border-slate-200',
  MICRO_OVERRUN: 'border-amber-300 bg-amber-50/40',
  OVER_LIMIT: 'border-red-300 bg-red-50/40',
  MISSING_RULE: 'border-red-300 bg-red-50/40',
};

/** Step 5's plan editor: drag an item from one container card to another to fine-tune the
 * auto-allocation before submitting it for review. Click an item to expand its full detail — the
 * same fields Step 4 shows, so you don't have to go back a step to check what you're moving. */
export function ContainerDropZone({ allocations, onMoveItem }: ContainerDropZoneProps) {
  const [draggingFrom, setDraggingFrom] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {allocations.map((allocation) => (
        <div
          key={allocation.id}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverId(allocation.id);
          }}
          onDragLeave={() => setDragOverId((id) => (id === allocation.id ? null : id))}
          onDrop={(e) => {
            e.preventDefault();
            const orderId = e.dataTransfer.getData('text/plain');
            if (draggingFrom && orderId) onMoveItem(draggingFrom, allocation.id, orderId);
            setDragOverId(null);
            setDraggingFrom(null);
          }}
          className={`flex flex-col gap-2 rounded-lg border bg-white p-3 transition-colors ${STATUS_STYLES[allocation.status]} ${
            dragOverId === allocation.id ? 'ring-2 ring-indigo-400' : ''
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Package className="h-4 w-4 text-indigo-500" aria-hidden="true" />
              {allocation.containerType} — {allocation.id}
            </p>
            {allocation.status !== 'OK' && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{allocation.status}</span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            {allocation.totalWeightKg.toFixed(0)} kg ({allocation.weightUtilPercent.toFixed(1)}%) ·{' '}
            {allocation.totalCbm.toFixed(1)} CBM ({allocation.cbmUtilPercent.toFixed(1)}%)
          </p>
          <ul className="flex flex-col gap-1">
            {allocation.items.map((item) => {
              const key = `${allocation.id}-${item.orderId}-${item.materialCode}`;
              const isOpen = expanded.has(key);
              return (
                <li key={key} className="rounded-md border border-slate-200 bg-slate-50">
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', item.orderId);
                      setDraggingFrom(allocation.id);
                    }}
                    className="flex cursor-grab items-center gap-1.5 px-2 py-1.5 text-xs active:cursor-grabbing"
                  >
                    <GripVertical className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => toggleExpanded(key)}
                      className="flex-shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200"
                      aria-label={isOpen ? 'Collapse details' : 'Expand details'}
                    >
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                    <span className="flex-1 truncate">
                      {item.poNumber} / {item.materialCode}
                    </span>
                    <span className="text-slate-400">{item.weightKg.toFixed(0)} kg</span>
                  </div>
                  {isOpen && (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-200 px-2.5 py-2 text-[11px]">
                      <dt className="col-span-2 truncate text-slate-500" title={item.description}>
                        {item.description || '—'}
                      </dt>
                      <dt className="text-slate-400">PO Qty</dt>
                      <dd className="text-right text-slate-700">
                        {item.quantity}
                        {item.isSplit && <span className="ml-1 text-amber-600">(split of {item.poQty})</span>}
                      </dd>
                      <dt className="text-slate-400">Carton Qty</dt>
                      <dd className="text-right text-slate-700">{item.cartonQty?.toFixed(0) ?? '—'}</dd>
                      <dt className="text-slate-400">Weight / Net</dt>
                      <dd className="text-right text-slate-700">
                        {item.weightKg.toFixed(1)} / {(item.netWeightKg ?? item.weightKg).toFixed(1)} kg
                      </dd>
                      <dt className="text-slate-400">CBM</dt>
                      <dd className="text-right text-slate-700">{item.volumeCbm.toFixed(2)}</dd>
                      <dt className="text-slate-400">VSN No</dt>
                      <dd className="text-right text-slate-700">{item.vsnNo || '—'}</dd>
                      <dt className="text-slate-400">Customer Product Code</dt>
                      <dd className="text-right text-slate-700">{item.customerProductCode || '—'}</dd>
                      <dt className="text-slate-400">Pack Master / Type</dt>
                      <dd className="text-right text-slate-700">
                        {item.packMaster || '—'} / {item.packType || '—'}
                      </dd>
                    </dl>
                  )}
                </li>
              );
            })}
            {allocation.items.length === 0 && <li className="rounded-md border border-dashed border-slate-200 px-2 py-3 text-center text-xs text-slate-400">Drop here</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default ContainerDropZone;
