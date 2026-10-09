import type { CargoBlock, ContainerAllocation, ContainerSpec, GravityResult } from '../types';

const DEFAULT_CG_TOLERANCE_PERCENT = 5;

/** Lays each item out along the container's length in loading order, proportional to its share of
 * the container's total volume — a deliberate simplification since this planner allocates by
 * aggregate weight/CBM per order line, not individual carton geometry. Width is assumed centred
 * and full; height is derived from the item's own volume share of its footprint, floor-loaded. */
export function buildCargoBlocks(allocation: ContainerAllocation, spec: ContainerSpec): CargoBlock[] {
  const totalCbm = allocation.items.reduce((s, i) => s + i.volumeCbm, 0);
  if (totalCbm <= 0) return [];

  let cursorX = 0;
  return allocation.items.map((item, i) => {
    const depthCm = (item.volumeCbm / totalCbm) * spec.internalLengthCm;
    const footprintM2 = (depthCm / 100) * (spec.internalWidthCm / 100);
    const heightCm = footprintM2 > 0 ? Math.min(spec.internalHeightCm, (item.volumeCbm / footprintM2) * 100) : spec.internalHeightCm;
    const block: CargoBlock = {
      id: `${allocation.id}-blk-${i}`,
      label: item.materialCode,
      xCm: cursorX,
      yCm: 0,
      widthCm: spec.internalWidthCm,
      depthCm,
      heightCm: Math.max(1, heightCm),
      weightKg: item.weightKg,
    };
    cursorX += depthCm;
    return block;
  });
}

/** Mass-weighted centre of gravity on all three axes, plus the % offset from the container's own
 * centreline on X (length) and Y (width) — OK if both are within tolerance, WARNING otherwise. */
export function calculateGravity(blocks: CargoBlock[], spec: ContainerSpec, tolerancePercent = DEFAULT_CG_TOLERANCE_PERCENT): GravityResult {
  const totalWeight = blocks.reduce((s, b) => s + b.weightKg, 0);
  if (totalWeight <= 0) {
    return {
      xCgCm: spec.internalLengthCm / 2,
      yCgCm: spec.internalWidthCm / 2,
      zCgCm: 0,
      offsetXPercent: 0,
      offsetYPercent: 0,
      verdict: 'OK',
    };
  }

  const xCgCm = blocks.reduce((s, b) => s + b.weightKg * (b.xCm + b.depthCm / 2), 0) / totalWeight;
  const yCgCm = blocks.reduce((s, b) => s + b.weightKg * (b.yCm + b.widthCm / 2), 0) / totalWeight;
  const zCgCm = blocks.reduce((s, b) => s + b.weightKg * (b.heightCm / 2), 0) / totalWeight;

  // Guards against a zero-dimension spec (e.g. a blank row never filled in on the Container
  // Specs tab) producing a division by zero that would otherwise render as a silent NaN%.
  const offsetXPercent = spec.internalLengthCm > 0 ? ((xCgCm - spec.internalLengthCm / 2) / spec.internalLengthCm) * 100 : 0;
  const offsetYPercent = spec.internalWidthCm > 0 ? ((yCgCm - spec.internalWidthCm / 2) / spec.internalWidthCm) * 100 : 0;
  const verdict: GravityResult['verdict'] =
    Math.abs(offsetXPercent) <= tolerancePercent && Math.abs(offsetYPercent) <= tolerancePercent ? 'OK' : 'WARNING';

  return { xCgCm, yCgCm, zCgCm, offsetXPercent, offsetYPercent, verdict };
}
