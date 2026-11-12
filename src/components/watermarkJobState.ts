import type { ExportProgress } from '../core/types';

export function isWatermarkJobActive(progress: ExportProgress | null, starting = false): boolean {
  return starting || progress?.state === 'running' || progress?.state === 'cancelling';
}

/** Event delivery and polling can interleave. Reject other jobs, stale counters
 * and updates arriving after a terminal state, including after cancellation. */
export function acceptWatermarkProgress(current: ExportProgress | null, incoming: ExportProgress, jobId: string): ExportProgress | null {
  if (incoming.jobId !== jobId || (current && !isWatermarkJobActive(current))) return current;
  if (current && incoming.completed < current.completed) return current;
  if (current?.state === 'cancelling' && incoming.state === 'running') return { ...incoming, state: 'cancelling' };
  return incoming;
}
