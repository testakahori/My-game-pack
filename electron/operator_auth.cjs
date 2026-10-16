// 運営ログインと、その ipc。main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// リポジトリは public のため平文パスワードは一切置かない。PBKDF2ハッシュのみを埋め込む。
// ログイン成功後は authEmail + authToken(HMAC) を app-config.json に保存し、次回起動時は
// トークン再計算で照合する（パスワード自体は保存しない）。
const crypto = require("crypto");

const OPERATOR_AUTH = {
  salt: "fa2e3d72dcba1a83977e4cac983c5366",
  hash: "8365be19bbae0379de9af9cb411e3883ae9faa82d6eb244ce5e1725a810d1c0c",
  iterations: 210000,
  keyLen: 32,
};

// credentials と now はテストで差し替えるためのもの。本番は既定値（上のハッシュと今の時刻）。
function createOperatorAuth({ readAppConfig, writeAppConfig, credentials = OPERATOR_AUTH, now = () => Date.now() }) {
  function verifyOperatorPassword(password) {
    const derived = crypto.pbkdf2Sync(
      String(password),
      credentials.salt,
      credentials.iterations,
      credentials.keyLen,
      "sha256"
    );
    const expected = Buffer.from(credentials.hash, "hex");
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  }

  function operatorLoginToken(email) {
    return crypto
      .createHmac("sha256", credentials.hash)
      .update(String(email).trim().toLowerCase())
      .digest("hex");
  }

  function isValidLoginEmail(email) {
    const v = String(email || "").trim();
    return v.length >= 5 && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  }

  let failedAuthAttempts = 0;
  let authLockedUntil = 0;

  // 運営ログイン済みかどうか（auth:status と同じ判定）。UI 全体は LoginPage でゲートされて
  // いるが、コンソール送信のような強い操作は main 側でも二重に確認する（多層防御）。
  function isOperatorAuthed() {
    try {
      const cfg = readAppConfig();
      const email = String(cfg.authEmail || "").trim();
      return !!email && cfg.authToken === operatorLoginToken(email);
    } catch { return false; }
  }

  function register(ipcMain) {
    ipcMain.handle("auth:status", async () => {
      const cfg = readAppConfig();
      const email = String(cfg.authEmail || "").trim();
      if (!email || !cfg.authToken) return { authenticated: false, email: "" };
      const valid = cfg.authToken === operatorLoginToken(email);
      return { authenticated: valid, email: valid ? email : "" };
    });

    ipcMain.handle("auth:login", async (_event, payload) => {
      const current = now();
      if (current < authLockedUntil) {
        const seconds = Math.max(1, Math.ceil((authLockedUntil - current) / 1000));
        return { ok: false, message: `ログイン試行が多すぎます。${seconds}秒後に再試行してください` };
      }
      const email = String(payload?.email || "").trim();
      const password = String(payload?.password || "");
      if (!isValidLoginEmail(email)) {
        return { ok: false, message: "メールアドレスの形式が正しくありません" };
      }
      if (!verifyOperatorPassword(password)) {
        failedAuthAttempts += 1;
        if (failedAuthAttempts >= 5) {
          failedAuthAttempts = 0;
          authLockedUntil = now() + 60000;
        }
        return { ok: false, message: "パスワードが違います" };
      }
      failedAuthAttempts = 0;
      authLockedUntil = 0;
      writeAppConfig({
        authEmail: email,
        authToken: operatorLoginToken(email),
        authLoginAt: new Date().toISOString(),
      });
      return { ok: true, email };
    });

    ipcMain.handle("auth:logout", async () => {
      writeAppConfig({ authEmail: "", authToken: "" });
      return { ok: true };
    });
  }

  return { verifyOperatorPassword, operatorLoginToken, isValidLoginEmail, isOperatorAuthed, register };
}

module.exports = { createOperatorAuth };
