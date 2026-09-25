import { memo } from 'react';
import { MapLayout, SLOT_GAP, SLOT_H, SLOT_W } from '../../core/mapLayout';
import type { Team } from '../../core/types';
import { getTerms } from '../../core/terms';
import { symbolShape } from '../symbols';
import { MapTheme, shade, tint } from './theme';

interface Pt {
  x: number;
  y: number;
}

function Label({ text, color, t, y }: { text: string; color: string; t: MapTheme; y: number }) {
  // long theme words ("CHEQUERED FLAG") shrink so the label never reaches the winner-slot column
  const fs = Math.min(30, 256 / (text.length * 0.73));
  const w = text.length * fs * 0.73 + 44;
  return (
    <g transform={`translate(0 ${y})`}>
      <rect x={-w / 2} y={-25} width={w} height={50} rx={25} fill={t.chipBg} stroke={color} strokeWidth={5} />
      <text textAnchor="middle" dy="0.36em" fontSize={fs} fontWeight={900} fill={t.chipInk} className="board-font" letterSpacing="0.14em">{text}</text>
    </g>
  );
}

/** The Transmitter: every team starts at its foot. */
export const TxTower = memo(function TxTower({ p, t }: { p: Pt; t: MapTheme }) {
  const c = t.route.A;
  return (
    <g transform={`translate(${p.x} ${p.y - 14})`} pointerEvents="none">
      <ellipse cx={0} cy={16} rx={104} ry={28} fill={t.shadow} opacity={0.5} />
      <ellipse cx={0} cy={8} rx={100} ry={26} fill="url(#gMetal)" stroke={t.metalDark} strokeWidth={3} />
      <ellipse cx={0} cy={2} rx={84} ry={20} fill={tint(c, 20)} stroke={c} strokeWidth={4} />
      {/* lattice tower */}
      <path d="M-40 0 L-7 -230 M40 0 L7 -230" stroke="url(#gMetal)" strokeWidth={11} strokeLinecap="round" fill="none" />
      <path d="M-34 -40 H34 M-27 -90 H27 M-20 -140 H20 M-13 -186 H13 M-38 -14 L28 -90 M38 -14 L-28 -90 M-26 -70 L20 -140 M26 -70 L-20 -140" stroke={t.metalDark} strokeWidth={4} fill="none" strokeLinecap="round" />
      <rect x={-22} y={-250} width={44} height={26} rx={9} fill="url(#gMetal)" stroke={t.metalDark} strokeWidth={3} />
      <circle cx={0} cy={-276} r={30} fill="url(#gCore)" opacity={0.8} className="pulse-core" />
      <circle cx={0} cy={-276} r={19} fill="#ffffff" stroke={c} strokeWidth={5} />
      <circle cx={0} cy={-276} r={9} fill={c} />
      {[46, 72, 98].map((r, i) => (
        <path key={r} className={`pulse-wave w${i}`} d={`M${-r * 0.8} ${-276 - r * 0.6} A${r} ${r} 0 0 1 ${r * 0.8} ${-276 - r * 0.6}`} fill="none" stroke={c} strokeWidth={5} strokeLinecap="round" />
      ))}
      <g transform="translate(0 -340)"><Label text={getTerms().start} color={c} t={t} y={0} /></g>
    </g>
  );
});

/** The Receiver: big station/portal. `locked` = qualified teams so far, `total` = slots. */
export const RxStation = memo(function RxStation({ p, t, locked, total }: { p: Pt; t: MapTheme; locked: number; total: number }) {
  const done = total > 0 && locked >= total;
  const c = done ? '#f59e0b' : locked > 0 ? '#16a34a' : t.route.B;
  return (
    <g transform={`translate(${p.x} ${p.y - 8})`} pointerEvents="none">
      <ellipse cx={0} cy={14} rx={118} ry={30} fill={t.shadow} opacity={0.5} />
      <ellipse cx={0} cy={6} rx={110} ry={28} fill="url(#gMetal)" stroke={t.metalDark} strokeWidth={3} />
      <path d="M-70 0 L-46 -70 M70 0 L46 -70" stroke="url(#gMetal)" strokeWidth={14} strokeLinecap="round" />
      {/* the receiving ring */}
      <ellipse cx={0} cy={-104} rx={92} ry={104} fill={tint(c, 16)} opacity={t.dark ? 0.3 : 0.8} />
      <ellipse cx={0} cy={-104} rx={72} ry={82} fill={c} opacity={0.22} className={locked > 0 ? 'pulse-core' : undefined} />
      <ellipse cx={0} cy={-104} rx={92} ry={104} fill="none" stroke="url(#gMetal)" strokeWidth={22} />
      <ellipse cx={0} cy={-104} rx={92} ry={104} fill="none" stroke={c} strokeWidth={6} />
      <ellipse cx={0} cy={-104} rx={92} ry={104} fill="none" stroke="#ffffff" strokeWidth={3} strokeDasharray="12 20" className="spin-slow" />
      {Array.from({ length: total }, (_, i) => {
        const a = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / Math.max(1, total);
        return <circle key={i} cx={Math.cos(a) * 92} cy={-104 + Math.sin(a) * 104} r={9} fill={i < locked ? '#16a34a' : '#ffffff'} stroke={shade(c, 70)} strokeWidth={3} />;
      })}
      <path d="M-34 -70 Q0 -160 34 -70" fill="none" stroke="#ffffff" strokeWidth={8} strokeLinecap="round" />
      <path d="M-28 -78 Q0 -146 28 -78" fill="none" stroke={c} strokeWidth={5} strokeLinecap="round" />
      <line x1={0} y1={-108} x2={0} y2={-150} stroke="#ffffff" strokeWidth={7} strokeLinecap="round" />
      <line x1={0} y1={-108} x2={0} y2={-150} stroke={c} strokeWidth={3.5} strokeLinecap="round" />
      <circle cx={0} cy={-154} r={8} fill={c} stroke="#ffffff" strokeWidth={3} />
      <g transform="translate(0 -250)"><Label text={getTerms().finish} color={c} t={t} y={0} /></g>
    </g>
  );
});

