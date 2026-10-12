import { useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface SingleSelectDropdownProps {
  placeholder: string;
  options: string[];
  selected: string;
  onChange: (selected: string) => void;
  /** Optional per-option display label (e.g. "1503 — Eastvale Plant") while `selected`/`onChange`
   * still deal in the raw option value. Also used to match typed search text. */
  labelFor?: (option: string) => string;
}

/** A strict single-select dropdown for filter panels — picking a new option always replaces
 * whatever was selected before (never adds to it), unlike CheckboxDropdown's multi-select. Clicking
 * the currently selected option again clears the selection. The trigger shows the selected option's
 * own name/code, not a generic "(1)" count. */
export function SingleSelectDropdown({ placeholder, options, selected, onChange, labelFor }: SingleSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const displayLabel = (opt: string) => labelFor?.(opt) ?? opt;
  const query = search.trim().toLowerCase();
  const visibleOptions = query === '' ? options : options.filter((opt) => displayLabel(opt).toLowerCase().includes(query));

  const pick = (opt: string) => {
    onChange(opt === selected ? '' : opt);
    setOpen(false);
    setSearch('');
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
      >
        <span className="truncate text-left">
          {selected === '' ? <span className="text-slate-400">{placeholder}</span> : displayLabel(selected)}
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
                <button
                  type="button"
                  key={opt}
                  onClick={() => pick(opt)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                >
                  <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
                    {opt === selected && <Check className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />}
                  </span>
                  <span className="truncate">{displayLabel(opt)}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default SingleSelectDropdown;
