import { memo } from 'react';
import type { Decoration, MapLayout } from '../../core/mapLayout';
import { MapTheme, shade, tint } from './theme';

/** Deterministic pseudo-random in [0,1) — scenery must look the same on every screen and every render. */
export const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Gradients shared by all layers (ids are theme-independent; colours come from the active theme). */
export function Defs({ t }: { t: MapTheme }) {
  return (
    <defs>
      <linearGradient id="gPlatTop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={t.platTopHi} />
        <stop offset="1" stopColor={t.platTop} />
      </linearGradient>
      <linearGradient id="gPlatSide" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={t.platSide} />
        <stop offset="1" stopColor={t.platSide2} />
      </linearGradient>
      <radialGradient id="gPlanet" cx="0.35" cy="0.3" r="0.9">
        <stop offset="0" stopColor={tint(t.planetB, 60)} />
        <stop offset="0.55" stopColor={t.planetA} />
        <stop offset="1" stopColor={shade(t.planetA, 55)} />
      </radialGradient>
      <radialGradient id="gCore" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.35" stopColor={t.route.A} stopOpacity="0.95" />
        <stop offset="1" stopColor={t.route.B} stopOpacity="0" />
      </radialGradient>
      <radialGradient id="gGlow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor={t.route.A} stopOpacity="0.55" />
        <stop offset="1" stopColor={t.route.A} stopOpacity="0" />
      </radialGradient>
      <radialGradient id="gNebA" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor={t.nebulaA} stopOpacity={t.dark ? 0.45 : 0.4} />
        <stop offset="1" stopColor={t.nebulaA} stopOpacity="0" />
      </radialGradient>
      <radialGradient id="gNebB" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor={t.nebulaB} stopOpacity={t.dark ? 0.4 : 0.35} />
        <stop offset="1" stopColor={t.nebulaB} stopOpacity="0" />
      </radialGradient>
      <linearGradient id="gDish" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor={t.metalDark} />
      </linearGradient>
      <linearGradient id="gMetal" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor={t.metal} />
        <stop offset="0.6" stopColor={tint(t.metalDark, 55)} />
        <stop offset="1" stopColor={t.metalDark} />
      </linearGradient>
    </defs>
  );
}

// ------------------------------------------------------------------ sky

export const Sky = memo(function Sky({ t, w, h }: { t: MapTheme; w: number; h: number }) {
  const stars = Math.round(70 * t.starDensity);
  return (
    <g pointerEvents="none">
      <ellipse cx={w * 0.22} cy={h * 0.25} rx={w * 0.3} ry={h * 0.32} fill="url(#gNebA)" />
      <ellipse cx={w * 0.8} cy={h * 0.7} rx={w * 0.3} ry={h * 0.34} fill="url(#gNebB)" />
      <ellipse cx={w * 0.6} cy={h * 0.15} rx={w * 0.22} ry={h * 0.2} fill="url(#gNebB)" opacity={0.6} />
      {Array.from({ length: stars }, (_, i) => {
        const x = -w * 0.15 + rnd(i * 3 + 1) * w * 1.3;
        const y = -h * 0.15 + rnd(i * 3 + 2) * h * 1.3;
        const r = 1.4 + rnd(i * 3 + 3) * 2.6;
        return i % 5 === 0 ? (
          <path key={i} d={`M${x} ${y - r * 2.6} L${x + r * 0.6} ${y - r * 0.6} L${x + r * 2.6} ${y} L${x + r * 0.6} ${y + r * 0.6} L${x} ${y + r * 2.6} L${x - r * 0.6} ${y + r * 0.6} L${x - r * 2.6} ${y} L${x - r * 0.6} ${y - r * 0.6} Z`} fill={t.starColor} opacity={0.55} />
        ) : (
          <circle key={i} cx={x} cy={y} r={r} fill={t.starColor} opacity={0.35 + rnd(i) * 0.4} />
        );
      })}
    </g>
  );
});

// ------------------------------------------------------------------ decor pieces (origin = base / centre)

