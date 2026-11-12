import type { ImageAsset } from '../core/types';
import { defaultWatermarkPlacement } from '../core/watermarkPlacement';
import type { WatermarkPresetSettings } from '../core/watermarkSettings';
import type { WatermarkLayer } from '../platform/watermark';

export interface WatermarkEdit {
  preset: WatermarkPresetSettings;
  watermark?: ImageAsset;
  reference?: ImageAsset;
  referencePath: string;
  profileId: string;
}

interface WatermarkEditHistory {
  past: WatermarkEdit[];
  current: WatermarkEdit;
  future: WatermarkEdit[];
  lastEdit?: { group: string; time: number };
  gesture?: WatermarkEdit;
}

type Edit = (value: WatermarkEdit) => WatermarkEdit;
type HistoryAction =
  | { type: 'edit'; update: Edit; group?: string; time: number }
  | { type: 'sync'; update: Edit }
  | { type: 'undo' | 'redo' | 'beginGesture' }
  | { type: 'endGesture'; cancelled: boolean };

const MAX_HISTORY = 60;
const MERGE_INTERVAL_MS = 550;
const pushPast = (past: WatermarkEdit[], value: WatermarkEdit) => [...past, value].slice(-MAX_HISTORY);

export function initialWatermarkHistory(current: WatermarkEdit): WatermarkEditHistory {
  return { past: [], current, future: [] };
}

export function watermarkHistoryReducer(state: WatermarkEditHistory, action: HistoryAction): WatermarkEditHistory {
  switch (action.type) {
    case 'sync':
      return { ...state, current: action.update(state.current), lastEdit: undefined };
    case 'edit': {
      const current = action.update(state.current);
      if (current === state.current) return state;
      if (state.gesture) return { ...state, current };
      const merge = action.group && state.lastEdit?.group === action.group && action.time - state.lastEdit.time < MERGE_INTERVAL_MS;
      return {
        current, past: merge ? state.past : pushPast(state.past, state.current), future: [],
        lastEdit: action.group ? { group: action.group, time: action.time } : undefined,
      };
    }
    case 'beginGesture':
      return state.gesture ? state : { ...state, gesture: state.current, lastEdit: undefined };
    case 'endGesture': {
      const gesture = state.gesture;
      if (!gesture) return state;
      if (action.cancelled) return { ...state, current: gesture, gesture: undefined };
      if (gesture === state.current) return { ...state, gesture: undefined };
      return { current: state.current, past: pushPast(state.past, gesture), future: [] };
    }
    case 'undo': {
      const current = state.past.at(-1);
      if (!current || state.gesture) return state;
      return { current, past: state.past.slice(0, -1), future: [...state.future, state.current] };
    }
    case 'redo': {
      const current = state.future.at(-1);
      if (!current || state.gesture) return state;
      return { current, past: pushPast(state.past, state.current), future: state.future.slice(0, -1) };
    }
  }
}

export function selectWatermarkReference(current: WatermarkEdit, reference?: ImageAsset): WatermarkEdit {
  const referencePath = reference?.originalPath ?? '';
  if (reference === current.reference && referencePath === current.referencePath) return current;
  return { ...current, reference, referencePath };
}

export function canRemoveWatermarkLayer({ preset }: WatermarkEdit, layer: WatermarkLayer): boolean {
  return layer === 'image' ? !!preset.watermarkPath || preset.imageEnabled === true : !!preset.text || preset.textEnabled === true;
}

export function removeWatermarkLayer(current: WatermarkEdit, layer: WatermarkLayer): WatermarkEdit {
  if (!canRemoveWatermarkLayer(current, layer)) return current;
  return layer === 'image'
    ? { ...current, watermark: undefined, profileId: '', preset: { ...current.preset, imageEnabled: false, watermarkPath: '', placement: defaultWatermarkPlacement() } }
    : { ...current, profileId: '', preset: { ...current.preset, textEnabled: false, text: undefined } };
}
