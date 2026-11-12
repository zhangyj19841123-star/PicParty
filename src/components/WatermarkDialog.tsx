import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Download, FolderOpen, ImageIcon, ImagePlus, LoaderCircle, Pencil, Redo2, RefreshCw, Save, Stamp, Trash2, Type, Undo2, X, XCircle } from 'lucide-react';
import { Modal } from './Modal';
import { ImageWatermarkControls, TextWatermarkControls } from './WatermarkControls';
import { WatermarkPreviewPane } from './WatermarkPreviewPane';
import { useWatermarkPreview } from './useWatermarkPreview';
import { useAssetImage } from '../images/cache';
import { importPaths, native } from '../platform/desktop';
import { cancelWatermark, chooseWatermarkDirectory, getWatermarkProgress, importWatermarkPath, listWatermarkFonts, onWatermarkProgress, scanWatermarkDirectory, selectPNGWatermark, selectWatermarkReference, startWatermark, type WatermarkLayer, type WatermarkPreviewRequest, type WatermarkScan } from '../platform/watermark';
import type { ExportProgress, ImageAsset } from '../core/types';
import { defaultTextWatermark, hasWatermarkLayer, normalizeTextWatermark, normalizeWatermarkPreset, type WatermarkPresetSettings } from '../core/watermarkSettings';
import { useWatermarkPreferences, type WatermarkLastSettings } from '../state/watermarkPreferences';
import { canRemoveWatermarkLayer, initialWatermarkHistory, removeWatermarkLayer, selectWatermarkReference as updateReference, watermarkHistoryReducer, type WatermarkEdit } from './watermarkEditHistory';
import { acceptWatermarkProgress, isWatermarkJobActive } from './watermarkJobState';
import './WatermarkDialog.css';

interface WatermarkDialogProps {
  onClose(): void;
  onNotify(message: string): void;
  onBusyChange?(busy: boolean): void;
  projectPreset?: WatermarkPresetSettings;
  onProjectPresetChange?(value: WatermarkPresetSettings): void;
}

const BATCH_PAGE_SIZE = 48;
const emptyText = defaultTextWatermark();
const fileName = (path: string) => path.split(/[\\/]/).at(-1) || path;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function progressLabel(progress: ExportProgress) {
  if (progress.state === 'completed') return progress.errors.length ? '部分照片未处理成功' : '水印处理完成';
  if (progress.state === 'cancelled') return '已取消处理';
  if (progress.state === 'failed') return '处理未完成';
  if (progress.state === 'cancelling') return '正在取消，等待当前照片完成…';
  return '正在批量处理';
}

function BatchThumbnail({ asset, active, onClick }: { asset: ImageAsset; active: boolean; onClick(): void }) {
  const button = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const proxy = useAssetImage(visible ? asset : undefined, 256);
  useEffect(() => {
    if (!button.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: '70px' });
    observer.observe(button.current);
    return () => observer.disconnect();
  }, []);
  return <button className="wm-thumbnail" ref={button} aria-pressed={active} title={asset.fileName} onClick={onClick}>
    <span className="wm-thumbnail-image">{proxy.image ? <img src={proxy.image.src} alt="" draggable={false} /> : <ImageIcon size={15} strokeWidth={1.5} />}</span>
    <span className="wm-thumbnail-meta"><strong>{asset.fileName}</strong><small>{asset.width} × {asset.height}</small></span>
  </button>;
}

