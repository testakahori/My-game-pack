const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { saveGiftPanelPng } = require('../image_export.cjs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
test('PNG保存: 短いタイトル・画像名を提示し、保存とキャンセルを区別', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'png-save-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'panel.png');let options;
  const saved=await saveGiftPanelPng({showSaveDialog:async o=>{options=o;return{filePath:file,canceled:false};}},{dataUrl:png,filename:'gift_panel_6x2_1080x480.png'});
  assert.equal(options.title,'ギフト案内画像を保存');assert.equal(options.defaultPath,'gift_panel_6x2_1080x480.png');assert.equal(saved.canceled,false);
  assert.deepEqual(fs.readFileSync(file),Buffer.from(png.split(',')[1],'base64'));
  assert.equal((await saveGiftPanelPng({showSaveDialog:async()=>({canceled:true})},{dataUrl:png})).canceled,true);
  await assert.rejects(saveGiftPanelPng({}, {dataUrl:'data:image/png;base64,YmFk'}),/PNG形式/);
});

test('PNG保存: 日本語のデザイン名を維持しパス指定と予約名を除去', async () => {
  const filenames = [];
  const dialog = {showSaveDialog:async options => {filenames.push(options.defaultPath); return {canceled:true};}};
  for (const filename of ['ギフト案内_1080x680.png', '../画像.png', 'CON.png', 'unsafe.exe']) {
    await saveGiftPanelPng(dialog, {dataUrl:png, filename});
  }
  assert.deepEqual(filenames, ['ギフト案内_1080x680.png', '.._画像.png', 'gift_panel.png', 'gift_panel.png']);
});

// ギフト設定の「全ページを保存」（2026-11-05 ユーザーの決定）。フォルダーを1回だけ選び、ページごとの PNG をそこへ書く。黙って上書きしない。
const { saveGiftPanelPngs } = require('../image_export.cjs');
const pngFiles = names => names.map(filename => ({ dataUrl: png, filename }));
function folderDialog(dir, answer, asked = []) {
  return {
    showOpenDialog: async options => { asked.push(['folder', options]); return { canceled: false, filePaths: [dir] }; },
    showMessageBox: async options => { asked.push(['message', options]); return { response: answer }; },
  };
}

test('全ページを保存: フォルダーを1回選び、ページごとの名前で書く', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'png-pages-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const asked = [];
  const result = await saveGiftPanelPngs(folderDialog(dir, 1, asked), { files: pngFiles(['採掘 ギフト一覧_1.png', '採掘 ギフト一覧_2.png']) });
  assert.deepEqual(result, { canceled: false, folder: dir, paths: [path.join(dir, '採掘 ギフト一覧_1.png'), path.join(dir, '採掘 ギフト一覧_2.png')] });
  assert.equal(asked.length, 1, '同じ名前が無ければ聞かない');
  assert.deepEqual(asked[0][1].properties, ['openDirectory', 'createDirectory']);
  assert.deepEqual(fs.readFileSync(path.join(dir, '採掘 ギフト一覧_2.png')), Buffer.from(png.split(',')[1], 'base64'));
  assert.deepEqual(await saveGiftPanelPngs({ showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, { files: pngFiles(['a.png']) }), { canceled: true });
});

test('全ページを保存: 同じ名前の画像があれば1回だけ聞く（上書き・別の名前・やめる）', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'png-pages-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const old = path.join(dir, 'list_1.png');
  const reset = () => { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir); fs.writeFileSync(old, 'old'); };
  const files = pngFiles(['list_1.png', 'list_2.png']);

  reset();
  let asked = [];
  assert.deepEqual(await saveGiftPanelPngs(folderDialog(dir, 2, asked), { files }), { canceled: true });
  assert.equal(asked.filter(([kind]) => kind === 'message').length, 1);
  assert.match(asked[1][1].message, /同じ名前の画像が1枚/);
  assert.deepEqual(asked[1][1].buttons, ['上書きする', '別の名前で保存', 'やめる']);
  assert.deepEqual(fs.readdirSync(dir), ['list_1.png'], 'やめたら何も書かない');
  assert.equal(fs.readFileSync(old, 'utf8'), 'old');

  reset();
  const renamed = await saveGiftPanelPngs(folderDialog(dir, 1), { files });
  assert.deepEqual(renamed.paths, [path.join(dir, 'list_1 (2).png'), path.join(dir, 'list_2.png')]);
  assert.equal(fs.readFileSync(old, 'utf8'), 'old', '別の名前を選んだら前の画像は残す');

  reset();
  const overwritten = await saveGiftPanelPngs(folderDialog(dir, 0), { files });
  assert.deepEqual(overwritten.paths, [old, path.join(dir, 'list_2.png')]);
  assert.deepEqual(fs.readFileSync(old), Buffer.from(png.split(',')[1], 'base64'), '上書きを選んだら書き換える');
});

test('全ページを保存: 書く前に全部を確かめる。PNG でない・名前の重なり・多すぎは止め、名前は整える', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'png-pages-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let opened = 0;
  const dialog = { showOpenDialog: async () => { opened++; return { canceled: false, filePaths: [dir] }; }, showMessageBox: async () => ({ response: 1 }) };
  await assert.rejects(saveGiftPanelPngs(dialog, { files: [{ dataUrl: png, filename: 'a.png' }, { dataUrl: 'data:image/png;base64,YmFk', filename: 'b.png' }] }), /PNG形式/);
  await assert.rejects(saveGiftPanelPngs(dialog, { files: [{ dataUrl: 'data:image/jpeg;base64,AAAA', filename: 'a.png' }] }), /PNG画像のデータが不正です。/);
  await assert.rejects(saveGiftPanelPngs(dialog, { files: pngFiles(['A.png', 'a.png']) }), /重なっています/);
  await assert.rejects(saveGiftPanelPngs(dialog, { files: pngFiles(Array.from({ length: 51 }, (_, i) => i + '.png')) }), /50枚まで/);
  await assert.rejects(saveGiftPanelPngs(dialog, { files: [] }), /保存するPNG画像がありません。/);
  assert.equal(opened, 0, 'だめなときはフォルダーを選ばせない');
  const result = await saveGiftPanelPngs(dialog, { files: pngFiles(['../画像.png', 'CON.png', 'unsafe.exe']) });
  assert.deepEqual(result.paths.map(file => path.basename(file)), ['.._画像.png', 'gift_list_2.png', 'gift_list_3.png']);
  assert.ok(result.paths.every(file => path.dirname(file) === dir), '選んだフォルダーの外に書かない');
});
