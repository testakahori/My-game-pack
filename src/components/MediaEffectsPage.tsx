import React, { useEffect, useState } from 'react';
import { useMediaEffects, type MediaRule, type MediaAsset } from '../mediaEffects';
import { useUnsavedChanges } from '../UnsavedChanges';
import type { Gift } from '../types/electron';
import '../media-effects.css';

const templates: Record<string, { x: number; y: number; width: number; volume: number }> = {
  chat: { x: 78, y: 72, width: 30, volume: 100 }, minecraft: { x: 20, y: 25, width: 28, volume: 85 }, sing: { x: 50, y: 78, width: 32, volume: 60 },
};
function newRule(profile: string, assets: MediaAsset[]): MediaRule {
  return { id: crypto.randomUUID(), name: '100いいねありがとう', enabled: true, trigger: 'likes', threshold: 100, giftId: '', coinMode: 'unit',
    visualId: assets.find(a => a.kind !== 'audio')?.id || '', audioId: '', duration: 5, cooldown: 3, ...templates[profile] };
}
export default function MediaEffectsPage() {
  const { state, busy, run, setDirty, discard } = useMediaEffects();
  const [rule, setRule] = useState<MediaRule | null>(null), [baseline, setBaseline] = useState(''), [volume, setVolume] = useState(35);
  const [username, setUsername] = useState('');
  const [gifts, setGifts] = useState<Gift[]>([]), [testType, setTestType] = useState('like'), [testBefore, setTestBefore] = useState(0), [testCount, setTestCount] = useState(100), [testGift, setTestGift] = useState('5655'), [testCoins, setTestCoins] = useState(1), [testRepeat, setTestRepeat] = useState(1), [testResult, setTestResult] = useState('');
  const profile = state?.settings.profiles.find(p => p.id === state.settings.activeProfile);
  const dirty = Boolean(rule && JSON.stringify({ rule, volume }) !== baseline);
  useUnsavedChanges(dirty, busy);
  useEffect(() => { setDirty(dirty); return () => setDirty(false); }, [dirty, setDirty]);
  useEffect(() => {
    if (!profile || !state) return;
    const next = profile.rules.find(saved => saved.id === rule?.id) || profile.rules[0] || newRule(profile.id, state.settings.assets); setRule(next); setVolume(profile.volume); setBaseline(JSON.stringify({ rule: next, volume: profile.volume }));
    // A saved revision/profile change invalidates a draft. Runtime polling does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.revision, discard]);
  useEffect(() => { let active = true; window.mygamepack.configRead().then(config => { if (active) setUsername(String(config.tiktokUsername || '')); }).catch(() => {}); return () => { active = false; }; }, []);
  useEffect(() => { if (state?.connection?.username) setUsername(state.connection.username); }, [state?.connection?.username]);
  useEffect(() => { let active = true; window.mygamepack.giftsRead().then(result => { if (active) setGifts(result.gifts || []); }).catch(() => {}); return () => { active = false; }; }, []);
  if (!state || !profile || !rule) return <p className="p-6">演出の準備中…</p>;
  const assets = state.settings.assets;
  const patch = (value: Partial<MediaRule>) => setRule(current => current ? { ...current, ...value } : current);
  const discardDraft = () => !dirty || window.confirm('編集中の演出設定を破棄して続けますか？');
  const edit = (next: MediaRule) => { if (!discardDraft()) return; setRule({ ...next }); setVolume(profile.volume); setBaseline(JSON.stringify({ rule: next, volume: profile.volume })); };
  const save = async (preview: boolean) => {
    const savedRule = { ...rule, name: rule.name.trim() };
    const profiles = state.settings.profiles.map(p => p.id !== profile.id ? p : { ...p, volume, rules: [...p.rules.filter(r => r.id !== savedRule.id), savedRule] });
    await run(async () => { await window.mygamepack.effectsSave({ ...state.settings, profiles }, state.revision); if (preview) await window.mygamepack.effectsTest({ ruleId: savedRule.id }); }, preview ? '演出を保存しました。確認用ウィンドウで再生します。' : '演出を保存しました。');
  };
  const switchProfile = (id: string) => { if (id !== profile.id && discardDraft()) void run(() => window.mygamepack.effectsSave({ ...state.settings, activeProfile: id }, state.revision), 'プロフィールを切り替えました。前の演出は停止しました。'); };
  const removeRule = (id: string) => { if (discardDraft()) void run(() => window.mygamepack.effectsSave({ ...state.settings, profiles: state.settings.profiles.map(p => p.id === profile.id ? { ...p, rules: p.rules.filter(r => r.id !== id) } : p) }, state.revision), '演出を削除しました。「元に戻す」で復元できます。'); };
  const test = () => void run(async () => {
    const event = testType === 'like' ? { type: 'like', previousLikes: testBefore, total: testCount } : { type: 'gift', giftId: testGift, unitCoins: testCoins, delta: testRepeat, previousCoins: 0, totalCoins: testCoins * testRepeat };
    const result = await window.mygamepack.effectsTest({ event });
    setTestResult('matched' in result && result.matched.length ? `発火: ${result.matched.join(' / ')}` : '該当する有効な演出がありません。保存した条件を確認してください。');
  });
  return <div className="media-page">
    <div className="media-page-heading"><div><p className="media-eyebrow">STREAM EFFECTS</p><h1>配信演出</h1><p>BOOTHなどで入手した素材を登録。いいねやギフトに合わせて、画面と音でありがとう。</p></div><div className="media-profile" aria-label="配信プロフィール">{state.settings.profiles.map(p => <button type="button" key={p.id} aria-pressed={p.id === profile.id} disabled={busy} onClick={() => switchProfile(p.id)}>{p.name}</button>)}</div></div>
    <div className="media-connection"><label>TikTokアカウント<input value={username} placeholder="@ユーザー名" maxLength={65} onChange={e => setUsername(e.target.value)} disabled={busy || state.connection?.state === 'connected' || state.connection?.mode === 'game'} /></label><button type="button" disabled={busy || state.connection?.mode === 'game' || ['connected', 'connecting', 'retrying'].includes(state.connection?.state || '')} onClick={() => void run(() => window.mygamepack.effectsConnect(username), '演出用の接続を開始しました。配信中のアカウントへ接続します。')}>TikTokに接続</button><button type="button" disabled={busy || !state.connection || state.connection.mode === 'game' || state.connection.state === 'stopped'} onClick={() => void run(() => window.mygamepack.effectsDisconnect(), '演出用の接続を停止しました。')}>接続を停止</button><span role="status">{state.connection?.mode === 'game' ? 'ゲーム用Bridgeを使用 · ' : ''}{({ stopped: '未接続', connecting: '接続中…', connected: '配信に接続済み', retrying: '配信開始・接続を待っています（30秒ごとに再試行）', error: '接続を開始できませんでした。もう一度お試しください。' } as Record<string,string>)[state.connection?.state || 'stopped'] || state.connection?.state}</span></div>
    <ol className="media-steps"><li><b>1</b> 素材を登録</li><li><b>2</b> 条件を選んで試す</li><li><b>3</b> OBSに追加</li></ol>
    <div className="media-columns">
      <section className="media-card"><div className="media-section-heading"><h2>1. ローカル素材</h2><button type="button" className="media-primary" disabled={busy || dirty} onClick={() => void run(() => window.mygamepack.effectsImport(), '素材を登録しました。素材の「試す」から再生できます。')}>＋ 素材を登録</button></div>
        <p className="media-hint">PNG・JPEG・GIF・WebP / MP3・WAV・OGG・M4A / MP4・WebM<br />元のファイルをアプリへコピーします。1件300MBまで。</p>
        {dirty && <p className="media-hint">追加登録する前に、編集中の設定を保存するか元に戻してください。</p>}
        {!assets.length ? <div className="media-empty">最初の画像、声、BGM、動画を選んでください。<small>購入・ポイント登録は不要です。</small></div> : <ul className="media-assets">{assets.map(a => <li key={a.id}><span className="media-kind">{a.kind === 'image' ? '画像' : a.kind === 'audio' ? '音声' : '動画'}</span><span className="media-asset-name" title={a.name}>{a.name}<small>{(a.size / 1024 / 1024).toFixed(1)} MB</small></span><button type="button" disabled={busy} onClick={() => void run(() => window.mygamepack.effectsTest({ assetId: a.id }), '10秒間の素材テストを開始しました。')}>試す</button><button type="button" disabled={busy} onClick={() => { patch(a.kind === 'audio' ? { audioId: a.id } : { visualId: a.id }); }}>使う</button></li>)}</ul>}
      </section>
      <section className="media-card"><div className="media-section-heading"><h2>2. 条件と見せ方</h2><button type="button" disabled={busy} onClick={() => edit(newRule(profile.id, assets))}>新しい演出</button></div>
        <div className="media-form">
          <label className="media-wide">演出名<input value={rule.name} maxLength={80} onChange={e => patch({ name: e.target.value })} /></label>
          <label>きっかけ<select value={rule.trigger} onChange={e => patch({ trigger: e.target.value as MediaRule['trigger'] })}><option value="likes">いいね</option><option value="gift">指定ギフト</option><option value="coins">ギフトのコイン数</option></select></label>
          {rule.trigger !== 'gift' ? <label>{rule.trigger === 'likes' ? '何いいねごと？' : '何コイン以上？'}<input type="number" min="1" max="10000000" value={rule.threshold} onChange={e => patch({ threshold: Number(e.target.value) })} /></label> : <label>ギフト<select value={rule.giftId} onChange={e => patch({ giftId: e.target.value })}><option value="">選んでください</option>{gifts.map(g => <option key={g.id} value={String(g.id)}>{g.name}（{g.diamond_count}コイン）</option>)}{rule.giftId && !gifts.some(g => String(g.id) === rule.giftId) && <option value={rule.giftId}>ID {rule.giftId}</option>}</select></label>}
          {rule.trigger === 'gift' && <label className="media-wide">ギフトIDで指定<input inputMode="numeric" value={rule.giftId} maxLength={20} onChange={e => patch({ giftId: e.target.value.replace(/\D/g, '') })} /></label>}
          {rule.trigger === 'coins' && <label className="media-wide">コイン数の判定<select value={rule.coinMode} onChange={e => patch({ coinMode: e.target.value as 'unit' | 'streak' })}><option value="unit">ギフト1個のコイン数</option><option value="streak">連続ギフトの合計が到達したとき</option></select><small>円ではなくTikTokのコイン数です。</small></label>}
          <label>画像・動画<select value={rule.visualId} onChange={e => patch({ visualId: e.target.value })}><option value="">なし</option>{assets.filter(a => a.kind !== 'audio').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>声・BGM<select value={rule.audioId} onChange={e => patch({ audioId: e.target.value })}><option value="">なし</option>{assets.filter(a => a.kind === 'audio').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>位置・音量テンプレート<select value="" onChange={e => { if (e.target.value) patch(templates[e.target.value]); }}><option value="">テンプレートを適用…</option><option value="chat">雑談：右下・音量100%</option><option value="minecraft">マイクラ：左上・音量85%</option><option value="sing">歌：下中央・音量60%</option></select></label>
          <label>表示・再生の上限（秒）<input type="number" min="1" max="600" value={rule.duration} onChange={e => patch({ duration: Number(e.target.value) })} /><small>音声・動画は終了またはこの秒数で停止</small></label>
          <details className="media-wide media-details"><summary>表示位置・サイズ・音量を調整</summary><div className="media-form">
          <div className="media-position media-wide" aria-label="表示位置の見取り図"><div style={{ left: `${rule.x}%`, top: `${rule.y}%`, width: `${rule.width}%` }}>演出</div><small>1920 × 1080</small></div>
          <label>横位置 {rule.x}%<input type="range" min="0" max="100" value={rule.x} onChange={e => patch({ x: Number(e.target.value) })} /></label>
          <label>縦位置 {rule.y}%<input type="range" min="0" max="100" value={rule.y} onChange={e => patch({ y: Number(e.target.value) })} /></label>
          <label>表示幅 {rule.width}%<input type="range" min="5" max="100" value={rule.width} onChange={e => patch({ width: Number(e.target.value) })} /></label>
          <label>演出音量 {rule.volume}%<input type="range" min="0" max="100" value={rule.volume} onChange={e => patch({ volume: Number(e.target.value) })} /></label>
          <label>プロフィール音量 {volume}%<input type="range" min="0" max="100" value={volume} onChange={e => setVolume(Number(e.target.value))} /><small>実際の音量：演出音量 × プロフィール音量</small></label>
          <label>連続発火の間隔（秒）<input type="number" min="0" max="600" value={rule.cooldown} onChange={e => patch({ cooldown: Number(e.target.value) })} /></label>
          </div></details>
          <label className="media-checkbox media-wide"><input type="checkbox" checked={rule.enabled} onChange={e => patch({ enabled: e.target.checked })} /> イベントで自動再生する</label>
        </div>
        <div className="media-actions"><button type="button" className="media-primary" disabled={busy || !assets.length || (!rule.visualId && !rule.audioId)} onClick={() => void save(true)}>保存して試す</button><button type="button" disabled={busy || !assets.length || (!rule.visualId && !rule.audioId)} onClick={() => void save(false)}>保存</button></div>
        <p className="media-hint">自動再生は上の「TikTokに接続」から開始できます。ゲーム用Bridgeの起動中はそちらを使います。接続前の累積いいねは発火しません。</p>
      </section>
    </div>
    <section className="media-card"><div className="media-section-heading"><h2>{profile.name}の演出 · {profile.rules.length}件</h2><span>待機 {state.queued}件</span></div>
      {!profile.rules.length ? <p className="media-hint">条件と素材を選び「保存して試す」で最初の演出を作れます。</p> : <ul className="media-rules">{profile.rules.map(r => <li key={r.id}><div><b>{r.name}</b><small>{r.enabled ? '有効' : '停止'} · {r.trigger === 'likes' ? `${r.threshold}いいねごと` : r.trigger === 'gift' ? `ギフト ${gifts.find(g => String(g.id) === r.giftId)?.name || r.giftId}` : `${r.threshold}コイン以上（${r.coinMode === 'unit' ? '1個' : '連続合計'}）`} · {r.duration}秒</small></div><button type="button" disabled={busy} onClick={() => void run(() => window.mygamepack.effectsTest({ ruleId: r.id }))}>試す</button><button type="button" disabled={busy} onClick={() => edit(r)}>編集</button><button type="button" disabled={busy} onClick={() => removeRule(r.id)}>削除</button></li>)}</ul>}
    </section>
    <section className="media-card"><h2>条件を発火テスト</h2><p className="media-hint">保存済みの条件を確認用プレビューで再生します。本番のいいね数・待ち行列・統計には加算しません。</p>
      <div className="media-test-fields"><label>種類<select value={testType} onChange={e => setTestType(e.target.value)}><option value="like">いいね</option><option value="gift">ギフト / コイン条件</option></select></label>
        {testType === 'like' ? <><label>変更前<input type="number" min="0" value={testBefore} onChange={e => setTestBefore(Number(e.target.value))} /></label><label>変更後<input type="number" min="0" value={testCount} onChange={e => setTestCount(Number(e.target.value))} /></label></> : <><label>ギフトID<input value={testGift} onChange={e => setTestGift(e.target.value)} /></label><label>1個のコイン数<input type="number" min="0" value={testCoins} onChange={e => setTestCoins(Number(e.target.value))} /></label><label>連続個数<input type="number" min="1" value={testRepeat} onChange={e => setTestRepeat(Number(e.target.value))} /></label></>}
        <button type="button" disabled={busy} onClick={test}>条件を試す</button></div>{testResult && <p role="status" className="media-notice">{testResult}</p>}
    </section>
    <section className="media-card"><h2>3. OBSへ追加・録画／配信前の確認</h2><div className="media-output-guide"><div><p>OBSの「ソース → ＋ → ブラウザ」で、下のボタンからコピーしたURLを貼り付けます。幅 <b>1920</b>・高さ <b>1080</b> に設定してください。</p><p className="media-hint">「OBSで音声を制御する」を有効にし、ミキサーと短い試し録画で実際の音を確認します。同じURLを複数ソースで開くと音が重なります。</p><div className="media-actions"><button type="button" disabled={busy} className="media-primary" onClick={() => void run(() => window.mygamepack.effectsCopyUrl(), 'OBS用URLをコピーしました。')}>OBS用URLをコピー</button><button type="button" disabled={busy} onClick={() => void run(() => window.mygamepack.effectsPreview())}>プレビューを開く</button></div></div><div className="media-checks"><b>映像・音声の準備確認</b><p>確認用ウィンドウで動くバーと短い音を試します。</p><button type="button" disabled={busy} onClick={() => void run(() => window.mygamepack.effectsTest({ calibration: true }))}>映像・音声を試験</button><div className="media-actions"><button type="button" disabled={busy || !state.previewClients || !state.calibrated || state.paused} onClick={() => void run(() => window.mygamepack.effectsConfirm('visual'))}>{state.checks.visual ? '✓ 映像確認済み' : '映像が見えた'}</button><button type="button" disabled={busy || !state.previewClients || !state.calibrated || state.paused || state.muted} onClick={() => void run(() => window.mygamepack.effectsConfirm('audio'))}>{state.checks.audio ? '✓ 音声確認済み' : '音が聞こえた'}</button></div><small>確認記録は起動・設定変更ごとにリセットします。</small></div></div>
      {state.liveClients > 1 && <p className="media-error">OBS出力が{state.liveClients}か所で開かれています。音声が重ならないよう確認してください。</p>}
      <p className="media-hint">確認用プレビューはOBSとは別出力です。上の停止ボタンは両方に効きます。音声停止は解除するまで新しい演出にも適用され、一時停止中のイベントはため込みません。演出設定の「元に戻す」はこの起動中の直近20回が対象です。</p>
    </section>
  </div>;
}