function Platform({ w, t, seed }: { w: number; t: MapTheme; seed: number }) {
  const rx = w / 2;
  const ry = w * 0.15;
  const d = w * 0.3;
  const tufts = t.id === 'clean' ? Array.from({ length: 7 }, (_, i) => ({ x: (rnd(seed + i) - 0.5) * rx * 1.5, y: (rnd(seed + i + 9) - 0.5) * ry * 1.2 })) : [];
  return (
    <g>
      <ellipse cx={0} cy={d + ry * 2.6} rx={rx * 0.62} ry={ry * 0.42} fill={t.shadow} opacity={0.35} />
      <path
        d={`M${-rx} 2 C${-rx} ${d * 0.5} ${-rx * 0.6} ${d * 0.85} ${-rx * 0.28} ${d * 0.98} L${-rx * 0.08} ${d * 1.32} L${rx * 0.12} ${d * 1.0} L${rx * 0.34} ${d * 1.12} C${rx * 0.66} ${d * 0.8} ${rx} ${d * 0.45} ${rx} 2 Z`}
        fill="url(#gPlatSide)"
      />
      <path d={`M${-rx * 0.5} ${d * 0.25} L${-rx * 0.18} ${d * 0.95} L${rx * 0.02} ${d * 0.4} Z`} fill={tint(t.platSide, 60)} opacity={0.35} />
      <ellipse cx={0} cy={7} rx={rx} ry={ry} fill={shade(t.platRim, 75)} />
      <ellipse cx={0} cy={0} rx={rx} ry={ry} fill="url(#gPlatTop)" stroke={t.platRim} strokeWidth={t.dark ? 4 : 3} />
      <ellipse cx={0} cy={0} rx={rx * 0.78} ry={ry * 0.72} fill="none" stroke={t.platRim} strokeWidth={2} opacity={0.35} strokeDasharray="6 10" />
      {tufts.map((p, i) => (
        <g key={i} transform={`translate(${p.x} ${p.y})`} opacity={0.9}>
          <ellipse cx={0} cy={2} rx={11} ry={4} fill="#5fb34c" opacity={0.5} />
          <path d="M-5 0 Q-3 -12 0 -2 Q3 -14 6 0 Z" fill="#4c9f3e" />
        </g>
      ))}
    </g>
  );
}

const Planet = ({ t }: { t: MapTheme }) => (
  <g>
    <ellipse cx={0} cy={0} rx={112} ry={24} fill="none" stroke={tint(t.planetB, 55)} strokeWidth={9} opacity={0.6} transform="rotate(-18)" />
    <circle r={62} fill="url(#gPlanet)" />
    <path d="M-40 -18 Q0 -34 42 -14" fill="none" stroke="#ffffff" strokeWidth={7} opacity={0.3} strokeLinecap="round" />
    <path d="M-48 12 Q0 26 50 8" fill="none" stroke="#ffffff" strokeWidth={5} opacity={0.2} strokeLinecap="round" />
    <ellipse cx={0} cy={0} rx={112} ry={24} fill="none" stroke={tint(t.planetB, 70)} strokeWidth={9} opacity={0.75} transform="rotate(-18)" strokeDasharray="120 400" strokeDashoffset={-30} />
  </g>
);

const Cloud = ({ t }: { t: MapTheme }) => (
  <g fill={t.cloud} opacity={t.dark ? 0.35 : 0.9}>
    <ellipse cx={0} cy={8} rx={84} ry={20} />
    <circle cx={-28} cy={-4} r={28} />
    <circle cx={10} cy={-14} r={34} />
    <circle cx={46} cy={-2} r={24} />
  </g>
);

const Rock = ({ t }: { t: MapTheme }) => (
  <g>
    <path d="M-40 -6 L-14 -26 L20 -22 L44 -2 L18 24 L-10 40 L-30 18 Z" fill="url(#gPlatSide)" />
    <path d="M-40 -6 L-14 -26 L20 -22 L44 -2 L0 6 Z" fill={t.platTop} stroke={t.platRim} strokeWidth={2} />
  </g>
);

const Satellite = ({ t }: { t: MapTheme }) => (
  <g>
    <rect x={-70} y={-12} width={50} height={26} rx={4} fill={t.route.A} opacity={0.85} stroke="#ffffff" strokeWidth={2} />
    <rect x={20} y={-12} width={50} height={26} rx={4} fill={t.route.A} opacity={0.85} stroke="#ffffff" strokeWidth={2} />
    <path d="M-70 1 H-20 M20 1 H70 M-45 -12 V14 M45 -12 V14" stroke="#ffffff" strokeWidth={1.6} opacity={0.7} />
    <rect x={-18} y={-20} width={36} height={40} rx={9} fill="url(#gMetal)" stroke={t.metalDark} strokeWidth={2} />
    <circle cx={0} cy={0} r={8} fill={t.route.B} />
    <path d="M0 -20 V-34" stroke={t.metalDark} strokeWidth={3} />
    <circle cx={0} cy={-36} r={5} fill={t.route.C} />
  </g>
);

