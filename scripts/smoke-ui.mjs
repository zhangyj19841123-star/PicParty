import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1480, height: 960 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.removeItem('frame-studio-recovery-v1'));
await mkdir('artifacts/ui', { recursive: true });
const state = () => page.evaluate(async () => {
  const { useEditorStore } = await import('/src/state/editorStore.ts');
  const s = useEditorStore.getState();
  return { project: s.project, mode: s.workspaceMode, visible: s.visiblePageIds, active: s.activePageId,
    selected: s.selectedPageIds, editing: s.editingFrame, frameEditing: s.frameEditing, undo: s.undoCount };
});
const canvasTargets = () => page.locator('.canvas-workspace').evaluate(async element => {
  const { useEditorStore } = await import('/src/state/editorStore.ts');
  const { workspaceLayout } = await import('/src/editor/workspaceLayout.ts');
  const { geometry } = await import('/src/core/engine.ts');
  const s = useEditorStore.getState();
  const { left, top, width, height } = element.getBoundingClientRect();
  const { document, pages, templates } = s.project;
  const { views } = workspaceLayout({ document, viewport: { width, height },
    count: s.visiblePageIds.length, mode: s.workspaceMode, zoom: s.viewZoom });
  return views.map((view, index) => {
    const item = pages.find(candidate => candidate.id === s.visiblePageIds[index]);
    const { frames, handles } = geometry().layout(item, document, templates[item.templateId]);
    const point = (x, y) => ({ x: left + view.x + x * view.scale, y: top + view.y + y * view.scale });
    return {
      photo: point(frames[0].rect.x + frames[0].rect.width / 2, frames[0].rect.y + frames[0].rect.height / 2),
      split: handles.map(({ rect, axis }) => ({
        ...point(rect.x + (axis === 'y' ? rect.width / 2 : 0), rect.y + (axis === 'x' ? rect.height / 2 : 0)), axis,
      }))[0],
    };
  });
});
async function settle() { await page.waitForTimeout(250); }
async function drag(from, to, steps = 15) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:1420');
  let pickerOpened = false;
  page.on('filechooser', () => { pickerOpened = true; });
  await page.getByRole('button', { name: '新建拼图', exact: true }).click({ timeout: 30000 });
  await page.getByText('页内模板', { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(pickerOpened, false, 'new collage enters an empty canvas without a photo picker');
  assert.equal(Object.keys((await state()).project.assets).length, 0, 'new collage has no photos');
  await page.screenshot({ path: 'artifacts/ui/01-empty.png' });
  const fixtures = await page.evaluate(() => {
    const palettes = [['#b1c9c4','#24483f'],['#e8b992','#844f44'],['#b2c5d5','#364f69'],['#ddd0a9','#6f704c'],['#dac2c8','#76555e'],['#9eccc7','#347979'],['#e9c3a6','#b46437'],['#cec5ab','#615d49']];
    return Array.from({ length: 20 }, (_, i) => {
      const [light, dark] = palettes[i % palettes.length];
      const canvas = document.createElement('canvas'); canvas.width=900; canvas.height=1350; const ctx=canvas.getContext('2d');
      const gradient=ctx.createLinearGradient(0,0,900,1350); gradient.addColorStop(0,light); gradient.addColorStop(1,dark);ctx.fillStyle=gradient;ctx.fillRect(0,0,900,1350);
      ctx.fillStyle='#ffffff44';ctx.beginPath();ctx.arc(630,350,145,0,Math.PI*2);ctx.fill();ctx.fillStyle=dark;ctx.beginPath();ctx.moveTo(0,950);ctx.lineTo(300,650);ctx.lineTo(560,1000);ctx.lineTo(760,700);ctx.lineTo(900,920);ctx.lineTo(900,1350);ctx.lineTo(0,1350);ctx.fill();ctx.fillStyle='#ffffffdd';ctx.font='100px sans-serif';ctx.fillText(String(i+1).padStart(2,'0'),70,1220);return canvas.toDataURL('image/png').split(',')[1];
    });
  });
  const files = fixtures.map((data,i) => ({ name: `Scene-${i+1}.png`, mimeType: 'image/png', buffer: Buffer.from(data,'base64') }));
  for (let i=0;i<files.length;i++) await writeFile(`artifacts/ui/Scene-${i+1}.png`,files[i].buffer);
  const importPagePhotos = async i => {
    await page.locator('input[type=file][multiple]').setInputFiles(files.slice(i * 2, i * 2 + 2));
    await page.waitForFunction(async n => {
      const { useEditorStore } = await import('/src/state/editorStore.ts');
      return Object.keys(useEditorStore.getState().project.assets).length === n;
    }, (i + 1) * 2);
  };
  await importPagePhotos(0);
  const addPage = page.locator('.editor-toolbar').getByRole('button', { name: '新增页面', exact: true });
  for (let i = 1; i < 4; i++) {
    await addPage.click();
    await importPagePhotos(i);
  }
  await page.getByRole('button',{name:'四页',exact:true}).click(); await settle();
  let s=await state(); assert.equal(s.visible.length,4); assert.equal(s.project.pages.length,4);
  assert.equal(s.project.pages.flatMap(item => item.frames).filter(frame => frame.imageAssetId).length, 8, 'all photos placed');
  const [from, to] = await canvasTargets();
  const firstAsset = (snapshot, index) => snapshot.project.pages.find(item => item.id === snapshot.visible[index]).frames[0].imageAssetId;
  const a = firstAsset(s, 0), b = firstAsset(s, 1), undoBeforeSwap = s.undo;
  await drag(from.photo, to.photo);
  s = await state();
  assert.equal(firstAsset(s, 0), b, 'source swapped');
  assert.equal(firstAsset(s, 1), a, 'destination swapped');
  assert.equal(s.undo, undoBeforeSwap + 1, 'swap is one operation');
  await page.getByRole('button', { name: '撤销 ⌘Z', exact: true }).click();
  s = await state();
  assert.equal(firstAsset(s, 0), a, 'undo restores source');
  assert.equal(firstAsset(s, 1), b, 'undo restores destination');
  await page.screenshot({path:'artifacts/ui/02-four-pages.png'});
  await page.keyboard.press('g');await settle();s=await state();assert.equal(s.mode,'overview');
  const overview = page.locator('.overview');
  await overview.getByRole('checkbox', { name: '勾选第 1 页用于导出' }).check();
  await overview.getByRole('checkbox', { name: '勾选第 3 页用于导出' }).check();
  s = await state();
  assert.deepEqual(s.selected, [s.project.pages[0].id, s.project.pages[2].id]);
  await page.screenshot({path:'artifacts/ui/03-overview.png'});
  await page.getByRole('button',{name:'同屏编辑',exact:false}).click();s=await state();assert.equal(s.mode,2);assert.equal(s.visible.length,2);assert.deepEqual(s.visible,[s.project.pages[0].id,s.project.pages[2].id]);
  await page.keyboard.press('g');
  await page.keyboard.press('Space');
  const quickPreview = page.getByRole('dialog', { name: /^第 \d+ 页$/ });
  await quickPreview.waitFor();
  await page.keyboard.press('Space');
  await quickPreview.waitFor({ state: 'hidden' });
  await page.keyboard.press('g');await page.getByRole('button',{name:'单页',exact:true}).click();await settle();
  const [{ split }] = await canvasTargets();
  assert.equal(split.axis, 'y', 'default template has a horizontal divider');
  s = await state();
  const rows = snapshot => snapshot.project.pages.find(item => item.id === snapshot.active).templateState.rows;
  const beforeRows = rows(s);
  await drag(split, { x: split.x, y: split.y + 45 });
  assert.notDeepEqual(rows(await state()), beforeRows, 'split line moves');
  const [{ photo }] = await canvasTargets();
  await page.mouse.click(photo.x, photo.y);
  s = await state();
  assert.ok(s.editing && !s.frameEditing, 'photo click enters photo editing');
  await page.mouse.wheel(0, -120);
  await settle();
  s = await state();
  assert.ok(s.project.pages.find(item => item.id === s.editing.pageId).frames.find(frame => frame.id === s.editing.frameId).transform.zoom > 1, 'wheel scales the selected photo');
  await page.screenshot({path:'artifacts/ui/04-crop.png'});
  await page.keyboard.press('Escape');
  await page.mouse.dblclick(photo.x, photo.y);
  assert.equal((await state()).frameEditing, true, 'double-click edits the frame');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: '导出作品' });
  await exportDialog.getByRole('button', { name: '导出 2 页', exact: true }).click();
  await exportDialog.getByText('原图导出需要在 macOS 桌面应用中进行。', { exact: false }).waitFor();
  await exportDialog.getByRole('button', { name: '取消', exact: true }).click();

  for (let i = 4; i < 10; i++) {
    await addPage.click();
    await importPagePhotos(i);
  }
  await page.getByRole('combobox', { name: '更多同屏页数' }).selectOption('10');
  await settle();
  s = await state();
  assert.equal(s.mode, 10, 'more menu selects ten-page mode');
  assert.equal(s.project.pages.length, 10, 'project contains ten pages');
  assert.equal(s.visible.length, 10, 'all ten pages are visible');
  assert.deepEqual(new Set(s.visible), new Set(s.project.pages.map(item => item.id)), 'each page appears exactly once');
  assert.equal(await page.locator('.canvas-workspace .page-label:visible').count(), 10, 'all ten pages are rendered in the workspace');
  assert.ok(s.project.pages.every(item => item.frames.length === 2 && item.frames.every(frame => frame.imageAssetId)), 'all twenty photos are placed');
  await page.screenshot({ path: 'artifacts/ui/05-ten-pages.png' });

  assert.deepEqual(errors,[],'no runtime errors');
  const checks = ['emptyCanvas', 'import8', 'fourPageViews', 'crossPageSwap', 'atomicUndo', 'overviewSelection',
    'specifiedTwoPages', 'spacePreview', 'splitDrag', 'photoZoom', 'doubleClickFrameEditing', 'browserExportBoundary', 'tenPageViewsWith20Photos'];
  await writeFile('artifacts/ui/result.json', JSON.stringify({ passed: true, checks, errors }, null, 2));
  console.log(`UI smoke passed: ${checks.length} interaction checks. Screenshots: artifacts/ui`);
} finally { await browser.close(); }
