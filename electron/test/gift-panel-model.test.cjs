
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');
const file = path.resolve(__dirname, '../../src/lib/giftPanel.ts');
const compiled = new Module(file, module);
compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node20' }).code, file);
const { syncPanelGift, createPanel, normalizePanel, applyPanelTemplate, readPanelLibrary, panelLayout, cardColors, panelFilename } = compiled.exports;
const card = (i = 0) => ({ id: 'card-' + i, giftId: '5655', giftName: 'バラ', image: 'https://example.com/rose.png', title: '回復', repeat: 1, category: 'お助け系', tone: 'help' });

test('OBS designs round trip independent documents without altering card text, order or colors', () => {
  const first = createPanel(); first.cards = [card(2), { ...card(1), title: '体力回復\nありがとう', color: '#B59AFA' }];
  const second = createPanel('light'); second.name = '配信ルール';
  const loaded = readPanelLibrary(JSON.stringify({ version: 1, activeId: second.id, designs: [first, second] }));
  assert.equal(loaded.activeId, second.id);
  assert.deepEqual(loaded.designs[0].cards, first.cards);
  assert.equal(loaded.designs[1].name, '配信ルール');
  assert.throws(() => readPanelLibrary('{broken'), SyntaxError);
  assert.throws(() => readPanelLibrary('{"version":2,"designs":[]}'), /形式/);
});
test('all 96 cards survive every template switch and fit within eight rows', () => {
  const original = createPanel(); original.cards = Array.from({length:96}, (_, i) => card(i));
  for (const template of ['compact','light','neon']) {
    const changed = applyPanelTemplate(original, template);
    assert.deepEqual(changed.cards, original.cards);
    assert.ok(changed.rows <= 8 && changed.columns <= 12);
    assert.equal(panelLayout(changed).overflow, 0);
  }
});
test('invalid stored settings cannot produce negative geometry or unbounded images', () => {
  const design = normalizePanel({ width: -3, height: 0, columns: 12, rows: 8, padding: 9999, gap: 9999, fontSize: Infinity,
    cards: [{ ...card(), image: 'javascript:alert(1)' }, { ...card() }] });
  const layout = panelLayout(design);
  assert.ok(layout.cardWidth > 0 && layout.cardHeight > 0);
  assert.equal(design.cards[0].image, null);
  assert.notEqual(design.cards[0].id, design.cards[1].id);
  assert.ok(design.width <= 3840 && design.height <= 2160);
  assert.ok(Number.isFinite(design.fontSize));
});
test('overflow is reported rather than silently dropping cards', () => {
  const design = createPanel(); design.cards = Array.from({length:13}, (_, i) => card(i));
  assert.equal(panelLayout(design).overflow, 1);
  const normalized = normalizePanel({...design, cards: Array.from({length:100}, (_, i) => card(i))});
  assert.equal(normalized.cards.length, 96);
});
test('category colors, per-card overrides, and readable automatic text colors', () => {
  const design = createPanel(); design.colorMode = 'category';
  assert.equal(cardColors(design, card()).accent, design.palette.help);
  assert.equal(cardColors(design, card()).text, '#FFFFFF');
  design.colorTarget = 'background';
  assert.equal(cardColors(design, card()).text, '#101522');
  assert.equal(cardColors(design, {...card(), color: '#000000'}).text, '#FFFFFF');
  assert.equal(cardColors(design, {...card(), textColor:'#123456'}).text, '#123456');
  assert.equal(cardColors(design, {...card(), color:'#123456'}).accent, '#123456');
});
test('PNG filename reports the full headline height and removes path characters', () => {
  const design = createPanel(); design.name = '案内:/画像'; design.headline = 'ダイヤ64個\n集めたら勝ち';
  assert.equal(panelLayout(design).height, 680);
  assert.equal(panelFilename(design), '案内__画像_1080x680.png');
});

test('explicit command sync updates all matching cards while retaining image-only styling', () => {
  const design = createPanel();
  design.cards = [{ ...card(1), color: '#FF0000', textColor: '#FFFFFF', title: 'custom' }, card(2), { ...card(3), giftId: 'other' }];
  const next = syncPanelGift(design, '5655', 'ゾンビ', 50, '敵対モブ');
  assert.deepEqual(next.cards[0], { ...design.cards[0], title: 'ゾンビ', repeat: 50, category: '敵対モブ' });
  assert.equal(next.cards[1].repeat, 50);
  assert.equal(next.cards[2], design.cards[2]);
  assert.equal(design.cards[0].title, 'custom');
  assert.equal(next.width, design.width);
  assert.equal(next.cards[0].tone, design.cards[0].tone);
});