const Dish = ({ t }: { t: MapTheme }) => (
  <g>
    <ellipse cx={0} cy={2} rx={30} ry={8} fill={t.shadow} opacity={0.5} />
    <path d="M-8 0 L-4 -30 H4 L8 0 Z" fill="url(#gMetal)" />
    <path d="M-34 -50 Q0 -8 34 -50 Q0 -32 -34 -50 Z" fill="url(#gDish)" stroke={t.metalDark} strokeWidth={2.5} strokeLinejoin="round" />
    <path d="M0 -40 V-72" stroke={t.metalDark} strokeWidth={3} />
    <circle cx={0} cy={-74} r={6} fill={t.route.C} />
    <path className="pulse-wave" d="M-16 -86 Q0 -100 16 -86" fill="none" stroke={t.route.A} strokeWidth={4} strokeLinecap="round" />
    <path className="pulse-wave w2" d="M-26 -94 Q0 -116 26 -94" fill="none" stroke={t.route.A} strokeWidth={4} strokeLinecap="round" />
  </g>
);

const Relay = ({ t }: { t: MapTheme }) => (
  <g>
    <ellipse cx={0} cy={2} rx={34} ry={9} fill={t.shadow} opacity={0.5} />
    <rect x={-8} y={-62} width={16} height={64} rx={6} fill="url(#gMetal)" stroke={t.metalDark} strokeWidth={2} />
    <ellipse cx={0} cy={-52} rx={44} ry={12} fill="none" stroke={t.route.B} strokeWidth={6} />
    <ellipse cx={0} cy={-52} rx={44} ry={12} fill="none" stroke="#ffffff" strokeWidth={2} strokeDasharray="10 14" />
    <circle cx={0} cy={-76} r={13} fill="url(#gMetal)" stroke={t.metalDark} strokeWidth={2} />
    <circle cx={0} cy={-76} r={5} fill={t.route.A} />
    <path d="M0 -89 V-108" stroke={t.metalDark} strokeWidth={3} />
    <circle cx={0} cy={-110} r={5} fill={t.route.C} />
  </g>
);

const Crystal = ({ t }: { t: MapTheme }) => (
  <g>
    <ellipse cx={0} cy={3} rx={34} ry={8} fill={t.shadow} opacity={0.45} />
    <path d="M-24 0 L-16 -44 L-6 0 Z" fill={tint(t.route.A, 55)} stroke="#ffffff" strokeWidth={1.5} />
    <path d="M-8 0 L4 -78 L18 0 Z" fill={t.route.A} opacity={0.9} stroke="#ffffff" strokeWidth={1.5} />
    <path d="M4 -78 L8 0 L18 0 Z" fill={shade(t.route.A, 75)} opacity={0.5} />
    <path d="M14 0 L26 -50 L34 0 Z" fill={tint(t.route.B, 60)} stroke="#ffffff" strokeWidth={1.5} />
    <path d="M-2 -60 L4 -70 L6 -52 Z" fill="#ffffff" opacity={0.7} />
  </g>
);

const Observatory = ({ t }: { t: MapTheme }) => (
  <g>
    <ellipse cx={0} cy={3} rx={44} ry={10} fill={t.shadow} opacity={0.45} />
    <rect x={-28} y={-34} width={56} height={36} rx={4} fill="url(#gMetal)" stroke={t.metalDark} strokeWidth={2} />
    <path d="M-30 -34 A30 30 0 0 1 30 -34 Z" fill="#ffffff" stroke={t.metalDark} strokeWidth={2.5} />
    <path d="M-5 -62 L5 -62 L9 -34 L-9 -34 Z" fill={t.route.A} opacity={0.85} />
    <path d="M-2 -60 L26 -84" stroke={t.metalDark} strokeWidth={6} strokeLinecap="round" />
    <rect x={-8} y={-20} width={16} height={22} rx={3} fill={t.route.B} opacity={0.8} />
  </g>
);

const Gate = ({ t }: { t: MapTheme }) => (
  <g>
    <ellipse cx={0} cy={4} rx={70} ry={12} fill={t.shadow} opacity={0.35} />
    <path d="M-54 0 V-86 A54 54 0 0 1 54 -86 V0" fill="none" stroke="url(#gMetal)" strokeWidth={16} strokeLinecap="round" />
    <path d="M-54 0 V-86 A54 54 0 0 1 54 -86 V0" fill="none" stroke={t.route.S} strokeWidth={4} opacity={0.9} />
    <path d="M-44 -6 V-86 A44 44 0 0 1 44 -86 V-6 Z" fill={t.route.S} opacity={0.18} />
    <circle cx={0} cy={-140} r={9} fill={t.route.C} stroke="#ffffff" strokeWidth={2} />
  </g>
);

