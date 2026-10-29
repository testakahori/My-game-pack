// server.properties の読み書き（初期セットアップと、ゲームの切り替えのマップの入れ替えが使う。埋め立て PR3 で initial_setup.cjs から分けた）。

function readProperties(text) {
  const props = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#!\s=]+)\s*=(.*)$/);
    if (match) props[match[1]] = match[2].trim();
  }
  return props;
}

// 指定したキーだけを書き換え、無いキーは最後に足す。ほかの行（コメントも）はそのまま残す。
function mergeProperties(text, updates) {
  const remaining = new Map(Object.entries(updates));
  const lines = text.split(/\r?\n/).map(line => {
    const match = line.match(/^\s*([^#!\s=]+)\s*=/);
    if (!match || !Object.hasOwn(updates, match[1])) return line;
    remaining.delete(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });
  while (lines.at(-1) === "") lines.pop();
  return [...lines, ...[...remaining].map(([key, value]) => `${key}=${value}`), ""].join("\n");
}

// サーバーが読むワールドの場所（書いていなければ Minecraft の既定の world）。
const levelNameOf = text => readProperties(text)["level-name"] || "world";

module.exports = { readProperties, mergeProperties, levelNameOf };
