import React, { useEffect, useState } from "react";
import setupCompleteHeroImage from "../../assets/初期セットアップ完了.png";
import setupBeforeHeroImage from "../../assets/初期セットアップ完了前01.png";
import setupBeforeForgeImage from "../../assets/初期セットアップ完了前02.png";
import setupBeforeEnvImage from "../../assets/初期セットアップ完了前03.png";

type Props = {
  setupComplete: boolean;
  onSetupComplete: () => void;
  onResetSetup: () => void;
};

const DEFAULT_SERVER_FOLDER = "server/Douma_Craft";

const AkahoriAvatar: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className ?? "setup-avatar"} viewBox="0 0 160 210" role="img" aria-label="赤堀堂馬のMinecraftアバター">
    <defs>
      <linearGradient id="avatarHair" x1="0" x2="1">
        <stop stopColor="#f05c3d" />
        <stop offset="1" stopColor="#a93329" />
      </linearGradient>
      <linearGradient id="avatarPants" x1="0" x2="1">
        <stop stopColor="#193ee5" />
        <stop offset="1" stopColor="#0b1d82" />
      </linearGradient>
    </defs>
    <g className="setup-avatar-shadow">
      <ellipse cx="82" cy="197" rx="48" ry="8" fill="#000" opacity=".38" />
    </g>
    <g transform="translate(18 6)">
      <path d="M35 65 8 105l16 12 27-37Z" fill="#1b1719" />
      <path d="M102 70 139 108l-14 14-39-33Z" fill="#1b1719" />
      <path d="M19 113 5 142l20 9 15-30Z" fill="#f0c594" />
      <path d="M125 112 141 81l18 9-15 33Z" fill="#f0c594" />
      <rect x="38" y="70" width="62" height="70" rx="6" fill="#161313" />
      <path d="M45 72h48l-9 65H54Z" fill="#242024" />
      <path d="M57 73h8v62h-8Zm22 0h8v62h-8Z" fill="#fff" opacity=".85" />
      <path d="M62 73h15l-7 17Z" fill="#f07f73" />
      <path d="M45 140h24v50H38l4-50Z" fill="url(#avatarPants)" />
      <path d="M70 140h27l10 50H77Z" fill="url(#avatarPants)" />
      <path d="M34 190h35v12H29Z" fill="#7b2b22" />
      <path d="M77 190h36v12H84Z" fill="#7b2b22" />
      <rect x="33" y="18" width="74" height="61" rx="8" fill="#f0c594" />
      <path d="M30 15h80v26H30Z" fill="url(#avatarHair)" />
      <path d="M30 34h15v39H30Zm95 1h-18v39h18Z" fill="url(#avatarHair)" />
      <path d="M45 20h24l-8 16H38Z" fill="#ff7352" opacity=".8" />
      <rect x="48" y="48" width="10" height="8" fill="#1e2443" />
      <rect x="82" y="48" width="10" height="8" fill="#1e2443" />
      <rect x="64" y="56" width="12" height="9" fill="#a65b43" />
      <path d="M58 71h34" stroke="#a05d48" strokeWidth="4" />
    </g>
  </svg>
);

const SetupDog: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className ?? "setup-dog"} viewBox="0 0 160 120" role="img" aria-label="Minecraftの犬">
    <ellipse cx="82" cy="105" rx="54" ry="8" fill="#000" opacity=".32" />
    <g transform="translate(14 18)">
      <rect x="36" y="38" width="70" height="38" rx="5" fill="#a8adb4" />
      <rect x="18" y="20" width="48" height="48" rx="5" fill="#c8cbd0" />
      <rect x="11" y="26" width="13" height="24" fill="#8e949d" />
      <rect x="60" y="24" width="12" height="24" fill="#8e949d" />
      <rect x="30" y="40" width="7" height="7" fill="#1b2030" />
      <rect x="51" y="40" width="7" height="7" fill="#1b2030" />
      <rect x="41" y="50" width="11" height="9" fill="#2b2430" />
      <path d="M36 61h19" stroke="#fff" strokeWidth="3" opacity=".7" />
      <rect x="68" y="40" width="10" height="36" fill="#dd4b3e" />
      <rect x="43" y="76" width="13" height="20" fill="#8e949d" />
      <rect x="86" y="76" width="13" height="20" fill="#8e949d" />
      <path d="M104 43 133 26l8 11-30 21Z" fill="#8e949d" />
      <rect x="109" y="58" width="11" height="18" fill="#8e949d" />
    </g>
  </svg>
);

