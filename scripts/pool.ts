// Tiny worker-thread pool for evaluating layouts in parallel on all CPU cores.
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import type { Report } from '../src/sim/metrics';
import type { SimConfig } from '../src/sim/model';

export class EvalPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { id: number; cfg: SimConfig; games: number; seed: number }[] = [];
  private pending = new Map<number, (r: Report) => void>();
  private next = 0;

  constructor(size = Math.max(1, os.cpus().length)) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./evalWorker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] });
      w.on('message', (m: { id: number; report: Report }) => {
        this.pending.get(m.id)!(m.report);
        this.pending.delete(m.id);
        this.idle.push(w);
        this.pump();
      });
      w.on('error', (e) => {
        console.error('worker error', e);
        process.exit(1);
      });
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      w.postMessage(this.queue.shift()!);
    }
  }

  run(cfg: SimConfig, games: number, seed: number): Promise<Report> {
    return new Promise((resolve) => {
      const id = this.next++;
      this.pending.set(id, resolve);
      this.queue.push({ id, cfg, games, seed });
      this.pump();
    });
  }

  async close() {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
