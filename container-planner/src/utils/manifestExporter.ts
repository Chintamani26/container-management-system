import * as XLSX from 'xlsx';
import { buildCargoBlocks, calculateGravity } from '../engine/gravityEngine';
import { findSpecByType } from '../engine/ruleResolver';
import type { AllocatedItem, ConfirmedPlan, ContainerAllocation, ContainerSpec } from '../types';

const PLANNING_COLUMNS = [
  'Container Planning',
  'PO No',
  'Customer Product Code',
  'VSN No',
  'Plant',
  'Ship Date',
  'Cancel Date',
  'Material Description',
  'Port Name',
  'Pack Master',
  'PO Qty',
  'Carton Qty',
  'Total CBM',
  'Gross Weight (Kg)',
  'Net Weight (Kg)',
  'Transport Mode',
] as const;

type PlanningRow = Record<(typeof PLANNING_COLUMNS)[number], string | number>;

const blankRow = (): PlanningRow =>
  PLANNING_COLUMNS.reduce((row, col) => ({ ...row, [col]: '' }), {} as PlanningRow);

function itemRow(item: AllocatedItem): PlanningRow {
  return {
    ...blankRow(),
    'PO No': item.poNumber,
    'Customer Product Code': item.customerProductCode ?? '',
    'VSN No': item.vsnNo ?? '',
    Plant: item.plant ?? '',
    'Ship Date': item.shipDate ?? '',
    'Cancel Date': item.cancelDate ?? '',
    'Material Description': item.description ?? item.materialCode,
    'Port Name': item.port ?? '',
    'Pack Master': item.packMaster ?? '',
    'PO Qty': item.quantity,
    'Carton Qty': item.cartonQty ?? '',
    'Total CBM': Number(item.volumeCbm.toFixed(2)),
    'Gross Weight (Kg)': Number(item.weightKg.toFixed(2)),
    'Net Weight (Kg)': Number((item.netWeightKg ?? item.weightKg).toFixed(2)),
    'Transport Mode': item.transportMode ?? '',
  };
}

/**
 * Builds the "Container Planning" sheet in the exact layout this company's own dispatch planners
 * already use: one container per block — a header row naming the sequence and type ("01 x 40HC"),
 * one row per item with that container's own share of PO/carton qty/weight/CBM, then a subtotal
 * row, then a blank separator before the next container. A grand-total row closes the sheet.
 */
function buildContainerPlanningRows(allocations: ContainerAllocation[]): PlanningRow[] {
  const rows: PlanningRow[] = [];
  const typeSeq = new Map<string, number>();

  let grandQty = 0;
  let grandCartons = 0;
  let grandCbm = 0;
  let grandGross = 0;
  let grandNet = 0;

  for (const a of allocations) {
    const seq = (typeSeq.get(a.containerType) ?? 0) + 1;
    typeSeq.set(a.containerType, seq);

    let subQty = 0;
    let subCartons = 0;
    let subCbm = 0;
    let subGross = 0;
    let subNet = 0;

    a.items.forEach((item, i) => {
      const row = itemRow(item);
      if (i === 0) row['Container Planning'] = `${String(seq).padStart(2, '0')} x ${a.containerType}`;
      rows.push(row);
      subQty += item.quantity;
      subCartons += item.cartonQty ?? 0;
      subCbm += item.volumeCbm;
      subGross += item.weightKg;
      subNet += item.netWeightKg ?? item.weightKg;
    });

    rows.push({
      ...blankRow(),
      'PO Qty': subQty,
      'Carton Qty': Number(subCartons.toFixed(2)),
      'Total CBM': Number(subCbm.toFixed(2)),
      'Gross Weight (Kg)': Number(subGross.toFixed(2)),
      'Net Weight (Kg)': Number(subNet.toFixed(2)),
    });
    rows.push(blankRow());

    grandQty += subQty;
    grandCartons += subCartons;
    grandCbm += subCbm;
    grandGross += subGross;
    grandNet += subNet;
  }

  rows.push({
    ...blankRow(),
    'Container Planning': 'TOTAL',
    'PO Qty': grandQty,
    'Carton Qty': Number(grandCartons.toFixed(2)),
    'Total CBM': Number(grandCbm.toFixed(2)),
    'Gross Weight (Kg)': Number(grandGross.toFixed(2)),
    'Net Weight (Kg)': Number(grandNet.toFixed(2)),
  });

  return rows;
}

/** Exports a confirmed plan as a dispatch manifest workbook: a "Container Planning" sheet in this
 * company's own historical layout, plus a Summary sheet with utilisation and CG verdict. */
export function exportDispatchManifest(plan: ConfirmedPlan, containerSpecs: ContainerSpec[]): void {
  const workbook = XLSX.utils.book_new();

  const planningSheet = XLSX.utils.json_to_sheet(buildContainerPlanningRows(plan.allocations), { header: [...PLANNING_COLUMNS] });
  XLSX.utils.book_append_sheet(workbook, planningSheet, 'Container Planning');

  const summaryRows = plan.allocations.map((a: ContainerAllocation, i) => {
    const spec = findSpecByType(containerSpecs, a.containerType);
    const blocks = spec ? buildCargoBlocks(a, spec) : [];
    const gravity = spec ? calculateGravity(blocks, spec) : undefined;
    return {
      Container: `#${i + 1}`,
      Type: a.containerType,
      Status: a.status,
      'Gross Weight (kg)': Number(a.totalWeightKg.toFixed(1)),
      'Net Weight (kg)': Number(a.totalNetWeightKg.toFixed(1)),
      'Weight Util %': Number(a.weightUtilPercent.toFixed(1)),
      'CBM Used': Number(a.totalCbm.toFixed(2)),
      'CBM Util %': Number(a.cbmUtilPercent.toFixed(1)),
      'Xcg (cm)': gravity ? Number(gravity.xCgCm.toFixed(1)) : '',
      'Xcg Offset %': gravity ? Number(gravity.offsetXPercent.toFixed(2)) : '',
      'Balance Verdict': gravity?.verdict ?? '',
      'Rule Source': a.ruleSource,
    };
  });
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary');

  XLSX.writeFile(workbook, `dispatch-manifest-${plan.planId}.xlsx`);
}