const CompletedPortalScene: React.FC = () => (
  <svg className="setup-complete-portal-scene" viewBox="0 0 560 210" aria-hidden="true">
    <defs>
      <radialGradient id="portalGlow" cx="50%" cy="62%" r="48%">
        <stop stopColor="#43ffd0" stopOpacity=".95" />
        <stop offset=".42" stopColor="#05bcaa" stopOpacity=".52" />
        <stop offset="1" stopColor="#01182d" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="grassRidge" x1="0" x2="1">
        <stop stopColor="#6cd05d" />
        <stop offset="1" stopColor="#1d7c42" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="560" height="210" fill="url(#portalGlow)" opacity=".65" />
    <g opacity=".65">
      {Array.from({ length: 22 }).map((_, i) => (
        <rect key={i} x={18 + i * 24} y={28 + (i % 5) * 11} width={7 + (i % 3) * 2} height={7 + (i % 4) * 2} fill={i % 2 ? "#7df25d" : "#4aa7ff"} transform={`rotate(${(i % 7) * 12} ${18 + i * 24} ${28 + (i % 5) * 11})`} />
      ))}
    </g>
    <g transform="translate(194 66)">
      <rect x="0" y="60" width="178" height="66" fill="#1a2b3a" opacity=".8" />
      {Array.from({ length: 8 }).map((_, i) => (
        <rect key={`top-${i}`} x={i * 22} y="38" width="22" height="22" fill={i % 2 ? "#2f4a5d" : "#22384c"} stroke="#42647b" />
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <rect key={`left-${i}`} x="0" y={60 + i * 11} width="28" height="11" fill={i % 2 ? "#324d62" : "#24384e"} stroke="#42647b" />
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <rect key={`right-${i}`} x="150" y={60 + i * 11} width="28" height="11" fill={i % 2 ? "#324d62" : "#24384e"} stroke="#42647b" />
      ))}
      <rect x="48" y="52" width="82" height="74" rx="3" fill="#00dfba" filter="url(#shadow)" />
      <rect x="58" y="62" width="62" height="64" fill="#062e36" opacity=".46" />
      <path d="M67 71c24 13 5 29 34 47M108 68c-31 18-8 34-36 52" stroke="#60ffe7" strokeWidth="5" opacity=".7" fill="none" />
    </g>
    <g transform="translate(0 145)">
      <polygon points="0,38 132,4 253,37 154,79" fill="url(#grassRidge)" />
      <polygon points="0,38 154,79 154,99 0,58" fill="#5b3d25" />
      <polygon points="560,35 424,2 318,35 426,74" fill="url(#grassRidge)" />
      <polygon points="560,35 426,74 426,96 560,57" fill="#51331f" />
    </g>
    <g transform="translate(464 112)">
      <rect x="23" y="0" width="21" height="54" fill="#5e3b21" />
      <polygon points="32,-28 70,-7 32,14 -7,-7" fill="#28783d" />
      <polygon points="-7,-7 32,14 32,37 -7,16" fill="#1c5f32" />
      <polygon points="70,-7 32,14 32,37 70,16" fill="#174d2d" />
    </g>
  </svg>
);

const ConstructionScene: React.FC = () => (
  <img
    className="setup-construction-scene setup-construction-scene--image"
    src={setupBeforeHeroImage}
    alt="初期セットアップ前のMinecraft風建設シーン"
  />
);

const ForgeAnvilArt: React.FC = () => (
  <img
    className="setup-step-art setup-step-art--forge setup-step-art--image"
    src={setupBeforeForgeImage}
    alt=""
    aria-hidden="true"
  />
);

const CommandBlockArt: React.FC = () => (
  <img
    className="setup-step-art setup-step-art--command setup-step-art--image"
    src={setupBeforeEnvImage}
    alt=""
    aria-hidden="true"
  />
);

