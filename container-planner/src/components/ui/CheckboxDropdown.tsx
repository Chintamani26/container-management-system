import { useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export interface CheckboxDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  /** Optional per-option display label (e.g. "CUST-001 — Acme Inc.") while `selected`/`onChange`
   * still deal in the raw option value. Also used to match typed search text. */
  labelFor?: (option: string) => string;
}

/** A multi-select dropdown for filter panels — click to open, search, check any number of
 * options, click outside to close. Empty selection conventionally means "no filter on this
 * dimension". */
export function CheckboxDropdown({ label, options, selected, onChange, labelFor }: CheckboxDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt]);
  };

  const displayLabel = (opt: string) => labelFor?.(opt) ?? opt;
  const query = search.trim().toLowerCase();
  const visibleOptions = query === '' ? options : options.filter((opt) => displayLabel(opt).toLowerCase().includes(query));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
      >
        <span className="truncate text-left">
          {label}
          {selected.length > 0 && <span className="ml-1 text-slate-400">({selected.length})</span>}
        </span>
        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full min-w-[16rem] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
            {options.length > 6 && (
              <div className="flex items-center gap-1.5 border-b border-slate-100 px-2 py-1.5">
                <Search className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full text-sm focus:outline-none"
                />
              </div>
            )}
            <div className="max-h-56 overflow-y-auto p-1">
              {visibleOptions.length === 0 && <p className="px-2 py-1.5 text-xs text-slate-400">No matches.</p>}
              {visibleOptions.map((opt) => (
                <label key={opt} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt)}
                    onChange={() => toggle(opt)}
                    className="h-3.5 w-3.5 flex-shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="truncate">{displayLabel(opt)}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default CheckboxDropdown;
