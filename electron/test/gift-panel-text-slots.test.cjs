// 配信画像の文字（文字の形・色・縁取り・大きさ）と、枠の中のカードの位置（2026-11-05 ユーザーの決定）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');

function loadLib(relative) {
  const file = path.resolve(__dirname, '../../src/lib', relative);
  const { outputFiles } = buildSync({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent' });
  const compiled = new Module(file, module);
  compiled._compile(outputFiles[0].text, file);
  return compiled.exports;
}
const { createPanel, normalizePanel, applyPanelTemplate, panelLayout, cardColors, cardFontSize, textOutline } = loadLib('giftPanel.ts');
const { dropCard, placeCards, fitPanel, slotAtPoint, slotRect, emptySlots, MAX_SLOTS } = loadLib('panelSlots.ts');
const { PANEL_FONTS, DEFAULT_PANEL_FONT, panelFontStack, isFontInstalled, installedPanelFonts } = loadLib('panelFonts.ts');
const { drawGiftPanel } = loadLib('giftPanelCanvas.ts');

const card = (i, extra = {}) => ({ id: 'card-' + i, giftId: String(5000 + i), giftName: 'ギフト' + i, image: null, title: '効果' + i, repeat: 1, category: '', tone: 'other', ...extra });
const slots = design => design.cards.map(c => c.id + '@' + c.slot);
const panel = (cards, extra = {}) => normalizePanel({ ...createPanel(), cards, ...extra });

test('枠の番号: 前の版の保存データは並び順どおりの枠に入り、重なり・範囲外は空いている最初の枠へ', () => {
  assert.deepEqual(slots(panel([card(0), card(1), card(2)])), ['card-0@0', 'card-1@1', 'card-2@2']);
  const mixed = panel([card(0, { slot: 4 }), card(1, { slot: 4 }), card(2, { slot: 999 }), card(3, { slot: -1 }), card(4, { slot: 1.5 }), card(5, { slot: 0 })]);
  assert.deepEqual(slots(mixed), ['card-5@0', 'card-1@1', 'card-2@2', 'card-3@3', 'card-0@4', 'card-4@5'], '先に書かれた番号を残し、残りは空き枠へ。枠の順に並ぶ');
  assert.equal(new Set(mixed.cards.map(c => c.slot)).size, mixed.cards.length);
  const full = panel(Array.from({ length: 100 }, (_, i) => card(i, { slot: 3 })));
  assert.equal(full.cards.length, 96);
  assert.ok(full.cards.every(c => c.slot >= 0 && c.slot < MAX_SLOTS));
});

test('ドラッグ: カードのある枠なら入れ替え、空いた枠なら移して元の枠を空ける', () => {
  const design = panel([card(0), card(1), card(2)]);
  const swapped = dropCard(design, 'card-0', 2);
  assert.deepEqual(slots(swapped), ['card-2@0', 'card-1@1', 'card-0@2']);
  const moved = dropCard(design, 'card-1', 7);
  assert.deepEqual(slots(moved), ['card-0@0', 'card-2@2', 'card-1@7']);
  assert.deepEqual(emptySlots(moved.cards, 2), [1, 3], '移したカードの元の枠は空く');
  assert.equal(dropCard(design, 'card-1', 1), design, '同じ枠なら何もしない');
  assert.equal(dropCard(design, 'card-1', MAX_SLOTS), design);
  assert.equal(dropCard(design, 'nope', 3), design);
  // 履歴（元に戻す）と自動保存は normalizePanel を通る。通しても位置は変わらない。
  assert.deepEqual(slots(normalizePanel(moved)), slots(moved));
});

test('追加・外す: 追加は空いている最初の枠から。外したカードの枠は詰めない', () => {
  const design = dropCard(panel([card(0), card(1), card(2)]), 'card-1', 5);
  const removed = normalizePanel({ ...design, cards: design.cards.filter(c => c.id !== 'card-0') });
  assert.deepEqual(slots(removed), ['card-2@2', 'card-1@5']);
  const added = placeCards(removed, [card(10), card(11), card(12), card(13)]);
  assert.deepEqual(slots(added), ['card-10@0', 'card-11@1', 'card-2@2', 'card-12@3', 'card-13@4', 'card-1@5']);
  assert.equal(added.columns, 6); assert.equal(added.rows, 2, '枠が足りていれば列・段は変えない');
  // 枠がいっぱいなら、いままでと同じように段を増やす。
  const fullDesign = panel(Array.from({ length: 12 }, (_, i) => card(i)));
  const grown = placeCards(fullDesign, [card(20)]);
  assert.equal(grown.rows, 3); assert.equal(grown.height, 630);
  assert.equal(grown.cards.find(c => c.id === 'card-20').slot, 12);
  assert.equal(panelLayout(grown).overflow, 0);
  // 96 枚まで。
  const many = panel(Array.from({ length: 95 }, (_, i) => card(i)));
  assert.equal(placeCards(many, [card(200), card(201)]).cards.length, 96);
  assert.equal(placeCards(panel(Array.from({ length: 96 }, (_, i) => card(i))), [card(300)]).cards.length, 96);
});

test('列・段を減らすと番号は保ったまま入らない分を数え、「すべて収まるように調整」で詰めて収める', () => {
  const design = dropCard(panel([card(0), card(1), card(2)]), 'card-2', 11);
  const smaller = normalizePanel({ ...design, rows: 1 });
  assert.deepEqual(slots(smaller), slots(design), '番号は変えない');
  assert.equal(panelLayout(smaller).overflow, 1, '7番目より後ろの枠のカードは入らない（保存を止める）');
  const fitted = fitPanel(smaller);
  assert.deepEqual(slots(fitted), ['card-0@0', 'card-1@1', 'card-2@2']);
  assert.equal(fitted.rows, 1);
  assert.equal(panelLayout(fitted).overflow, 0);
  const crowded = fitPanel(normalizePanel({ ...createPanel(), columns: 2, rows: 1, cards: Array.from({ length: 13 }, (_, i) => card(i)) }));
  assert.equal(panelLayout(crowded).overflow, 0);
  // テンプレートを替えても、いちばん後ろのカードまで入る。
  const switched = applyPanelTemplate(dropCard(panel([card(0)]), 'card-0', 20), 'light');
  assert.equal(panelLayout(switched).overflow, 0);
});

test('プレビューの点から枠: 各枠の中心は自分の枠、見出し・画像の外は null、外側の余白は近い枠', () => {
  const design = { ...createPanel(), headline: '見出し', columns: 4, rows: 3 };
  const layout = panelLayout(design);
  for (let slot = 0; slot < 12; slot++) {
    const r = slotRect(layout, 4, slot);
    assert.equal(slotAtPoint(layout, 4, 3, r.x + r.width / 2, r.y + r.height / 2), slot);
  }
  assert.equal(slotAtPoint(layout, 4, 3, 50, layout.headingHeight / 2), null);
  assert.equal(slotAtPoint(layout, 4, 3, -1, layout.height / 2), null);
  assert.equal(slotAtPoint(layout, 4, 3, layout.width + 1, layout.height / 2), null);
  assert.equal(slotAtPoint(layout, 4, 3, 1, layout.headingHeight + 1), 0);
  assert.equal(slotAtPoint(layout, 4, 3, layout.width - 1, layout.height - 1), 11);
});

test('文字の既定: 前の版の保存データは、いままでの文字の形・自動の文字色・自動の縁取りのまま', () => {
  const old = normalizePanel({ ...createPanel(), font: undefined, outline: undefined, outlineColor: undefined, outlineWidth: undefined, cards: [card(0)] });
  assert.equal(old.font, DEFAULT_PANEL_FONT);
  assert.equal(old.outline, 'auto');
  assert.equal(old.outlineWidth, 8);
  assert.equal('textColor' in old, false);
  assert.equal(panelFontStack(old.font), '"Yu Gothic", "Meiryo", sans-serif', '前の FONT と同じ並び');
  assert.equal(cardFontSize(old, old.cards[0]), old.fontSize);
  // 自動：白い効果名と見出しだけ #08090D。ギフト名・暗い文字は縁取らない。
  assert.deepEqual(textOutline(old, 'label', '#FFFFFF'), { color: '#08090D', width: 8 });
  assert.equal(textOutline(old, 'label', '#101522'), null);
  assert.equal(textOutline(old, 'label', '#ffffff'), null, '前と同じく #FFFFFF だけ');
  assert.equal(textOutline(old, 'name', '#FFFFFF'), null);
  assert.deepEqual(textOutline(old, 'headline', '#FFEB3B'), { color: '#08090D', width: 8 });
});

test('文字の設定: 縁取りなし・色を指定・カードだけの色、文字色、カードの文字サイズ、壊れた値', () => {
  const base = panel([card(0)]);
  const none = { ...base, outline: 'none' };
  assert.equal(textOutline(none, 'label', '#FFFFFF'), null);
  assert.equal(textOutline(none, 'headline', '#FFEB3B'), null);
  const colored = { ...base, outline: 'color', outlineColor: '#FF3B5C', outlineWidth: 20 };
  assert.deepEqual(textOutline(colored, 'name', '#101522'), { color: '#FF3B5C', width: 20 });
  assert.deepEqual(textOutline(none, 'label', '#101522', { ...base.cards[0], outlineColor: '#00FF00' }), { color: '#00FF00', width: 8 }, 'カードの指定が先');
  const textColored = { ...base, textColor: '#FFEB3B' };
  assert.equal(cardColors(textColored, base.cards[0]).text, '#FFEB3B');
  assert.equal(cardColors(textColored, { ...base.cards[0], textColor: '#123456' }).text, '#123456', 'カードの文字色が先');
  assert.equal(cardFontSize(base, { ...base.cards[0], fontScale: 150 }), base.fontSize * 1.5);
  const broken = normalizePanel({ ...createPanel(), font: 'Comic Sans', textColor: 'red', outline: 'glow', outlineColor: 'x', outlineWidth: 999,
    cards: [card(0, { fontScale: 5000, outlineColor: '#zzzzzz' }), card(1, { fontScale: 100 }), card(2, { fontScale: 'x' })] });
  assert.equal(broken.font, DEFAULT_PANEL_FONT);
  assert.equal(broken.textColor, '#FFFFFF');
  assert.equal(broken.outline, 'auto');
  assert.equal(broken.outlineColor, '#FFFFFF');
  assert.equal(broken.outlineWidth, 40);
  assert.equal(broken.cards[0].fontScale, 300);
  assert.equal(broken.cards[0].outlineColor, '#FFFFFF');
  assert.equal('fontScale' in broken.cards[1], false, '100% は「自動」と同じなので残さない');
  assert.equal('fontScale' in broken.cards[2], false);
  const kept = normalizePanel({ ...createPanel(), font: 'hg-soei-pop', textColor: '#FFEB3B', outline: 'color', outlineColor: '#000000', outlineWidth: 16 });
  assert.deepEqual([kept.font, kept.textColor, kept.outline, kept.outlineColor, kept.outlineWidth], ['hg-soei-pop', '#FFEB3B', 'color', '#000000', 16]);
  assert.equal(applyPanelTemplate(kept, 'light').font, 'hg-soei-pop', 'テンプレートを替えても文字の形は保つ');
  assert.equal(applyPanelTemplate(kept, 'light').outline, 'auto');
});

test('文字の形: 幅を比べてこの PC にあるものだけを出し、どの形でも游ゴシック・メイリオで補う', () => {
  // 入っている文字の形は、その名前の幅で測れる。無ければ総称の幅になる（Chromium と同じ）。
  const widths = { monospace: 500, 'sans-serif': 610, serif: 640, HGPSoeiKakupoptai: 700, 'MS PGothic': 500, 'Yu Mincho': 655 };
  const measure = font => {
    const families = font.replace(/^900 72px /, '').split(', ').map(f => f.replace(/"/g, ''));
    return widths[families.find(f => f in widths)];
  };
  assert.equal(isFontInstalled(['HGPSoeiKakupoptai', 'HGSoeiKakupoptai'], measure), true);
  assert.equal(isFontInstalled(['HGSoeiKakupoptai'], measure), false);
  assert.equal(isFontInstalled(['MS PGothic'], measure), true, '等幅と同じ幅でも、ほかの総称と違えば入っている');
  const ids = installedPanelFonts(measure).map(f => f.id);
  assert.deepEqual(ids, [DEFAULT_PANEL_FONT, 'hg-soei-pop', 'ms-gothic', 'yu-mincho'], '標準は必ず出す');
  for (const font of PANEL_FONTS) assert.match(panelFontStack(font.id), /"Yu Gothic"(, "Meiryo")?, sans-serif$|"Meiryo", sans-serif$/);
  assert.equal(panelFontStack('meiryo'), '"Meiryo", "Yu Gothic", sans-serif');
  assert.equal(panelFontStack('hg-soei-pop'), '"HGPSoeiKakupoptai", "HGSoeiKakupoptai", "Yu Gothic", "Meiryo", sans-serif');
  assert.equal(new Set(PANEL_FONTS.map(f => f.id)).size, PANEL_FONTS.length);
});

// 描いた文字を記録する偽の canvas。
function recordDraw(design) {
  const calls = [];
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '', lineJoin: '',
    measureText(text) { return { width: [...text].length * Number(/ (\d+(?:\.\d+)?)px /.exec(' ' + this.font + ' ')?.[1] || 10) * .9 }; },
    fillText(text, x, y) { calls.push(['fill', text, this.font, this.fillStyle, Math.round(x), Math.round(y)]); },
    strokeText(text, x, y) { calls.push(['stroke', text, this.font, this.strokeStyle, this.lineWidth, Math.round(x), Math.round(y)]); },
  };
  for (const name of ['clearRect', 'beginPath', 'roundRect', 'rect', 'fill', 'stroke', 'clip', 'save', 'restore', 'drawImage']) ctx[name] = () => {};
  drawGiftPanel({ width: 0, height: 0, getContext: () => ctx }, design, new Map());
  return calls;
}

test('PNG の文字: 既定はいままでどおり（游ゴシック・白い効果名と見出しだけ #08090D の縁）、選べば形・色・縁が変わる', () => {
  // 明るい地（回復）は暗い文字、暗い地（ゾンビ）は白い文字になる。
  const design = panel([card(0, { title: '回復', tone: 'help' }), card(1, { title: 'ゾンビ', tone: 'other' })], { headline: 'ダイヤ', colorTarget: 'background', colorMode: 'category' });
  design.palette.other = '#202020';
  const calls = recordDraw(design);
  assert.ok(calls.every(c => c[2].endsWith('px "Yu Gothic", "Meiryo", sans-serif') && c[2].startsWith('900 ')));
  const strokes = calls.filter(c => c[0] === 'stroke');
  assert.deepEqual(strokes.map(c => [c[1], c[3]]), [['ダイヤ', '#08090D'], ['ゾンビ', '#08090D']], '見出しと白い効果名だけ縁取る');
  for (const s of strokes) assert.equal(s[4], Math.max(2, Number(/900 (\S+)px/.exec(s[2])[1]) * .08));
  assert.ok(!strokes.some(c => c[1] === 'ギフト0' || c[1] === 'ギフト1'), 'ギフト名は縁取らない');
  // 文字の形・文字色・縁取りを選ぶ。
  const styled = { ...design, font: 'hg-soei-pop', textColor: '#FFEB3B', outline: 'color', outlineColor: '#FFFFFF', outlineWidth: 24 };
  const styledCalls = recordDraw(styled);
  // 1つの太さしか無い形は 400 で描く（にせの太字で字がつぶれないように）。
  assert.ok(styledCalls.every(c => c[2].startsWith('400 ') && c[2].endsWith('px "HGPSoeiKakupoptai", "HGSoeiKakupoptai", "Yu Gothic", "Meiryo", sans-serif')));
  assert.ok(styledCalls.filter(c => c[0] === 'fill' && c[1] !== 'ダイヤ').every(c => c[3] === '#FFEB3B'));
  assert.ok(styledCalls.filter(c => c[0] === 'stroke').length === styledCalls.filter(c => c[0] === 'fill').length, 'すべての文字を縁取る');
  assert.ok(styledCalls.filter(c => c[0] === 'stroke').every(c => c[3] === '#FFFFFF'));
  // 空いた枠には描かず、カードは自分の枠に描く。
  const moved = dropCard(design, 'card-0', 5);
  const label = recordDraw(moved).find(c => c[0] === 'fill' && c[1] === '回復');
  const r = slotRect(panelLayout(moved), moved.columns, 5);
  assert.equal(label[4], Math.round(r.x + r.width / 2));
});
