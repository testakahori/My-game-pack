// src/components/InitialSetupPage.tsx
import React, { useState } from "react";

type Props = {
  setupComplete: boolean;
  onSetupComplete: () => void;
  onResetSetup: () => void;
};

const InitialSetupPage: React.FC<Props> = ({ setupComplete, onSetupComplete, onResetSetup }) => {
  const [customFolder, setCustomFolder] = useState<string>("");
  const [forgeState, setForgeState] = useState<"idle" | "launching" | "launched">("idle");
  const [setupState, setSetupState] = useState<"idle" | "running" | "launched" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState("");

  const api = (window as any).mygamepack;

  const handlePickFolder = async () => {
    try {
      const res = await api.dialogPickFolder("セットアップを実行するフォルダを選択");
      if (!res.canceled && res.path) {
        setCustomFolder(res.path);
        setErrorMsg("");
        setForgeState("idle");
        setSetupState("idle");
        setVerifyMsg("");
      }
    } catch (e: any) {
      setErrorMsg(`フォルダ選択エラー: ${e?.message ?? String(e)}`);
    }
  };

  const resolveTargetFolder = async (): Promise<string> => {
    if (customFolder.trim()) return customFolder.trim();
    const cfg = await api.appConfigRead();
    return (cfg.serverFolder as string) || "";
  };

  const handleForgeInstall = async () => {
    setForgeState("launching");
    setErrorMsg("");
    try {
      const targetFolder = await resolveTargetFolder();
      if (!targetFolder) throw new Error("セットアップ先フォルダが設定されていません。フォルダを選択してください。");
      await api.appConfigWrite({ serverFolder: targetFolder });
      await api.serverCopyTemplate(targetFolder);
      await api.serverForgeInstallAtPath(targetFolder);
      setForgeState("launched");
    } catch (e: any) {
      setForgeState("idle");
      setErrorMsg(`エラー: ${e?.message ?? String(e)}`);
    }
  };

  const handleSetup = async () => {
    setSetupState("running");
    setErrorMsg("");
    try {
      const targetFolder = await resolveTargetFolder();
      if (!targetFolder) throw new Error("セットアップ先フォルダが設定されていません。フォルダを選択してください。");
      await api.appConfigWrite({ serverFolder: targetFolder });
      await api.serverCopyTemplate(targetFolder);
      await api.serverSetupAtPath(targetFolder);
      setSetupState("launched");
    } catch (e: any) {
      setSetupState("error");
      setErrorMsg(`エラー: ${e?.message ?? String(e)}`);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyMsg("");
    try {
      const result = await api.serverCheckSetupComplete();
      if (result.complete) {
        const targetFolder = await resolveTargetFolder();
        if (targetFolder) await api.bridgeExtractTo(targetFolder);
        await api.serverPropsWrite({ "enable-command-block": "true" });
        await api.appConfigWrite({ setupComplete: true });
        onSetupComplete();
      } else {
        setVerifyMsg("セットアップがまだ完了していません。コマンドプロンプトの処理が終わるまでお待ちください。");
      }
    } catch (e: any) {
      setVerifyMsg(`確認エラー: ${e?.message ?? String(e)}`);
    } finally {
      setVerifying(false);
    }
  };

  // セットアップ済みの場合
  if (setupComplete) {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white">初期セットアップ</h1>
        </div>
        <div className="bg-emerald-900/30 border border-emerald-500/40 rounded-xl p-6 text-center space-y-3">
          <div className="text-3xl">✅</div>
          <div className="text-emerald-300 font-bold">セットアップ完了済みです</div>
          <div className="text-emerald-200/70 text-sm">
            ダッシュボードからサーバーを起動できます。
          </div>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
          <div className="text-sm text-gray-400">
            セットアップをやり直す場合は、新しいフォルダを選択して再実行できます。
          </div>
          <button
            type="button"
            onClick={onResetSetup}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-200 transition"
          >
            🔄 セットアップをやり直す
          </button>
        </div>
      </div>
    );
  }

  const busy = forgeState === "launching" || setupState === "running";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white">初期セットアップ</h1>
        <p className="text-gray-400 text-sm mt-1">
          Forge サーバーを初めて使う場合に実行します。
          <span className="text-amber-400 font-bold"> 初回のみ</span> 必要です。
        </p>
      </div>

      {/* 警告 */}
      <div className="bg-amber-900/30 border border-amber-500/40 rounded-xl p-4 text-sm text-amber-200 space-y-1">
        <div className="font-bold text-amber-300">⚠️ 注意事項</div>
        <ul className="list-disc list-inside space-y-1 text-amber-200/80">
          <li>セットアップには数分かかります。</li>
          <li>Minecraft EULA に自動で同意します。セットアップ実行をもって同意とみなします。</li>
          <li>既存のサーバーが起動中の場合は先に停止してください。</li>
        </ul>
      </div>

      {/* フォルダ選択 */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
        <div className="text-sm font-bold text-gray-300">セットアップ先フォルダ</div>
        <div className="flex items-center gap-3">
          <input
            readOnly
            value={customFolder || "（デフォルト: server/Douma_Craft）"}
            className={`flex-1 bg-gray-900 border rounded-lg px-3 py-2 text-sm truncate focus:outline-none ${
              customFolder ? "border-cyan-500/50 text-cyan-300" : "border-gray-600 text-gray-500"
            }`}
          />
          <button
            type="button"
            onClick={handlePickFolder}
            disabled={busy}
            className="shrink-0 px-4 py-2 rounded-lg text-xs font-bold bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            📁 フォルダを選択
          </button>
          {customFolder && !busy && (
            <button
              type="button"
              onClick={() => {
                setCustomFolder("");
                setForgeState("idle");
                setSetupState("idle");
                setErrorMsg("");
                setVerifyMsg("");
              }}
              className="shrink-0 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 transition"
            >
              リセット
            </button>
          )}
        </div>
        <div className="text-[11px] text-gray-500">
          {customFolder
            ? "選択したフォルダにサーバーファイルをコピーしてセットアップします。空のフォルダでも使えます。"
            : "変更しない場合はデフォルトフォルダ（server/Douma_Craft）で実行されます。"}
        </div>
      </div>

      {/* ① Forge インストール */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
            ①
          </div>
          <div className="text-sm font-bold text-gray-200">Forge をインストールする（プレイ用）</div>
        </div>
        <div className="text-xs text-gray-400 pl-8">
          自分の Minecraft に Forge クライアントをインストールします。画面が表示されたら{" "}
          <span className="text-white font-bold">「Install client」</span>{" "}
          を選択して OK を押してください。
        </div>
        <div className="pl-8">
          <button
            type="button"
            onClick={handleForgeInstall}
            disabled={forgeState === "launching"}
            className={`px-6 py-3 rounded-xl font-bold text-sm transition ${
              forgeState === "launching"
                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                : forgeState === "launched"
                ? "bg-emerald-700 hover:bg-emerald-600 text-white"
                : "bg-blue-600 hover:bg-blue-500 text-white"
            }`}
          >
            {forgeState === "launching"
              ? "⏳ 起動中..."
              : forgeState === "launched"
              ? "✅ 起動済み（再度起動する場合はクリック）"
              : "🔧 Forge をインストールする"}
          </button>
        </div>
      </div>

      {/* ② 環境構築 */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-orange-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
            ②
          </div>
          <div className="text-sm font-bold text-gray-200">環境構築をする</div>
        </div>
        <div className="text-xs text-gray-400 pl-8">
          ① 完了後に実行してください。run.bat 生成・EULA 同意・RCON 設定・server.properties
          設定を自動で行います。
        </div>
        <div className="pl-8">
          <button
            type="button"
            onClick={handleSetup}
            disabled={setupState === "running" || setupState === "launched"}
            className={`px-6 py-3 rounded-xl font-bold text-sm transition ${
              setupState === "running" || setupState === "launched"
                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                : "bg-orange-600 hover:bg-orange-500 text-white"
            }`}
          >
            {setupState === "running"
              ? "⏳ 起動中..."
              : setupState === "launched"
              ? "✅ setup.bat 起動済み"
              : "⚙️ 環境構築をする"}
          </button>
        </div>
      </div>

      {/* エラーメッセージ */}
      {errorMsg && (
        <div className="px-4 py-3 rounded-xl text-sm bg-red-900/50 border border-red-500/30 text-red-300">
          ❌ {errorMsg}
        </div>
      )}

      {/* セットアップ完了確認 */}
      {setupState === "launched" && (
        <div className="space-y-2">
          <div className="text-xs text-gray-400 text-center">
            コマンドプロンプトでの処理が終わったら下のボタンで完了を確認してください
          </div>
          <button
            type="button"
            onClick={handleVerify}
            disabled={verifying}
            className={`w-full py-3 rounded-xl font-bold text-base transition ${
              verifying
                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                : "bg-emerald-600 hover:bg-emerald-500 text-white"
            }`}
          >
            {verifying ? "⏳ 確認中…" : "✅ セットアップ完了を確認"}
          </button>
          {verifyMsg && (
            <div className="px-4 py-3 rounded-xl text-sm bg-amber-900/50 border border-amber-500/30 text-amber-300">
              ⚠️ {verifyMsg}
            </div>
          )}
        </div>
      )}

      <div className="text-xs text-gray-600 border-t border-gray-800 pt-3 space-y-1">
        <div>
          ① <code className="text-gray-500">forge_install.bat</code> → ②{" "}
          <code className="text-gray-500">setup.bat</code>
        </div>
        <div>セットアップ完了後は「ダッシュボード」からサーバーを起動できます。</div>
      </div>
    </div>
  );
};

export default InitialSetupPage;
