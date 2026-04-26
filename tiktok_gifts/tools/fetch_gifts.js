"use strict";

const fs = require("fs");
const path = require("path");
const { TikTokLiveConnection } = require("tiktok-live-connector");

function normalizeUniqueId(id) {
  return String(id || "").trim().replace(/^@/, "");
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

(async () => {
  const uniqueId = normalizeUniqueId(process.argv[2]);
  if (!uniqueId) {
    console.error("Usage: node tools/fetch_gifts.js <tiktokUniqueId>");
    process.exit(1);
  }

  const connection = new TikTokLiveConnection(uniqueId, {
    enableExtendedGiftInfo: true,
  });

  try {
    console.log(`[fetchAvailableGifts] start: @${uniqueId}`);

    const giftList = await connection.fetchAvailableGifts();

    const outDir = path.resolve(process.cwd(), "data", "gifts");
    ensureDir(outDir);

    const outFull = path.join(outDir, "gifts.full.json");
    fs.writeFileSync(outFull, JSON.stringify(giftList, null, 2), "utf-8");

    const simplified = giftList.map((g) => ({
      id: g.id,
      name: g.name,
      diamond_count: g.diamond_count,
      image: pickImageUrl(g),
    }));

    const outMin = path.join(outDir, "gifts.min.json");
    fs.writeFileSync(outMin, JSON.stringify(simplified, null, 2), "utf-8");

    const meta = {
      generatedAt: new Date().toISOString(),
      username: uniqueId,
      count: simplified.length,
    };
    fs.writeFileSync(path.join(outDir, "gifts.meta.json"), JSON.stringify(meta, null, 2), "utf-8");

    console.log(`OK: ${giftList.length} gifts`);
    console.log(`- full: ${outFull}`);
    console.log(`- min : ${outMin}`);
    console.log(`- meta: ${path.join(outDir, "gifts.meta.json")}`);
  } catch (err) {
    console.error("FAILED:", err?.message || err);
    console.error(err);
    process.exit(2);
  }
})();