import type { ReactElement } from 'react';
import { TEAM_COLORS } from '../state/game';

const poly = (pts: [number, number][]) => pts.map((p) => p.join(',')).join(' ');
const star = (r: number, inner: number, n: number) => {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const rr = i % 2 === 0 ? r : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    pts.push([+(Math.cos(a) * rr).toFixed(2), +(Math.sin(a) * rr).toFixed(2)]);
  }
  return poly(pts);
};

/**
 * Team symbol as an SVG shape centred on (0,0). Index order matches ● ▲ ■ ◆ ★ ✦ ✚ ☼ ◇ ⬢.
 * Drawn as shapes (not font glyphs) so they look identical on every laptop/projector.
 */
export function symbolShape(idx: number, r: number, fill: string, stroke = '#04070d', sw = 2): ReactElement {
  const common = { fill, stroke, strokeWidth: sw, strokeLinejoin: 'round' as const };
  switch (idx % 10) {
    case 0:
      return <circle r={r} {...common} />;
    case 1:
      return <polygon points={poly([[0, -r * 1.1], [r * 1.05, r * 0.85], [-r * 1.05, r * 0.85]])} {...common} />;
    case 2:
      return <rect x={-r * 0.9} y={-r * 0.9} width={r * 1.8} height={r * 1.8} rx={r * 0.12} {...common} />;
    case 3:
      return <polygon points={poly([[0, -r * 1.15], [r * 1.05, 0], [0, r * 1.15], [-r * 1.05, 0]])} {...common} />;
    case 4:
      return <polygon points={star(r * 1.2, r * 0.5, 5)} {...common} />;
    case 5:
      return <polygon points={star(r * 1.3, r * 0.38, 4)} {...common} />;
    case 6: {
      const a = r * 0.36;
      const b = r * 1.05;
      return (
        <polygon
          points={poly([[-a, -b], [a, -b], [a, -a], [b, -a], [b, a], [a, a], [a, b], [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a]])}
          {...common}
        />
      );
    }
    case 7:
      return (
        <g>
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i * Math.PI) / 4;
            return (
              <line
                key={i}
                x1={Math.cos(a) * r * 0.7}
                y1={Math.sin(a) * r * 0.7}
                x2={Math.cos(a) * r * 1.2}
                y2={Math.sin(a) * r * 1.2}
                stroke={fill}
                strokeWidth={Math.max(2, r * 0.22)}
                strokeLinecap="round"
              />
            );
          })}
          <circle r={r * 0.68} {...common} />
        </g>
      );
    case 8:
      return (
        <polygon
          points={poly([[0, -r * 1.1], [r, 0], [0, r * 1.1], [-r, 0]])}
          fill="#05080f"
          stroke={fill}
          strokeWidth={Math.max(3, r * 0.34)}
          strokeLinejoin="round"
        />
      );
    default: {
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 - Math.PI / 6;
        pts.push([+(Math.cos(a) * r * 1.1).toFixed(2), +(Math.sin(a) * r * 1.1).toFixed(2)]);
      }
      return <polygon points={poly(pts)} {...common} />;
    }
  }
}

export function TeamIcon({ index, size = 22, color }: { index: number; size?: number; color?: string }) {
  const c = color ?? TEAM_COLORS[index % 10];
  return (
    <svg className="team-icon" width={size} height={size} viewBox="-14 -14 28 28" aria-hidden>
      {symbolShape(index, 9.5, c, '#04070d', 1.6)}
    </svg>
  );
}
