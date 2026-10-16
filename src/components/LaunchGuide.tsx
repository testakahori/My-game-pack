import React from 'react';

type State = 'pending' | 'active' | 'done' | 'error' | 'manual';
const LABELS: Record<State, string> = { pending: '待機中', active: '処理中', done: '完了', error: '確認が必要', manual: '自分で確認' };

export default function LaunchGuide({ server, bridge, gameRunning, live, world }: {
  server: State; bridge: State; gameRunning: boolean; live: boolean; world: string;
}) {
  const steps: Array<{ title: string; description: string; state: State }> = [
    { title: 'LIVE STUDIOで接続', description: '接続済みなら「一括起動」へ進みます。', state: 'manual' },
    { title: 'Forgeサーバー起動', description: '一括起動で自動的に準備します。', state: server },
    { title: 'Minecraftを起動', description: 'ランチャーから起動してサーバーに参加します。', state: gameRunning ? 'done' : 'pending' },
    { title: 'BRIDGE起動', description: 'ギフト・いいねを受け取ります。', state: bridge },
    { title: 'ワールド・MAP保存を確認', description: `${world || '配信ワールドを選択'}。必要に応じてMAPを保存してください。`, state: 'manual' },
    { title: 'LIVE STUDIOで配信開始', description: '配信開始ボタンはLIVE STUDIO側で押します。', state: live ? 'done' : 'manual' },
  ];
  return <aside className="cockpit-flow-panel" aria-label="配信開始の手順">
    <h2>配信開始の手順</h2>
    <ol className="cockpit-flow-list">
      {steps.map((step, index) => <li className={`cockpit-flow-step cockpit-flow-step--${step.state}`} key={step.title}>
        <span>{index + 1}</span>
        <div><b>{step.title}</b><small>{step.description}</small><em>{LABELS[step.state]}</em></div>
      </li>)}
    </ol>
    <p className="cockpit-flow-note">自動確認できない項目は「自分で確認」と表示します。</p>
  </aside>;
}
