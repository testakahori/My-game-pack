// 画面のログイン状態の確かめ（2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 7）。
// main が authenticated: true を返したときだけ通す。確かめそのものが失敗したとき・窓口が無いときはログイン画面を出す
// （前は失敗すると「旧preload等ではブロックせず通す」としてログイン済みにしていた）。
// electron/test/ui-auth-state.test.cjs が見張る。

type AuthApi = { authStatus?: () => Promise<{ authenticated?: unknown } | undefined> } | undefined;

export async function readAuthState(api: AuthApi): Promise<"authed" | "unauthed"> {
  try {
    const status = await api?.authStatus?.();
    return status?.authenticated === true ? "authed" : "unauthed";
  } catch {
    return "unauthed";
  }
}