/** Docking bays for the qualified teams, wired to the Receiver. */
export const SlotBays = memo(function SlotBays({
  layout,
  rx,
  t,
  teams,
  qualifiers,
  slots,
  recentSlot,
}: {
  layout: MapLayout;
  rx: Pt;
  t: MapTheme;
  teams: Team[];
  qualifiers: number[];
  slots: number;
  recentSlot: number | null;
}) {
  const a = layout.slotsAnchor;
  const spineX = a.x - 20;
  const bottom = a.y + slots * (SLOT_H + SLOT_GAP) - SLOT_GAP;
  const wire = t.route.B;
  return (
    <g pointerEvents="none">
      <path d={`M${rx.x + 70} ${rx.y - 30} C${rx.x + 120} ${rx.y - 30} ${spineX - 40} ${(a.y + bottom) / 2} ${spineX} ${(a.y + bottom) / 2}`} fill="none" stroke={t.shadow} strokeWidth={9} strokeLinecap="round" transform="translate(0 6)" />
      <path d={`M${rx.x + 70} ${rx.y - 30} C${rx.x + 120} ${rx.y - 30} ${spineX - 40} ${(a.y + bottom) / 2} ${spineX} ${(a.y + bottom) / 2}`} fill="none" stroke={wire} strokeWidth={6} strokeLinecap="round" strokeDasharray="2 14" className="flow" />
      <line x1={spineX} y1={a.y + 20} x2={spineX} y2={bottom - 20} stroke={wire} strokeWidth={8} strokeLinecap="round" opacity={0.7} />
      {Array.from({ length: slots }, (_, i) => {
        const id = qualifiers[i];
        const team = id ? teams.find((x) => x.id === id) : undefined;
        const y = a.y + i * (SLOT_H + SLOT_GAP);
        const col = team ? team.color : t.slotStroke;
        return (
          <g key={i} transform={`translate(${a.x} ${y})`} className={recentSlot === i + 1 ? 'slot-pop' : undefined}>
            <line x1={-20} y1={SLOT_H / 2} x2={0} y2={SLOT_H / 2} stroke={wire} strokeWidth={6} strokeLinecap="round" />
            <rect x={3} y={9} width={SLOT_W} height={SLOT_H} rx={20} fill={t.shadow} opacity={0.5} />
            <rect width={SLOT_W} height={SLOT_H} rx={20} fill={t.slotFill} stroke={col} strokeWidth={team ? 6 : 4} strokeDasharray={team ? undefined : '10 8'} />
            <rect x={10} y={8} width={SLOT_W - 20} height={26} rx={13} fill={team ? tint(col, 26) : t.dark ? '#16225e' : '#e8f1fb'} />
            <text x={SLOT_W / 2} y={22} textAnchor="middle" dy="0.36em" fontSize={19} fontWeight={900} fill={t.chipInk} className="board-font" letterSpacing="0.14em">SLOT {i + 1}</text>
            {team ? (
              <g>
                <g transform="translate(40 70)">{symbolShape(team.id - 1, 24, team.color, shade(team.color, 45), 4)}</g>
                <text x={76} y={64} fontSize={34} fontWeight={900} fill={t.chipInk} className="board-font">T{team.id}</text>
                <text x={76} y={88} fontSize={17} fontWeight={700} fill={t.inkSoft}>{team.name.length > 9 ? `${team.name.slice(0, 8)}…` : team.name}</text>
              </g>
            ) : (
              <g opacity={0.6}>
                <circle cx={SLOT_W / 2} cy={70} r={20} fill="none" stroke={t.slotStroke} strokeWidth={3} strokeDasharray="4 6" />
                <text x={SLOT_W / 2} y={70} textAnchor="middle" dy="0.36em" fontSize={16} fontWeight={700} fill={t.inkSoft}>OPEN</text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
});
