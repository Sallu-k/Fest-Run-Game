import { useEffect, useState } from 'react';
import { Balancer } from './Balancer';
import { Host } from './Host';
import { Projector } from './Projector';
import { MapEditor } from './MapEditor';
import { useViewPrefs } from './hooks';
import { titleFor } from '../state/mapStore';

function useHash(): string {
  const [h, setH] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const on = () => setH(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return h;
}

export function App() {
  const hash = useHash();
  const prefs = useViewPrefs();
  useEffect(() => {
    const { event, game } = titleFor(prefs);
    document.title = event ? `${event} — ${game}` : `${game} — FestRun`;
  }, [prefs]);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.style;
    document.documentElement.dataset.calm = String(prefs.calm);
  }, [prefs.style, prefs.calm]);
  useEffect(() => {
    // Hidden admin shortcut: Ctrl+Shift+B opens the Board Balancer.
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        window.location.hash = '#/balancer';
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  if (hash.startsWith('#/projector')) return <Projector />;
  if (hash.startsWith('#/balancer')) return <Balancer />;
  if (hash.startsWith('#/map')) return <MapEditor />;
  return <Host />;
}
