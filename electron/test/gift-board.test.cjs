// ギフト設定の右の列「登録済みギフト」の一覧と PNG（2026-11-05 ユーザーの決定。src/lib/giftBoard.ts・giftBoardCanvas.ts・giftImageCache.ts・RegisteredGiftBoard.tsx）。
// 6列 × 9段で1ページ、入りきらない分は次のページ。マスへ落とすと入れ替え、空いたマスへ落とすと最後へ。PNG は 1080 × 1920（9:16）で四方の余白が同じ。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { build, buildSync } = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

// src/lib の読み込みごと1ファイルにまとめて読む（gift-mapping-rows.test.cjs の loadLib と同じ）。
function loadLib(relative) {
  const file = path.resolve(root, 'src/lib', relative);
  const { outputFiles } = buildSync({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent' });
  const compiled = new Module(file, module);
  compiled._compile(outputFiles[0].text, file);
  return compiled.exports;
}
const board = loadLib('giftBoard.ts');
const { createGiftImageCache, toImageDataUrl } = loadLib('giftImageCache.ts');
const row = (n, extra = {}) => ({ id: 'id' + n, giftId: String(n), name: 'ギフト' + n, commandFile: 'zombie.txt', repeat: 1, ...extra });

test('ページ: 6列 × 9段 = 54 マス。入りきらない分は次のページ', () => {
  assert.equal(board.BOARD_COLUMNS, 6);
  assert.equal(board.BOARD_ROWS, 9);
  assert.equal(board.BOARD_CELLS, 54);
  assert.deepEqual([0, 1, 54, 55, 108, 109].map(board.boardPageCount), [1, 1, 1, 2, 2, 3]);
  assert.deepEqual([board.boardPageOf(0), board.boardPageOf(53), board.boardPageOf(54), board.boardPageOf(108)], [1, 1, 2, 3]);
  const list = Array.from({ length: 60 }, (_, i) => i);
  assert.deepEqual(board.boardPageItems(list, 1), list.slice(0, 54));
  assert.deepEqual(board.boardPageItems(list, 2), [54, 55, 56, 57, 58, 59]);
  // 消して減ったときは近いページへ（3ページ目を見ていて2ページに減ったら2ページ目）。
  assert.deepEqual([board.clampBoardPage(3, 60), board.clampBoardPage(0, 60), board.clampBoardPage(NaN, 60), board.clampBoardPage(2, 0)], [2, 1, 1, 1]);
});

test('並べ替え: ギフトのあるマスへ落とすと入れ替え、空いたマスへ落とすと最後へ。変わらないときは同じ配列', () => {
  const list = Array.from({ length: 60 }, (_, i) => row(i));
  const ids = value => value.map(item => item.id);
  const swapped = board.dropOnBoard(list, 'id1', 'id4');
  assert.deepEqual(ids(swapped).slice(0, 6), ['id0', 'id4', 'id2', 'id3', 'id1', 'id5']);
  assert.equal(swapped.length, 60);
  // ページをまたいでも入れ替え（1ページ目の 3 と 2ページ目の 58）。
  const across = board.dropOnBoard(list, 'id3', 'id58');
  assert.equal(across[3].id, 'id58');
  assert.equal(across[58].id, 'id3');
  const moved = board.dropOnBoard(list, 'id2', null);
  assert.deepEqual(ids(moved).slice(0, 3), ['id0', 'id1', 'id3']);
  assert.equal(moved[59].id, 'id2');
  for (const [from, to] of [['id5', 'id5'], ['missing', 'id1'], ['id1', 'missing'], ['id59', null]]) {
    assert.equal(board.dropOnBoard(list, from, to), list, `${from} → ${to} は変えない`);
  }
  assert.deepEqual(ids(list).slice(0, 3), ['id0', 'id1', 'id2'], '渡した配列は書き換えない');
});

test('PNG の形: 1080 × 1920（9:16）、四方の余白は同じ。見出しの帯の下に 6 × 9 のマス', () => {
  const layout = board.boardLayout();
  assert.equal(layout.width / layout.height, 9 / 16);
  const right = layout.width - (layout.gridLeft + layout.gridWidth);
  const bottom = layout.height - (layout.gridTop + layout.gridHeight);
  assert.deepEqual([layout.gridLeft, right, bottom, layout.gridTop - layout.header], [layout.margin, layout.margin, layout.margin, layout.margin]);
  const cells = Array.from({ length: board.BOARD_CELLS }, (_, i) => board.boardCellRect(i, layout));
  assert.deepEqual(cells[0], { x: layout.gridLeft, y: layout.gridTop, width: layout.cellWidth, height: layout.cellHeight });
  const last = cells[53];
  assert.ok(Math.abs(last.x + last.width - (layout.gridLeft + layout.gridWidth)) < 1e-9 && Math.abs(last.y + last.height - (layout.gridTop + layout.gridHeight)) < 1e-9, '最後のマスはマスの欄の右下');
  assert.equal(cells[6].y, layout.gridTop + layout.cellHeight, '7番目は2段目');
  // マスの中の画像・名前・回数は、マスの中に重ならずに収まる。
  const t = board.BOARD_CELL_TEXT;
  assert.ok(t.imageTop + t.imageSize <= t.titleTop && t.titleTop + t.titleHeight <= t.repeatTop && t.repeatTop + t.repeatHeight <= layout.cellHeight);
  assert.ok(t.imageSize <= layout.cellWidth - t.inset);
});

test('見出しと PNG の名前: 選んだゲームの名前で変わる。使えない文字は _', () => {
  assert.equal(board.boardTitle('埋め立て'), '埋め立て ギフト一覧');
  assert.equal(board.boardTitle('  採掘 '), '採掘 ギフト一覧');
  assert.equal(board.boardTitle(''), 'ギフト一覧');
  assert.equal(board.boardTitle(undefined), 'ギフト一覧');
  assert.equal(board.boardFilename('採掘', 1), '採掘 ギフト一覧_1.png');
  assert.equal(board.boardFilename('埋め立て', 2), '埋め立て ギフト一覧_2.png');
  assert.equal(board.boardFilename('a/b:c', 1), 'a_b_c ギフト一覧_1.png');
});

test('マスの中身: コマンドの名前は一覧の題名（.txt・大文字小文字を問わない）、無ければファイル名。ギフトの画像はカタログから', () => {
  const gifts = [{ id: 5655, name: 'バラ', diamond_count: 1, image: 'https://example.com/rose.png' }];
  const commands = [{ name: 'zombie.txt', title: 'ゾンビ' }];
  const items = board.boardItems([
    row(5655, { name: '5655', commandFile: 'Zombie.TXT', repeat: 3 }),
    row(7, { commandFile: 'heal.txt', enabled: false }),
  ], gifts, commands);
  assert.deepEqual(items[0], { id: 'id5655', giftId: '5655', giftName: 'バラ', image: 'https://example.com/rose.png', diamonds: 1, title: 'ゾンビ', repeat: 3, disabled: false });
  assert.equal(items[1].title, 'heal');
  assert.equal(items[1].image, null);
  assert.equal(items[1].disabled, true, '無効の割り当て（enabled: false）は画面に印を出す');
});

test('文字の収め方: 1行で入れば1行。入らなければ縮めて折り返し、「！」だけを次の行に落とさない', () => {
  const measure = (text, size) => [...text].length * size; // 1文字の幅 = 大きさ
  assert.deepEqual(board.fitBoardText('ゾンビ', 148, 46, 32, measure), { size: 32, lines: ['ゾンビ'] });
  // 8文字：折り返すと 20px（7文字 + 1文字）。1行なら 18px で、あまり変わらないので1行。
  assert.deepEqual(board.fitBoardText('エンダーパール！', 148, 46, 32, measure), { size: 18, lines: ['エンダーパール！'] });
  // 12文字：1行なら 12px、折り返すと 20px なので2行。行の頭に「！」を置かない。
  const long = board.fitBoardText('あいうえおかきくけこさ！', 148, 46, 32, measure);
  assert.equal(long.size, 20);
  assert.deepEqual(long.lines, ['あいうえおかき', 'くけこさ！']);
  const kinsoku = board.fitBoardText('あいうえおかき！', 140, 46, 32, measure, 20);
  assert.deepEqual(kinsoku.lines, ['あいうえおか', 'き！'], '「！」の前の1文字も次の行へ');
});

test('ギフトの画像の読み込み: 4枚ずつ読み、読めた画像・待ち・読めなかった画像を数える。読み直しと時間切れ', async () => {
  const calls = [];
  const resolvers = new Map();
  const cache = createGiftImageCache({
    fetchDataUrl: url => { calls.push(url); return new Promise((resolve, reject) => resolvers.set(url, { resolve, reject })); },
    decode: async dataUrl => ({ dataUrl }),
    timeoutMs: 1000,
  });
  let changes = 0;
  const stop = cache.subscribe(() => { changes++; });
  const urls = ['u1', 'u2', 'u3', 'u4', 'u5', null, 'u1'];
  cache.request(urls);
  assert.deepEqual(calls, ['u1', 'u2', 'u3', 'u4'], '同時に読むのは4枚まで。空と重なりは飛ばす');
  assert.equal(cache.summary(urls).pending, 5);
  resolvers.get('u1').resolve('AAAA');
  resolvers.get('u2').reject(new Error('404'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['u1', 'u2', 'u3', 'u4', 'u5'], '終わった分だけ次を読む');
  const summary = cache.summary(urls);
  assert.deepEqual(summary.images.get('u1'), { dataUrl: 'data:image/png;base64,AAAA' });
  assert.deepEqual(summary.failed, ['u2']);
  assert.equal(summary.pending, 3);
  assert.ok(changes >= 2, '読み終えるたびに知らせる');
  cache.retryFailed(urls);
  assert.equal(calls.filter(url => url === 'u2').length, 2, '読めなかった画像を読み直す（読み終えた画像は読み直さない）');
  assert.equal(calls.filter(url => url === 'u1').length, 1);
  for (const url of ['u3', 'u4', 'u5']) resolvers.get(url).resolve('data:image/png;base64,QQ==');
  resolvers.get('u2').resolve('QUJD');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual([cache.summary(urls).pending, cache.summary(urls).failed.length], [0, 0]);
  stop();

  const slow = createGiftImageCache({ fetchDataUrl: () => new Promise(() => {}), decode: async value => value, timeoutMs: 20 });
  const unsubscribe = slow.subscribe(() => {});
  slow.request(['late']);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.deepEqual(slow.summary(['late']).failed, ['late'], '時間切れは読めなかった画像');
  unsubscribe();
  assert.equal(toImageDataUrl('data:image/webp;base64,AA'), 'data:image/webp;base64,AA');
});

test('ギフトの画像の読み込み: 誰も見ていなくなったら、まだ始めていない読み込みはやめる', async () => {
  const calls = [];
  const cache = createGiftImageCache({ fetchDataUrl: url => { calls.push(url); return new Promise(() => {}); }, decode: async value => value, workers: 1, timeoutMs: 30 });
  const stop = cache.subscribe(() => {});
  cache.request(['a', 'b', 'c']);
  stop();
  assert.deepEqual(calls, ['a']);
  assert.equal(cache.summary(['b', 'c']).pending, 2, '始めていない分は消したので、もう一度 request すれば読む');
});

// 画面の部品は、アイコン（.png?inline）を data URL に置き換えて組み立てる。
async function loadBoard() {
  const file = path.join(root, 'src/components/RegisteredGiftBoard.tsx');
  const assets = { name: 'assets', setup(b) {
    b.onResolve({ filter: /\?inline$/ }, args => ({ path: args.path, namespace: 'inline-asset' }));
    b.onLoad({ filter: /.*/, namespace: 'inline-asset' }, () => ({ contents: 'export default "data:image/png;base64,iVBORw0KGgo="', loader: 'js' }));
  } };
  const { outputFiles } = await build({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node20', jsx: 'automatic',
    external: ['react', 'react-dom'], nodePaths: [path.join(root, 'node_modules')], plugins: [assets], logLevel: 'silent' });
  const compiled = new Module(file, module);
  compiled.paths = Module._nodeModulePaths(path.join(root, 'src/components'));
  compiled._compile(outputFiles[0].text, file);
  return compiled.exports.default;
}

test('登録済みギフトの一覧: ゲームの名前の見出し・◀▶・54マスのページ。編集中のマスと無効の印、✖ はマウスを載せたときだけ', async () => {
  globalThis.window = { mygamepack: {}, addEventListener() {}, removeEventListener() {} };
  const RegisteredGiftBoard = await loadBoard();
  const mappings = Array.from({ length: 60 }, (_, i) => row(i, i === 4 ? { enabled: false } : {}));
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(RegisteredGiftBoard, {
    mappings, gifts: [], commandFiles: [{ name: 'zombie.txt', title: 'ゾンビ' }], gameName: '埋め立て', selectedGiftId: '2',
    onPickGift: noop, onRemove: noop, onMove: noop,
  }));
  assert.match(html, /登録済みギフト<em>60件<\/em>/);
  assert.match(html, /<h3><img[^>]*>埋め立て ギフト一覧<\/h3>/, 'BRIDGE のアイコンは見出しの左');
  assert.match(html, /aria-label="前のページ"/);
  assert.match(html, /aria-label="次のページ"/);
  assert.match(html, /<span>1 \/ 2<\/span>/);
  const grids = html.split('class="gift-board-grid"').slice(1);
  assert.equal(grids.length, 2, 'ページは全部描いて、今のページだけを見せる');
  assert.ok(grids[1].startsWith(' hidden=""'), '2ページ目は隠す');
  assert.equal((grids[0].match(/class="gift-board-cell /g) || []).length, 54);
  assert.equal((grids[1].match(/class="gift-board-cell is-filled/g) || []).length, 6);
  assert.equal((grids[1].match(/class="gift-board-cell is-empty/g) || []).length, 48, '空いたマスも描く（落とすと最後へ）');
  assert.equal((html.match(/is-editing/g) || []).length, 1, '編集中のマスは1つ');
  assert.equal((html.match(/gift-disabled-mark is-compact/g) || []).length, 1, '無効の割り当てに小さい印');
  assert.equal((html.match(/class="gift-board-remove"/g) || []).length, 60);
  assert.match(html, /全60件（2ページ）をPNGに保存/);
  assert.match(html, /このページを保存/);
  const css = read('src/components/GiftSettingsBoard.css');
  assert.match(css, /\.gift-steps \.gift-board-remove \{[^}]*opacity: 0;[^}]*pointer-events: none;/, '✖ はふだん見えない');
  assert.match(css, /\.gift-steps \.gift-board-cell:hover \.gift-board-remove,[^{]*\{[^}]*opacity: 1;/, 'マウスを載せると出る');
  assert.match(css, /\.gift-steps \.gift-board-grid\[hidden\] \{[^}]*display: none;/);
});

test('PNG に描くもの: 見出し・アイコン・マスだけ。✖・無効の印・◀▶ は描かない。紺の地で透明にしない', () => {
  const canvas = read('src/lib/giftBoardCanvas.ts');
  const code = canvas.split(/\r?\n/).filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /DisabledMappingMark|無効（動きません）|disabled|✖|◀|▶/);
  assert.match(canvas, /ctx\.fillRect\(0, 0, width, height\)/, '全体を紺で塗る');
  assert.doesNotMatch(canvas, /clearRect/);
  // 画面の一覧と PNG は同じ形と同じ文字の収め方を使う。
  const component = read('src/components/RegisteredGiftBoard.tsx');
  assert.match(component, /boardLayout\(\)/);
  assert.match(component, /fitBoardText\(/);
  assert.match(canvas, /fitBoardText\(/);
  assert.match(component, /giftPanelSavePngs\(files\)/, '全ページはフォルダーを1回選んで保存');
  assert.match(component, /giftPanelSavePng\(renderPage\(current\), boardFilename\(gameName, current\)\)/);
  // 並び順は設定の mappings の順として保存する（GiftSettingsPage の commitMappings）。
  assert.match(read('src/components/GiftSettingsPage.tsx'), /commitMappings\(p => \[\.\.\.dropOnBoard\(p, fromId, toId\)\]\)/);
});
