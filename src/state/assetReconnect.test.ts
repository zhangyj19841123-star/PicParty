import { describe, expect, it } from 'vitest';
import { createEditorStore } from './editorStore';
import { createProject } from '../core/templates';
import { defaultAdjustments } from '../core/photoAdjustments';
import { validateAsset } from './validateProject';
import type { ImageAsset } from '../core/types';
const asset: ImageAsset = { id:'photo', originalPath:'/old/photo.png',fileName:'photo.png',width:120,height:180,rawWidth:120,rawHeight:180,orientation:1,format:'png',fingerprint:'hash',icc:null };
describe('automatic source reconnection', () => {
  it('reconnects across history and active transform cancellation without changing crop, color, layout or undo count', () => {
    const store=createEditorStore(createProject({canvasSizing:'fixed'}));const s=()=>store.getState();s().assignAssets([asset]);
    const ref={pageId:s().project.pages[0].id,frameId:s().project.pages[0].frames[0].id};s().updateTransform(ref,{zoom:1.6,rotation:17,focusX:.3,adjustments:{...defaultAdjustments(),exposure:.7}});
    const before=structuredClone(s().project.pages), count=s().undoCount;
    s().setSelectedFrame(ref);s().beginPhotoTransform();s().updateTransform(ref,{rotation:40});
    const next={...asset,originalPath:'/new/photo.png',sourceRoot:'/new',relativePath:'photo.png',initialPath:asset.originalPath,fileSize:900};
    s().refreshAssets([next],{photo:asset.originalPath});s().cancelPhotoTransform();
    expect(s().project.pages).toEqual(before);expect(s().project.assets.photo).toEqual(next);expect(s().undoCount).toBe(count);
    s().undo();expect(s().project.assets.photo.originalPath).toBe('/new/photo.png');expect(s().project.pages[0].frames[0].transform.rotation).toBe(0);
    s().redo();expect(s().project.pages).toEqual(before);expect(s().project.assets.photo.originalPath).toBe('/new/photo.png');
  });
  it('ignores a result whose source path was manually changed meanwhile', () => {
    const store=createEditorStore(createProject({}));store.getState().assignAssets([asset]);const manual={...asset,originalPath:'/manual/photo.png'};store.getState().updateAsset(manual);
    store.getState().refreshAssets([{...asset,originalPath:'/automatic/photo.png'}],{photo:asset.originalPath});expect(store.getState().project.assets.photo).toEqual(manual);
  });
  it('loads old metadata and rejects malformed new location metadata', () => {
    expect(()=>validateAsset(asset)).not.toThrow();expect(()=>validateAsset({...asset,fileSize:-1})).toThrow();expect(()=>validateAsset({...asset,previousRoots:Array(17).fill('/x')})).toThrow();expect(()=>validateAsset({...asset,sourceRoot:'a\0b'})).toThrow();
  });
});
