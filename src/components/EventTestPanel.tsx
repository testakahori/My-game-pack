import React, { useEffect, useState } from 'react';
import { useUnsavedGuard } from '../UnsavedChanges';
import { commandOptionLabel } from '../lib/commandLabel';
import { stepLines, type FiredRow, type TestStep } from '../lib/testResult';

const EVENTS = [
  ['gift', '🎁 ギフト（コマンド直接）'], ['mapped_gift', '🎁 設定済みギフト'], ['unmapped_gift', '🎁 未設定ギフト'],
  ['like', '♥ いいね'], ['comment', '💬 コメント'], ['death', '☠ 死亡'], ['share', '🔗 シェア'],
  ['member', '👋 訪問'], ['follow', '＋ フォロー'], ['roulette', '🎲 ルーレット'],
  ['combo', '⚡ コンボ'], ['like_milestone', '🏁 いいねマイルストーン'], ['follow_milestone', '🏁 フォローマイルストーン'],
  ['comment_command', '⌨ コメントコマンド'], ['poll', '🗳 コメント投票の当選'],
];
type Result = { ok: boolean; message: string; notes?: string[]; preview?: boolean; steps?: TestStep[]; fired?: FiredRow[] };

export default function EventTestPanel({ onTested, bridgeRunning }: { onTested: () => Promise<void>; bridgeRunning: boolean }) {
  const api = window.mygamepack;
  const { hasChanges } = useUnsavedGuard();
  const [type, setType] = useState('gift');
  const [commands, setCommands] = useState<Array<{ name: string; title: string; invalidName?: boolean; invalidReason?: string }>>([]);
  const [mappings, setMappings] = useState<Array<{ giftId: string | number; name?: string }>>([]);
  const [commandFile, setCommandFile] = useState('');
  const [sender, setSender] = useState('テスト視聴者');
  const [giftId, setGiftId] = useState('');
  const [unknownGiftId, setUnknownGiftId] = useState('999999999');
  const [count, setCount] = useState(1);
  const [previousLikes, setPreviousLikes] = useState(0);
  const [likeCount, setLikeCount] = useState(100);
  const [deaths, setDeaths] = useState(1);
  const [followCount, setFollowCount] = useState(1);
  const [comment, setComment] = useState('ありがとう');
  const [pollOption, setPollOption] = useState('1');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.bridgeCommandsList(), api.configRead()]).then(([list, cfg]) => {
      if (cancelled) return;
      setCommands(list); setCommandFile(list[0]?.name || '');
      setMappings(cfg.mappings || []); setGiftId(String(cfg.mappings?.[0]?.giftId || ''));
    }).catch(error => { if (!cancelled) setResult({ ok: false, message: String(error.message || error) }); });
    return () => { cancelled = true; };
  }, [api]);
  const fire = async (preview: boolean) => {
    if (busy || hasChanges || !bridgeRunning) return;
    setBusy(true); setResult(null);
    try {
      setResult(await api.testEvent({ type, preview, listenerName: sender, commandFile,
        giftId: type === 'unmapped_gift' ? unknownGiftId : giftId, count, previousLikes, likeCount, deaths, followCount, comment, pollOption }));
      await onTested();
    } catch (error) { setResult({ ok: false, message: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  };
  return <section className="ops-panel ops-test-card">
    <div className="ops-panel-heading"><span className="ops-panel-icon ops-panel-icon--blue">▣</span><div><h2>オフライン・テストモード</h2><p>保存済みの設定で条件を確認し、TikTok接続なしで発火できます。</p></div></div>
    <fieldset disabled={busy} className="event-test-fields">
      <label className="ops-field"><span>テストするイベント</span><select value={type} onChange={e => { setType(e.target.value); setResult(null); }}>{EVENTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="ops-field"><span>テスト視聴者名・プレイヤー名</span><input value={sender} maxLength={40} onChange={e => setSender(e.target.value)} /></label>
      {type === 'gift' ? <label className="ops-field"><span>コマンドファイル</span><select value={commandFile} onChange={e => setCommandFile(e.target.value)}>{commands.map(c => <option key={c.name} value={c.name}>{commandOptionLabel(c)}（{c.name}）</option>)}</select></label> : null}
      {['mapped_gift', 'combo'].includes(type) ? <label className="ops-field"><span>設定済みギフト</span><select value={giftId} onChange={e => setGiftId(e.target.value)}>{mappings.length ? mappings.map((m, i) => <option key={`${m.giftId}-${i}`} value={String(m.giftId)}>{m.name || m.giftId}（ID: {m.giftId}）</option>) : <option value="">割当がありません</option>}</select></label> : null}
      {type === 'unmapped_gift' ? <label className="ops-field"><span>割当のないギフトID</span><input value={unknownGiftId} onChange={e => setUnknownGiftId(e.target.value)} /></label> : null}
      {['gift', 'mapped_gift', 'combo'].includes(type) ? <label className="ops-field"><span>ギフト数・発火数（1〜100）</span><input type="number" min={1} max={100} value={count} onChange={e => setCount(Number(e.target.value))} /></label> : null}
      {['like', 'like_milestone'].includes(type) ? <div className="ops-two-cols"><label className="ops-field"><span>前回の累計いいね</span><input type="number" min={0} max={1000000} value={previousLikes} onChange={e => setPreviousLikes(Number(e.target.value))} /></label><label className="ops-field"><span>今回の累計いいね</span><input type="number" min={0} max={1000000} value={likeCount} onChange={e => setLikeCount(Number(e.target.value))} /></label></div> : null}
      {['comment', 'comment_command'].includes(type) ? <label className="ops-field"><span>テストするコメント</span><input value={comment} maxLength={500} onChange={e => setComment(e.target.value)} /></label> : null}
      {type === 'death' ? <label className="ops-field"><span>累計死亡回数</span><input type="number" min={1} max={1000000} value={deaths} onChange={e => setDeaths(Number(e.target.value))} /></label> : null}
      {['follow', 'follow_milestone'].includes(type) ? <label className="ops-field"><span>今回で何人目のフォローか</span><input type="number" min={1} max={1000000} value={followCount} onChange={e => setFollowCount(Number(e.target.value))} /></label> : null}
      {type === 'poll' ? <label className="ops-field"><span>当選させる投票番号（例: 1）</span><input value={pollOption} onChange={e => setPollOption(e.target.value)} /></label> : null}
      {['combo', 'like_milestone', 'follow_milestone', 'comment_command'].includes(type) ? <p className="ops-test-note">本番と同じく、元のギフト・いいね・フォロー・コメントの設定も一緒に動きます。</p> : null}
      <div className="ops-action-row"><button type="button" disabled={hasChanges || !bridgeRunning} className="ops-small-button" onClick={() => fire(true)}>条件だけ確認</button><button type="button" disabled={hasChanges || !bridgeRunning} className="ops-primary-button ops-primary-button--cyan" onClick={() => fire(false)}>{busy ? '確認中…' : type === 'gift' ? '🎁 ギフト発火' : type === 'like' ? '♥ いいね発火' : 'テスト発火'}</button></div>
      {!bridgeRunning ? <p className="ops-test-note" role="status">BRIDGE を起動すると試せます。</p> : null}
    </fieldset>
    <p className="ops-test-note">{hasChanges ? '未保存の変更があります。保存してからテストしてください。' : '条件確認・発火には BRIDGE の起動が必要です（本番と同じ処理で試します）。発火には Minecraft サーバーも必要です。実際にコマンドが動きますが、テスト履歴は配信統計に加算しません。'}</p>
    {result ? <div className="event-test-result" role="status"><b className={result.ok ? 'ok' : 'bad'}>{result.message}</b>{result.notes?.map((note, i) => <p key={i}>{note}</p>)}{stepLines(result.steps, result.fired).map((line, i) => <p key={i}>{line}</p>)}</div> : null}
  </section>;
}
