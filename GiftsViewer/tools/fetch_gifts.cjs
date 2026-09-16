"use strict";

const fs = require("fs");
const path = require("path");
const { TikTokLiveConnection } = require("tiktok-live-connector");

function normalizeUniqueId(id) {
  return String(id || "").trim().replace(/^@/, "");
}

function pickArg(flag) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return null;
}

function pickImageUrl(gift) {
  const img = gift?.image || gift?.gift?.image;
  if (!img) return null;

  if (Array.isArray(img.url_list) && img.url_list[0]) return img.url_list[0];
  if (typeof img.url === "string") return img.url;

  for (const k of ["urlList", "url_list", "urls", "url"]) {
    const v = img[k];
    if (Array.isArray(v) && v[0]) return v[0];
    if (typeof v === "string") return v;
  }
  return null;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function configureSystemCertificates(tls = require("node:tls")) {
  // OSで信頼済みの証明書も使う。証明書・ホスト名の検証は無効化しない。
  if (typeof tls.getCACertificates === "function" && typeof tls.setDefaultCACertificates === "function") {
    tls.setDefaultCACertificates([...tls.getCACertificates("default"), ...tls.getCACertificates("system")]);
  }
}

function formatFetchError(error) {
  const seen = new Set();
  const details = [];
  function visit(item) {
    if (!item || seen.has(item) || seen.size >= 20) return;
    seen.add(item);
    details.push(item);
    visit(item.cause);
    if (Array.isArray(item.errors)) item.errors.forEach(visit);
  }
  visit(error);
  if (details.some(item => /CERT|UNABLE_TO_VERIFY|SELF_SIGNED/.test(String(item.code || "")))) {
    return "通信先の証明書を確認できませんでした。Windowsの日時や、ネットワーク・保護ソフトの通知を確認してください。保存済みのギフト一覧はそのまま使えます。";
  }
  const message = details.find(item => typeof item.message === "string" && item.message.trim())?.message;
  return message ? message.split(/[\r\n]/)[0].replace(/https?:\/\/\S+/g, "通信先").slice(0, 240)
    : "ギフト一覧を取得できませんでした。TikTok IDと通信状態を確認して、もう一度お試しください。";
}

async function fetchGiftCatalog(connection) {
  const roomId = await connection.fetchRoomId();
  if (!roomId) throw new Error("配信ルームが見つかりません。TikTok IDと配信状態を確認してください。");
  // 2.4系のfetchAvailableGiftsは外部の有料署名サービスを要求する。
  // 公開のgift/list APIで取得し、配信接続や外部署名を必要としない。
  const response = await connection.webClient.getJsonObjectFromWebcastApi("gift/list/", {
    ...connection.clientParams,
    room_id: roomId,
    app_language: "ja-JP",
    browser_language: "ja-JP",
    webcast_language: "ja-JP",
  });
  const gifts = response?.data?.gifts;
  if (!Array.isArray(gifts) || gifts.length === 0 || gifts.some(g =>
    !g || !g.id || typeof g.name !== "string" || !Number.isFinite(g.diamond_count) || g.diamond_count < 0)) {
    throw new Error("有効なギフト一覧を取得できませんでした。保存済みの一覧は変更していません。");
  }
  return { gifts, roomId };
}

async function main() {
  const uniqueId = normalizeUniqueId(process.argv[2]);
  if (!uniqueId) {
    console.error("Usage: node tools/fetch_gifts.cjs <tiktokUniqueId> [--out <dir>]");
    process.exit(1);
  }

  const outBase = pickArg("--out") ? path.resolve(pickArg("--out")) : process.cwd();
  ensureDir(outBase);

  const outFull = path.join(outBase, "gifts.full.json");
  const outMin = path.join(outBase, "gifts.min.json");
  const outMeta = path.join(outBase, "gifts.meta.json");

  configureSystemCertificates();
  const connection = new TikTokLiveConnection(uniqueId, {
    enableExtendedGiftInfo: true,
    // ギフト名などを日本語で取得する（デフォルトは en）
    webClientParams: {
      app_language: "ja-JP",
      browser_language: "ja-JP",
      webcast_language: "ja-JP",
    },
    webClientHeaders: {
      "Accept-Language": "ja-JP,ja;q=0.9",
    },
  });

  try {
    console.log(`[fetchAvailableGifts] start: @${uniqueId}`);
    const { gifts: giftList, roomId } = await fetchGiftCatalog(connection);

    fs.writeFileSync(outFull, JSON.stringify(giftList, null, 2), "utf-8");

    const simplified = giftList.map((g) => ({
      id: g.id,
      name: g.name,
      diamond_count: g.diamond_count,
      image: pickImageUrl(g),
    }));

    fs.writeFileSync(outMin, JSON.stringify(simplified, null, 2), "utf-8");

    const meta = {
      generatedAt: new Date().toISOString(),
      username: uniqueId,
      roomId,
      count: simplified.length,
    };
    fs.writeFileSync(outMeta, JSON.stringify(meta, null, 2), "utf-8");

    console.log(`OK: ${giftList.length} gifts`);
    console.log(`- full: ${outFull}`);
    console.log(`- min : ${outMin}`);
    console.log(`- meta: ${outMeta}`);
  } catch (err) {
    console.error("FAILED:", formatFetchError(err));
    process.exitCode = 2;
  }
}

module.exports = { fetchGiftCatalog, normalizeUniqueId, configureSystemCertificates, formatFetchError };
if (require.main === module) main();
