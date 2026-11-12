import { describe, expect, it } from 'vitest';
import type { ExportProgress } from '../core/types';
import { acceptWatermarkProgress, isWatermarkJobActive } from './watermarkJobState';

const progress = (patch: Partial<ExportProgress> = {}): ExportProgress => ({ jobId: 'watermark_job', completed: 1, total: 10, pageName: '照片.jpg', state: 'running', errors: [], paths: [], ...patch });
describe('watermark job event and close boundaries', () => {
  it('blocks dismissal throughout startup, processing and cancellation, releasing it only for terminal states', () => {
    expect(isWatermarkJobActive(null, true)).toBe(true);
    expect(isWatermarkJobActive(null)).toBe(false);
    for (const state of ['running', 'cancelling'] as const) expect(isWatermarkJobActive(progress({ state }))).toBe(true);
    for (const state of ['cancelled', 'completed', 'failed'] as const) expect(isWatermarkJobActive(progress({ state }))).toBe(false);
  });
  it('ignores unrelated jobs and out-of-order counters when polling and events overlap', () => {
    const current = progress({ completed: 4 });
    expect(acceptWatermarkProgress(current, progress({ jobId: 'collage_export' }), current.jobId)).toBe(current);
    expect(acceptWatermarkProgress(current, progress({ completed: 3 }), current.jobId)).toBe(current);
    const next = progress({ completed: 5 });
    expect(acceptWatermarkProgress(current, next, current.jobId)).toBe(next);
  });
  it('keeps cancellation visible while accepting the current photo completing, then prevents terminal regression', () => {
    const current = progress({ state: 'cancelling', completed: 4 });
    const next = acceptWatermarkProgress(current, progress({ completed: 5 }), current.jobId)!;
    expect(next.state).toBe('cancelling'); expect(next.completed).toBe(5);
    const cancelled = progress({ completed: 5, state: 'cancelled' });
    expect(acceptWatermarkProgress(next, cancelled, current.jobId)).toBe(cancelled);
    expect(acceptWatermarkProgress(cancelled, progress({ completed: 6 }), current.jobId)).toBe(cancelled);
    const failed = progress({ state: 'failed' });
    expect(acceptWatermarkProgress(failed, progress({ state: 'completed' }), failed.jobId)).toBe(failed);
  });
});
