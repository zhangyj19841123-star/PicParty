import { describe, expect, it } from 'vitest';
import type { ImageAsset } from '../core/types';
import { defaultWatermarkPlacement } from '../core/watermarkPlacement';
import { defaultTextWatermark } from '../core/watermarkSettings';
import { initialWatermarkHistory, removeWatermarkLayer, selectWatermarkReference, watermarkHistoryReducer, type WatermarkEdit } from './watermarkEditHistory';

const mark = { id: 'mark', originalPath: '/photos/brand.png' } as ImageAsset;
const reference = { id: 'photo', originalPath: '/photos/reference.jpg' } as ImageAsset;
const empty: WatermarkEdit = { preset: { watermarkPath: '', placement: defaultWatermarkPlacement() }, referencePath: '', profileId: '' };
const populated = (edit: WatermarkEdit): WatermarkEdit => ({
  ...edit, watermark: mark, reference, referencePath: reference.originalPath,
  preset: {
    ...edit.preset, watermarkPath: mark.originalPath, imageEnabled: true, textEnabled: true,
    text: { ...defaultTextWatermark(), text: '署名', color: '#ff8000' },
  },
});

describe('watermark edit history', () => {
  it('adds, deletes, restores and re-deletes image and text layers independently', () => {
    const before = initialWatermarkHistory(empty);
    const added = watermarkHistoryReducer(before, { type: 'edit', time: 1, update: populated });
    const withoutImage = watermarkHistoryReducer(added, { type: 'edit', time: 2, update: current => removeWatermarkLayer(current, 'image') });
    expect(withoutImage.current.watermark).toBeUndefined();
    expect(withoutImage.current.preset).toMatchObject({ watermarkPath: '', imageEnabled: false, textEnabled: true });
    const imageRestored = watermarkHistoryReducer(withoutImage, { type: 'undo' });
    expect(imageRestored.current).toEqual(added.current);
    expect(watermarkHistoryReducer(imageRestored, { type: 'redo' }).current).toEqual(withoutImage.current);

    const withoutText = watermarkHistoryReducer(imageRestored, { type: 'edit', time: 3, update: current => removeWatermarkLayer(current, 'text') });
    expect(withoutText.current.watermark).toBe(mark);
    expect(withoutText.current.preset.text).toBeUndefined();
    expect(withoutText.current.preset.textEnabled).toBe(false);
    expect(withoutText.future).toEqual([]);
    const textRestored = watermarkHistoryReducer(withoutText, { type: 'undo' });
    expect(textRestored.current.preset.text).toEqual(added.current.preset.text);
    expect(watermarkHistoryReducer(textRestored, { type: 'redo' }).current).toEqual(withoutText.current);
    expect(watermarkHistoryReducer(textRestored, { type: 'undo' }).current).toEqual(empty);
  });

  it('clears both the reference image and its persisted path and restores them together', () => {
    const before = initialWatermarkHistory(populated(empty));
    const removed = watermarkHistoryReducer(before, { type: 'edit', time: 1, update: current => selectWatermarkReference(current) });
    expect(removed.current.reference).toBeUndefined();
    expect(removed.current.referencePath).toBe('');
    expect(watermarkHistoryReducer(removed, { type: 'undo' }).current.reference).toBe(reference);
    expect(watermarkHistoryReducer(removed, { type: 'undo' }).current.referencePath).toBe(reference.originalPath);
  });

  it('groups a long gesture into one undo and preserves redo when the gesture is cancelled', () => {
    const before = initialWatermarkHistory(populated(empty));
    const gesture = watermarkHistoryReducer(before, { type: 'beginGesture' });
    const move = (x: number) => (current: WatermarkEdit): WatermarkEdit => ({
      ...current, preset: { ...current.preset, placement: { ...current.preset.placement, x } },
    });
    const dragging = watermarkHistoryReducer(gesture, { type: 'edit', time: 1, update: move(0.5) });
    const moved = watermarkHistoryReducer(dragging, { type: 'edit', time: 2000, update: move(0.25) });
    const committed = watermarkHistoryReducer(moved, { type: 'endGesture', cancelled: false });
    expect(committed.past).toHaveLength(1);
    const undone = watermarkHistoryReducer(committed, { type: 'undo' });
    expect(undone.current).toEqual(before.current);

    const second = watermarkHistoryReducer(undone, { type: 'beginGesture' });
    const draft = watermarkHistoryReducer(second, { type: 'edit', time: 3000, update: move(0.65) });
    const cancelled = watermarkHistoryReducer(draft, { type: 'endGesture', cancelled: true });
    expect(cancelled.current).toEqual(before.current);
    expect(watermarkHistoryReducer(cancelled, { type: 'redo' }).current).toEqual(committed.current);
  });
});
