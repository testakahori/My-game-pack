const fs = require('node:fs/promises');

async function saveGiftPanelPng(dialog, input) {
  const dataUrl = input?.dataUrl;
  if (typeof dataUrl !== 'string' || dataUrl.length > 40 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error('PNG画像のデータが不正です。');
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('PNG形式ではありません。');
  const basename = typeof input.filename === 'string' ? input.filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 120) : '';
  const filename = basename.toLowerCase().endsWith('.png') && !/^\.+\.png$/i.test(basename) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\.png$/i.test(basename) ? basename : 'gift_panel.png';
  const result = await dialog.showSaveDialog({ title: 'ギフト案内画像を保存', buttonLabel: 'PNGを保存', defaultPath: filename, filters: [{ name: 'PNG画像', extensions: ['png'] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, buffer);
  return { canceled: false, path: result.filePath };
}
module.exports = { saveGiftPanelPng };
