import { useEffect, useRef } from 'react';
import type { LogEntry } from '../state/game';

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false });

function renderText(e: LogEntry) {
  return (
    <>
      {e.text}
      {e.from && e.to && e.from !== e.to && !e.text.includes('→') && (
        <>
          {' '}
          (<em>{e.from}</em> → <em>{e.to}</em>)
        </>
      )}
      {e.cards && <span className="cd">{e.cards}</span>}
    </>
  );
}

export function LogPanel({ log, max = 260, follow = true }: { log: LogEntry[]; max?: number; follow?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log.length, follow]);
  return (
    <div className="log" ref={ref} style={{ maxHeight: max }}>
      {log.length === 0 && <div className="muted">No events yet.</div>}
      {log.map((e) => (
        <div key={e.id} className={`log-row ${e.kind}`}>
          <span className="t">{time(e.ts)}</span>
          <span className="r">R{e.round}</span>
          <span className="x">{renderText(e)}</span>
        </div>
      ))}
    </div>
  );
}

export function logToText(log: LogEntry[]): string {
  return log
    .map((e) => `${time(e.ts)}  R${e.round}  ${e.text}${e.from && e.to && e.from !== e.to ? `  (${e.from} -> ${e.to})` : ''}${e.cards ? `  [${e.cards}]` : ''}`)
    .join('\n');
}

export function logToCsv(log: LogEntry[]): string {
  const q = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['time', 'round', 'team', 'kind', 'action', 'from', 'to', 'cards'].map(q).join(',')];
  for (const e of log) rows.push([time(e.ts), e.round, e.teamId ? `T${e.teamId}` : '', e.kind, e.text, e.from, e.to, e.cards].map(q).join(','));
  return rows.join('\n');
}

export function download(name: string, text: string, mime = 'text/csv') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
