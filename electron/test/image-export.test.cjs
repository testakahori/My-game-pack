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
