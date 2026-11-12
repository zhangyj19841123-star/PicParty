import { useEffect, useRef, useState } from 'react';
import { renderWatermarkPreview, type WatermarkPreview, type WatermarkPreviewRequest } from '../platform/watermark';

interface PreviewFrame { request: WatermarkPreviewRequest; preview: WatermarkPreview }
interface PreviewFailure { request: WatermarkPreviewRequest; message: string }

export function useWatermarkPreview(request: WatermarkPreviewRequest | null) {
  const enqueue = useRef<(next: WatermarkPreviewRequest | null) => void>(() => {});
  const [frame, setFrame] = useState<PreviewFrame>();
  const [failure, setFailure] = useState<PreviewFailure>();

  useEffect(() => {
    let active = true, inFlight = false;
    let latest: WatermarkPreviewRequest | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule() {
      if (!active || inFlight || timer || !latest) return;
      timer = setTimeout(() => {
        timer = undefined;
        const current = latest;
        if (!active || !current) return;
        inFlight = true;
        void renderWatermarkPreview(current).then(preview => {
          if (active && latest?.photo === current.photo) setFrame({ request: current, preview });
        }, error => {
          if (active && latest === current) setFailure({ request: current, message: String(error instanceof Error ? error.message : error) });
        }).finally(() => {
          inFlight = false;
          if (latest !== current) schedule();
        });
      }, 75);
    }
    enqueue.current = next => { latest = next; schedule(); };
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      enqueue.current = () => {};
    };
  }, []);
  useEffect(() => { enqueue.current(request); }, [request]);

  const error = request && failure?.request === request ? failure.message : undefined;
  // Never display a cached frame with a removed layer or with a replaced PNG.
  const compatibleFrame = request && frame && frame.request.photo === request.photo
    && frame.request.watermark === request.watermark && !!frame.request.text === !!request.text;
  return {
    preview: compatibleFrame ? frame.preview : undefined,
    current: request !== null && frame?.request === request,
    loading: request !== null && frame?.request !== request && !error,
    error,
  };
}
