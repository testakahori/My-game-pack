import React from 'react';

type State = 'pending' | 'active' | 'done' | 'error' | 'manual';
const LABELS: Record<State, string> = { pending: '待機中', active: '処理中', done: '完了', error: '確認が必要', manual: '自分で確認' };

export default function LaunchGuide({ server, bridge, gameRunning, live, world }: {
  server: State; bridge: State; gameRunning: boolean; live: boolean; world: string;
}) {
  const steps: Array<{ title: string; description: string; state: State }> = [
    { title: 'TIKTOK LIVE STUDIO でライブ接続', description: '接続済みなら「一括起動」へ進めます', state: 'manual' },
    { title: 'Forgeサーバー起動', description: 'Forge 1.20.1 が起動するまで待つ', state: server },
    { title: 'Minecraft起動', description: 'ランチャーを開いてサーバーに接続', state: gameRunning ? 'done' : 'pending' },
    { title: 'BRIDGE起動', description: 'TikTok → BridgeMOD 接続', state: bridge },
    { title: '配布ワールド選択', description: world || '配信ワールドを選択してください', state: 'manual' },
    { title: 'ワールド・MAP保存を確認', description: `${world || '配信ワールドを選択'}。必要に応じてMAPを保存してください。`, state: 'manual' },
    { title: 'TIKTOK LIVE 配信開始', description: '配信開始ボタンはLive Studio側で押します', state: live ? 'done' : 'manual' },
  ];
  return <aside className="cockpit-flow-panel" aria-label="配信開始の手順">
    <h2>ライブ手順 <small>（起動フロー）</small></h2>
    <div className="cockpit-flow-list">
      {steps.map((step, index) => <div className={`cockpit-flow-step cockpit-flow-step--${step.state}`} key={step.title}>
        <span>{index + 1}</span>
        <div><b>{step.title}</b><small>{step.description}</small><em>{LABELS[step.state]}</em></div>
      </div>)}
    </div>
    <p className="cockpit-flow-note">初回は「初期セットアップ」でフォルダーを設定してください。</p>
  </aside>;
}
