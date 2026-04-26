"use strict";

const fs = require("fs");
const path = require("path");

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const DEFAULT_MIN_JSON = path.resolve(process.cwd(), "data", "gifts", "gifts.min.json");
const DEFAULT_HTML = path.resolve(process.cwd(), "data", "gifts", "gifts.html");

// 使い方:
//  - node tools/gifts_to_html.js            -> data/gifts/gifts.min.json を読む
//  - node tools/gifts_to_html.js <path>     -> 指定ファイルを読む
const inArg = process.argv[2];
const inputPath = inArg ? path.resolve(process.cwd(), inArg) : DEFAULT_MIN_JSON;

if (!fs.existsSync(inputPath)) {
  console.error("Input not found:", inputPath);
  console.error("Run: node tools/fetch_gifts.js <tiktokUniqueId> first");
  process.exit(1);
}

const list = JSON.parse(fs.readFileSync(inputPath, "utf-8"));

const rows = list
  .slice()
  .sort((a, b) => (a.diamond_count ?? 0) - (b.diamond_count ?? 0))
  .map((g) => {
    const img = g.image
      ? `<img src="${escapeHtml(g.image)}" alt="" loading="lazy" />`
      : `<div class="noimg">no image</div>`;
    return `
      <tr>
        <td class="img">${img}</td>
        <td class="id">${escapeHtml(g.id)}</td>
        <td class="name">${escapeHtml(g.name)}</td>
        <td class="cost">${escapeHtml(g.diamond_count)}</td>
      </tr>
    `;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Gift List</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:16px}
  h1{font-size:18px;margin:0 0 12px}
  .note{color:#666;font-size:12px;margin:0 0 12px}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #ddd;padding:8px;vertical-align:middle}
  th{background:#f6f6f6;text-align:left}
  td.img{width:72px}
  td.img img{width:56px;height:56px;object-fit:contain;display:block}
  .noimg{width:56px;height:56px;display:grid;place-items:center;background:#fafafa;color:#999;font-size:10px;border:1px dashed #ccc}
  td.cost{text-align:right;white-space:nowrap}
  .search{margin:0 0 12px;display:flex;gap:8px;flex-wrap:wrap}
  input{padding:8px 10px;border:1px solid #ccc;border-radius:8px;min-width:240px}
</style>
</head>
<body>
<h1>Gift List</h1>
<p class="note">ID / Name / Image / Diamonds</p>

<div class="search">
  <input id="q" placeholder="filter: id/name" />
</div>

<table id="t">
  <thead>
    <tr><th>Image</th><th>ID</th><th>Name</th><th>Cost</th></tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>

<script>
  const q = document.getElementById('q');
  const tbody = document.querySelector('#t tbody');
  const all = Array.from(tbody.querySelectorAll('tr'));
  q.addEventListener('input', () => {
    const s = q.value.trim().toLowerCase();
    for (const tr of all) {
      const text = tr.innerText.toLowerCase();
      tr.style.display = (!s || text.includes(s)) ? '' : 'none';
    }
  });
</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(DEFAULT_HTML), { recursive: true });
fs.writeFileSync(DEFAULT_HTML, html, "utf-8");
console.log("OK:", DEFAULT_HTML);