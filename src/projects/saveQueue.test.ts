import { describe, expect, it } from 'vitest';
import { ProjectSaveQueue, type SaveTarget, type SaveSnapshot } from './saveQueue';
import type { LibraryDocument, SaveLibraryRequest } from './library';
import { createProject } from '../core/templates';

const snapshot = (name='A',id='project-A'):SaveSnapshot => ({project:{...createProject(),name,id},editorRevision:1,editorState:{version:1,activePageId:'page-A'}});
const target=(id='project-A'):SaveTarget=>({projectId:id,kind:'project',libraryId:null,revision:null,document:null});
const result=(request:SaveLibraryRequest,revision=1):LibraryDocument=>({entry:{id:request.libraryId??'storage-A',name:request.project.name,kind:request.kind,updatedAt:100,deletedAt:null,pageCount:request.project.pages.length,assetCount:0,revision},project:request.project,path:'/data/project.json',editorState:request.editorState??null,recovered:false});
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}

describe('project autosave serialization and immutable destinations',()=>{
  it('serializes writes and uses the first allocated storage ID and revision on the next snapshot',async()=>{
    const pending=deferred<LibraryDocument>(), calls:SaveLibraryRequest[]=[];
    const queue=new ProjectSaveQueue(async request=>{calls.push(request);return calls.length===1?pending.promise:result(request,2);});
    const destination=target(),first=queue.save(destination,snapshot('first')),second=queue.save(destination,snapshot('second'));
    await Promise.resolve();await Promise.resolve();expect(calls).toHaveLength(1);
    pending.resolve(result(calls[0],1));await first;await second;
    expect(calls[1]).toMatchObject({libraryId:'storage-A',expectedRevision:1,project:{name:'second'}});
    expect(destination).toMatchObject({libraryId:'storage-A',revision:2,document:{project:{name:'second'}}});await queue.flush();
  });
  it('captures the document at enqueue time even when the original object later changes',async()=>{
    const calls:SaveLibraryRequest[]=[],queue=new ProjectSaveQueue(async request=>{calls.push(request);return result(request);}),value=snapshot('original');
    const work=queue.save(target(),value);value.project.name='modified after enqueue';value.editorState.activePageId='other';await work;
    expect(calls[0].project.name).toBe('original');expect(calls[0].editorState?.activePageId).toBe('page-A');
  });
  it('never redirects a delayed save to a newly visible project or to a draft target',async()=>{
    const pending=deferred<LibraryDocument>(),calls:SaveLibraryRequest[]=[];
    const queue=new ProjectSaveQueue(async request=>{calls.push(request);return calls.length===1?pending.promise:result(request);});
    const a=target(),b={...target('project-B'),kind:'draft' as const};
    const first=queue.save(a,snapshot()),second=queue.save(b,snapshot('B','project-B'));
    await Promise.resolve();await Promise.resolve();pending.resolve(result(calls[0]));await first;await second;
    expect(calls.map(call=>[call.project.id,call.kind,call.libraryId])).toEqual([['project-A','project',null],['project-B','draft',null]]);
    expect(a.document?.project.id).toBe('project-A');expect(b.document?.project.id).toBe('project-B');
  });
  it('keeps previous successful metadata after a disk failure and permits an explicit retry',async()=>{
    let fail=true;const queue=new ProjectSaveQueue(async request=>{if(fail)throw new Error('disk full');return result(request,4);}),destination={...target(),libraryId:'existing',revision:3};
    await expect(queue.save(destination,snapshot())).rejects.toThrow('disk full');await expect(queue.flush()).rejects.toThrow('disk full');
    expect(destination).toMatchObject({libraryId:'existing',revision:3,document:null});fail=false;await queue.save(destination,snapshot('retry'));await queue.flush();expect(destination.revision).toBe(4);
  });
  it('rejects a mismatched project identity without sending any filesystem write',async()=>{
    let count=0;const queue=new ProjectSaveQueue(async request=>{count++;return result(request);});await expect(queue.save(target(),snapshot('B','project-B'))).rejects.toThrow('身份');expect(count).toBe(0);
  });
  it('does not accept a success response belonging to another project',async()=>{
    const destination=target(),queue=new ProjectSaveQueue(async request=>({...result(request),project:{...request.project,id:'wrong'}}));await expect(queue.save(destination,snapshot())).rejects.toThrow('目标不一致');expect(destination.document).toBeNull();expect(destination.libraryId).toBeNull();
  });
});