const FlowBlocks: React.FC = () => (
  <svg className="setup-flow-art" viewBox="0 0 360 72" aria-hidden="true">
    <defs>
      <linearGradient id="flowBlue" x1="0" x2="1"><stop stopColor="#21d4ff" /><stop offset="1" stopColor="#165dff" /></linearGradient>
      <linearGradient id="flowOrange" x1="0" x2="1"><stop stopColor="#ffad3e" /><stop offset="1" stopColor="#bc4d12" /></linearGradient>
      <linearGradient id="flowGreen" x1="0" x2="1"><stop stopColor="#80ff63" /><stop offset="1" stopColor="#128043" /></linearGradient>
    </defs>
    {[
      ["flowBlue", 48],
      ["flowOrange", 180],
      ["flowGreen", 310],
    ].map(([grad, x]) => (
      <g key={grad} transform={`translate(${x} 12)`}>
        <polygon points="24,0 48,12 24,24 0,12" fill={`url(#${grad})`} />
        <polygon points="0,12 24,24 24,48 0,36" fill="#0b2440" opacity=".86" />
        <polygon points="48,12 24,24 24,48 48,36" fill="#07182c" opacity=".86" />
        <path d="M0 12 24 24 48 12M24 24v24" stroke="#baf8ff" opacity=".5" />
      </g>
    ))}
    <path d="M100 36h54m15 0h78" stroke="url(#flowBlue)" strokeWidth="4" strokeLinecap="round" />
    <path d="m151 27 12 9-12 9m93-18 12 9-12 9" fill="none" stroke="#29e5ff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const InitialSetupPage: React.FC<Props> = ({ setupComplete, onSetupComplete, onResetSetup }) => {
  const [customFolder, setCustomFolder] = useState<string>("");
  const [forgeState, setForgeState] = useState<"idle" | "launching" | "launched">("idle");
  const [setupState, setSetupState] = useState<"idle" | "running" | "launched" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState("");
  const [usingExisting, setUsingExisting] = useState(false);
  const [manualFolderMode, setManualFolderMode] = useState(false);
  const [manualFolderInput, setManualFolderInput] = useState("");
  const [copyProgress, setCopyProgress] = useState<{ copied: number; total: number } | null>(null);
  const [envInfo, setEnvInfo] = useState<{
    forge: { detected: boolean; version: string };
    minecraft: { detected: boolean; version: string };
    java: { detected: boolean; version: string };
    bridge: { detected: boolean; version: string };
    doumaMod: { detected: boolean; version: string };
    tiktokApi: { detected: boolean; version: string };
  } | null>(null);

  const api = (window as any).mygamepack;

  useEffect(() => {
    api.appConfigRead()
      .then((config: { serverFolder?: string }) => {
        if (config?.serverFolder) setCustomFolder(config.serverFolder);
      })
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    if (setupComplete) return;
    api.appConfigRead()
      .then((config: { serverFolder?: string }) => {
        setCustomFolder(config?.serverFolder || "");
      })
      .catch(() => setCustomFolder(""));
  }, [api, setupComplete]);

  useEffect(() => {
    if (!setupComplete) return;
    api.setupInspectEnvironment?.()
      .then((info: typeof envInfo) => setEnvInfo(info))
      .catch(() => setEnvInfo(null));
  }, [api, setupComplete]);

  const saveServerFolder = async (folderPath: string) => {
    const normalized = folderPath.trim();
    setCustomFolder(normalized);
    await api.appConfigWrite({ serverFolder: normalized });
  };

  const handlePickFolder = async () => {
    try {
      const res = await api.dialogPickFolder("セットアップを実行するフォルダを選択");
      if (!res.canceled && res.path) {
        await saveServerFolder(res.path);
        setManualFolderMode(false);
        setManualFolderInput("");
        setErrorMsg("");
        setForgeState("idle");
        setSetupState("idle");
        setVerifyMsg("");
      }
    } catch (e: any) {
      if (import.meta.env.DEV) {
        // 開発ブラウザーはネイティブダイアログが使えないため、手入力欄へフォールバックする。
        // EXE（preload経由のwindow.mygamepack）ではこのフォールバックに落とさず、実エラーだけを表示する。
        setManualFolderMode(true);
        setManualFolderInput(customFolder || "");
        setErrorMsg(
          `フォルダ選択エラー: ${e?.message ?? String(e)}。開発ブラウザではフォルダ選択ダイアログが使えないため、下の入力欄にセットアップ先パスを直接入力してください。`,
        );
      } else {
        setErrorMsg(`フォルダ選択エラー: ${e?.message ?? String(e)}`);
      }
    }
  };

  const handleApplyManualFolder = async () => {
    const normalized = manualFolderInput.trim();
    if (!normalized) {
      setErrorMsg("セットアップ先フォルダのパスを入力してください。");
      return;
    }
    try {
      await saveServerFolder(normalized);
      setManualFolderMode(false);
      setErrorMsg("");
      setForgeState("idle");
      setSetupState("idle");
      setVerifyMsg("");
    } catch (e: any) {
      setErrorMsg(`フォルダ設定エラー: ${e?.message ?? String(e)}`);
    }
  };

  const resolveTargetFolder = async (): Promise<string> => {
    if (customFolder.trim()) return customFolder.trim();
    const cfg = await api.appConfigRead();
    return (cfg.serverFolder as string) || DEFAULT_SERVER_FOLDER;
  };

  const completeSetupIfReady = async (targetFolder: string): Promise<boolean> => {
    const result = await api.serverCheckSetupComplete();
    if (!result.complete) return false;

    if (targetFolder) await api.bridgeExtractTo(targetFolder);
    await api.serverPropsWrite({ "enable-command-block": "true" });
    await api.appConfigWrite({
      serverFolder: targetFolder,
      setupComplete: true,
      setupRequiredByInstall: false,
    });
    onSetupComplete();
    return true;
  };

  const waitForSetupComplete = async (targetFolder: string) => {
    setVerifying(true);
    setVerifyMsg("setup.bat の完了を自動確認しています…");
    try {
      for (let index = 0; index < 120; index += 1) {
        if (await completeSetupIfReady(targetFolder)) return;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      setVerifyMsg("まだ完了を確認できません。コマンドプロンプトの処理が終わったら「セットアップ完了を確認」を押してください。");
    } catch (e: any) {
      setVerifyMsg(`自動確認エラー: ${e?.message ?? String(e)}`);
    } finally {
      setVerifying(false);
    }
  };

  const handleResetFolder = async () => {
    setCustomFolder("");
    setManualFolderInput("");
    setManualFolderMode(false);
    setForgeState("idle");
    setSetupState("idle");
    setErrorMsg("");
    setVerifyMsg("");
    try {
      await api.appConfigWrite({ serverFolder: "" });
    } catch {
      /* 表示リセットは先に行う */
    }
  };

  const handleOpenFolder = async () => {
    setErrorMsg("");
    try {
      const targetFolder = await resolveTargetFolder();
      if (!targetFolder) throw new Error("サーバーフォルダが設定されていません。");
      await api.folderOpen(targetFolder);
    } catch (e: any) {
      setErrorMsg(`フォルダを開けませんでした: ${e?.message ?? String(e)}`);
    }
  };

  // テンプレコピー（JDK一式で数千ファイル）は数十秒かかることがある。進捗をポーリングして表示する。
  const runCopyTemplateWithProgress = async (targetFolder: string) => {
    setCopyProgress({ copied: 0, total: 0 });
    const poll = api.serverCopyTemplateStatus
      ? setInterval(() => {
          api.serverCopyTemplateStatus()
            .then((s: { copied?: number; total?: number }) => setCopyProgress({ copied: s.copied || 0, total: s.total || 0 }))
            .catch(() => {});
        }, 400)
      : null;
    try {
      await api.serverCopyTemplate(targetFolder);
    } finally {
      if (poll) clearInterval(poll);
      setCopyProgress(null);
    }
  };

  const handleForgeInstall = async () => {
    setForgeState("launching");
    setErrorMsg("");
    try {
      const targetFolder = await resolveTargetFolder();
      if (!targetFolder) throw new Error("セットアップ先フォルダが設定されていません。フォルダを選択してください。");
      await api.appConfigWrite({ serverFolder: targetFolder });
      await runCopyTemplateWithProgress(targetFolder);
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
      await runCopyTemplateWithProgress(targetFolder);
      await api.serverSetupAtPath(targetFolder);
      setSetupState("launched");
      void waitForSetupComplete(targetFolder);
    } catch (e: any) {
      setSetupState("error");
      setErrorMsg(`エラー: ${e?.message ?? String(e)}`);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyMsg("");
    try {
      const targetFolder = await resolveTargetFolder();
      if (!await completeSetupIfReady(targetFolder)) {
        setVerifyMsg("セットアップがまだ完了していません。コマンドプロンプトの処理が終わるまでお待ちください。");
      }
    } catch (e: any) {
      setVerifyMsg(`確認エラー: ${e?.message ?? String(e)}`);
    } finally {
      setVerifying(false);
    }
  };

  const handleUseExistingSetup = async () => {
    setUsingExisting(true);
    setErrorMsg("");
    setVerifyMsg("");

    try {
      let targetFolder = await resolveTargetFolder();

      if (!targetFolder) {
        const picked = await api.dialogPickFolder("セットアップ済みのMinecraftサーバーフォルダを選択");
        if (picked.canceled || !picked.path) {
          setVerifyMsg("既存のサーバーフォルダを選択すると、ほかのページを開放できます。");
          return;
        }
        targetFolder = picked.path;
        setCustomFolder(targetFolder);
      }

      await api.appConfigWrite({
        serverFolder: targetFolder,
        setupComplete: true,
        setupRequiredByInstall: false,
      });

      void api.bridgeExtractTo(targetFolder).catch((error: unknown) => {
        console.warn("既存セットアップへのBridge同期に失敗しました", error);
      });
      onSetupComplete();
    } catch (e: any) {
      setErrorMsg(`既存セットアップの引き継ぎに失敗しました: ${e?.message ?? String(e)}`);
    } finally {
      setUsingExisting(false);
    }
  };

  const handleChooseCompletedFolder = async () => {
    setErrorMsg("");
    try {
      const picked = await api.dialogPickFolder("使用するMinecraftサーバーフォルダを選択");
      if (picked.canceled || !picked.path) return;
      await saveServerFolder(picked.path);
      await api.bridgeExtractTo(picked.path).catch(() => ({ ok: false }));
      setVerifyMsg("サーバーフォルダを設定しました。");
    } catch (e: any) {
      setErrorMsg(`サーバーフォルダの設定に失敗しました: ${e?.message ?? String(e)}`);
    }
  };

  if (setupComplete) {
    return (
      <div className="setup-page setup-complete-page setup-complete-v2 page-surface max-w-none">
        <section className="setup-complete-hero-v2 setup-complete-hero-v2--image">
          <img
            src={setupCompleteHeroImage}
            alt="セットアップ完了済みです。Forge、Bridge、Minecraft、TikTok の準備が完了したMinecraft風の完了ビジュアル"
            className="setup-complete-hero-image-v2"
          />
        </section>

        <div className="setup-complete-grid-v2">
          <section className="setup-info-panel-v2">
            <h2>サーバーフォルダ</h2>
            <div className="setup-folder-row-v2">
              <code>{customFolder || DEFAULT_SERVER_FOLDER}</code>
              <button type="button" onClick={handleChooseCompletedFolder}>📁 フォルダを選択</button>
              <button type="button" onClick={handleOpenFolder}>📁 フォルダを開く</button>
            </div>
            <p>設定ファイルやログはこのフォルダに保存されます。</p>
            <div className="setup-server-meta-v2">
              <span>▣ <small>サーバー状態</small><b>セットアップ完了</b></span>
              <span>◷ <small>最終更新</small><b>この端末</b></span>
              <span>◉ <small>ログサイズ</small><b>準備OK</b></span>
            </div>
          </section>

          <section className="setup-info-panel-v2 setup-environment-v2">
            <h2>検出された環境</h2>
            {envInfo ? (
              [
                ["Forge", envInfo.forge],
                ["Minecraft", envInfo.minecraft],
                ["Java", envInfo.java],
                ["Bridge", envInfo.bridge],
                ["DoumaMod", envInfo.doumaMod],
                ["TikTok API", envInfo.tiktokApi],
              ].map(([label, info], index) => (
                <div className="setup-env-row-v2" key={label as string}>
                  <span className={`setup-env-dot-v2 setup-env-dot-v2--${(info as { detected: boolean }).detected ? index : 0}`} />
                  <b>{label as string}</b><em>{(info as { version: string }).version}</em>
                  <i>{(info as { detected: boolean }).detected ? "✓" : "✗"}</i>
                </div>
              ))
            ) : (
              <p>環境を確認しています…</p>
            )}
          </section>
        </div>

        {errorMsg && (
          <div className="setup-error-v2">
            ❌ {errorMsg}
          </div>
        )}
        {verifyMsg && (
          <div className="setup-verify-note-v2">
            ✅ {verifyMsg}
          </div>
        )}

        <div className="setup-complete-actions-v2">
          <button type="button" onClick={onSetupComplete} className="setup-dashboard-button-v2">
            <span>🚀</span>
            <div><b>ダッシュボードへ戻る</b><small>サーバーを起動して配信を開始しましょう！</small></div>
          </button>
          <button type="button" onClick={onResetSetup} className="setup-reset-button-v2">
            <span>↻</span>
            <div><b>セットアップをやり直す</b><small>最初から設定をやり直します</small></div>
          </button>
        </div>

        <div className="setup-ready-banner-v2">
          <span>⬡</span>
          <div><b>すべての準備が整いました！</b><small>ダッシュボードからいつでもサーバーの起動・監視が可能です。素敵な配信をお楽しみください！</small></div>
          <em>💎</em>
        </div>
      </div>
    );
  }

  const busy = forgeState === "launching" || setupState === "running";
  const folderDisplay = customFolder;

  return (
    <div className="setup-page setup-first-page setup-first-v2 page-surface max-w-none">
      <div className="setup-first-top-v2">
        <div className="setup-first-copy-v2">
          <h1>初期セットアップ</h1>
          <p>
            MC TikTok Bridge を初めて使う場合に実行します。
            <span> 初回のみ </span>必要です。
          </p>
          <button
            type="button"
            onClick={handleUseExistingSetup}
            disabled={usingExisting}
            className="setup-existing-button-v2"
          >
            {usingExisting ? "確認しています…" : "✓ もうすでにセットアップ済みです"}
          </button>
        </div>
        <ConstructionScene />
      </div>

      <section className="setup-warning-v2">
        <strong>⚠ 注意事項</strong>
        <ul>
          <li>セットアップには数分かかります。</li>
          <li>Minecraft EULA に自動で同意します。セットアップ実行をもって同意とみなします。</li>
          <li>既存のサーバーが起動中の場合は先に停止してください。</li>
        </ul>
      </section>

      <section className="setup-folder-panel-v2">
        <div className="setup-folder-label-v2">▱ セットアップ先フォルダ</div>
        <div className="setup-folder-input-v2">
          <input readOnly value={folderDisplay} placeholder="フォルダを選択してください" />
          <button type="button" onClick={handlePickFolder} disabled={busy}>📁 フォルダを選択</button>
          {customFolder && !busy && (
            <button
              type="button"
              onClick={handleResetFolder}
              className="setup-folder-reset-v2"
            >
              リセット
            </button>
          )}
        </div>
        {manualFolderMode && (
          <div className="setup-manual-folder-v2">
            <label>
              <span>開発ブラウザ用：セットアップ先パスを手入力</span>
              <input
                value={manualFolderInput}
                onChange={(event) => setManualFolderInput(event.currentTarget.value)}
                placeholder="例: D:\新しいフォルダー (2)"
                disabled={busy}
              />
            </label>
            <button type="button" onClick={handleApplyManualFolder} disabled={busy}>
              このフォルダを使う
            </button>
          </div>
        )}
        <p>変更しない場合はデフォルトフォルダ（{DEFAULT_SERVER_FOLDER}）で実行されます。</p>
      </section>

      <section className="setup-step-card-v2 setup-step-card-v2--forge">
        <div className="setup-step-number-v2">1</div>
        <ForgeAnvilArt />
        <div className="setup-step-main-v2">
          <div className="setup-step-title-v2">
            <h2>Forge をインストールする（プレイ用）</h2>
            <span>必須</span>
          </div>
          <p>自分の Minecraft に Forge クライアントをインストールします。画面が表示されたら「Install client」を選択して OK を押してください。</p>
          <button
            type="button"
            onClick={handleForgeInstall}
            disabled={forgeState === "launching"}
            className="setup-step-button-v2 setup-step-button-v2--forge"
          >
            {forgeState === "launching"
              ? "⏳ 起動中..."
              : forgeState === "launched"
              ? "✅ 起動済み（再度起動できます）"
              : "↓ Forge をインストールする"}
          </button>
        </div>
        <div className="setup-step-meta-v2">
          <dl><dt>内容</dt><dd>Forge クライアントのインストール</dd></dl>
          <dl><dt>使用するもの</dt><dd>forge_install.bat</dd></dl>
          <dl><dt>所要時間（目安）</dt><dd>約 1〜3 分</dd></dl>
          <dl><dt>状態</dt><dd className={forgeState === "launched" ? "is-done" : ""}>{forgeState === "launched" ? "起動済み" : "未実行"}</dd></dl>
        </div>
      </section>

      <section className="setup-step-card-v2 setup-step-card-v2--env">
        <div className="setup-step-number-v2">2</div>
        <CommandBlockArt />
        <div className="setup-step-main-v2">
          <div className="setup-step-title-v2">
            <h2>環境構築をする</h2>
            <span>必須</span>
          </div>
          <p>サーバー環境・BRIDGE・各種設定ファイルを自動構築します。EULA 同意・RCON 設定・server.properties 設定も含みます。</p>
          <button
            type="button"
            onClick={handleSetup}
            disabled={setupState === "running" || setupState === "launched"}
            className="setup-step-button-v2 setup-step-button-v2--env"
          >
            {setupState === "running"
              ? "⏳ 起動中..."
              : setupState === "launched"
              ? "✅ setup.bat 起動済み"
              : "⚙ 環境構築をする"}
          </button>
        </div>
        <div className="setup-step-meta-v2">
          <dl><dt>内容</dt><dd>環境構築・設定ファイル生成</dd></dl>
          <dl><dt>使用するもの</dt><dd>setup.bat</dd></dl>
          <dl><dt>所要時間（目安）</dt><dd>約 2〜5 分</dd></dl>
          <dl><dt>状態</dt><dd className={setupState === "launched" ? "is-done" : ""}>{setupState === "launched" ? "起動済み" : "未実行"}</dd></dl>
        </div>
      </section>

      {copyProgress && (
        <section className="setup-copy-progress-v2">
          <p>
            サーバーテンプレートをコピー中…
            {copyProgress.total > 0 ? ` ${copyProgress.copied} / ${copyProgress.total} ファイル` : ""}
          </p>
          {copyProgress.total > 0 && (
            <div className="setup-copy-progress-bar-v2">
              <div
                className="setup-copy-progress-bar-fill-v2"
                style={{ width: `${Math.min(100, Math.round((copyProgress.copied / copyProgress.total) * 100))}%` }}
              />
            </div>
          )}
        </section>
      )}

      {errorMsg && <div className="setup-error-v2">❌ {errorMsg}</div>}

      {(setupState === "running" || setupState === "launched") && (
        <section className="setup-guide-overlay-v2">
          <strong>setup.bat コンソールでの操作手順</strong>
          <ol>
            <li>新しく開いたコンソールウィンドウで setup.bat の進行を待ちます。</li>
            <li>server.properties 生成のためサーバーが一度起動します。起動が確認できたら、そのサーバーウィンドウを閉じてください。</li>
            <li>コンソールに戻り、任意のキーを押して処理を続行します。</li>
            <li>「完了」と表示されたら、このアプリが自動でダッシュボードへ遷移します（反映まで数秒かかる場合があります）。</li>
          </ol>
        </section>
      )}

      {setupState === "launched" && (
        <section className="setup-verify-panel-v2">
          <p>{verifying ? "処理完了を自動確認しています。コマンドプロンプトを閉じずにお待ちください。" : "コマンドプロンプトでの処理が終わったら、完了を確認してください。"}</p>
          <button type="button" onClick={handleVerify} disabled={verifying}>
            {verifying ? "⏳ 確認中…" : "✅ セットアップ完了を確認"}
          </button>
          {verifyMsg && <div>⚠️ {verifyMsg}</div>}
        </section>
      )}

      <section className="setup-flow-panel-v2">
        <div className="setup-flow-copy-v2">
          <span>ⓘ</span>
          <p>① forge_install.bat → ② <b>setup.bat</b> の順で実行されます。<br />セットアップ完了後はダッシュボードからサーバーを起動できます。</p>
        </div>
        <FlowBlocks />
      </section>
    </div>
  );
};

export default InitialSetupPage;
