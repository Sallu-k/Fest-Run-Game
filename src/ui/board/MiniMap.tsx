import { useMemo } from 'react';
import { buildBoard } from '../../core/board';
import { MapLayout, applyLayout, ensureLayout } from '../../core/mapLayout';
import type { BoardConfig, RulesConfig } from '../../core/types';
import { BoardCanvas } from './BoardCanvas';
import { themeOf } from './theme';
import { useViewPrefs } from '../hooks';

/** Read-only (or click-to-edit) map preview used by the map picker and the Board Balancer. Fills its
 *  positioned parent. */
export function MiniMap({
  cfg,
  rules,
  layout,
  heat,
  showIds,
  onNodeClick,
  selectedNode,
}: {
  cfg: BoardConfig;
  rules: RulesConfig;
  layout?: MapLayout | null;
  heat?: Record<string, number>;
  showIds?: boolean;
  onNodeClick?: (id: string) => void;
  selectedNode?: string | null;
}) {
  const prefs = useViewPrefs();
  const world = useMemo(() => {
    try {
      const b = buildBoard(cfg);
      const l = ensureLayout(b, layout);
      return { board: applyLayout(b, l), layout: l };
    } catch {
      return null;
    }
  }, [cfg, layout]);
  if (!world) return null;
  return (
    <BoardCanvas
      mode={onNodeClick ? 'editor' : 'host'}
      tools={!!onNodeClick}
      board={world.board}
      layout={world.layout}
      theme={themeOf(prefs.style)}
      teams={[]}
      slots={5}
      qualifiers={[]}
      showCards
      heat={heat}
      showIds={showIds}
      boosterAmount={rules.boosterAmount}
      noiseBack={rules.noiseBack}
      calm
      follow={false}
      editor={
        onNodeClick
          ? {
              selectedNode: selectedNode ?? null,
              selectedDecor: null,
              onNodeDown: (id, e) => {
                e.stopPropagation();
                onNodeClick(id);
              },
              onDecorDown: () => undefined,
              onSlotsDown: () => undefined,
            }
          : undefined
      }
    />
  );
}
