// サーバーフォルダーのファイル（server.properties・RCON パスワード・配布ワールドの一覧・ops.json）と、OP の付与・ゲームルールの古い窓口。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron は読み込まず、BridgeMOD との通信は main から受け取る。
const path = require("path");
const fs = require("fs");
const { bridgeCommandsDir } = require("../bridge/config_defaults.cjs");
const { GAMES } = require("../bridge/game_commands.cjs");
const { worldsForGame } = require("./game_maps.cjs");

// サーバーの子プロセス・MAP の作業中・BridgeMOD との通信は、あとで main で作られるので、呼ばれたときに読む関数で受け取る。
// activeGame は今のゲーム（切り替えの記録。無ければ null）。配信ワールドの一覧を、そのゲームで使えるものだけにする。
// assertGameProfileIdle は、ゲームの切り替え中・復旧が必要なときに投げる（その間は server.properties を書かない。2026-10-30）。
function createServerFiles({ getServerRoot, getBridgeBatDir, readAppConfig, assertMapIdle, serverChild, waitForBridgeMod, requestBridgeMod, activeGame = () => null, assertGameProfileIdle = () => {} }) {
  // --------------------
  // IPC: マイクラIDへ OP 権限を付与（_op.txt を書いて Mod 経由で実行）
  // --------------------

  // サーバー停止中でも OP を付与できるよう ops.json へ直接書く。
  // 過去に一度でもログインしていれば usercache.json から UUID を引ける。
  function grantOpOffline(name) {
    const root = getServerRoot();
    let cache = [];
    try { cache = JSON.parse(fs.readFileSync(path.join(root, "usercache.json"), "utf8")); } catch {}
    const entry = Array.isArray(cache)
      ? cache.find((c) => c && String(c.name || "").toLowerCase() === name.toLowerCase())
      : null;
    if (!entry?.uuid) return false;
    const opsPath = path.join(root, "ops.json");
    let ops = [];
    try { ops = JSON.parse(fs.readFileSync(opsPath, "utf8")); } catch {}
    if (!Array.isArray(ops)) ops = [];
    if (!ops.some((o) => o && String(o.name || "").toLowerCase() === name.toLowerCase())) {
      ops.push({ uuid: entry.uuid, name: entry.name, level: 4, bypassesPlayerLimit: false });
      fs.writeFileSync(opsPath, JSON.stringify(ops, null, 2) + "\n", "utf8");
    }
    return true;
  }

  function register(ipcMain) {
    ipcMain.handle("minecraft:grantOp", async () => {
      const name = String(readAppConfig().minecraftPlayerName || "").trim();
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
        throw new Error("マイクラIDが未設定か形式が不正です（英数字と_で3〜16文字）。配信ホームで保存してください。");
      }
      const dir = bridgeCommandsDir(getBridgeBatDir());
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "_op.txt"), `# TITLE: OP付与\nop ${name}\n`, "utf8");
      try {
        // サーバー起動直後ならワールド読み込み完了（Mod HTTP 開通）まで待ってから送る
        if (serverChild()) await waitForBridgeMod();
        await requestBridgeMod("POST", "/bridge/event", {
          type: "other", key: "_op", count: 1, listenerName: "system", announce: false,
        });
      } catch (e) {
        const msg = String(e?.message || e);
        if (/ECONNREFUSED|timeout|ENOTFOUND|ECONNRESET/i.test(msg)) {
          // サーバー停止中：ops.json へ直接登録（次回起動から有効）
          if (!serverChild() && grantOpOffline(name)) {
            return { ok: true, name, offline: true, message: `サーバー停止中のため ops.json に直接登録しました。次回サーバー起動から「${name}」はOPになります。` };
          }
          if (!serverChild()) {
            throw new Error("Minecraftサーバーが起動しておらず、過去のログイン記録も無いため付与できません。一度サーバーに接続（ログイン）してから再度お試しください。");
          }
          throw new Error("Minecraftサーバーは起動中ですが、Mod（BridgeMod）に接続できません。ワールドの読み込み完了（コンソールに Done 表示）を待ってから再度お試しください。");
        }
        throw e;
      }
      return { ok: true, name };
    });

    // --------------------
    // IPC: server.properties 読み込み
    // --------------------
    ipcMain.handle("server:props:read", async () => {
      const propsPath = path.join(getServerRoot(), "server.properties");
      if (!fs.existsSync(propsPath)) throw new Error(`server.properties not found: ${propsPath}`);

      const text = fs.readFileSync(propsPath, "utf-8");
      const props = {};
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith("#") || !line.includes("=")) continue;
        const idx = line.indexOf("=");
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1); // 末尾スペース等を保持
        props[key] = val;
      }
      return props;
    });

    // --------------------
    // IPC: server.properties 書き込み
    // --------------------
    ipcMain.handle("server:props:write", async (_event, updates) => {
      assertMapIdle();
      // ゲームの切り替えの間（埋め立てのマップを写している間など）に配信ワールドを保存すると、切り替えで上書きされ、覚える値も古くなる。
      assertGameProfileIdle();
      if (typeof updates !== "object" || updates === null) throw new Error("updates must be an object");

      const propsPath = path.join(getServerRoot(), "server.properties");
      if (!fs.existsSync(propsPath)) throw new Error(`server.properties not found: ${propsPath}`);

      let text = fs.readFileSync(propsPath, "utf-8");

      for (const [key, value] of Object.entries(updates)) {
        const lines = text.split(/\r?\n/);
        let found = false;
        const updated = lines.map((line) => {
          if (line.startsWith("#") || !line.includes("=")) return line;
          const idx = line.indexOf("=");
          const k = line.slice(0, idx).trim();
          if (k === key) {
            found = true;
            return `${key}=${value}`;
          }
          return line;
        });
        if (!found) updated.push(`${key}=${value}`);
        text = updated.join("\n");
      }

      fs.writeFileSync(propsPath, text, "utf-8");
      return { ok: true };
    });

    // --------------------
    // IPC: RCONパスワード.txt 読み込み
    // --------------------
    ipcMain.handle("server:rconpassword:read", async () => {
      const txtPath = path.join(getServerRoot(), "RCON_password.txt");
      if (!fs.existsSync(txtPath)) return { found: false, password: "" };
      const raw = fs.readFileSync(txtPath, "utf-8").trim();
      return { found: true, password: raw };
    });

    // --------------------
    // IPC: ゲームルール一括適用（RCON）
    // --------------------
    // Environment is owned by BridgeMOD; this legacy IPC now verifies it only.
    ipcMain.handle("server:gamerules:apply", async () => {
      if (serverChild()) await waitForBridgeMod();
      const status = await requestBridgeMod("GET", "/bridge/status");
      if (status.environmentFixed !== true) throw new Error("固定環境に対応したBridgeMODが必要です");
      return { ok: true, transport: "bridge_mod" };
    });
    // No new datapack is written. Old packs are retired only while the server is stopped.
    ipcMain.handle("server:datapack:deployNightVision", () => ({ ok: true, managedBy: "BridgeMOD" }));

    // --------------------
    // IPC: haihu_world/ 内のサブフォルダ一覧（今のゲームで使えるものだけ。埋め立ては埋め立ての専用マップだけ、採掘は専用マップ以外の全部。2026-10-30）
    // --------------------
    ipcMain.handle("server:worlds:list", async () => {
      const dir = path.join(getServerRoot(), "haihu_world");
      if (!fs.existsSync(dir)) return [];
      const folders = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      return worldsForGame(GAMES, activeGame(), folders);
    });
  }

  return { register };
}

module.exports = { createServerFiles };
