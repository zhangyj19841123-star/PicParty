import { describe, expect, it } from 'vitest';
import { createEditorStore } from '../state/editorStore';
import { defaultTextWatermark } from '../core/watermarkSettings';
import { captureWorkspace, restoredWorkspace } from './workspaceState';

describe('versioned project workspace recovery',()=>{
  it('does not bring the previous acceptance watermark back with a saved project', () => {
    const state = createEditorStore().getState();
    const watermark = {
      watermarkPath: '/repo/artifacts/picparty/验收/透明水印.png',
      placement: { x: .2, y: .4, widthRatio: .36, opacity: .5 },
      imageEnabled: true, textEnabled: true,
      text: { ...defaultTextWatermark(), text: 'PicParty 验收\n摄影作品' },
    };
    const exportSettings = { scope: 'selected', format: 'png', quality: 95 };
    const restore = (text: string) => restoredWorkspace(state, {
      version: 1, outputSettings: { export: exportSettings, watermark: { ...watermark, text: { ...watermark.text, text } } },
    }).outputSettings;
    expect(restore(watermark.text.text)).toMatchObject({ export: exportSettings, watermark: { watermarkPath: '', imageEnabled: false, textEnabled: false } });
    expect(restore('用户自己的签名')?.watermark?.text?.text).toBe('用户自己的签名');
  });
  it('restores output preferences with their project and resets them on a new workspace', () => {
    const store = createEditorStore();
    store.getState().updateOutputSettings({
      export: { scope: 'selected', format: 'png', quality: 95 },
      watermark: { watermarkPath: '/Volumes/Photo/mark.png', placement: { x: .9, y: .8, widthRatio: .2, opacity: .65, rotation: -25 } },
    });
    const before = store.getState();
    const snapshot = captureWorkspace(before);
    const restored = restoredWorkspace(before, snapshot);
    expect(restored.outputSettings).toEqual(before.outputSettings);
    expect(before.undoCount).toBe(0);
    store.getState().newProject();
    expect(store.getState().outputSettings).toEqual({});
  });
  it('restores checked pages, visible subset, overview and zoom without serializing active pointer transactions or undo',()=>{
    const store=createEditorStore(),first=store.getState().activePageId;store.getState().addPage();const second=store.getState().activePageId;store.getState().setWorkspaceMode(2);store.getState().setSelectedPageIds([second]);store.getState().setViewZoom(.5);store.getState().setWorkspaceMode('overview');
    const snapshot=captureWorkspace(store.getState());expect(snapshot).not.toHaveProperty('transaction');expect(snapshot).not.toHaveProperty('history');expect(snapshot).not.toHaveProperty('runtimeAssets');
    const restored=restoredWorkspace(store.getState(),snapshot);expect(restored).toMatchObject({workspaceMode:'overview',previousMode:2,viewZoom:.5,selectedPageIds:[second],photoTransform:null});expect(restored.visiblePageIds).toEqual([second,first]);
  });
  it('filters deleted page and frame references instead of reviving stale editor state',()=>{
    const state=createEditorStore().getState(),first=state.project.pages[0];const restored=restoredWorkspace(state,{version:1,activePageId:'gone',visiblePageIds:['gone',first.id],selectedPageIds:['gone'],workspaceMode:4,previousMode:4,selectedFrame:{pageId:first.id,frameId:'gone'},editingFrame:{pageId:'gone',frameId:'gone'},frameEditing:true,backgroundEditing:true,viewZoom:Infinity});
    expect(restored).toMatchObject({activePageId:first.id,visiblePageIds:[first.id],selectedPageIds:[],selectedFrame:null,editingFrame:null,frameEditing:false,backgroundEditing:false,viewZoom:'fit'});
  });
  it('keeps zero export checks and rejects unknown snapshot versions and untrusted workspace capacity',()=>{
    const state=createEditorStore().getState();expect(restoredWorkspace(state,{version:99})).toEqual({});const restored=restoredWorkspace(state,{version:1,selectedPageIds:[],workspaceMode:10000,previousMode:-1,viewZoom:.00001});expect(restored).toMatchObject({selectedPageIds:[],workspaceMode:1,previousMode:1,viewZoom:'fit'});
  });
  it('restores a valid yellow-frame edit without also restoring photo or background mode',()=>{
    const state=createEditorStore().getState(),page=state.project.pages[0],ref={pageId:page.id,frameId:page.frames[0].id};const restored=restoredWorkspace(state,{version:1,activePageId:page.id,visiblePageIds:[page.id],selectedFrame:ref,editingFrame:ref,frameEditing:true,backgroundEditing:true,workspaceMode:1,previousMode:1,viewZoom:'fit'});expect(restored).toMatchObject({selectedFrame:ref,editingFrame:null,frameEditing:true,backgroundEditing:false,photoTransform:null});
  });
});
