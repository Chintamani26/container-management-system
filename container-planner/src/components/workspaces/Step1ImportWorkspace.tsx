import { useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, FileSpreadsheet, TriangleAlert, UploadCloud } from 'lucide-react';
import { parseExcelOrCsv } from '../../utils/excelParser';
import { mapCanonicalFields, cellToText, parseNumericCell, CANONICAL_FIELD_LABELS, type CanonicalField } from '../../engine/dynamicSchema';
import { applyImportedOrders } from '../../store/orderImportActions';
import { useRawOrdersStore } from '../../store/useRawOrdersStore';
import type { SAPOrderRow } from '../../types';

export interface Step1ImportWorkspaceProps {
  onNext: () => void;
}

interface ImportSummary {
  rows: number;
  customers: number;
  pos: number;
  mapping: Partial<Record<CanonicalField, string>>;
  blankCustomerId: number;
  missingData: number;
  zeroQuantity: number;
  missingWeight: number;
  zeroCbm: number;
}

const genId = () => `row-${Math.random().toString(36).slice(2, 9)}`;

/**
 * Step 1: imports a raw SAP/ERP order extract, fuzzy-matching its columns to the canonical fields
 * (dynamicSchema.ts) so it works with whatever headers the export actually uses. Doesn't render
 * the raw rows in a table (the data can include customer-identifying detail) — just a read-only
 * summary of what was found. Data-quality issues (zero quantity, missing weight, missing identity)
 * are only counted here; resolving them (skipping a PO) happens on the Planning stage, not here —
 * every imported row is committed to the store as-is, and the next screen is always Master Data.
 *
 * Deliberately does NOT touch Master Data (Container Specs / Customer Rules) in any way — no
 * dedicated-sheet scan, no embedded-table scan, no auto-drafted rows. Master Data starts empty and
 * is populated only by the admin via the "+ Add Container Spec" / "+ Add Customer Rule" forms in
 * Step 2, which persist permanently through `useMasterRulesStore`'s `persist` middleware.
 *
 * Where the parsed data ends up: every imported row is handed to `applyImportedOrders`, which
 * writes it into `useRawOrdersStore` (Zustand) — persisted to IndexedDB (not localStorage; a real
 * extract can be thousands of rows, past localStorage's ~5MB per-origin quota). From there, Step
 * 3's cascading filter and Step 4's allocator both read it straight out of that store.
 */
