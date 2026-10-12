import * as XLSX from 'xlsx';
import { detectColumns } from '../engine/dynamicSchema';

export interface ParsedSheet {
  columns: string[];
  rows: Record<string, any>[];
}

/** A row where every cell is an empty string — a blank trailing/leading row some exports leave in range. */
const isBlankRow = (row: Record<string, any>) => Object.values(row).every((v) => v === '' || v === undefined || v === null);

/**
 * Reads an uploaded .xlsx, .xls or .csv file entirely in the browser and returns its data
 * sheet's rows plus the detected column headers.
 *
 * Real SAP/Excel exports often carry more than one sheet — a cover page or an "Instructions"
 * sheet before the actual data — so every sheet is parsed and the one with the most data rows
 * wins, instead of always assuming `SheetNames[0]` is the right one. Fully blank rows inside the
 * data range (a common trailing-row artefact) are dropped.
 *
 * An empty file, a workbook with no sheets, or a workbook where every sheet is empty all resolve
 * to `{ columns: [], rows: [] }` rather than throwing.
 */
export async function parseExcelOrCsv(file: File): Promise<ParsedSheet> {
  if (file.size === 0) {
    return { columns: [], rows: [] };
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  let bestRows: Record<string, any>[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    // raw: false formats each cell the way Excel displays it (using the cell's number format),
    // instead of the underlying raw number. This matters a lot for SAP-style codes stored as a
    // zero-padded number format (e.g. customer code "0001000234") — raw mode would hand back the
    // plain number 1000234, silently dropping the padding and breaking every match against it.
    const parsed: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    const rows = parsed.filter((row) => !isBlankRow(row));
    if (rows.length > bestRows.length) bestRows = rows;
  }

  if (bestRows.length === 0) {
    return { columns: [], rows: [] };
  }

  return { columns: detectColumns(bestRows), rows: bestRows };
}