export function WatermarkDialog({ onClose, onNotify, onBusyChange, projectPreset, onProjectPresetChange }: WatermarkDialogProps) {
  const profiles = useWatermarkPreferences(state => state.profiles);
  const initial = useRef<WatermarkLastSettings>({
    ...useWatermarkPreferences.getState().last,
    ...(projectPreset ? normalizeWatermarkPreset(projectPreset) : {}),
  }).current;
  const initialPreset = useRef(normalizeWatermarkPreset(projectPreset ?? initial)).current;
  const [history, dispatch] = useReducer(watermarkHistoryReducer, {
    preset: initialPreset, referencePath: initial.referencePath, profileId: '',
  }, initialWatermarkHistory);
  const { preset, watermark, reference, referencePath, profileId } = history.current;
  const [layer, setLayer] = useState<WatermarkLayer>(() => initialPreset.textEnabled && !initialPreset.watermarkPath ? 'text' : 'image');
  const [inputDirectory, setInputDirectory] = useState(initial.inputDirectory);
  const [outputDirectory, setOutputDirectory] = useState(initial.outputDirectory);
  const [format, setFormat] = useState(initial.format);
  const [scan, setScan] = useState<WatermarkScan>();
  const [batchPage, setBatchPage] = useState(0);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [fonts, setFonts] = useState<string[]>([]);
  const [fontsLoading, setFontsLoading] = useState(native);
  const [fontError, setFontError] = useState<string>();
  const [profileName, setProfileName] = useState('');
  const [profilePanel, setProfilePanel] = useState<'save' | 'rename' | 'delete'>();
  const [starting, setStarting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [closeWarning, setCloseWarning] = useState(false);
  const jobRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const loadingRef = useRef(false);
  const closeAfterCancel = useRef(false);
  const mounted = useRef(true);
  const persistenceWarning = useRef(false);
  const projectChange = useRef(onProjectPresetChange);
  projectChange.current = onProjectPresetChange;
  const lastProjectPreset = useRef(JSON.stringify(initialPreset));
  const batchList = useRef<HTMLDivElement>(null);
  const active = isWatermarkJobActive(progress, starting);
  const locked = active || loading !== null;
  const photos = useMemo(() => scan?.assets.filter(asset => asset.originalPath !== preset.watermarkPath) ?? [], [scan, preset.watermarkPath]);
  const pageCount = Math.max(1, Math.ceil(photos.length / BATCH_PAGE_SIZE));
  const displayedPage = Math.min(batchPage, pageCount - 1);
  const visiblePhotos = photos.slice(displayedPage * BATCH_PAGE_SIZE, (displayedPage + 1) * BATCH_PAGE_SIZE);
  const text = preset.text ?? emptyText;
  const imageEnabled = preset.imageEnabled ?? !!preset.watermarkPath;
  const textEnabled = preset.textEnabled === true;
  const activeMark = imageEnabled ? watermark ?? null : null;
  const activePlacement = activeMark ? preset.placement : null;
  const activeText = textEnabled && text.text.trim() ? text : null;
  const request = useMemo<WatermarkPreviewRequest | null>(() => native && reference ? {
    photo: reference, watermark: activeMark, placement: activePlacement, text: activeText, maxSize: 1024,
  } : null, [reference, activeMark, activePlacement, activeText]);
  const preview = useWatermarkPreview(request);
  const currentProfile = profiles.find(profile => profile.id === profileId);
  const missingMark = imageEnabled && !!preset.watermarkPath && !watermark;
  const sameOutputDirectory = !!inputDirectory && inputDirectory.replace(/\/+$/, '') === outputDirectory.replace(/\/+$/, '');
  const canRun = native && !locked && !!photos.length && !!outputDirectory && !sameOutputDirectory && !missingMark && !!(activeMark || activeText) && preview.current;

  const edit = (update: (value: WatermarkEdit) => WatermarkEdit, group?: string) => {
    dispatch({ type: 'edit', update, group, time: Date.now() });
  };
  const updatePreset = (patch: Partial<WatermarkPresetSettings>, group?: string) => edit(current => {
    const next = { ...current.preset, ...patch };
    return JSON.stringify(current.preset) === JSON.stringify(next) ? current : { ...current, preset: next };
  }, group);
  const setReference = (asset?: ImageAsset) => edit(current => updateReference(current, asset));
  const removeLayer = () => {
    if (locked || loadingRef.current || startingRef.current || history.gesture) return;
    setError('');
    edit(current => removeWatermarkLayer(current, layer));
  };
  const runHistory = (command: 'undo' | 'redo') => {
    if (locked || loadingRef.current || startingRef.current || profilePanel || history.gesture) return;
    setError('');
    dispatch({ type: command });
  };
  const shortcutActions = useRef({ removeLayer, runHistory, canRemove: false });
  const canRemove = canRemoveWatermarkLayer(history.current, layer);
  shortcutActions.current = { removeLayer, runHistory, canRemove: canRemove && !profilePanel };
  const persistSettings = ({ requireLocal = false, saveToProject = false } = {}) => {
    const snapshot = normalizeWatermarkPreset(preset);
    try {
      useWatermarkPreferences.getState().remember({
        ...snapshot, imageEnabled: snapshot.imageEnabled, textEnabled: snapshot.textEnabled, text: snapshot.text,
        format, inputDirectory, outputDirectory, referencePath,
      });
    } catch (failure) {
      if (requireLocal) throw failure;
      if (!persistenceWarning.current) {
        persistenceWarning.current = true;
        onNotify(errorText(failure));
      }
    }
    const serialized = JSON.stringify(snapshot);
    if (saveToProject || serialized !== lastProjectPreset.current) {
      projectChange.current?.(snapshot);
      lastProjectPreset.current = serialized;
    }
  };
  const acceptProgress = (incoming: ExportProgress) => {
    const id = jobRef.current;
    if (mounted.current && id) setProgress(current => acceptWatermarkProgress(current, incoming, id));
  };

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const sourcePath = initialPreset.imageEnabled === false ? '' : initialPreset.watermarkPath;
    if (!native || (!sourcePath && !initial.referencePath)) return () => { mounted.current = false; };
    setLoading('恢复上次设置');
    loadingRef.current = true;
    const tasks = [
      sourcePath ? importWatermarkPath(sourcePath) : Promise.resolve(undefined),
      initial.referencePath ? importPaths([initial.referencePath]).then(result => {
        if (!result.assets.length) throw new Error(result.errors.join('\n') || '上次参考照片已不可用，请重新选择。');
        return result.assets[0];
      }) : Promise.resolve(undefined),
    ] as const;
    void Promise.allSettled(tasks).then(results => {
      if (cancelled) return;
      const [mark, photo] = results;
      dispatch({ type: 'sync', update: current => ({
        ...current,
        watermark: mark.status === 'fulfilled' ? mark.value : undefined,
        reference: photo.status === 'fulfilled' ? photo.value : undefined,
      }) });
      const failures = results.flatMap(result => result.status === 'rejected' ? [errorText(result.reason)] : []);
      if (failures.length) setError(failures.join('\n'));
      loadingRef.current = false;
      setLoading(null);
    });
    return () => { cancelled = true; mounted.current = false; };
  }, [initial, initialPreset]);

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    void listWatermarkFonts().then(items => {
      if (!disposed) setFonts([...new Set(items)].sort((a, b) => a.localeCompare(b, 'zh-CN')));
    }, failure => {
      if (!disposed) setFontError(`无法读取本机字体：${errorText(failure)}`);
    }).finally(() => { if (!disposed) setFontsLoading(false); });
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => persistSettings(), 180);
    return () => clearTimeout(timer);
  }, [preset, format, inputDirectory, outputDirectory, referencePath]);
  useEffect(() => { if (batchList.current) batchList.current.scrollTop = 0; }, [displayedPage, scan]);

  useEffect(() => {
    const editingField = 'input:not([type="checkbox"]):not([type="button"]):not([type="range"]):not([type="color"]),textarea,select,[contenteditable]:not([contenteditable="false"])';
    const keyboard = (event: KeyboardEvent) => {
      if (event.isComposing || (event.target instanceof Element && event.target.closest(editingField))) return;
      const actions = shortcutActions.current;
      const modified = event.metaKey || event.ctrlKey;
      if (modified && !event.altKey && event.key.toLowerCase() === 'z') {
        // On macOS the native Edit menu dispatches Command+Z.
        if (native && event.metaKey) return;
        event.preventDefault();
        event.stopPropagation();
        actions.runHistory(event.shiftKey ? 'redo' : 'undo');
      } else if (!modified && !event.altKey && (event.key === 'Backspace' || event.key === 'Delete') && actions.canRemove) {
        event.preventDefault();
        event.stopPropagation();
        actions.removeLayer();
      }
    };
    const menu = (event: Event) => {
      const command = (event as CustomEvent<unknown>).detail;
      if (command === 'undo' || command === 'redo') shortcutActions.current.runHistory(command);
    };
    document.addEventListener('keydown', keyboard, true);
    window.addEventListener('picparty-watermark-history', menu);
    return () => {
      document.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('picparty-watermark-history', menu);
    };
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined, disposed = false;
    void onWatermarkProgress(acceptProgress).then(unlisten => {
      if (disposed) unlisten();
      else cleanup = unlisten;
    }).catch(failure => { if (!disposed) setError(errorText(failure)); });
    return () => { disposed = true; cleanup?.(); };
  }, []);
  useEffect(() => {
    if (!jobId || !active) return;
    let disposed = false, pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const latest = await getWatermarkProgress(jobId);
        if (disposed) return;
        if (latest) acceptProgress(latest);
        else setProgress(current => current && isWatermarkJobActive(current) ? {
          ...current, state: 'failed', errors: [...current.errors, '后台任务已不存在，请检查输出文件夹后重新开始。'],
        } : current);
      } catch (failure) { if (!disposed) setError(`暂时无法读取进度：${errorText(failure)}`); }
      finally { pending = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 700);
    return () => { disposed = true; clearInterval(timer); };
  }, [jobId, active]);

  useEffect(() => { onBusyChange?.(active); }, [active, onBusyChange]);
  useEffect(() => {
    if (progress && !active && closeAfterCancel.current) {
      closeAfterCancel.current = false;
      onClose();
    }
  }, [progress, active, onClose]);

  const requestClose = () => {
    if (startingRef.current || isWatermarkJobActive(progress)) {
      setCloseWarning(true);
      return;
    }
    if (loadingRef.current) {
      setError('正在读取文件，请等待完成后关闭。');
      return;
    }
    if (profilePanel) {
      setProfilePanel(undefined);
      return;
    }
    persistSettings();
    onClose();
  };
  const load = async (label: string, task: () => Promise<void>) => {
    if (active || loadingRef.current || startingRef.current) return;
    loadingRef.current = true;
    setLoading(label);
    setError('');
    try { await task(); }
    catch (failure) { if (mounted.current) setError(errorText(failure)); }
    finally {
      loadingRef.current = false;
      if (mounted.current) setLoading(null);
    }
  };
  const chooseMark = () => load('读取透明 PNG', async () => {
    const asset = await selectPNGWatermark();
    if (!asset) return;
    edit(current => {
      const next = { ...current, watermark: asset, preset: { ...current.preset, watermarkPath: asset.originalPath, imageEnabled: true } };
      return current.referencePath === asset.originalPath
        ? updateReference(next, scan?.assets.find(photo => photo.originalPath !== asset.originalPath)) : next;
    });
  });
  const enableImage = (enabled: boolean) => {
    if (enabled && !watermark && preset.watermarkPath) {
      void load('读取 PNG 水印', async () => {
        const asset = await importWatermarkPath(preset.watermarkPath);
        edit(current => ({ ...current, watermark: asset, preset: { ...current.preset, imageEnabled: true } }));
      });
    } else {
      updatePreset({ imageEnabled: enabled });
    }
  };
  const chooseReference = () => load('读取参考照片', async () => {
    const asset = await selectWatermarkReference();
    if (asset) setReference(asset);
  });
  const readInput = async (directory: string) => {
    const result = await scanWatermarkDirectory(directory);
    if (!mounted.current) return;
    setScan(result);
    setInputDirectory(result.directory);
    const batch = result.assets.filter(asset => asset.originalPath !== preset.watermarkPath);
    const currentIndex = batch.findIndex(asset => asset.originalPath === reference?.originalPath);
    const selectedIndex = Math.max(0, currentIndex);
    setBatchPage(Math.floor(selectedIndex / BATCH_PAGE_SIZE));
    if (batch.length) setReference(batch[selectedIndex]);
  };
  const chooseInput = () => load('读取照片文件夹', async () => {
    const directory = await chooseWatermarkDirectory('input', inputDirectory || undefined);
    if (directory) await readInput(directory);
  });
  const chooseOutput = () => load('选择输出文件夹', async () => {
    const directory = await chooseWatermarkDirectory('output', outputDirectory || undefined);
    if (directory) setOutputDirectory(directory);
  });

  const applyProfile = (id: string) => load('载入水印预设', async () => {
    if (!id) {
      dispatch({ type: 'sync', update: current => ({ ...current, profileId: '' }) });
      setProfileName('');
      return;
    }
    const store = useWatermarkPreferences.getState();
    const profile = store.profiles.find(item => item.id === id);
    if (!profile) throw new Error('找不到这个水印预设。');
    const source = profile.watermarkPath && profile.imageEnabled !== false ? await importWatermarkPath(profile.watermarkPath).catch(failure => {
      setError(errorText(failure));
      return undefined;
    }) : undefined;
    edit(current => {
      const next = { ...current, watermark: source, preset: normalizeWatermarkPreset(profile), profileId: id };
      return profile.watermarkPath && current.referencePath === profile.watermarkPath
        ? updateReference(next, scan?.assets.find(photo => photo.originalPath !== profile.watermarkPath)) : next;
    });
    setLayer(!profile.watermarkPath || (profile.textEnabled && profile.imageEnabled === false) ? 'text' : 'image');
    setProfileName(profile.name);
    setProfilePanel(undefined);
  });
  const editProfile = () => {
    setError('');
    try {
      const store = useWatermarkPreferences.getState();
      if (profilePanel === 'save') {
        persistSettings({ requireLocal: true });
        const profile = store.saveProfile(profileName);
        dispatch({ type: 'sync', update: current => ({ ...current, profileId: profile.id }) });
        setProfileName(profile.name);
        onNotify(`已保存水印预设「${profile.name}」`);
      } else if (profilePanel === 'rename') {
        const profile = store.renameProfile(profileId, profileName);
        setProfileName(profile.name);
      } else if (profilePanel === 'delete') {
        store.deleteProfile(profileId);
        dispatch({ type: 'sync', update: current => ({ ...current, profileId: '' }) });
        setProfileName('');
      }
      setProfilePanel(undefined);
    } catch (failure) { setError(errorText(failure)); }
  };
  const showProfilePanel = (mode: 'save' | 'rename' | 'delete') => {
    setProfileName(currentProfile?.name ?? '');
    setProfilePanel(mode);
  };
  const run = async () => {
    if (!canRun || !scan || startingRef.current || loadingRef.current) return;
    setError('');
    persistSettings({ saveToProject: true });
    startingRef.current = true;
    onBusyChange?.(true);
    setStarting(true);
    setProgress(null);
    setJobId(null);
    jobRef.current = null;
    setCloseWarning(false);
    closeAfterCancel.current = false;
    try {
      const id = await startWatermark({
        assets: photos, watermark: activeMark, placement: activePlacement, text: activeText,
        inputDirectory: scan.directory, directory: outputDirectory, format, quality: 100,
      });
      jobRef.current = id;
      setJobId(id);
      setProgress({ jobId: id, completed: 0, total: photos.length, pageName: '', state: 'running', errors: [], paths: [] });
    } catch (failure) { setError(errorText(failure)); }
    finally {
      startingRef.current = false;
      setStarting(false);
    }
  };
  const cancel = async (thenClose = false) => {
    const id = jobRef.current;
    if (!id || progress?.state === 'cancelling') return;
    closeAfterCancel.current = thenClose;
    setProgress(current => current && isWatermarkJobActive(current) ? { ...current, state: 'cancelling' } : current);
    try {
      await cancelWatermark(id);
      const latest = await getWatermarkProgress(id);
      if (latest) acceptProgress(latest);
    } catch (failure) {
      closeAfterCancel.current = false;
      setError(errorText(failure));
      setProgress(current => current?.state === 'cancelling' ? { ...current, state: 'running' } : current);
    }
  };

  return <Modal title="批量水印" className="watermark-modal" onClose={requestClose}>
    <fieldset disabled={locked} className="wm-editor-grid">
      <aside className="wm-batch-sidebar" aria-label="待处理照片">
        <div className="wm-section-heading"><h3>照片</h3><span>{photos.length} 张</span></div>
        <div className="wm-folder-actions">
          <button className="quiet-button wm-directory" onClick={() => void chooseInput()} title={inputDirectory || '选择照片文件夹'}>
            <FolderOpen size={15} /><span>{inputDirectory ? fileName(inputDirectory) : '选择照片文件夹'}</span>
          </button>
          {inputDirectory && <button className="quiet-button wm-reload" aria-label="重新读取照片文件夹" title="重新读取照片文件夹" onClick={() => void load('读取照片文件夹', () => readInput(inputDirectory))}><RefreshCw size={14} /></button>}
        </div>
        <div className="wm-batch-list" ref={batchList}>
          {visiblePhotos.length ? visiblePhotos.map(asset => <BatchThumbnail key={asset.id} asset={asset} active={reference?.originalPath === asset.originalPath} onClick={() => setReference(asset)} />)
            : <p className="wm-empty-batch">{scan ? '没有可处理的照片' : inputDirectory ? '重新读取文件夹，开始本批处理。' : '从文件夹载入 JPG 或 PNG。'}</p>}
        </div>
        {pageCount > 1 && <div className="wm-batch-pagination">
          <button type="button" className="icon-button" disabled={displayedPage === 0} aria-label="上一组照片" onClick={() => setBatchPage(displayedPage - 1)}><ChevronLeft size={15} /></button>
          <span>{displayedPage + 1} / {pageCount}</span>
          <button type="button" className="icon-button" disabled={displayedPage + 1 === pageCount} aria-label="下一组照片" onClick={() => setBatchPage(displayedPage + 1)}><ChevronRight size={15} /></button>
        </div>}
        {(!!scan?.skipped || !!scan?.errors.length) && <details className="wm-scan-errors">
          <summary>读取详情</summary>
          {!!scan.skipped && <p>跳过 {scan.skipped} 个不支持的文件。</p>}
          {scan.errors.map((message, index) => <p key={index}>{message}</p>)}
        </details>}
      </aside>

      <section className="wm-preview-section" aria-label="照片预览">
        <div className="wm-preview-toolbar">
          <div><strong title={reference?.fileName}>{reference?.fileName ?? '预览'}</strong>{reference && <span>{reference.width} × {reference.height} px</span>}</div>
          <div className="wm-reference-actions">
            <button className="quiet-button" onClick={() => void chooseReference()}><ImagePlus size={14} />参考照片</button>
            {referencePath && <button type="button" className="icon-button wm-clear-reference" aria-label="清除参考照片" title="清除参考照片" onClick={() => { setError(''); setReference(); }}><X size={15} /></button>}
          </div>
        </div>
        <WatermarkPreviewPane photo={reference} watermark={watermark} imagePlacement={preset.placement} text={text} layer={layer}
          preview={preview.preview} loading={preview.loading} current={preview.current} locked={locked}
          onGestureStart={() => dispatch({ type: 'beginGesture' })} onGestureEnd={cancelled => dispatch({ type: 'endGesture', cancelled })}
          onImageChange={placement => updatePreset({ placement })} onTextChange={value => updatePreset({ text: value })} />
        <div className="wm-preview-caption">
          {preview.preview?.layers[layer] ? '拖动水印定位，拖四角调整大小。' : '选择图片或文字水印，在此查看效果。'}
          {(activeMark || activeText) && <span>{activeMark && activeText ? '图片 + 文字' : activeMark ? '图片水印' : '文字水印'}</span>}
        </div>
      </section>

      <aside className="wm-settings" aria-label="水印参数">
        <div className="wm-layer-switch" role="group" aria-label="选择水印图层">
          <button type="button" aria-pressed={layer === 'image'} onClick={() => setLayer('image')}><ImageIcon size={15} />图片水印{activeMark && <i />}</button>
          <button type="button" aria-pressed={layer === 'text'} onClick={() => setLayer('text')}><Type size={15} />文字水印{activeText && <i />}</button>
        </div>
        <div className="wm-layer-actions" role="group" aria-label="水印编辑操作">
          <button type="button" className="quiet-button wm-remove-layer" disabled={!canRemove || !!history.gesture} onClick={event => {
            event.currentTarget.focus({ preventScroll: true });
            removeLayer();
          }}><Trash2 size={14} />{layer === 'image' ? '删除图片水印' : '删除文字水印'}</button>
          <div className="wm-history-actions">
            <button type="button" className="icon-button" aria-label="撤销水印编辑" title="撤销 ⌘Z" disabled={!history.past.length || !!history.gesture} onClick={() => runHistory('undo')}><Undo2 size={16} /></button>
            <button type="button" className="icon-button" aria-label="重做水印编辑" title="重做 ⇧⌘Z" disabled={!history.future.length || !!history.gesture} onClick={() => runHistory('redo')}><Redo2 size={16} /></button>
          </div>
        </div>
        <div className="wm-layer-fields" key={layer}>
          {layer === 'image' ? <ImageWatermarkControls watermark={watermark} sourcePath={preset.watermarkPath} placement={preset.placement} photo={reference} rect={preview.preview?.layers.image}
            enabled={imageEnabled} onEnabled={enableImage} onChoose={() => void chooseMark()} onChange={placement => {
              updatePreset({ placement }, placement.opacity !== preset.placement.opacity ? 'image-opacity' : undefined);
            }} />
            : <TextWatermarkControls settings={text} fonts={fonts} fontsLoading={fontsLoading} fontError={fontError} photo={reference} rect={preview.preview?.layers.text}
              enabled={textEnabled} onEnabled={value => updatePreset({ textEnabled: value })}
              onChange={value => {
                const group = value.text !== text.text ? 'text-content' : value.placement.opacity !== text.placement.opacity ? 'text-opacity' : undefined;
                updatePreset({ text: normalizeTextWatermark(value), ...(value.text && !text.text ? { textEnabled: true } : {}) }, group);
              }} />}
        </div>
      </aside>
    </fieldset>

    {(loading || error || preview.error || sameOutputDirectory || missingMark || !native) && <div className="wm-notices">
      {loading && <p className="wm-loading" role="status"><LoaderCircle size={13} className="spin" />{loading}…</p>}
      {error && <p className="wm-error" role="alert">{error}</p>}
      {preview.error && <p className="wm-error" role="alert">{preview.error}</p>}
      {missingMark && !loading && <p className="wm-error">图片水印暂不可用，请重新选择文件或删除图片水印。</p>}
      {sameOutputDirectory && <p className="wm-error" role="alert">请选择与输入不同的输出文件夹。</p>}
      {!native && <p className="wm-loading">批量水印需要 macOS 桌面应用。</p>}
    </div>}
    {progress && <section className={`wm-progress ${progress.state}`} aria-label="水印处理进度" aria-live="polite">
      <div>{active ? <LoaderCircle size={15} className="spin" /> : progress.state === 'completed' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
        <strong>{progressLabel(progress)}</strong><span>{progress.completed} / {progress.total}</span></div>
      <progress max={progress.total || 1} value={progress.completed} />
      <p>{active && progress.pageName ? progress.pageName : `已输出 ${progress.paths.length} 张照片`}</p>
      {progress.errors.length > 0 && <details open={!active}><summary>{progress.errors.length} 条处理详情</summary>{progress.errors.map((message, index) => <p key={index}>{message}</p>)}</details>}
    </section>}
    {closeWarning && active && <div className="wm-close-warning" role="alert">
      <span>请等待处理完成，或取消任务后关闭。</span>
      <button className="quiet-button" disabled={starting || progress?.state === 'cancelling'} onClick={() => void cancel(true)}>取消任务并关闭</button>
    </div>}
    <footer className="wm-footer">
      <div className="wm-preset-bar">
        <select disabled={locked} aria-label="水印预设" value={currentProfile?.id ?? ''} onChange={event => void applyProfile(event.target.value)}>
          <option value="">水印预设</option>
          {profiles.map(profile => <option value={profile.id} key={profile.id}>{profile.name}</option>)}
        </select>
        <button className="quiet-button" disabled={locked || !hasWatermarkLayer(preset)} onClick={() => showProfilePanel('save')}><Save size={14} />保存预设</button>
        {currentProfile && <>
          <button className="icon-button" disabled={locked} aria-label="重命名预设" title="重命名预设" onClick={() => showProfilePanel('rename')}><Pencil size={14} /></button>
          <button className="icon-button" disabled={locked} aria-label="删除预设" title="删除预设" onClick={() => showProfilePanel('delete')}><Trash2 size={14} /></button>
        </>}
        {profilePanel && <div className="wm-preset-popover">
          {profilePanel === 'delete' ? <p>删除预设「{currentProfile?.name}」？</p> :
            <label className="wm-field"><span>{profilePanel === 'rename' ? '重命名预设' : '预设名称'}</span>
              <input autoFocus value={profileName} maxLength={80} onChange={event => setProfileName(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); editProfile(); } }} />
            </label>}
          <div><button className="quiet-button" onClick={() => setProfilePanel(undefined)}>取消</button>
            <button className="primary-button" disabled={profilePanel !== 'delete' && !profileName.trim()} onClick={editProfile}>{profilePanel === 'delete' ? '确认删除' : '保存'}</button></div>
        </div>}
      </div>
      <div className="wm-output-bar">
        <button className="quiet-button wm-output-folder" title={outputDirectory || '选择输出文件夹'} disabled={locked} onClick={() => void chooseOutput()}>
          <FolderOpen size={14} /><span>{outputDirectory ? fileName(outputDirectory) : '输出文件夹'}</span>
        </button>
        <select aria-label="水印输出格式" disabled={locked} value={format} onChange={event => setFormat(event.target.value as 'jpg' | 'png')}>
          <option value="jpg">JPG · 100%</option><option value="png">PNG · 无损</option>
        </select>
        {active ? <button className="quiet-button" disabled={starting || progress?.state === 'cancelling'} onClick={() => void cancel()}>取消处理</button>
          : <button className="primary-button" disabled={!canRun || !!profilePanel} onClick={() => void run()}>{photos.length ? <Download size={15} /> : <Stamp size={15} />}
            {photos.length ? `处理 ${photos.length} 张` : '批量应用'}
          </button>}
      </div>
    </footer>
  </Modal>;
}
