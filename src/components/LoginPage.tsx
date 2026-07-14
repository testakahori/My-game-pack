// src/components/LoginPage.tsx
// 運営ログイン画面。メールアドレスがID、パスワードは運営配布のもの。
// 認証に成功すると app-config.json にトークンが保存され、次回起動からは表示されない。
import React, { useState } from "react";
import MinecraftBlockIcon from "./MinecraftBlockIcon";

interface LoginPageProps {
  onLoginSuccess: (email: string) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError("");

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("メールアドレスとパスワードを入力してください");
      return;
    }

    setSubmitting(true);
    try {
      const api = (window as any).mygamepack;
      const result = await api.authLogin({ email: trimmedEmail, password });
      if (result?.ok) {
        onLoginSuccess(result.email || trimmedEmail);
      } else {
        setError(result?.message || "ログインに失敗しました");
      }
    } catch {
      setError("ログイン処理でエラーが発生しました。アプリを再起動してお試しください");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gray-900 text-gray-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-800 p-8 shadow-2xl"
      >
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="h-12 w-12"><MinecraftBlockIcon /></div>
          <h1 className="text-lg font-bold">MC TikTok Bridge</h1>
          <p className="text-xs text-gray-400">運営から配布されたアカウントでログインしてください</p>
        </div>

        <label className="mb-1 block text-xs font-semibold text-gray-300" htmlFor="login-email">
          メールアドレス
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          placeholder="you@example.com"
          className="mb-4 w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />

        <label className="mb-1 block text-xs font-semibold text-gray-300" htmlFor="login-password">
          パスワード
        </label>
        <div className="relative mb-4">
          <input
            id="login-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            placeholder="運営配布のパスワード"
            className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 pr-12 text-sm outline-none focus:border-emerald-500"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 px-3 text-xs text-gray-400 hover:text-gray-200"
            aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
          >
            {showPassword ? "隠す" : "表示"}
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-700 bg-red-900/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-emerald-600 py-2 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "確認中…" : "ログイン"}
        </button>

        <p className="mt-4 text-center text-[10px] leading-relaxed text-gray-500">
          パスワードが分からない場合は運営までお問い合わせください。
        </p>
      </form>
    </div>
  );
};

export default LoginPage;
