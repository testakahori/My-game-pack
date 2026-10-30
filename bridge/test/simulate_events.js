// bridge/test/simulate_events.js
// オフライン検証：
//  1. コマンドtxtパーサー
//  2. ギフト重複排除キー
//  3. BridgeMod送信リトライ（フェイクサーバーで429→429→202を再現）
//  4. commands/minecraft/*.txt の健全性（未実装プレースホルダ・視線依存座標の残留チェック）
//
// 実行: node test/simulate_events.js

"use strict";

const http = require("http");
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const bridge = require("../index.js");
const { parseWeightedList, chooseWeighted } = require("../weighted_choice.cjs");
const { validateBridgeConfig } = require("../config_schema.js");
const { RestartPolicy } = require("../../electron/restart_policy.cjs");

let passed = 0;
function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  [PASS] ${name}`);
    })
    .catch((e) => {
      console.error(`  [FAIL] ${name}: ${e?.message || e}`);
      process.exitCode = 1;
    });
}

async function main() {
  console.log("=== Bridge simulation tests ===");

  await ok("TikTok connector: 現行APIの接続クラスを利用可能", () => {
    const connector = require("tiktok-live-connector");
    assert.strictEqual(typeof connector.TikTokLiveConnection, "function");
  });

  await ok("parseCommandFile: meta/コメント/コマンド分離", () => {
    const { meta, commands } = bridge.parseCommandFile(
      "# TITLE: テスト\n# SUBTITLE: サブ\n\n// comment\nsummon minecraft:cod ~ ~ ~\neffect give @a speed 5 1\n"
    );
    assert.strictEqual(meta.TITLE, "テスト");
    assert.strictEqual(meta.SUBTITLE, "サブ");
    assert.deepStrictEqual(commands, [
      "summon minecraft:cod ~ ~ ~",
      "effect give @a speed 5 1",
    ]);
  });

  await ok("applyPlaceholders(RCON): 40文字で切っても絵文字のサロゲートペアを壊さない", () => {
    // 途中で切れた \ud83d が SNBT の CustomName に入ると、summon ごと失敗する。
    const name = "x".repeat(39) + "\u{1f600}\u{1f600}";
    const out = bridge.applyPlaceholders('summon minecraft:zombie ~ ~ ~ {CustomName:"\\"{ListenerName}\\""}', { listenerName: name });
    assert.strictEqual(out, 'summon minecraft:zombie ~ ~ ~ {CustomName:"\\"' + "x".repeat(39) + '\u{1f600}\\""}');
    assert.ok(!/\\u[dD][89a-fA-F]/.test(out), out);
  });

  await ok("dedupe: 同一msgId+repeatCountは重複、repeatCountが進めば別イベント", () => {
    const base = { msgId: "m1", giftId: "5655", nickname: "alice", repeatCount: 1 };
    const k1 = bridge.dedupeKeyFromGift(base);
    assert.strictEqual(bridge.isDuplicateEvent(k1), false);
    assert.strictEqual(bridge.isDuplicateEvent(k1), true); // 二重発火は捨てる
    const k2 = bridge.dedupeKeyFromGift({ ...base, repeatCount: 2 });
    assert.notStrictEqual(k1, k2);
    assert.strictEqual(bridge.isDuplicateEvent(k2), false); // 連打の進行は通す
  });

  await ok("BridgeMod送信: 429キュー満杯でもリトライして届く（ギフト不落）", async () => {
    let requests = 0;
    let lastBody = null;
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        requests++;
        lastBody = body;
        res.setHeader("Content-Type", "application/json");
        if (requests <= 2) {
          res.statusCode = 429;
          res.end('{"ok":false,"error":"queue_full"}');
        } else {
          res.statusCode = 202;
          res.end('{"ok":true,"queued":true}');
        }
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    const t0 = Date.now();
    await bridge.enqueueBridgeModEvent(
      { host: "127.0.0.1", port },
      { type: "gift", commandFile: "zombie.txt", count: 3, listenerName: "tester", announce: true }
    );
    server.close();

    assert.strictEqual(requests, 3, `expected 3 requests (2x429 + 202), got ${requests}`);
    const payload = JSON.parse(lastBody);
    assert.strictEqual(payload.key, "zombie");
    assert.strictEqual(payload.count, 3);
    assert.strictEqual(payload.type, "gift");
    console.log(`         retries took ${Date.now() - t0}ms, payload=${lastBody}`);
  });

  await ok("commands/minecraft/*.txt: 健全性チェック", () => {
    const dir = path.resolve(__dirname, "..", "commands", "minecraft");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt"));
    assert.ok(files.length > 0, "no command files found");
    const problems = [];
    for (const f of files) {
      const { commands } = bridge.parseCommandFile(fs.readFileSync(path.join(dir, f), "utf8"));
      if (commands.length === 0) problems.push(`${f}: コマンド行が0件`);
      for (const cmd of commands) {
        if (/\{playerme\}/i.test(cmd)) problems.push(`${f}: 未実装プレースホルダ {PlayerMe} が残存`);
        // スポーンは視線非依存のワールド相対(~)へ統一済み。summon で ^（視線基準）を使うと
        // 採掘中の向き次第でスポーン位置が地中などにぶれるため、一切禁止する。
        if (/\bsummon\b/.test(cmd) && cmd.includes("^")) {
          problems.push(`${f}: summon に視線基準の^座標が残存 -> ${cmd.slice(0, 80)}`);
        }
        // コマンドとして成立しない行（NBTだけ等）
        if (cmd.startsWith("{")) problems.push(`${f}: コマンドではない行 -> ${cmd.slice(0, 60)}`);
      }
      // 召喚個体を狙う一時タグは、同一ファイル内で必ず remove する
      // （付けっぱなしだと次回以降のセレクタが過去の個体まで巻き込み、効果の誤爆やリークになる）
      const joined = commands.join("\n");
      for (const tag of ["gift_spawn_new", "giftwolf_new"]) {
        if (joined.includes(tag) && !joined.includes(`remove ${tag}`)) {
          problems.push(`${f}: 一時タグ ${tag} を付与後に remove していない`);
        }
      }
    }
    assert.strictEqual(problems.length, 0, "\n    " + problems.join("\n    "));
  });

  await ok("RANDOM の重み: 重みの割合で選ぶ", () => {
    assert.strictEqual(chooseWeighted(parseWeightedList("heal.txt*1,tnt.txt*9"), () => 0).commandFile, "heal.txt");
  });

  await ok("config schema: 誤設定を具体的に検出", () => {
    const bad = validateBridgeConfig({ tiktokUsername: "", mappings: [{ giftId: "", commandFile: "" }],
      options: { bridgeModPort: 99999 } });
    assert.strictEqual(bad.ok, false);
    // TikTok ID が空の文はアプリの文にそろえた（2026-10-18 設計書の 7）。
    assert.ok(bad.errors.some(x => x.includes("TikTok IDが未承認です")));
    assert.ok(bad.errors.some(x => x.includes("bridgeModPort")));
  });

  await ok("TTS設定: 不正値を安全な範囲へ正規化", () => {
    assert.deepStrictEqual(bridge.normalizeTtsConfig({
      engine: "unknown", speakerId: -9, speedScale: 99, pitchScale: -9,
      intonationScale: "NaN", volume: 4, giftTemplate: "x".repeat(300),
    }), {
      engine: "voicevox", speakerId: 0, speedScale: 2, pitchScale: -0.15,
      intonationScale: 1, volume: 2, enabled: true, commentEnabled: true,
      giftEnabled: true, giftTemplate: "x".repeat(200),
    });
  });

  await ok("streak: 正常な連打進行はdeltaが増分のみ", () => {
    const map = new Map();
    const key = "gift1:alice";
    const t0 = 1_000_000;
    assert.strictEqual(bridge.computeStreakDelta(map, key, 1, false, t0, 60000), 1);
    assert.strictEqual(bridge.computeStreakDelta(map, key, 3, false, t0 + 100, 60000), 2);
    assert.strictEqual(bridge.computeStreakDelta(map, key, 5, false, t0 + 200, 60000), 2);
  });

  await ok("streak: repeatEndはtruthy判定（1でもtrueでも終了扱い）", () => {
    const map = new Map();
    const key = "gift1:alice";
    const t0 = 1_000_000;
    bridge.computeStreakDelta(map, key, 5, 1, t0, 60000); // repeatEnd=1（非boolean）でも終了扱い
    assert.strictEqual(map.has(key), false, "repeatEnd=1 でbaselineが残留している");

    bridge.computeStreakDelta(map, key, 3, true, t0 + 100, 60000);
    assert.strictEqual(map.has(key), false, "repeatEnd=true でbaselineが残留している");
  });

  await ok("streak: ベースライン残留バグの回帰（終了イベント欠落→次streakが無視されない）", () => {
    const map = new Map();
    const key = "gift1:alice";
    const t0 = 1_000_000;
    // 1回目のstreak: rc=5で終了イベントが来ない（欠落）まま残留
    bridge.computeStreakDelta(map, key, 5, false, t0, 60000);
    assert.strictEqual(map.get(key).count, 5);

    // 2回目のstreakがrc=1から開始 → 修正前は delta=1-5<=0 で無視されていた
    const delta = bridge.computeStreakDelta(map, key, 1, false, t0 + 100, 60000);
    assert.strictEqual(delta, 1, "新しいstreak開始（rc巻き戻り）が無視されている");
  });

  await ok("streak: TTL失効後は同一rcNumでもbaselineを捨てて発火する", () => {
    const map = new Map();
    const key = "gift1:alice";
    const t0 = 1_000_000;
    const ttlMs = 60000;
    bridge.computeStreakDelta(map, key, 5, false, t0, ttlMs);

    // TTLを過ぎてから同じ人が同じギフトをrc=1から投げ直す
    const delta = bridge.computeStreakDelta(map, key, 1, false, t0 + ttlMs + 1, ttlMs);
    assert.strictEqual(delta, 1, "TTL失効後もbaselineが効いてしまっている");
  });

  await ok("Bridge再起動ポリシー: クラッシュ時のみ再起動", () => {
    const policy = new RestartPolicy();
    policy.start();
    assert.strictEqual(policy.shouldRestart(), true);
    assert.strictEqual(policy.status(null).restartCount, 1);
    policy.requestStop();
    assert.strictEqual(policy.shouldRestart(), false);
  });

  console.log(`=== done: ${passed} passed, exitCode=${process.exitCode || 0} ===`);
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
