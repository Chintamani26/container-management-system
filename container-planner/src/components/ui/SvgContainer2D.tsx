import type { CargoBlock, GravityResult } from '../../types';

export interface SvgContainer2DProps {
  blocks: CargoBlock[];
  gravity: GravityResult;
  internalLengthCm: number;
}

const PALETTE = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#8b5cf6', '#f97316', '#84cc16'];

/** A side-view 2D balance diagram: each item as a block along the container's length, with the
 * CG marked as a dashed line that turns red when the balance check fails. */
export function SvgContainer2D({ blocks, gravity, internalLengthCm }: SvgContainer2DProps) {
  const drawW = 640;
  const scale = drawW / internalLengthCm;
  const maxHeight = Math.max(1, ...blocks.map((b) => b.heightCm));
  const drawH = maxHeight * scale;
  const cgX = gravity.xCgCm * scale;
  const centreX = (internalLengthCm / 2) * scale;

  return (
    <svg width={drawW + 16} height={drawH + 28} className="rounded border border-slate-200 bg-white">
      <g transform="translate(8,8)">
        <rect x={0} y={0} width={internalLengthCm * scale} height={drawH} fill="none" stroke="#cbd5e1" />
        {blocks.map((b, i) => (
          <rect
            key={b.id}
            x={b.xCm * scale}
            y={drawH - b.heightCm * scale}
            width={Math.max(1, b.depthCm * scale)}
            height={b.heightCm * scale}
            fill={PALETTE[i % PALETTE.length]}
            opacity={0.85}
            stroke="#ffffff"
            strokeWidth={0.5}
          />
        ))}
        <line x1={centreX} y1={0} x2={centreX} y2={drawH} stroke="#94a3b8" strokeDasharray="2,2" />
        <line x1={cgX} y1={0} x2={cgX} y2={drawH} stroke={gravity.verdict === 'OK' ? '#f59e0b' : '#dc2626'} strokeDasharray="4,3" strokeWidth={2} />
        <text x={Math.max(0, cgX - 20)} y={12} fontSize={10} fill={gravity.verdict === 'OK' ? '#b45309' : '#dc2626'}>
          CG {gravity.xCgCm.toFixed(0)} cm ({gravity.offsetXPercent >= 0 ? '+' : ''}
          {gravity.offsetXPercent.toFixed(1)}%)
        </text>
        <text x={Math.max(0, centreX - 24)} y={drawH + 14} fontSize={10} fill="#94a3b8">
          centre {(internalLengthCm / 2).toFixed(0)} cm
        </text>
      </g>
    </svg>
  );
}

export default SvgContainer2D;