const Portal = ({ t }: { t: MapTheme }) => (
  <g>
    <ellipse cx={0} cy={2} rx={50} ry={11} fill={t.shadow} opacity={0.4} />
    <ellipse cx={0} cy={-58} rx={38} ry={58} fill={t.route.B} opacity={0.2} />
    <ellipse cx={0} cy={-58} rx={38} ry={58} fill="none" stroke={t.route.B} strokeWidth={9} />
    <ellipse cx={0} cy={-58} rx={38} ry={58} fill="none" stroke="#ffffff" strokeWidth={2.5} strokeDasharray="14 18" className="spin-slow" />
    <path d="M-16 -80 Q0 -100 12 -70 Q26 -40 0 -32 Q-22 -30 -18 -55" fill="none" stroke={t.route.A} strokeWidth={4.5} strokeLinecap="round" opacity={0.9} />
  </g>
);

const Core = ({ t }: { t: MapTheme }) => (
  <g>
    <ellipse cx={0} cy={6} rx={92} ry={20} fill={t.shadow} opacity={0.4} />
    <circle cx={0} cy={-104} r={120} fill="url(#gCore)" opacity={0.55} />
    <ellipse cx={0} cy={-104} rx={84} ry={26} fill="none" stroke={t.route.A} strokeWidth={7} opacity={0.9} transform="rotate(-14 0 -104)" />
    <ellipse cx={0} cy={-104} rx={84} ry={26} fill="none" stroke="#ffffff" strokeWidth={2.5} strokeDasharray="16 22" transform="rotate(-14 0 -104)" className="spin-slow" />
    <ellipse cx={0} cy={-104} rx={64} ry={20} fill="none" stroke={t.route.B} strokeWidth={6} opacity={0.9} transform="rotate(26 0 -104)" />
    <circle cx={0} cy={-104} r={34} fill="#ffffff" opacity={0.95} />
    <circle cx={0} cy={-104} r={24} fill={t.route.A} />
    <circle cx={-8} cy={-112} r={8} fill="#ffffff" opacity={0.8} />
    <path d="M-12 0 L-8 -50 H8 L12 0 Z" fill="url(#gMetal)" stroke={t.metalDark} strokeWidth={2.5} />
    <ellipse cx={0} cy={-2} rx={36} ry={10} fill="url(#gMetal)" stroke={t.metalDark} strokeWidth={2.5} />
    <path className="pulse-wave" d="M-56 -146 Q0 -190 56 -146" fill="none" stroke={t.route.A} strokeWidth={5} strokeLinecap="round" />
    <path className="pulse-wave w2" d="M-76 -160 Q0 -222 76 -160" fill="none" stroke={t.route.A} strokeWidth={5} strokeLinecap="round" />
  </g>
);

const Tower = ({ t }: { t: MapTheme }) => (
  <g>
    <ellipse cx={0} cy={3} rx={26} ry={7} fill={t.shadow} opacity={0.45} />
    <path d="M-14 0 L-3 -110 H3 L14 0" fill="none" stroke="url(#gMetal)" strokeWidth={7} strokeLinejoin="round" />
    <path d="M-10 -30 H10 M-7 -60 H7 M-5 -86 H5" stroke={t.metalDark} strokeWidth={3} />
    <circle cx={0} cy={-116} r={8} fill={t.route.A} stroke="#ffffff" strokeWidth={2} />
    <path className="pulse-wave" d="M-16 -128 Q0 -144 16 -128" fill="none" stroke={t.route.A} strokeWidth={3.5} strokeLinecap="round" />
  </g>
);

const Hub = ({ t }: { t: MapTheme }) => (
  <g>
    <ellipse cx={0} cy={4} rx={70} ry={14} fill={t.shadow} opacity={0.4} />
    <path d="M-50 0 L-40 -42 H40 L50 0 Z" fill="url(#gMetal)" stroke={t.metalDark} strokeWidth={2.5} strokeLinejoin="round" />
    <path d="M-34 -42 A34 30 0 0 1 34 -42 Z" fill="#ffffff" stroke={t.metalDark} strokeWidth={2.5} />
    <rect x={-8} y={-30} width={16} height={30} rx={3} fill={t.route.S} opacity={0.9} />
    <path d="M0 -72 V-96" stroke={t.metalDark} strokeWidth={3.5} />
    <circle cx={0} cy={-100} r={7} fill={t.route.C} />
    <path className="pulse-wave" d="M-18 -112 Q0 -130 18 -112" fill="none" stroke={t.route.S} strokeWidth={4} strokeLinecap="round" />
  </g>
);

