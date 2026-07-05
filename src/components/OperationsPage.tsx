import React, { useCallback, useEffect, useState } from "react";

type ModStatus = {
  online: boolean; gift?: number; like?: number; other?: number;
  executed?: number; failed?: number; lastError?: string; error?: string;
  protectedSkips?: number;
  tps?: number; tickMs?: number; player?: { online: boolean; x: number; y: number; z: number };
};
type HistoryRow = { at: string; type: string; sender: string; commandFile: string; count: number; ok: boolean; message?: string };
type Stats = { total: number; succeeded: number; failed: number;
  topCommands: Array<{name:string;count:number}>; topSenders: Array<{name:string;count:number}> };

const field = "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100";
const card = "rounded-2xl border border-gray-700 bg-gray-900/70 p-5";

export default function OperationsPage() {
  const api = (window as any).mygamepack;
  const [status, setStatus] = useState<ModStatus>({ online: false });
  const [commands, setCommands] = useState<Array<{name:string;title:string}>>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [commandFile, setCommandFile] = useState("");
  const [sender, setSender] = useState("テスト視聴者");
  const [count, setCount] = useState(1);
  const [notice, setNotice] = useState("");
  const [cfg, setCfg] = useState<any>({});
  const [appCfg, setAppCfg] = useState<any>({});
  const [stats, setStats] = useState<Stats>({ total:0, succeeded:0, failed:0, topCommands:[], topSenders:[] });
  const [presets, setPresets] = useState<string[]>([]);
  const [presetName, setPresetName] = useState("配信用");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [gameplayText, setGameplayText] = useState("{}");
  const [updater, setUpdater] = useState<any>({state:"idle"});
  const [bridgeProcess, setBridgeProcess] = useState<any>({running:false,restartCount:0});

  const refresh = useCallback(async () => {
    const [s, h, st, up, bp] = await Promise.all([api.modStatus(), api.operationsHistory(), api.operationsStats(), api.updaterStatus(), api.bridgeProcessStatus()]);
    setStatus(s); setHistory(h); setStats(st); setUpdater(up); setBridgeProcess(bp);
  }, [api]);

  useEffect(() => {
    Promise.all([api.bridgeCommandsList(), api.configRead(), api.appConfigRead(), api.presetsList()]).then(([list, c, a, p]: any[]) => {
      setCommands(list); setCommandFile(list[0]?.name || ""); setCfg(c); setAppCfg(a);
      setGameplayText(JSON.stringify(c?.options?.gameplay || {}, null, 2));
      setPresets(p); setSelectedPreset(p[0] || "");
    });
    refresh();
    const id = window.setInterval(refresh, 2000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const fire = async (type: string) => {
    setNotice("送信中…");
    const r = await api.testEvent({ type, commandFile, count, listenerName: sender });
    setNotice(r.ok ? "テストイベントを送信しました" : `失敗: ${r.message}`);
    await refresh();
  };
  const save = async () => {
    try {
      const gameplay = JSON.parse(gameplayText);
      const next = {...cfg, options:{...(cfg.options||{}), gameplay}};
      const validation = await api.configValidate(next);
      if (!validation.ok) throw new Error(validation.errors.join("\n"));
      await Promise.all([api.configWrite(next), api.appConfigWrite({
        autoBackupOnServerStart: appCfg.autoBackupOnServerStart !== false
      })]);
      setCfg(next);
      setNotice(validation.warnings.length ? `保存しました: ${validation.warnings.join(" / ")}` : "運用設定を保存しました");
    } catch (e:any) { setNotice(`保存失敗: ${e?.message || e}`); }
  };
  const o = cfg.options || {};
  const setOption = (key: string, value: any) => setCfg((v:any) => ({...v, options:{...(v.options||{}), [key]:value}}));
  const backlog = (status.gift||0)+(status.like||0)+(status.other||0);
  const pct = Math.min(100, backlog / 10);

  return <div className="max-w-6xl space-y-5">
    <div className={card}>
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-black">Mod死活監視</h2><p className="text-xs text-gray-400">2秒ごとに /douma/status を確認</p></div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.online?"bg-emerald-500/20 text-emerald-300":"bg-red-500/20 text-red-300"}`}>
          {status.online ? "● サーバー / Mod 正常" : "● 応答なし（サーバー停止・Mod未ロード）"}
        </span>
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-gray-800"><div className={`${backlog>700?"bg-red-500":backlog>300?"bg-amber-400":"bg-cyan-500"} h-full transition-all`} style={{width:`${pct}%`}} /></div>
      <div className="mt-2 flex gap-5 text-xs text-gray-300"><span>Gift {status.gift||0}</span><span>Like {status.like||0}</span><span>Other {status.other||0}</span><span>成功 {status.executed||0}</span><span className="text-red-300">失敗 {status.failed||0}</span></div>
      <div className="mt-1 text-xs text-amber-300">拠点保護による抑止 {status.protectedSkips||0}</div>
      <div className="mt-2 flex gap-5 text-xs text-gray-400"><span>TPS {status.tps?.toFixed?.(1) ?? "—"}</span><span>Tick {status.tickMs?.toFixed?.(1) ?? "—"} ms</span><span>座標 {status.player?.online ? `${status.player.x}, ${status.player.y}, ${status.player.z}` : "未接続"}</span></div>
      <div className="mt-1 text-xs text-gray-400">Bridgeプロセス: {bridgeProcess.running ? `起動中 (PID ${bridgeProcess.pid})` : "停止中"} / 自動復旧 {bridgeProcess.restartCount}回</div>
      {status.lastError && <p className="mt-2 text-xs text-red-300">直近エラー: {status.lastError}</p>}
    </div>

    <div className="grid gap-5 lg:grid-cols-2">
      <div className={card}>
        <h2 className="font-black">オフライン・テストモード</h2>
        <p className="mb-4 text-xs text-gray-400">TikTok接続なしでModへ直接イベントを送ります。</p>
        <div className="space-y-3">
          <select className={field} value={commandFile} onChange={e=>setCommandFile(e.target.value)}>{commands.map(c=><option key={c.name} value={c.name}>{c.title} ({c.name})</option>)}</select>
          <input className={field} value={sender} onChange={e=>setSender(e.target.value)} placeholder="送信者名" />
          <input className={field} type="number" min={1} max={100} value={count} onChange={e=>setCount(Math.max(1,Math.min(100,+e.target.value)))} />
          <div className="grid grid-cols-2 gap-2"><button className="rounded-lg bg-pink-600 py-2 font-bold" onClick={()=>fire("gift")}>🎁 ギフト発火</button><button className="rounded-lg bg-cyan-600 py-2 font-bold" onClick={()=>fire("like")}>♥ いいね発火</button></div>
          {notice && <p className="text-xs text-cyan-300">{notice}</p>}
        </div>
      </div>
      <div className={card}>
        <h2 className="font-black">安定運用・荒らし対策</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <label>ギフト間隔(ms)<input className={field} type="number" value={o.giftCooldownMs??300} onChange={e=>setOption("giftCooldownMs",+e.target.value)}/></label>
          <label>いいね追いつき上限<input className={field} type="number" value={o.maxLikeCatchUpPerEvent??5} onChange={e=>setOption("maxLikeCatchUpPerEvent",+e.target.value)}/></label>
          <label>いいねバッチ(ms)<input className={field} type="number" value={o.likeBatchWindowMs??1200} onChange={e=>setOption("likeBatchWindowMs",+e.target.value)}/></label>
          <label>個別最大コマンド数<input className={field} type="number" value={o.maxCommandsPerGift??200} onChange={e=>setOption("maxCommandsPerGift",+e.target.value)}/></label>
          <label className="col-span-2">ミュートユーザー（カンマ区切り）<input className={field} value={(o.mutedUsers||[]).join(", ")} onChange={e=>setOption("mutedUsers",e.target.value.split(",").map(x=>x.trim()).filter(Boolean))}/></label>
          <label className="col-span-2">TTS NGワード（カンマ区切り）<input className={field} value={(o.ttsNgWords||[]).join(", ")} onChange={e=>setOption("ttsNgWords",e.target.value.split(",").map(x=>x.trim()).filter(Boolean))}/></label>
          <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={appCfg.autoBackupOnServerStart !== false} onChange={e=>setAppCfg((v:any)=>({...v,autoBackupOnServerStart:e.target.checked}))}/>サーバー起動前にワールドを自動バックアップ</label>
          <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={o.protection?.enabled===true} onChange={e=>setOption("protection",{...(o.protection||{}),enabled:e.target.checked})}/>拠点保護エリア内ではTNT・マグマ・落とし穴を抑止</label>
          <label>保護 X1<input className={field} type="number" value={o.protection?.x1??-20} onChange={e=>setOption("protection",{...(o.protection||{}),x1:+e.target.value})}/></label>
          <label>保護 X2<input className={field} type="number" value={o.protection?.x2??20} onChange={e=>setOption("protection",{...(o.protection||{}),x2:+e.target.value})}/></label>
          <label>保護 Z1<input className={field} type="number" value={o.protection?.z1??-20} onChange={e=>setOption("protection",{...(o.protection||{}),z1:+e.target.value})}/></label>
          <label>保護 Z2<input className={field} type="number" value={o.protection?.z2??20} onChange={e=>setOption("protection",{...(o.protection||{}),z2:+e.target.value})}/></label>
        </div>
        <div className="mt-3 flex gap-2"><button className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold" onClick={save}>保存</button><button className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-bold" onClick={async()=>{const r=await api.worldBackup();setNotice(r.message);}}>ワールドを今すぐバックアップ</button></div>
      </div>
    </div>

    <div className="grid gap-5 lg:grid-cols-2">
      <div className={card}>
        <h2 className="font-black">演出・ゲーム性設定</h2>
        <p className="mb-2 text-xs text-gray-400">コンボ、マイルストーン、コメントコマンド、時限モード、投票をJSONで設定します。</p>
        <textarea className={`${field} h-72 font-mono text-xs`} value={gameplayText} onChange={e=>setGameplayText(e.target.value)} />
      </div>
      <div className={`${card} space-y-4`}>
        <div><h2 className="font-black">アプリ自動更新</h2><p className="mt-1 text-xs text-gray-400">状態: {updater.state} {updater.version ? `v${updater.version}` : ""} {updater.percent ? `${updater.percent}%` : ""}</p>
          {updater.error && <p className="text-xs text-red-300">{updater.error}</p>}
          <div className="mt-2 flex gap-2"><button className="rounded-lg bg-gray-700 px-3 py-2 text-xs" onClick={async()=>setUpdater(await api.updaterCheck())}>更新を確認</button>{updater.state==="ready"&&<button className="rounded-lg bg-emerald-700 px-3 py-2 text-xs" onClick={()=>api.updaterInstall()}>再起動して適用</button>}</div>
        </div>
        <div><h2 className="font-black">設定プリセット</h2>
          <div className="mt-2 flex gap-2"><input className={field} value={presetName} onChange={e=>setPresetName(e.target.value)}/><button className="shrink-0 rounded-lg bg-cyan-700 px-3 text-sm" onClick={async()=>{await api.presetsSave(presetName);const p=await api.presetsList();setPresets(p);setNotice("プリセットを保存しました");}}>保存</button></div>
          <div className="mt-2 flex gap-2"><select className={field} value={selectedPreset} onChange={e=>setSelectedPreset(e.target.value)}>{presets.map(p=><option key={p}>{p}</option>)}</select><button className="shrink-0 rounded-lg bg-violet-700 px-3 text-sm" disabled={!selectedPreset} onClick={async()=>{const r=await api.presetsLoad(selectedPreset);setCfg(r.config);setGameplayText(JSON.stringify(r.config?.options?.gameplay||{},null,2));setNotice("プリセットを適用しました");}}>適用</button></div>
        </div>
        <div><h2 className="font-black">配信統計</h2><div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-lg bg-gray-950 p-3">総数<br/><b className="text-lg">{stats.total}</b></div><div className="rounded-lg bg-gray-950 p-3">成功<br/><b className="text-lg text-emerald-300">{stats.succeeded}</b></div><div className="rounded-lg bg-gray-950 p-3">失敗<br/><b className="text-lg text-red-300">{stats.failed}</b></div></div>
          <p className="mt-3 text-xs text-gray-400">最多ギフト: {stats.topCommands[0]?.name || "—"} ({stats.topCommands[0]?.count || 0})</p>
          <p className="text-xs text-gray-400">トップギフター: {stats.topSenders[0]?.name || "—"} ({stats.topSenders[0]?.count || 0})</p>
        </div>
      </div>
    </div>

    <div className={card}><div className="flex justify-between"><h2 className="font-black">イベント履歴</h2><button className="text-xs text-gray-400" onClick={async()=>{await api.operationsHistoryClear();refresh();}}>履歴を消去</button></div>
      <div className="mt-3 max-h-72 overflow-auto"><table className="w-full text-left text-xs"><thead className="text-gray-500"><tr><th>時刻</th><th>種別</th><th>送信者</th><th>発動</th><th>回数</th><th>結果</th></tr></thead><tbody>{history.map((h,i)=><tr key={i} className="border-t border-gray-800"><td className="py-2">{new Date(h.at).toLocaleString("ja-JP")}</td><td>{h.type}</td><td>{h.sender}</td><td>{h.commandFile}</td><td>{h.count}</td><td className={h.ok?"text-emerald-300":"text-red-300"}>{h.ok?"成功":h.message||"失敗"}</td></tr>)}</tbody></table></div>
    </div>
  </div>;
}
