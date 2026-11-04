const fs = require('node:fs/promises');
const path = require('node:path');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// 画面から来た data URL を PNG のバイトにする。PNG でなければ止める。
function pngBuffer(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 40 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error('PNG画像のデータが不正です。');
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('PNG形式ではありません。');
  return buffer;
}

// 保存の名前：フォルダーを指す文字と Windows の予約名を除き、.png で終わる名前だけを使う。
function safePngName(filename, fallback) {
  const basename = typeof filename === 'string' ? filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 120) : '';
  return basename.toLowerCase().endsWith('.png') && !/^\.+\.png$/i.test(basename) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\.png$/i.test(basename) ? basename : fallback;
}

async function saveGiftPanelPng(dialog, input) {
  const buffer = pngBuffer(input?.dataUrl);
  const filename = safePngName(input.filename, 'gift_panel.png');
  const result = await dialog.showSaveDialog({ title: 'ギフト案内画像を保存', buttonLabel: 'PNGを保存', defaultPath: filename, filters: [{ name: 'PNG画像', extensions: ['png'] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, buffer);
  return { canceled: false, path: result.filePath };
}

const MAX_PAGES = 50;

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

// 上書きしないときは「名前 (2).png」「名前 (3).png」…の空いている名前に書く（wx で、あとから現れた同じ名前も上書きしない）。
async function writePng(folder, name, buffer, overwrite) {
  if (overwrite) {
    const target = path.join(folder, name);
    await fs.writeFile(target, buffer);
    return target;
  }
  const stem = name.slice(0, -4);
  for (let n = 1; n < 1000; n++) {
    const target = path.join(folder, n === 1 ? name : `${stem} (${n}).png`);
    try { await fs.writeFile(target, buffer, { flag: 'wx' }); return target; }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  throw new Error('同じ名前の画像が多すぎて保存できません。');
}

// ギフト設定の「全ページを保存」（2026-11-05 ユーザーの決定）。保存先のフォルダーを1回だけ選び、ページごとの PNG をそこへ書く。
// 書く前に全部の PNG を確かめる（途中まで書いて止まらないように）。同じ名前の画像があれば1回だけ聞き、黙って上書きしない。
async function saveGiftPanelPngs(dialog, input) {
  const files = Array.isArray(input?.files) ? input.files : [];
  if (!files.length) throw new Error('保存するPNG画像がありません。');
  if (files.length > MAX_PAGES) throw new Error(`PNG画像が多すぎます（${MAX_PAGES}枚まで）。`);
  const pages = files.map((file, index) => ({ buffer: pngBuffer(file?.dataUrl), name: safePngName(file?.filename, `gift_list_${index + 1}.png`) }));
  const names = pages.map(page => page.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new Error('同じ名前のPNG画像が重なっています。');
  const picked = await dialog.showOpenDialog({ title: 'ギフト一覧の画像を保存するフォルダーを選ぶ', buttonLabel: 'このフォルダーに保存', properties: ['openDirectory', 'createDirectory'] });
  const folder = picked?.filePaths?.[0];
  if (picked?.canceled || !folder) return { canceled: true };
  const existing = [];
  for (const page of pages) if (await exists(path.join(folder, page.name))) existing.push(page.name);
  let overwrite = false;
  if (existing.length) {
    const answer = await dialog.showMessageBox({
      type: 'question', title: '同じ名前の画像があります', noLink: true, defaultId: 1, cancelId: 2,
      message: `選んだフォルダーに、同じ名前の画像が${existing.length}枚あります。`,
      detail: existing.slice(0, 10).join('\n') + (existing.length > 10 ? `\nほか${existing.length - 10}枚` : '') + '\n\n「別の名前で保存」は、名前の後ろに (2) などを付けます。',
      buttons: ['上書きする', '別の名前で保存', 'やめる'],
    });
    if (answer.response !== 0 && answer.response !== 1) return { canceled: true };
    overwrite = answer.response === 0;
  }
  const paths = [];
  for (const page of pages) paths.push(await writePng(folder, page.name, page.buffer, overwrite));
  return { canceled: false, folder, paths };
}

module.exports = { saveGiftPanelPng, saveGiftPanelPngs };