export function Step1ImportWorkspace({ onNext }: Step1ImportWorkspaceProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [showMapping, setShowMapping] = useState(false);

  const existingCount = useRawOrdersStore((s) => s.rawImportedRows.length);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const { columns, rows } = await parseExcelOrCsv(file);
      if (rows.length === 0) {
        setError('No data rows found in that file.');
        return;
      }

      const mapping = mapCanonicalFields(columns);
      if (!mapping.poNumber || !mapping.materialCode) {
        setError(`Couldn't find PO Number / Material Code columns. Detected columns: ${columns.join(', ')}`);
        return;
      }

      const imported: SAPOrderRow[] = rows.map((row) => ({
        id: genId(),
        poNumber: cellToText(row[mapping.poNumber!]),
        customerId: mapping.customerId ? cellToText(row[mapping.customerId]) : '',
        customerName: mapping.customerName ? cellToText(row[mapping.customerName]) : (mapping.customerId ? cellToText(row[mapping.customerId]) : ''),
        plant: mapping.plant ? cellToText(row[mapping.plant]) : undefined,
        shipWindow: mapping.shipWindow ? cellToText(row[mapping.shipWindow]) : undefined,
        country: mapping.country ? cellToText(row[mapping.country]) : undefined,
        port: mapping.port ? cellToText(row[mapping.port]) : undefined,
        materialCode: cellToText(row[mapping.materialCode!]),
        description: mapping.description ? cellToText(row[mapping.description]) : undefined,
        // parseNumericCell (not bare Number()) — a real export routinely formats large numbers
        // with thousands separators ("17,536"), which Number() turns into NaN and silently
        // becomes 0 downstream. This was the actual cause of "items showing 0 in planning".
        quantity: mapping.quantity ? parseNumericCell(row[mapping.quantity]) : 0,
        cartonQty: mapping.cartonQty ? parseNumericCell(row[mapping.cartonQty]) || undefined : undefined,
        weightKg: mapping.weightKg ? parseNumericCell(row[mapping.weightKg]) : 0,
        netWeightKg: mapping.netWeightKg ? parseNumericCell(row[mapping.netWeightKg]) || undefined : undefined,
        volumeCbm: mapping.volumeCbm ? parseNumericCell(row[mapping.volumeCbm]) : 0,
        vsnNo: mapping.vsnNo ? cellToText(row[mapping.vsnNo]) : undefined,
        customerProductCode: mapping.customerProductCode ? cellToText(row[mapping.customerProductCode]) : undefined,
        packMaster: mapping.packMaster ? cellToText(row[mapping.packMaster]) : undefined,
        packType: mapping.packType ? cellToText(row[mapping.packType]) : undefined,
        packType2: mapping.packType2 ? cellToText(row[mapping.packType2]) : undefined,
        cancelDate: mapping.cancelDate ? cellToText(row[mapping.cancelDate]) : undefined,
        transportMode: mapping.transportMode ? cellToText(row[mapping.transportMode]) : undefined,
      }));
      // 100% row preservation: every row from the sheet is kept in state, even one with a blank PO
      // Number/Material Code — it gets a 'missing_data' status flag instead of being silently
      // dropped. A row's status is checked in priority order — missing identity, then zero
      // quantity, then missing weight — so each row gets exactly one flag.
      for (const r of imported) {
        if (!r.poNumber || !r.materialCode) r.status = 'missing_data';
        else if (r.quantity <= 0) r.status = 'zero_qty';
        else if (!r.weightKg || r.weightKg <= 0) r.status = 'missing_weight';
      }

      if (imported.length === 0) {
        setError('No data rows found in that file.');
        return;
      }

      const missingData = imported.filter((r) => r.status === 'missing_data');
      const zeroQty = imported.filter((r) => r.status === 'zero_qty');
      const missingWeight = imported.filter((r) => r.status === 'missing_weight');

      if (import.meta.env.DEV) {
        const win = window as unknown as Record<string, unknown>;
        const parsedRows = imported;
        const omittedRows = rows.filter((_, i) => parsedRows[i] === undefined);
        win.__EXCEL_DEBUG__ = {
          totalRawRows: rows.length,
          rawSheetData: rows,
          parsedRows,
          omittedRows,
        };
        console.group('📦 Excel Import Audit');
        console.log('1. Raw Rows:', rows.length);
        console.log('2. Parsed Rows:', parsedRows.length);
        console.warn('3. Discarded Rows (Should be 0):', omittedRows);
        console.groupEnd();
      }

      applyImportedOrders(imported);

      setSummary({
        rows: imported.length,
        customers: new Set(imported.map((r) => r.customerId)).size,
        pos: new Set(imported.map((r) => r.poNumber)).size,
        mapping,
        blankCustomerId: imported.filter((r) => !r.customerId).length,
        missingData: missingData.length,
        zeroQuantity: zeroQty.length,
        missingWeight: missingWeight.length,
        zeroCbm: imported.filter((r) => r.volumeCbm <= 0).length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.');
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Step 1 · Import Orders</h2>
        <p className="text-sm text-slate-500">Upload a SAP/ERP order extract — headers are matched automatically.</p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
          isDraggingOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 bg-slate-50 hover:border-slate-400'
        }`}
      >
        <UploadCloud className="h-8 w-8 text-slate-400" aria-hidden="true" />
        <p className="text-sm font-medium text-slate-700">Drag & drop your order extract, or click to browse</p>
        <p className="text-xs text-slate-400">.xlsx, .xls or .csv</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-sm text-red-600">
          <FileSpreadsheet className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {summary && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
            <span>Total Rows Read: {summary.rows}</span>
            <span className="text-slate-300">|</span>
            <span>Valid Line Items: {summary.rows - summary.zeroQuantity - summary.missingData - summary.missingWeight}</span>
            <span className="text-slate-300">|</span>
            <span>Skipped (Qty = 0): {summary.zeroQuantity}</span>
            <span className="text-slate-300">|</span>
            <span>Warnings (Missing Data): {summary.missingData + summary.missingWeight}</span>
          </div>

          <p className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            Imported {summary.rows} rows across {summary.pos} PO(s) and {summary.customers} customer(s).
          </p>

          {(summary.blankCustomerId > 0 || summary.missingData > 0 || summary.zeroQuantity > 0 || summary.missingWeight > 0 || summary.zeroCbm > 0) && (
            <div className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p className="flex items-center gap-1.5 font-medium">
                <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                Data quality check — every row above is still kept (nothing is discarded); rows needing attention will be flagged again on the Planning stage:
              </p>
              <ul className="list-inside list-disc">
                {summary.missingData > 0 && <li>{summary.missingData} row(s) have no PO Number and/or no Material Code — kept in the data, but can't be identified for planning.</li>}
                {summary.blankCustomerId > 0 && <li>{summary.blankCustomerId} row(s) have no Customer ID — they can never match any customer filter or rule.</li>}
                {summary.zeroQuantity > 0 && <li>{summary.zeroQuantity} row(s) have a PO quantity of zero — they're excluded from the plan automatically.</li>}
                {summary.missingWeight > 0 && <li>{summary.missingWeight} row(s) have missing or zero weight — resolve on the Planning stage before allocating.</li>}
                {summary.zeroCbm > 0 && <li>{summary.zeroCbm} row(s) have zero volume (CBM).</li>}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowMapping((v) => !v)}
            className="flex items-center gap-1 self-start text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            {showMapping ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
            Which column was matched to each field?
          </button>
          {showMapping && (
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2.5 py-1.5 text-left font-semibold text-slate-600">Field</th>
                    <th className="px-2.5 py-1.5 text-left font-semibold text-slate-600">Matched Column</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {(Object.keys(CANONICAL_FIELD_LABELS) as CanonicalField[]).map((field) => (
                    <tr key={field}>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-slate-600">{CANONICAL_FIELD_LABELS[field]}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5">
                        {summary.mapping[field] ? (
                          <span className="text-slate-800">{summary.mapping[field]}</span>
                        ) : (
                          <span className="text-slate-400">not found</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={existingCount === 0 && !summary}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue to Master Data
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default Step1ImportWorkspace;