const Jelly = ({ t }: { t: MapTheme }) => (
  <g opacity={0.92}>
    <path d="M-44 0 A44 40 0 0 1 44 0 Q30 10 20 6 Q10 14 0 6 Q-10 14 -20 6 Q-30 10 -44 0 Z" fill={tint(t.route.B, 40)} stroke="#ffffff" strokeWidth={2.5} />
    <ellipse cx={-14} cy={-14} rx={16} ry={9} fill="#ffffff" opacity={0.55} />
    {[-28, -10, 10, 28].map((x, i) => (
      <path key={i} d={`M${x} 8 q${i % 2 ? 9 : -9} 16 0 28 q${i % 2 ? -9 : 9} 14 0 26`} fill="none" stroke={tint(t.route.B, 55)} strokeWidth={4} strokeLinecap="round" />
    ))}
    <circle cx={-14} cy={-2} r={4} fill={t.ink} />
    <circle cx={14} cy={-2} r={4} fill={t.ink} />
  </g>
);

const Probe = ({ t }: { t: MapTheme }) => (
  <g>
    <ellipse cx={0} cy={-30} rx={34} ry={40} fill="#ffffff" stroke={t.route.C} strokeWidth={3} />
    <path d="M-34 -30 Q0 -76 34 -30" fill={t.route.C} opacity={0.85} />
    <path d="M-12 -68 Q-22 -30 -8 6 M12 -68 Q22 -30 8 6" stroke={t.route.C} strokeWidth={4} fill="none" opacity={0.75} />
    <path d="M-16 8 L-9 26 M16 8 L9 26" stroke={t.metalDark} strokeWidth={2.5} />
    <rect x={-13} y={26} width={26} height={18} rx={4} fill="url(#gMetal)" stroke={t.metalDark} strokeWidth={2} />
    <circle cx={0} cy={-40} r={6} fill={t.route.A} />
  </g>
);

export function DecorPiece({ d, t }: { d: Decoration; t: MapTheme }) {
  switch (d.kind) {
    case 'platform':
      return <Platform w={d.w ?? 220} t={t} seed={Math.round(d.x + d.y)} />;
    case 'planet':
      return <Planet t={t} />;
    case 'cloud':
      return <Cloud t={t} />;
    case 'rock':
      return <Rock t={t} />;
    case 'satellite':
      return <Satellite t={t} />;
    case 'dish':
      return <Dish t={t} />;
    case 'relay':
      return <Relay t={t} />;
    case 'crystal':
      return <Crystal t={t} />;
    case 'observatory':
      return <Observatory t={t} />;
    case 'gate':
      return <Gate t={t} />;
    case 'portal':
      return <Portal t={t} />;
    case 'core':
      return <Core t={t} />;
    case 'tower':
      return <Tower t={t} />;
    case 'hub':
      return <Hub t={t} />;
    case 'jelly':
      return <Jelly t={t} />;
    case 'probe':
      return <Probe t={t} />;
    default:
      return null;
  }
}

/** Floating things bob gently; big structures stay put. */
const FLOATERS = new Set(['satellite', 'probe', 'jelly', 'rock', 'cloud', 'planet']);

/** Decorative world: sky details, platforms, landmarks. Never interactive unless the editor asks for it. */
export const Scenery = memo(function Scenery({
  layout,
  t,
  editor,
}: {
  layout: MapLayout;
  t: MapTheme;
  editor?: { selected: string | null; onDown: (id: string, e: React.PointerEvent) => void };
}) {
  const order = (k: string) => (k === 'planet' || k === 'cloud' || k === 'rock' ? 0 : k === 'platform' ? 1 : 2);
  const sorted = layout.decor
    .map((d, i) => ({ d, i }))
    .sort((a, b) => order(a.d.kind) - order(b.d.kind) || a.d.y - b.d.y || a.i - b.i)
    .map((x) => x.d);
  return (
    <g pointerEvents={editor ? undefined : 'none'}>
      {sorted.map((d, i) => (
        <g
          key={d.id}
          transform={`translate(${d.x} ${d.y}) rotate(${d.rot}) scale(${d.scale})`}
          className={FLOATERS.has(d.kind) ? `bob b${i % 3}` : undefined}
          onPointerDown={editor ? (e) => editor.onDown(d.id, e) : undefined}
          style={editor ? { cursor: 'grab' } : undefined}
        >
          <DecorPiece d={d} t={t} />
          {editor?.selected === d.id && <circle r={(d.w ?? 140) * 0.45} fill="none" stroke="#f43f5e" strokeWidth={4} strokeDasharray="10 8" />}
        </g>
      ))}
    </g>
  );
});
