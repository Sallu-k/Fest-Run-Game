import { useMemo, useState } from 'react';
import { buildBoard, longestPath, shortestPath } from '../core/board';
import { classicLanes } from '../core/classicBoard';
import { MapConfiguration } from '../core/mapEdit';
import { wheelLanes } from '../core/wheelBoard';
import { MAP_PRESETS, MapLength, MapPreset } from '../data/mapPresets';
import { saveActiveMap } from '../state/mapStore';
import { MiniMap } from './board/MiniMap';
import { useTerms } from './hooks';

function presetStats(preset: MapPreset) {
  const map = preset.build();
  const board = buildBoard(map.board);
  const lanes = classicLanes(board);
  const wheel = wheelLanes(board);
  const counts = { chance: 0, noise: 0, booster: 0 };
  for (const n of board.nodes) if (n.special) counts[n.special.type]++;
  return {
    map,
    paths: lanes ? `${lanes.laneIds.length} paths` : wheel ? `${new Set(wheel.groups.map((g) => g.stage)).size} rings` : '',
    shortest: shortestPath(board),
    longest: longestPath(board),
    ...counts,
  };
}

const FILTERS: ('All' | MapLength)[] = ['All', 'Quick', 'Standard', 'Long'];

/** Pre-game map selection: preview + stats for every shipped map. USE MAP makes it the map for new
 *  games; EDIT MAP does the same and opens the Map Editor on it. */
export function MapPresetPicker({ current, onApplied }: { current?: string; onApplied?: (preset: MapPreset, map: MapConfiguration) => void }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const stats = useMemo(() => MAP_PRESETS.map((p) => ({ preset: p, stat: presetStats(p) })), []);
  const t = useTerms();
  const shown = stats.filter(({ preset }) => filter === 'All' || preset.length === filter);
  const apply = (preset: MapPreset, map: MapConfiguration) => {
    saveActiveMap(map);
    onApplied?.(preset, map);
  };

  return (
    <div className="panel wide">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>3 · CHOOSE A MAP</h3>
        <div className="seg small">
          {FILTERS.map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      </div>
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 12.5 }}>
        {MAP_PRESETS.length} maps, each simulated so no route is a free win. Every map works with every theme, and any of them can be tweaked in the Map Editor.
      </p>
      <div className="map-preset-grid">
        {shown.map(({ preset, stat }) => (
          <div key={preset.id} className={`map-preset-card ${current === preset.id ? 'current' : ''}`}>
            <div className="mini-board" style={{ aspectRatio: '16/10' }}>
              <MiniMap cfg={stat.map.board} rules={stat.map.rules} layout={stat.map.layout} showIds={false} />
            </div>
            <div className="body">
              <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                <b className="name">{preset.name}</b>
                <span className={`len-badge ${preset.length.toLowerCase()}`}>{preset.length}</span>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>{preset.blurb}</p>
              <div className="stat-row">
                <span><b>{preset.rounds}</b> rounds</span>
                <span>{preset.teams[0]}–{preset.teams[1]} teams</span>
                <span>{stat.paths}</span>
                <span>{stat.shortest === stat.longest ? stat.shortest : `${stat.shortest}–${stat.longest}`} spaces</span>
              </div>
              <div className="stat-row">
                <span>{stat.chance}× {t.chance}</span>
                <span>{stat.noise}× {t.noise}</span>
                <span>{stat.booster}× {t.booster}</span>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn small go" disabled={current === preset.id} onClick={() => apply(preset, stat.map)}>
                  {current === preset.id ? '✔ IN USE' : 'USE MAP'}
                </button>
                <button
                  className="btn small"
                  onClick={() => {
                    apply(preset, stat.map);
                    window.location.hash = '#/map';
                  }}
                >
                  EDIT MAP
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
